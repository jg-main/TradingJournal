'use client';

// ProcessReviewPanel — process discipline, directional performance,
// attention items, and the weekly review write surface for the workstation.
//
// Reads dashboard catalogue data (processScoreDistribution,
// directionalPerformance, attentionInsights) exclusively from
// WorkstationContext. In live mode the panel additionally hosts:
//
//   4. Weekly Review summary — a panel-local fetch of
//      GET /api/reviews/weekly?accountId=X filtered to the current week
//      (auto-computed metrics when a review exists, "No review this week"
//      otherwise).
//   5. 'Update review' in the panel header opens the ReviewWriteSheet
//      (S02/T01). After a save the panel applies the saved row immediately
//      and reconciles against the persisted list in the background — the
//      summary refreshes without a page reload.
//
// Fixture mode (liveMode=false): no summary section, no Update review
// button, no fetch — the panel stays read-only (the sheet self-gates too).
//
// Sub-sections:
//   1. Weekly Review — current-week metrics or empty/error state
//   2. Process Score Distribution — grade distribution bars (A–F)
//   3. Directional Performance — long vs short P&L and win rate
//   4. Attention Items — top 3 highest-attention insights (severity-sorted)
//      with severity indicators
//
// Panel header reads 'Review Metrics' per WORKSTATION_PANEL_CATALOGUE
// (compact, action-oriented dense summary row).
//
// CSS classes: ws-panel, ws-panel-header, ws-panel-body, ws-num, ws-pos,
// ws-neg, ws-stat-row, ws-mono, ws-empty.
//
// data-testid attributes:
//   ws-panel-process-review, ws-update-review, ws-weekly-review-summary,
//   ws-weekly-review-loading, ws-weekly-review-error, ws-weekly-review-retry,
//   ws-weekly-review-empty, ws-weekly-review-week,
//   ws-weekly-review-metric-trades, ws-weekly-review-metric-netpnl,
//   ws-weekly-review-metric-winrate, ws-weekly-review-metric-avgr,
//   ws-weekly-review-metric-grade, ws-process-score-dist,
//   ws-process-score-row, ws-directional-performance, ws-dir-perf-long,
//   ws-dir-perf-short, ws-attention-items, ws-attention-item-{index},
//   ws-severity-{severity}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

import { useWorkstation } from './workstation-context';
import {
  ReviewWriteSheet,
  mondayIsoDate,
  gradeLabelFromScore,
  formatWeekRange,
  fmtDecimal,
  extractApiError,
  type WeeklyReviewRow,
} from './review-write-sheet';
import { Button } from '@/components/ui/button';
import type { ProcessScoreBin } from '@/lib/dashboard';
import type { DirectionalPerformanceResult } from '@/lib/dashboard';
import type { AttentionInsight } from '@/lib/attention-insights';

// ── Formatters ──────────────────────────────────────────────────────────

function fmtCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const sign = value < 0 ? '-' : '';
  return `${sign}$${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pnlClass(n: number | null | undefined): string {
  if (n === null || n === undefined) return '';
  if (n > 0) return 'ws-pos';
  if (n < 0) return 'ws-neg';
  return '';
}

function fmtPct(fraction: number | null | undefined): string {
  if (fraction === null || fraction === undefined) return '—';
  return `${(fraction * 100).toFixed(1)}%`;
}

// ── Grade colour mapping ────────────────────────────────────────────────

/**
 * Map a process-score bin label to a colour class.
 * A–B grades → ws-pos, C → '', D–F → ws-neg.
 * The grade letter is the first character of the label.
 */
function gradeClass(label: string): string {
  const grade = label.charAt(0).toUpperCase();
  if (grade === 'A' || grade === 'B') return 'ws-pos';
  if (grade === 'D' || grade === 'E' || grade === 'F') return 'ws-neg';
  return '';
}

// ── Severity mapping ────────────────────────────────────────────────────

function severityIndicatorClass(severity: string): string {
  if (severity === 'warning' || severity === 'critical') return 'ws-neg';
  return '';
}

function severityLabel(severity: string): string {
  switch (severity) {
    case 'critical': return 'CRIT';
    case 'warning': return 'WARN';
    case 'info': return 'INFO';
    default: return severity.toUpperCase();
  }
}

// ── Component ───────────────────────────────────────────────────────────

export function ProcessReviewPanel() {
  const { fixtures, activeAccountId, liveMode } = useWorkstation();
  const { dashboard } = fixtures;
  const { processScoreDistribution, directionalPerformance, attentionInsights } = dashboard;

  // ── Weekly review summary (live mode only) ─────────────────────────
  const [sheetOpen, setSheetOpen] = useState(false);
  const [summary, setSummary] = useState<{
    loading: boolean;
    error: string | null;
    review: WeeklyReviewRow | null;
  }>({ loading: false, error: null, review: null });

  // Token guard (same pattern as the sheet): the newest fetch owns the
  // summary state; any response arriving under an older token discards
  // itself so a slow response can never clobber a newer account's data.
  const fetchTokenRef = useRef(0);

  // The current week is detected exactly like the sheet (shared helper),
  // so the summary and the write surface always agree on the boundary.
  const weekStart = useMemo(() => mondayIsoDate(new Date()), []);

  // Panel-local weekly review summary fetch: GET /api/reviews/weekly for
  // the active account, filtered to the current week. `silent` mode (used
  // to reconcile right after a save) never flips the loading/error state —
  // it only upgrades the summary when the persisted list actually contains
  // the current-week review. Failures log with a [review-panel] tag; a
  // non-silent failure surfaces the inline alert in the summary section.
  const refreshSummary = useCallback((opts?: { silent?: boolean }): void => {
    if (!activeAccountId) return;
    const token = ++fetchTokenRef.current;

    const run = async (): Promise<void> => {
      if (!opts?.silent) {
        setSummary({ loading: true, error: null, review: null });
      }

      try {
        const response = await fetch(
          `/api/reviews/weekly?accountId=${encodeURIComponent(activeAccountId)}`,
        );
        if (token !== fetchTokenRef.current) return; // superseded

        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as unknown;
          const message = extractApiError(
            body,
            'Failed to load the weekly review summary',
          );
          console.error(
            `[review-panel] summary fetch failed (${response.status}): ${message}`,
          );
          if (!opts?.silent) {
            setSummary({ loading: false, error: message, review: null });
          }
          return;
        }

        const rows = (await response.json()) as WeeklyReviewRow[];
        if (token !== fetchTokenRef.current) return;

        const current = rows.find((r) => r.weekStart === weekStart) ?? null;
        console.info(
          `[review-panel] summary loaded for week ${weekStart}: ${
            current ? `${current.closedTrades} closed trades` : 'no review'
          }`,
        );

        // In silent (post-save) mode, keep the just-saved row when the
        // persisted list does not (yet) contain the current week — never
        // replace fresh client truth with a stale "no review".
        if (opts?.silent && !current) return;
        setSummary({ loading: false, error: null, review: current });
      } catch (error) {
        if (token !== fetchTokenRef.current) return;
        console.error('[review-panel] summary network failure:', error);
        if (!opts?.silent) {
          setSummary({
            loading: false,
            error: 'Network error — could not load the weekly review summary',
            review: null,
          });
        }
      }
    };

    void run();
  }, [activeAccountId, weekStart]);

  // Load the current week's review summary on mount, on account change,
  // and when live mode turns on. Fixture mode never fetches.
  useEffect(() => {
    if (!liveMode || !activeAccountId) return;
    refreshSummary();
  }, [liveMode, activeAccountId, refreshSummary]);

  // SPA-continuous refresh: apply the saved row immediately (the sheet's
  // PUT response is already the persisted row), then reconcile against the
  // persisted list in the background. Failures during reconcile only log.
  const handleSaved = (review: WeeklyReviewRow): void => {
    setSummary({ loading: false, error: null, review });
    refreshSummary({ silent: true });
  };

  const hasScores = processScoreDistribution !== undefined && processScoreDistribution.length > 0;
  const hasDirectional = directionalPerformance !== undefined;
  const insights = attentionInsights?.insights ?? [];
  const hasInsights = insights.length > 0;
  // AttentionInsightsResult.insights is already ordered most-important
  // first (critical → warning → info); take the top 3 for density.
  const topInsights = hasInsights ? insights.slice(0, 3) : [];

  return (
    <section
      className="ws-panel"
      style={{ gridArea: 'review' }}
      data-testid="ws-panel-process-review"
    >
      <div className="ws-panel-header">
        <span>Review Metrics</span>
        {liveMode && (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            data-testid="ws-update-review"
            onClick={() => setSheetOpen(true)}
          >
            Update review
          </Button>
        )}
      </div>
      <div className="ws-panel-body">

        {/* ── Weekly Review Summary (live mode only) ────────────────── */}
        {liveMode && (
          <div
            className="mb-3 rounded-lg border border-border p-3"
            data-testid="ws-weekly-review-summary"
          >
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Weekly Review
              </span>
              {summary.review && (
                <span
                  className="ws-mono text-xs text-muted-foreground"
                  data-testid="ws-weekly-review-week"
                >
                  {formatWeekRange(summary.review.weekStart, summary.review.weekEnd)}
                </span>
              )}
            </div>

            <div aria-live="polite">
              {summary.loading && (
                <div
                  className="py-1 text-sm text-muted-foreground"
                  data-testid="ws-weekly-review-loading"
                >
                  Loading review…
                </div>
              )}

              {!summary.loading && summary.error && (
                <div
                  className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                  data-testid="ws-weekly-review-error"
                  role="alert"
                >
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <div className="flex-1">
                    <p>{summary.error}</p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2"
                      data-testid="ws-weekly-review-retry"
                      onClick={() => refreshSummary()}
                    >
                      <RotateCcw className="size-3.5" />
                      Retry
                    </Button>
                  </div>
                </div>
              )}

              {!summary.loading && !summary.error && summary.review === null && (
                <div
                  className="py-1 text-sm text-muted-foreground"
                  data-testid="ws-weekly-review-empty"
                >
                  No review this week
                </div>
              )}

              {!summary.loading && summary.review && (
                <WeeklyReviewSummary review={summary.review} />
              )}
            </div>
          </div>
        )}

        {/* ── Process Score Distribution ─────────────────────────────── */}
        <div data-testid="ws-process-score-dist">
          {hasScores ? (
            <ProcessScoreDistribution bins={processScoreDistribution!} />
          ) : (
            <div className="ws-empty">No process scores</div>
          )}
        </div>

        {/* ── Directional Performance ────────────────────────────────── */}
        <div data-testid="ws-directional-performance">
          {hasDirectional ? (
            <DirectionalPerformance data={directionalPerformance!} />
          ) : (
            <div className="ws-empty">No directional data</div>
          )}
        </div>

        {/* ── Attention Items ────────────────────────────────────────── */}
        <div data-testid="ws-attention-items">
          {hasInsights ? (
            <ul className="ws-attention-list">
              {topInsights.map((insight: AttentionInsight, i: number) => (
                <li
                  key={`${insight.type}-${i}`}
                  className="ws-attention-item"
                  data-testid={`ws-attention-item-${i}`}
                >
                  <span
                    className={`ws-severity-badge ${severityIndicatorClass(insight.severity)}`}
                    data-testid={`ws-severity-${insight.severity}`}
                  >
                    {severityLabel(insight.severity)}
                  </span>
                  <span className="ws-attention-title">{insight.title}</span>
                  <span className="ws-attention-message">{insight.message}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="ws-empty">No attention items</div>
          )}
        </div>

      </div>

      {/* ── Weekly review write sheet (live mode only) ───────────────── */}
      {liveMode && (
        <ReviewWriteSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          onSaved={handleSaved}
        />
      )}
    </section>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────

/** Current-week review summary: dense 2-column metric grid mirroring the
 *  sheet's auto-computed metrics (trades, net P&L, win rate, avg R, grade). */
function WeeklyReviewSummary({ review }: { review: WeeklyReviewRow }) {
  const grade = gradeLabelFromScore(review.avgProcessScore);
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <dt className="text-sm text-muted-foreground">Trades</dt>
        <dd
          className="ws-num ws-mono text-sm"
          data-testid="ws-weekly-review-metric-trades"
        >
          {review.closedTrades}
        </dd>
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <dt className="text-sm text-muted-foreground">Net P&amp;L</dt>
        <dd
          className={`ws-num ws-mono text-sm ${pnlClass(review.netPnl)}`}
          data-testid="ws-weekly-review-metric-netpnl"
        >
          {fmtCurrency(review.netPnl)}
        </dd>
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <dt className="text-sm text-muted-foreground">Win Rate</dt>
        <dd
          className="ws-num ws-mono text-sm"
          data-testid="ws-weekly-review-metric-winrate"
        >
          {fmtPct(review.winRate)}
        </dd>
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <dt className="text-sm text-muted-foreground">Avg R</dt>
        <dd
          className="ws-num ws-mono text-sm"
          data-testid="ws-weekly-review-metric-avgr"
        >
          {fmtDecimal(review.avgR)}
        </dd>
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <dt className="text-sm text-muted-foreground">Process grade</dt>
        <dd
          className="ws-num ws-mono text-sm"
          data-testid="ws-weekly-review-metric-grade"
        >
          {review.avgProcessScore === null || review.avgProcessScore === undefined
            ? '—'
            : `${grade} (${fmtDecimal(review.avgProcessScore, 1)})`}
        </dd>
      </div>
    </dl>
  );
}

function ProcessScoreDistribution({ bins }: { bins: ProcessScoreBin[] }) {
  const maxCount = Math.max(...bins.map((b) => b.count), 1);

  return (
    <div className="ws-process-score-bars">
      {bins.map((bin) => {
        const widthPct = Math.round((bin.count / maxCount) * 100);
        const colorCls = gradeClass(bin.label);
        return (
          <div
            key={bin.label}
            className="ws-stat-row"
            data-testid="ws-process-score-row"
          >
            <span className="ws-mono" style={{ minWidth: '6em' }}>{bin.label}</span>
            <span
              className={`ws-process-bar ${colorCls}`}
              style={{ width: `${widthPct}%`, minWidth: bin.count > 0 ? '2px' : '0' }}
            />
            <span className="ws-num ws-mono">{bin.count}</span>
          </div>
        );
      })}
    </div>
  );
}

function DirectionalPerformance({ data }: { data: DirectionalPerformanceResult }) {
  return (
    <div className="ws-directional-grid">
      <div data-testid="ws-dir-perf-long">
        <div className="ws-stat-row">
          <span>Long</span>
        </div>
        <div className="ws-stat-row">
          <span>Trades</span>
          <span className="ws-num ws-mono">{data.long.tradeCount}</span>
        </div>
        <div className="ws-stat-row">
          <span>Net P&L</span>
          <span className={`ws-num ws-mono ${pnlClass(data.long.netPnl)}`}>
            {fmtCurrency(data.long.netPnl)}
          </span>
        </div>
        <div className="ws-stat-row">
          <span>Win Rate</span>
          <span className="ws-num ws-mono">{fmtPct(data.long.winRate)}</span>
        </div>
      </div>
      <div data-testid="ws-dir-perf-short">
        <div className="ws-stat-row">
          <span>Short</span>
        </div>
        <div className="ws-stat-row">
          <span>Trades</span>
          <span className="ws-num ws-mono">{data.short.tradeCount}</span>
        </div>
        <div className="ws-stat-row">
          <span>Net P&L</span>
          <span className={`ws-num ws-mono ${pnlClass(data.short.netPnl)}`}>
            {fmtCurrency(data.short.netPnl)}
          </span>
        </div>
        <div className="ws-stat-row">
          <span>Win Rate</span>
          <span className="ws-num ws-mono">{fmtPct(data.short.winRate)}</span>
        </div>
      </div>
    </div>
  );
}
