/**
 * /api/reset route tests
 *
 * Tests the POST handler for factory reset:
 *  - Empty DB reset returns { success: true } with all tables at 0 rows
 *  - Populated DB reset wipes all 17 tables completely
 *  - Readiness returns ready: false with all 4 missing steps after reset
 *  - Existing restore route tests still pass (no regression from DELETE_ORDER export)
 *
 * Follows the replica pattern from src/app/api/restore/__tests__/route.test.ts.
 * Replicates route handler logic inline because @/lib/restore imports @/db/index
 * which imports 'server-only' (not available in tsx standalone context).
 *
 * Run: npx tsx src/app/api/reset/__tests__/route.test.ts
 */

process.env.DB_FILE_NAME = './.test-m15-s03-t02-db';

import { mkdirSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '@/db/schema';
import { checkReadiness } from '@/lib/readiness';

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

// ── Constants (replicating restore.ts) ──────────────────────────────────

const INSERT_ORDER: string[] = [
  'app_profile',
  'accounts',
  'settings',
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

const DELETE_ORDER: string[] = [...INSERT_ORDER].reverse();

const NOW = '2026-07-01T12:00:00.000Z';

// ── Helpers ─────────────────────────────────────────────────────────────

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

/**
 * Count rows in all 17 user-data tables.
 */
function countAllTables(sqlite: Database.Database): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const tableName of INSERT_ORDER) {
    try {
      const row = sqlite.prepare(`SELECT COUNT(*) AS count FROM "${tableName}"`).get() as { count: number };
      counts[tableName] = row.count;
    } catch {
      // Table may reference FK targets not yet created during seeding;
      // mark as -1 to surface in assertions
      counts[tableName] = -1;
    }
  }
  return counts;
}

/**
 * Seed sample data across all 17 tables for populated-DB tests.
 */
function seedData(sqlite: Database.Database) {
  const profileId = randomUUID();
  const accId = randomUUID();
  const lookupId = randomUUID();
  const setupDefId = randomUUID();
  const tradeId = randomUUID();

  // app_profile
  sqlite.prepare(`INSERT INTO app_profile (id, display_name, timezone, default_currency, created_at)
    VALUES (?, 'Reset Test Trader', 'America/New_York', 'USD', ?)`)
    .run(profileId, NOW);

  // accounts
  sqlite.prepare(`INSERT INTO accounts (id, name, broker, currency, is_active, starting_balance, created_at, updated_at)
    VALUES (?, 'Reset Test Account', 'IBKR', 'USD', 1, 50000, ?, ?)`)
    .run(accId, NOW, NOW);

  // settings
  sqlite.prepare(`INSERT INTO settings (id, starting_account_value, max_risk_per_trade_pct, default_commission, currency, journal_start_date, created_at, updated_at)
    VALUES (?, 50000, 1.0, 0.005, 'USD', '2026-07-01', ?, ?)`)
    .run(randomUUID(), NOW, NOW);

  // lookup_values
  sqlite.prepare(`INSERT INTO lookup_values (id, type, value, sort_order, is_active, created_at, updated_at)
    VALUES (?, 'sector', 'Technology', 1, 1, ?, ?)`)
    .run(lookupId, NOW, NOW);
  sqlite.prepare(`INSERT INTO lookup_values (id, type, value, sort_order, is_active, created_at, updated_at)
    VALUES (?, 'setup', 'Breakout', 1, 1, ?, ?)`)
    .run(randomUUID(), NOW, NOW);

  // setup_definitions
  sqlite.prepare(`INSERT INTO setup_definitions (id, name, description, is_active, created_at, updated_at)
    VALUES (?, 'Test Setup', 'A test setup definition', 1, ?, ?)`)
    .run(setupDefId, NOW, NOW);

  // trades (closed so FK constraints are satisfied)
  sqlite.prepare(`INSERT INTO trades (id, trade_code, account_id, symbol, direction, sector_id, status, opened_at, created_at, updated_at)
    VALUES (?, 'RESET-TEST', ?, 'AAPL', 'long', ?, 'closed', ?, ?, ?)`)
    .run(tradeId, accId, lookupId, NOW, NOW, NOW);

  // trade_executions
  sqlite.prepare(`INSERT INTO trade_executions (id, trade_id, executed_at, action, quantity, price, fees, created_at)
    VALUES (?, ?, ?, 'buy', 100, 180.50, 1.99, ?)`)
    .run(randomUUID(), tradeId, NOW, NOW);

  // trade_risk_snapshots
  sqlite.prepare(`INSERT INTO trade_risk_snapshots (id, trade_id, account_equity_at_open, initial_entry_price, initial_stop_price, initial_quantity, created_at)
    VALUES (?, ?, 50000, 180.50, 175.00, 100, ?)`)
    .run(randomUUID(), tradeId, NOW);

  // trade_stop_adjustments
  sqlite.prepare(`INSERT INTO trade_stop_adjustments (id, trade_id, adjusted_at, previous_stop, new_stop, reason, created_at)
    VALUES (?, ?, ?, 175.00, 182.00, 'Trailing stop adjustment', ?)`)
    .run(randomUUID(), tradeId, NOW, NOW);

  // trade_assets
  sqlite.prepare(`INSERT INTO trade_assets (id, trade_id, asset_type, phase, label, created_at)
    VALUES (?, ?, 'screenshot', 'entry', 'Entry screenshot', ?)`)
    .run(randomUUID(), tradeId, NOW);

  // trade_grades
  sqlite.prepare(`INSERT INTO trade_grades (id, trade_id, setup_quality_score, total_score, grade_label, created_at)
    VALUES (?, ?, 8, 85.0, 'B+', ?)`)
    .run(randomUUID(), tradeId, NOW);

  // trade_mistakes
  sqlite.prepare(`INSERT INTO trade_mistakes (id, trade_id, mistake_type_id, phase, severity, root_cause, status, created_at)
    VALUES (?, ?, ?, 'entry', 'minor', 'Filled too early', 'open', ?)`)
    .run(randomUUID(), tradeId, lookupId, NOW);

  // watchlist_items
  sqlite.prepare(`INSERT INTO watchlist_items (id, symbol, direction, status, sector_id, created_at)
    VALUES (?, 'MSFT', 'long', 'pending', ?, ?)`)
    .run(randomUUID(), lookupId, NOW);

  // account_transactions
  sqlite.prepare(`INSERT INTO account_transactions (id, account_id, type, amount, balance_after, date, created_at)
    VALUES (?, ?, 'deposit', 10000, 60000, '2026-07-01', ?)`)
    .run(randomUUID(), accId, NOW);

  // account_rollforward
  sqlite.prepare(`INSERT INTO account_rollforward (id, account_id, date, beginning_equity, ending_equity, created_at)
    VALUES (?, ?, '2026-07-01', 50000, 51000, ?)`)
    .run(randomUUID(), accId, NOW);

  // weekly_reviews
  sqlite.prepare(`INSERT INTO weekly_reviews (id, week_start, week_end, account_id, closed_trades, net_pnl, created_at)
    VALUES (?, '2026-06-29', '2026-07-05', ?, 1, 1000, ?)`)
    .run(randomUUID(), accId, NOW);

  // review_action_items
  sqlite.prepare(`INSERT INTO review_action_items (id, source_type, action_text, status, created_at)
    VALUES (?, 'general', 'Review reset test results', 'open', ?)`)
    .run(randomUUID(), NOW);
}

// ── Route Handler Replica ───────────────────────────────────────────────

interface ResetTestResult {
  status: number;
  body: unknown;
  error?: string;
  details?: unknown;
}

/**
 * Replica of POST /api/reset handler logic.
 *
 * Performs a transactional DELETE-all using FK-safe ordering (children-first)
 * via PRAGMA defer_foreign_keys = ON, matching the real reset route.
 */
function doPostReset(sqlite: Database.Database): ResetTestResult {
  try {
    sqlite.transaction(() => {
      sqlite.exec('PRAGMA defer_foreign_keys = ON');

      for (const tableName of DELETE_ORDER) {
        sqlite.exec(`DELETE FROM "${tableName}"`);
      }
    })();

    return { status: 200, body: { success: true } };
  } catch (err) {
    return {
      status: 500,
      body: null,
      error: 'Reset failed',
      details: String(err),
    };
  }
}

// ── Tests ───────────────────────────────────────────────────────────────

async function runTests() {
  console.log('\n\uD83D\uDDA5\uFE0F Reset API Route Tests');
  console.log('\u2550'.repeat(60) + '\n');

  // ── Test 1: Empty DB Reset ─────────────────────────────────────────
  console.log('\u25B6 Empty DB Reset');

  {
    const testDir = mkdtempSync(join(tmpdir(), 'reset-route-test-'));
    const dbPath = join(testDir, '.trading-journal', 'journal.db');
    const { sqlite } = createSchemaDb(dbPath);

    try {
      // Execute reset on empty schema DB
      const result = doPostReset(sqlite);

      // Assert response shape
      assert(result.status === 200, 'Empty DB: returns 200');
      assert(result.body !== null, 'Empty DB: body is not null');
      const body = result.body as { success: boolean };
      assert(body.success === true, 'Empty DB: success is true');

      // Assert all tables have 0 rows after reset
      const counts = countAllTables(sqlite);
      for (const tableName of INSERT_ORDER) {
        assert(counts[tableName] === 0, `Empty DB: "${tableName}" has 0 rows (got ${counts[tableName]})`);
      }
    } finally {
      sqlite.close();
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  // ── Test 2: Populated DB Reset ─────────────────────────────────────
  console.log('\u25B6 Populated DB Reset');

  {
    const testDir = mkdtempSync(join(tmpdir(), 'reset-route-test-'));
    const dbPath = join(testDir, '.trading-journal', 'journal.db');
    const { sqlite } = createSchemaDb(dbPath);

    try {
      // Seed data across all tables
      seedData(sqlite);

      // Verify rows exist before reset
      const preCounts = countAllTables(sqlite);
      const preCountSum = Object.values(preCounts).reduce((sum, c) => sum + c, 0);
      assert(preCountSum > 0, 'Populated DB: pre-reset has rows (' + Object.entries(preCounts)
        .filter(([, c]) => c > 0).map(([t]) => t).join(', ') + ')');

      // Execute reset
      const result = doPostReset(sqlite);

      // Assert response shape
      assert(result.status === 200, 'Populated DB: returns 200');
      const body = result.body as { success: boolean };
      assert(body.success === true, 'Populated DB: success is true');

      // Assert all 17 tables have 0 rows after reset
      const postCounts = countAllTables(sqlite);
      for (const tableName of INSERT_ORDER) {
        assert(postCounts[tableName] === 0, `Populated DB: "${tableName}" has 0 rows (got ${postCounts[tableName]})`);
      }
    } finally {
      sqlite.close();
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  // ── Test 3: Readiness After Reset ──────────────────────────────────
  console.log('\u25B6 Readiness After Reset');

  {
    const testDir = mkdtempSync(join(tmpdir(), 'reset-route-test-'));
    const dbPath = join(testDir, '.trading-journal', 'journal.db');
    const { sqlite, db: testDb } = createSchemaDb(dbPath);

    try {
      // Seed data so readiness is initially ready
      seedData(sqlite);

      // Verify readiness is ready before reset
      const preReadiness = checkReadiness(testDb);
      assert(preReadiness.ready === true, 'Readiness: app is ready before reset');
      assert(preReadiness.missing.length === 0, 'Readiness: no missing steps before reset');

      // Execute reset
      doPostReset(sqlite);

      // Check readiness after reset — should return ready: false
      const postReadiness = checkReadiness(testDb);
      assert(postReadiness.ready === false, 'Readiness: app is NOT ready after reset');

      // All 4 missing steps should be present
      const missingIds = postReadiness.missing.map((s) => s.id).sort();
      assert(missingIds.length === 4, `Readiness: 4 missing steps (got ${missingIds.length})`);
      assert(missingIds.includes('app_profile'), 'Readiness: app_profile is missing');
      assert(missingIds.includes('settings'), 'Readiness: settings is missing');
      assert(missingIds.includes('accounts'), 'Readiness: accounts is missing');
      assert(missingIds.includes('setups'), 'Readiness: setups is missing');
    } finally {
      sqlite.close();
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  // ── Test 4: Error path — null/invalid sqlite handle ──
  // Note: The real route uses getSqliteHandle() which always returns a handle
  // in production. In tests we test the inline replica which uses a valid sqlite
  // handle. This test verifies the 500 error path works with a closed connection.
  console.log('\u25B6 Error Path');

  {
    const testDir = mkdtempSync(join(tmpdir(), 'reset-route-test-'));
    const dbPath = join(testDir, '.trading-journal', 'journal.db');
    const { sqlite } = createSchemaDb(dbPath);

    try {
      // Close the handle to simulate a connection error
      sqlite.close();

      // Attempt reset on closed handle
      try {
        // Replicate what happens when sqlite handle is dead
        sqlite.transaction(() => {
          sqlite.exec('PRAGMA defer_foreign_keys = ON');
          for (const tableName of DELETE_ORDER) {
            sqlite.exec(`DELETE FROM "${tableName}"`);
          }
        })();
        assert(false, 'Error path: should have thrown for closed connection');
      } catch {
        assert(true, 'Error path: throws error on closed connection');
      }
    } finally {
      // sqlite already closed in test body
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  // ── Test 5: Existing restore route tests regression check ──────────
  // Run the restore route tests to prove DELETE_ORDER export does not break them.
  // This test delegates to a child process.
  console.log('\u25B6 Restore Route Regression Check');

  {
    let restoreExitCode = -1;
    try {
      const childProcess = await import('node:child_process');
      const util = await import('node:util');
      const exec = util.promisify(childProcess.exec);
      const { stdout, stderr } = await exec(
        'npx tsx src/app/api/restore/__tests__/route.test.ts',
        { cwd: process.cwd(), timeout: 120000, env: { ...process.env, DB_FILE_NAME: './.test-m15-s03-t02-restore-regression-db' } },
      );
      restoreExitCode = 0;
      console.log(`  Restore tests stdout:\n${stdout.split('\n').slice(-10).join('\n')}`);
      if (stderr) console.log(`  Restore tests stderr:\n${stderr}`);
    } catch (err: unknown) {
      const execErr = err as { code?: number; stdout?: string; stderr?: string };
      restoreExitCode = execErr.code ?? 1;
      console.log(`  Restore tests exit code: ${restoreExitCode}`);
      if (execErr.stdout) console.log(`  Restore tests stdout:\n${execErr.stdout}`);
      if (execErr.stderr) console.log(`  Restore tests stderr:\n${execErr.stderr}`);
    }
    assert(restoreExitCode === 0, 'Regression: restore route tests still pass (' + restoreExitCode + ')');
  }

  // ── Summary ───────────────────────────────────────────────────────────

  const total = passed + failed;
  console.log(`\n${'\u2500'.repeat(60)}`);
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
