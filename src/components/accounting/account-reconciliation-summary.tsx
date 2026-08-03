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
        className: 'bg-positive/10 text-positive',
      };
    case 'explained':
      return {
        label: 'Explained',
        className: 'bg-info/10 text-info',
      };
    case 'unexplained':
      return {
        label: 'Unexplained',
        className: 'bg-negative/10 text-negative',
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
      return 'border-positive/30 bg-positive/10';
    case 'failure':
    case 'refused':
      return 'border-destructive/30 bg-destructive/10';
    case 'pending':
      return 'border-info/30 bg-info/10';
  }
}

function feedbackIcon(outcome: MigrationFeedback['outcome']) {
  switch (outcome) {
    case 'success':
      return <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-positive" />;
    case 'failure':
      return <XCircle className="mt-0.5 size-4 shrink-0 text-negative" />;
    case 'refused':
      return <ShieldAlert className="mt-0.5 size-4 shrink-0 text-negative" />;
    case 'pending':
      return <RefreshCw className="mt-0.5 size-4 animate-spin shrink-0 text-info" />;
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
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          Reconciliation
        </h2>
        <div className="flex items-center gap-2">
          {/* Dry Run Button */}
          <button
            onClick={() => runMigration(true)}
            disabled={migrating}
            className="inline-flex items-center gap-1 rounded-md border border-input bg-card px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
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
            className="inline-flex items-center gap-1 rounded-md border border-warning/40 bg-card px-2.5 py-1 text-xs text-warning hover:bg-warning/10 disabled:opacity-50"
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
            className="inline-flex items-center gap-1 rounded-md border border-input bg-card px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
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
          className="mb-4 rounded-lg border border-warning/30 bg-warning/10 p-4"
          role="alertdialog"
          aria-label="Confirm migration"
        >
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 size-5 shrink-0 text-warning" />
            <div className="flex-1">
              <p className="text-sm font-medium text-warning">
                Run full migration?
              </p>
              <p className="mt-1 text-xs text-warning">
                This will import all legacy account transactions, trade executions,
                and price snapshots into the accounting system and rebuild all projections.
                Existing data is safe (duplicates are detected), but this action cannot be
                undone once committed. Use &quot;Inspect&quot; first to preview the results.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={() => setShowConfirmRun(false)}
                  className="inline-flex items-center gap-1 rounded-md border border-input bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
                  aria-label="Cancel migration"
                >
                  Cancel
                </button>
                <button
                  onClick={() => runMigration(false)}
                  className="inline-flex items-center gap-1 rounded-md border border-warning bg-warning px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-warning/90"
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
                  <p className="text-sm font-medium text-info">
                    {migrationFeedback.dryRun
                      ? 'Inspecting legacy data...'
                      : 'Running migration...'}
                  </p>
                  <p className="mt-1 text-xs text-info">
                    {migrationFeedback.dryRun
                      ? 'Counting records that would be migrated.'
                      : 'Importing records and rebuilding projections.'}
                  </p>
                </>
              )}

              {migrationFeedback.outcome === 'success' && migrationFeedback.result && (
                <>
                  <p className="text-sm font-medium text-positive">
                    {migrationFeedback.dryRun
                      ? 'Inspection complete'
                      : 'Migration completed successfully'}
                  </p>
                  <div className="mt-1 text-xs text-positive">
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
                  <p className="text-sm font-medium text-destructive">
                    {migrationFeedback.dryRun ? 'Inspection failed' : 'Migration failed'}
                  </p>
                  <p className="mt-1 text-xs text-destructive">
                    {migrationFeedback.errorMessage ?? 'An unexpected error occurred.'}
                  </p>
                </>
              )}

              {migrationFeedback.outcome === 'refused' && (
                <>
                  <p className="text-sm font-medium text-destructive">
                    Migration refused
                  </p>
                  <p className="mt-1 text-xs text-destructive">
                    {migrationFeedback.errorMessage ?? 'Request could not be processed.'}
                  </p>
                </>
              )}
            </div>
            {/* Dismiss button for completed outcomes */}
            {migrationFeedback.outcome !== 'pending' && (
              <button
                onClick={() => setMigrationFeedback(null)}
                className="shrink-0 text-muted-foreground hover:text-foreground"
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
        <div className="rounded-lg border border-border p-8 text-center">
          <RefreshCw className="mx-auto mb-2 size-5 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Loading reconciliation report...
          </p>
        </div>
      )}

      {/* ── Error / Not-Found State ─────────────────────────────────── */}
      {error && !loading && (
        <div
          className="rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-center"
          role="alert"
          aria-live="polite"
        >
          <XCircle className="mx-auto mb-2 size-5 text-destructive" />
          <p className="text-sm text-destructive">{error}</p>
          {errorType === 'generic' && (
            <button
              onClick={fetchReport}
              className="mt-3 inline-flex items-center gap-1 rounded-md border border-destructive/40 bg-card px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10"
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
          className="rounded-lg border border-dashed border-border p-6 text-center"
          role="status"
          aria-live="polite"
        >
          <BookOpen className="mx-auto mb-2 size-6 text-muted-foreground" />
          <p className="text-sm text-foreground">
            No migration run recorded.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Use the Inspect button above to preview what data would be migrated,
            then run a full migration to compare legacy source data against
            accounting projections.
          </p>
        </div>
      )}

      {/* ── Report Summary ──────────────────────────────────────────── */}
      {!loading && !error && hasReport && report && (
        <div className="rounded-lg border border-border bg-card">
          {/* Eligibility Banner */}
          <div
            className={`flex items-start gap-3 rounded-t-lg border-b px-4 py-3 ${
              isEligible
                ? 'border-positive/30 bg-positive/10'
                : 'border-warning/30 bg-warning/10'
            }`}
          >
            {isEligible ? (
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-positive" />
            ) : (
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" />
            )}
            <div className="flex-1">
              <p
                className={`text-sm font-medium ${
                  isEligible
                    ? 'text-positive'
                    : 'text-warning'
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
                      className="text-xs text-warning"
                    >
                      {reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Summary Stats */}
          <div className="grid grid-cols-4 gap-3 border-b border-border px-4 py-3">
            <div className="text-center">
              <p className="text-lg font-semibold tabular-nums text-foreground">
                {report.totals.comparisons}
              </p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                Comparisons
              </p>
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold tabular-nums text-positive">
                {report.totals.matching}
              </p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                Matching
              </p>
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold tabular-nums text-info">
                {report.totals.explained}
              </p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                Explained
              </p>
            </div>
            <div className="text-center">
              <p
                className={`text-lg font-semibold tabular-nums ${
                  anomalyCount > 0 || unexplainedCount > 0
                    ? 'text-negative'
                    : 'text-foreground'
                }`}
              >
                {anomalyCount + unexplainedCount}
              </p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                Issues
              </p>
            </div>
          </div>

          {/* Comparison Details Drill-Down */}
          {hasComparisons && (
            <>
              <button
                onClick={() => setExpanded((prev) => !prev)}
                className="flex w-full items-center justify-between border-b border-border px-4 py-2 text-left text-xs font-medium text-muted-foreground hover:bg-muted/50"
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
                      <tr className="bg-muted">
                        <th className="px-4 py-2 text-left font-medium text-muted-foreground">
                          Dimension
                        </th>
                        <th className="px-4 py-2 text-right font-medium text-muted-foreground">
                          Legacy
                        </th>
                        <th className="px-4 py-2 text-right font-medium text-muted-foreground">
                          Accounting
                        </th>
                        <th className="px-4 py-2 text-right font-medium text-muted-foreground">
                          Diff
                        </th>
                        <th className="px-4 py-2 text-center font-medium text-muted-foreground">
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {report.comparisons.map((cmp) => {
                        const badge = getClassificationBadge(cmp.classification);
                        return (
                          <tr
                            key={cmp.key}
                            className="hover:bg-muted/50"
                          >
                            <td
                              className="max-w-[160px] truncate px-4 py-2 text-foreground"
                              title={cmp.description}
                            >
                              {cmp.description}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                              {cmp.legacyValue}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                              {cmp.accountingValue}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums font-medium text-foreground">
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
            <div className="border-t border-border px-4 py-3">
              <div className="flex items-start gap-2">
                <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    {report.anomalies.length} anomaly type
                    {report.anomalies.length !== 1 ? 's' : ''}
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {report.anomalies.map((a) => (
                      <li
                        key={a.anomalyCode}
                        className="text-xs text-muted-foreground"
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
          <div className="flex items-center justify-between border-t border-border bg-muted px-4 py-2">
            <span className="text-xs text-muted-foreground">
              {getHistoryLabel(report.runStatus)} #{report.runId.slice(0, 8)}
            </span>
            <span className="text-xs text-muted-foreground">
              {formatDateTime(report.computedAt)}
            </span>
          </div>
        </div>
      )}

      {/* ── Unexpected state: report exists but no comparisons ────────── */}
      {!loading && !error && hasReport && !hasComparisons && report && (
        <div className="rounded-lg border border-border bg-card p-6 text-center">
          <CheckCircle2 className="mx-auto mb-2 size-6 text-positive" />
          <p className="text-sm font-medium text-foreground">
            Migration completed with no comparison dimensions.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Run ID: {report.runId.slice(0, 8)}
          </p>
        </div>
      )}
    </div>
  );
}
