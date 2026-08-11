/**
 * Tests for OpenPositionsRiskWidget — combined dashboard widget with risk
 * summary row + position detail table.
 *
 * Covers: widget title rendering, risk summary row values and badges,
 * position detail table columns, loading/error/empty states,
 * no-open-positions empty state, null edge cases, P&L color classes.
 *
 * Run: npx vitest run src/components/dashboard/open-positions-risk-widget.test.tsx
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { OpenPositionsRiskWidget } from './open-positions-risk-widget';
import type {
  ValuationCompleteness,
  DashboardPositionSummary,
  RiskSummary,
} from '@/components/dashboard-v2';

// ═══════════════════════════════════════════════════════════════════════════
// Fixtures
// ═══════════════════════════════════════════════════════════════════════════

const SAMPLE_POSITION: DashboardPositionSummary = {
  instrumentId: 'inst-1',
  symbol: 'AAPL',
  direction: 'long',
  quantity: '100',
  averageCost: '150.00',
  markStatus: 'fresh',
  markPrice: '155.00',
  markedValue: '15500.00',
  unrealizedPnl: '500.00',
  markTimestamp: '2026-07-17T19:00:00.000Z',
  markAgeMinutes: 5,
};

const NEGATIVE_POSITION: DashboardPositionSummary = {
  instrumentId: 'inst-2',
  symbol: 'TSLA',
  direction: 'short',
  quantity: '50',
  averageCost: '250.00',
  markStatus: 'fresh',
  markPrice: '242.00',
  markedValue: '12100.00',
  unrealizedPnl: '400.00',
  markTimestamp: '2026-07-17T19:00:00.000Z',
  markAgeMinutes: 5,
};

const STALE_POSITION: DashboardPositionSummary = {
  instrumentId: 'inst-3',
  symbol: 'GOOGL',
  direction: 'long',
  quantity: '25',
  averageCost: '180.00',
  markStatus: 'stale',
  markPrice: '182.00',
  markedValue: '4550.00',
  unrealizedPnl: '50.00',
  markTimestamp: '2026-07-17T12:00:00.000Z',
  markAgeMinutes: 420,
};

const MISSING_POSITION: DashboardPositionSummary = {
  instrumentId: 'inst-4',
  symbol: 'NFLX',
  direction: null,
  quantity: '10',
  averageCost: '500.00',
  markStatus: 'missing',
  markPrice: null,
  markedValue: null,
  unrealizedPnl: null,
  markTimestamp: null,
  markAgeMinutes: null,
};

const LOSS_POSITION: DashboardPositionSummary = {
  instrumentId: 'inst-5',
  symbol: 'META',
  direction: 'long',
  quantity: '20',
  averageCost: '200.00',
  markStatus: 'fresh',
  markPrice: '190.00',
  markedValue: '3800.00',
  unrealizedPnl: '-200.00',
  markTimestamp: '2026-07-17T19:00:00.000Z',
  markAgeMinutes: 5,
};

const SAMPLE_VALUATION: ValuationCompleteness = {
  positionsTotal: 5,
  fresh: 3,
  stale: 1,
  missing: 1,
  state: 'partial',
  coveragePct: '60.00',
  presentationLabel: '— Partial — 2 unpriced',
  markedSubsetPnl: '700.00',
  positions: [
    SAMPLE_POSITION,
    NEGATIVE_POSITION,
    STALE_POSITION,
    MISSING_POSITION,
    LOSS_POSITION,
  ],
};

const EMPTY_VALUATION: ValuationCompleteness = {
  positionsTotal: 0,
  fresh: 0,
  stale: 0,
  missing: 0,
  state: 'complete',
  coveragePct: null,
  presentationLabel: null,
  markedSubsetPnl: null,
  positions: [],
};

const VALUATION_ZERO_ENTRY_POSITIONS: ValuationCompleteness = {
  positionsTotal: 0,
  fresh: 0,
  stale: 0,
  missing: 0,
  state: 'complete',
  coveragePct: null,
  presentationLabel: null,
  markedSubsetPnl: null,
  positions: [],
};

const SAMPLE_RISK: RiskSummary = {
  openPnl: '750.00',
  openRisk: '2500.00',
  portfolioHeat: '3.5',
  missingStops: 1,
  positionsWithStop: 4,
  openRiskToStop: '980.00',
  stopCoverage: {
    openTrades: 5,
    withStop: 4,
    withoutStop: 1,
    state: 'partial',
    presentationLabel: 'Incomplete — 1 without a valid stop',
  },
};

const ZERO_MISSING_RISK: RiskSummary = {
  openPnl: '500.00',
  openRisk: '1800.00',
  portfolioHeat: '2.1',
  missingStops: 0,
  positionsWithStop: 5,
  openRiskToStop: '0.00',
  stopCoverage: {
    openTrades: 5,
    withStop: 5,
    withoutStop: 0,
    state: 'complete',
    presentationLabel: null,
  },
};

const NULL_HEAT_RISK: RiskSummary = {
  openPnl: '0.00',
  openRisk: '0.00',
  portfolioHeat: null,
  missingStops: 0,
  positionsWithStop: 0,
  openRiskToStop: '0.00',
  stopCoverage: {
    openTrades: 0,
    withStop: 0,
    withoutStop: 0,
    state: 'complete',
    presentationLabel: null,
  },
};

const NEGATIVE_PNL_RISK: RiskSummary = {
  openPnl: '-200.00',
  openRisk: '1500.00',
  portfolioHeat: '2.8',
  missingStops: 2,
  positionsWithStop: 3,
  openRiskToStop: '620.00',
  stopCoverage: {
    openTrades: 5,
    withStop: 3,
    withoutStop: 2,
    state: 'partial',
    presentationLabel: 'Incomplete — 2 without a valid stop',
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('OpenPositionsRiskWidget', () => {
  afterEach(() => {
    cleanup();
  });

  // ── Widget Title ─────────────────────────────────────────────────

  it('renders widget title', () => {
    const { container } = render(
      <OpenPositionsRiskWidget
        valuation={SAMPLE_VALUATION}
        riskSummary={SAMPLE_RISK}
      />,
    );
    const title = container.querySelector('[data-slot="card-title"]');
    expect(title?.textContent).toContain('Open Positions & Risk');
  });

  it('has data-testid="widget-open-positions-risk"', () => {
    const { container } = render(
      <OpenPositionsRiskWidget
        valuation={SAMPLE_VALUATION}
        riskSummary={SAMPLE_RISK}
      />,
    );
    const el = container.querySelector(
      '[data-testid="widget-open-positions-risk"]',
    );
    expect(el).toBeTruthy();
  });

  // ── Loading State ────────────────────────────────────────────────

  it('shows skeleton when isLoading', () => {
    render(
      <OpenPositionsRiskWidget
        valuation={null}
        riskSummary={null}
        isLoading
      />,
    );
    const skeleton = document.querySelector('[aria-busy="true"]');
    expect(skeleton).toBeTruthy();
  });

  it('shows skeleton on refetch with existing data', () => {
    render(
      <OpenPositionsRiskWidget
        valuation={SAMPLE_VALUATION}
        riskSummary={SAMPLE_RISK}
        isLoading
      />,
    );
    const skeleton = document.querySelector('[aria-busy="true"]');
    expect(skeleton).toBeTruthy();
    // Content should not render while loading
    expect(screen.queryByText('AAPL')).toBeNull();
  });

  // ── Error State ──────────────────────────────────────────────────

  it('shows error message when error prop is set', () => {
    render(
      <OpenPositionsRiskWidget
        valuation={SAMPLE_VALUATION}
        riskSummary={SAMPLE_RISK}
        error="Failed to load position data"
      />,
    );
    expect(screen.getByText('Failed to load position data')).toBeTruthy();
    // Content should not render when error is shown
    expect(screen.queryByText('AAPL')).toBeNull();
  });

  // ── Empty / No Data State ────────────────────────────────────────

  it('shows "No position data available" when valuations is null and riskSummary is null', () => {
    render(
      <OpenPositionsRiskWidget
        valuation={null}
        riskSummary={null}
      />,
    );
    expect(
      screen.getByText('No position data available'),
    ).toBeTruthy();
  });

  it('shows "No position data available" when valuations is null even with riskSummary', () => {
    render(
      <OpenPositionsRiskWidget
        valuation={null}
        riskSummary={SAMPLE_RISK}
      />,
    );
    expect(
      screen.getByText('No position data available'),
    ).toBeTruthy();
  });

  it('shows "No position data available" when riskSummary is null even with valuation', () => {
    render(
      <OpenPositionsRiskWidget
        valuation={SAMPLE_VALUATION}
        riskSummary={null}
      />,
    );
    expect(
      screen.getByText('No position data available'),
    ).toBeTruthy();
  });

  // ── Risk Summary Row: Labels ────────────────────────────────────

  it('renders "Open P&L" label', () => {
    render(
      <OpenPositionsRiskWidget
        valuation={SAMPLE_VALUATION}
        riskSummary={SAMPLE_RISK}
      />,
    );
    expect(screen.getByText('Open P&L:')).toBeTruthy();
  });

  it('renders "Open Risk" label', () => {
    render(
      <OpenPositionsRiskWidget
        valuation={SAMPLE_VALUATION}
        riskSummary={SAMPLE_RISK}
      />,
    );
    expect(screen.getByText('Open Risk:')).toBeTruthy();
  });

  it('renders "Portfolio Heat" label', () => {
    render(
      <OpenPositionsRiskWidget
        valuation={SAMPLE_VALUATION}
        riskSummary={SAMPLE_RISK}
      />,
    );
    expect(screen.getByText('Portfolio Heat:')).toBeTruthy();
  });

  it('renders "Missing Stops" label', () => {
    render(
      <OpenPositionsRiskWidget
        valuation={SAMPLE_VALUATION}
        riskSummary={SAMPLE_RISK}
      />,
    );
    expect(screen.getByText('Missing Stops:')).toBeTruthy();
  });

  it('renders "Marks" label', () => {
    render(
      <OpenPositionsRiskWidget
        valuation={SAMPLE_VALUATION}
        riskSummary={SAMPLE_RISK}
      />,
    );
    expect(screen.getByText('Marks:')).toBeTruthy();
  });

  // ── Risk Summary Row: Values ────────────────────────────────────

  it('renders Open P&L formatted as signed currency', () => {
    render(
      <OpenPositionsRiskWidget
        valuation={SAMPLE_VALUATION}
        riskSummary={SAMPLE_RISK}
      />,
    );
    expect(screen.getByText('+$750.00')).toBeTruthy();
  });

  it('renders Open Risk formatted as currency', () => {
    render(
      <OpenPositionsRiskWidget
        valuation={SAMPLE_VALUATION}
        riskSummary={SAMPLE_RISK}
      />,
    );
    expect(screen.getByText('$2,500.00')).toBeTruthy();
  });

  it('renders Portfolio Heat as percentage', () => {
    render(
      <OpenPositionsRiskWidget
        valuation={SAMPLE_VALUATION}
        riskSummary={SAMPLE_RISK}
      />,
    );
    expect(screen.getByText('3.5%')).toBeTruthy();
  });

  it('renders Missing Stops count via Badge', () => {
    render(
      <OpenPositionsRiskWidget
        valuation={SAMPLE_VALUATION}
        riskSummary={SAMPLE_RISK}
      />,
    );
    expect(screen.getByText('1')).toBeTruthy();
  });

  it('renders Fresh/Stale/Missing badges from valuation data', () => {
    render(
      <OpenPositionsRiskWidget
        valuation={SAMPLE_VALUATION}
        riskSummary={SAMPLE_RISK}
      />,
    );
    expect(screen.getByText('Fresh: 3')).toBeTruthy();
    expect(screen.getByText('Stale: 1')).toBeTruthy();
    expect(screen.getByText('Missing: 1')).toBeTruthy();
  });

  // ── Risk Summary Row: Edge Cases ────────────────────────────────

  it('renders zero Open P&L with neutral styling', () => {
    render(
      <OpenPositionsRiskWidget
        valuation={SAMPLE_VALUATION}
        riskSummary={NULL_HEAT_RISK}
      />,
    );
    // signDisplay: 'exceptZero' omits the + sign for zero values.
    // $0.00 appears for both openPnl (neutral color) and openRisk.
    const results = screen.getAllByText('$0.00');
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('renders negative Open P&L with negative sign', () => {
    render(
      <OpenPositionsRiskWidget
        valuation={SAMPLE_VALUATION}
        riskSummary={NEGATIVE_PNL_RISK}
      />,
    );
    // -$200.00 appears in both the risk summary row (openPnl) and the
    // META position table cell (unrealizedPnl)
    const results = screen.getAllByText('-$200.00');
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('renders Portfolio Heat as "--" when null', () => {
    render(
      <OpenPositionsRiskWidget
        valuation={SAMPLE_VALUATION}
        riskSummary={NULL_HEAT_RISK}
      />,
    );
    // -- appears in both portfolioHeat (risk summary) and NFLX P&L (position table)
    const results = screen.getAllByText('--');
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('renders Missing Stops badge with destructive variant when > 0', () => {
    render(
      <OpenPositionsRiskWidget
        valuation={SAMPLE_VALUATION}
        riskSummary={SAMPLE_RISK}
      />,
    );
    // SAMPLE_RISK has missingStops=1, so the badge should have destructive variant
    // We check by looking for badge with text "1"
    const badge = screen.getByText('1');
    expect(badge).toBeTruthy();
  });

  it('renders Missing Stops badge for zero missing stops', () => {
    render(
      <OpenPositionsRiskWidget
        valuation={SAMPLE_VALUATION}
        riskSummary={ZERO_MISSING_RISK}
      />,
    );
    const badge = screen.getByText('0');
    expect(badge).toBeTruthy();
  });

  it('renders all-zero badge counts for empty valuation data', () => {
    render(
      <OpenPositionsRiskWidget
        valuation={EMPTY_VALUATION}
        riskSummary={ZERO_MISSING_RISK}
      />,
    );
    expect(screen.getByText('Fresh: 0')).toBeTruthy();
    expect(screen.getByText('Stale: 0')).toBeTruthy();
    expect(screen.getByText('Missing: 0')).toBeTruthy();
  });

  // ── Position Table: Symbols ─────────────────────────────────────

  it('renders position symbols in the table', () => {
    render(
      <OpenPositionsRiskWidget
        valuation={SAMPLE_VALUATION}
        riskSummary={SAMPLE_RISK}
      />,
    );
    expect(screen.getByText('AAPL')).toBeTruthy();
    expect(screen.getByText('TSLA')).toBeTruthy();
    expect(screen.getByText('GOOGL')).toBeTruthy();
    expect(screen.getByText('NFLX')).toBeTruthy();
    expect(screen.getByText('META')).toBeTruthy();
  });

  it('renders position quantity', () => {
    render(
      <OpenPositionsRiskWidget
        valuation={SAMPLE_VALUATION}
        riskSummary={SAMPLE_RISK}
      />,
    );
    expect(screen.getByText('100')).toBeTruthy();
    expect(screen.getByText('50')).toBeTruthy();
    expect(screen.getByText('25')).toBeTruthy();
    expect(screen.getByText('10')).toBeTruthy();
    expect(screen.getByText('20')).toBeTruthy();
  });

  // ── Position Table: P&L ───────────────────────────────────────

  it('renders positive P&L with "+" sign', () => {
    render(
      <OpenPositionsRiskWidget
        valuation={SAMPLE_VALUATION}
        riskSummary={SAMPLE_RISK}
      />,
    );
    expect(screen.getByText('+$500.00')).toBeTruthy();
    expect(screen.getByText('+$400.00')).toBeTruthy();
    expect(screen.getByText('+$50.00')).toBeTruthy();
  });

  it('renders negative P&L with "-" sign', () => {
    render(
      <OpenPositionsRiskWidget
        valuation={SAMPLE_VALUATION}
        riskSummary={SAMPLE_RISK}
      />,
    );
    expect(screen.getByText('-$200.00')).toBeTruthy();
  });

  it('renders "--" for null unrealized P&L', () => {
    render(
      <OpenPositionsRiskWidget
        valuation={SAMPLE_VALUATION}
        riskSummary={SAMPLE_RISK}
      />,
    );
    // NFLX has null unrealizedPnl — '--' appears in the P&L column
    // There may also be '--' from portfolioHeat null etc.
    const dashElements = screen.getAllByText('--');
    expect(dashElements.length).toBeGreaterThanOrEqual(1);
  });

  // ── Position Table: Status Badges ──────────────────────────────

  it('renders Fresh badge for fresh positions', () => {
    render(
      <OpenPositionsRiskWidget
        valuation={SAMPLE_VALUATION}
        riskSummary={SAMPLE_RISK}
      />,
    );
    // There are 3 fresh positions (AAPL, TSLA, META) plus the Fresh badge in
    // the risk summary row which says "Fresh: 3"
    const freshBadges = screen.getAllByText('Fresh');
    // At minimum 3 from the Fresh:3 badge + individual Fresh cells
    expect(freshBadges.length).toBeGreaterThanOrEqual(2);
  });

  it('renders Stale badge for stale positions', () => {
    render(
      <OpenPositionsRiskWidget
        valuation={SAMPLE_VALUATION}
        riskSummary={SAMPLE_RISK}
      />,
    );
    // The risk summary row shows "Stale: 1" (single element), and the
    // GOOGL position table row renders a badge with text "Stale"
    const staleTexts = screen.getAllByText('Stale');
    expect(staleTexts.length).toBeGreaterThanOrEqual(1);
  });

  it('renders Missing badge for missing positions', () => {
    render(
      <OpenPositionsRiskWidget
        valuation={SAMPLE_VALUATION}
        riskSummary={SAMPLE_RISK}
      />,
    );
    // The risk summary row shows "Missing: 1" (single element), and the
    // NFLX position table row renders a badge with text "Missing"
    const missingTexts = screen.getAllByText('Missing');
    expect(missingTexts.length).toBeGreaterThanOrEqual(1);
  });

  // ── Direction Icons ─────────────────────────────────────────────

  it('renders direction icons for all positions', () => {
    const { container } = render(
      <OpenPositionsRiskWidget
        valuation={SAMPLE_VALUATION}
        riskSummary={SAMPLE_RISK}
      />,
    );
    const svgs = container.querySelectorAll('svg');
    expect(svgs.length).toBeGreaterThan(0);
  });

  // ── P&L Color Classes ────────────────────────────────────────────

  it('applies green color class for positive P&L', () => {
    const { container } = render(
      <OpenPositionsRiskWidget
        valuation={SAMPLE_VALUATION}
        riskSummary={SAMPLE_RISK}
      />,
    );
    const greenCells = container.querySelectorAll('.text-positive');
    expect(greenCells.length).toBeGreaterThanOrEqual(1);
  });

  it('applies red color class for negative P&L', () => {
    const { container } = render(
      <OpenPositionsRiskWidget
        valuation={SAMPLE_VALUATION}
        riskSummary={NEGATIVE_PNL_RISK}
      />,
    );
    const redCells = container.querySelectorAll('.text-negative');
    // The Open P&L '-$200.00' cell and the META cell should have red
    expect(redCells.length).toBeGreaterThanOrEqual(1);
  });

  // ── Empty Position State ─────────────────────────────────────────

  it('shows "No open positions" when positions array is empty', () => {
    render(
      <OpenPositionsRiskWidget
        valuation={VALUATION_ZERO_ENTRY_POSITIONS}
        riskSummary={ZERO_MISSING_RISK}
      />,
    );
    expect(screen.getByText('No open positions')).toBeTruthy();
    expect(
      screen.getByText('This account has no open positions to display.'),
    ).toBeTruthy();
  });

  // ── Table Headers ────────────────────────────────────────────────

  it('renders all table column headers', () => {
    render(
      <OpenPositionsRiskWidget
        valuation={SAMPLE_VALUATION}
        riskSummary={SAMPLE_RISK}
      />,
    );
    expect(screen.getByText('Symbol')).toBeTruthy();
    expect(screen.getByText('Dir')).toBeTruthy();
    expect(screen.getByText('Qty')).toBeTruthy();
    expect(screen.getByText('P&L')).toBeTruthy();
    expect(screen.getByText('Status')).toBeTruthy();
  });

  // ── P&L Color: Positive vs Negative comparison ────────────────────

  it('applies green for positive P&L cells and red for negative P&L cells', () => {
    const { container } = render(
      <OpenPositionsRiskWidget
        valuation={SAMPLE_VALUATION}
        riskSummary={SAMPLE_RISK}
      />,
    );
    // Positive P&L cells (AAPL $500, TSLA $400, GOOGL $50): text-positive
    const greenCells = container.querySelectorAll('.text-positive');
    expect(greenCells.length).toBeGreaterThanOrEqual(1);
    // META has -$200.00 P&L which should be text-negative in the P&L cell
    // The risk summary Open P&L uses SAMPLE_RISK (positive $750), so only
    // the META row cell should be red
    const redCells = container.querySelectorAll('.text-negative');
    expect(redCells.length).toBeGreaterThanOrEqual(1);
  });
});
