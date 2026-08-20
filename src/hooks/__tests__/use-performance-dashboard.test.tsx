/**
 * Tests for the PerformanceDashboardContext provider + usePerformanceDashboard hook.
 *
 * Covers: default filter shape, debounced single fetch keyed on the serialized
 * API query, filter-change refetches, unit changes NOT triggering refetches,
 * error surfacing (non-OK + network), the stale-response guard, and
 * missing-provider failure.
 *
 * Run: npx vitest run src/hooks/__tests__/use-performance-dashboard.test.tsx
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import React from 'react';
import {
  PerformanceDashboardProvider,
  buildQueryParams,
  usePerformanceDashboard,
} from '../use-performance-dashboard';
import type { PerformanceDashboardFilter } from '@/lib/performance-view-types';

// ═══════════════════════════════════════════════════════════════════════════
// Fetch helpers
// ═══════════════════════════════════════════════════════════════════════════

function okResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}

function errorResponse(body: unknown, status = 400): Response {
  return {
    ok: false,
    status,
    json: async () => body,
  } as unknown as Response;
}

const analyticsBody = (netPnl: number) => ({
  kpiMetrics: { netPnl },
  charts: {},
  metadata: { accountCount: 1, mixedCurrencies: false, tradeCount: 3, dateRange: { from: null, to: null } },
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <PerformanceDashboardProvider>{children}</PerformanceDashboardProvider>
);

// ═══════════════════════════════════════════════════════════════════════════
// buildQueryParams (pure helper)
// ═══════════════════════════════════════════════════════════════════════════

describe('buildQueryParams', () => {
  it('serializes account scope, date range and advanced filters', () => {
    const filter: PerformanceDashboardFilter = {
      accountScope: { mode: 'multiple', accountIds: ['acc-1', 'acc-2'] },
      dateRange: { preset: 'Custom', from: '2026-01-01', to: '2026-06-30' },
      advancedFilters: {
        setupIds: ['s-1'],
        directions: ['long'],
        symbols: ['AAPL'],
        tradeResults: ['win'],
      },
      unit: 'currency',
    };
    const qs = buildQueryParams(filter).toString();
    expect(qs).toContain('accountScope=multiple');
    expect(qs).toContain('accountIds=acc-1%2Cacc-2');
    expect(qs).toContain('dateFrom=2026-01-01');
    expect(qs).toContain('dateTo=2026-06-30');
    expect(qs).toContain('setupIds=s-1');
    expect(qs).toContain('directions=long');
    expect(qs).toContain('symbols=AAPL');
    expect(qs).toContain('tradeResults=win');
  });

  it('excludes unit (client-side presentation must not refetch)', () => {
    const filter: PerformanceDashboardFilter = {
      accountScope: { mode: 'all', accountIds: [] },
      dateRange: { preset: 'YTD', from: '', to: '' },
      advancedFilters: { setupIds: [], directions: [], symbols: [], tradeResults: [] },
      unit: 'r',
    };
    const qs = buildQueryParams(filter).toString();
    expect(qs).not.toContain('unit');
    expect(qs).toContain('accountScope=all');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Provider behavior
// ═══════════════════════════════════════════════════════════════════════════

describe('PerformanceDashboardProvider', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn().mockResolvedValue(okResponse(analyticsBody(100)));
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    globalThis.fetch = originalFetch;
  });

  it('exposes the default filter on mount', () => {
    const { result } = renderHook(() => usePerformanceDashboard(), { wrapper });
    expect(result.current.filter.accountScope).toEqual({ mode: 'all', accountIds: [] });
    expect(result.current.filter.dateRange.preset).toBe('YTD');
    expect(result.current.filter.unit).toBe('currency');
    expect(result.current.analyticsData).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('fetches once on mount, debounced, with the serialized query', async () => {
    renderHook(() => usePerformanceDashboard(), { wrapper });
    expect(globalThis.fetch).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toMatch(/^\/api\/performance\/analytics\?accountScope=all$/);
  });

  it('refetches with updated query after a date-range change', async () => {
    const { result } = renderHook(() => usePerformanceDashboard(), { wrapper });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.setDateRange({ preset: '1M', from: '2026-07-01', to: '' });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1][0] as string;
    expect(url).toContain('dateFrom=2026-07-01');
    expect(url).toContain('accountScope=all');
  });

  it('does NOT refetch when only the unit changes (identical query key)', async () => {
    const { result } = renderHook(() => usePerformanceDashboard(), { wrapper });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.setUnit('percent');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(result.current.filter.unit).toBe('percent');
  });

  it('stores fetched analytics data', async () => {
    const { result } = renderHook(() => usePerformanceDashboard(), { wrapper });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(result.current.analyticsData?.kpiMetrics?.netPnl).toBe(100);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('surfaces the API error message on a non-OK response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(errorResponse({ error: 'No accounts found' }));
    const { result } = renderHook(() => usePerformanceDashboard(), { wrapper });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(result.current.error).toBe('No accounts found');
    expect(result.current.analyticsData).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('surfaces a network failure without crashing', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
    const { result } = renderHook(() => usePerformanceDashboard(), { wrapper });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(result.current.error).toBe('Network error');
    expect(result.current.analyticsData).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('ignores a stale out-of-order response (latest request wins)', async () => {
    let resolveOld!: (r: Response) => void;
    const first = new Promise<Response>((res) => {
      resolveOld = res;
    });
    globalThis.fetch = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(Promise.resolve(okResponse(analyticsBody(200))));

    const { result } = renderHook(() => usePerformanceDashboard(), { wrapper });

    // First debounced fetch fires and stays pending.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    // Filter change triggers a second fetch that resolves immediately.
    act(() => {
      result.current.setDateRange({ preset: '1M', from: '2026-07-01', to: '' });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
      await Promise.resolve();
    });
    expect(result.current.analyticsData?.kpiMetrics?.netPnl).toBe(200);

    // Now the OLD request resolves late with stale data — must be discarded.
    await act(async () => {
      resolveOld(okResponse(analyticsBody(999)));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.analyticsData?.kpiMetrics?.netPnl).toBe(200);
    expect(result.current.error).toBeNull();
  });

  it('refetch() forces an immediate fetch', async () => {
    const { result } = renderHook(() => usePerformanceDashboard(), { wrapper });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.refetch();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
});

describe('usePerformanceDashboard outside provider', () => {
  it('throws a descriptive error', () => {
    expect(() => renderHook(() => usePerformanceDashboard())).toThrow(
      'usePerformanceDashboard must be used within a PerformanceDashboardProvider',
    );
  });
});
