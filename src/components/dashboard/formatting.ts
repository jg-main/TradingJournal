/**
 * Shared formatting helpers for dashboard KPI display.
 *
 * Pure functions extracted from page.tsx to enable reuse across
 * widget components and unit testing without DOM dependencies.
 *
 * Run: npx vitest run src/components/dashboard/formatting.test.ts
 */

// ── Grade Rubric (matches reviews page) ────────────────────────────────

export const GRADE_RUBRIC: { min: number; label: string }[] = [
  { min: 54, label: 'A' },
  { min: 42, label: 'B' },
  { min: 30, label: 'C' },
  { min: 18, label: 'D' },
];

// ── Formatting Helpers (follow reviews page patterns) ──────────────────

export function formatCurrency(
  v: number | null | undefined,
  opts?: { sign?: boolean },
): string {
  if (v === null || v === undefined) return '--';
  return v.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    signDisplay: opts?.sign ? 'exceptZero' : 'auto',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatPercent(v: number | null | undefined): string {
  if (v === null || v === undefined) return '--';
  return `${(v * 100).toFixed(1)}%`;
}

export function formatDecimal(
  v: number | null | undefined,
  digits = 2,
): string {
  if (v === null || v === undefined) return '--';
  return v.toFixed(digits);
}

export function gradeLabelFromScore(score: number | null | undefined): string {
  if (score === null || score === undefined) return '--';
  for (const tier of GRADE_RUBRIC) {
    if (score >= tier.min) return tier.label;
  }
  return 'F';
}

export function pnlColorClass(v: number | null | undefined): string {
  if (v === null || v === undefined) return '';
  if (v > 0) return 'text-zinc-700 dark:text-zinc-300';
  if (v < 0) return 'text-red-600 dark:text-red-400';
  return 'text-zinc-500 dark:text-zinc-400';
}
