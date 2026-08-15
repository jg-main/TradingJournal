'use client';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { computeRiskReward, formatCurrency } from './helpers';
import TradeDetailsCard from './trade-details-card';
import type { RiskSnapshot, Trade, StopAdjustment, TargetAdjustment, MtmData } from './types';

interface RiskSnapshotCardProps {
  riskSnapshot: RiskSnapshot | null;
  plannedValues?: Pick<Trade, 'direction' | 'plannedEntry' | 'plannedStop' | 'plannedQuantity' | 'plannedTarget1' | 'plannedTarget2'> | null;
  actualValues?: { avgEntryPrice: number | null; avgExitPrice: number | null } | null;
  /** Canonical remaining position quantity for the Trade Details Current column. */
  currentQuantity?: number | null;
  mtmData?: MtmData;
  onRefreshPrice?: () => void;
  tradeStatus?: Trade['status'];
  stopAdjustments?: StopAdjustment[];
  targetAdjustments?: TargetAdjustment[];
  /** Open-trade inline editing (M019/S02/T02): forwarded to TradeDetailsCard. */
  tradeId?: string;
  /** Called after a successful level edit so the page refetches both chains. */
  onAdjustmentsChanged?: () => Promise<void>;
  /** M019/S04/T02: opens the page-owned AddFillDialog from the TradeDetailsCard header button. */
  onAddFill?: () => void;
}

export default function RiskSnapshotCard({
  riskSnapshot,
  plannedValues,
  actualValues,
  currentQuantity,
  mtmData,
  tradeStatus,
  stopAdjustments,
  targetAdjustments,
  tradeId,
  onAdjustmentsChanged,
  onAddFill,
}: RiskSnapshotCardProps) {
  if (!riskSnapshot) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base font-semibold text-foreground">
            Trade Overview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No risk snapshot recorded.</p>
        </CardContent>
      </Card>
    );
  }

  const dir = plannedValues?.direction ?? 'long';
  const planEntry = plannedValues?.plannedEntry;
  const planStop = plannedValues?.plannedStop;
  const planQty = plannedValues?.plannedQuantity;
  const planTarget1 = plannedValues?.plannedTarget1 ?? null;

  const planRiskShare = planEntry != null && planStop != null ? Math.abs(planEntry - planStop) : null;
  const planRiskPct = planRiskShare != null && planEntry != null && planEntry > 0 ? (planRiskShare / planEntry) * 100 : null;
  const planRiskDollar = planRiskShare != null && planQty != null ? planRiskShare * planQty : null;
  const planReturn = planEntry != null && planTarget1 != null && planTarget1 > 0
    ? computeRiskReward(dir, planEntry, planTarget1, planQty ?? null) : null;
  function computeRR(
    returnPct: number | null | undefined,
    riskPct: number | null | undefined,
  ): string | null {
    if (returnPct == null || riskPct == null) return null;
    if (riskPct === 0) {
      return returnPct > 0 ? '∞' : returnPct < 0 ? '—' : null;
    }
    return (returnPct / riskPct).toFixed(2);
  }

  const planRR = computeRR(planReturn?.pct, planRiskPct);

  const actualEntry = actualValues?.avgEntryPrice ?? riskSnapshot!.initialEntryPrice;
  const actualExit = actualValues?.avgExitPrice;
  const actualQty = riskSnapshot!.initialQuantity;
  const actualStop = plannedValues?.plannedStop ?? null;

  const actualRiskShare = actualEntry != null && actualStop != null ? Math.abs(actualEntry - actualStop) : null;
  const actualRiskPct = actualRiskShare != null && actualEntry != null && actualEntry > 0 ? (actualRiskShare / actualEntry) * 100 : null;
  const actualRiskDollar = actualRiskShare != null && actualQty != null ? actualRiskShare * actualQty : null;
  const actualReturn = actualEntry != null && actualExit != null && actualExit > 0 && actualQty != null
    ? computeRiskReward(dir, actualEntry, actualExit, actualQty) : null;
  const actualRR = computeRR(actualReturn?.pct, actualRiskPct);

  const hasMtm = mtmData?.price != null && tradeStatus === 'open';
  const mtmReturnPct = hasMtm && actualEntry != null
    ? dir === 'long' ? ((mtmData!.price! - actualEntry) / actualEntry) * 100 : ((actualEntry - mtmData!.price!) / actualEntry) * 100
    : null;
  const mtmReturnDollar = mtmReturnPct != null && actualEntry != null && actualQty != null
    ? (mtmReturnPct / 100) * actualEntry * actualQty : null;
  const mtmRR = hasMtm && planEntry != null && planStop != null
    ? dir === 'long'
      ? ((mtmData!.price! - planStop) / (planEntry - planStop)).toFixed(2)
      : ((planStop - mtmData!.price!) / (planStop - planEntry)).toFixed(2)
    : null;

  const T = 'text-muted-foreground';
  const V = 'tabular-nums text-foreground';

  const mtmPositiveClass = 'text-warning';
  const mtmBadge = (
    <span className="ml-1.5 inline-flex items-center rounded-full bg-warning/10 px-1.5 py-0 text-[10px] font-medium text-warning">
      MTM
    </span>
  );

  const hasPlan = !!plannedValues;

  return (
    <div className="space-y-4">
      {/* ── Two-column cards ── */}
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Trade Details (Plan / Current / Market) */}
        <TradeDetailsCard
          plannedValues={plannedValues}
          initialEntryPrice={riskSnapshot.initialEntryPrice}
          initialStopPrice={riskSnapshot.initialStopPrice}
          initialQuantity={riskSnapshot.initialQuantity}
          currentQuantity={currentQuantity}
          actualEntryPrice={actualValues?.avgEntryPrice ?? null}
          stopAdjustments={stopAdjustments}
          targetAdjustments={targetAdjustments}
          mtmData={mtmData}
          tradeStatus={tradeStatus}
          tradeId={tradeId}
          onAdjustmentsChanged={onAdjustmentsChanged}
          onAddFill={onAddFill}
        />

        {/* Risk & Reward Card */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Risk &amp; Reward
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="pb-1.5 text-left text-xs font-normal text-muted-foreground"></th>
                  {hasPlan && <th className="pb-1.5 text-right text-xs font-normal text-muted-foreground">Plan</th>}
                  <th className="pb-1.5 text-right text-xs font-normal text-muted-foreground">Actual</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border">
                  <td className={'py-1.5 ' + T}>Risk %</td>
                  {hasPlan && <td className={'py-1.5 text-right tabular-nums text-muted-foreground'}>{planRiskPct != null ? planRiskPct.toFixed(2) + '%' : '—'}</td>}
                  <td className={'py-1.5 text-right tabular-nums text-muted-foreground'}>{actualRiskPct != null ? actualRiskPct.toFixed(2) + '%' : '—'}</td>
                </tr>
                <tr className="border-b border-border">
                  <td className={'py-1.5 ' + T}>Risk $</td>
                  {hasPlan && <td className={'py-1.5 text-right tabular-nums text-muted-foreground'}>{planRiskDollar != null ? '$' + planRiskDollar.toFixed(2) : '—'}</td>}
                  <td className={'py-1.5 text-right tabular-nums text-muted-foreground'}>{actualRiskDollar != null ? '$' + actualRiskDollar.toFixed(2) : '—'}</td>
                </tr>
                <tr className="border-b border-border">
                  <td className={'py-1.5 ' + T}>Return %</td>
                  {hasPlan && <td className={'py-1.5 text-right tabular-nums text-foreground'}>{planReturn != null ? '+' + planReturn.pct.toFixed(1) + '%' : '—'}</td>}
                  <td className={'py-1.5 text-right tabular-nums ' + (hasMtm && mtmReturnPct != null ? (mtmReturnPct >= 0 ? mtmPositiveClass : 'text-negative') : actualReturn != null ? 'text-foreground' : V)}>
                    {hasMtm && mtmReturnPct != null ? (<span>{mtmReturnPct >= 0 ? '+' : ''}{mtmReturnPct.toFixed(1)}%{mtmBadge}</span>) : actualReturn != null ? '+' + actualReturn.pct.toFixed(1) + '%' : '—'}
                  </td>
                </tr>
                <tr className="border-b border-border">
                  <td className={'py-1.5 ' + T}>Return $</td>
                  {hasPlan && <td className={'py-1.5 text-right tabular-nums text-foreground'}>{planReturn != null ? formatCurrency(planReturn.dollar) : '—'}</td>}
                  <td className={'py-1.5 text-right tabular-nums ' + (hasMtm && mtmReturnDollar != null ? (mtmReturnDollar >= 0 ? mtmPositiveClass : 'text-negative') : actualReturn != null ? 'text-foreground' : 'text-muted-foreground')}>
                    {hasMtm && mtmReturnDollar != null ? (<span>{formatCurrency(mtmReturnDollar)}{mtmBadge}</span>) : actualReturn != null ? formatCurrency(actualReturn.dollar) : '—'}
                  </td>
                </tr>
                <tr className="border-b border-border">
                  <td className={'py-1.5 ' + T}>R:R</td>
                  {hasPlan && <td className={'py-1.5 text-right ' + V}>{planRR != null ? (planRR === '∞' ? '∞' : '1:' + planRR) : '—'}</td>}
                  <td className={'py-1.5 text-right ' + (hasMtm && mtmRR != null ? mtmPositiveClass : V)}>
                    {hasMtm && mtmRR != null ? (<span>1:{mtmRR}{mtmBadge}</span>) : actualRR != null ? (actualRR === '∞' ? <span className="text-positive">∞</span> : '1:' + actualRR) : (actualReturn != null ? '1:0' : '—')}
                  </td>
                </tr>
                <tr>
                  <td className={'py-1.5 ' + T}>Acct Risk %</td>
                  {hasPlan && <td className="py-1.5 text-right text-muted-foreground">—</td>}
                  <td className={'py-1.5 text-right ' + V}>{riskSnapshot!.accountRiskPct != null ? riskSnapshot!.accountRiskPct.toFixed(2) + '%' : '—'}</td>
                </tr>
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
