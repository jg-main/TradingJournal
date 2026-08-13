/**
 * Tests for the workstation PerformancePanel.
 *
 * The panel is a context-consuming component that reads fixtures.dashboard
 * (DashboardResponse) from useWorkstation(). These tests mock the context
 * module to supply controlled fixture data and pin:
 *
 *   - All KPI stat rows render with correct formatted values
 *   - Profit factor threshold colouring (>1.5 ws-pos, ≥1.0 '', <1.0 ws-neg)
 *   - Dense S02 contract: stat rows only — no monthly table, no R
 *     distribution, no setup ranking, and no Tier 3 gated analytics in the
 *     compact summary row (DASHBOARD_DENSE_LAYOUT_REQUIREMENTS)
 *   - Empty data shows compact empty state
 *
 * Run: npx vitest run src/components/workstation/performance-panel.test.tsx
 */

import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';

import type { DashboardResponse } from '@/lib/workstation-fixtures';

// ── Mock workstation context ────────────────────────────────────────────

const mockUseWorkstation = vi.fn();

vi.mock('./workstation-context', () => ({
  useWorkstation: () => mockUseWorkstation(),
}));

import { PerformancePanel } from './performance-panel';

// ── Fixture helpers ─────────────────────────────────────────────────────

function baseKpis() {
  return {
    totalTrades: 42,
    openTrades: 3,
    winRate: 0.619,
    netPnl: 4523.5,
    avgR: 1.23,
    avgGrade: 78.5,
    currentDrawdown: -200,
    currentDrawdownPct: -0.02,
    accountValue: 50000,
    profitFactor: 2.15,
    avgWin: 350.0,
    avgLoss: 163.5,
    closedTrades: 39,
    realizedPnl: 4523.5,
    totalFees: 421.25,
    payoffRatio: 2.14,
    expectancy: 116.0,
    expectancyR: 0.43,
    bestTrade: 1240.0,
    worstTrade: -480.0,
    averageHoldingDays: 3.5,
  };
}

function baseDashboard(
  overrides: Partial<DashboardResponse> = {},
): DashboardResponse {
  return {
    kpis: baseKpis(),
    mtm: { netUnrealizedPnl: 0, openTradeCount: 3, tradesWithPrices: 3, tradesAwaitingData: 0 },
    equityCurve: [],
    drawdown: [],
    monthlyPerformance: [
      { month: '2026-01', netPnl: 1200, winRate: 0.7, tradeCount: 10 },
      { month: '2026-02', netPnl: -300, winRate: 0.4, tradeCount: 8 },
      { month: '2026-03', netPnl: 2100, winRate: 0.75, tradeCount: 12 },
      { month: '2026-04', netPnl: 800, winRate: 0.55, tradeCount: 9 },
      { month: '2026-05', netPnl: 723.5, winRate: 0.5, tradeCount: 3 },
    ],
    rDistribution: [
      { label: '< -2', count: 3 },
      { label: '-2 to -1', count: 5 },
      { label: '-1 to 0', count: 4 },
      { label: '0 to 1', count: 10 },
      { label: '1 to 2', count: 12 },
      { label: '> 2', count: 8 },
    ],
    setupRanking: [
      {
        setupName: 'Breakout',
        setupId: 's1',
        count: 15,
        winRate: 0.67,
        avgR: 1.5,
        avgProcessScore: 82.0,
        sampleSizeWarning: 'adequate',
      },
      {
        setupName: 'Pullback',
        setupId: 's2',
        count: 12,
        winRate: 0.58,
        avgR: 0.9,
        avgProcessScore: 75.0,
        sampleSizeWarning: 'adequate',
      },
      {
        setupName: 'Reversal',
        setupId: 's3',
        count: 10,
        winRate: 0.6,
        avgR: 1.1,
        avgProcessScore: 79.0,
        sampleSizeWarning: 'small',
      },
      {
        setupName: 'Range',
        setupId: 's4',
        count: 5,
        winRate: 0.4,
        avgR: -0.3,
        avgProcessScore: 60.0,
        sampleSizeWarning: 'very_small',
      },
    ],
    calendarHeatmap: [],
    periodMatrix: {},
    attentionInsights: { insights: [], tradeCount: 42 },
    ...overrides,
  };
}

function renderWithDashboard(dashboard: DashboardResponse) {
  mockUseWorkstation.mockReturnValue({
    fixtures: { dashboard },
  });
  return render(<PerformancePanel />);
}

// ── Tests ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe('PerformancePanel — KPI stat rows', () => {
  it('renders all metrics with correct formatted values', () => {
    renderWithDashboard(baseDashboard());

    // Net P&L
    const netPnl = screen.getByTestId('ws-perf-net-pnl');
    expect(netPnl.textContent).toContain('$4,523.50');
    expect(netPnl.querySelector('.ws-num')?.className).toContain('ws-pos');

    // Win Rate
    const winRate = screen.getByTestId('ws-perf-win-rate');
    expect(winRate.textContent).toContain('61.9%');

    // Profit Factor
    const pf = screen.getByTestId('ws-perf-profit-factor');
    expect(pf.textContent).toContain('2.15');

    // Avg R
    const avgR = screen.getByTestId('ws-perf-avg-r');
    expect(avgR.textContent).toContain('1.23');

    // Avg Win
    const avgWin = screen.getByTestId('ws-perf-avg-win');
    expect(avgWin.textContent).toContain('$350.00');
    expect(avgWin.querySelector('.ws-num')?.className).toContain('ws-pos');

    // Avg Loss
    const avgLoss = screen.getByTestId('ws-perf-avg-loss');
    expect(avgLoss.textContent).toContain('-$163.50');
    expect(avgLoss.querySelector('.ws-num')?.className).toContain('ws-neg');

    // Total Trades
    expect(screen.getByTestId('ws-perf-total-trades').textContent).toContain('42');

    // Open Trades
    expect(screen.getByTestId('ws-perf-open-trades').textContent).toContain('3');

    // Supported period-performance metrics
    expect(screen.getByTestId('ws-perf-fees').textContent).toContain('$421.25');
    expect(screen.getByTestId('ws-perf-payoff').textContent).toContain('2.14');
    expect(screen.getByTestId('ws-perf-expectancy').textContent).toContain('$116.00');
    expect(screen.getByTestId('ws-perf-expectancy-r').textContent).toContain('0.43');
    expect(screen.getByTestId('ws-perf-best-trade').textContent).toContain('$1,240.00');
    expect(screen.getByTestId('ws-perf-worst-trade').textContent).toContain('-$480.00');
    expect(screen.getByTestId('ws-perf-holding-days').textContent).toContain('3.5d');
  });

  it('renders null values as dashes', () => {
    renderWithDashboard(
      baseDashboard({
        kpis: {
          ...baseKpis(),
          winRate: null,
          avgR: null,
          profitFactor: null,
          avgWin: null,
          avgLoss: null,
        },
      }),
    );

    expect(screen.getByTestId('ws-perf-win-rate').textContent).toContain('—');
    expect(screen.getByTestId('ws-perf-avg-r').textContent).toContain('—');
    expect(screen.getByTestId('ws-perf-profit-factor').textContent).toContain('—');
    expect(screen.getByTestId('ws-perf-avg-win').textContent).toContain('—');
    expect(screen.getByTestId('ws-perf-avg-loss').textContent).toContain('—');
  });

  it('renders an all-scratch average loss as neutral zero', () => {
    renderWithDashboard(
      baseDashboard({ kpis: { ...baseKpis(), avgLoss: 0 } }),
    );

    const avgLoss = screen.getByTestId('ws-perf-avg-loss');
    expect(avgLoss.textContent).toContain('$0.00');
    expect(avgLoss.textContent).not.toContain('-$0.00');
    expect(avgLoss.querySelector('.ws-num')?.className).not.toContain('ws-neg');
  });
});

describe('PerformancePanel — Profit Factor threshold colouring', () => {
  it('applies ws-pos when profit factor > 1.5', () => {
    renderWithDashboard(
      baseDashboard({ kpis: { ...baseKpis(), profitFactor: 2.0 } }),
    );
    const el = screen.getByTestId('ws-perf-profit-factor');
    expect(el.querySelector('.ws-num')?.className).toContain('ws-pos');
  });

  it('applies no colour class when profit factor is between 1.0 and 1.5', () => {
    renderWithDashboard(
      baseDashboard({ kpis: { ...baseKpis(), profitFactor: 1.2 } }),
    );
    const el = screen.getByTestId('ws-perf-profit-factor');
    const cls = el.querySelector('.ws-num')?.className ?? '';
    expect(cls).not.toContain('ws-pos');
    expect(cls).not.toContain('ws-neg');
  });

  it('applies ws-neg when profit factor < 1.0', () => {
    renderWithDashboard(
      baseDashboard({ kpis: { ...baseKpis(), profitFactor: 0.7 } }),
    );
    const el = screen.getByTestId('ws-perf-profit-factor');
    expect(el.querySelector('.ws-num')?.className).toContain('ws-neg');
  });
});

describe('PerformancePanel — dense summary contract (S02)', () => {
  it('renders stat rows only — no monthly table in the summary row', () => {
    renderWithDashboard(baseDashboard());

    // Data points render…
    expect(screen.getByTestId('ws-performance-kpis')).toBeTruthy();
    expect(screen.getByTestId('ws-perf-net-pnl')).toBeTruthy();

    // …while the monthly breakdown table is excluded (data exists in the
    // snapshot but must not share the compact summary row).
    expect(screen.queryByTestId('ws-performance-monthly')).toBeNull();
    expect(screen.queryByText('Monthly Performance')).toBeNull();
  });

  it('renders no R distribution section', () => {
    renderWithDashboard(baseDashboard());

    expect(screen.queryByTestId('ws-performance-r-dist')).toBeNull();
    // No bin rows even though the fixture carries populated bins.
    expect(screen.queryByTestId('ws-r-bin-< -2')).toBeNull();
    expect(screen.queryByTestId('ws-r-bin-> 2')).toBeNull();
  });

  it('renders no setup ranking table', () => {
    renderWithDashboard(baseDashboard());

    expect(screen.queryByTestId('ws-performance-setups')).toBeNull();
    expect(screen.queryByTestId('ws-setup-s1')).toBeNull();
    expect(screen.queryByTestId('ws-setup-s4')).toBeNull();
  });

  it('renders no Tier 3 gated analytics section', () => {
    renderWithDashboard(baseDashboard());

    expect(screen.queryByTestId('ws-performance-tier3')).toBeNull();
    expect(screen.queryByTestId('ws-tier3-mae-mfe')).toBeNull();
    expect(screen.queryByTestId('ws-tier3-sharpe-sortino')).toBeNull();
    expect(screen.queryByTestId('ws-tier3-risk-of-ruin')).toBeNull();
    expect(screen.queryByTestId('ws-tier3-pips-points')).toBeNull();
  });

  it('keeps the panel header meta showing the closed-decision count', () => {
    renderWithDashboard(baseDashboard());

    const panel = screen.getByTestId('ws-panel-performance');
    expect(panel.textContent).toContain('39 closed');
  });
});

describe('PerformancePanel — Empty state', () => {
  it('shows compact empty state when no data', () => {
    renderWithDashboard(
      baseDashboard({
        kpis: {
          totalTrades: 0,
          openTrades: 0,
          winRate: null,
          netPnl: 0,
          avgR: null,
          avgGrade: null,
          currentDrawdown: null,
          currentDrawdownPct: null,
          accountValue: null,
          profitFactor: null,
          avgWin: null,
          avgLoss: null,
        },
        monthlyPerformance: [],
        rDistribution: [],
        setupRanking: [],
      }),
    );

    const empty = screen.getByTestId('ws-performance-empty');
    expect(empty).toBeTruthy();
    expect(empty.textContent).toContain('No performance data');

    // KPI section should not render
    expect(screen.queryByTestId('ws-performance-kpis')).toBeNull();
  });
});
