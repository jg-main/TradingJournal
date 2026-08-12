'use client';

// DataQualityAlertStrip — fixed data-quality alert strip for the
// workstation first screen (S04 T01).
//
// Consumes ONLY the DashboardV2Response (the workstation context's
// fixtures.dashboardV2) and gates on the API's own provenance state —
// classification is never re-implemented here:
//
//   - valuation.state                  → partial / stale / unavailable marks
//   - riskSummary.stopCoverage.state   → incomplete stop coverage
//   - journalLinked.provenance.status  → journal reconciliation divergence
//   - integrity.status / warnings      → account integrity errors
//
// The strip trusts the API aggregate state and renders it verbatim,
// together with the provenance metadata (source, as-of, computed-at) each
// section already declares. It is a pure consumer of API state — no new
// server-side observability, no local freshness/coverage computation.
//
// Per requirements §5.1, §8.2 and §9 (DASH-AC-02/05/06): the strip sits
// above the main grid, outside any editable layout, and cannot be
// dismissed as resolved until the underlying condition is resolved —
// there is deliberately no dismiss affordance. State is conveyed by text
// (state chip, qualified presentationLabel, message) as well as color,
// per §8.3.

import type { DashboardV2Response } from '@/lib/accounting/dashboard-v2';

/** Severity of one data-quality alert. */
export type DataQualityAlertSeverity = 'critical' | 'warning';

/** One derived data-quality alert. Every field traces back to API state. */
export interface DataQualityAlert {
  /** Stable alert id — one per gating section. */
  id: 'valuation' | 'stop-coverage' | 'journal-linked' | 'integrity';
  severity: DataQualityAlertSeverity;
  /**
   * The API-declared state that gates this alert
   * (valuation.state / stopCoverage.state / journalLinked.provenance.status
   * / integrity.status). Rendered as visible text — never color-only.
   */
  state: string;
  title: string;
  /**
   * Qualified display hint the API already computed for this section
   * (valuation.presentationLabel / stopCoverage.presentationLabel), or
   * null when the section provides none.
   */
  presentationLabel: string | null;
  message: string;
  /** Provenance metadata carried through from the API response section. */
  provenance: {
    source: string;
    asOf: string | null;
    computedAt: string;
  };
}

/** Compact UTC rendering of an ISO-8601 timestamp for provenance lines. */
function fmtTimestamp(value: string | null): string {
  if (!value) return 'n/a';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/**
 * Derive the data-quality alerts for one dashboard V2 snapshot.
 *
 * Pure function of the API response: each alert is gated exclusively on an
 * API-declared state field. The strip never recomputes freshness, coverage,
 * or reconciliation status from raw position rows or timestamps — if the
 * API declares a section complete, no alert fires for it, even when a row
 * looks inconsistent (the API aggregate is the authority).
 */
export function deriveDataQualityAlerts(
  dashboardV2: DashboardV2Response,
): DataQualityAlert[] {
  const alerts: DataQualityAlert[] = [];
  const { valuation, riskSummary, journalLinked, integrity } = dashboardV2;

  // ── Valuation completeness ───────────────────────────────────────────
  if (valuation.state !== 'complete') {
    const severity =
      valuation.state === 'unavailable' ? 'critical' : 'warning';
    const title =
      valuation.state === 'unavailable'
        ? 'Valuation unavailable'
        : valuation.state === 'stale'
          ? 'Valuation stale'
          : 'Valuation partial';
    const message =
      valuation.presentationLabel ??
      (valuation.state === 'stale'
        ? `All ${valuation.stale} mark(s) are stale — showing last-known values.`
        : `${valuation.missing} position(s) have no mark, ${valuation.stale} stale.`);
    alerts.push({
      id: 'valuation',
      severity,
      state: valuation.state,
      title,
      presentationLabel: valuation.presentationLabel,
      message,
      provenance: pickProvenance(valuation.provenance),
    });
  }

  // ── Stop coverage ────────────────────────────────────────────────────
  const stopCoverage = riskSummary.stopCoverage;
  if (stopCoverage.state === 'partial') {
    alerts.push({
      id: 'stop-coverage',
      severity: 'warning',
      state: stopCoverage.state,
      title: 'Stop coverage incomplete',
      presentationLabel: stopCoverage.presentationLabel,
      message:
        stopCoverage.presentationLabel ??
        `${stopCoverage.withoutStop} of ${stopCoverage.openTrades} open trade(s) have no valid stop.`,
      provenance: pickProvenance(riskSummary.provenance),
    });
  }

  // ── Journal reconciliation ───────────────────────────────────────────
  const journalProvenance = journalLinked.provenance;
  if (journalProvenance.status !== 'complete') {
    const mismatches = journalLinked.comparisons.filter(
      (c) => c.status === 'mismatch',
    ).length;
    const severity =
      journalProvenance.status === 'unavailable' ? 'critical' : 'warning';
    const message =
      journalProvenance.status === 'unavailable'
        ? 'No open journal trades to reconcile — journal-linked values are not comparable to the Trades surface.'
        : journalLinked.comparisons.length === 0
          ? 'Some journal-linked positions could not be reconciled against an open journal trade.'
          : `${mismatches} of ${journalLinked.comparisons.length} journal-linked comparison(s) mismatch the Trades surface.`;
    alerts.push({
      id: 'journal-linked',
      severity,
      state: journalProvenance.status,
      title:
        journalProvenance.status === 'unavailable'
          ? 'Journal reconciliation unavailable'
          : 'Journal reconciliation diverges',
      presentationLabel: null,
      message,
      provenance: {
        source: journalProvenance.source,
        asOf: journalProvenance.asOf,
        computedAt: journalProvenance.computedAt,
      },
    });
  }

  // ── Account integrity ────────────────────────────────────────────────
  if (integrity.status !== 'healthy' && integrity.warnings.length > 0) {
    alerts.push({
      id: 'integrity',
      severity: integrity.status === 'critical' ? 'critical' : 'warning',
      state: integrity.status,
      title: 'Account integrity',
      presentationLabel: null,
      message: integrity.warnings.join(' '),
      provenance: {
        source: 'account snapshot',
        asOf: null,
        computedAt: dashboardV2.computedAt,
      },
    });
  }

  return alerts;
}

/** Copy the provenance fields the strip renders from an API section. */
function pickProvenance(provenance: {
  source: string;
  asOf: string | null;
  computedAt: string;
}): DataQualityAlert['provenance'] {
  return {
    source: provenance.source,
    asOf: provenance.asOf,
    computedAt: provenance.computedAt,
  };
}

/**
 * DataQualityAlertStrip — renders one compact alert per gated condition.
 *
 * Renders nothing when every section is complete/healthy. Each alert shows
 * the API-declared state chip, the qualified presentationLabel (when the
 * API provides one), a human message, and the provenance metadata
 * (source · as-of · computed-at) carried from the API response. No dismiss
 * affordance: the strip clears only when the underlying condition clears.
 */
export function DataQualityAlertStrip({
  dashboardV2,
}: {
  dashboardV2: DashboardV2Response;
}) {
  const alerts = deriveDataQualityAlerts(dashboardV2);
  if (alerts.length === 0) return null;

  return (
    <section
      className="ws-data-quality"
      data-testid="ws-data-quality-alert-strip"
      role="region"
      aria-label="Data quality alerts"
    >
      {alerts.map((alert) => (
        <article
          key={alert.id}
          className={`ws-dq-alert ws-dq-${alert.severity}`}
          data-testid={`ws-dq-alert-${alert.id}`}
          role="alert"
        >
          <div className="ws-dq-head">
            <span className="ws-dq-title">{alert.title}</span>
            <span
              className="ws-dq-state ws-mono"
              data-testid={`ws-dq-state-${alert.id}`}
            >
              {alert.state}
            </span>
          </div>
          {alert.presentationLabel && (
            <div
              className="ws-dq-label ws-mono"
              data-testid={`ws-dq-label-${alert.id}`}
            >
              {alert.presentationLabel}
            </div>
          )}
          <div className="ws-dq-message">{alert.message}</div>
          <div
            className="ws-dq-provenance ws-mono"
            data-testid={`ws-dq-provenance-${alert.id}`}
          >
            source {alert.provenance.source} · as-of{' '}
            {fmtTimestamp(alert.provenance.asOf)} · computed{' '}
            {fmtTimestamp(alert.provenance.computedAt)}
          </div>
        </article>
      ))}
    </section>
  );
}
