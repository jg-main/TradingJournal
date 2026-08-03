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
              <tr className="border-b border-border">
                <th className="pb-2 text-left font-medium text-muted-foreground w-1/3"></th>
                <th className="pb-2 text-right font-medium text-muted-foreground">Plan</th>
                {isExecuted && (
                  <th className="pb-2 text-right font-medium text-muted-foreground">Actual</th>
                )}
              </tr>
            </thead>
            <tbody>
              {/* Entry */}
              <tr className="border-b border-border">
                <td className="py-2 text-muted-foreground">Entry</td>
                <td className="py-2 text-right tabular-nums text-foreground">
                  {formatPrice(trade.plannedEntry)}
                </td>
                {isExecuted && (
                  <td className="py-2 text-right tabular-nums text-foreground">
                    {actualEntry ? formatPrice(actualEntry) : '—'}
                  </td>
                )}
              </tr>
              {/* Stop Loss */}
              <tr className="border-b border-border">
                <td className="py-2 text-muted-foreground">Stop Loss</td>
                <td className="py-2 text-right tabular-nums text-foreground">
                  {formatPrice(trade.plannedStop)}
                </td>
                {isExecuted && (
                  <td className="py-2 text-right tabular-nums text-muted-foreground">
                    {formatPrice(trade.plannedStop)}
                  </td>
                )}
              </tr>
              {/* Target 1 */}
              <tr className="border-b border-border">
                <td className="py-2 text-muted-foreground">Target 1</td>
                <td className="py-2 text-right tabular-nums text-foreground">
                  {formatPrice(trade.plannedTarget1)}
                </td>
                {isExecuted && (
                  <td className="py-2 text-right tabular-nums text-muted-foreground">
                    {actualExit ? formatPrice(actualExit) : '—'}
                  </td>
                )}
              </tr>
              {/* Target 2 */}
              <tr className="border-b border-border">
                <td className="py-2 text-muted-foreground">Target 2</td>
                <td className="py-2 text-right tabular-nums text-foreground">
                  {formatPrice(trade.plannedTarget2)}
                </td>
                {isExecuted && (
                  <td className="py-2 text-right tabular-nums text-muted-foreground">—</td>
                )}
              </tr>
              {/* Quantity */}
              <tr className="border-b border-border">
                <td className="py-2 text-muted-foreground">Qty</td>
                <td className="py-2 text-right tabular-nums text-foreground">
                  {trade.plannedQuantity ?? '—'}
                </td>
                {isExecuted && (
                  <td className="py-2 text-right tabular-nums text-foreground">
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
            <div className="mb-1 text-xs font-medium text-muted-foreground">Thesis</div>
            <p className="text-sm text-foreground">{trade.thesis}</p>
          </div>
        )}
        {trade.invalidationCondition && (
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">Invalidation</div>
            <p className="text-sm text-foreground">{trade.invalidationCondition}</p>
          </div>
        )}
        {trade.preTradePlan && (
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">Pre-Trade Plan</div>
            <p className="text-sm text-foreground">{trade.preTradePlan}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
