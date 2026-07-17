/**
 * Tests for KPI metric widget components.
 *
 * Covers: title rendering, loading/error/empty state passthrough,
 * individual metric display, hierarchy constants, default layout,
 * and widget map completeness.
 *
 * Run: npx vitest run src/components/dashboard/kpi-widgets.test.tsx
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  NetPnlWidget,
  TotalTradesWidget,
  WinRateWidget,
  AvgRWidget,
  AvgGradeWidget,
  ProfitFactorWidget,
  AvgWinWidget,
  AvgLossWidget,
  CurrentDrawdownWidget,
  AccountValueWidget,
  UnrealizedPnlWidget,
  KpiSectionHeader,
  WIDGET_IDS,
  PTD_WIDGET_IDS,
  CURRENT_STATE_WIDGET_IDS,
  ALL_KPI_WIDGET_IDS,
  DEFAULT_KPI_LAYOUT,
  SECTION_TINTS,
  KPI_WIDGET_MAP,
} from './kpi-widgets';
import type { KpiMetrics } from './kpi-widgets';
import type { MtmData } from './kpi-widgets';

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

function renderWithTooltip(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

describe('WIDGET_IDS', () => {
  it('defines all 11 KPI metric IDs', () => {
    const ids = Object.values(WIDGET_IDS);
    expect(ids).toHaveLength(11);
    expect(ids).toContain('net-pnl');
    expect(ids).toContain('total-trades');
    expect(ids).toContain('win-rate');
    expect(ids).toContain('avg-r');
    expect(ids).toContain('avg-grade');
    expect(ids).toContain('profit-factor');
    expect(ids).toContain('avg-win');
    expect(ids).toContain('avg-loss');
    expect(ids).toContain('account-value');
    expect(ids).toContain('current-drawdown');
    expect(ids).toContain('unrealized-pnl');
  });
});

describe('PTD_WIDGET_IDS', () => {
  it('has 8 period-to-date metrics', () => {
    expect(PTD_WIDGET_IDS).toHaveLength(8);
  });
});

describe('CURRENT_STATE_WIDGET_IDS', () => {
  it('has 3 current-state metrics', () => {
    expect(CURRENT_STATE_WIDGET_IDS).toHaveLength(3);
  });
});

describe('ALL_KPI_WIDGET_IDS', () => {
  it('has 11 total widget IDs in display order', () => {
    expect(ALL_KPI_WIDGET_IDS).toHaveLength(11);
    // PTD first, then current-state
    expect(ALL_KPI_WIDGET_IDS[0]).toBe('net-pnl');
    expect(ALL_KPI_WIDGET_IDS[8]).toBe('account-value');
  });
});

describe('DEFAULT_KPI_LAYOUT', () => {
  it('has layout entries for all 11 KPI widgets', () => {
    expect(DEFAULT_KPI_LAYOUT).toHaveLength(11);
  });

  it('each layout item has minW and minH', () => {
    for (const item of DEFAULT_KPI_LAYOUT) {
      expect(item.minW).toBeTypeOf('number');
      expect(item.minH).toBeTypeOf('number');
    }
  });

  it('layout items use WIDGET_IDS values', () => {
    const layoutIds = new Set(DEFAULT_KPI_LAYOUT.map((l) => l.i));
    for (const id of Object.values(WIDGET_IDS)) {
      expect(layoutIds.has(id)).toBe(true);
    }
  });
});

describe('SECTION_TINTS', () => {
  it('defines PTD and CURRENT tints', () => {
    expect(SECTION_TINTS.PTD).toContain('blue');
    expect(SECTION_TINTS.CURRENT).toContain('amber');
  });
});

describe('KPI_WIDGET_MAP', () => {
  it('has entries for all widget IDs', () => {
    const mapKeys = Object.keys(KPI_WIDGET_MAP);
    expect(mapKeys).toHaveLength(11);
    for (const id of Object.values(WIDGET_IDS)) {
      expect(mapKeys).toContain(id);
    }
  });

  it('maps each ID to a React component', () => {
    for (const Component of Object.values(KPI_WIDGET_MAP)) {
      expect(Component).toBeTypeOf('function');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// KpiSectionHeader
// ═══════════════════════════════════════════════════════════════════════════

describe('KpiSectionHeader', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the title', () => {
    render(<KpiSectionHeader title="Period-to-Date" />);
    expect(screen.getByText('Period-to-Date')).toBeTruthy();
  });

  it('renders description when provided', () => {
    render(
      <KpiSectionHeader
        title="PTD"
        description="Metrics from closed trades"
      />,
    );
    expect(screen.getByText('Metrics from closed trades')).toBeTruthy();
  });

  it('does not render description when omitted', () => {
    const { container } = render(<KpiSectionHeader title="PTD" />);
    const desc = container.querySelector('.text-sm');
    // Should only be the title, no description paragraph
    expect(desc).toBeNull();
  });

  it('applies tint class when provided', () => {
    const { container } = render(
      <KpiSectionHeader title="PTD" tint="bg-blue-50/40" />,
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper?.classList.contains('bg-blue-50/40')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Widget: NetPnlWidget
// ═══════════════════════════════════════════════════════════════════════════

describe('NetPnlWidget', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders title in card-title', () => {
    const { container } = renderWithTooltip(<NetPnlWidget kpis={SAMPLE_KPIS} />);
    const title = container.querySelector('[data-slot="card-title"]');
    expect(title?.textContent).toContain('Net P&L');
  });

  it('renders formatted net P&L value', () => {
    renderWithTooltip(<NetPnlWidget kpis={SAMPLE_KPIS} />);
    // 2500 formatted as currency
    expect(screen.getByText(/\$2,500/)).toBeTruthy();
  });

  it('shows aria-busy when loading (skeleton)', () => {
    renderWithTooltip(<NetPnlWidget kpis={null} isLoading />);
    const busyEl = document.querySelector('[aria-busy="true"]');
    expect(busyEl).toBeTruthy();
  });

  it('shows error when error prop is set', () => {
    renderWithTooltip(
      <NetPnlWidget kpis={SAMPLE_KPIS} error="Failed to load" />,
    );
    expect(screen.getByText('Failed to load')).toBeTruthy();
  });
});

// ── TotalTradesWidget ──────────────────────────────────────────────

describe('TotalTradesWidget', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders title in card-title', () => {
    const { container } = renderWithTooltip(<TotalTradesWidget kpis={SAMPLE_KPIS} />);
    const title = container.querySelector('[data-slot="card-title"]');
    expect(title?.textContent).toContain('Total Trades');
  });

  it('renders total trade count', () => {
    renderWithTooltip(<TotalTradesWidget kpis={SAMPLE_KPIS} />);
    expect(screen.getByText('42')).toBeTruthy();
  });
});

// ── WinRateWidget ──────────────────────────────────────────────────

describe('WinRateWidget', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders title in card-title', () => {
    const { container } = renderWithTooltip(<WinRateWidget kpis={SAMPLE_KPIS} />);
    const title = container.querySelector('[data-slot="card-title"]');
    expect(title?.textContent).toContain('Win Rate');
  });

  it('renders win rate as percentage', () => {
    renderWithTooltip(<WinRateWidget kpis={SAMPLE_KPIS} />);
    // 0.55 → 55.0%
    expect(screen.getByText('55.0%')).toBeTruthy();
  });

  it('renders -- when win rate is null', () => {
    renderWithTooltip(<WinRateWidget kpis={NULL_KPIS} />);
    expect(screen.getByText('--')).toBeTruthy();
  });
});

// ── AvgRWidget ─────────────────────────────────────────────────────

describe('AvgRWidget', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders title in card-title', () => {
    const { container } = renderWithTooltip(<AvgRWidget kpis={SAMPLE_KPIS} />);
    const title = container.querySelector('[data-slot="card-title"]');
    expect(title?.textContent).toContain('Avg R');
  });

  it('renders avg R as decimal', () => {
    renderWithTooltip(<AvgRWidget kpis={SAMPLE_KPIS} />);
    expect(screen.getByText('1.80')).toBeTruthy();
  });

  it('renders -- when avg R is null', () => {
    renderWithTooltip(<AvgRWidget kpis={NULL_KPIS} />);
    expect(screen.getByText('--')).toBeTruthy();
  });
});

// ── AvgGradeWidget ─────────────────────────────────────────────────

describe('AvgGradeWidget', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders title in card-title', () => {
    const { container } = renderWithTooltip(<AvgGradeWidget kpis={SAMPLE_KPIS} />);
    const title = container.querySelector('[data-slot="card-title"]');
    expect(title?.textContent).toContain('Avg Grade');
  });

  it('renders grade score with letter', () => {
    renderWithTooltip(<AvgGradeWidget kpis={SAMPLE_KPIS} />);
    // 48 → 48.00 (B)
    expect(screen.getByText('48.00 (B)')).toBeTruthy();
  });

  it('renders -- when avg grade is null', () => {
    renderWithTooltip(<AvgGradeWidget kpis={NULL_KPIS} />);
    expect(screen.getByText('--')).toBeTruthy();
  });
});

// ── ProfitFactorWidget ─────────────────────────────────────────────

describe('ProfitFactorWidget', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders title in card-title', () => {
    const { container } = renderWithTooltip(<ProfitFactorWidget kpis={SAMPLE_KPIS} />);
    const title = container.querySelector('[data-slot="card-title"]');
    expect(title?.textContent).toContain('Profit Factor');
  });

  it('renders profit factor as decimal', () => {
    renderWithTooltip(<ProfitFactorWidget kpis={SAMPLE_KPIS} />);
    expect(screen.getByText('1.75')).toBeTruthy();
  });

  it('renders -- when profit factor is null', () => {
    renderWithTooltip(<ProfitFactorWidget kpis={NULL_KPIS} />);
    expect(screen.getByText('--')).toBeTruthy();
  });
});

// ── AvgWinWidget ───────────────────────────────────────────────────

describe('AvgWinWidget', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders title in card-title', () => {
    const { container } = renderWithTooltip(<AvgWinWidget kpis={SAMPLE_KPIS} />);
    const title = container.querySelector('[data-slot="card-title"]');
    expect(title?.textContent).toContain('Avg Win');
  });

  it('renders avg win as currency', () => {
    renderWithTooltip(<AvgWinWidget kpis={SAMPLE_KPIS} />);
    expect(screen.getByText(/\$350/)).toBeTruthy();
  });

  it('renders -- when avg win is null', () => {
    renderWithTooltip(<AvgWinWidget kpis={NULL_KPIS} />);
    expect(screen.getByText('--')).toBeTruthy();
  });
});

// ── AvgLossWidget ──────────────────────────────────────────────────

describe('AvgLossWidget', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders title in card-title', () => {
    const { container } = renderWithTooltip(<AvgLossWidget kpis={SAMPLE_KPIS} />);
    const title = container.querySelector('[data-slot="card-title"]');
    expect(title?.textContent).toContain('Avg Loss');
  });

  it('renders avg loss as currency', () => {
    renderWithTooltip(<AvgLossWidget kpis={SAMPLE_KPIS} />);
    expect(screen.getByText(/\$200/)).toBeTruthy();
  });

  it('renders -- when avg loss is null', () => {
    renderWithTooltip(<AvgLossWidget kpis={NULL_KPIS} />);
    expect(screen.getByText('--')).toBeTruthy();
  });
});

// ── CurrentDrawdownWidget ──────────────────────────────────────────

describe('CurrentDrawdownWidget', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders title in card-title', () => {
    const { container } = renderWithTooltip(<CurrentDrawdownWidget kpis={SAMPLE_KPIS} />);
    const title = container.querySelector('[data-slot="card-title"]');
    expect(title?.textContent).toContain('Current Drawdown');
  });

  it('renders drawdown with absolute value and percentage', () => {
    renderWithTooltip(<CurrentDrawdownWidget kpis={SAMPLE_KPIS} />);
    // -500 → $500.00 (-5.0%)
    const text = screen.getByText(/500/);
    expect(text).toBeTruthy();
  });

  it('renders -- when drawdown is null', () => {
    renderWithTooltip(<CurrentDrawdownWidget kpis={NULL_KPIS} />);
    expect(screen.getByText('--')).toBeTruthy();
  });
});

// ── AccountValueWidget ─────────────────────────────────────────────

describe('AccountValueWidget', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders title in card-title', () => {
    const { container } = renderWithTooltip(<AccountValueWidget kpis={SAMPLE_KPIS} />);
    const title = container.querySelector('[data-slot="card-title"]');
    expect(title?.textContent).toContain('Account Value');
  });

  it('renders account value as currency', () => {
    renderWithTooltip(<AccountValueWidget kpis={SAMPLE_KPIS} />);
    expect(screen.getByText(/\$25,000/)).toBeTruthy();
  });

  it('renders -- when account value is null', () => {
    renderWithTooltip(<AccountValueWidget kpis={NULL_KPIS} />);
    expect(screen.getByText('--')).toBeTruthy();
  });
});

// ── UnrealizedPnlWidget ────────────────────────────────────────────

describe('UnrealizedPnlWidget', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders title in card-title', () => {
    const { container } = renderWithTooltip(
      <UnrealizedPnlWidget kpis={SAMPLE_KPIS} mtm={SAMPLE_MTM} />,
    );
    const title = container.querySelector('[data-slot="card-title"]');
    expect(title?.textContent).toContain('Unrealized P&L');
  });

  it('renders unrealized P&L as currency with sign', () => {
    renderWithTooltip(
      <UnrealizedPnlWidget kpis={SAMPLE_KPIS} mtm={SAMPLE_MTM} />,
    );
    // 150 with sign
    expect(screen.getByText(/\$150/)).toBeTruthy();
  });

  it('shows "Awaiting prices" when mtm has open trades but no pnl', () => {
    renderWithTooltip(
      <UnrealizedPnlWidget kpis={SAMPLE_KPIS} mtm={NULL_MTM} />,
    );
    expect(screen.getByText('Awaiting prices')).toBeTruthy();
  });

  it('shows "No open positions" when mtm has no open trades and no pnl', () => {
    const emptyMtm: MtmData = {
      netUnrealizedPnl: null,
      openTradeCount: 0,
      tradesWithPrices: 0,
      tradesAwaitingData: 0,
    };
    renderWithTooltip(
      <UnrealizedPnlWidget kpis={SAMPLE_KPIS} mtm={emptyMtm} />,
    );
    expect(screen.getByText('No open positions')).toBeTruthy();
  });

  it('shows -- when mtm is null (loading)', () => {
    renderWithTooltip(
      <UnrealizedPnlWidget kpis={SAMPLE_KPIS} mtm={null} />,
    );
    expect(screen.getByText('--')).toBeTruthy();
  });
});

// ── Empty State Passthrough ────────────────────────────────────────

describe('KPI widget empty state', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows "No data available" default empty message', () => {
    renderWithTooltip(<NetPnlWidget kpis={null} isEmpty />);
    expect(screen.getByText('No data available')).toBeTruthy();
  });
});

// ── Test ID Attributes ─────────────────────────────────────────────

describe('Widget test IDs', () => {
  afterEach(() => {
    cleanup();
  });

  it('NetPnlWidget has data-testid="widget-net-pnl"', () => {
    const { container } = renderWithTooltip(
      <NetPnlWidget kpis={SAMPLE_KPIS} />,
    );
    const el = container.querySelector('[data-testid="widget-net-pnl"]');
    expect(el).toBeTruthy();
  });

  it('UnrealizedPnlWidget has data-testid="widget-unrealized-pnl"', () => {
    const { container } = renderWithTooltip(
      <UnrealizedPnlWidget kpis={SAMPLE_KPIS} mtm={SAMPLE_MTM} />,
    );
    const el = container.querySelector(
      '[data-testid="widget-unrealized-pnl"]',
    );
    expect(el).toBeTruthy();
  });
});
