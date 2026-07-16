/**
 * Account Detail Inventory — authoritative seam map, response shape registry,
 * legacy consumer inventory, and intended field destination.
 *
 * Written during T01 of M035-s6wrkx.  Downstream slices read this to
 * understand which fields exist, where they come from, who reads them,
 * and where they should land in the redesign.
 *
 * @module __fixtures__/account-detail-inventory
 */

// ═══════════════════════════════════════════════════════════════════════════
// Repository Seams
// ═══════════════════════════════════════════════════════════════════════════

/**
 * There are two independent data authorities in the system:
 *
 * LEGACY (src/lib/account-summary.ts, src/db/schema.ts):
 *   - trades, tradeExecutions, tradeRiskSnapshots, tradeGrades
 *   - accountTransactions (deposits/withdrawals)
 *   - Query pattern: Drizzle ORM via db instance, in-memory KPI computation
 *   - Functions: computeAccountKPIs(), computeAccountBalance()
 *   - Used by: GET /api/accounts/[id] (hybrid), POST /api/accounts/[id]/close
 *   - Status: being replaced by accounting projection; fields confined to
 *     collaboration mode (legacyAudit) pending cutover
 *
 * ACCOUNTING (src/db/accounting-repository.ts, src/lib/accounting/):
 *   - financial_events, ledger_entries, ledger_postings
 *   - accounting_executions, fifo_lots, lot_matches, correction_lineage
 *   - account_positions, account_performance, valuation_marks
 *   - migration_runs, migration_records
 *   - Query pattern: raw better-sqlite3 via getSqliteHandle()
 *   - Functions: findAccountPerformance(), listAccountPositions(),
 *     computeReconciliation(), correctExecution(), computeAccountActivity()
 *   - Used by: GET /api/accounts/[id] (hybrid), GET /api/dashboard/v2,
 *     POST financial-events, POST corrections, positions GET
 *   - Status: authoritative for overview, ledger, positions tabs
 */

// ═══════════════════════════════════════════════════════════════════════════
// Current GET /api/accounts/[id] Response Shape (as of July 2026)
// ═══════════════════════════════════════════════════════════════════════════

export const ACCOUNT_RESPONSE_SHAPE = {
  /** Source: accounts table via Drizzle SELECT. */
  id: 'string',
  name: 'string',
  broker: 'string | null',
  currency: 'string',
  startingBalance: 'number | null',
  maxRiskPerTradePct: 'number | null',
  defaultCommission: 'number | null',
  isActive: 'boolean',
  createdAt: 'string (ISO-8601)',
  updatedAt: 'string (ISO-8601)',

  // ── Derived metric fields ─────────────────────────────────────────
  /**
   * currentBalance: number
   * Source: ledger NAV (parseFloat(accountingNAV)) when projection exists,
   *         otherwise legacyBalance.currentBalance from computeAccountBalance().
   * Consumer destination: Overview → NAV snapshot card.
   */
  currentBalance: 'number',

  /**
   * realizedPnl: number
   * Source: ledger realizedPnl when projection exists,
   *         otherwise legacyBalance.realizedPnl from computeAccountBalance().
   * Consumer destination: Overview → Net P&L metric.
   */
  realizedPnl: 'number',

  /**
   * netDeposits: number
   * Source: computeAccountBalance() legacy path.
   * Consumer destination: Overview → deposit metric OR computed on-the-fly from financial events.
   */
  netDeposits: 'number',

  /**
   * netWithdrawals: number
   * Source: computeAccountBalance() legacy path.
   * Consumer destination: Confined to Reconciliation tab.
   */
  netWithdrawals: 'number',

  // ── KPI sub-object ────────────────────────────────────────────────
  /**
   * kpis: { tradeCount, netPnl, winRate, avgR, avgGrade }
   * Source: computeAccountKPIs() from legacy trades/executions/risk-snapshots/grades.
   * netPnl is overridden by ledger realizedPnl when projection exists.
   * Consumer destination: Confined to Reconciliation / legacy comparison.
   */
  kpis: {
    tradeCount: 'number',
    netPnl: 'number',
    winRate: 'number | null',
    avgR: 'number | null',
    avgGrade: 'number | null',
  },

  // ── Accounting projection sub-object ──────────────────────────────
  /**
   * accounting: { projection, realizedPnl, nav, ledgerDerived }
   * Source: findAccountPerformance() from account_performance table.
   * Consumer destination: Overview by selected fields; entire object
   *   confined to Reconciliation tab.
   */
  accounting: {
    projection: {
      netCash: 'string',
      nav: 'string',
      markedPositions: 'string',
      realizedPnl: 'string',
      unrealizedPnl: 'string',
      totalPnl: 'string',
      realizedFees: 'string',
      grossExposure: 'string',
      netExposure: 'string',
      modifiedDietzReturn: 'string | null',
      twr: 'string | null',
      highWaterMark: 'string | null',
      drawdown: 'string | null',
      drawdownPct: 'string | null',
      computedAt: 'string',
      rebuildCount: 'number',
      lastRebuiltAt: 'string | null',
    } as const,
    realizedPnl: 'string | null',
    nav: 'string | null',
    ledgerDerived: 'boolean',
  } as const,

  // ── Reconciliation / integrity sub-object ─────────────────────────
  /**
   * accountingIntegrity: { status, cutoverEligible, ... }
   * Source: computeReconciliation() from reconciliation engine.
   * Consumer destination: Reconciliation tab only (banner state + full report).
   */
  accountingIntegrity: {
    status: "'eligible' | 'stale' | 'blocked'",
    cutoverEligible: 'boolean',
    cutoverRefusalReasons: 'string[]',
    totals: {
      comparisons: 'number',
      matching: 'number',
      explained: 'number',
      unexplained: 'number',
    } as const,
    runId: 'string',
    runStatus: 'string',
    computedAt: 'string',
    recordStatusCounts: {
      mappedCount: 'number',
      anomalyCount: 'number',
      unsupportedCount: 'number',
      duplicateCount: 'number',
      totalRecords: 'number',
    } as const,
  } as const,

  // ── Legacy audit sub-object ──────────────────────────────────────
  /**
   * legacyAudit: { kpis, realizedPnl, currentBalance, ... }
   * Source: pre-cutover legacy computations, preserved for comparison.
   * Consumer destination: Confined to Reconciliation tab exclusively.
   */
  legacyAudit: {
    kpis: '{ tradeCount, netPnl, winRate, avgR, avgGrade }',
    realizedPnl: 'number',
    currentBalance: 'number',
    netDeposits: 'number',
    netWithdrawals: 'number',
  } as const,
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// Response Contract Test Coverage
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The fixture file src/lib/__fixtures__/response-contracts.test.ts asserts:
 * - Account detail returns { ...account, ...balance, kpis }
 * - currentBalance, netDeposits, netWithdrawals, realizedPnl are numbers
 * - kpis has tradeCount, netPnl, winRate, avgR, avgGrade
 *
 * It does NOT currently assert:
 * - accounting / accountingIntegrity / legacyAudit sub-objects
 * - ledgerDerived flag semantics
 * - accountingIntegrity.status value constraints
 *
 * The account route test file tests KPI edge cases (no closed trades,
 * closed trades with risk snapshots, closed trades with grades).
 */

// ═══════════════════════════════════════════════════════════════════════════
// Legacy Consumer Inventory
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Who calls GET /api/accounts/[id] and what fields they consume:
 *
 * 1. src/app/accounts/[id]/page.tsx (Account detail page)
 *    - Homepage-like detail page with performance, positions, activity.
 *    - Consumes: account.*, currentBalance, netDeposits, kpis.netPnl,
 *      accounting.projection, accountingIntegrity
 *    - Intended destination after redesign:
 *      → Overview tab (account identity, NAV, net P&L, net cash)
 *      → Positions tab (moved to separate route segment)
 *      → Ledger tab (moved to separate route segment)
 *      → Reconciliation tab (accountingIntegrity)
 *
 * 2. src/app/settings/accounts/[id]/page.tsx (Settings page)
 *    - Identity/defaults/lifecycle controls.
 *    - Consumes: account.*, currentBalance, kpis.netPnl, accounting.projection.nav,
 *      accountingIntegrity
 *    - Intended destination after redesign:
 *      → Settings tab under /accounts/[id]/settings
 *      → Route is eventually redirected from /settings/accounts/[id] → /accounts/[id]/settings
 *
 * 3. src/lib/__fixtures__/response-contracts.test.ts
 *    - Contract-level response shape assertions.
 *    - Currently only asserts the sparse { ...account, ...balance, kpis } shape.
 *    - Will need UPDATE to match new response shape after redesign.
 *
 * 4. src/app/api/accounts/[id]/__tests__/route.test.ts
 *    - Route behavior tests, KPI edge cases.
 *    - Assertions on kpis sub-object.
 *
 * 5. src/app/api/accounts/[id]/close/__tests__/route.test.ts
 *    - Fetches account before close, reads kpis.tradeCount etc.
 *
 * Who does NOT call GET /api/accounts/[id]:
 * - Dashboard (calls GET /api/dashboard/v2 instead)
 * - Positions page (calls GET /api/accounts/[id]/positions directly)
 * - Financial events page (calls GET /api/accounts/[id]/financial-events directly)
 * - Performance page (calls GET /api/accounts/[id]/performance directly)
 * - Reconciliation page (calls GET /api/accounts/[id]/reconciliation directly)
 */

// ═══════════════════════════════════════════════════════════════════════════
// Intended Field Destination Map (for the redesign)
// ═══════════════════════════════════════════════════════════════════════════

export const FIELD_DESTINATIONS = {
  /** Keep at top-level for backward compat; Overview tab uses NAV directly. */
  currentBalance: 'overview-primary',

  /** Overview → Net P&L; existing consumers use kpis.netPnl as fallback. */
  realizedPnl: 'overview-primary',

  /** Ledger tab: displayed in cash flow summary; computed from financial events. */
  netDeposits: 'overview-ledger',

  /** Confine to Reconciliation tab exclusively. */
  netWithdrawals: 'reconciliation',

  /** Confine to Reconciliation tab exclusively (legacy comparison). */
  kpis: 'reconciliation',

  /** Overview tab uses selected fields (NAV, Cash, Unrealized, Realized). */
  'accounting.projection': 'overview-reconciliation',

  /** Reconciliation tab banner state. */
  accountingIntegrity: 'reconciliation',

  /** Confine to Reconciliation tab exclusively. */
  legacyAudit: 'reconciliation',

  /** Overview tab: account identity block. */
  'account.*': 'overview-header',

  /** Settings tab: identity + defaults + lifecycle. */
  'account.*settings*': 'settings',
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// Duplicate Execution Risk Register
// ═══════════════════════════════════════════════════════════════════════════

export const DUPLICATE_EXECUTION_RISKS = [
  {
    risk: 'legacy trade_executions vs accounting_executions join',
    description:
      'The legacy trades/tradeExecutions tables store executions for journal trades. ' +
      'The accounting_executions table stores the authoritative accounting entries ' +
      'from financial events with type trade_execution. Joining both produces duplicate rows.',
    mitigation:
      'The overview and ledger adapters MUST query accounting_executions for ' +
      'authoritative execution data and use the journal_trade_id column for ' +
      'cross-referencing to legacy trades rather than joining trade_executions.',
    status: 'active',
  },
  {
    risk: 'correction triples create display row inflation',
    description:
      'Each correction creates 3 accounting_execution rows: original, reversal, replacement. ' +
      'Naively listing accounting_executions without grouping by correction_lineage ' +
      'produces inflated event counts.',
    mitigation:
      'Ledger adapter MUST group correction triples into a single display row, ' +
      'retaining original/reversal/replacement IDs for expandable audit detail.',
    status: 'active',
  },
  {
    risk: 'migration records duplication',
    description:
      'The migration_records table stores per-source-record reconciliation status. ' +
      'A ledger query that joins migration_records to accounting_executions or ' +
      'financial_events can multiply rows if not scoped correctly.',
    mitigation:
      'Use financial_events as the authoritative event source. Do not join ' +
      'migration records into event/list responses.',
    status: 'active',
  },
] as const;

// ═══════════════════════════════════════════════════════════════════════════
// Overview Adapter Data Requirements
// ═══════════════════════════════════════════════════════════════════════════

export const OVERVIEW_ADAPTER_DATA = {
  snapshot: [
    { field: 'nav', source: 'findAccountPerformance().nav', format: 'string (canonical decimal)' },
    { field: 'netCash', source: 'findAccountPerformance().net_cash', format: 'string' },
    { field: 'markedPositions', source: 'findAccountPerformance().marked_positions', format: 'string' },
    { field: 'realizedPnl', source: 'findAccountPerformance().realized_pnl', format: 'string' },
    { field: 'unrealizedPnl', source: 'findAccountPerformance().unrealized_pnl', format: 'string' },
    { field: 'totalPnl', source: 'findAccountPerformance().total_pnl', format: 'string' },
    { field: 'grossExposure', source: 'findAccountPerformance().gross_exposure', format: 'string' },
    { field: 'netExposure', source: 'findAccountPerformance().net_exposure', format: 'string' },
  ],
  // Fields EXCLUDED from Overview (confined to Reconciliation):
  excludedFields: [
    'twr',
    'highWaterMark',
    'drawdown',
    'drawdownPct',
    'modifiedDietzReturn',
    'warnings',
    'rebuildCount',
    'lastRebuiltAt',
  ],
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// Ledger Adapter Data Requirements
// ═══════════════════════════════════════════════════════════════════════════

export const LEDGER_ADAPTER_DATA = {
  eventSource: 'financial_events (via listAccountEvents / computeAccountActivity)',
  postingDetail: 'ledger_entries via findEntryByEventId, ledger_postings via findPostingsByEntryId',
  correctionGrouping: 'correction_lineage via findCorrectionByOriginalExecution / findCorrectionByRelatedExecution',
  ordering: 'posted_at ASC, id ASC (deterministic)',
  pagination: 'limit (1-200), offset, total from countAccountEvents',
  filters: ['eventType', 'dateFrom', 'dateTo', 'symbol', 'category'],
} as const;
