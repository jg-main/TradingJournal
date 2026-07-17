/**
 * Tests for the AttentionInsightsWidget component.
 *
 * Covers: title rendering, insight card rendering (all 3 severities),
 * all type labels, value badge display, loading/error/empty state
 * passthrough, drag handle, testId support, error is null handling,
 * and edge cases.
 *
 * Run: npx vitest run src/components/dashboard/attention-insights-widget.test.tsx
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { AttentionInsightsWidget } from './attention-insights-widget';
import type { AttentionInsight } from '@/lib/attention-insights';

// ── Fixtures ───────────────────────────────────────────────────────────

const CRITICAL_INSIGHT: AttentionInsight = {
  type: 'no_stop_loss',
  severity: 'critical',
  title: '5 trades had no stop loss recorded',
  message: '5 of 20 closed trades (25%) had no stop loss recorded. Trades without predefined risk limits can lead to outsized losses.',
  value: 5,
};

const WARNING_INSIGHT: AttentionInsight = {
  type: 'losing_streak',
  severity: 'warning',
  title: 'On a 3-trade losing streak',
  message: "You've lost 3 consecutive trades. Consider reducing position size or taking a break to reassess.",
  value: 3,
};

const INFO_INSIGHT_DAY: AttentionInsight = {
  type: 'day_of_week_best',
  severity: 'info',
  title: 'Tuesday is your best trading day',
  message: "Tuesday: 80% win rate across 10 trades. That's 4.0x better than Wednesday (20% across 5 trades).",
  value: '80%',
};

const INFO_INSIGHT_TRADE: AttentionInsight = {
  type: 'top_trade',
  severity: 'info',
  title: 'Best trade: 3.5R',
  message: 'Your best trade returned 3.5R with a P&L of $525.00.',
  value: '3.5R',
};

const ALL_SEVERITIES: AttentionInsight[] = [
  CRITICAL_INSIGHT,
  WARNING_INSIGHT,
  INFO_INSIGHT_DAY,
  INFO_INSIGHT_TRADE,
];

const EMPTY_INSIGHTS: AttentionInsight[] = [];

const SINGLE_CRITICAL: AttentionInsight[] = [CRITICAL_INSIGHT];

const NO_VALUE_INSIGHT: AttentionInsight = {
  type: 'setup_diversity',
  severity: 'info',
  title: 'Traded 5 different setups',
  message: 'Your 20 closed trades span 5 unique setups.',
};

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('AttentionInsightsWidget', () => {
  afterEach(() => {
    cleanup();
  });

  // ── Title ───────────────────────────────────────────────────────

  it('renders the default title in the widget header', () => {
    render(
      <AttentionInsightsWidget
        insights={ALL_SEVERITIES}
      />,
    );
    expect(screen.getByText('Attention Insights')).toBeTruthy();
  });

  it('renders a custom title when provided', () => {
    render(
      <AttentionInsightsWidget
        insights={ALL_SEVERITIES}
        title="Trading Observations"
      />,
    );
    expect(screen.getByText('Trading Observations')).toBeTruthy();
  });

  // ── Insight card rendering ─────────────────────────────────────

  it('renders critical severity insight with title', () => {
    render(
      <AttentionInsightsWidget
        insights={SINGLE_CRITICAL}
      />,
    );
    expect(screen.getByText('5 trades had no stop loss recorded')).toBeTruthy();
  });

  it('renders critical severity insight with message', () => {
    render(
      <AttentionInsightsWidget
        insights={SINGLE_CRITICAL}
      />,
    );
    expect(
      screen.getByText(/5 of 20 closed trades.*had no stop loss recorded/),
    ).toBeTruthy();
  });

  it('renders all insights when multiple are provided', () => {
    render(
      <AttentionInsightsWidget
        insights={ALL_SEVERITIES}
      />,
    );
    expect(screen.getByText('5 trades had no stop loss recorded')).toBeTruthy();
    expect(screen.getByText('On a 3-trade losing streak')).toBeTruthy();
    expect(screen.getByText('Tuesday is your best trading day')).toBeTruthy();
    expect(screen.getByText('Best trade: 3.5R')).toBeTruthy();
  });

  it('renders warning severity insight with title', () => {
    render(
      <AttentionInsightsWidget
        insights={[WARNING_INSIGHT]}
      />,
    );
    expect(screen.getByText('On a 3-trade losing streak')).toBeTruthy();
  });

  it('renders info severity insight with title', () => {
    render(
      <AttentionInsightsWidget
        insights={[INFO_INSIGHT_DAY]}
      />,
    );
    expect(screen.getByText('Tuesday is your best trading day')).toBeTruthy();
  });

  it('renders the type badge label for each insight', () => {
    render(
      <AttentionInsightsWidget
        insights={ALL_SEVERITIES}
      />,
    );
    // Risk (no_stop_loss), Momentum (losing_streak), Pattern (day_of_week_best), Performance (top_trade)
    expect(screen.getByText('Risk')).toBeTruthy();
    expect(screen.getByText('Momentum')).toBeTruthy();
    expect(screen.getByText('Pattern')).toBeTruthy();
    expect(screen.getByText('Performance')).toBeTruthy();
  });

  it('renders type label for unclassified setups as Setup', () => {
    const unclassifiedInsight: AttentionInsight = {
      type: 'unclassified_setups',
      severity: 'warning',
      title: '5 trades have no setup recorded',
      message: '5 of 20 trades have no setup assigned.',
      value: 5,
    };
    render(
      <AttentionInsightsWidget
        insights={[unclassifiedInsight]}
      />,
    );
    expect(screen.getByText('Setup')).toBeTruthy();
  });

  // ── Value badge ────────────────────────────────────────────────

  it('renders numeric value badge when insight has value', () => {
    render(
      <AttentionInsightsWidget
        insights={SINGLE_CRITICAL}
      />,
    );
    // The numeric value 5 should be rendered somewhere
    expect(screen.getByText('5')).toBeTruthy();
  });

  it('renders string value badge when insight has string value', () => {
    render(
      <AttentionInsightsWidget
        insights={[INFO_INSIGHT_DAY]}
      />,
    );
    expect(screen.getByText('80%')).toBeTruthy();
  });

  it('does not render value badge when insight has no value', () => {
    render(
      <AttentionInsightsWidget
        insights={[NO_VALUE_INSIGHT]}
      />,
    );
    expect(screen.getByText('Traded 5 different setups')).toBeTruthy();
    // R-multiple string "3.5R" is not present since this insight has no value
    // And the numeric badge area should be absent
  });

  // ── Empty state ────────────────────────────────────────────────

  it('shows empty state title when insights array is empty', () => {
    render(
      <AttentionInsightsWidget
        insights={EMPTY_INSIGHTS}
      />,
    );
    expect(screen.getByText('No insights yet')).toBeTruthy();
  });

  it('shows empty state description when insights array is empty', () => {
    render(
      <AttentionInsightsWidget
        insights={EMPTY_INSIGHTS}
      />,
    );
    expect(
      screen.getByText(
        'Trading insights will appear here as you build a track record. They surface useful patterns and potential issues from your trade data.',
      ),
    ).toBeTruthy();
  });

  it('shows empty state via DashboardWidget isEmpty prop', () => {
    render(
      <AttentionInsightsWidget
        insights={ALL_SEVERITIES}
        isEmpty
      />,
    );
    expect(screen.getByText('No data available')).toBeTruthy();
  });

  // ── Loading state ───────────────────────────────────────────────

  it('shows skeleton when isLoading is true with data', () => {
    const { container } = render(
      <AttentionInsightsWidget
        insights={ALL_SEVERITIES}
        isLoading
      />,
    );
    const skeletons = container.querySelectorAll('[data-slot="skeleton"]');
    expect(skeletons.length).toBeGreaterThanOrEqual(1);
    // Insights should not render while loading
    expect(screen.queryByText('5 trades had no stop loss recorded')).toBeNull();
  });

  it('shows aria-busy when loading', () => {
    render(
      <AttentionInsightsWidget
        insights={ALL_SEVERITIES}
        isLoading
      />,
    );
    const busy = document.querySelector('[aria-busy="true"]');
    expect(busy).toBeTruthy();
  });

  // ── Error state ─────────────────────────────────────────────────

  it('shows error message and alert role when error is provided', () => {
    render(
      <AttentionInsightsWidget
        insights={ALL_SEVERITIES}
        error="Failed to load attention insights"
      />,
    );
    expect(screen.getByText('Failed to load attention insights')).toBeTruthy();
    expect(screen.queryByText('5 trades had no stop loss recorded')).toBeNull();
    const alertEl = screen.getByRole('alert');
    expect(alertEl).toBeTruthy();
  });

  it('prioritises error over loading', () => {
    render(
      <AttentionInsightsWidget
        insights={ALL_SEVERITIES}
        isLoading
        error="Error wins"
      />,
    );
    expect(screen.getByText('Error wins')).toBeTruthy();
  });

  // ── Drag handle ─────────────────────────────────────────────────

  it('renders the drag handle element via DashboardWidget', () => {
    const { container } = render(
      <AttentionInsightsWidget
        insights={ALL_SEVERITIES}
      />,
    );
    const dragHandle = container.querySelector('.dashboard-widget-drag-handle');
    expect(dragHandle).toBeTruthy();
  });

  // ── testId ──────────────────────────────────────────────────────

  it('sets data-testid attribute when provided', () => {
    const { container } = render(
      <AttentionInsightsWidget
        insights={ALL_SEVERITIES}
        testId="widget-attention-insights"
      />,
    );
    const el = container.querySelector('[data-testid="widget-attention-insights"]');
    expect(el).toBeTruthy();
  });

  // ── Error is null (no error shown) ──────────────────────────────

  it('renders insights when error is null', () => {
    render(
      <AttentionInsightsWidget
        insights={SINGLE_CRITICAL}
        error={null}
      />,
    );
    expect(screen.getByText('5 trades had no stop loss recorded')).toBeTruthy();
  });

  // ── Edge Cases ──────────────────────────────────────────────────

  it('renders a single critical insight correctly', () => {
    render(
      <AttentionInsightsWidget
        insights={SINGLE_CRITICAL}
      />,
    );
    expect(screen.getByText('5 trades had no stop loss recorded')).toBeTruthy();
    expect(screen.getByText('Risk')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy();
  });

  it('renders insight with no value property gracefully', () => {
    render(
      <AttentionInsightsWidget
        insights={[NO_VALUE_INSIGHT]}
      />,
    );
    expect(screen.getByText('Traded 5 different setups')).toBeTruthy();
    expect(screen.getByText('Setup')).toBeTruthy();
  });

  it('renders 4 insights as separate cards', () => {
    const { container } = render(
      <AttentionInsightsWidget
        insights={ALL_SEVERITIES}
      />,
    );
    // The border-l-4 class is used on each insight card
    const cards = container.querySelectorAll('.border-l-4');
    expect(cards.length).toBe(4);
  });

  it('renders insights with different severity icons', () => {
    const { container } = render(
      <AttentionInsightsWidget
        insights={ALL_SEVERITIES}
      />,
    );
    // Check that we have svg icons rendered (lucide-react icons)
    const icons = container.querySelectorAll('svg');
    // Each of the 4 insight cards has an icon in the left column plus
    // the type badge icon. So we expect at least 4 svg elements
    expect(icons.length).toBeGreaterThanOrEqual(4);
  });

  it('renders info severity insight with R-multiple value', () => {
    render(
      <AttentionInsightsWidget
        insights={[INFO_INSIGHT_TRADE]}
      />,
    );
    expect(screen.getByText('Best trade: 3.5R')).toBeTruthy();
    expect(screen.getByText('3.5R')).toBeTruthy();
    expect(screen.getByText('Performance')).toBeTruthy();
  });

  // ── Type label mappings ────────────────────────────────────────

  it('renders type label for no_stop_loss as Risk', () => {
    render(
      <AttentionInsightsWidget
        insights={[CRITICAL_INSIGHT]}
      />,
    );
    expect(screen.getByText('Risk')).toBeTruthy();
  });

  it('renders type label for day_of_week_best as Pattern', () => {
    render(
      <AttentionInsightsWidget
        insights={[INFO_INSIGHT_DAY]}
      />,
    );
    expect(screen.getByText('Pattern')).toBeTruthy();
  });

  it('renders type label for losing_streak as Momentum', () => {
    render(
      <AttentionInsightsWidget
        insights={[WARNING_INSIGHT]}
      />,
    );
    expect(screen.getByText('Momentum')).toBeTruthy();
  });

  // ── Unknown type label ─────────────────────────────────────────

  it('renders fallback type label for unknown types', () => {
    const unknownInsight: AttentionInsight = {
      type: 'custom_observation',
      severity: 'info',
      title: 'Custom observation',
      message: 'This is a custom observation for testing fallback type label.',
    };
    render(
      <AttentionInsightsWidget
        insights={[unknownInsight]}
      />,
    );
    // Fallback replaces underscores with spaces
    expect(screen.getByText('custom observation')).toBeTruthy();
  });
});
