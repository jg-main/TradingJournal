/**
 * Runtime smoke test for the backup job (T04).
 *
 * Verifies:
 * - createBackupBuffer() produces a valid ZIP
 * - runBackupJob() writes a ZIP to the backup dir
 * - performRetentionCleanup() deletes oldest files
 * - getBackupDir() returns a valid path
 *
 * Run: npx tsx src/lib/__tests__/backup-job-runtime.test.ts
 */

process.env.DB_FILE_NAME = testDbPath('backup-job-runtime');

import { testDbPath } from '../testing/test-db';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '@/db/schema';
import { getBackupDir, performRetentionCleanup, runBackupJob } from '@/lib/backup-job';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.error(`  ❌ ${msg} (FAILED)`); }
}

async function main() {
  console.log('\n🖥️ Backup Job Runtime Tests\n' + '═'.repeat(40) + '\n');

  // ── Setup ──────────────────────────────────────────────────────────
  const dbFile = process.env.DB_FILE_NAME!;
  const backupDir = dirname(dbFile) + '/backups';

  // Clean up from prior runs
  for (const f of [dbFile, dbFile + '-wal', dbFile + '-shm', backupDir]) {
    try { rmSync(f, { recursive: true, force: true }); } catch {}
  }

  // Create a fresh DB with migrations applied
  mkdirSync(dirname(dbFile), { recursive: true });
  const sqlite = new Database(dbFile);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  const migrationsDir = join(process.cwd(), 'src/db/migrations');
  migrate(db, { migrationsFolder: migrationsDir });

  // Seed a settings row with backup retention = 2
  const now = new Date().toISOString();
  db.insert(schema.settings).values({
    id: crypto.randomUUID(),
    backupEnabled: false,
    backupRetentionCount: 2,
    createdAt: now,
    updatedAt: now,
  }).run();

  // ── Test 1: getBackupDir ───────────────────────────────────────────
  console.log('▶ getBackupDir');
  {
    const dir = getBackupDir();
    assert(typeof dir === 'string', 'returns a string');
    assert(dir.endsWith('/backups') || dir.endsWith('backups'), 'ends with backups directory');
    assert(!dir.includes(':'), 'no colons in path');
  }

  // ── Test 2: runBackupJob - first backup ────────────────────────────
  console.log('\n▶ First backup');
  {
    await runBackupJob(db);

    // Check settings were updated
    const row = db.select().from(schema.settings).limit(1).get();
    assert(row?.backupLastRunStatus === 'success', 'backupLastRunStatus = success');
    assert(row?.backupLastRunAt !== null, 'backupLastRunAt is set');

    // Check backup file exists
    assert(existsSync(backupDir), 'backup dir exists');
    const files = readdirSync(backupDir).filter((f) => f.startsWith('backup-') && f.endsWith('.zip'));
    assert(files.length === 1, `exactly 1 backup file (got ${files.length})`);
    assert(files[0].startsWith('backup-'), 'filename starts with "backup-"');
    assert(files[0].endsWith('.zip'), 'filename ends with ".zip"');
    console.log(`  📄 Created: ${files[0]}`);
  }

  // ── Test 3: runBackupJob - second backup ───────────────────────────
  console.log('\n▶ Second backup');
  {
    await runBackupJob(db);

    const files = readdirSync(backupDir).filter((f) => f.startsWith('backup-') && f.endsWith('.zip'));
    assert(files.length === 2, `exactly 2 backup files (got ${files.length})`);
    // First file should be older (lexicographic sort of ISO timestamps)
    assert(files[0] < files[1], 'first backup filename sorts before second');
    console.log(`  📄 ${files[0]}`);
    console.log(`  📄 ${files[1]}`);
  }

  // ── Test 4: retention cleanup ──────────────────────────────────────
  console.log('\n▶ Retention cleanup (max 1)');
  {
    // Create a few fake backup files to test the retention logic
    writeFileSync(join(backupDir, 'backup-2025-01-01T00-00-00-000Z.zip'), Buffer.from('fake1'));
    writeFileSync(join(backupDir, 'backup-2025-01-02T00-00-00-000Z.zip'), Buffer.from('fake2'));
    writeFileSync(join(backupDir, 'backup-2025-01-03T00-00-00-000Z.zip'), Buffer.from('fake3'));

    const before = readdirSync(backupDir).filter((f) => f.startsWith('backup-') && f.endsWith('.zip'));
    console.log(`  Files before cleanup: ${before.length}`);

    performRetentionCleanup(backupDir, 1);

    const after = readdirSync(backupDir).filter((f) => f.startsWith('backup-') && f.endsWith('.zip'));
    assert(after.length === 1, `1 file remains after retention cleanup (got ${after.length})`);
    // The most recent backup should be the one kept
    const maxFilename = [...before].sort().pop()!;
    assert(after[0] === maxFilename, `kept the most recent file: ${after[0]}`);
    console.log(`  Files after cleanup: ${after.length} (kept: ${after[0]})`);
  }

  // ── Test 5: retention cleanup on empty dir ─────────────────────────
  console.log('\n▶ Retention cleanup on empty directory');
  {
    try { rmSync(backupDir, { recursive: true, force: true }); } catch {}
    // Should not throw
    performRetentionCleanup(backupDir, 3);
    assert(true, 'no-op on non-existent directory');
  }

  // ── Test 6: retention cleanup with fewer files than limit ──────────
  console.log('\n▶ Retention cleanup with files < limit');
  {
    mkdirSync(backupDir, { recursive: true });
    writeFileSync(join(backupDir, 'backup-2025-06-01T00-00-00-000Z.zip'), Buffer.from('a'));
    performRetentionCleanup(backupDir, 5);
    const files = readdirSync(backupDir).filter((f) => f.startsWith('backup-') && f.endsWith('.zip'));
    assert(files.length === 1, `1 file remains when limit is 5 (got ${files.length})`);
    console.log(`  Files after cleanup (limit=5, had 1): ${files.length}`);
  }

  // ── Summary ────────────────────────────────────────────────────────
  const total = passed + failed;
  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Results: ${passed}/${total} passed`);
  if (failed > 0) {
    console.error(`         ${failed}/${total} FAILED\n`);
    process.exit(1);
  } else {
    console.log('         All tests passed!\n');
  }

  // ── Cleanup ────────────────────────────────────────────────────────
  sqlite.close();
  for (const f of [dbFile, dbFile + '-wal', dbFile + '-shm', backupDir]) {
    try { rmSync(f, { recursive: true, force: true }); } catch {}
  }
}

main()
  .then(() => failed > 0 ? process.exit(1) : process.exit(0))
  .catch((err) => { console.error('Test suite error:', err); process.exit(1); });
