'use client';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { computeRiskReward, formatPrice, formatCurrency } from './helpers';
import type { RiskSnapshot, Trade, MtmData } from './types';

interface RiskSnapshotCardProps {
  riskSnapshot: RiskSnapshot | null;
  plannedValues?: Pick<Trade, 'direction' | 'plannedEntry' | 'plannedStop' | 'plannedQuantity' | 'plannedTarget1' | 'plannedTarget2'> | null;
  actualValues?: { avgEntryPrice: number | null; avgExitPrice: number | null } | null;
  mtmData?: MtmData;
  onRefreshPrice?: () => void;
  tradeStatus?: Trade['status'];
  thesis?: string | null;
  invalidationCondition?: string | null;
  preTradePlan?: string | null;
}

export default function RiskSnapshotCard({
  riskSnapshot,
  plannedValues,
  actualValues,
  mtmData,
  onRefreshPrice,
  tradeStatus,
  thesis,
  invalidationCondition,
  preTradePlan,
}: RiskSnapshotCardProps) {
  if (!riskSnapshot) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base font-semibold text-zinc-800 dark:text-zinc-200">
            Trade Overview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">No risk snapshot recorded.</p>
        </CardContent>
      </Card>
    );
  }

  const dir = plannedValues?.direction ?? 'long';
  const planEntry = plannedValues?.plannedEntry;
  const planStop = plannedValues?.plannedStop;
  const planQty = plannedValues?.plannedQuantity;
  const planTarget1 = plannedValues?.plannedTarget1 ?? null;
  const planTarget2 = plannedValues?.plannedTarget2 ?? null;

  const planRiskShare = planEntry != null && planStop != null ? Math.abs(planEntry - planStop) : null;
  const planRiskPct = planRiskShare != null && planEntry != null && planEntry > 0 ? (planRiskShare / planEntry) * 100 : null;
  const planRiskDollar = planRiskShare != null && planQty != null ? planRiskShare * planQty : null;
  const planReturn = planEntry != null && planTarget1 != null && planTarget1 > 0
    ? computeRiskReward(dir, planEntry, planTarget1, planQty ?? null) : null;
  const planRR = planReturn != null && planRiskPct != null && planRiskPct > 0
    ? (planReturn.pct / planRiskPct).toFixed(2) : null;

  const actualEntry = actualValues?.avgEntryPrice ?? riskSnapshot!.initialEntryPrice;
  const actualExit = actualValues?.avgExitPrice;
  const actualQty = riskSnapshot!.initialQuantity;
  const actualStop = plannedValues?.plannedStop ?? null;

  const actualRiskShare = actualEntry != null && actualStop != null ? Math.abs(actualEntry - actualStop) : null;
  const actualRiskPct = actualRiskShare != null && actualEntry != null && actualEntry > 0 ? (actualRiskShare / actualEntry) * 100 : null;
  const actualRiskDollar = actualRiskShare != null && actualQty != null ? actualRiskShare * actualQty : null;
  const actualReturn = actualEntry != null && actualExit != null && actualExit > 0 && actualQty != null
    ? computeRiskReward(dir, actualEntry, actualExit, actualQty) : null;
  const actualRR = actualReturn != null && actualRiskPct != null && actualRiskPct > 0
    ? (actualReturn.pct / actualRiskPct).toFixed(2) : null;

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

  const T = 'text-zinc-500 dark:text-zinc-400';
  const V = 'tabular-nums text-zinc-900 dark:text-zinc-100';
  const D = 'tabular-nums text-zinc-500 dark:text-zinc-400';

  const mtmPositiveClass = 'text-amber-600 dark:text-amber-400';
  const mtmBadge = (
    <span className="ml-1.5 inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
      MTM
    </span>
  );

  const hasPlan = !!plannedValues;

  return (
    <div className="space-y-4">
      {/* ── Two-column cards ── */}
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Price Levels Card */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
              Price Levels
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 dark:border-zinc-800">
                  <th className="pb-1.5 text-left text-xs font-normal text-zinc-400 dark:text-zinc-500"></th>
                  {hasPlan && <th className="pb-1.5 text-right text-xs font-normal text-zinc-400 dark:text-zinc-500">Plan</th>}
                  <th className="pb-1.5 text-right text-xs font-normal text-zinc-400 dark:text-zinc-500">Actual</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-zinc-100 dark:border-zinc-800">
                  <td className={'py-1.5 ' + T}>Entry</td>
                  {hasPlan && <td className={'py-1.5 text-right ' + V}>{formatPrice(planEntry)}</td>}
                  <td className={'py-1.5 text-right ' + (actualEntry != null ? V : D)}>{actualEntry != null ? formatPrice(actualEntry) : '—'}</td>
                </tr>
                <tr className="border-b border-zinc-100 dark:border-zinc-800">
                  <td className={'py-1.5 ' + T}>Stop</td>
                  {hasPlan && <td className={'py-1.5 text-right ' + V}>{formatPrice(planStop)}</td>}
                  <td className={'py-1.5 text-right ' + D}>{formatPrice(actualStop)}</td>
                </tr>
                <tr className="border-b border-zinc-100 dark:border-zinc-800">
                  <td className={'py-1.5 ' + T}>Target 1</td>
                  {hasPlan && <td className={'py-1.5 text-right ' + V}>{formatPrice(planTarget1)}</td>}
                  <td className={'py-1.5 text-right ' + D}>{actualExit ? formatPrice(actualExit) : '—'}</td>
                </tr>
                <tr className="border-b border-zinc-100 dark:border-zinc-800">
                  <td className={'py-1.5 ' + T}>Target 2</td>
                  {hasPlan && <td className={'py-1.5 text-right ' + V}>{formatPrice(planTarget2)}</td>}
                  <td className={'py-1.5 text-right ' + D}>—</td>
                </tr>
                <tr>
                  <td className={'py-1.5 ' + T}>Qty</td>
                  {hasPlan && <td className={'py-1.5 text-right ' + V}>{planQty ?? '—'}</td>}
                  <td className={'py-1.5 text-right ' + V}>{actualQty != null ? actualQty.toLocaleString() : '—'}</td>
                </tr>
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* Risk & Reward Card */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
              Risk &amp; Reward
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 dark:border-zinc-800">
                  <th className="pb-1.5 text-left text-xs font-normal text-zinc-400 dark:text-zinc-500"></th>
                  {hasPlan && <th className="pb-1.5 text-right text-xs font-normal text-zinc-400 dark:text-zinc-500">Plan</th>}
                  <th className="pb-1.5 text-right text-xs font-normal text-zinc-400 dark:text-zinc-500">Actual</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-zinc-100 dark:border-zinc-800">
                  <td className={'py-1.5 ' + T}>Risk %</td>
                  {hasPlan && <td className={'py-1.5 text-right tabular-nums text-zinc-500'}>{planRiskPct != null ? planRiskPct.toFixed(2) + '%' : '—'}</td>}
                  <td className={'py-1.5 text-right tabular-nums text-zinc-500'}>{actualRiskPct != null ? actualRiskPct.toFixed(2) + '%' : '—'}</td>
                </tr>
                <tr className="border-b border-zinc-100 dark:border-zinc-800">
                  <td className={'py-1.5 ' + T}>Risk $</td>
                  {hasPlan && <td className={'py-1.5 text-right tabular-nums text-zinc-500'}>{planRiskDollar != null ? '$' + planRiskDollar.toFixed(2) : '—'}</td>}
                  <td className={'py-1.5 text-right tabular-nums text-zinc-500'}>{actualRiskDollar != null ? '$' + actualRiskDollar.toFixed(2) : '—'}</td>
                </tr>
                <tr className="border-b border-zinc-100 dark:border-zinc-800">
                  <td className={'py-1.5 ' + T}>Return %</td>
                  {hasPlan && <td className={'py-1.5 text-right tabular-nums text-zinc-900 dark:text-zinc-100'}>{planReturn != null ? '+' + planReturn.pct.toFixed(1) + '%' : '—'}</td>}
                  <td className={'py-1.5 text-right tabular-nums ' + (hasMtm && mtmReturnPct != null ? (mtmReturnPct >= 0 ? mtmPositiveClass : 'text-red-600 dark:text-red-400') : actualReturn != null ? 'text-zinc-900 dark:text-zinc-100' : V)}>
                    {hasMtm && mtmReturnPct != null ? (<span>{mtmReturnPct >= 0 ? '+' : ''}{mtmReturnPct.toFixed(1)}%{mtmBadge}</span>) : actualReturn != null ? '+' + actualReturn.pct.toFixed(1) + '%' : '—'}
                  </td>
                </tr>
                <tr className="border-b border-zinc-100 dark:border-zinc-800">
                  <td className={'py-1.5 ' + T}>Return $</td>
                  {hasPlan && <td className={'py-1.5 text-right tabular-nums text-zinc-900 dark:text-zinc-100'}>{planReturn != null ? formatCurrency(planReturn.dollar) : '—'}</td>}
                  <td className={'py-1.5 text-right tabular-nums ' + (hasMtm && mtmReturnDollar != null ? (mtmReturnDollar >= 0 ? mtmPositiveClass : 'text-red-600 dark:text-red-400') : actualReturn != null ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-500')}>
                    {hasMtm && mtmReturnDollar != null ? (<span>{formatCurrency(mtmReturnDollar)}{mtmBadge}</span>) : actualReturn != null ? formatCurrency(actualReturn.dollar) : '—'}
                  </td>
                </tr>
                <tr className="border-b border-zinc-100 dark:border-zinc-800">
                  <td className={'py-1.5 ' + T}>R:R</td>
                  {hasPlan && <td className={'py-1.5 text-right ' + V}>{planRR != null ? '1:' + planRR : '—'}</td>}
                  <td className={'py-1.5 text-right ' + (hasMtm && mtmRR != null ? mtmPositiveClass : V)}>
                    {hasMtm && mtmRR != null ? (<span>1:{mtmRR}{mtmBadge}</span>) : actualRR != null ? '1:' + actualRR : (actualReturn != null ? '1:0' : '—')}
                  </td>
                </tr>
                <tr>
                  <td className={'py-1.5 ' + T}>Acct Risk %</td>
                  {hasPlan && <td className="py-1.5 text-right text-zinc-400">—</td>}
                  <td className={'py-1.5 text-right ' + V}>{riskSnapshot!.accountRiskPct != null ? riskSnapshot!.accountRiskPct.toFixed(2) + '%' : '—'}</td>
                </tr>
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      {/* ── Narrative fields ── */}
      {(thesis || invalidationCondition || preTradePlan) && (
        <div className="space-y-3 border-t border-zinc-100 pt-4 dark:border-zinc-800">
          {thesis && (
            <div>
              <div className="mb-1 text-xs font-medium text-zinc-400 dark:text-zinc-500">Thesis</div>
              <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{thesis}</p>
            </div>
          )}
          {invalidationCondition && (
            <div>
              <div className="mb-1 text-xs font-medium text-zinc-400 dark:text-zinc-500">Invalidation</div>
              <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{invalidationCondition}</p>
            </div>
          )}
          {preTradePlan && (
            <div>
              <div className="mb-1 text-xs font-medium text-zinc-400 dark:text-zinc-500">Pre-Trade Plan</div>
              <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{preTradePlan}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
