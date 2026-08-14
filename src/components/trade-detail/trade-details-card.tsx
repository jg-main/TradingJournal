'use client';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { formatPrice, formatCurrency } from './helpers';
import { deriveCurrentStop, deriveCurrentTarget } from '@/lib/trade-levels';
import type { Trade, StopAdjustment, TargetAdjustment, MtmData } from './types';

interface TradeDetailsCardProps {
  plannedValues?: Pick<Trade, 'direction' | 'plannedEntry' | 'plannedStop' | 'plannedQuantity' | 'plannedTarget1' | 'plannedTarget2'> | null;
  initialEntryPrice?: number | null;
  initialStopPrice?: number | null;
  initialQuantity?: number | null;
  actualEntryPrice?: number | null;
  stopAdjustments?: StopAdjustment[];
  targetAdjustments?: TargetAdjustment[];
  mtmData?: MtmData;
  tradeStatus?: Trade['status'];
}

/**
 * Trade Details card (M019/S02).
 *
 * Shows Plan / Current / Market level columns. The "Current" stop and targets
 * are live values derived from the append-only adjustment chains via
 * trade-levels.ts — never the planned values once the trade is live. Planned
 * values stay in the Plan column as immutable reference points.
 */
export default function TradeDetailsCard({
  plannedValues,
  initialEntryPrice,
  initialStopPrice,
  initialQuantity,
  actualEntryPrice,
  stopAdjustments = [],
  targetAdjustments = [],
  mtmData,
  tradeStatus,
}: TradeDetailsCardProps) {
  const planEntry = plannedValues?.plannedEntry;
  const planStop = plannedValues?.plannedStop;
  const planQty = plannedValues?.plannedQuantity;
  const planTarget1 = plannedValues?.plannedTarget1 ?? null;
  const planTarget2 = plannedValues?.plannedTarget2 ?? null;

  // ── Live "Current" values ──
  // Current stop/targets are derived from the server-side adjustment chains:
  // the latest adjustment wins, else the initial level, else the plan.
  const currentEntry = actualEntryPrice ?? initialEntryPrice ?? null;
  const currentStop = deriveCurrentStop(planStop ?? null, initialStopPrice ?? null, stopAdjustments);
  const currentTarget1 = deriveCurrentTarget(planTarget1, 1, targetAdjustments);
  const currentTarget2 = deriveCurrentTarget(planTarget2, 2, targetAdjustments);
  const currentQty = initialQuantity ?? null;

  // ── Market-column metrics ──
  const hasMtm = mtmData?.price != null && tradeStatus === 'open';
  const mtmPrice = hasMtm ? mtmData!.price! : null;
  const mtmMarketValue = hasMtm && currentQty != null ? mtmPrice! * currentQty : null;

  function mtmDistTo(level: number | null | undefined): { dollar: number; pct: number } | null {
    if (mtmPrice == null || level == null || level === 0) return null;
    const dollar = Math.abs(mtmPrice - level);
    const pct = (dollar / level) * 100;
    return { dollar, pct };
  }
  const mtmDistStop = mtmDistTo(currentStop);
  const mtmDistTarget1 = mtmDistTo(currentTarget1);
  const mtmDistTarget2 = mtmDistTo(currentTarget2);

  const hasPlan = !!plannedValues;

  const T = 'text-muted-foreground';
  const V = 'tabular-nums text-foreground';
  const D = 'tabular-nums text-muted-foreground';

  const mtmPositiveClass = 'text-warning';
  const mtmBadge = (
    <span className="ml-1.5 inline-flex items-center rounded-full bg-warning/10 px-1.5 py-0 text-[10px] font-medium text-warning">
      MTM
    </span>
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Trade Details
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="pb-1.5 text-left text-xs font-normal text-muted-foreground"></th>
              {hasPlan && <th className="pb-1.5 text-right text-xs font-normal text-muted-foreground">Plan</th>}
              <th className="pb-1.5 text-right text-xs font-normal text-muted-foreground">Current</th>
              {hasMtm && <th className="pb-1.5 text-right text-xs font-normal text-warning">Market</th>}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border">
              <td className={'py-1.5 ' + T}>Entry</td>
              {hasPlan && <td className={'py-1.5 text-right ' + V}>{formatPrice(planEntry)}</td>}
              <td className={'py-1.5 text-right ' + (currentEntry != null ? V : D)}>{currentEntry != null ? formatPrice(currentEntry) : '—'}</td>
              {hasMtm && <td className={'py-1.5 text-right ' + mtmPositiveClass}>{formatPrice(mtmPrice)}{mtmBadge}</td>}
            </tr>
            <tr className="border-b border-border">
              <td className={'py-1.5 ' + T}>Stop</td>
              {hasPlan && <td className={'py-1.5 text-right ' + V}>{formatPrice(planStop)}</td>}
              <td className={'py-1.5 text-right ' + (currentStop != null ? V : D)}>{currentStop != null ? formatPrice(currentStop) : '—'}</td>
              {hasMtm && <td className={'py-1.5 text-right ' + D}>{mtmDistStop != null ? `${formatPrice(mtmDistStop.dollar)} (${mtmDistStop.pct.toFixed(1)}%)` : '—'}</td>}
            </tr>
            <tr className="border-b border-border">
              <td className={'py-1.5 ' + T}>Target 1</td>
              {hasPlan && <td className={'py-1.5 text-right ' + V}>{formatPrice(planTarget1)}</td>}
              <td className={'py-1.5 text-right ' + (currentTarget1 != null ? V : D)}>{currentTarget1 != null ? formatPrice(currentTarget1) : '—'}</td>
              {hasMtm && <td className={'py-1.5 text-right ' + D}>{mtmDistTarget1 != null ? `${formatPrice(mtmDistTarget1.dollar)} (${mtmDistTarget1.pct.toFixed(1)}%)` : '—'}</td>}
            </tr>
            <tr className="border-b border-border">
              <td className={'py-1.5 ' + T}>Target 2</td>
              {hasPlan && <td className={'py-1.5 text-right ' + V}>{formatPrice(planTarget2)}</td>}
              <td className={'py-1.5 text-right ' + (currentTarget2 != null ? V : D)}>{currentTarget2 != null ? formatPrice(currentTarget2) : '—'}</td>
              {hasMtm && <td className={'py-1.5 text-right ' + D}>{mtmDistTarget2 != null ? `${formatPrice(mtmDistTarget2.dollar)} (${mtmDistTarget2.pct.toFixed(1)}%)` : '—'}</td>}
            </tr>
            <tr>
              <td className={'py-1.5 ' + T}>Qty</td>
              {hasPlan && <td className={'py-1.5 text-right ' + V}>{planQty ?? '—'}</td>}
              <td className={'py-1.5 text-right ' + V}>{currentQty != null ? currentQty.toLocaleString() : '—'}</td>
              {hasMtm && <td className={'py-1.5 text-right ' + V}>{mtmMarketValue != null ? formatCurrency(mtmMarketValue) : '—'}</td>}
            </tr>
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
