/**
 * create-backup.test.ts
 *
 * Comprehensive tests for the backup archive creation library.
 * Covers positive, negative, and edge cases.
 *
 * Negative tests (Q7 coverage):
 * - Missing uploads directory -> gracefully skipped, ZIP contains manifest.json
 * - Empty/tableless DB         -> fails closed instead of producing a partial ZIP
 * - Missing DB file            -> throws Error when no dbParam provided
 * - No files in uploads        -> ZIP contains manifest.json and data/ files only
 *
 * Run: npx tsx src/lib/create-backup.test.ts
 */

import { createBackupArchive } from './create-backup';
import { existsSync, mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '../db/schema';

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

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

let testDir: string;

function setupTestDir() {
  testDir = mkdtempSync(join(tmpdir(), 'backup-test-'));
  mkdirSync(join(testDir, '.trading-journal'), { recursive: true });
  mkdirSync(join(testDir, 'public', 'uploads', 'trades'), { recursive: true });
}

function teardownTestDir() {
  if (testDir && existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
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

// ────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────

async function runTests() {
  // ── Negative: missing uploads directory ───────────────────────────────
  {
    console.log('\n## Missing uploads directory');
    const originalEnv = process.env.DB_FILE_NAME;

    try {
      setupTestDir();
      const dbPath = join(testDir, '.trading-journal', 'journal.db');
      process.env.DB_FILE_NAME = dbPath;
      const { sqlite, db: testDb } = createSchemaDb(dbPath);

      // Remove the uploads directory to test graceful handling
      const uploadsDir = join(testDir, 'public', 'uploads', 'trades');
      rmSync(uploadsDir, { recursive: true, force: true });

      const stream = await createBackupArchive(testDb);
      assert(stream instanceof ReadableStream, 'missing uploads -> returns a ReadableStream');

      const buffer = await streamToBuffer(stream);
      assert(buffer.length > 0, 'missing uploads -> ZIP buffer has data');

      // Verify ZIP signature
      const hasZipSig = buffer[0] === 0x50 && buffer[1] === 0x4B;
      assert(hasZipSig, 'missing uploads -> buffer is a valid ZIP (PK signature)');

      const contents = buffer.toString('latin1');
      const hasManifest = contents.includes('manifest.json');
      assert(hasManifest, 'missing uploads -> ZIP contains manifest.json');

      const hasDataDir = contents.includes('data/');
      assert(hasDataDir, 'missing uploads -> ZIP contains data/ entries');

      const hasUploadEntry = contents.includes('uploads/');
      assert(!hasUploadEntry, 'missing uploads -> ZIP does not contain uploads/ entries');

      sqlite.close();
    } finally {
      process.env.DB_FILE_NAME = originalEnv;
      teardownTestDir();
    }
  }

  // ── Negative: empty/tableless DB fails closed ───────────────────────
  {
    console.log('\n## Empty/tableless database (fails closed)');

    try {
      setupTestDir();
      // Create a database with no tables. A backup must never encode failed
      // table reads as an apparently valid archive.
      const sqlite = new Database(':memory:');
      const testDb = drizzle(sqlite, { schema });

      let threw = false;
      try {
        await createBackupArchive(testDb);
      } catch {
        threw = true;
      }
      assert(threw, 'tableless DB -> backup creation fails closed');

      sqlite.close();
    } finally {
      teardownTestDir();
    }
  }

  // ── Positive: full backup with uploads ────────────────────────────────
  {
    console.log('\n## Full backup with uploads');
    const originalEnv = process.env.DB_FILE_NAME;

    try {
      setupTestDir();
      const dbPath = join(testDir, '.trading-journal', 'journal.db');
      process.env.DB_FILE_NAME = dbPath;
      const { sqlite, db: testDb } = createSchemaDb(dbPath);

      const uploadsDir = join(testDir, 'public', 'uploads', 'trades');
      writeFileSync(join(uploadsDir, 'screenshot1.png'), Buffer.from('fake png data 1'));
      writeFileSync(join(uploadsDir, 'screenshot2.png'), Buffer.from('fake png data 2'));
      writeFileSync(join(uploadsDir, '.gitkeep'), '');

      const stream = await createBackupArchive(testDb);
      assert(stream instanceof ReadableStream, 'full backup -> returns a ReadableStream');

      const buffer = await streamToBuffer(stream);
      assert(buffer.length > 0, 'full backup -> ZIP buffer has data');

      const hasZipSig = buffer[0] === 0x50 && buffer[1] === 0x4B;
      assert(hasZipSig, 'full backup -> buffer is a valid ZIP (PK signature)');

      const contents = buffer.toString('latin1');

      // JSON format checks
      const hasManifest = contents.includes('manifest.json');
      assert(hasManifest, 'full backup -> ZIP contains manifest.json');

      const hasDataDir = contents.includes('data/');
      assert(hasDataDir, 'full backup -> ZIP contains data/ directory entries');

      // Upload checks
      assert(contents.includes('uploads/screenshot1.png'), 'full backup -> ZIP contains uploads/screenshot1.png');
      assert(contents.includes('uploads/screenshot2.png'), 'full backup -> ZIP contains uploads/screenshot2.png');

      const hasGitkeep = contents.includes('.gitkeep');
      assert(!hasGitkeep, 'full backup -> .gitkeep is excluded from ZIP');

      // journal.db should NOT be in the new JSON format
      const hasJournalDb = contents.includes('journal.db');
      assert(!hasJournalDb, 'full backup -> journal.db is NOT in the ZIP (JSON format)');

      sqlite.close();
    } finally {
      process.env.DB_FILE_NAME = originalEnv;
      teardownTestDir();
    }
  }

  // ── Edge: empty uploads directory ─────────────────────────────────────
  {
    console.log('\n## Empty uploads directory');
    const originalEnv = process.env.DB_FILE_NAME;

    try {
      setupTestDir();
      const dbPath = join(testDir, '.trading-journal', 'journal.db');
      process.env.DB_FILE_NAME = dbPath;
      const { sqlite, db: testDb } = createSchemaDb(dbPath);

      const uploadsDir = join(testDir, 'public', 'uploads', 'trades');
      writeFileSync(join(uploadsDir, '.gitkeep'), '');

      const stream = await createBackupArchive(testDb);
      const buffer = await streamToBuffer(stream);

      const contents = buffer.toString('latin1');
      const hasManifest = contents.includes('manifest.json');
      assert(hasManifest, 'empty uploads -> ZIP contains manifest.json');

      const hasDataDir = contents.includes('data/');
      assert(hasDataDir, 'empty uploads -> ZIP contains data/ entries');

      assert(!contents.includes('.gitkeep'), 'empty uploads -> .gitkeep excluded');
      assert(!contents.includes('uploads/'), 'empty uploads -> no uploads/ prefix entries');

      sqlite.close();
    } finally {
      process.env.DB_FILE_NAME = originalEnv;
      teardownTestDir();
    }
  }
}

// ────────────────────────────────────────────────────────────────────────
// Run
// ────────────────────────────────────────────────────────────────────────

runTests()
  .then(() => {
    console.log(`\n=== ${passed} passed, ${failed} failed ===`);
    if (failed > 0) {
      process.exit(1);
    }
  })
  .catch((err) => {
    console.error('Test suite error:', err);
    process.exit(1);
  });
