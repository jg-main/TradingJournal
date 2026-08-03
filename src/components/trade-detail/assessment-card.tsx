'use client';

import { useState } from 'react';
import { Brain, Loader2, AlertCircle, ClipboardList, ChevronRight, ChevronDown } from 'lucide-react';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
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
  /** The exact prompt text sent to the AI, or null for historical snapshots */
  promptText?: string | null;
  /** The raw JSON response from the AI, or null for historical snapshots */
  rawResponse?: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────

function gradeColorClass(letter: string): string {
  switch (letter) {
    case 'A':
      return 'bg-positive/10 text-positive border-positive/30';
    case 'B':
      return 'bg-info/10 text-info border-info/30';
    case 'C':
      return 'bg-warning/10 text-warning border-warning/30';
    case 'D':
      return 'bg-warning/10 text-warning border-warning/30';
    case 'F':
      return 'bg-negative/10 text-negative border-negative/30';
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}

function scoreLabel(score: number): string {
  if (score >= 80) return 'Excellent';
  if (score >= 60) return 'Good';
  if (score >= 40) return 'Fair';
  return 'Needs Improvement';
}

function dimensionColorClass(score: number): string {
  if (score >= 8) return 'text-positive';
  if (score >= 6) return 'text-info';
  if (score >= 4) return 'text-warning';
  return 'text-negative';
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
          <Brain className="size-4 text-muted-foreground" />
          AI Quality Assessment
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
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
          <Brain className="size-4 text-muted-foreground" />
          AI Quality Assessment
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
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
          <Brain className="size-4 text-muted-foreground" />
          AI Quality Assessment
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center gap-4 py-6 text-center">
          <ClipboardList className="size-10 text-muted-foreground" strokeWidth={1} />
          <div>
            <p className="text-sm font-medium text-foreground">
              No AI assessment yet
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Request an AI-powered quality assessment to evaluate this trade plan.
            </p>
          </div>
          {onRequest && (
            <button
              type="button"
              onClick={onRequest}
              disabled={requestLoading}
              className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:bg-foreground/80 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-secondary dark:text-secondary-foreground dark:hover:bg-secondary/80"
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
          className="flex items-start gap-1.5 rounded-md bg-warning/10 p-2 text-xs text-warning"
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
    <div className="flex items-center justify-between border-b border-border py-1.5 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={cn('text-sm font-medium tabular-nums', dimensionColorClass(score))}>
        {score}/10
      </span>
    </div>
  );
}

// ── Collapsible Section ───────────────────────────────────────────────

function CollapsibleSection({ label, content }: { label: string; content: string | null | undefined }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-t border-border pt-3">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
          {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          {label}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <pre className="mt-2 whitespace-pre-wrap rounded-md bg-muted p-3 text-xs text-foreground">
            {content ?? 'Not available'}
          </pre>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

// ── Scorecard Display ─────────────────────────────────────────────────

function ScorecardDisplay({
  scorecard,
  warnings,
  onRequest,
  requestLoading,
  promptText,
  rawResponse,
}: {
  scorecard: Scorecard;
  warnings?: string[];
  onRequest?: () => void;
  requestLoading?: boolean;
  promptText?: string | null;
  rawResponse?: string | null;
}) {
  return (
    <Card className="mb-8">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Brain className="size-4 text-muted-foreground" />
            AI Quality Assessment
          </CardTitle>
          {onRequest && (
            <button
              type="button"
              onClick={onRequest}
              disabled={requestLoading}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 dark:border-input dark:hover:bg-input/50"
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
            <span className="text-2xl font-bold tabular-nums text-foreground">
              {scorecard.overallScore}
            </span>
            <span className="text-sm text-muted-foreground">/100</span>
          </div>
          <Badge
            className={cn(
              'text-xs font-semibold',
              gradeColorClass(scorecard.gradeLabel),
            )}
          >
            {scorecard.gradeLabel}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {scoreLabel(scorecard.overallScore)}
          </span>
        </div>

        {/* ── Dimension Scores ──────────────────────────────────── */}
        <div className="mb-4 rounded-lg border border-border px-3 py-2">
          <div className="mb-1 text-xs font-medium text-muted-foreground">
            Dimensions
          </div>
          {scorecard.dimensions.map((dim) => (
            <DimensionRow key={dim.key} label={dim.label} score={dim.score} />
          ))}
        </div>

        {/* ── Summary / Rationale ───────────────────────────────── */}
        {scorecard.summary && (
          <div className="mb-4">
            <div className="mb-1 text-xs font-medium text-muted-foreground">
              Summary
            </div>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
              {scorecard.summary}
            </p>
          </div>
        )}

        {/* ── Metadata ──────────────────────────────────────────── */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
          {scorecard.metadata?.modelUsed && (
            <span>
              Model: <span className="font-medium text-foreground">{scorecard.metadata.modelUsed}</span>
            </span>
          )}
          <span>
            Assessment:{' '}
            <span className="font-medium text-foreground">
              {scorecard.assessmentType === 'ai_quality' ? 'Quality' : 'Review'}
            </span>
          </span>
          {scorecard.metadata?.promptTokens !== undefined && (
            <span>
              Prompt: <span className="tabular-nums font-medium text-foreground">{scorecard.metadata.promptTokens}</span> tokens
            </span>
          )}
          {scorecard.metadata?.completionTokens !== undefined && (
            <span>
              Completion: <span className="tabular-nums font-medium text-foreground">{scorecard.metadata.completionTokens}</span> tokens
            </span>
          )}
          {scorecard.metadata?.durationMs !== undefined && (
            <span>
              Duration: <span className="tabular-nums font-medium text-foreground">{formatDuration(scorecard.metadata.durationMs)}</span>
            </span>
          )}
        </div>

        {/* ── Prompt & Raw Response Collapsible Sections ────────── */}
        <CollapsibleSection label="View Prompt" content={promptText} />
        <CollapsibleSection label="View Raw Response" content={rawResponse} />
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
  promptText,
  rawResponse,
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
      promptText={promptText}
      rawResponse={rawResponse}
    />
  );
}
