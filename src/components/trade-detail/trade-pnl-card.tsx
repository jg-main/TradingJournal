'use client';

import { Card, CardContent } from '@/components/ui/card';
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
  /** MTM unrealized values for open trades */
  unrealizedPnl?: number | null;
  unrealizedReturnPct?: number | null;
  unrealizedRMultiple?: number | null;
  /** Setup/play name */
  setupName?: string | null;
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
  unrealizedPnl,
  unrealizedReturnPct,
  unrealizedRMultiple,
  setupName,
}: TradePnlCardProps) {
  const hasUnrealized = unrealizedPnl != null;
  const pnlValue = hasUnrealized ? unrealizedPnl : realizedPnl;
  const pnlSign = pnlValue! >= 0;
  const pnlColor = pnlSign ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400';
  const unrealizedColor = 'text-amber-600 dark:text-amber-400';

  const mtmBadge = (
    <span className="ml-1.5 inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 align-middle">
      MTM
    </span>
  );

  return (
    <Card className="border-zinc-200/60 dark:border-zinc-800/60">
      <CardContent className="p-0">
        {/* ── P&L Metrics Grid ── */}
        <div className="px-5 py-4">
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
            <div>
              <div className="text-xs text-zinc-400 dark:text-zinc-500">
                {hasUnrealized ? 'Unrealized P&L' : 'Realized P&L'}
              </div>
              <div className={`mt-0.5 text-lg font-semibold tabular-nums ${hasUnrealized ? unrealizedColor : pnlColor}`}>
                {formatCurrency(pnlValue!, { showSign: true })}
                {hasUnrealized && mtmBadge}
              </div>
            </div>
            <div>
              <div className="text-xs text-zinc-400 dark:text-zinc-500">
                {hasUnrealized && unrealizedRMultiple != null ? 'Unrealized R' : 'R Multiple'}
              </div>
              <div className={`mt-0.5 text-lg font-semibold tabular-nums ${hasUnrealized && unrealizedRMultiple != null ? unrealizedColor : rMultiple != null ? pnlColor : 'text-zinc-400 dark:text-zinc-500'}`}>
                {hasUnrealized && unrealizedRMultiple != null ? (
                  <span>{unrealizedRMultiple.toFixed(2)}{mtmBadge}</span>
                ) : rMultiple != null ? rMultiple.toFixed(2) : '—'}
              </div>
            </div>
            <div>
              <div className="text-xs text-zinc-400 dark:text-zinc-500">
                {hasUnrealized && unrealizedReturnPct != null ? 'Unrealized Return' : 'Return %'}
              </div>
              <div className={`mt-0.5 text-lg font-semibold tabular-nums ${hasUnrealized && unrealizedReturnPct != null ? unrealizedColor : returnPercent != null ? (returnPercent >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400') : 'text-zinc-400 dark:text-zinc-500'}`}>
                {hasUnrealized && unrealizedReturnPct != null ? (
                  <span>{unrealizedReturnPct >= 0 ? '+' : ''}{unrealizedReturnPct.toFixed(2)}%{mtmBadge}</span>
                ) : returnPercent != null ? `${returnPercent >= 0 ? '+' : ''}${returnPercent.toFixed(2)}%` : '—'}
              </div>
            </div>
            <div>
              <div className="text-xs text-zinc-400 dark:text-zinc-500">Duration</div>
              <div className="mt-0.5 text-lg font-semibold tabular-nums text-zinc-800 dark:text-zinc-200">
                {formatDuration(duration)}
              </div>
            </div>
            <div>
              <div className="text-xs text-zinc-400 dark:text-zinc-500">Avg Entry</div>
              <div className="mt-0.5 text-sm tabular-nums text-zinc-700 dark:text-zinc-300">
                {formatPrice(avgEntryPrice)}
              </div>
            </div>
            <div>
              <div className="text-xs text-zinc-400 dark:text-zinc-500">Entry / Exit Qty</div>
              <div className="mt-0.5 text-sm tabular-nums text-zinc-700 dark:text-zinc-300">
                {totalEntryQty} / {totalExitQty}
              </div>
            </div>
            <div>
              <div className="text-xs text-zinc-400 dark:text-zinc-500">Total Fees</div>
              <div className="mt-0.5 text-sm tabular-nums text-zinc-700 dark:text-zinc-300">
                {formatCurrency(totalFees)}
              </div>
            </div>
            <div>
              <div className="text-xs text-zinc-400 dark:text-zinc-500">Setup</div>
              <div className="mt-0.5 text-sm tabular-nums text-zinc-700 dark:text-zinc-300">
                {setupName || '—'}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
