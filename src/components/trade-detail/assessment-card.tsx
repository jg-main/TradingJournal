'use client';

import { Brain, Loader2, AlertCircle, ClipboardList } from 'lucide-react';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Scorecard } from '@/lib/scorecard';

// ── Types ──────────────────────────────────────────────────────────────

export interface AssessmentCardProps {
  /** Parsed scorecard data, or null when none exists */
  scorecard: Scorecard | null;
  /** Non-fatal warnings from the assessment pipeline */
  warnings?: string[];
  /** Whether a fetch is in progress */
  loading?: boolean;
  /** User-facing error message, or null */
  error?: string | null;
  /** Callback to trigger a new assessment request */
  onRequestAssessment?: () => void;
  /** Whether an assessment request is in flight */
  requestLoading?: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────

function gradeColorClass(letter: string): string {
  switch (letter) {
    case 'A':
      return 'bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-700';
    case 'B':
      return 'bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-700';
    case 'C':
      return 'bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700';
    case 'D':
      return 'bg-orange-100 text-orange-700 border-orange-300 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-700';
    case 'F':
      return 'bg-red-100 text-red-700 border-red-300 dark:bg-red-900/30 dark:text-red-400 dark:border-red-700';
    default:
      return 'bg-zinc-100 text-zinc-700 border-zinc-300 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700';
  }
}

function scoreLabel(score: number): string {
  if (score >= 80) return 'Excellent';
  if (score >= 60) return 'Good';
  if (score >= 40) return 'Fair';
  return 'Needs Improvement';
}

function dimensionColorClass(score: number): string {
  if (score >= 8) return 'text-emerald-600 dark:text-emerald-400';
  if (score >= 6) return 'text-blue-600 dark:text-blue-400';
  if (score >= 4) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

// ── Sub-Components ────────────────────────────────────────────────────

function LoadingState() {
  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="size-4 text-zinc-500" />
          AI Quality Assessment
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2 py-6 text-sm text-zinc-500 dark:text-zinc-400">
          <Loader2 className="size-4 animate-spin" />
          Loading assessment...
        </div>
      </CardContent>
    </Card>
  );
}

function ErrorState({ error }: { error: string }) {
  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="size-4 text-zinc-500" />
          AI Quality Assessment
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-start gap-2 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState({ onRequest, requestLoading }: { onRequest?: () => void; requestLoading?: boolean }) {
  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="size-4 text-zinc-500" />
          AI Quality Assessment
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center gap-4 py-6 text-center">
          <ClipboardList className="size-10 text-zinc-300 dark:text-zinc-600" strokeWidth={1} />
          <div>
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              No AI assessment yet
            </p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Request an AI-powered quality assessment to evaluate this trade plan.
            </p>
          </div>
          {onRequest && (
            <button
              type="button"
              onClick={onRequest}
              disabled={requestLoading}
              className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              {requestLoading && <Loader2 className="size-4 animate-spin" />}
              {requestLoading ? 'Requesting...' : 'Request Assessment'}
            </button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function WarningsList({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;

  return (
    <div className="mb-3 space-y-1">
      {warnings.map((w, i) => (
        <div
          key={i}
          className="flex items-start gap-1.5 rounded-md bg-amber-50 p-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-400"
        >
          <AlertCircle className="mt-0.5 size-3 shrink-0" />
          <span>{w}</span>
        </div>
      ))}
    </div>
  );
}

// ── Dimension Scores Table ────────────────────────────────────────────

function DimensionRow({ label, score }: { label: string; score: number }) {
  return (
    <div className="flex items-center justify-between border-b border-zinc-100 py-1.5 last:border-0 dark:border-zinc-800">
      <span className="text-sm text-zinc-600 dark:text-zinc-400">{label}</span>
      <span className={cn('text-sm font-medium tabular-nums', dimensionColorClass(score))}>
        {score}/10
      </span>
    </div>
  );
}

// ── Scorecard Display ─────────────────────────────────────────────────

function ScorecardDisplay({
  scorecard,
  warnings,
  onRequest,
  requestLoading,
}: {
  scorecard: Scorecard;
  warnings?: string[];
  onRequest?: () => void;
  requestLoading?: boolean;
}) {
  return (
    <Card className="mb-8">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Brain className="size-4 text-zinc-500" />
            AI Quality Assessment
          </CardTitle>
          {onRequest && (
            <button
              type="button"
              onClick={onRequest}
              disabled={requestLoading}
              className="inline-flex items-center gap-1 rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              {requestLoading && <Loader2 className="size-3 animate-spin" />}
              Reassess
            </button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <WarningsList warnings={warnings ?? []} />

        {/* ── Overall Score & Grade ──────────────────────────────── */}
        <div className="mb-4 flex items-center gap-4">
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
              {scorecard.overallScore}
            </span>
            <span className="text-sm text-zinc-500 dark:text-zinc-400">/100</span>
          </div>
          <Badge
            className={cn(
              'text-xs font-semibold',
              gradeColorClass(scorecard.gradeLabel),
            )}
          >
            {scorecard.gradeLabel}
          </Badge>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {scoreLabel(scorecard.overallScore)}
          </span>
        </div>

        {/* ── Dimension Scores ──────────────────────────────────── */}
        <div className="mb-4 rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-700">
          <div className="mb-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Dimensions
          </div>
          {scorecard.dimensions.map((dim) => (
            <DimensionRow key={dim.key} label={dim.label} score={dim.score} />
          ))}
        </div>

        {/* ── Summary / Rationale ───────────────────────────────── */}
        {scorecard.summary && (
          <div className="mb-4">
            <div className="mb-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Summary
            </div>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
              {scorecard.summary}
            </p>
          </div>
        )}

        {/* ── Metadata ──────────────────────────────────────────── */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-zinc-200 pt-3 text-xs text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          {scorecard.metadata?.modelUsed && (
            <span>
              Model: <span className="font-medium text-zinc-700 dark:text-zinc-300">{scorecard.metadata.modelUsed}</span>
            </span>
          )}
          <span>
            Assessment:{' '}
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              {scorecard.assessmentType === 'ai_quality' ? 'Quality' : 'Review'}
            </span>
          </span>
          {scorecard.metadata?.promptTokens !== undefined && (
            <span>
              Prompt: <span className="tabular-nums font-medium text-zinc-700 dark:text-zinc-300">{scorecard.metadata.promptTokens}</span> tokens
            </span>
          )}
          {scorecard.metadata?.completionTokens !== undefined && (
            <span>
              Completion: <span className="tabular-nums font-medium text-zinc-700 dark:text-zinc-300">{scorecard.metadata.completionTokens}</span> tokens
            </span>
          )}
          {scorecard.metadata?.durationMs !== undefined && (
            <span>
              Duration: <span className="tabular-nums font-medium text-zinc-700 dark:text-zinc-300">{formatDuration(scorecard.metadata.durationMs)}</span>
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Root Component ────────────────────────────────────────────────────

export default function AssessmentCard({
  scorecard,
  warnings,
  loading = false,
  error = null,
  onRequestAssessment,
  requestLoading = false,
}: AssessmentCardProps) {
  // Loading takes highest priority
  if (loading) {
    return <LoadingState />;
  }

  // Error state
  if (error) {
    return <ErrorState error={error} />;
  }

  // Empty state — no assessment data yet
  if (!scorecard) {
    return (
      <EmptyState
        onRequest={onRequestAssessment}
        requestLoading={requestLoading}
      />
    );
  }

  // Scorecard display
  return (
    <ScorecardDisplay
      scorecard={scorecard}
      warnings={warnings}
      onRequest={onRequestAssessment}
      requestLoading={requestLoading}
    />
  );
}
