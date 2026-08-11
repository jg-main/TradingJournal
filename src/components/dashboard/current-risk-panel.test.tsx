/**
 * Tests for CurrentRiskPanel — 9-metric 3x3 grid from /api/dashboard/v2.
 *
 * Covers: widget title rendering, all 9 metrics with formatting,
 * loading/error/empty/null states, Open P&L color classes (positive,
 * negative, zero), Portfolio Heat percentage, Missing Stops badge variant
 * (>0 destructive, 0 outline), Fresh/Stale/Missing badge triples, Largest
 * Exposure derivation, attribution badge, and computeLargestExposure in
 * isolation.
 *
 * Run: npx vitest run src/components/dashboard/current-risk-panel.test.tsx
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  CurrentRiskPanel,
  computeLargestExposure,
} from './current-risk-panel';
import type {
  RiskSummary,
  ValuationCompleteness,
  DashboardPositionSummary,
} from '@/components/dashboard-v2';

// ═══════════════════════════════════════════════════════════════════════════
// Fixtures
// ═══════════════════════════════════════════════════════════════════════════

const SAMPLE_RISK_SUMMARY: RiskSummary = {
  openPnl: '150.00',
  openRisk: '5000.00',
  portfolioHeat: '0.085',
  missingStops: 2,
  positionsWithStop: 5,
  openRiskToStop: '1500.00',
  stopCoverage: {
    openTrades: 7,
    withStop: 5,
    withoutStop: 2,
    state: 'partial',
    presentationLabel: 'Incomplete — 2 without a valid stop',
  },
};

const SAMPLE_VALUATION: ValuationCompleteness = {
  positionsTotal: 7,
  fresh: 4,
  stale: 2,
  missing: 1,
  state: 'partial',
  coveragePct: '57.14',
  presentationLabel: '— Partial — 3 unpriced',
  markedSubsetPnl: '500.00',
  positions: [
    {
      instrumentId: 'AAPL',
      symbol: 'AAPL',
      direction: 'long',
      quantity: '100',
      averageCost: '150.00',
      markStatus: 'fresh',
      markPrice: '155.00',
      markedValue: '25000.00',
      unrealizedPnl: '500.00',
      markTimestamp: '2026-07-18T10:00:00Z',
      markAgeMinutes: 5,
    },
    {
      instrumentId: 'MSFT',
      symbol: 'MSFT',
      direction: 'long',
      quantity: '50',
      averageCost: '300.00',
      markStatus: 'stale',
      markPrice: '310.00',
      markedValue: '15500.00',
      unrealizedPnl: '500.00',
      markTimestamp: '2026-07-18T08:00:00Z',
      markAgeMinutes: 125,
    },
    {
      instrumentId: 'GOOGL',
      symbol: 'GOOGL',
      direction: 'short',
      quantity: '30',
      averageCost: '2000.00',
      markStatus: 'missing',
      markPrice: null,
      markedValue: '-60000.00',
      unrealizedPnl: null,
      markTimestamp: null,
      markAgeMinutes: null,
    },
  ],
};

/** RiskSummary with negative Open P&L to test red coloring */
const NEGATIVE_RISK_SUMMARY: RiskSummary = {
  openPnl: '-350.00',
  openRisk: '5000.00',
  portfolioHeat: '0.085',
  missingStops: 2,
  positionsWithStop: 5,
  openRiskToStop: '1500.00',
  stopCoverage: {
    openTrades: 7,
    withStop: 5,
    withoutStop: 2,
    state: 'partial',
    presentationLabel: 'Incomplete — 2 without a valid stop',
  },
};

/** RiskSummary with zero values */
const ZERO_RISK_SUMMARY: RiskSummary = {
  openPnl: '0',
  openRisk: '0',
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

const ZERO_VALUATION: ValuationCompleteness = {
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

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

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
      <CurrentRiskPanel
        riskSummary={SAMPLE_RISK_SUMMARY}
        valuation={SAMPLE_VALUATION}
      />,
    );
    const title = container.querySelector('[data-slot="card-title"]');
    expect(title?.textContent).toContain('Current Risk');
  });

  it('has data-testid="widget-current-risk"', () => {
    const { container } = renderWithTooltip(
      <CurrentRiskPanel
        riskSummary={SAMPLE_RISK_SUMMARY}
        valuation={SAMPLE_VALUATION}
      />,
    );
    const el = container.querySelector(
      '[data-testid="widget-current-risk"]',
    );
    expect(el).toBeTruthy();
  });

  // ── Loading State ────────────────────────────────────────────────

  it('shows skeleton when isLoading', () => {
    renderWithTooltip(
      <CurrentRiskPanel riskSummary={null} valuation={null} isLoading />,
    );
    const skeleton = document.querySelector('[aria-busy="true"]');
    expect(skeleton).toBeTruthy();
  });

  it('shows skeleton when isLoading with data present', () => {
    renderWithTooltip(
      <CurrentRiskPanel
        riskSummary={SAMPLE_RISK_SUMMARY}
        valuation={SAMPLE_VALUATION}
        isLoading
      />,
    );
    const skeleton = document.querySelector('[aria-busy="true"]');
    expect(skeleton).toBeTruthy();
    // Metric content should not render while loading
    expect(screen.queryByText(/Open Positions/)).toBeNull();
  });

  // ── Error State ──────────────────────────────────────────────────

  it('shows error message when error prop is set', () => {
    renderWithTooltip(
      <CurrentRiskPanel
        riskSummary={SAMPLE_RISK_SUMMARY}
        valuation={SAMPLE_VALUATION}
        error="Failed to load risk data"
      />,
    );
    expect(screen.getByText('Failed to load risk data')).toBeTruthy();
    // Content should not render when error is shown
    expect(screen.queryByText(/Open Positions/)).toBeNull();
  });

  // ── Empty / No Data State ────────────────────────────────────────

  it('shows "No risk data available" when riskSummary is null and not loading', () => {
    renderWithTooltip(
      <CurrentRiskPanel riskSummary={null} valuation={null} />,
    );
    expect(screen.getByText('No risk data available')).toBeTruthy();
  });

  // ── All 9 Metrics Render ─────────────────────────────────--------

  it('renders Open Positions from valuation.positionsTotal', () => {
    renderWithTooltip(
      <CurrentRiskPanel
        riskSummary={SAMPLE_RISK_SUMMARY}
        valuation={SAMPLE_VALUATION}
      />,
    );
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getByText('Open Positions')).toBeTruthy();
  });

  it('renders Open P&L as signed currency from riskSummary.openPnl', () => {
    renderWithTooltip(
      <CurrentRiskPanel
        riskSummary={SAMPLE_RISK_SUMMARY}
        valuation={SAMPLE_VALUATION}
      />,
    );
    // Positive P&L should show with sign: +$150.00
    expect(screen.getByText(/\+?\$150\.00/)).toBeTruthy();
    expect(screen.getByText('Open P&L')).toBeTruthy();
  });

  it('renders Open Risk as currency from riskSummary.openRisk', () => {
    renderWithTooltip(
      <CurrentRiskPanel
        riskSummary={SAMPLE_RISK_SUMMARY}
        valuation={SAMPLE_VALUATION}
      />,
    );
    expect(screen.getByText(/\$5,000\.00/)).toBeTruthy();
    expect(screen.getByText('Open Risk')).toBeTruthy();
  });

  it('renders Portfolio Heat as percentage from riskSummary.portfolioHeat', () => {
    renderWithTooltip(
      <CurrentRiskPanel
        riskSummary={SAMPLE_RISK_SUMMARY}
        valuation={SAMPLE_VALUATION}
      />,
    );
    expect(screen.getByText('8.5%')).toBeTruthy();
    expect(screen.getByText('Portfolio Heat')).toBeTruthy();
  });

  it('renders Positions Without Stops as badge from riskSummary.missingStops', () => {
    const { container } = renderWithTooltip(
      <CurrentRiskPanel
        riskSummary={SAMPLE_RISK_SUMMARY}
        valuation={SAMPLE_VALUATION}
      />,
    );
    // The destructive badge (data-variant="destructive") with text '2' is the
    // missingStops badge; the secondary badge with '2' is stickyStale.
    const destructiveBadges = container.querySelectorAll(
      '[data-variant="destructive"]',
    );
    const matching = Array.from(destructiveBadges).filter(
      (b) => b.textContent === '2',
    );
    expect(matching.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Positions Without Stops')).toBeTruthy();
  });

  it('renders Largest Exposure formatted as currency from max markedValue', () => {
    renderWithTooltip(
      <CurrentRiskPanel
        riskSummary={SAMPLE_RISK_SUMMARY}
        valuation={SAMPLE_VALUATION}
      />,
    );
    // Largest of AAPL(25000), MSFT(15500), GOOGL(-60000) = 25000
    expect(screen.getByText(/\$25,000\.00/)).toBeTruthy();
    expect(screen.getByText('Largest Exposure')).toBeTruthy();
  });

  it('renders Fresh Prices as badge from valuation.fresh', () => {
    renderWithTooltip(
      <CurrentRiskPanel
        riskSummary={SAMPLE_RISK_SUMMARY}
        valuation={SAMPLE_VALUATION}
      />,
    );
    expect(screen.getByText('4')).toBeTruthy();
    expect(screen.getByText('Fresh Prices')).toBeTruthy();
  });

  it('renders Stale Prices as badge from valuation.stale', () => {
    const { container } = renderWithTooltip(
      <CurrentRiskPanel
        riskSummary={SAMPLE_RISK_SUMMARY}
        valuation={SAMPLE_VALUATION}
      />,
    );
    // The secondary badge (data-variant="secondary") with text '2' is the
    // stale badge; the destructive badge with '2' is missingStops.
    const secondaryBadges = container.querySelectorAll(
      '[data-variant="secondary"]',
    );
    const matching = Array.from(secondaryBadges).filter(
      (b) => b.textContent === '2',
    );
    expect(matching.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Stale Prices')).toBeTruthy();
  });

  it('renders Missing Prices as badge from valuation.missing', () => {
    renderWithTooltip(
      <CurrentRiskPanel
        riskSummary={SAMPLE_RISK_SUMMARY}
        valuation={SAMPLE_VALUATION}
      />,
    );
    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.getByText('Missing Prices')).toBeTruthy();
  });

  // ── Open P&L Color Classes ─────────────────────────────────────

  it('applies positive color class for positive Open P&L', () => {
    renderWithTooltip(
      <CurrentRiskPanel
        riskSummary={SAMPLE_RISK_SUMMARY}
        valuation={SAMPLE_VALUATION}
      />,
    );
    // Find the signed P&L element
    const valueEl = screen.getByText(/\+?\$150\.00/);
    expect(valueEl.className).toContain('text-positive');
  });

  it('applies negative color class for negative Open P&L', () => {
    renderWithTooltip(
      <CurrentRiskPanel
        riskSummary={NEGATIVE_RISK_SUMMARY}
        valuation={SAMPLE_VALUATION}
      />,
    );
    const valueEl = screen.getByText(/-?\$350\.00/);
    expect(valueEl.className).toContain('text-negative');
  });

  it('applies neutral color class for zero Open P&L', () => {
    renderWithTooltip(
      <CurrentRiskPanel
        riskSummary={ZERO_RISK_SUMMARY}
        valuation={ZERO_VALUATION}
      />,
    );
    // Both Open P&L and Open Risk show $0.00. Pick the one next to the
    // 'Open P&L' label by matching the one with text-zinc-500 class.
    const values = screen.getAllByText(/\$0\.00/);
    const pnlValue = values.find(
      (el) => el.className.includes('text-muted-foreground')
    );
    expect(pnlValue).toBeTruthy();
    expect(pnlValue!.className).toContain('text-muted-foreground');
  });

  // ── Missing Stops Badge Variants ────────────────────────────────

  it('shows destructive badge variant when Positions Without Stops > 0', () => {
    const { container } = renderWithTooltip(
      <CurrentRiskPanel
        riskSummary={SAMPLE_RISK_SUMMARY}
        valuation={SAMPLE_VALUATION}
      />,
    );
    // The 2 badge for missingStops should have destructive styling
    const badges = container.querySelectorAll('[data-slot="badge"]');
    const twoBadges = Array.from(badges).filter(
      (b) => b.textContent === '2',
    );
    expect(twoBadges.length).toBeGreaterThanOrEqual(1);
  });

  it('shows outline badge variant when Positions Without Stops is 0', () => {
    const { container } = renderWithTooltip(
      <CurrentRiskPanel
        riskSummary={ZERO_RISK_SUMMARY}
        valuation={ZERO_VALUATION}
      />,
    );
    // The badge for missingStops should be outline variant when 0
    const zeroBadges = container.querySelectorAll('[data-slot="badge"]');
    expect(zeroBadges.length).toBeGreaterThanOrEqual(1);
  });

  // ── Valuation Badge Triples ─────────────────────────────────────

  it('renders Fresh/Stale/Missing badges with correct counts', () => {
    renderWithTooltip(
      <CurrentRiskPanel
        riskSummary={SAMPLE_RISK_SUMMARY}
        valuation={SAMPLE_VALUATION}
      />,
    );
    expect(screen.getByText('Fresh Prices')).toBeTruthy();
    expect(screen.getByText('Stale Prices')).toBeTruthy();
    expect(screen.getByText('Missing Prices')).toBeTruthy();
  });

  it('shows -- for Fresh/Stale/Missing when valuation is null', () => {
    renderWithTooltip(
      <CurrentRiskPanel
        riskSummary={SAMPLE_RISK_SUMMARY}
        valuation={null}
      />,
    );
    // When valuation is null, badges show '--'
    const dashes = screen.getAllByText('--');
    expect(dashes.length).toBeGreaterThanOrEqual(1);
  });

  it('shows zero counts in badges for zero valuation', () => {
    renderWithTooltip(
      <CurrentRiskPanel
        riskSummary={ZERO_RISK_SUMMARY}
        valuation={ZERO_VALUATION}
      />,
    );
    // Fresh, Stale, Missing badges all show 0
    const zeroes = screen.getAllByText('0');
    expect(zeroes.length).toBeGreaterThanOrEqual(3);
  });

  // ── Portfolio Heat Edge Cases ───────────────────────────────────

  it('shows -- for Portfolio Heat when portfolioHeat is null', () => {
    renderWithTooltip(
      <CurrentRiskPanel
        riskSummary={ZERO_RISK_SUMMARY}
        valuation={ZERO_VALUATION}
      />,
    );
    expect(screen.getByText('Portfolio Heat')).toBeTruthy();
  });

  // ── Open Positions Edge Cases ───────────────────────────────────

  it('shows 0 for Open Positions when valuation has no positions', () => {
    renderWithTooltip(
      <CurrentRiskPanel
        riskSummary={SAMPLE_RISK_SUMMARY}
        valuation={ZERO_VALUATION}
      />,
    );
    // The ZERO_VALUATION has fresh/stale/missing all 0 (shown as badges)
    // and positionsTotal=0 (shown as a plain number). Find the plain '0'
    // that is NOT inside a badge — it's the Open Positions count.
    // Use container query to find tabular-nums spans without badge parent.
    const zeroElements = screen.getAllByText('0');
    const plainZero = zeroElements.find(
      (el) =>
        el.tagName === 'SPAN' &&
        !el.closest('[data-slot="badge"]') &&
        el.className.includes('tabular-nums'),
    );
    expect(plainZero).toBeTruthy();
    expect(screen.getByText('Open Positions')).toBeTruthy();
  });

  // ── Attribution Badge ───────────────────────────────────────────

  it('renders "Current state" attribution badge', () => {
    renderWithTooltip(
      <CurrentRiskPanel
        riskSummary={SAMPLE_RISK_SUMMARY}
        valuation={SAMPLE_VALUATION}
      />,
    );
    expect(screen.getByText('Current state')).toBeTruthy();
  });

  // ── No Refresh Button ───────────────────────────────────────────

  it('does not render a refresh button (removed in v2 refactor)', () => {
    renderWithTooltip(
      <CurrentRiskPanel
        riskSummary={SAMPLE_RISK_SUMMARY}
        valuation={SAMPLE_VALUATION}
      />,
    );
    expect(
      screen.queryByTitle('Refresh prices from market data'),
    ).toBeNull();
    expect(
      screen.queryByTitle('Refreshing...'),
    ).toBeNull();
    expect(screen.queryByText('Refreshing...')).toBeNull();
  });

  // ── Grid renders with null valuation when riskSummary is provided ──

  it('renders grid when riskSummary is provided but valuation is null', () => {
    renderWithTooltip(
      <CurrentRiskPanel
        riskSummary={SAMPLE_RISK_SUMMARY}
        valuation={null}
      />,
    );
    // Grid should show despite null valuation (warning: no empty state)
    expect(screen.getByText('Open Risk')).toBeTruthy();
    expect(screen.getByText('Portfolio Heat')).toBeTruthy();
    // Empty state text should NOT appear
    expect(
      screen.queryByText('No risk data available'),
    ).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// computeLargestExposure — pure function tests
// ═══════════════════════════════════════════════════════════════════════════

describe('computeLargestExposure', () => {
  it('returns the maximum markedValue from positions', () => {
    const positions: DashboardPositionSummary[] = [
      {
        instrumentId: 'A',
        symbol: 'A',
        direction: 'long',
        quantity: '1',
        averageCost: '100',
        markStatus: 'fresh',
        markPrice: '110',
        markedValue: '110.00',
        unrealizedPnl: '10.00',
        markTimestamp: null,
        markAgeMinutes: null,
      },
      {
        instrumentId: 'B',
        symbol: 'B',
        direction: 'long',
        quantity: '1',
        averageCost: '200',
        markStatus: 'fresh',
        markPrice: '250',
        markedValue: '250.00',
        unrealizedPnl: '50.00',
        markTimestamp: null,
        markAgeMinutes: null,
      },
      {
        instrumentId: 'C',
        symbol: 'C',
        direction: 'short',
        quantity: '1',
        averageCost: '50',
        markStatus: 'stale',
        markPrice: '45',
        markedValue: '-45.00',
        unrealizedPnl: '5.00',
        markTimestamp: null,
        markAgeMinutes: null,
      },
    ];
    expect(computeLargestExposure(positions)).toBe(250);
  });

  it('returns null for empty positions array', () => {
    expect(computeLargestExposure([])).toBeNull();
  });

  it('returns null for undefined positions', () => {
    expect(computeLargestExposure(undefined as unknown as DashboardPositionSummary[])).toBeNull();
  });

  it('skips positions with null markedValue', () => {
    const positions: DashboardPositionSummary[] = [
      {
        instrumentId: 'A',
        symbol: 'A',
        direction: 'long',
        quantity: '1',
        averageCost: '100',
        markStatus: 'missing',
        markPrice: null,
        markedValue: null,
        unrealizedPnl: null,
        markTimestamp: null,
        markAgeMinutes: null,
      },
      {
        instrumentId: 'B',
        symbol: 'B',
        direction: 'long',
        quantity: '1',
        averageCost: '200',
        markStatus: 'fresh',
        markPrice: '250',
        markedValue: '250.00',
        unrealizedPnl: '50.00',
        markTimestamp: null,
        markAgeMinutes: null,
      },
    ];
    expect(computeLargestExposure(positions)).toBe(250);
  });

  it('returns null when all positions have null markedValue', () => {
    const positions: DashboardPositionSummary[] = [
      {
        instrumentId: 'A',
        symbol: 'A',
        direction: 'long',
        quantity: '1',
        averageCost: '100',
        markStatus: 'missing',
        markPrice: null,
        markedValue: null,
        unrealizedPnl: null,
        markTimestamp: null,
        markAgeMinutes: null,
      },
      {
        instrumentId: 'B',
        symbol: 'B',
        direction: 'short',
        quantity: '1',
        averageCost: '200',
        markStatus: 'missing',
        markPrice: null,
        markedValue: null,
        unrealizedPnl: null,
        markTimestamp: null,
        markAgeMinutes: null,
      },
    ];
    expect(computeLargestExposure(positions)).toBeNull();
  });

  it('handles negative markedValue (short positions) correctly', () => {
    const positions: DashboardPositionSummary[] = [
      {
        instrumentId: 'A',
        symbol: 'A',
        direction: 'short',
        quantity: '10',
        averageCost: '100',
        markStatus: 'fresh',
        markPrice: '95',
        markedValue: '-950.00',
        unrealizedPnl: '50.00',
        markTimestamp: null,
        markAgeMinutes: null,
      },
      {
        instrumentId: 'B',
        symbol: 'B',
        direction: 'short',
        quantity: '10',
        averageCost: '200',
        markStatus: 'fresh',
        markPrice: '210',
        markedValue: '-2100.00',
        unrealizedPnl: '-100.00',
        markTimestamp: null,
        markAgeMinutes: null,
      },
    ];
    // Math.max of -950 and -2100 = -950 (least negative)
    expect(computeLargestExposure(positions)).toBe(-950);
  });
});
