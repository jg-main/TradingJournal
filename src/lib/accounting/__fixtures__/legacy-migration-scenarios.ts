/**
 * Legacy migration scenario fixtures.
 *
 * 14 representative scenarios covering valid cash flows, buys/sells, fees,
 * missing or invalid prices, duplicate source rows, unsupported/ambiguous
 * records, and legacy journal attribution.
 *
 * Each scenario provides:
 * - Input legacy rows (the raw data as it exists in legacy tables)
 * - Resolved context values (accountId, symbol, instrumentId as the
 *   migration runner would resolve them from parent rows)
 * - Expected mapping result indicators (status, recordType, anomaly codes)
 *
 * Pure data module — no database, Next.js, or server imports.
 *
 * @module legacy-migration-scenarios
 */

import type {
  LegacyAccountTransaction,
  LegacyTradeExecution,
  LegacyPriceSnapshot,
  MapResult,
  MigrationInput,
  CashEventMigrationInput,
  ExecutionMigrationInput,
  PriceMarkMigrationInput,
} from '../legacy-migration';
import type { CanonicalDecimal } from '../types';

// ── Shared test identifiers ─────────────────────────────────────────────

export const TEST_ACCOUNT_ID = '00000000-0000-0000-0000-000000000001';
export const TEST_INSTRUMENT_ID = '00000000-0000-0000-0000-00000000000a';
export const TEST_SYMBOL = 'AAPL';

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 1: Valid Deposit
// ═══════════════════════════════════════════════════════════════════════════

export const scenario1ValidDeposit = {
  name: 'valid_deposit',
  description: 'A valid account_transactions deposit row maps to a cash_event migration input.',
  input: {
    row: {
      id: 'dep-0000-0000-0000-000000000001',
      accountId: TEST_ACCOUNT_ID,
      type: 'deposit' as const,
      amount: 10000.00,
      balanceAfter: 15000.00,
      date: '2024-01-15T10:00:00.000Z',
      notes: 'Initial deposit',
      createdAt: '2024-01-15T10:00:00.000Z',
    } satisfies LegacyAccountTransaction,
  },
  expected: {
    status: 'mapped' as const,
    recordType: 'cash_event' as const,
    input: {
      type: 'cash_event',
      accountId: TEST_ACCOUNT_ID,
      eventType: 'deposit',
      amount: '10000.00' as CanonicalDecimal,
      description: 'Initial deposit',
      postedAt: '2024-01-15T10:00:00.000Z',
      legacySourceTable: 'account_transactions',
      legacySourceId: 'dep-0000-0000-0000-000000000001',
    } satisfies Omit<CashEventMigrationInput, 'idempotencyKey'>,
    anomaly: null,
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 2: Valid Withdrawal
// ═══════════════════════════════════════════════════════════════════════════

export const scenario2ValidWithdrawal = {
  name: 'valid_withdrawal',
  description: 'A valid account_transactions withdrawal row maps to a cash_event migration input with eventType withdrawal.',
  input: {
    row: {
      id: 'wth-0000-0000-0000-000000000002',
      accountId: TEST_ACCOUNT_ID,
      type: 'withdrawal' as const,
      amount: 5000.00,
      balanceAfter: 5000.00,
      date: '2024-02-01T10:00:00.000Z',
      notes: null,
      createdAt: '2024-02-01T10:00:00.000Z',
    } satisfies LegacyAccountTransaction,
  },
  expected: {
    status: 'mapped' as const,
    recordType: 'cash_event' as const,
    input: {
      type: 'cash_event',
      accountId: TEST_ACCOUNT_ID,
      eventType: 'withdrawal',
      amount: '5000.00' as CanonicalDecimal,
      description: null,
      postedAt: '2024-02-01T10:00:00.000Z',
      legacySourceTable: 'account_transactions',
      legacySourceId: 'wth-0000-0000-0000-000000000002',
    } satisfies Omit<CashEventMigrationInput, 'idempotencyKey'>,
    anomaly: null,
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 3: Valid Buy Execution
// ═══════════════════════════════════════════════════════════════════════════

export const scenario3ValidBuy = {
  name: 'valid_buy_execution',
  description: 'A valid trade_executions buy row maps to an execution migration input.',
  input: {
    row: {
      id: 'exe-buy-0000-0000-0000-000000000003',
      tradeId: 'trd-0000-0000-0000-000000000001',
      executedAt: '2024-01-16T09:30:00.000Z',
      action: 'buy' as const,
      quantity: 100,
      price: 150.50,
      fees: 0,
      reasonId: null,
      notes: 'Bought 100 AAPL',
      createdAt: '2024-01-16T09:30:00.000Z',
    } satisfies LegacyTradeExecution,
    accountId: TEST_ACCOUNT_ID,
    symbol: TEST_SYMBOL,
  },
  expected: {
    status: 'mapped' as const,
    recordType: 'execution' as const,
    input: {
      type: 'execution',
      accountId: TEST_ACCOUNT_ID,
      symbol: TEST_SYMBOL,
      action: 'buy',
      quantity: '100.00' as CanonicalDecimal,
      price: '150.50' as CanonicalDecimal,
      fees: '0.00' as CanonicalDecimal,
      postedAt: '2024-01-16T09:30:00.000Z',
      journalTradeId: 'trd-0000-0000-0000-000000000001',
      legacySourceTable: 'trade_executions',
      legacySourceId: 'exe-buy-0000-0000-0000-000000000003',
    } satisfies Omit<ExecutionMigrationInput, 'idempotencyKey'>,
    anomaly: null,
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 4: Valid Sell Execution
// ═══════════════════════════════════════════════════════════════════════════

export const scenario4ValidSell = {
  name: 'valid_sell_execution',
  description: 'A valid trade_executions sell row maps to an execution migration input.',
  input: {
    row: {
      id: 'exe-sell-0000-0000-0000-000000000004',
      tradeId: 'trd-0000-0000-0000-000000000001',
      executedAt: '2024-01-20T15:00:00.000Z',
      action: 'sell' as const,
      quantity: 100,
      price: 165.00,
      fees: 0,
      reasonId: null,
      notes: 'Sold 100 AAPL',
      createdAt: '2024-01-20T15:00:00.000Z',
    } satisfies LegacyTradeExecution,
    accountId: TEST_ACCOUNT_ID,
    symbol: TEST_SYMBOL,
  },
  expected: {
    status: 'mapped' as const,
    recordType: 'execution' as const,
    input: {
      type: 'execution',
      accountId: TEST_ACCOUNT_ID,
      symbol: TEST_SYMBOL,
      action: 'sell',
      quantity: '100.00' as CanonicalDecimal,
      price: '165.00' as CanonicalDecimal,
      fees: '0.00' as CanonicalDecimal,
      postedAt: '2024-01-20T15:00:00.000Z',
      journalTradeId: 'trd-0000-0000-0000-000000000001',
      legacySourceTable: 'trade_executions',
      legacySourceId: 'exe-sell-0000-0000-0000-000000000004',
    } satisfies Omit<ExecutionMigrationInput, 'idempotencyKey'>,
    anomaly: null,
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 5: Valid Sell Short Execution
// ═══════════════════════════════════════════════════════════════════════════

export const scenario5ValidSellShort = {
  name: 'valid_sell_short_execution',
  description: 'A valid trade_executions sell_short row maps to an execution migration input.',
  input: {
    row: {
      id: 'exe-ss-0000-0000-0000-000000000005',
      tradeId: 'trd-0000-0000-0000-000000000002',
      executedAt: '2024-02-10T09:30:00.000Z',
      action: 'sell_short' as const,
      quantity: 50,
      price: 200.00,
      fees: 1.50,
      reasonId: null,
      notes: null,
      createdAt: '2024-02-10T09:30:00.000Z',
    } satisfies LegacyTradeExecution,
    accountId: TEST_ACCOUNT_ID,
    symbol: 'SPY',
  },
  expected: {
    status: 'mapped' as const,
    recordType: 'execution' as const,
    input: {
      type: 'execution',
      accountId: TEST_ACCOUNT_ID,
      symbol: 'SPY',
      action: 'sell_short',
      quantity: '50.00' as CanonicalDecimal,
      price: '200.00' as CanonicalDecimal,
      fees: '1.50' as CanonicalDecimal,
      postedAt: '2024-02-10T09:30:00.000Z',
      journalTradeId: 'trd-0000-0000-0000-000000000002',
      legacySourceTable: 'trade_executions',
      legacySourceId: 'exe-ss-0000-0000-0000-000000000005',
    } satisfies Omit<ExecutionMigrationInput, 'idempotencyKey'>,
    anomaly: null,
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 6: Valid Buy to Cover Execution
// ═══════════════════════════════════════════════════════════════════════════

export const scenario6ValidBuyToCover = {
  name: 'valid_buy_to_cover_execution',
  description: 'A valid trade_executions buy_to_cover row maps to an execution migration input.',
  input: {
    row: {
      id: 'exe-btc-0000-0000-0000-000000000006',
      tradeId: 'trd-0000-0000-0000-000000000002',
      executedAt: '2024-02-15T15:00:00.000Z',
      action: 'buy_to_cover' as const,
      quantity: 50,
      price: 195.00,
      fees: 0,
      reasonId: null,
      notes: null,
      createdAt: '2024-02-15T15:00:00.000Z',
    } satisfies LegacyTradeExecution,
    accountId: TEST_ACCOUNT_ID,
    symbol: 'SPY',
  },
  expected: {
    status: 'mapped' as const,
    recordType: 'execution' as const,
    input: {
      type: 'execution',
      accountId: TEST_ACCOUNT_ID,
      symbol: 'SPY',
      action: 'buy_to_cover',
      quantity: '50.00' as CanonicalDecimal,
      price: '195.00' as CanonicalDecimal,
      fees: '0.00' as CanonicalDecimal,
      postedAt: '2024-02-15T15:00:00.000Z',
      journalTradeId: 'trd-0000-0000-0000-000000000002',
      legacySourceTable: 'trade_executions',
      legacySourceId: 'exe-btc-0000-0000-0000-000000000006',
    } satisfies Omit<ExecutionMigrationInput, 'idempotencyKey'>,
    anomaly: null,
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 7: Execution With Fees
// ═══════════════════════════════════════════════════════════════════════════

export const scenario7WithFees = {
  name: 'execution_with_fees',
  description: 'An execution with non-zero fees maps correctly and preserves the fee amount.',
  input: {
    row: {
      id: 'exe-fee-0000-0000-0000-000000000007',
      tradeId: 'trd-0000-0000-0000-000000000003',
      executedAt: '2024-03-01T09:30:00.000Z',
      action: 'buy' as const,
      quantity: 200,
      price: 50.25,
      fees: 7.99,
      reasonId: null,
      notes: 'Commission $7.99',
      createdAt: '2024-03-01T09:30:00.000Z',
    } satisfies LegacyTradeExecution,
    accountId: TEST_ACCOUNT_ID,
    symbol: 'MSFT',
  },
  expected: {
    status: 'mapped' as const,
    recordType: 'execution' as const,
    input: {
      type: 'execution',
      accountId: TEST_ACCOUNT_ID,
      symbol: 'MSFT',
      action: 'buy',
      quantity: '200.00' as CanonicalDecimal,
      price: '50.25' as CanonicalDecimal,
      fees: '7.99' as CanonicalDecimal,
      postedAt: '2024-03-01T09:30:00.000Z',
      journalTradeId: 'trd-0000-0000-0000-000000000003',
      legacySourceTable: 'trade_executions',
      legacySourceId: 'exe-fee-0000-0000-0000-000000000007',
    } satisfies Omit<ExecutionMigrationInput, 'idempotencyKey'>,
    anomaly: null,
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 8: Execution With Missing Price (price = 0)
// ═══════════════════════════════════════════════════════════════════════════

export const scenario8MissingPrice = {
  name: 'execution_missing_price',
  description: 'An execution with zero price produces an anomaly with code MISSING_PRICE.',
  input: {
    row: {
      id: 'exe-no-price-0000-0000-0000-000000000008',
      tradeId: 'trd-0000-0000-0000-000000000004',
      executedAt: '2024-03-05T09:30:00.000Z',
      action: 'buy' as const,
      quantity: 100,
      price: 0,
      fees: 0,
      reasonId: null,
      notes: null,
      createdAt: '2024-03-05T09:30:00.000Z',
    } satisfies LegacyTradeExecution,
    accountId: TEST_ACCOUNT_ID,
    symbol: 'GOOGL',
  },
  expected: {
    status: 'anomaly' as const,
    recordType: 'execution' as const,
    anomalyCode: 'ANOMALY_MISSING_PRICE',
    anomalyField: 'price',
    input: null,
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 9: Execution With Negative Price
// ═══════════════════════════════════════════════════════════════════════════

export const scenario9NegativePrice = {
  name: 'execution_negative_price',
  description: 'An execution with a negative price produces an anomaly with code NEGATIVE_PRICE.',
  input: {
    row: {
      id: 'exe-neg-price-0000-0000-0000-000000000009',
      tradeId: 'trd-0000-0000-0000-000000000005',
      executedAt: '2024-03-10T09:30:00.000Z',
      action: 'sell' as const,
      quantity: 50,
      price: -10.00,
      fees: 0,
      reasonId: null,
      notes: null,
      createdAt: '2024-03-10T09:30:00.000Z',
    } satisfies LegacyTradeExecution,
    accountId: TEST_ACCOUNT_ID,
    symbol: 'TSLA',
  },
  expected: {
    status: 'anomaly' as const,
    recordType: 'execution' as const,
    anomalyCode: 'ANOMALY_NEGATIVE_PRICE',
    anomalyField: 'price',
    input: null,
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 10: Execution With Zero Quantity
// ═══════════════════════════════════════════════════════════════════════════

export const scenario10ZeroQuantity = {
  name: 'execution_zero_quantity',
  description: 'An execution with zero quantity produces an anomaly with code ZERO_QUANTITY.',
  input: {
    row: {
      id: 'exe-zero-qty-0000-0000-0000-000000000010',
      tradeId: 'trd-0000-0000-0000-000000000006',
      executedAt: '2024-03-15T09:30:00.000Z',
      action: 'buy' as const,
      quantity: 0,
      price: 100.00,
      fees: 0,
      reasonId: null,
      notes: null,
      createdAt: '2024-03-15T09:30:00.000Z',
    } satisfies LegacyTradeExecution,
    accountId: TEST_ACCOUNT_ID,
    symbol: 'NFLX',
  },
  expected: {
    status: 'anomaly' as const,
    recordType: 'execution' as const,
    anomalyCode: 'ANOMALY_ZERO_QUANTITY',
    anomalyField: 'quantity',
    input: null,
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 11: Duplicate Source Row
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Duplicate detection is handled at the runner level (T02) by checking
 * idempotency keys in the repository.  This scenario provides the fixture
 * row and its expected idempotency key so the runner test can verify that
 * two rows with the same source identity are rejected on the second write.
 *
 * The mapping adapters do NOT detect duplicates — they always return
 * `mapped` with the correct idempotency key.  This fixture validates
 * the idempotency key contract.
 */
export const scenario11DuplicateSourceRow = {
  name: 'duplicate_source_row',
  description:
    'Two executions with the same source ID produce identical idempotency keys. ' +
    'Runner-level duplicate detection rejects the second write.',
  input: {
    row: {
      id: 'exe-dup-0000-0000-0000-000000000011',
      tradeId: 'trd-0000-0000-0000-000000000007',
      executedAt: '2024-04-01T09:30:00.000Z',
      action: 'buy' as const,
      quantity: 10,
      price: 500.00,
      fees: 0,
      reasonId: null,
      notes: null,
      createdAt: '2024-04-01T09:30:00.000Z',
    } satisfies LegacyTradeExecution,
    accountId: TEST_ACCOUNT_ID,
    symbol: 'AMZN',
  },
  expected: {
    status: 'mapped' as const,
    recordType: 'execution' as const,
    idempotencyKey: 'migrated:trade_executions:exe-dup-0000-0000-0000-000000000011',
    input: null, // Checked via idempotencyKey comparison
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 12: Invalid Price Snapshot (negative price)
// ═══════════════════════════════════════════════════════════════════════════

export const scenario12InvalidPriceSnapshot = {
  name: 'invalid_price_snapshot',
  description: 'A price snapshot with a negative price produces an anomaly with code INVALID_PRICE_SNAPSHOT.',
  input: {
    row: {
      id: 'psnap-inv-0000-0000-0000-000000000012',
      tradeId: 'trd-0000-0000-0000-000000000008',
      price: -1.00,
      source: 'yahoo',
      marketState: 'REGULAR',
      shortName: null,
      quoteType: 'EQUITY',
      sector: null,
      industry: null,
      previousClose: null,
      dayHigh: null,
      dayLow: null,
      change: null,
      changePercent: null,
      fetchedAt: '2024-04-05T12:00:00.000Z',
      createdAt: '2024-04-05T12:00:00.000Z',
    } satisfies LegacyPriceSnapshot,
    accountId: TEST_ACCOUNT_ID,
    instrumentId: TEST_INSTRUMENT_ID,
  },
  expected: {
    status: 'anomaly' as const,
    recordType: 'price_mark' as const,
    anomalyCode: 'ANOMALY_INVALID_PRICE_SNAPSHOT',
    anomalyField: 'price',
    input: null,
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 13: Missing Price Snapshot (zero price)
// ═══════════════════════════════════════════════════════════════════════════

export const scenario13MissingPriceSnapshot = {
  name: 'missing_price_snapshot_price',
  description: 'A price snapshot with zero price produces an anomaly with code MISSING_PRICE_SNAPSHOT_PRICE.',
  input: {
    row: {
      id: 'psnap-zero-0000-0000-0000-000000000013',
      tradeId: 'trd-0000-0000-0000-000000000009',
      price: 0,
      source: 'yahoo',
      marketState: null,
      shortName: null,
      quoteType: null,
      sector: null,
      industry: null,
      previousClose: null,
      dayHigh: null,
      dayLow: null,
      change: null,
      changePercent: null,
      fetchedAt: '2024-04-10T12:00:00.000Z',
      createdAt: '2024-04-10T12:00:00.000Z',
    } satisfies LegacyPriceSnapshot,
    accountId: TEST_ACCOUNT_ID,
    instrumentId: TEST_INSTRUMENT_ID,
  },
  expected: {
    status: 'anomaly' as const,
    recordType: 'price_mark' as const,
    anomalyCode: 'ANOMALY_MISSING_PRICE_SNAPSHOT_PRICE',
    anomalyField: 'price',
    input: null,
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 14: Legacy Journal Attribution
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A valid execution that carries a journalTradeId (the trade FK) for
 * auditing/attribution — the adapter preserves tradeId as journalTradeId.
 */
export const scenario14LegacyJournalAttribution = {
  name: 'legacy_journal_attribution',
  description:
    'A valid execution preserves the legacy tradeId as journalTradeId for audit attribution.',
  input: {
    row: {
      id: 'exe-jrnl-0000-0000-0000-000000000014',
      tradeId: 'trd-jrnl-0000-0000-0000-00000000000a',
      executedAt: '2024-05-01T09:30:00.000Z',
      action: 'buy' as const,
      quantity: 75,
      price: 180.00,
      fees: 5.00,
      reasonId: null,
      notes: 'Legacy entry buy',
      createdAt: '2024-05-01T09:30:00.000Z',
    } satisfies LegacyTradeExecution,
    accountId: TEST_ACCOUNT_ID,
    symbol: 'NVDA',
  },
  expected: {
    status: 'mapped' as const,
    recordType: 'execution' as const,
    input: {
      type: 'execution',
      accountId: TEST_ACCOUNT_ID,
      symbol: 'NVDA',
      action: 'buy',
      quantity: '75.00' as CanonicalDecimal,
      price: '180.00' as CanonicalDecimal,
      fees: '5.00' as CanonicalDecimal,
      postedAt: '2024-05-01T09:30:00.000Z',
      journalTradeId: 'trd-jrnl-0000-0000-0000-00000000000a',
      legacySourceTable: 'trade_executions',
      legacySourceId: 'exe-jrnl-0000-0000-0000-000000000014',
    } satisfies Omit<ExecutionMigrationInput, 'idempotencyKey'>,
    anomaly: null,
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Scenario Index
// ═══════════════════════════════════════════════════════════════════════════

/**
 * All 14 scenarios in a single array for easy iteration in tests.
 */
export const allScenarios = [
  scenario1ValidDeposit,
  scenario2ValidWithdrawal,
  scenario3ValidBuy,
  scenario4ValidSell,
  scenario5ValidSellShort,
  scenario6ValidBuyToCover,
  scenario7WithFees,
  scenario8MissingPrice,
  scenario9NegativePrice,
  scenario10ZeroQuantity,
  scenario11DuplicateSourceRow,
  scenario12InvalidPriceSnapshot,
  scenario13MissingPriceSnapshot,
  scenario14LegacyJournalAttribution,
] as const;
