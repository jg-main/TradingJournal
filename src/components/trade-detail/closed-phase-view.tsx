'use client';

import { useState } from 'react';
import { TrendingUp, TrendingDown, PlusCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { LifecycleStepper } from '@/components/lifecycle-stepper';
import { statusBadgeVariant, statusLabel } from './helpers';
import TradeLifecycleSummaryCard from './trade-lifecycle-summary-card';
import TradePnlCard from './trade-pnl-card';
import TradeExecutionsCard from './trade-executions-card';
import TradeStopAdjustmentsCard from './trade-stop-adjustments-card';
import TradeGradeCard from './trade-grade-card';
import type { GradeFormPayload } from './trade-grade-card';
import TradeMistakesCard from './trade-mistakes-card';
import TradeAssetsCard from './trade-assets-card';
import TradeExitNotesCard from './trade-exit-notes-card';
import { AddExitDialog } from '@/components/add-exit-dialog';
import { Button } from '@/components/ui/button';
import type { Trade, Execution, TradeGrade, TradeMistake, LookupValue, TradeAsset, StopAdjustment } from './types';
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
  onAdjustmentAdded,
  onAssetsChanged,
  onMistakesChanged,
  onGradeSave,
  onExecutionAdded,
}: ClosedPhaseViewProps) {
  const [exitDialogOpen, setExitDialogOpen] = useState(false);
  const badgeInfo = statusBadgeVariant(trade.status);

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
          <p className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
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
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
            Executions
          </h3>
          {onExecutionAdded && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setExitDialogOpen(true)}
            >
              <PlusCircle className="mr-1.5 size-3.5" />
              Add Exit
            </Button>
          )}
        </div>
        <TradeExecutionsCard executions={executions} />
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
      <TradeStopAdjustmentsCard
        stopAdjustments={stopAdjustments}
        tradeId={trade.id}
        onAdjustmentAdded={onAdjustmentAdded}
      />

      {/* Trade Grade */}
      <TradeGradeCard
        grade={grade}
        tradeStatus={trade.status}
        onSave={onGradeSave}
      />

      {/* Mistakes */}
      <TradeMistakesCard
        mistakes={mistakes}
        mistakeTypes={mistakeTypes}
        tradeId={trade.id}
        onMistakesChanged={onMistakesChanged}
      />

      {/* Assets — all phases */}
      <TradeAssetsCard
        assets={assets}
        tradeId={trade.id}
        onAssetsChanged={onAssetsChanged}
      />

      {/* Exit Notes + Lesson */}
      <TradeExitNotesCard
        exitNotes={trade.exitNotes}
        lesson={trade.lesson}
      />
    </>
  );
}
