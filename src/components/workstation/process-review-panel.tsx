'use client';

// ProcessReviewPanel — process discipline, directional performance, and
// attention items for the workstation.
//
// Reads dashboard catalogue data (processScoreDistribution,
// directionalPerformance, attentionInsights) exclusively from
// WorkstationContext. The panel is read-only in both live and fixture mode:
// it renders the shared snapshot and never fetches on its own.
//
// Sub-sections:
//   1. Process Score Distribution — grade distribution bars (A–F)
//   2. Directional Performance — long vs short P&L and win rate
//   3. Attention Items — top 3 highest-attention insights (severity-sorted)
//      with severity indicators
//
// Panel header reads 'Review Metrics' per WORKSTATION_PANEL_CATALOGUE
// (compact, action-oriented dense summary row).
//
// CSS classes: ws-panel, ws-panel-header, ws-panel-body, ws-num, ws-pos,
// ws-neg, ws-stat-row, ws-mono, ws-empty.
//
// data-testid attributes:
//   ws-panel-process-review, ws-process-score-dist, ws-process-score-row,
//   ws-directional-performance, ws-dir-perf-long, ws-dir-perf-short,
//   ws-attention-items, ws-attention-item-{index}, ws-severity-{severity}

import { useWorkstation } from './workstation-context';
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
  const { fixtures } = useWorkstation();
  const { dashboard } = fixtures;
  const { processScoreDistribution, directionalPerformance, attentionInsights } = dashboard;

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
      </div>
      <div className="ws-panel-body">

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
    </section>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────

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
