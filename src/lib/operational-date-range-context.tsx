'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAppTimezone } from '@/lib/timezone-context';
import {
  OPERATIONAL_DATE_RANGE_STORAGE_KEY,
  defaultOperationalDateRangeSelection,
  deserializeOperationalDateRange,
  isValidCustomRange,
  millisecondsUntilNextOperationalLocalDay,
  resolveOperationalDateRange,
  serializeOperationalDateRange,
  type OperationalDatePreset,
  type OperationalDateRangeSelection,
  type ResolvedOperationalDateRange,
} from '@/lib/operational-date-range';

/**
 * Global operational date-range context (M004/T9A).
 *
 * Sole canonical owner of the shared operational period across Workstation,
 * Trades, and Performance. Persists the semantic selection under
 * `app:date-range`; relative presets are recomputed from the configured app
 * timezone on every resolution, never stored as stale resolved dates.
 *
 * Lifecycle (M004/T9E): while the app stays open, RELATIVE presets roll
 * forward at the configured LOCAL-CALENDAR midnight via a single timeout
 * re-armed per boundary. The public `resolvedRange` is stabilized BY VALUE —
 * a midnight tick whose from/to are unchanged keeps the same reference, so
 * consumers keyed on `resolvedRange` never refetch merely because the clock
 * advanced. Max/Custom never auto-roll, and automatic rollover never touches
 * the semantic selection or `app:date-range`.
 *
 * Must be mounted inside TimezoneProvider (resolution depends on the
 * configured timezone).
 */

interface OperationalDateRangeContextValue {
  selection: OperationalDateRangeSelection;
  resolvedRange: ResolvedOperationalDateRange;
  /** True once persisted browser state has been read (or storage failed). */
  hydrated: boolean;
  setPreset: (preset: OperationalDatePreset) => void;
  setCustomRange: (from: string, to: string) => void;
}

const OperationalDateRangeContext = createContext<OperationalDateRangeContextValue | null>(null);

export function OperationalDateRangeProvider({ children }: { children: React.ReactNode }) {
  const { timezone } = useAppTimezone();
  // Deterministic default (YTD) on first render — avoids hydration mismatch.
  const [selection, setSelection] = useState<OperationalDateRangeSelection>(
    defaultOperationalDateRangeSelection,
  );
  const [hydrated, setHydrated] = useState(false);

  // Hydration: read + validate the persisted selection once after mount.
  // The storage read is deferred to a microtask so consumers can observe the
  // deterministic pre-hydration default (YTD) on the first committed render.
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      let restored: OperationalDateRangeSelection | null = null;
      try {
        const raw = window.localStorage.getItem(OPERATIONAL_DATE_RANGE_STORAGE_KEY);
        restored = deserializeOperationalDateRange(raw);
      } catch {
        // localStorage unavailable — the default selection still works.
      }
      if (cancelled) return;
      if (restored) setSelection(restored);
      setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Commit a selection to state and persist it immediately. Persistence
  // failures degrade to session-only state without crashing.
  const commitSelection = useCallback((next: OperationalDateRangeSelection) => {
    setSelection(next);
    try {
      window.localStorage.setItem(
        OPERATIONAL_DATE_RANGE_STORAGE_KEY,
        serializeOperationalDateRange(next),
      );
    } catch {
      // Storage unavailable — session state remains usable.
    }
  }, []);

  const setPreset = useCallback(
    (preset: OperationalDatePreset) => {
      if (preset === 'Custom') {
        // Preserve the most recent explicit bounds when re-entering Custom.
        commitSelection({ preset: 'Custom', from: selection.from, to: selection.to });
      } else {
        commitSelection({ preset, from: '', to: '' });
      }
    },
    [commitSelection, selection.from, selection.to],
  );

  const setCustomRange = useCallback(
    (from: string, to: string) => {
      // Defense-in-depth: enforce the canonical Custom invariant before
      // committing. Invalid ranges are a safe no-op — they never touch
      // selection, resolvedRange, or the persisted payload.
      if (!isValidCustomRange(from, to)) return;
      commitSelection({ preset: 'Custom', from, to });
    },
    [commitSelection],
  );

  // Pure derivation from the CURRENT calendar date in the configured
  // timezone — recomputed each render so a midnight rollover's rendered
  // value and the timer's tick always agree (M004/T9E §7/§8).
  const derivedRange = resolveOperationalDateRange(selection, timezone, new Date());

  // Stabilized canonical state: recompute-on-render adjusts it when the
  // values genuinely change, and the local-midnight tick publishes via
  // setState. Identical from/to keep the SAME object reference, so consumers
  // keyed on resolvedRange never observe a change merely because the clock
  // advanced.
  const [resolvedRange, setResolvedRange] = useState<ResolvedOperationalDateRange>(derivedRange);
  if (resolvedRange.from !== derivedRange.from || resolvedRange.to !== derivedRange.to) {
    setResolvedRange(derivedRange);
  }

  // Local-midnight rollover (M004/T9E §7/§9): for a hydrated RELATIVE preset,
  // schedule ONE timeout to the next configured local midnight; on fire,
  // recompute the resolved range from the actual current date and re-arm for
  // the next boundary. Max/Custom never auto-roll. The timer is re-armed on
  // preset/timezone change and cleaned up on unmount. Automatic rollover
  // never writes `app:date-range` or mutates the semantic selection.
  const midnightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const publishMidnightRange = useCallback(() => {
    const candidate = resolveOperationalDateRange(selection, timezone, new Date());
    setResolvedRange((prev) =>
      prev.from === candidate.from && prev.to === candidate.to ? prev : candidate,
    );
  }, [selection, timezone]);

  useEffect(() => {
    const isRelative = selection.preset !== 'Max' && selection.preset !== 'Custom';
    if (!hydrated || !isRelative) return () => {};

    let cancelled = false;
    const arm = () => {
      const delay = Math.max(
        0,
        millisecondsUntilNextOperationalLocalDay(timezone, new Date()),
      );
      midnightTimerRef.current = setTimeout(() => {
        if (cancelled) return;
        publishMidnightRange();
        arm();
      }, delay);
    };
    arm();

    return () => {
      cancelled = true;
      if (midnightTimerRef.current) {
        clearTimeout(midnightTimerRef.current);
        midnightTimerRef.current = null;
      }
    };
  }, [hydrated, publishMidnightRange, selection, timezone]);

  const value = useMemo(
    () => ({ selection, resolvedRange, hydrated, setPreset, setCustomRange }),
    [selection, resolvedRange, hydrated, setPreset, setCustomRange],
  );

  return (
    <OperationalDateRangeContext.Provider value={value}>
      {children}
    </OperationalDateRangeContext.Provider>
  );
}

export function useOperationalDateRange(): OperationalDateRangeContextValue {
  const ctx = useContext(OperationalDateRangeContext);
  if (!ctx) {
    throw new Error('useOperationalDateRange must be used within OperationalDateRangeProvider');
  }
  return ctx;
}
