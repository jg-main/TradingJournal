/**
 * repair-alias-executions.test.ts
 *
 * M007-S07 — integration test for the canonical-data alias audit + repair
 * path (T01 service, T02 audit script, T03 this suite).
 *
 * The suite plants PRE-FIX data directly via SQL: accounting_executions rows
 * still carrying the workflow aliases `add` / `reduce` (bypassing the writer
 * boundary, which now resolves aliases), each with a matching legacy
 * financial event + ledger entry + balanced postings. It then proves:
 *
 *   1. findAliasExecutions detects exactly the planted alias rows (and no
 *      concrete-action rows).
 *   2. repairAliasExecutions resolves LONG add → buy / reduce → sell and
 *      writes reversal + replacement + correction_lineage, keeping the
 *      immutable originals untouched.
 *   3. repairAliasExecutions resolves SHORT add → sell_short / reduce →
 *      buy_to_cover symmetrically.
 *   4. Unresolvable rows (no journal_trade_id) are reported as anomalies and
 *      never guessed or repaired.
 *   5. Repair is idempotent: a second run repairs zero rows and writes zero
 *      new events/entries/lineage.
 *   6. dryRun reports the plan with null ids and mutates nothing.
 *   7. Post-repair the audit surface is empty (zero un-repaired alias rows —
 *      the effective S07 invariant, since migration 0026 immutability forbids
 *      DELETE of the superseded originals).
 *   8. Every repair-written trade_execution event stores a concrete action
 *      whose cash direction matches cashDirectionForEconomicAction; the
 *      planted alias events remain untouched (immutable legacy audit trail).
 *   9. Activity projection, computeAccountCashImpact net, and the ledger
 *      projection all agree after repair.
 *  10. FIFO account_positions and fifo_lots rebuild correctly (long and
 *      short), with the replacement execution as the opening lot.
 *  11. Fail-closed: an inconsistent stream (reduce before add) whose
 *      replacement is rejected by the FIFO allocator rolls back that row
 *      atomically and throws naming the failing execution — never commits a
 *      broken projection.
 *
 * The planted legacy events use the post-A5 concrete-side cash directions
 * (long add → decrease, long reduce → increase, short add → increase,
 * short reduce → decrease) — the realistic state of data created after the
 * A5 cash-direction repair and before S01/S02 closed the alias writer
 * boundary, which is exactly the population S07 targets. Test 8 therefore
 * scopes the direction check to concrete-action events (the repair-written
 * surface); the original alias events are asserted as untouched instead,
 * mirroring the accounting-invariant-matrix contract that alias rows never
 * carry canonical cash classification.
 *
 * Run: npx vitest run src/lib/accounting/__tests__/repair-alias-executions.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';

import { createTestDatabase } from '@/lib/testing/test-db';
import type { TestDatabaseContext } from '@/lib/testing/test-db';
import {
  findAliasExecutions,
  repairAliasExecutions,
  type AliasRepairResult,
} from '../repair-alias-executions';
import {
  cashDirectionForEconomicAction,
  ECONOMIC_ACTIONS,
  isGenericManagementAction,
  resolveEconomicExecutionAction,
  type EconomicAction,
  type PositionDirection,
} from '../economic-action';
import { reverseAction } from '../correction-contracts';
import { postFinancialEvent } from '../posting';
import { executionFinancialEventIdempotencyKey } from '../execution-posting';
import { computeAccountActivity, computeAccountCashImpact } from '../activity';
import { buildLedgerProjection } from '../ledger';
import type { LedgerEntryInput, LedgerPostingInput } from '../ledger';
import { resolveFinancialEventCorrectionGroupsForAccount } from '../ledger-route-helpers';
import { toMicros, fromMicros } from '../decimal';
import {
  listAccountEvents,
  findPostingsByEntryId,
  findAccountingExecutionById,
  findAccountPosition,
  findFifoLotsByAccountInstrument,
  findCorrectionByOriginalExecution,
} from '@/db/accounting-repository';
import type { FinancialEventWithStatusRow } from '@/db/accounting-repository';

// ── Shared scenario constants ────────────────────────────────────────────

const MICROS_PER_UNIT = 1_000_000;
const ADD_POSTED_AT = '2024-01-16T09:30:00.000Z';
const REDUCE_POSTED_AT = '2024-01-17T09:30:00.000Z';
const ORPHAN_POSTED_AT = '2024-02-01T09:30:00.000Z';
const SYMBOL = 'AAPL';

const now = () => new Date().toISOString();

// ── Seeding helpers ──────────────────────────────────────────────────────

function seedAccount(sqlite: TestDatabaseContext['sqlite'], name: string): string {
  const id = randomUUID();
  sqlite
    .prepare(
      `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
       VALUES (?, ?, 'Test Broker', 'USD', 1, ?, ?)`,
    )
    .run(id, name, now(), now());
  return id;
}

function seedInstrument(sqlite: TestDatabaseContext['sqlite'], symbol: string): string {
  const existing = sqlite
    .prepare('SELECT id FROM instruments WHERE symbol = ?')
    .get(symbol) as { id: string } | undefined;
  if (existing) return existing.id;
  const id = randomUUID();
  sqlite
    .prepare('INSERT INTO instruments (id, symbol, name) VALUES (?, ?, ?)')
    .run(id, symbol, symbol);
  return id;
}

function seedTrade(
  sqlite: TestDatabaseContext['sqlite'],
  accountId: string,
  symbol: string,
  direction: PositionDirection,
): string {
  const id = randomUUID();
  sqlite
    .prepare(
      `INSERT INTO trades (id, trade_code, account_id, symbol, direction, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'open', ?, ?)`,
    )
    .run(id, `T-${id.slice(0, 8)}`, accountId, symbol, direction, now(), now());
  return id;
}

/**
 * Insert an alias accounting_executions row DIRECTLY via SQL, bypassing the
 * writer boundary (which now resolves aliases) — simulating pre-fix data.
 */
function insertAliasExecution(
  sqlite: TestDatabaseContext['sqlite'],
  values: {
    accountId: string;
    tradeId: string | null;
    instrumentId: string;
    action: 'add' | 'reduce';
    quantity: string;
    price: string;
    postedAt: string;
  },
): string {
  const id = randomUUID();
  sqlite
    .prepare(
      `INSERT INTO accounting_executions
         (id, account_id, instrument_id, action, quantity, price, fees,
          idempotency_key, journal_trade_id, description, posted_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, '0.00', NULL, ?, ?, ?, ?)`,
    )
    .run(
      id,
      values.accountId,
      values.instrumentId,
      values.action,
      values.quantity,
      values.price,
      values.tradeId,
      `Legacy ${values.action} ${values.quantity}`,
      values.postedAt,
      now(),
    );
  return id;
}

/** Gross consideration (quantity × price) in micros — mirrors the repair arithmetic. */
function considerationMicros(quantity: string, price: string): number {
  return Number(
    (BigInt(toMicros(quantity)) * BigInt(toMicros(price))) / BigInt(1_000_000),
  );
}

/**
 * Cash direction the post-A5 legacy writer stored for an alias action on a
 * trade with the given direction (i.e. the direction of the resolved
 * concrete economic action — realistic pre-fix, post-A5 data).
 */
function legacyAliasCashDirection(
  action: 'add' | 'reduce',
  direction: PositionDirection,
): 'increase' | 'decrease' {
  return cashDirectionForEconomicAction(resolveEconomicExecutionAction(action, direction));
}

/**
 * Plant the pre-existing financial event + ledger entry + balanced postings
 * for an alias execution via the canonical posting service (the same shape
 * the legacy writer produced), keyed by the execution's deterministic
 * idempotency key so the activity projection can resolve its direction.
 */
function plantAliasEvent(
  sqlite: TestDatabaseContext['sqlite'],
  values: {
    accountId: string;
    executionId: string;
    action: 'add' | 'reduce';
    symbol: string;
    quantity: string;
    price: string;
    tradeDirection: PositionDirection;
    postedAt: string;
  },
): void {
  const amountMicros = considerationMicros(values.quantity, values.price);
  const direction = legacyAliasCashDirection(values.action, values.tradeDirection);
  postFinancialEvent(sqlite, {
    accountId: values.accountId,
    eventType: 'trade_execution',
    amount: fromMicros(amountMicros),
    idempotencyKey: executionFinancialEventIdempotencyKey(values.executionId),
    description: `Legacy ${values.action} ${values.quantity} ${values.symbol}`,
    payload: JSON.stringify({
      action: values.action,
      symbol: values.symbol,
      quantity: values.quantity,
      price: values.price,
      fees: '0.00',
    }),
    effect: JSON.stringify({
      kind: 'cash',
      direction,
      amount: fromMicros(amountMicros),
      amountMicros,
    }),
    postedAt: values.postedAt,
  });
}

interface RepairScenario {
  accountId: string;
  tradeId: string;
  instrumentId: string;
  addExecutionId: string;
  reduceExecutionId: string;
}

/**
 * Seed one account with the full pre-fix alias dataset: add 100 @ 50.00 +
 * reduce 50 @ 55.00 (long) or 45.00 (short), each with a matching legacy
 * financial event/entry/postings.
 */
function seedRepairScenario(
  sqlite: TestDatabaseContext['sqlite'],
  direction: PositionDirection,
): RepairScenario {
  const accountId = seedAccount(sqlite, `repair-${direction}`);
  const instrumentId = seedInstrument(sqlite, SYMBOL);
  const tradeId = seedTrade(sqlite, accountId, SYMBOL, direction);

  const addExecutionId = insertAliasExecution(sqlite, {
    accountId,
    tradeId,
    instrumentId,
    action: 'add',
    quantity: '100.00',
    price: '50.00',
    postedAt: ADD_POSTED_AT,
  });
  const reducePrice = direction === 'long' ? '55.00' : '45.00';
  const reduceExecutionId = insertAliasExecution(sqlite, {
    accountId,
    tradeId,
    instrumentId,
    action: 'reduce',
    quantity: '50.00',
    price: reducePrice,
    postedAt: REDUCE_POSTED_AT,
  });

  plantAliasEvent(sqlite, {
    accountId,
    executionId: addExecutionId,
    action: 'add',
    symbol: SYMBOL,
    quantity: '100.00',
    price: '50.00',
    tradeDirection: direction,
    postedAt: ADD_POSTED_AT,
  });
  plantAliasEvent(sqlite, {
    accountId,
    executionId: reduceExecutionId,
    action: 'reduce',
    symbol: SYMBOL,
    quantity: '50.00',
    price: reducePrice,
    tradeDirection: direction,
    postedAt: REDUCE_POSTED_AT,
  });

  return { accountId, tradeId, instrumentId, addExecutionId, reduceExecutionId };
}

// ── Invariant helpers ────────────────────────────────────────────────────

function signedMicros(amountMicros: number, direction: string): number {
  return direction === 'increase' ? amountMicros : -amountMicros;
}

/** Signed cash sum over the activity projection's cash events. */
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

/** Signed cash sum over the ledger projection's displayed rows. */
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
 * Invariant 9: activity event sum, computeAccountCashImpact net, and the
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

/** Invariant 7: the audit surface is empty (zero un-repaired alias rows). */
function expectNoUnrepairedAliasRows(
  sqlite: TestDatabaseContext['sqlite'],
  label: string,
): void {
  const remaining = findAliasExecutions(sqlite);
  expect(remaining, `${label}: findAliasExecutions returns no un-repaired alias rows`).toEqual([]);
}

/**
 * Invariant 8: every STORED trade_execution event carrying a concrete
 * economic action has effect.direction matching cashDirectionForEconomicAction.
 * The repair writes exactly 4 such events per account (2 reversals + 2
 * replacements); planted alias events are legacy and covered separately by
 * the immutability assertions in the calling test.
 */
function expectStoredCashDirectionAlignment(
  sqlite: TestDatabaseContext['sqlite'],
  accountId: string,
  label: string,
): void {
  const rows = sqlite
    .prepare(
      `SELECT id, payload, effect FROM financial_events
       WHERE account_id = ? AND event_type = 'trade_execution'`,
    )
    .all(accountId) as Array<{ id: string; payload: string | null; effect: string | null }>;

  let concreteCount = 0;
  for (const row of rows) {
    const payload = row.payload ? (JSON.parse(row.payload) as { action?: unknown }) : null;
    const action = payload?.action;
    if (typeof action !== 'string' || isGenericManagementAction(action)) continue;
    concreteCount += 1;
    expect(
      (ECONOMIC_ACTIONS as readonly string[]).includes(action),
      `${label}: event ${row.id} carries a concrete economic action (got ${action})`,
    ).toBe(true);
    const effect = row.effect ? (JSON.parse(row.effect) as { kind?: string; direction?: string }) : null;
    expect(effect?.kind, `${label}: event ${row.id} has a cash effect`).toBe('cash');
    if (effect?.kind === 'cash') {
      expect(effect.direction, `${label}: ${action} stored cash direction`).toBe(
        cashDirectionForEconomicAction(action as EconomicAction),
      );
    }
  }
  expect(concreteCount, `${label}: repair wrote concrete-action events (2 reversals + 2 replacements)`).toBe(4);
}

/** Assert a repaired detail row's reversal/replacement actions against expectations. */
function expectRepairedActions(
  ctx: TestDatabaseContext,
  detail: { originalId: string; reversalId: string | null; replacementId: string | null },
  expected: { originalAction: string; concreteAction: EconomicAction; reversalAction: string },
  label: string,
): void {
  const original = findAccountingExecutionById(ctx.sqlite, detail.originalId)!;
  const reversal = findAccountingExecutionById(ctx.sqlite, detail.reversalId!)!;
  const replacement = findAccountingExecutionById(ctx.sqlite, detail.replacementId!)!;

  expect(original.action, `${label}: original row keeps the alias action (immutable)`).toBe(
    expected.originalAction,
  );
  expect(reversal.action, `${label}: reversal action`).toBe(expected.reversalAction);
  expect(replacement.action, `${label}: replacement action`).toBe(expected.concreteAction);

  // Replacement inherits the original's account, instrument, quantity, price,
  // and journal linkage (it is the true economic fill at the original's slot).
  expect(replacement.account_id).toBe(original.account_id);
  expect(replacement.instrument_id).toBe(original.instrument_id);
  expect(replacement.quantity).toBe(original.quantity);
  expect(replacement.price).toBe(original.price);
}

/** Assert correction_lineage links original → reversal → replacement. */
function expectLineageLinksOriginal(
  ctx: TestDatabaseContext,
  detail: { originalId: string; reversalId: string | null; replacementId: string | null; lineageId: string | null },
  label: string,
): void {
  const lineage = findCorrectionByOriginalExecution(ctx.sqlite, detail.originalId);
  expect(lineage, `${label}: correction_lineage exists for original`).toBeDefined();
  expect(lineage!.original_execution_id).toBe(detail.originalId);
  expect(lineage!.reversal_execution_id).toBe(detail.reversalId);
  expect(lineage!.replacement_execution_id).toBe(detail.replacementId);
  expect(lineage!.idempotency_key).toBe(`audit-repair:${detail.originalId}`);
}

function countRows(sqlite: TestDatabaseContext['sqlite'], table: string): number {
  return (sqlite.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
}

// ═══════════════════════════════════════════════════════════════════════════
// Test 1 — findAliasExecutions detects planted alias rows
// ═══════════════════════════════════════════════════════════════════════════

describe('findAliasExecutions detects planted alias rows', () => {
  let ctx: TestDatabaseContext;
  let long: RepairScenario;
  let short: RepairScenario;
  let concreteExecutionId: string;

  beforeAll(() => {
    ctx = createTestDatabase({ migrations: true });
    long = seedRepairScenario(ctx.sqlite, 'long');
    short = seedRepairScenario(ctx.sqlite, 'short');

    // A concrete-action row must NOT appear in the audit surface.
    concreteExecutionId = randomUUID();
    ctx.sqlite
      .prepare(
        `INSERT INTO accounting_executions
           (id, account_id, instrument_id, action, quantity, price, fees,
            idempotency_key, journal_trade_id, description, posted_at, created_at)
         VALUES (?, ?, ?, 'buy', '10.00', '50.00', '0.00', NULL, NULL, 'concrete row', ?, ?)`,
      )
      .run(concreteExecutionId, long.accountId, long.instrumentId, long.tradeId, now());
  });

  afterAll(() => {
    ctx.dispose();
  });

  it('returns exactly the planted alias rows and excludes concrete-action rows', () => {
    const rows = findAliasExecutions(ctx.sqlite);

    // Deterministic stream order: all 'add' rows (2024-01-16) precede all
    // 'reduce' rows (2024-01-17).
    expect(rows.map((r) => r.action)).toEqual(['add', 'add', 'reduce', 'reduce']);

    const ids = new Set(rows.map((r) => r.id));
    expect(ids).toEqual(
      new Set([
        long.addExecutionId,
        long.reduceExecutionId,
        short.addExecutionId,
        short.reduceExecutionId,
      ]),
    );

    // No concrete-action rows leak into the audit surface.
    expect(ids.has(concreteExecutionId)).toBe(false);
    expect(rows.every((r) => r.action === 'add' || r.action === 'reduce')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Test 2 — LONG add → buy, LONG reduce → sell
// ═══════════════════════════════════════════════════════════════════════════

describe('repairAliasExecutions resolves LONG add → buy and LONG reduce → sell', () => {
  let ctx: TestDatabaseContext;
  let scenario: RepairScenario;
  let result: AliasRepairResult;

  beforeAll(() => {
    ctx = createTestDatabase({ migrations: true });
    scenario = seedRepairScenario(ctx.sqlite, 'long');
    result = repairAliasExecutions(ctx.sqlite);
  });

  afterAll(() => {
    ctx.dispose();
  });

  it('repairs both planted alias rows (scanned 2, repaired 2, no anomalies)', () => {
    expect(result.scanned).toBe(2);
    expect(result.repaired).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.anomalies).toEqual([]);
  });

  it('keeps the original alias rows immutable (not deleted)', () => {
    expect(findAccountingExecutionById(ctx.sqlite, scenario.addExecutionId)?.action).toBe('add');
    expect(findAccountingExecutionById(ctx.sqlite, scenario.reduceExecutionId)?.action).toBe('reduce');
  });

  it('LONG add → reversal sell + replacement buy; LONG reduce → reversal buy + replacement sell', () => {
    const addDetail = result.details.find((d) => d.originalId === scenario.addExecutionId)!;
    const reduceDetail = result.details.find((d) => d.originalId === scenario.reduceExecutionId)!;

    expect(addDetail.concreteAction).toBe('buy');
    expect(reduceDetail.concreteAction).toBe('sell');

    // Reversal of a concrete action is its opposite (reverseAction contract).
    expect(reverseAction(addDetail.concreteAction)).toBe('sell');
    expect(reverseAction(reduceDetail.concreteAction)).toBe('buy');

    expectRepairedActions(
      ctx,
      addDetail,
      { originalAction: 'add', concreteAction: 'buy', reversalAction: 'sell' },
      'LONG add',
    );
    expectRepairedActions(
      ctx,
      reduceDetail,
      { originalAction: 'reduce', concreteAction: 'sell', reversalAction: 'buy' },
      'LONG reduce',
    );

    // Journal linkage inherited by both repair rows.
    expect(findAccountingExecutionById(ctx.sqlite, addDetail.replacementId!)?.journal_trade_id).toBe(
      scenario.tradeId,
    );
    expect(findAccountingExecutionById(ctx.sqlite, addDetail.reversalId!)?.journal_trade_id).toBe(
      scenario.tradeId,
    );
  });

  it('records correction_lineage linking original → reversal → replacement', () => {
    const addDetail = result.details.find((d) => d.originalId === scenario.addExecutionId)!;
    const reduceDetail = result.details.find((d) => d.originalId === scenario.reduceExecutionId)!;
    expectLineageLinksOriginal(ctx, addDetail, 'LONG add');
    expectLineageLinksOriginal(ctx, reduceDetail, 'LONG reduce');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Test 3 — SHORT add → sell_short, SHORT reduce → buy_to_cover
// ═══════════════════════════════════════════════════════════════════════════

describe('repairAliasExecutions resolves SHORT add → sell_short and SHORT reduce → buy_to_cover', () => {
  let ctx: TestDatabaseContext;
  let scenario: RepairScenario;
  let result: AliasRepairResult;

  beforeAll(() => {
    ctx = createTestDatabase({ migrations: true });
    scenario = seedRepairScenario(ctx.sqlite, 'short');
    result = repairAliasExecutions(ctx.sqlite);
  });

  afterAll(() => {
    ctx.dispose();
  });

  it('repairs both planted alias rows (scanned 2, repaired 2, no anomalies)', () => {
    expect(result.scanned).toBe(2);
    expect(result.repaired).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.anomalies).toEqual([]);
  });

  it('SHORT add → reversal buy_to_cover + replacement sell_short; SHORT reduce → reversal sell_short + replacement buy_to_cover', () => {
    const addDetail = result.details.find((d) => d.originalId === scenario.addExecutionId)!;
    const reduceDetail = result.details.find((d) => d.originalId === scenario.reduceExecutionId)!;

    expect(addDetail.concreteAction).toBe('sell_short');
    expect(reduceDetail.concreteAction).toBe('buy_to_cover');

    expect(reverseAction(addDetail.concreteAction)).toBe('buy_to_cover');
    expect(reverseAction(reduceDetail.concreteAction)).toBe('sell_short');

    expectRepairedActions(
      ctx,
      addDetail,
      { originalAction: 'add', concreteAction: 'sell_short', reversalAction: 'buy_to_cover' },
      'SHORT add',
    );
    expectRepairedActions(
      ctx,
      reduceDetail,
      { originalAction: 'reduce', concreteAction: 'buy_to_cover', reversalAction: 'sell_short' },
      'SHORT reduce',
    );
  });

  it('records correction_lineage linking original → reversal → replacement', () => {
    const addDetail = result.details.find((d) => d.originalId === scenario.addExecutionId)!;
    const reduceDetail = result.details.find((d) => d.originalId === scenario.reduceExecutionId)!;
    expectLineageLinksOriginal(ctx, addDetail, 'SHORT add');
    expectLineageLinksOriginal(ctx, reduceDetail, 'SHORT reduce');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Test 4 — anomaly for unresolvable alias (no journal_trade_id)
// ═══════════════════════════════════════════════════════════════════════════

describe('repairAliasExecutions reports anomaly for unresolvable alias (no journal_trade_id)', () => {
  let ctx: TestDatabaseContext;
  let scenario: RepairScenario;
  let orphanExecutionId: string;
  let result: AliasRepairResult;

  beforeAll(() => {
    ctx = createTestDatabase({ migrations: true });
    scenario = seedRepairScenario(ctx.sqlite, 'long');

    // An alias row with NO journal linkage — direction is unresolvable and
    // must be reported, never guessed.
    orphanExecutionId = insertAliasExecution(ctx.sqlite, {
      accountId: scenario.accountId,
      tradeId: null,
      instrumentId: scenario.instrumentId,
      action: 'add',
      quantity: '10.00',
      price: '50.00',
      postedAt: ORPHAN_POSTED_AT,
    });
    plantAliasEvent(ctx.sqlite, {
      accountId: scenario.accountId,
      executionId: orphanExecutionId,
      action: 'add',
      symbol: SYMBOL,
      quantity: '10.00',
      price: '50.00',
      tradeDirection: 'long',
      postedAt: ORPHAN_POSTED_AT,
    });

    result = repairAliasExecutions(ctx.sqlite);
  });

  afterAll(() => {
    ctx.dispose();
  });

  it('repairs the resolvable rows and reports the orphan as an anomaly', () => {
    expect(result.scanned).toBe(3);
    expect(result.repaired).toBe(2);
    expect(result.anomalies).toHaveLength(1);
    expect(result.anomalies[0].executionId).toBe(orphanExecutionId);
    expect(result.anomalies[0].action).toBe('add');
    expect(result.anomalies[0].reason).toContain('no journal_trade_id');
  });

  it('leaves the orphan un-repaired (no lineage, still in the audit surface)', () => {
    expect(findCorrectionByOriginalExecution(ctx.sqlite, orphanExecutionId)).toBeUndefined();
    const remaining = findAliasExecutions(ctx.sqlite);
    expect(remaining.map((r) => r.id)).toEqual([orphanExecutionId]);
    // Its original execution row is untouched.
    expect(findAccountingExecutionById(ctx.sqlite, orphanExecutionId)?.action).toBe('add');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Test 5 — idempotency (re-run repairs nothing, writes nothing)
// ═══════════════════════════════════════════════════════════════════════════

describe('repairAliasExecutions is idempotent (re-run skips already-repaired)', () => {
  let ctx: TestDatabaseContext;

  beforeAll(() => {
    ctx = createTestDatabase({ migrations: true });
    seedRepairScenario(ctx.sqlite, 'long');
  });

  afterAll(() => {
    ctx.dispose();
  });

  it('second run repairs zero rows and writes zero new events/entries/lineage', () => {
    const first = repairAliasExecutions(ctx.sqlite);
    expect(first.repaired).toBe(2);

    const counts = () => ({
      executions: countRows(ctx.sqlite, 'accounting_executions'),
      events: countRows(ctx.sqlite, 'financial_events'),
      entries: countRows(ctx.sqlite, 'ledger_entries'),
      postings: countRows(ctx.sqlite, 'ledger_postings'),
      lineage: countRows(ctx.sqlite, 'correction_lineage'),
    });
    const before = counts();

    const second = repairAliasExecutions(ctx.sqlite);
    // The audit surface is already zero (the scan pre-filters repaired rows
    // through correction_lineage), so the second run sees nothing to do.
    expect(second.scanned).toBe(0);
    expect(second.repaired).toBe(0);
    expect(second.details).toEqual([]);
    expect(second.anomalies).toEqual([]);

    expect(counts()).toEqual(before);
    expectNoUnrepairedAliasRows(ctx.sqlite, 'idempotent re-run');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Test 6 — dryRun reports planned repairs without mutating
// ═══════════════════════════════════════════════════════════════════════════

describe('dryRun mode reports planned repairs without mutating', () => {
  let ctx: TestDatabaseContext;
  let scenario: RepairScenario;

  beforeAll(() => {
    ctx = createTestDatabase({ migrations: true });
    scenario = seedRepairScenario(ctx.sqlite, 'long');
  });

  afterAll(() => {
    ctx.dispose();
  });

  it('returns the full plan with null ids and writes nothing', () => {
    const counts = () => ({
      executions: countRows(ctx.sqlite, 'accounting_executions'),
      events: countRows(ctx.sqlite, 'financial_events'),
      entries: countRows(ctx.sqlite, 'ledger_entries'),
      postings: countRows(ctx.sqlite, 'ledger_postings'),
      lineage: countRows(ctx.sqlite, 'correction_lineage'),
    });
    const before = counts();

    const dry = repairAliasExecutions(ctx.sqlite, { dryRun: true });

    expect(dry.scanned).toBe(2);
    expect(dry.repaired).toBe(0);
    expect(dry.anomalies).toEqual([]);
    expect(dry.details).toHaveLength(2);

    for (const d of dry.details) {
      expect(d.reversalId, 'dry-run reversal id stays null').toBeNull();
      expect(d.replacementId, 'dry-run replacement id stays null').toBeNull();
      expect(d.lineageId, 'dry-run lineage id stays null').toBeNull();
    }

    // The plan still resolves the concrete actions (auditable intent).
    const addDetail = dry.details.find((d) => d.originalId === scenario.addExecutionId)!;
    const reduceDetail = dry.details.find((d) => d.originalId === scenario.reduceExecutionId)!;
    expect(addDetail.concreteAction).toBe('buy');
    expect(reduceDetail.concreteAction).toBe('sell');

    // Nothing was written; the alias rows remain un-repaired.
    expect(counts()).toEqual(before);
    expect(findAliasExecutions(ctx.sqlite)).toHaveLength(2);
    expect(findCorrectionByOriginalExecution(ctx.sqlite, scenario.addExecutionId)).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Negative path — fail-closed when the FIFO rebuild rejects a repair
// ═══════════════════════════════════════════════════════════════════════════

describe('repairAliasExecutions fails closed when the FIFO rebuild rejects an execution', () => {
  let ctx: TestDatabaseContext;
  let accountId: string;
  let instrumentId: string;

  beforeAll(() => {
    ctx = createTestDatabase({ migrations: true });
    accountId = seedAccount(ctx.sqlite, 'repair-fail-closed');
    instrumentId = seedInstrument(ctx.sqlite, SYMBOL);
    const tradeId = seedTrade(ctx.sqlite, accountId, SYMBOL, 'long');

    // Inconsistent stream: a 'reduce' (sell) precedes any 'add' (buy). The
    // repair resolves reduce → sell, and the replacement sell is rejected by
    // the FIFO allocator (closing quantity exceeds open quantity) — the row's
    // repair must roll back and the run must throw, never commit a broken
    // projection.
    insertAliasExecution(ctx.sqlite, {
      accountId,
      tradeId,
      instrumentId,
      action: 'reduce',
      quantity: '50.00',
      price: '55.00',
      postedAt: ADD_POSTED_AT,
    });
    insertAliasExecution(ctx.sqlite, {
      accountId,
      tradeId,
      instrumentId,
      action: 'add',
      quantity: '100.00',
      price: '50.00',
      postedAt: REDUCE_POSTED_AT,
    });
  });

  afterAll(() => {
    ctx.dispose();
  });

  it('throws naming the failing execution and rolls back the row (no lineage, no partial writes)', () => {
    const counts = () => ({
      executions: countRows(ctx.sqlite, 'accounting_executions'),
      events: countRows(ctx.sqlite, 'financial_events'),
      lineage: countRows(ctx.sqlite, 'correction_lineage'),
    });
    const before = counts();

    expect(() => repairAliasExecutions(ctx.sqlite)).toThrow(/Alias repair failed for execution/);

    // The failing row's repair (reversal + replacement + lineage) rolled back
    // atomically; the originals remain the only executions.
    expect(counts()).toEqual(before);
    expect(findAliasExecutions(ctx.sqlite)).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Tests 7–10 — post-repair invariants (long + short)
// ═══════════════════════════════════════════════════════════════════════════

describe('post-repair invariants: no alias rows, cash direction, activity-ledger agreement, positions', () => {
  let ctx: TestDatabaseContext;
  let long: RepairScenario;
  let short: RepairScenario;
  let repairResult: AliasRepairResult;

  beforeAll(() => {
    ctx = createTestDatabase({ migrations: true });
    long = seedRepairScenario(ctx.sqlite, 'long');
    short = seedRepairScenario(ctx.sqlite, 'short');
    repairResult = repairAliasExecutions(ctx.sqlite);
    expect(repairResult.repaired).toBe(4);
    expect(repairResult.anomalies).toEqual([]);
  });

  afterAll(() => {
    ctx.dispose();
  });

  it('invariant 7: no alias rows remain — findAliasExecutions returns empty', () => {
    expectNoUnrepairedAliasRows(ctx.sqlite, 'long account');
    expectNoUnrepairedAliasRows(ctx.sqlite, 'short account');

    // The immutable superseded originals still exist (never deleted) — the
    // effective invariant is zero UN-REPAIRED alias rows, not zero alias rows.
    const rawCount = ctx.sqlite
      .prepare(
        `SELECT COUNT(*) AS c FROM accounting_executions WHERE action IN ('add', 'reduce')`,
      )
      .get() as { c: number };
    expect(rawCount.c).toBe(4); // 2 long + 2 short originals preserved as audit trail
  });

  it('invariant 8: cash-direction alignment — repair-written concrete events align; alias originals untouched', () => {
    expectStoredCashDirectionAlignment(ctx.sqlite, long.accountId, 'long repair');
    expectStoredCashDirectionAlignment(ctx.sqlite, short.accountId, 'short repair');

    // Planted alias events are immutable legacy audit trail: still alias
    // payloads with cash effects, never rewritten by the repair.
    for (const [label, sc] of [
      ['long', long],
      ['short', short],
    ] as const) {
      for (const [aliasAction, execId] of [
        ['add', sc.addExecutionId],
        ['reduce', sc.reduceExecutionId],
      ] as const) {
        const event = ctx.sqlite
          .prepare('SELECT payload, effect FROM financial_events WHERE idempotency_key = ?')
          .get(executionFinancialEventIdempotencyKey(execId)) as
          | { payload: string; effect: string }
          | undefined;
        expect(event, `${label}: alias event exists for ${aliasAction}`).toBeDefined();
        expect((JSON.parse(event!.payload) as { action: string }).action).toBe(aliasAction);
        expect(JSON.parse(event!.effect) as { kind: string }).toHaveProperty('kind', 'cash');
      }
    }
  });

  it('invariant 9: activity-ledger agreement — activity sum, cash summary, and ledger net agree', () => {
    expectActivityLedgerAgreement(ctx.sqlite, long.accountId, 'long repair');
    expectActivityLedgerAgreement(ctx.sqlite, short.accountId, 'short repair');

    // Exact economics: the repair pair (reversal + replacement) cancels to
    // zero net cash, so the account net equals the legacy alias events alone.
    // Long: add 100 @ 50 (decrease 5000) + reduce 50 @ 55 (increase 2750) = -2250.
    // Short: add 100 @ 50 (increase 5000) + reduce 50 @ 45 (decrease 2250) = +2750.
    expect(computeAccountCashImpact(ctx.sqlite, long.accountId).netCashImpactMicros).toBe(
      -2250 * MICROS_PER_UNIT,
    );
    expect(computeAccountCashImpact(ctx.sqlite, short.accountId).netCashImpactMicros).toBe(
      2750 * MICROS_PER_UNIT,
    );
  });

  it('invariant 10: FIFO positions and lots rebuild correctly (long and short)', () => {
    const longAddReplacementId = repairResult.details.find(
      (d) => d.originalId === long.addExecutionId,
    )!.replacementId!;
    const shortAddReplacementId = repairResult.details.find(
      (d) => d.originalId === short.addExecutionId,
    )!.replacementId!;

    // ── LONG: buy 100 @ 50, sell 50 @ 55 → long 50 @ avg 50, realized +250.
    const longPos = findAccountPosition(ctx.sqlite, long.accountId, long.instrumentId)!;
    expect(longPos.direction, 'LONG position direction').toBe('long');
    expect(Number(longPos.quantity), 'LONG remaining quantity').toBe(50);
    expect(Number(longPos.average_cost), 'LONG average cost').toBe(50);
    expect(Number(longPos.realized_gross_pnl), 'LONG realized gross P&L').toBe(250);
    expect(Number(longPos.realized_fees), 'LONG realized fees').toBe(0);

    const longLots = findFifoLotsByAccountInstrument(ctx.sqlite, long.accountId, long.instrumentId);
    expect(longLots).toHaveLength(1);
    expect(longLots[0].direction).toBe('long');
    expect(Number(longLots[0].remaining_quantity)).toBe(50);
    expect(Number(longLots[0].original_quantity)).toBe(100);
    expect(Number(longLots[0].entry_price)).toBe(50);
    expect(longLots[0].opening_execution_id).toBe(longAddReplacementId);

    // ── SHORT: sell_short 100 @ 50, buy_to_cover 50 @ 45 → short 50 @ avg 50, realized +250.
    const shortPos = findAccountPosition(ctx.sqlite, short.accountId, short.instrumentId)!;
    expect(shortPos.direction, 'SHORT position direction').toBe('short');
    expect(Number(shortPos.quantity), 'SHORT remaining quantity').toBe(50);
    expect(Number(shortPos.average_cost), 'SHORT average cost').toBe(50);
    expect(Number(shortPos.realized_gross_pnl), 'SHORT realized gross P&L').toBe(250);
    expect(Number(shortPos.realized_fees), 'SHORT realized fees').toBe(0);

    const shortLots = findFifoLotsByAccountInstrument(ctx.sqlite, short.accountId, short.instrumentId);
    expect(shortLots).toHaveLength(1);
    expect(shortLots[0].direction).toBe('short');
    expect(Number(shortLots[0].remaining_quantity)).toBe(50);
    expect(Number(shortLots[0].original_quantity)).toBe(100);
    expect(Number(shortLots[0].entry_price)).toBe(50);
    expect(shortLots[0].opening_execution_id).toBe(shortAddReplacementId);
  });
});
