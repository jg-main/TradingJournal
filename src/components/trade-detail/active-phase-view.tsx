'use client';

import { useState } from 'react';
import { PlusCircle, MoreHorizontal, Pencil, RefreshCw } from 'lucide-react';
import { LifecycleStepper } from '@/components/lifecycle-stepper';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import TradeDetailHeader from './trade-detail-header';
import RiskSnapshotCard from './risk-snapshot-card';
import TradeLifecycleSummaryCard from './trade-lifecycle-summary-card';
import PriceWidget from './price-widget';
import TradePnlCard from './trade-pnl-card';
import TradeExecutionsCard from './trade-executions-card';
import TradeStopAdjustmentsCard from './trade-stop-adjustments-card';
import TradeCheckResultsCard from './trade-check-results-card';
import { AddExitDialog } from '@/components/add-exit-dialog';
import { Button } from '@/components/ui/button';
import TradeAssetsCard from './trade-assets-card';
import type { Trade, Execution, RiskSnapshot, StopAdjustment, TradeAsset, CheckResult, MtmData } from './types';
import type { DeriveStatusResult } from '@/lib/trade-calc';
import type { PerfMetrics } from '@/lib/perf-metrics';

interface ActivePhaseViewProps {
  trade: Trade;
  executions: Execution[];
  riskSnapshot: RiskSnapshot | null;
  stopAdjustments: StopAdjustment[];
  assets: TradeAsset[];
  derivedStatus: DeriveStatusResult | null;
  pnlResult: { totalRealizedPnL: number; avgEntryPrice: number | null; totalEntryQty: number; totalExitQty: number } | null;
  rMultiple: { rMultiple: number | null; initialRiskUsed: boolean } | null;
  perfMetrics: PerfMetrics | null;
  checkResults: CheckResult[];
  mtmData: MtmData;
  onRefreshPrice: () => void;
  onAdjustmentAdded: () => Promise<void>;
  onAssetsChanged: () => Promise<void>;
  onExecutionAdded?: () => void;
  onEdit?: () => void;
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
  perfMetrics,
  checkResults,
  mtmData,
  onRefreshPrice,
  onAdjustmentAdded,
  onAssetsChanged,
  onExecutionAdded,
  onEdit,
}: ActivePhaseViewProps) {
  const [exitDialogOpen, setExitDialogOpen] = useState(false);
  const entryManagementAssets = assets.filter(
    (a) => a.phase === 'entry' || a.phase === 'management',
  );

  // ── Compute MTM unrealized values for the top P&L card ──
  const hasMtmPrice = mtmData?.price != null;
  const dir = trade.direction;
  const entryPrice = pnlResult?.avgEntryPrice ?? null;
  const entryQty = pnlResult?.totalEntryQty ?? 0;
  const derivedRiskAmount =
    riskSnapshot?.initialRiskAmount ??
    (riskSnapshot?.initialEntryPrice != null &&
     riskSnapshot?.initialStopPrice != null &&
     riskSnapshot?.initialQuantity != null
      ? Math.abs(riskSnapshot.initialEntryPrice - riskSnapshot.initialStopPrice) * riskSnapshot.initialQuantity
      : null);

  const unrealizedPnl =
    hasMtmPrice && entryPrice != null && entryQty > 0
      ? dir === 'long'
        ? (mtmData!.price! - entryPrice) * entryQty
        : (entryPrice - mtmData!.price!) * entryQty
      : null;
  const unrealizedReturnPct =
    unrealizedPnl != null && entryPrice != null && entryQty > 0
      ? (unrealizedPnl / (entryPrice * entryQty)) * 100
      : null;
  const unrealizedRMultiple =
    unrealizedPnl != null && derivedRiskAmount != null && derivedRiskAmount > 0
      ? unrealizedPnl / derivedRiskAmount
      : null;

  return (
    <>
      {/* ── Compact header ── */}
      <TradeDetailHeader
        symbol={trade.symbol}
        status={trade.status}
        direction={trade.direction}
        tradeCode={trade.tradeCode}
        openedAt={trade.openedAt}
        setupName={trade.setupName}
        rightContent={
          <div className="flex items-center gap-1">
            <Button variant="default" size="sm" onClick={() => setExitDialogOpen(true)}>
              <PlusCircle className="mr-1.5 size-3.5" />
              Add Exit
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="size-8" aria-label="More actions">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onEdit?.()}>
                  <Pencil className="size-4" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onRefreshPrice} disabled={mtmData?.loading}>
                  <RefreshCw className={`size-4 ${mtmData?.loading ? 'animate-spin' : ''}`} />
                  {mtmData?.loading ? 'Refreshing...' : 'Refresh'}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      {/* ── Lifecycle Stepper (useful during active trade) ── */}
      <div className="mb-8">
        <LifecycleStepper
          status={trade.status}
          direction={trade.direction}
          openedAt={trade.openedAt}
          exitNotes={trade.exitNotes}
          lesson={trade.lesson}
        />
      </div>

      {/* ── Price Widget ── */}
      <div className="mb-8">
        <PriceWidget mtmData={mtmData} onRefreshPrice={onRefreshPrice} />
      </div>

      {/* ── P&L-R Metrics first (the most important outcome) ── */}
      <div className="mb-8">
        <TradePnlCard
          realizedPnl={pnlResult?.totalRealizedPnL ?? 0}
          rMultiple={rMultiple?.rMultiple ?? null}
          avgEntryPrice={pnlResult?.avgEntryPrice ?? null}
          totalEntryQty={pnlResult?.totalEntryQty ?? 0}
          totalExitQty={pnlResult?.totalExitQty ?? 0}
          duration={perfMetrics?.duration ?? null}
          returnPercent={perfMetrics?.returnPercent ?? null}
          totalFees={perfMetrics?.totalFees ?? 0}
          unrealizedPnl={unrealizedPnl}
          unrealizedReturnPct={unrealizedReturnPct}
          unrealizedRMultiple={unrealizedRMultiple}
          setupName={trade.setupName}
        />
      </div>

      {/* ── Unified Plan vs Actual (single card) ── */}
      <div className="mb-8">
        <RiskSnapshotCard
          riskSnapshot={riskSnapshot}
          plannedValues={trade}
          actualValues={{ avgEntryPrice: pnlResult?.avgEntryPrice ?? null, avgExitPrice: null }}
          mtmData={mtmData}
          onRefreshPrice={onRefreshPrice}
          tradeStatus={trade.status}
          thesis={trade.thesis}
          invalidationCondition={trade.invalidationCondition}
          preTradePlan={trade.preTradePlan}
        />
      </div>

      {/* ── Lifecycle Summary ── */}
      {derivedStatus && (
        <div className="mb-8">
          <TradeLifecycleSummaryCard
            status={trade.status}
            openedAt={derivedStatus.openedAt}
            closedAt={derivedStatus.closedAt}
            openQuantity={derivedStatus.openQuantity}
          />
        </div>
      )}

      {/* ── Executions ── */}
      <div className="mb-8">
        <TradeExecutionsCard
          executions={executions}
          tradeId={trade.id}
          onComplete={onExecutionAdded ?? (() => {})}
        />
      </div>

      <AddExitDialog
        trade={{
          id: trade.id,
          symbol: trade.symbol,
          direction: trade.direction,
          plannedQuantity: trade.plannedQuantity,
        }}
        open={exitDialogOpen}
        onOpenChange={setExitDialogOpen}
        onComplete={() => {
          onExecutionAdded?.();
          setExitDialogOpen(false);
        }}
      />

      {/* ── Stop Adjustments ── */}
      <div className="mb-8">
        <TradeStopAdjustmentsCard
          stopAdjustments={stopAdjustments}
          tradeId={trade.id}
          tradeStatus={trade.status}
          onAdjustmentAdded={onAdjustmentAdded}
        />
      </div>

      {/* ── Checklist ── */}
      <div className="mb-8">
        <TradeCheckResultsCard checkResults={checkResults} />
      </div>

      {/* ── Assets ── */}
      <div className="mb-8">
        <TradeAssetsCard
          assets={entryManagementAssets}
          tradeId={trade.id}
          onAssetsChanged={onAssetsChanged}
          defaultPhase="entry"
        />
      </div>
    </>
  );
}
