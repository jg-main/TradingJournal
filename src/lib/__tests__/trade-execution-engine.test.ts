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
  ActionDirectionError,
  ReadinessFailureError,
  ChecklistGateError,
  type ExecuteTradeFillInput,
  type TradeExecutionContext,
} from '../trade-execution-engine';
import { UnsupportedAccountCurrencyError } from '../accounting/errors';

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
}

function seedTrade(accountId: string, options: SeedTradeOptions = {}): string {
  const tradeId = randomUUID();
  db.insert(schema.trades)
    .values({
      id: tradeId,
      tradeCode: `TC-${randomUUID().slice(0, 8)}`,
      accountId,
      symbol: 'AAPL',
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

  it('canonical equity cascade: performance.nav wins over the legacy model', () => {
    const accountId = seedAccount();
    seedSettings();
    seedAccountPerformance(accountId, '50000.00');
    const tradeId = seedTrade(accountId, { plannedStop: 95 });

    const result = executeTradeFill(fill(tradeId), context);

    expect(result.riskSnapshot?.accountEquityAtOpen).toBe(50000);
  });

  it('canonical equity cascade: rollforward.ending_equity is the next fallback', () => {
    const accountId = seedAccount({ startingBalance: null });
    seedSettings(12345);
    seedRollforward(accountId, 75000);
    const tradeId = seedTrade(accountId, { plannedStop: 99 });

    const result = executeTradeFill(fill(tradeId, { quantity: 10, price: 100 }), context);

    // No account_performance → rollforward.ending_equity.
    expect(result.riskSnapshot?.accountEquityAtOpen).toBe(75000);
  });

  it('canonical equity cascade: settings.startingAccountValue is the final fallback', () => {
    const accountId = seedAccount({ startingBalance: null });
    seedSettings(12345);
    const tradeId = seedTrade(accountId, { plannedStop: 99 });

    const result = executeTradeFill(fill(tradeId, { quantity: 10, price: 100 }), context);

    expect(result.riskSnapshot?.accountEquityAtOpen).toBe(12345);
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

    // Short trade accepts only sell_short / buy_to_cover.
    const shortTradeId = seedTrade(accountId, { direction: 'short', plannedStop: 105 });
    expect(() => executeTradeFill(fill(shortTradeId, { action: 'buy' }), context)).toThrow(
      ActionDirectionError,
    );
    const ok = executeTradeFill(
      fill(shortTradeId, { action: 'sell_short', price: 100 }),
      context,
    );
    expect(ok.trade.status).toBe('open');
  });
});
