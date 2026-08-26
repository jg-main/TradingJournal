#!/usr/bin/env node
/**
 * S01 T02 — Audit: Accounting kernel and domain infrastructure.
 *
 * Automated verification of the accounting backend for the M006
 * accounting audit matrix. Verifies:
 *
 *   1. Schema tables (financial_events, ledger_entries, ledger_postings,
 *      instruments, accounting_executions, account_positions, fifo_lots,
 *      lot_matches, valuation_marks, account_performance,
 *      correction_lineage, accounting_migration_runs,
 *      accounting_migration_records) with their key columns.
 *   2. Event-type model: EVENT_TYPES (12), CASH_EVENT_TYPES (8),
 *      corporate-action types, and the manual-entry API discriminated
 *      union (9 types) vs internal-only posting paths.
 *   3. The balanced immutable posting kernel (posting.ts).
 *   4. Event-posting and execution-posting bridges and their API wiring.
 *   5. Correction infrastructure (reversal-and-replacement + lineage).
 *   6. Rebuild paths (opening cash, activity, net position, ledger
 *      balance, positions, account performance, migration CLI).
 *   7. Projection libraries (ledger, activity, reconciliation, freshness).
 *   8. Legacy accounting migration mappers + runner.
 *   9. Positions/FIFO and performance/valuation domain libraries.
 *  10. Database-level immutability triggers across migrations 0024-0029.
 *  11. The accounting-repository data-access layer.
 *  12. Test coverage and registration across the repo's two runners.
 *
 * Pure filesystem verification — no database, no network, no server. Safe
 * to run repeatedly. Exits 0 when every check passes, 1 otherwise.
 *
 * Usage: node scripts/audit-s01-backend.mjs
 * Output: per-check PASS/FAIL lines plus a machine-readable JSON summary
 *         between the AUDIT_JSON_BEGIN / AUDIT_JSON_END markers on stdout.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

// ── Tiny assertion harness ────────────────────────────────────────────
let passCount = 0;
let failCount = 0;
const failures = [];
const sections = [];

function check(section, label, ok, detail = '') {
  if (ok) {
    passCount += 1;
    console.log(`PASS  [${section}] ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failCount += 1;
    failures.push({ section, label, detail });
    console.log(`FAIL  [${section}] ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function readFile(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/** Section-aware existence check (empty file counts as missing). */
function filePresent(section, label, rel) {
  let ok = false;
  let detail = '';
  try {
    const content = readFile(rel);
    ok = content.trim().length > 0;
    detail = ok ? `${content.split('\n').length} lines` : 'file is empty';
  } catch {
    detail = 'file missing';
  }
  check(section, label, ok, detail);
  return ok;
}

/** Check that `rel` contains all of the given expected substrings. */
function fileContains(section, label, rel, expected) {
  let content = '';
  try {
    content = readFile(rel);
  } catch {
    check(section, label, false, 'file missing');
    return false;
  }
  const missing = expected.filter((s) => !content.includes(s));
  check(
    section,
    label,
    missing.length === 0,
    missing.length === 0
      ? `all ${expected.length} marker(s) present`
      : `missing marker(s): ${missing.join(' | ')}`,
  );
  return missing.length === 0;
}

/** Check that a module exports every expected named symbol. */
function moduleExports(section, label, rel, expected) {
  let content = '';
  try {
    content = readFile(rel);
  } catch {
    check(section, label, false, 'file missing');
    return false;
  }
  const missing = expected.filter(
    (name) =>
      !new RegExp(`export\\s+(async\\s+)?(function|const|class|type|interface)\\s+${name}\\b`).test(
        content,
      ) &&
      !new RegExp(`export\\s*\\{[^}]*\\b${name}\\b`).test(content) &&
      !new RegExp(`export\\s+type\\s*\\{[^}]*\\b${name}\\b`).test(content),
  );
  check(
    section,
    label,
    missing.length === 0,
    missing.length === 0
      ? `exports ${expected.join(', ')}`
      : `missing export(s): ${missing.join(' | ')}`,
  );
  return missing.length === 0;
}

// ── 1. Schema tables ──────────────────────────────────────────────────
{
  const S = 'Schema';
  const schema = 'src/db/schema.ts';
  sections.push(S);

  // Core ledger triad.
  fileContains(S, 'financial_events table', schema, [
    "sqliteTable('financial_events'",
    "eventType: text('event_type'",
    "idempotencyKey: text('idempotency_key')",
    "payload: text('payload')",
    "effect: text('effect')",
    "postedAt: text('posted_at')",
  ]);
  fileContains(S, 'financial_events event_type enum covers 12 types', schema, [
    "'opening_balance', 'trade_execution', 'adjustment', 'transfer'",
    "'deposit', 'withdrawal', 'dividend', 'interest'",
    "'fee', 'tax', 'stock_split', 'manual_adjustment'",
  ]);
  fileContains(S, 'financial_events unique idempotency key', schema, [
    "unique('uq_financial_events_idempotency_key')",
  ]);
  fileContains(S, 'ledger_entries table', schema, [
    "sqliteTable('ledger_entries'",
    "financialEventId: text('financial_event_id')",
    "accountId: text('account_id')",
  ]);
  fileContains(S, 'ledger_postings table (exact-decimal pair)', schema, [
    "sqliteTable('ledger_postings'",
    "side: text('side', { enum: ['debit', 'credit'] })",
    "amount: text('amount')",
    "amountMicros: integer('amount_micros')",
    "currency: text('currency')",
    "sequence: integer('sequence')",
  ]);

  // Executions / positions.
  fileContains(S, 'instruments table (canonical symbols)', schema, [
    "sqliteTable('instruments'",
    "symbol: text('symbol')",
    "currency: text('currency')",
    "isActive: integer('is_active'",
  ]);
  fileContains(S, 'accounting_executions table (immutable fills)', schema, [
    "sqliteTable('accounting_executions'",
    "action: text('action'",
    "quantity: text('quantity')",
    "price: text('price')",
    "fees: text('fees')",
    "journalTradeId: text('journal_trade_id')",
  ]);
  fileContains(S, 'accounting_executions action enum (6 actions)', schema, [
    "'buy', 'sell', 'sell_short', 'buy_to_cover', 'add', 'reduce'",
  ]);
  fileContains(S, 'account_positions table (projection)', schema, [
    "sqliteTable('account_positions'",
    "direction: text('direction'",
    "averageCost: text('average_cost')",
    "realizedNetPnl: text('realized_net_pnl')",
    "unique('uq_account_positions_account_instrument')",
  ]);
  fileContains(S, 'fifo_lots table (cost-basis slices)', schema, [
    "sqliteTable('fifo_lots'",
    "remainingQuantity: text('remaining_quantity')",
    "originalQuantity: text('original_quantity')",
    "entryPrice: text('entry_price')",
    "openingExecutionId: text('opening_execution_id')",
  ]);
  fileContains(S, 'lot_matches table (realized P&L)', schema, [
    "sqliteTable('lot_matches'",
    "closingExecutionId: text('closing_execution_id')",
    "realizedNetPnl: text('realized_net_pnl')",
    "sequence: integer('sequence')",
  ]);

  // Valuation / performance.
  fileContains(S, 'valuation_marks table (immutable marks)', schema, [
    "sqliteTable('valuation_marks'",
    "priceMicros: integer('price_micros')",
    "source: text('source'",
    "markTimestamp: text('mark_timestamp')",
  ]);
  fileContains(S, 'valuation_marks source enum', schema, [
    "'user', 'market_data', 'import', 'system'",
  ]);
  fileContains(S, 'account_performance table (rebuildable projection)', schema, [
    "sqliteTable('account_performance'",
    "nav: text('nav')",
    "twr: text('twr')",
    "highWaterMark: text('high_water_mark')",
    "drawdown: text('drawdown')",
    "rebuildCount: integer('rebuild_count')",
    "lastRebuiltAt: text('last_rebuilt_at')",
  ]);

  // Correction lineage + migration audit.
  fileContains(S, 'correction_lineage table', schema, [
    "sqliteTable('correction_lineage'",
    "originalExecutionId: text('original_execution_id')",
    "reversalExecutionId: text('reversal_execution_id')",
    "replacementExecutionId: text('replacement_execution_id')",
    "correctedAt: text('corrected_at')",
  ]);
  fileContains(S, 'accounting_migration_runs table', schema, [
    "sqliteTable('accounting_migration_runs'",
    "status: text('status'",
    "rebuildFingerprint: text('rebuild_fingerprint')",
  ]);
  fileContains(S, 'accounting_migration_records table', schema, [
    "sqliteTable('accounting_migration_records'",
    "sourceTable: text('source_table')",
    "sourceId: text('source_id')",
    "anomalyCode: text('anomaly_code')",
  ]);
  fileContains(S, 'migration record status enum', schema, [
    "'mapped', 'anomaly', 'unsupported', 'duplicate'",
  ]);
}

// ── 2. Event types ────────────────────────────────────────────────────
{
  const S = 'EventTypes';
  const types = 'src/lib/accounting/types.ts';
  sections.push(S);

  fileContains(S, 'EVENT_TYPES defined with 12 types', types, [
    "export const EVENT_TYPES = [",
    "'opening_balance'",
    "'trade_execution'",
    "'adjustment'",
    "'transfer'",
    "'deposit'",
    "'withdrawal'",
    "'dividend'",
    "'interest'",
    "'fee'",
    "'tax'",
    "'stock_split'",
    "'manual_adjustment'",
  ]);
  fileContains(S, 'CASH_EVENT_TYPES defined (8 cash types)', types, [
    "export const CASH_EVENT_TYPES",
    "'opening_balance'",
    "'deposit'",
    "'withdrawal'",
    "'dividend'",
    "'interest'",
    "'fee'",
    "'tax'",
    "'manual_adjustment'",
  ]);
  fileContains(S, 'CORPORATE_ACTION_EVENT_TYPES = [stock_split]', types, [
    "export const CORPORATE_ACTION_EVENT_TYPES",
    "'stock_split'",
  ]);
  fileContains(S, 'POSTING_SIDES debit/credit', types, [
    "export const POSTING_SIDES = ['debit', 'credit']",
  ]);
  fileContains(S, 'Effect union (cash/none/market)', types, [
    "export interface CashEffect",
    "kind: 'cash'",
    "direction: 'increase' | 'decrease'",
    "export interface NoCashEffect",
    "export interface MarketEffect",
  ]);
  fileContains(S, 'Posting status + event status types', types, [
    "export type PostingStatus = 'posted' | 'pending' | 'failed'",
    "export interface EventStatus",
    "hasEntry",
    "isBalanced",
  ]);

  // Manual-entry API surface (financial-events POST).
  const apiContracts = 'src/lib/accounting/api-contracts.ts';
  const manualEntryTypes = [
    'opening_balance',
    'deposit',
    'withdrawal',
    'dividend',
    'interest',
    'fee',
    'tax',
    'stock_split',
    'manual_adjustment',
  ];
  fileContains(
    S,
    'Manual-entry API union exposes 9 event types (postFinancialEventSchema)',
    apiContracts,
    [
      'postFinancialEventSchema = z.discriminatedUnion',
      ...manualEntryTypes.map((t) => `eventType: z.literal('${t}')`),
    ],
  );
  fileContains(S, 'Opening-balance API requires positive amount', apiContracts, [
    "openingBalanceSchema",
    "Opening balance amount must be positive",
  ]);
  fileContains(S, 'Adjustment API requires non-zero amount', apiContracts, [
    "manualAdjustmentSchema",
    "Adjustment amount must be non-zero",
  ]);

  // Internal-only event types (key audit facts for T03 determinations).
  fileContains(
    S,
    'trade_execution posted internally (execution-posting, correction, migration)',
    'src/lib/accounting/execution-posting.ts',
    ["eventType: 'trade_execution'"],
  );
  fileContains(
    S,
    'trade_execution reversal/replacement events posted by correction',
    'src/lib/accounting/correction.ts',
    ["eventType: 'trade_execution'"],
  );
  fileContains(
    S,
    'trade_execution events posted by legacy migration runner',
    'src/lib/accounting/legacy-migration-runner.ts',
    ["eventType: 'trade_execution'"],
  );
  // transfer is defined in EVENT_TYPES but has no posting path anywhere in
  // the accounting kernel — the manual API union does not include it.
  let transferPostingPaths = [];
  for (const f of ['posting.ts', 'event-posting.ts', 'correction.ts', 'execution-posting.ts']) {
    try {
      if (readFile(`src/lib/accounting/${f}`).includes("'transfer'")) {
        transferPostingPaths.push(f);
      }
    } catch { /* file missing handled elsewhere */ }
  }
  check(
    S,
    'transfer has no posting path in the kernel (defined but unexposed)',
    transferPostingPaths.length === 0,
    transferPostingPaths.length === 0
      ? 'no transfer posting in posting/event-posting/correction/execution-posting — transfer is MISSING from the pipeline'
      : `unexpected transfer usage in: ${transferPostingPaths.join(', ')}`,
  );
  check(
    S,
    'manual financial-events API does not accept transfer',
    !apiContractsExposes(apiContracts, 'transfer'),
    'transfer absent from postFinancialEventSchema union',
  );
  // adjustment raw type vs manual_adjustment: the API exposes manual_adjustment,
  // and the plain 'adjustment' type has no posting path.
  check(
    S,
    "plain 'adjustment' event type has no posting path (API uses manual_adjustment)",
    !kernelPostsAdjustment(),
    "'adjustment' only appears in the EVENT_TYPES/schema enum — manual_adjustment is the posted form",
  );
}

/** True when api-contracts.ts exposes a literal eventType for `t`. */
function apiContractsExposes(rel, t) {
  try {
    return readFile(rel).includes(`eventType: z.literal('${t}')`);
  } catch {
    return false;
  }
}

/** True when any accounting kernel module posts eventType 'adjustment'. */
function kernelPostsAdjustment() {
  const files = [
    'src/lib/accounting/posting.ts',
    'src/lib/accounting/event-posting.ts',
    'src/lib/accounting/correction.ts',
    'src/lib/accounting/execution-posting.ts',
    'src/lib/accounting/legacy-migration-runner.ts',
  ];
  for (const f of files) {
    try {
      if (readFile(f).includes("eventType: 'adjustment'")) return true;
    } catch { /* skip */ }
  }
  return false;
}

// ── 3. Posting kernel ─────────────────────────────────────────────────
{
  const S = 'PostingKernel';
  const posting = 'src/lib/accounting/posting.ts';
  sections.push(S);

  moduleExports(S, 'posting.ts exports posting kernel', posting, [
    'postFinancialEvent',
    'postOpeningBalance',
    'validatePostingAmount',
    'validateNonNegativePostingAmount',
  ]);
  fileContains(S, 'Strict validator rejects non-positive amounts', posting, [
    'Amount must be positive',
  ]);
  fileContains(S, 'Relaxed validator allows zero, rejects negatives', posting, [
    'Allow zero (for non-cash events like stock splits)',
    'Amount must not be negative',
  ]);
  fileContains(S, 'stock_split uses relaxed (zero-amount) validator', posting, [
    "eventType === 'stock_split'",
    'validateNonNegativePostingAmount',
  ]);
  fileContains(S, 'Micros safe-integer bounds enforced', posting, [
    'Number.MAX_SAFE_INTEGER',
    'InvalidMicrosBoundsError',
  ]);
  fileContains(S, 'Canonical decimal validated via validateDecimal', posting, [
    "from './decimal'",
    'validateDecimal',
  ]);
  fileContains(S, 'Pre-transaction idempotency check', posting, [
    'findEventByIdempotencyKey',
    'DuplicateIdempotencyKeyError',
  ]);
  fileContains(S, 'Account existence check', posting, [
    'accountExists',
    'AccountNotFoundError',
  ]);
  fileContains(S, 'Atomic transaction (better-sqlite3)', posting, [
    'sqlite.transaction(',
  ]);
  fileContains(S, 'Balanced debit/credit pair with stable sequence', posting, [
    "side: 'debit'",
    "side: 'credit'",
    'nextSeq + 1',
  ]);
  fileContains(S, 'Insert helpers come from accounting-repository', posting, [
    "from '../../db/accounting-repository'",
    'insertFinancialEvent',
    'insertLedgerEntry',
    'insertLedgerPosting',
    'getNextSequence',
  ]);
  fileContains(S, 'postOpeningBalance hard-codes opening_balance type', posting, [
    "eventType: 'opening_balance'",
  ]);
}

// ── 4. Event-posting / execution-posting bridges ──────────────────────
{
  const S = 'EventExecutionPosting';
  sections.push(S);

  moduleExports(S, 'event-posting.ts bridge exports', 'src/lib/accounting/event-posting.ts', [
    'computePayload',
    'computeEffect',
    'getPostingAmount',
    'postEventWithEffect',
  ]);
  fileContains(S, 'postEventWithEffect delegates to kernel with payload/effect', 'src/lib/accounting/event-posting.ts', [
    'return postFinancialEvent(sqlite, {',
    'payload: JSON.stringify(payload)',
    'effect: JSON.stringify(effect)',
  ]);

  moduleExports(S, 'execution-posting.ts exports', 'src/lib/accounting/execution-posting.ts', [
    'executionFinancialEventIdempotencyKey',
    'buildExecutionFinancialEventInput',
    'ensureExecutionFinancialEvent',
    'postExecutionFill',
  ]);
  fileContains(S, 'Execution idempotency key is deterministic per execution', 'src/lib/accounting/execution-posting.ts', [
    'executionFinancialEventIdempotencyKey',
    'accounting-execution-${accountingExecutionId}',
  ]);

  // API wiring (financial-events and executions routes).
  fileContains(
    S,
    'POST /financial-events uses postEventWithEffect + postFinancialEventSchema',
    'src/app/api/accounts/[id]/financial-events/route.ts',
    ['postEventWithEffect', 'postFinancialEventSchema', 'listAccountEvents', 'countAccountEvents'],
  );
  fileContains(
    S,
    'POST /executions uses postExecutionFill + FIFO + rebuilds',
    'src/app/api/accounts/[id]/executions/route.ts',
    ['postExecutionFill', 'rebuildPositions', 'allocateFifo', 'rebuildAccountPerformance'],
  );
}

// ── 5. Correction infrastructure ──────────────────────────────────────
{
  const S = 'Correction';
  sections.push(S);

  moduleExports(S, 'correction.ts exports correctExecution', 'src/lib/accounting/correction.ts', [
    'correctExecution',
    'CorrectExecutionInput',
    'CorrectExecutionResult',
  ]);
  fileContains(S, 'Reversal-and-replacement pattern (original never mutated)', 'src/lib/accounting/correction.ts', [
    'reversal-and-replacement pattern',
    'Create reversal execution',
    'Create replacement execution',
    "correctionType: 'reversal'",
    "correctionType: 'replacement'",
  ]);
  fileContains(S, 'Reversal + replacement posted as trade_execution events', 'src/lib/accounting/correction.ts', [
    "eventType: 'trade_execution'",
    'executionFinancialEventIdempotencyKey(reversalExecution.id)',
    'executionFinancialEventIdempotencyKey(replacementExecution.id)',
  ]);
  fileContains(S, 'Lineage record links original/reversal/replacement', 'src/lib/accounting/correction.ts', [
    'insertCorrectionLineage',
    'originalExecutionId: originalExecution.id',
    'reversalExecutionId: reversalExecution.id',
    'replacementExecutionId: replacementExecution.id',
  ]);
  fileContains(S, 'Positions and performance rebuilt after correction', 'src/lib/accounting/correction.ts', [
    'rebuildPositions(sqlite, accountId,',
    'rebuildAccountPerformance(sqlite, accountId)',
  ]);
  fileContains(S, 'Correction guard errors enforced', 'src/lib/accounting/errors.ts', [
    'ExecutionAlreadyCorrectedError',
    'ExecutionNotMutableError',
    'DuplicateCorrectionIdempotencyError',
  ]);
  fileContains(S, 'Correction errors used by correctExecution', 'src/lib/accounting/correction.ts', [
    'ExecutionAlreadyCorrectedError',
    'ExecutionNotMutableError',
    'DuplicateCorrectionIdempotencyError',
  ]);

  // Contracts.
  fileContains(S, 'correction-contracts action enum (6 actions)', 'src/lib/accounting/correction-contracts.ts', [
    "EXECUTION_ACTION_VALUES = [",
    "'buy'",
    "'sell'",
    "'sell_short'",
    "'buy_to_cover'",
    "'add'",
    "'reduce'",
  ]);
  fileContains(S, 'reverseAction maps to opposite action', 'src/lib/accounting/correction-contracts.ts', [
    'export function reverseAction',
    'buy: \'sell\'',
    'sell: \'buy\'',
    'sell_short: \'buy_to_cover\'',
    'buy_to_cover: \'sell_short\'',
    'add: \'reduce\'',
    'reduce: \'add\'',
  ]);
  moduleExports(S, 'correction-contracts response schemas', 'src/lib/accounting/correction-contracts.ts', [
    'correctionInputSchema',
    'correctionExecutionResponseSchema',
    'correctionPositionResponseSchema',
    'correctionResponseSchema',
  ]);

  // API wiring.
  fileContains(
    S,
    'POST /executions/[id]/correct uses correctExecution + correctionInputSchema',
    'src/app/api/accounts/[id]/executions/[executionId]/correct/route.ts',
    ['correctExecution', 'correctionInputSchema'],
  );
}

// ── 6. Rebuild paths ──────────────────────────────────────────────────
{
  const S = 'Rebuild';
  sections.push(S);

  moduleExports(S, 'rebuild.ts exports projection rebuilders', 'src/lib/accounting/rebuild.ts', [
    'rebuildOpeningCash',
    'rebuildAccountActivity',
    'rebuildNetPosition',
    'checkLedgerBalance',
  ]);
  fileContains(S, 'Opening cash = sum of debit opening-balance postings', 'src/lib/accounting/rebuild.ts', [
    "fe.event_type = 'opening_balance'",
    "lp.side = 'debit'",
    'totalMicros += debitPosting.amount_micros',
  ]);
  fileContains(S, 'Net position = debit total - credit total', 'src/lib/accounting/rebuild.ts', [
    "lp.side = 'debit'",
    "lp.side = 'credit'",
    'debitTotal.total - creditTotal.total',
  ]);
  fileContains(S, 'Global ledger balance check (debit == credit)', 'src/lib/accounting/rebuild.ts', [
    'checkLedgerBalance',
    'isBalanced: difference === 0',
  ]);
  fileContains(S, 'Rebuild is deterministic (no random IDs, sorted by sequence)', 'src/lib/accounting/rebuild.ts', [
    'events.sort((a, b) => a.sequence - b.sequence)',
    'Pure projection logic — no mutations, no random IDs',
  ]);

  moduleExports(S, 'positions/rebuild.ts exports', 'src/lib/positions/rebuild.ts', [
    'rebuildPositions',
    'rebuildPositionsWithinTransaction',
  ]);
  moduleExports(S, 'performance-rebuild.ts exports', 'src/lib/performance/performance-rebuild.ts', [
    'rebuildAccountPerformance',
    'PerformanceRebuildResult',
    'PerformanceRebuildOptions',
  ]);

  // Migration CLI (rebuild path operator surface).
  fileContains(S, 'accounting-migrate CLI supports migrate/reconcile/cutover-check/rebuild', 'scripts/accounting-migrate.ts', [
    'migrate <accountId>',
    'reconcile <accountId>',
    'cutover-check <accountId>',
    'rebuild <accountId>',
  ]);
  fileContains(S, 'accounting-migrate CLI exit-code contract (0/1/2)', 'scripts/accounting-migrate.ts', [
    '0 — success / cutover eligible',
    '1 — anomalies detected / cutover refused',
    '2 — runtime error',
  ]);
  fileContains(S, 'POST /migration route runs the legacy migration', 'src/app/api/accounts/[id]/migration/route.ts', [
    'runLegacyMigration',
  ]);
}

// ── 7. Projection libraries (ledger / activity / reconciliation) ──────
{
  const S = 'Projections';
  sections.push(S);

  moduleExports(S, 'ledger.ts exports projection builder', 'src/lib/accounting/ledger.ts', [
    'buildLedgerProjection',
    'EVENT_CATEGORIES',
    'DEFAULT_PAGE_LIMIT',
    'MAX_PAGE_LIMIT',
  ]);
  fileContains(S, 'Ledger pagination limits (50 default / 200 max)', 'src/lib/accounting/ledger.ts', [
    'export const DEFAULT_PAGE_LIMIT = 50',
    'export const MAX_PAGE_LIMIT = 200',
  ]);
  fileContains(S, 'Ledger projection handles correction groups', 'src/lib/accounting/ledger.ts', [
    'CorrectionGroupInput',
    'CorrectionGroupDisplay',
    'CorrectionGroup',
  ]);

  moduleExports(S, 'activity.ts exports', 'src/lib/accounting/activity.ts', [
    'computeAccountActivity',
    'computeAccountCashImpact',
    'computeRebuildCashFlow',
  ]);
  fileContains(S, 'Activity computes cash impact per event', 'src/lib/accounting/activity.ts', [
    'kind: \'cash\'',
    'direction',
  ]);

  moduleExports(S, 'reconciliation.ts exports', 'src/lib/accounting/reconciliation.ts', [
    'computeReconciliation',
    'ReconciliationReport',
    'AnomalySummary',
  ]);
  fileContains(S, 'Reconciliation classifies match/explained/unexplained', 'src/lib/accounting/reconciliation.ts', [
    "'match' | 'explained' | 'unexplained'",
  ]);

  moduleExports(S, 'freshness-policy.ts exports', 'src/lib/accounting/freshness-policy.ts', [
    'createFreshnessPolicy',
    'resolveFreshnessPolicy',
    'classifyMarkStatus',
    'classifyCompleteness',
  ]);
  fileContains(S, 'Default freshness threshold is 1440 minutes (24h)', 'src/lib/accounting/freshness-policy.ts', [
    'export const DEFAULT_FRESHNESS_THRESHOLD_MINUTES = 1440',
  ]);

  // API wiring.
  fileContains(
    S,
    'GET /ledger uses buildLedgerProjection + correction-group resolution',
    'src/app/api/accounts/[id]/ledger/route.ts',
    ['buildLedgerProjection', 'resolveCorrectionGroupsForAccount'],
  );
  fileContains(
    S,
    'GET /reconciliation uses computeReconciliation',
    'src/app/api/accounts/[id]/reconciliation/route.ts',
    ['computeReconciliation'],
  );
  moduleExports(S, 'ledger-route-helpers.ts exports', 'src/lib/accounting/ledger-route-helpers.ts', [
    'resolveCorrectionGroup',
    'resolveCorrectionGroupsForAccount',
  ]);
}

// ── 8. Legacy accounting migration ────────────────────────────────────
{
  const S = 'LegacyMigration';
  sections.push(S);

  moduleExports(S, 'legacy-migration.ts mappers + classifier', 'src/lib/accounting/legacy-migration.ts', [
    'buildIdempotencyKey',
    'mapAccountTransactionToCashEvent',
    'mapTradeExecutionToExecutionInput',
    'mapPriceSnapshotToValuationMark',
    'classifyLegacyRecord',
  ]);
  fileContains(S, 'Migration anomaly codes stable (ANOMALY_ prefix)', 'src/lib/accounting/legacy-migration.ts', [
    'ANOMALY_UNSUPPORTED_EVENT_TYPE',
    'ANOMALY_UNSUPPORTED_EXECUTION_ACTION',
    'ANOMALY_DUPLICATE_SOURCE_IDENTITY',
    'ANOMALY_UNSUPPORTED_RECORD',
  ]);
  fileContains(S, 'Migration covers 3 legacy source types', 'src/lib/accounting/legacy-migration.ts', [
    'LegacyAccountTransaction',
    'LegacyTradeExecution',
    'LegacyPriceSnapshot',
  ]);

  moduleExports(S, 'legacy-migration-runner.ts exports', 'src/lib/accounting/legacy-migration-runner.ts', [
    'runLegacyMigration',
    'findLatestMigrationRun',
    'listMigrationRecords',
  ]);
  fileContains(S, 'Migration runner writes run + record audit rows', 'src/lib/accounting/legacy-migration-runner.ts', [
    'accounting_migration_runs',
    'accounting_migration_records',
  ]);
  fileContains(S, 'Migration runner rebuilds projections after run', 'src/lib/accounting/legacy-migration-runner.ts', [
    'rebuildAccountPerformance',
    'rebuildPositions',
  ]);
}

// ── 9. Positions / FIFO / performance libraries ───────────────────────
{
  const S = 'PositionsPerformance';
  sections.push(S);

  fileContains(S, 'positions/types.ts direction + action constants', 'src/lib/positions/types.ts', [
    "export const POSITION_DIRECTIONS = ['long', 'short']",
    "export const EXECUTION_ACTIONS = [",
    "export const LONG_OPENING_ACTIONS",
    "export const SHORT_OPENING_ACTIONS",
  ]);
  moduleExports(S, 'positions/types.ts helpers', 'src/lib/positions/types.ts', [
    'actionImpliedDirection',
    'resolveEffectiveDirection',
    'FIFO_REJECTION_MESSAGES',
  ]);
  moduleExports(S, 'fifo.ts exports allocateFifo', 'src/lib/positions/fifo.ts', [
    'allocateFifo',
  ]);
  moduleExports(S, 'trade-execution-idempotency.ts exports', 'src/lib/trade-execution-idempotency.ts', [
    'tradeExecutionIdempotencyKey',
  ]);

  moduleExports(S, 'performance.ts exports', 'src/lib/performance/performance.ts', [
    'computeModifiedDietzReturn',
    'computeTwr',
    'computeHighWaterMarkAndDrawdown',
    'computePerformance',
  ]);
  moduleExports(S, 'valuation.ts exports', 'src/lib/performance/valuation.ts', [
    'computeMarkStatus',
    'computeMarkAgeMinutes',
    'computeMarkedValue',
    'absoluteQuantity',
  ]);
  fileContains(S, 'Valuation default freshness threshold 24h', 'src/lib/performance/valuation.ts', [
    'export const DEFAULT_FRESHNESS_THRESHOLD_MINUTES = 24 * 60',
  ]);
  fileContains(S, 'valuation-repository validates marks on insert', 'src/lib/performance/valuation-repository.ts', [
    'insertValidatedValuationMark',
    'ValuationMarkError',
  ]);
}

// ── 10. Database-level immutability ───────────────────────────────────
{
  const S = 'Immutability';
  sections.push(S);

  const triggersByMigration = {
    '0024_immutable_ledger_postings.sql': [
      'trg_financial_events_prevent_update',
      'trg_financial_events_prevent_delete',
      'trg_ledger_entries_prevent_update',
      'trg_ledger_entries_prevent_delete',
      'trg_ledger_postings_prevent_update',
      'trg_ledger_postings_prevent_delete',
    ],
    '0026_accounting_executions_fifo_positions.sql': [
      'trg_accounting_executions_prevent_update',
      'trg_accounting_executions_prevent_delete',
    ],
    '0027_accounting_valuation_performance.sql': [
      'trg_valuation_marks_prevent_update',
      'trg_valuation_marks_prevent_delete',
    ],
    '0028_legacy_accounting_migration.sql': [
      'trg_migration_runs_prevent_delete',
      'trg_migration_records_prevent_update',
      'trg_migration_records_prevent_delete',
    ],
    '0029_correction_lineage.sql': [
      'trg_correction_lineage_prevent_update',
      'trg_correction_lineage_prevent_delete',
    ],
  };

  for (const [migration, triggers] of Object.entries(triggersByMigration)) {
    fileContains(
      S,
      `${migration} defines immutability triggers`,
      `src/db/migrations/${migration}`,
      triggers,
    );
  }
  fileContains(S, '0025 adds payload/effect columns', 'src/db/migrations/0025_financial_event_payload.sql', [
    'ALTER TABLE financial_events ADD COLUMN payload TEXT',
    'ALTER TABLE financial_events ADD COLUMN effect TEXT',
  ]);
  fileContains(S, 'Triggers ABORT (RAISE) on mutation', 'src/db/migrations/0024_immutable_ledger_postings.sql', [
    'RAISE(ABORT, \'Cannot update a posted financial event',
    'RAISE(ABORT, \'Cannot delete a posted financial event',
  ]);
  fileContains(S, 'Migrations auto-applied at DB startup', 'src/db/index.ts', [
    'Auto-apply pending migrations on startup',
    '__drizzle_migrations',
  ]);
}

// ── 11. Accounting repository layer ───────────────────────────────────
{
  const S = 'Repository';
  const repo = 'src/db/accounting-repository.ts';
  sections.push(S);

  filePresent(S, 'accounting-repository.ts present', repo);
  moduleExports(S, 'Posting/ledger repository functions', repo, [
    'insertFinancialEvent',
    'insertLedgerEntry',
    'insertLedgerPosting',
    'getNextSequence',
    'findEventByIdempotencyKey',
    'findEventWithPostings',
    'listAccountEvents',
    'accountExists',
  ]);
  moduleExports(S, 'Execution/position repository functions', repo, [
    'insertAccountingExecution',
    'findAccountingExecutionById',
    'findAccountingExecutionByIdempotencyKey',
    'upsertAccountPosition',
    'insertFifoLots',
    'findFifoLotsByAccountInstrument',
    'insertLotMatches',
    'deleteProjectionByAccountInstrument',
  ]);
  moduleExports(S, 'Valuation/performance/correction repository functions', repo, [
    'insertValuationMark',
    'listLatestValuationMarks',
    'upsertAccountPerformance',
    'findAccountPerformance',
    'insertCorrectionLineage',
    'findCorrectionByOriginalExecution',
    'listCorrectionsByAccount',
  ]);
  fileContains(S, 'Repository imported by posting kernel', 'src/lib/accounting/posting.ts', [
    "from '../../db/accounting-repository'",
  ]);
  fileContains(S, 'Repository imported by correction service', 'src/lib/accounting/correction.ts', [
    "from '../../db/accounting-repository'",
  ]);
}

// ── 12. Test coverage and registration ────────────────────────────────
{
  const S = 'Tests';
  sections.push(S);

  const libTests = [
    'src/lib/accounting/decimal.test.ts',
    'src/lib/accounting/posting.test.ts',
    'src/lib/accounting/rebuild.test.ts',
    'src/lib/accounting/ledger.test.ts',
    'src/lib/accounting/reconciliation.test.ts',
    'src/lib/accounting/correction.test.ts',
    'src/lib/accounting/legacy-migration.test.ts',
    'src/lib/accounting/legacy-migration-runner.test.ts',
    'src/lib/accounting/dashboard-v2.test.ts',
  ];
  const integrationTests = [
    'src/lib/accounting/__tests__/accounting-integration.test.ts',
    'src/lib/accounting/__tests__/opening-balance-flow.test.ts',
    'src/lib/accounting/__tests__/financial-event-contracts.test.ts',
    'src/lib/accounting/__tests__/financial-event-posting.test.ts',
    'src/lib/accounting/__tests__/activity-rebuild.test.ts',
    'src/lib/accounting/__tests__/financial-events-integration.test.ts',
    'src/lib/accounting/__tests__/execution-contracts.test.ts',
    'src/lib/accounting/__tests__/execution-posting.integration.test.ts',
    'src/lib/accounting/__tests__/dashboard-journal-linked.test.ts',
    'src/lib/accounting/__tests__/dashboard-journal-reconciliation.test.ts',
    'src/lib/accounting/__tests__/dashboard-snapshot-contract.test.ts',
    'src/lib/accounting/__tests__/freshness-policy.test.ts',
  ];
  const positionsTests = [
    'src/lib/positions/fifo.test.ts',
    'src/lib/positions/rebuild.test.ts',
    'src/lib/positions/trade-execution-sync.test.ts',
  ];
  const performanceTests = [
    'src/lib/performance/performance.test.ts',
    'src/lib/performance/performance-rebuild.test.ts',
    'src/lib/performance/valuation.test.ts',
  ];

  const allTests = [...libTests, ...integrationTests, ...positionsTests, ...performanceTests];
  for (const t of allTests) {
    filePresent(S, `Kernel test ${path.relative('src', t)}`, t);
  }

  // Registration: vitest.config.ts uses an explicit include array — any
  // unregistered test silently never runs. Every kernel test must be listed.
  let vitest = '';
  try {
    vitest = readFile('vitest.config.ts');
  } catch {
    check(S, 'vitest.config.ts readable', false, 'file missing');
  }
  if (vitest) {
    const unregistered = [];
    for (const t of allTests) {
      if (!vitest.includes(t)) unregistered.push(path.relative('src', t));
    }
    check(
      S,
      'every kernel test registered in vitest.config.ts include',
      unregistered.length === 0,
      unregistered.length === 0
        ? `${allTests.length}/${allTests.length} registered`
        : `${unregistered.length} unregistered: ${unregistered.join(', ')}`,
    );
  }
}

// ── Summary ───────────────────────────────────────────────────────────
const facts = {
  eventTypes: {
    total: 12,
    cash: 8,
    corporateAction: ['stock_split'],
    manualEntryApiUnion: [
      'opening_balance', 'deposit', 'withdrawal', 'dividend', 'interest',
      'fee', 'tax', 'stock_split', 'manual_adjustment',
    ],
    internalOnly: {
      trade_execution: 'posted by execution-posting, correction reversal/replacement, migration runner',
      transfer: 'defined in EVENT_TYPES/schema enum only — no posting path, not in API union (MISSING)',
      adjustment: 'defined in EVENT_TYPES/schema enum only — API exposes manual_adjustment instead (no raw posting path)',
    },
  },
  postingKernel: {
    exports: ['postFinancialEvent', 'postOpeningBalance', 'validatePostingAmount', 'validateNonNegativePostingAmount'],
    balancedPair: true,
    immutabilityTriggers: 15,
    migrationFiles: ['0024_immutable_ledger_postings', '0025_financial_event_payload', '0026_accounting_executions_fifo_positions', '0027_accounting_valuation_performance', '0028_legacy_accounting_migration', '0029_correction_lineage'],
  },
  schemaTables: [
    'financial_events', 'ledger_entries', 'ledger_postings', 'instruments',
    'accounting_executions', 'account_positions', 'fifo_lots', 'lot_matches',
    'valuation_marks', 'account_performance', 'correction_lineage',
    'accounting_migration_runs', 'accounting_migration_records',
  ],
  correction: {
    pattern: 'reversal-and-replacement',
    lineage: 'correction_lineage links original/reversal/replacement',
    rebuilds: ['rebuildPositions', 'rebuildAccountPerformance'],
  },
  rebuildPaths: [
    'rebuildOpeningCash (sum of debit opening-balance postings)',
    'rebuildAccountActivity (raw event projection)',
    'rebuildNetPosition (debit - credit)',
    'checkLedgerBalance (global debit == credit)',
    'rebuildPositions / rebuildPositionsWithinTransaction',
    'rebuildAccountPerformance (NAV/TWR/HWM/drawdown)',
    'scripts/accounting-migrate.ts CLI (migrate|reconcile|cutover-check|rebuild)',
  ],
  ledgerProjection: {
    pageLimits: { default: 50, max: 200 },
    correctionGroups: true,
  },
  migration: {
    anomalyCodes: 'ANOMALY_* stable codes',
    sourceTables: ['account_transactions', 'trade_executions', 'position_price_snapshots'],
    runner: 'runLegacyMigration / findLatestMigrationRun / listMigrationRecords',
  },
};

const summary = {
  tool: 'audit-s01-backend',
  task: 'T02',
  slice: 'S01',
  milestone: 'M006-t7xrwf',
  timestamp: new Date().toISOString(),
  checksRun: passCount + failCount,
  passed: passCount,
  failed: failCount,
  sections,
  failures,
  verdict: failCount === 0 ? 'PASS' : 'FAIL',
  facts,
};

console.log('');
console.log(`SUMMARY: ${passCount} passed, ${failCount} failed, ${passCount + failCount} total`);
console.log('AUDIT_JSON_BEGIN');
console.log(JSON.stringify(summary, null, 2));
console.log('AUDIT_JSON_END');

process.exit(failCount === 0 ? 0 : 1);
