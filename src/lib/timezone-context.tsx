'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

// ── Types ───────────────────────────────────────────────────────────

type TimezoneContextValue = {
  timezone: string;
  /** Format an ISO string as a date+time string in the configured timezone. */
  formatDateTime: (iso: string | null) => string;
  /** Format an ISO string as a date-only string in the configured timezone. */
  formatDate: (iso: string | null) => string;
  /** Return the current datetime as a local string for datetime-local inputs. */
  nowDatetimeLocal: () => string;
};

const TimezoneContext = createContext<TimezoneContextValue>({
  timezone: 'America/Bogota',
  formatDateTime: (iso) => iso ?? '',
  formatDate: (iso) => iso ?? '',
  nowDatetimeLocal: () => '',
});

// ── Provider ────────────────────────────────────────────────────────

export function TimezoneProvider({ children }: { children: React.ReactNode }) {
  const [timezone, setTimezone] = useState('America/Bogota');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/app-profile')
      .then((r) => r.json())
      .then((data: { timezone?: string | null }) => {
        if (!cancelled && data?.timezone) setTimezone(data.timezone);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const formatDateTime = useCallback(
    (iso: string | null): string => {
      if (!iso) return '-';
      try {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return iso;
        return d.toLocaleString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          timeZone: timezone,
        });
      } catch {
        return iso;
      }
    },
    [timezone],
  );

  const formatDate = useCallback(
    (iso: string | null): string => {
      if (!iso) return '-';
      try {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return iso;
        return d.toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          timeZone: timezone,
        });
      } catch {
        return iso;
      }
    },
    [timezone],
  );

  const nowDatetimeLocal = useCallback((): string => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    // Format current time in the CONFIGURED timezone, not browser local
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(d);
    const m: Record<string, string> = {};
    for (const p of parts) m[p.type] = p.value;
    return `${m.year}-${m.month}-${m.day}T${m.hour}:${m.minute}`;
  }, [timezone]);

  return (
    <TimezoneContext.Provider value={{ timezone, formatDateTime, formatDate, nowDatetimeLocal }}>
      {children}
    </TimezoneContext.Provider>
  );
}

// ── Hook ────────────────────────────────────────────────────────────

export function useAppTimezone() {
  return useContext(TimezoneContext);
}
