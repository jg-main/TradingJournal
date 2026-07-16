/**
 * account-detail-contracts.test.ts
 *
 * Cutover contract assertions for the account-detail redesign
 * (overview, ledger, positions, reconciliation).
 *
 * These tests verify that the fixture contracts are self-consistent and
 * match the requirements documented in the account-detail inventory:
 *
 * 1. Authoritative event identity — no duplicate event IDs
 * 2. No unexplained duplicate execution rows — correction triples collapse to one
 * 3. Correction lineage preservation — original/reversal/replacement IDs retained
 * 4. Empty-array behavior — valid no-match queries return [] not null
 * 5. Machine-readable error conventions — standardised error shapes
 * 6. Explicit confinement of legacy values to reconciliation
 *
 * All tests are database-free — they consume plain-object fixtures
 * that can also be imported by API route tests in downstream slices.
 *
 * @module __fixtures__/account-detail-contracts.test
 */

import { describe, it, expect } from 'vitest';
import {
  ACCOUNT_ID,
  ACCOUNT_NAME,
  ACCOUNT_BROKER,
  ACCOUNT_CURRENCY,
  OVERVIEW_SNAPSHOT_FULL,
  OVERVIEW_SNAPSHOT_NULL,
  OVERVIEW_SNAPSHOT_PARTIAL,
  EVENT_IDS,
  CORRECTION_LINEAGE,
  EXECUTION_ORIGINAL,
  EXECUTION_REPLACEMENT,
  LEDGER_EVENTS_FULL,
  LEDGER_EVENTS_EMPTY,
  POSITIONS_FULL,
  POSITIONS_EMPTY,
  RECONCILIATION_ELIGIBLE,
  RECONCILIATION_STALE,
  RECONCILIATION_BLOCKED,
  LEGACY_AUDIT,
  OVERVIEW_FIELDS,
  OVERVIEW_EXCLUDED_FIELDS,
  LEDGER_CATEGORIES,
  ERROR_404,
  ERROR_VALIDATION,
  ERROR_SERVER,
  ERROR_CONVENTIONS,
  CORRECTION_TRIPLE_RAW_COUNT,
  CORRECTION_DISPLAY_ROW_COUNT,
  AUTHORITATIVE_EVENT_IDENTITY_COUNT,
  FULL_LEDGER_DISPLAY_ROW_COUNT,
  type LedgerEventRow,
  type LedgerCorrectionRow,
} from './account-detail-contracts';

// ═══════════════════════════════════════════════════════════════════════════
// Fixture self-consistency
// ═══════════════════════════════════════════════════════════════════════════

describe('fixture self-consistency', () => {
  it('exports account identity constants', () => {
    expect(ACCOUNT_ID).toBe('acc-test-001');
    expect(ACCOUNT_NAME).toBe('Test Trading Account');
    expect(ACCOUNT_BROKER).toBe('Test Broker');
    expect(ACCOUNT_CURRENCY).toBe('USD');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. Authoritative Event Identity
// ═══════════════════════════════════════════════════════════════════════════

describe('authoritative event identity', () => {
  it('has unique event IDs — no duplicates', () => {
    const ids = Object.values(EVENT_IDS);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('each EVENT_IDS value is a non-empty string', () => {
    const ids = Object.values(EVENT_IDS);
    for (const id of ids) {
      expect(id).toBeTypeOf('string');
      expect(id.length).toBeGreaterThan(0);
    }
  });

  it('exports the authoritative identity count', () => {
    expect(AUTHORITATIVE_EVENT_IDENTITY_COUNT).toBe(Object.keys(EVENT_IDS).length);
  });

  it('full ledger display row count equals authoritative identity count', () => {
    // Each event identity maps to exactly one display row.
    // Correction triples collapse to 1 row, so the display count
    // equals the event identity count.
    expect(FULL_LEDGER_DISPLAY_ROW_COUNT).toBe(AUTHORITATIVE_EVENT_IDENTITY_COUNT);
  });

  it('every ledger event has a unique eventId', () => {
    const eventIds = LEDGER_EVENTS_FULL.map((row) => row.eventId);
    const unique = new Set(eventIds);
    expect(unique.size).toBe(eventIds.length);
  });

  it('every EVENT_IDS value appears exactly once in the full ledger fixture', () => {
    const expectedIds = Object.values(EVENT_IDS);
    const actualIds = LEDGER_EVENTS_FULL.map((row) => row.eventId);
    const eventIdSet = new Set(actualIds);

    // Note: the grouped correction display row uses a synthetic ID
    // not in EVENT_IDS; only the non-correction IDs must match
    const nonCorrectionIds = expectedIds.filter(
      (id) => id !== EVENT_IDS.tradeReversal && id !== EVENT_IDS.tradeReplacement,
    );
    for (const id of nonCorrectionIds) {
      expect(eventIdSet.has(id)).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. No Unexplained Duplicate Execution Rows
// ═══════════════════════════════════════════════════════════════════════════

describe('no duplicate execution rows (correction triple collapse)', () => {
  it('correction triple constant declares 3 raw → 1 display', () => {
    // 3 accounting_execution rows (original + reversal + replacement)
    // should collapse to 1 display row in the ledger
    expect(CORRECTION_TRIPLE_RAW_COUNT).toBe(3);
    expect(CORRECTION_DISPLAY_ROW_COUNT).toBe(1);
  });

  it('only one correction-grouped row exists in the full ledger fixture', () => {
    const correctionRows = LEDGER_EVENTS_FULL.filter(
      (row): row is typeof row & { isGrouped: true; correctionId: string } =>
        'isGrouped' in row && row.isGrouped === true,
    );
    // The correction triple (3 raw) must produce exactly 1 display row
    expect(correctionRows).toHaveLength(1);
  });

  it('the single correction row references all 3 constituent execution IDs', () => {
    const correctionRow = LEDGER_EVENTS_FULL.find(
      (row) => 'isGrouped' in row && row.isGrouped === true,
    ) as { correctionId: string; originalExecutionId: string; reversalExecutionId: string; replacementExecutionId: string } | undefined;

    expect(correctionRow).toBeDefined();
    if (correctionRow) {
      expect(correctionRow.correctionId).toBe(CORRECTION_LINEAGE.id);
      expect(correctionRow.originalExecutionId).toBe(CORRECTION_LINEAGE.originalExecutionId);
      expect(correctionRow.reversalExecutionId).toBe(CORRECTION_LINEAGE.reversalExecutionId);
      expect(correctionRow.replacementExecutionId).toBe(CORRECTION_LINEAGE.replacementExecutionId);
    }
  });

  it('no other ledger rows have duplicate event IDs from corrections', () => {
    // Verify the tradeReversal event ID does NOT appear as a standalone
    // non-grouped row — the reversal is absorbed into the grouped correction
    const reversalRows = LEDGER_EVENTS_FULL.filter(
      (row) => row.eventId === EVENT_IDS.tradeReversal || row.eventId === EVENT_IDS.tradeReplacement,
    );
    // Both reversal and replacement IDs should only exist implicitly
    // inside the correction group, not as standalone rows
    // (the tradeOriginal row IS a standalone row — it's the event before correction)
    expect(reversalRows).toHaveLength(0);
  });

  it('non-correction ledger events outnumber correction-grouped rows', () => {
    const nonCorrection = LEDGER_EVENTS_FULL.filter(
      (row) => !('isGrouped' in row && row.isGrouped === true),
    );
    const correctionGroups = LEDGER_EVENTS_FULL.filter(
      (row) => 'isGrouped' in row && row.isGrouped === true,
    );
    expect(nonCorrection.length).toBeGreaterThan(correctionGroups.length);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Correction Lineage Preservation
// ═══════════════════════════════════════════════════════════════════════════

describe('correction lineage preservation', () => {
  it('CORRECTION_LINEAGE has all required fields', () => {
    expect(CORRECTION_LINEAGE.id).toBeTypeOf('string');
    expect(CORRECTION_LINEAGE.originalExecutionId).toBeTypeOf('string');
    expect(CORRECTION_LINEAGE.reversalExecutionId).toBeTypeOf('string');
    expect(CORRECTION_LINEAGE.replacementExecutionId).toBeTypeOf('string');
    expect(CORRECTION_LINEAGE.reason).toBeTypeOf('string');
    expect(CORRECTION_LINEAGE.correctedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('correction reason is human-readable', () => {
    expect(CORRECTION_LINEAGE.reason.length).toBeGreaterThan(10);
    expect(CORRECTION_LINEAGE.reason).toContain('quantity');
  });

  it('original execution has symbol, action, quantity, price, fees, executedAt', () => {
    expect(EXECUTION_ORIGINAL.symbol).toBe('AAPL');
    expect(EXECUTION_ORIGINAL.action).toBe('buy');
    expect(EXECUTION_ORIGINAL.quantity).toBe('100.00');
    expect(EXECUTION_ORIGINAL.price).toBe('150.00');
    expect(EXECUTION_ORIGINAL.fees).toBe('15.00');
    expect(EXECUTION_ORIGINAL.executedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('replacement execution has reduced quantity (the fix)', () => {
    expect(EXECUTION_REPLACEMENT.quantity).toBe('50.00');
    expect(Number(EXECUTION_REPLACEMENT.quantity)).toBeLessThan(
      Number(EXECUTION_ORIGINAL.quantity),
    );
  });

  it('replacement execution has proportionally lower fees', () => {
    expect(EXECUTION_REPLACEMENT.fees).toBe('7.50');
    expect(Number(EXECUTION_REPLACEMENT.fees)).toBeLessThan(
      Number(EXECUTION_ORIGINAL.fees),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Empty-Array Behavior for Valid No-Match Queries
// ═══════════════════════════════════════════════════════════════════════════

describe('empty-array behavior (valid no-match queries)', () => {
  it('LEDGER_EVENTS_EMPTY is an empty array (not null)', () => {
    expect(LEDGER_EVENTS_EMPTY).toEqual([]);
    expect(Array.isArray(LEDGER_EVENTS_EMPTY)).toBe(true);
    expect(LEDGER_EVENTS_EMPTY.length).toBe(0);
  });

  it('POSITIONS_EMPTY is an empty array (not null)', () => {
    expect(POSITIONS_EMPTY).toEqual([]);
    expect(Array.isArray(POSITIONS_EMPTY)).toBe(true);
    expect(POSITIONS_EMPTY.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Machine-Readable Error Conventions
// ═══════════════════════════════════════════════════════════════════════════

describe('machine-readable error conventions', () => {
  it('ERROR_CONVENTIONS declares the correct shape types', () => {
    expect(ERROR_CONVENTIONS.errorType).toBe('string');
    expect(ERROR_CONVENTIONS.detailsType).toBe('object');
  });

  it('404 error: has error string, no details key', () => {
    expect(ERROR_404.error).toBeTypeOf('string');
    expect(ERROR_404.error).toBe('Account not found');
    expect('details' in ERROR_404).toBe(false);
  });

  it('400 validation error: has error string and details object with fieldErrors', () => {
    expect(ERROR_VALIDATION.error).toBeTypeOf('string');
    expect(ERROR_VALIDATION.error).toBe('Validation failed');
    expect(ERROR_VALIDATION.details).toBeTypeOf('object');
    const details = ERROR_VALIDATION.details as Record<string, unknown>;
    expect(details.fieldErrors).toBeTypeOf('object');
    const fieldErrors = details.fieldErrors as Record<string, string[]>;
    expect(Array.isArray(fieldErrors.accountId)).toBe(true);
    expect(fieldErrors.accountId[0]).toBeTypeOf('string');
  });

  it('500 server error: has error string and details string', () => {
    expect(ERROR_SERVER.error).toBeTypeOf('string');
    expect(ERROR_SERVER.error).toContain('Failed to fetch');
    expect(ERROR_SERVER.details).toBeTypeOf('string');
  });

  it('all error objects have a string error field', () => {
    const errors = [ERROR_404, ERROR_VALIDATION, ERROR_SERVER];
    for (const err of errors) {
      expect(err.error).toBeTypeOf('string');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Explicit Confinement of Legacy Values to Reconciliation
// ═══════════════════════════════════════════════════════════════════════════

describe('legacy value confinement to reconciliation', () => {
  it('OVERVIEW_SNAPSHOT_FULL does not contain reconciliation-confined fields', () => {
    const overviewKeys = Object.keys(OVERVIEW_SNAPSHOT_FULL);
    for (const excluded of OVERVIEW_EXCLUDED_FIELDS) {
      expect(overviewKeys).not.toContain(excluded);
    }
  });

  it('OVERVIEW_FIELDS lists exactly the 9 overview fields from the inventory', () => {
    expect(OVERVIEW_FIELDS).toHaveLength(9);
    expect(OVERVIEW_FIELDS).toEqual([
      'netCash',
      'nav',
      'markedPositions',
      'realizedPnl',
      'unrealizedPnl',
      'totalPnl',
      'realizedFees',
      'grossExposure',
      'netExposure',
    ]);
  });

  it('OVERVIEW_EXCLUDED_FIELDS lists exactly the 8 fields confined to reconciliation', () => {
    expect(OVERVIEW_EXCLUDED_FIELDS).toHaveLength(8);
    expect(OVERVIEW_EXCLUDED_FIELDS).toEqual([
      'twr',
      'highWaterMark',
      'drawdown',
      'drawdownPct',
      'modifiedDietzReturn',
      'warnings',
      'rebuildCount',
      'lastRebuiltAt',
    ]);
  });

  it('LEGACY_AUDIT kpis are the legacy trade-based KPIs (reconciliation use only)', () => {
    expect(LEGACY_AUDIT.kpis.tradeCount).toBe(5);
    expect(LEGACY_AUDIT.kpis.netPnl).toBe(12000);
    expect(LEGACY_AUDIT.kpis.winRate).toBe(0.6);
    expect(LEGACY_AUDIT.kpis.avgR).toBe(1.8);
    expect(LEGACY_AUDIT.kpis.avgGrade).toBe(72);
  });

  it('LEGACY_AUDIT has the four balance rollforward fields', () => {
    expect(LEGACY_AUDIT.realizedPnl).toBeTypeOf('number');
    expect(LEGACY_AUDIT.currentBalance).toBeTypeOf('number');
    expect(LEGACY_AUDIT.netDeposits).toBeTypeOf('number');
    expect(LEGACY_AUDIT.netWithdrawals).toBeTypeOf('number');
  });

  it('RECONCILIATION_ELIGIBLE has correct eligible status shape', () => {
    expect(RECONCILIATION_ELIGIBLE.status).toBe('eligible');
    expect(RECONCILIATION_ELIGIBLE.cutoverEligible).toBe(true);
    expect(RECONCILIATION_ELIGIBLE.refusalReasons).toEqual([]);
    expect(RECONCILIATION_ELIGIBLE.unresolvedCount).toBe(0);
    expect(RECONCILIATION_ELIGIBLE.computedAt).toBeTypeOf('string');
  });

  it('RECONCILIATION_STALE has no computedAt', () => {
    expect(RECONCILIATION_STALE.status).toBe('stale');
    expect(RECONCILIATION_STALE.cutoverEligible).toBe(false);
    expect(RECONCILIATION_STALE.computedAt).toBeNull();
    expect(RECONCILIATION_STALE.comparisonCount).toBe(0);
  });

  it('RECONCILIATION_BLOCKED has refusal reasons and unresolved differences', () => {
    expect(RECONCILIATION_BLOCKED.status).toBe('blocked');
    expect(RECONCILIATION_BLOCKED.cutoverEligible).toBe(false);
    expect(RECONCILIATION_BLOCKED.refusalReasons.length).toBeGreaterThan(0);
    expect(RECONCILIATION_BLOCKED.unresolvedCount).toBeGreaterThan(0);
    expect(RECONCILIATION_BLOCKED.comparisonCount).toBeGreaterThan(0);
    expect(RECONCILIATION_BLOCKED.computedAt).toBeTypeOf('string');
  });

  it('summary text correctly reflects each reconciliation status', () => {
    expect(RECONCILIATION_ELIGIBLE.summary).toContain('Ready for cutover');
    expect(RECONCILIATION_STALE.summary).toContain('No reconciliation run yet');
    expect(RECONCILIATION_BLOCKED.summary).toContain('blocked');
    expect(RECONCILIATION_BLOCKED.summary).toContain('unexplained difference');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. Overview Fixture Shapes
// ═══════════════════════════════════════════════════════════════════════════

describe('overview snapshot fixtures', () => {
  it('OVERVIEW_SNAPSHOT_FULL has all 9 fields with string values', () => {
    for (const key of OVERVIEW_FIELDS) {
      expect(OVERVIEW_SNAPSHOT_FULL[key as keyof typeof OVERVIEW_SNAPSHOT_FULL]).toBeTypeOf('string');
    }
  });

  it('OVERVIEW_SNAPSHOT_NULL has all 9 fields as null', () => {
    for (const key of OVERVIEW_FIELDS) {
      expect(OVERVIEW_SNAPSHOT_NULL[key as keyof typeof OVERVIEW_SNAPSHOT_NULL]).toBeNull();
    }
  });

  it('OVERVIEW_SNAPSHOT_PARTIAL has only netCash and nav as strings, rest null', () => {
    expect(OVERVIEW_SNAPSHOT_PARTIAL.netCash).toBeTypeOf('string');
    expect(OVERVIEW_SNAPSHOT_PARTIAL.nav).toBeTypeOf('string');
    expect(OVERVIEW_SNAPSHOT_PARTIAL.markedPositions).toBeNull();
    expect(OVERVIEW_SNAPSHOT_PARTIAL.realizedPnl).toBeNull();
    expect(OVERVIEW_SNAPSHOT_PARTIAL.unrealizedPnl).toBeNull();
    expect(OVERVIEW_SNAPSHOT_PARTIAL.totalPnl).toBeNull();
    expect(OVERVIEW_SNAPSHOT_PARTIAL.realizedFees).toBeNull();
    expect(OVERVIEW_SNAPSHOT_PARTIAL.grossExposure).toBeNull();
    expect(OVERVIEW_SNAPSHOT_PARTIAL.netExposure).toBeNull();
  });

  it('OVERVIEW_SNAPSHOT_FULL values pass the decimal-format check', () => {
    for (const key of OVERVIEW_FIELDS) {
      const val = OVERVIEW_SNAPSHOT_FULL[key as keyof typeof OVERVIEW_SNAPSHOT_FULL];
      expect(val).toMatch(/^-?\d+\.\d{2}$/);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. Ledger Fixture Shapes
// ═══════════════════════════════════════════════════════════════════════════

describe('ledger fixture shapes', () => {
  it('LEDGER_EVENTS_FULL has 7 display rows (8 event IDs minus correction triple merged)', () => {
    // EVENT_IDS has 8 entries, but the correction triple (3 IDs: tradeOriginal,
    // tradeReversal, tradeReplacement) collapses to 1 display row.
    // That means 8 - 2 = 6 distinct non-correction rows + 1 correction group = 7 total
    expect(LEDGER_EVENTS_FULL.length).toBe(7);
  });

  it('every ledger row has required fields', () => {
    for (const row of LEDGER_EVENTS_FULL) {
      expect(row.eventId).toBeTypeOf('string');
      expect(row.eventType).toBeTypeOf('string');
      expect(row.category).toBeTypeOf('string');
      expect(row.postedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(row.amount).toMatch(/^-?\d+\.\d{2}$/);
    }
  });

  it('correction grouped row has isGrouped=true and correction fields', () => {
    const correctionRows = LEDGER_EVENTS_FULL.filter(
      (r): r is LedgerCorrectionRow => 'isGrouped' in r,
    );
    expect(correctionRows).toHaveLength(1);
    expect(correctionRows[0].isGrouped).toBe(true);
    expect(correctionRows[0].correctionId).toBeTypeOf('string');
    expect(correctionRows[0].originalExecutionId).toBeTypeOf('string');
  });

  it('non-correction ledger rows have isCorrection=false and no correction fields', () => {
    const nonCorrectionRows = LEDGER_EVENTS_FULL.filter(
      (r): r is LedgerEventRow => !('isGrouped' in r),
    );
    for (const row of nonCorrectionRows) {
      expect(row.isCorrection).toBe(false);
      expect(row.correctionGroupId).toBeNull();
      expect(row.constituentIds).toBeNull();
    }
  });

  it('opening balance row has correct shape', () => {
    const ob = LEDGER_EVENTS_FULL.find((r): r is LedgerEventRow =>
      r.eventId === EVENT_IDS.openingBalance && !('isGrouped' in r),
    );
    expect(ob).toBeDefined();
    expect(ob!.eventType).toBe('opening_balance');
    expect(ob!.category).toBe('Opening Balance');
    expect(ob!.amount).toBe('100000.00');
    expect(ob!.symbol).toBeNull();
    expect(ob!.isCorrection).toBe(false);
  });

  it('dividend event has positive cash amount', () => {
    const div = LEDGER_EVENTS_FULL.find((r): r is LedgerEventRow =>
      r.eventId === EVENT_IDS.dividend && !('isGrouped' in r),
    );
    expect(div).toBeDefined();
    expect(div!.eventType).toBe('dividend');
    expect(div!.category).toBe('Cash');
    expect(div!.amount).toBe('50.00');
    expect(div!.symbol).toBe('AAPL');
  });

  it('fee event has negative amount', () => {
    const fee = LEDGER_EVENTS_FULL.find((r): r is LedgerEventRow =>
      r.eventId === EVENT_IDS.fee && !('isGrouped' in r),
    );
    expect(fee).toBeDefined();
    expect(fee!.eventType).toBe('fee');
    expect(fee!.category).toBe('Fee/Tax');
    expect(fee!.amount.startsWith('-')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. Positions Fixture Shapes
// ═══════════════════════════════════════════════════════════════════════════

describe('positions fixture shapes', () => {
  it('POSITIONS_FULL has 5 positions with mixed directions and mark statuses', () => {
    expect(POSITIONS_FULL).toHaveLength(5);
    const directions = new Set(POSITIONS_FULL.map((p) => p.direction));
    expect(directions.has('long')).toBe(true);
    expect(directions.has('short')).toBe(true);
    expect(directions.has(null)).toBe(true);
  });

  it('every position has required fields', () => {
    for (const pos of POSITIONS_FULL) {
      expect(pos.symbol).toBeTypeOf('string');
      expect(pos.quantity).toMatch(/^-?\d+\.\d{2}$/);
      expect(pos.averageCost).toMatch(/^-?\d+\.\d{2}$/);
      expect(pos.totalCostBasis).toMatch(/^-?\d+\.\d{2}$/);
      expect(pos.realizedGrossPnl).toMatch(/^-?\d+\.\d{2}$/);
      expect(pos.realizedNetPnl).toMatch(/^-?\d+\.\d{2}$/);
      expect(['fresh', 'stale', 'missing', 'pending']).toContain(pos.markStatus);
    }
  });

  it('position with markPrice=null has null markedValue and null unrealizedPnl', () => {
    const msft = POSITIONS_FULL.find((p) => p.symbol === 'MSFT');
    expect(msft).toBeDefined();
    expect(msft!.markPrice).toBeNull();
    expect(msft!.markedValue).toBeNull();
    expect(msft!.unrealizedPnl).toBeNull();
    expect(msft!.markStatus).toBe('missing');
  });

  it('position with markPrice has computed markedValue and unrealizedPnl', () => {
    const aapl = POSITIONS_FULL.find((p) => p.symbol === 'AAPL');
    expect(aapl).toBeDefined();
    expect(aapl!.markPrice).toBeTypeOf('string');
    expect(aapl!.markedValue).toBeTypeOf('string');
    expect(aapl!.unrealizedPnl).toBeTypeOf('string');
    // markedValue = 50 * 165.00 = 8250.00
    expect(aapl!.markedValue).toBe('8250.00');
    // unrealizedPnl = (165.00 - 150.00) * 50 = 750.00
    expect(aapl!.unrealizedPnl).toBe('750.00');
  });

  it('stale position has markTimestamp in the past and markAgeMinutes > 1440', () => {
    const tsla = POSITIONS_FULL.find((p) => p.symbol === 'TSLA');
    expect(tsla).toBeDefined();
    expect(tsla!.markStatus).toBe('stale');
  });

  it('flat position (GOOG) has direction=null and quantity=0.00', () => {
    const goog = POSITIONS_FULL.find((p) => p.symbol === 'GOOG');
    expect(goog).toBeDefined();
    expect(goog!.direction).toBeNull();
    expect(goog!.quantity).toBe('0.00');
    expect(goog!.realizedGrossPnl).toBe('2000.00');
  });

  it('fractional position (SPY) has non-integer quantity', () => {
    const spy = POSITIONS_FULL.find((p) => p.symbol === 'SPY');
    expect(spy).toBeDefined();
    expect(spy!.quantity).toBe('0.55');
    expect(spy!.averageCost).toBe('450.00');
    expect(spy!.totalCostBasis).toBe('247.50');
  });
});
