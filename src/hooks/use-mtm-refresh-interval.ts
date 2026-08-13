'use client';

import { useEffect, useState } from 'react';

import {
  DEFAULT_MTM_REFRESH_INTERVAL_SECONDS,
  resolveMtmRefreshIntervalSeconds,
} from '@/lib/market-data-refresh-interval';

/**
 * Read the persisted mark refresh cadence for the legacy trade-detail route.
 * The dashboard owns its own shared live-data state; this hook keeps the
 * standalone trade page on the same server-backed setting without a second
 * browser-persisted preference.
 */
export function useMtmRefreshInterval(): number {
  const [intervalSeconds, setIntervalSeconds] = useState(
    DEFAULT_MTM_REFRESH_INTERVAL_SECONDS,
  );

  useEffect(() => {
    const controller = new AbortController();

    const loadInterval = async () => {
      try {
        const response = await fetch('/api/market-data/settings', {
          signal: controller.signal,
        });
        if (!response.ok) return;

        const data = (await response.json()) as {
          refreshIntervalSeconds?: unknown;
        };
        setIntervalSeconds(
          resolveMtmRefreshIntervalSeconds(data.refreshIntervalSeconds),
        );
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        // The default cadence remains safe when settings cannot be read.
      }
    };

    void loadInterval();
    return () => controller.abort();
  }, []);

  return intervalSeconds * 1_000;
}
