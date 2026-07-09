'use client';

import { useEffect, useState } from 'react';
import { PlusCircle, Brain, Loader2 } from 'lucide-react';
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
import AssessmentCard from './assessment-card';
import AssessmentHistory from './assessment-history';
import type { AssessmentSnapshot } from './assessment-history';
import { AddExitDialog } from '@/components/add-exit-dialog';
import { Button } from '@/components/ui/button';
import type { Trade, Execution, TradeGrade, TradeMistake, LookupValue, TradeAsset, StopAdjustment, CheckResult } from './types';
import type { DeriveStatusResult } from '@/lib/trade-calc';
import type { PerfMetrics } from '@/lib/perf-metrics';
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
  perfMetrics: PerfMetrics | null;
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
  perfMetrics,
  stopAdjustments,
  checkResults,
  onAdjustmentAdded,
  onAssetsChanged,
  onMistakesChanged,
  onGradeSave,
  onExecutionAdded,
}: ClosedPhaseViewProps) {
  const [exitDialogOpen, setExitDialogOpen] = useState(false);

  // ── AI Assessment State ──────────────────────────────────────────────
  const [assessments, setAssessments] = useState<AssessmentSnapshot[]>([]);
  const [assessmentsLoading, setAssessmentsLoading] = useState(true);
  const [assessmentsError, setAssessmentsError] = useState<string | null>(null);
  const [requestLoading, setRequestLoading] = useState(false);

  // Fetch assessments on mount
  useEffect(() => {
    let cancelled = false;
    async function fetchAssessments() {
      setAssessmentsLoading(true);
      setAssessmentsError(null);
      try {
        const res = await fetch(`/api/trades/${trade.id}/assessments`);
        if (cancelled) return;
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setAssessmentsError(body.error ?? 'Failed to load assessments');
          return;
        }
        const body = await res.json();
        const data: AssessmentSnapshot[] = body.data ?? [];
        if (!cancelled) setAssessments(data);
      } catch (err) {
        if (!cancelled) {
          if (
            (err instanceof DOMException && err.name === 'AbortError') ||
            (err instanceof TypeError && /abort|cancelled/i.test(err.message))
          ) {
            return;
          }
          console.error('Assessment fetch failed:', err);
          setAssessmentsError(String(err));
        }
      } finally {
        if (!cancelled) setAssessmentsLoading(false);
      }
    }
    fetchAssessments();
    return () => {
      cancelled = true;
    };
  }, [trade.id]);

  // Handle requesting a new after-exit assessment
  const handleRequestAssessment = async () => {
    setRequestLoading(true);
    setAssessmentsError(null);
    try {
      const res = await fetch(`/api/trades/${trade.id}/assessments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessmentType: 'ai_review' }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const rawMessage = body.error ?? 'Failed to request assessment';
        const errorCode = body.code;
        if (errorCode === 'STALE_MARKET_DATA') {
          setAssessmentsError('Market data is not current — try again later');
        } else if (errorCode === 'AI_NOT_CONFIGURED') {
          setAssessmentsError('AI not configured — set up in Settings');
        } else if (errorCode === 'AI_PROVIDER_ERROR') {
          setAssessmentsError('AI provider error — check credentials');
        } else {
          setAssessmentsError(rawMessage);
        }
        console.error('Assessment POST failed:', { status: res.status, errorCode, rawMessage });
        return;
      }
      // Re-fetch the full list after creation
      const updatedRes = await fetch(`/api/trades/${trade.id}/assessments`);
      if (updatedRes.ok) {
        const body = await updatedRes.json();
        setAssessments(body.data ?? []);
      }
    } catch (err) {
      setAssessmentsError(String(err));
    } finally {
      setRequestLoading(false);
    }
  };

  // Latest assessment is the first item (sorted by snapshotVersion DESC)
  const latestAssessment = assessments.length > 0 ? assessments[0] : null;

  return (
    <>
      <TradeDetailHeader
        symbol={trade.symbol}
        status={trade.status}
        direction={trade.direction}
        tradeCode={trade.tradeCode}
        rightContent={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleRequestAssessment}
              disabled={requestLoading}
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              {requestLoading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Brain className="size-4" />
              )}
              {requestLoading ? 'Assessing...' : 'Assess'}
            </button>
          </div>
        }
      />

      {/* Lifecycle Stepper */}
      <div className="mb-8">
        <LifecycleStepper
          status={trade.status}
          direction={trade.direction}
          openedAt={trade.openedAt}
          exitNotes={trade.exitNotes}
          lesson={trade.lesson}
          hasGrade={!!grade}
          hasMistakes={mistakes.length > 0}
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
            duration={perfMetrics?.duration ?? null}
            returnPercent={perfMetrics?.returnPercent ?? null}
            totalFees={perfMetrics?.totalFees ?? 0}
          />
        </div>
      )}

      {/* Executions */}
      <div className="mb-8">
        <TradeExecutionsCard
          executions={executions}
          tradeId={trade.id}
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
          onComplete={onExecutionAdded ?? (() => {})}
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
          tradeStatus={trade.status}
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

      {/* AI Assessment — latest scorecard */}
      <div className="mb-8">
        <AssessmentCard
          scorecard={latestAssessment?.scorecard ?? null}
          loading={assessmentsLoading}
          error={assessmentsError}
          onRequestAssessment={handleRequestAssessment}
          requestLoading={requestLoading}
        />
      </div>

      {/* AI Assessment History */}
      <div className="mb-8">
        <AssessmentHistory
          assessments={assessments}
          loading={assessmentsLoading}
          error={assessmentsError}
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
