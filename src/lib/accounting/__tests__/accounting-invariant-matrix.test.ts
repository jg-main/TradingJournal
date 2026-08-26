/**
 * M007-S04 — cross-cutting accounting invariant matrix.
 *
 * ONE suite that exercises ALL FOUR accounting writer paths against both
 * long and short scenarios and asserts the five shared invariants the
 * canonical economic-action boundary must hold everywhere:
 *
 *   writer path                 long                            short
 *   ──────────────────────────────────────────────────────────────────────────
 *   postExecutionFill           buy + sell                      sell_short + buy_to_cover
 *   correctExecution            buy → corrected buy             sell_short → corrected sell_short
 *   runLegacyMigration          add + reduce (long trade)       add + reduce (short trade)
 *   executeTradeFill            add (long trade)                add (short trade)
 *
 *   invariant 1 — no-alias persistence:   accounting_executions never stores
 *                 the generic management aliases 'add'/'reduce' (each writer
 *                 must resolve to a concrete economic action first).
 *   invariant 2 — cash-direction alignment: every trade_execution cash effect
 *                 matches cashDirectionForEconomicAction(action); fee events
 *                 always decrease cash.
 *   invariant 3 — long/short symmetry: equivalent long and short trades (same
 *                 symbol, quantity, price, fees) mirror each other's cash.
 *   invariant 4 — correction net economics: original + reversal cancel exactly;
 *                 (original + reversal + replacement) net equals replacement
 *                 alone.
 *   invariant 5 — activity-ledger agreement: the activity projection's signed
 *                 cash-event sum equals computeAccountCashImpact net AND the
 *                 buildLedgerProjection cash-impact sum for the same account.
 *
 * Each describe block owns its own database + accounts so the four writer
 * paths cannot contaminate each other, and every invariant assertion names
 * the writer path, direction, and scenario so a divergence localizes
 * immediately.
 *
 * Run: npx vitest run src/lib/accounting/__tests__/accounting-invariant-matrix.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';

import { createTestDatabase } from '@/lib/testing/test-db';
import type { TestDatabaseContext } from '@/lib/testing/test-db';
import {
  postExecutionFill,
  executionFinancialEventIdempotencyKey,
  executionFeeFinancialEventIdempotencyKey,
} from '../execution-posting';
import { correctExecution } from '../correction';
import { runLegacyMigration } from '../legacy-migration-runner';
import { executeTradeFill, type ExecuteTradeFillInput } from '../../trade-execution-engine';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '@/db/schema';
import {
  computeAccountActivity,
  computeAccountCashImpact,
} from '../activity';
import { buildLedgerProjection } from '../ledger';
import type {
  LedgerEntryInput,
  LedgerPostingInput,
} from '../ledger';
import { resolveFinancialEventCorrectionGroupsForAccount } from '../ledger-route-helpers';
import {
  cashDirectionForEconomicAction,
  ECONOMIC_ACTIONS,
  type EconomicAction,
} from '../economic-action';
import { toMicros } from '../decimal';
import {
  listAccountEvents,
  findPostingsByEntryId,
} from '@/db/accounting-repository';
import type { FinancialEventWithStatusRow } from '@/db/accounting-repository';
import type { AccountingExecutionRow } from '@/db/accounting-repository';

// ── Micros arithmetic helpers ────────────────────────────────────────────

const MICROS_PER_UNIT = 1_000_000;

/** Signed micros for a cash effect: increase is positive, decrease negative. */
function signedMicros(amountMicros: number, direction: string): number {
  return direction === 'increase' ? amountMicros : -amountMicros;
}

// ── Seeding helpers ──────────────────────────────────────────────────────

function insertAccount(sqlite: TestDatabaseContext['sqlite'], name: string): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
       VALUES (?, ?, 'Test Broker', 'USD', 1, ?, ?)`,
    )
    .run(id, name, now, now);
  return id;
}

function insertTrade(
  sqlite: TestDatabaseContext['sqlite'],
  accountId: string,
  symbol: string,
  direction: 'long' | 'short',
): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO trades (id, trade_code, account_id, symbol, direction, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'open', ?, ?)`,
    )
    .run(id, `T-${id.slice(0, 8)}`, accountId, symbol, direction, now, now);
  return id;
}

/** Insert a legacy trade_executions row (mirrors the journal domain table). */
function insertLegacyExecution(
  sqlite: TestDatabaseContext['sqlite'],
  tradeId: string,
  action: string,
  quantity: number,
  price: number,
  fees: number,
  executedAt: string,
): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO trade_executions (id, trade_id, executed_at, action, quantity, price, fees, reason_id, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
    )
    .run(id, tradeId, executedAt, action, quantity, price, fees, now);
  return id;
}

// ── Invariant helpers ────────────────────────────────────────────────────

/**
 * Invariant 1: no management alias ('add'/'reduce') may persist in the
 * canonical accounting_executions table for the account.
 */
function expectNoAliasPersistence(
  sqlite: TestDatabaseContext['sqlite'],
  accountId: string,
  label: string,
): void {
  const row = sqlite
    .prepare(
      `SELECT COUNT(*) AS count FROM accounting_executions
       WHERE account_id = ? AND action IN ('add', 'reduce')`,
    )
    .get(accountId) as { count: number };
  expect(row.count, `${label}: no add/reduce alias rows persist`).toBe(0);
}

/**
 * Invariant 2: every trade_execution event's cash direction matches its
 * concrete economic action; every fee event decreases cash.
 */
function expectCashDirectionAlignment(
  sqlite: TestDatabaseContext['sqlite'],
  accountId: string,
  label: string,
): void {
  const activity = computeAccountActivity(sqlite, accountId);
  const tradeEvents = activity.events.filter((e) => e.eventType === 'trade_execution');
  expect(tradeEvents.length, `${label}: at least one trade execution event`).toBeGreaterThan(0);

  for (const evt of tradeEvents) {
    const action = (evt.payload as { action?: unknown } | null)?.action;
    expect(
      typeof action === 'string' && (ECONOMIC_ACTIONS as readonly string[]).includes(action),
      `${label}: event ${evt.eventId} carries a concrete economic action (got ${String(action)})`,
    ).toBe(true);
    const effect = evt.effect;
    expect(effect?.kind, `${label}: trade event has a cash effect`).toBe('cash');
    if (effect?.kind === 'cash') {
      expect(effect.direction, `${label}: ${String(action)} cash direction`).toBe(
        cashDirectionForEconomicAction(action as EconomicAction),
      );
    }
  }

  for (const evt of activity.events) {
    if (evt.eventType !== 'fee') continue;
    const effect = evt.effect;
    expect(effect?.kind, `${label}: fee event has a cash effect`).toBe('cash');
    if (effect?.kind === 'cash') {
      expect(effect.direction, `${label}: fee events always decrease cash`).toBe('decrease');
    }
  }
}

/**
 * Signed cash sum over the activity projection's cash events.
 */
function activityCashSumMicros(
  sqlite: TestDatabaseContext['sqlite'],
  accountId: string,
): number {
  const activity = computeAccountActivity(sqlite, accountId);
  let sum = 0;
  for (const evt of activity.events) {
    const effect = evt.effect;
    if (!effect || effect.kind !== 'cash') continue;
    sum += signedMicros(effect.amountMicros, effect.direction);
  }
  return sum;
}

/**
 * Signed cash sum over the ledger projection's displayed rows.
 *
 * Composes the exact repository-shaped input the ledger route builds
 * (listAccountEvents + ledger entries + postings + correction groups).
 */
function ledgerCashSumMicros(
  sqlite: TestDatabaseContext['sqlite'],
  accountId: string,
): number {
  const eventRows = listAccountEvents(sqlite, accountId) as FinancialEventWithStatusRow[];

  const entries: LedgerEntryInput[] = [];
  const postings: LedgerPostingInput[] = [];

  for (const row of eventRows) {
    if (!row.entry_id) continue;
    if (!entries.some((e) => e.id === row.entry_id)) {
      entries.push({
        id: row.entry_id,
        financial_event_id: row.id,
        account_id: row.account_id,
        description: row.description,
        posted_at: row.posted_at,
        created_at: row.created_at,
      });
    }
    for (const pr of findPostingsByEntryId(sqlite, row.entry_id)) {
      if (!postings.some((p) => p.id === pr.id)) {
        postings.push({
          id: pr.id,
          ledger_entry_id: pr.ledger_entry_id,
          account_id: pr.account_id,
          side: pr.side,
          amount: pr.amount,
          amount_micros: pr.amount_micros,
          currency: pr.currency,
          sequence: pr.sequence,
          created_at: pr.created_at,
        });
      }
    }
  }

  const correctionGroups = resolveFinancialEventCorrectionGroupsForAccount(sqlite, accountId);
  const projection = buildLedgerProjection({ events: eventRows, entries, postings, correctionGroups });

  let net = 0;
  for (const row of projection.events) {
    if (row.cashImpact === null) continue;
    // buildLedgerProjection renders decrease as "-<amount>" and increase as "<amount>".
    net += toMicros(row.cashImpact);
  }
  return net;
}

/**
 * Invariant 5: activity event sum, computeAccountCashImpact net, and the
 * ledger projection's cash-impact sum must all agree for the account.
 */
function expectActivityLedgerAgreement(
  sqlite: TestDatabaseContext['sqlite'],
  accountId: string,
  label: string,
): void {
  const cash = computeAccountCashImpact(sqlite, accountId);
  const activitySum = activityCashSumMicros(sqlite, accountId);
  const ledgerSum = ledgerCashSumMicros(sqlite, accountId);

  expect(activitySum, `${label}: activity event sum matches cash summary`).toBe(
    cash.netCashImpactMicros,
  );
  expect(ledgerSum, `${label}: ledger projection agrees with activity net`).toBe(
    cash.netCashImpactMicros,
  );
}

/**
 * The trade_execution financial event for an accounting execution, resolved
 * through its deterministic idempotency key (works for postExecutionFill
 * originals and correction reversal/replacement events alike).
 */
function executionTradeEvent(
  sqlite: TestDatabaseContext['sqlite'],
  executionId: string,
): { eventId: string; direction: string; amountMicros: number } | null {
  const row = sqlite
    .prepare(
      `SELECT id, effect FROM financial_events WHERE idempotency_key = ?`,
    )
    .get(executionFinancialEventIdempotencyKey(executionId)) as
    | { id: string; effect: string }
    | undefined;
  if (!row) return null;
  const effect = JSON.parse(row.effect) as { direction: string; amountMicros: number };
  return { eventId: row.id, direction: effect.direction, amountMicros: effect.amountMicros };
}

/** Execution fee cash event for an accounting execution (or null). */
function executionFeeEvent(
  sqlite: TestDatabaseContext['sqlite'],
  executionId: string,
): { eventId: string; direction: string; amountMicros: number } | null {
  const row = sqlite
    .prepare(
      `SELECT id, effect FROM financial_events WHERE idempotency_key = ?`,
    )
    .get(executionFeeFinancialEventIdempotencyKey(executionId)) as
    | { id: string; effect: string }
    | undefined;
  if (!row) return null;
  const effect = JSON.parse(row.effect) as { direction: string; amountMicros: number };
  return { eventId: row.id, direction: effect.direction, amountMicros: effect.amountMicros };
}

/** Account net cash (trade + fee events) in micros. */
function accountNetMicros(
  sqlite: TestDatabaseContext['sqlite'],
  accountId: string,
): number {
  return computeAccountCashImpact(sqlite, accountId).netCashImpactMicros;
}

// ═══════════════════════════════════════════════════════════════════════════
// Writer path 1 — canonical posting (postExecutionFill)
// ═══════════════════════════════════════════════════════════════════════════

describe('accounting invariant matrix — canonical posting (postExecutionFill)', () => {
  let ctx: TestDatabaseContext;
  let longAccount: string;
  let shortAccount: string;
  let symLongAccount: string;
  let symShortAccount: string;

  beforeAll(() => {
    ctx = createTestDatabase({ migrations: true });
    const sqlite = ctx.sqlite;

    // Full round-trip scenario accounts.
    longAccount = insertAccount(sqlite, 'posting-long');
    const longTrade = insertTrade(sqlite, longAccount, 'AAPL', 'long');
    postExecutionFill(sqlite, {
      accountId: longAccount,
      symbol: 'AAPL',
      action: 'buy',
      quantity: '100.00',
      price: '50.00',
      fees: '1.00',
      journalTradeId: longTrade,
    });
    postExecutionFill(sqlite, {
      accountId: longAccount,
      symbol: 'AAPL',
      action: 'sell',
      quantity: '100.00',
      price: '55.00',
      fees: '1.00',
      journalTradeId: longTrade,
    });

    shortAccount = insertAccount(sqlite, 'posting-short');
    const shortTrade = insertTrade(sqlite, shortAccount, 'AAPL', 'short');
    postExecutionFill(sqlite, {
      accountId: shortAccount,
      symbol: 'AAPL',
      action: 'sell_short',
      quantity: '100.00',
      price: '50.00',
      fees: '1.00',
      journalTradeId: shortTrade,
    });
    postExecutionFill(sqlite, {
      accountId: shortAccount,
      symbol: 'AAPL',
      action: 'buy_to_cover',
      quantity: '100.00',
      price: '45.00',
      fees: '1.00',
      journalTradeId: shortTrade,
    });

    // Symmetry accounts: one equivalent fill each (same symbol/qty/price/fees).
    symLongAccount = insertAccount(sqlite, 'posting-sym-long');
    postExecutionFill(sqlite, {
      accountId: symLongAccount,
      symbol: 'AAPL',
      action: 'buy',
      quantity: '100.00',
      price: '50.00',
      fees: '1.00',
    });
    symShortAccount = insertAccount(sqlite, 'posting-sym-short');
    postExecutionFill(sqlite, {
      accountId: symShortAccount,
      symbol: 'AAPL',
      action: 'sell_short',
      quantity: '100.00',
      price: '50.00',
      fees: '1.00',
    });
  });

  afterAll(() => {
    ctx.dispose();
  });

  it('invariant 1: canonical posting never persists add/reduce aliases (long + short)', () => {
    expectNoAliasPersistence(ctx.sqlite, longAccount, 'posting long round trip');
    expectNoAliasPersistence(ctx.sqlite, shortAccount, 'posting short round trip');
  });

  it('invariant 2: every posting cash direction matches the economic action (long + short)', () => {
    expectCashDirectionAlignment(ctx.sqlite, longAccount, 'posting long round trip');
    expectCashDirectionAlignment(ctx.sqlite, shortAccount, 'posting short round trip');
  });

  it('invariant 3: long buy and short sell_short mirror each other (qty×price ± fees)', () => {
    // Equivalent fills: buy vs sell_short, 100 @ 50.00, fees 1.00 each.
    const longTradeEvent = executionTradeEvent(ctx.sqlite, (
      ctx.sqlite.prepare('SELECT id FROM accounting_executions WHERE account_id = ? ORDER BY posted_at ASC LIMIT 1').get(symLongAccount) as { id: string }
    ).id)!;
    const shortTradeEvent = executionTradeEvent(ctx.sqlite, (
      ctx.sqlite.prepare('SELECT id FROM accounting_executions WHERE account_id = ? ORDER BY posted_at ASC LIMIT 1').get(symShortAccount) as { id: string }
    ).id)!;

    // Trade consideration mirrors exactly: -qty×price vs +qty×price.
    expect(signedMicros(longTradeEvent.amountMicros, longTradeEvent.direction)).toBe(
      -100 * 50 * MICROS_PER_UNIT,
    );
    expect(signedMicros(shortTradeEvent.amountMicros, shortTradeEvent.direction)).toBe(
      100 * 50 * MICROS_PER_UNIT,
    );
    expect(signedMicros(longTradeEvent.amountMicros, longTradeEvent.direction)).toBe(
      -signedMicros(shortTradeEvent.amountMicros, shortTradeEvent.direction),
    );

    // Account net (trade + fee): long buy = -(qty×price) - fees, short sell_short = +(qty×price) - fees.
    const longNet = accountNetMicros(ctx.sqlite, symLongAccount);
    const shortNet = accountNetMicros(ctx.sqlite, symShortAccount);
    expect(longNet).toBe(-100 * 50 * MICROS_PER_UNIT - MICROS_PER_UNIT);
    expect(shortNet).toBe(100 * 50 * MICROS_PER_UNIT - MICROS_PER_UNIT);
    expect(longNet + shortNet).toBe(-2 * MICROS_PER_UNIT);

    // Fee events exist for both fills and always decrease cash by the fee amount.
    const longFee = executionFeeEvent(ctx.sqlite, (
      ctx.sqlite.prepare('SELECT id FROM accounting_executions WHERE account_id = ? ORDER BY posted_at ASC LIMIT 1').get(symLongAccount) as { id: string }
    ).id)!;
    const shortFee = executionFeeEvent(ctx.sqlite, (
      ctx.sqlite.prepare('SELECT id FROM accounting_executions WHERE account_id = ? ORDER BY posted_at ASC LIMIT 1').get(symShortAccount) as { id: string }
    ).id)!;
    expect(signedMicros(longFee.amountMicros, longFee.direction)).toBe(-MICROS_PER_UNIT);
    expect(signedMicros(shortFee.amountMicros, shortFee.direction)).toBe(-MICROS_PER_UNIT);
  });

  it('invariant 5: activity and ledger agree with the cash summary (long + short)', () => {
    expectActivityLedgerAgreement(ctx.sqlite, longAccount, 'posting long round trip');
    expectActivityLedgerAgreement(ctx.sqlite, shortAccount, 'posting short round trip');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Writer path 2 — execution correction (correctExecution)
// ═══════════════════════════════════════════════════════════════════════════

describe('accounting invariant matrix — execution correction (correctExecution)', () => {
  let ctx: TestDatabaseContext;
  let longAccount: string;
  let shortAccount: string;
  let longOriginal: AccountingExecutionRow;
  let shortOriginal: AccountingExecutionRow;
  let longReplacement: AccountingExecutionRow;
  let shortReplacement: AccountingExecutionRow;
  let longReversal: AccountingExecutionRow;
  let shortReversal: AccountingExecutionRow;

  beforeAll(() => {
    ctx = createTestDatabase({ migrations: true });
    const sqlite = ctx.sqlite;

    // Long: original buy 100 @ 50.00 fees 1.00 → corrected buy 100 @ 48.00 fees 1.00.
    longAccount = insertAccount(sqlite, 'correction-long');
    const longFill = postExecutionFill(sqlite, {
      accountId: longAccount,
      symbol: 'AAPL',
      action: 'buy',
      quantity: '100.00',
      price: '50.00',
      fees: '1.00',
    });
    const longCorrection = correctExecution(sqlite, {
      accountId: longAccount,
      originalExecutionId: longFill.execution.id,
      symbol: 'AAPL',
      action: 'buy',
      quantity: '100.00',
      price: '48.00',
      fees: '1.00',
      reason: 'invariant-matrix long correction',
    });
    longOriginal = longFill.execution as unknown as AccountingExecutionRow;
    longReversal = longCorrection.reversalExecution as unknown as AccountingExecutionRow;
    longReplacement = longCorrection.replacementExecution as unknown as AccountingExecutionRow;

    // Short: original sell_short 100 @ 50.00 fees 1.00 → corrected sell_short 100 @ 52.00 fees 1.00.
    shortAccount = insertAccount(sqlite, 'correction-short');
    const shortFill = postExecutionFill(sqlite, {
      accountId: shortAccount,
      symbol: 'AAPL',
      action: 'sell_short',
      quantity: '100.00',
      price: '50.00',
      fees: '1.00',
    });
    const shortCorrection = correctExecution(sqlite, {
      accountId: shortAccount,
      originalExecutionId: shortFill.execution.id,
      symbol: 'AAPL',
      action: 'sell_short',
      quantity: '100.00',
      price: '52.00',
      fees: '1.00',
      reason: 'invariant-matrix short correction',
    });
    shortOriginal = shortFill.execution as unknown as AccountingExecutionRow;
    shortReversal = shortCorrection.reversalExecution as unknown as AccountingExecutionRow;
    shortReplacement = shortCorrection.replacementExecution as unknown as AccountingExecutionRow;
  });

  afterAll(() => {
    ctx.dispose();
  });

  it('invariant 1: correction reversal + replacement never persist add/reduce aliases', () => {
    expectNoAliasPersistence(ctx.sqlite, longAccount, 'correction long');
    expectNoAliasPersistence(ctx.sqlite, shortAccount, 'correction short');
  });

  it('invariant 2: original, reversal, and replacement cash directions stay canonical', () => {
    expectCashDirectionAlignment(ctx.sqlite, longAccount, 'correction long');
    expectCashDirectionAlignment(ctx.sqlite, shortAccount, 'correction short');
  });

  it('invariant 4: original + reversal cancel exactly and the three-event net equals the replacement', () => {
    for (const [label, original, reversal, replacement] of [
      ['long buy→corrected buy', longOriginal, longReversal, longReplacement],
      ['short sell_short→corrected sell_short', shortOriginal, shortReversal, shortReplacement],
    ] as const) {
      const orig = executionTradeEvent(ctx.sqlite, original.id)!;
      const rev = executionTradeEvent(ctx.sqlite, reversal.id)!;
      const rep = executionTradeEvent(ctx.sqlite, replacement.id)!;

      const origNet = signedMicros(orig.amountMicros, orig.direction);
      const revNet = signedMicros(rev.amountMicros, rev.direction);
      const repNet = signedMicros(rep.amountMicros, rep.direction);

      expect(origNet + revNet, `${label}: original and reversal cancel exactly`).toBe(0);
      expect(
        origNet + revNet + repNet,
        `${label}: original+reversal+replacement net equals replacement alone`,
      ).toBe(repNet);
    }
  });

  it('invariant 5: activity and ledger agree with the cash summary after correction', () => {
    expectActivityLedgerAgreement(ctx.sqlite, longAccount, 'correction long');
    expectActivityLedgerAgreement(ctx.sqlite, shortAccount, 'correction short');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Writer path 3 — legacy migration (runLegacyMigration)
// ═══════════════════════════════════════════════════════════════════════════

describe('accounting invariant matrix — legacy migration (runLegacyMigration)', () => {
  let ctx: TestDatabaseContext;
  let longAccount: string;
  let shortAccount: string;
  let symLongAccount: string;
  let symShortAccount: string;

  beforeAll(() => {
    ctx = createTestDatabase({ migrations: true });
    const sqlite = ctx.sqlite;

    // Long trade: add 100 @ 50.00, reduce 50 @ 55.00 → buy / sell.
    longAccount = insertAccount(sqlite, 'migration-long');
    const longTrade = insertTrade(sqlite, longAccount, 'MSFT', 'long');
    insertLegacyExecution(sqlite, longTrade, 'add', 100, 50.0, 0, '2024-01-16T09:30:00.000Z');
    insertLegacyExecution(sqlite, longTrade, 'reduce', 50, 55.0, 0, '2024-01-17T09:30:00.000Z');
    const longRun = runLegacyMigration({ sqlite, accountId: longAccount });
    expect(longRun.status).toBe('completed');
    expect(longRun.mappedCount).toBe(2);

    // Short trade: add 100 @ 50.00, reduce 50 @ 45.00 → sell_short / buy_to_cover.
    shortAccount = insertAccount(sqlite, 'migration-short');
    const shortTrade = insertTrade(sqlite, shortAccount, 'MSFT', 'short');
    insertLegacyExecution(sqlite, shortTrade, 'add', 100, 50.0, 0, '2024-01-16T09:30:00.000Z');
    insertLegacyExecution(sqlite, shortTrade, 'reduce', 50, 45.0, 0, '2024-01-17T09:30:00.000Z');
    const shortRun = runLegacyMigration({ sqlite, accountId: shortAccount });
    expect(shortRun.status).toBe('completed');
    expect(shortRun.mappedCount).toBe(2);

    // Symmetry accounts: one equivalent add each (100 @ 50.00, no fees).
    symLongAccount = insertAccount(sqlite, 'migration-sym-long');
    const symLongTrade = insertTrade(sqlite, symLongAccount, 'MSFT', 'long');
    insertLegacyExecution(sqlite, symLongTrade, 'add', 100, 50.0, 0, '2024-01-16T09:30:00.000Z');
    expect(runLegacyMigration({ sqlite, accountId: symLongAccount }).status).toBe('completed');

    symShortAccount = insertAccount(sqlite, 'migration-sym-short');
    const symShortTrade = insertTrade(sqlite, symShortAccount, 'MSFT', 'short');
    insertLegacyExecution(sqlite, symShortTrade, 'add', 100, 50.0, 0, '2024-01-16T09:30:00.000Z');
    expect(runLegacyMigration({ sqlite, accountId: symShortAccount }).status).toBe('completed');
  });

  afterAll(() => {
    ctx.dispose();
  });

  it('invariant 1: migration resolves add/reduce and never persists aliases', () => {
    expectNoAliasPersistence(ctx.sqlite, longAccount, 'migration long');
    expectNoAliasPersistence(ctx.sqlite, shortAccount, 'migration short');
  });

  it('invariant 2: migrated executions carry concrete actions with aligned cash direction', () => {
    expectCashDirectionAlignment(ctx.sqlite, longAccount, 'migration long');
    expectCashDirectionAlignment(ctx.sqlite, shortAccount, 'migration short');
  });

  it('invariant 3: migrated long add and short add mirror each other (same qty/price)', () => {
    // Legacy fees do not create cash events on the migration writer, so the
    // account net equals the trade consideration alone.
    const longNet = accountNetMicros(ctx.sqlite, symLongAccount);
    const shortNet = accountNetMicros(ctx.sqlite, symShortAccount);
    expect(longNet).toBe(-100 * 50 * MICROS_PER_UNIT);
    expect(shortNet).toBe(100 * 50 * MICROS_PER_UNIT);
    expect(longNet).toBe(-shortNet);
  });

  it('invariant 5: activity and ledger agree with the cash summary after migration', () => {
    expectActivityLedgerAgreement(ctx.sqlite, longAccount, 'migration long');
    expectActivityLedgerAgreement(ctx.sqlite, shortAccount, 'migration short');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Writer path 4 — canonical execution engine (executeTradeFill)
// ═══════════════════════════════════════════════════════════════════════════
// D6: the obsolete fail-open journal→accounting sync writer was retired. The canonical writer for new fills is executeTradeFill, which
// persists the journal execution, trade lifecycle, risk snapshot, accounting
// execution, ledger effects, FIFO positions, and account performance inside
// one atomic transaction. This block proves that path satisfies the same five
// invariants (D1 economic-action boundary) for long and short.

describe('accounting invariant matrix — canonical execution engine (executeTradeFill)', () => {
  let ctx: TestDatabaseContext;
  let longAccount: string;
  let shortAccount: string;

  beforeAll(() => {
    ctx = createTestDatabase({ migrations: true });
    const sqlite = ctx.sqlite;
    const db = drizzle(sqlite, { schema });
    const context = { db, sqlite };
    const now = new Date().toISOString();

    // Global settings row (single-row convention): equity + max-risk defaults.
    sqlite
      .prepare(
        `INSERT OR REPLACE INTO settings (id, starting_account_value, max_risk_per_trade_pct, default_commission)
         VALUES ('default', 100000, 10, 1)`,
      )
      .run();

    // Long trade: add 100 @ 50.00 fees 1.00 → resolved to buy (cash down).
    longAccount = insertAccount(sqlite, 'engine-long');
    const longTradeId = insertTrade(sqlite, longAccount, 'NVDA', 'long');
    sqlite
      .prepare(`UPDATE trades SET planned_stop = 45 WHERE id = ?`)
      .run(longTradeId);
    executeTradeFill(
      {
        tradeId: longTradeId,
        action: 'add',
        quantity: 100,
        price: 50.0,
        fees: 1.0,
        executedAt: '2024-02-01T09:30:00.000Z',
        idempotencyKey: 'invariant-engine-long-' + now,
      } as ExecuteTradeFillInput,
      context,
    );

    // Short trade: add 100 @ 50.00 fees 1.00 → resolved to sell_short (cash up).
    shortAccount = insertAccount(sqlite, 'engine-short');
    const shortTradeId = insertTrade(sqlite, shortAccount, 'NVDA', 'short');
    sqlite
      .prepare(`UPDATE trades SET planned_stop = 55 WHERE id = ?`)
      .run(shortTradeId);
    executeTradeFill(
      {
        tradeId: shortTradeId,
        action: 'add',
        quantity: 100,
        price: 50.0,
        fees: 1.0,
        executedAt: '2024-02-01T09:30:00.000Z',
        idempotencyKey: 'invariant-engine-short-' + now,
      } as ExecuteTradeFillInput,
      context,
    );
  });

  afterAll(() => {
    ctx.dispose();
  });

  it('invariant 1: executeTradeFill resolves add through trade direction and never persists aliases', () => {
    expectNoAliasPersistence(ctx.sqlite, longAccount, 'engine long');
    expectNoAliasPersistence(ctx.sqlite, shortAccount, 'engine short');
  });

  it('invariant 2: executed fills carry concrete actions with aligned cash direction', () => {
    expectCashDirectionAlignment(ctx.sqlite, longAccount, 'engine long');
    expectCashDirectionAlignment(ctx.sqlite, shortAccount, 'engine short');
  });

  it('invariant 3: engine long add and short add mirror each other (qty×price ± fees)', () => {
    const longNet = accountNetMicros(ctx.sqlite, longAccount);
    const shortNet = accountNetMicros(ctx.sqlite, shortAccount);
    expect(longNet).toBe(-100 * 50 * MICROS_PER_UNIT - MICROS_PER_UNIT);
    expect(shortNet).toBe(100 * 50 * MICROS_PER_UNIT - MICROS_PER_UNIT);
    expect(longNet + shortNet).toBe(-2 * MICROS_PER_UNIT);
  });

  it('invariant 5: activity and ledger agree with the cash summary after executeTradeFill', () => {
    expectActivityLedgerAgreement(ctx.sqlite, longAccount, 'engine long');
    expectActivityLedgerAgreement(ctx.sqlite, shortAccount, 'engine short');
  });
});

