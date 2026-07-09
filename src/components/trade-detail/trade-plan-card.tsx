'use client';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { formatPrice } from './helpers';
import type { Trade } from './types';

interface TradePlanCardProps {
  trade: Pick<Trade, 'plannedEntry' | 'plannedStop' | 'plannedTarget1' | 'plannedQuantity' | 'thesis' | 'invalidationCondition' | 'preTradePlan' | 'setupName'>;
}

export default function TradePlanCard({ trade }: TradePlanCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Trade Plan</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div className="text-zinc-600 dark:text-zinc-300">Setup</div>
          <div className="text-zinc-900 dark:text-zinc-100">
            {trade.setupName ?? '-\u00a0'}
          </div>

          <div className="text-zinc-600 dark:text-zinc-300">Planned Entry</div>
          <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
            {formatPrice(trade.plannedEntry)}
          </div>

          <div className="text-zinc-600 dark:text-zinc-300">Planned Stop</div>
          <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
            {formatPrice(trade.plannedStop)}
          </div>

          <div className="text-zinc-600 dark:text-zinc-300">Target 1</div>
          <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
            {formatPrice(trade.plannedTarget1)}
          </div>

          <div className="text-zinc-600 dark:text-zinc-300">Quantity</div>
          <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
            {trade.plannedQuantity ?? '-\u00a0'}
          </div>

        </div>

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
