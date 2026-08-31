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
import {
  millisecondsUntilNextOperationalLocalDay,
  OPERATIONAL_DATE_RANGE_STORAGE_KEY,
} from './operational-date-range';

// ── Mock the timezone context (mutable configured timezone) ─────────────

let mockTimezone = 'UTC';

vi.mock('@/lib/timezone-context', () => ({
  useAppTimezone: () => ({ timezone: mockTimezone }),
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
      <button data-testid="set-1m" onClick={() => setPreset('1M')} />
      <button data-testid="set-ytd" onClick={() => setPreset('YTD')} />
      <button data-testid="set-max" onClick={() => setPreset('Max')} />
      <button data-testid="set-custom" onClick={() => setCustomRange('2026-01-01', '2026-06-30')} />
      <button data-testid="set-reversed" onClick={() => setCustomRange('2026-12-31', '2026-01-01')} />
      <button data-testid="set-malformed" onClick={() => setCustomRange('2026-02-30', '')} />
      <button data-testid="set-one-sided-from" onClick={() => setCustomRange('2026-01-01', '')} />
      <button data-testid="set-one-sided-to" onClick={() => setCustomRange('', '2026-06-30')} />
    </div>
  );
}

/**
 * Stable-context probe (M004/T9E §12): counts consumer-visible range VALUE
 * changes. This is equivalent to counting REFERENCE changes — the provider
 * keeps the same resolvedRange reference exactly when its values are
 * unchanged — and is the "consumer-visible range-change" signal. The first
 * render is the baseline and never counted.
 */
function ChangeProbe() {
  const { selection, resolvedRange, setPreset, setCustomRange } = useOperationalDateRange();
  const [track, setTrack] = React.useState({
    from: resolvedRange.from,
    to: resolvedRange.to,
    changes: 0,
  });
  if (track.from !== resolvedRange.from || track.to !== resolvedRange.to) {
    setTrack({ from: resolvedRange.from, to: resolvedRange.to, changes: track.changes + 1 });
  }
  return (
    <div>
      <span data-testid="probe-from">{resolvedRange.from}</span>
      <span data-testid="probe-to">{resolvedRange.to}</span>
      <span data-testid="probe-changes">{track.changes}</span>
      <span data-testid="probe-preset">{selection.preset}</span>
      <button data-testid="probe-set-3m" onClick={() => setPreset('3M')} />
      <button data-testid="probe-set-1m" onClick={() => setPreset('1M')} />
      <button data-testid="probe-set-max" onClick={() => setPreset('Max')} />
      <button data-testid="probe-set-custom" onClick={() => setCustomRange('2026-01-01', '2026-06-30')} />
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

const HOUR_MS = 3_600_000;

async function advanceMs(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

function renderChangeProbe() {
  return render(
    <OperationalDateRangeProvider>
      <ChangeProbe />
    </OperationalDateRangeProvider>,
  );
}

function storedValue(): string | null {
  return window.localStorage.getItem(OPERATIONAL_DATE_RANGE_STORAGE_KEY);
}

beforeEach(() => {
  window.localStorage.clear();
  mockTimezone = 'UTC';
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

// ── M004/T9E — local-midnight rollover of RELATIVE presets ──────────────

describe('M004/T9E — local-midnight rollover', () => {
  it('1M rolls at the configured local midnight', async () => {
    vi.setSystemTime(new Date('2026-08-31T12:00:00Z'));
    renderProvider();
    await flush();
    act(() => { screen.getByTestId('set-1m').click(); });
    expect(screen.getByTestId('resolved-from').textContent).toBe('2026-07-31');

    await advanceMs(12 * HOUR_MS); // → 2026-09-01T00:00:00Z
    expect(screen.getByTestId('resolved-from').textContent).toBe('2026-08-01');
  });

  it('3M rolls at the configured local midnight', async () => {
    vi.setSystemTime(new Date('2026-08-31T12:00:00Z'));
    renderProvider();
    await flush();
    act(() => { screen.getByTestId('set-3m').click(); });
    expect(screen.getByTestId('resolved-from').textContent).toBe('2026-05-31');

    await advanceMs(12 * HOUR_MS);
    expect(screen.getByTestId('resolved-from').textContent).toBe('2026-06-01');
  });

  it('6M rolls at the configured local midnight', async () => {
    vi.setSystemTime(new Date('2026-08-31T12:00:00Z'));
    window.localStorage.setItem(OPERATIONAL_DATE_RANGE_STORAGE_KEY, '{"version":1,"preset":"6M"}');
    renderProvider();
    await flush();
    expect(screen.getByTestId('resolved-from').textContent).toBe('2026-02-28');

    await advanceMs(12 * HOUR_MS);
    expect(screen.getByTestId('resolved-from').textContent).toBe('2026-03-01');
  });

  it('1Y rolls at the configured local midnight', async () => {
    vi.setSystemTime(new Date('2026-08-31T12:00:00Z'));
    window.localStorage.setItem(OPERATIONAL_DATE_RANGE_STORAGE_KEY, '{"version":1,"preset":"1Y"}');
    renderProvider();
    await flush();
    expect(screen.getByTestId('resolved-from').textContent).toBe('2025-08-31');

    await advanceMs(12 * HOUR_MS);
    expect(screen.getByTestId('resolved-from').textContent).toBe('2025-09-01');
  });

  it('MTD changes on the month boundary', async () => {
    vi.setSystemTime(new Date('2026-07-31T12:00:00Z'));
    window.localStorage.setItem(OPERATIONAL_DATE_RANGE_STORAGE_KEY, '{"version":1,"preset":"MTD"}');
    renderProvider();
    await flush();
    expect(screen.getByTestId('resolved-from').textContent).toBe('2026-07-01');

    await advanceMs(12 * HOUR_MS); // → 2026-08-01T00:00:00Z
    expect(screen.getByTestId('resolved-from').textContent).toBe('2026-08-01');
  });

  it('MTD does NOT publish a changed range on an ordinary same-month midnight', async () => {
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'));
    window.localStorage.setItem(OPERATIONAL_DATE_RANGE_STORAGE_KEY, '{"version":1,"preset":"MTD"}');
    renderChangeProbe();
    await flush();
    expect(screen.getByTestId('probe-from').textContent).toBe('2026-07-01');
    // Hydration restoring MTD (vs the pre-hydration YTD default) is a genuine
    // selection change and legitimately counts once. The MIDNIGHT TICK must
    // add nothing.
    const countAfterRestore = screen.getByTestId('probe-changes').textContent;
    expect(countAfterRestore).toBe('1');

    await advanceMs(12 * HOUR_MS); // → 2026-07-16T00:00:00Z
    expect(screen.getByTestId('probe-from').textContent).toBe('2026-07-01');
    expect(screen.getByTestId('probe-changes').textContent).toBe(countAfterRestore);
  });

  it('YTD does NOT publish a changed range on an ordinary same-year midnight', async () => {
    vi.setSystemTime(new Date('2026-08-31T12:00:00Z'));
    renderChangeProbe();
    await flush();
    expect(screen.getByTestId('probe-from').textContent).toBe('2026-01-01');
    expect(screen.getByTestId('probe-changes').textContent).toBe('0');

    await advanceMs(12 * HOUR_MS); // → 2026-09-01T00:00:00Z
    expect(screen.getByTestId('probe-from').textContent).toBe('2026-01-01');
    expect(screen.getByTestId('probe-changes').textContent).toBe('0');
  });

  it('YTD publishes a changed range on Jan 1', async () => {
    vi.setSystemTime(new Date('2026-12-31T12:00:00Z'));
    renderChangeProbe();
    await flush();
    expect(screen.getByTestId('probe-from').textContent).toBe('2026-01-01');
    expect(screen.getByTestId('probe-changes').textContent).toBe('0');

    await advanceMs(12 * HOUR_MS); // → 2027-01-01T00:00:00Z
    expect(screen.getByTestId('probe-from').textContent).toBe('2027-01-01');
    expect(screen.getByTestId('probe-changes').textContent).toBe('1');
  });

  it('Max schedules no effective rolling change', async () => {
    vi.setSystemTime(new Date('2026-08-31T12:00:00Z'));
    renderChangeProbe();
    await flush();
    act(() => { screen.getByTestId('probe-set-max').click(); });
    expect(screen.getByTestId('probe-from').textContent).toBe('');
    const countAfterSet = screen.getByTestId('probe-changes').textContent;

    await advanceMs(48 * HOUR_MS);
    expect(screen.getByTestId('probe-from').textContent).toBe('');
    expect(screen.getByTestId('probe-changes').textContent).toBe(countAfterSet);
  });

  it('Custom schedules no effective rolling change', async () => {
    vi.setSystemTime(new Date('2026-08-31T12:00:00Z'));
    renderChangeProbe();
    await flush();
    act(() => { screen.getByTestId('probe-set-custom').click(); });
    expect(screen.getByTestId('probe-from').textContent).toBe('2026-01-01');
    const countAfterSet = screen.getByTestId('probe-changes').textContent;

    await advanceMs(48 * HOUR_MS);
    expect(screen.getByTestId('probe-from').textContent).toBe('2026-01-01');
    expect(screen.getByTestId('probe-changes').textContent).toBe(countAfterSet);
  });

  it('an automatic rollover does not change selection or write app:date-range', async () => {
    vi.setSystemTime(new Date('2026-08-31T12:00:00Z'));
    window.localStorage.setItem(OPERATIONAL_DATE_RANGE_STORAGE_KEY, '{"version":1,"preset":"1M"}');
    renderProvider();
    await flush();
    const storedBefore = storedValue();
    expect(screen.getByTestId('preset').textContent).toBe('1M');
    expect(screen.getByTestId('from').textContent).toBe('');

    await advanceMs(12 * HOUR_MS); // rollover
    expect(screen.getByTestId('resolved-from').textContent).toBe('2026-08-01');
    // Semantic selection untouched and persistence byte-for-byte unchanged.
    expect(screen.getByTestId('preset').textContent).toBe('1M');
    expect(screen.getByTestId('from').textContent).toBe('');
    expect(screen.getByTestId('to').textContent).toBe('');
    expect(storedValue()).toBe(storedBefore);
  });

  it('a daily rolling preset publishes exactly one consumer-visible range change per midnight', async () => {
    vi.setSystemTime(new Date('2026-08-31T12:00:00Z'));
    renderChangeProbe();
    await flush();
    act(() => { screen.getByTestId('probe-set-3m').click(); });
    expect(screen.getByTestId('probe-from').textContent).toBe('2026-05-31');
    expect(screen.getByTestId('probe-changes').textContent).toBe('1'); // the set itself

    await advanceMs(12 * HOUR_MS);
    expect(screen.getByTestId('probe-from').textContent).toBe('2026-06-01');
    expect(screen.getByTestId('probe-changes').textContent).toBe('2');

    await advanceMs(24 * HOUR_MS);
    expect(screen.getByTestId('probe-from').textContent).toBe('2026-06-02');
    expect(screen.getByTestId('probe-changes').textContent).toBe('3');
  });
});

// ── M004/T9E — configured timezone change ───────────────────────────────

describe('M004/T9E — timezone change', () => {
  it('recomputes immediately and re-arms against the new timezone midnight', async () => {
    mockTimezone = 'UTC';
    vi.setSystemTime(new Date('2026-01-01T02:00:00Z'));
    window.localStorage.setItem(OPERATIONAL_DATE_RANGE_STORAGE_KEY, '{"version":1,"preset":"1M"}');
    const view = renderProvider();
    await flush();
    // UTC: 2026-01-01 → 1M from = 2025-12-01.
    expect(screen.getByTestId('resolved-from').textContent).toBe('2025-12-01');

    // Switch to Bogotá: 2026-01-01T02:00Z is still 2025-12-31 21:00 local.
    mockTimezone = 'America/Bogota';
    view.rerender(
      <OperationalDateRangeProvider>
        <Probe />
      </OperationalDateRangeProvider>,
    );
    await flush();
    // Immediate recompute with the new timezone — no waiting for old midnight.
    expect(screen.getByTestId('resolved-from').textContent).toBe('2025-11-30');

    // The old UTC timer was cancelled and re-armed to Bogotá midnight
    // (2026-01-01T05:00:00Z, 3h away): advancing 3h rolls the range.
    await advanceMs(3 * HOUR_MS);
    expect(screen.getByTestId('resolved-from').textContent).toBe('2025-12-01');
  });

  it('an identical recompute after a timezone change preserves stable public identity', async () => {
    // UTC and Bogotá agree on the date here, so the resolved values are the
    // same — the reference must remain stable.
    mockTimezone = 'UTC';
    vi.setSystemTime(new Date('2026-08-31T07:00:00Z'));
    window.localStorage.setItem(OPERATIONAL_DATE_RANGE_STORAGE_KEY, '{"version":1,"preset":"1M"}');
    const view = renderChangeProbe();
    await flush();
    expect(screen.getByTestId('probe-from').textContent).toBe('2026-07-31');
    const countBefore = screen.getByTestId('probe-changes').textContent;

    mockTimezone = 'America/Bogota';
    view.rerender(
      <OperationalDateRangeProvider>
        <ChangeProbe />
      </OperationalDateRangeProvider>,
    );
    await flush();
    expect(screen.getByTestId('probe-from').textContent).toBe('2026-07-31');
    expect(screen.getByTestId('probe-changes').textContent).toBe(countBefore);
  });
});

// ── M004/T9E — timer lifecycle ──────────────────────────────────────────

describe('M004/T9E — timer lifecycle', () => {
  it('cleans up the midnight timer on unmount', async () => {
    vi.setSystemTime(new Date('2026-08-31T12:00:00Z'));
    renderProvider();
    await flush();
    // Default YTD is relative → the provider owns a midnight timer.
    const armed = vi.getTimerCount();
    expect(armed).toBeGreaterThan(0);

    cleanup();
    expect(vi.getTimerCount()).toBe(armed - 1);

    // Advancing far past midnight after unmount is safe (no state writes).
    await act(async () => {
      vi.advanceTimersByTime(48 * HOUR_MS);
    });
  });

  it('switching Relative → Custom cancels automatic rolling', async () => {
    vi.setSystemTime(new Date('2026-08-31T12:00:00Z'));
    renderProvider();
    await flush();
    act(() => { screen.getByTestId('set-3m').click(); });
    const before = screen.getByTestId('resolved-from').textContent;

    act(() => { screen.getByTestId('set-custom').click(); });
    expect(screen.getByTestId('resolved-from').textContent).toBe('2026-01-01');

    // With Custom, advancing far past midnight must NOT roll the range.
    await advanceMs(48 * HOUR_MS);
    expect(screen.getByTestId('resolved-from').textContent).toBe('2026-01-01');
    expect(before).not.toBe('2026-01-01');
  });

  it('switching Custom → Relative arms rolling after the selection change', async () => {
    vi.setSystemTime(new Date('2026-08-31T12:00:00Z'));
    renderProvider();
    await flush();
    act(() => { screen.getByTestId('set-custom').click(); });

    act(() => { screen.getByTestId('set-1m').click(); });
    expect(screen.getByTestId('resolved-from').textContent).toBe('2026-07-31');

    // 1M is relative → advancing to the next UTC midnight rolls it.
    await advanceMs(12 * HOUR_MS);
    expect(screen.getByTestId('resolved-from').textContent).toBe('2026-08-01');
  });
});

// ── M004/T9E — stable resolved-range identity across midnight ───────────

describe('M004/T9E — stable-context across the configured local midnight', () => {
  it('YTD reference stays referentially stable across a Bogotá midnight with unchanged values', async () => {
    mockTimezone = 'America/Bogota';
    vi.setSystemTime(new Date('2026-08-31T12:00:00Z')); // Bogotá 07:00 local
    renderChangeProbe();
    await flush();
    expect(screen.getByTestId('probe-from').textContent).toBe('2026-01-01');
    expect(screen.getByTestId('probe-changes').textContent).toBe('0');

    // Advance through Bogotá midnight (2026-09-01T05:00:00Z, 17h away).
    const delay = millisecondsUntilNextOperationalLocalDay(
      'America/Bogota',
      new Date('2026-08-31T12:00:00Z'),
    );
    await advanceMs(delay);

    expect(screen.getByTestId('probe-from').textContent).toBe('2026-01-01');
    // No consumer-visible range-change fired from the midnight tick alone.
    expect(screen.getByTestId('probe-changes').textContent).toBe('0');
  });

  it('YTD publishes exactly one consumer-visible range change at the Jan 1 boundary', async () => {
    mockTimezone = 'America/Bogota';
    vi.setSystemTime(new Date('2026-12-31T12:00:00Z')); // Bogotá 07:00 local
    renderChangeProbe();
    await flush();
    expect(screen.getByTestId('probe-from').textContent).toBe('2026-01-01');
    expect(screen.getByTestId('probe-changes').textContent).toBe('0');

    const delay = millisecondsUntilNextOperationalLocalDay(
      'America/Bogota',
      new Date('2026-12-31T12:00:00Z'),
    );
    await advanceMs(delay); // → 2027-01-01T05:00:00Z

    expect(screen.getByTestId('probe-from').textContent).toBe('2027-01-01');
    expect(screen.getByTestId('probe-changes').textContent).toBe('1');
  });
});
