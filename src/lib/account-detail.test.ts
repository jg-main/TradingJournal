/**
 * Tests for the pure account-detail mapping contracts.
 *
 * Covers all 6 mapping modules with test scenarios for normal, empty,
 * blocked, duplicate-risk, missing-price, negative-zero, and
 * grouped-correction cases.
 *
 * Pure-function tests — no database, no API routes, no side effects.
 *
 * @module account-detail.test
 */

import { describe, it, expect } from 'vitest';
import {
  composeOverviewSnapshot,
  deriveBannerState,
  classifyPriceStatus,
  categorizeLedgerEvent,
  groupCorrection,
  groupCorrections,
  mapPositionRow,
  mapPositionRows,
} from './account-detail';
import type {
  OverviewSnapshotInput,
  BannerStateInput,
  PriceStatusInput,
  CorrectionGroupInput,
  CorrectionExecutionInput,
  PositionRowInput,
} from './account-detail';

// ═══════════════════════════════════════════════════════════════════════════
// 1. Overview Snapshot Composition
// ═══════════════════════════════════════════════════════════════════════════

describe('composeOverviewSnapshot', () => {
  // ── Normal case ─────────────────────────────────────────────────────

  it('composes a full overview snapshot from projection data', () => {
    const input: OverviewSnapshotInput = {
      netCash: '50000.00',
      nav: '150000.00',
      markedPositions: '100000.00',
      realizedPnl: '25000.00',
      unrealizedPnl: '5000.00',
      totalPnl: '30000.00',
      realizedFees: '1500.00',
      grossExposure: '200000.00',
      netExposure: '150000.00',
    };

    const result = composeOverviewSnapshot(input);

    expect(result).toEqual({
      netCash: '50000.00',
      nav: '150000.00',
      markedPositions: '100000.00',
      realizedPnl: '25000.00',
      unrealizedPnl: '5000.00',
      totalPnl: '30000.00',
      realizedFees: '1500.00',
      grossExposure: '200000.00',
      netExposure: '150000.00',
    });
  });

  // ── Empty / null preservation ───────────────────────────────────────

  it('preserves null when all projection fields are null', () => {
    const input: OverviewSnapshotInput = {
      netCash: null,
      nav: null,
      markedPositions: null,
      realizedPnl: null,
      unrealizedPnl: null,
      totalPnl: null,
      realizedFees: null,
      grossExposure: null,
      netExposure: null,
    };

    const result = composeOverviewSnapshot(input);

    expect(result.netCash).toBeNull();
    expect(result.nav).toBeNull();
    expect(result.markedPositions).toBeNull();
    expect(result.realizedPnl).toBeNull();
    expect(result.unrealizedPnl).toBeNull();
    expect(result.totalPnl).toBeNull();
    expect(result.realizedFees).toBeNull();
    expect(result.grossExposure).toBeNull();
    expect(result.netExposure).toBeNull();
  });

  it('preserves null for undefined fields via nullish coalescing', () => {
    const input: OverviewSnapshotInput = {
      netCash: '1000.00',
      nav: null,
      markedPositions: null,
      realizedPnl: undefined as unknown as null,
      unrealizedPnl: undefined as unknown as null,
      totalPnl: undefined as unknown as null,
      realizedFees: undefined as unknown as null,
      grossExposure: undefined as unknown as null,
      netExposure: undefined as unknown as null,
    };

    const result = composeOverviewSnapshot(input);

    expect(result.netCash).toBe('1000.00');
    expect(result.nav).toBeNull();
    expect(result.realizedPnl).toBeNull();
    expect(result.unrealizedPnl).toBeNull();
    expect(result.totalPnl).toBeNull();
  });

  // ── Negative values (negative-zero semantics) ───────────────────────

  it('preserves negative values in snapshot fields', () => {
    const input: OverviewSnapshotInput = {
      netCash: '-2000.00',
      nav: '100000.00',
      markedPositions: '95000.00',
      realizedPnl: '-5000.00',
      unrealizedPnl: '2000.00',
      totalPnl: '-3000.00',
      realizedFees: '500.00',
      grossExposure: '50000.00',
      netExposure: '-50000.00',
    };

    const result = composeOverviewSnapshot(input);

    expect(result.realizedPnl).toBe('-5000.00');
    expect(result.totalPnl).toBe('-3000.00');
    expect(result.netExposure).toBe('-50000.00');
    expect(result.netCash).toBe('-2000.00');
  });

  // ── No excluded fields leak ─────────────────────────────────────────

  it('does not contain reconciliation-confined fields', () => {
    const input: OverviewSnapshotInput = {
      netCash: '50000.00',
      nav: '150000.00',
      markedPositions: '100000.00',
      realizedPnl: '25000.00',
      unrealizedPnl: '5000.00',
      totalPnl: '30000.00',
      realizedFees: '1500.00',
      grossExposure: '200000.00',
      netExposure: '150000.00',
    };

    const result = composeOverviewSnapshot(input);

    // These fields belong to Reconciliation tab — must NOT appear
    expect(result).not.toHaveProperty('twr');
    expect(result).not.toHaveProperty('highWaterMark');
    expect(result).not.toHaveProperty('drawdown');
    expect(result).not.toHaveProperty('drawdownPct');
    expect(result).not.toHaveProperty('modifiedDietzReturn');
    expect(result).not.toHaveProperty('rebuildCount');
    expect(result).not.toHaveProperty('lastRebuiltAt');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Reconciliation Banner State
// ═══════════════════════════════════════════════════════════════════════════

describe('deriveBannerState', () => {
  // ── Eligible case ───────────────────────────────────────────────────

  it('returns eligible status when cutoverEligible is true', () => {
    const input: BannerStateInput = {
      cutoverEligible: true,
      cutoverRefusalReasons: [],
      comparisons: 12,
      matching: 10,
      explained: 2,
      unexplained: 0,
      computedAt: '2026-07-15T12:00:00.000Z',
    };

    const result = deriveBannerState(input);

    expect(result.status).toBe('eligible');
    expect(result.cutoverEligible).toBe(true);
    expect(result.refusalReasons).toEqual([]);
    expect(result.comparisonCount).toBe(12);
    expect(result.resolvedCount).toBe(12);
    expect(result.unresolvedCount).toBe(0);
    expect(result.summary).toContain('Ready for cutover');
  });

  // ── Stale case ──────────────────────────────────────────────────────

  it('returns stale status when no computedAt timestamp', () => {
    const input: BannerStateInput = {
      cutoverEligible: false,
      cutoverRefusalReasons: [],
      comparisons: 0,
      matching: 0,
      explained: 0,
      unexplained: 0,
      computedAt: null,
    };

    const result = deriveBannerState(input);

    expect(result.status).toBe('stale');
    expect(result.cutoverEligible).toBe(false);
    expect(result.refusalReasons).toEqual([]);
    expect(result.summary).toContain('No reconciliation run yet');
  });

  // ── Blocked case ────────────────────────────────────────────────────

  it('returns blocked status when cutoverEligible is false with computedAt', () => {
    const input: BannerStateInput = {
      cutoverEligible: false,
      cutoverRefusalReasons: ['Unexplained differences found in execution count comparison'],
      comparisons: 12,
      matching: 8,
      explained: 2,
      unexplained: 2,
      computedAt: '2026-07-15T12:00:00.000Z',
    };

    const result = deriveBannerState(input);

    expect(result.status).toBe('blocked');
    expect(result.cutoverEligible).toBe(false);
    expect(result.refusalReasons).toHaveLength(1);
    expect(result.refusalReasons[0]).toContain('Unexplained differences');
    expect(result.comparisonCount).toBe(12);
    expect(result.resolvedCount).toBe(10);
    expect(result.unresolvedCount).toBe(2);
    expect(result.summary).toContain('blocked');
    expect(result.summary).toContain('2 unexplained');
  });

  // ── Blocked with multiple refusal reasons ───────────────────────────

  it('includes all refusal reasons when blocked', () => {
    const input: BannerStateInput = {
      cutoverEligible: false,
      cutoverRefusalReasons: [
        'Execution count mismatch: legacy 15 vs accounting 12',
        'Fee total mismatch: legacy 1250.00 vs accounting 1248.50',
      ],
      comparisons: 10,
      matching: 6,
      explained: 2,
      unexplained: 2,
      computedAt: '2026-07-15T14:00:00.000Z',
    };

    const result = deriveBannerState(input);

    expect(result.status).toBe('blocked');
    expect(result.refusalReasons).toHaveLength(2);
  });

  // ── Zero comparison edge case ───────────────────────────────────────

  it('handles zero comparisons gracefully', () => {
    const input: BannerStateInput = {
      cutoverEligible: true,
      cutoverRefusalReasons: [],
      comparisons: 0,
      matching: 0,
      explained: 0,
      unexplained: 0,
      computedAt: '2026-07-15T12:00:00.000Z',
    };

    const result = deriveBannerState(input);

    expect(result.status).toBe('eligible');
    expect(result.comparisonCount).toBe(0);
    expect(result.resolvedCount).toBe(0);
    expect(result.unresolvedCount).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Price-Status Classification
// ═══════════════════════════════════════════════════════════════════════════

describe('classifyPriceStatus', () => {
  // ── Fresh (normal) ──────────────────────────────────────────────────

  it('returns fresh when mark is within freshness threshold', () => {
    const input: PriceStatusInput = {
      markTimestamp: '2026-07-15T12:00:00.000Z',
      markAgeMinutes: 30,
      hasPrice: true,
    };

    expect(classifyPriceStatus(input)).toBe('fresh');
  });

  it('returns fresh when mark age equals the threshold', () => {
    const input: PriceStatusInput = {
      markTimestamp: '2026-07-15T12:00:00.000Z',
      markAgeMinutes: 1440,
      hasPrice: true,
    };

    expect(classifyPriceStatus(input)).toBe('fresh');
  });

  it('respects custom freshness threshold', () => {
    const withinCustom: PriceStatusInput = {
      markTimestamp: '2026-07-15T12:00:00.000Z',
      markAgeMinutes: 60,
      hasPrice: true,
    };

    // 60 <= 120 → fresh
    expect(classifyPriceStatus(withinCustom, 120)).toBe('fresh');
  });

  // ── Stale ───────────────────────────────────────────────────────────

  it('returns stale when mark exceeds freshness threshold', () => {
    const input: PriceStatusInput = {
      markTimestamp: '2026-07-14T12:00:00.000Z',
      markAgeMinutes: 1500, // > 1440
      hasPrice: true,
    };

    expect(classifyPriceStatus(input)).toBe('stale');
  });

  it('returns stale with custom threshold', () => {
    const input: PriceStatusInput = {
      markTimestamp: '2026-07-15T12:00:00.000Z',
      markAgeMinutes: 61,
      hasPrice: true,
    };

    // 61 > 60 → stale
    expect(classifyPriceStatus(input, 60)).toBe('stale');
  });

  // ── Missing price ───────────────────────────────────────────────────

  it('returns missing when hasPrice is false', () => {
    const input: PriceStatusInput = {
      markTimestamp: null,
      markAgeMinutes: null,
      hasPrice: false,
    };

    expect(classifyPriceStatus(input)).toBe('missing');
  });

  it('returns missing when markTimestamp is null even if hasPrice is true', () => {
    const input: PriceStatusInput = {
      markTimestamp: null,
      markAgeMinutes: null,
      hasPrice: true,
    };

    expect(classifyPriceStatus(input)).toBe('missing');
  });

  // ── Pending (indeterminate age) ─────────────────────────────────────

  it('returns pending when markAgeMinutes is null', () => {
    const input: PriceStatusInput = {
      markTimestamp: '2026-07-15T12:00:00.000Z',
      markAgeMinutes: null,
      hasPrice: true,
    };

    expect(classifyPriceStatus(input)).toBe('pending');
  });

  it('returns pending when markAgeMinutes is negative (future timestamp)', () => {
    const input: PriceStatusInput = {
      markTimestamp: '2026-07-20T12:00:00.000Z',
      markAgeMinutes: -100,
      hasPrice: true,
    };

    expect(classifyPriceStatus(input)).toBe('pending');
  });

  // ── Edge: very old stale mark ───────────────────────────────────────

  it('returns stale for a very old mark', () => {
    const input: PriceStatusInput = {
      markTimestamp: '2025-01-01T00:00:00.000Z',
      markAgeMinutes: 500_000,
      hasPrice: true,
    };

    expect(classifyPriceStatus(input)).toBe('stale');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Ledger Category Mapping
// ═══════════════════════════════════════════════════════════════════════════

describe('categorizeLedgerEvent', () => {
  // ── All known event types ───────────────────────────────────────────

  it('maps opening_balance to Opening Balance', () => {
    expect(categorizeLedgerEvent('opening_balance')).toBe('Opening Balance');
  });

  it('maps deposit to Cash', () => {
    expect(categorizeLedgerEvent('deposit')).toBe('Cash');
  });

  it('maps withdrawal to Cash', () => {
    expect(categorizeLedgerEvent('withdrawal')).toBe('Cash');
  });

  it('maps dividend to Cash', () => {
    expect(categorizeLedgerEvent('dividend')).toBe('Cash');
  });

  it('maps interest to Cash', () => {
    expect(categorizeLedgerEvent('interest')).toBe('Cash');
  });

  it('maps fee to Fee/Tax', () => {
    expect(categorizeLedgerEvent('fee')).toBe('Fee/Tax');
  });

  it('maps tax to Fee/Tax', () => {
    expect(categorizeLedgerEvent('tax')).toBe('Fee/Tax');
  });

  it('maps trade_execution to Trade', () => {
    expect(categorizeLedgerEvent('trade_execution')).toBe('Trade');
  });

  it('maps adjustment to Adjustment', () => {
    expect(categorizeLedgerEvent('adjustment')).toBe('Adjustment');
  });

  it('maps transfer to Transfer', () => {
    expect(categorizeLedgerEvent('transfer')).toBe('Transfer');
  });

  it('maps stock_split to Corporate Action', () => {
    expect(categorizeLedgerEvent('stock_split')).toBe('Corporate Action');
  });

  it('maps manual_adjustment to Adjustment', () => {
    expect(categorizeLedgerEvent('manual_adjustment')).toBe('Adjustment');
  });

  // ── Unknown / fallback ──────────────────────────────────────────────

  it('maps unknown event type to Adjustment fallback', () => {
    expect(categorizeLedgerEvent('unknown_type')).toBe('Adjustment');
  });

  it('maps empty string to Adjustment fallback', () => {
    expect(categorizeLedgerEvent('')).toBe('Adjustment');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Correction Grouping
// ═══════════════════════════════════════════════════════════════════════════

describe('groupCorrection', () => {
  // ── Normal grouped correction ───────────────────────────────────────

  it('groups a correction triple into a single display row', () => {
    const lineage: CorrectionGroupInput = {
      id: 'corr-001',
      originalExecutionId: 'exec-original-001',
      reversalExecutionId: 'exec-reversal-001',
      replacementExecutionId: 'exec-replacement-001',
      reason: 'Wrong quantity entered',
      correctedAt: '2026-07-15T14:00:00.000Z',
    };

    const original: CorrectionExecutionInput = {
      symbol: 'AAPL',
      action: 'buy',
      quantity: '100.00',
    };

    const replacement: CorrectionExecutionInput = {
      symbol: 'AAPL',
      action: 'buy',
      quantity: '50.00',
    };

    const result = groupCorrection(lineage, original, replacement);

    expect(result.correctionId).toBe('corr-001');
    expect(result.originalExecutionId).toBe('exec-original-001');
    expect(result.reversalExecutionId).toBe('exec-reversal-001');
    expect(result.replacementExecutionId).toBe('exec-replacement-001');
    expect(result.symbol).toBe('AAPL');
    expect(result.originalAction).toBe('buy');
    expect(result.replacementAction).toBe('buy');
    expect(result.originalQuantity).toBe('100.00');
    expect(result.replacementQuantity).toBe('50.00');
    expect(result.reason).toBe('Wrong quantity entered');
    expect(result.correctedAt).toBe('2026-07-15T14:00:00.000Z');
  });

  // ── Correction with symbol change ───────────────────────────────────

  it('uses replacement symbol for the group', () => {
    const lineage: CorrectionGroupInput = {
      id: 'corr-002',
      originalExecutionId: 'exec-orig-002',
      reversalExecutionId: 'exec-rev-002',
      replacementExecutionId: 'exec-repl-002',
      reason: 'Wrong ticker',
      correctedAt: '2026-07-15T15:00:00.000Z',
    };

    const original: CorrectionExecutionInput = {
      symbol: 'GOOGL',
      action: 'sell',
      quantity: '200.00',
    };

    const replacement: CorrectionExecutionInput = {
      symbol: 'GOOG',
      action: 'sell',
      quantity: '200.00',
    };

    const result = groupCorrection(lineage, original, replacement);

    expect(result.symbol).toBe('GOOG');
    expect(result.originalAction).toBe('sell');
    expect(result.replacementAction).toBe('sell');
  });

  // ── Correction with null reason ─────────────────────────────────────

  it('preserves null reason', () => {
    const lineage: CorrectionGroupInput = {
      id: 'corr-003',
      originalExecutionId: 'exec-orig-003',
      reversalExecutionId: 'exec-rev-003',
      replacementExecutionId: 'exec-repl-003',
      reason: null,
      correctedAt: '2026-07-15T16:00:00.000Z',
    };

    const original: CorrectionExecutionInput = {
      symbol: 'TSLA',
      action: 'buy',
      quantity: '10.00',
    };

    const replacement: CorrectionExecutionInput = {
      symbol: 'TSLA',
      action: 'buy',
      quantity: '15.00',
    };

    const result = groupCorrection(lineage, original, replacement);

    expect(result.reason).toBeNull();
  });
});

describe('groupCorrections', () => {
  // ── Multiple corrections ────────────────────────────────────────────

  it('groups multiple corrections in input order', () => {
    const corrections = [
      {
        lineage: {
          id: 'corr-001',
          originalExecutionId: 'exec-orig-001',
          reversalExecutionId: 'exec-rev-001',
          replacementExecutionId: 'exec-repl-001',
          reason: 'Wrong quantity',
          correctedAt: '2026-07-15T14:00:00.000Z',
        },
        original: { symbol: 'AAPL', action: 'buy', quantity: '100.00' },
        replacement: { symbol: 'AAPL', action: 'buy', quantity: '50.00' },
      },
      {
        lineage: {
          id: 'corr-002',
          originalExecutionId: 'exec-orig-002',
          reversalExecutionId: 'exec-rev-002',
          replacementExecutionId: 'exec-repl-002',
          reason: 'Wrong ticker',
          correctedAt: '2026-07-15T15:00:00.000Z',
        },
        original: { symbol: 'GOOGL', action: 'sell', quantity: '200.00' },
        replacement: { symbol: 'GOOG', action: 'sell', quantity: '200.00' },
      },
    ];

    const results = groupCorrections(corrections);

    expect(results).toHaveLength(2);
    expect(results[0].correctionId).toBe('corr-001');
    expect(results[1].correctionId).toBe('corr-002');
  });

  // ── Empty correction list ───────────────────────────────────────────

  it('returns empty array for no corrections', () => {
    const results = groupCorrections([]);
    expect(results).toEqual([]);
  });

  // ── Duplicate-risk correction grouping ──────────────────────────────

  it('groups corrections preserving all constituent IDs for audit', () => {
    const corrections = [
      {
        lineage: {
          id: 'corr-003',
          originalExecutionId: 'exec-dup-orig-001',
          reversalExecutionId: 'exec-dup-rev-001',
          replacementExecutionId: 'exec-dup-repl-001',
          reason: 'Duplicate execution correction',
          correctedAt: '2026-07-15T16:00:00.000Z',
        },
        original: { symbol: 'MSFT', action: 'buy', quantity: '50.00' },
        replacement: { symbol: 'MSFT', action: 'buy', quantity: '50.00' },
      },
    ];

    const results = groupCorrections(corrections);

    expect(results[0].originalExecutionId).toBe('exec-dup-orig-001');
    expect(results[0].reversalExecutionId).toBe('exec-dup-rev-001');
    expect(results[0].replacementExecutionId).toBe('exec-dup-repl-001');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Positions Row Mapping
// ═══════════════════════════════════════════════════════════════════════════

describe('mapPositionRow', () => {
  // ── Normal long position with fresh mark ────────────────────────────

  it('maps a long position with fresh mark data', () => {
    const input: PositionRowInput = {
      symbol: 'AAPL',
      direction: 'long',
      quantity: '100.00',
      averageCost: '150.75',
      totalCostBasis: '15075.00',
      realizedGrossPnl: '500.00',
      realizedNetPnl: '485.00',
      markTimestamp: '2026-07-15T12:00:00.000Z',
      markPrice: '165.00',
      markAgeMinutes: 30,
    };

    const result = mapPositionRow(input);

    expect(result.symbol).toBe('AAPL');
    expect(result.direction).toBe('long');
    expect(result.quantity).toBe('100.00');
    expect(result.averageCost).toBe('150.75');
    expect(result.totalCostBasis).toBe('15075.00');
    expect(result.markStatus).toBe('fresh');
    expect(result.markPrice).toBe('165.00');
    // markedValue = 100.00 * 165.00 = 16500.00
    expect(result.markedValue).toBe('16500.00');
    // unrealizedPnl = (165.00 - 150.75) * 100.00 = 1425.00
    expect(result.unrealizedPnl).toBe('1425.00');
    expect(result.realizedGrossPnl).toBe('500.00');
    expect(result.realizedNetPnl).toBe('485.00');
  });

  // ── Short position with stale mark ──────────────────────────────────

  it('maps a short position with stale mark', () => {
    const input: PositionRowInput = {
      symbol: 'TSLA',
      direction: 'short',
      quantity: '50.00',
      averageCost: '200.00',
      totalCostBasis: '10000.00',
      realizedGrossPnl: '-250.00',
      realizedNetPnl: '-260.00',
      markTimestamp: '2026-07-10T12:00:00.000Z',
      markPrice: '210.00',
      markAgeMinutes: 4320, // 3 days
    };

    const result = mapPositionRow(input);

    expect(result.symbol).toBe('TSLA');
    expect(result.direction).toBe('short');
    expect(result.markStatus).toBe('stale');
    expect(result.markPrice).toBe('210.00');
    // Unrealized P&L for a short = (averageCost - markPrice) × quantity.
    expect(result.unrealizedPnl).toBe('-500.00');
    expect(result.realizedGrossPnl).toBe('-250.00');
    expect(result.realizedNetPnl).toBe('-260.00');
  });

  // ── Missing price (no mark) ─────────────────────────────────────────

  it('maps a position with missing price as markStatus = missing', () => {
    const input: PositionRowInput = {
      symbol: 'MSFT',
      direction: 'long',
      quantity: '200.00',
      averageCost: '300.00',
      totalCostBasis: '60000.00',
      realizedGrossPnl: '1000.00',
      realizedNetPnl: '985.00',
      markTimestamp: null,
      markPrice: null,
      markAgeMinutes: null,
    };

    const result = mapPositionRow(input);

    expect(result.symbol).toBe('MSFT');
    expect(result.markStatus).toBe('missing');
    expect(result.markPrice).toBeNull();
    expect(result.markedValue).toBeNull();
    expect(result.unrealizedPnl).toBeNull();
  });

  // ── Negative-zero position ──────────────────────────────────────────

  it('maps a flat (zero-quantity) position correctly', () => {
    const input: PositionRowInput = {
      symbol: 'AAPL',
      direction: null,
      quantity: '0.00',
      averageCost: '0.00',
      totalCostBasis: '0.00',
      realizedGrossPnl: '5000.00',
      realizedNetPnl: '4850.00',
      markTimestamp: null,
      markPrice: null,
      markAgeMinutes: null,
    };

    const result = mapPositionRow(input);

    expect(result.direction).toBeNull();
    expect(result.quantity).toBe('0.00');
    expect(result.averageCost).toBe('0.00');
    expect(result.markStatus).toBe('missing');
    expect(result.markedValue).toBeNull();
    expect(result.unrealizedPnl).toBeNull();
    expect(result.realizedGrossPnl).toBe('5000.00');
    expect(result.realizedNetPnl).toBe('4850.00');
  });

  // ── Pending mark (age unavailable) ──────────────────────────────────

  it('maps a position with pending mark status', () => {
    const input: PositionRowInput = {
      symbol: 'GOOG',
      direction: 'long',
      quantity: '10.00',
      averageCost: '1500.00',
      totalCostBasis: '15000.00',
      realizedGrossPnl: '200.00',
      realizedNetPnl: '190.00',
      markTimestamp: '2026-07-15T12:00:00.000Z',
      markPrice: '1550.00',
      markAgeMinutes: null,
    };

    const result = mapPositionRow(input);

    expect(result.markStatus).toBe('pending');
    expect(result.markPrice).toBe('1550.00');
    expect(result.markedValue).toBe('15500.00'); // 10.00 * 1550.00
    expect(result.unrealizedPnl).toBe('500.00'); // (1550 - 1500) * 10
  });

  // ── Duplicate-risk position (included symbol) ───────────────────────

  it('maps a duplicate-risk position symbol without issues', () => {
    // This tests that positions with symbols that appear in the
    // duplicate execution risk register still map correctly
    const input: PositionRowInput = {
      symbol: 'AAPL',
      direction: 'long',
      quantity: '100.00',
      averageCost: '150.00',
      totalCostBasis: '15000.00',
      realizedGrossPnl: '0.00',
      realizedNetPnl: '0.00',
      markTimestamp: '2026-07-15T10:00:00.000Z',
      markPrice: '160.00',
      markAgeMinutes: 120,
    };

    const result = mapPositionRow(input);

    expect(result.symbol).toBe('AAPL');
    expect(result.markStatus).toBe('fresh');
    expect(result.markedValue).toBe('16000.00');
    expect(result.unrealizedPnl).toBe('1000.00');
  });

  // ── Very small fractional quantities ─────────────────────────────────

  it('maps a position with fractional quantity', () => {
    const input: PositionRowInput = {
      symbol: 'SPY',
      direction: 'long',
      quantity: '0.55',
      averageCost: '450.00',
      totalCostBasis: '247.50',
      realizedGrossPnl: '0.00',
      realizedNetPnl: '0.00',
      markTimestamp: '2026-07-15T10:00:00.000Z',
      markPrice: '455.00',
      markAgeMinutes: 60,
    };

    const result = mapPositionRow(input);

    expect(result.quantity).toBe('0.55');
    expect(result.markStatus).toBe('fresh');
    // markedValue = 0.55 * 455.00 = 250.25
    expect(result.markedValue).toBe('250.25');
    // unrealizedPnl = (455 - 450) * 0.55 = 2.75
    expect(result.unrealizedPnl).toBe('2.75');
  });

  it('uses quote micros for account-position values while retaining the display price', () => {
    const result = mapPositionRow({
      symbol: 'CLBK',
      direction: 'long',
      quantity: '10.00',
      averageCost: '11.30',
      totalCostBasis: '113.00',
      realizedGrossPnl: '0.00',
      realizedNetPnl: '0.00',
      markTimestamp: '2026-07-15T10:00:00.000Z',
      markPrice: '11.62',
      markPriceMicros: 11_615_000,
      markAgeMinutes: 30,
    });

    expect(result.markPrice).toBe('11.62');
    expect(result.markedValue).toBe('116.15');
    expect(result.unrealizedPnl).toBe('3.15');
  });
});

describe('mapPositionRows', () => {
  // ── Multiple positions ──────────────────────────────────────────────

  it('maps multiple positions in input order', () => {
    const inputs: PositionRowInput[] = [
      {
        symbol: 'AAPL', direction: 'long', quantity: '100.00',
        averageCost: '150.00', totalCostBasis: '15000.00',
        realizedGrossPnl: '500.00', realizedNetPnl: '485.00',
        markTimestamp: '2026-07-15T12:00:00.000Z',
        markPrice: '165.00', markAgeMinutes: 30,
      },
      {
        symbol: 'TSLA', direction: 'short', quantity: '50.00',
        averageCost: '200.00', totalCostBasis: '10000.00',
        realizedGrossPnl: '-250.00', realizedNetPnl: '-260.00',
        markTimestamp: null, markPrice: null, markAgeMinutes: null,
      },
    ];

    const results = mapPositionRows(inputs);

    expect(results).toHaveLength(2);
    expect(results[0].symbol).toBe('AAPL');
    expect(results[1].symbol).toBe('TSLA');
  });

  // ── Empty positions ─────────────────────────────────────────────────

  it('returns empty array for no positions', () => {
    const results = mapPositionRows([]);
    expect(results).toEqual([]);
  });

  // ── Mixed missing and fresh marks ───────────────────────────────────

  it('maps positions with mixed mark statuses', () => {
    const inputs: PositionRowInput[] = [
      {
        symbol: 'AAPL', direction: 'long', quantity: '100.00',
        averageCost: '150.00', totalCostBasis: '15000.00',
        realizedGrossPnl: '0.00', realizedNetPnl: '0.00',
        markTimestamp: '2026-07-15T12:00:00.000Z',
        markPrice: '165.00', markAgeMinutes: 30,
      },
      {
        symbol: 'MSFT', direction: 'long', quantity: '50.00',
        averageCost: '300.00', totalCostBasis: '15000.00',
        realizedGrossPnl: '0.00', realizedNetPnl: '0.00',
        markTimestamp: null, markPrice: null, markAgeMinutes: null,
      },
      {
        symbol: 'GOOG', direction: 'long', quantity: '10.00',
        averageCost: '1500.00', totalCostBasis: '15000.00',
        realizedGrossPnl: '0.00', realizedNetPnl: '0.00',
        markTimestamp: '2026-07-10T12:00:00.000Z',
        markPrice: '1450.00', markAgeMinutes: 4320,
      },
    ];

    const results = mapPositionRows(inputs);

    expect(results[0].markStatus).toBe('fresh');
    expect(results[1].markStatus).toBe('missing');
    expect(results[2].markStatus).toBe('stale');
  });
});
