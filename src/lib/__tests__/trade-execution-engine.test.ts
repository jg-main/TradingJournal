/**
 * trade-execution-engine.test.ts
 *
 * Unit/integration tests for the canonical atomic execution engine (S03/T02).
 *
 * Covers:
 * - Happy path: first fill on a planned trade → open, risk snapshot,
 *   accounting execution (canonical decimals), financial event, FIFO position,
 *   performance rebuild.
 * - Idempotent replay: same idempotencyKey → original result, zero new rows.
 * - Atomicity: accounting failure inside the transaction rolls back the
 *   journal execution (no orphan rows).
 * - First-fill checklist gate: required items must pass; optional items are
 *   recorded but never gate.
 * - Max-risk block: overrideable 422 semantics; override reason stored.
 * - Canonical equity cascade: performance.nav → rollforward.ending_equity →
 *   account.startingBalance → settings.startingAccountValue.
 * - Deleted trade rejection.
 * - Action-direction validation.
 * - S04: backdated fill deterministic ordering — insertion-order invariance,
 *   FIFO matching over backdated timestamps, status derivation from
 *   executedAt, and atomic rejection of stream-invalid backdates.
 *
 * Run: npx vitest run src/lib/__tests__/trade-execution-engine.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import * as schema from '@/db/schema';
import { testDbPath, disposeSqliteFile, applyAllMigrations } from '@/lib/testing/test-db';
import {
  executeTradeFill,
  TradeNotFoundError,
  TradeDeletedError,
  TradeClosedError,
  ExecutionIdempotencyConflictError,
  ActionDirectionError,
  ReadinessFailureError,
  ChecklistGateError,
  OverCloseError,
  OpenPositionRequiredError,
  type ExecuteTradeFillInput,
  type TradeExecutionContext,
} from '../trade-execution-engine';
import { computeTradeMetrics } from '../trade-metrics';
import { deriveWorkflowPhase, hasManagementActivity } from '@/lib/workflow-phase';
import { UnsupportedAccountCurrencyError } from '../accounting/errors';
import { postExecutionFill } from '../accounting/execution-posting';
import { tradeExecutionIdempotencyKey } from '../trade-execution-idempotency';
import { findAccountingExecutionByIdempotencyKey } from '@/db/accounting-repository';
import { postFinancialEvent } from '../accounting/posting';
import { insertValuationMark } from '@/db/accounting-repository';
import { rebuildAccountPerformance } from '../performance/performance-rebuild';

// ── Test Database Setup ─────────────────────────────────────────────────

const TEST_DB_PATH = testDbPath('trade-execution-engine');

let sqlite: Database.Database;
let db: TradeExecutionContext['db'];
let context: TradeExecutionContext;

beforeAll(() => {
  sqlite = new Database(TEST_DB_PATH);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  applyAllMigrations(sqlite);
  db = drizzle(sqlite, { schema });
  context = { db, sqlite };
});

afterAll(() => {
  disposeSqliteFile(sqlite, TEST_DB_PATH);
});

// ── Seed helpers ────────────────────────────────────────────────────────

const now = () => new Date().toISOString();

interface SeedAccountOptions {
  isActive?: boolean;
  currency?: string;
  maxRiskPerTradePct?: number | null;
  defaultCommission?: number | null;
  startingBalance?: number | null;
}

function seedAccount(options: SeedAccountOptions = {}): string {
  const accountId = randomUUID();
  db.insert(schema.accounts)
    .values({
      id: accountId,
      name: 'Engine Test Account',
      broker: 'Test Broker',
      currency: options.currency ?? 'USD',
      isActive: options.isActive ?? true,
      maxRiskPerTradePct: options.maxRiskPerTradePct === undefined ? 1 : options.maxRiskPerTradePct,
      defaultCommission: options.defaultCommission === undefined ? 1 : options.defaultCommission,
      startingBalance: options.startingBalance === undefined ? 100000 : options.startingBalance,
    })
    .run();
  return accountId;
}

function seedSettings(startingAccountValue = 100000, maxRiskPerTradePct = 2): void {
  // Tests share one database, so the 'default' settings row is replaced per
  // test rather than appended (settings is a single-row table by convention).
  sqlite
    .prepare(
      `INSERT OR REPLACE INTO settings (id, starting_account_value, max_risk_per_trade_pct, default_commission)
       VALUES ('default', ?, ?, 1)`,
    )
    .run(startingAccountValue, maxRiskPerTradePct);
}

interface SeedTradeOptions {
  status?: string;
  direction?: 'long' | 'short';
  plannedStop?: number | null;
  setupId?: string | null;
  symbol?: string;
}

function seedTrade(accountId: string, options: SeedTradeOptions = {}): string {
  const tradeId = randomUUID();
  db.insert(schema.trades)
    .values({
      id: tradeId,
      tradeCode: `TC-${randomUUID().slice(0, 8)}`,
      accountId,
      symbol: options.symbol ?? 'AAPL',
      direction: options.direction ?? 'long',
      status: (options.status ?? 'planned') as 'planned' | 'open' | 'closed' | 'deleted',
      plannedEntry: 100,
      plannedStop: options.plannedStop === undefined ? 95 : options.plannedStop,
      setupId: options.setupId ?? null,
    })
    .run();
  return tradeId;
}

function seedChecklist(accountId: string, items: Array<{ isRequired: boolean; description: string }>): string[] {
  const ids = items.map(() => randomUUID());
  items.forEach((item, i) => {
    db.insert(schema.checklistDefinitions)
      .values({
        id: ids[i],
        accountId,
        description: item.description,
        isRequired: item.isRequired,
        sortOrder: i,
      })
      .run();
  });
  return ids;
}

function seedAccountPerformance(accountId: string, nav: string): void {
  sqlite
    .prepare(
      `INSERT INTO account_performance
         (id, account_id, computed_as_of, net_cash, nav, marked_positions, realized_pnl,
          unrealized_pnl, total_pnl, realized_fees, gross_exposure, net_exposure,
          warnings, positions_json, rebuild_count, last_rebuilt_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, '[]', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00',
               '[]', '[]', 0, ?, ?, ?)`,
    )
    .run(randomUUID(), accountId, now(), '0.00', nav, now(), now(), now());
}

/**
 * Seed a canonical opening_balance financial event (M006 funding evidence).
 * A2 canonical-funding detection keys on non-trade financial events, so a
 * canonical account must have at least one such event (opening_balance,
 * deposit, ...) to take the canonical path — the derived account_performance
 * row alone is NOT canonical funding evidence.
 */
function seedOpeningBalance(accountId: string, amount: number, postedAt = now()): void {
  sqlite
    .prepare(
      `INSERT INTO financial_events
         (id, account_id, event_type, idempotency_key, description, payload, effect, posted_at, created_at)
       VALUES (?, ?, 'opening_balance', ?, 'Opening balance', ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      accountId,
      null,
      JSON.stringify({ amount: amount.toFixed(2) }),
      JSON.stringify({ kind: 'cash', direction: 'increase', amount: amount.toFixed(2), amountMicros: Math.round(amount * 1_000_000) }),
      postedAt,
      now(),
    );
}

/** Seed a canonical withdrawal financial event (M006 funding evidence). */
function seedWithdrawal(accountId: string, amount: number, postedAt = now()): void {
  sqlite
    .prepare(
      `INSERT INTO financial_events
         (id, account_id, event_type, idempotency_key, description, payload, effect, posted_at, created_at)
       VALUES (?, ?, 'withdrawal', ?, 'Withdrawal', ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      accountId,
      null,
      JSON.stringify({ amount: amount.toFixed(2) }),
      JSON.stringify({ kind: 'cash', direction: 'decrease', amount: amount.toFixed(2), amountMicros: Math.round(amount * 1_000_000) }),
      postedAt,
      now(),
    );
}

function seedRollforward(accountId: string, endingEquity: number): void {
  sqlite
    .prepare(
      `INSERT INTO account_rollforward
         (id, account_id, date, beginning_equity, deposits_withdrawals, realized_gross_pnl,
          fees, ending_equity, cumulative_pnl, created_at, updated_at)
       VALUES (?, ?, '2026-01-01', 0, 0, 0, 0, ?, 0, ?, ?)`,
    )
    .run(randomUUID(), accountId, endingEquity, now(), now());
}

function countRows(table: string, where: string, ...params: unknown[]): number {
  const row = sqlite
    .prepare(`SELECT count(*) AS count FROM ${table} WHERE ${where}`)
    .get(...params) as { count: number };
  return row.count;
}

/** Read account_performance.net_cash (canonical cash projection). */
function netCash(accountId: string): number {
  const row = sqlite
    .prepare('SELECT net_cash FROM account_performance WHERE account_id = ?')
    .get(accountId) as { net_cash: string } | undefined;
  return row ? Number(row.net_cash) : Number.NaN;
}

/** Read account_performance.nav / unrealized_pnl / realized_fees / realized_pnl. */
function perfValue(accountId: string, column: 'nav' | 'unrealized_pnl' | 'realized_pnl' | 'realized_fees' | 'total_pnl'): number {
  const row = sqlite
    .prepare(`SELECT ${column} FROM account_performance WHERE account_id = ?`)
    .get(accountId) as Record<string, string> | undefined;
  return row ? Number(row[column]) : Number.NaN;
}

/** Sum of open lot remaining entry fees (fifo_lots.allocated_fees, qty > 0). */
function openFees(accountId: string): number {
  const rows = sqlite
    .prepare(
      `SELECT allocated_fees FROM fifo_lots
       WHERE account_id = ? AND remaining_quantity != '0.00'`,
    )
    .all(accountId) as Array<{ allocated_fees: string }>;
  return rows.reduce((sum, r) => sum + Number(r.allocated_fees), 0);
}

function fill(tradeId: string, overrides: Partial<ExecuteTradeFillInput> = {}): ExecuteTradeFillInput {
  return {
    tradeId,
    action: 'buy',
    quantity: 100,
    price: 100,
    fees: 0,
    idempotencyKey: randomUUID(),
    ...overrides,
  };
}

/**
 * Recompute trade metrics from the executions the engine actually persisted.
 * Mirrors the engine's internal postExecutionFill derivation so tests can
 * assert quantities/status on the canonical computation path.
 */
function metricsForTrade(tradeId: string) {
  const trade = db.select().from(schema.trades).where(eq(schema.trades.id, tradeId)).get();
  if (!trade) throw new Error(`trade ${tradeId} not found`);
  const rows = db
    .select()
    .from(schema.tradeExecutions)
    .where(eq(schema.tradeExecutions.tradeId, tradeId))
    .all();
  return computeTradeMetrics({
    executions: rows.map((r) => ({
      id: r.id,
      action: r.action,
      quantity: r.quantity,
      price: r.price,
      fees: r.fees,
      executedAt: r.executedAt ?? r.createdAt ?? '',
    })),
    direction: trade.direction as 'long' | 'short',
    riskSnapshot: null,
    stopAdjustments: [],
    currentMark: null,
    currentAccountEquity: null,
  });
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('executeTradeFill', () => {
  it('happy path: first fill commits journal + accounting + FIFO + performance atomically', () => {
    const accountId = seedAccount();
    seedSettings();
    const tradeId = seedTrade(accountId, { plannedStop: 95 });

    const result = executeTradeFill(fill(tradeId), context);

    // Journal execution persisted with the idempotency key.
    expect(result.execution.action).toBe('buy');
    expect(result.execution.quantity).toBe(100);
    expect(result.execution.idempotencyKey).toBeTruthy();
    expect(result.replayed).toBe(false);

    // Trade state derived from computeTradeMetrics.
    expect(result.trade.status).toBe('open');
    expect(result.trade.openedAt).toBeTruthy();

    // First-entry risk snapshot (canonical equity cascade → startingBalance).
    expect(result.riskSnapshot).not.toBeNull();
    expect(result.riskSnapshot!.initialEntryPrice).toBe(100);
    expect(result.riskSnapshot!.initialStopPrice).toBe(95);
    expect(result.riskSnapshot!.initialQuantity).toBe(100);
    expect(result.riskSnapshot!.initialRiskAmount).toBe(500);
    expect(result.riskSnapshot!.accountEquityAtOpen).toBe(100000);

    // Accounting execution mirror with canonical decimal strings.
    expect(result.accountingExecution).not.toBeNull();
    expect(result.accountingExecution!.quantity).toBe('100.00');
    expect(result.accountingExecution!.price).toBe('100.00');
    expect(result.accountingExecution!.journal_trade_id).toBe(tradeId);

    // Financial event + balanced ledger postings exist.
    expect(
      countRows('financial_events', "account_id = ? AND event_type = 'trade_execution'", accountId),
    ).toBe(1);
    expect(countRows('ledger_postings', 'account_id = ?', accountId)).toBeGreaterThanOrEqual(2);

    // FIFO position projection rebuilt.
    expect(countRows('account_positions', 'account_id = ? AND quantity = ?', accountId, '100.00')).toBe(1);

    // Account performance rebuilt.
    expect(countRows('account_performance', 'account_id = ?', accountId)).toBe(1);
  });

  it('idempotent replay: same key returns the original result with zero new rows', () => {
    const accountId = seedAccount();
    seedSettings();
    const tradeId = seedTrade(accountId, { plannedStop: 95 });
    const key = randomUUID();

    const first = executeTradeFill(fill(tradeId, { idempotencyKey: key }), context);
    const replay = executeTradeFill(fill(tradeId, { idempotencyKey: key }), context);

    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.execution.id).toBe(first.execution.id);
    expect(replay.trade.id).toBe(first.trade.id);
    expect(replay.riskSnapshot?.id).toBe(first.riskSnapshot?.id);
    expect(replay.accountingExecution?.id).toBe(first.accountingExecution?.id);

    // Zero new rows across every domain.
    expect(countRows('trade_executions', 'trade_id = ?', tradeId)).toBe(1);
    expect(countRows('accounting_executions', 'journal_trade_id = ?', tradeId)).toBe(1);
    expect(countRows('financial_events', 'account_id = ?', accountId)).toBe(1);
  });

  it('D6 §15: accounting execution is keyed trade-execution-<journalId> and found via the pure builder', () => {
    const accountId = seedAccount();
    seedSettings();
    const tradeId = seedTrade(accountId, { plannedStop: 95 });

    const result = executeTradeFill(fill(tradeId), context);

    // Journal execution id E → accounting idempotency key trade-execution-E.
    const journalId = result.execution.id;
    const expectedKey = tradeExecutionIdempotencyKey(journalId);
    expect(expectedKey).toBe(`trade-execution-${journalId}`);
    expect(result.accountingExecution?.idempotency_key).toBe(expectedKey);

    // Correction lookup via the pure builder finds exactly that row.
    const found = findAccountingExecutionByIdempotencyKey(context.sqlite, expectedKey);
    expect(found).toBeDefined();
    expect(found!.id).toBe(result.accountingExecution!.id);
    expect(found!.journal_trade_id).toBe(tradeId);
  });

  it('D6 §16: idempotent replay locates the accounting execution via the pure key builder', () => {
    const accountId = seedAccount();
    seedSettings();
    const tradeId = seedTrade(accountId, { plannedStop: 95 });
    const key = randomUUID();

    const first = executeTradeFill(fill(tradeId, { idempotencyKey: key }), context);
    const replay = executeTradeFill(fill(tradeId, { idempotencyKey: key }), context);

    expect(replay.replayed).toBe(true);
    const found = findAccountingExecutionByIdempotencyKey(
      context.sqlite,
      tradeExecutionIdempotencyKey(first.execution.id),
    );
    expect(found?.id).toBe(first.accountingExecution!.id);
    // No duplicate accounting row after replay.
    expect(countRows('accounting_executions', 'journal_trade_id = ?', tradeId)).toBe(1);
  });

  it('atomicity: accounting failure inside the transaction rolls back the journal execution', () => {
    const accountId = seedAccount();
    seedSettings();
    const tradeId = seedTrade(accountId, { plannedStop: 95 });

    // First fill succeeds and opens the trade (skips first-fill gates).
    executeTradeFill(fill(tradeId), context);
    expect(
      db.select().from(schema.trades).where(eq(schema.trades.id, tradeId)).get()?.status,
    ).toBe('open');

    // Break the USD-only accounting contract AFTER the trade opened: the
    // engine's pre-flight no longer gates (status open), so the failure is
    // raised by postExecutionFill inside the transaction.
    sqlite.prepare("UPDATE accounts SET currency = 'EUR' WHERE id = ?").run(accountId);

    expect(() =>
      executeTradeFill(
        fill(tradeId, { action: 'add', quantity: 50, idempotencyKey: randomUUID() }),
        context,
      ),
    ).toThrow(UnsupportedAccountCurrencyError);

    // The failed fill left no orphan journal execution and no partial
    // accounting rows.
    expect(countRows('trade_executions', 'trade_id = ?', tradeId)).toBe(1);
    expect(countRows('accounting_executions', 'account_id = ?', accountId)).toBe(1);
    expect(
      db.select().from(schema.trades).where(eq(schema.trades.id, tradeId)).get()?.status,
    ).toBe('open');
    expect(countRows('trade_risk_snapshots', 'trade_id = ?', tradeId)).toBe(1);
  });

  it('first-fill checklist gate: required items must pass, optional items never gate', () => {
    const accountId = seedAccount();
    seedSettings();
    const [requiredId, optionalId] = seedChecklist(accountId, [
      { isRequired: true, description: 'Has a valid stop loss' },
      { isRequired: false, description: 'Checked technicals (optional)' },
    ]);

    // Required passed + optional omitted → success; evidence snapshots text.
    const tradeId = seedTrade(accountId, { plannedStop: 95 });
    const result = executeTradeFill(
      fill(tradeId, { checkResults: [{ checklistDefinitionId: requiredId, passed: true }] }),
      context,
    );
    expect(result.trade.status).toBe('open');
    const evidence = sqlite
      .prepare('SELECT item_text, passed FROM trade_check_results WHERE trade_id = ?')
      .all(tradeId) as Array<{ item_text: string | null; passed: number }>;
    expect(evidence).toHaveLength(1);
    expect(evidence[0].item_text).toBe('Has a valid stop loss');
    expect(evidence[0].passed).toBe(1);

    // Required + optional both submitted → both recorded, optional never gates.
    const tradeBoth = seedTrade(accountId, { plannedStop: 95 });
    executeTradeFill(
      fill(tradeBoth, {
        checkResults: [
          { checklistDefinitionId: requiredId, passed: true },
          { checklistDefinitionId: optionalId, passed: false },
        ],
      }),
      context,
    );
    const bothEvidence = sqlite
      .prepare('SELECT item_text, passed FROM trade_check_results WHERE trade_id = ? ORDER BY item_text')
      .all(tradeBoth) as Array<{ item_text: string | null; passed: number }>;
    expect(bothEvidence).toHaveLength(2);
    expect(bothEvidence.some((e) => e.item_text === 'Checked technicals (optional)' && e.passed === 0)).toBe(true);

    // Missing required → blocked.
    const tradeMissing = seedTrade(accountId, { plannedStop: 95 });
    expect(() => executeTradeFill(fill(tradeMissing), context)).toThrow(ChecklistGateError);

    // Required submitted but not passed → blocked.
    const tradeNotPassed = seedTrade(accountId, { plannedStop: 95 });
    expect(() =>
      executeTradeFill(
        fill(tradeNotPassed, {
          checkResults: [{ checklistDefinitionId: requiredId, passed: false }],
        }),
        context,
      ),
    ).toThrow(ChecklistGateError);
  });

  it('max-risk block: overrideable failure without reason; override reason stored with reason', () => {
    const accountId = seedAccount();
    seedSettings();
    // 1% of 100000 = 1000 limit. Entry 95, stop 90, qty 1000 → risk 5000.
    const tradeId = seedTrade(accountId, { plannedStop: 90 });

    expect(() =>
      executeTradeFill(fill(tradeId, { quantity: 1000, price: 95 }), context),
    ).toThrow(ReadinessFailureError);

    // Inspect the structured failure: max-risk is overrideable with limit/computed.
    let caught: unknown;
    try {
      executeTradeFill(fill(tradeId, { quantity: 1000, price: 95 }), context);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ReadinessFailureError);
    const failure = (caught as ReadinessFailureError).failures.find(
      (f) => f.code === 'max-risk-exceeded',
    );
    expect(failure?.overrideable).toBe(true);
    expect(failure?.limit).toBe(1000);
    expect(failure?.computed).toBe(5000);

    // With an explicit override reason the fill succeeds and the reason is
    // persisted on the trade for the audit trail.
    const tradeOverride = seedTrade(accountId, { plannedStop: 90 });
    const result = executeTradeFill(
      fill(tradeOverride, {
        quantity: 1000,
        price: 95,
        riskOverrideReason: 'High-conviction breakout',
      }),
      context,
    );
    expect(result.trade.status).toBe('open');
    expect(result.trade.riskOverrideReason).toBe('High-conviction breakout');
  });

  it('A1: first fill succeeds with GLOBAL-ONLY risk/commission configuration', () => {
    // Account carries NO account-level risk/commission, but the global
    // settings row provides both. Pre-A1 this threw
    // account-not-trading-ready ('Account setup incomplete for trading').
    const accountId = seedAccount({
      maxRiskPerTradePct: null,
      defaultCommission: null,
      startingBalance: 100000,
    });
    // seedSettings(startingAccountValue, maxRiskPerTradePct) also writes
    // default_commission = 1 in the settings row (single-row convention).
    seedSettings(100000, 2);
    const tradeId = seedTrade(accountId, { plannedStop: 95 });

    const result = executeTradeFill(fill(tradeId), context);

    expect(result.trade.status).toBe('open');
    expect(result.trade.openedAt).toBeTruthy();
    // Full atomic execution state: journal + accounting + FIFO + performance.
    expect(result.accountingExecution).not.toBeNull();
    expect(
      countRows('financial_events', "account_id = ? AND event_type = 'trade_execution'", accountId),
    ).toBe(1);
    expect(countRows('account_positions', 'account_id = ?', accountId)).toBe(1);
    const perf = sqlite
      .prepare('SELECT nav FROM account_performance WHERE account_id = ?')
      .get(accountId) as { nav: string } | undefined;
    expect(perf).toBeTruthy();
    // The risk snapshot uses the global-derived max risk configuration.
    expect(result.riskSnapshot).not.toBeNull();
  });

  it('A1: max-risk threshold uses the GLOBAL default when the account has none', () => {
    // Global max risk 2% of equity 10000 = 200 limit. Account risk null.
    const accountId = seedAccount({
      maxRiskPerTradePct: null,
      defaultCommission: 1,
      startingBalance: 10000,
    });
    seedSettings(10000, 2);
    // Risk = |95 - 90| * 50 = 250 > 200 → blocked (overrideable).
    const tradeId = seedTrade(accountId, { plannedStop: 90 });

    let caught: unknown;
    try {
      executeTradeFill(fill(tradeId, { quantity: 50, price: 95 }), context);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ReadinessFailureError);
    const failure = (caught as ReadinessFailureError).failures.find(
      (f) => f.code === 'max-risk-exceeded',
    );
    expect(failure?.overrideable).toBe(true);
    expect(failure?.limit).toBe(200); // global 2% of 10000
    expect(failure?.computed).toBe(250);
    // Global fallback also makes the account trading-ready (no readiness block).
    expect(
      (caught as ReadinessFailureError).failures.some(
        (f) => f.code === 'account-not-trading-ready',
      ),
    ).toBe(false);
  });

  it('A1: risk override still lifts the global-max-risk block and persists the reason', () => {
    const accountId = seedAccount({
      maxRiskPerTradePct: null,
      defaultCommission: 1,
      startingBalance: 10000,
    });
    seedSettings(10000, 2);
    const tradeId = seedTrade(accountId, { plannedStop: 90 });

    const result = executeTradeFill(
      fill(tradeId, {
        quantity: 50,
        price: 95,
        riskOverrideReason: 'Exceptional setup',
      }),
      context,
    );
    expect(result.trade.status).toBe('open');
    expect(result.trade.riskOverrideReason).toBe('Exceptional setup');
  });

  it('A1: management fills (add/reduce/close) never rerun the first-fill readiness gate', () => {
    // Open a trade with full account-level config, then REMOVE the global
    // settings row entirely. Management fills must still work.
    const accountId = seedAccount();
    seedSettings();
    const tradeId = seedTrade(accountId, { plannedStop: 95 });
    executeTradeFill(fill(tradeId), context);

    sqlite.prepare('DELETE FROM settings WHERE id = ?').run('default');

    const add = executeTradeFill(
      fill(tradeId, { action: 'add', quantity: 50, price: 101 }),
      context,
    );
    expect(add.trade.status).toBe('open');

    const close = executeTradeFill(
      fill(tradeId, { action: 'sell', quantity: 150, price: 110 }),
      context,
    );
    expect(close.trade.status).toBe('closed');
  });

  it('A1: inactive account stays blocked even with complete global defaults', () => {
    const accountId = seedAccount({ isActive: false });
    seedSettings();
    const tradeId = seedTrade(accountId, { plannedStop: 95 });

    expect(() => executeTradeFill(fill(tradeId), context)).toThrow(ReadinessFailureError);
  });

  it('A1: non-USD account stays blocked even with complete global defaults', () => {
    const accountId = seedAccount({ currency: 'EUR' });
    seedSettings();
    const tradeId = seedTrade(accountId, { plannedStop: 95 });

    expect(() => executeTradeFill(fill(tradeId), context)).toThrow(ReadinessFailureError);
  });

  it('A2: current canonical projection wins over contradictory legacy data', () => {
    // Canonical funding evidence (opening_balance event) + current projection
    // NAV 50000. Contradictory legacy startingBalance is seeded too — the
    // canonical projection must win.
    const accountId = seedAccount({ startingBalance: 500000 });
    seedSettings();
    seedOpeningBalance(accountId, 50000);
    seedAccountPerformance(accountId, '50000.00');
    const tradeId = seedTrade(accountId, { plannedStop: 95 });

    const result = executeTradeFill(fill(tradeId), context);

    expect(result.riskSnapshot?.accountEquityAtOpen).toBe(50000);
    expect(result.riskSnapshot?.accountEquitySource).toBe('current_projection');
  });

  it('A2: historical_rollforward is used for a backdated fill (bounded by asOf)', () => {
    // Canonical funding + a rollforward observation dated before the backdated
    // fill timestamp. The fill is backdated to AFTER the rollforward date, so
    // the bounded lookup finds it (never "latest row overall").
    const accountId = seedAccount({ startingBalance: null });
    seedSettings(12345);
    seedOpeningBalance(accountId, 10000, '2025-12-15T00:00:00.000Z');
    seedRollforward(accountId, 75000); // date '2026-01-01'
    const tradeId = seedTrade(accountId, { plannedStop: 99 });

    const result = executeTradeFill(
      fill(tradeId, { quantity: 10, price: 100, executedAt: '2026-01-10T10:00:00.000Z' }),
      context,
    );

    expect(result.riskSnapshot?.accountEquityAtOpen).toBe(75000);
    expect(result.riskSnapshot?.accountEquitySource).toBe('historical_rollforward');
  });

  it('A2.1: backdated fill after prior canonical trade activity blocks safely (no trusted as-of valuation)', () => {
    // Canonical funding + a prior canonical execution (postExecutionFill →
    // accounting_executions + financial_events + ledger) BEFORE the backdated
    // fill timestamp. No projection/rollforward usable for the historical
    // window: A2.1 refuses to fabricate equity (never netCash + journal P&L,
    // never today's NAV) → readiness blocks, no execution, no risk snapshot.
    const accountId = seedAccount({ startingBalance: null });
    seedSettings(12345);
    seedOpeningBalance(accountId, 10000, '2026-01-01T00:00:00.000Z');
    postExecutionFill(sqlite, {
      accountId,
      symbol: 'AAPL',
      action: 'buy',
      quantity: '10.00',
      price: '100.00',
      postedAt: '2026-01-05T10:00:00.000Z',
    });
    const tradeId = seedTrade(accountId, { plannedStop: 99 });

    // The new fill is backdated AFTER the prior trade activity — the safe
    // reconstruction branch must NOT double-count that execution's cash.
    expect(() =>
      executeTradeFill(fill(tradeId, { quantity: 10, price: 100, executedAt: '2026-01-06T10:00:00.000Z' }), context),
    ).toThrow(ReadinessFailureError);
    // No execution, no risk snapshot persisted.
    expect(countRows('trade_executions', 'trade_id = ?', tradeId)).toBe(0);
    expect(countRows('trade_risk_snapshots', 'trade_id = ?', tradeId)).toBe(0);
  });

  it('A5: short add/resolve sell_short and reduce/buy_to_cover post the correct cash side (§8/§9/§10)', () => {
    // Canonical funding 10000; short trade. Full workflow: sell_short 100@50,
    // add 20@45 (sell more short → cash +900), reduce 30@40 (buy to cover →
    // cash -1200), buy_to_cover 90@35. Final cash 11550, position flat.
    const accountId = seedAccount({ startingBalance: null, maxRiskPerTradePct: 10 }); // 10% max-risk limit
    seedSettings(12345, 10);
    // Opening posted through the posting kernel so the projection's
    // rebuildOpeningCash (ledger postings) counts it in net cash.
    postFinancialEvent(sqlite, {
      accountId,
      eventType: 'opening_balance',
      amount: '10000.00',
      description: 'Opening balance',
      payload: JSON.stringify({ amount: '10000.00' }),
      effect: JSON.stringify({ kind: 'cash', direction: 'increase', amount: '10000.00', amountMicros: 10_000_000_000 }),
      postedAt: '2026-01-01T00:00:00.000Z',
    });
    const tradeId = seedTrade(accountId, { direction: 'short', plannedStop: 55 });

    executeTradeFill(fill(tradeId, { action: 'sell_short', quantity: 100, price: 50 }), context);
    expect(netCash(accountId)).toBe(15000); // 10000 + 5000

    // Journal keeps the workflow alias; accounting gets the concrete side.
    executeTradeFill(fill(tradeId, { action: 'add', quantity: 20, price: 45 }), context);
    expect(netCash(accountId)).toBe(15900); // 15000 + 900 — NEVER 14100
    const journalActions = db
      .select()
      .from(schema.tradeExecutions)
      .where(eq(schema.tradeExecutions.tradeId, tradeId))
      .all()
      .map((r) => r.action);
    expect(journalActions).toContain('add');
    const acctRows = db
      .select()
      .from(schema.accountingExecutions)
      .where(eq(schema.accountingExecutions.journalTradeId, tradeId))
      .all();
    expect(acctRows.map((r) => r.action).filter((a) => a === 'sell_short').length).toBeGreaterThanOrEqual(2);

    executeTradeFill(fill(tradeId, { action: 'reduce', quantity: 30, price: 40 }), context);
    expect(netCash(accountId)).toBe(14700); // 15900 - 1200 — NEVER 17100

    executeTradeFill(fill(tradeId, { action: 'buy_to_cover', quantity: 90, price: 35 }), context);
    expect(netCash(accountId)).toBe(11550); // flat: 10000 + 5000 + 900 - 1200 - 3150

    // Position flat, trade closed.
    expect(countRows('account_positions', "account_id = ? AND quantity != '0.00'", accountId)).toBe(0);
    const t = db.select().from(schema.trades).where(eq(schema.trades.id, tradeId)).get();
    expect(t?.status).toBe('closed');
  });

  it('A5: long add/buy and reduce/sell cash behavior stays correct (§11)', () => {
    // Canonical funding 10000; long trade. buy 100@50, add 20@45, reduce
    // 30@55, sell 90@60. Final cash 11150.
    const accountId = seedAccount({ startingBalance: null, maxRiskPerTradePct: 10 });
    seedSettings(12345, 10);
    postFinancialEvent(sqlite, {
      accountId,
      eventType: 'opening_balance',
      amount: '10000.00',
      description: 'Opening balance',
      payload: JSON.stringify({ amount: '10000.00' }),
      effect: JSON.stringify({ kind: 'cash', direction: 'increase', amount: '10000.00', amountMicros: 10_000_000_000 }),
      postedAt: '2026-01-01T00:00:00.000Z',
    });
    const tradeId = seedTrade(accountId, { plannedStop: 45 });

    executeTradeFill(fill(tradeId, { action: 'buy', quantity: 100, price: 50 }), context);
    expect(netCash(accountId)).toBe(5000);

    executeTradeFill(fill(tradeId, { action: 'add', quantity: 20, price: 45 }), context);
    expect(netCash(accountId)).toBe(4100); // 5000 - 900

    executeTradeFill(fill(tradeId, { action: 'reduce', quantity: 30, price: 55 }), context);
    expect(netCash(accountId)).toBe(5750); // 4100 + 1650

    executeTradeFill(fill(tradeId, { action: 'sell', quantity: 90, price: 60 }), context);
    expect(netCash(accountId)).toBe(11150); // flat

    expect(countRows('account_positions', "account_id = ? AND quantity != '0.00'", accountId)).toBe(0);
  });

  it('A6 §55: long entry fee reduces cash and NAV immediately; open fee reduces net unrealized', () => {
    // Opening 10000, buy 100 @ 50 fee 10, mark 50.
    const accountId = seedAccount({ startingBalance: null, maxRiskPerTradePct: 10 });
    seedSettings(12345, 10);
    postFinancialEvent(sqlite, {
      accountId,
      eventType: 'opening_balance',
      amount: '10000.00',
      description: 'Opening balance',
      payload: JSON.stringify({ amount: '10000.00' }),
      effect: JSON.stringify({ kind: 'cash', direction: 'increase', amount: '10000.00', amountMicros: 10_000_000_000 }),
      postedAt: '2026-01-01T00:00:00.000Z',
    });
    const tradeId = seedTrade(accountId, { plannedStop: 45 });

    const result = executeTradeFill(fill(tradeId, { quantity: 100, price: 50, fees: 10 }), context);

    // Gross execution event -5000, fee event -10 → net cash 4990.
    expect(netCash(accountId)).toBe(4990);
    expect(countRows('financial_events', "account_id = ? AND event_type = 'fee'", accountId)).toBe(1);
    expect(result.accountingExecution!.fees).toBe('10.00');

    // Mark at 50: gross unrealized 0, open fee 10, net unrealized -10, NAV 9990.
    insertValuationMark(sqlite, {
      accountId,
      instrumentId: result.accountingExecution!.instrument_id,
      price: '50.00',
      priceMicros: 50_000_000,
      source: 'user',
      markTimestamp: new Date().toISOString(),
    });
    const perf = rebuildAccountPerformance(sqlite, accountId);
    expect(perf.success).toBe(true);
    expect(openFees(accountId)).toBe(10);
    expect(perfValue(accountId, 'nav')).toBe(9990); // 4990 + 5000
    expect(perfValue(accountId, 'unrealized_pnl')).toBe(-10);
  });

  it('A6 §56: full long round trip with fees — cash, NAV, realized P&L all agree (10,995)', () => {
    const accountId = seedAccount({ startingBalance: null, maxRiskPerTradePct: 10 });
    seedSettings(12345, 10);
    postFinancialEvent(sqlite, {
      accountId,
      eventType: 'opening_balance',
      amount: '10000.00',
      description: 'Opening balance',
      payload: JSON.stringify({ amount: '10000.00' }),
      effect: JSON.stringify({ kind: 'cash', direction: 'increase', amount: '10000.00', amountMicros: 10_000_000_000 }),
      postedAt: '2026-01-01T00:00:00.000Z',
    });
    const tradeId = seedTrade(accountId, { plannedStop: 45 });

    executeTradeFill(fill(tradeId, { quantity: 100, price: 50, fees: 2 }), context);
    executeTradeFill(fill(tradeId, { action: 'sell', quantity: 100, price: 60, fees: 3 }), context);

    expect(netCash(accountId)).toBe(10995); // 10000 - 5000 - 2 + 6000 - 3
    expect(perfValue(accountId, 'nav')).toBe(10995);
    expect(perfValue(accountId, 'realized_pnl')).toBe(995); // 1000 gross - 5 fees
    expect(perfValue(accountId, 'realized_fees')).toBe(5);
    expect(openFees(accountId)).toBe(0);
  });

  it('A6 §57: full short round trip with fees — symmetric to long (10,995)', () => {
    const accountId = seedAccount({ startingBalance: null, maxRiskPerTradePct: 10 });
    seedSettings(12345, 10);
    postFinancialEvent(sqlite, {
      accountId,
      eventType: 'opening_balance',
      amount: '10000.00',
      description: 'Opening balance',
      payload: JSON.stringify({ amount: '10000.00' }),
      effect: JSON.stringify({ kind: 'cash', direction: 'increase', amount: '10000.00', amountMicros: 10_000_000_000 }),
      postedAt: '2026-01-01T00:00:00.000Z',
    });
    const tradeId = seedTrade(accountId, { direction: 'short', plannedStop: 55 });

    executeTradeFill(fill(tradeId, { action: 'sell_short', quantity: 100, price: 50, fees: 2 }), context);
    executeTradeFill(fill(tradeId, { action: 'buy_to_cover', quantity: 100, price: 40, fees: 3 }), context);

    expect(netCash(accountId)).toBe(10995); // 10000 + 5000 - 2 - 4000 - 3
    expect(perfValue(accountId, 'nav')).toBe(10995);
    expect(perfValue(accountId, 'realized_pnl')).toBe(995); // 1000 gross - 5 fees
    expect(perfValue(accountId, 'realized_fees')).toBe(5);
  });

  it('A6 §58: partial close allocates entry fee to matched quantity (100/40 scenario)', () => {
    const accountId = seedAccount({ startingBalance: null, maxRiskPerTradePct: 10 });
    seedSettings(12345, 10);
    postFinancialEvent(sqlite, {
      accountId,
      eventType: 'opening_balance',
      amount: '10000.00',
      description: 'Opening balance',
      payload: JSON.stringify({ amount: '10000.00' }),
      effect: JSON.stringify({ kind: 'cash', direction: 'increase', amount: '10000.00', amountMicros: 10_000_000_000 }),
      postedAt: '2026-01-01T00:00:00.000Z',
    });
    const tradeId = seedTrade(accountId, { plannedStop: 45 });

    // Buy 100 @ 50 fee 10 → cash 4990, open fee 10.
    executeTradeFill(fill(tradeId, { quantity: 100, price: 50, fees: 10 }), context);
    expect(openFees(accountId)).toBe(10);

    // Sell 40 @ 55 fee 4: gross 200, entry fee share 4, exit fee 4 → net 192.
    executeTradeFill(fill(tradeId, { action: 'sell', quantity: 40, price: 55, fees: 4 }), context);
    expect(netCash(accountId)).toBe(7186); // 4990 + 2200 - 4
    expect(perfValue(accountId, 'realized_fees')).toBe(8);
    expect(perfValue(accountId, 'realized_pnl')).toBe(192);
    expect(openFees(accountId)).toBe(6); // 10 - 4 allocated to closed 40

    // Mark 55: gross unrealized (55-50)*60 = 300, net 294; NAV 10486.
    const accounting = db
      .select()
      .from(schema.accountingExecutions)
      .where(eq(schema.accountingExecutions.accountId, accountId))
      .get()!;
    insertValuationMark(sqlite, {
      accountId,
      instrumentId: accounting.instrumentId,
      price: '55.00',
      priceMicros: 55_000_000,
      source: 'user',
      markTimestamp: new Date().toISOString(),
    });
    const perf = rebuildAccountPerformance(sqlite, accountId);
    expect(perf.success).toBe(true);
    expect(perfValue(accountId, 'unrealized_pnl')).toBe(294); // 300 - 6 open fee
    expect(perfValue(accountId, 'total_pnl')).toBe(486); // 192 + 294
    expect(perfValue(accountId, 'nav')).toBe(10486); // 7186 + 3300

    // §59: close remaining 60 @ 55 fee 6 → flat, all 20 fees realized exactly once.
    executeTradeFill(fill(tradeId, { action: 'sell', quantity: 60, price: 55, fees: 6 }), context);
    expect(netCash(accountId)).toBe(10480); // 7186 + 3300 - 6
    expect(perfValue(accountId, 'realized_fees')).toBe(20); // 10 + 4 + 6
    expect(perfValue(accountId, 'realized_pnl')).toBe(480); // 200 + 300 - 20
    expect(openFees(accountId)).toBe(0);
    expect(countRows('account_positions', "account_id = ? AND quantity != '0.00'", accountId)).toBe(0);
  });

  it('A2: settings.startingAccountValue never funds an account with no canonical/legacy evidence', () => {
    // No canonical funding event, no startingBalance, no accountTransactions:
    // the global starting value must NOT fabricate equity (A2 §11/§21).
    const accountId = seedAccount({ startingBalance: null });
    seedSettings(12345);
    const tradeId = seedTrade(accountId, { plannedStop: 99 });

    expect(() => executeTradeFill(fill(tradeId, { quantity: 10, price: 100 }), context)).toThrow(
      ReadinessFailureError,
    );
  });

  it('A2: canonical zero equity (opening 10000, withdrawal 10000) stays zero — no global fallback', () => {
    const accountId = seedAccount({ startingBalance: null });
    seedSettings(50000);
    seedOpeningBalance(accountId, 10000, '2026-01-01T00:00:00.000Z');
    seedWithdrawal(accountId, 10000, '2026-01-02T00:00:00.000Z');
    // No projection row: reconstruction path resolves correction-aware cash = 0.
    const tradeId = seedTrade(accountId, { plannedStop: 99 });

    expect(() => executeTradeFill(fill(tradeId, { quantity: 10, price: 100 }), context)).toThrow(
      ReadinessFailureError,
    );
  });

  it('deleted trade is rejected before any mutation', () => {
    const accountId = seedAccount();
    seedSettings();
    const tradeId = seedTrade(accountId, { status: 'deleted' });

    expect(() => executeTradeFill(fill(tradeId), context)).toThrow(TradeDeletedError);
    expect(countRows('trade_executions', 'trade_id = ?', tradeId)).toBe(0);
  });

  it('missing trade raises TradeNotFoundError', () => {
    expect(() => executeTradeFill(fill(randomUUID()), context)).toThrow(TradeNotFoundError);
  });

  it('action-direction validation rejects actions invalid for the trade direction', () => {
    const accountId = seedAccount();
    seedSettings();
    const tradeId = seedTrade(accountId, { direction: 'long' });

    expect(() => executeTradeFill(fill(tradeId, { action: 'sell_short' }), context)).toThrow(
      ActionDirectionError,
    );

    // Short trades accept the full symmetric action set: sell_short, add,
    // buy_to_cover, reduce. 'buy' (a long-side action) is still rejected.
    const shortTradeId = seedTrade(accountId, { direction: 'short', plannedStop: 105 });
    expect(() => executeTradeFill(fill(shortTradeId, { action: 'buy' }), context)).toThrow(
      ActionDirectionError,
    );

    // Open with sell_short, then scale in with 'add'.
    const opened = executeTradeFill(
      fill(shortTradeId, { action: 'sell_short', price: 100 }),
      context,
    );
    expect(opened.trade.status).toBe('open');

    const added = executeTradeFill(
      fill(shortTradeId, { action: 'add', quantity: 50, price: 101 }),
      context,
    );
    expect(added.trade.status).toBe('open');

    // Partially reduce the short, then cover the remainder.
    const reduced = executeTradeFill(
      fill(shortTradeId, { action: 'reduce', quantity: 25, price: 99 }),
      context,
    );
    expect(reduced.trade.status).toBe('open');

    const closed = executeTradeFill(
      fill(shortTradeId, { action: 'buy_to_cover', quantity: 125, price: 98 }),
      context,
    );
    expect(closed.trade.status).toBe('closed');
    expect(closed.trade.closedAt).toBeTruthy();

    // The full short lifecycle (sell_short → add → reduce → buy_to_cover) is
    // accepted by the engine and derives symmetric quantities through the
    // canonical computeTradeMetrics path.
    const metrics = metricsForTrade(shortTradeId);
    expect(metrics.size.entryQuantity).toBe(150);
    expect(metrics.size.exitQuantity).toBe(150);
    expect(metrics.size.openQuantity).toBe(0);
    expect(metrics.position.status).toBe('closed');
  });
});

describe('A9-short management actions (Fix 9)', () => {
  const journalActionsFor = (tradeId: string): string[] =>
    (
      sqlite
        .prepare('SELECT action FROM trade_executions WHERE trade_id = ? ORDER BY created_at')
        .all(tradeId) as Array<{ action: string }>
    ).map((r) => r.action);

  const phaseFor = (tradeId: string): string => {
    const actions = journalActionsFor(tradeId);
    return deriveWorkflowPhase(
      'open',
      null,
      hasManagementActivity(actions.map((action) => ({ action })) as never),
    );
  };

  it('short add/reduce keep journal management vocabulary, resolve canonical accounting, cash, FIFO, managed phase', () => {
    const accountId = seedAccount();
    seedSettings();
    const tradeId = seedTrade(accountId, { direction: 'short', plannedStop: 105 });

    // Initial short entry: journal sell_short; phase open (no management yet).
    const opened = executeTradeFill(
      fill(tradeId, { action: 'sell_short', quantity: 100, price: 100, fees: 1 }),
      context,
    );
    expect(opened.trade.status).toBe('open');
    expect(phaseFor(tradeId)).toBe('open');

    // Short ADD: journal 'add' → accounting 'sell_short'; cash increases.
    const added = executeTradeFill(
      fill(tradeId, { action: 'add', quantity: 20, price: 101, fees: 1 }),
      context,
    );
    expect(added.trade.status).toBe('open');
    expect(metricsForTrade(tradeId).size.openQuantity).toBe(120);

    // Short REDUCE (partial): journal 'reduce' → accounting 'buy_to_cover';
    // cash decreases; trade stays open.
    const reduced = executeTradeFill(
      fill(tradeId, { action: 'reduce', quantity: 30, price: 99, fees: 1 }),
      context,
    );
    expect(reduced.trade.status).toBe('open');
    expect(metricsForTrade(tradeId).size.openQuantity).toBe(90);

    // Journal actions preserve the management vocabulary.
    expect(journalActionsFor(tradeId)).toEqual(['sell_short', 'add', 'reduce']);

    // Canonical accounting resolves the economic side (M002-A5 frozen).
    const accountingActions = (
      sqlite.prepare(
        'SELECT action FROM accounting_executions WHERE journal_trade_id = ? ORDER BY created_at',
      ).all(tradeId) as Array<{ action: string }>
    ).map((r) => r.action);
    expect(accountingActions).toEqual(['sell_short', 'sell_short', 'buy_to_cover']);

    // Cash direction (canonical projection): short sale proceeds
    // (100*100−1) + add proceeds (20*101−1) − cover cost (30*99+1) = +9047.
    // The engine rebuilds account_performance.net_cash after every fill.
    const perf = sqlite
      .prepare('SELECT net_cash FROM account_performance WHERE account_id = ?')
      .get(accountId) as { net_cash: string } | undefined;
    const expectedNetCash = 100 * 100 - 1 + 20 * 101 - 1 - (30 * 99 + 1);
    expect(Number(perf?.net_cash ?? '0')).toBeCloseTo(expectedNetCash, 2);

    // FIFO short position coherent: open quantity 90 (lots 100 + 20 − 30).
    const pos = sqlite
      .prepare('SELECT quantity FROM account_positions WHERE account_id = ?')
      .get(accountId) as { quantity: string } | undefined;
    expect(Number(pos?.quantity ?? 0)).toBeCloseTo(90, 2);

    // Managed phase: after add (management execution), phase derives managed
    // without any stop/target adjustment.
    expect(phaseFor(tradeId)).toBe('managed');
  });

  it('short partial reduce alone turns management activity true (phase managed)', () => {
    const accountId = seedAccount();
    seedSettings();
    const tradeId = seedTrade(accountId, { direction: 'short', plannedStop: 105 });

    executeTradeFill(
      fill(tradeId, { action: 'sell_short', quantity: 100, price: 100 }),
      context,
    );
    executeTradeFill(
      fill(tradeId, { action: 'reduce', quantity: 30, price: 99 }),
      context,
    );

    expect(phaseFor(tradeId)).toBe('managed');
    expect(metricsForTrade(tradeId).size.openQuantity).toBe(70);
  });

  it('full-quantity short reduce closes the trade (equivalent to full buy_to_cover)', () => {
    const accountId = seedAccount();
    seedSettings();
    const tradeId = seedTrade(accountId, { direction: 'short', plannedStop: 105 });

    executeTradeFill(
      fill(tradeId, { action: 'sell_short', quantity: 100, price: 100 }),
      context,
    );
    const closed = executeTradeFill(
      fill(tradeId, { action: 'reduce', quantity: 100, price: 99 }),
      context,
    );
    expect(closed.trade.status).toBe('closed');
    expect(closed.trade.closedAt).toBeTruthy();
    expect(metricsForTrade(tradeId).size.openQuantity).toBe(0);
    // Journal keeps the management vocabulary; accounting resolves buy_to_cover.
    expect(journalActionsFor(tradeId)).toEqual(['sell_short', 'reduce']);
    const accountingActions = (
      sqlite.prepare(
        'SELECT action FROM accounting_executions WHERE journal_trade_id = ? ORDER BY created_at',
      ).all(tradeId) as Array<{ action: string }>
    ).map((r) => r.action);
    expect(accountingActions).toEqual(['sell_short', 'buy_to_cover']);
  });

  it('short over-close via reduce is rejected with zero mutation (OverCloseError)', () => {
    const accountId = seedAccount();
    seedSettings();
    const tradeId = seedTrade(accountId, { direction: 'short', plannedStop: 105 });

    executeTradeFill(
      fill(tradeId, { action: 'sell_short', quantity: 100, price: 100 }),
      context,
    );
    expect(() =>
      executeTradeFill(fill(tradeId, { action: 'reduce', quantity: 150, price: 99 }), context),
    ).toThrow(OverCloseError);
    expect(metricsForTrade(tradeId).size.openQuantity).toBe(100);
    expect(countRows('trade_executions', 'trade_id = ?', tradeId)).toBe(1);
  });
});

describe('A13 idempotency-key trade ownership', () => {
  it('same-trade key reuse replays with self-consistent identity', () => {
    const accountId = seedAccount();
    seedSettings();
    const tradeId = seedTrade(accountId);
    const key = randomUUID();

    const first = executeTradeFill(
      fill(tradeId, { action: 'buy', quantity: 100, price: 100, idempotencyKey: key }),
      context,
    );
    expect(first.replayed).toBe(false);

    const replay = executeTradeFill(
      fill(tradeId, { action: 'buy', quantity: 100, price: 100, idempotencyKey: key }),
      context,
    );
    expect(replay.replayed).toBe(true);
    expect(replay.execution.id).toBe(first.execution.id);
    expect(replay.trade.id).toBe(tradeId);
    expect(replay.execution.tradeId).toBe(tradeId);
    // Identity assertions: execution.tradeId == trade.id; accounting linkage
    // matches the owning trade.
    expect(replay.execution.tradeId).toBe(replay.trade.id);
    expect(replay.accountingExecution?.journal_trade_id).toBe(tradeId);
    expect(countRows('trade_executions', 'trade_id = ?', tradeId)).toBe(1);
  });

  it('cross-trade key reuse is an ownership conflict with zero mutation on B', () => {
    const accountId = seedAccount();
    seedSettings();
    const tradeA = seedTrade(accountId);
    const tradeB = seedTrade(accountId);
    const key = randomUUID();

    executeTradeFill(
      fill(tradeA, { action: 'buy', quantity: 100, price: 100, idempotencyKey: key }),
      context,
    );

    const beforeB = countRows('trade_executions', 'trade_id = ?', tradeB);
    let err: unknown = null;
    try {
      executeTradeFill(
        fill(tradeB, { action: 'buy', quantity: 50, price: 100, idempotencyKey: key }),
        context,
      );
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ExecutionIdempotencyConflictError);
    const conflict = err as ExecutionIdempotencyConflictError;
    expect(conflict.idempotencyKey).toBe(key);
    expect(conflict.requestedTradeId).toBe(tradeB);
    expect(countRows('trade_executions', 'trade_id = ?', tradeB)).toBe(beforeB);
    // A's execution is untouched and still owns the key.
    expect(countRows('trade_executions', 'trade_id = ?', tradeA)).toBe(1);
  });

  it('A12 ordering: closed trade + own final-close key replays; new key rejected; foreign key conflicts', () => {
    const accountId = seedAccount();
    seedSettings();
    const tradeA = seedTrade(accountId);
    const tradeB = seedTrade(accountId);
    const closeKey = randomUUID();

    executeTradeFill(
      fill(tradeA, { action: 'buy', quantity: 100, price: 100, idempotencyKey: randomUUID() }),
      context,
    );
    const closed = executeTradeFill(
      fill(tradeA, { action: 'sell', quantity: 100, price: 110, idempotencyKey: closeKey }),
      context,
    );
    expect(closed.trade.status).toBe('closed');

    // Same-trade final-close retry: replay (A12 preserved).
    const retry = executeTradeFill(
      fill(tradeA, { action: 'sell', quantity: 100, price: 110, idempotencyKey: closeKey }),
      context,
    );
    expect(retry.replayed).toBe(true);

    // New key on the closed trade: closed boundary.
    expect(() =>
      executeTradeFill(fill(tradeA, { action: 'buy', quantity: 10, price: 100, idempotencyKey: randomUUID() }), context),
    ).toThrow(TradeClosedError);

    // A foreign key owned by tradeB... tradeB owns nothing yet; seed B's own
    // execution with a distinct key, then use B's key against A → conflict.
    const bKey = randomUUID();
    executeTradeFill(
      fill(tradeB, { action: 'buy', quantity: 10, price: 100, idempotencyKey: bKey }),
      context,
    );
    expect(() =>
      executeTradeFill(fill(tradeA, { action: 'buy', quantity: 10, price: 100, idempotencyKey: bKey }), context),
    ).toThrow(ExecutionIdempotencyConflictError);
  });
});

describe('A12 closed-trade ordinary execution boundary', () => {
  it('rejects every NEW ordinary action on a closed long trade with zero mutation', () => {
    const accountId = seedAccount();
    seedSettings();
    const tradeId = seedTrade(accountId);

    executeTradeFill(fill(tradeId, { action: 'buy', quantity: 100, price: 100 }), context);
    const closed = executeTradeFill(
      fill(tradeId, { action: 'sell', quantity: 100, price: 110 }),
      context,
    );
    expect(closed.trade.status).toBe('closed');

    const before = {
      tx: countRows('trade_executions', 'trade_id = ?', tradeId),
      acct: countRows('accounting_executions', 'journal_trade_id = ?', tradeId),
      fe: countRows('financial_events', '1 = 1'),
      fee: countRows('financial_events', "event_type = 'fee'"),
    };

    for (const [action, quantity] of [
      ['buy', 10],
      ['add', 10],
      ['sell', 10],
      ['reduce', 10],
    ] as const) {
      expect(() =>
        executeTradeFill(fill(tradeId, { action, quantity, price: 100 }), context),
      ).toThrow(TradeClosedError);
    }

    expect(countRows('trade_executions', 'trade_id = ?', tradeId)).toBe(before.tx);
    expect(countRows('accounting_executions', 'journal_trade_id = ?', tradeId)).toBe(before.acct);
    expect(countRows('financial_events', '1 = 1')).toBe(before.fe);
    expect(countRows('financial_events', "event_type = 'fee'")).toBe(before.fee);
    expect(metricsForTrade(tradeId).position.status).toBe('closed');
  });

  it('rejects every NEW ordinary action on a closed short trade with zero mutation', () => {
    const accountId = seedAccount();
    seedSettings();
    const tradeId = seedTrade(accountId, { direction: 'short', plannedStop: 105 });

    executeTradeFill(
      fill(tradeId, { action: 'sell_short', quantity: 100, price: 100 }),
      context,
    );
    const closed = executeTradeFill(
      fill(tradeId, { action: 'buy_to_cover', quantity: 100, price: 90 }),
      context,
    );
    expect(closed.trade.status).toBe('closed');

    const before = countRows('trade_executions', 'trade_id = ?', tradeId);

    for (const [action, quantity] of [
      ['sell_short', 10],
      ['add', 10],
      ['buy_to_cover', 10],
      ['reduce', 10],
    ] as const) {
      expect(() =>
        executeTradeFill(fill(tradeId, { action, quantity, price: 100 }), context),
      ).toThrow(TradeClosedError);
    }

    expect(countRows('trade_executions', 'trade_id = ?', tradeId)).toBe(before);
    expect(metricsForTrade(tradeId).position.status).toBe('closed');
  });

  it('replays the SAME-key final closing fill after the trade is closed', () => {
    const accountId = seedAccount();
    seedSettings();
    const tradeId = seedTrade(accountId);
    const buyKey = randomUUID();
    const closeKey = randomUUID();

    executeTradeFill(
      fill(tradeId, { action: 'buy', quantity: 100, price: 100, idempotencyKey: buyKey }),
      context,
    );
    const first = executeTradeFill(
      fill(tradeId, { action: 'sell', quantity: 100, price: 110, idempotencyKey: closeKey }),
      context,
    );
    expect(first.trade.status).toBe('closed');

    // Network retry of the identical request: replay, NOT TradeClosedError.
    const replay = executeTradeFill(
      fill(tradeId, { action: 'sell', quantity: 100, price: 110, idempotencyKey: closeKey }),
      context,
    );
    expect(replay.replayed).toBe(true);
    expect(replay.execution.id).toBe(first.execution.id);
    expect(countRows('trade_executions', 'trade_id = ?', tradeId)).toBe(2);
    expect(metricsForTrade(tradeId).position.status).toBe('closed');
  });

  it('rejects a NEW key on the closed trade after replay coverage', () => {
    const accountId = seedAccount();
    seedSettings();
    const tradeId = seedTrade(accountId);
    const buyKey = randomUUID();
    const closeKey = randomUUID();
    const newSellKey = randomUUID();
    const newBuyKey = randomUUID();

    executeTradeFill(
      fill(tradeId, { action: 'buy', quantity: 100, price: 100, idempotencyKey: buyKey }),
      context,
    );
    executeTradeFill(
      fill(tradeId, { action: 'sell', quantity: 100, price: 110, idempotencyKey: closeKey }),
      context,
    );

    expect(() =>
      executeTradeFill(fill(tradeId, { action: 'sell', quantity: 100, price: 110, idempotencyKey: newSellKey }), context),
    ).toThrow(TradeClosedError);
    expect(() =>
      executeTradeFill(fill(tradeId, { action: 'buy', quantity: 10, price: 100, idempotencyKey: newBuyKey }), context),
    ).toThrow(TradeClosedError);
  });

  it('rejects ordinary fills on a reviewed closed trade', () => {
    const accountId = seedAccount();
    seedSettings();
    const tradeId = seedTrade(accountId);

    executeTradeFill(fill(tradeId, { action: 'buy', quantity: 100, price: 100 }), context);
    executeTradeFill(fill(tradeId, { action: 'sell', quantity: 100, price: 110 }), context);

    // Stamp review as the workflow does (reviewedAt != null).
    const { db } = context;
    db.update(schema.trades)
      .set({ reviewedAt: '2026-03-01T00:00:00.000Z' })
      .where(eq(schema.trades.id, tradeId))
      .run();
    expect(
      db.select().from(schema.trades).where(eq(schema.trades.id, tradeId)).get()?.reviewedAt,
    ).toBeTruthy();

    expect(() =>
      executeTradeFill(fill(tradeId, { action: 'buy', quantity: 10, price: 100 }), context),
    ).toThrow(TradeClosedError);
    expect(metricsForTrade(tradeId).position.status).toBe('closed');
  });
});

describe('S04 quantity guards', () => {
  it('rejects an over-close on a long trade before any mutation', () => {
    const accountId = seedAccount();
    seedSettings();
    const tradeId = seedTrade(accountId, { plannedStop: 95 });

    // Open with 100, then try to close 200.
    executeTradeFill(fill(tradeId), context);
    expect(() =>
      executeTradeFill(
        fill(tradeId, { action: 'sell', quantity: 200, price: 110, idempotencyKey: randomUUID() }),
        context,
      ),
    ).toThrow(OverCloseError);

    // Zero mutations across every domain: the pre-flight rejection never
    // reached the transaction.
    expect(countRows('trade_executions', 'trade_id = ?', tradeId)).toBe(1);
    expect(countRows('accounting_executions', 'journal_trade_id = ?', tradeId)).toBe(1);
    expect(countRows('financial_events', 'account_id = ?', accountId)).toBe(1);
    expect(
      db.select().from(schema.trades).where(eq(schema.trades.id, tradeId)).get()?.status,
    ).toBe('open');
  });

  it('rejects an over-cover on a short trade before any mutation', () => {
    const accountId = seedAccount();
    seedSettings();
    const tradeId = seedTrade(accountId, { direction: 'short', plannedStop: 105 });

    // Open a 100-share short, then try to cover 200.
    executeTradeFill(fill(tradeId, { action: 'sell_short', price: 100 }), context);
    expect(() =>
      executeTradeFill(
        fill(tradeId, { action: 'buy_to_cover', quantity: 200, price: 98, idempotencyKey: randomUUID() }),
        context,
      ),
    ).toThrow(OverCloseError);

    expect(countRows('trade_executions', 'trade_id = ?', tradeId)).toBe(1);
    expect(countRows('accounting_executions', 'journal_trade_id = ?', tradeId)).toBe(1);
  });

  it('carries the requested/open quantities on the over-close error', () => {
    const accountId = seedAccount();
    seedSettings();
    const tradeId = seedTrade(accountId, { plannedStop: 95 });

    executeTradeFill(fill(tradeId), context); // buy 100
    let caught: unknown;
    try {
      executeTradeFill(
        fill(tradeId, { action: 'sell', quantity: 200, price: 110, idempotencyKey: randomUUID() }),
        context,
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(OverCloseError);
    const overClose = caught as OverCloseError;
    expect(overClose.name).toBe('OverCloseError');
    expect(overClose.requestedQuantity).toBe(200);
    expect(overClose.openQuantity).toBe(100);
    expect(overClose.message).toContain('200');
    expect(overClose.message).toContain('100');
  });

  it('accepts a partial close and leaves the remainder open', () => {
    const accountId = seedAccount();
    seedSettings();
    const tradeId = seedTrade(accountId, { plannedStop: 95 });

    executeTradeFill(fill(tradeId), context); // buy 100
    const partial = executeTradeFill(
      fill(tradeId, { action: 'sell', quantity: 50, price: 110, idempotencyKey: randomUUID() }),
      context,
    );

    expect(partial.trade.status).toBe('open');
    const metrics = metricsForTrade(tradeId);
    expect(metrics.size.entryQuantity).toBe(100);
    expect(metrics.size.exitQuantity).toBe(50);
    expect(metrics.size.openQuantity).toBe(50);
    expect(metrics.position.status).toBe('open');
  });

  it('accepts a full close and derives closed status', () => {
    const accountId = seedAccount();
    seedSettings();
    const tradeId = seedTrade(accountId, { plannedStop: 95 });

    executeTradeFill(fill(tradeId), context); // buy 100
    const full = executeTradeFill(
      fill(tradeId, { action: 'sell', quantity: 100, price: 110, idempotencyKey: randomUUID() }),
      context,
    );

    expect(full.trade.status).toBe('closed');
    expect(full.trade.closedAt).toBeTruthy();
    const metrics = metricsForTrade(tradeId);
    expect(metrics.size.openQuantity).toBe(0);
    expect(metrics.position.status).toBe('closed');
  });

  it("rejects 'add' on a planned trade with OpenPositionRequiredError", () => {
    const accountId = seedAccount();
    seedSettings();
    const tradeId = seedTrade(accountId, { plannedStop: 95 });

    expect(() =>
      executeTradeFill(fill(tradeId, { action: 'add', quantity: 50 }), context),
    ).toThrow(OpenPositionRequiredError);
    expect(countRows('trade_executions', 'trade_id = ?', tradeId)).toBe(0);
  });

  it("rejects 'reduce' on a planned trade with OpenPositionRequiredError", () => {
    const accountId = seedAccount();
    seedSettings();
    const tradeId = seedTrade(accountId, { plannedStop: 95 });

    expect(() =>
      executeTradeFill(fill(tradeId, { action: 'reduce', quantity: 25 }), context),
    ).toThrow(OpenPositionRequiredError);
    expect(countRows('trade_executions', 'trade_id = ?', tradeId)).toBe(0);
  });

  it("rejects 'sell' on a planned trade as an over-close (open quantity is zero)", () => {
    const accountId = seedAccount();
    seedSettings();
    const tradeId = seedTrade(accountId, { plannedStop: 95 });

    // A closing fill on a planned trade has no position to close: the
    // open-quantity guard (openQuantity = 0) rejects it pre-flight, before
    // the first-fill readiness/checklist gates run.
    expect(() =>
      executeTradeFill(fill(tradeId, { action: 'sell', quantity: 10 }), context),
    ).toThrow(OverCloseError);
    expect(countRows('trade_executions', 'trade_id = ?', tradeId)).toBe(0);
  });
});

// ── S04: backdated fill deterministic ordering ─────────────────────────
//
// Requirement §28: "Backdated fills are supported. Canonical ordering must be
// deterministic. At minimum use executedAt, then stable tie-breaker such as
// createdAt, id/sequence. No state should depend on insertion order alone."
//
// The metrics layer sorts entries/exits by (executedAt, id) and the FIFO
// rebuild replays accounting_executions in (posted_at ASC, id ASC) order — the
// engine maps executedAt → posted_at, so both layers follow the fill's
// timestamp, never the insertion order. These tests prove that invariant by
// driving the same fill sets through the canonical engine in different orders.

interface S04FifoLotRow {
  remaining_quantity: string;
  entry_price: string;
  opened_at: string;
}

interface S04PositionRow {
  quantity: string;
  realized_gross_pnl: string;
  realized_net_pnl: string;
}

interface S04MatchRow {
  match_quantity: string;
  match_price: string;
  realized_gross_pnl: string;
  sequence: number;
  lot_entry_price: string;
}

describe('S04 backdated fills order deterministically', () => {
  // Fixed backdated timestamps, oldest → newest.
  const T0 = '2026-08-20T09:00:00.000Z';
  const T1 = '2026-08-20T10:00:00.000Z';
  const T11 = '2026-08-20T11:00:00.000Z';
  const T12 = '2026-08-20T12:00:00.000Z';
  const T13 = '2026-08-20T13:00:00.000Z';

  interface TradeSnapshot {
    metrics: {
      entryQuantity: number;
      exitQuantity: number;
      openQuantity: number;
      status: string;
      openedAt: string | null;
      closedAt: string | null;
      grossRealizedPnl: number;
      netRealizedPnl: number;
    };
    position: { quantity: string; realizedGrossPnl: string; realizedNetPnl: string } | null;
    lots: Array<{ remaining: string; entry: string; openedAt: string }>;
    matches: Array<{ qty: string; price: string; gross: string; lotEntry: string }>;
  }

  /** Snapshot every derived surface for a trade so two seeds can be compared. */
  function snapshotTradeState(accountId: string, tradeId: string): TradeSnapshot {
    const metrics = metricsForTrade(tradeId);
    const position = sqlite
      .prepare(
        `SELECT quantity, realized_gross_pnl, realized_net_pnl
         FROM account_positions WHERE account_id = ?`,
      )
      .get(accountId) as S04PositionRow | undefined;
    const lots = sqlite
      .prepare(
        `SELECT remaining_quantity, entry_price, opened_at
         FROM fifo_lots WHERE account_id = ? ORDER BY opened_at ASC, id ASC`,
      )
      .all(accountId) as S04FifoLotRow[];
    const matches = sqlite
      .prepare(
        `SELECT lm.match_quantity, lm.match_price, lm.realized_gross_pnl,
                lm.sequence, fl.entry_price AS lot_entry_price
         FROM lot_matches lm
         JOIN fifo_lots fl ON fl.id = lm.lot_id
         JOIN accounting_executions ae ON ae.id = lm.closing_execution_id
         WHERE ae.account_id = ?
         ORDER BY lm.sequence ASC`,
      )
      .all(accountId) as S04MatchRow[];
    return {
      metrics: {
        entryQuantity: metrics.size.entryQuantity,
        exitQuantity: metrics.size.exitQuantity,
        openQuantity: metrics.size.openQuantity,
        status: metrics.position.status,
        openedAt: metrics.position.openedAt,
        closedAt: metrics.position.closedAt,
        grossRealizedPnl: metrics.realizedPnl.grossRealizedPnl,
        netRealizedPnl: metrics.realizedPnl.netRealizedPnl,
      },
      position: position
        ? {
            quantity: position.quantity,
            realizedGrossPnl: position.realized_gross_pnl,
            realizedNetPnl: position.realized_net_pnl,
          }
        : null,
      lots: lots.map((l) => ({ remaining: l.remaining_quantity, entry: l.entry_price, openedAt: l.opened_at })),
      matches: matches.map((m) => ({
        qty: m.match_quantity,
        price: m.match_price,
        gross: m.realized_gross_pnl,
        lotEntry: m.lot_entry_price,
      })),
    };
  }

  it('produces identical metrics and FIFO state when 3 backdated entries are inserted in reverse order', () => {
    // Same fill set, two insertion orders, two fresh accounts. All three fills
    // are opening actions, so every insertion prefix is valid under the T02
    // quantity guards (a close cannot be inserted first — that is by design).
    const fillsChrono: Array<Partial<ExecuteTradeFillInput>> = [
      { action: 'buy', quantity: 100, price: 100, executedAt: T1 }, // A (earliest)
      { action: 'buy', quantity: 50, price: 100, executedAt: T11 }, // B
      { action: 'buy', quantity: 25, price: 100, executedAt: T12 }, // C (latest)
    ];
    const fillsReverse = [...fillsChrono].reverse(); // inserted C, B, A

    const acctChrono = seedAccount();
    seedSettings();
    const tradeChrono = seedTrade(acctChrono, { plannedStop: 95 });
    for (const f of fillsChrono) executeTradeFill(fill(tradeChrono, f), context);

    const acctReverse = seedAccount();
    const tradeReverse = seedTrade(acctReverse, { plannedStop: 95 });
    for (const f of fillsReverse) executeTradeFill(fill(tradeReverse, f), context);

    const chronoState = snapshotTradeState(acctChrono, tradeChrono);
    const reverseState = snapshotTradeState(acctReverse, tradeReverse);

    expect(reverseState).toEqual(chronoState);
    // openedAt follows the earliest executedAt (fill A), not the first-inserted fill.
    expect(chronoState.metrics.openedAt).toBe(T1);
    expect(chronoState.metrics.entryQuantity).toBe(175);
    expect(chronoState.metrics.exitQuantity).toBe(0);
    expect(chronoState.metrics.openQuantity).toBe(175);
    expect(chronoState.metrics.status).toBe('open');
    expect(chronoState.position?.quantity).toBe('175.00');
  });

  it('produces identical metrics and FIFO P&L when a close is inserted before a backdated add', () => {
    const entry: Partial<ExecuteTradeFillInput> = { action: 'buy', quantity: 100, price: 100, executedAt: T1 };
    const add: Partial<ExecuteTradeFillInput> = { action: 'add', quantity: 50, price: 105, executedAt: T12 };
    const close: Partial<ExecuteTradeFillInput> = { action: 'sell', quantity: 30, price: 110, executedAt: T13 };

    const acctA = seedAccount();
    seedSettings();
    const tradeA = seedTrade(acctA, { plannedStop: 95 });
    // Order 1: chronological entry → add → close.
    for (const f of [entry, add, close]) executeTradeFill(fill(tradeA, f), context);

    const acctB = seedAccount();
    const tradeB = seedTrade(acctB, { plannedStop: 95 });
    // Order 2: entry → close → backdated add (the add lands between entry and close).
    for (const f of [entry, close, add]) executeTradeFill(fill(tradeB, f), context);

    const stateA = snapshotTradeState(acctA, tradeA);
    const stateB = snapshotTradeState(acctB, tradeB);

    expect(stateB).toEqual(stateA);
    expect(stateA.metrics.entryQuantity).toBe(150);
    expect(stateA.metrics.exitQuantity).toBe(30);
    expect(stateA.metrics.openQuantity).toBe(120);
    expect(stateA.metrics.grossRealizedPnl).toBe(300); // 30 × (110 − 100)
    expect(stateA.metrics.status).toBe('open');
    expect(stateA.position?.quantity).toBe('120.00');
    expect(stateA.position?.realizedGrossPnl).toBe('300.00');
    expect(stateA.lots).toEqual([
      { remaining: '70.00', entry: '100.00', openedAt: T1 },
      { remaining: '50.00', entry: '105.00', openedAt: T12 },
    ]);
    expect(stateA.matches).toEqual([
      { qty: '30.00', price: '110.00', gross: '300.00', lotEntry: '100.00' },
    ]);
  });

  it('matches a backdated partial close against the earliest FIFO lot with correct P&L', () => {
    const accountId = seedAccount();
    seedSettings();
    const tradeId = seedTrade(accountId, { plannedStop: 49 });

    executeTradeFill(fill(tradeId, { quantity: 100, price: 50, executedAt: T1 }), context); // entry 100 @ 50
    executeTradeFill(
      fill(tradeId, { action: 'add', quantity: 50, price: 55, executedAt: T12, idempotencyKey: randomUUID() }),
      context,
    ); // add 50 @ 55
    // Backdated partial close: executedAt sits between the entry (T1) and the add (T12).
    executeTradeFill(
      fill(tradeId, { action: 'sell', quantity: 40, price: 54, executedAt: T11, idempotencyKey: randomUUID() }),
      context,
    );

    const metrics = metricsForTrade(tradeId);
    expect(metrics.size.entryQuantity).toBe(150);
    expect(metrics.size.exitQuantity).toBe(40);
    expect(metrics.size.openQuantity).toBe(110);
    expect(metrics.realizedPnl.grossRealizedPnl).toBe(160); // 40 × (54 − 50)
    expect(metrics.realizedPnl.netRealizedPnl).toBe(160);
    expect(metrics.position.status).toBe('open');

    const position = sqlite
      .prepare(
        `SELECT quantity, realized_gross_pnl, realized_net_pnl, average_cost
         FROM account_positions WHERE account_id = ?`,
      )
      .get(accountId) as {
      quantity: string;
      realized_gross_pnl: string;
      realized_net_pnl: string;
      average_cost: string;
    };
    expect(position.quantity).toBe('110.00');
    expect(position.realized_gross_pnl).toBe('160.00');
    expect(position.realized_net_pnl).toBe('160.00');
    expect(position.average_cost).toBe('52.27'); // (60×50 + 50×55) / 110

    const lots = sqlite
      .prepare(
        `SELECT remaining_quantity, entry_price, opened_at
         FROM fifo_lots WHERE account_id = ? ORDER BY opened_at ASC, id ASC`,
      )
      .all(accountId) as S04FifoLotRow[];
    expect(lots).toEqual([
      { remaining_quantity: '60.00', entry_price: '50.00', opened_at: T1 },
      { remaining_quantity: '50.00', entry_price: '55.00', opened_at: T12 },
    ]);

    // The close must match the T1 lot (entry price 50) — FIFO by timestamp, not
    // by insertion order — and the add lot (55) must be untouched.
    const matches = sqlite
      .prepare(
        `SELECT lm.match_quantity, lm.match_price, lm.realized_gross_pnl,
                lm.sequence, fl.entry_price AS lot_entry_price
         FROM lot_matches lm
         JOIN fifo_lots fl ON fl.id = lm.lot_id
         JOIN accounting_executions ae ON ae.id = lm.closing_execution_id
         WHERE ae.account_id = ? AND ae.action = 'sell'`,
      )
      .all(accountId) as S04MatchRow[];
    expect(matches).toHaveLength(1);
    expect(matches[0]).toEqual({
      match_quantity: '40.00',
      match_price: '54.00',
      realized_gross_pnl: '160.00',
      sequence: 1,
      lot_entry_price: '50.00',
    });
  });

  it('derives openedAt from the earliest backdated entry, not the first-inserted fill', () => {
    const acctA = seedAccount();
    seedSettings();
    const tradeA = seedTrade(acctA, { plannedStop: 95 });

    // Seed A: later-timestamp entry first, then a backdated earlier entry.
    executeTradeFill(fill(tradeA, { quantity: 100, price: 100, executedAt: T11 }), context);
    const backdated = executeTradeFill(
      fill(tradeA, { quantity: 50, price: 100, executedAt: T1, idempotencyKey: randomUUID() }),
      context,
    );

    const acctB = seedAccount();
    const tradeB = seedTrade(acctB, { plannedStop: 95 });
    // Seed B: chronological insertion of the same two fills.
    executeTradeFill(fill(tradeB, { quantity: 50, price: 100, executedAt: T1 }), context);
    executeTradeFill(fill(tradeB, { quantity: 100, price: 100, executedAt: T11, idempotencyKey: randomUUID() }), context);

    expect(snapshotTradeState(acctA, tradeA)).toEqual(snapshotTradeState(acctB, tradeB));
    // openedAt moved to T1 — the earliest executedAt — even though the T1 fill
    // was inserted second.
    expect(backdated.trade.openedAt).toBe(T1);
    expect(backdated.trade.status).toBe('open');
    expect(metricsForTrade(tradeA).size.entryQuantity).toBe(150);
  });

  it('derives closedAt from the backdated close executedAt and closes the FIFO position', () => {
    const accountId = seedAccount();
    seedSettings();
    const tradeId = seedTrade(accountId, { plannedStop: 95 });

    executeTradeFill(fill(tradeId, { quantity: 100, price: 100, executedAt: T1 }), context);
    const close = executeTradeFill(
      fill(tradeId, { action: 'sell', quantity: 100, price: 110, executedAt: T11, idempotencyKey: randomUUID() }),
      context,
    );

    expect(close.trade.status).toBe('closed');
    expect(close.trade.openedAt).toBe(T1);
    expect(close.trade.closedAt).toBe(T11);

    const metrics = metricsForTrade(tradeId);
    expect(metrics.position.status).toBe('closed');
    expect(metrics.position.openedAt).toBe(T1);
    expect(metrics.position.closedAt).toBe(T11);

    // FIFO projection is flat with realized P&L of 100 × (110 − 100).
    const position = sqlite
      .prepare(`SELECT quantity, realized_gross_pnl FROM account_positions WHERE account_id = ?`)
      .get(accountId) as { quantity: string; realized_gross_pnl: string };
    expect(position.quantity).toBe('0.00');
    expect(position.realized_gross_pnl).toBe('1000.00');
  });

  it('rejects a backdated close before the first entry with zero mutations', () => {
    const accountId = seedAccount();
    seedSettings();
    const tradeId = seedTrade(accountId, { plannedStop: 95 });

    executeTradeFill(fill(tradeId, { quantity: 100, price: 100, executedAt: T1 }), context);

    // T0 < T1: the close would be replayed before the entry in the FIFO stream.
    // The pre-flight open-quantity guard passes (open = 100, close = 100), but the
    // immutable accounting stream rejects the exit-before-entry replay inside the
    // transaction and rolls the whole fill back — zero mutations survive.
    expect(() =>
      executeTradeFill(
        fill(tradeId, { action: 'sell', quantity: 100, price: 110, executedAt: T0, idempotencyKey: randomUUID() }),
        context,
      ),
    ).toThrow(/NO_POSITION_TO_CLOSE/);

    expect(countRows('trade_executions', 'trade_id = ?', tradeId)).toBe(1);
    expect(countRows('accounting_executions', 'journal_trade_id = ?', tradeId)).toBe(1);
    const trade = db.select().from(schema.trades).where(eq(schema.trades.id, tradeId)).get();
    expect(trade?.status).toBe('open');
  });

  it('rejects a backdated close that exceeds the position at its stream position', () => {
    const accountId = seedAccount();
    seedSettings();
    const tradeId = seedTrade(accountId, { plannedStop: 95 });

    executeTradeFill(fill(tradeId, { quantity: 100, price: 100, executedAt: T1 }), context);
    executeTradeFill(
      fill(tradeId, { action: 'add', quantity: 50, price: 105, executedAt: T12, idempotencyKey: randomUUID() }),
      context,
    );

    // The pre-flight guard sees the full persisted set (150 open) and passes, but
    // the FIFO rebuild replays in posted_at order — at T11 only 100 shares exist,
    // so closing 120 would reverse the position. The atomic transaction rejects
    // (REVERSAL) and rolls back.
    expect(() =>
      executeTradeFill(
        fill(tradeId, { action: 'sell', quantity: 120, price: 110, executedAt: T11, idempotencyKey: randomUUID() }),
        context,
      ),
    ).toThrow(/REVERSAL/);

    expect(countRows('trade_executions', 'trade_id = ?', tradeId)).toBe(2);
    expect(countRows('accounting_executions', 'journal_trade_id = ?', tradeId)).toBe(2);
  });

  it('orders same-executedAt entries by stable id tiebreaker, never insertion order', () => {
    const ts = '2026-08-20T10:00:00.000Z';

    const acctA = seedAccount();
    seedSettings();
    const tradeA = seedTrade(acctA, { plannedStop: 95 });
    // Same executedAt for both entries; different insertion order per seed.
    executeTradeFill(fill(tradeA, { quantity: 100, price: 100, executedAt: ts }), context);
    executeTradeFill(fill(tradeA, { quantity: 50, price: 110, executedAt: ts, idempotencyKey: randomUUID() }), context);

    const acctB = seedAccount();
    const tradeB = seedTrade(acctB, { plannedStop: 95 });
    executeTradeFill(fill(tradeB, { quantity: 50, price: 110, executedAt: ts }), context);
    executeTradeFill(fill(tradeB, { quantity: 100, price: 100, executedAt: ts, idempotencyKey: randomUUID() }), context);

    // Aggregate metrics and the position row are insertion-order independent.
    // (The per-lot array order may differ between seeds because the tiebreaker
    // is the stable row id, never insertion order.)
    const stateA = snapshotTradeState(acctA, tradeA);
    const stateB = snapshotTradeState(acctB, tradeB);
    expect(stateA.metrics).toEqual(stateB.metrics);
    expect(stateA.position).toEqual(stateB.position);
    expect(stateA.metrics.entryQuantity).toBe(150);
    expect(stateA.metrics.openQuantity).toBe(150);
    expect(stateA.metrics.openedAt).toBe(ts);
    expect(stateA.position?.quantity).toBe('150.00');
  });

  it('M007: unmarked short cash-only NAV never inflates the second-fill risk limit', () => {
    // Canonical account: opening 50000, max risk 2%. The opening balance is
    // posted through the balanced posting kernel so the ledger carries it
    // (readAccountCash reads ledger debit postings).
    const accountId = seedAccount({ maxRiskPerTradePct: 2, startingBalance: null });
    seedSettings(50000, 2);
    postFinancialEvent(sqlite, {
      accountId,
      eventType: 'opening_balance',
      amount: '50000.00',
      description: 'Opening balance',
      payload: JSON.stringify({ amount: '50000.00' }),
      effect: JSON.stringify({ kind: 'cash', direction: 'increase', amount: '50000.00', amountMicros: 50_000_000_000 }),
      postedAt: now(),
    });

    // Open a short: sell_short 100 @ 200, stop 210 → proposed risk 1000 =
    // 2% of 50000 (exact boundary, accepted on the pristine projection).
    const shortTrade = seedTrade(accountId, { direction: 'short', plannedStop: 210 });
    const shortResult = executeTradeFill(
      fill(shortTrade, { action: 'sell_short', quantity: 100, price: 200, fees: 0 }),
      context,
    );
    expect(shortResult.trade.status).toBe('open');
    // Unmarked short liability → the rebuilt projection is CASH-ONLY and
    // inflated: 50000 + 20000 = 70000, marked_positions 0.
    expect(netCash(accountId)).toBe(70000);
    expect(perfValue(accountId, 'nav')).toBe(70000);

    // Second first-fill trade must FAIL CLOSED: the incomplete (cash-only)
    // projection is not trusted execution equity — the engine must never see
    // the inflated 70000 as usable equity. (Different instrument: no FIFO
    // interaction with the AAPL short.)
    const secondTrade = seedTrade(accountId, { plannedStop: 80, symbol: 'MSFT' });
    let caught: unknown;
    try {
      executeTradeFill(fill(secondTrade, { quantity: 100, price: 100 }), context);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ReadinessFailureError);
    expect(
      (caught as ReadinessFailureError).failures.some(
        (f) => f.code === 'account-not-trading-ready',
      ),
    ).toBe(true);
    expect(
      (caught as ReadinessFailureError).failures.some((f) => f.code === 'max-risk-exceeded'),
    ).toBe(false);

    // After a valid canonical mark + projection rebuild, the complete marked
    // NAV (70000 - 100 × 200 = 50000) is used and normal max-risk enforcement
    // resumes against it.
    insertValuationMark(sqlite, {
      accountId,
      instrumentId: shortResult.accountingExecution!.instrument_id,
      price: '200.00',
      priceMicros: 200_000_000,
      source: 'user',
      markTimestamp: new Date().toISOString(),
    });
    const perf = rebuildAccountPerformance(sqlite, accountId);
    expect(perf.success).toBe(true);
    expect(perfValue(accountId, 'nav')).toBe(50000);

    // Over-limit second fill: risk |100-80| × 100 = 2000 > 2% of 50000 = 1000
    // → max-risk enforcement against the complete NAV.
    let caught2: unknown;
    try {
      executeTradeFill(fill(secondTrade, { quantity: 100, price: 100 }), context);
    } catch (err) {
      caught2 = err;
    }
    expect(caught2).toBeInstanceOf(ReadinessFailureError);
    const maxRisk = (caught2 as ReadinessFailureError).failures.find(
      (f) => f.code === 'max-risk-exceeded',
    );
    expect(maxRisk).toBeTruthy();
    expect(maxRisk?.overrideable).toBe(true);
    expect(maxRisk?.limit).toBe(1000);
    expect(maxRisk?.computed).toBe(2000);
    expect(
      (caught2 as ReadinessFailureError).failures.some(
        (f) => f.code === 'account-not-trading-ready',
      ),
    ).toBe(false);

    // In-limit second fill succeeds once equity is trustworthy: risk 300 < 1000.
    const secondTradeOk = seedTrade(accountId, { plannedStop: 97, symbol: 'MSFT' });
    const okResult = executeTradeFill(
      fill(secondTradeOk, { quantity: 100, price: 100 }),
      context,
    );
    expect(okResult.trade.status).toBe('open');
  });
});
