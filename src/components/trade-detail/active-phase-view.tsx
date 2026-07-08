'use client';

import { useState } from 'react';
import { PlusCircle } from 'lucide-react';
import { LifecycleStepper } from '@/components/lifecycle-stepper';
import TradeDetailHeader from './trade-detail-header';
import TradePlanCard from './trade-plan-card';
import RiskSnapshotCard from './risk-snapshot-card';
import TradeLifecycleSummaryCard from './trade-lifecycle-summary-card';
import TradePnlCard from './trade-pnl-card';
import TradeExecutionsCard from './trade-executions-card';
import TradeStopAdjustmentsCard from './trade-stop-adjustments-card';
import TradeCheckResultsCard from './trade-check-results-card';
import { AddExitDialog } from '@/components/add-exit-dialog';
import { Button } from '@/components/ui/button';
import TradeAssetsCard from './trade-assets-card';
import type { Trade, Execution, RiskSnapshot, StopAdjustment, TradeAsset, CheckResult } from './types';
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
  checkResults: CheckResult[];
  onAdjustmentAdded: () => Promise<void>;
  onAssetsChanged: () => Promise<void>;
  onRiskSnapshotSave: (payload: Record<string, number | null>) => Promise<void>;
  onExecutionAdded?: () => void;
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
  checkResults,
  onAdjustmentAdded,
  onAssetsChanged,
  onRiskSnapshotSave,
  onExecutionAdded,
}: ActivePhaseViewProps) {
  const [exitDialogOpen, setExitDialogOpen] = useState(false);
  const entryManagementAssets = assets.filter(
    (a) => a.phase === 'entry' || a.phase === 'management',
  );

  return (
    <>
      <TradeDetailHeader
        symbol={trade.symbol}
        status={trade.status}
        direction={trade.direction}
        tradeCode={trade.tradeCode}
      />

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
        <div className="mb-8">
          <TradeLifecycleSummaryCard
            status={trade.status}
            openedAt={derivedStatus.openedAt}
            closedAt={derivedStatus.closedAt}
            openQuantity={derivedStatus.openQuantity}
          />
        </div>
      )}

      {/* P&L-R Metrics */}
      {pnlResult && (
        <div className="mb-8">
          <TradePnlCard
            realizedPnl={pnlResult.totalRealizedPnL}
            rMultiple={rMultiple?.rMultiple ?? null}
            avgEntryPrice={pnlResult.avgEntryPrice}
            totalEntryQty={pnlResult.totalEntryQty}
            totalExitQty={pnlResult.totalExitQty}
          />
        </div>
      )}

      {/* Executions */}
      <div className="mb-8">
        <TradeExecutionsCard
          executions={executions}
          actions={
            trade.status === 'open' && onExecutionAdded ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setExitDialogOpen(true)}
              >
                <PlusCircle className="mr-1.5 size-3.5" />
                Add Exit
              </Button>
            ) : undefined
          }
        />
      </div>

      {/* Add Exit Dialog */}
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

      {/* Stop Adjustments */}
      <div className="mb-8">
        <TradeStopAdjustmentsCard
          stopAdjustments={stopAdjustments}
          tradeId={trade.id}
          onAdjustmentAdded={onAdjustmentAdded}
        />
      </div>

      {/* Pre-Execution Checklist Audit */}
      <div className="mb-8">
        <TradeCheckResultsCard checkResults={checkResults} />
      </div>

      {/* Assets — entry/management only */}
      <div className="mb-8">
        <TradeAssetsCard
          assets={entryManagementAssets}
          tradeId={trade.id}
          onAssetsChanged={onAssetsChanged}
        />
      </div>
    </>
  );
}
