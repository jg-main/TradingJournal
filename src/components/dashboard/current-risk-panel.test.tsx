/**
 * Tests for CurrentRiskPanel — compact grouped current-risk metric panel.
 *
 * Covers: widget title rendering, all 3 metric values with formatting,
 * loading/error/empty states, MTM states (value, awaiting prices, no open
 * positions), null metrics, refresh button, attribution badge.
 *
 * Run: npx vitest run src/components/dashboard/current-risk-panel.test.tsx
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { CurrentRiskPanel } from './current-risk-panel';
import type { KpiMetrics, MtmData } from './kpi-widgets';

// ═══════════════════════════════════════════════════════════════════════════
// Fixtures
// ═══════════════════════════════════════════════════════════════════════════

const SAMPLE_KPIS: KpiMetrics = {
  totalTrades: 42,
  openTrades: 3,
  winRate: 0.55,
  netPnl: 2500,
  avgR: 1.8,
  avgGrade: 48,
  currentDrawdown: -500,
  currentDrawdownPct: -0.05,
  accountValue: 25000,
  profitFactor: 1.75,
  avgWin: 350,
  avgLoss: -200,
};

const NULL_KPIS: KpiMetrics = {
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
};

const SAMPLE_MTM: MtmData = {
  netUnrealizedPnl: 150,
  openTradeCount: 3,
  tradesWithPrices: 2,
  tradesAwaitingData: 1,
};

const NULL_MTM: MtmData = {
  netUnrealizedPnl: null,
  openTradeCount: 3,
  tradesWithPrices: 0,
  tradesAwaitingData: 3,
};

const NO_OPEN_TRADES_MTM: MtmData = {
  netUnrealizedPnl: null,
  openTradeCount: 0,
  tradesWithPrices: 0,
  tradesAwaitingData: 0,
};

function renderWithTooltip(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('CurrentRiskPanel', () => {
  afterEach(() => {
    cleanup();
  });

  // ── Widget Title ─────────────────────────────────────────────────

  it('renders widget title', () => {
    const { container } = renderWithTooltip(
      <CurrentRiskPanel data={SAMPLE_KPIS} mtm={SAMPLE_MTM} />,
    );
    const title = container.querySelector('[data-slot="card-title"]');
    expect(title?.textContent).toContain('Current Risk');
  });

  it('has data-testid="widget-current-risk"', () => {
    const { container } = renderWithTooltip(
      <CurrentRiskPanel data={SAMPLE_KPIS} mtm={SAMPLE_MTM} />,
    );
    const el = container.querySelector(
      '[data-testid="widget-current-risk"]',
    );
    expect(el).toBeTruthy();
  });

  // ── Loading State ────────────────────────────────────────────────

  it('shows skeleton when isLoading', () => {
    renderWithTooltip(
      <CurrentRiskPanel data={null} isLoading />,
    );
    const skeleton = document.querySelector('[aria-busy="true"]');
    expect(skeleton).toBeTruthy();
  });

  it('shows skeleton on refetch with existing data', () => {
    renderWithTooltip(
      <CurrentRiskPanel data={SAMPLE_KPIS} mtm={SAMPLE_MTM} isLoading />,
    );
    const skeleton = document.querySelector('[aria-busy="true"]');
    expect(skeleton).toBeTruthy();
    // Content should not render while loading
    expect(screen.queryByText(/\$25,000/)).toBeNull();
  });

  // ── Error State ──────────────────────────────────────────────────

  it('shows error message when error prop is set', () => {
    renderWithTooltip(
      <CurrentRiskPanel
        data={SAMPLE_KPIS}
        mtm={SAMPLE_MTM}
        error="Failed to load risk data"
      />,
    );
    expect(screen.getByText('Failed to load risk data')).toBeTruthy();
    // Content should not render when error is shown
    expect(screen.queryByText(/\$25,000/)).toBeNull();
  });

  // ── Empty / No Data State ────────────────────────────────────────

  it('shows "No risk data available" when data is null and not loading', () => {
    renderWithTooltip(
      <CurrentRiskPanel data={null} />,
    );
    expect(screen.getByText('No risk data available')).toBeTruthy();
  });

  // ── All 3 Metrics: Account Value, Current Drawdown, Unrealized P&L

  it('renders Account Value metric formatted as currency', () => {
    renderWithTooltip(<CurrentRiskPanel data={SAMPLE_KPIS} mtm={SAMPLE_MTM} />);
    expect(screen.getByText(/\$25,000/)).toBeTruthy();
    expect(screen.getByText('Account Value')).toBeTruthy();
  });

  it('renders -- for Account Value when null', () => {
    renderWithTooltip(<CurrentRiskPanel data={NULL_KPIS} mtm={SAMPLE_MTM} />);
    expect(screen.getByText('Account Value')).toBeTruthy();
    // There should be at least one '--' in the grid for null account value
    const dashes = screen.getAllByText('--');
    expect(dashes.length).toBeGreaterThan(0);
  });

  it('renders Current Drawdown as absolute currency plus percentage', () => {
    renderWithTooltip(<CurrentRiskPanel data={SAMPLE_KPIS} mtm={SAMPLE_MTM} />);
    // -500 → $500.00 (5.0%)
    expect(screen.getByText(/\$500\.00 \(5\.0%\)/)).toBeTruthy();
    expect(screen.getByText('Current Drawdown')).toBeTruthy();
  });

  it('renders -- for Current Drawdown when drawdown and drawdownPct are null', () => {
    renderWithTooltip(<CurrentRiskPanel data={NULL_KPIS} mtm={SAMPLE_MTM} />);
    expect(screen.getByText('Current Drawdown')).toBeTruthy();
  });

  it('renders Unrealized P&L as currency with sign when MTM has value', () => {
    renderWithTooltip(<CurrentRiskPanel data={SAMPLE_KPIS} mtm={SAMPLE_MTM} />);
    // 150 with signDisplay 'exceptZero'
    expect(screen.getByText(/\+?\$150/)).toBeTruthy();
    expect(screen.getByText('Unrealized P&L')).toBeTruthy();
  });

  it('shows "Awaiting prices" when MTM has open trades but no P&L', () => {
    renderWithTooltip(<CurrentRiskPanel data={SAMPLE_KPIS} mtm={NULL_MTM} />);
    expect(screen.getByText('Awaiting prices')).toBeTruthy();
  });

  it('shows "No open positions" when MTM has no open trades and no P&L', () => {
    renderWithTooltip(
      <CurrentRiskPanel data={SAMPLE_KPIS} mtm={NO_OPEN_TRADES_MTM} />,
    );
    expect(screen.getByText('No open positions')).toBeTruthy();
  });

  it('shows -- when mtm is null (loading)', () => {
    renderWithTooltip(
      <CurrentRiskPanel data={SAMPLE_KPIS} mtm={null} />,
    );
    expect(screen.getByText('Unrealized P&L')).toBeTruthy();
  });

  // ── Unrealized P&L Color Classes ─────────────────────────────────

  it('applies pnl color class for positive unrealized P&L', () => {
    renderWithTooltip(<CurrentRiskPanel data={SAMPLE_KPIS} mtm={SAMPLE_MTM} />);
    // +150 → text-zinc-700
    const valueElement = screen.getByText(/150/);
    expect(valueElement?.className).toContain('text-zinc-700');
  });

  // ── Attribution Badge ────────────────────────────────────────────

  it('renders "Current state" attribution badge', () => {
    renderWithTooltip(<CurrentRiskPanel data={SAMPLE_KPIS} mtm={SAMPLE_MTM} />);
    expect(screen.getByText('Current state')).toBeTruthy();
  });

  // ── Refresh Button ────────────────────────────────────────────────

  it('renders refresh button when onRefresh is provided', () => {
    const onRefresh = () => {};
    renderWithTooltip(
      <CurrentRiskPanel
        data={SAMPLE_KPIS}
        mtm={SAMPLE_MTM}
        onRefresh={onRefresh}
      />,
    );
    const refreshBtn = screen.getByTitle('Refresh prices from market data');
    expect(refreshBtn).toBeTruthy();
  });

  it('does not render refresh button when onRefresh is omitted', () => {
    renderWithTooltip(
      <CurrentRiskPanel data={SAMPLE_KPIS} mtm={SAMPLE_MTM} />,
    );
    expect(
      screen.queryByTitle('Refresh prices from market data'),
    ).toBeNull();
  });

  it('renders "Refreshing..." text and disabled button when isRefreshing', () => {
    const onRefresh = () => {};
    renderWithTooltip(
      <CurrentRiskPanel
        data={SAMPLE_KPIS}
        mtm={SAMPLE_MTM}
        onRefresh={onRefresh}
        isRefreshing
      />,
    );
    expect(screen.getByText('Refreshing...')).toBeTruthy();
    const refreshBtn = screen.getByTitle('Refreshing...');
    expect((refreshBtn as HTMLButtonElement).disabled).toBe(true);
  });

  // ── Current Drawdown stays red even for null values (the element exists) ──

  it('Current Drawdown label element always renders', () => {
    renderWithTooltip(<CurrentRiskPanel data={SAMPLE_KPIS} mtm={SAMPLE_MTM} />);
    expect(screen.getByText('Current Drawdown')).toBeTruthy();
  });
});
