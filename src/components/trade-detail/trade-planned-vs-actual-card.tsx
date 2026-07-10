'use client';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { formatPrice } from './helpers';
import type { Trade } from './types';

interface PlannedVsActualCardProps {
  trade: Pick<Trade, 'plannedEntry' | 'plannedStop' | 'plannedTarget1' | 'plannedQuantity' | 'direction'>;
  avgEntryPrice: number | null;
  avgExitPrice: number | null;
  totalRealizedPnL: number | null;
}

/** Compute % and $ values for a given price set */
function computeRow(
  label: string,
  direction: 'long' | 'short',
  entry: number,
  exit: number,
  quantity: number | null,
): { label: string; pct: string; dollar: string } | null {
  if (!entry || !exit || !quantity) return null;
  const isLong = direction === 'long';
  const pct = isLong ? ((exit - entry) / entry) * 100 : ((entry - exit) / entry) * 100;
  const dollar = (pct / 100) * entry * quantity;
  const isPositive = pct >= 0;
  return {
    label,
    pct: `${isPositive ? '+' : ''}${pct.toFixed(1)}%`,
    dollar: `${isPositive ? '+' : '-'}$${Math.abs(dollar).toFixed(2)}`,
  };
}

export default function PlannedVsActualCard({
  trade,
  avgEntryPrice,
  avgExitPrice,
  totalRealizedPnL,
}: PlannedVsActualCardProps) {
  const dir = trade.direction ?? 'long';
  const plannedEntry = trade.plannedEntry ?? 0;
  const plannedStop = trade.plannedStop ?? 0;
  const plannedTarget = trade.plannedTarget1 ?? 0;
  const qty = trade.plannedQuantity ?? 0;

  const hasActual = avgEntryPrice && avgEntryPrice > 0;

  // Planned risk (entry → stop)
  const plannedRisk = plannedEntry > 0 && plannedStop > 0
    ? computeRow('Risk (Stop)', dir, plannedEntry, plannedStop, qty)
    : null;

  // Planned reward (entry → target)
  const plannedReward = plannedEntry > 0 && plannedTarget > 0
    ? computeRow('Reward (Target)', dir, plannedEntry, plannedTarget, qty)
    : null;

  // Planned R:R
  const plannedRr = plannedRisk && plannedReward && parseFloat(plannedRisk.pct) < 0
    ? (parseFloat(plannedReward.pct) / Math.abs(parseFloat(plannedRisk.pct))).toFixed(2)
    : null;

  // Actual (entry → avg exit)
  const actualResult = hasActual && avgExitPrice && avgExitPrice > 0
    ? computeRow('Actual', dir, avgEntryPrice!, avgExitPrice, qty)
    : null;

  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle>Planned vs Actual</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-700">
                <th className="pb-2 text-left font-medium text-zinc-600 dark:text-zinc-400"></th>
                <th className="pb-2 text-right font-medium text-zinc-600 dark:text-zinc-400">Price</th>
                <th className="pb-2 text-right font-medium text-zinc-600 dark:text-zinc-400">P&amp;L %</th>
                <th className="pb-2 text-right font-medium text-zinc-600 dark:text-zinc-400">P&amp;L $</th>
                <th className="pb-2 text-right font-medium text-zinc-600 dark:text-zinc-400">R:R</th>
              </tr>
            </thead>
            <tbody>
              {/* ── Planned Entry ── */}
              <tr className="border-b border-zinc-100 dark:border-zinc-800">
                <td className="py-2 text-zinc-600 dark:text-zinc-400">Planned Entry</td>
                <td className="py-2 text-right tabular-nums text-zinc-900 dark:text-zinc-100">
                  {formatPrice(trade.plannedEntry)}
                </td>
                <td colSpan={3}></td>
              </tr>

              {/* ── Planned Risk ── */}
              {plannedRisk && (
                <tr className="border-b border-zinc-100 dark:border-zinc-800">
                  <td className="py-2 text-zinc-600 dark:text-zinc-400">{plannedRisk.label}</td>
                  <td className="py-2 text-right tabular-nums text-zinc-500">
                    {formatPrice(trade.plannedStop)}
                  </td>
                  <td className="py-2 text-right tabular-nums text-red-600 dark:text-red-400">
                    {plannedRisk.pct}
                  </td>
                  <td className="py-2 text-right tabular-nums text-red-600 dark:text-red-400">
                    {plannedRisk.dollar}
                  </td>
                  <td className="py-2 text-right tabular-nums text-zinc-500">
                    {plannedRr ? `1:${plannedRr}` : '—'}
                  </td>
                </tr>
              )}

              {/* ── Planned Reward ── */}
              {plannedReward && (
                <tr className="border-b border-zinc-100 dark:border-zinc-800">
                  <td className="py-2 text-zinc-600 dark:text-zinc-400">{plannedReward.label}</td>
                  <td className="py-2 text-right tabular-nums text-zinc-500">
                    {formatPrice(trade.plannedTarget1)}
                  </td>
                  <td className="py-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                    {plannedReward.pct}
                  </td>
                  <td className="py-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                    {plannedReward.dollar}
                  </td>
                  <td className="py-2 text-right tabular-nums text-zinc-500">
                    {plannedRr ? `1:${plannedRr}` : '—'}
                  </td>
                </tr>
              )}

              {/* ── Separator ── */}
              <tr>
                <td colSpan={5} className="py-1"></td>
              </tr>

              {/* ── Actual Entry ── */}
              <tr className="border-b border-zinc-200 dark:border-zinc-700">
                <td className="py-2 font-medium text-zinc-800 dark:text-zinc-200">Actual Entry</td>
                <td className="py-2 text-right tabular-nums font-medium text-zinc-900 dark:text-zinc-100">
                  {hasActual ? formatPrice(avgEntryPrice) : '—'}
                </td>
                <td colSpan={3}></td>
              </tr>

              {/* ── Actual Result ── */}
              {actualResult && (
                <tr>
                  <td className="py-2 font-medium text-zinc-800 dark:text-zinc-200">{actualResult.label}</td>
                  <td className="py-2 text-right tabular-nums text-zinc-500">
                    {formatPrice(avgExitPrice)}
                  </td>
                  <td className={`py-2 text-right tabular-nums font-medium ${
                    parseFloat(actualResult.pct) >= 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}>
                    {actualResult.pct}
                  </td>
                  <td className={`py-2 text-right tabular-nums font-medium ${
                    parseFloat(actualResult.dollar.replace(/[+\-$]/g, '')) >= 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}>
                    {actualResult.dollar}
                  </td>
                  <td></td>
                </tr>
              )}

              {/* ── Total Realized P&L fallback ── */}
              {!actualResult && totalRealizedPnL !== null && (
                <tr>
                  <td className="py-2 font-medium text-zinc-800 dark:text-zinc-200">Realized P&amp;L</td>
                  <td colSpan={2}></td>
                  <td className={`py-2 text-right tabular-nums font-medium ${
                    totalRealizedPnL >= 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}>
                    {totalRealizedPnL >= 0 ? '+' : '-'}${Math.abs(totalRealizedPnL).toFixed(2)}
                  </td>
                  <td></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
