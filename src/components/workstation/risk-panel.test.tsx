/**
 * Tests for the workstation RiskPanel risk band (S04 T02) — the canonical
 * R032 regression guard (S08 T01).
 *
 * R032 defines four distinct risk concepts that must be rendered as
 * distinct, named UI elements:
 *   - 'Initial risk'        — aggregate of initialRiskAmount from open
 *                             journal trade risk snapshots (riskSummary.openRisk)
 *   - 'Current risk to stop'— per-position risk to the active stop
 *                             (position.risk.currentRiskToStop)
 *   - 'Open risk'           — aggregate of per-position current risk to
 *                             stop (riskSummary.openRiskToStop)
 *   - 'Portfolio heat'      — open risk / NAV percentage
 *
 * The panel is a context-consuming component that reads fixtures.dashboardV2
 * from useWorkstation(). These tests mock the context module and pin:
 *   - all four R032 labels rendered as distinct named elements (the band
 *     renders Initial risk / Open risk / Portfolio heat; the positions
 *     table renders the per-position 'Current risk to stop' header)
 *   - Initial risk and Open risk render different, correctly-sourced
 *     aggregates (openRisk vs openRiskToStop — the M016 PARTIAL gap)
 *   - partial stop coverage qualifies Open risk + Portfolio heat but not
 *     Initial risk (distinct meaning: Initial risk is snapshot-derived and
 *     historical, not stop-coverage-derived)
 *   - null openRiskToStop under complete coverage renders 'Incomplete'
 *     (never a bare total)
 *   - null openRisk renders the API's qualified provenance label
 *   - all eight band cells carry stable data-testids
 *
 * Run: npx vitest run src/components/workstation/risk-panel.test.tsx
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import React from 'react';

import type {
  DashboardPositionSummary,
  DashboardV2Response,
  RiskSummary,
} from '@/lib/accounting/dashboard-v2';
import { RiskPanel } from './risk-panel';
import { RiskPositionsTable } from './risk-positions-table';

// ── Mock workstation context ────────────────────────────────────────────

type MockContextValue = {
  fixtures: { dashboardV2: DashboardV2Response };
};

let mockCtx: MockContextValue;

vi.mock('./workstation-context', () => ({
  useWorkstation: () => mockCtx,
}));

// ── Fixture factories ───────────────────────────────────────────────────

const COMPUTED_AT = '2026-07-17T20:15:00.000Z';
const AS_OF = '2026-07-17T19:58:00.000Z';

/**
 * Minimal fully-fresh position factory. Sum of currentRiskToStop across the
 * default three positions is 474.00 + 257.60 + 0 = 731.60, which is the
 * openRiskToStop the panel fixture exposes — the aggregates stay coherent.
 */
function position(
  overrides: Partial<DashboardPositionSummary> = {},
): DashboardPositionSummary {
  return {
    instrumentId: 'inst-xxxx',
    symbol: 'XXXX',
    direction: 'long',
    quantity: '100',
    averageCost: '100.00',
    markStatus: 'fresh',
    markPrice: '110.00',
    markedValue: '11000.00',
    unrealizedPnl: '1000.00',
    markTimestamp: AS_OF,
    markAgeMinutes: 5,
    attribution: { kind: 'journal', executionCount: 10, journalTradeCount: 1 },
    markProvenance: { source: 'market_data', asOf: AS_OF, computedAt: COMPUTED_AT, status: 'fresh' },
    risk: { hasValidStop: true, stopPrice: 95, currentRiskToStop: '1500.00', openTrades: 1 },
    journalLinkedMetrics: null,
    ...overrides,
  };
}

const DEFAULT_POSITIONS: DashboardPositionSummary[] = [
  position({
    instrumentId: 'inst-nvda',
    symbol: 'NVDA',
    quantity: '120',
    averageCost: '128.40',
    markPrice: '131.85',
    markedValue: '15822.00',
    unrealizedPnl: '414.00',
    risk: { hasValidStop: true, stopPrice: 127.9, currentRiskToStop: '474.00', openTrades: 1 },
  }),
  position({
    instrumentId: 'inst-amd',
    symbol: 'AMD',
    quantity: '80',
    averageCost: '112.10',
    markPrice: '118.42',
    markedValue: '9473.60',
    unrealizedPnl: '505.60',
    risk: { hasValidStop: true, stopPrice: 115.2, currentRiskToStop: '257.60', openTrades: 1 },
  }),
];

/** RiskSummary factory mirroring the v2 API contract, incl. stop coverage. */
function riskSummary(opts: {
  openRisk?: string | null;
  openRiskToStop?: string | null;
  portfolioHeat?: string | null;
  coverage?: 'complete' | 'partial';
} = {}): RiskSummary {
  const {
    openRisk = '1450.00',
    openRiskToStop = '731.60',
    portfolioHeat = '2.80',
    coverage = 'complete',
  } = opts;
  const missingStops = coverage === 'partial' ? 1 : 0;
  const openTrades = 3;
  return {
    openPnl: '841.35',
    openRisk,
    portfolioHeat,
    missingStops,
    positionsWithStop: openTrades - missingStops,
    openRiskToStop,
    stopCoverage: {
      openTrades,
      withStop: openTrades - missingStops,
      withoutStop: missingStops,
      state: coverage,
      presentationLabel:
        missingStops > 0 ? `Incomplete — ${missingStops} without a valid stop` : null,
    },
    provenance: {
      source: 'account_positions + trades + trade_risk_snapshots',
      asOf: AS_OF,
      computedAt: COMPUTED_AT,
      status: 'complete',
      presentationLabel: null,
    },
  };
}

/** Full DashboardV2Response with the risk band's consumed sections. */
function baseDashboardV2(opts: {
  risk?: RiskSummary;
  positions?: DashboardPositionSummary[];
  valuationState?: DashboardV2Response['valuation']['state'];
  valuationLabel?: string | null;
} = {}): DashboardV2Response {
  const {
    risk = riskSummary(),
    positions = DEFAULT_POSITIONS,
    valuationState = 'complete',
    valuationLabel = null,
  } = opts;

  return {
    snapshotId: `snap:acc-1:${COMPUTED_AT}`,
    account: { id: 'acc-1', name: 'Primary', currency: 'USD' },
    scopes: {
      accountPositions: {
        id: 'account_positions',
        section: 'valuation',
        description: 'Open positions.',
        source: 'account_positions + valuation_marks',
        asOf: AS_OF,
      },
      journalTrades: {
        id: 'journal_trades',
        section: 'journalAttribution',
        description: 'Journal trade linkage.',
        source: 'accounting_executions + trades',
        asOf: COMPUTED_AT,
      },
      periodPerformance: {
        id: 'period_performance',
        section: 'metrics',
        description: 'Period performance projection.',
        source: 'account_performance',
        asOf: COMPUTED_AT,
      },
    },
    metrics: {
      cash: '24150.75',
      nav: '50000.00',
      markedPositions: '31543.85',
      realizedPnl: '11596.40',
      unrealizedPnl: '841.35',
      totalPnl: '12437.75',
      realizedFees: '512.30',
      grossExposure: '31543.85',
      netExposure: '31543.85',
      drawdown: '2500.00',
      drawdownPct: '1.64',
      modifiedDietzReturn: '0.055',
      twr: '0.053',
      provenance: {
        source: 'account_performance',
        asOf: AS_OF,
        computedAt: COMPUTED_AT,
        status: 'complete',
        presentationLabel: null,
      },
    },
    valuation: {
      positionsTotal: positions.length,
      fresh: positions.length,
      stale: 0,
      missing: 0,
      state: valuationState,
      coveragePct: '1.00',
      presentationLabel: valuationLabel,
      markedSubsetPnl: null,
      positions,
      provenance: {
        source: 'valuation_marks',
        asOf: AS_OF,
        computedAt: COMPUTED_AT,
        status: valuationState === 'complete' ? 'complete' : 'partial',
        presentationLabel: null,
      },
    },
    journalAttribution: {
      hasJournalTrades: true,
      journalExecutionCount: 20,
      accountOnlyExecutionCount: 5,
      provenance: {
        source: 'journal',
        asOf: COMPUTED_AT,
        computedAt: COMPUTED_AT,
        status: 'complete',
        presentationLabel: null,
      },
    },
    journalLinked: {
      tradeCount: 2,
      positionCount: 2,
      remainingQty: '200',
      openAvgCost: '121.90',
      grossRealizedPnl: '1531.25',
      netRealizedPnl: '1501.65',
      netUnrealizedPnl: '919.60',
      openFees: '6.80',
      comparisons: [],
      provenance: {
        source: 'journal',
        asOf: COMPUTED_AT,
        computedAt: COMPUTED_AT,
        status: 'complete',
        presentationLabel: null,
      },
    },
    reconciliation: {
      eligible: true,
      refusalReasons: [],
      comparisons: null,
      totals: null,
      provenance: {
        source: 'reconciliation',
        asOf: COMPUTED_AT,
        computedAt: COMPUTED_AT,
        status: 'complete',
        presentationLabel: null,
      },
    },
    riskSummary: risk,
    integrity: {
      status: 'healthy',
      warnings: [],
    },
    computedAt: COMPUTED_AT,
  };
}

/** Render the band + positions table over one coherent DashboardV2Response. */
function renderRiskSurface(dashboardV2: DashboardV2Response) {
  mockCtx = { fixtures: { dashboardV2 } };
  return render(
    <>
      <RiskPanel />
      <RiskPositionsTable positions={dashboardV2.valuation.positions} />
    </>,
  );
}

function cellValue(testId: string): string | null | undefined {
  return screen.getByTestId(testId).querySelector('.ws-risk-value')?.textContent;
}

// Unmount the previous render between tests so getByTestId never resolves
// against accumulated DOM from earlier cases.
afterEach(cleanup);

// ── R032: four distinct risk labels ─────────────────────────────────────

describe('R032 distinct risk labels', () => {
  it('renders all four R032 labels as distinct named UI elements', () => {
    renderRiskSurface(baseDashboardV2());

    // Band labels: Initial risk / Open risk / Portfolio heat.
    const panel = screen.getByTestId('ws-panel-risk');
    expect(within(panel).getByText('Initial risk')).toBeTruthy();
    expect(within(panel).getByText('Open risk')).toBeTruthy();
    expect(within(panel).getByText('Portfolio heat')).toBeTruthy();

    // Per-position label: 'Current risk to stop' column header.
    const headers = Array.from(
      screen.getByTestId('ws-positions-table').querySelectorAll('thead th'),
    ).map((h) => h.textContent);
    expect(headers).toContain('Current risk to stop');
  });

  it('renders Initial risk from openRisk and Open risk from openRiskToStop as distinct aggregates', () => {
    renderRiskSurface(baseDashboardV2());

    // Initial risk = sum of initialRiskAmount (riskSummary.openRisk).
    expect(
      screen.getByTestId('ws-risk-cell-initial-risk').querySelector('.ws-risk-label')
        ?.textContent,
    ).toBe('Initial risk');
    expect(cellValue('ws-risk-cell-initial-risk')).toBe('$1,450.00');

    // Open risk = sum of per-position current risk to stop
    // (riskSummary.openRiskToStop) — a different aggregate.
    expect(
      screen.getByTestId('ws-risk-cell-open-risk').querySelector('.ws-risk-label')
        ?.textContent,
    ).toBe('Open risk');
    expect(cellValue('ws-risk-cell-open-risk')).toBe('$731.60');

    // The two aggregates are never conflated into one number.
    expect(cellValue('ws-risk-cell-initial-risk')).not.toBe(
      cellValue('ws-risk-cell-open-risk'),
    );
  });

  it('renders Portfolio heat as the canonical percentage', () => {
    renderRiskSurface(baseDashboardV2());
    expect(cellValue('ws-risk-cell-heat')).toBe('2.80%');
  });

  it('renders the per-position Current risk to stop cell value from position.risk', () => {
    renderRiskSurface(baseDashboardV2());
    const nvdaRow = screen.getByTestId('ws-position-row-NVDA');
    expect(
      within(nvdaRow).getByTestId('ws-position-cell-risk').textContent,
    ).toContain('$474.00');
  });
});

// ── R032 distinct meanings under partial data ───────────────────────────

describe('R032 gating', () => {
  it('partial stop coverage qualifies Open risk and heat but not Initial risk', () => {
    renderRiskSurface(
      baseDashboardV2({
        risk: riskSummary({ coverage: 'partial', openRiskToStop: '731.60' }),
      }),
    );

    // Open risk + Portfolio heat: qualified label, never a partial total.
    for (const id of ['open-risk', 'heat']) {
      expect(cellValue(`ws-risk-cell-${id}`)).toBe(
        'Incomplete — 1 without a valid stop',
      );
    }

    // Initial risk is snapshot-derived and historical — stop coverage does
    // not gate it (distinct meaning from Open risk).
    expect(cellValue('ws-risk-cell-initial-risk')).toBe('$1,450.00');
  });

  it('null openRiskToStop under complete coverage renders Incomplete, never a total', () => {
    renderRiskSurface(baseDashboardV2({ risk: riskSummary({ openRiskToStop: null }) }));
    expect(cellValue('ws-risk-cell-open-risk')).toBe('Incomplete');
    // Heat follows openRiskToStop availability through the same gate.
    expect(cellValue('ws-risk-cell-heat')).toBe('2.80%');
  });

  it('null openRisk renders the API qualified provenance label for Initial risk', () => {
    const risk = riskSummary({ openRisk: null });
    risk.provenance.presentationLabel = '— Partial — 1 unpriced';
    renderRiskSurface(baseDashboardV2({ risk }));
    expect(cellValue('ws-risk-cell-initial-risk')).toBe('— Partial — 1 unpriced');
  });
});

// ── Band structure ──────────────────────────────────────────────────────

describe('RiskPanel band structure', () => {
  it('renders all eight current-state cells with stable testids', () => {
    renderRiskSurface(baseDashboardV2());
    for (const id of [
      'positions',
      'open-pnl',
      'initial-risk',
      'open-risk',
      'heat',
      'coverage',
      'gross',
      'net',
    ]) {
      expect(screen.getByTestId(`ws-risk-cell-${id}`)).toBeTruthy();
    }
  });

  it('keeps the existing qualified Open P&L and coverage behavior intact', () => {
    renderRiskSurface(baseDashboardV2());
    expect(cellValue('ws-risk-cell-open-pnl')).toBe('$841.35');
    // Complete coverage: 3 open journal trades, 3 with a valid stop.
    expect(cellValue('ws-risk-cell-coverage')).toBe('3/3');
  });

  it('partial coverage still qualifies the coverage cell', () => {
    renderRiskSurface(
      baseDashboardV2({ risk: riskSummary({ coverage: 'partial' }) }),
    );
    expect(cellValue('ws-risk-cell-coverage')).toBe(
      'Incomplete — 1 without a valid stop',
    );
  });
});
