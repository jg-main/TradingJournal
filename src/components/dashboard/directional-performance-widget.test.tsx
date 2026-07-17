/**
 * Tests for the DirectionalPerformanceWidget component.
 *
 * Covers: title rendering, loading/error/empty state passthrough,
 * long/short metric rendering (P&L, Win Rate, Trade Count), P&L colour
 * classes, null directionalPerformance fallback.
 *
 * Run: npx vitest run src/components/dashboard/directional-performance-widget.test.tsx
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { DirectionalPerformanceWidget } from './directional-performance-widget';
import type { DirectionalPerformanceResult } from '@/lib/dashboard';

// ── Fixtures ───────────────────────────────────────────────────────────

const SAMPLE_DIRECTIONAL: DirectionalPerformanceResult = {
  long: { netPnl: 1500, winRate: 0.6, tradeCount: 25 },
  short: { netPnl: -300, winRate: 0.45, tradeCount: 10 },
};

const ZERO_PNL_DIRECTIONAL: DirectionalPerformanceResult = {
  long: { netPnl: 0, winRate: 0.5, tradeCount: 5 },
  short: { netPnl: 0, winRate: 0.5, tradeCount: 3 },
};

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('DirectionalPerformanceWidget', () => {
  afterEach(() => {
    cleanup();
  });

  // ── Title ───────────────────────────────────────────────────────

  it('renders the default title in the widget header', () => {
    render(
      <DirectionalPerformanceWidget
        directionalPerformance={SAMPLE_DIRECTIONAL}
      />,
    );
    expect(screen.getByText('Directional Performance')).toBeTruthy();
  });

  it('renders a custom title when provided', () => {
    render(
      <DirectionalPerformanceWidget
        directionalPerformance={SAMPLE_DIRECTIONAL}
        title="Long/Short Breakdown"
      />,
    );
    expect(screen.getByText('Long/Short Breakdown')).toBeTruthy();
  });

  // ── Long/short rendering ────────────────────────────────────────

  it('renders Long and Short section labels', () => {
    render(
      <DirectionalPerformanceWidget
        directionalPerformance={SAMPLE_DIRECTIONAL}
      />,
    );
    expect(screen.getByText('Long')).toBeTruthy();
    expect(screen.getByText('Short')).toBeTruthy();
  });

  it('renders P&L, Win Rate, and Trades labels for both directions', () => {
    render(
      <DirectionalPerformanceWidget
        directionalPerformance={SAMPLE_DIRECTIONAL}
      />,
    );
    // Each direction has P&L, Win Rate, Trades labels
    const pnlLabels = screen.getAllByText('P&L');
    expect(pnlLabels).toHaveLength(2);
    const wrLabels = screen.getAllByText('Win Rate');
    expect(wrLabels).toHaveLength(2);
    const tradesLabels = screen.getAllByText('Trades');
    expect(tradesLabels).toHaveLength(2);
  });

  it('renders formatted P&L values for long and short', () => {
    render(
      <DirectionalPerformanceWidget
        directionalPerformance={SAMPLE_DIRECTIONAL}
      />,
    );
    // Long: +$1,500.00 (positive with signDisplay exceptZero), Short: -$300.00
    expect(screen.getByText('+$1,500.00')).toBeTruthy();
    expect(screen.getByText('-$300.00')).toBeTruthy();
  });

  it('renders formatted win rate percentages', () => {
    render(
      <DirectionalPerformanceWidget
        directionalPerformance={SAMPLE_DIRECTIONAL}
      />,
    );
    expect(screen.getByText('60.0%')).toBeTruthy();
    expect(screen.getByText('45.0%')).toBeTruthy();
  });

  it('renders trade counts', () => {
    render(
      <DirectionalPerformanceWidget
        directionalPerformance={SAMPLE_DIRECTIONAL}
      />,
    );
    expect(screen.getByText('25')).toBeTruthy();
    expect(screen.getByText('10')).toBeTruthy();
  });

  it('renders positive P&L without red colour class', () => {
    const { container } = render(
      <DirectionalPerformanceWidget
        directionalPerformance={SAMPLE_DIRECTIONAL}
      />,
    );
    // Long P&L value (+$1,500.00) should have text-zinc-700 class (positive)
    const longPnl = screen.getByText('+$1,500.00');
    expect(longPnl.className).toContain('text-zinc-700');
    expect(longPnl.className).toContain('dark:text-zinc-300');
  });

  it('renders negative P&L with red colour class', () => {
    const { container } = render(
      <DirectionalPerformanceWidget
        directionalPerformance={SAMPLE_DIRECTIONAL}
      />,
    );
    // Short P&L value (-$300) should have text-red-600 class (negative)
    const shortPnl = screen.getByText('-$300.00');
    expect(shortPnl.className).toContain('text-red-600');
    expect(shortPnl.className).toContain('dark:text-red-400');
  });

  it('renders zero P&L without colour class emphasis', () => {
    render(
      <DirectionalPerformanceWidget
        directionalPerformance={ZERO_PNL_DIRECTIONAL}
      />,
    );
    // $0.00 with signDisplay 'exceptZero' renders as '$0.00' (no sign for zero)
    const zeroPnl = screen.getAllByText('$0.00');
    expect(zeroPnl).toHaveLength(2);
    // $0.00 should not have red colour class
    zeroPnl.forEach((el) => {
      expect(el.className).not.toContain('text-red-600');
    });
  });

  // ── Loading state ───────────────────────────────────────────────

  it('shows skeleton when isLoading is true with data', () => {
    const { container } = render(
      <DirectionalPerformanceWidget
        directionalPerformance={SAMPLE_DIRECTIONAL}
        isLoading
      />,
    );
    const skeletons = container.querySelectorAll('[data-slot="skeleton"]');
    expect(skeletons.length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Long')).toBeNull();
  });

  it('shows aria-busy when loading', () => {
    render(
      <DirectionalPerformanceWidget
        directionalPerformance={SAMPLE_DIRECTIONAL}
        isLoading
      />,
    );
    const busy = document.querySelector('[aria-busy="true"]');
    expect(busy).toBeTruthy();
  });

  // ── Error state ─────────────────────────────────────────────────

  it('shows error message and alert role when error is provided', () => {
    render(
      <DirectionalPerformanceWidget
        directionalPerformance={SAMPLE_DIRECTIONAL}
        error="Failed to load directional data"
      />,
    );
    expect(screen.getByText('Failed to load directional data')).toBeTruthy();
    expect(screen.queryByText('Long')).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('prioritises error over loading', () => {
    render(
      <DirectionalPerformanceWidget
        directionalPerformance={SAMPLE_DIRECTIONAL}
        isLoading
        error="Error wins"
      />,
    );
    expect(screen.getByText('Error wins')).toBeTruthy();
  });

  // ── Empty state ─────────────────────────────────────────────────

  it('shows empty state when isEmpty is true', () => {
    render(
      <DirectionalPerformanceWidget
        directionalPerformance={SAMPLE_DIRECTIONAL}
        isEmpty
      />,
    );
    expect(screen.getByText('No data available')).toBeTruthy();
  });

  it('shows EmptyState when directionalPerformance is null', () => {
    render(
      <DirectionalPerformanceWidget
        directionalPerformance={null}
      />,
    );
    expect(screen.getByText('No directional data')).toBeTruthy();
    expect(screen.queryByText('Long')).toBeNull();
  });

  it('shows empty state description when no data', () => {
    render(
      <DirectionalPerformanceWidget
        directionalPerformance={null}
      />,
    );
    expect(
      screen.getByText(
        'Long/short performance breakdown will appear after you close trades in both directions.',
      ),
    ).toBeTruthy();
  });

  // ── Drag handle ─────────────────────────────────────────────────

  it('renders the drag handle element via DashboardWidget', () => {
    const { container } = render(
      <DirectionalPerformanceWidget
        directionalPerformance={SAMPLE_DIRECTIONAL}
      />,
    );
    const dragHandle = container.querySelector('.dashboard-widget-drag-handle');
    expect(dragHandle).toBeTruthy();
  });

  // ── testId ──────────────────────────────────────────────────────

  it('sets data-testid attribute when provided', () => {
    const { container } = render(
      <DirectionalPerformanceWidget
        directionalPerformance={SAMPLE_DIRECTIONAL}
        testId="widget-directional-performance"
      />,
    );
    const el = container.querySelector('[data-testid="widget-directional-performance"]');
    expect(el).toBeTruthy();
  });

  // ── Grid layout ─────────────────────────────────────────────────

  it('renders with sm:grid-cols-2 grid layout', () => {
    const { container } = render(
      <DirectionalPerformanceWidget
        directionalPerformance={SAMPLE_DIRECTIONAL}
      />,
    );
    // The content div should have the grid classes
    const grid = container.querySelector('.sm\\:grid-cols-2');
    expect(grid).toBeTruthy();
  });
});
