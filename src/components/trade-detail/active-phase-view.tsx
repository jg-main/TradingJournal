'use client';

import { TrendingUp, TrendingDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { LifecycleStepper } from '@/components/lifecycle-stepper';
import { statusBadgeVariant, statusLabel } from './helpers';
import TradePlanCard from './trade-plan-card';
import RiskSnapshotCard from './risk-snapshot-card';
import TradeLifecycleSummaryCard from './trade-lifecycle-summary-card';
import TradePnlCard from './trade-pnl-card';
import TradeExecutionsCard from './trade-executions-card';
import TradeStopAdjustmentsCard from './trade-stop-adjustments-card';
import TradeAssetsCard from './trade-assets-card';
import type { Trade, Execution, RiskSnapshot, StopAdjustment, TradeAsset } from './types';
import type { DeriveStatusResult } from '@/lib/trade-calc';

interface ActivePhaseViewProps {
  trade: Trade;
  executions: Execution[];
  riskSnapshot: RiskSnapshot | null;
  stopAdjustments: StopAdjustment[];
  assets: TradeAsset[];
  derivedStatus: DeriveStatusResult | null;
  pnlResult: { totalRealizedPnL: number; avgEntryPrice: number | null; totalEntryQty: number; totalExitQty: number } | null;
  rMultiple: { rMultiple: number | null } | null;
  onAdjustmentAdded: () => Promise<void>;
  onAssetsChanged: () => Promise<void>;
  onRiskSnapshotSave: (payload: Record<string, number | null>) => Promise<void>;
}

export default function ActivePhaseView({
  trade,
  executions,
  riskSnapshot,
  stopAdjustments,
  assets,
  derivedStatus,
  pnlResult,
  rMultiple,
  onAdjustmentAdded,
  onAssetsChanged,
  onRiskSnapshotSave,
}: ActivePhaseViewProps) {
  const badgeInfo = statusBadgeVariant(trade.status);
  const entryManagementAssets = assets.filter(
    (a) => a.phase === 'entry' || a.phase === 'management',
  );

  return (
    <>
      {/* Header */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <div className="mb-2 flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              {trade.symbol}
            </h1>
            <Badge variant={badgeInfo.variant} className={badgeInfo.className}>
              {statusLabel(trade.status)}
            </Badge>
            {trade.direction === 'long' ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                <TrendingUp className="size-3" />
                Long
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
                <TrendingDown className="size-3" />
                Short
              </span>
            )}
          </div>
          <p className="font-mono text-xs text-zinc-400 dark:text-zinc-500">
            {trade.tradeCode}
          </p>
        </div>
      </div>

      {/* Lifecycle Stepper */}
      <div className="mb-8">
        <LifecycleStepper
          status={trade.status}
          direction={trade.direction}
          openedAt={trade.openedAt}
          exitNotes={trade.exitNotes}
          lesson={trade.lesson}
        />
      </div>

      {/* Grid: Trade Plan + Risk Snapshot */}
      <div className="mb-8 grid gap-6 md:grid-cols-2">
        <TradePlanCard trade={trade} />
        <RiskSnapshotCard
          riskSnapshot={riskSnapshot}
          onSave={onRiskSnapshotSave}
        />
      </div>

      {/* Lifecycle Summary */}
      {derivedStatus && (
        <TradeLifecycleSummaryCard
          status={trade.status}
          openedAt={derivedStatus.openedAt}
          closedAt={derivedStatus.closedAt}
          openQuantity={derivedStatus.openQuantity}
        />
      )}

      {/* P&L-R Metrics */}
      {pnlResult && (
        <TradePnlCard
          realizedPnl={pnlResult.totalRealizedPnL}
          rMultiple={rMultiple?.rMultiple ?? null}
          avgEntryPrice={pnlResult.avgEntryPrice}
          totalEntryQty={pnlResult.totalEntryQty}
          totalExitQty={pnlResult.totalExitQty}
        />
      )}

      {/* Executions */}
      <div className="mb-8">
        <TradeExecutionsCard executions={executions} />
      </div>

      {/* Stop Adjustments */}
      <TradeStopAdjustmentsCard
        stopAdjustments={stopAdjustments}
        tradeId={trade.id}
        onAdjustmentAdded={onAdjustmentAdded}
      />

      {/* Assets — entry/management only */}
      <TradeAssetsCard
        assets={entryManagementAssets}
        tradeId={trade.id}
        onAssetsChanged={onAssetsChanged}
      />
    </>
  );
}
