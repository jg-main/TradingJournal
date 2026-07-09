/**
 * /api/roundtrip standalone round-trip test
 *
 * Seeds a database with N trades (default 100, 10K when FULL=1), serializes
 * via serializeBackup(), builds a ZIP, wipes the DB, restores from the ZIP
 * data, then verifies row counts and sampled trade data integrity.
 *
 * Follows the same standalone pattern as src/app/api/restore/__tests__/route.test.ts.
 *
 * Run: npx tsx src/app/api/roundtrip/__tests__/route.test.ts
 * Run (full): FULL=1 npx tsx src/app/api/roundtrip/__tests__/route.test.ts
 */

process.env.DB_FILE_NAME = './.test-m15-s04-roundtrip-db';

import { rmSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '@/db/schema';
import AdmZip from 'adm-zip';
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

// ── Constants ──────────────────────────────────────────────────────────

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

const SYMBOLS = ['AAPL', 'TSLA', 'MSFT', 'NVDA', 'GOOGL'];
const DIRECTIONS = ['long', 'short'];
const SECTORS = ['Technology', 'Consumer Cyclical', 'Communication Services', 'Healthcare', 'Financial'];
const NOW = '2026-07-01T12:00:00.000Z';

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

function camelToSnake(str: string): string {
  return str
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([a-zA-Z])(\d)/g, '$1_$2')
    .toLowerCase();
}

function countAllTables(sqlite: Database.Database): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const { name } of TABLE_REGISTRY) {
    const row = sqlite.prepare(`SELECT COUNT(*) AS count FROM "${name}"`).get() as { count: number };
    counts[name] = row.count;
  }
  return counts;
}

// ── Main Test ───────────────────────────────────────────────────────────

async function runTest() {
  const isFull = process.env.FULL === '1';
  const tradeCount = isFull ? 10000 : 100;
  const dbPath = join(process.cwd(), '.test-m15-s04-roundtrip-db');

  console.log(`\n\uD83D\uDDB2\uFE0F 10K Scale Round-Trip Test`);
  console.log(`Trade count: ${tradeCount}${isFull ? ' (FULL)' : ''}`);
  console.log('\u2550'.repeat(60) + '\n');

  // ── Setup ──────────────────────────────────────────────────────────
  console.log('\u25B6 Setup');
  const { sqlite, db: testDb } = createSchemaDb(dbPath);

  try {
    // ── Seed Phase ──────────────────────────────────────────────────
    console.log('\u25B6 Seed Phase');
    const seedStart = Date.now();

    // Pre-compute all seed data in memory for performance
    const profileId = randomUUID();
    const accId = randomUUID();
    const settingsId = randomUUID();
    const sectorLookupIds: string[] = [];

    const appProfileRows = [{ id: profileId, displayName: 'Scale Test Trader', timezone: 'America/New_York', defaultCurrency: 'USD' }];
    const accountRows = [{ id: accId, name: 'Scale Test Account', broker: 'IBKR', currency: 'USD', isActive: 1, startingBalance: 100000, createdAt: NOW, updatedAt: NOW }];
    const settingsRows = [{ id: settingsId, startingAccountValue: 100000, maxRiskPerTradePct: 1.0, defaultCommission: 0.005, currency: 'USD', createdAt: NOW, updatedAt: NOW }];

    const lookupValueRows = SECTORS.map((sector, i) => {
      const lid = randomUUID();
      sectorLookupIds.push(lid);
      return { id: lid, type: 'sector', value: sector, sortOrder: i + 1, isActive: 1, createdAt: NOW, updatedAt: NOW };
    });

    const setupDefinitionRows = [{ id: randomUUID(), name: 'Breakout', description: 'Standard breakout setup', isActive: 1, createdAt: NOW, updatedAt: NOW }];

    // Generate N trades with their executions, risk snapshots, and optional stop adjustments
    interface TradeSeed {
      id: string;
      tradeCode: string;
      accountId: string;
      symbol: string;
      direction: string;
      sectorId: string;
    }
    interface ExecSeed {
      id: string;
      tradeId: string;
      action: string;
      quantity: number;
      price: number;
      fees: number;
    }
    interface RiskSeed {
      id: string;
      tradeId: string;
      accountEquityAtOpen: number;
      initialEntryPrice: number;
      initialStopPrice: number;
      initialQuantity: number;
    }
    interface StopSeed {
      id: string;
      tradeId: string;
      previousStop: number;
      newStop: number;
      reason: string;
      ruleBased: number;
    }

    const trades: TradeSeed[] = [];
    const executions: ExecSeed[] = [];
    const snapshots: RiskSeed[] = [];
    const stops: StopSeed[] = [];

    for (let i = 0; i < tradeCount; i++) {
      const tradeId = randomUUID();
      const symbol = SYMBOLS[i % SYMBOLS.length];
      const direction = DIRECTIONS[i % DIRECTIONS.length];
      const sectorId = sectorLookupIds[i % sectorLookupIds.length];
      const entryPrice = 150 + Math.random() * 50;

      trades.push({
        id: tradeId,
        tradeCode: `T${String(i + 1).padStart(6, '0')}`,
        accountId: accId,
        symbol,
        direction,
        sectorId,
      });

      executions.push({
        id: randomUUID(),
        tradeId,
        action: 'buy',
        quantity: 100,
        price: Math.round(entryPrice * 100) / 100,
        fees: 1.99,
      });

      snapshots.push({
        id: randomUUID(),
        tradeId,
        accountEquityAtOpen: 100000,
        initialEntryPrice: entryPrice,
        initialStopPrice: entryPrice - 5,
        initialQuantity: 100,
      });

      if (i % 3 === 0) {
        stops.push({
          id: randomUUID(),
          tradeId,
          previousStop: entryPrice - 5,
          newStop: entryPrice - 2,
          reason: 'BEP adjustment',
          ruleBased: 1,
        });
      }
    }

    // Batch insert via single transaction for maximum performance
    sqlite.exec('BEGIN');
    try {
      const insertProfile = sqlite.prepare('INSERT INTO app_profile (id, display_name, timezone, default_currency) VALUES (?, ?, ?, ?)');
      for (const r of appProfileRows) insertProfile.run(r.id, r.displayName, r.timezone, r.defaultCurrency);

      const insertAccount = sqlite.prepare('INSERT INTO accounts (id, name, broker, currency, is_active, starting_balance, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      for (const r of accountRows) insertAccount.run(r.id, r.name, r.broker, r.currency, r.isActive, r.startingBalance, r.createdAt, r.updatedAt);

      const insertSetting = sqlite.prepare('INSERT INTO settings (id, starting_account_value, max_risk_per_trade_pct, default_commission, currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
      for (const r of settingsRows) insertSetting.run(r.id, r.startingAccountValue, r.maxRiskPerTradePct, r.defaultCommission, r.currency, r.createdAt, r.updatedAt);

      const insertLookup = sqlite.prepare('INSERT INTO lookup_values (id, type, value, sort_order, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
      for (const r of lookupValueRows) insertLookup.run(r.id, r.type, r.value, r.sortOrder, r.isActive, r.createdAt, r.updatedAt);

      const insertSetup = sqlite.prepare('INSERT INTO setup_definitions (id, name, description, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
      for (const r of setupDefinitionRows) insertSetup.run(r.id, r.name, r.description, r.isActive, r.createdAt, r.updatedAt);

      const insertTrade = sqlite.prepare('INSERT INTO trades (id, trade_code, account_id, symbol, direction, sector_id, status, opened_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      const status = 'closed';
      for (const r of trades) insertTrade.run(r.id, r.tradeCode, r.accountId, r.symbol, r.direction, r.sectorId, status, NOW, NOW, NOW);

      const insertExec = sqlite.prepare('INSERT INTO trade_executions (id, trade_id, executed_at, action, quantity, price, fees, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      for (const r of executions) insertExec.run(r.id, r.tradeId, NOW, r.action, r.quantity, r.price, r.fees, NOW);

      const insertRisk = sqlite.prepare('INSERT INTO trade_risk_snapshots (id, trade_id, account_equity_at_open, initial_entry_price, initial_stop_price, initial_quantity, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
      for (const r of snapshots) insertRisk.run(r.id, r.tradeId, r.accountEquityAtOpen, r.initialEntryPrice, r.initialStopPrice, r.initialQuantity, NOW);

      const insertStop = sqlite.prepare('INSERT INTO trade_stop_adjustments (id, trade_id, adjusted_at, previous_stop, new_stop, reason, rule_based, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      for (const r of stops) insertStop.run(r.id, r.tradeId, NOW, r.previousStop, r.newStop, r.reason, r.ruleBased, NOW);

      sqlite.exec('COMMIT');
    } catch (err) {
      sqlite.exec('ROLLBACK');
      throw err;
    }

    const seedDuration = Date.now() - seedStart;
    console.log(`  Seeded ${tradeCount} trades in ${seedDuration}ms`);

    // Build expected counts
    const expectedCounts: Record<string, number> = {
      app_profile: appProfileRows.length,
      accounts: accountRows.length,
      settings: settingsRows.length,
      lookup_values: lookupValueRows.length,
      setup_definitions: setupDefinitionRows.length,
      trades: trades.length,
      trade_executions: executions.length,
      trade_risk_snapshots: snapshots.length,
      trade_stop_adjustments: stops.length,
      trade_assets: 0,
      trade_grades: 0,
      trade_mistakes: 0,
      watchlist_items: 0,
      account_transactions: 0,
      account_rollforward: 0,
      weekly_reviews: 0,
      review_action_items: 0,
    };

    // Sample trade data for content verification: first, middle, last
    const sampleIndices = [0, Math.floor(trades.length / 2), trades.length - 1];
    const preSamples = sampleIndices.map((idx) => {
      const t = trades[idx];
      const e = executions[idx];
      return {
        tradeCode: t.tradeCode,
        symbol: t.symbol,
        direction: t.direction,
        entryPrice: e.price,
      };
    });

    // ── Backup Phase ──────────────────────────────────────────────────
    console.log('\u25B6 Backup Phase');
    const backupStart = Date.now();
    const backupData = await serializeBackup(testDb);
    const backupDuration = Date.now() - backupStart;
    console.log(`  Serialized ${backupData.manifest.tables['trades']} trades in ${backupDuration}ms`);

    // Verify manifest row counts match expected
    for (const { name } of TABLE_REGISTRY) {
      const exp = expectedCounts[name] ?? 0;
      const act = backupData.manifest.tables[name] ?? 0;
      assert(act === exp, `Backup manifest: "${name}" shows ${act} rows (expected ${exp})`);
    }

    // Build the backup ZIP
    const zip = new AdmZip();
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(backupData.manifest, null, 2), 'utf-8'));
    for (const { name } of TABLE_REGISTRY) {
      zip.addFile(`data/${name}.json`, Buffer.from(JSON.stringify(backupData.tables[name] ?? [], null, 2), 'utf-8'));
    }
    const zipBuffer = zip.toBuffer();
    assert(zipBuffer.length > 0, 'Backup ZIP buffer is non-empty');
    console.log(`  ZIP size: ${(zipBuffer.length / 1024).toFixed(1)} KB`);

    // ── Restore Phase ─────────────────────────────────────────────────
    console.log('\u25B6 Restore Phase');
    const restoreStart = Date.now();

    // Use PRAGMA defer_foreign_keys = ON (matching restore.ts pattern)
    sqlite.exec('PRAGMA defer_foreign_keys = ON');

    sqlite.exec('BEGIN');
    try {
      // WIPE all rows in DELETE_ORDER (children first)
      for (const tableName of DELETE_ORDER) {
        sqlite.exec(`DELETE FROM "${tableName}"`);
      }

      // INSERT backup data in INSERT_ORDER (parents first)
      // Read data from ZIP to simulate the full restore pipeline
      const restoreZip = new AdmZip(zipBuffer);
      for (const tableName of INSERT_ORDER) {
        const entry = restoreZip.getEntry(`data/${tableName}.json`);
        if (!entry) continue;

        const raw = entry.getData().toString('utf-8');
        const rows: Record<string, unknown>[] = JSON.parse(raw);
        if (rows.length === 0) continue;

        // Dynamic column name detection with camelCase -> snake_case mapping
        const originalKeys = Object.keys(rows[0]);
        const columnNames = originalKeys.map(camelToSnake);
        const quotedColumns = columnNames.map((c) => `"${c}"`).join(', ');
        const placeholders = columnNames.map(() => '?').join(', ');
        const stmt = sqlite.prepare(`INSERT INTO "${tableName}" (${quotedColumns}) VALUES (${placeholders})`);

        for (const row of rows) {
          const values = originalKeys.map((key) => {
            const val = row[key];
            if (typeof val === 'boolean') return val ? 1 : 0;
            return val ?? null;
          });
          stmt.run(...values);
        }
      }

      sqlite.exec('COMMIT');
    } catch (err) {
      sqlite.exec('ROLLBACK');
      throw err;
    }

    const restoreDuration = Date.now() - restoreStart;
    console.log(`  Restored in ${restoreDuration}ms`);

    // ── Verify Phase ──────────────────────────────────────────────────
    console.log('\u25B6 Verify Phase');
    const verifyStart = Date.now();

    // 1. Count rows in all tables, compare to expected
    const postCounts = countAllTables(sqlite);
    for (const { name } of TABLE_REGISTRY) {
      const exp = expectedCounts[name] ?? 0;
      const act = postCounts[name];
      assert(act === exp, `Table "${name}" has ${act} rows (expected ${exp})`);
    }

    const totalRows = Object.values(postCounts).reduce((a, b) => a + b, 0);
    console.log(`  Total rows: ${totalRows}`);

    // 2. Verify sampled trade data content
    for (const sample of preSamples) {
      const tradeRow = sqlite.prepare("SELECT symbol, direction FROM trades WHERE trade_code = ?").get(sample.tradeCode) as { symbol: string; direction: string } | undefined;
      assert(tradeRow !== undefined, `Sampled trade ${sample.tradeCode} exists after restore`);
      if (tradeRow) {
        assert(tradeRow.symbol === sample.symbol, `Trade ${sample.tradeCode}: symbol is ${tradeRow.symbol} (expected ${sample.symbol})`);
        assert(tradeRow.direction === sample.direction, `Trade ${sample.tradeCode}: direction is ${tradeRow.direction} (expected ${sample.direction})`);
      }

      const execRow = sqlite.prepare(`SELECT e.price FROM trade_executions e
        JOIN trades t ON t.id = e.trade_id WHERE t.trade_code = ?`).get(sample.tradeCode) as { price: number } | undefined;
      assert(execRow !== undefined, `Sampled trade ${sample.tradeCode} has execution after restore`);
      if (execRow) {
        assert(execRow.price === sample.entryPrice, `Trade ${sample.tradeCode}: entry price is ${execRow.price} (expected ${sample.entryPrice})`);
      }
    }

    // 3. Verify manifest row counts match actual table counts
    for (const { name } of TABLE_REGISTRY) {
      const manifestCount = backupData.manifest.tables[name] ?? 0;
      const actualCount = postCounts[name];
      assert(manifestCount === actualCount, `Manifest row count for "${name}" matches actual (${manifestCount} vs ${actualCount})`);
    }

    const verifyDuration = Date.now() - verifyStart;

    // ── Duration Report ─────────────────────────────────────────────
    const totalDuration = Date.now() - seedStart;
    console.log(`\n${'\u2500'.repeat(60)}`);
    console.log(`Seed:     ${seedDuration}ms`);
    console.log(`Backup:   ${backupDuration}ms`);
    console.log(`Restore:  ${restoreDuration}ms`);
    console.log(`Verify:   ${verifyDuration}ms`);
    console.log(`Total:    ${totalDuration}ms`);

    // ── Summary ───────────────────────────────────────────────────────
    const total = passed + failed;
    console.log(`\n${'\u2500'.repeat(60)}`);
    console.log(`Results: ${passed}/${total} passed`);
    if (failed > 0) {
      console.error(`         ${failed}/${total} FAILED\n`);
      process.exit(1);
    } else {
      console.log('         All tests passed!\n');
    }
  } finally {
    // ── Cleanup ──────────────────────────────────────────────────────
    sqlite.close();
    try {
      rmSync(dbPath, { force: true });
      rmSync(dbPath + '-wal', { force: true });
      rmSync(dbPath + '-shm', { force: true });
    } catch {
      // Best-effort cleanup
    }
  }
}

runTest()
  .then(() => {
    if (failed > 0) process.exit(1);
  })
  .catch((err) => {
    console.error('Test suite error:', err);
    process.exit(1);
  });
