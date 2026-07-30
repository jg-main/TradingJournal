'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { useAccount } from '@/lib/account-context';

// ── Component ───────────────────────────────────────────────────────────

interface SidebarValueProps {
  collapsed?: boolean;
}

/**
 * Sidebar value block: shows a Live badge when open trades exist.
 * No monetary total displayed (removed per user request).
 *
 * Fetches /api/accounts/summary for open trade count only.
 * Loading: skeleton pulse. Error: muted dash. No open trades: nothing.
 */
export function SidebarValue({ collapsed = false }: SidebarValueProps) {
  const { accounts: accountMeta } = useAccount();
  const [openCount, setOpenCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/accounts/summary')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load account summary');
        return res.json() as Promise<{ openTradeCount: number }>;
      })
      .then((data) => {
        if (cancelled) return;
        setOpenCount(data.openTradeCount);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Error');
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // No accounts at all — render nothing
  if (!loading && accountMeta.length === 0) return null;

  // Loading
  if (loading) {
    return (
      <div className="border-t p-3" data-testid="sidebar-value">
        <div className="h-4 w-full animate-pulse rounded bg-muted" />
      </div>
    );
  }

  // Error — render nothing (non-critical)
  if (error) return null;

  if (openCount === 0) return null;

  return (
    <div
      className={cn(
        'border-t',
        collapsed ? 'flex items-center justify-center px-0 py-2' : 'px-3 py-2',
      )}
      data-testid="sidebar-value"
    >
      {collapsed ? (
        <span
          className="size-1.5 rounded-full bg-emerald-500"
          data-testid="sidebar-value-live-dot"
        />
      ) : (
        <div className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-emerald-500" />
          <span className="text-[10px] font-medium uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
            LIVE
          </span>
        </div>
      )}
    </div>
  );
}
