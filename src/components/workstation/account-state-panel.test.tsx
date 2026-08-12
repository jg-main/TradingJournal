/**
 * Tests for the workstation AccountStatePanel (S07).
 *
 * The panel is a context-driven consumer of fixtures.dashboardV2 (metrics +
 * valuation) and fixtures.dashboard (equityCurve, drawdown, kpis). These
 * tests pin:
 *
 *   - Cash renders with effective time sub-line from provenance.asOf
 *   - Marked positions shows completeness qualifier for partial/unavailable
 *   - NAV shows correct qualification (Full / Partial / Ledger only)
 *   - Drawdown ALWAYS uses ws-neg class (never ws-pos)
 *   - Total P&L renders presentationLabel when valuation.state ≠ 'complete'
 *   - Realized/Unrealized P&L use PnL colouring (ws-pos / ws-neg)
 *   - Panel renders without crashing
 *
 * Run: npx vitest run src/components/workstation/account-state-panel.test.tsx
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';

import type {
  DashboardV2Response,
  JournalAttribution,
  JournalLinkedAggregate,
  DashboardReconciliationSummary,
  RiskSummary,
} from '@/lib/accounting/dashboard-v2';
import type { DashboardResponse } from '@/lib/workstation-fixtures';
import type { KpiMetrics, MtmData } from '@/components/dashboard/kpi-widgets';

// ── Mock workstation context ────────────────────────────────────────────

import { AccountStatePanel } from './account-state-panel';

type MockContextValue = {
  fixtures: {
    dashboardV2: DashboardV2Response;
    dashboard: DashboardResponse;
  };
};

let mockCtx: MockContextValue;

vi.mock('./workstation-context', () => ({
  useWorkstation: () => mockCtx,
}));

// Mock EquityChart — echarts-for-react doesn't render in jsdom.
vi.mock('./equity-chart', () => ({
  EquityChart: ({ equityCurve }: { equityCurve: unknown[] }) => (
    <div data-testid="ws-equity-chart-mock">
      {equityCurve.length > 0 ? 'chart' : 'empty'}
    </div>
  ),
}));

// ── Fixture factories ───────────────────────────────────────────────────

const COMPUTED_AT = '2026-07-17T20:15:00.000Z';
const AS_OF = '2026-07-17T19:58:00.000Z';

function baseDashboardV2(
  overrides: {
    metrics?: Partial<DashboardV2Response['metrics']>;
    valuationState?: DashboardV2Response['valuation']['state'];
    presentationLabel?: string | null;
  } = {},
): DashboardV2Response {
  const {
    metrics: metricOverrides = {},
    valuationState = 'complete',
    presentationLabel = null,
  } = overrides;

  const journalAttribution: JournalAttribution = {
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
  };

  const journalLinked: JournalLinkedAggregate = {
    tradeCount: 10,
    positionCount: 3,
    remainingQty: '500',
    openAvgCost: '150.00',
    grossRealizedPnl: '5200.00',
    netRealizedPnl: '5080.00',
    netUnrealizedPnl: '3100.00',
    openFees: '40.00',
    comparisons: [],
    provenance: {
      source: 'journal',
      asOf: COMPUTED_AT,
      computedAt: COMPUTED_AT,
      status: 'complete',
      presentationLabel: null,
    },
  };

  const reconciliation: DashboardReconciliationSummary = {
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
  };

  const riskSummary: RiskSummary = {
    openPnl: '3100.00',
    openRisk: '5000.00',
    portfolioHeat: '3.33',
    missingStops: 0,
    positionsWithStop: 3,
    openRiskToStop: '5000.00',
    stopCoverage: {
      openTrades: 3,
      withStop: 3,
      withoutStop: 0,
      state: 'complete',
      presentationLabel: null,
    },
    provenance: {
      source: 'risk',
      asOf: AS_OF,
      computedAt: COMPUTED_AT,
      status: 'complete',
      presentationLabel: null,
    },
  };

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
      cash: '50000.00',
      nav: '150000.00',
      markedPositions: '75000.00',
      realizedPnl: '5200.00',
      unrealizedPnl: '3100.00',
      totalPnl: '8300.00',
      realizedFees: '120.00',
      grossExposure: '75000.00',
      netExposure: '50000.00',
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
      ...metricOverrides,
    },
    valuation: {
      positionsTotal: 3,
      fresh: 3,
      stale: 0,
      missing: 0,
      state: valuationState,
      coveragePct: '1.00',
      presentationLabel,
      markedSubsetPnl: null,
      positions: [],
      provenance: {
        source: 'valuation_marks',
        asOf: AS_OF,
        computedAt: COMPUTED_AT,
        status: valuationState === 'complete' ? 'complete' : 'partial',
        presentationLabel: null,
      },
    },
    journalAttribution,
    journalLinked,
    reconciliation,
    riskSummary,
    integrity: {
      status: 'healthy',
      warnings: [],
    },
    computedAt: COMPUTED_AT,
  };
}

function baseKpis(): KpiMetrics {
  return {
    totalTrades: 45,
    openTrades: 3,
    winRate: 0.62,
    netPnl: 8300,
    avgR: 0.5,
    avgGrade: null,
    currentDrawdown: -2500,
    currentDrawdownPct: -0.0164,
    accountValue: 150000,
    profitFactor: 1.8,
    avgWin: 450,
    avgLoss: -250,
  };
}

function baseMtm(): MtmData {
  return {
    netUnrealizedPnl: 3100,
    openTradeCount: 3,
    tradesWithPrices: 3,
    tradesAwaitingData: 0,
  };
}

function baseDashboard(): DashboardResponse {
  return {
    kpis: baseKpis(),
    mtm: baseMtm(),
    equityCurve: [
      { date: '2026-07-01', equity: 140000, cumulativePnl: -1000, highWaterMark: 141000 },
      { date: '2026-07-10', equity: 145000, cumulativePnl: 4000, highWaterMark: 145000 },
      { date: '2026-07-17', equity: 150000, cumulativePnl: 8300, highWaterMark: 150000 },
    ],
    drawdown: [
      { date: '2026-07-01', drawdownAmount: -1000, drawdownPct: -0.007 },
      { date: '2026-07-05', drawdownAmount: -500, drawdownPct: -0.003 },
      { date: '2026-07-17', drawdownAmount: 0, drawdownPct: 0 },
    ],
    monthlyPerformance: [
      { month: '2026-07', netPnl: 8300, winRate: 0.62, tradeCount: 45 },
    ],
    rDistribution: [],
    calendarHeatmap: [],
    periodMatrix: {},
    setupRanking: [],
    attentionInsights: { insights: [], tradeCount: 0 },
  };
}

// ── Render helper ───────────────────────────────────────────────────────

function renderPanel(
  dashboardV2: DashboardV2Response = baseDashboardV2(),
  dashboard: DashboardResponse = baseDashboard(),
) {
  mockCtx = { fixtures: { dashboardV2, dashboard } };
  return render(<AccountStatePanel />);
}

afterEach(cleanup);

// ── Tests ───────────────────────────────────────────────────────────────

describe('AccountStatePanel', () => {
  it('renders without crashing', () => {
    renderPanel();
    expect(screen.getByTestId('ws-panel-account-state')).toBeTruthy();
  });

  it('renders the metrics grid with all seven cells', () => {
    renderPanel();
    const grid = screen.getByTestId('ws-account-state-metrics');
    expect(grid).toBeTruthy();
    expect(screen.getByTestId('ws-account-state-cash')).toBeTruthy();
    expect(screen.getByTestId('ws-account-state-marked')).toBeTruthy();
    expect(screen.getByTestId('ws-account-state-nav')).toBeTruthy();
    expect(screen.getByTestId('ws-account-state-realized')).toBeTruthy();
    expect(screen.getByTestId('ws-account-state-unrealized')).toBeTruthy();
    expect(screen.getByTestId('ws-account-state-total')).toBeTruthy();
    expect(screen.getByTestId('ws-account-state-drawdown')).toBeTruthy();
  });

  // ── Cash ──────────────────────────────────────────────────────────────

  describe('Cash', () => {
    it('renders cash value with effective time sub-line from provenance.asOf', () => {
      renderPanel();
      const cell = screen.getByTestId('ws-account-state-cash');
      expect(cell.textContent).toContain('$50,000.00');
      // Sub-line should contain a formatted date from AS_OF
      expect(cell.textContent).toContain('Jul');
      expect(cell.textContent).toContain('17');
    });

    it('renders dash when cash is null', () => {
      renderPanel(baseDashboardV2({ metrics: { cash: null } }));
      const cell = screen.getByTestId('ws-account-state-cash');
      expect(cell.textContent).toContain('—');
    });
  });

  // ── Marked positions ──────────────────────────────────────────────────

  describe('Marked positions', () => {
    it('shows no qualifier when valuation state is complete', () => {
      renderPanel(baseDashboardV2({ valuationState: 'complete' }));
      const cell = screen.getByTestId('ws-account-state-marked');
      expect(cell.textContent).toContain('$75,000.00');
      expect(cell.textContent).not.toContain('Partial valuation');
      expect(cell.textContent).not.toContain('Unavailable');
    });

    it('shows "Partial valuation" qualifier when state is partial', () => {
      renderPanel(baseDashboardV2({ valuationState: 'partial' }));
      const cell = screen.getByTestId('ws-account-state-marked');
      expect(cell.textContent).toContain('Partial valuation');
    });

    it('shows "Unavailable" qualifier when state is unavailable', () => {
      renderPanel(baseDashboardV2({ valuationState: 'unavailable' }));
      const cell = screen.getByTestId('ws-account-state-marked');
      expect(cell.textContent).toContain('Unavailable');
    });
  });

  // ── NAV ───────────────────────────────────────────────────────────────

  describe('NAV', () => {
    it('shows "Full" qualification when valuation state is complete', () => {
      renderPanel(baseDashboardV2({ valuationState: 'complete' }));
      const cell = screen.getByTestId('ws-account-state-nav');
      expect(cell.textContent).toContain('$150,000.00');
      expect(cell.textContent).toContain('Full');
    });

    it('shows "Partial" qualification when valuation state is partial', () => {
      renderPanel(baseDashboardV2({ valuationState: 'partial' }));
      const cell = screen.getByTestId('ws-account-state-nav');
      expect(cell.textContent).toContain('Partial');
    });

    it('shows "Ledger only" qualification when valuation state is unavailable', () => {
      renderPanel(baseDashboardV2({ valuationState: 'unavailable' }));
      const cell = screen.getByTestId('ws-account-state-nav');
      expect(cell.textContent).toContain('Ledger only');
    });
  });

  // ── Drawdown ──────────────────────────────────────────────────────────

  describe('Drawdown', () => {
    it('ALWAYS uses ws-neg class, never ws-pos', () => {
      renderPanel(
        baseDashboardV2({
          metrics: { drawdown: '2500.00', drawdownPct: '1.64' },
        }),
      );
      const cell = screen.getByTestId('ws-account-state-drawdown');
      const valueSpan = cell.querySelector('.ws-num');
      expect(valueSpan).toBeTruthy();
      expect(valueSpan!.className).toContain('ws-neg');
      expect(valueSpan!.className).not.toContain('ws-pos');
    });

    it('renders drawdown amount and percentage', () => {
      renderPanel();
      const cell = screen.getByTestId('ws-account-state-drawdown');
      expect(cell.textContent).toContain('$2,500.00');
      expect(cell.textContent).toContain('1.64%');
      expect(cell.textContent).toContain('from peak');
    });

    it('renders dash when drawdown is null', () => {
      renderPanel(
        baseDashboardV2({ metrics: { drawdown: null, drawdownPct: null } }),
      );
      const cell = screen.getByTestId('ws-account-state-drawdown');
      expect(cell.textContent).toContain('—');
    });
  });

  // ── Total P&L ─────────────────────────────────────────────────────────

  describe('Total P&L', () => {
    it('renders "Realized + Unrealized" sub-line when valuation is complete', () => {
      renderPanel(baseDashboardV2({ valuationState: 'complete' }));
      const cell = screen.getByTestId('ws-account-state-total');
      expect(cell.textContent).toContain('$8,300.00');
      expect(cell.textContent).toContain('Realized + Unrealized');
    });

    it('renders presentationLabel when valuation state is partial', () => {
      renderPanel(
        baseDashboardV2({
          valuationState: 'partial',
          presentationLabel: '— Partial — 1 unpriced',
        }),
      );
      const cell = screen.getByTestId('ws-account-state-total');
      expect(cell.textContent).toContain('— Partial — 1 unpriced');
      expect(cell.textContent).not.toContain('$8,300.00');
      expect(cell.textContent).not.toContain('Realized + Unrealized');
    });

    it('renders presentationLabel when valuation state is unavailable', () => {
      renderPanel(
        baseDashboardV2({
          valuationState: 'unavailable',
          presentationLabel: '— Unavailable — 3 unpriced',
        }),
      );
      const cell = screen.getByTestId('ws-account-state-total');
      expect(cell.textContent).toContain('— Unavailable — 3 unpriced');
    });
  });

  // ── Realized P&L ──────────────────────────────────────────────────────

  describe('Realized P&L', () => {
    it('uses ws-pos class for positive realized P&L', () => {
      renderPanel(baseDashboardV2({ metrics: { realizedPnl: '5200.00' } }));
      const cell = screen.getByTestId('ws-account-state-realized');
      const valueSpan = cell.querySelector('.ws-num');
      expect(valueSpan!.className).toContain('ws-pos');
    });

    it('uses ws-neg class for negative realized P&L', () => {
      renderPanel(baseDashboardV2({ metrics: { realizedPnl: '-1200.00' } }));
      const cell = screen.getByTestId('ws-account-state-realized');
      const valueSpan = cell.querySelector('.ws-num');
      expect(valueSpan!.className).toContain('ws-neg');
    });

    it('renders "Closed positions" sub-line', () => {
      renderPanel();
      const cell = screen.getByTestId('ws-account-state-realized');
      expect(cell.textContent).toContain('Closed positions');
    });
  });

  // ── Unrealized P&L ────────────────────────────────────────────────────

  describe('Unrealized P&L', () => {
    it('uses ws-pos class for positive unrealized P&L', () => {
      renderPanel(baseDashboardV2({ metrics: { unrealizedPnl: '3100.00' } }));
      const cell = screen.getByTestId('ws-account-state-unrealized');
      const valueSpan = cell.querySelector('.ws-num');
      expect(valueSpan!.className).toContain('ws-pos');
    });

    it('uses ws-neg class for negative unrealized P&L', () => {
      renderPanel(baseDashboardV2({ metrics: { unrealizedPnl: '-800.00' } }));
      const cell = screen.getByTestId('ws-account-state-unrealized');
      const valueSpan = cell.querySelector('.ws-num');
      expect(valueSpan!.className).toContain('ws-neg');
    });

    it('shows "Open positions" sub-line when valuation is complete', () => {
      renderPanel(baseDashboardV2({ valuationState: 'complete' }));
      const cell = screen.getByTestId('ws-account-state-unrealized');
      expect(cell.textContent).toContain('Open positions');
    });

    it('shows presentationLabel when valuation is not complete', () => {
      renderPanel(
        baseDashboardV2({
          valuationState: 'partial',
          presentationLabel: '— Partial — 1 unpriced',
        }),
      );
      const cell = screen.getByTestId('ws-account-state-unrealized');
      expect(cell.textContent).toContain('— Partial — 1 unpriced');
      expect(cell.textContent).not.toContain('$3,100.00');
    });
  });

  describe('price-derived aggregate honesty', () => {
    it('does not render normal marked-position or NAV totals for partial valuation', () => {
      renderPanel(
        baseDashboardV2({
          valuationState: 'partial',
          presentationLabel: '— Partial — 1 unpriced',
        }),
      );
      expect(screen.getByTestId('ws-account-state-marked').textContent).not.toContain('$75,000.00');
      expect(screen.getByTestId('ws-account-state-nav').textContent).not.toContain('$150,000.00');
    });

    it('labels all stale price-derived amounts as stale rather than current', () => {
      renderPanel(baseDashboardV2({ valuationState: 'stale' }));
      expect(screen.getByTestId('ws-account-state-marked').textContent).toContain('Stale marked positions');
      expect(screen.getByTestId('ws-account-state-nav').textContent).toContain('Stale NAV');
      expect(screen.getByTestId('ws-account-state-unrealized').textContent).toContain('Stale Unrealized P&L');
      expect(screen.getByTestId('ws-account-state-total').textContent).toContain('Stale Total P&L');
    });
  });

  // ── Equity chart integration ──────────────────────────────────────────

  describe('Equity chart', () => {
    it('renders the equity chart component', () => {
      renderPanel();
      expect(screen.getByTestId('ws-equity-chart-mock')).toBeTruthy();
    });
  });

  // ── Drawdown summary ──────────────────────────────────────────────────

  describe('Drawdown summary', () => {
    it('renders current drawdown from kpis with ws-neg class', () => {
      renderPanel();
      const summary = screen.getByTestId('ws-account-state-dd-summary');
      expect(summary.textContent).toContain('Current drawdown');
      const negSpan = summary.querySelector('.ws-neg');
      expect(negSpan).toBeTruthy();
    });
  });
});
