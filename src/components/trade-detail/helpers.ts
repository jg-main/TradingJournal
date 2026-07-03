/**
 * Pure utility functions for the Trade Detail page.
 * Extracted from src/app/trades/[id]/page.tsx to provide a single import
 * source for all trade-detail sub-components.
 */

import type { ExecutionData } from '@/lib/trade-calc';
import type { Trade, Execution } from './types';

/**
 * Returns badge variant and class name for the given trade status.
 */
export function statusBadgeVariant(status: Trade['status']): {
  variant: 'default' | 'secondary' | 'destructive' | 'outline';
  className: string;
} {
  switch (status) {
    case 'planned':
      return { variant: 'secondary', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' };
    case 'open':
      return { variant: 'default', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' };
    case 'closed':
      return { variant: 'outline', className: 'text-zinc-500 dark:text-zinc-400' };
    case 'deleted':
      return { variant: 'outline', className: 'text-zinc-500 dark:text-zinc-400 line-through' };
  }
}

/**
 * Formats a number with minimum 2 fraction digits.
 * Returns '-' for null/undefined.
 */
export function formatPrice(v: number | null | undefined): string {
  if (v === null || v === undefined) return '-';
  return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Formats a number as USD currency with sign prefix.
 * Returns '-' for null/undefined.
 */
export function formatCurrency(v: number | null | undefined): string {
  if (v === null || v === undefined) return '-';
  const abs = Math.abs(v);
  const formatted = abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v >= 0 ? `$${formatted}` : `-$${formatted}`;
}

/**
 * Formats a date string into a locale-friendly display format.
 * Returns '-' for null/undefined input, and falls back to the raw string
 * if Date parsing throws.
 */
export function formatDate(d: string | null): string {
  if (!d) return '-';
  try {
    return new Date(d).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return d;
  }
}

/**
 * Maps an execution action code to a human-readable label.
 */
export function formatAction(action: string): string {
  const labels: Record<string, string> = {
    buy: 'Buy',
    sell: 'Sell',
    buy_to_cover: 'Buy to Cover',
    sell_short: 'Sell Short',
    add: 'Add',
    reduce: 'Reduce',
  };
  return labels[action] ?? action;
}

/**
 * Maps Execution[] to ExecutionData[] for trade-calc functions.
 */
export function toExecutionData(executions: Execution[]): ExecutionData[] {
  return executions.map((e) => ({
    action: e.action,
    quantity: e.quantity,
    price: e.price,
    fees: e.fees ?? 0,
    executedAt: e.executedAt ?? e.createdAt ?? '',
  }));
}

/**
 * Capitalizes the first letter of a status string for display.
 */
export function statusLabel(status: Trade['status']): string {
  switch (status) {
    default: return status.charAt(0).toUpperCase() + status.slice(1);
  }
}
