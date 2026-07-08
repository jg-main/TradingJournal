'use client';

import { DollarSign } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { formatCurrency, formatPrice, formatDuration } from './helpers';

interface TradePnlCardProps {
  realizedPnl: number;
  rMultiple: number | null;
  avgEntryPrice: number | null;
  totalEntryQty: number;
  totalExitQty: number;
  duration: number | null;
  returnPercent: number | null;
  totalFees: number;
}

export default function TradePnlCard({
  realizedPnl,
  rMultiple,
  avgEntryPrice,
  totalEntryQty,
  totalExitQty,
  duration,
  returnPercent,
  totalFees,
}: TradePnlCardProps) {
  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DollarSign className="size-4 text-zinc-500" />
          P&amp;L-R Metrics
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          <div>
            <div className="text-zinc-600 dark:text-zinc-300">Realized P&amp;L</div>
            <div className={`tabular-nums font-medium ${realizedPnl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
              {formatCurrency(realizedPnl)}
            </div>
          </div>
          <div>
            <div className="text-zinc-600 dark:text-zinc-300">R Multiple</div>
            <div className={`tabular-nums font-medium ${rMultiple != null ? (rMultiple >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400') : ''}`}>
              {rMultiple != null ? rMultiple.toFixed(2) : '-'}
            </div>
          </div>
          <div>
            <div className="text-zinc-600 dark:text-zinc-300">Avg Entry Price</div>
            <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
              {formatPrice(avgEntryPrice)}
            </div>
          </div>
          <div>
            <div className="text-zinc-600 dark:text-zinc-300">Total Qty</div>
            <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
              {totalEntryQty.toLocaleString()} / {totalExitQty.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-zinc-600 dark:text-zinc-300">Duration</div>
            <div className="tabular-nums font-medium text-zinc-900 dark:text-zinc-100">
              {formatDuration(duration)}
            </div>
          </div>
          <div>
            <div className="text-zinc-600 dark:text-zinc-300">Return %</div>
            <div className={`tabular-nums font-medium ${returnPercent != null ? (returnPercent >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400') : ''}`}>
              {returnPercent != null ? `${returnPercent.toFixed(2)}%` : '-'}
            </div>
          </div>
          <div>
            <div className="text-zinc-600 dark:text-zinc-300">Total Fees</div>
            <div className="tabular-nums font-medium text-zinc-900 dark:text-zinc-100">
              {formatCurrency(totalFees)}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
