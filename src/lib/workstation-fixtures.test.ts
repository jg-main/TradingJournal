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
  MARKET_INDEX_SYMBOLS,
  type DashboardResponse,
  type MarketIndexSnapshot,
  type SymbolPriceData,
  type TradeIdea,
  type WorkstationPosition,
  type WorkstationRisk,
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

function expectValidMarketIndices(indices: MarketIndexSnapshot[]): void {
  expect(indices).toHaveLength(MARKET_INDEX_SYMBOLS.length);
  const symbols = indices.map((i) => i.symbol);
  for (const sym of MARKET_INDEX_SYMBOLS) {
    expect(symbols).toContain(sym);
  }
  for (const idx of indices) {
    expect(Number.isFinite(idx.lastPrice)).toBe(true);
    expect(idx.lastPrice).toBeGreaterThan(0);
    expect(Number.isFinite(idx.change)).toBe(true);
    expect(Number.isFinite(idx.changePct)).toBe(true);
    // changePct should respect the sign of change
    if (idx.change > 0) expect(idx.changePct).toBeGreaterThanOrEqual(0);
    if (idx.change < 0) expect(idx.changePct).toBeLessThanOrEqual(0);
  }
}

function expectValidSymbolPrices(
  prices: Record<string, SymbolPriceData>,
  watchlist: { symbol: string }[],
): void {
  // Every watchlist symbol has a price entry
  for (const item of watchlist) {
    const price = prices[item.symbol];
    expect(price, `missing price for ${item.symbol}`).toBeDefined();
    expect(price.symbol).toBe(item.symbol);
    expect(Number.isFinite(price.lastPrice)).toBe(true);
    expect(price.lastPrice).toBeGreaterThan(0);
    expect(Number.isFinite(price.previousClose)).toBe(true);
    expect(Number.isFinite(price.gap)).toBe(true);
    expect(Number.isFinite(price.gapPct)).toBe(true);
    // gap consistency: gap = lastPrice - previousClose
    expect(price.gap).toBeCloseTo(price.lastPrice - price.previousClose, 1);
    // If triggerPrice is set, distanceToTrigger must be set
    if (price.triggerPrice !== null) {
      expect(price.distanceToTrigger).not.toBeNull();
      expect(price.distanceToTriggerPct).not.toBeNull();
      expect(Number.isFinite(price.distanceToTrigger!)).toBe(true);
      expect(Number.isFinite(price.distanceToTriggerPct!)).toBe(true);
      // distanceToTriggerPct is absolute
      expect(price.distanceToTriggerPct!).toBeGreaterThanOrEqual(0);
      // distanceToTrigger consistency
      expect(price.distanceToTrigger!).toBeCloseTo(
        price.lastPrice - price.triggerPrice!,
        1,
      );
    }
  }
}

function expectValidDashboardV2(v2: DashboardV2Response): void {
  expect(v2.account.id).toBeTruthy();
  expect(v2.account.currency).toBe('USD');

  // All non-null metric fields are canonical decimal strings
  for (const [key, value] of Object.entries(v2.metrics)) {
    if (value === null || key === 'provenance') continue;
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
      expectValidMarketIndices(fixtures.marketIndices);
      expectValidSymbolPrices(fixtures.symbolPrices, fixtures.watchlist);
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
    const nav = parseFloat(fixtures.dashboardV2.metrics.nav ?? '0');
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

// ── Workstation positions ───────────────────────────────────────────────

describe('workstation positions', () => {
  it('default scenario has 3 positions with R-multiples', () => {
    const { positions } = getWorkstationFixtures('default');
    expect(positions).toHaveLength(3);
    for (const pos of positions) {
      expect(pos.symbol).toBeTruthy();
      expect(pos.direction).toBeTruthy();
      expect(pos.initialRiskAmount).toBeTruthy();
      expect(pos.rMultiple).not.toBeNull();
      expect(pos.rMultiple!).toMatch(/^-?\d+\.\d{2}$/);
    }
    // Verify computed R-multiple values against fixture data.
    expect(positions[0].symbol).toBe('NVDA');
    expect(positions[0].initialRiskAmount).toBe('300.00');
    expect(positions[0].rMultiple).toBe('1.38');
    expect(positions[1].symbol).toBe('AMD');
    expect(positions[1].initialRiskAmount).toBe('250.00');
    expect(positions[1].rMultiple).toBe('2.02');
    expect(positions[2].symbol).toBe('TSLA');
    expect(positions[2].initialRiskAmount).toBe('200.00');
    expect(positions[2].rMultiple).toBe('-0.39');
  });

  it('zero-positions scenario has empty positions array', () => {
    const { positions } = getWorkstationFixtures('zero-positions');
    expect(positions).toEqual([]);
  });

  it('large-drawdown scenario has 2 positions with null rMultiples (missing marks)', () => {
    const { positions } = getWorkstationFixtures('large-drawdown');
    expect(positions).toHaveLength(2);
    for (const pos of positions) {
      expect(pos.markStatus).toBe('missing');
      expect(pos.markPrice).toBeNull();
      expect(pos.markedValue).toBeNull();
      expect(pos.unrealizedPnl).toBeNull();
      // rMultiple is null because unrealizedPnl is null (cannot compute)
      expect(pos.rMultiple).toBeNull();
      // initialRiskAmount is still known — risk exists even without a mark
      expect(pos.initialRiskAmount).not.toBeNull();
    }
  });

  it('many-watchlist scenario positions match default', () => {
    const many = getWorkstationFixtures('many-watchlist');
    const def = getWorkstationFixtures('default');
    expect(many.positions).toEqual(def.positions);
  });

  it('every position has the 7 canonical columns the table needs', () => {
    for (const id of WORKSTATION_SCENARIO_IDS) {
      const { positions } = getWorkstationFixtures(id);
      for (const pos of positions) {
        expect(typeof pos.symbol).toBe('string');
        expect(['long', 'short', null]).toContain(pos.direction);
        expect(typeof pos.quantity).toBe('string');
        expect(typeof pos.averageCost).toBe('string');
        expect(['fresh', 'stale', 'missing']).toContain(pos.markStatus);
        expect(typeof pos.unrealizedPnl === 'string' || pos.unrealizedPnl === null).toBe(true);
        // rMultiple: null-safe column — null when data is missing, string otherwise
        expect(pos.rMultiple === null || typeof pos.rMultiple === 'string').toBe(true);
        if (pos.rMultiple !== null) {
          expect(pos.rMultiple).toMatch(/^-?\d+\.\d{2}$/);
        }
      }
    }
  });
});

// ── Workstation risk ────────────────────────────────────────────────────

describe('workstation risk', () => {
  it('default scenario has PTD and current risk sections', () => {
    const { risk } = getWorkstationFixtures('default');
    expect(risk.ptd.realizedPnl).toBe('11596.40');
    expect(risk.ptd.realizedFees).toBe('512.30');
    expect(risk.ptd.drawdown).not.toBeNull();
    expect(risk.ptd.drawdownPct).not.toBeNull();
    expect(risk.current.openPnl).toBe('841.35');
    expect(risk.current.openRisk).toBe('1450.00');
    expect(risk.current.portfolioHeat).not.toBeNull();
    expect(risk.current.missingStops).toBe(1);
    expect(risk.current.positionsWithStop).toBe(2);
    expect(risk.current.exposure).toBe('31543.85');
  });

  it('zero-positions scenario has zeroed risk metrics', () => {
    const { risk } = getWorkstationFixtures('zero-positions');
    expect(risk.current.openPnl).toBe('0.00');
    expect(risk.current.openRisk).toBe('0.00');
    expect(risk.current.portfolioHeat).toBe('0.00');
    expect(risk.current.missingStops).toBe(0);
    expect(risk.current.positionsWithStop).toBe(0);
    expect(risk.current.exposure).toBe('0.00');
    expect(risk.ptd.drawdown).toBe('0.00');
    expect(risk.ptd.drawdownPct).toBe('0.00');
  });

  it('large-drawdown scenario has negative risk metrics', () => {
    const { risk } = getWorkstationFixtures('large-drawdown');
    expect(risk.current.openPnl).toBe('-1234.80');
    expect(parseFloat(risk.ptd.drawdown!)).toBeLessThan(0);
    expect(parseFloat(risk.ptd.drawdownPct!)).toBeLessThan(0);
    expect(risk.current.missingStops).toBe(2);
    expect(risk.current.positionsWithStop).toBe(0);
    expect(risk.current.exposure).toBe('22549.60');
  });

  it('all scenarios have structurally valid risk sections', () => {
    for (const id of WORKSTATION_SCENARIO_IDS) {
      const { risk } = getWorkstationFixtures(id);
      // PTD section must be present
      expect(typeof risk.ptd.realizedPnl).toBe('string');
      expect(typeof risk.ptd.realizedFees).toBe('string');
      expect(
        risk.ptd.drawdown === null || typeof risk.ptd.drawdown === 'string',
      ).toBe(true);
      expect(
        risk.ptd.drawdownPct === null ||
          typeof risk.ptd.drawdownPct === 'string',
      ).toBe(true);
      // Current section must be present
      expect(typeof risk.current.openPnl).toBe('string');
      expect(typeof risk.current.openRisk).toBe('string');
      expect(
        risk.current.portfolioHeat === null ||
          typeof risk.current.portfolioHeat === 'string',
      ).toBe(true);
      expect(typeof risk.current.missingStops).toBe('number');
      expect(typeof risk.current.positionsWithStop).toBe('number');
      expect(typeof risk.current.exposure).toBe('string');
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

  it('produces identical positions across calls', () => {
    const a = getWorkstationFixtures('default');
    const b = getWorkstationFixtures('default');
    expect(a.positions).toEqual(b.positions);
  });

  it('produces identical risk across calls', () => {
    const a = getWorkstationFixtures('default');
    const b = getWorkstationFixtures('default');
    expect(a.risk).toEqual(b.risk);
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

// ── Market indices ──────────────────────────────────────────────────────

describe('market indices', () => {
  it('exposes the four canonical index symbols', () => {
    expect(MARKET_INDEX_SYMBOLS).toEqual(['SPX', 'NDX', 'RUT', 'VIX']);
  });

  it('generates realistic index values for the default scenario', () => {
    const { marketIndices } = getWorkstationFixtures('default');
    expectValidMarketIndices(marketIndices);
    const spx = marketIndices.find((i) => i.symbol === 'SPX')!;
    expect(spx.lastPrice).toBeGreaterThan(5000);
    expect(spx.lastPrice).toBeLessThan(6500);
    const ndx = marketIndices.find((i) => i.symbol === 'NDX')!;
    expect(ndx.lastPrice).toBeGreaterThan(18000);
    expect(ndx.lastPrice).toBeLessThan(22000);
    const rut = marketIndices.find((i) => i.symbol === 'RUT')!;
    expect(rut.lastPrice).toBeGreaterThan(1800);
    expect(rut.lastPrice).toBeLessThan(2500);
    const vix = marketIndices.find((i) => i.symbol === 'VIX')!;
    expect(vix.lastPrice).toBeGreaterThan(8);
    expect(vix.lastPrice).toBeLessThan(35);
  });

  it('generates bearish index values for large-drawdown scenario', () => {
    const { marketIndices } = getWorkstationFixtures('large-drawdown');
    expectValidMarketIndices(marketIndices);
    // In a drawdown scenario, the VIX should be elevated
    const vix = marketIndices.find((i) => i.symbol === 'VIX')!;
    expect(vix.lastPrice).toBeGreaterThan(12);
  });

  it('generates flat index values for zero-positions scenario', () => {
    const { marketIndices } = getWorkstationFixtures('zero-positions');
    expectValidMarketIndices(marketIndices);
    // Changes should be near zero (drift multiplier is 0)
    const totalAbsChange = marketIndices.reduce(
      (sum, i) => sum + Math.abs(i.changePct),
      0,
    );
    expect(totalAbsChange).toBeLessThan(10);
  });
});

// ── Symbol prices ───────────────────────────────────────────────────────

describe('symbol prices', () => {
  it('generates price data for every watchlist symbol in default scenario', () => {
    const fixtures = getWorkstationFixtures('default');
    expectValidSymbolPrices(fixtures.symbolPrices, fixtures.watchlist);
    // Price map should have exactly one entry per watchlist item
    expect(Object.keys(fixtures.symbolPrices)).toHaveLength(
      fixtures.watchlist.length,
    );
  });

  it('generates realistic price ranges around key levels', () => {
    const fixtures = getWorkstationFixtures('default');
    for (const item of fixtures.watchlist) {
      const price = fixtures.symbolPrices[item.symbol];
      expect(price).toBeDefined();
      if (item.keyLevel !== null) {
        // lastPrice should be within ±5% of keyLevel
        const deviation = Math.abs(price.lastPrice - item.keyLevel) / item.keyLevel;
        expect(deviation).toBeLessThan(0.05);
      }
    }
  });

  it('preserves trigger price from watchlist items', () => {
    const fixtures = getWorkstationFixtures('many-watchlist');
    for (const item of fixtures.watchlist) {
      const price = fixtures.symbolPrices[item.symbol];
      expect(price.triggerPrice).toBe(item.triggerPrice);
    }
  });

  it('generates price data for the many-watchlist scenario (28 entries)', () => {
    const fixtures = getWorkstationFixtures('many-watchlist');
    expect(Object.keys(fixtures.symbolPrices)).toHaveLength(28);
    expectValidSymbolPrices(fixtures.symbolPrices, fixtures.watchlist);
  });

  it('generates price data for the zero-positions scenario (4 entries)', () => {
    const fixtures = getWorkstationFixtures('zero-positions');
    expect(Object.keys(fixtures.symbolPrices)).toHaveLength(4);
    expectValidSymbolPrices(fixtures.symbolPrices, fixtures.watchlist);
  });

  it('computes positive and negative gap values across symbols', () => {
    const fixtures = getWorkstationFixtures('many-watchlist');
    const gaps = Object.values(fixtures.symbolPrices).map((p) => p.gap);
    const positiveGaps = gaps.filter((g) => g > 0);
    const negativeGaps = gaps.filter((g) => g < 0);
    // With 28 entries and random generation, both signs should appear
    expect(positiveGaps.length).toBeGreaterThan(0);
    expect(negativeGaps.length).toBeGreaterThan(0);
  });

  it('computes distanceToTriggerPct as an absolute percentage', () => {
    const fixtures = getWorkstationFixtures('default');
    for (const price of Object.values(fixtures.symbolPrices)) {
      if (price.distanceToTriggerPct !== null) {
        expect(price.distanceToTriggerPct).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(price.distanceToTriggerPct)).toBe(true);
      }
    }
  });

  it('leaves distanceToTrigger null when triggerPrice is null', () => {
    const fixtures = getWorkstationFixtures('many-watchlist');
    for (const item of fixtures.watchlist) {
      if (item.triggerPrice === null) {
        const price = fixtures.symbolPrices[item.symbol];
        expect(price.distanceToTrigger).toBeNull();
        expect(price.distanceToTriggerPct).toBeNull();
      }
    }
  });
});

// ── Trade ideas (derived from watchlist with trigger prices) ────────────

describe('trade ideas', () => {
  it('default scenario has trade ideas derived from watchlist', () => {
    const fixtures = getWorkstationFixtures('default');
    expect(Array.isArray(fixtures.tradeIdeas)).toBe(true);
    expect(fixtures.tradeIdeas.length).toBeGreaterThan(0);
    expect(fixtures.tradeIdeas.length).toBeLessThanOrEqual(
      fixtures.watchlist.length,
    );
  });

  it('every trade idea conforms to the TradeIdea shape', () => {
    for (const id of WORKSTATION_SCENARIO_IDS) {
      const fixtures = getWorkstationFixtures(id);
      for (const idea of fixtures.tradeIdeas) {
        expect(typeof idea.watchlistItemId).toBe('string');
        expect(idea.watchlistItemId.length).toBeGreaterThan(0);
        expect(typeof idea.symbol).toBe('string');
        expect(idea.symbol.length).toBeGreaterThan(0);
        expect(idea.name === null || typeof idea.name === 'string').toBe(true);
        expect(['long', 'short']).toContain(idea.direction);
        expect(
          typeof idea.setupId === 'string' || idea.setupId === null,
        ).toBe(true);
        expect(
          typeof idea.setupName === 'string' || idea.setupName === null,
        ).toBe(true);
        // Entry price must be present and positive
        expect(typeof idea.entryPrice).toBe('number');
        expect(Number.isFinite(idea.entryPrice!)).toBe(true);
        expect(idea.entryPrice!).toBeGreaterThan(0);
        // Stop price must be present
        expect(typeof idea.stopPrice).toBe('number');
        expect(Number.isFinite(idea.stopPrice!)).toBe(true);
        // Target price may be null
        expect(
          typeof idea.targetPrice === 'number' || idea.targetPrice === null,
        ).toBe(true);
        if (idea.targetPrice !== null) {
          expect(Number.isFinite(idea.targetPrice)).toBe(true);
        }
        // Risk per share must be present and positive
        expect(idea.riskPerShare).not.toBeNull();
        expect(idea.riskPerShare!).toBeGreaterThan(0);
        // Reward may be null (when target is null)
        expect(
          typeof idea.rewardPerShare === 'number' ||
            idea.rewardPerShare === null,
        ).toBe(true);
        // riskRewardRatio: null when data incomplete, a finite number otherwise
        expect(
          idea.riskRewardRatio === null ||
            typeof idea.riskRewardRatio === 'number',
        ).toBe(true);
        if (idea.riskRewardRatio !== null) {
          expect(Number.isFinite(idea.riskRewardRatio)).toBe(true);
        }
        // Status must be a valid watchlist status
        expect(WORKSTATION_WATCHLIST_STATUSES).toContain(idea.status);
        // lastPrice may be null or a number
        expect(
          typeof idea.lastPrice === 'number' || idea.lastPrice === null,
        ).toBe(true);
        if (idea.lastPrice !== null) {
          expect(Number.isFinite(idea.lastPrice)).toBe(true);
        }
      }
    }
  });

  it('entry price matches the watchlist triggerPrice', () => {
    for (const id of WORKSTATION_SCENARIO_IDS) {
      const fixtures = getWorkstationFixtures(id);
      const watchlistById = new Map(
        fixtures.watchlist.map((w) => [w.id, w]),
      );
      for (const idea of fixtures.tradeIdeas) {
        const item = watchlistById.get(idea.watchlistItemId);
        expect(item).toBeDefined();
        expect(idea.entryPrice).toBe(item!.triggerPrice);
      }
    }
  });

  it('stop price matches the watchlist plannedStop', () => {
    for (const id of WORKSTATION_SCENARIO_IDS) {
      const fixtures = getWorkstationFixtures(id);
      const watchlistById = new Map(
        fixtures.watchlist.map((w) => [w.id, w]),
      );
      for (const idea of fixtures.tradeIdeas) {
        const item = watchlistById.get(idea.watchlistItemId);
        expect(idea.stopPrice).toBe(item!.plannedStop);
      }
    }
  });

  it('target price matches the watchlist targetPrice', () => {
    for (const id of WORKSTATION_SCENARIO_IDS) {
      const fixtures = getWorkstationFixtures(id);
      const watchlistById = new Map(
        fixtures.watchlist.map((w) => [w.id, w]),
      );
      for (const idea of fixtures.tradeIdeas) {
        const item = watchlistById.get(idea.watchlistItemId);
        expect(idea.targetPrice).toBe(item!.targetPrice);
      }
    }
  });

  it('only derives ideas from non-promoted items with trigger prices', () => {
    for (const id of WORKSTATION_SCENARIO_IDS) {
      const fixtures = getWorkstationFixtures(id);
      const qualifying = fixtures.watchlist.filter(
        (item) =>
          item.triggerPrice !== null && item.promotedTradeId === null,
      );
      expect(fixtures.tradeIdeas.length).toBe(qualifying.length);
      // Every qualifying item has a corresponding trade idea
      const ideaIds = new Set(
        fixtures.tradeIdeas.map((idea) => idea.watchlistItemId),
      );
      for (const item of qualifying) {
        expect(ideaIds.has(item.id)).toBe(true);
      }
    }
  });

  it('no trade idea comes from an item without a trigger price', () => {
    for (const id of WORKSTATION_SCENARIO_IDS) {
      const fixtures = getWorkstationFixtures(id);
      const noTriggerIds = new Set(
        fixtures.watchlist
          .filter((item) => item.triggerPrice === null)
          .map((item) => item.id),
      );
      for (const idea of fixtures.tradeIdeas) {
        expect(noTriggerIds.has(idea.watchlistItemId)).toBe(false);
      }
    }
  });

  it('no trade idea comes from a promoted item', () => {
    for (const id of WORKSTATION_SCENARIO_IDS) {
      const fixtures = getWorkstationFixtures(id);
      const promotedIds = new Set(
        fixtures.watchlist
          .filter((item) => item.promotedTradeId !== null)
          .map((item) => item.id),
      );
      for (const idea of fixtures.tradeIdeas) {
        expect(promotedIds.has(idea.watchlistItemId)).toBe(false);
      }
    }
  });

  it('risk/reward is direction-aware: long risk = entry - stop', () => {
    for (const id of WORKSTATION_SCENARIO_IDS) {
      const fixtures = getWorkstationFixtures(id);
      for (const idea of fixtures.tradeIdeas) {
        if (idea.direction === 'long' && idea.riskPerShare !== null) {
          // Tolerance of 0.01 because round2 may differ from raw subtraction
          expect(idea.riskPerShare).toBeCloseTo(
            idea.entryPrice! - idea.stopPrice!,
            1,
          );
          if (
            idea.rewardPerShare !== null &&
            idea.targetPrice !== null
          ) {
            expect(idea.rewardPerShare).toBeCloseTo(
              idea.targetPrice - idea.entryPrice!,
              1,
            );
          }
        }
      }
    }
  });

  it('risk/reward is direction-aware: short risk = stop - entry', () => {
    for (const id of WORKSTATION_SCENARIO_IDS) {
      const fixtures = getWorkstationFixtures(id);
      for (const idea of fixtures.tradeIdeas) {
        if (idea.direction === 'short' && idea.riskPerShare !== null) {
          expect(idea.riskPerShare).toBeCloseTo(
            idea.stopPrice! - idea.entryPrice!,
            1,
          );
          if (
            idea.rewardPerShare !== null &&
            idea.targetPrice !== null
          ) {
            expect(idea.rewardPerShare).toBeCloseTo(
              idea.entryPrice! - idea.targetPrice,
              1,
            );
          }
        }
      }
    }
  });

  it('riskRewardRatio is rewardPerShare / riskPerShare (when both present)', () => {
    for (const id of WORKSTATION_SCENARIO_IDS) {
      const fixtures = getWorkstationFixtures(id);
      for (const idea of fixtures.tradeIdeas) {
        if (
          idea.riskRewardRatio !== null &&
          idea.rewardPerShare !== null &&
          idea.riskPerShare !== null &&
          idea.riskPerShare > 0
        ) {
          const expected =
            Math.round(
              (idea.rewardPerShare / idea.riskPerShare) * 100,
            ) / 100;
          expect(idea.riskRewardRatio).toBeCloseTo(expected, 2);
        }
      }
    }
  });

  it('setupName resolves from the SETUPS constant', () => {
    const fixtures = getWorkstationFixtures('default');
    for (const idea of fixtures.tradeIdeas) {
      if (idea.setupId !== null) {
        expect(idea.setupName).not.toBeNull();
        expect(typeof idea.setupName).toBe('string');
      }
    }
  });

  it('lastPrice matches the corresponding symbolPrices entry', () => {
    for (const id of WORKSTATION_SCENARIO_IDS) {
      const fixtures = getWorkstationFixtures(id);
      for (const idea of fixtures.tradeIdeas) {
        const price = fixtures.symbolPrices[idea.symbol];
        expect(price).toBeDefined();
        expect(idea.lastPrice).toBe(price.lastPrice);
      }
    }
  });

  it('many-watchlist scenario has more trade ideas than default', () => {
    const many = getWorkstationFixtures('many-watchlist');
    const def = getWorkstationFixtures('default');
    expect(many.tradeIdeas.length).toBeGreaterThan(def.tradeIdeas.length);
  });

  it('zero-positions scenario may have trade ideas (watchlist items exist)', () => {
    const fixtures = getWorkstationFixtures('zero-positions');
    expect(fixtures.watchlist.length).toBe(4);
    expect(Array.isArray(fixtures.tradeIdeas)).toBe(true);
  });
});

// ── Determinism extension ───────────────────────────────────────────────

describe('determinism (new fields)', () => {
  it('produces identical marketIndices across calls', () => {
    const a = getWorkstationFixtures('default');
    const b = getWorkstationFixtures('default');
    expect(a.marketIndices).toEqual(b.marketIndices);
  });

  it('produces identical symbolPrices across calls', () => {
    const a = getWorkstationFixtures('default');
    const b = getWorkstationFixtures('default');
    expect(a.symbolPrices).toEqual(b.symbolPrices);
  });

  it('different scenarios produce different market indices', () => {
    const def = getWorkstationFixtures('default');
    const dd = getWorkstationFixtures('large-drawdown');
    expect(def.marketIndices).not.toEqual(dd.marketIndices);
  });

  it('different scenarios produce different symbol prices', () => {
    const def = getWorkstationFixtures('default');
    const zp = getWorkstationFixtures('zero-positions');
    // Different watchlist sizes → different symbolPrices
    expect(Object.keys(def.symbolPrices)).not.toEqual(
      Object.keys(zp.symbolPrices),
    );
  });
});

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
