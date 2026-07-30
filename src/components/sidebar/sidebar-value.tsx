'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { useAccount } from '@/lib/account-context';

// ── Types ───────────────────────────────────────────────────────────────

interface AccountSummaryResponse {
  accounts: {
    id: string;
    name: string;
    broker: string | null;
    currency: string;
    currentBalance: string | null;
    asOf: string | null;
  }[];
  totalBalance: string | null;
  openTradeCount: number;
}

// ── Formatting ──────────────────────────────────────────────────────────

function formatCurrency(value: string | null, currency: string): string {
  if (value === null) return '—';
  const num = parseFloat(value);
  if (isNaN(num)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

function formatCompact(value: string | null, currency: string): string {
  if (value === null) return '-';
  const num = parseFloat(value);
  if (isNaN(num)) return '-';
  // Compact: $12.3k or $1.2M
  const abs = Math.abs(num);
  let compact: string;
  if (abs >= 1_000_000) {
    compact = (num / 1_000_000).toFixed(1) + 'M';
  } else if (abs >= 1_000) {
    compact = (num / 1_000).toFixed(1) + 'k';
  } else {
    compact = num.toFixed(0);
  }
  const sym = currency === 'USD' ? '$' : currency + ' ';
  return sym + compact;
}

// ── Component ───────────────────────────────────────────────────────────

interface SidebarValueProps {
  collapsed?: boolean;
}

/**
 * Sidebar value block: shows total account balance in compact format
 * with a Live dot when open trades exist (M007 S03).
 *
 * Fetches /api/accounts/summary. Loading: skeleton pulse.
 * Error: muted dash. Empty accounts: nothing.
 */
export function SidebarValue({ collapsed = false }: SidebarValueProps) {
  const { accounts: accountMeta } = useAccount();
  const [summary, setSummary] = useState<AccountSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/accounts/summary')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load account summary');
        return res.json() as Promise<AccountSummaryResponse>;
      })
      .then((data) => {
        if (cancelled) return;
        setSummary(data);
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

  // Error
  if (error) {
    return (
      <div className="border-t px-3 py-2 text-xs text-muted-foreground" data-testid="sidebar-value">
        {collapsed ? (
          <span title={error}>—</span>
        ) : (
          <span>&mdash;</span>
        )}
      </div>
    );
  }

  if (!summary) return null;

  const total = summary.totalBalance;
  const openCount = summary.openTradeCount;
  const hasLive = openCount > 0;
  const currency = summary.accounts[0]?.currency ?? 'USD';

  return (
    <div
      className={cn(
        'border-t',
        collapsed ? 'flex items-center justify-center px-0 py-2' : 'px-3 py-2',
      )}
      data-testid="sidebar-value"
    >
      {collapsed ? (
        <div className="relative flex items-center">
          {hasLive && (
            <span
              className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-emerald-500"
              data-testid="sidebar-value-live-dot"
            />
          )}
          <span
            className="text-[11px] font-medium tabular-nums text-foreground"
            title={`Total: ${formatCurrency(total, currency)}`}
          >
            {formatCompact(total, currency)}
          </span>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                Equity
              </span>
              {hasLive && (
                <span
                  className="size-1.5 rounded-full bg-emerald-500"
                  data-testid="sidebar-value-live-dot"
                />
              )}
            </div>
            <span
              className="text-sm font-medium tabular-nums text-foreground"
              data-testid="sidebar-value-total"
            >
              {formatCurrency(total, currency)}
            </span>
          </div>
          {hasLive && (
            <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
              LIVE
            </span>
          )}
        </div>
      )}
    </div>
  );
}
