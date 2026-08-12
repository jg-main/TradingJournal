/**
 * Tests for the workstation data-quality alert strip (S04 T01).
 *
 * The strip is a pure consumer of API provenance state: every alert is
 * gated exclusively on an API-declared state field (valuation.state,
 * riskSummary.stopCoverage.state, journalLinked.provenance.status,
 * integrity.status) and never re-implements classification from raw
 * position rows or timestamps. These tests pin:
 *
 *   - gating per condition (partial / stale / unavailable / integrity)
 *   - qualified presentationLabel rendering
 *   - provenance metadata carried through (source, as-of, computed-at)
 *   - the never-re-implement contract (API aggregate is the authority)
 *   - component rendering semantics (roles, testids, no dismiss affordance)
 *
 * Run: npx vitest run src/components/workstation/data-quality-alert-strip.test.tsx
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';

import type { DashboardV2Response } from '@/lib/accounting/dashboard-v2';
import {
  DataQualityAlertStrip,
  deriveDataQualityAlerts,
} from './data-quality-alert-strip';

// ── Fixture helpers ────────────────────────────────────────────────────
// A minimal, fully healthy DashboardV2Response. Each test overrides only
// the section it exercises so the remaining sections stay baseline-clean.

const COMPUTED_AT = '2026-07-17T20:15:00.000Z';
const AS_OF = '2026-07-17T19:58:00.000Z';

function provenance(
  source: string,
  asOf: string | null,
  status: DashboardV2Response['valuation']['state'],
) {
  return { source, asOf, computedAt: COMPUTED_AT, status, presentationLabel: null };
}

function baseDashboardV2(): DashboardV2Response {
  return {
    snapshotId: `snap:acc-1:${COMPUTED_AT}`,
    account: { id: 'acc-1', name: 'Primary', currency: 'USD' },
    scopes: {
      accountPositions: {
        id: 'account_positions',
        section: 'valuation',
        description: 'Open positions with valuation marks.',
        source: 'account_positions + valuation_marks',
        asOf: AS_OF,
      },
      journalTrades: {
        id: 'journal_trades',
        section: 'journalAttribution',
        description: 'Journal trade linkage.',
        source: 'accounting_executions + trades',
        asOf: COMPUTED_AT,
      },
      periodPerformance: {
        id: 'period_performance',
        section: 'metrics',
        description: 'Period performance projection.',
        source: 'account_performance',
        asOf: COMPUTED_AT,
      },
    },
    metrics: {
      cash: '1000.00',
      nav: '10000.00',
      markedPositions: '0.00',
      realizedPnl: '100.00',
      unrealizedPnl: '0.00',
      totalPnl: '100.00',
      realizedFees: '0.00',
      grossExposure: '0.00',
      netExposure: '0.00',
      drawdown: '0.00',
      drawdownPct: '0.00',
      modifiedDietzReturn: '0.01',
      twr: '0.01',
      provenance: provenance('account_performance', COMPUTED_AT, 'complete'),
    },
    valuation: {
      positionsTotal: 0,
      fresh: 0,
      stale: 0,
      missing: 0,
      state: 'complete',
      coveragePct: null,
      presentationLabel: null,
      markedSubsetPnl: null,
      positions: [],
      provenance: provenance('account_positions + valuation_marks', AS_OF, 'complete'),
    },
    journalAttribution: {
      hasJournalTrades: false,
      journalExecutionCount: 0,
      accountOnlyExecutionCount: 0,
      provenance: provenance('accounting_executions', COMPUTED_AT, 'complete'),
    },
    journalLinked: {
      tradeCount: 0,
      positionCount: 0,
      remainingQty: '0.00',
      openAvgCost: null,
      grossRealizedPnl: '0.00',
      netRealizedPnl: '0.00',
      netUnrealizedPnl: null,
      openFees: '0.00',
      comparisons: [],
      provenance: {
        source: 'accounting_executions + trades + fifo_lots',
        asOf: COMPUTED_AT,
        computedAt: COMPUTED_AT,
        status: 'complete',
        presentationLabel: null,
      },
    },
    reconciliation: {
      eligible: true,
      refusalReasons: [],
      comparisons: null,
      totals: null,
      provenance: provenance('reconciliation_report', COMPUTED_AT, 'complete'),
    },
    riskSummary: {
      openPnl: '0.00',
      openRisk: '0.00',
      portfolioHeat: '0.00',
      missingStops: 0,
      positionsWithStop: 0,
      openRiskToStop: '0.00',
      stopCoverage: {
        openTrades: 0,
        withStop: 0,
        withoutStop: 0,
        state: 'complete',
        presentationLabel: null,
      },
      provenance: provenance(
        'account_positions + trades + trade_risk_snapshots',
        AS_OF,
        'complete',
      ),
    },
    integrity: { status: 'healthy', warnings: [] },
    computedAt: COMPUTED_AT,
  };
}

/** Keys of DashboardV2Response whose value is an object (spreadable). */
type ObjectSection = {
  [K in keyof DashboardV2Response]: DashboardV2Response[K] extends object
    ? K
    : never;
}[keyof DashboardV2Response];

/** Shallow-override a top-level object section of the response. */
function withSection<T extends ObjectSection>(
  base: DashboardV2Response,
  key: T,
  patch: Partial<DashboardV2Response[T]>,
): DashboardV2Response {
  return { ...base, [key]: { ...base[key], ...patch } };
}

// ── Derivation tests ───────────────────────────────────────────────────

describe('deriveDataQualityAlerts', () => {
  it('returns no alerts for a fully healthy snapshot', () => {
    const alerts = deriveDataQualityAlerts(baseDashboardV2());
    expect(alerts).toEqual([]);
  });

  it('gates valuation partial on valuation.state and carries the qualified presentationLabel', () => {
    const alerts = deriveDataQualityAlerts(
      withSection(baseDashboardV2(), 'valuation', {
        state: 'partial',
        fresh: 2,
        stale: 1,
        missing: 0,
        presentationLabel: '— Partial — 1 unpriced',
        provenance: provenance('account_positions + valuation_marks', AS_OF, 'partial'),
      }),
    );

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      id: 'valuation',
      severity: 'warning',
      state: 'partial',
      title: 'Valuation partial',
      presentationLabel: '— Partial — 1 unpriced',
    });
    // Provenance metadata carried through from the API response.
    expect(alerts[0].provenance).toEqual({
      source: 'account_positions + valuation_marks',
      asOf: AS_OF,
      computedAt: COMPUTED_AT,
    });
  });

  it('classifies valuation unavailable as critical', () => {
    const alerts = deriveDataQualityAlerts(
      withSection(baseDashboardV2(), 'valuation', {
        state: 'unavailable',
        fresh: 0,
        stale: 0,
        missing: 3,
        presentationLabel: '— Unavailable — 3 unpriced',
        provenance: provenance('account_positions + valuation_marks', null, 'unavailable'),
      }),
    );

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      id: 'valuation',
      severity: 'critical',
      state: 'unavailable',
      title: 'Valuation unavailable',
      presentationLabel: '— Unavailable — 3 unpriced',
    });
    expect(alerts[0].provenance.asOf).toBeNull();
  });

  it('fires a warning when every mark is stale (state-driven, no local age math)', () => {
    const alerts = deriveDataQualityAlerts(
      withSection(baseDashboardV2(), 'valuation', {
        state: 'stale',
        fresh: 0,
        stale: 2,
        missing: 0,
        presentationLabel: null,
        provenance: provenance('account_positions + valuation_marks', AS_OF, 'stale'),
      }),
    );

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      id: 'valuation',
      severity: 'warning',
      state: 'stale',
      presentationLabel: null,
    });
    // Fallback message derived from API counts, not recomputed timestamps.
    expect(alerts[0].message).toContain('stale');
  });

  it('gates stop-coverage alerts on stopCoverage.state partial', () => {
    const base = baseDashboardV2();
    const alerts = deriveDataQualityAlerts(
      withSection(base, 'riskSummary', {
        stopCoverage: {
          openTrades: 3,
          withStop: 2,
          withoutStop: 1,
          state: 'partial',
          presentationLabel: 'Incomplete — 1 without a valid stop',
        },
      }),
    );

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      id: 'stop-coverage',
      severity: 'warning',
      state: 'partial',
      title: 'Stop coverage incomplete',
      presentationLabel: 'Incomplete — 1 without a valid stop',
    });
  });

  it('does not fire a stop-coverage alert when coverage is complete', () => {
    const base = baseDashboardV2();
    const alerts = deriveDataQualityAlerts(
      withSection(base, 'riskSummary', {
        stopCoverage: {
          openTrades: 3,
          withStop: 3,
          withoutStop: 0,
          state: 'complete',
          presentationLabel: null,
        },
      }),
    );

    expect(alerts.filter((a) => a.id === 'stop-coverage')).toEqual([]);
  });

  it('gates journal-linked alerts on provenance.status partial and counts mismatches', () => {
    const base = baseDashboardV2();
    const alerts = deriveDataQualityAlerts(
      withSection(base, 'journalLinked', {
        tradeCount: 3,
        comparisons: [
          {
            key: 'remainingQty',
            description: 'Remaining open quantity',
            dashboardValue: '200.00',
            tradesValue: '180.00',
            difference: '20.00',
            status: 'mismatch',
          },
          {
            key: 'openFees',
            description: 'Fees remaining on open entry lots',
            dashboardValue: '6.80',
            tradesValue: '6.80',
            difference: '0.00',
            status: 'match',
          },
        ],
        provenance: {
          source: 'accounting_executions + trades + fifo_lots',
          asOf: COMPUTED_AT,
          computedAt: COMPUTED_AT,
          status: 'partial',
          presentationLabel: null,
        },
      }),
    );

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      id: 'journal-linked',
      severity: 'warning',
      state: 'partial',
      title: 'Journal reconciliation diverges',
    });
    expect(alerts[0].message).toBe(
      '1 of 2 journal-linked comparison(s) mismatch the Trades surface.',
    );
  });

  it('classifies journal reconciliation unavailable as critical', () => {
    const base = baseDashboardV2();
    const alerts = deriveDataQualityAlerts(
      withSection(base, 'journalLinked', {
        tradeCount: 0,
        comparisons: [],
        provenance: {
          source: 'accounting_executions + trades + fifo_lots',
          asOf: null,
          computedAt: COMPUTED_AT,
          status: 'unavailable',
          presentationLabel: null,
        },
      }),
    );

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      id: 'journal-linked',
      severity: 'critical',
      state: 'unavailable',
      title: 'Journal reconciliation unavailable',
    });
  });

  it('surfaces integrity warnings when the API declares them', () => {
    const base = baseDashboardV2();
    const alerts = deriveDataQualityAlerts(
      withSection(base, 'integrity', {
        status: 'warning',
        warnings: ['TSLA mark is stale (24h old).'],
      }),
    );

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      id: 'integrity',
      severity: 'warning',
      state: 'warning',
      title: 'Account integrity',
    });
    expect(alerts[0].message).toContain('TSLA mark is stale');
    expect(alerts[0].provenance.computedAt).toBe(COMPUTED_AT);
  });

  it('classifies integrity critical as a critical alert', () => {
    const base = baseDashboardV2();
    const alerts = deriveDataQualityAlerts(
      withSection(base, 'integrity', {
        status: 'critical',
        warnings: ['3 position(s) have no valuation mark.'],
      }),
    );

    expect(alerts[0]).toMatchObject({
      id: 'integrity',
      severity: 'critical',
      state: 'critical',
    });
  });

  it('fires all active conditions together', () => {
    const base = baseDashboardV2();
    const snapshot: DashboardV2Response = {
      ...withSection(base, 'valuation', {
        state: 'partial',
        fresh: 2,
        stale: 1,
        missing: 0,
        presentationLabel: '— Partial — 1 unpriced',
      }),
      riskSummary: {
        ...base.riskSummary,
        stopCoverage: {
          openTrades: 3,
          withStop: 2,
          withoutStop: 1,
          state: 'partial',
          presentationLabel: 'Incomplete — 1 without a valid stop',
        },
      },
      integrity: {
        status: 'warning',
        warnings: ['TSLA mark is stale (24h old).'],
      },
    };

    const alerts = deriveDataQualityAlerts(snapshot);
    expect(alerts.map((a) => a.id).sort()).toEqual([
      'integrity',
      'stop-coverage',
      'valuation',
    ]);
  });

  it('never re-implements classification: trusts the API aggregate over row data', () => {
    // Contradictory API data: a position row with a missing mark while the
    // valuation aggregate declares 'complete'. The strip must NOT scan rows
    // or recompute coverage — the API aggregate is the authority.
    const base = baseDashboardV2();
    const snapshot = withSection(base, 'valuation', {
      state: 'complete',
      positions: [
        {
          instrumentId: 'inst-xyz',
          symbol: 'XYZ',
          direction: 'long',
          quantity: '10',
          averageCost: '10.00',
          markStatus: 'missing',
          markPrice: null,
          markedValue: null,
          unrealizedPnl: null,
          markTimestamp: null,
          markAgeMinutes: null,
          attribution: { kind: 'account_only', executionCount: 1, journalTradeCount: 0 },
          markProvenance: {
            source: null,
            asOf: null,
            computedAt: COMPUTED_AT,
            status: 'missing',
          },
          risk: {
            hasValidStop: false,
            stopPrice: null,
            currentRiskToStop: null,
            openTrades: 0,
          },
          journalLinkedMetrics: null,
        },
      ],
    });

    const alerts = deriveDataQualityAlerts(snapshot);
    expect(alerts.filter((a) => a.id === 'valuation')).toEqual([]);
    expect(alerts).toEqual([]);
  });
});

// ── Component rendering tests ──────────────────────────────────────────

describe('DataQualityAlertStrip', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders nothing when every section is healthy', () => {
    const { container } = render(
      <DataQualityAlertStrip dashboardV2={baseDashboardV2()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders one alert per gated condition with state, label, and provenance', () => {
    const base = baseDashboardV2();
    const snapshot: DashboardV2Response = {
      ...withSection(base, 'valuation', {
        state: 'partial',
        fresh: 2,
        stale: 1,
        missing: 0,
        presentationLabel: '— Partial — 1 unpriced',
        provenance: provenance('account_positions + valuation_marks', AS_OF, 'partial'),
      }),
      riskSummary: {
        ...base.riskSummary,
        stopCoverage: {
          openTrades: 3,
          withStop: 2,
          withoutStop: 1,
          state: 'partial',
          presentationLabel: 'Incomplete — 1 without a valid stop',
        },
      },
    };

    render(<DataQualityAlertStrip dashboardV2={snapshot} />);

    const strip = screen.getByTestId('ws-data-quality-alert-strip');
    expect(strip).toBeTruthy();

    // Region + alert semantics (announced; text not color-only).
    expect(strip.getAttribute('role')).toBe('region');
    expect(strip.getAttribute('aria-label')).toBe('Data quality alerts');
    expect(strip.querySelectorAll('[role="alert"]')).toHaveLength(2);

    // Valuation alert: state chip, qualified label, provenance metadata.
    expect(screen.getByTestId('ws-dq-state-valuation').textContent).toBe('partial');
    expect(screen.getByTestId('ws-dq-label-valuation').textContent).toBe(
      '— Partial — 1 unpriced',
    );
    const valuationProvenance = screen.getByTestId('ws-dq-provenance-valuation')
      .textContent;
    expect(valuationProvenance).toContain('account_positions + valuation_marks');
    expect(valuationProvenance).toContain('as-of');
    expect(valuationProvenance).toContain('computed');

    // Stop-coverage alert carries its qualified label.
    expect(screen.getByTestId('ws-dq-state-stop-coverage').textContent).toBe(
      'partial',
    );
    expect(screen.getByTestId('ws-dq-label-stop-coverage').textContent).toBe(
      'Incomplete — 1 without a valid stop',
    );
  });

  it('renders a readable as-of timestamp from the API provenance', () => {
    const base = baseDashboardV2();
    const snapshot = withSection(base, 'valuation', {
      state: 'partial',
      fresh: 2,
      stale: 1,
      missing: 0,
      presentationLabel: '— Partial — 1 unpriced',
    });

    render(<DataQualityAlertStrip dashboardV2={snapshot} />);
    const provenanceLine = screen.getByTestId('ws-dq-provenance-valuation')
      .textContent as string;
    expect(provenanceLine).toContain('2026-07-17 19:58 UTC');
    expect(provenanceLine).toContain('2026-07-17 20:15 UTC');
  });

  it('has no dismiss affordance (strip clears only when the condition clears)', () => {
    const base = baseDashboardV2();
    const snapshot = withSection(base, 'valuation', {
      state: 'partial',
      fresh: 2,
      stale: 1,
      missing: 0,
      presentationLabel: '— Partial — 1 unpriced',
    });

    const { container } = render(
      <DataQualityAlertStrip dashboardV2={snapshot} />,
    );
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
  });
});
