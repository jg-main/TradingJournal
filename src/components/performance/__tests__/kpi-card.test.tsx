import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  const analyticsWith = (kpiMetrics: Record<string, unknown>, metadata: Record<string, unknown> = {}) => ({
    kpiMetrics,
    charts: {},
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

  it('shows a loading ellipsis while the first fetch is in flight (no data yet)', async () => {
    globalThis.fetch = vi.fn().mockReturnValue(new Promise<Response>(() => {}));
    renderCard('net-pnl');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(screen.getByText('…')).toBeDefined();
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
    expect(screen.queryByText('…')).toBeNull();
  });
});
