/**
 * DASH-AC fixture scenario unit tests.
 *
 * Focused contract assertions for the two dedicated DASH-AC fixture
 * scenarios shipped for the §11 release gate:
 *
 *   dash-ac-01-healthy — DASH-AC-01: every open position fresh-marked with
 *     a valid stop; valuation complete, stop coverage 3/3, integrity healthy.
 *   dash-ac-02-partial — DASH-AC-02: one of three positions has no mark and
 *     the two marked rows total exactly +$10.94. The primary Open P&L must
 *     be the qualified label '— Partial — 1 unpriced', never a bare signed
 *     total; the marked subset is subordinate ('10.94').
 *
 * These are fixture-level proofs; the browser-level equivalents live in
 * e2e/dash-acceptance.spec.ts.
 */

import { describe, it, expect } from 'vitest';
import { getWorkstationFixtures, isWorkstationScenarioId } from '@/lib/workstation-fixtures';

describe('dash-ac-01-healthy scenario (DASH-AC-01 baseline)', () => {
  const fixtures = getWorkstationFixtures('dash-ac-01-healthy');

  it('is a registered scenario id', () => {
    expect(isWorkstationScenarioId('dash-ac-01-healthy')).toBe(true);
  });

  it('every open position has a fresh mark', () => {
    expect(fixtures.dashboardV2.valuation.positions).toHaveLength(3);
    for (const pos of fixtures.dashboardV2.valuation.positions) {
      expect(pos.markStatus).toBe('fresh');
      expect(pos.markPrice).not.toBeNull();
      expect(pos.unrealizedPnl).not.toBeNull();
    }
  });

  it('every open position has a valid stop', () => {
    for (const pos of fixtures.dashboardV2.valuation.positions) {
      expect(pos.risk.hasValidStop).toBe(true);
      expect(pos.risk.stopPrice).not.toBeNull();
    }
  });

  it('valuation is complete with 100% coverage and no presentation label', () => {
    const { valuation } = fixtures.dashboardV2;
    expect(valuation.state).toBe('complete');
    expect(valuation.fresh).toBe(3);
    expect(valuation.stale).toBe(0);
    expect(valuation.missing).toBe(0);
    expect(valuation.coveragePct).toBe('100.00');
    expect(valuation.presentationLabel).toBeNull();
  });

  it('stop coverage is complete 3/3 with no missing stops', () => {
    const { stopCoverage } = fixtures.dashboardV2.riskSummary;
    expect(stopCoverage.openTrades).toBe(3);
    expect(stopCoverage.withStop).toBe(3);
    expect(stopCoverage.withoutStop).toBe(0);
    expect(stopCoverage.state).toBe('complete');
    expect(stopCoverage.presentationLabel).toBeNull();
  });

  it('open P&L is a normal signed total with complete provenance', () => {
    expect(fixtures.dashboardV2.riskSummary.openPnl).toBe('841.35');
    expect(fixtures.dashboardV2.riskSummary.provenance.status).toBe('complete');
    expect(fixtures.dashboardV2.riskSummary.provenance.presentationLabel).toBeNull();
  });

  it('integrity is healthy with no warnings', () => {
    expect(fixtures.dashboardV2.integrity.status).toBe('healthy');
    expect(fixtures.dashboardV2.integrity.warnings).toEqual([]);
  });

  it('workstation position rows are all fresh with R-multiples', () => {
    expect(fixtures.positions).toHaveLength(3);
    for (const pos of fixtures.positions) {
      expect(pos.markStatus).toBe('fresh');
      expect(pos.rMultiple).not.toBeNull();
    }
  });
});

describe('dash-ac-02-partial scenario (DASH-AC-02 +$10.94 defect)', () => {
  const fixtures = getWorkstationFixtures('dash-ac-02-partial');

  it('is a registered scenario id', () => {
    expect(isWorkstationScenarioId('dash-ac-02-partial')).toBe(true);
  });

  it('has three positions, one without a mark', () => {
    const { valuation } = fixtures.dashboardV2;
    expect(valuation.positionsTotal).toBe(3);
    expect(valuation.fresh).toBe(2);
    expect(valuation.stale).toBe(0);
    expect(valuation.missing).toBe(1);
    const missing = valuation.positions.find((p) => p.markStatus === 'missing');
    expect(missing).toBeDefined();
    expect(missing!.markPrice).toBeNull();
    expect(missing!.unrealizedPnl).toBeNull();
  });

  it('the two marked rows total exactly +$10.94', () => {
    const { valuation } = fixtures.dashboardV2;
    expect(valuation.markedSubsetPnl).toBe('10.94');
    // Independent arithmetic check against the position rows.
    const markedSum = valuation.positions
      .filter((p) => p.markStatus === 'fresh' && p.unrealizedPnl !== null)
      .reduce((acc, p) => acc + Number(p.unrealizedPnl), 0);
    expect(markedSum.toFixed(2)).toBe('10.94');
  });

  it('the primary valuation label is the qualified label, not a signed total', () => {
    const { valuation, riskSummary } = fixtures.dashboardV2;
    expect(valuation.state).toBe('partial');
    expect(valuation.presentationLabel).toBe('— Partial — 1 unpriced');
    // The risk summary never presents a partial sum as a signed total.
    expect(riskSummary.openPnl).toBeNull();
    expect(riskSummary.provenance.status).toBe('partial');
    expect(riskSummary.provenance.presentationLabel).toBe('— Partial — 1 unpriced');
  });

  it('stop coverage stays complete — the defect is the missing mark only', () => {
    const { stopCoverage } = fixtures.dashboardV2.riskSummary;
    expect(stopCoverage.state).toBe('complete');
    expect(stopCoverage.withoutStop).toBe(0);
  });

  it('surfaces a valuation integrity warning', () => {
    expect(fixtures.dashboardV2.integrity.status).toBe('warning');
    expect(fixtures.dashboardV2.integrity.warnings.join(' ')).toMatch(/no valuation mark/i);
  });

  it('workstation position rows mirror the marked-subset defect', () => {
    expect(fixtures.positions).toHaveLength(3);
    const fresh = fixtures.positions.filter((p) => p.markStatus === 'fresh');
    const missing = fixtures.positions.find((p) => p.markStatus === 'missing');
    expect(fresh).toHaveLength(2);
    expect(missing).toBeDefined();
    expect(missing!.unrealizedPnl).toBeNull();
    expect(missing!.rMultiple).toBeNull();
    // The two marked rows still sum to +$10.94 at the workstation row level.
    const sum = fresh.reduce((acc, p) => acc + Number(p.unrealizedPnl), 0);
    expect(sum.toFixed(2)).toBe('10.94');
  });
});
