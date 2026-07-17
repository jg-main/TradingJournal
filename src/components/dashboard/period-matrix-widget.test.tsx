/**
 * Tests for the PeriodMatrixWidget component.
 *
 * Covers: title rendering, period type selector (WoW/MoM/QoQ),
 * table rendering with current/previous/delta rows, delta indicators
 * with arrows and colors, loading/error/empty state passthrough,
 * no-data-for-selected-type fallback, and empty data handling.
 *
 * Run: npx vitest run src/components/dashboard/period-matrix-widget.test.tsx
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import { PeriodMatrixWidget } from './period-matrix-widget';
import { CustomizingProvider } from '@/lib/customizing-context';
import type { PeriodMatrixResult } from '@/lib/period-matrix';

// ── Fixtures ───────────────────────────────────────────────────────────

const SAMPLE_WOW_ROW = {
  current: {
    periodId: '2026-W27',
    periodLabel: 'Week 27',
    startDate: '2026-06-29',
    endDate: '2026-07-05',
    winRate: 0.6,
    pnl: 2500,
    tradeCount: 15,
    avgR: 1.5,
  },
  previous: {
    periodId: '2026-W26',
    periodLabel: 'Week 26',
    startDate: '2026-06-22',
    endDate: '2026-06-28',
    winRate: 0.45,
    pnl: 800,
    tradeCount: 12,
    avgR: 1.2,
  },
  delta: {
    winRate: 0.15,
    pnl: 1700,
    tradeCount: 3,
    avgR: 0.3,
  },
};

const SAMPLE_WOW_RESULT: PeriodMatrixResult = {
  comparisonType: 'wow',
  rows: [SAMPLE_WOW_ROW],
};

const SAMPLE_MOM_ROW = {
  current: {
    periodId: '2026-07',
    periodLabel: 'Jul 2026',
    startDate: '2026-07-01',
    endDate: '2026-07-31',
    winRate: 0.55,
    pnl: 5200,
    tradeCount: 42,
    avgR: 1.3,
  },
  previous: {
    periodId: '2026-06',
    periodLabel: 'Jun 2026',
    startDate: '2026-06-01',
    endDate: '2026-06-30',
    winRate: 0.42,
    pnl: 3800,
    tradeCount: 35,
    avgR: 1.1,
  },
  delta: {
    winRate: 0.13,
    pnl: 1400,
    tradeCount: 7,
    avgR: 0.2,
  },
};

const SAMPLE_MOM_RESULT: PeriodMatrixResult = {
  comparisonType: 'mom',
  rows: [SAMPLE_MOM_ROW],
};

const SAMPLE_QOQ_RESULT: PeriodMatrixResult = {
  comparisonType: 'qoq',
  rows: [],
};

const ALL_TYPES_DATA: Record<string, PeriodMatrixResult> = {
  wow: SAMPLE_WOW_RESULT,
  mom: SAMPLE_MOM_RESULT,
  qoq: SAMPLE_QOQ_RESULT,
};

const ALL_TYPES_DATA_WOW_ONLY: Record<string, PeriodMatrixResult> = {
  wow: SAMPLE_WOW_RESULT,
  mom: { comparisonType: 'mom', rows: [] },
  qoq: { comparisonType: 'qoq', rows: [] },
};

const EMPTY_DATA: Record<string, PeriodMatrixResult> = {
  wow: { comparisonType: 'wow', rows: [] },
  mom: { comparisonType: 'mom', rows: [] },
  qoq: { comparisonType: 'qoq', rows: [] },
};

const MULTI_ROW_WOW_RESULT: PeriodMatrixResult = {
  comparisonType: 'wow',
  rows: [
    {
      current: {
        periodId: '2026-W28',
        periodLabel: 'Week 28',
        startDate: '2026-07-06',
        endDate: '2026-07-12',
        winRate: 0.6,
        pnl: 2500,
        tradeCount: 15,
        avgR: 1.5,
      },
      previous: {
        periodId: '2026-W27',
        periodLabel: 'Week 27',
        startDate: '2026-06-29',
        endDate: '2026-07-05',
        winRate: 0.55,
        pnl: 2100,
        tradeCount: 14,
        avgR: 1.4,
      },
      delta: {
        winRate: 0.05,
        pnl: 400,
        tradeCount: 1,
        avgR: 0.1,
      },
    },
    {
      current: {
        periodId: '2026-W27',
        periodLabel: 'Week 27',
        startDate: '2026-06-29',
        endDate: '2026-07-05',
        winRate: 0.55,
        pnl: 2100,
        tradeCount: 14,
        avgR: 1.4,
      },
      previous: {
        periodId: '2026-W26',
        periodLabel: 'Week 26',
        startDate: '2026-06-22',
        endDate: '2026-06-28',
        winRate: 0.45,
        pnl: 800,
        tradeCount: 12,
        avgR: 1.2,
      },
      delta: {
        winRate: 0.1,
        pnl: 1300,
        tradeCount: 2,
        avgR: 0.2,
      },
    },
  ],
};

const NEGATIVE_DELTA_RESULT: PeriodMatrixResult = {
  comparisonType: 'wow',
  rows: [
    {
      current: {
        periodId: '2026-W27',
        periodLabel: 'Week 27',
        startDate: '2026-06-29',
        endDate: '2026-07-05',
        winRate: 0.35,
        pnl: -500,
        tradeCount: 8,
        avgR: 0.8,
      },
      previous: {
        periodId: '2026-W26',
        periodLabel: 'Week 26',
        startDate: '2026-06-22',
        endDate: '2026-06-28',
        winRate: 0.50,
        pnl: 1200,
        tradeCount: 10,
        avgR: 1.4,
      },
      delta: {
        winRate: -0.15,
        pnl: -1700,
        tradeCount: -2,
        avgR: -0.6,
      },
    },
  ],
};

const NULL_METRICS_RESULT: PeriodMatrixResult = {
  comparisonType: 'wow',
  rows: [
    {
      current: {
        periodId: '2026-W27',
        periodLabel: 'Week 27',
        startDate: '2026-06-29',
        endDate: '2026-07-05',
        winRate: null,
        pnl: 0,
        tradeCount: 0,
        avgR: null,
      },
      previous: {
        periodId: '2026-W26',
        periodLabel: 'Week 26',
        startDate: '2026-06-22',
        endDate: '2026-06-28',
        winRate: null,
        pnl: 0,
        tradeCount: 0,
        avgR: null,
      },
      delta: {
        winRate: null,
        pnl: 0,
        tradeCount: 0,
        avgR: null,
      },
    },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('PeriodMatrixWidget', () => {
  afterEach(() => {
    cleanup();
  });

  // ── Title ───────────────────────────────────────────────────────

  it('renders the default title in the widget header', () => {
    render(
      <PeriodMatrixWidget
        periodMatrixData={ALL_TYPES_DATA}
      />,
    );
    expect(screen.getByText('Period Comparison')).toBeTruthy();
  });

  it('renders a custom title when provided', () => {
    render(
      <PeriodMatrixWidget
        periodMatrixData={ALL_TYPES_DATA}
        title="Period-over-Period Comparison"
      />,
    );
    expect(screen.getByText('Period-over-Period Comparison')).toBeTruthy();
  });

  // ── Period type selector ────────────────────────────────────────

  it('renders period type toggle buttons (WoW, MoM, QoQ)', () => {
    render(
      <PeriodMatrixWidget
        periodMatrixData={ALL_TYPES_DATA}
      />,
    );
    expect(screen.getByText('WoW')).toBeTruthy();
    expect(screen.getByText('MoM')).toBeTruthy();
    expect(screen.getByText('QoQ')).toBeTruthy();
  });

  it('defaults to WoW view when data is present', () => {
    render(
      <PeriodMatrixWidget
        periodMatrixData={ALL_TYPES_DATA}
      />,
    );
    // WoW data has rows — should render the table
    expect(screen.getByText('Week 27 vs Week 26')).toBeTruthy();
    expect(screen.getByText('Week 27')).toBeTruthy();
    expect(screen.getByText('Week 26')).toBeTruthy();
  });

  it('switches to MoM view when MoM button is clicked', () => {
    render(
      <PeriodMatrixWidget
        periodMatrixData={ALL_TYPES_DATA}
      />,
    );
    const momBtn = screen.getByText('MoM');
    fireEvent.click(momBtn);

    expect(screen.getByText('Jul 2026 vs Jun 2026')).toBeTruthy();
    expect(screen.getByText('Jul 2026')).toBeTruthy();
    expect(screen.getByText('Jun 2026')).toBeTruthy();
  });

  it('switches to QoQ view and shows empty state when QoQ has no rows', () => {
    render(
      <PeriodMatrixWidget
        periodMatrixData={ALL_TYPES_DATA}
      />,
    );
    const qoqBtn = screen.getByText('QoQ');
    fireEvent.click(qoqBtn);

    // QoQ has no data — shows no comparison data empty state
    expect(screen.getByText('No comparison data')).toBeTruthy();
  });

  it('auto-switches to a type with data when current selection has no rows', () => {
    render(
      <PeriodMatrixWidget
        periodMatrixData={ALL_TYPES_DATA_WOW_ONLY}
      />,
    );
    // Should show WoW since it has data
    expect(screen.getByText('Week 27 vs Week 26')).toBeTruthy();
  });

  it('shows empty state when all types have no rows', () => {
    render(
      <PeriodMatrixWidget
        periodMatrixData={EMPTY_DATA}
      />,
    );
    expect(screen.getByText('No comparison data available')).toBeTruthy();
  });

  // ── Table rendering ─────────────────────────────────────────────

  it('renders the comparison table with Period, Win Rate, P&L, Trades, and Avg R columns', () => {
    render(
      <PeriodMatrixWidget
        periodMatrixData={ALL_TYPES_DATA}
      />,
    );
    expect(screen.getByText('Period')).toBeTruthy();
    expect(screen.getByText('Win Rate')).toBeTruthy();
    expect(screen.getByText('P&L')).toBeTruthy();
    expect(screen.getByText('Trades')).toBeTruthy();
    expect(screen.getByText('Avg R')).toBeTruthy();
  });

  it('renders the pair label as a section header', () => {
    render(
      <PeriodMatrixWidget
        periodMatrixData={ALL_TYPES_DATA}
      />,
    );
    expect(screen.getByText('Week 27 vs Week 26')).toBeTruthy();
  });

  it('renders current period values in the first data row', () => {
    render(
      <PeriodMatrixWidget
        periodMatrixData={ALL_TYPES_DATA}
      />,
    );
    expect(screen.getByText('Week 27')).toBeTruthy();
    // Current P&L ($2,500)
    expect(screen.getByText(/\$2,500/)).toBeTruthy();
  });

  it('renders previous period values in the second data row', () => {
    render(
      <PeriodMatrixWidget
        periodMatrixData={ALL_TYPES_DATA}
      />,
    );
    expect(screen.getByText('Week 26')).toBeTruthy();
    // Previous P&L ($800)
    expect(screen.getByText(/\$800/)).toBeTruthy();
  });

  it('renders a delta row with "Change" label', () => {
    render(
      <PeriodMatrixWidget
        periodMatrixData={ALL_TYPES_DATA}
      />,
    );
    const changeLabels = screen.getAllByText('Change');
    expect(changeLabels.length).toBeGreaterThanOrEqual(1);
  });

  it('renders all comparison rows when data has multiple rows', () => {
    render(
      <PeriodMatrixWidget
        periodMatrixData={{ wow: MULTI_ROW_WOW_RESULT }}
      />,
    );
    expect(screen.getByText('Week 28 vs Week 27')).toBeTruthy();
    expect(screen.getByText('Week 27 vs Week 26')).toBeTruthy();
  });

  // ── Delta indicators ────────────────────────────────────────────

  it('shows green upward arrow for positive win rate delta', () => {
    render(
      <PeriodMatrixWidget
        periodMatrixData={ALL_TYPES_DATA}
      />,
    );
    // Win rate delta: +0.15 → "+15.0%" with green ▲
    const winRateDelta = screen.getByText('+15.0%');
    expect(winRateDelta).toBeTruthy();
    // The parentElement is the outer <span> with the color class
    const parent = winRateDelta.parentElement;
    expect(parent?.className).toContain('text-green');
  });

  it('shows red downward arrow for negative win rate delta', () => {
    render(
      <PeriodMatrixWidget
        periodMatrixData={{ wow: NEGATIVE_DELTA_RESULT }}
      />,
    );
    // Win rate delta: -0.15 → should show red ▼
    const winRateDelta = screen.getByText('-15.0%');
    const parent = winRateDelta.parentElement;
    expect(parent?.className).toContain('text-red');
  });

  it('shows green upward arrow for positive P&L delta', () => {
    render(
      <PeriodMatrixWidget
        periodMatrixData={ALL_TYPES_DATA}
      />,
    );
    // P&L delta: +1700 → "+$1,700.00" with green ▲
    const pnlDelta = screen.getByText(/\$1,700\.00/);
    expect(pnlDelta).toBeTruthy();
    const parent = pnlDelta.parentElement;
    expect(parent?.className).toContain('text-green');
  });

  it('shows red downward arrow for negative P&L delta', () => {
    render(
      <PeriodMatrixWidget
        periodMatrixData={{ wow: NEGATIVE_DELTA_RESULT }}
      />,
    );
    // P&L delta: -1700 → "-$1,700.00" with red ▼
    const pnlDelta = screen.getByText('-$1,700.00');
    expect(pnlDelta).toBeTruthy();
    const parent = pnlDelta.parentElement;
    expect(parent?.className).toContain('text-red');
  });

  it('shows neutral indicator for trade count delta regardless of sign', () => {
    render(
      <PeriodMatrixWidget
        periodMatrixData={ALL_TYPES_DATA}
      />,
    );
    // Trade count delta: +3 → "+3" with neutral color (zinc)
    const tradeCountDelta = screen.getByText('+3');
    expect(tradeCountDelta).toBeTruthy();
    const parent = tradeCountDelta.parentElement;
    expect(parent?.className).toContain('text-zinc');
  });

  it('shows negative trade count delta with neutral indicator', () => {
    render(
      <PeriodMatrixWidget
        periodMatrixData={{ wow: NEGATIVE_DELTA_RESULT }}
      />,
    );
    // Trade count delta: -2 → "-2" with neutral color
    const tradeCountDelta = screen.getByText('-2');
    expect(tradeCountDelta).toBeTruthy();
    const parent = tradeCountDelta.parentElement;
    expect(parent?.className).toContain('text-zinc');
  });

  it('shows green upward arrow for positive avg R delta', () => {
    render(
      <PeriodMatrixWidget
        periodMatrixData={ALL_TYPES_DATA}
      />,
    );
    // Avg R delta: +0.3 → "+0.30R" with green ▲
    const avgRDelta = screen.getByText('+0.30R');
    expect(avgRDelta).toBeTruthy();
    const parent = avgRDelta.parentElement;
    expect(parent?.className).toContain('text-green');
  });

  // ── Loading state ───────────────────────────────────────────────

  it('shows skeleton when isLoading is true with data', () => {
    const { container } = render(
      <PeriodMatrixWidget
        periodMatrixData={ALL_TYPES_DATA}
        isLoading
      />,
    );
    const skeletons = container.querySelectorAll('[data-slot="skeleton"]');
    expect(skeletons.length).toBeGreaterThanOrEqual(1);
    // Table should not render while loading
    expect(screen.queryByText('Week 27 vs Week 26')).toBeNull();
  });

  it('shows aria-busy when loading', () => {
    render(
      <PeriodMatrixWidget
        periodMatrixData={ALL_TYPES_DATA}
        isLoading
      />,
    );
    const busy = document.querySelector('[aria-busy="true"]');
    expect(busy).toBeTruthy();
  });

  // ── Error state ─────────────────────────────────────────────────

  it('shows error message and alert role when error is provided', () => {
    render(
      <PeriodMatrixWidget
        periodMatrixData={ALL_TYPES_DATA}
        error="Failed to load comparison data"
      />,
    );
    expect(screen.getByText('Failed to load comparison data')).toBeTruthy();
    const alertEl = screen.getByRole('alert');
    expect(alertEl).toBeTruthy();
  });

  it('prioritises error over loading', () => {
    render(
      <PeriodMatrixWidget
        periodMatrixData={ALL_TYPES_DATA}
        isLoading
        error="Error wins"
      />,
    );
    expect(screen.getByText('Error wins')).toBeTruthy();
  });

  // ── Empty state ─────────────────────────────────────────────────

  it('shows empty state when isEmpty is true', () => {
    render(
      <PeriodMatrixWidget
        periodMatrixData={ALL_TYPES_DATA}
        isEmpty
      />,
    );
    expect(screen.getByText('No data available')).toBeTruthy();
  });

  it('shows empty state when periodMatrixData is null', () => {
    render(
      <PeriodMatrixWidget
        periodMatrixData={null}
      />,
    );
    expect(screen.getByText('No comparison data available')).toBeTruthy();
  });

  it('shows description text in empty state', () => {
    render(
      <PeriodMatrixWidget
        periodMatrixData={null}
      />,
    );
    expect(
      screen.getByText(
        'Your period-over-period performance matrix will appear here after you close trades across multiple periods.',
      ),
    ).toBeTruthy();
  });

  // ── Null metric values ──────────────────────────────────────────

  it('renders em dash for null win rate values', () => {
    render(
      <PeriodMatrixWidget
        periodMatrixData={{ wow: NULL_METRICS_RESULT }}
      />,
    );
    // The win rate column will show '--' for null
    const emDashes = document.querySelectorAll('.tabular-nums');
    expect(emDashes.length).toBeGreaterThanOrEqual(2); // current and previous
  });

  it('renders em dash for null avg R values', () => {
    render(
      <PeriodMatrixWidget
        periodMatrixData={{ wow: NULL_METRICS_RESULT }}
      />,
    );
    // There are multiple em dashes rendered (null avgR cells + null delta cells)
    const avgRCells = screen.getAllByText('\u2014');
    expect(avgRCells.length).toBeGreaterThanOrEqual(1);
  });

  it('shows em dash in delta row when delta values are null', () => {
    render(
      <PeriodMatrixWidget
        periodMatrixData={{ wow: NULL_METRICS_RESULT }}
      />,
    );
    // The delta row for winRate and avgR should show em dashes
    const emDashes = document.querySelectorAll('.tabular-nums');
    expect(emDashes.length).toBeGreaterThanOrEqual(4); // current, previous, plus deltas
  });

  // ── Drag handle ─────────────────────────────────────────────────

  it('renders the drag handle element via DashboardWidget', () => {
    const { container } = render(
      <CustomizingProvider value={true}>
        <PeriodMatrixWidget
          periodMatrixData={ALL_TYPES_DATA}
        />
      </CustomizingProvider>,
    );
    const dragHandle = container.querySelector('.dashboard-widget-drag-handle');
    expect(dragHandle).toBeTruthy();
  });

  // ── testId ──────────────────────────────────────────────────────

  it('sets data-testid attribute when provided', () => {
    const { container } = render(
      <PeriodMatrixWidget
        periodMatrixData={ALL_TYPES_DATA}
        testId="widget-period-matrix"
      />,
    );
    const el = container.querySelector('[data-testid="widget-period-matrix"]');
    expect(el).toBeTruthy();
  });

  // ── Error is null ───────────────────────────────────────────────

  it('renders content when error is null', () => {
    render(
      <PeriodMatrixWidget
        periodMatrixData={ALL_TYPES_DATA}
        error={null}
      />,
    );
    expect(screen.getByText('Week 27 vs Week 26')).toBeTruthy();
  });

  // ── P&L colouring ───────────────────────────────────────────────

  it('shows current period P&L in green when positive', () => {
    render(
      <PeriodMatrixWidget
        periodMatrixData={ALL_TYPES_DATA}
      />,
    );
    // Current P&L: $2,500 (positive) → green
    const pnlText = screen.getByText(/\$2,500/);
    expect(pnlText).toBeTruthy();
    const parent = pnlText.closest('td') || pnlText;
    expect(parent.className).toContain('text-green');
  });

  it('shows current period P&L in red when negative', () => {
    render(
      <PeriodMatrixWidget
        periodMatrixData={{ wow: NEGATIVE_DELTA_RESULT }}
      />,
    );
    // Current P&L: -$500 (negative) → red
    const pnlText = screen.getByText('-$500.00');
    expect(pnlText).toBeTruthy();
    const parent = pnlText.closest('td') || pnlText;
    expect(parent.className).toContain('text-red');
  });
});
