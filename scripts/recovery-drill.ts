#!/usr/bin/env tsx
/**
 * recovery-drill.ts — end-to-end backup-restore recovery drill (M007-S09).
 *
 * Proves the production backup-restore pipeline works end-to-end with a
 * realistic dataset and a disposable target instance:
 *
 *   Phase 1 — Source DB + backup
 *     - Creates a fresh SQLite DB in a temp dir (WAL, FK on) and applies all
 *       migrations via runMigrations (the same runner the app uses).
 *     - Seeds realistic data (accounts, instruments, trades, trade_executions,
 *       accounting_executions, financial_events, ledger_entries,
 *       ledger_postings, settings, lookup_values, market_data_settings) plus
 *       a fake upload asset.
 *     - Rebuilds FIFO projections on the source so replaceable projection
 *       rows exist before backup (the restore path always rebuilds them).
 *     - Calls createBackupBuffer(sourceDb) → writes the ZIP to an
 *       "independent storage" temp dir (simulates copy-to-archive).
 *     - Validates the ZIP: PK signature, manifest.json, data/ entries.
 *
 *   Phase 2 — Restore into a disposable target
 *     - Points DB_FILE_NAME / UPLOADS_DIR at a separate temp target.
 *     - Creates the target DB with migrations applied, then pre-seeds the
 *       same lookup_values / market_data_settings rows with fixed IDs so the
 *       app's idempotent startup seeds are skipped (otherwise they would
 *       inject random UUIDs and break byte-level comparison).
 *     - Dynamically imports @/lib/restore AFTER env vars are set (restore.ts
 *       eagerly imports the @/db/index singleton) and runs executeRestore.
 *
 *   Phase 3 — Verification
 *     - Compares row counts for every table in TABLE_REGISTRY, then compares
 *       actual row data as canonical row multisets. The three rebuildable
 *       projection tables (account_positions, fifo_lots, lot_matches) are
 *       compared modulo their generated IDs / timestamps, which differ by
 *       design between independent rebuilds.
 *     - Verifies upload assets match, target DB health (SELECT 1), and emits
 *       a JSON report between RECOVERY_DRILL_BEGIN / RECOVERY_DRILL_END.
 *
 * Exit codes: 0 on verdict "passed", 1 on any failure.
 *
 * Usage: npx tsx scripts/recovery-drill.ts
 *
 * Notes:
 *   - Runs fully in the OS temp dir; never touches the real journal DB or
 *     repo artifacts (root-pollution guard H1).
 *   - __dirname is used instead of import.meta.dirname because the
 *     repository is a CommonJS package (tsx CJS output leaves
 *     import.meta.dirname undefined — verified empirically).
 */

// ── server-only interception ────────────────────────────────────────────
// restore.ts imports @/db/index, which imports the 'server-only' package
// (its default export throws outside React Server Components). Intercept
// Module._load so the drill can execute the real restore pipeline under
// plain tsx. Must precede any module load that reaches @/db/index.
import Module from 'node:module';
const originalLoad = (Module as unknown as { _load: (r: string, p: unknown, m: boolean) => unknown })._load;
(Module as unknown as { _load: (r: string, p: unknown, m: boolean) => unknown })._load = function (
  this: unknown,
  request: string,
  parent: unknown,
  isMain: boolean
) {
  if (request === 'server-only') return {};
  return originalLoad.call(this, request, parent, isMain);
};

// ── Static imports (none eagerly load @/db/index) ──────────────────────
import Database from 'better-sqlite3';
import AdmZip from 'adm-zip';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '@/db/schema';
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { TABLE_REGISTRY, serializeBackup } from '@/lib/backup-serializer';
import { createBackupBuffer } from '@/lib/create-backup';
import { rebuildPositions } from '@/lib/positions/rebuild';
import { runMigrations } from '@/db/run-migrations';

type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

// ── Constants ───────────────────────────────────────────────────────────

const MIGRATIONS_DIR = join(__dirname, '..', 'src', 'db', 'migrations');
const REPORT_BEGIN = 'RECOVERY_DRILL_BEGIN';
const REPORT_END = 'RECOVERY_DRILL_END';

/** Fixed seed timestamps so both DBs are byte-identical. */
const SEED_NOW = '2026-08-01T12:00:00.000Z';

/**
 * Volatile columns in the three rebuildable projection tables. The restore
 * path always rebuilds these from accounting_executions, generating fresh
 * row IDs / timestamps, so an exact byte comparison would always fail. We
 * compare every semantic column instead.
 */
const VOLATILE_PROJECTION_COLUMNS: Record<string, string[]> = {
  account_positions: ['id', 'last_updated', 'created_at', 'updated_at'],
  fifo_lots: ['id', 'created_at'],
  lot_matches: ['id', 'lot_id', 'created_at'],
};

// ── Report types ────────────────────────────────────────────────────────

interface TableCheck {
  expected: number;
  actual: number;
  countMatch: boolean;
  dataMatch: boolean;
}

interface DrillReport {
  verdict: 'passed' | 'failed';
  source: { dbPath: string; tableCounts: Record<string, number>; uploadCount: number };
  backup: { path: string; sizeBytes: number; manifestTables: Record<string, number>; zipValid: boolean };
  restore: { restoredTables: number; restoredRows: number; durationMs: number };
  verification: {
    perTable: Record<string, TableCheck>;
    firstMismatch: { table: string; expected: number; actual: number } | null;
    uploadMatch: boolean;
    healthCheck: boolean;
  };
  error?: string;
}

// ── DB helpers ──────────────────────────────────────────────────────────

/** Create a migrated SQLite DB (WAL + FK) using the app's own runner. */
function createMigratedDb(dbPath: string): Database.Database {
  mkdirSync(dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  runMigrations(sqlite, MIGRATIONS_DIR);
  return sqlite;
}

/** Seed the source DB with realistic, internally consistent data. */
function seedSourceDb(sqlite: Database.Database): void {
  const now = SEED_NOW;

  // ── Accounts (one cash, one margin) ────────────────────────────────
  sqlite.prepare(
    `INSERT INTO accounts (id, name, broker, currency, is_active, max_risk_per_trade_pct,
       default_commission, starting_balance, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`
  ).run('acct-cash-0001', 'Core Cash', 'Schwab', 'USD', 1.0, 0.0, 50000, now, now);
  sqlite.prepare(
    `INSERT INTO accounts (id, name, broker, currency, is_active, max_risk_per_trade_pct,
       default_commission, starting_balance, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`
  ).run('acct-margin-0002', 'Margin', 'IBKR', 'USD', 1.0, 0.0, 100000, now, now);

  // ── Instruments (3 stocks) ─────────────────────────────────────────
  const instruments: Array<[string, string, string]> = [
    ['inst-aapl-0001', 'AAPL', 'Apple Inc.'],
    ['inst-msft-0002', 'MSFT', 'Microsoft Corp.'],
    ['inst-tsla-0003', 'TSLA', 'Tesla Inc.'],
  ];
  const insertInstrument = sqlite.prepare(
    `INSERT INTO instruments (id, symbol, name, type, currency, is_active, created_at, updated_at)
     VALUES (?, ?, ?, 'stock', 'USD', 1, ?, ?)`
  );
  for (const [id, symbol, name] of instruments) insertInstrument.run(id, symbol, name, now, now);

  // ── lookup_values — mirror the app's startup seed (fixed IDs so the
  //    target's startup auto-seed is skipped and both DBs match exactly).
  const mistakeTypes: Array<[string, string, string]> = [
    ['mt-fomo-entry', 'fomo_entry', 'FOMO — entry without proper analysis'],
    ['mt-fv-setup-selection', 'fv_setup_selection', 'Setup selection failure'],
    ['mt-fv-risk-assessment', 'fv_risk_assessment', 'Risk assessment failure'],
    ['mt-fv-entry-timing', 'fv_entry_timing', 'Entry timing failure'],
    ['mt-fv-position-sizing', 'fv_position_sizing', 'Position sizing failure'],
    ['mt-fv-stop-placement', 'fv_stop_placement', 'Stop placement failure'],
    ['mt-fv-patience', 'fv_patience', 'Patience failure'],
    ['mt-fv-management', 'fv_management', 'Trade management failure'],
    ['mt-fv-exit-discipline', 'fv_exit_discipline', 'Exit discipline failure'],
    ['mt-fv-psychology', 'fv_psychology', 'Psychology failure'],
  ];
  const insertLookup = sqlite.prepare(
    `INSERT INTO lookup_values (id, type, value, description, sort_order, is_active, created_at, updated_at)
     VALUES (?, 'mistake_type', ?, ?, 0, 1, ?, ?)`
  );
  for (const [id, value, description] of mistakeTypes) insertLookup.run(id, value, description, now, now);

  // ── market_data_settings — fixed row so startup auto-seed is skipped.
  sqlite.prepare(
    `INSERT INTO market_data_settings (id, active_provider, providers, refresh_interval_seconds, created_at, updated_at)
     VALUES (?, 'clickhouse', ?, 30, ?, ?)`
  ).run(
    'mds-drill-0001',
    JSON.stringify({
      clickhouse: { host: 'localhost', port: 8123, user: 'default', password: '', database: 'market' },
    }),
    now,
    now,
  );

  // ── Trades (2 long, 2 short; mix of open and closed) ──────────────
  sqlite.prepare(
    `INSERT INTO trades (id, trade_code, account_id, symbol, direction, status,
       opened_at, closed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('tr-aapl-0001', 'T-2026-0001', 'acct-cash-0001', 'AAPL', 'long', 'closed',
    '2026-08-01T14:30:00.000Z', '2026-08-03T15:30:00.000Z', now, now);
  sqlite.prepare(
    `INSERT INTO trades (id, trade_code, account_id, symbol, direction, status,
       opened_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('tr-msft-0002', 'T-2026-0002', 'acct-cash-0001', 'MSFT', 'long', 'open',
    '2026-08-04T14:00:00.000Z', now, now);
  sqlite.prepare(
    `INSERT INTO trades (id, trade_code, account_id, symbol, direction, status,
       opened_at, closed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('tr-tsla-0003', 'T-2026-0003', 'acct-margin-0002', 'TSLA', 'short', 'closed',
    '2026-08-06T13:30:00.000Z', '2026-08-07T13:15:00.000Z', now, now);
  sqlite.prepare(
    `INSERT INTO trades (id, trade_code, account_id, symbol, direction, status,
       opened_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('tr-tsla-0004', 'T-2026-0004', 'acct-margin-0002', 'TSLA', 'short', 'open',
    '2026-08-08T14:20:00.000Z', now, now);

  // ── trade_executions (journal-domain fills) ────────────────────────
  const tradeExecutions: Array<[string, string, string, string, number, number, number]> = [
    // [id, tradeId, action, executedAt, quantity, price, fees]
    ['te-000001', 'tr-aapl-0001', 'buy', '2026-08-01T14:30:00.000Z', 100, 150.0, 0.0],
    ['te-000002', 'tr-aapl-0001', 'sell', '2026-08-02T15:00:00.000Z', 40, 155.0, 0.0],
    ['te-000003', 'tr-aapl-0001', 'sell', '2026-08-03T15:30:00.000Z', 60, 152.0, 0.0],
    ['te-000004', 'tr-msft-0002', 'buy', '2026-08-04T14:00:00.000Z', 50, 200.0, 0.0],
    ['te-000005', 'tr-msft-0002', 'add', '2026-08-05T14:45:00.000Z', 25, 198.0, 0.0],
    ['te-000006', 'tr-tsla-0003', 'sell_short', '2026-08-06T13:30:00.000Z', 100, 250.0, 0.0],
    ['te-000007', 'tr-tsla-0003', 'buy_to_cover', '2026-08-07T13:15:00.000Z', 100, 245.0, 0.0],
    ['te-000008', 'tr-tsla-0004', 'sell_short', '2026-08-08T14:20:00.000Z', 25, 240.0, 0.0],
  ];
  const insertTe = sqlite.prepare(
    `INSERT INTO trade_executions (id, trade_id, executed_at, action, quantity, price, fees,
       idempotency_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  tradeExecutions.forEach(([id, tradeId, action, executedAt, qty, price, fees], i) => {
    insertTe.run(id, tradeId, executedAt, action, qty, price, fees, `te-idem-${i + 1}`, now);
  });

  // ── accounting_executions (economic-side fills — must replay cleanly
  //    through the FIFO allocator so the restore rebuild does not reject).
  const accountingExecutions: Array<[string, string, string, string, string, string, string, string, string, string]> = [
    // [id, accountId, instrumentId, action, quantity, price, fees, postedAt, tradeId, description]
    ['ae-000001', 'acct-cash-0001', 'inst-aapl-0001', 'buy', '100.00', '150.00', '0.00',
      '2026-08-01T14:30:00.000Z', 'tr-aapl-0001', 'Buy 100 AAPL @ 150.00'],
    ['ae-000002', 'acct-cash-0001', 'inst-aapl-0001', 'sell', '40.00', '155.00', '0.00',
      '2026-08-02T15:00:00.000Z', 'tr-aapl-0001', 'Sell 40 AAPL @ 155.00'],
    ['ae-000003', 'acct-cash-0001', 'inst-aapl-0001', 'sell', '60.00', '152.00', '0.00',
      '2026-08-03T15:30:00.000Z', 'tr-aapl-0001', 'Sell 60 AAPL @ 152.00'],
    ['ae-000004', 'acct-cash-0001', 'inst-msft-0002', 'buy', '50.00', '200.00', '0.00',
      '2026-08-04T14:00:00.000Z', 'tr-msft-0002', 'Buy 50 MSFT @ 200.00'],
    ['ae-000005', 'acct-cash-0001', 'inst-msft-0002', 'add', '25.00', '198.00', '0.00',
      '2026-08-05T14:45:00.000Z', 'tr-msft-0002', 'Add 25 MSFT @ 198.00'],
    ['ae-000006', 'acct-margin-0002', 'inst-tsla-0003', 'sell_short', '100.00', '250.00', '0.00',
      '2026-08-06T13:30:00.000Z', 'tr-tsla-0003', 'Short 100 TSLA @ 250.00'],
    ['ae-000007', 'acct-margin-0002', 'inst-tsla-0003', 'buy_to_cover', '100.00', '245.00', '0.00',
      '2026-08-07T13:15:00.000Z', 'tr-tsla-0003', 'Cover 100 TSLA @ 245.00'],
    ['ae-000008', 'acct-margin-0002', 'inst-tsla-0003', 'sell_short', '25.00', '240.00', '0.00',
      '2026-08-08T14:20:00.000Z', 'tr-tsla-0004', 'Short 25 TSLA @ 240.00'],
  ];
  const insertAe = sqlite.prepare(
    `INSERT INTO accounting_executions (id, account_id, instrument_id, action, quantity, price, fees,
       idempotency_key, journal_trade_id, description, posted_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  accountingExecutions.forEach(([id, accountId, instrumentId, action, qty, price, fees, postedAt, tradeId, desc], i) => {
    insertAe.run(id, accountId, instrumentId, action, qty, price, fees, `ae-idem-${i + 1}`, tradeId, desc, postedAt, now);
  });

  // ── financial_events + ledger_entries + ledger_postings (balanced) ──
  const events: Array<[string, string, string, string, string, number]> = [
    // [eventId, accountId, eventType, description, amount, amountMicros]
    ['fe-000001', 'acct-cash-0001', 'opening_balance', 'Opening balance', '50000.00', 50_000_000_000],
    ['fe-000002', 'acct-margin-0002', 'opening_balance', 'Opening balance', '100000.00', 100_000_000_000],
    ['fe-000003', 'acct-cash-0001', 'deposit', 'Cash deposit', '5000.00', 5_000_000_000],
    ['fe-000004', 'acct-margin-0002', 'deposit', 'Cash deposit', '3000.00', 3_000_000_000],
  ];
  const insertFe = sqlite.prepare(
    `INSERT INTO financial_events (id, account_id, event_type, idempotency_key, description, payload, effect, posted_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertLe = sqlite.prepare(
    `INSERT INTO ledger_entries (id, financial_event_id, account_id, description, posted_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const insertLp = sqlite.prepare(
    `INSERT INTO ledger_postings (id, ledger_entry_id, account_id, side, amount, amount_micros, currency, sequence, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'USD', ?, ?)`
  );
  events.forEach(([eventId, accountId, eventType, description, amount, micros], i) => {
    const eventNumber = i + 1;
    const entryId = `le-${String(eventNumber).padStart(6, '0')}`;
    const postedAt = `2026-07-0${eventNumber}T09:00:00.000Z`;
    const payload = JSON.stringify({ amount });
    const effect = JSON.stringify({ cashDirection: 'in', amount });
    insertFe.run(eventId, accountId, eventType, `fe-idem-${eventNumber}`, description, payload, effect, postedAt, now);
    insertLe.run(entryId, eventId, accountId, description, postedAt, now);
    // Balanced pair: one debit, one credit of the same amount.
    insertLp.run(`lp-${String(eventNumber).padStart(6, '0')}-d`, entryId, accountId, 'debit', amount, micros, 1, now);
    insertLp.run(`lp-${String(eventNumber).padStart(6, '0')}-c`, entryId, accountId, 'credit', amount, micros, 2, now);
  });

  // ── Settings (2 rows) ──────────────────────────────────────────────
  sqlite.prepare(
    `INSERT INTO settings (id, default_account_id, starting_account_value, max_risk_per_trade_pct,
       default_commission, journal_start_date, currency, backup_enabled, backup_retention_count,
       backup_cron_time, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 5, '02:00', ?, ?)`
  ).run('settings-main-0001', 'acct-cash-0001', 50000, 1.0, 0.0, '2026-07-01', 'USD', now, now);
  sqlite.prepare(
    `INSERT INTO settings (id, starting_account_value, currency, backup_enabled, created_at, updated_at)
     VALUES (?, ?, ?, 0, ?, ?)`
  ).run('settings-audit-0002', 100000, 'USD', now, now);

  // ── Rebuild FIFO projections so source matches what restore rebuilds.
  const accountsWithExecutions = sqlite
    .prepare('SELECT DISTINCT account_id AS account_id FROM accounting_executions')
    .all() as Array<{ account_id: string }>;
  for (const { account_id } of accountsWithExecutions) {
    rebuildPositions(sqlite, account_id);
  }
}

/** Pre-seed the target with the fixed-ID rows that match the source exactly. */
function preSeedTargetDb(sqlite: Database.Database): void {
  const now = SEED_NOW;

  const mistakeTypes: Array<[string, string, string]> = [
    ['mt-fomo-entry', 'fomo_entry', 'FOMO — entry without proper analysis'],
    ['mt-fv-setup-selection', 'fv_setup_selection', 'Setup selection failure'],
    ['mt-fv-risk-assessment', 'fv_risk_assessment', 'Risk assessment failure'],
    ['mt-fv-entry-timing', 'fv_entry_timing', 'Entry timing failure'],
    ['mt-fv-position-sizing', 'fv_position_sizing', 'Position sizing failure'],
    ['mt-fv-stop-placement', 'fv_stop_placement', 'Stop placement failure'],
    ['mt-fv-patience', 'fv_patience', 'Patience failure'],
    ['mt-fv-management', 'fv_management', 'Trade management failure'],
    ['mt-fv-exit-discipline', 'fv_exit_discipline', 'Exit discipline failure'],
    ['mt-fv-psychology', 'fv_psychology', 'Psychology failure'],
  ];
  const insertLookup = sqlite.prepare(
    `INSERT INTO lookup_values (id, type, value, description, sort_order, is_active, created_at, updated_at)
     VALUES (?, 'mistake_type', ?, ?, 0, 1, ?, ?)`
  );
  for (const [id, value, description] of mistakeTypes) insertLookup.run(id, value, description, now, now);

  sqlite.prepare(
    `INSERT INTO market_data_settings (id, active_provider, providers, refresh_interval_seconds, created_at, updated_at)
     VALUES (?, 'clickhouse', ?, 30, ?, ?)`
  ).run(
    'mds-drill-0001',
    JSON.stringify({
      clickhouse: { host: 'localhost', port: 8123, user: 'default', password: '', database: 'market' },
    }),
    now,
    now,
  );
}

// ── Verification helpers ────────────────────────────────────────────────

function canonicalRows(rows: Array<Record<string, unknown>>, table: string): string[] {
  const volatile = VOLATILE_PROJECTION_COLUMNS[table] ?? [];
  return rows.map((row) => {
    const cleaned: Record<string, unknown> = {};
    for (const key of Object.keys(row).sort()) {
      if (volatile.includes(key)) continue;
      cleaned[key] = row[key];
    }
    return JSON.stringify(cleaned);
  });
}

function compareTable(
  source: Database.Database,
  target: Database.Database,
  table: string,
): TableCheck {
  const expected = (source.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get() as { c: number }).c;
  const actual = (target.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get() as { c: number }).c;
  const countMatch = expected === actual;

  let dataMatch = true;
  if (expected > 0) {
    // Row IDs are regenerated for the three rebuildable projection tables, so
    // ORDER BY id is not deterministic across independent rebuilds. Compare
    // canonical row multisets instead: every row is normalized (volatile
    // columns stripped, keys sorted, JSON-stringified) and the arrays are
    // sorted, making the comparison order-independent.
    const srcRows = source.prepare(`SELECT * FROM "${table}"`).all() as Array<Record<string, unknown>>;
    const tgtRows = target.prepare(`SELECT * FROM "${table}"`).all() as Array<Record<string, unknown>>;
    const srcCanonical = canonicalRows(srcRows, table).sort();
    const tgtCanonical = canonicalRows(tgtRows, table).sort();
    dataMatch = JSON.stringify(srcCanonical) === JSON.stringify(tgtCanonical);
  }

  return { expected, actual, countMatch, dataMatch };
}

function compareUploadDirs(
  sourceDir: string,
  targetDir: string,
): { pass: boolean; files: string[]; detail?: string } {
  const list = (dir: string): string[] =>
    existsSync(dir) ? readdirSync(dir).filter((f) => f !== '.gitkeep').sort() : [];
  const srcFiles = list(sourceDir);
  const tgtFiles = list(targetDir);

  if (JSON.stringify(srcFiles) !== JSON.stringify(tgtFiles)) {
    return {
      pass: false,
      files: srcFiles,
      detail: `file list mismatch — source=[${srcFiles.join(', ')}] target=[${tgtFiles.join(', ')}]`,
    };
  }
  for (const file of srcFiles) {
    const srcBytes = readFileSync(join(sourceDir, file));
    const tgtBytes = readFileSync(join(targetDir, file));
    if (!srcBytes.equals(tgtBytes)) {
      return { pass: false, files: srcFiles, detail: `content mismatch on ${file}` };
    }
  }
  return { pass: true, files: srcFiles };
}

// ── Error formatting ───────────────────────────────────────────────────

/**
 * Restore pipeline errors are thrown as plain objects ({ error, details })
 * per the API contract; other failures are Error instances. Normalize both
 * into a single human-readable string for the report's `error` field.
 */
function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    const record = err as { error?: unknown; details?: unknown };
    if (typeof record.error === 'string') {
      const detail = record.details !== undefined ? ` — ${JSON.stringify(record.details)}` : '';
      return `${record.error}${detail}`;
    }
  }
  return String(err);
}

// ── Main drill ──────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const report: DrillReport = {
    verdict: 'failed',
    source: { dbPath: '', tableCounts: {}, uploadCount: 0 },
    backup: { path: '', sizeBytes: 0, manifestTables: {}, zipValid: false },
    restore: { restoredTables: 0, restoredRows: 0, durationMs: 0 },
    verification: { perTable: {}, firstMismatch: null, uploadMatch: false, healthCheck: false },
  };

  let tempDir: string | null = null;
  let sourceSqlite: Database.Database | null = null;
  let targetSqlite: Database.Database | null = null;

  try {
    // ── Phase 1: Source DB creation and backup ────────────────────────
    tempDir = join(tmpdir(), `tradingjournal-recovery-drill-${process.pid}-${Date.now()}`);
    const sourceDbPath = join(tempDir, 'source', 'journal.db');
    const targetDbPath = join(tempDir, 'target', 'journal.db');
    const sourceUploadsDir = join(tempDir, 'source-uploads');
    const targetUploadsDir = join(tempDir, 'target-uploads');
    const backupDir = join(tempDir, 'backup');

    mkdirSync(sourceUploadsDir, { recursive: true });
    mkdirSync(backupDir, { recursive: true });

    sourceSqlite = createMigratedDb(sourceDbPath);
    seedSourceDb(sourceSqlite);

    // Fake upload asset (matches BACKUP_ASSET_FILENAME image patterns).
    const fakePng = Buffer.from(
      Array.from({ length: 512 }, (_, i) => (i * 31 + 7) % 256),
    );
    writeFileSync(join(sourceUploadsDir, 'chart-snapshot.png'), fakePng);

    // Source table counts via the production serializer.
    const sourceDb: DrizzleDb = drizzle(sourceSqlite, { schema });
    const sourceBackupData = await serializeBackup(sourceDb);
    report.source.dbPath = sourceDbPath;
    report.source.tableCounts = sourceBackupData.manifest.tables;
    report.source.uploadCount = readdirSync(sourceUploadsDir).filter((f) => f !== '.gitkeep').length;

    // Create the backup ZIP via the production pipeline (buffer path).
    process.env.UPLOADS_DIR = sourceUploadsDir;
    const backupBuffer = await createBackupBuffer(sourceDb);
    report.backup.sizeBytes = backupBuffer.length;
    const backupPath = join(backupDir, 'recovery-drill.zip');
    writeFileSync(backupPath, backupBuffer); // "copy to independent storage"
    report.backup.path = backupPath;

    // Validate the ZIP structure.
    const zip = new AdmZip(backupBuffer);
    const hasPkSig = backupBuffer[0] === 0x50 && backupBuffer[1] === 0x4b;
    const manifestEntry = zip.getEntry('manifest.json');
    const manifest = manifestEntry ? JSON.parse(manifestEntry.getData().toString('utf-8')) as { tables: Record<string, number> } : null;
    const dataEntries = zip.getEntries().filter((e) => e.entryName.startsWith('data/')).map((e) => e.entryName);
    const allDataFilesPresent = TABLE_REGISTRY.every(({ name }) => dataEntries.includes(`data/${name}.json`));
    const uploadEntryPresent = zip.getEntries().some((e) => e.entryName === 'uploads/chart-snapshot.png');
    if (!hasPkSig || !manifest || !allDataFilesPresent || !uploadEntryPresent) {
      throw new Error(
        `Backup ZIP validation failed: pkSig=${hasPkSig} manifest=${manifest !== null} dataFiles=${allDataFilesPresent} uploadEntry=${uploadEntryPresent}`,
      );
    }
    report.backup.zipValid = true;
    report.backup.manifestTables = manifest.tables;
    console.error(`[recovery-drill] backup OK: ${backupBuffer.length} bytes, ${Object.keys(manifest.tables).length} tables, 1 upload asset`);

    // ── Phase 2: Restore into disposable target ───────────────────────
    process.env.DB_FILE_NAME = targetDbPath;
    process.env.UPLOADS_DIR = targetUploadsDir;

    // Target DB with migrations applied (tables exist for executeRestore),
    // plus fixed-ID pre-seed so the app's startup auto-seeds are skipped.
    targetSqlite = createMigratedDb(targetDbPath);
    preSeedTargetDb(targetSqlite);

    // Dynamically import AFTER env vars are set — restore.ts eagerly
    // imports the @/db/index singleton which resolves DB_FILE_NAME at
    // module load.
    const restoreMod = await import('@/lib/restore');
    const dbIndex = await import('@/db/index');

    const restoreStarted = Date.now();
    const restoreResult = await restoreMod.executeRestore(backupBuffer, {
      uploadsDir: targetUploadsDir,
    });
    report.restore.durationMs = Date.now() - restoreStarted;
    report.restore.restoredTables = restoreResult.restoredTables;
    report.restore.restoredRows = restoreResult.restoredRows;
    console.error(
      `[recovery-drill] restore OK: ${restoreResult.restoredTables} tables, ${restoreResult.restoredRows} rows in ${report.restore.durationMs}ms (snapshot: ${restoreResult.snapshotPath})`,
    );

    // ── Phase 3: Verification ─────────────────────────────────────────
    const liveTarget = dbIndex.getSqliteHandle();

    // Health check.
    const healthRow = liveTarget.prepare('SELECT 1 AS ok').get() as { ok: number } | undefined;
    report.verification.healthCheck = healthRow?.ok === 1;

    // Per-table row count + data comparison.
    for (const { name } of TABLE_REGISTRY) {
      const check = compareTable(sourceSqlite, liveTarget, name);
      report.verification.perTable[name] = check;
      if (!check.countMatch && !report.verification.firstMismatch) {
        report.verification.firstMismatch = { table: name, expected: check.expected, actual: check.actual };
      }
    }

    // Upload assets.
    const uploadCheck = compareUploadDirs(sourceUploadsDir, targetUploadsDir);
    report.verification.uploadMatch = uploadCheck.pass;
    if (!uploadCheck.pass) {
      console.error(`[recovery-drill] upload mismatch: ${uploadCheck.detail}`);
    }

    // Verdict.
    const anyCountMismatch = TABLE_REGISTRY.some(({ name }) => !report.verification.perTable[name].countMatch);
    const anyDataMismatch = TABLE_REGISTRY.some(({ name }) => !report.verification.perTable[name].dataMatch);
    report.verdict =
      report.backup.zipValid &&
      report.verification.healthCheck &&
      report.verification.uploadMatch &&
      !anyCountMismatch &&
      !anyDataMismatch
        ? 'passed'
        : 'failed';

    console.error(`[recovery-drill] verdict: ${report.verdict}`);
    return report.verdict === 'passed' ? 0 : 1;
  } catch (err) {
    report.error = formatError(err);
    report.verdict = 'failed';
    console.error(`[recovery-drill] drill failed: ${report.error}`);
    return 1;
  } finally {
    try {
      sourceSqlite?.close();
    } catch {
      /* best-effort */
    }
    try {
      targetSqlite?.close();
    } catch {
      /* best-effort */
    }
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      console.error(`[recovery-drill] cleaned up ${tempDir}`);
    }
    // Emit the JSON report between markers (only on stdout).
    console.log(REPORT_BEGIN);
    console.log(JSON.stringify(report, null, 2));
    console.log(REPORT_END);
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(`[recovery-drill] fatal: ${formatError(err)}`);
    process.exitCode = 1;
  },
);
