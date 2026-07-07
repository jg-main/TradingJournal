/**
 * /api/backup route tests
 *
 * Tests the GET handler for backup ZIP download:
 *  - Valid backup returns 200 with correct Content-Type and Content-Disposition headers
 *  - ZIP contains manifest.json and data/<table>.json instead of raw journal.db
 *  - ZIP filename includes date stamp
 *  - Missing database file returns 500 with project error shape
 *  - Error response follows { error: string, details: string } pattern
 *  - Missing/empty uploads directory is handled gracefully
 *  - All 17 tables produce data/<table>.json entries in ZIP
 *
 * Follows the replica pattern from /api/trades/export/__tests__/route.test.ts.
 * Uses the real serializeBackup from backup-serializer to produce JSON-format ZIPs.
 *
 * Run: npx tsx src/app/api/backup/__tests__/route.test.ts
 */

process.env.DB_FILE_NAME = './.test-m06-s02-t02-db';

import { mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { ZipArchive } from 'archiver';
import { Readable } from 'node:stream';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '@/db/schema';
import { serializeBackup, TABLE_REGISTRY } from '@/lib/backup-serializer';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    passed++;
    console.log(`  \u2705 ${msg}`);
  } else {
    failed++;
    console.error(`  \u274c ${msg} (FAILED)`);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Convert a Node.js Readable stream to a Web ReadableStream<Uint8Array>.
 * Replica of the helper in src/lib/create-backup.ts.
 */
function nodeStreamToWeb(nodeStream: Readable): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      nodeStream.on('data', (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
      });
      nodeStream.on('end', () => {
        controller.close();
      });
      nodeStream.on('error', (err: Error) => {
        controller.error(err);
      });
    },
    cancel() {
      nodeStream.destroy();
    },
  });
}

/**
 * Consume a ReadableStream into a Buffer for inspection.
 */
async function streamToBuffer(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)));
}

/**
 * Create a fresh SQLite database with the full schema applied via Drizzle migrations.
 */
function createSchemaDb(dbPath: string) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const testDb = drizzle(sqlite, { schema });
  const migrationsDir = join(process.cwd(), 'src/db/migrations');
  migrate(testDb, { migrationsFolder: migrationsDir });
  return { sqlite, db: testDb };
}

interface BackupTestResult {
  status: number;
  body: ReadableStream<Uint8Array> | null;
  headers: Record<string, string>;
  error?: string;
  details?: unknown;
}

/**
 * Replica of the route handler logic for testing.
 *
 * Uses the real serializeBackup from backup-serializer (bypassing server-only
 * import in @/db/index) and operates on explicit dbPath and uploadsDir paths.
 */
async function doGetBackup(overrides?: {
  dbPath?: string;
  uploadsDir?: string;
  sqlite?: Database.Database;
  testDb?: ReturnType<typeof drizzle<typeof schema>>;
}): Promise<BackupTestResult> {
  try {
    const dbPath = overrides?.dbPath ?? process.env.DB_FILE_NAME ?? './.trading-journal/journal.db';
    const uploadsDir = overrides?.uploadsDir ?? 'public/uploads/trades';

    // Check DB file exists
    if (!existsSync(dbPath)) {
      throw new Error(`Database file not found at ${dbPath}`);
    }

    // Use the provided Drizzle instance, or open a fresh one
    let testDb: ReturnType<typeof drizzle<typeof schema>>;
    let sqlite: Database.Database | null = null;
    if (overrides?.testDb) {
      testDb = overrides.testDb;
    } else {
      sqlite = new Database(dbPath);
      testDb = drizzle(sqlite, { schema });
    }

    // Checkpoint WAL to flush recent writes
    testDb.run('PRAGMA wal_checkpoint(TRUNCATE)');

    // Serialize all tables to JSON
    const backupData = await serializeBackup(testDb);

    const archive = new ZipArchive({ zlib: { level: 9 } });
    const webStream = nodeStreamToWeb(archive);

    // Write manifest.json to the archive root
    archive.append(JSON.stringify(backupData.manifest, null, 2), { name: 'manifest.json' });

    // Write per-table JSON files under data/
    for (const { name } of TABLE_REGISTRY) {
      const rows = backupData.tables[name] ?? [];
      archive.append(JSON.stringify(rows, null, 2), { name: `data/${name}.json` });
    }

    // Add uploads
    if (existsSync(uploadsDir)) {
      const files = readdirSync(uploadsDir);
      for (const file of files) {
        if (file === '.gitkeep') continue;
        const filePath = join(uploadsDir, file);
        if (statSync(filePath).isFile()) {
          archive.file(filePath, { name: `uploads/${file}` });
        }
      }
    }

    archive.finalize();

    if (sqlite) sqlite.close();

    const filename = `trading-journal-backup-${new Date().toISOString().slice(0, 10)}.zip`;

    return {
      status: 200,
      body: webStream,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    };
  } catch (error) {
    return {
      status: 500,
      body: null,
      headers: {},
      error: 'Failed to create backup archive',
      details: String(error),
    };
  }
}

// ── Tests ───────────────────────────────────────────────────────────────

async function runTests() {
  console.log('\n\uD83D\uDDA5\uFE0F Backup API Route Tests');
  console.log('\u2550'.repeat(40) + '\n');

  // ── Test 1: Successful backup returns 200 with correct headers ────────
  console.log('\u25B6 Successful Backup');

  {
    const testDir = mkdtempSync(join(tmpdir(), 'backup-route-test-'));
    const dbPath = join(testDir, '.trading-journal', 'journal.db');
    // Use a proper schema DB so serializeBackup works
    const { sqlite, db: testDb } = createSchemaDb(dbPath);

    const uploadsDir = join(testDir, 'public', 'uploads', 'trades');
    mkdirSync(uploadsDir, { recursive: true });
    writeFileSync(join(uploadsDir, 'screenshot1.png'), Buffer.from('fake png data'));
    writeFileSync(join(uploadsDir, '.gitkeep'), '');

    try {
      const result = await doGetBackup({ dbPath, uploadsDir, sqlite, testDb });
      assert(result.status === 200, 'Successful backup returns 200');
      assert(result.body instanceof ReadableStream, 'Body is a ReadableStream');
      assert(result.headers['Content-Type'] === 'application/zip', 'Content-Type is application/zip');
      assert(
        result.headers['Content-Disposition'].startsWith('attachment; filename="trading-journal-backup-'),
        'Content-Disposition has correct filename prefix',
      );
      assert(
        result.headers['Content-Disposition'].endsWith('.zip"'),
        'Content-Disposition ends with .zip"',
      );

      // Verify the stream is a valid ZIP containing expected entries
      const buffer = await streamToBuffer(result.body!);
      const hasZipSig = buffer[0] === 0x50 && buffer[1] === 0x4B;
      assert(hasZipSig, 'Stream produces a valid ZIP archive (PK signature)');

      const contents = buffer.toString('latin1');

      // JSON format: manifest.json and data/*.json instead of journal.db
      assert(contents.includes('manifest.json'), 'ZIP contains manifest.json (JSON format)');
      assert(contents.includes('data/'), 'ZIP contains data/ directory entries');
      assert(!contents.includes('journal.db'), 'ZIP does NOT contain raw journal.db (JSON format)');

      // Upload check
      assert(contents.includes('uploads/screenshot1.png'), 'ZIP contains uploads/screenshot1.png');

      // .gitkeep should be excluded
      assert(!contents.includes('.gitkeep'), 'ZIP excludes .gitkeep placeholder');

      // Verify a few expected data files
      assert(contents.includes('data/accounts.json'), 'ZIP contains data/accounts.json');
      assert(contents.includes('data/settings.json'), 'ZIP contains data/settings.json');
      assert(contents.includes('data/trades.json'), 'ZIP contains data/trades.json');
    } finally {
      sqlite.close();
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  // ── Test 2: Missing DB file returns 500 with error shape ──────────────
  console.log('\n\u25B6 Missing Database File');

  {
    const testDir = mkdtempSync(join(tmpdir(), 'backup-route-test-'));
    const missingDbPath = join(testDir, 'nonexistent.db');

    try {
      const result = await doGetBackup({ dbPath: missingDbPath });
      assert(result.status === 500, 'Missing DB returns 500');
      assert(result.error === 'Failed to create backup archive', 'Error message matches');
      assert(typeof result.details === 'string', 'Details is a string');
      assert(
        (result.details as string).includes('Database file not found'),
        'Details mentions the missing DB file',
      );
      assert(result.body === null, 'Body is null on error');
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  // ── Test 3: Missing uploads directory is graceful ────────────────────
  console.log('\n\u25B6 Missing Uploads Directory');

  {
    const testDir = mkdtempSync(join(tmpdir(), 'backup-route-test-'));
    const dbPath = join(testDir, '.trading-journal', 'journal.db');
    const { sqlite, db: testDb } = createSchemaDb(dbPath);

    // Don't create uploads dir - verify graceful handling
    try {
      const result = await doGetBackup({ dbPath, uploadsDir: join(testDir, 'public', 'uploads', 'trades'), sqlite, testDb });
      assert(result.status === 200, 'Missing uploads still returns 200');

      const buffer = await streamToBuffer(result.body!);
      const hasZipSig = buffer[0] === 0x50 && buffer[1] === 0x4B;
      assert(hasZipSig, 'Stream is valid ZIP even without uploads');

      const contents = buffer.toString('latin1');

      // JSON format checks instead of journal.db
      assert(contents.includes('manifest.json'), 'Missing uploads ZIP contains manifest.json');
      assert(contents.includes('data/'), 'Missing uploads ZIP contains data/ directory entries');
      assert(!contents.includes('journal.db'), 'ZIP does NOT contain raw journal.db');
      assert(!contents.includes('uploads/'), 'No uploads entries in ZIP');
    } finally {
      sqlite.close();
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  // ── Test 4: Empty uploads directory produces valid ZIP ────────────────
  console.log('\n\u25B6 Empty Uploads Directory');

  {
    const testDir = mkdtempSync(join(tmpdir(), 'backup-route-test-'));
    const dbPath = join(testDir, '.trading-journal', 'journal.db');
    const { sqlite, db: testDb } = createSchemaDb(dbPath);

    const uploadsDir = join(testDir, 'public', 'uploads', 'trades');
    mkdirSync(uploadsDir, { recursive: true });
    writeFileSync(join(uploadsDir, '.gitkeep'), ''); // only .gitkeep

    try {
      const result = await doGetBackup({ dbPath, uploadsDir, sqlite, testDb });
      assert(result.status === 200, 'Empty uploads returns 200');

      const buffer = await streamToBuffer(result.body!);
      const contents = buffer.toString('latin1');

      // JSON format checks
      assert(contents.includes('manifest.json'), 'Empty uploads ZIP contains manifest.json');
      assert(contents.includes('data/'), 'Empty uploads ZIP contains data/ entries');
      assert(!contents.includes('journal.db'), 'ZIP does NOT contain raw journal.db');
      assert(!contents.includes('.gitkeep'), 'ZIP excludes .gitkeep');
      assert(!contents.includes('uploads/'), 'No uploads/ entries');
    } finally {
      sqlite.close();
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  // ── Test 5: Verify all 17 tables produce data/ entries in ZIP ────────
  console.log('\n\u25B6 All 17 Tables in data/');

  {
    const testDir = mkdtempSync(join(tmpdir(), 'backup-route-test-'));
    const dbPath = join(testDir, '.trading-journal', 'journal.db');
    const { sqlite, db: testDb } = createSchemaDb(dbPath);

    try {
      const result = await doGetBackup({ dbPath, sqlite, testDb });
      assert(result.status === 200, 'Returns 200');

      const buffer = await streamToBuffer(result.body!);
      const contents = buffer.toString('latin1');

      // ZIP headers store filenames in plain text — verify all 17 table data files
      const expectedTables = [
        'app_profile',
        'settings',
        'accounts',
        'lookup_values',
        'setup_definitions',
        'trades',
        'trade_executions',
        'trade_risk_snapshots',
        'trade_stop_adjustments',
        'trade_assets',
        'trade_grades',
        'trade_mistakes',
        'watchlist_items',
        'account_transactions',
        'account_rollforward',
        'weekly_reviews',
        'review_action_items',
      ];

      for (const table of expectedTables) {
        assert(contents.includes(`data/${table}.json`), `ZIP contains data/${table}.json`);
      }
    } finally {
      sqlite.close();
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────

  const total = passed + failed;
  console.log(`\n${'\u2500'.repeat(40)}`);
  console.log(`Results: ${passed}/${total} passed`);
  if (failed > 0) {
    console.error(`         ${failed}/${total} FAILED\n`);
    process.exit(1);
  } else {
    console.log('         All tests passed!\n');
  }
}

runTests()
  .then(() => {
    if (failed > 0) process.exit(1);
  })
  .catch((err) => {
    console.error('Test suite error:', err);
    process.exit(1);
  });
