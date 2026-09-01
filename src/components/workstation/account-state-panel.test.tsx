/**
 * Tests for the workstation AccountStatePanel (S07, dense S02).
 *
 * The panel is a context-driven consumer of fixtures.dashboardV2 (metrics +
 * valuation). Since M017/S02 removed the equity/drawdown chart and the
 * compact drawdown summary row (the chart moves to the future analysis
 * workspace), the panel no longer reads fixtures.dashboard. These tests pin:
 *
 *   - Cash renders with effective time sub-line from provenance.asOf
 *   - Marked positions shows completeness qualifier for partial/unavailable
 *   - NAV shows correct qualification (Full / Partial / Ledger only)
 *   - Drawdown ALWAYS uses ws-neg class (never ws-pos)
 *   - Total P&L renders presentationLabel when valuation.state ≠ 'complete'
 *   - Realized/Open P&L use PnL colouring (ws-pos / ws-neg)
 *   - Panel renders without crashing
 *   - Panel renders no equity chart and no drawdown summary row (dense S02)
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

// ── Mock workstation context ────────────────────────────────────────────

import { AccountStatePanel } from './account-state-panel';

type MockContextValue = {
  fixtures: {
    dashboardV2: DashboardV2Response;
  };
};

let mockCtx: MockContextValue;

vi.mock('./workstation-context', () => ({
  useWorkstation: () => mockCtx,
}));

// ── Fixture factories ───────────────────────────────────────────────────

const COMPUTED_AT = '2026-07-17T20:15:00.000Z';
const AS_OF = '2026-07-17T19:58:00.000Z';

function baseDashboardV2(
  overrides: {
    metrics?: Partial<DashboardV2Response['metrics']>;
    riskSummary?: Partial<RiskSummary>;
    valuationState?: DashboardV2Response['valuation']['state'];
    presentationLabel?: string | null;
  } = {},
): DashboardV2Response {
  const {
    metrics: metricOverrides = {},
    riskSummary: riskSummaryOverrides = {},
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
    riskSummary: {
      ...riskSummary,
      ...riskSummaryOverrides,
    },
    integrity: {
      status: 'healthy',
      warnings: [],
    },
    computedAt: COMPUTED_AT,
  };
}

// ── Render helper ───────────────────────────────────────────────────────

function renderPanel(dashboardV2: DashboardV2Response = baseDashboardV2()) {
  mockCtx = { fixtures: { dashboardV2 } };
  return render(<AccountStatePanel />);
}

afterEach(cleanup);

// ── Tests ───────────────────────────────────────────────────────────────

describe('AccountStatePanel', () => {
  it('renders without crashing', () => {
    renderPanel();
    expect(screen.getByTestId('ws-panel-account-state')).toBeTruthy();
  });

  it('renders the metrics grid with all nine cells', () => {
    renderPanel();
    const grid = screen.getByTestId('ws-account-state-metrics');
    expect(grid).toBeTruthy();
    expect(screen.getByTestId('ws-account-state-cash')).toBeTruthy();
    expect(screen.getByTestId('ws-account-state-marked')).toBeTruthy();
    expect(screen.getByTestId('ws-account-state-nav')).toBeTruthy();
    expect(screen.getByTestId('ws-account-state-realized')).toBeTruthy();
    expect(screen.getByTestId('ws-account-state-open-pnl')).toBeTruthy();
    expect(screen.getByTestId('ws-account-state-total')).toBeTruthy();
    expect(screen.getByTestId('ws-account-state-twr')).toBeTruthy();
    expect(screen.getByTestId('ws-account-state-modified-dietz')).toBeTruthy();
    expect(screen.getByTestId('ws-account-state-drawdown')).toBeTruthy();
  });

  it('groups context with its label and exposes one right-aligned value per row', () => {
    renderPanel();

    const cells = [
      'ws-account-state-cash',
      'ws-account-state-marked',
      'ws-account-state-nav',
      'ws-account-state-realized',
      'ws-account-state-open-pnl',
      'ws-account-state-total',
      'ws-account-state-twr',
      'ws-account-state-modified-dietz',
      'ws-account-state-drawdown',
    ].map((testId) => screen.getByTestId(testId));

    for (const cell of cells) {
      expect(cell.classList.contains('ws-account-stat-row')).toBe(true);
      expect(cell.querySelector('.ws-account-stat-label')).toBeTruthy();
      expect(cell.querySelector('.ws-account-stat-value.ws-num')).toBeTruthy();
    }
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

  // ── Canonical return metrics (M004 hands-on fix) ─────────────────────

  describe('Time-Weighted Return & Modified Dietz Return', () => {
    it('formats positive canonical values as two-decimal percentages', () => {
      renderPanel(
        baseDashboardV2({ metrics: { twr: '2.3456', modifiedDietzReturn: '1.2345' } }),
      );
      const twr = screen.getByTestId('ws-account-state-twr');
      expect(twr.textContent).toContain('2.35%');
      const dietz = screen.getByTestId('ws-account-state-modified-dietz');
      expect(dietz.textContent).toContain('1.23%');
    });

    it('formats negative canonical values with the negative semantic class', () => {
      renderPanel(
        baseDashboardV2({ metrics: { twr: '-1.235', modifiedDietzReturn: '-0.55' } }),
      );
      const twrValue = screen.getByTestId('ws-account-state-twr').querySelector('.ws-num');
      expect(twrValue!.textContent).toBe('-1.24%');
      expect(twrValue!.className).toContain('ws-neg');
      const dietzValue = screen.getByTestId('ws-account-state-modified-dietz').querySelector('.ws-num');
      expect(dietzValue!.textContent).toBe('-0.55%');
      expect(dietzValue!.className).toContain('ws-neg');
    });

    it('formats zero as 0.00% with neutral presentation', () => {
      renderPanel(
        baseDashboardV2({ metrics: { twr: '0', modifiedDietzReturn: '0' } }),
      );
      for (const testId of ['ws-account-state-twr', 'ws-account-state-modified-dietz']) {
        const value = screen.getByTestId(testId).querySelector('.ws-num');
        expect(value!.textContent).toBe('0.00%');
        expect(value!.className).not.toContain('ws-pos');
        expect(value!.className).not.toContain('ws-neg');
      }
    });

    it('renders a dash when the canonical value is unavailable — no synthetic fallback', () => {
      renderPanel(
        baseDashboardV2({ metrics: { twr: null, modifiedDietzReturn: null } }),
      );
      expect(screen.getByTestId('ws-account-state-twr').textContent).toContain('—');
      expect(screen.getByTestId('ws-account-state-modified-dietz').textContent).toContain('—');
    });

    it('exposes the exact user-facing labels and never "TWR"', () => {
      renderPanel();
      expect(screen.getByTestId('ws-account-state-twr').textContent).toContain('Time-Weighted Return');
      expect(screen.getByTestId('ws-account-state-modified-dietz').textContent).toContain('Modified Dietz Return');
      expect(screen.queryByText('TWR')).toBeNull();
    });

    it('labels both rows with the Account performance scope sub-line', () => {
      renderPanel();
      expect(screen.getByTestId('ws-account-state-twr').textContent).toContain('Account performance');
      expect(screen.getByTestId('ws-account-state-modified-dietz').textContent).toContain('Account performance');
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
    it('declares the account-performance scope when valuation is complete', () => {
      renderPanel(baseDashboardV2({ valuationState: 'complete' }));
      const cell = screen.getByTestId('ws-account-state-total');
      expect(cell.textContent).toContain('$8,300.00');
      // Presentation wording is faithful to the V2 account_performance
      // source and never implies the sidebar's user-selected Period scopes
      // this cell (M004 9D.2 §16).
      expect(cell.textContent).toContain('Account performance');
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
      expect(cell.textContent).not.toContain('Account performance');
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

  // ── Open P&L ──────────────────────────────────────────────────────────

  describe('Open P&L', () => {
    it('uses the current risk-summary Open P&L instead of the persisted period projection', () => {
      renderPanel(
        baseDashboardV2({
          metrics: { unrealizedPnl: '19.20' },
          riskSummary: { openPnl: '45.38' },
        }),
      );

      const cell = screen.getByTestId('ws-account-state-open-pnl');
      expect(cell.textContent).toContain('$45.38');
      expect(cell.textContent).not.toContain('$19.20');
      expect(cell.textContent).toContain('Open P&L');
    });

    it('uses ws-pos class for positive Open P&L', () => {
      renderPanel(baseDashboardV2({ riskSummary: { openPnl: '3100.00' } }));
      const cell = screen.getByTestId('ws-account-state-open-pnl');
      const valueSpan = cell.querySelector('.ws-num');
      expect(valueSpan!.className).toContain('ws-pos');
    });

    it('uses ws-neg class for negative Open P&L', () => {
      renderPanel(baseDashboardV2({ riskSummary: { openPnl: '-800.00' } }));
      const cell = screen.getByTestId('ws-account-state-open-pnl');
      const valueSpan = cell.querySelector('.ws-num');
      expect(valueSpan!.className).toContain('ws-neg');
    });

    it('shows "Open positions" sub-line when valuation is complete', () => {
      renderPanel(baseDashboardV2({ valuationState: 'complete' }));
      const cell = screen.getByTestId('ws-account-state-open-pnl');
      expect(cell.textContent).toContain('Open positions');
    });

    it('shows presentationLabel when valuation is not complete', () => {
      renderPanel(
        baseDashboardV2({
          valuationState: 'partial',
          presentationLabel: '— Partial — 1 unpriced',
        }),
      );
      const cell = screen.getByTestId('ws-account-state-open-pnl');
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
      expect(screen.getByTestId('ws-account-state-open-pnl').textContent).toContain('Stale Open P&L');
      expect(screen.getByTestId('ws-account-state-total').textContent).toContain('Stale Total P&L');
    });
  });

  // ── Dense S02: chart and drawdown summary removed ──────────────────────

  describe('dense summary contract (S02)', () => {
    it('renders no equity chart inside the panel', () => {
      renderPanel();
      expect(screen.queryByTestId('ws-equity-chart')).toBeNull();
      expect(screen.queryByTestId('ws-equity-chart-empty')).toBeNull();
    });

    it('renders no compact drawdown summary row', () => {
      renderPanel();
      expect(screen.queryByTestId('ws-account-state-dd-summary')).toBeNull();
      expect(screen.queryByText('Current drawdown')).toBeNull();
    });

    it('still renders the full metrics grid (all nine stat cells)', () => {
      renderPanel();
      expect(screen.getByTestId('ws-account-state-metrics')).toBeTruthy();
      expect(screen.getByTestId('ws-account-state-cash')).toBeTruthy();
      expect(screen.getByTestId('ws-account-state-marked')).toBeTruthy();
      expect(screen.getByTestId('ws-account-state-nav')).toBeTruthy();
      expect(screen.getByTestId('ws-account-state-realized')).toBeTruthy();
      expect(screen.getByTestId('ws-account-state-open-pnl')).toBeTruthy();
      expect(screen.getByTestId('ws-account-state-total')).toBeTruthy();
      expect(screen.getByTestId('ws-account-state-twr')).toBeTruthy();
      expect(screen.getByTestId('ws-account-state-modified-dietz')).toBeTruthy();
      expect(screen.getByTestId('ws-account-state-drawdown')).toBeTruthy();
    });
  });
});
