'use client';

import { useState } from 'react';
import { History, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import AssessmentCard from './assessment-card';
import type { Scorecard } from '@/lib/scorecard';

// ── Types ──────────────────────────────────────────────────────────────

/** Shape of a single assessment snapshot row from the GET /assessments API */
export interface AssessmentSnapshot {
  id: string;
  tradeId: string;
  assessedAt: string | null;
  assessmentType: string;
  overallScore: number | null;
  modelUsed: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  notes: string | null;
  createdAt: string | null;
  scorecard: Scorecard | null;
  snapshotVersion: number;
}

export interface AssessmentHistoryProps {
  /** Array of assessment snapshots, expected sorted by snapshotVersion DESC */
  assessments: AssessmentSnapshot[];
  /** Whether the assessment list fetch is in progress */
  loading?: boolean;
  /** User-facing error message, or null */
  error?: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────

function formatTimestamp(ts: string | undefined | null): string {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return ts;
  }
}

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

/**
 * Derive a displayable grade letter from an assessment snapshot.
 * Prefers the parsed scorecard.gradeLabel, falls back to overallScore
 * thresholds, and returns '-' when neither is available.
 */
function deriveGradeLabel(assessment: AssessmentSnapshot): string {
  if (assessment.scorecard?.gradeLabel) {
    return assessment.scorecard.gradeLabel;
  }
  if (assessment.overallScore !== null && assessment.overallScore !== undefined) {
    if (assessment.overallScore >= 80) return 'A';
    if (assessment.overallScore >= 60) return 'B';
    if (assessment.overallScore >= 40) return 'C';
    if (assessment.overallScore >= 20) return 'D';
    return 'F';
  }
  return '-';
}

function assessmentTypeLabel(type: string): string {
  if (type === 'ai_quality') return 'Quality';
  if (type === 'ai_review') return 'Review';
  return type;
}

// ── Sub-Components ────────────────────────────────────────────────────

function ErrorState({ error }: { error: string }) {
  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="size-4 text-zinc-500" />
          Assessment History
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

function EmptyState() {
  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="size-4 text-zinc-500" />
          Assessment History
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <History className="size-10 text-zinc-300 dark:text-zinc-600" strokeWidth={1} />
          <div>
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              No assessment history yet
            </p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Assessments will appear here once you request one.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function HistoryRow({
  assessment,
  isExpanded,
  onToggle,
}: {
  assessment: AssessmentSnapshot;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const grade = deriveGradeLabel(assessment);
  const score = assessment.scorecard?.overallScore ?? assessment.overallScore;

  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          'flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50',
          isExpanded && 'bg-zinc-50 dark:bg-zinc-800/50',
        )}
      >
        {/* Expand/collapse icon */}
        <span className="shrink-0 text-zinc-400">
          {isExpanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </span>

        {/* Version number */}
        <span className="w-8 shrink-0 tabular-nums font-medium text-zinc-900 dark:text-zinc-100">
          v{assessment.snapshotVersion}
        </span>

        {/* Date */}
        <span className="w-36 shrink-0 text-zinc-600 dark:text-zinc-400">
          {formatTimestamp(assessment.assessedAt)}
        </span>

        {/* Model */}
        <span className="w-28 shrink-0 truncate text-zinc-600 dark:text-zinc-400">
          {assessment.modelUsed || '-'}
        </span>

        {/* Type */}
        <span className="w-20 shrink-0 text-zinc-600 dark:text-zinc-400">
          {assessmentTypeLabel(assessment.assessmentType)}
        </span>

        {/* Score */}
        <span className="w-16 shrink-0 text-right tabular-nums font-medium text-zinc-900 dark:text-zinc-100">
          {score !== null && score !== undefined ? score : '-'}
        </span>

        {/* Grade badge */}
        <span className="w-14 shrink-0">
          <Badge
            className={cn(
              'text-xs font-semibold',
              grade === '-'
                ? 'bg-zinc-100 text-zinc-500 border-zinc-300 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700'
                : gradeColorClass(grade),
            )}
          >
            {grade}
          </Badge>
        </span>

        {/* Score label */}
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {score !== null && score !== undefined ? scoreLabel(score) : ''}
        </span>
      </button>

      {/* Expanded detail: full scorecard via AssessmentCard */}
      {isExpanded && (
        <div className="border-t border-zinc-100 px-4 py-4 dark:border-zinc-800">
          {assessment.scorecard ? (
            <AssessmentCard scorecard={assessment.scorecard} loading={false} error={null} />
          ) : (
            <div className="flex items-center gap-2 py-4 text-sm text-zinc-500 dark:text-zinc-400">
              <AlertCircle className="size-4" />
              <span>No scorecard data available for this assessment.</span>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function TableSkeleton() {
  return (
    <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
      {/* Column header */}
      <div className="flex items-center gap-3 px-4 py-2">
        <span className="w-4 shrink-0" />
        <span className="w-8 shrink-0 text-xs font-medium uppercase text-zinc-500">Ver</span>
        <span className="w-36 shrink-0 text-xs font-medium uppercase text-zinc-500">Date</span>
        <span className="w-28 shrink-0 text-xs font-medium uppercase text-zinc-500">Model</span>
        <span className="w-20 shrink-0 text-xs font-medium uppercase text-zinc-500">Type</span>
        <span className="w-16 shrink-0 text-right text-xs font-medium uppercase text-zinc-500">Score</span>
        <span className="w-14 shrink-0 text-xs font-medium uppercase text-zinc-500">Grade</span>
        <span className="text-xs font-medium uppercase text-zinc-500" />
      </div>
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex animate-pulse items-center gap-3 px-4 py-3">
          <div className="h-4 w-4 rounded bg-zinc-200 dark:bg-zinc-700" />
          <div className="h-4 w-8 rounded bg-zinc-200 dark:bg-zinc-700" />
          <div className="h-4 w-36 rounded bg-zinc-200 dark:bg-zinc-700" />
          <div className="h-4 w-28 rounded bg-zinc-200 dark:bg-zinc-700" />
          <div className="h-4 w-20 rounded bg-zinc-200 dark:bg-zinc-700" />
          <div className="ml-auto h-4 w-16 rounded bg-zinc-200 dark:bg-zinc-700" />
          <div className="h-5 w-14 rounded-full bg-zinc-200 dark:bg-zinc-700" />
        </div>
      ))}
    </div>
  );
}

// ── Root Component ────────────────────────────────────────────────────

export default function AssessmentHistory({
  assessments,
  loading = false,
  error = null,
}: AssessmentHistoryProps) {
  const [expandedVersion, setExpandedVersion] = useState<number | null>(null);

  const handleToggle = (version: number) => {
    setExpandedVersion((prev) => (prev === version ? null : version));
  };

  // Loading takes highest priority
  if (loading) {
    return (
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="size-4 text-zinc-500" />
            Assessment History
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <TableSkeleton />
        </CardContent>
      </Card>
    );
  }

  // Error state
  if (error) {
    return <ErrorState error={error} />;
  }

  // Empty state — no assessments exist
  if (assessments.length === 0) {
    return <EmptyState />;
  }

  // Data state — render the history table
  return (
    <Card className="mb-8">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <History className="size-4 text-zinc-500" />
            Assessment History
          </CardTitle>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {assessments.length} version{assessments.length !== 1 ? 's' : ''}
          </span>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {/* Column headers */}
        <div className="flex items-center gap-3 border-b border-zinc-100 px-4 py-2 dark:border-zinc-800">
          <span className="w-4 shrink-0" />
          <span className="w-8 shrink-0 text-xs font-medium uppercase text-zinc-500">Ver</span>
          <span className="w-36 shrink-0 text-xs font-medium uppercase text-zinc-500">Date</span>
          <span className="w-28 shrink-0 text-xs font-medium uppercase text-zinc-500">Model</span>
          <span className="w-20 shrink-0 text-xs font-medium uppercase text-zinc-500">Type</span>
          <span className="w-16 shrink-0 text-right text-xs font-medium uppercase text-zinc-500">Score</span>
          <span className="w-14 shrink-0 text-xs font-medium uppercase text-zinc-500">Grade</span>
          <span className="text-xs font-medium uppercase text-zinc-500" />
        </div>

        {/* Assessment rows */}
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {assessments.map((assessment) => (
            <HistoryRow
              key={assessment.id}
              assessment={assessment}
              isExpanded={expandedVersion === assessment.snapshotVersion}
              onToggle={() => handleToggle(assessment.snapshotVersion)}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
