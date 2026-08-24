/**
 * backup.test.ts
 *
 * Unit tests for the shared ZIP buffer creation (createBackupBuffer).
 *
 * Covers:
 *  - Positive: createBackupBuffer returns a Buffer with valid ZIP structure
 *  - Positive: ZIP contains manifest.json and all data/*.json for all 23 tables
 *  - Positive: ZIP contents match database state (correct row counts in manifest)
 *  - Negative: tableless DB fails closed instead of producing a partial ZIP
 *  - Edge: schemaVersion in ZIP manifest matches migration file count
 *  - Edge: backupTimestamp in manifest is valid ISO-8601
 *
 * Pattern: src/lib/create-backup.test.ts, src/lib/backup-job-runtime.test.ts
 *
 * Run: npx tsx src/lib/__tests__/backup.test.ts
 */

process.env.DB_FILE_NAME = testDbPath('backup-buffer-units');

import { testDbPath } from '../testing/test-db';
import { mkdirSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import AdmZip from 'adm-zip';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '@/db/schema';
import { createBackupBuffer } from '@/lib/create-backup';
import { TABLE_REGISTRY, getMigrationCount } from '@/lib/backup-serializer';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) { passed++; console.log(`  \u2705 ${msg}`); }
  else { failed++; console.error(`  \u274c ${msg} (FAILED)`); }
}

function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) { passed++; console.log(`  \u2705 ${msg}`); }
  else { failed++; console.error(`  \u274c ${msg} — expected "${expected}", got "${actual}" (FAILED)`); }
}

// ── Helpers ─────────────────────────────────────────────────────────────

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

/**
 * Extract the manifest JSON object from a backup ZIP buffer using adm-zip.
 */
function extractManifestFromZip(buffer: Buffer): Record<string, unknown> | null {
  try {
    const zip = new AdmZip(buffer);
    const entry = zip.getEntry('manifest.json');
    if (!entry) return null;
    const raw = entry.getData().toString('utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ── Tests ───────────────────────────────────────────────────────────────

async function runTests() {
  console.log('\n\uD83D\uDDA5\uFE0F Backup Buffer Unit Tests');
  console.log('\u2550'.repeat(40) + '\n');

  // ── Test 1: createBackupBuffer returns a Buffer ──────────────────────
  console.log('\u25B6 Returns a Buffer with valid ZIP');

  {
    const testDir = mkdtempSync(join(tmpdir(), 'backup-buffer-test-'));
    const dbPath = join(testDir, '.trading-journal', 'journal.db');
    const { sqlite, db: testDb } = createSchemaDb(dbPath);

    try {
      const buffer = await createBackupBuffer(testDb);
      assert(Buffer.isBuffer(buffer), 'createBackupBuffer returns a Buffer');
      assert(buffer.length > 0, 'Buffer is non-empty');

      // Verify ZIP signature
      const hasZipSig = buffer[0] === 0x50 && buffer[1] === 0x4B;
      assert(hasZipSig, 'Buffer starts with ZIP PK signature');

      sqlite.close();
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  // ── Test 2: ZIP contains manifest.json and data/*.json ───────────────
  console.log('\n\u25B6 ZIP entry structure via AdmZip');

  {
    const testDir = mkdtempSync(join(tmpdir(), 'backup-buffer-test-'));
    const dbPath = join(testDir, '.trading-journal', 'journal.db');
    const { sqlite, db: testDb } = createSchemaDb(dbPath);

    try {
      const buffer = await createBackupBuffer(testDb);
      const zip = new AdmZip(buffer);

      const entries = zip.getEntries().map((e) => e.entryName);
      assert(entries.some((e) => e === 'manifest.json'), 'ZIP contains manifest.json');
      assert(entries.some((e) => e.startsWith('data/')), 'ZIP contains data/ prefix entries');

      for (const { name } of TABLE_REGISTRY) {
        const expectedEntry = `data/${name}.json`;
        assert(entries.some((e) => e === expectedEntry), `ZIP contains ${expectedEntry}`);
      }

      assert(!entries.some((e) => e.includes('journal.db')), 'ZIP does not contain journal.db');

      sqlite.close();
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  // ── Test 3: Manifest row counts match seed data ──────────────────────
  console.log('\n\u25B6 Manifest correctness with seed data');

  {
    const testDir = mkdtempSync(join(tmpdir(), 'backup-buffer-test-'));
    const dbPath = join(testDir, '.trading-journal', 'journal.db');
    const { sqlite, db: testDb } = createSchemaDb(dbPath);

    try {
      const now = new Date().toISOString();
      sqlite.prepare(`INSERT INTO accounts (id, name, currency, is_active, starting_balance, created_at, updated_at)
        VALUES (?, 'Test Account', 'USD', 1, 50000, ?, ?)`)
        .run('acc-seed-1', now, now);
      sqlite.prepare(`INSERT INTO accounts (id, name, currency, is_active, starting_balance, created_at, updated_at)
        VALUES (?, 'Account Two', 'EUR', 1, 25000, ?, ?)`)
        .run('acc-seed-2', now, now);
      sqlite.prepare(`INSERT INTO settings (id, starting_account_value, max_risk_per_trade_pct, default_commission, currency, created_at, updated_at)
        VALUES (?, 50000, 1.0, 0.005, 'USD', ?, ?)`)
        .run('set-seed-1', now, now);
      sqlite.prepare(`INSERT INTO app_profile (id, display_name, timezone, default_currency, created_at)
        VALUES (?, 'Seed Trader', 'America/New_York', 'USD', ?)`)
        .run('prof-seed-1', now);

      const buffer = await createBackupBuffer(testDb);
      const manifest = extractManifestFromZip(buffer);

      assert(manifest !== null, 'manifest extracted from ZIP');
      assert(typeof manifest!['schemaVersion'] === 'number', 'manifest.schemaVersion is a number');

      const tables = manifest!['tables'] as Record<string, number>;
      assertEqual(tables['accounts'], 2, 'manifest.accounts row count = 2');
      assertEqual(tables['settings'], 1, 'manifest.settings row count = 1');
      assertEqual(tables['app_profile'], 1, 'manifest.app_profile row count = 1');
      assertEqual(tables['trades'], 0, 'manifest.trades row count = 0 (unseeded)');

      // Verify all data/*.json files are valid JSON arrays
      const zip = new AdmZip(buffer);
      for (const { name } of TABLE_REGISTRY) {
        const dataEntry = zip.getEntry(`data/${name}.json`);
        assert(dataEntry !== null, `data/${name}.json entry exists`);
        const dataRaw = dataEntry!.getData().toString('utf-8');
        const rows = JSON.parse(dataRaw);
        assert(Array.isArray(rows), `data/${name}.json parses as array`);
      }

      sqlite.close();
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  // ── Test 4: Empty/tableless DB fails closed ───────────────────────────
  console.log('\n\u25B6 Tableless database fails closed');

  {
    try {
      const sqlite = new Database(':memory:');
      const badDb = drizzle(sqlite, { schema });

      let threw = false;
      try {
        await createBackupBuffer(badDb);
      } catch (e) {
        threw = e instanceof Error && e.message.includes('Backup failed while reading table');
      }
      assert(threw, 'tableless DB: backup fails closed with table-read error');
      sqlite.close();
    } catch (e) {
      assert(false, `tableless DB: test errored — ${e}`);
    }
  }

  // ── Test 5: schemaVersion in ZIP matches migration count ──────────────
  console.log('\n\u25B6 Schema version alignment');

  {
    const testDir = mkdtempSync(join(tmpdir(), 'backup-buffer-test-'));
    const dbPath = join(testDir, '.trading-journal', 'journal.db');
    const { sqlite, db: testDb } = createSchemaDb(dbPath);

    try {
      const buffer = await createBackupBuffer(testDb);
      const manifest = extractManifestFromZip(buffer);

      assert(manifest !== null, 'manifest extracted from ZIP');

      const expectedVersion = getMigrationCount();
      assertEqual(
        manifest!['schemaVersion'] as number,
        expectedVersion,
        `schemaVersion (${manifest!['schemaVersion']}) matches getMigrationCount() (${expectedVersion})`,
      );

      sqlite.close();
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  // ── Test 6: backupTimestamp is valid ISO-8601 ─────────────────────────
  console.log('\n\u25B6 Backup timestamp validity');

  {
    const testDir = mkdtempSync(join(tmpdir(), 'backup-buffer-test-'));
    const dbPath = join(testDir, '.trading-journal', 'journal.db');
    const { sqlite, db: testDb } = createSchemaDb(dbPath);

    try {
      const before = new Date();
      const buffer = await createBackupBuffer(testDb);
      const after = new Date();
      const manifest = extractManifestFromZip(buffer);

      assert(manifest !== null, 'manifest extracted from ZIP');
      assert(typeof manifest!['backupTimestamp'] === 'string', 'backupTimestamp is a string');

      const tsStr = manifest!['backupTimestamp'] as string;
      const parsed = new Date(tsStr);
      assert(!isNaN(parsed.getTime()), `backupTimestamp "${tsStr}" is valid ISO-8601`);
      assert(
        parsed.getTime() >= before.getTime() - 1000 &&
        parsed.getTime() <= after.getTime() + 1000,
        'backupTimestamp is within expected time range',
      );

      sqlite.close();
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
  .then(() => { if (failed > 0) process.exit(1); })
  .catch((err) => { console.error('Test suite error:', err); process.exit(1); });
