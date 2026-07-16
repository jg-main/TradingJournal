'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  RefreshCw,
  XCircle,
  CheckCircle2,
  AlertTriangle,
  Info,
  ChevronDown,
  ChevronRight,
  BookOpen,
  Play,
  Eye,
  ShieldAlert,
} from 'lucide-react';

// ── Types (mirroring the reconciliation API contract) ────────────────────

interface ComparisonResult {
  key: string;
  description: string;
  legacyValue: string;
  accountingValue: string;
  difference: string;
  classification: 'match' | 'explained' | 'unexplained';
  tolerance: string | null;
  detail: string | null;
}

interface ReconciliationReport {
  runId: string;
  accountId: string;
  runStatus: string;
  rebuildFingerprint: string | null;
  computedAt: string;
  totals: {
    comparisons: number;
    matching: number;
    explained: number;
    anomalies: number;
    unexplained: number;
  };
  comparisons: ComparisonResult[];
  anomalies?: Array<{
    anomalyCode: string;
    count: number;
    sourceTable: string;
    records: Array<{
      sourceId: string;
      anomalyField: string;
      anomalyDetail: string;
    }>;
  }>;
  recordStatusCounts?: {
    mappedCount: number;
    anomalyCount: number;
    unsupportedCount: number;
    duplicateCount: number;
    totalRecords: number;
  };
  cutoverEligible: boolean;
  cutoverRefusalReasons: string[];
}

// ── Props ───────────────────────────────────────────────────────────────

interface AccountReconciliationSummaryProps {
  accountId: string;
  refreshKey?: number;
}

// ── Migration API contract ──────────────────────────────────────────────

interface MigrationResult {
  runId: string;
  accountId: string;
  status: string;
  totalRecords: number;
  mappedCount: number;
  anomalyCount: number;
  unsupportedCount: number;
  duplicateCount: number;
  rebuildFingerprint: string | null;
  errorMessage: string | null;
  dryRun: boolean;
}

interface MigrationFeedback {
  /** 'pending' | 'success' | 'failure' | 'refused' */
  outcome: 'pending' | 'success' | 'failure' | 'refused';
  result?: MigrationResult;
  errorMessage?: string;
  dryRun: boolean;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function getClassificationBadge(
  classification: 'match' | 'explained' | 'unexplained',
): { label: string; className: string } {
  switch (classification) {
    case 'match':
      return {
        label: 'Match',
        className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
      };
    case 'explained':
      return {
        label: 'Explained',
        className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
      };
    case 'unexplained':
      return {
        label: 'Unexplained',
        className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
      };
  }
}

function formatDateTime(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getHistoryLabel(runStatus: string): string {
  switch (runStatus) {
    case 'completed':
      return 'Last Migration';
    case 'partial':
      return 'Partial Migration';
    default:
      return `Status: ${runStatus}`;
  }
}

function feedbackContentClass(outcome: MigrationFeedback['outcome']): string {
  switch (outcome) {
    case 'success':
      return 'border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/20';
    case 'failure':
    case 'refused':
      return 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20';
    case 'pending':
      return 'border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20';
  }
}

function feedbackIcon(outcome: MigrationFeedback['outcome']) {
  switch (outcome) {
    case 'success':
      return <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />;
    case 'failure':
      return <XCircle className="mt-0.5 size-4 shrink-0 text-red-600 dark:text-red-400" />;
    case 'refused':
      return <ShieldAlert className="mt-0.5 size-4 shrink-0 text-red-600 dark:text-red-400" />;
    case 'pending':
      return <RefreshCw className="mt-0.5 size-4 animate-spin shrink-0 text-blue-600 dark:text-blue-400" />;
  }
}

// ── Component ──────────────────────────────────────────────────────────

export default function AccountReconciliationSummary({
  accountId,
  refreshKey = 0,
}: AccountReconciliationSummaryProps) {
  const [report, setReport] = useState<ReconciliationReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorType, setErrorType]
    = useState<'account-not-found' | 'no-migration' | 'generic' | null>(null);
  const [expanded, setExpanded] = useState(false);

  // Migration state
  const [migrating, setMigrating] = useState(false);
  const [migrationFeedback, setMigrationFeedback] = useState<MigrationFeedback | null>(null);
  const [showConfirmRun, setShowConfirmRun] = useState(false);

  // ── Fetch reconciliation report ─────────────────────────────────────

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    setErrorType(null);
    try {
      const res = await fetch(`/api/accounts/${accountId}/reconciliation`);

      if (res.status === 404) {
        setError('Account not found.');
        setErrorType('account-not-found');
        setReport(null);
        setLoading(false);
        return;
      }

      if (res.status === 400) {
        // No migration run yet — this is expected for new accounts
        setReport(null);
        setErrorType('no-migration');
        setLoading(false);
        return;
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to fetch' }));
        throw new Error(err.error ?? 'Failed to fetch reconciliation report');
      }

      const data = (await res.json()) as ReconciliationReport;
      setReport(data);
      setErrorType(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setErrorType('generic');
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    // The async loader updates loading/error state after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchReport();
  }, [fetchReport, refreshKey]);

  // ── Run migration ──────────────────────────────────────────────────

  const runMigration = useCallback(
    async (dryRun: boolean) => {
      // Prevent duplicate submissions
      if (migrating) return;

      setMigrating(true);
      setMigrationFeedback({ outcome: 'pending', dryRun });
      setShowConfirmRun(false);

      try {
        const res = await fetch(`/api/accounts/${accountId}/migration`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dryRun }),
        });

        if (res.status === 404) {
          setMigrationFeedback({
            outcome: 'refused',
            dryRun,
            errorMessage: 'Account not found.',
          });
          return;
        }

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Migration failed' }));
          setMigrationFeedback({
            outcome: 'failure',
            dryRun,
            errorMessage: err.error ?? 'Migration failed',
          });
          return;
        }

        const data = (await res.json()) as MigrationResult;
        setMigrationFeedback({ outcome: 'success', result: data, dryRun });

        // Auto-refresh the reconciliation report after a successful migration
        if (!dryRun && data.status === 'completed') {
          // Small delay to let DB settle
          setTimeout(() => void fetchReport(), 300);
        }
      } catch (err) {
        setMigrationFeedback({
          outcome: 'failure',
          dryRun,
          errorMessage: err instanceof Error ? err.message : 'An error occurred',
        });
      } finally {
        setMigrating(false);
      }
    },
    [accountId, migrating, fetchReport],
  );

  // ── Derived state ──────────────────────────────────────────────────

  const hasReport = report !== null;
  const isEligible = report?.cutoverEligible ?? false;
  const hasComparisons = report && report.comparisons.length > 0;
  const hasAnomalies = report && report.anomalies && report.anomalies.length > 0;
  const unexplainedCount = report?.totals.unexplained ?? 0;
  const anomalyCount = report?.totals.anomalies ?? 0;

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div className="mb-8">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wider">
          Reconciliation
        </h2>
        <div className="flex items-center gap-2">
          {/* Dry Run Button */}
          <button
            onClick={() => runMigration(true)}
            disabled={migrating}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
            title="Preview what would be migrated without writing any data"
            aria-label="Run dry-run migration inspection"
          >
            <Eye className="size-3" />
            Inspect
          </button>
          {/* Run Migration Button */}
          <button
            onClick={() => setShowConfirmRun(true)}
            disabled={migrating}
            className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs text-amber-700 hover:bg-amber-50 disabled:opacity-50 dark:border-amber-700 dark:bg-zinc-800 dark:text-amber-400 dark:hover:bg-zinc-700"
            title="Run a full migration from legacy data"
            aria-label="Run full migration"
          >
            <Play className="size-3" />
            Run Migration
          </button>
          {/* Refresh Button */}
          <button
            onClick={fetchReport}
            disabled={loading || migrating}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
            title="Refresh reconciliation report"
            aria-label="Refresh reconciliation report"
          >
            <RefreshCw className={`size-3 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* ── Confirmation Dialog ──────────────────────────────────────── */}
      {showConfirmRun && (
        <div
          className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20"
          role="alertdialog"
          aria-label="Confirm migration"
        >
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                Run full migration?
              </p>
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                This will import all legacy account transactions, trade executions,
                and price snapshots into the accounting system and rebuild all projections.
                Existing data is safe (duplicates are detected), but this action cannot be
                undone once committed. Use &quot;Inspect&quot; first to preview the results.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={() => setShowConfirmRun(false)}
                  className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                  aria-label="Cancel migration"
                >
                  Cancel
                </button>
                <button
                  onClick={() => runMigration(false)}
                  className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 dark:border-amber-700 dark:bg-amber-700 dark:hover:bg-amber-600"
                  aria-label="Confirm migration"
                >
                  <Play className="size-3" />
                  Confirm Migration
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Migration Feedback ───────────────────────────────────────── */}
      {migrationFeedback && (
        <div
          className={`mb-4 rounded-lg border p-4 ${feedbackContentClass(migrationFeedback.outcome)}`}
          role={migrationFeedback.outcome === 'failure' ? 'alert' : 'status'}
          aria-live="polite"
        >
          <div className="flex items-start gap-3">
            {feedbackIcon(migrationFeedback.outcome)}
            <div className="flex-1">
              {migrationFeedback.outcome === 'pending' && (
                <>
                  <p className="text-sm font-medium text-blue-800 dark:text-blue-300">
                    {migrationFeedback.dryRun
                      ? 'Inspecting legacy data...'
                      : 'Running migration...'}
                  </p>
                  <p className="mt-1 text-xs text-blue-700 dark:text-blue-400">
                    {migrationFeedback.dryRun
                      ? 'Counting records that would be migrated.'
                      : 'Importing records and rebuilding projections.'}
                  </p>
                </>
              )}

              {migrationFeedback.outcome === 'success' && migrationFeedback.result && (
                <>
                  <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
                    {migrationFeedback.dryRun
                      ? 'Inspection complete'
                      : 'Migration completed successfully'}
                  </p>
                  <div className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">
                    <p>
                      {migrationFeedback.result.totalRecords} record
                      {migrationFeedback.result.totalRecords !== 1 ? 's' : ''} processed
                      ({migrationFeedback.result.mappedCount} mapped,
                      {' '}{migrationFeedback.result.duplicateCount} duplicates
                      {migrationFeedback.result.anomalyCount > 0
                        ? `, ${migrationFeedback.result.anomalyCount} anomalies`
                        : ''}
                      {migrationFeedback.result.unsupportedCount > 0
                        ? `, ${migrationFeedback.result.unsupportedCount} unsupported`
                        : ''})
                    </p>
                    {migrationFeedback.result.rebuildFingerprint && (
                      <p className="mt-0.5 font-mono">
                        Fingerprint: {migrationFeedback.result.rebuildFingerprint.slice(0, 16)}...
                      </p>
                    )}
                  </div>
                </>
              )}

              {migrationFeedback.outcome === 'failure' && (
                <>
                  <p className="text-sm font-medium text-red-800 dark:text-red-300">
                    {migrationFeedback.dryRun ? 'Inspection failed' : 'Migration failed'}
                  </p>
                  <p className="mt-1 text-xs text-red-700 dark:text-red-400">
                    {migrationFeedback.errorMessage ?? 'An unexpected error occurred.'}
                  </p>
                </>
              )}

              {migrationFeedback.outcome === 'refused' && (
                <>
                  <p className="text-sm font-medium text-red-800 dark:text-red-300">
                    Migration refused
                  </p>
                  <p className="mt-1 text-xs text-red-700 dark:text-red-400">
                    {migrationFeedback.errorMessage ?? 'Request could not be processed.'}
                  </p>
                </>
              )}
            </div>
            {/* Dismiss button for completed outcomes */}
            {migrationFeedback.outcome !== 'pending' && (
              <button
                onClick={() => setMigrationFeedback(null)}
                className="shrink-0 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                aria-label="Dismiss migration result"
              >
                <XCircle className="size-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Loading State ───────────────────────────────────────────── */}
      {loading && (
        <div className="rounded-lg border border-zinc-200 p-8 text-center dark:border-zinc-800">
          <RefreshCw className="mx-auto mb-2 size-5 animate-spin text-zinc-400" />
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Loading reconciliation report...
          </p>
        </div>
      )}

      {/* ── Error / Not-Found State ─────────────────────────────────── */}
      {error && !loading && (
        <div
          className="rounded-lg border border-red-200 bg-red-50 p-6 text-center dark:border-red-800 dark:bg-red-900/20"
          role="alert"
          aria-live="polite"
        >
          <XCircle className="mx-auto mb-2 size-5 text-red-500" />
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          {errorType === 'generic' && (
            <button
              onClick={fetchReport}
              className="mt-3 inline-flex items-center gap-1 rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-700 dark:bg-red-950 dark:text-red-400 dark:hover:bg-red-900/30"
              aria-label="Retry loading reconciliation report"
            >
              <RefreshCw className="size-3" />
              Try Again
            </button>
          )}
        </div>
      )}

      {/* ── No Migration Run (expected for new/empty accounts) ──────── */}
      {!loading && !error && !hasReport && errorType === 'no-migration' && (
        <div
          className="rounded-lg border border-dashed border-zinc-300 p-6 text-center dark:border-zinc-700"
          role="status"
          aria-live="polite"
        >
          <BookOpen className="mx-auto mb-2 size-6 text-zinc-400" />
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            No migration run recorded.
          </p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Use the Inspect button above to preview what data would be migrated,
            then run a full migration to compare legacy source data against
            accounting projections.
          </p>
        </div>
      )}

      {/* ── Report Summary ──────────────────────────────────────────── */}
      {!loading && !error && hasReport && report && (
        <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          {/* Eligibility Banner */}
          <div
            className={`flex items-start gap-3 rounded-t-lg border-b px-4 py-3 ${
              isEligible
                ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/20'
                : 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20'
            }`}
          >
            {isEligible ? (
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
            )}
            <div className="flex-1">
              <p
                className={`text-sm font-medium ${
                  isEligible
                    ? 'text-emerald-800 dark:text-emerald-300'
                    : 'text-amber-800 dark:text-amber-300'
                }`}
              >
                {isEligible
                  ? 'Account is eligible for cutover'
                  : 'Account is not eligible for cutover'}
              </p>
              {report.cutoverRefusalReasons.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {report.cutoverRefusalReasons.map((reason, i) => (
                    <li
                      key={i}
                      className="text-xs text-amber-700 dark:text-amber-400"
                    >
                      {reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Summary Stats */}
          <div className="grid grid-cols-4 gap-3 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
            <div className="text-center">
              <p className="text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                {report.totals.comparisons}
              </p>
              <p className="text-[10px] text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                Comparisons
              </p>
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                {report.totals.matching}
              </p>
              <p className="text-[10px] text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                Matching
              </p>
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold tabular-nums text-blue-600 dark:text-blue-400">
                {report.totals.explained}
              </p>
              <p className="text-[10px] text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                Explained
              </p>
            </div>
            <div className="text-center">
              <p
                className={`text-lg font-semibold tabular-nums ${
                  anomalyCount > 0 || unexplainedCount > 0
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-zinc-900 dark:text-zinc-50'
                }`}
              >
                {anomalyCount + unexplainedCount}
              </p>
              <p className="text-[10px] text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                Issues
              </p>
            </div>
          </div>

          {/* Comparison Details Drill-Down */}
          {hasComparisons && (
            <>
              <button
                onClick={() => setExpanded((prev) => !prev)}
                className="flex w-full items-center justify-between border-b border-zinc-100 px-4 py-2 text-left text-xs font-medium text-zinc-500 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800/50"
              >
                <span>
                  {report.comparisons.length} comparison
                  {report.comparisons.length !== 1 ? 's' : ''}
                </span>
                {expanded ? (
                  <ChevronDown className="size-3" />
                ) : (
                  <ChevronRight className="size-3" />
                )}
              </button>

              {expanded && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-zinc-50 dark:bg-zinc-800/50">
                        <th className="px-4 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400">
                          Dimension
                        </th>
                        <th className="px-4 py-2 text-right font-medium text-zinc-500 dark:text-zinc-400">
                          Legacy
                        </th>
                        <th className="px-4 py-2 text-right font-medium text-zinc-500 dark:text-zinc-400">
                          Accounting
                        </th>
                        <th className="px-4 py-2 text-right font-medium text-zinc-500 dark:text-zinc-400">
                          Diff
                        </th>
                        <th className="px-4 py-2 text-center font-medium text-zinc-500 dark:text-zinc-400">
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {report.comparisons.map((cmp) => {
                        const badge = getClassificationBadge(cmp.classification);
                        return (
                          <tr
                            key={cmp.key}
                            className="hover:bg-zinc-50 dark:hover:bg-zinc-800/30"
                          >
                            <td
                              className="max-w-[160px] truncate px-4 py-2 text-zinc-700 dark:text-zinc-300"
                              title={cmp.description}
                            >
                              {cmp.description}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                              {cmp.legacyValue}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                              {cmp.accountingValue}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums font-medium text-zinc-900 dark:text-zinc-50">
                              {cmp.difference !== '0' ? cmp.difference : '0'}
                            </td>
                            <td className="px-4 py-2 text-center">
                              <span
                                className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium ${badge.className}`}
                                title={cmp.detail ?? ''}
                              >
                                {badge.label}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {/* Anomaly Drill-Down */}
          {hasAnomalies && report.anomalies && (
            <div className="border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
              <div className="flex items-start gap-2">
                <Info className="mt-0.5 size-4 shrink-0 text-zinc-400" />
                <div>
                  <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    {report.anomalies.length} anomaly type
                    {report.anomalies.length !== 1 ? 's' : ''}
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {report.anomalies.map((a) => (
                      <li
                        key={a.anomalyCode}
                        className="text-xs text-zinc-500 dark:text-zinc-400"
                      >
                        {a.anomalyCode}: {a.count} record
                        {a.count !== 1 ? 's' : ''} ({a.sourceTable})
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-zinc-100 bg-zinc-50 px-4 py-2 dark:border-zinc-800 dark:bg-zinc-900/50">
            <span className="text-xs text-zinc-400 dark:text-zinc-500">
              {getHistoryLabel(report.runStatus)} #{report.runId.slice(0, 8)}
            </span>
            <span className="text-xs text-zinc-400 dark:text-zinc-500">
              {formatDateTime(report.computedAt)}
            </span>
          </div>
        </div>
      )}

      {/* ── Unexpected state: report exists but no comparisons ────────── */}
      {!loading && !error && hasReport && !hasComparisons && report && (
        <div className="rounded-lg border border-zinc-200 bg-white p-6 text-center dark:border-zinc-800 dark:bg-zinc-900">
          <CheckCircle2 className="mx-auto mb-2 size-6 text-emerald-500" />
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
            Migration completed with no comparison dimensions.
          </p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Run ID: {report.runId.slice(0, 8)}
          </p>
        </div>
      )}
    </div>
  );
}
