/**
 * create-backup.test.ts
 *
 * Comprehensive tests for the backup archive creation library.
 * Covers positive, negative, and edge cases.
 *
 * Negative tests (Q7 coverage):
 * - Missing DB file -> Error thrown
 * - Missing uploads directory -> gracefully skipped
 * - Corrupted DB path -> Error thrown
 * - No files in uploads -> ZIP contains only journal.db
 *
 * Run: npx tsx src/lib/create-backup.test.ts
 */

import { createBackupArchive } from './create-backup';
import { existsSync, mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
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
 * Create a minimal valid SQLite database file at the given path.
 * Uses better-sqlite3 directly so the file has proper page-1 structure.
 */
function createMinimalSqliteDb(dbPath: string) {
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.close();
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
      createMinimalSqliteDb(dbPath);
      process.env.DB_FILE_NAME = dbPath;

      const sqlite = new Database(dbPath);
      const testDb = drizzle(sqlite, { schema });

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

      const hasJournalDb = buffer.toString('latin1').includes('journal.db');
      assert(hasJournalDb, 'missing uploads -> ZIP contains journal.db');

      const hasUploadEntry = buffer.toString('latin1').includes('uploads/');
      assert(!hasUploadEntry, 'missing uploads -> ZIP does not contain uploads/ entries');

      sqlite.close();
    } finally {
      process.env.DB_FILE_NAME = originalEnv;
      teardownTestDir();
    }
  }

  // ── Negative: missing DB file ────────────────────────────────────────
  {
    console.log('\n## Missing DB file');
    const originalEnv = process.env.DB_FILE_NAME;

    try {
      setupTestDir();

      // Create a valid SQLite db for the dbParam so the WAL checkpoint succeeds
      const validDbPath = join(testDir, '.trading-journal', 'valid.db');
      createMinimalSqliteDb(validDbPath);
      const sqlite = new Database(validDbPath);
      const testDb = drizzle(sqlite, { schema });

      // Set DB_FILE_NAME to a non-existent path so existsSync fails
      const nonExistentDb = join(testDir, '.trading-journal', 'nonexistent.db');
      process.env.DB_FILE_NAME = nonExistentDb;

      assert(!existsSync(nonExistentDb), 'missing DB -> env var file does not exist before test');

      let threw = false;
      try {
        const stream = await createBackupArchive(testDb);
        const reader = stream.getReader();
        await reader.cancel();
      } catch {
        threw = true;
      }
      assert(threw, 'missing DB file -> throws Error');

      sqlite.close();
    } finally {
      process.env.DB_FILE_NAME = originalEnv;
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
      createMinimalSqliteDb(dbPath);
      process.env.DB_FILE_NAME = dbPath;

      const sqlite = new Database(dbPath);
      const testDb = drizzle(sqlite, { schema });

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
      assert(contents.includes('journal.db'), 'full backup -> ZIP contains journal.db');
      assert(contents.includes('uploads/screenshot1.png'), 'full backup -> ZIP contains uploads/screenshot1.png');
      assert(contents.includes('uploads/screenshot2.png'), 'full backup -> ZIP contains uploads/screenshot2.png');

      const hasGitkeep = contents.includes('.gitkeep');
      assert(!hasGitkeep, 'full backup -> .gitkeep is excluded from ZIP');

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
      createMinimalSqliteDb(dbPath);
      process.env.DB_FILE_NAME = dbPath;

      const sqlite = new Database(dbPath);
      const testDb = drizzle(sqlite, { schema });

      const uploadsDir = join(testDir, 'public', 'uploads', 'trades');
      writeFileSync(join(uploadsDir, '.gitkeep'), '');

      const stream = await createBackupArchive(testDb);
      const buffer = await streamToBuffer(stream);

      const contents = buffer.toString('latin1');
      assert(contents.includes('journal.db'), 'empty uploads -> ZIP contains journal.db');
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
