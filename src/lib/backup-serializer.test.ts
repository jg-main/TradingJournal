/**
 * backup-serializer.test.ts
 *
 * Unit tests for the backup serializer module.
 * Covers positive cases (all tables serialize correctly with proper types
 * and manifest), negative cases (empty tables, missing db), and edge cases
 * (null/boolean/date fields, decimal precision).
 *
 * Runs against a real SQLite database with the full schema applied via
 * Drizzle migrations, seeded with representative test data.
 *
 * Pattern: src/lib/create-backup.test.ts, src/lib/dashboard.test.ts
 *
 * Run: npx tsx src/lib/backup-serializer.test.ts
 */

import { serializeBackup, TABLE_COUNT, getMigrationCount, type BackupData, type BackupManifest } from './backup-serializer';
import { existsSync, mkdirSync, rmSync, readdirSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '../db/schema';
import { readFileSync } from 'node:fs';

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

function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) {
    passed++;
    console.log(`  \u2705 ${msg}`);
  } else {
    failed++;
    console.error(`  \u274c ${msg} — expected "${expected}", got "${actual}" (FAILED)`);
  }
}

// ── Test helpers ────────────────────────────────────────────────────────

let testDir: string;

function setupTestDir() {
  testDir = mkdtempSync(join(tmpdir(), 'backup-serializer-test-'));
}

function teardownTestDir() {
  if (testDir && existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
}

/**
 * Create a fresh SQLite database with the full schema applied and seed data.
 */
function createTestDb() {
  const dbPath = join(testDir, 'journal.db');
  mkdirSync(dirname(dbPath), { recursive: true });

  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  const testDb = drizzle(sqlite, { schema });

  // Run migrations to create the full schema
  const migrationsDir = join(process.cwd(), 'src/db/migrations');
  migrate(testDb, { migrationsFolder: migrationsDir });

  return { sqlite, db: testDb, dbPath };
}

/**
 * Insert representative seed data across several tables for verification.
 */
function seedTestData(sqlite: Database.Database) {
  // Seed accounts
  sqlite.exec(`
    INSERT INTO accounts (id, name, broker, currency, is_active, starting_balance, created_at)
    VALUES ('acc-1', 'Main Account', 'Interactive Brokers', 'USD', 1, 50000.00, '2026-01-01T00:00:00.000Z')
  `);
  sqlite.exec(`
    INSERT INTO accounts (id, name, broker, currency, is_active, starting_balance, created_at)
    VALUES ('acc-2', 'Test Account', 'Paper', 'USD', 1, 10000.00, '2026-01-01T00:00:00.000Z')
  `);

  // Seed a lookup value
  sqlite.exec(`
    INSERT INTO lookup_values (id, type, value, sort_order, is_active, created_at)
    VALUES ('lv-1', 'sector', 'Technology', 1, 1, '2026-01-01T00:00:00.000Z')
  `);

  // Seed a trade
  sqlite.exec(`
    INSERT INTO trades (id, trade_code, account_id, symbol, direction, status, opened_at, created_at)
    VALUES ('trade-1', 'T001', 'acc-1', 'AAPL', 'long', 'open', '2026-06-01T10:00:00.000Z', '2026-06-01T10:00:00.000Z')
  `);

  // Seed a trade execution
  sqlite.exec(`
    INSERT INTO trade_executions (id, trade_id, executed_at, action, quantity, price, fees, created_at)
    VALUES ('exec-1', 'trade-1', '2026-06-01T10:05:00.000Z', 'buy', 100, 180.50, 1.99, '2026-06-01T10:05:00.000Z')
  `);

  // Seed a trade risk snapshot
  sqlite.exec(`
    INSERT INTO trade_risk_snapshots (id, trade_id, account_equity_at_open, initial_entry_price, initial_stop_price, initial_quantity, created_at)
    VALUES ('risk-1', 'trade-1', 50000.00, 180.50, 175.00, 100, '2026-06-01T10:00:00.000Z')
  `);

  // Seed settings
  sqlite.exec(`
    INSERT INTO settings (id, starting_account_value, max_risk_per_trade_pct, default_commission, currency, created_at)
    VALUES ('set-1', 50000.00, 1.0, 0.005, 'USD', '2026-01-01T00:00:00.000Z')
  `);

  // Seed app profile
  sqlite.exec(`
    INSERT INTO app_profile (id, display_name, timezone, default_currency, created_at)
    VALUES ('prof-1', 'Trader One', 'America/New_York', 'USD', '2026-01-01T00:00:00.000Z')
  `);
}

// ── Tests ───────────────────────────────────────────────────────────────

async function runTests() {
  console.log('\n\uD83D\uDDA5\uFE0F Backup Serializer Tests');
  console.log('\u2550'.repeat(40) + '\n');

  // ── Positive: full serialization with seed data ──────────────────────
  console.log('\u25B6 Full serialization with seed data');

  {
    setupTestDir();
    try {
      const { sqlite, db } = createTestDb();
      seedTestData(sqlite);

      const result: BackupData = await serializeBackup(db);

      // Verify result shape
      assert(result instanceof Object, 'result is an object');
      assert(result.manifest instanceof Object, 'result.manifest is an object');
      assert(result.tables instanceof Object, 'result.tables is an object');

      // Verify manifest fields
      const manifest: BackupManifest = result.manifest;
      assert(typeof manifest.schemaVersion === 'number' && manifest.schemaVersion > 0,
        `schemaVersion is positive (got ${manifest.schemaVersion})`);
      assert(typeof manifest.backupTimestamp === 'string' && manifest.backupTimestamp.length > 0,
        'backupTimestamp is a non-empty string');
      assert(typeof manifest.appVersion === 'string' && manifest.appVersion.length > 0,
        'appVersion is a non-empty string');

      // Verify backupTimestamp is valid ISO-8601
      const ts = new Date(manifest.backupTimestamp);
      assert(!isNaN(ts.getTime()), `backupTimestamp "${manifest.backupTimestamp}" is valid ISO-8601`);

      // Verify appVersion matches package.json
      const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8'));
      assertEqual(manifest.appVersion, pkg.version, `appVersion matches package.json (${pkg.version})`);

      // Verify all 17 tables present in manifest
      const tableNames = Object.keys(manifest.tables);
      assertEqual(tableNames.length, TABLE_COUNT, `manifest lists all ${TABLE_COUNT} tables`);

      // Verify seeded table row counts
      assertEqual(manifest.tables['accounts'], 2, 'accounts has 2 rows');
      assertEqual(manifest.tables['trades'], 1, 'trades has 1 row');
      assertEqual(manifest.tables['trade_executions'], 1, 'trade_executions has 1 row');
      assertEqual(manifest.tables['trade_risk_snapshots'], 1, 'trade_risk_snapshots has 1 row');
      assertEqual(manifest.tables['lookup_values'], 1, 'lookup_values has 1 row');
      assertEqual(manifest.tables['settings'], 1, 'settings has 1 row');
      assertEqual(manifest.tables['app_profile'], 1, 'app_profile has 1 row');

      // Verify unseeded tables have 0 rows
      assertEqual(manifest.tables['setup_definitions'], 0, 'setup_definitions has 0 rows');
      assertEqual(manifest.tables['trade_stop_adjustments'], 0, 'trade_stop_adjustments has 0 rows');
      assertEqual(manifest.tables['trade_assets'], 0, 'trade_assets has 0 rows');
      assertEqual(manifest.tables['trade_grades'], 0, 'trade_grades has 0 rows');
      assertEqual(manifest.tables['trade_mistakes'], 0, 'trade_mistakes has 0 rows');
      assertEqual(manifest.tables['watchlist_items'], 0, 'watchlist_items has 0 rows');
      assertEqual(manifest.tables['account_transactions'], 0, 'account_transactions has 0 rows');
      assertEqual(manifest.tables['account_rollforward'], 0, 'account_rollforward has 0 rows');
      assertEqual(manifest.tables['weekly_reviews'], 0, 'weekly_reviews has 0 rows');
      assertEqual(manifest.tables['review_action_items'], 0, 'review_action_items has 0 rows');

      // Verify tables data matches manifest counts
      assert(result.tables['accounts'] instanceof Array, 'tables.accounts is an array');
      assertEqual(result.tables['accounts'].length, 2, 'tables.accounts has 2 rows');
      assertEqual(result.tables['trades'].length, 1, 'tables.trades has 1 row');
      assertEqual(result.tables['trade_executions'].length, 1, 'tables.trade_executions has 1 row');
      assertEqual(result.tables['setup_definitions'].length, 0, 'tables.setup_definitions is empty');

      // Verify row content is serialized as plain objects
      const accountRow = result.tables['accounts'][0] as Record<string, unknown>;
      assertEqual(accountRow['id'], 'acc-1', 'account row has correct id');
      assertEqual(accountRow['name'], 'Main Account', 'account row has correct name');
      assertEqual(accountRow['broker'], 'Interactive Brokers', 'account row has correct broker');
      assertEqual(accountRow['currency'], 'USD', 'account row has correct currency');
      assertEqual(accountRow['startingBalance'] as number, 50000, 'account row has correct startingBalance (decimal)');

      // Verify boolean field is serialized as boolean (not 0/1)
      assert(typeof accountRow['isActive'] === 'boolean', 'isActive is a boolean, not integer');
      assertEqual(accountRow['isActive'] as boolean, true, 'isActive is true');

      // Verify date fields are serialized as strings
      const tradeRow = result.tables['trades'][0] as Record<string, unknown>;
      assert(typeof tradeRow['openedAt'] === 'string', 'openedAt is a string (date)');
      assertEqual(tradeRow['openedAt'] as string, '2026-06-01T10:00:00.000Z', 'openedAt matches seed value');

      // Verify decimal fields preserve precision
      const execRow = result.tables['trade_executions'][0] as Record<string, unknown>;
      assertEqual(execRow['price'] as number, 180.50, 'execution price preserves decimal (180.50)');
      assertEqual(execRow['fees'] as number, 1.99, 'execution fees preserve decimal (1.99)');

      // Verify nullable fields are present and null where appropriate
      assertEqual(tradeRow['sectorId'], null, 'nullable sectorId is null');
      assertEqual(tradeRow['setupId'], null, 'nullable setupId is null');
      assertEqual(tradeRow['plannedEntry'], null, 'nullable plannedEntry is null');
      assertEqual(tradeRow['plannedStop'], null, 'nullable plannedStop is null');

      sqlite.close();
    } finally {
      teardownTestDir();
    }
  }

  // ── Positive: empty database (all tables, no data) ───────────────────
  console.log('\n\u25B6 Empty database (all tables, no rows)');

  {
    setupTestDir();
    try {
      const { sqlite, db } = createTestDb();

      const result: BackupData = await serializeBackup(db);

      // Verify all tables present with 0 rows
      const tableNames = Object.keys(result.manifest.tables);
      assertEqual(tableNames.length, TABLE_COUNT, `empty db: manifest lists all ${TABLE_COUNT} tables`);

      for (const name of tableNames) {
        assertEqual(result.manifest.tables[name], 0, `empty db: ${name} has 0 rows`);
        assertEqual(result.tables[name].length, 0, `empty db: tables.${name} is empty`);
      }

      sqlite.close();
    } finally {
      teardownTestDir();
    }
  }

  // ── Edge: schemaVersion matches migration count ──────────────────────
  console.log('\n\u25B6 Schema version equals migration file count');

  {
    setupTestDir();
    try {
      const { sqlite, db } = createTestDb();

      // Count .sql migration files
      const migrationsDir = join(process.cwd(), 'src/db/migrations');
      const fileCount = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).length;

      const result: BackupData = await serializeBackup(db);
      assertEqual(result.manifest.schemaVersion, fileCount,
        `schemaVersion (${result.manifest.schemaVersion}) matches migration file count (${fileCount})`);

      sqlite.close();
    } finally {
      teardownTestDir();
    }
  }

  // ── Edge: JSON serializable output ────────────────────────────────────
  console.log('\n\u25B6 Output is valid JSON (no circular refs, no special types)');

  {
    setupTestDir();
    try {
      const { sqlite, db } = createTestDb();
      seedTestData(sqlite);

      const result: BackupData = await serializeBackup(db);

      // JSON.stringify should succeed without throwing
      let json: string;
      try {
        json = JSON.stringify(result, null, 2);
        assert(true, 'JSON.stringify succeeds on backup data');
      } catch (e) {
        assert(false, `JSON.stringify threw: ${e}`);
        sqlite.close();
        return;
      }

      // Verify JSON contains expected keys
      assert(json.includes('"manifest"'), 'JSON output contains "manifest"');
      assert(json.includes('"tables"'), 'JSON output contains "tables"');
      assert(json.includes('"schemaVersion"'), 'JSON output contains "schemaVersion"');
      assert(json.includes('"backupTimestamp"'), 'JSON output contains "backupTimestamp"');
      assert(json.includes('"appVersion"'), 'JSON output contains "appVersion"');
      assert(json.includes('"accounts"'), 'JSON contains account data');

      // Parse back to verify round-trip
      const parsed = JSON.parse(json) as BackupData;
      assertEqual(parsed.manifest.schemaVersion, result.manifest.schemaVersion, 'JSON round-trip preserves schemaVersion');
      assertEqual(parsed.tables['accounts'].length, 2, 'JSON round-trip preserves row count');

      sqlite.close();
    } finally {
      teardownTestDir();
    }
  }

  // ── Verify getMigrationCount export ───────────────────────────────────
  console.log('\n\u25B6 getMigrationCount export');

  {
    try {
      const count = getMigrationCount();
      assert(typeof count === 'number' && count >= 0,
        `getMigrationCount() returns a non-negative number (got ${count})`);

      // Cross-verify against actual migration file count on disk
      const migrationsDir = join(process.cwd(), 'src/db/migrations');
      const fileCount = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).length;
      assertEqual(count, fileCount,
        `getMigrationCount() (${count}) matches migration file count (${fileCount})`);

      // Verify it is a function not a side-effect-only import
      assert(typeof getMigrationCount === 'function', 'getMigrationCount is a function');
    } catch (e) {
      assert(false, `getMigrationCount() threw unexpectedly: ${e}`);
    }
  }

  // ── Negative: invalid DB throws gracefully ───────────────────────────
  console.log('\n\u25B6 Invalid database connection');

  {
    setupTestDir();
    try {
      const badSqlite = new Database(':memory:'); // empty, no schema
      const badDb = drizzle(badSqlite, { schema });

      // Should still produce a result with -1 counts for table queries
      const result: BackupData = await serializeBackup(badDb);

      // The function catches individual table query errors and records -1
      const allNegative = Object.values(result.manifest.tables).every((c) => c === -1);
      assert(allNegative, 'empty schema DB: all table counts set to -1 (error indicator)');
      assert(typeof result.manifest.appVersion === 'string', 'manifest still populated on error');
      assert(typeof result.manifest.backupTimestamp === 'string', 'backupTimestamp still populated on error');
      assert(typeof result.manifest.schemaVersion === 'number', 'schemaVersion still populated on error');

      badSqlite.close();
    } finally {
      teardownTestDir();
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
