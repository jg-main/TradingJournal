'use client';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { formatPrice } from './helpers';
import type { Trade } from './types';

interface TradePlanCardProps {
  trade: Pick<Trade, 'plannedEntry' | 'plannedStop' | 'plannedTarget1' | 'plannedTarget2' | 'plannedQuantity' | 'thesis' | 'invalidationCondition' | 'preTradePlan' | 'setupName' | 'direction' | 'symbol'>;
  /** When provided, shows side-by-side Planned | Executed columns */
  executedValues?: {
    avgEntryPrice: number | null;
    avgExitPrice: number | null;
  } | null;
}

export default function TradePlanCard({ trade, executedValues }: TradePlanCardProps) {
  const isExecuted = !!executedValues;
  const actualEntry = executedValues?.avgEntryPrice;
  const actualExit = executedValues?.avgExitPrice;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Trade Definition</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* ── Side-by-side table ── */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-700">
                <th className="pb-2 text-left font-medium text-zinc-600 dark:text-zinc-400 w-1/3"></th>
                <th className="pb-2 text-right font-medium text-zinc-600 dark:text-zinc-400">Plan</th>
                {isExecuted && (
                  <th className="pb-2 text-right font-medium text-zinc-600 dark:text-zinc-400">Actual</th>
                )}
              </tr>
            </thead>
            <tbody>
              {/* Entry */}
              <tr className="border-b border-zinc-100 dark:border-zinc-800">
                <td className="py-2 text-zinc-600 dark:text-zinc-400">Entry</td>
                <td className="py-2 text-right tabular-nums text-zinc-900 dark:text-zinc-100">
                  {formatPrice(trade.plannedEntry)}
                </td>
                {isExecuted && (
                  <td className="py-2 text-right tabular-nums text-zinc-900 dark:text-zinc-100">
                    {actualEntry ? formatPrice(actualEntry) : '—'}
                  </td>
                )}
              </tr>
              {/* Stop Loss */}
              <tr className="border-b border-zinc-100 dark:border-zinc-800">
                <td className="py-2 text-zinc-600 dark:text-zinc-400">Stop Loss</td>
                <td className="py-2 text-right tabular-nums text-zinc-900 dark:text-zinc-100">
                  {formatPrice(trade.plannedStop)}
                </td>
                {isExecuted && (
                  <td className="py-2 text-right tabular-nums text-zinc-500">
                    {formatPrice(trade.plannedStop)}
                  </td>
                )}
              </tr>
              {/* Target 1 */}
              <tr className="border-b border-zinc-100 dark:border-zinc-800">
                <td className="py-2 text-zinc-600 dark:text-zinc-400">Target 1</td>
                <td className="py-2 text-right tabular-nums text-zinc-900 dark:text-zinc-100">
                  {formatPrice(trade.plannedTarget1)}
                </td>
                {isExecuted && (
                  <td className="py-2 text-right tabular-nums text-zinc-500">
                    {actualExit ? formatPrice(actualExit) : '—'}
                  </td>
                )}
              </tr>
              {/* Target 2 */}
              <tr className="border-b border-zinc-100 dark:border-zinc-800">
                <td className="py-2 text-zinc-600 dark:text-zinc-400">Target 2</td>
                <td className="py-2 text-right tabular-nums text-zinc-900 dark:text-zinc-100">
                  {formatPrice(trade.plannedTarget2)}
                </td>
                {isExecuted && (
                  <td className="py-2 text-right tabular-nums text-zinc-500">—</td>
                )}
              </tr>
              {/* Quantity */}
              <tr className="border-b border-zinc-100 dark:border-zinc-800">
                <td className="py-2 text-zinc-600 dark:text-zinc-400">Qty</td>
                <td className="py-2 text-right tabular-nums text-zinc-900 dark:text-zinc-100">
                  {trade.plannedQuantity ?? '—'}
                </td>
                {isExecuted && (
                  <td className="py-2 text-right tabular-nums text-zinc-900 dark:text-zinc-100">
                    {trade.plannedQuantity ?? '—'}
                  </td>
                )}
              </tr>
            </tbody>
          </table>
        </div>

        {/* ── Narrative fields ── */}
        {trade.thesis && (
          <div>
            <div className="mb-1 text-xs font-medium text-zinc-600 dark:text-zinc-300">Thesis</div>
            <p className="text-sm text-zinc-700 dark:text-zinc-300">{trade.thesis}</p>
          </div>
        )}
        {trade.invalidationCondition && (
          <div>
            <div className="mb-1 text-xs font-medium text-zinc-600 dark:text-zinc-300">Invalidation</div>
            <p className="text-sm text-zinc-700 dark:text-zinc-300">{trade.invalidationCondition}</p>
          </div>
        )}
        {trade.preTradePlan && (
          <div>
            <div className="mb-1 text-xs font-medium text-zinc-600 dark:text-zinc-300">Pre-Trade Plan</div>
            <p className="text-sm text-zinc-700 dark:text-zinc-300">{trade.preTradePlan}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
