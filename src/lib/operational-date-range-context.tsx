'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAppTimezone } from '@/lib/timezone-context';
import {
  OPERATIONAL_DATE_RANGE_STORAGE_KEY,
  defaultOperationalDateRangeSelection,
  deserializeOperationalDateRange,
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
      commitSelection({ preset: 'Custom', from, to });
    },
    [commitSelection],
  );

  // Relative presets resolve against the current calendar date in the
  // configured timezone whenever the selection or timezone changes.
  const resolvedRange = useMemo(
    () => resolveOperationalDateRange(selection, timezone, new Date()),
    [selection, timezone],
  );

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
