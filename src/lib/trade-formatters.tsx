'use client';

/**
 * trade-formatters.tsx
 *
 * Shared formatter utilities and cell renderers for trade table columns.
 * All components are marked 'use client' for interactivity (sorting, etc.).
 */

import { cn } from '@/lib/utils';

// ── Numeric Formatters ─────────────────────────────────────────────────

/** Format a currency value as $X,XXX.XX */
export function formatCurrency(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  const abs = Math.abs(value);
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(abs);
  return value < 0 ? `-${formatted}` : formatted;
}

/** Format a price (same as currency but might show more decimals) */
export function formatPrice(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  // For stock prices, 2 decimal places is standard
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(value);
}

/** Format a numeric value */
export function formatNumber(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  });
}

/** Format a percentage value (e.g. 0.0342 → "3.42%") */
export function formatPercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  const pct = value * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

/** Format an R-multiple value */
export function formatRMultiple(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}R`;
}

/** Format a risk:reward ratio (planned R:R) */
export function formatRiskRewardRatio(
  risk: number | null | undefined,
  reward: number | null | undefined,
): string {
  if (risk == null || reward == null || risk <= 0) return '—';
  const ratio = reward / risk;
  return `1:${ratio.toFixed(1)}`;
}

/** Format a date to short form: M/D/YY */
export function formatDateShort(value: string | null | undefined): string {
  if (!value) return '—';
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-US', {
      month: 'numeric',
      day: 'numeric',
      year: '2-digit',
    });
  } catch {
    return '—';
  }
}

/** Format holding period from days */
export function formatHoldingPeriod(days: number | null | undefined): string {
  if (days == null || Number.isNaN(days)) return '—';
  if (days < 1) {
    return '<1d';
  }
  return `${Math.round(days)}d`;
}

// ── Cell Components ────────────────────────────────────────────────────

/** Color-coded P&L value */
export function PnlCell({ value }: { value: number | null | undefined }) {
  const formatted = formatCurrency(value);
  if (value == null || Number.isNaN(value) || value === 0) {
    return <span className="tabular-nums text-muted-foreground">{formatted}</span>;
  }
  return (
    <span
      className={cn(
        'tabular-nums',
        value > 0 ? 'text-emerald-600 dark:text-emerald-500' : 'text-red-600 dark:text-red-500',
      )}
    >
      {formatted}
    </span>
  );
}

/** Color-coded percentage value */
export function PercentCell({ value }: { value: number | null | undefined }) {
  const formatted = formatPercent(value);
  if (value == null || Number.isNaN(value) || value === 0) {
    return <span className="tabular-nums text-muted-foreground">{formatted}</span>;
  }
  return (
    <span
      className={cn(
        'tabular-nums',
        value > 0 ? 'text-emerald-600 dark:text-emerald-500' : 'text-red-600 dark:text-red-500',
      )}
    >
      {formatted}
    </span>
  );
}

/** Color-coded R-multiple value */
export function RCell({ value }: { value: number | null | undefined }) {
  const formatted = formatRMultiple(value);
  if (value == null || Number.isNaN(value) || value === 0) {
    return <span className="tabular-nums text-muted-foreground">{formatted}</span>;
  }
  return (
    <span
      className={cn(
        'tabular-nums',
        value > 0 ? 'text-emerald-600 dark:text-emerald-500' : 'text-red-600 dark:text-red-500',
      )}
    >
      {formatted}
    </span>
  );
}

/** Direction badge: Long (green/up) or Short (red/down) */
export function DirectionBadge({ direction }: { direction: string | null | undefined }) {
  if (!direction) return <span className="text-muted-foreground">—</span>;
  const isLong = direction === 'long';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium',
        isLong
          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400'
          : 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400',
      )}
    >
      {isLong ? 'Long' : 'Short'}
    </span>
  );
}

// ── Computed Helpers for Planned Trades ───────────────────────────────

/** Compute planned trade risk amount (absolute dollar risk) */
export function computePlannedRisk(
  direction: string | null | undefined,
  entry: number | null | undefined,
  stop: number | null | undefined,
  quantity: number | null | undefined,
): number | null {
  if (!entry || !stop || !quantity || quantity <= 0) return null;
  if (!direction) return null;
  const diff = direction === 'long' ? entry - stop : stop - entry;
  if (diff <= 0) return null;
  return diff * quantity;
}

/** Compute planned risk:reward ratio */
export function computePlannedRR(
  direction: string | null | undefined,
  entry: number | null | undefined,
  stop: number | null | undefined,
  target1: number | null | undefined,
): number | null {
  if (!entry || !stop || !target1) return null;
  if (!direction) return null;
  const risk = direction === 'long' ? entry - stop : stop - entry;
  const reward = direction === 'long' ? target1 - entry : entry - target1;
  if (risk <= 0 || reward <= 0) return null;
  return reward / risk;
}
