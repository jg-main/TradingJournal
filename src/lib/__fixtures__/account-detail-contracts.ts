/**
 * account-detail-contracts.ts
 *
 * Representative fixtures and contract safe-value objects for the
 * account-detail redesign (overview, ledger, positions, reconciliation).
 *
 * All fixtures are database-free plain objects usable by both pure-library
 * tests (vitest) and API route tests (vitest + route handlers).
 *
 * @module __fixtures__/account-detail-contracts
 */

// ───────────────────────────────────────────────────────────────────────────
// Account Identity (shared by all adapter fixtures)
// ───────────────────────────────────────────────────────────────────────────

export const ACCOUNT_ID = 'acc-test-001';
export const ACCOUNT_NAME = 'Test Trading Account';
export const ACCOUNT_BROKER = 'Test Broker';
export const ACCOUNT_CURRENCY = 'USD';

// ───────────────────────────────────────────────────────────────────────────
// 1. Overview Adapter Fixtures
// ───────────────────────────────────────────────────────────────────────────

/**
 * Fixture for a full overview snapshot with all fields populated.
 */
export const OVERVIEW_SNAPSHOT_FULL = {
  netCash: '50000.00',
  nav: '150000.00',
  markedPositions: '100000.00',
  realizedPnl: '25000.00',
  unrealizedPnl: '5000.00',
  totalPnl: '30000.00',
  realizedFees: '1500.00',
  grossExposure: '200000.00',
  netExposure: '150000.00',
} as const;

/**
 * Fixture for a null overview snapshot (no accounting projection data).
 */
export const OVERVIEW_SNAPSHOT_NULL = {
  netCash: null,
  nav: null,
  markedPositions: null,
  realizedPnl: null,
  unrealizedPnl: null,
  totalPnl: null,
  realizedFees: null,
  grossExposure: null,
  netExposure: null,
} as const;

/**
 * Fixture for an overview snapshot where only cash and NAV have data.
 */
export const OVERVIEW_SNAPSHOT_PARTIAL = {
  netCash: '10000.00',
  nav: '110000.00',
  markedPositions: null,
  realizedPnl: null,
  unrealizedPnl: null,
  totalPnl: null,
  realizedFees: null,
  grossExposure: null,
  netExposure: null,
} as const;

// ───────────────────────────────────────────────────────────────────────────
// 2. Ledger Adapter Fixtures
// ───────────────────────────────────────────────────────────────────────────

/**
 * Authoritative financial event identity for contract assertions.
 *
 * The ledger adapter MUST deduplicate by financial_events.id and
 * MUST NOT produce duplicate rows from correction triples.
 */
export const EVENT_IDS = {
  /** Standalone opening balance event. */
  openingBalance: 'evt-ob-001',
  /** Standalone deposit event. */
  deposit: 'evt-dep-001',
  /** Original trade execution event (later corrected). */
  tradeOriginal: 'evt-trade-orig-001',
  /** Correction reversal event. */
  tradeReversal: 'evt-trade-rev-001',
  /** Replacement trade execution event. */
  tradeReplacement: 'evt-trade-repl-001',
  /** Uncorrected trade execution. */
  tradeUncorrected: 'evt-trade-uncorr-001',
  /** Standalone fee event. */
  fee: 'evt-fee-001',
  /** Standalone dividend event. */
  dividend: 'evt-div-001',
} as const;

/**
 * Correction lineage fixture (maps to correction_lineage table).
 */
export const CORRECTION_LINEAGE = {
  id: 'cline-001',
  originalExecutionId: 'exec-orig-001',
  reversalExecutionId: 'exec-rev-001',
  replacementExecutionId: 'exec-repl-001',
  reason: 'Wrong quantity entered — corrected from 100 to 50',
  correctedAt: '2026-07-15T14:00:00.000Z',
} as const;

/**
 * Original execution for the correction fixture.
 */
export const EXECUTION_ORIGINAL = {
  symbol: 'AAPL',
  action: 'buy',
  quantity: '100.00',
  price: '150.00',
  fees: '15.00',
  executedAt: '2026-07-14T10:00:00.000Z',
} as const;

/**
 * Replacement execution for the correction fixture.
 */
export const EXECUTION_REPLACEMENT = {
  symbol: 'AAPL',
  action: 'buy',
  quantity: '50.00',
  price: '150.00',
  fees: '7.50',
  executedAt: '2026-07-15T14:00:00.000Z',
} as const;

/**
 * A ledger row representing a single authoritative event.
 */
export interface LedgerEventRow {
  eventId: string;
  eventType: string;
  category: string;
  description: string;
  postedAt: string;
  symbol: string | null;
  quantity: string | null;
  price: string | null;
  amount: string;
  fees: string | null;
  isCorrection: boolean;
  correctionGroupId: string | null;
  constituentIds: string[] | null;
}

/**
 * Grouped correction display row (triple collapsed into one).
 */
export interface LedgerCorrectionRow {
  eventId: string;
  eventType: string;
  category: string;
  description: string;
  postedAt: string;
  symbol: string;
  correctionId: string;
  originalExecutionId: string;
  reversalExecutionId: string;
  replacementExecutionId: string;
  originalQuantity: string;
  replacementQuantity: string;
  amount: string;
  reason: string | null;
  isGrouped: true;
}

/**
 * Full ledger fixture: authoritative events in deterministic order.
 * This demonstrates that corrections collapse to ONE display row,
 * not three — preventing the duplicate-execution row inflation.
 */
export const LEDGER_EVENTS_FULL: (LedgerEventRow | LedgerCorrectionRow)[] = [
  {
    eventId: EVENT_IDS.openingBalance,
    eventType: 'opening_balance',
    category: 'Opening Balance',
    description: 'Opening balance for account',
    postedAt: '2026-01-01T00:00:00.000Z',
    symbol: null,
    quantity: null,
    price: null,
    amount: '100000.00',
    fees: null,
    isCorrection: false,
    correctionGroupId: null,
    constituentIds: null,
  },
  {
    eventId: EVENT_IDS.deposit,
    eventType: 'deposit',
    category: 'Cash',
    description: 'Initial deposit',
    postedAt: '2026-01-02T10:00:00.000Z',
    symbol: null,
    quantity: null,
    price: null,
    amount: '50000.00',
    fees: null,
    isCorrection: false,
    correctionGroupId: null,
    constituentIds: null,
  },
  {
    eventId: EVENT_IDS.tradeOriginal,
    eventType: 'trade_execution',
    category: 'Trade',
    description: 'Buy 100 AAPL @ 150.00',
    postedAt: '2026-07-14T10:00:00.000Z',
    symbol: 'AAPL',
    quantity: '100.00',
    price: '150.00',
    amount: '-15015.00',
    fees: '15.00',
    isCorrection: false,
    correctionGroupId: null,
    constituentIds: null,
  },
  // The correction triple collapses into one display row:
  {
    eventId: 'grouped-corr-001-display',
    eventType: 'trade_execution',
    category: 'Trade',
    description: 'Corrected: Buy 50 AAPL @ 150.00 (was 100)',
    postedAt: '2026-07-15T14:00:00.000Z',
    symbol: 'AAPL',
    correctionId: CORRECTION_LINEAGE.id,
    originalExecutionId: CORRECTION_LINEAGE.originalExecutionId,
    reversalExecutionId: CORRECTION_LINEAGE.reversalExecutionId,
    replacementExecutionId: CORRECTION_LINEAGE.replacementExecutionId,
    originalQuantity: '100.00',
    replacementQuantity: '50.00',
    amount: '-7507.50',
    reason: CORRECTION_LINEAGE.reason,
    isGrouped: true as const,
  } as LedgerCorrectionRow,
  {
    eventId: EVENT_IDS.tradeUncorrected,
    eventType: 'trade_execution',
    category: 'Trade',
    description: 'Buy 200 MSFT @ 300.00',
    postedAt: '2026-07-16T10:00:00.000Z',
    symbol: 'MSFT',
    quantity: '200.00',
    price: '300.00',
    amount: '-60030.00',
    fees: '30.00',
    isCorrection: false,
    correctionGroupId: null,
    constituentIds: null,
  },
  {
    eventId: EVENT_IDS.dividend,
    eventType: 'dividend',
    category: 'Cash',
    description: 'AAPL dividend',
    postedAt: '2026-07-17T09:00:00.000Z',
    symbol: 'AAPL',
    quantity: null,
    price: null,
    amount: '50.00',
    fees: null,
    isCorrection: false,
    correctionGroupId: null,
    constituentIds: null,
  },
  {
    eventId: EVENT_IDS.fee,
    eventType: 'fee',
    category: 'Fee/Tax',
    description: 'Monthly platform fee',
    postedAt: '2026-07-18T00:00:00.000Z',
    symbol: null,
    quantity: null,
    price: null,
    amount: '-25.00',
    fees: '25.00',
    isCorrection: false,
    correctionGroupId: null,
    constituentIds: null,
  },
];

/**
 * Empty ledger fixture for valid no-match queries.
 */
export const LEDGER_EVENTS_EMPTY: (LedgerEventRow | LedgerCorrectionRow)[] = [];

/**
 * Ledger query metadata.
 */
export const LEDGER_QUERY = {
  accountId: ACCOUNT_ID,
  page: 1,
  limit: 50,
  total: LEDGER_EVENTS_FULL.length,
  eventTypes: [] as string[],
  dateFrom: null as string | null,
  dateTo: null as string | null,
  symbol: null as string | null,
} as const;

// ───────────────────────────────────────────────────────────────────────────
// 3. Positions Adapter Fixtures
// ───────────────────────────────────────────────────────────────────────────

export interface PositionsRow {
  symbol: string;
  direction: string | null;
  quantity: string;
  averageCost: string;
  totalCostBasis: string;
  markStatus: string;
  markPrice: string | null;
  markedValue: string | null;
  unrealizedPnl: string | null;
  realizedGrossPnl: string;
  realizedNetPnl: string;
}

/**
 * Full positions fixture: multiple positions with mixed mark statuses.
 */
export const POSITIONS_FULL: PositionsRow[] = [
  {
    symbol: 'AAPL',
    direction: 'long',
    quantity: '50.00',
    averageCost: '150.00',
    totalCostBasis: '7500.00',
    markStatus: 'fresh',
    markPrice: '165.00',
    markedValue: '8250.00',
    unrealizedPnl: '750.00',
    realizedGrossPnl: '500.00',
    realizedNetPnl: '485.00',
  },
  {
    symbol: 'MSFT',
    direction: 'long',
    quantity: '200.00',
    averageCost: '300.00',
    totalCostBasis: '60000.00',
    markStatus: 'missing',
    markPrice: null,
    markedValue: null,
    unrealizedPnl: null,
    realizedGrossPnl: '1000.00',
    realizedNetPnl: '985.00',
  },
  {
    symbol: 'TSLA',
    direction: 'short',
    quantity: '50.00',
    averageCost: '200.00',
    totalCostBasis: '10000.00',
    markStatus: 'stale',
    markPrice: '210.00',
    markedValue: '10500.00',
    unrealizedPnl: '500.00',
    realizedGrossPnl: '-250.00',
    realizedNetPnl: '-260.00',
  },
  {
    symbol: 'SPY',
    direction: 'long',
    quantity: '0.55',
    averageCost: '450.00',
    totalCostBasis: '247.50',
    markStatus: 'fresh',
    markPrice: '455.00',
    markedValue: '250.25',
    unrealizedPnl: '2.75',
    realizedGrossPnl: '0.00',
    realizedNetPnl: '0.00',
  },
  {
    symbol: 'GOOG',
    direction: null,
    quantity: '0.00',
    averageCost: '0.00',
    totalCostBasis: '0.00',
    markStatus: 'missing',
    markPrice: null,
    markedValue: null,
    unrealizedPnl: null,
    realizedGrossPnl: '2000.00',
    realizedNetPnl: '1950.00',
  },
];

/**
 * Empty positions fixture for valid no-match queries.
 */
export const POSITIONS_EMPTY: PositionsRow[] = [];

// ───────────────────────────────────────────────────────────────────────────
// 4. Reconciliation Adapter Fixtures
// ───────────────────────────────────────────────────────────────────────────

export interface ReconciliationBannerFixture {
  status: 'eligible' | 'stale' | 'blocked';
  cutoverEligible: boolean;
  refusalReasons: string[];
  summary: string;
  comparisonCount: number;
  resolvedCount: number;
  unresolvedCount: number;
  computedAt: string | null;
}

export interface LegacyAuditFixture {
  kpis: {
    tradeCount: number;
    netPnl: number;
    winRate: number | null;
    avgR: number | null;
    avgGrade: number | null;
  };
  realizedPnl: number;
  currentBalance: number;
  netDeposits: number;
  netWithdrawals: number;
}

/**
 * Reconciliation fixture: eligible for cutover.
 */
export const RECONCILIATION_ELIGIBLE: ReconciliationBannerFixture = {
  status: 'eligible',
  cutoverEligible: true,
  refusalReasons: [],
  summary: 'Reconciliation complete — 12 comparisons, 12 resolved. Ready for cutover.',
  comparisonCount: 12,
  resolvedCount: 12,
  unresolvedCount: 0,
  computedAt: '2026-07-15T12:00:00.000Z',
};

/**
 * Reconciliation fixture: stale (no run yet).
 */
export const RECONCILIATION_STALE: ReconciliationBannerFixture = {
  status: 'stale',
  cutoverEligible: false,
  refusalReasons: [],
  summary: 'No reconciliation run yet. Run a migration to compare legacy and accounting data.',
  comparisonCount: 0,
  resolvedCount: 0,
  unresolvedCount: 0,
  computedAt: null,
};

/**
 * Reconciliation fixture: blocked with refusal reasons.
 */
export const RECONCILIATION_BLOCKED: ReconciliationBannerFixture = {
  status: 'blocked',
  cutoverEligible: false,
  refusalReasons: [
    'Execution count mismatch: legacy 15 vs accounting 12',
    'Fee total mismatch: legacy 1250.00 vs accounting 1248.50',
  ],
  summary: 'Reconciliation blocked — 2 unexplained difference(s) out of 12 comparisons.',
  comparisonCount: 12,
  resolvedCount: 10,
  unresolvedCount: 2,
  computedAt: '2026-07-15T12:00:00.000Z',
};

/**
 * Legacy audit fixture (confined to Reconciliation tab exclusively).
 */
export const LEGACY_AUDIT: LegacyAuditFixture = {
  kpis: {
    tradeCount: 5,
    netPnl: 12000,
    winRate: 0.6,
    avgR: 1.8,
    avgGrade: 72,
  },
  realizedPnl: 12000,
  currentBalance: 112000,
  netDeposits: 50000,
  netWithdrawals: 10000,
};

// ───────────────────────────────────────────────────────────────────────────
// 5. Overview Adapter Data Requirements (ported from inventory)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Fields that belong in Overview tab.
 */
export const OVERVIEW_FIELDS = [
  'netCash',
  'nav',
  'markedPositions',
  'realizedPnl',
  'unrealizedPnl',
  'totalPnl',
  'realizedFees',
  'grossExposure',
  'netExposure',
] as const;

/**
 * Fields that are EXCLUDED from Overview — confined to Reconciliation.
 */
export const OVERVIEW_EXCLUDED_FIELDS = [
  'twr',
  'highWaterMark',
  'drawdown',
  'drawdownPct',
  'modifiedDietzReturn',
  'warnings',
  'rebuildCount',
  'lastRebuiltAt',
] as const;

/**
 * Ledger category fixture (all known mappings).
 */
export const LEDGER_CATEGORIES = {
  opening_balance: 'Opening Balance',
  deposit: 'Cash',
  withdrawal: 'Cash',
  dividend: 'Cash',
  interest: 'Cash',
  fee: 'Fee/Tax',
  tax: 'Fee/Tax',
  trade_execution: 'Trade',
  adjustment: 'Adjustment',
  transfer: 'Transfer',
  stock_split: 'Corporate Action',
  manual_adjustment: 'Adjustment',
} as const;

// ───────────────────────────────────────────────────────────────────────────
// 6. Error Response Shapes
// ───────────────────────────────────────────────────────────────────────────

export interface ErrorResponse {
  error: string;
  details?: unknown;
}

/**
 * Standard 404 error.
 */
export const ERROR_404: ErrorResponse = {
  error: 'Account not found',
};

/**
 * Standard 400 validation error.
 */
export const ERROR_VALIDATION: ErrorResponse = {
  error: 'Validation failed',
  details: { fieldErrors: { accountId: ['No account resolved'] } },
};

/**
 * Standard 500 server error.
 */
export const ERROR_SERVER: ErrorResponse = {
  error: 'Failed to fetch account detail',
  details: 'Internal server error',
};

/**
 * Machine-readable error conventions for the account-detail redesign.
 *
 * ALL account-detail routes (overview, ledger, positions, reconciliation)
 * MUST adhere to these conventions.
 */
export const ERROR_CONVENTIONS = {
  /** Error field is always a human-readable string. */
  errorType: 'string',
  /** Details field, when present, is always an object (never a raw string). */
  detailsType: 'object',
  /** Standard not-found format: { error: string } without details key. */
  notFoundShape: { error: 'string' },
  /** Standard validation format: { error: string, details: { fieldErrors: Record<string, string[]> } }. */
  validationShape: { error: 'string', details: { fieldErrors: 'Record<string, string[]>' } },
  /** Standard server error format: { error: string, details: string }. */
  serverErrorShape: { error: 'string', details: 'string' },
} as const;

// ───────────────────────────────────────────────────────────────────────────
// 7. Duplicate Execution Risk Assertion Constants
// ───────────────────────────────────────────────────────────────────────────

/**
 * The correction fixture MUST collapse 3 accounting_execution rows
 * into 1 display row. This constant verifies the transformation.
 */
export const CORRECTION_TRIPLE_RAW_COUNT = 3;
export const CORRECTION_DISPLAY_ROW_COUNT = 1;

/**
 * Total distinct financial event IDs in the full ledger fixture.
 * This is the authoritative identity count — the adapter MUST
 * produce exactly this many rows (one per event identity).
 */
export const AUTHORITATIVE_EVENT_IDENTITY_COUNT = Object.keys(EVENT_IDS).length;

/**
 * Total fixture rows including grouped corrections.
 */
export const FULL_LEDGER_DISPLAY_ROW_COUNT = Object.keys(EVENT_IDS).length;

// ───────────────────────────────────────────────────────────────────────────
// 8. Repository-Shaped Ledger Fixtures (consumed by ledger.ts adapter)
// ───────────────────────────────────────────────────────────────────────────
//
// These fixtures match the LedgerEventInput / LedgerEntryInput / LedgerPostingInput
// types from ledger.ts and the accounting-repository row shapes.
// T02 route tests import these directly. The correction grouping links are
// expressed at the financial-event ID level via CorrectionGroupInput.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Effect JSON: cash increase.
 */
function cEffect(amount: string, micros: number): string {
  return JSON.stringify({ kind: 'cash', direction: 'increase', amount, amountMicros: micros });
}

/**
 * Effect JSON: cash decrease.
 */
function cdEffect(amount: string, micros: number): string {
  return JSON.stringify({ kind: 'cash', direction: 'decrease', amount, amountMicros: micros });
}

/**
 * Effect JSON: market (non-cash) effect.
 */
function mEffect(symbol: string): string {
  return JSON.stringify({ kind: 'market', symbol, details: 'stock split' });
}

/**
 * Repository-shaped financial event rows matching LedgerEventInput.
 */
export const LEDGER_EVENTS_INPUT = [
  {
    id: EVENT_IDS.openingBalance,
    account_id: ACCOUNT_ID,
    event_type: 'opening_balance',
    idempotency_key: null,
    description: 'Opening balance for account',
    payload: null,
    effect: cEffect('100000.00', 100_000_000_000),
    posted_at: '2026-01-01T00:00:00.000Z',
    created_at: '2026-01-01T00:00:00.000Z',
  },
  {
    id: EVENT_IDS.deposit,
    account_id: ACCOUNT_ID,
    event_type: 'deposit',
    idempotency_key: null,
    description: 'Initial deposit',
    payload: null,
    effect: cEffect('50000.00', 50_000_000_000),
    posted_at: '2026-01-02T10:00:00.000Z',
    created_at: '2026-01-02T10:00:00.000Z',
  },
  {
    id: EVENT_IDS.tradeOriginal,
    account_id: ACCOUNT_ID,
    event_type: 'trade_execution',
    idempotency_key: null,
    description: 'Buy 100 AAPL @ 150.00',
    payload: null,
    effect: cdEffect('15015.00', 15_015_000_000),
    posted_at: '2026-07-14T10:00:00.000Z',
    created_at: '2026-07-14T10:00:00.000Z',
  },
  {
    id: EVENT_IDS.tradeReversal,
    account_id: ACCOUNT_ID,
    event_type: 'trade_execution',
    idempotency_key: null,
    description: 'Correction reversal: Sell 100 AAPL @ 150.00',
    payload: null,
    effect: cEffect('15015.00', 15_015_000_000),
    posted_at: '2026-07-15T14:00:00.000Z',
    created_at: '2026-07-15T14:00:00.000Z',
  },
  {
    id: EVENT_IDS.tradeReplacement,
    account_id: ACCOUNT_ID,
    event_type: 'trade_execution',
    idempotency_key: null,
    description: 'Corrected: Buy 50 AAPL @ 150.00',
    payload: null,
    effect: cdEffect('7507.50', 7_507_500_000),
    posted_at: '2026-07-15T14:00:01.000Z',
    created_at: '2026-07-15T14:00:01.000Z',
  },
  {
    id: EVENT_IDS.tradeUncorrected,
    account_id: ACCOUNT_ID,
    event_type: 'trade_execution',
    idempotency_key: null,
    description: 'Buy 200 MSFT @ 300.00',
    payload: null,
    effect: cdEffect('60030.00', 60_030_000_000),
    posted_at: '2026-07-16T10:00:00.000Z',
    created_at: '2026-07-16T10:00:00.000Z',
  },
  {
    id: EVENT_IDS.dividend,
    account_id: ACCOUNT_ID,
    event_type: 'dividend',
    idempotency_key: null,
    description: 'AAPL dividend',
    payload: null,
    effect: cEffect('50.00', 50_000_000),
    posted_at: '2026-07-17T09:00:00.000Z',
    created_at: '2026-07-17T09:00:00.000Z',
  },
  {
    id: EVENT_IDS.fee,
    account_id: ACCOUNT_ID,
    event_type: 'fee',
    idempotency_key: null,
    description: 'Monthly platform fee',
    payload: null,
    effect: cdEffect('25.00', 25_000_000),
    posted_at: '2026-07-18T00:00:00.000Z',
    created_at: '2026-07-18T00:00:00.000Z',
  },
];

/**
 * Repository-shaped stock split event (non-cash, non-trade).
 */
export const LEDGER_EVENT_STOCK_SPLIT = {
  id: 'evt-split-001',
  account_id: ACCOUNT_ID,
  event_type: 'stock_split',
  idempotency_key: null,
  description: 'AAPL 4:1 stock split',
  payload: null,
  effect: mEffect('AAPL'),
  posted_at: '2026-07-19T00:00:00.000Z',
  created_at: '2026-07-19T00:00:00.000Z',
};

/**
 * Ledger entry ID mapping (keyed by event ID for readability).
 * This constant makes it easy for T02 route tests to reference entries.
 */
export const LEDGER_ENTRY_IDS = {
  [EVENT_IDS.openingBalance]: 'entry-ob-001',
  [EVENT_IDS.deposit]: 'entry-dep-001',
  [EVENT_IDS.tradeOriginal]: 'entry-trade-orig-001',
  [EVENT_IDS.tradeReversal]: 'entry-trade-rev-001',
  [EVENT_IDS.tradeReplacement]: 'entry-trade-repl-001',
  [EVENT_IDS.tradeUncorrected]: 'entry-trade-uncorr-001',
  [EVENT_IDS.dividend]: 'entry-div-001',
  [EVENT_IDS.fee]: 'entry-fee-001',
  'evt-split-001': 'entry-split-001',
} as const;

/**
 * Repository-shaped ledger entry rows matching LedgerEntryInput.
 */
export const LEDGER_ENTRIES_INPUT = Object.entries(LEDGER_ENTRY_IDS).map(([financialEventId, entryId]) => ({
  id: entryId,
  financial_event_id: financialEventId,
  account_id: ACCOUNT_ID,
  description: null,
  posted_at: '2026-01-01T00:00:00.000Z',
  created_at: '2026-01-01T00:00:00.000Z',
}));

/**
 * Repository-shaped ledger posting rows matching LedgerPostingInput.
 * Each event with an entry gets a balanced debit/credit pair.
 */
function makeBalancedPostings(entryId: string, amount: string, micros: number): Array<{
  id: string;
  ledger_entry_id: string;
  account_id: string;
  side: string;
  amount: string;
  amount_micros: number;
  currency: string;
  sequence: number;
  created_at: string;
}> {
  return [
    {
      id: `p-debit-${entryId}`,
      ledger_entry_id: entryId,
      account_id: ACCOUNT_ID,
      side: 'debit',
      amount,
      amount_micros: micros,
      currency: 'USD',
      sequence: 1,
      created_at: '2026-01-01T00:00:00.000Z',
    },
    {
      id: `p-credit-${entryId}`,
      ledger_entry_id: entryId,
      account_id: ACCOUNT_ID,
      side: 'credit',
      amount,
      amount_micros: micros,
      currency: 'USD',
      sequence: 2,
      created_at: '2026-01-01T00:00:00.000Z',
    },
  ];
}

/**
 * All postings for the full ledger fixture.
 */
export const LEDGER_POSTINGS_INPUT: Array<{
  id: string;
  ledger_entry_id: string;
  account_id: string;
  side: string;
  amount: string;
  amount_micros: number;
  currency: string;
  sequence: number;
  created_at: string;
}> = [
  ...makeBalancedPostings(LEDGER_ENTRY_IDS[EVENT_IDS.openingBalance], '100000.00', 100_000_000_000),
  ...makeBalancedPostings(LEDGER_ENTRY_IDS[EVENT_IDS.deposit], '50000.00', 50_000_000_000),
  ...makeBalancedPostings(LEDGER_ENTRY_IDS[EVENT_IDS.tradeOriginal], '15015.00', 15_015_000_000),
  ...makeBalancedPostings(LEDGER_ENTRY_IDS[EVENT_IDS.tradeReversal], '15015.00', 15_015_000_000),
  ...makeBalancedPostings(LEDGER_ENTRY_IDS[EVENT_IDS.tradeReplacement], '7507.50', 7_507_500_000),
  ...makeBalancedPostings(LEDGER_ENTRY_IDS[EVENT_IDS.tradeUncorrected], '60030.00', 60_030_000_000),
  ...makeBalancedPostings(LEDGER_ENTRY_IDS[EVENT_IDS.dividend], '50.00', 50_000_000),
  ...makeBalancedPostings(LEDGER_ENTRY_IDS[EVENT_IDS.fee], '25.00', 25_000_000),
  ...makeBalancedPostings(LEDGER_ENTRY_IDS['evt-split-001'], '0.00', 0),
];

/**
 * Correction group fixture at the financial-event identity level,
 * matching the CorrectionGroupInput type from ledger.ts.
 * Maps the 3 correction constituent execution IDs to their
 * financial event IDs for adapter consumption.
 */
export const LEDGER_CORRECTION_GROUP_INPUT = {
  correctionId: 'grouped-corr-001',
  originalEventId: EVENT_IDS.tradeOriginal,
  reversalEventId: EVENT_IDS.tradeReversal,
  replacementEventId: EVENT_IDS.tradeReplacement,
  reason: CORRECTION_LINEAGE.reason,
  correctedAt: CORRECTION_LINEAGE.correctedAt,
};

