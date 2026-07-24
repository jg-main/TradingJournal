'use client';

// SetupsPanel — three vertically-stacked sub-panels replacing the placeholder
// insights panel: Setup Ranking (per-setup win rate, sample size, avgR,
// process score with sample-size-warning indicators), Attention Insights
// (severity-prefixed list with critical/warning/info badges), and Trade Ideas
// (compact table with entry, stop, target, risk/reward).
//
// All data flows through WorkstationContext — no independent fetches.
// Renders its own Panel chrome (header + body) so the shell drops
// <SetupsPanel /> directly into the "insights" grid area.
//
// data-testid attributes per slice verification contract:
//   ws-setup-ranking-table, ws-setup-row-{setupId}, ws-sample-size-warning,
//   ws-attention-insights-list, ws-insight-item-{type},
//   ws-severity-{severity}, ws-ideas-table, ws-idea-row-{symbol},
//   ws-setups-ideas-empty (consolidated empty state)

import { useWorkstation } from './workstation-context';
import type { SetupPerfResult, SampleSizeWarning } from '@/lib/review-dashboard';
import type { AttentionInsight, InsightSeverity } from '@/lib/attention-insights';
import type { TradeIdea } from '@/lib/workstation-fixtures';

// ── Formatters ──────────────────────────────────────────────────────────

function fmtWinRate(value: number | null): string {
  if (value === null) return '—';
  return `${value.toFixed(0)}%`;
}

function fmtAvgR(value: number | null): string {
  if (value === null) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}R`;
}

function fmtProcessScore(value: number | null): string {
  if (value === null) return '—';
  return value.toFixed(1);
}

function fmtRatio(value: number | null): string {
  if (value === null) return '—';
  return `1:${value.toFixed(2)}`;
}

function fmtPrice(value: number | null): string {
  if (value === null) return '—';
  return value.toFixed(2);
}

function dirClass(direction: 'long' | 'short'): string {
  return direction === 'long' ? 'ws-dir-long' : 'ws-dir-short';
}

function dirLabel(direction: 'long' | 'short'): string {
  return direction === 'long' ? 'L' : 'S';
}

// ── Render helpers ──────────────────────────────────────────────────────

/** Color mapping for sample-size warnings. */
function sampleSizeClass(warning: SampleSizeWarning): string {
  switch (warning) {
    case 'very_small':
      return 'ws-severity-critical';
    case 'small':
      return 'ws-severity-warning';
    default:
      return '';
  }
}

function sampleSizeLabel(warning: SampleSizeWarning): string {
  switch (warning) {
    case 'very_small':
      return '<10';
    case 'small':
      return '<30';
    default:
      return '';
  }
}

/** Color mapping for insight severity badges. */
function severityClass(severity: InsightSeverity): string {
  switch (severity) {
    case 'critical':
      return 'ws-severity-critical';
    case 'warning':
      return 'ws-severity-warning';
    case 'info':
      return 'ws-severity-info';
  }
}

function severityLabel(severity: InsightSeverity): string {
  switch (severity) {
    case 'critical':
      return 'CRIT';
    case 'warning':
      return 'WARN';
    case 'info':
      return 'INFO';
  }
}

// ── Sub-section header ──────────────────────────────────────────────────

function SubHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="ws-setups-subheader">
      <span>{label}</span>
      <span className="ws-setups-subheader-count">{count}</span>
    </div>
  );
}

// ── Component ───────────────────────────────────────────────────────────

export function SetupsPanel() {
  const { fixtures } = useWorkstation();
  const { dashboard, tradeIdeas } = fixtures;
  const { setupRanking, attentionInsights } = dashboard;

  const hasSetups = setupRanking.length > 0;
  const hasInsights = attentionInsights.insights.length > 0;
  const hasIdeas = tradeIdeas.length > 0;
  const allEmpty = !hasSetups && !hasInsights && !hasIdeas;

  // ── Consolidated empty state ──────────────────────────────────────────
  if (allEmpty) {
    return (
      <section
        className="ws-panel"
        style={{ gridArea: 'insights' }}
        data-testid="ws-panel-insights"
      >
        <div className="ws-panel-header">
          <span>Setups &amp; Ideas</span>
        </div>
        <div className="ws-panel-body">
          <div
            className="ws-empty"
            data-testid="ws-setups-ideas-empty"
          >
            No setups or trade ideas to display
          </div>
        </div>
      </section>
    );
  }

  // ── Populated state ───────────────────────────────────────────────────
  return (
    <section
      className="ws-panel"
      style={{ gridArea: 'insights' }}
      data-testid="ws-panel-insights"
    >
      <div className="ws-panel-header">
        <span>Setups &amp; Ideas</span>
        <span className="ws-panel-meta ws-mono">
          {setupRanking.length} setups
        </span>
      </div>
      <div className="ws-panel-body">

        {/* ── Setup Ranking ───────────────────────────────────────────── */}
        <SubHeader label="Setup Ranking" count={setupRanking.length} />

        {hasSetups ? (
          <table
            className="ws-table"
            data-testid="ws-setup-ranking-table"
          >
            <thead>
              <tr>
                <th>Setup</th>
                <th className="ws-num">Win %</th>
                <th className="ws-num">N</th>
                <th className="ws-num">Avg R</th>
                <th className="ws-num">Score</th>
              </tr>
            </thead>
            <tbody>
              {setupRanking.map((setup: SetupPerfResult) => (
                <tr
                  key={setup.setupId ?? `setup-${setup.setupName}`}
                  data-testid={`ws-setup-row-${setup.setupId ?? setup.setupName}`}
                >
                  <td>{setup.setupName}</td>
                  <td className="ws-num">{fmtWinRate(setup.winRate)}</td>
                  <td className="ws-num">
                    {setup.count}
                    {setup.sampleSizeWarning !== 'moderate' &&
                      setup.sampleSizeWarning !== 'adequate' && (
                      <span
                        className={`ws-sample-size-warning ${sampleSizeClass(setup.sampleSizeWarning)}`}
                        data-testid="ws-sample-size-warning"
                        title={`Sample size: ${setup.sampleSizeWarning.replace('_', ' ')} (${setup.count} trades)`}
                      >
                        {' '}{sampleSizeLabel(setup.sampleSizeWarning)}
                      </span>
                    )}
                  </td>
                  <td
                    className={`ws-num ${setup.avgR !== null && setup.avgR > 0 ? 'ws-pos' : setup.avgR !== null && setup.avgR < 0 ? 'ws-neg' : ''}`}
                  >
                    {fmtAvgR(setup.avgR)}
                  </td>
                  <td className="ws-num">{fmtProcessScore(setup.avgProcessScore)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="ws-empty ws-setups-empty" data-testid="ws-setups-ideas-empty">
            No setup data
          </div>
        )}

        {/* ── Attention Insights ──────────────────────────────────────── */}
        <SubHeader label="Attention" count={attentionInsights.insights.length} />

        {hasInsights ? (
          <ul
            className="ws-insights-list"
            data-testid="ws-attention-insights-list"
          >
            {attentionInsights.insights.map((insight: AttentionInsight, i: number) => (
              <li
                key={`${insight.type}-${i}`}
                className="ws-insight-item"
                data-testid={`ws-insight-item-${insight.type}`}
              >
                <span
                  className={`ws-severity-badge ${severityClass(insight.severity)}`}
                  data-testid={`ws-severity-${insight.severity}`}
                >
                  {severityLabel(insight.severity)}
                </span>
                <span className="ws-insight-message">{insight.message}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="ws-empty ws-setups-empty" data-testid="ws-setups-ideas-empty">
            No insights
          </div>
        )}

        {/* ── Trade Ideas ─────────────────────────────────────────────── */}
        <SubHeader label="Trade Ideas" count={tradeIdeas.length} />

        {hasIdeas ? (
          <table
            className="ws-table"
            data-testid="ws-ideas-table"
          >
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Setup</th>
                <th>Dir</th>
                <th className="ws-num">Entry</th>
                <th className="ws-num">Stop</th>
                <th className="ws-num">Target</th>
                <th className="ws-num">R/R</th>
              </tr>
            </thead>
            <tbody>
              {tradeIdeas.map((idea: TradeIdea) => (
                <tr
                  key={idea.watchlistItemId}
                  data-testid={`ws-idea-row-${idea.symbol}`}
                >
                  <td className="ws-mono">{idea.symbol}</td>
                  <td>{idea.setupName ?? '—'}</td>
                  <td className={dirClass(idea.direction)}>
                    {dirLabel(idea.direction)}
                  </td>
                  <td className="ws-num">{fmtPrice(idea.entryPrice)}</td>
                  <td className="ws-num">{fmtPrice(idea.stopPrice)}</td>
                  <td className="ws-num">{fmtPrice(idea.targetPrice)}</td>
                  <td className="ws-num">
                    {fmtRatio(idea.riskRewardRatio)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="ws-empty ws-setups-empty" data-testid="ws-setups-ideas-empty">
            No trade ideas
          </div>
        )}

      </div>
    </section>
  );
}
