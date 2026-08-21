import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { KpiCard } from '../kpi-card';
import { PerformanceDashboardProvider, usePerformanceDashboard } from '@/hooks/use-performance-dashboard';

afterEach(() => cleanup());

// Wrap with provider so the card can consume the context.
function renderCard(widgetType: string, config: Record<string, unknown> = {}, initialFilter?: Record<string, unknown>) {
  return render(
    <PerformanceDashboardProvider initialFilter={initialFilter as never}>
      <KpiCard instanceId="inst-1" widgetType={widgetType} config={config} />
    </PerformanceDashboardProvider>,
  );
}

describe('KpiCard', () => {
  it('renders a currency metric', () => {
    renderCard('net-pnl');
    expect(screen.getByText('Net P&L')).toBeDefined();
    // No analytics data loaded yet → em dash
    expect(screen.getByText('—')).toBeDefined();
  });

  it('renders title override', () => {
    renderCard('net-pnl', { titleOverride: 'My Net P&L' });
    expect(screen.getByText('My Net P&L')).toBeDefined();
  });

  it('renders fixed-semantic metric (win rate stays %)', () => {
    renderCard('win-rate');
    expect(screen.getByText('Win Rate')).toBeDefined();
  });

  it('renders count metric', () => {
    renderCard('total-trades');
    expect(screen.getByText('Total Trades')).toBeDefined();
  });

  it('renders edit mode controls when editMode is on', () => {
    render(
      <PerformanceDashboardProvider>
        <KpiCard
          instanceId="inst-1"
          widgetType="net-pnl"
          config={{}}
          editMode
          onConfigure={() => {}}
          onDuplicate={() => {}}
          onRemove={() => {}}
        />
      </PerformanceDashboardProvider>,
    );
    expect(screen.getByLabelText('Configure Net P&L')).toBeDefined();
    expect(screen.getByLabelText('Duplicate Net P&L')).toBeDefined();
    expect(screen.getByLabelText('Remove Net P&L')).toBeDefined();
  });

  it('does not render edit controls in normal mode', () => {
    renderCard('net-pnl');
    expect(screen.queryByLabelText('Configure Net P&L')).toBeNull();
    expect(screen.queryByLabelText('Duplicate Net P&L')).toBeNull();
    expect(screen.queryByLabelText('Remove Net P&L')).toBeNull();
  });

  it('renders a widget-level error state when the analytics fetch fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));
    renderCard('net-pnl');
    // The debounced fetch (300ms) fails → the card shows its own error slot
    // instead of a stale value or a whole-dashboard crash.
    await waitFor(() => {
      expect(screen.getByTestId('kpi-error-net-pnl')).toBeDefined();
    });
    expect(screen.getByText('Error loading')).toBeDefined();
  });
});

// ── Unit conversion, loading, and stale-state coverage ─────────────────────

describe('KpiCard conversion and data states', () => {
  const originalFetch = globalThis.fetch;

  const okResponse = (body: unknown): Response =>
    ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

  const analyticsWith = (
    kpiMetrics: Record<string, unknown>,
    metadata: Record<string, unknown> = {},
    charts: Record<string, unknown> = {},
  ) => ({
    kpiMetrics,
    charts,
    metadata: {
      accountCount: 1,
      mixedCurrencies: false,
      tradeCount: 0,
      dateRange: { from: null, to: null },
      ...metadata,
    },
  });

  beforeEach(() => {
    vi.useFakeTimers();
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(okResponse(analyticsWith({ netPnl: 1000, totalInitialRisk: 200 })));
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    globalThis.fetch = originalFetch;
  });

  it('shows a loading skeleton while the first fetch is in flight (no data yet)', async () => {
    globalThis.fetch = vi.fn().mockReturnValue(new Promise<Response>(() => {}));
    renderCard('net-pnl');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(screen.getByTestId('kpi-skeleton-net-pnl')).toBeDefined();
  });

  it('converts a currency metric to percent of period-start equity', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(okResponse(analyticsWith({ netPnl: 1000 }, { periodStartEquity: 10000 })));
    renderCard('net-pnl', {}, { unit: 'percent' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(screen.getByText('10.0%')).toBeDefined();
  });

  it('converts a currency metric to R-multiples using total initial risk', async () => {
    renderCard('net-pnl', {}, { unit: 'r' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(screen.getByText('5.00R')).toBeDefined();
  });

  it('applies the R-multiple guard: missing initial risk renders an em dash, not 0R', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(okResponse(analyticsWith({ netPnl: 1000 })));
    renderCard('net-pnl', {}, { unit: 'r' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(screen.getByText('—')).toBeDefined();
    expect(screen.queryByText(/R$/)).toBeNull();
  });

  it('falls back to the widget type title for an unknown metric id without crashing', () => {
    renderCard('not-a-metric');
    expect(screen.getByText('not-a-metric')).toBeDefined();
    expect(screen.getByText('—')).toBeDefined();
  });

  it('keeps showing the stale value during a background refetch', async () => {
    const pending = new Promise<Response>(() => {});
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(okResponse(analyticsWith({ netPnl: 1000 })))
      .mockReturnValueOnce(pending);

    function StaleHarness() {
      const { setDateRange } = usePerformanceDashboard();
      return (
        <div>
          <button onClick={() => setDateRange({ preset: '1M', from: '2026-07-01', to: '' })}>
            refilter
          </button>
          <KpiCard instanceId="inst-1" widgetType="net-pnl" config={{}} />
        </div>
      );
    }

    render(
      <PerformanceDashboardProvider>
        <StaleHarness />
      </PerformanceDashboardProvider>,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(screen.getByText('$1,000')).toBeDefined();

    fireEvent.click(screen.getByText('refilter'));
    await act(async () => {
      // Second debounced fetch fires and stays pending: isLoading true, data still present.
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(screen.getByText('$1,000')).toBeDefined();
    expect(screen.queryByTestId('kpi-skeleton-net-pnl')).toBeNull();
  });
});

// ── Equal-geometry and microviz-containment coverage (R003, S03/T2) ────────

describe('KpiCard equal geometry and microviz containment', () => {
  const originalFetch = globalThis.fetch;

  const okResponse = (body: unknown): Response =>
    ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

  const analyticsWith = (
    kpiMetrics: Record<string, unknown>,
    metadata: Record<string, unknown> = {},
    charts: Record<string, unknown> = {},
  ) => ({
    kpiMetrics,
    charts,
    metadata: {
      accountCount: 1,
      mixedCurrencies: false,
      tradeCount: 0,
      dateRange: { from: null, to: null },
      ...metadata,
    },
  });

  const sparklineCharts = {
    cumulativeDailyPnl: [
      { cumulativePnl: 100 },
      { cumulativePnl: 200 },
      { cumulativePnl: 300 },
    ],
  };

  beforeEach(() => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    globalThis.fetch = originalFetch;
  });

  async function loadData() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
  }

  it('enforces a fixed card height (h-kpi-card) instead of content-driven min-height', () => {
    const { container } = renderCard('net-pnl');
    const card = container.querySelector('[data-kpi-card="net-pnl"]') as HTMLElement;
    expect(card).not.toBeNull();
    // Fixed-height token replaces the loose min-h-[72px]: height is fixed and
    // token-driven, never a min-height that grows with content.
    expect(card.className).toContain('h-kpi-card');
    expect(card.className).not.toMatch(/min-h-/);
    // Column flex keeps title/value in the shared top block and pins the
    // microviz slot to the bottom without affecting the top block.
    expect(card.className).toContain('flex');
    expect(card.className).toContain('flex-col');
  });

  it('keeps the title and value in the top block, ahead of the bottom microviz slot', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(okResponse(analyticsWith({ netPnl: 1000, totalInitialRisk: 200 }, {}, sparklineCharts)));
    const { container } = renderCard('net-pnl');
    await loadData();

    const card = container.querySelector('[data-kpi-card="net-pnl"]') as HTMLElement;
    const children = Array.from(card.children);
    const valueIndex = children.findIndex((c) => c.getAttribute('data-kpi-value') === 'net-pnl');
    const slotIndex = children.findIndex((c) => c.hasAttribute('data-kpi-microviz-slot'));
    // Title row is first; the value row is second; the microviz slot is the
    // final child. Title and value always share the top block across cards.
    expect(valueIndex).toBe(1);
    expect(slotIndex).toBe(2);
  });

  it('contains the microviz in a fixed reserved slot that cannot grow the card', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(okResponse(analyticsWith({ netPnl: 1000, totalInitialRisk: 200 }, {}, sparklineCharts)));
    const { container } = renderCard('net-pnl');
    await loadData();

    const slot = container.querySelector('[data-kpi-microviz-slot]') as HTMLElement;
    expect(slot).not.toBeNull();
    // Reserved fixed slot: exact height, shrink-proof, overflow-clipped, so
    // the visualization can never change the card height or escape bounds.
    expect(slot.className).toContain('h-10');
    expect(slot.className).toContain('overflow-hidden');
    expect(slot.className).toContain('shrink-0');
    // The slot is a direct child of the card (contained within card bounds).
    expect(slot.parentElement?.getAttribute('data-kpi-card')).toBe('net-pnl');
    // The sparkline renders inside the slot.
    expect(container.querySelector('[data-testid="kpi-sparkline"]')).not.toBeNull();
  });

  it('renders the win-rate donut inside the same fixed slot', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(okResponse(analyticsWith({ winRate: 0.6 }, {}, sparklineCharts)));
    const { container } = renderCard('win-rate');
    await loadData();

    const card = container.querySelector('[data-kpi-card="win-rate"]') as HTMLElement;
    const slot = container.querySelector('[data-kpi-microviz-slot]') as HTMLElement;
    expect(slot).not.toBeNull();
    expect(slot.className).toContain('h-10');
    expect(container.querySelector('[data-testid="kpi-donut"]')).not.toBeNull();
    expect(slot.parentElement).toBe(card);
  });

  it('keeps the same fixed-height class whether or not a microviz is present', async () => {
    // Net P&L with sparkline data vs Profit Factor without any microviz.
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(okResponse(analyticsWith({ netPnl: 1000, totalInitialRisk: 200, profitFactor: 1.5 }, {}, sparklineCharts)));
    const withViz = renderCard('net-pnl');
    const withoutViz = renderCard('profit-factor');
    await loadData();

    const cardWithViz = withViz.container.querySelector('[data-kpi-card="net-pnl"]') as HTMLElement;
    const cardWithoutViz = withoutViz.container.querySelector('[data-kpi-card="profit-factor"]') as HTMLElement;
    // Both cards carry the identical fixed-height token class: the microviz
    // adds no height-affecting class, so geometry stays equal across cards.
    expect(cardWithViz.className).toContain('h-kpi-card');
    expect(cardWithoutViz.className).toContain('h-kpi-card');
    expect(cardWithViz.className).toBe(cardWithoutViz.className);
    // The no-viz card simply has no slot; its height is still fixed.
    expect(withoutViz.container.querySelector('[data-kpi-microviz-slot]')).toBeNull();
  });

  it('keeps edit-mode controls inside the card bounds', () => {
    const { container } = render(
      <PerformanceDashboardProvider>
        <KpiCard
          instanceId="inst-1"
          widgetType="net-pnl"
          config={{}}
          editMode
          onConfigure={() => {}}
          onDuplicate={() => {}}
          onRemove={() => {}}
        />
      </PerformanceDashboardProvider>,
    );
    const card = container.querySelector('[data-kpi-card="net-pnl"]') as HTMLElement;
    expect(card).not.toBeNull();
    // Configure/duplicate/remove live inside the card root (the header row),
    // not in an external overlay — they stay within the card geometry.
    // within() uses text matching (the & in the label is unreliable in
    // jsdom CSS attribute selectors), and scopes the query to the card root.
    expect(within(card).getByLabelText('Configure Net P&L')).toBeDefined();
    expect(within(card).getByLabelText('Duplicate Net P&L')).toBeDefined();
    expect(within(card).getByLabelText('Remove Net P&L')).toBeDefined();
  });
});
