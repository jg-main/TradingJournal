/**
 * trade-execution-engine.ts
 *
 * Canonical atomic execution engine (S03 / T02).
 *
 * POST /api/trades/:id/executions (P2) and the bulk P1 adapter
 * /api/trades/:id/execute both delegate here — this module is the ONE
 * execution path in the product. No route owns independent execution logic.
 *
 * One engine call commits, atomically inside a single outer SQLite
 * transaction:
 *
 *   a. journal execution   — trade_executions row (with idempotency key)
 *   b. trade state         — status / openedAt / closedAt derived by
 *                            computeTradeMetrics from the full execution set
 *   c. risk snapshot       — first-entry snapshot with the canonical equity
 *                            cascade (account_performance.nav →
 *                            account_rollforward.ending_equity →
 *                            account.startingBalance →
 *                            settings.startingAccountValue)
 *   d. checklist evidence  — trade_check_results with item-text snapshot (F7)
 *   e. accounting          — immutable accounting_executions row + financial
 *                            event + balanced ledger postings via
 *                            postExecutionFill (nested savepoint inside the
 *                            outer transaction)
 *   f. FIFO positions      — rebuildPositionsWithinTransaction (no nested
 *                            transaction; the outer one owns the connection)
 *   g. account performance — rebuildAccountPerformance (no internal tx)
 *
 * Any unhandled error inside the transaction rolls back ALL of the above —
 * no orphan journal rows, no half-applied accounting.
 *
 * Idempotency: a client-supplied idempotencyKey is checked read-only before
 * the transaction; a replay returns the original result with `replayed: true`
 * and creates no rows. A concurrent duplicate that slips past the pre-flight
 * check is caught by the partial unique index
 * uq_trade_executions_idempotency_key inside the transaction and surfaced as
 * `IdempotentReplayError` with the original result attached.
 *
 * The accounting idempotency key is derived from the journal execution ID via
 * `tradeExecutionIdempotencyKey()` (shared with the legacy sync path — the
 * keys must never diverge, MEM055), and quantities/prices are normalized to
 * canonical decimal strings for the accounting layer.
 *
 * Pure service: no NextResponse, no request parsing, no HTTP concerns. The
 * caller supplies the drizzle handle and the raw better-sqlite3 handle.
 */

import type Database from 'better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq, and, or, isNull, asc } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import * as schema from '@/db/schema';
import {
  trades,
  tradeExecutions,
  tradeRiskSnapshots,
  tradeCheckResults,
  checklistDefinitions,
  lookupValues,
  setupDefinitions,
} from '@/db/schema';
import { computeTradeMetrics, type ExecutionData, type Direction } from '@/lib/trade-metrics';
import { computeRiskSnapshotValues } from '@/lib/risk-snapshot';
import { computeExecutionContext } from '@/lib/execution-context';
import { checkExecutionReadiness, type ReadinessFailure } from '@/lib/execution-readiness';
import { postExecutionFill, type PostExecutionFillResult } from '@/lib/accounting/execution-posting';
import { rebuildPositionsWithinTransaction } from '@/lib/positions/rebuild';
import { rebuildAccountPerformance } from '@/lib/performance/performance-rebuild';
import { tradeExecutionIdempotencyKey } from '@/lib/positions/trade-execution-sync';
import { normalizeDecimal } from '@/lib/accounting/decimal';
import type { AccountingExecutionRow } from '@/db/accounting-repository';
import { findAccountingExecutionByIdempotencyKey } from '@/db/accounting-repository';

// ── Types ────────────────────────────────────────────────────────────────

/**
 * The transaction handle passed to db.transaction() callbacks. Uses the
 * same extraction drizzle applies when it constructs the callback.
 */
type EngineTx = BetterSQLite3Database<typeof schema> extends {
  transaction<TReturn>(
    cb: (tx: infer TTx) => TReturn,
    config?: unknown,
  ): TReturn;
}
  ? TTx
  : never;

export type TradeExecutionAction =
  | 'buy'
  | 'sell'
  | 'buy_to_cover'
  | 'sell_short'
  | 'add'
  | 'reduce';

export type TradeDirection = 'long' | 'short';

/** One submitted checklist check result (item-text snapshot is taken by the engine). */
export interface TradeFillCheckResult {
  checklistDefinitionId: string;
  passed: boolean;
  comment?: string;
}

/**
 * Validated fill data for one execution.
 *
 * `stopPrice` applies to the FIRST fill only (the P1 bulk path passes the
 * request stop price; P2 has no per-fill stop and falls back to
 * trade.plannedStop). Over-close and quantity guards are intentionally NOT
 * enforced here — that is S04's action-semantics concern.
 */
export interface ExecuteTradeFillInput {
  tradeId: string;
  action: TradeExecutionAction;
  quantity: number;
  price: number;
  fees?: number;
  /** ISO-8601 execution timestamp; defaults to now. */
  executedAt?: string;
  /** Client-generated idempotency key; replay-safe when supplied. */
  idempotencyKey?: string;
  /** First-fill checklist results (required items must pass). */
  checkResults?: TradeFillCheckResult[];
  /** Lifts the max-risk block on the first fill and is stored on the trade. */
  riskOverrideReason?: string;
  /** Stop price for the first-fill risk snapshot (P1 bulk path). */
  stopPrice?: number;
  /** Optional execution reason lookup id (P2 passthrough). */
  reasonId?: string | null;
  /** Optional free-form notes (P2 passthrough). */
  notes?: string | null;
}

/** Engine dependencies: drizzle handle + raw better-sqlite3 handle. */
export interface TradeExecutionContext {
  db: BetterSQLite3Database<typeof schema>;
  sqlite: Database.Database;
}

/** Full result of a successful fill (or an idempotent replay). */
export interface TradeExecutionEngineResult {
  /** The journal trade_executions row. */
  execution: typeof schema.tradeExecutions.$inferSelect;
  /** The trade row after status/openedAt/closedAt derivation. */
  trade: typeof schema.trades.$inferSelect;
  /** The first-entry risk snapshot (null when no entry / not yet due). */
  riskSnapshot: typeof schema.tradeRiskSnapshots.$inferSelect | null;
  /** The immutable accounting_executions row (mirror of the fill). */
  accountingExecution: AccountingExecutionRow | null;
  /** True when this call replayed an existing idempotent execution. */
  replayed: boolean;
}

// ── Typed Errors ─────────────────────────────────────────────────────────

export class TradeNotFoundError extends Error {
  constructor(tradeId: string) {
    super(`Trade not found: ${tradeId}`);
    this.name = 'TradeNotFoundError';
  }
}

export class TradeDeletedError extends Error {
  constructor() {
    super('Cannot add executions to a deleted trade');
    this.name = 'TradeDeletedError';
  }
}

export class ActionDirectionError extends Error {
  readonly action: string;
  readonly direction: string;
  constructor(action: string, direction: string) {
    super(
      `Action "${action}" is not valid for a ${direction} trade. ` +
        `Valid actions: ${DIRECTION_ACTIONS[direction as TradeDirection]?.join(', ') ?? ''}`,
    );
    this.name = 'ActionDirectionError';
    this.action = action;
    this.direction = direction;
  }
}

/** First-fill execution-readiness gate failure (readiness failures carry codes). */
export class ReadinessFailureError extends Error {
  readonly failures: ReadinessFailure[];
  constructor(failures: ReadinessFailure[]) {
    super(failures.map((f) => f.message).join('; '));
    this.name = 'ReadinessFailureError';
    this.failures = failures;
  }
}

/** First-fill checklist gate failure (required items missing or not passed). */
export class ChecklistGateError extends Error {
  readonly missing: string[];
  readonly notPassed: string[];
  constructor(detail: { missing: string[]; notPassed: string[] }) {
    const parts = [
      ...(detail.missing.length > 0
        ? [`Missing check results for: ${detail.missing.join(', ')}`]
        : []),
      ...(detail.notPassed.length > 0
        ? [`Checklist items must be passed before execution: ${detail.notPassed.join(', ')}`]
        : []),
    ];
    super(parts.join('; '));
    this.name = 'ChecklistGateError';
    this.missing = detail.missing;
    this.notPassed = detail.notPassed;
  }
}

/**
 * A concurrent duplicate execution (same idempotency key) hit the partial
 * unique index inside the transaction. The original result is attached so the
 * route can return 200 with it instead of erroring.
 */
export class IdempotentReplayError extends Error {
  readonly result: TradeExecutionEngineResult;
  constructor(result: TradeExecutionEngineResult) {
    super('Concurrent duplicate execution detected; original result returned');
    this.name = 'IdempotentReplayError';
    this.result = result;
  }
}

// ── Constants ────────────────────────────────────────────────────────────

const DIRECTION_ACTIONS: Record<TradeDirection, TradeExecutionAction[]> = {
  long: ['buy', 'add', 'sell', 'reduce'],
  short: ['sell_short', 'buy_to_cover'],
};

// ── Structured Logging ──────────────────────────────────────────────────

function logInfo(message: string, details: Record<string, unknown>): void {
  console.log(`[execution-engine] ${message} ${JSON.stringify(details)}`);
}

function logError(message: string, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`[execution-engine] error ${message}: ${detail}`);
}

// ── Helpers ─────────────────────────────────────────────────────────────

function toExecutionData(
  rows: typeof schema.tradeExecutions.$inferSelect[],
): ExecutionData[] {
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    quantity: r.quantity,
    price: r.price,
    fees: r.fees,
    executedAt: r.executedAt ?? r.createdAt ?? '',
  }));
}

function validateActionForDirection(
  action: TradeExecutionAction,
  direction: TradeDirection,
): void {
  if (!DIRECTION_ACTIONS[direction].includes(action)) {
    throw new ActionDirectionError(action, direction);
  }
}

/**
 * Resolve the canonical account equity at open for the risk snapshot:
 * account_performance.nav (canonical decimal string, parsed as float) →
 * latest account_rollforward.ending_equity (date DESC) →
 * account.startingBalance → settings.startingAccountValue.
 *
 * Mirrors the dashboard-v2 journal-kernel cascade. This is the source for the
 * risk snapshot only — the readiness gate keeps using execution-context.ts
 * (S02 contract preserved).
 */
function resolveCanonicalEquity(
  sqlite: Database.Database,
  accountId: string,
): number | null {
  const performance = sqlite
    .prepare('SELECT nav FROM account_performance WHERE account_id = ?')
    .get(accountId) as { nav: string | null } | undefined;
  if (performance?.nav) {
    const nav = parseFloat(performance.nav);
    if (Number.isFinite(nav)) return nav;
  }

  const rollforward = sqlite
    .prepare(
      `SELECT ending_equity FROM account_rollforward
       WHERE account_id = ? ORDER BY date DESC, created_at DESC LIMIT 1`,
    )
    .get(accountId) as { ending_equity: number | null } | undefined;
  if (rollforward?.ending_equity != null) return rollforward.ending_equity;

  const account = sqlite
    .prepare('SELECT starting_balance FROM accounts WHERE id = ?')
    .get(accountId) as { starting_balance: number | null } | undefined;
  if (account?.starting_balance != null) return account.starting_balance;

  const settingsRow = sqlite
    .prepare("SELECT starting_account_value FROM settings WHERE id = 'default'")
    .get() as { starting_account_value: number | null } | undefined;
  return settingsRow?.starting_account_value ?? null;
}

// ── Checklist helpers ───────────────────────────────────────────────────

interface ChecklistSnapshot {
  submitted: TradeFillCheckResult[];
  itemTextById: Map<string, string>;
}

/** Resolve the setup-definition ID from the trade's setup lookup value. */
function resolveSetupDefinitionId(
  dbHandle: BetterSQLite3Database<typeof schema>,
  trade: typeof schema.trades.$inferSelect,
): string | undefined {
  if (!trade.setupId) return undefined;
  const lookupVal = dbHandle
    .select()
    .from(lookupValues)
    .where(eq(lookupValues.id, trade.setupId))
    .get();
  if (!lookupVal) return undefined;
  const setupDef = dbHandle
    .select()
    .from(setupDefinitions)
    .where(eq(setupDefinitions.name, lookupVal.value))
    .get();
  return setupDef?.id;
}

/** Load the merged active checklist for the trade's account + resolved setup. */
function loadMergedChecklist(
  dbHandle: BetterSQLite3Database<typeof schema>,
  trade: typeof schema.trades.$inferSelect,
): typeof schema.checklistDefinitions.$inferSelect[] {
  const setupDefId = resolveSetupDefinitionId(dbHandle, trade);
  return dbHandle
    .select()
    .from(checklistDefinitions)
    .where(
      and(
        or(
          eq(checklistDefinitions.accountId, trade.accountId),
          ...(setupDefId ? [eq(checklistDefinitions.setupId, setupDefId)] : []),
        ),
        isNull(checklistDefinitions.deletedAt),
      ),
    )
    .orderBy(asc(checklistDefinitions.sortOrder), asc(checklistDefinitions.createdAt))
    .all();
}

/**
 * Enforce the first-fill checklist gate (D3): required items of the merged
 * active checklist must all be submitted and passed. Optional items may be
 * omitted but are still recorded when submitted. Builds the item-text snapshot
 * map (F7) with a direct fallback for submitted definitions outside the merged
 * active set.
 */
function enforceFirstFillChecklist(
  dbHandle: BetterSQLite3Database<typeof schema>,
  trade: typeof schema.trades.$inferSelect,
  submitted: TradeFillCheckResult[],
): ChecklistSnapshot {
  const mergedChecks = loadMergedChecklist(dbHandle, trade);
  const submittedMap = new Map(
    submitted.map((cr) => [cr.checklistDefinitionId, cr.passed]),
  );

  const missing: string[] = [];
  const notPassed: string[] = [];
  for (const check of mergedChecks) {
    if (!check.isRequired) continue;
    const passedResult = submittedMap.get(check.id);
    if (passedResult === undefined) {
      missing.push(check.description);
    } else if (!passedResult) {
      notPassed.push(check.description);
    }
  }

  if (missing.length > 0 || notPassed.length > 0) {
    throw new ChecklistGateError({ missing, notPassed });
  }

  const itemTextById = new Map<string, string>();
  for (const check of mergedChecks) {
    itemTextById.set(check.id, check.description);
  }
  for (const cr of submitted) {
    if (!itemTextById.has(cr.checklistDefinitionId)) {
      const def = dbHandle
        .select()
        .from(checklistDefinitions)
        .where(eq(checklistDefinitions.id, cr.checklistDefinitionId))
        .get();
      if (def) {
        itemTextById.set(cr.checklistDefinitionId, def.description);
      }
    }
  }

  return { submitted, itemTextById };
}

/** Persist submitted checklist results with their item-text snapshot (F7). */
function persistChecklistEvidence(
  tx: EngineTx,
  params: {
    tradeId: string;
    snapshot: ChecklistSnapshot;
    now: string;
  },
): void {
  const { tradeId, snapshot, now } = params;
  for (const cr of snapshot.submitted) {
    tx.insert(tradeCheckResults)
      .values({
        id: randomUUID(),
        tradeId,
        checklistDefinitionId: cr.checklistDefinitionId,
        itemText: snapshot.itemTextById.get(cr.checklistDefinitionId) ?? null,
        passed: cr.passed,
        comment: cr.comment ?? null,
        checkedAt: now,
        createdAt: now,
      })
      .run();
  }
}

// ── Risk snapshot helper ─────────────────────────────────────────────────

/**
 * Create the first-entry risk snapshot when none exists for the trade and the
 * entry quantity is positive. Equity-at-open comes from the canonical cascade
 * (resolveCanonicalEquity), NOT from the legacy startingBalance + flows model.
 */
function maybeCreateRiskSnapshot(
  tx: EngineTx,
  sqlite: Database.Database,
  params: {
    tradeId: string;
    accountId: string;
    direction: Direction;
    entryQuantity: number;
    avgEntryPrice: number | null;
    stopPrice: number | null;
    now: string;
  },
): typeof schema.tradeRiskSnapshots.$inferSelect | null {
  const { tradeId, accountId, direction, entryQuantity, avgEntryPrice, stopPrice, now } = params;

  if (entryQuantity <= 0 || avgEntryPrice == null) return null;

  const existing = tx
    .select()
    .from(tradeRiskSnapshots)
    .where(eq(tradeRiskSnapshots.tradeId, tradeId))
    .get();
  if (existing) return existing;

  const equityAtOpen = resolveCanonicalEquity(sqlite, accountId);

  const riskValues = computeRiskSnapshotValues({
    avgEntryPrice,
    initialQuantity: entryQuantity,
    initialStopPrice: stopPrice,
    direction,
    accountEquityAtOpen: equityAtOpen,
  });

  const insert: typeof schema.tradeRiskSnapshots.$inferInsert = {
    id: randomUUID(),
    tradeId,
    createdAt: now,
    ...(equityAtOpen != null ? { accountEquityAtOpen: equityAtOpen } : {}),
    ...riskValues,
  };
  tx.insert(tradeRiskSnapshots).values(insert).run();

  return (
    tx
      .select()
      .from(tradeRiskSnapshots)
      .where(eq(tradeRiskSnapshots.tradeId, tradeId))
      .get() ?? null
  );
}

/** Convert the posting kernel's camelCase result to the snake_case row shape. */
function toAccountingExecutionRow(
  execution: PostExecutionFillResult['execution'],
): AccountingExecutionRow {
  return {
    id: execution.id,
    account_id: execution.accountId,
    instrument_id: execution.instrumentId,
    action: execution.action,
    quantity: execution.quantity,
    price: execution.price,
    fees: execution.fees,
    idempotency_key: execution.idempotencyKey,
    journal_trade_id: execution.journalTradeId,
    description: execution.description,
    posted_at: execution.postedAt,
    created_at: execution.createdAt,
  };
}

// ── Idempotent replay ───────────────────────────────────────────────────

function composeReplayResult(params: {
  execution: typeof schema.tradeExecutions.$inferSelect;
  trade: typeof schema.trades.$inferSelect;
  riskSnapshot: typeof schema.tradeRiskSnapshots.$inferSelect | null;
  accountingExecution: AccountingExecutionRow | null;
}): TradeExecutionEngineResult {
  return { ...params, replayed: true };
}

/** Read the full original result for an idempotent replay. */
function buildReplayResult(
  dbHandle: BetterSQLite3Database<typeof schema>,
  sqlite: Database.Database,
  existingExecution: typeof schema.tradeExecutions.$inferSelect,
  tradeId: string,
): TradeExecutionEngineResult {
  const trade = dbHandle
    .select()
    .from(trades)
    .where(eq(trades.id, tradeId))
    .get();
  if (!trade) {
    throw new TradeNotFoundError(tradeId);
  }
  const riskSnapshot =
    dbHandle
      .select()
      .from(tradeRiskSnapshots)
      .where(eq(tradeRiskSnapshots.tradeId, tradeId))
      .get() ?? null;
  const accountingExecution =
    findAccountingExecutionByIdempotencyKey(
      sqlite,
      tradeExecutionIdempotencyKey(existingExecution.id),
    ) ?? null;
  return composeReplayResult({
    execution: existingExecution,
    trade,
    riskSnapshot,
    accountingExecution,
  });
}

/** Detect a SQLite unique-constraint violation (better-sqlite3 SqliteError). */
function isUniqueConstraintViolation(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string' && code.startsWith('SQLITE_CONSTRAINT')) return true;
  return /UNIQUE constraint failed/i.test(err.message);
}

// ── Main entry point ────────────────────────────────────────────────────

/**
 * Execute one trade fill atomically: journal + trade state + risk snapshot +
 * checklist evidence + accounting execution + FIFO positions + account
 * performance commit together or roll back together.
 *
 * @throws {TradeNotFoundError}      trade is missing
 * @throws {TradeDeletedError}       trade is deleted
 * @throws {ActionDirectionError}    action not valid for the trade direction
 * @throws {ReadinessFailureError}   first-fill readiness gate failed
 * @throws {ChecklistGateError}      first-fill required checklist items not passed
 * @throws {IdempotentReplayError}   concurrent duplicate (result attached)
 * @throws {Error}                   any accounting/rebuild failure (full rollback)
 */
export function executeTradeFill(
  input: ExecuteTradeFillInput,
  context: TradeExecutionContext,
): TradeExecutionEngineResult {
  const { db: dbHandle, sqlite } = context;
  const now = new Date().toISOString();
  const execTimestamp = input.executedAt ?? now;

  // ── Pre-flight (outside transaction, read-only) ─────────────────────

  const trade = dbHandle
    .select()
    .from(trades)
    .where(eq(trades.id, input.tradeId))
    .get();
  if (!trade) throw new TradeNotFoundError(input.tradeId);
  if (trade.status === 'deleted') throw new TradeDeletedError();

  // Idempotent replay: same idempotency key → return the original result.
  if (input.idempotencyKey) {
    const existing = dbHandle
      .select()
      .from(tradeExecutions)
      .where(eq(tradeExecutions.idempotencyKey, input.idempotencyKey))
      .get();
    if (existing) {
      logInfo('idempotent-replay', {
        idempotencyKey: input.idempotencyKey,
        executionId: existing.id,
        tradeId: input.tradeId,
      });
      return buildReplayResult(dbHandle, sqlite, existing, input.tradeId);
    }
  }

  validateActionForDirection(input.action, trade.direction as TradeDirection);

  let riskOverrideReasonToStore: string | null = null;
  let checklistSnapshot: ChecklistSnapshot = { submitted: [], itemTextById: new Map() };

  // First-fill gates (trade still 'planned').
  if (trade.status === 'planned') {
    // ── Execution readiness gate (S02 contract) ──────────────────────
    const effectiveStop = input.stopPrice ?? trade.plannedStop;
    const initialRiskAmount =
      effectiveStop != null
        ? Math.abs(input.price - effectiveStop) * input.quantity
        : null;

    const equityContext = computeExecutionContext(
      dbHandle,
      trade.accountId,
      execTimestamp,
    );

    const readiness = checkExecutionReadiness({
      account: {
        isActive: equityContext.account?.isActive ?? false,
        currency: equityContext.account?.currency ?? 'USD',
        maxRiskPerTradePct: equityContext.account?.maxRiskPerTradePct ?? null,
        defaultCommission: equityContext.account?.defaultCommission ?? null,
      },
      settings: {
        maxRiskPerTradePct: equityContext.globalSettings?.maxRiskPerTradePct ?? null,
        startingAccountValue: equityContext.globalSettings?.startingAccountValue ?? null,
      },
      tradeStatus: trade.status,
      initialRiskAmount,
      equityAtOpen: equityContext.equityAtOpen,
      hasOpeningCash: equityContext.hasOpeningCash,
      // Required checklist items were enforced by the checklist gate below.
      requiredChecklistPassed: true,
    });

    // Non-max-risk failures block unconditionally (no override contract).
    const nonMaxRiskFailure = readiness.failures.find(
      (f) => f.code !== 'max-risk-exceeded',
    );
    if (nonMaxRiskFailure) {
      throw new ReadinessFailureError(
        readiness.failures.filter((f) => f.code !== 'max-risk-exceeded'),
      );
    }

    // Max-risk failure blocks unless an explicit override reason is supplied.
    const maxRiskFailure = readiness.failures.find(
      (f) => f.code === 'max-risk-exceeded',
    );
    if (maxRiskFailure) {
      if (!input.riskOverrideReason) {
        throw new ReadinessFailureError([maxRiskFailure]);
      }
      riskOverrideReasonToStore = input.riskOverrideReason;
    }

    // ── First-fill checklist gate (D3) + item-text snapshot (F7) ─────
    checklistSnapshot = enforceFirstFillChecklist(
      dbHandle,
      trade,
      input.checkResults ?? [],
    );
  }

  // ── Atomic transaction ───────────────────────────────────────────────

  const result = dbHandle.transaction((tx) => {
    // a. Insert the journal execution with the idempotency key.
    const executionId = randomUUID();
    try {
      tx.insert(tradeExecutions)
        .values({
          id: executionId,
          tradeId: input.tradeId,
          action: input.action,
          quantity: input.quantity,
          price: input.price,
          fees: input.fees ?? 0,
          executedAt: execTimestamp,
          reasonId: input.reasonId ?? null,
          notes: input.notes ?? null,
          idempotencyKey: input.idempotencyKey ?? null,
          createdAt: now,
        })
        .run();
    } catch (err) {
      // Concurrent duplicate slipped past the pre-flight check: the partial
      // unique index protects us. Re-read the original row and surface it as
      // an idempotent replay instead of failing the request.
      if (input.idempotencyKey && isUniqueConstraintViolation(err)) {
        const concurrent = tx
          .select()
          .from(tradeExecutions)
          .where(eq(tradeExecutions.idempotencyKey, input.idempotencyKey))
          .get();
        if (concurrent) {
          logInfo('idempotent-replay (concurrent)', {
            idempotencyKey: input.idempotencyKey,
            executionId: concurrent.id,
            tradeId: input.tradeId,
          });
          throw new IdempotentReplayError(
            buildReplayResult(tx as unknown as BetterSQLite3Database<typeof schema>, sqlite, concurrent, input.tradeId),
          );
        }
      }
      logError('journal-insert', err);
      throw err;
    }

    // b. Reload all executions and derive the new trade state.
    let metrics: ReturnType<typeof computeTradeMetrics>;
    try {
      const allExecutions = tx
        .select()
        .from(tradeExecutions)
        .where(eq(tradeExecutions.tradeId, input.tradeId))
        .orderBy(tradeExecutions.executedAt, tradeExecutions.createdAt)
        .all();

      metrics = computeTradeMetrics({
        executions: toExecutionData(allExecutions),
        direction: trade.direction as Direction,
        riskSnapshot: null,
        stopAdjustments: [],
        currentMark: null,
        currentAccountEquity: null,
      });
    } catch (err) {
      logError('journal-state', err);
      throw err;
    }

    // c. Update the trade row.
    try {
      tx.update(trades)
        .set({
          status: metrics.position.status,
          openedAt: metrics.position.openedAt,
          closedAt: metrics.position.closedAt,
          updatedAt: now,
          ...(riskOverrideReasonToStore
            ? { riskOverrideReason: riskOverrideReasonToStore }
            : {}),
        })
        .where(eq(trades.id, input.tradeId))
        .run();
    } catch (err) {
      logError('trade-state', err);
      throw err;
    }

    // d. First-entry risk snapshot with the canonical equity cascade.
    let riskSnapshot: typeof schema.tradeRiskSnapshots.$inferSelect | null = null;
    try {
      riskSnapshot = maybeCreateRiskSnapshot(tx, sqlite, {
        tradeId: input.tradeId,
        accountId: trade.accountId,
        direction: trade.direction as Direction,
        entryQuantity: metrics.size.entryQuantity,
        avgEntryPrice: metrics.averagePrices.avgEntryPrice,
        stopPrice: input.stopPrice ?? trade.plannedStop,
        now,
      });
    } catch (err) {
      logError('risk-snapshot', err);
      throw err;
    }

    // e. Persist first-fill checklist evidence (item-text snapshot).
    try {
      persistChecklistEvidence(tx, {
        tradeId: input.tradeId,
        snapshot: checklistSnapshot,
        now,
      });
    } catch (err) {
      logError('checklist-evidence', err);
      throw err;
    }

    logInfo('journal-committed', {
      tradeId: input.tradeId,
      executionId,
      action: input.action,
      quantity: input.quantity,
      status: metrics.position.status,
    });

    // f. Accounting execution (P4/P5 kernel; nested savepoint).
    let accountingRow: AccountingExecutionRow;
    try {
      accountingRow = toAccountingExecutionRow(
        postExecutionFill(sqlite, {
          accountId: trade.accountId,
          symbol: trade.symbol,
          action: input.action,
          quantity: normalizeDecimal(input.quantity),
          price: normalizeDecimal(input.price),
          fees: normalizeDecimal(input.fees ?? 0),
          idempotencyKey: tradeExecutionIdempotencyKey(executionId),
          journalTradeId: input.tradeId,
          postedAt: execTimestamp,
        }).execution,
      );
    } catch (err) {
      logError('accounting-execution', err);
      throw err;
    }

    logInfo('accounting-committed', {
      accountingExecutionId: accountingRow.id,
      idempotencyKey: accountingRow.idempotency_key,
    });

    // g. FIFO position rebuild — no nested transaction (outer owns the
    //    connection).
    try {
      rebuildPositionsWithinTransaction(
        sqlite,
        trade.accountId,
        accountingRow.instrument_id,
      );
    } catch (err) {
      logError('positions-rebuild', err);
      throw err;
    }

    // h. Account performance rebuild — no internal transaction. A failed
    //    rebuild is fatal: the whole execution rolls back.
    try {
      const performanceResult = rebuildAccountPerformance(sqlite, trade.accountId);
      if (!performanceResult.success) {
        throw new Error(performanceResult.error ?? 'Failed to rebuild account performance');
      }
    } catch (err) {
      logError('performance-rebuild', err);
      throw err;
    }

    logInfo('positions-rebuilt', {
      accountId: trade.accountId,
      instrumentId: accountingRow.instrument_id,
    });

    const execution = tx
      .select()
      .from(tradeExecutions)
      .where(eq(tradeExecutions.id, executionId))
      .get();
    const updatedTrade = tx
      .select()
      .from(trades)
      .where(eq(trades.id, input.tradeId))
      .get();

    return {
      execution: execution!,
      trade: updatedTrade!,
      riskSnapshot,
      accountingExecution: accountingRow,
      replayed: false,
    } satisfies TradeExecutionEngineResult;
  });

  return result;
}
