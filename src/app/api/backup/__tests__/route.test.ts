/**
 * /api/backup route tests
 *
 * Tests the GET handler for backup ZIP download:
 *  - Valid backup returns 200 with correct Content-Type and Content-Disposition headers
 *  - Missing database file returns 500 with project error shape
 *  - ZIP filename includes date stamp
 *  - Error response follows { error: string, details: string } pattern
 *  - Missing/empty uploads directory is handled gracefully
 *
 * Follows the replica pattern from /api/trades/export/__tests__/route.test.ts.
 *
 * Run: npx tsx src/app/api/backup/__tests__/route.test.ts
 */

process.env.DB_FILE_NAME = './.test-m06-s02-t02-db';

import { mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ZipArchive } from 'archiver';
import { Readable } from 'node:stream';

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
 * Create a minimal valid SQLite database file at the given path.
 */
function createMinimalSqliteDb(dbPath: string) {
  mkdirSync(join(dbPath, '..'), { recursive: true });
  const header = Buffer.alloc(100);
  header.write('SQLite format 3\0', 0, 19, 'ascii');
  header.writeUInt16BE(512, 20); // page size = 512
  writeFileSync(dbPath, header);
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
 * Uses archiver directly (bypassing server-only import in @/db/index)
 * and operates on explicit dbPath and uploadsDir paths.
 */
function doGetBackup(overrides?: { dbPath?: string; uploadsDir?: string }): BackupTestResult {
  try {
    const dbPath = overrides?.dbPath ?? (process.env.DB_FILE_NAME || './.trading-journal/journal.db');
    const uploadsDir = overrides?.uploadsDir ?? 'public/uploads/trades';

    // Check DB file exists
    if (!existsSync(dbPath)) {
      throw new Error(`Database file not found at ${dbPath}`);
    }

    const archive = new ZipArchive({ zlib: { level: 9 } });
    const webStream = nodeStreamToWeb(archive);

    // Add DB file
    archive.file(dbPath, { name: 'journal.db' });

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
    createMinimalSqliteDb(dbPath);

    const uploadsDir = join(testDir, 'public', 'uploads', 'trades');
    mkdirSync(uploadsDir, { recursive: true });
    writeFileSync(join(uploadsDir, 'screenshot1.png'), Buffer.from('fake png data'));
    writeFileSync(join(uploadsDir, '.gitkeep'), '');

    try {
      const result = doGetBackup({ dbPath, uploadsDir });
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
      assert(contents.includes('journal.db'), 'ZIP contains journal.db');
      assert(contents.includes('uploads/screenshot1.png'), 'ZIP contains uploads/screenshot1.png');

      // .gitkeep should be excluded
      assert(!contents.includes('.gitkeep'), 'ZIP excludes .gitkeep placeholder');
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  // ── Test 2: Missing DB file returns 500 with error shape ──────────────
  console.log('\n\u25B6 Missing Database File');

  {
    const testDir = mkdtempSync(join(tmpdir(), 'backup-route-test-'));
    const missingDbPath = join(testDir, 'nonexistent.db');

    try {
      const result = doGetBackup({ dbPath: missingDbPath });
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
    createMinimalSqliteDb(dbPath);

    // Don't create uploads dir - verify graceful handling
    try {
      const result = doGetBackup({ dbPath, uploadsDir: join(testDir, 'public', 'uploads', 'trades') });
      assert(result.status === 200, 'Missing uploads still returns 200');

      const buffer = await streamToBuffer(result.body!);
      const hasZipSig = buffer[0] === 0x50 && buffer[1] === 0x4B;
      assert(hasZipSig, 'Stream is valid ZIP even without uploads');

      const contents = buffer.toString('latin1');
      assert(contents.includes('journal.db'), 'ZIP contains journal.db');
      assert(!contents.includes('uploads/'), 'No uploads entries in ZIP');
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  // ── Test 4: Empty uploads directory produces valid ZIP ────────────────
  console.log('\n\u25B6 Empty Uploads Directory');

  {
    const testDir = mkdtempSync(join(tmpdir(), 'backup-route-test-'));
    const dbPath = join(testDir, '.trading-journal', 'journal.db');
    createMinimalSqliteDb(dbPath);

    const uploadsDir = join(testDir, 'public', 'uploads', 'trades');
    mkdirSync(uploadsDir, { recursive: true });
    writeFileSync(join(uploadsDir, '.gitkeep'), ''); // only .gitkeep

    try {
      const result = doGetBackup({ dbPath, uploadsDir });
      assert(result.status === 200, 'Empty uploads returns 200');

      const buffer = await streamToBuffer(result.body!);
      const contents = buffer.toString('latin1');
      assert(contents.includes('journal.db'), 'ZIP contains journal.db');
      assert(!contents.includes('.gitkeep'), 'ZIP excludes .gitkeep');
      assert(!contents.includes('uploads/'), 'No uploads/ entries');
    } finally {
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
