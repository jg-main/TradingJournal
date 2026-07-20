/**
 * Tests for the workstation fixture data system.
 *
 * Coverage:
 * - Shape conformance: every scenario matches DashboardResponse,
 *   DashboardV2Response, and WorkstationWatchlistItem contracts (compile-time
 *   via the module's own types, runtime via structural assertions).
 * - Scenario behavior: default, zero-positions, large-drawdown, many-watchlist.
 * - Negative surface: unknown scenario ids, invalid scenario guards.
 * - Determinism: identical payloads across calls (seeded PRNG, fixed dates).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  getWorkstationFixtures,
  isWorkstationScenarioId,
  warnFixtureMode,
  WORKSTATION_SCENARIO_IDS,
  WORKSTATION_WATCHLIST_STATUSES,
  type DashboardResponse,
} from '@/lib/workstation-fixtures';
import type { DashboardV2Response } from '@/lib/accounting/dashboard-v2';

// ── Helpers ──────────────────────────────────────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function expectValidDashboard(dashboard: DashboardResponse): void {
  // KPI invariants
  expect(dashboard.kpis.totalTrades).toBeGreaterThan(0);
  expect(dashboard.kpis.openTrades).toBeGreaterThanOrEqual(0);
  if (dashboard.kpis.winRate !== null) {
    expect(dashboard.kpis.winRate).toBeGreaterThanOrEqual(0);
    expect(dashboard.kpis.winRate).toBeLessThanOrEqual(1);
  }

  // Equity curve: sorted, finite, coherent with drawdown length
  const curve = dashboard.equityCurve;
  expect(curve.length).toBeGreaterThan(0);
  expect(dashboard.drawdown).toHaveLength(curve.length);
  for (let i = 0; i < curve.length; i++) {
    const point = curve[i];
    expect(point.date).toMatch(ISO_DATE);
    expect(Number.isFinite(point.equity)).toBe(true);
    expect(Number.isFinite(point.cumulativePnl)).toBe(true);
    expect(point.highWaterMark).toBeGreaterThanOrEqual(point.equity);
    if (i > 0) {
      expect(point.date > curve[i - 1].date).toBe(true);
    }
    // Drawdown pairs with the same date and is never positive
    expect(dashboard.drawdown[i].date).toBe(point.date);
    expect(dashboard.drawdown[i].drawdownAmount).toBeLessThanOrEqual(0);
    expect(dashboard.drawdown[i].drawdownPct).toBeLessThanOrEqual(0);
  }

  // Calendar heatmap dates are valid
  for (const year of dashboard.calendarHeatmap) {
    expect(year.year).toBeGreaterThan(2000);
    for (const day of year.days) {
      expect(day.date).toMatch(ISO_DATE);
      expect(Number.isFinite(day.pnl)).toBe(true);
    }
  }

  // Period matrix exposes the three canonical comparison types
  expect(dashboard.periodMatrix.wow.comparisonType).toBe('wow');
  expect(dashboard.periodMatrix.mom.comparisonType).toBe('mom');
  expect(dashboard.periodMatrix.qoq.comparisonType).toBe('qoq');

  // Setup ranking is sorted by count descending (API contract)
  for (let i = 1; i < dashboard.setupRanking.length; i++) {
    expect(dashboard.setupRanking[i].count).toBeLessThanOrEqual(
      dashboard.setupRanking[i - 1].count,
    );
  }
}

function expectValidDashboardV2(v2: DashboardV2Response): void {
  expect(v2.account.id).toBeTruthy();
  expect(v2.account.currency).toBe('USD');

  // All non-null metric fields are canonical decimal strings
  for (const [key, value] of Object.entries(v2.metrics)) {
    if (value === null) continue;
    expect(Number.isNaN(parseFloat(value as string)), `metrics.${key}`).toBe(false);
  }

  // Valuation counts agree with the positions array
  const { positionsTotal, fresh, stale, missing, positions } = v2.valuation;
  expect(positionsTotal).toBe(positions.length);
  expect(fresh + stale + missing).toBe(positionsTotal);

  // computedAt is a valid ISO timestamp
  expect(Number.isNaN(Date.parse(v2.computedAt))).toBe(false);

  // Integrity status is one of the canonical values
  expect(['healthy', 'warning', 'critical', 'unknown']).toContain(v2.integrity.status);
}

// ── Scenario registry ────────────────────────────────────────────────────

describe('scenario registry', () => {
  it('exposes exactly the four planned scenarios', () => {
    expect(WORKSTATION_SCENARIO_IDS).toEqual([
      'default',
      'zero-positions',
      'large-drawdown',
      'many-watchlist',
    ]);
  });

  it('builds every registered scenario without throwing', () => {
    for (const id of WORKSTATION_SCENARIO_IDS) {
      const fixtures = getWorkstationFixtures(id);
      expect(fixtures.scenario).toBe(id);
      expectValidDashboard(fixtures.dashboard);
      expectValidDashboardV2(fixtures.dashboardV2);
      expect(fixtures.watchlist.length).toBeGreaterThan(0);
    }
  });
});

// ── Shape conformance ────────────────────────────────────────────────────

describe('default scenario', () => {
  const fixtures = getWorkstationFixtures('default');

  it('returns a DashboardResponse with realistic open-position state', () => {
    expectValidDashboard(fixtures.dashboard);
    expect(fixtures.dashboard.kpis.openTrades).toBe(3);
    expect(fixtures.dashboard.mtm.openTradeCount).toBe(3);
    expect(fixtures.dashboard.equityCurve.length).toBe(60);
  });

  it('returns a DashboardV2Response matching the API contract', () => {
    expectValidDashboardV2(fixtures.dashboardV2);
    expect(fixtures.dashboardV2.valuation.positionsTotal).toBe(3);
    expect(fixtures.dashboardV2.valuation.fresh).toBe(2);
    expect(fixtures.dashboardV2.valuation.stale).toBe(1);
    expect(fixtures.dashboardV2.integrity.status).toBe('warning');
    expect(fixtures.dashboardV2.integrity.warnings.length).toBeGreaterThan(0);
    // NAV ≈ cash + marked positions
    const nav = parseFloat(fixtures.dashboardV2.metrics.nav);
    expect(nav).toBeGreaterThan(0);
  });

  it('returns watchlist items matching the watchlist_items row shape', () => {
    expect(fixtures.watchlist.length).toBe(12);
    for (const item of fixtures.watchlist) {
      expect(item.id).toBeTruthy();
      expect(item.symbol).toBeTruthy();
      expect(WORKSTATION_WATCHLIST_STATUSES).toContain(item.status);
      expect(['long', 'short']).toContain(item.direction);
      // alertConfig is a JSON string or null (matches schema text column)
      if (item.alertConfig !== null) {
        expect(() => JSON.parse(item.alertConfig as string)).not.toThrow();
      }
    }
  });
});

// ── Edge-case scenarios ──────────────────────────────────────────────────

describe('zero-positions scenario', () => {
  const fixtures = getWorkstationFixtures('zero-positions');

  it('has no open trades and zeroed MTM', () => {
    expect(fixtures.dashboard.kpis.openTrades).toBe(0);
    expect(fixtures.dashboard.mtm.openTradeCount).toBe(0);
    expect(fixtures.dashboard.mtm.netUnrealizedPnl).toBe(0);
  });

  it('has an empty valuation with zeroed counts', () => {
    expect(fixtures.dashboardV2.valuation.positionsTotal).toBe(0);
    expect(fixtures.dashboardV2.valuation.positions).toEqual([]);
    expect(fixtures.dashboardV2.valuation.fresh).toBe(0);
    expect(fixtures.dashboardV2.valuation.stale).toBe(0);
    expect(fixtures.dashboardV2.valuation.missing).toBe(0);
  });

  it('reports healthy integrity and zero open risk', () => {
    expect(fixtures.dashboardV2.integrity.status).toBe('healthy');
    expect(fixtures.dashboardV2.integrity.warnings).toEqual([]);
    expect(fixtures.dashboardV2.riskSummary.openRisk).toBe('0.00');
    expect(fixtures.dashboardV2.riskSummary.missingStops).toBe(0);
  });

  it('still validates as a well-formed dashboard payload', () => {
    expectValidDashboard(fixtures.dashboard);
    expectValidDashboardV2(fixtures.dashboardV2);
  });
});

describe('large-drawdown scenario', () => {
  const fixtures = getWorkstationFixtures('large-drawdown');

  it('has a deeply negative worst drawdown and negative net P&L', () => {
    expect(fixtures.dashboard.kpis.currentDrawdown).toBeLessThan(-2000);
    expect(fixtures.dashboard.kpis.currentDrawdownPct).toBeLessThan(-0.03);
    expect(fixtures.dashboard.kpis.netPnl).toBeLessThan(0);
    expect(fixtures.dashboard.kpis.profitFactor).toBeLessThan(1);
  });

  it('surfaces critical integrity with warnings', () => {
    expect(fixtures.dashboardV2.integrity.status).toBe('critical');
    expect(fixtures.dashboardV2.integrity.warnings.length).toBeGreaterThanOrEqual(1);
  });

  it('has positions with missing valuation marks', () => {
    expect(fixtures.dashboardV2.valuation.missing).toBeGreaterThan(0);
  });

  it('still validates as a well-formed dashboard payload', () => {
    expectValidDashboard(fixtures.dashboard);
    expectValidDashboardV2(fixtures.dashboardV2);
  });
});

describe('many-watchlist scenario', () => {
  const fixtures = getWorkstationFixtures('many-watchlist');

  it('returns 28 watchlist items with unique ids', () => {
    expect(fixtures.watchlist.length).toBe(28);
    const ids = new Set(fixtures.watchlist.map((w) => w.id));
    expect(ids.size).toBe(28);
  });

  it('covers every watchlist status', () => {
    const statuses = new Set(fixtures.watchlist.map((w) => w.status));
    for (const status of WORKSTATION_WATCHLIST_STATUSES) {
      expect(statuses.has(status)).toBe(true);
    }
  });
});

// ── Determinism and isolation ────────────────────────────────────────────

describe('determinism', () => {
  it('produces identical payloads across calls', () => {
    const a = getWorkstationFixtures('default');
    const b = getWorkstationFixtures('default');
    expect(a).toEqual(b);
  });

  it('returns fresh objects — mutation does not leak between calls', () => {
    const a = getWorkstationFixtures('default');
    a.dashboard.kpis.totalTrades = -999;
    a.watchlist[0].symbol = 'MUTATED';
    const b = getWorkstationFixtures('default');
    expect(b.dashboard.kpis.totalTrades).not.toBe(-999);
    expect(b.watchlist[0].symbol).not.toBe('MUTATED');
  });
});

// ── Negative surface ─────────────────────────────────────────────────────

describe('negative inputs', () => {
  it('throws a descriptive error for an unknown scenario id', () => {
    expect(() =>
      getWorkstationFixtures('bogus' as never),
    ).toThrow(/Unknown workstation fixture scenario: "bogus"/);
  });

  it('rejects invalid scenario ids in the type guard', () => {
    expect(isWorkstationScenarioId('bogus')).toBe(false);
    expect(isWorkstationScenarioId('')).toBe(false);
    expect(isWorkstationScenarioId('DEFAULT')).toBe(false);
    expect(isWorkstationScenarioId(' default')).toBe(false);
  });

  it('accepts all registered scenario ids in the type guard', () => {
    for (const id of WORKSTATION_SCENARIO_IDS) {
      expect(isWorkstationScenarioId(id)).toBe(true);
    }
  });
});

// ── Fixture-mode observability ───────────────────────────────────────────

describe('warnFixtureMode', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits a console.warn naming the scenario (slice verification signal)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    warnFixtureMode('large-drawdown');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('FIXTURE MODE');
    expect(warn.mock.calls[0][0]).toContain('large-drawdown');
  });
});
