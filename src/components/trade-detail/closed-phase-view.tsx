'use client';

import { useEffect, useState } from 'react';
import { MoreHorizontal, Pencil, Brain, Loader2 } from 'lucide-react';
import { LifecycleStepper } from '@/components/lifecycle-stepper';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import TradeDetailHeader from './trade-detail-header';
import TradeLifecycleSummaryCard from './trade-lifecycle-summary-card';
import RiskSnapshotCard from './risk-snapshot-card';
import TradeHistoryFeed, { type LevelHistoryEvent } from './trade-history-feed';
import PriceWidget from './price-widget';
import TradePnlCard from './trade-pnl-card';
import TradeCheckResultsCard from './trade-check-results-card';
import TradeGradeCard from './trade-grade-card';
import type { GradeFormPayload } from './trade-grade-card';
import TradeMistakesCard from './trade-mistakes-card';
import TradeAssetsCard from './trade-assets-card';
import TradeExitNotesCard from './trade-exit-notes-card';
import AssessmentCard from './assessment-card';
import AssessmentHistory from './assessment-history';
import type { AssessmentSnapshot } from './assessment-history';
import { TradeDetailGrid, TradeDetailPanel, TradeDetailStack } from './trade-detail-grid';
import { TradeCollapsibleReviewSection } from './trade-collapsible-review-section';
import TradeContextBand from './trade-context-band';
import type { Trade, Execution, TradeGrade, TradeMistake, LookupValue, TradeAsset, StopAdjustment, TargetAdjustment, CheckResult, RiskSnapshot, MtmData } from './types';
import type { DeriveStatusResult } from '@/lib/trade-metrics';
import type { PerfMetrics } from '@/lib/perf-metrics';

interface ClosedPhaseViewProps {
  trade: Trade;
  executions: Execution[];
  /** Stop/target adjustment events from the S01 level-history API, for the unified history feed. */
  levelHistoryEvents: LevelHistoryEvent[];
  riskSnapshot: RiskSnapshot | null;
  grade: TradeGrade | null;
  mistakes: TradeMistake[];
  mistakeTypes: LookupValue[];
  assets: TradeAsset[];
  derivedStatus: DeriveStatusResult | null;
  pnlResult: { totalRealizedPnL: number; avgEntryPrice: number | null; totalEntryQty: number; totalExitQty: number } | null;
  rMultiple: { rMultiple: number | null; initialRiskUsed: boolean } | null;
  perfMetrics: PerfMetrics | null;
  mtmData: MtmData;
  onRefreshPrice: () => void;
  stopAdjustments: StopAdjustment[];
  targetAdjustments: TargetAdjustment[];
  checkResults: CheckResult[];
  /** Called after a TradeDetailsCard level edit so the page refetches both chains. */
  onAdjustmentsChanged: () => Promise<void>;
  onAssetsChanged: () => Promise<void>;
  onMistakesChanged: () => Promise<void>;
  onGradeSave: (payload: GradeFormPayload) => Promise<void>;
  onExecutionAdded?: () => void;
  onEdit?: () => void;
  /** M019/S04/T02: opens the page-owned AddFillDialog (threaded to TradeDetailsCard). */
  onAddFill?: () => void;
  /** Opens the page-owned accounting correction workflow for a fill. */
  onCorrectExecution?: (execution: Execution) => void;
}


export default function ClosedPhaseView({
  trade,
  executions,
  levelHistoryEvents,
  riskSnapshot,
  grade,
  mistakes,
  mistakeTypes,
  assets,
  derivedStatus,
  pnlResult,
  rMultiple,
  perfMetrics,
  mtmData,
  onRefreshPrice,
  stopAdjustments,
  targetAdjustments,
  checkResults,
  onAdjustmentsChanged,
  onAssetsChanged,
  onMistakesChanged,
  onGradeSave,
  onExecutionAdded,
  onEdit,
  onAddFill,
  onCorrectExecution,
}: ClosedPhaseViewProps) {

  const exitExecs = executions.filter((e) =>
    trade.direction === 'long'
      ? e.action === 'sell' || e.action === 'reduce'
      : e.action === 'buy_to_cover'
  );
  const avgExitPrice = exitExecs.length > 0
    ? exitExecs.reduce((sum, e) => sum + e.price * e.quantity, 0) / exitExecs.reduce((sum, e) => sum + e.quantity, 0)
    : null;
  const hasContextContent = Boolean(
    trade.thesis || trade.invalidationCondition || trade.preTradePlan,
  );

  // ── AI Assessment State ──
  const [assessments, setAssessments] = useState<AssessmentSnapshot[]>([]);
  const [assessmentsLoading, setAssessmentsLoading] = useState(true);
  const [assessmentsError, setAssessmentsError] = useState<string | null>(null);
  const [requestLoading, setRequestLoading] = useState(false);

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
          ) return;
          setAssessmentsError(String(err));
        }
      } finally {
        if (!cancelled) setAssessmentsLoading(false);
      }
    }
    fetchAssessments();
    return () => { cancelled = true; };
  }, [trade.id]);

  const handleRequestAssessment = async () => {
  // Expose assess handler to parent for the top-bar button
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
        if (errorCode === 'STALE_MARKET_DATA') setAssessmentsError('Market data is not current — try again later');
        else if (errorCode === 'AI_NOT_CONFIGURED') setAssessmentsError('AI not configured — set up in Settings');
        else if (errorCode === 'AI_PROVIDER_ERROR') setAssessmentsError('AI provider error — check credentials');
        else setAssessmentsError(rawMessage);
        return;
      }
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

  const latestAssessment = assessments.length > 0 ? assessments[0] : null;

  return (
    <>
      {/* ── Closed grid: lifecycle | left stack/risk/right stack ── */}
      <TradeDetailGrid variant="closed" hasContextContent={hasContextContent}>
        <TradeDetailPanel area="lifecycle" title="Lifecycle">
          <LifecycleStepper
            status={trade.status}
            direction={trade.direction}
            openedAt={trade.openedAt}
            exitNotes={trade.exitNotes}
            lesson={trade.lesson}
            hasGrade={!!grade}
            hasMistakes={mistakes.length > 0}
          />
        </TradeDetailPanel>

        <TradeDetailStack area="left">
          {/* Cockpit: identity + actions + frozen price + compact lifecycle summary. */}
          <TradeDetailPanel area="cockpit" title="Cockpit">
          <TradeDetailHeader
            symbol={trade.symbol}
            status={trade.status}
            direction={trade.direction}
            tradeCode={trade.tradeCode}
            openedAt={trade.openedAt}
            setupName={trade.setupName}
            gradeLabel={grade?.gradeLabel ?? null}
            rightContent={
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center justify-center rounded-md border border-border p-2 text-foreground hover:bg-muted dark:border-input dark:hover:bg-input/50"
                    aria-label="More actions"
                  >
                    <MoreHorizontal className="size-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onEdit?.()}>
                    <Pencil className="size-4" />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleRequestAssessment} disabled={requestLoading}>
                    {requestLoading ? <Loader2 className="size-4 animate-spin" /> : <Brain className="size-4" />}
                    {requestLoading ? 'Assessing...' : 'Assess'}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            }
          />

          <PriceWidget mtmData={mtmData} onRefreshPrice={onRefreshPrice} frozen />

          {derivedStatus && (
            <TradeLifecycleSummaryCard
              status={trade.status}
              openedAt={derivedStatus.openedAt}
              closedAt={derivedStatus.closedAt}
              openQuantity={derivedStatus.openQuantity}
            />
          )}
          </TradeDetailPanel>

          {/* History: unified stop/target/execution timeline (own title) */}
          <TradeDetailPanel area="history">
            <TradeHistoryFeed
              levelHistoryEvents={levelHistoryEvents}
              executions={executions}
              onCorrectExecution={onCorrectExecution}
            />
          </TradeDetailPanel>
        </TradeDetailStack>

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
            setupName={trade.setupName}
          />
          <RiskSnapshotCard
            riskSnapshot={riskSnapshot}
            plannedValues={trade}
            actualValues={{ avgEntryPrice: pnlResult?.avgEntryPrice ?? null, avgExitPrice }}
            currentQuantity={derivedStatus?.openQuantity ?? null}
            tradeStatus={trade.status}
            stopAdjustments={stopAdjustments}
            targetAdjustments={targetAdjustments}
            tradeId={trade.id}
            onAdjustmentsChanged={onAdjustmentsChanged}
            onAddFill={onAddFill}
          />
        </TradeDetailPanel>

        <TradeDetailStack area="right">
          {hasContextContent && (
            <TradeDetailPanel area="context" title="Context">
              <TradeContextBand
                thesis={trade.thesis}
                invalidationCondition={trade.invalidationCondition}
                preTradePlan={trade.preTradePlan}
              />
            </TradeDetailPanel>
          )}

          {/* Review: checklist (stays visible — critical evidence never hides
              inside a collapsible) above the collapsible grade / mistakes /
              AI assessment / exit-notes sections. */}
          <TradeDetailPanel area="review" title="Review">
          <TradeCheckResultsCard checkResults={checkResults} />

          <TradeCollapsibleReviewSection
            title="Grade"
            meta={grade ? grade.gradeLabel : undefined}
          >
            <TradeGradeCard grade={grade} tradeStatus={trade.status} onSave={onGradeSave} />
          </TradeCollapsibleReviewSection>

          <TradeCollapsibleReviewSection
            title="Mistakes"
            meta={mistakes.length > 0 ? `${mistakes.length} recorded` : undefined}
          >
            <TradeMistakesCard
              mistakes={mistakes}
              mistakeTypes={mistakeTypes}
              tradeId={trade.id}
              onMistakesChanged={onMistakesChanged}
            />
          </TradeCollapsibleReviewSection>

          <TradeCollapsibleReviewSection title="AI Assessment">
            <AssessmentCard
              scorecard={latestAssessment?.scorecard ?? null}
              loading={assessmentsLoading}
              error={assessmentsError}
              onRequestAssessment={handleRequestAssessment}
              requestLoading={requestLoading}
              promptText={latestAssessment?.promptText}
              rawResponse={latestAssessment?.rawResponse}
            />
            <AssessmentHistory
              assessments={assessments}
              loading={assessmentsLoading}
              error={assessmentsError}
            />
          </TradeCollapsibleReviewSection>

          {/* Exit notes are the one review section that may be absent
              entirely — no empty titled section when the trade has no notes
              (same pattern as the context band in S01/S03). */}
          {(trade.exitNotes || trade.lesson) && (
            <TradeCollapsibleReviewSection title="Exit Notes">
              <TradeExitNotesCard exitNotes={trade.exitNotes} lesson={trade.lesson} />
            </TradeCollapsibleReviewSection>
          )}
          </TradeDetailPanel>
        </TradeDetailStack>
      </TradeDetailGrid>

      {/* Assets remain below the grid so post-mortem evidence does not expand
          the monitoring/review hierarchy. */}
      <div className="mt-8">
        <TradeAssetsCard
          assets={assets}
          tradeId={trade.id}
          onAssetsChanged={onAssetsChanged}
          defaultPhase="review"
        />
      </div>

    </>
  );
}
