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
import TradeHistoryFeed, { type LevelHistoryEvent } from './trade-history-feed';
import PriceWidget from './price-widget';
import TradePnlCard from './trade-pnl-card';
import TradeCheckResultsCard from './trade-check-results-card';
import { AddExitDialog } from '@/components/add-exit-dialog';
import { Button } from '@/components/ui/button';
import { TradeDetailGrid, TradeDetailPanel } from './trade-detail-grid';
import TradeAssetsCard from './trade-assets-card';
import type { Trade, Execution, RiskSnapshot, StopAdjustment, TargetAdjustment, TradeAsset, CheckResult, MtmData } from './types';
import type { DeriveStatusResult } from '@/lib/trade-metrics';
import type { PerfMetrics } from '@/lib/perf-metrics';

interface ActivePhaseViewProps {
  trade: Trade;
  executions: Execution[];
  /** Stop/target adjustment events from the S01 level-history API, for the unified history feed. */
  levelHistoryEvents: LevelHistoryEvent[];
  riskSnapshot: RiskSnapshot | null;
  stopAdjustments: StopAdjustment[];
  targetAdjustments: TargetAdjustment[];
  assets: TradeAsset[];
  derivedStatus: DeriveStatusResult | null;
  pnlResult: { totalRealizedPnL: number; avgEntryPrice: number | null; totalEntryQty: number; totalExitQty: number } | null;
  rMultiple: { rMultiple: number | null; initialRiskUsed: boolean } | null;
  perfMetrics: PerfMetrics | null;
  checkResults: CheckResult[];
  mtmData: MtmData;
  onRefreshPrice: () => void;
  /** Called after a TradeDetailsCard level edit so the page refetches both chains. */
  onAdjustmentsChanged: () => Promise<void>;
  onAssetsChanged: () => Promise<void>;
  onExecutionAdded?: () => void;
  onEdit?: () => void;
  /** M019/S04/T02: opens the page-owned AddFillDialog (threaded to TradeDetailsCard). */
  onAddFill?: () => void;
  /** Opens the page-owned accounting correction workflow for a fill. */
  onCorrectExecution?: (execution: Execution) => void;
  /** Canonical unrealized values from API metrics (FIFO-aware, partial-exit accurate) */
  unrealizedPnl?: number | null;
  unrealizedReturnPct?: number | null;
  unrealizedRMultiple?: number | null;
}

export default function ActivePhaseView({
  trade,
  executions,
  levelHistoryEvents,
  riskSnapshot,
  stopAdjustments,
  targetAdjustments,
  assets,
  derivedStatus,
  pnlResult,
  rMultiple,
  perfMetrics,
  checkResults,
  mtmData,
  onRefreshPrice,
  onAdjustmentsChanged,
  onAssetsChanged,
  onExecutionAdded,
  onEdit,
  onAddFill,
  onCorrectExecution,
  unrealizedPnl,
  unrealizedReturnPct,
  unrealizedRMultiple,
}: ActivePhaseViewProps) {
  const [exitDialogOpen, setExitDialogOpen] = useState(false);

  return (
    <>
      {/* ── Monitoring grid (M020/S01): cockpit | risk | history | review ── */}
      <TradeDetailGrid>
        {/* Cockpit: identity + price + actions + compact lifecycle summary */}
        <TradeDetailPanel area="cockpit" title="Cockpit">
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
          <PriceWidget mtmData={mtmData} onRefreshPrice={onRefreshPrice} />
          {derivedStatus && (
            <TradeLifecycleSummaryCard
              status={trade.status}
              openedAt={derivedStatus.openedAt}
              closedAt={derivedStatus.closedAt}
              openQuantity={derivedStatus.openQuantity}
            />
          )}
        </TradeDetailPanel>

        {/* Risk: P&L / R + plan vs actual + levels + inline editing */}
        <TradeDetailPanel area="risk" title="Risk">
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
          <RiskSnapshotCard
            riskSnapshot={riskSnapshot}
            plannedValues={trade}
            actualValues={{ avgEntryPrice: pnlResult?.avgEntryPrice ?? null, avgExitPrice: null }}
            currentQuantity={derivedStatus?.openQuantity ?? null}
            mtmData={mtmData}
            onRefreshPrice={onRefreshPrice}
            tradeStatus={trade.status}
            stopAdjustments={stopAdjustments}
            targetAdjustments={targetAdjustments}
            tradeId={trade.id}
            onAdjustmentsChanged={onAdjustmentsChanged}
            onAddFill={onAddFill}
          />
        </TradeDetailPanel>

        {/* History: unified stop/target/execution timeline (own title) */}
        <TradeDetailPanel area="history">
          <TradeHistoryFeed
            levelHistoryEvents={levelHistoryEvents}
            executions={executions}
            onCorrectExecution={onCorrectExecution}
          />
        </TradeDetailPanel>

        {/* Review: pre-execution checklist */}
        <TradeDetailPanel area="review" title="Review">
          <TradeCheckResultsCard checkResults={checkResults} />
        </TradeDetailPanel>
      </TradeDetailGrid>

      {/* ── Below the grid (document flow) ── */}
      <div className="mt-8">
        <LifecycleStepper
          status={trade.status}
          direction={trade.direction}
          openedAt={trade.openedAt}
          exitNotes={trade.exitNotes}
          lesson={trade.lesson}
        />
      </div>

      <div className="mt-8">
        <TradeAssetsCard
          assets={assets}
          tradeId={trade.id}
          onAssetsChanged={onAssetsChanged}
          defaultPhase="entry"
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
    </>
  );
}
