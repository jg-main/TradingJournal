/**
 * Tests for the SetupRankingWidget component.
 *
 * Covers: title rendering, table rendering with correct columns,
 * sorting by win rate descending, sample size indicators (all 4 levels),
 * loading/error/empty state passthrough, null metric values,
 * drag handle presence, testId support, and error is null handling.
 *
 * Run: npx vitest run src/components/dashboard/setup-ranking-widget.test.tsx
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { SetupRankingWidget } from './setup-ranking-widget';
import { CustomizingProvider } from '@/lib/customizing-context';
import type { SetupPerfResult } from '@/lib/review-dashboard';

// ── Fixtures ───────────────────────────────────────────────────────────

const SETUP_A: SetupPerfResult = {
  setupName: 'Breakout',
  setupId: 'setup-1',
  count: 25,
  winRate: 0.65,
  avgR: 1.8,
  avgProcessScore: 48,
  sampleSizeWarning: 'moderate',
};

const SETUP_B: SetupPerfResult = {
  setupName: 'Pullback',
  setupId: 'setup-2',
  count: 40,
  winRate: 0.58,
  avgR: 1.4,
  avgProcessScore: 42,
  sampleSizeWarning: 'adequate',
};

const SETUP_C: SetupPerfResult = {
  setupName: 'Reversal',
  setupId: 'setup-3',
  count: 12,
  winRate: 0.72,
  avgR: 2.1,
  avgProcessScore: 36,
  sampleSizeWarning: 'small',
};

const SETUP_D: SetupPerfResult = {
  setupName: 'Gap Fill',
  setupId: 'setup-4',
  count: 3,
  winRate: 0.33,
  avgR: 0.9,
  avgProcessScore: 28,
  sampleSizeWarning: 'very_small',
};

const NULL_WINRATE_SETUP: SetupPerfResult = {
  setupName: 'Scalp',
  setupId: 'setup-5',
  count: 8,
  winRate: null,
  avgR: null,
  avgProcessScore: 30,
  sampleSizeWarning: 'small',
};

const ALL_SETUPS: SetupPerfResult[] = [
  SETUP_B,
  SETUP_A,
  SETUP_D,
  SETUP_C,
];

const WITH_NULLS: SetupPerfResult[] = [
  ...ALL_SETUPS,
  NULL_WINRATE_SETUP,
];

const EMPTY_SETUPS: SetupPerfResult[] = [];

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('SetupRankingWidget', () => {
  afterEach(() => {
    cleanup();
  });

  // ── Title ───────────────────────────────────────────────────────

  it('renders the default title in the widget header', () => {
    render(
      <SetupRankingWidget
        setupRanking={ALL_SETUPS}
      />,
    );
    expect(screen.getByText('Setup Ranking')).toBeTruthy();
  });

  it('renders a custom title when provided', () => {
    render(
      <SetupRankingWidget
        setupRanking={ALL_SETUPS}
        title="Setup Performance Ranking"
      />,
    );
    expect(screen.getByText('Setup Performance Ranking')).toBeTruthy();
  });

  // ── Table rendering ─────────────────────────────────────────────

  it('renders the table with Setup Name, Win Rate, Avg R, Trades, and Sample Size columns', () => {
    render(
      <SetupRankingWidget
        setupRanking={ALL_SETUPS}
      />,
    );
    expect(screen.getByText('Setup Name')).toBeTruthy();
    expect(screen.getByText('Win Rate')).toBeTruthy();
    expect(screen.getByText('Avg R')).toBeTruthy();
    expect(screen.getByText('Trades')).toBeTruthy();
    expect(screen.getByText('Sample Size')).toBeTruthy();
  });

  it('renders all setup rows', () => {
    render(
      <SetupRankingWidget
        setupRanking={ALL_SETUPS}
      />,
    );
    expect(screen.getByText('Breakout')).toBeTruthy();
    expect(screen.getByText('Pullback')).toBeTruthy();
    expect(screen.getByText('Reversal')).toBeTruthy();
    expect(screen.getByText('Gap Fill')).toBeTruthy();
  });

  it('renders win rate values as formatted percentages', () => {
    render(
      <SetupRankingWidget
        setupRanking={ALL_SETUPS}
      />,
    );
    // SETUP_C has highest win rate (72%) and should appear first
    expect(screen.getByText('72.0%')).toBeTruthy();
    expect(screen.getByText('65.0%')).toBeTruthy();
    expect(screen.getByText('58.0%')).toBeTruthy();
    expect(screen.getByText('33.0%')).toBeTruthy();
  });

  it('renders Avg R values with R suffix', () => {
    render(
      <SetupRankingWidget
        setupRanking={ALL_SETUPS}
      />,
    );
    expect(screen.getByText('2.10R')).toBeTruthy();
    expect(screen.getByText('1.80R')).toBeTruthy();
    expect(screen.getByText('1.40R')).toBeTruthy();
    expect(screen.getByText('0.90R')).toBeTruthy();
  });

  it('renders trade count values', () => {
    render(
      <SetupRankingWidget
        setupRanking={ALL_SETUPS}
      />,
    );
    expect(screen.getByText('40')).toBeTruthy();
    expect(screen.getByText('25')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });

  // ── Sorting ─────────────────────────────────────────────────────

  it('sorts by win rate descending by default', () => {
    render(
      <SetupRankingWidget
        setupRanking={ALL_SETUPS}
      />,
    );

    // Reversal (72%) should be first, Breakout (65%) second, etc.
    const rows = document.querySelectorAll('[data-slot="table-row"]');
    // First data row (index 0 is the header) should be Reversal
    // The first data row cell should contain the highest win rate setup
    const firstDataRow = rows[1];
    const cells = firstDataRow?.querySelectorAll('[data-slot="table-cell"]');
    expect(cells?.[0]?.textContent).toBe('Reversal');
  });

  it('places null-win-rate items at the bottom sorted by count', () => {
    render(
      <SetupRankingWidget
        setupRanking={WITH_NULLS}
      />,
    );

    const rows = document.querySelectorAll('[data-slot="table-row"]');
    // Null win rate setups should be at the bottom
    const lastDataRow = rows[rows.length - 1];
    const cells = lastDataRow?.querySelectorAll('[data-slot="table-cell"]');
    expect(cells?.[0]?.textContent).toBe('Scalp');
  });

  // ── Sample Size Indicators ──────────────────────────────────────

  it('shows adequate sample size with green dot for 30+ trades', () => {
    render(
      <SetupRankingWidget
        setupRanking={ALL_SETUPS}
      />,
    );
    // Pullback has 40 trades → 'adequate' → green dot
    const pullbackRow = screen.getByText('Pullback').closest('tr');
    const greenDot = pullbackRow?.querySelector('.bg-green-500');
    expect(greenDot).toBeTruthy();
    expect(screen.getByText('Adequate')).toBeTruthy();
  });

  it('shows moderate sample size with blue dot for 20-29 trades', () => {
    render(
      <SetupRankingWidget
        setupRanking={ALL_SETUPS}
      />,
    );
    // Breakout has 25 trades → 'moderate' → blue dot
    const breakoutRow = screen.getByText('Breakout').closest('tr');
    const blueDot = breakoutRow?.querySelector('.bg-blue-500');
    expect(blueDot).toBeTruthy();
    expect(screen.getByText('Moderate')).toBeTruthy();
  });

  it('shows small sample size with amber dot for 5-19 trades', () => {
    render(
      <SetupRankingWidget
        setupRanking={ALL_SETUPS}
      />,
    );
    // Reversal has 12 trades → 'small' → amber dot
    const reversalRow = screen.getByText('Reversal').closest('tr');
    const amberDot = reversalRow?.querySelector('.bg-amber-500');
    expect(amberDot).toBeTruthy();
    expect(screen.getByText('Small')).toBeTruthy();
  });

  it('shows very small sample size with red dot for 1-4 trades', () => {
    render(
      <SetupRankingWidget
        setupRanking={ALL_SETUPS}
      />,
    );
    // Gap Fill has 3 trades → 'very_small' → red dot
    const gapFillRow = screen.getByText('Gap Fill').closest('tr');
    const redDot = gapFillRow?.querySelector('.bg-red-500');
    expect(redDot).toBeTruthy();
    expect(screen.getByText('Very small')).toBeTruthy();
  });

  // ── Loading state ───────────────────────────────────────────────

  it('shows skeleton when isLoading is true with data', () => {
    const { container } = render(
      <SetupRankingWidget
        setupRanking={ALL_SETUPS}
        isLoading
      />,
    );
    const skeletons = container.querySelectorAll('[data-slot="skeleton"]');
    expect(skeletons.length).toBeGreaterThanOrEqual(1);
    // Table should not render while loading
    expect(screen.queryByText('Breakout')).toBeNull();
  });

  it('shows aria-busy when loading', () => {
    render(
      <SetupRankingWidget
        setupRanking={ALL_SETUPS}
        isLoading
      />,
    );
    const busy = document.querySelector('[aria-busy="true"]');
    expect(busy).toBeTruthy();
  });

  // ── Error state ─────────────────────────────────────────────────

  it('shows error message and alert role when error is provided', () => {
    render(
      <SetupRankingWidget
        setupRanking={ALL_SETUPS}
        error="Failed to load setup data"
      />,
    );
    expect(screen.getByText('Failed to load setup data')).toBeTruthy();
    expect(screen.queryByText('Breakout')).toBeNull();
    const alertEl = screen.getByRole('alert');
    expect(alertEl).toBeTruthy();
  });

  it('prioritises error over loading', () => {
    render(
      <SetupRankingWidget
        setupRanking={ALL_SETUPS}
        isLoading
        error="Error wins"
      />,
    );
    expect(screen.getByText('Error wins')).toBeTruthy();
  });

  // ── Empty state ─────────────────────────────────────────────────

  it('shows empty state when isEmpty is true', () => {
    render(
      <SetupRankingWidget
        setupRanking={ALL_SETUPS}
        isEmpty
      />,
    );
    expect(screen.getByText('No data available')).toBeTruthy();
  });

  it('shows EmptyState when setupRanking is empty array', () => {
    render(
      <SetupRankingWidget
        setupRanking={EMPTY_SETUPS}
      />,
    );
    expect(screen.getByText('No setup data available')).toBeTruthy();
  });

  it('shows empty state description when no data', () => {
    render(
      <SetupRankingWidget
        setupRanking={EMPTY_SETUPS}
      />,
    );
    expect(
      screen.getByText(
        'Your setup ranking will appear here after you close trades with assigned setups.',
      ),
    ).toBeTruthy();
  });

  // ── Null metric values ──────────────────────────────────────────

  it('renders em dash for null win rate values', () => {
    render(
      <SetupRankingWidget
        setupRanking={WITH_NULLS}
      />,
    );
    // Scalp has null winRate → should show '--'
    expect(screen.getByText('--')).toBeTruthy();
  });

  it('renders em dash for null avg R values', () => {
    render(
      <SetupRankingWidget
        setupRanking={WITH_NULLS}
      />,
    );
    // There are multiple em dash characters. The avgR for Scalp is null
    // and should show '—' (unicode em dash)
    const emDashes = screen.getAllByText('\u2014');
    expect(emDashes.length).toBeGreaterThanOrEqual(1);
  });

  // ── Drag handle ─────────────────────────────────────────────────

  it('renders the drag handle element via DashboardWidget', () => {
    const { container } = render(
      <CustomizingProvider value={true}>
        <SetupRankingWidget
          setupRanking={ALL_SETUPS}
        />
      </CustomizingProvider>,
    );
    const dragHandle = container.querySelector('.dashboard-widget-drag-handle');
    expect(dragHandle).toBeTruthy();
  });

  // ── testId ──────────────────────────────────────────────────────

  it('sets data-testid attribute when provided', () => {
    const { container } = render(
      <SetupRankingWidget
        setupRanking={ALL_SETUPS}
        testId="widget-setup-ranking"
      />,
    );
    const el = container.querySelector('[data-testid="widget-setup-ranking"]');
    expect(el).toBeTruthy();
  });

  // ── Error is null ───────────────────────────────────────────────

  it('renders content when error is null', () => {
    render(
      <SetupRankingWidget
        setupRanking={ALL_SETUPS}
        error={null}
      />,
    );
    expect(screen.getByText('Breakout')).toBeTruthy();
  });

  // ── Single setup (edge case) ────────────────────────────────────

  it('renders a single setup correctly', () => {
    const singleSetup: SetupPerfResult[] = [SETUP_A];
    render(
      <SetupRankingWidget
        setupRanking={singleSetup}
      />,
    );
    expect(screen.getByText('Breakout')).toBeTruthy();
    const rows = document.querySelectorAll('[data-slot="table-row"]');
    expect(rows.length).toBe(2); // header + 1 data row
  });
});
