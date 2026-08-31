/**
 * Tests for the OperationalDateRangeProvider / useOperationalDateRange global
 * context (M004/T9A).
 *
 * Proves hydration/restoration semantics, safe degradation for corrupted or
 * unavailable storage, setPreset/setCustomRange persistence, timezone-driven
 * resolution, and the single canonical owner across both route-group layouts.
 *
 * Run: npx vitest run src/lib/operational-date-range-context.test.tsx
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import {
  OperationalDateRangeProvider,
  useOperationalDateRange,
} from './operational-date-range-context';
import { OPERATIONAL_DATE_RANGE_STORAGE_KEY } from './operational-date-range';

// ── Mock the timezone context (fixed configured timezone) ──────────────

vi.mock('@/lib/timezone-context', () => ({
  useAppTimezone: () => ({ timezone: 'UTC' }),
}));

// ── Probe ──────────────────────────────────────────────────────────────

function Probe() {
  const { selection, resolvedRange, hydrated, setPreset, setCustomRange } = useOperationalDateRange();
  return (
    <div>
      <span data-testid="preset">{selection.preset}</span>
      <span data-testid="from">{selection.from}</span>
      <span data-testid="to">{selection.to}</span>
      <span data-testid="resolved-from">{resolvedRange.from}</span>
      <span data-testid="resolved-to">{resolvedRange.to}</span>
      <span data-testid="hydrated">{String(hydrated)}</span>
      <button data-testid="set-3m" onClick={() => setPreset('3M')} />
      <button data-testid="set-custom" onClick={() => setCustomRange('2026-01-01', '2026-06-30')} />
      <button data-testid="set-reversed" onClick={() => setCustomRange('2026-12-31', '2026-01-01')} />
      <button data-testid="set-malformed" onClick={() => setCustomRange('2026-02-30', '')} />
      <button data-testid="set-one-sided-from" onClick={() => setCustomRange('2026-01-01', '')} />
      <button data-testid="set-one-sided-to" onClick={() => setCustomRange('', '2026-06-30')} />
    </div>
  );
}

function renderProvider() {
  return render(
    <OperationalDateRangeProvider>
      <Probe />
    </OperationalDateRangeProvider>,
  );
}

async function flush() {
  // Hydration is microtask-deferred; under fake timers microtasks are real,
  // so flushing the microtask queue completes restoration.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function storedValue(): string | null {
  return window.localStorage.getItem(OPERATIONAL_DATE_RANGE_STORAGE_KEY);
}

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers();
  // Deterministic "now" — resolution must never depend on the real wall clock.
  vi.setSystemTime(new Date('2026-07-15T12:00:00Z'));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('default state and hydration', () => {
  it('defaults to YTD before and after hydration', async () => {
    renderProvider();
    expect(screen.getByTestId('preset').textContent).toBe('YTD');
    await flush();
    expect(screen.getByTestId('preset').textContent).toBe('YTD');
  });

  it('hydrated is false before restoration completes and true after', async () => {
    renderProvider();
    expect(screen.getByTestId('hydrated').textContent).toBe('false');
    await flush();
    expect(screen.getByTestId('hydrated').textContent).toBe('true');
  });
});

describe('persisted state restoration', () => {
  it('restores a valid persisted relative preset', async () => {
    window.localStorage.setItem(OPERATIONAL_DATE_RANGE_STORAGE_KEY, '{"version":1,"preset":"3M"}');
    renderProvider();
    await flush();
    expect(screen.getByTestId('preset').textContent).toBe('3M');
  });

  it('restores a valid persisted Custom range', async () => {
    window.localStorage.setItem(
      OPERATIONAL_DATE_RANGE_STORAGE_KEY,
      '{"version":1,"preset":"Custom","from":"2026-01-01","to":"2026-06-30"}',
    );
    renderProvider();
    await flush();
    expect(screen.getByTestId('preset').textContent).toBe('Custom');
    expect(screen.getByTestId('from').textContent).toBe('2026-01-01');
    expect(screen.getByTestId('to').textContent).toBe('2026-06-30');
  });

  it('falls back to YTD on malformed JSON', async () => {
    window.localStorage.setItem(OPERATIONAL_DATE_RANGE_STORAGE_KEY, '{not json');
    renderProvider();
    await flush();
    expect(screen.getByTestId('preset').textContent).toBe('YTD');
  });

  it('falls back to YTD on an unknown preset', async () => {
    window.localStorage.setItem(OPERATIONAL_DATE_RANGE_STORAGE_KEY, '{"version":1,"preset":"Quarterly"}');
    renderProvider();
    await flush();
    expect(screen.getByTestId('preset').textContent).toBe('YTD');
  });

  it('falls back to YTD on an unknown version', async () => {
    window.localStorage.setItem(OPERATIONAL_DATE_RANGE_STORAGE_KEY, '{"version":99,"preset":"YTD"}');
    renderProvider();
    await flush();
    expect(screen.getByTestId('preset').textContent).toBe('YTD');
  });

  it('falls back safely on an invalid persisted Custom range', async () => {
    window.localStorage.setItem(
      OPERATIONAL_DATE_RANGE_STORAGE_KEY,
      '{"version":1,"preset":"Custom","from":"2026-06-30","to":"2026-01-01"}',
    );
    renderProvider();
    await flush();
    expect(screen.getByTestId('preset').textContent).toBe('YTD');
  });

  it('recomputes a restored RELATIVE preset against current now (no stale resolved date)', async () => {
    // Persisted semantics only — the 1M from-bound must be recomputed from
    // the mocked current date (2026-07-15 → 2026-06-15), never a stale value.
    window.localStorage.setItem(OPERATIONAL_DATE_RANGE_STORAGE_KEY, '{"version":1,"preset":"1M"}');
    renderProvider();
    await flush();
    expect(screen.getByTestId('resolved-from').textContent).toBe('2026-06-15');
    // And the persisted payload never carries a resolved date.
    expect(storedValue()).toBe('{"version":1,"preset":"1M"}');
  });
});

describe('selection updates and persistence', () => {
  it('setPreset updates state and persists the semantic selection', async () => {
    renderProvider();
    await flush();
    act(() => {
      screen.getByTestId('set-3m').click();
    });
    expect(screen.getByTestId('preset').textContent).toBe('3M');
    expect(storedValue()).toBe('{"version":1,"preset":"3M"}');
  });

  it('setCustomRange updates state and persists the explicit bounds', async () => {
    renderProvider();
    await flush();
    act(() => {
      screen.getByTestId('set-custom').click();
    });
    expect(screen.getByTestId('preset').textContent).toBe('Custom');
    expect(screen.getByTestId('from').textContent).toBe('2026-01-01');
    expect(screen.getByTestId('to').textContent).toBe('2026-06-30');
    expect(storedValue()).toBe(
      '{"version":1,"preset":"Custom","from":"2026-01-01","to":"2026-06-30"}',
    );
  });
});

describe('storage failure degradation', () => {
  it('localStorage read failure does not crash and session state works', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });
    renderProvider();
    await flush();
    expect(screen.getByTestId('preset').textContent).toBe('YTD');
    expect(screen.getByTestId('hydrated').textContent).toBe('true');
  });

  it('localStorage write failure does not crash and state still updates in-session', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });
    renderProvider();
    await flush();
    act(() => {
      screen.getByTestId('set-3m').click();
    });
    expect(screen.getByTestId('preset').textContent).toBe('3M');
  });
});

describe('Custom-range invariant enforcement (M004/T9A.1)', () => {
  it('rejects a reversed range as a safe no-op preserving state and persistence', async () => {
    renderProvider();
    await flush();
    // Establish a valid Custom state first.
    act(() => {
      screen.getByTestId('set-custom').click();
    });
    const before = storedValue();
    expect(screen.getByTestId('preset').textContent).toBe('Custom');

    // Reversed range must not throw and must not change anything.
    expect(() => {
      act(() => {
        screen.getByTestId('set-reversed').click();
      });
    }).not.toThrow();
    expect(screen.getByTestId('preset').textContent).toBe('Custom');
    expect(screen.getByTestId('from').textContent).toBe('2026-01-01');
    expect(screen.getByTestId('to').textContent).toBe('2026-06-30');
    expect(storedValue()).toBe(before);
  });

  it('rejects a malformed date range as a safe no-op', async () => {
    renderProvider();
    await flush();
    act(() => {
      screen.getByTestId('set-custom').click();
    });
    const before = storedValue();

    expect(() => {
      act(() => {
        screen.getByTestId('set-malformed').click();
      });
    }).not.toThrow();
    expect(screen.getByTestId('from').textContent).toBe('2026-01-01');
    expect(screen.getByTestId('to').textContent).toBe('2026-06-30');
    expect(storedValue()).toBe(before);
  });

  it('allows a valid one-sided range with only from', async () => {
    renderProvider();
    await flush();
    act(() => {
      screen.getByTestId('set-one-sided-from').click();
    });
    expect(screen.getByTestId('preset').textContent).toBe('Custom');
    expect(screen.getByTestId('from').textContent).toBe('2026-01-01');
    expect(screen.getByTestId('to').textContent).toBe('');
    expect(storedValue()).toBe('{"version":1,"preset":"Custom","from":"2026-01-01","to":""}');
  });

  it('allows a valid one-sided range with only to', async () => {
    renderProvider();
    await flush();
    act(() => {
      screen.getByTestId('set-one-sided-to').click();
    });
    expect(screen.getByTestId('preset').textContent).toBe('Custom');
    expect(screen.getByTestId('from').textContent).toBe('');
    expect(screen.getByTestId('to').textContent).toBe('2026-06-30');
    expect(storedValue()).toBe('{"version":1,"preset":"Custom","from":"","to":"2026-06-30"}');
  });

  it('a valid complete Custom range still persists exactly as before', async () => {
    renderProvider();
    await flush();
    act(() => {
      screen.getByTestId('set-custom').click();
    });
    expect(screen.getByTestId('preset').textContent).toBe('Custom');
    expect(storedValue()).toBe(
      '{"version":1,"preset":"Custom","from":"2026-01-01","to":"2026-06-30"}',
    );
  });
});

describe('provider ownership', () => {
  const repoRoot = resolve(__dirname, '..', '..');
  const legacyLayout = readFileSync(resolve(repoRoot, 'src/app/(legacy)/layout.tsx'), 'utf8');
  const tradesLayout = readFileSync(resolve(repoRoot, 'src/app/(trades)/layout.tsx'), 'utf8');

  it('both route-group layouts mount the same canonical provider', () => {
    expect(legacyLayout).toContain('@/lib/operational-date-range-context');
    expect(legacyLayout).toContain('<OperationalDateRangeProvider>');
    expect(tradesLayout).toContain('@/lib/operational-date-range-context');
    expect(tradesLayout).toContain('<OperationalDateRangeProvider>');
  });

  it('introduces no second date-range state owner', () => {
    // The context module is the ONLY module defining the provider/hook.
    const ctxModule = readFileSync(resolve(repoRoot, 'src/lib/operational-date-range-context.tsx'), 'utf8');
    expect(ctxModule).toContain('export function OperationalDateRangeProvider');
    expect(ctxModule).toContain('export function useOperationalDateRange');
    // The pure module owns no React state.
    const pureModule = readFileSync(resolve(repoRoot, 'src/lib/operational-date-range.ts'), 'utf8');
    expect(pureModule).not.toContain('createContext');
    expect(pureModule).not.toContain('useState');
  });
});
