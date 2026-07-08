'use client';

import { useState } from 'react';
import { PlusCircle } from 'lucide-react';
import { LifecycleStepper } from '@/components/lifecycle-stepper';
import TradeDetailHeader from './trade-detail-header';
import TradeLifecycleSummaryCard from './trade-lifecycle-summary-card';
import TradePnlCard from './trade-pnl-card';
import TradeExecutionsCard from './trade-executions-card';
import TradeStopAdjustmentsCard from './trade-stop-adjustments-card';
import TradeCheckResultsCard from './trade-check-results-card';
import TradeGradeCard from './trade-grade-card';
import type { GradeFormPayload } from './trade-grade-card';
import TradeMistakesCard from './trade-mistakes-card';
import TradeAssetsCard from './trade-assets-card';
import TradeExitNotesCard from './trade-exit-notes-card';
import { AddExitDialog } from '@/components/add-exit-dialog';
import { Button } from '@/components/ui/button';
import type { Trade, Execution, TradeGrade, TradeMistake, LookupValue, TradeAsset, StopAdjustment, CheckResult } from './types';
import type { DeriveStatusResult } from '@/lib/trade-calc';

interface ClosedPhaseViewProps {
  trade: Trade;
  executions: Execution[];
  grade: TradeGrade | null;
  mistakes: TradeMistake[];
  mistakeTypes: LookupValue[];
  assets: TradeAsset[];
  derivedStatus: DeriveStatusResult | null;
  pnlResult: { totalRealizedPnL: number; avgEntryPrice: number | null; totalEntryQty: number; totalExitQty: number } | null;
  rMultiple: { rMultiple: number | null } | null;
  stopAdjustments: StopAdjustment[];
  checkResults: CheckResult[];
  onAdjustmentAdded: () => Promise<void>;
  onAssetsChanged: () => Promise<void>;
  onMistakesChanged: () => Promise<void>;
  onGradeSave: (payload: GradeFormPayload) => Promise<void>;
  onExecutionAdded?: () => void;
}

export default function ClosedPhaseView({
  trade,
  executions,
  grade,
  mistakes,
  mistakeTypes,
  assets,
  derivedStatus,
  pnlResult,
  rMultiple,
  stopAdjustments,
  checkResults,
  onAdjustmentAdded,
  onAssetsChanged,
  onMistakesChanged,
  onGradeSave,
  onExecutionAdded,
}: ClosedPhaseViewProps) {
  const [exitDialogOpen, setExitDialogOpen] = useState(false);

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
            onExecutionAdded ? (
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

      {/* Trade Grade */}
      <div className="mb-8">
        <TradeGradeCard
          grade={grade}
          tradeStatus={trade.status}
          onSave={onGradeSave}
        />
      </div>

      {/* Mistakes */}
      <div className="mb-8">
        <TradeMistakesCard
          mistakes={mistakes}
          mistakeTypes={mistakeTypes}
          tradeId={trade.id}
          onMistakesChanged={onMistakesChanged}
        />
      </div>

      {/* Assets — all phases */}
      <div className="mb-8">
        <TradeAssetsCard
          assets={assets}
          tradeId={trade.id}
          onAssetsChanged={onAssetsChanged}
        />
      </div>

      {/* Exit Notes + Lesson */}
      <div className="mb-8">
        <TradeExitNotesCard
          exitNotes={trade.exitNotes}
          lesson={trade.lesson}
        />
      </div>
    </>
  );
}
