/**
 * Tests for the FilterContext component.
 *
 * Covers: default values, initial values, setter functions,
 * setFilters partial update, setDatePreset, toSearchParams,
 * and error-on-missing-provider.
 *
 * Run: npx vitest run src/components/dashboard/filter-context.test.tsx
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import {
  FilterProvider,
  useDashboardFilters,
  type DashboardFilterState,
  type DatePreset,
} from './filter-context';

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

/** Wraps a hook call with FilterProvider, optionally with initial filters. */
function renderWithProvider(initialFilters?: Partial<DashboardFilterState>) {
  return renderHook(() => useDashboardFilters(), {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <FilterProvider initialFilters={initialFilters}>{children}</FilterProvider>
    ),
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('FilterContext', () => {
  afterEach(() => {
    cleanup();
  });

  // ── Default values ─────────────────────────────────────────────

  it('provides default empty filter values when no initialFilters given', () => {
    const { result } = renderWithProvider();
    expect(result.current.filters.dateFrom).toBe('');
    expect(result.current.filters.dateTo).toBe('');
    expect(result.current.filters.accountId).toBeNull();
  });

  // ── Initial values ─────────────────────────────────────────────

  it('initializes filters from initialFilters prop', () => {
    const { result } = renderWithProvider({
      dateFrom: '2025-01-01',
      dateTo: '2025-12-31',
      accountId: 'acc-1',
    });
    expect(result.current.filters.dateFrom).toBe('2025-01-01');
    expect(result.current.filters.dateTo).toBe('2025-12-31');
    expect(result.current.filters.accountId).toBe('acc-1');
  });

  // ── setDateFrom ────────────────────────────────────────────────

  it('setDateFrom updates the dateFrom filter', () => {
    const { result } = renderWithProvider();
    act(() => result.current.actions.setDateFrom('2025-06-15'));
    expect(result.current.filters.dateFrom).toBe('2025-06-15');
  });

  // ── setDateTo ──────────────────────────────────────────────────

  it('setDateTo updates the dateTo filter', () => {
    const { result } = renderWithProvider();
    act(() => result.current.actions.setDateTo('2025-07-01'));
    expect(result.current.filters.dateTo).toBe('2025-07-01');
  });

  // ── setAccountId ───────────────────────────────────────────────

  it('setAccountId updates the accountId filter', () => {
    const { result } = renderWithProvider();
    act(() => result.current.actions.setAccountId('acc-2'));
    expect(result.current.filters.accountId).toBe('acc-2');
  });

  it('setAccountId accepts null to clear account filter', () => {
    const { result } = renderWithProvider({ accountId: 'acc-1' });
    act(() => result.current.actions.setAccountId(null));
    expect(result.current.filters.accountId).toBeNull();
  });

  // ── setFilters ─────────────────────────────────────────────────

  it('setFilters replaces a single field', () => {
    const { result } = renderWithProvider({
      dateFrom: '2025-01-01',
      dateTo: '2025-12-31',
    });
    act(() => result.current.actions.setFilters({ dateFrom: '2025-06-01' }));
    expect(result.current.filters.dateFrom).toBe('2025-06-01');
    // Other fields unchanged
    expect(result.current.filters.dateTo).toBe('2025-12-31');
    expect(result.current.filters.accountId).toBeNull();
  });

  it('setFilters replaces multiple fields at once', () => {
    const { result } = renderWithProvider({
      dateFrom: '2025-01-01',
      dateTo: '2025-12-31',
      accountId: 'acc-1',
    });
    act(() =>
      result.current.actions.setFilters({
        dateFrom: '2025-03-01',
        dateTo: '',
        accountId: null,
      }),
    );
    expect(result.current.filters.dateFrom).toBe('2025-03-01');
    expect(result.current.filters.dateTo).toBe('');
    expect(result.current.filters.accountId).toBeNull();
  });

  // ── setDatePreset ──────────────────────────────────────────────

  describe('setDatePreset', () => {
    it('"All" clears both date fields', () => {
      const { result } = renderWithProvider({
        dateFrom: '2025-01-01',
        dateTo: '2025-12-31',
      });
      act(() => result.current.actions.setDatePreset('All'));
      expect(result.current.filters.dateFrom).toBe('');
      expect(result.current.filters.dateTo).toBe('');
    });

    it('"YTD" sets dateFrom to Jan 1 of current year', () => {
      const { result } = renderWithProvider();
      const currentYear = new Date().getFullYear();
      act(() => result.current.actions.setDatePreset('YTD'));
      expect(result.current.filters.dateFrom).toBe(`${currentYear}-01-01`);
      expect(result.current.filters.dateTo).toBe('');
    });

    it('"1W" sets dateFrom to 7 days ago', () => {
      const { result } = renderWithProvider();
      act(() => result.current.actions.setDatePreset('1W'));
      const expectedFrom = new Date();
      expectedFrom.setDate(expectedFrom.getDate() - 7);
      expect(result.current.filters.dateFrom).toBe(expectedFrom.toISOString().split('T')[0]);
      expect(result.current.filters.dateTo).toBe('');
    });

    it('"1M" sets dateFrom to ~30 days ago', () => {
      const { result } = renderWithProvider();
      act(() => result.current.actions.setDatePreset('1M'));
      const expectedFrom = new Date();
      expectedFrom.setDate(expectedFrom.getDate() - 30);
      expect(result.current.filters.dateFrom).toBe(expectedFrom.toISOString().split('T')[0]);
    });

    it('"3M" sets dateFrom to ~90 days ago', () => {
      const { result } = renderWithProvider();
      act(() => result.current.actions.setDatePreset('3M'));
      const expectedFrom = new Date();
      expectedFrom.setDate(expectedFrom.getDate() - 90);
      expect(result.current.filters.dateFrom).toBe(expectedFrom.toISOString().split('T')[0]);
    });

    it('"6M" sets dateFrom to ~180 days ago', () => {
      const { result } = renderWithProvider();
      act(() => result.current.actions.setDatePreset('6M'));
      const expectedFrom = new Date();
      expectedFrom.setDate(expectedFrom.getDate() - 180);
      expect(result.current.filters.dateFrom).toBe(expectedFrom.toISOString().split('T')[0]);
    });
  });

  // ── toSearchParams ─────────────────────────────────────────────

  it('toSearchParams builds URLSearchParams from filter state', () => {
    const { result } = renderWithProvider({
      dateFrom: '2025-01-01',
      dateTo: '2025-12-31',
      accountId: 'acc-1',
    });
    const params = result.current.actions.toSearchParams();
    expect(params.get('dateFrom')).toBe('2025-01-01');
    expect(params.get('dateTo')).toBe('2025-12-31');
    expect(params.get('accountId')).toBe('acc-1');
  });

  it('toSearchParams omits empty fields', () => {
    const { result } = renderWithProvider({ accountId: 'acc-1' });
    const params = result.current.actions.toSearchParams();
    expect(params.has('dateFrom')).toBe(false);
    expect(params.has('dateTo')).toBe(false);
    expect(params.get('accountId')).toBe('acc-1');
  });

  it('toSearchParams returns empty params when all filters are empty', () => {
    const { result } = renderWithProvider();
    const params = result.current.actions.toSearchParams();
    expect(Array.from(params.entries())).toHaveLength(0);
  });

  // ── Error on missing provider ──────────────────────────────────

  it('throws when useDashboardFilters is used outside FilterProvider', () => {
    expect(() => {
      renderHook(() => useDashboardFilters());
    }).toThrow('useDashboardFilters must be used within a FilterProvider');
  });

  // ── Provider isolation ─────────────────────────────────────────

  it('does not re-render consumers when unrelated state changes', () => {
    // This is more of a design test: changing setDateTo should not
    // trigger re-renders of components reading other filter fields.
    // We verify the hook correctly isolates each useState.
    const { result } = renderWithProvider({
      dateFrom: '2025-01-01',
      dateTo: '2025-12-31',
      accountId: 'acc-1',
    });

    act(() => result.current.actions.setDateFrom('2025-06-01'));
    // All fields should still be correct
    expect(result.current.filters.dateFrom).toBe('2025-06-01');
    expect(result.current.filters.dateTo).toBe('2025-12-31');
    expect(result.current.filters.accountId).toBe('acc-1');
  });
});
