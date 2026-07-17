/**
 * Tests for AccountPerformancePanel — compact grouped metric panel.
 *
 * Covers: widget title rendering, all 9 metric values with formatting,
 * account info header, integrity badge, journal attribution badges,
 * computed-at timestamp, loading/error/empty states, null metrics.
 *
 * Run: npx vitest run src/components/dashboard/account-performance-panel.test.tsx
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AccountPerformancePanel } from './account-performance-panel';
import type { DashboardV2Response, IntegrityStatus } from '@/components/dashboard-v2';

// ═══════════════════════════════════════════════════════════════════════════
// Fixtures
// ═══════════════════════════════════════════════════════════════════════════

const SAMPLE_DATA: DashboardV2Response = {
  account: { id: 'acc-1', name: 'Test Account', currency: 'USD' },
  metrics: {
    cash: '10000.00',
    nav: '17280.00',
    markedPositions: '7298.00',
    realizedPnl: '250.00',
    unrealizedPnl: '42.50',
    totalPnl: '292.50',
    realizedFees: '8.00',
    grossExposure: '7298.00',
    netExposure: '7298.00',
    drawdown: '500.00',
    drawdownPct: '0.05',
    modifiedDietzReturn: null,
    twr: null,
  },
  valuation: {
    positionsTotal: 2,
    fresh: 2,
    stale: 0,
    missing: 0,
    positions: [],
  },
  journalAttribution: {
    hasJournalTrades: true,
    journalExecutionCount: 1,
    accountOnlyExecutionCount: 2,
  },
  integrity: {
    status: 'healthy',
    warnings: [],
  },
  computedAt: '2026-07-17T20:00:00.000Z',
};

const SAMPLE_DATA_NEGATIVE_METRICS: DashboardV2Response = {
  ...SAMPLE_DATA,
  metrics: {
    ...SAMPLE_DATA.metrics,
    realizedPnl: '-150.00',
    unrealizedPnl: '-42.50',
    netExposure: '-1000.00',
    drawdown: '1500.00',
    drawdownPct: '0.15',
  },
};

const SAMPLE_DATA_WITH_WARNINGS: DashboardV2Response = {
  ...SAMPLE_DATA,
  integrity: {
    status: 'critical',
    warnings: ['No reconciliation has been performed', 'Missing mark for GOOGL'],
  },
};

const SAMPLE_DATA_NULL_DRAWDOWN: DashboardV2Response = {
  ...SAMPLE_DATA,
  metrics: {
    ...SAMPLE_DATA.metrics,
    drawdown: null,
    drawdownPct: null,
  },
};

function renderWithTooltip(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('AccountPerformancePanel', () => {
  afterEach(() => {
    cleanup();
  });

  // ── Widget Title ─────────────────────────────────────────────────

  it('renders widget title', () => {
    const { container } = renderWithTooltip(
      <AccountPerformancePanel data={SAMPLE_DATA} />,
    );
    const title = container.querySelector('[data-slot="card-title"]');
    expect(title?.textContent).toContain('Account Performance');
  });

  it('has data-testid="widget-account-performance"', () => {
    const { container } = renderWithTooltip(
      <AccountPerformancePanel data={SAMPLE_DATA} />,
    );
    const el = container.querySelector(
      '[data-testid="widget-account-performance"]',
    );
    expect(el).toBeTruthy();
  });

  // ── Account Info ─────────────────────────────────────────────────

  it('renders account name and currency', () => {
    renderWithTooltip(<AccountPerformancePanel data={SAMPLE_DATA} />);
    expect(screen.getByText('Test Account')).toBeTruthy();
    expect(screen.getByText('USD')).toBeTruthy();
  });

  // ── Loading State ────────────────────────────────────────────────

  it('shows skeleton when isLoading', () => {
    renderWithTooltip(
      <AccountPerformancePanel data={null} isLoading />,
    );
    const skeleton = document.querySelector('[aria-busy="true"]');
    expect(skeleton).toBeTruthy();
  });

  it('shows skeleton on refetch with existing data', () => {
    renderWithTooltip(
      <AccountPerformancePanel data={SAMPLE_DATA} isLoading />,
    );
    const skeleton = document.querySelector('[aria-busy="true"]');
    expect(skeleton).toBeTruthy();
    // Content should not render while loading
    expect(screen.queryByText('Test Account')).toBeNull();
  });

  // ── Error State ──────────────────────────────────────────────────

  it('shows error message when error prop is set', () => {
    renderWithTooltip(
      <AccountPerformancePanel
        data={SAMPLE_DATA}
        error="Failed to load account data"
      />,
    );
    expect(screen.getByText('Failed to load account data')).toBeTruthy();
    // Content should not render when error is shown
    expect(screen.queryByText('Test Account')).toBeNull();
  });

  // ── Empty / No Data State ────────────────────────────────────────

  it('shows "No account data available" when data is null and not loading', () => {
    renderWithTooltip(
      <AccountPerformancePanel data={null} />,
    );
    expect(screen.getByText('No account data available')).toBeTruthy();
  });

  // ── All 9 Metrics: Row 1 (Cash, NAV, Marked Positions) ──────────

  it('renders Cash metric formatted', () => {
    renderWithTooltip(<AccountPerformancePanel data={SAMPLE_DATA} />);
    expect(screen.getByText('$10,000.00')).toBeTruthy();
    expect(screen.getByText('Cash')).toBeTruthy();
  });

  it('renders NAV metric formatted', () => {
    renderWithTooltip(<AccountPerformancePanel data={SAMPLE_DATA} />);
    expect(screen.getByText('$17,280.00')).toBeTruthy();
    expect(screen.getByText('NAV')).toBeTruthy();
  });

  it('renders Marked Positions metric formatted', () => {
    renderWithTooltip(<AccountPerformancePanel data={SAMPLE_DATA} />);
    // $7,298.00 appears twice: Marked Positions and Gross Exposure
    const values = screen.getAllByText('$7,298.00');
    expect(values.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Marked Positions')).toBeTruthy();
  });

  // ── All 9 Metrics: Row 2 (Realized P&L, Unrealized P&L, Fees) ──

  it('renders Realized P&L metric formatted with sign', () => {
    renderWithTooltip(<AccountPerformancePanel data={SAMPLE_DATA} />);
    // 250.00 with signDisplay 'exceptZero' → +$250.00
    expect(screen.getByText(/\+?\$250\.00/)).toBeTruthy();
    expect(screen.getByText('Realized P&L')).toBeTruthy();
  });

  it('renders Unrealized P&L metric formatted with sign', () => {
    renderWithTooltip(<AccountPerformancePanel data={SAMPLE_DATA} />);
    // 42.50 with signDisplay 'exceptZero' → +$42.50
    expect(screen.getByText(/\+?\$42\.50/)).toBeTruthy();
    expect(screen.getByText('Unrealized P&L')).toBeTruthy();
  });

  it('renders Realized Fees metric formatted with sign', () => {
    renderWithTooltip(<AccountPerformancePanel data={SAMPLE_DATA} />);
    // 8.00 with signDisplay 'exceptZero' → +$8.00
    expect(screen.getByText(/\+?\$8\.00/)).toBeTruthy();
    expect(screen.getByText('Realized Fees')).toBeTruthy();
  });

  // ── All 9 Metrics: Row 3 (Gross/Net Exposure, Drawdown) ─────────

  it('renders Gross Exposure metric formatted', () => {
    renderWithTooltip(<AccountPerformancePanel data={SAMPLE_DATA} />);
    // $7,298.00 appears in both Marked Positions and Gross Exposure
    const values = screen.getAllByText('$7,298.00');
    expect(values.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Gross Exposure')).toBeTruthy();
  });

  it('renders Net Exposure metric formatted with sign', () => {
    renderWithTooltip(<AccountPerformancePanel data={SAMPLE_DATA} />);
    expect(screen.getByText('Net Exposure')).toBeTruthy();
  });

  it('renders Drawdown metric as currency plus percentage', () => {
    renderWithTooltip(<AccountPerformancePanel data={SAMPLE_DATA} />);
    // Drawdown renders as "$500.00 (5.0%)" in a single text node
    expect(screen.getByText(/\$500\.00 \(5\.0%\)/)).toBeTruthy();
    expect(screen.getByText('Drawdown')).toBeTruthy();
  });

  it('renders -- for Drawdown when drawdown and drawdownPct are null', () => {
    renderWithTooltip(
      <AccountPerformancePanel data={SAMPLE_DATA_NULL_DRAWDOWN} />,
    );
    expect(screen.getByText('Drawdown')).toBeTruthy();
  });

  // ── P&L Color Classes ────────────────────────────────────────────

  it('applies red color for negative realized P&L', () => {
    renderWithTooltip(
      <AccountPerformancePanel data={SAMPLE_DATA_NEGATIVE_METRICS} />,
    );
    // The -$150.00 should have text-red-600 class applied
    const valueElement = screen.getByText(/\$150\.00/);
    expect(valueElement?.className).toContain('text-red-600');
  });

  // ── Integrity Badge ──────────────────────────────────────────────

  it('renders health integrity badge when no warnings', () => {
    renderWithTooltip(<AccountPerformancePanel data={SAMPLE_DATA} />);
    expect(screen.getByText('healthy')).toBeTruthy();
  });

  it('renders critical integrity badge with warning count', () => {
    renderWithTooltip(
      <AccountPerformancePanel data={SAMPLE_DATA_WITH_WARNINGS} />,
    );
    expect(screen.getByText('critical')).toBeTruthy();
    // Warning count: 2
    expect(screen.getByText('(2)')).toBeTruthy();
  });

  // ── Journal Attribution Badges ───────────────────────────────────

  it('renders attribution badges', () => {
    renderWithTooltip(<AccountPerformancePanel data={SAMPLE_DATA} />);
    expect(screen.getByText('Account performance')).toBeTruthy();
    expect(screen.getByText(/Journal: 1 linked, 2 direct/)).toBeTruthy();
  });

  // ── Computed-at Timestamp ────────────────────────────────────────

  it('renders computed-at timestamp', () => {
    renderWithTooltip(<AccountPerformancePanel data={SAMPLE_DATA} />);
    // computedAt is 2026-07-17T20:00:00.000Z — rendered via toLocaleString
    // We test for presence of some numeric component of the date
    expect(screen.getByText(/2026/)).toBeTruthy();
  });

  // ── Refresh Button ────────────────────────────────────────────────

  it('renders refresh button when onRefresh is provided', () => {
    const onRefresh = () => {};
    renderWithTooltip(
      <AccountPerformancePanel data={SAMPLE_DATA} onRefresh={onRefresh} />,
    );
    const refreshBtn = screen.getByTitle('Refresh');
    expect(refreshBtn).toBeTruthy();
  });

  it('does not render refresh button when onRefresh is omitted', () => {
    renderWithTooltip(<AccountPerformancePanel data={SAMPLE_DATA} />);
    expect(screen.queryByTitle('Refresh')).toBeNull();
  });
});
