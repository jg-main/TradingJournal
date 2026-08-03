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
  const pnlColor = pnlSign ? 'text-positive' : 'text-negative';
  const unrealizedColor = 'text-warning';

  const mtmBadge = (
    <span className="ml-1.5 inline-flex items-center rounded-full bg-warning/10 px-1.5 py-0 text-[10px] font-medium text-warning align-middle">
      MTM
    </span>
  );

  return (
    <Card className="border-border">
      <CardContent className="p-0">
        {/* ── P&L Metrics Grid ── */}
        <div className="px-5 py-4">
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
            <div>
              <div className="text-xs text-muted-foreground">
                {hasUnrealized ? 'Unrealized P&L' : 'Realized P&L'}
              </div>
              <div className={`mt-0.5 text-lg font-semibold tabular-nums ${hasUnrealized ? unrealizedColor : pnlColor}`}>
                {formatCurrency(pnlValue!, { showSign: true })}
                {hasUnrealized && mtmBadge}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">
                {hasUnrealized && unrealizedRMultiple != null ? 'Unrealized R' : 'R Multiple'}
              </div>
              <div className={`mt-0.5 text-lg font-semibold tabular-nums ${hasUnrealized && unrealizedRMultiple != null ? unrealizedColor : rMultiple != null ? pnlColor : 'text-muted-foreground'}`}>
                {hasUnrealized && unrealizedRMultiple != null ? (
                  <span>{unrealizedRMultiple.toFixed(2)}{mtmBadge}</span>
                ) : rMultiple != null ? rMultiple.toFixed(2) : '—'}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">
                {hasUnrealized && unrealizedReturnPct != null ? 'Unrealized Return' : 'Return %'}
              </div>
              <div className={`mt-0.5 text-lg font-semibold tabular-nums ${hasUnrealized && unrealizedReturnPct != null ? unrealizedColor : returnPercent != null ? (returnPercent >= 0 ? 'text-positive' : 'text-negative') : 'text-muted-foreground'}`}>
                {hasUnrealized && unrealizedReturnPct != null ? (
                  <span>{unrealizedReturnPct >= 0 ? '+' : ''}{unrealizedReturnPct.toFixed(2)}%{mtmBadge}</span>
                ) : returnPercent != null ? `${returnPercent >= 0 ? '+' : ''}${returnPercent.toFixed(2)}%` : '—'}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Duration</div>
              <div className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
                {formatDuration(duration)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Avg Entry</div>
              <div className="mt-0.5 text-sm tabular-nums text-foreground">
                {formatPrice(avgEntryPrice)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Entry / Exit Qty</div>
              <div className="mt-0.5 text-sm tabular-nums text-foreground">
                {totalEntryQty} / {totalExitQty}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Total Fees</div>
              <div className="mt-0.5 text-sm tabular-nums text-foreground">
                {formatCurrency(totalFees)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Setup</div>
              <div className="mt-0.5 text-sm tabular-nums text-foreground">
                {setupName || '—'}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
