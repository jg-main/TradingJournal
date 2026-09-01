/**
 * /api/trades/export route tests
 *
 * Tests the GET handler for CSV trade export:
 *  - Valid export returns CSV with correct headers and data
 *  - Empty trades returns header-only CSV
 *  - Account resolution fallback (param -> settings -> first active)
 *  - 400 when no account exists
 *  - CSV contains computed P&L and grade data
 *  - Child record counts are included
 *
 * Run: npx tsx src/app/api/trades/export/__tests__/route.test.ts (uses an OS-temp test DB)
 */

import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, and, ne } from 'drizzle-orm';
import { unlinkSync } from 'node:fs';
import { testDbPath, disposeSqliteFile } from '../../../../../lib/testing/test-db';

import * as schema from '@/db/schema';
import { computeTradeMetrics } from '@/lib/trade-metrics';
import type { TradeMetricsInput } from '@/lib/trade-metrics';
import { exportTradesToCsv, CSV_COLUMNS, type ExportTradeRow } from '@/lib/export-csv';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.error(`  ❌ ${msg} (FAILED)`);
  }
}

function assertDeepEqual(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failed++;
    console.error(`  ❌ ${msg} — expected ${e}, got ${a} (FAILED)`);
  } else {
    passed++;
    console.log(`  ✅ ${msg}`);
  }
}

// ── Setup: test DB (H1 — disposable SQLite lives under os.tmpdir()) ──────

const DB_FILE = testDbPath('trades-export');
const sqlite = new Database(DB_FILE);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
const db = drizzle(sqlite, { schema });

// Create all tables needed for export tests
sqlite.exec(`
  DROP TABLE IF EXISTS trade_stop_adjustments;
  DROP TABLE IF EXISTS trade_mistakes;
  DROP TABLE IF EXISTS trade_grades;
  DROP TABLE IF EXISTS trade_risk_snapshots;
  DROP TABLE IF EXISTS trade_executions;
  DROP TABLE IF EXISTS trade_assets;
  DROP TABLE IF EXISTS trades;
  DROP TABLE IF EXISTS settings;
  DROP TABLE IF EXISTS lookup_values;
  DROP TABLE IF EXISTS accounts;

  CREATE TABLE accounts (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    broker TEXT,
    currency TEXT DEFAULT 'USD',
    is_active INTEGER DEFAULT 1,
    max_risk_per_trade_pct REAL,
    default_commission REAL,
    starting_balance REAL,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );

  CREATE TABLE settings (
    id TEXT PRIMARY KEY NOT NULL,
    default_account_id TEXT,
    starting_account_value REAL,
    max_risk_per_trade_pct REAL,
    default_commission REAL,
    journal_start_date TEXT,
    currency TEXT DEFAULT 'USD',
    backup_enabled INTEGER DEFAULT 0,
    backup_retention_count INTEGER DEFAULT 3,
    backup_last_run_at TEXT,
    backup_last_run_status TEXT,
    backup_cron_time TEXT DEFAULT '02:00',
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp),
    FOREIGN KEY (default_account_id) REFERENCES accounts(id)
  );

  CREATE TABLE trades (
    id TEXT PRIMARY KEY NOT NULL,
    trade_code TEXT NOT NULL UNIQUE,
    account_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    direction TEXT NOT NULL DEFAULT 'long',
    sector_id TEXT,
    setup_id TEXT,
    market_condition_id TEXT,
    status TEXT NOT NULL DEFAULT 'planned',
    planned_entry REAL,
    planned_stop REAL,
    planned_target_1 REAL,
    planned_target_2 REAL,
    planned_quantity REAL,
    thesis TEXT,
    invalidation_condition TEXT,
    pre_trade_plan TEXT,
    risk_override_reason TEXT,
    opened_at TEXT,
    closed_at TEXT,
    reviewed_at TEXT,
    current_price REAL,
    current_price_fetched_at TEXT,
    gross_realized_pnl REAL,
    net_realized_pnl REAL,
    realized_fees REAL,
    exit_notes TEXT,
    lesson TEXT,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp),
    FOREIGN KEY (account_id) REFERENCES accounts(id)
  );

  CREATE TABLE trade_executions (
    id TEXT PRIMARY KEY NOT NULL,
    trade_id TEXT NOT NULL,
    action TEXT NOT NULL,
    quantity REAL NOT NULL,
    price REAL NOT NULL,
    fees REAL DEFAULT 0,
    reason_id TEXT,
    executed_at TEXT,
    notes TEXT,
    idempotency_key TEXT,
    created_at TEXT DEFAULT (current_timestamp),
    FOREIGN KEY (trade_id) REFERENCES trades(id)
  );

  CREATE TABLE trade_grades (
    id TEXT PRIMARY KEY NOT NULL,
    trade_id TEXT UNIQUE NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
    setup_quality_score INTEGER,
    risk_quality_score INTEGER,
    entry_quality_score INTEGER,
    management_quality_score INTEGER,
    exit_quality_score INTEGER,
    review_quality_score INTEGER,
    total_score REAL,
    grade_label TEXT,
    followed_plan INTEGER,
    rule_violation INTEGER,
    notes TEXT,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );

  CREATE TABLE trade_risk_snapshots (
    id TEXT PRIMARY KEY NOT NULL,
    trade_id TEXT NOT NULL UNIQUE,
    account_equity_at_open REAL,
  account_equity_source TEXT,
  account_equity_as_of TEXT,
    initial_entry_price REAL,
    initial_stop_price REAL,
    initial_quantity REAL,
    risk_per_share REAL,
    initial_risk_amount REAL,
    account_risk_pct REAL,
    planned_reward_risk REAL,
    created_at TEXT DEFAULT (current_timestamp),
    FOREIGN KEY (trade_id) REFERENCES trades(id) ON DELETE CASCADE
  );

  CREATE TABLE trade_mistakes (
    id TEXT PRIMARY KEY NOT NULL,
    trade_id TEXT NOT NULL,
    mistake_type_id TEXT,
    phase TEXT NOT NULL,
    severity TEXT NOT NULL,
    root_cause TEXT,
    corrective_action TEXT,
    status TEXT NOT NULL,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp),
    FOREIGN KEY (trade_id) REFERENCES trades(id) ON DELETE CASCADE
  );

  CREATE TABLE trade_stop_adjustments (
    id TEXT PRIMARY KEY NOT NULL,
    trade_id TEXT NOT NULL,
    adjusted_at TEXT,
    previous_stop REAL,
    new_stop REAL,
    reason TEXT,
    rule_based INTEGER,
    notes TEXT,
    created_at TEXT DEFAULT (current_timestamp),
    FOREIGN KEY (trade_id) REFERENCES trades(id) ON DELETE CASCADE
  );

  CREATE TABLE lookup_values (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT NOT NULL,
    value TEXT NOT NULL,
    description TEXT,
    color TEXT,
    icon TEXT,
    sort_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );
`);

// ── Replica of the route logic ─────────────────────────────────────────

interface ExportRouteResult {
  status: number;
  csv: string | null;
  headers: Record<string, string>;
  error?: string;
  details?: unknown;
}

function doGetExport(queryAccountId?: string | null): ExportRouteResult {
  try {
    let accountId: string | null = queryAccountId ?? null;

    // Resolve account: provided param -> settings.defaultAccountId -> first active account
    if (!accountId) {
      const setting = db.select().from(schema.settings).get();
      if (setting?.defaultAccountId) {
        accountId = setting.defaultAccountId ?? null;
      } else {
        const firstActive = db
          .select()
          .from(schema.accounts)
          .where(eq(schema.accounts.isActive, true))
          .get();
        accountId = firstActive?.id ?? null;
      }
    }

    if (!accountId) {
      return {
        status: 400,
        csv: null,
        headers: {},
        error: 'No active account found. Create an account first or set a default account in settings.',
        details: { fieldErrors: { accountId: ['No account resolved'] } },
      };
    }

    // 1. Fetch all trades for this account
    // Mirror of the route: D057/R027 excludes soft-deleted (scratched) trades
    // from the export. Single where(and(...)) — chained .where() calls would
    // replace the accountId clause in this drizzle version (MEM329).
    const allTrades = db
      .select()
      .from(schema.trades)
      .where(and(eq(schema.trades.accountId, accountId), ne(schema.trades.status, 'deleted')))
      .all();

    const allTradeIds = allTrades.map((t) => t.id);

    // 2. Batch-fetch related data using raw SQL for test replica
    const executionsMap = new Map<string, (typeof schema.tradeExecutions.$inferSelect)[]>();
    const gradesMap = new Map<string, typeof schema.tradeGrades.$inferSelect>();
    const mistakesMap = new Map<string, (typeof schema.tradeMistakes.$inferSelect)[]>();
    const riskMap = new Map<string, typeof schema.tradeRiskSnapshots.$inferSelect>();
    const stopAdjustmentsMap = new Map<string, (typeof schema.tradeStopAdjustments.$inferSelect)[]>();

    if (allTradeIds.length > 0) {
      const placeholders = allTradeIds.map(() => '?').join(',');

      // Executions
      const execRows = sqlite.prepare(`SELECT * FROM trade_executions WHERE trade_id IN (${placeholders})`).all(...allTradeIds) as Record<string, unknown>[];
      for (const row of execRows) {
        const exec = {
          id: row.id as string,
          tradeId: row.trade_id as string,
          action: row.action as string,
          quantity: row.quantity as number,
          price: row.price as number,
          fees: row.fees as number | null,
          reasonId: row.reason_id as string | null,
          executedAt: row.executed_at as string | null,
          notes: row.notes as string | null,
          createdAt: row.created_at as string | null,
        } as typeof schema.tradeExecutions.$inferSelect;
        const list = executionsMap.get(exec.tradeId) ?? [];
        list.push(exec);
        executionsMap.set(exec.tradeId, list);
      }

      // Grades
      const gradeRows = sqlite.prepare(`SELECT * FROM trade_grades WHERE trade_id IN (${placeholders})`).all(...allTradeIds) as Record<string, unknown>[];
      for (const row of gradeRows) {
        const grade = {
          id: row.id as string,
          tradeId: row.trade_id as string,
          setupQualityScore: row.setup_quality_score as number | null,
          riskQualityScore: row.risk_quality_score as number | null,
          entryQualityScore: row.entry_quality_score as number | null,
          managementQualityScore: row.management_quality_score as number | null,
          exitQualityScore: row.exit_quality_score as number | null,
          reviewQualityScore: row.review_quality_score as number | null,
          totalScore: row.total_score as number | null,
          gradeLabel: row.grade_label as string | null,
          followedPlan: row.followed_plan as boolean | null,
          ruleViolation: row.rule_violation as boolean | null,
          notes: row.notes as string | null,
          createdAt: row.created_at as string | null,
          updatedAt: row.updated_at as string | null,
        } as typeof schema.tradeGrades.$inferSelect;
        gradesMap.set(grade.tradeId, grade);
      }

      // Mistakes
      const mistakeRows = sqlite.prepare(`SELECT * FROM trade_mistakes WHERE trade_id IN (${placeholders})`).all(...allTradeIds) as Record<string, unknown>[];
      for (const row of mistakeRows) {
        const mistake = {
          id: row.id as string,
          tradeId: row.trade_id as string,
          mistakeTypeId: row.mistake_type_id as string | null,
          phase: row.phase as string,
          severity: row.severity as string,
          rootCause: row.root_cause as string | null,
          correctiveAction: row.corrective_action as string | null,
          status: row.status as string,
          createdAt: row.created_at as string | null,
          updatedAt: row.updated_at as string | null,
        } as typeof schema.tradeMistakes.$inferSelect;
        const list = mistakesMap.get(mistake.tradeId) ?? [];
        list.push(mistake);
        mistakesMap.set(mistake.tradeId, list);
      }

      // Risk snapshots
      const snapRows = sqlite.prepare(`SELECT * FROM trade_risk_snapshots WHERE trade_id IN (${placeholders})`).all(...allTradeIds) as Record<string, unknown>[];
      for (const row of snapRows) {
        const snap = {
          id: row.id as string,
          tradeId: row.trade_id as string,
          accountEquityAtOpen: row.account_equity_at_open as number | null,
          initialEntryPrice: row.initial_entry_price as number | null,
          initialStopPrice: row.initial_stop_price as number | null,
          initialQuantity: row.initial_quantity as number | null,
          riskPerShare: row.risk_per_share as number | null,
          initialRiskAmount: row.initial_risk_amount as number | null,
          accountRiskPct: row.account_risk_pct as number | null,
          plannedRewardRisk: row.planned_reward_risk as number | null,
          createdAt: row.created_at as string | null,
        } as typeof schema.tradeRiskSnapshots.$inferSelect;
        riskMap.set(snap.tradeId, snap);
      }

      // Stop adjustments
      const adjRows = sqlite.prepare(`SELECT * FROM trade_stop_adjustments WHERE trade_id IN (${placeholders})`).all(...allTradeIds) as Record<string, unknown>[];
      for (const row of adjRows) {
        const adj = {
          id: row.id as string,
          tradeId: row.trade_id as string,
          adjustedAt: row.adjusted_at as string | null,
          previousStop: row.previous_stop as number | null,
          newStop: row.new_stop as number | null,
          reason: row.reason as string | null,
          ruleBased: row.rule_based as boolean | null,
          notes: row.notes as string | null,
          createdAt: row.created_at as string | null,
        } as typeof schema.tradeStopAdjustments.$inferSelect;
        const list = stopAdjustmentsMap.get(adj.tradeId) ?? [];
        list.push(adj);
        stopAdjustmentsMap.set(adj.tradeId, list);
      }
    }

    // 3. Resolve lookup names
    const lookupIdSet = new Set<string>();
    for (const t of allTrades) {
      if (t.sectorId) lookupIdSet.add(t.sectorId);
      if (t.setupId) lookupIdSet.add(t.setupId);
      if (t.marketConditionId) lookupIdSet.add(t.marketConditionId);
    }
    const lookupIds = [...lookupIdSet];
    const lookupMap = new Map<string, string>();
    if (lookupIds.length > 0) {
      const lvPlaceholders = lookupIds.map(() => '?').join(',');
      const lvRows = sqlite.prepare(`SELECT * FROM lookup_values WHERE id IN (${lvPlaceholders})`).all(...lookupIds) as Record<string, unknown>[];
      for (const row of lvRows) {
        lookupMap.set(row.id as string, row.value as string);
      }
    }

    // Fetch account and settings for equity cascade
    const exportAccount = db.select().from(schema.accounts).where(eq(schema.accounts.id, accountId)).get();
    const exportSettings = db.select().from(schema.settings).get();
    const currentAccountEquity =
      exportAccount?.startingBalance ?? exportSettings?.startingAccountValue ?? null;

    // 4. Build ExportTradeRow array
    const exportRows: ExportTradeRow[] = allTrades.map((trade) => {
      const tradeExecs = executionsMap.get(trade.id) ?? [];
      const riskSnap = riskMap.get(trade.id);
      const stopAdjustments = stopAdjustmentsMap.get(trade.id) ?? [];

      // Build TradeMetricsInput for computeTradeMetrics
      const metricsInput: TradeMetricsInput = {
        executions: tradeExecs.map((ex) => ({
          id: ex.id,
          action: ex.action,
          quantity: ex.quantity,
          price: ex.price,
          fees: ex.fees ?? 0,
          executedAt: ex.executedAt ?? '',
        })),
        direction: trade.direction as 'long' | 'short',
        riskSnapshot: riskSnap
          ? {
              initialRiskAmount: riskSnap.initialRiskAmount,
              accountEquityAtOpen: riskSnap.accountEquityAtOpen,
            }
          : null,
        stopAdjustments: stopAdjustments
          .filter((s) => s.newStop != null)
          .map((s) => ({
            stopPrice: s.newStop as number,
            adjustedAt: s.adjustedAt ?? '',
          })),
        currentMark: null,
        currentAccountEquity,
      };

      const metrics = computeTradeMetrics(metricsInput);

      const grade = gradesMap.get(trade.id);

      return {
        tradeCode: trade.tradeCode,
        symbol: trade.symbol,
        direction: trade.direction,
        status: trade.status,
        setup: trade.setupId ? (lookupMap.get(trade.setupId) ?? null) : null,
        sector: trade.sectorId ? (lookupMap.get(trade.sectorId) ?? null) : null,
        marketCondition: trade.marketConditionId ? (lookupMap.get(trade.marketConditionId) ?? null) : null,
        plannedEntry: trade.plannedEntry ?? null,
        plannedStop: trade.plannedStop ?? null,
        plannedTarget1: trade.plannedTarget1 ?? null,
        plannedQuantity: trade.plannedQuantity ?? null,
        thesis: trade.thesis ?? null,
        invalidationCondition: trade.invalidationCondition ?? null,
        preTradePlan: trade.preTradePlan ?? null,
        exitNotes: trade.exitNotes ?? null,
        lesson: trade.lesson ?? null,
        openedAt: trade.openedAt ?? null,
        closedAt: trade.closedAt ?? null,
        createdAt: trade.createdAt ?? null,
        updatedAt: trade.updatedAt ?? null,
        realizedPnL: metrics.realizedPnl.netRealizedPnl,
        grossRealizedPnl: metrics.realizedPnl.grossRealizedPnl,
        netRealizedPnl: metrics.realizedPnl.netRealizedPnl,
        realizedFees: metrics.fees.realizedFees,
        rMultiple: metrics.returnMetrics.rMultiple,
        avgEntryPrice: metrics.averagePrices.avgEntryPrice,
        openAvgCost: metrics.averagePrices.openAvgCost,
        totalEntryQty: metrics.size.entryQuantity,
        totalExitQty: metrics.size.exitQuantity,
        openQuantity: metrics.size.openQuantity,
        totalFees: metrics.fees.totalFees,
        setupQualityScore: grade?.setupQualityScore ?? null,
        riskQualityScore: grade?.riskQualityScore ?? null,
        entryQualityScore: grade?.entryQualityScore ?? null,
        managementQualityScore: grade?.managementQualityScore ?? null,
        exitQualityScore: grade?.exitQualityScore ?? null,
        reviewQualityScore: grade?.reviewQualityScore ?? null,
        totalScore: grade?.totalScore ?? null,
        gradeLabel: grade?.gradeLabel ?? null,
        followedPlan: grade?.followedPlan ?? null,
        ruleViolation: grade?.ruleViolation ?? null,
        gradeNotes: grade?.notes ?? null,
        initialRiskAmount: riskSnap?.initialRiskAmount ?? null,
        accountRiskPct: riskSnap?.accountRiskPct ?? null,
        executionCount: tradeExecs.length,
        mistakeCount: (mistakesMap.get(trade.id) ?? []).length,
        stopAdjustmentCount: (stopAdjustmentsMap.get(trade.id) ?? []).length,
      };
    });

    const csv = exportTradesToCsv(exportRows);

    const filename = `trades-export-${new Date().toISOString().slice(0, 10)}.csv`;

    return {
      status: 200,
      csv,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    };
  } catch (error) {
    return {
      status: 500,
      csv: null,
      headers: {},
      error: 'Failed to export trades',
      details: String(error),
    };
  }
}

// ── Seed helpers ────────────────────────────────────────────────────────

const NOW = '2026-07-01T12:00:00.000Z';

function seedAccount(overrides?: Partial<typeof schema.accounts.$inferInsert>): string {
  const id = overrides?.id ?? randomUUID();
  db.insert(schema.accounts).values({
    id,
    name: overrides?.name ?? 'Test Account',
    broker: overrides?.broker ?? 'Test Broker',
    currency: overrides?.currency ?? 'USD',
    isActive: overrides?.isActive ?? true,
    createdAt: NOW,
    updatedAt: NOW,
  }).run();
  return id;
}

function seedSetting(overrides?: Partial<typeof schema.settings.$inferInsert>): string {
  const id = overrides?.id ?? randomUUID();
  db.insert(schema.settings).values({
    id,
    defaultAccountId: overrides?.defaultAccountId ?? null,
    startingAccountValue: overrides?.startingAccountValue ?? null,
    currency: 'USD',
    createdAt: NOW,
    updatedAt: NOW,
  }).run();
  return id;
}

function seedTrade(
  accountId: string,
  overrides?: Partial<typeof schema.trades.$inferInsert>,
): string {
  const id = overrides?.id ?? randomUUID();
  db.insert(schema.trades).values({
    id,
    tradeCode: overrides?.tradeCode ?? `T-${id.slice(0, 4)}`,
    accountId,
    symbol: overrides?.symbol ?? 'AAPL',
    direction: overrides?.direction ?? 'long',
    status: overrides?.status ?? 'closed',
    sectorId: overrides?.sectorId ?? null,
    setupId: overrides?.setupId ?? null,
    marketConditionId: overrides?.marketConditionId ?? null,
    plannedEntry: overrides?.plannedEntry ?? null,
    plannedStop: overrides?.plannedStop ?? null,
    plannedTarget1: overrides?.plannedTarget1 ?? null,
    thesis: overrides?.thesis ?? null,
    invalidationCondition: overrides?.invalidationCondition ?? null,
    preTradePlan: overrides?.preTradePlan ?? null,
    exitNotes: overrides?.exitNotes ?? null,
    lesson: overrides?.lesson ?? null,
    openedAt: overrides?.openedAt ?? null,
    closedAt: overrides?.closedAt ?? null,
    createdAt: NOW,
    updatedAt: NOW,
  }).run();
  return id;
}

function seedExecution(
  tradeId: string,
  overrides?: Partial<typeof schema.tradeExecutions.$inferInsert>,
): string {
  const id = overrides?.id ?? randomUUID();
  db.insert(schema.tradeExecutions).values({
    id,
    tradeId,
    action: overrides?.action ?? 'buy',
    quantity: overrides?.quantity ?? 100,
    price: overrides?.price ?? 100,
    fees: overrides?.fees ?? 0,
    executedAt: overrides?.executedAt ?? NOW,
  }).run();
  return id;
}

function seedGrade(
  tradeId: string,
  overrides?: Partial<typeof schema.tradeGrades.$inferInsert>,
): string {
  const id = overrides?.id ?? randomUUID();
  const values: Record<string, unknown> = {
    id,
    tradeId,
    createdAt: NOW,
  };
  if (overrides) {
    for (const key of Object.keys(overrides)) {
      if (overrides[key as keyof typeof overrides] !== undefined) {
        values[key] = overrides[key as keyof typeof overrides] as unknown;
      }
    }
  }
  db.insert(schema.tradeGrades)
    .values(values as typeof schema.tradeGrades.$inferInsert)
    .run();
  return id;
}

function seedRiskSnapshot(
  tradeId: string,
  overrides?: Partial<typeof schema.tradeRiskSnapshots.$inferInsert>,
): string {
  const id = overrides?.id ?? randomUUID();
  db.insert(schema.tradeRiskSnapshots).values({
    id,
    tradeId,
    initialRiskAmount: overrides?.initialRiskAmount ?? null,
    accountRiskPct: overrides?.accountRiskPct ?? null,
    createdAt: NOW,
  }).run();
  return id;
}

function seedMistake(
  tradeId: string,
  overrides?: Partial<typeof schema.tradeMistakes.$inferInsert>,
): string {
  const id = overrides?.id ?? randomUUID();
  db.insert(schema.tradeMistakes).values({
    id,
    tradeId,
    phase: overrides?.phase ?? 'entry',
    severity: overrides?.severity ?? 'minor',
    status: overrides?.status ?? 'open',
    createdAt: NOW,
  }).run();
  return id;
}

function seedStopAdjustment(
  tradeId: string,
): string {
  const id = randomUUID();
  db.insert(schema.tradeStopAdjustments).values({
    id,
    tradeId,
    previousStop: 140,
    newStop: 145,
    createdAt: NOW,
  }).run();
  return id;
}

function seedLookupValue(type: string, value: string): string {
  const id = randomUUID();
  db.insert(schema.lookupValues).values({
    id,
    type: type as 'sector' | 'setup' | 'market_condition',
    value,
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
  }).run();
  return id;
}

function cleanup() {
  sqlite.exec(`
    DELETE FROM trade_stop_adjustments;
    DELETE FROM trade_mistakes;
    DELETE FROM trade_grades;
    DELETE FROM trade_risk_snapshots;
    DELETE FROM trade_executions;
    DELETE FROM trades;
    DELETE FROM settings;
    DELETE FROM lookup_values;
    DELETE FROM accounts;
  `);
}

// ── Tests ───────────────────────────────────────────────────────────────

console.log('\n📊 Trade Export API Route Tests');
console.log('════════════════════════════\n');

// ── Test 1: No account resolved → 400 ─────────────────────────────────
console.log('▶ Account Resolution');

cleanup();
{
  const result = doGetExport(null);
  assert(result.status === 400, 'No account config returns 400');
  assert((result.error?.includes('No active account') ?? false), 'Error message mentions no active account');
  assertDeepEqual(
    (result.details as Record<string, unknown>)?.fieldErrors,
    { accountId: ['No account resolved'] },
    'Error details has fieldErrors.accountId',
  );
}

// ── Test 2: Account via settings.defaultAccountId → empty trades returns header-only CSV
console.log('▶ Empty Trades via Settings');

cleanup();
{
  const accountId = seedAccount();
  seedSetting({ defaultAccountId: accountId });

  const result = doGetExport(null);
  assert(result.status === 200, 'Resolves account via settings.defaultAccountId');
  assert(result.csv !== null, 'CSV body is not null');
  assert(result.csv!.startsWith('\uFEFF'), 'CSV starts with BOM');
  assert(result.headers['Content-Type'] === 'text/csv; charset=utf-8', 'Content-Type is text/csv');
  assert(result.headers['Content-Disposition'].startsWith('attachment; filename="trades-export-'), 'Content-Disposition is attachment');

  // Empty trades: only header row + trailing newline
  const lines = result.csv!.split('\n');
  assert(lines[0] === '\uFEFF' + CSV_COLUMNS.map((c) => c.label).join(','), 'Header row contains all column labels');
  assert(lines[1] === '', 'No data rows for empty trades');
}

// ── Test 3: Account via first active account (no settings) ─────────────
console.log('▶ First Active Account Fallback');

cleanup();
{
  const account1 = seedAccount({ name: 'Inactive', isActive: false });
  seedAccount({ name: 'Active Main', isActive: true });

  const result = doGetExport(null);
  assert(result.status === 200, 'Resolves via first active account');

  // Verify it's using the active account by checking no trades from account1 appear
  seedTrade(account1, { symbol: 'HIDDEN' });
  const result2 = doGetExport(null);
  // Should be empty since account1's trade shouldn't appear
  const lines = result2.csv!.split('\n').filter((l) => l.length > 0 && !l.startsWith('\uFEFF'));
  assert(lines.length === 0, 'Using active account, not inactive');
}

// ── Test 4: Explicit accountId parameter ──────────────────────────────
console.log('▶ Explicit accountId');

cleanup();
{
  const accA = seedAccount({ name: 'Account A' });
  const accB = seedAccount({ name: 'Account B' });

  seedTrade(accA, { tradeCode: 'EXPORT-A-1', symbol: 'AAPL' });
  seedTrade(accA, { tradeCode: 'EXPORT-A-2', symbol: 'MSFT' });
  seedTrade(accB, { tradeCode: 'EXPORT-B-1', symbol: 'GOOGL' });

  { // Account A export
    const result = doGetExport(accA);
    assert(result.status === 200, 'Account A returns 200');
    const dataLines = result.csv!.split('\n').filter((l) => l.length > 0 && !l.startsWith('\uFEFF'));
    assert(dataLines.length === 2, 'Account A has 2 trade data rows');
    assert(dataLines[0].includes('EXPORT-A-1'), 'First row is EXPORT-A-1');
    assert(dataLines[1].includes('EXPORT-A-2'), 'Second row is EXPORT-A-2');
  }

  { // Account B export
    const result = doGetExport(accB);
    assert(result.status === 200, 'Account B returns 200');
    const dataLines = result.csv!.split('\n').filter((l) => l.length > 0 && !l.startsWith('\uFEFF'));
    assert(dataLines.length === 1, 'Account B has 1 trade data row');
    assert(dataLines[0].includes('EXPORT-B-1'), 'Data row is EXPORT-B-1');
  }
}

// ── Test 5: Full trade data with P&L, grades, lookups, and child counts ──
console.log('▶ Full Trade Data');

cleanup();
{
  const accountId = seedAccount();
  seedSetting({ defaultAccountId: accountId });

  // Setup lookup values
  const sectorId = seedLookupValue('sector', 'Technology');
  const setupId = seedLookupValue('setup', 'Breakout');
  const marketConditionId = seedLookupValue('market_condition', 'Bull Market');

  // Trade 1: Long AAPL, buy 100 @ 100, sell 100 @ 120, fees $10 → PnL = (120-100)*100 - 10 = 1990
  // Risk: initialRiskAmount = 500 → R = 1990/500 = 3.98
  // Grade: totalScore = 85, gradeLabel = 'A'
  // 1 mistake, 2 stop adjustments
  const t1 = seedTrade(accountId, {
    tradeCode: 'EXPORT-FULL-1',
    symbol: 'AAPL',
    direction: 'long',
    status: 'closed',
    sectorId,
    setupId,
    marketConditionId,
    plannedEntry: 100,
    plannedStop: 95,
    plannedTarget1: 120,
    thesis: 'Strong quarterly earnings',
    invalidationCondition: 'Break below 95',
    preTradePlan: 'Scale in on weakness',
    exitNotes: 'Exited at target 1',
    lesson: 'Stick to the plan',
    openedAt: '2026-06-10T10:00:00.000Z',
    closedAt: '2026-06-15T14:00:00.000Z',
  });
  seedExecution(t1, { action: 'buy', quantity: 100, price: 100, fees: 5 });
  seedExecution(t1, { action: 'sell', quantity: 100, price: 120, fees: 5 });
  seedGrade(t1, {
    setupQualityScore: 8,
    riskQualityScore: 7,
    entryQualityScore: 9,
    managementQualityScore: 6,
    exitQualityScore: 8,
    reviewQualityScore: 7,
    totalScore: 45,
    gradeLabel: 'B',
    followedPlan: true,
    ruleViolation: false,
    notes: 'Good trade',
  });
  seedRiskSnapshot(t1, { initialRiskAmount: 500, accountRiskPct: 1.5 });
  seedMistake(t1);
  seedStopAdjustment(t1);
  seedStopAdjustment(t1);

  // Trade 2: Open trade (no grade, no risk snapshot)
  const t2 = seedTrade(accountId, {
    tradeCode: 'EXPORT-FULL-2',
    symbol: 'GOOGL',
    direction: 'long',
    status: 'open',
    openedAt: '2026-06-20T09:30:00.000Z',
  });
  seedExecution(t2, { action: 'buy', quantity: 50, price: 180 });

  const result = doGetExport(accountId);
  assert(result.status === 200, 'Full data returns 200');

  const dataLines = result.csv!.split('\n').filter((l) => l.startsWith('EXPORT-FULL'));
  assert(dataLines.length === 2, '2 trade data rows');

  // Check Trade 1 data
  const t1Row = dataLines[0];
  assert(t1Row.includes('EXPORT-FULL-1'), 'Trade 1: tradeCode present');
  assert(t1Row.includes('AAPL'), 'Trade 1: symbol present');
  assert(t1Row.includes('long'), 'Trade 1: direction present');
  assert(t1Row.includes('closed'), 'Trade 1: status present');
  assert(t1Row.includes('Breakout'), 'Trade 1: setup resolved from lookup');
  assert(t1Row.includes('Technology'), 'Trade 1: sector resolved from lookup');
  assert(t1Row.includes('Bull Market'), 'Trade 1: market condition resolved from lookup');
  assert(t1Row.includes('1990.00'), 'Trade 1: realizedPnL = 1990.00');
  assert(t1Row.includes('2000.00'), 'Trade 1: grossRealizedPnl = 2000.00');
  assert(t1Row.includes('10.00'), 'Trade 1: realizedFees = 10.00');
  assert(t1Row.includes('3.98'), 'Trade 1: rMultiple = 3.98');

  // Grade columns
  const t1Parts = t1Row.split(',');
  const gradeLabelIdx = CSV_COLUMNS.findIndex((c) => c.key === 'gradeLabel');
  const t1GradeLabel = t1Parts[gradeLabelIdx];
  assert(t1GradeLabel === 'B', 'Trade 1: gradeLabel = B');

  // Check Trade 2 data (open trade)
  const t2Row = dataLines[1];
  assert(t2Row.includes('EXPORT-FULL-2'), 'Trade 2: tradeCode present');
  assert(t2Row.includes('GOOGL'), 'Trade 2: symbol present');
  assert(t2Row.includes('open'), 'Trade 2: status = open');
}

// ── Test 6: Account isolation ──────────────────────────────────────────
console.log('▶ Account Isolation');

cleanup();
{
  const accA = seedAccount({ name: 'Account A' });
  const accB = seedAccount({ name: 'Account B', isActive: false });

  seedTrade(accA, { tradeCode: 'ISO-A', symbol: 'AAPL' });
  seedTrade(accB, { tradeCode: 'ISO-B', symbol: 'MSFT' });

  const result = doGetExport(accA);
  assert(result.status === 200, 'Account A returns 200');

  const dataLines = result.csv!.split('\n').filter((l) => l.startsWith('ISO'));
  assert(dataLines.length === 1, 'Only Account A trades in CSV');
  assert(dataLines[0].includes('ISO-A'), 'CSV contains account A symbol');
}

// ── Test 7: Multiple trades with different statuses ────────────────────
console.log('▶ Multiple Statuses');

cleanup();
{
  const accountId = seedAccount();

  // Closed trade (win)
  const t1 = seedTrade(accountId, {
    tradeCode: 'STATUS-CLOSED',
    symbol: 'AAPL',
    direction: 'long',
    status: 'closed',
  });
  seedExecution(t1, { action: 'buy', quantity: 10, price: 100 });
  seedExecution(t1, { action: 'sell', quantity: 10, price: 110 });

  // Open trade
  const t2 = seedTrade(accountId, {
    tradeCode: 'STATUS-OPEN',
    symbol: 'MSFT',
    direction: 'long',
    status: 'open',
  });
  seedExecution(t2, { action: 'buy', quantity: 10, price: 200 });

  // Planned trade (no executions)
  seedTrade(accountId, {
    tradeCode: 'STATUS-PLANNED',
    symbol: 'GOOGL',
    direction: 'short',
    status: 'planned',
  });

  const result = doGetExport(accountId);
  assert(result.status === 200, 'Multiple statuses returns 200');

  const dataLines = result.csv!.split('\n').filter((l) => l.startsWith('STATUS'));
  assert(dataLines.length === 3, '3 trades in CSV');

  // Find status column
  const t1Parts = dataLines[0].split(',');
  const statusIdx = CSV_COLUMNS.findIndex((c) => c.key === 'status');
  assert(t1Parts[statusIdx] === 'closed', 'Trade 1 status = closed');

  const t2Parts = dataLines[1].split(',');
  assert(t2Parts[statusIdx] === 'open', 'Trade 2 status = open');

  const t3Parts = dataLines[2].split(',');
  assert(t3Parts[statusIdx] === 'planned', 'Trade 3 status = planned');
}

// ── Test 8: CSV contains correct number of columns ─────────────────────
console.log('▶ Column Count');

cleanup();
{
  const accountId = seedAccount();
  seedSetting({ defaultAccountId: accountId });

  seedTrade(accountId, { tradeCode: 'COL-COUNT', symbol: 'AAPL' });

  const result = doGetExport(accountId);
  assert(result.status === 200, 'Column count test returns 200');

  const lines = result.csv!.split('\n').filter((l) => l.length > 0);
  const headerCols = lines[0].replace('\uFEFF', '').split(',');
  assert(headerCols.length === CSV_COLUMNS.length, `Header has ${CSV_COLUMNS.length} columns`);
}

// ── Test 9: Empty trades returns header-only CSV ──────────────────────
console.log('▶ Empty Trades Header Only');

cleanup();
{
  const accountId = seedAccount();
  seedSetting({ defaultAccountId: accountId });

  const result = doGetExport(accountId);
  assert(result.status === 200, 'Empty trades returns 200');
  assert(result.csv! === '\uFEFF' + CSV_COLUMNS.map((c) => c.label).join(',') + '\n', 'Header-only CSV with trailing newline');
}

// ── Test 10: Deleted trades excluded from export (R027) ────────────────
console.log('▶ Deleted Trades Exclusion (R027)');

cleanup();
{
  const accountId = seedAccount();
  seedSetting({ defaultAccountId: accountId });

  // Real closed trade that MUST appear in the CSV
  const t1 = seedTrade(accountId, {
    tradeCode: 'DEL-EXCL-REAL',
    symbol: 'AAPL',
    direction: 'long',
    status: 'closed',
  });
  seedExecution(t1, { action: 'buy', quantity: 10, price: 100 });
  seedExecution(t1, { action: 'sell', quantity: 10, price: 110 });

  // Soft-deleted (scratched) trade that MUST NOT leak into the CSV.
  // Large fake P&L (+20000 if leaked) makes any leak immediately visible.
  const t2 = seedTrade(accountId, {
    tradeCode: 'DEL-EXCL-SCRATCHED',
    symbol: 'MSFT',
    direction: 'long',
    status: 'deleted',
  });
  seedExecution(t2, { action: 'buy', quantity: 100, price: 200 });
  seedExecution(t2, { action: 'sell', quantity: 100, price: 400 });

  const result = doGetExport(accountId);
  assert(result.status === 200, 'Deleted exclusion test returns 200');

  const dataLines = result.csv!.split('\n').filter((l) => l.startsWith('DEL-EXCL'));
  assert(dataLines.length === 1, 'Only the real trade appears in CSV (deleted excluded)');
  assert(dataLines[0].includes('DEL-EXCL-REAL'), 'CSV row is the real trade');
  assert(dataLines[0].includes('AAPL'), 'CSV row contains the real trade symbol');
}

// ── Summary ─────────────────────────────────────────────────────────────

// H1 teardown: close the connection and remove the owned DB + SQLite
// companions so the repository root stays clean even on ordinary failures.
disposeSqliteFile(sqlite, DB_FILE);
try {
  unlinkSync(`${DB_FILE}-journal`);
} catch {
  // no rollback journal present (WAL mode)
}

const total = passed + failed;
console.log(`\n${'─'.repeat(40)}`);
console.log(`Results: ${passed}/${total} passed`);
if (failed > 0) {
  console.error(`         ${failed}/${total} FAILED\n`);
  process.exit(1);
} else {
  console.log('         All tests passed!\n');
}
