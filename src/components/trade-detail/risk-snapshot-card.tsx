'use client';

import { Target } from 'lucide-react';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { computeRiskReward } from './helpers';
import type { RiskSnapshot, Trade, MtmData } from './types';

interface RiskSnapshotCardProps {
  riskSnapshot: RiskSnapshot | null;
  plannedValues?: Pick<Trade, 'direction' | 'plannedEntry' | 'plannedStop' | 'plannedQuantity' | 'plannedTarget1'> | null;
  /** Actual execution prices — when provided, the Actual column uses real trade data instead of risk snapshot initial values */
  actualValues?: { avgEntryPrice: number | null; avgExitPrice: number | null } | null;
  /** MTM (mark-to-market) data for open trades */
  mtmData?: MtmData;
  /** Callback to refresh the current price */
  onRefreshPrice?: () => void;
}

export default function RiskSnapshotCard({ riskSnapshot, plannedValues, actualValues, mtmData, onRefreshPrice }: RiskSnapshotCardProps) {
  if (!riskSnapshot) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="size-4 text-zinc-500" />
            Risk Snapshot
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
  const planTarget = plannedValues?.plannedTarget1 ?? null;

  // ── Plan side ──
  const planRiskShare = planEntry != null && planStop != null ? Math.abs(planEntry - planStop) : null;
  const planRiskPct = planRiskShare != null && planEntry != null && planEntry > 0 ? (planRiskShare / planEntry) * 100 : null;
  const planRiskDollar = planRiskShare != null && planQty != null ? planRiskShare * planQty : null;
  const planReturn = planEntry != null && planTarget != null && planTarget > 0
    ? computeRiskReward(dir, planEntry, planTarget, planQty ?? null) : null;
  const planRR = planReturn != null && planRiskPct != null && planRiskPct > 0
    ? (planReturn.pct / planRiskPct).toFixed(2) : null;

  // ── Actual side (use real execution data when available) ──
  const actualEntry = actualValues?.avgEntryPrice ?? riskSnapshot.initialEntryPrice;
  const actualExit = actualValues?.avgExitPrice;
  const actualQty = riskSnapshot.initialQuantity;
  // Actual stop is always the initial stop from the risk snapshot (the risk that was actually taken).
  // Do NOT derive stop from exit price — that breaks risk calculation for winning trades.
  const actualStop = riskSnapshot.initialStopPrice ?? plannedValues?.plannedStop ?? null;

  const actualRiskShare = actualEntry != null && actualStop != null
    ? Math.abs(actualEntry - actualStop) : null;
  const actualRiskPct = actualRiskShare != null && actualEntry != null && actualEntry > 0
    ? (actualRiskShare / actualEntry) * 100 : null;
  const actualRiskDollar = actualRiskShare != null && actualQty != null
    ? actualRiskShare * actualQty : null;
  const actualReturn = actualEntry != null && actualExit != null && actualExit > 0 && actualQty != null
    ? computeRiskReward(dir, actualEntry, actualExit, actualQty) : null;
  const actualRR = actualReturn != null && actualRiskPct != null && actualRiskPct > 0
    ? (actualReturn.pct / actualRiskPct).toFixed(2) : null;

  const showSideBySide = !!plannedValues;

  const T = 'text-zinc-600 dark:text-zinc-400'; // label class
  const V = 'tabular-nums text-zinc-900 dark:text-zinc-100';  // value class

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="size-4 text-zinc-500" />
          Risk Snapshot
        </CardTitle>
      </CardHeader>
      <CardContent>
        {showSideBySide ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-700">
                  <th className="pb-2 text-left font-medium text-zinc-600 dark:text-zinc-400"></th>
                  <th className="pb-2 text-right font-medium text-zinc-600 dark:text-zinc-400">Plan</th>
                  <th className="pb-2 text-right font-medium text-zinc-600 dark:text-zinc-400">Actual</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-zinc-100 dark:border-zinc-800">
                  <td className={'py-2 ' + T}>Risk %</td>
                  <td className={'py-2 text-right tabular-nums text-red-600 dark:text-red-400'}>
                    {planRiskPct != null ? planRiskPct.toFixed(2) + '%' : '-'}
                  </td>
                  <td className={'py-2 text-right tabular-nums text-red-600 dark:text-red-400'}>
                    {actualRiskPct != null ? actualRiskPct.toFixed(2) + '%' : '-'}
                  </td>
                </tr>
                <tr className="border-b border-zinc-100 dark:border-zinc-800">
                  <td className={'py-2 ' + T}>Risk $</td>
                  <td className={'py-2 text-right tabular-nums text-red-600 dark:text-red-400'}>
                    {planRiskDollar != null ? '$' + planRiskDollar.toFixed(2) : '-'}
                  </td>
                  <td className={'py-2 text-right tabular-nums text-red-600 dark:text-red-400'}>
                    {actualRiskDollar != null ? '$' + actualRiskDollar.toFixed(2) : '-'}
                  </td>
                </tr>
                <tr className="border-b border-zinc-100 dark:border-zinc-800">
                  <td className={'py-2 ' + T}>Return %</td>
                  <td className={'py-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400'}>
                    {planReturn != null ? planReturn.pct.toFixed(1) + '%' : '-'}
                  </td>
                  <td className={'py-2 text-right tabular-nums ' + (actualReturn != null ? 'text-emerald-600 dark:text-emerald-400' : V)}>
                    {actualReturn != null ? actualReturn.pct.toFixed(1) + '%' : (actualRR != null ? '1:' + actualRR : '-')}
                  </td>
                </tr>
                <tr className="border-b border-zinc-100 dark:border-zinc-800">
                  <td className={'py-2 ' + T}>Return $</td>
                  <td className={'py-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400'}>
                    {planReturn != null ? '$' + planReturn.dollar.toFixed(2) : '-'}
                  </td>
                  <td className={'py-2 text-right tabular-nums ' + (actualReturn != null ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-500')}>
                    {actualReturn != null ? '$' + actualReturn.dollar.toFixed(2) : '-'}
                  </td>
                </tr>
                <tr className="border-b border-zinc-100 dark:border-zinc-800">
                  <td className={'py-2 ' + T}>R:R</td>
                  <td className={'py-2 text-right tabular-nums ' + V}>
                    {planRR != null ? '1:' + planRR : '-'}
                  </td>
                  <td className={'py-2 text-right tabular-nums ' + V}>
                    {actualRR != null ? '1:' + actualRR : (actualReturn != null ? '1:0' : '-')}
                  </td>
                </tr>
                <tr>
                  <td className={'py-2 ' + T}>Account Risk %</td>
                  <td className={'py-2 text-right tabular-nums text-zinc-500'}>-</td>
                  <td className={'py-2 text-right tabular-nums ' + V}>
                    {riskSnapshot.accountRiskPct != null ? riskSnapshot.accountRiskPct.toFixed(2) + '%' : '-'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div className={T}>Risk %</div>
            <div className="tabular-nums text-red-600 dark:text-red-400">
              {actualRiskPct != null ? actualRiskPct.toFixed(2) + '%' : '-'}
            </div>
            <div className={T}>Risk $</div>
            <div className="tabular-nums text-red-600 dark:text-red-400">
              {actualRiskDollar != null ? '$' + actualRiskDollar.toFixed(2) : '-'}
            </div>
            <div className={T}>Return %</div>
            <div className={V}>
              {riskSnapshot.plannedRewardRisk != null ? '1:' + riskSnapshot.plannedRewardRisk.toFixed(2) : '-'}
            </div>
            <div className={T}>Return $</div>
            <div className="tabular-nums text-zinc-500">-</div>
            <div className={T}>Account Risk %</div>
            <div className={V}>
              {riskSnapshot.accountRiskPct != null ? riskSnapshot.accountRiskPct.toFixed(2) + '%' : '-'}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
