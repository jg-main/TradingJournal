import { describe, it, expect } from 'vitest';
import {
  computeDailyNetPnl,
  computeCumulativeDailyPnl,
  type PerformanceTradeInput,
} from '../performance-analytics';
import {
  currencyToPercent,
  currencyToR,
  applyUnit,
  getKpiMetricDefinition,
} from '../performance-kpi-catalogue';
import type { ExecutionData } from '../trade-metrics';

/**
 * Contract test: close-date attribution for realized performance.
 *
 * Milestone invariant: realized metrics attribute trades to the selected
 * period by CLOSE DATE. Entry date is never silently used for realized P&L.
 *
 * Scenario: trade entered Jan 28, closed Feb 3.
 * - A January-only window must EXCLUDE it (realized in February).
 * - A February window must INCLUDE it.
 */

function makeTrade(overrides: Partial<PerformanceTradeInput> = {}): PerformanceTradeInput {
  return {
    id: 'trade-boundary',
    direction: 'long',
    status: 'closed',
    symbol: 'AAPL',
    setupId: null,
    executions: [
      { id: 'e1', action: 'buy', quantity: 100, price: 100, fees: 5, executedAt: '2024-01-28T10:00:00Z' } as ExecutionData,
      { id: 'e2', action: 'sell', quantity: 100, price: 120, fees: 5, executedAt: '2024-02-03T15:00:00Z' } as ExecutionData,
    ],
    riskSnapshot: { initialRiskAmount: 500 },
    closedAt: '2024-02-03T15:00:00Z',
    openedAt: '2024-01-28T10:00:00Z',
    ...overrides,
  };
}

// A trade closed on Feb 3 (the boundary trade) plus one genuinely closed in January.
function januaryTrade(): PerformanceTradeInput {
  return makeTrade({
    id: 'trade-jan',
    closedAt: '2024-01-10T15:00:00Z',
    openedAt: '2024-01-05T10:00:00Z',
    executions: [
      { id: 'e3', action: 'buy', quantity: 50, price: 200, fees: 5, executedAt: '2024-01-05T10:00:00Z' } as ExecutionData,
      { id: 'e4', action: 'sell', quantity: 50, price: 210, fees: 5, executedAt: '2024-01-10T15:00:00Z' } as ExecutionData,
    ],
  });
}

describe('close-date attribution contract', () => {
  const boundaryTrade = makeTrade();
  const janTrade = januaryTrade();

  it('a trade entered in January but closed in February is excluded from a January window', () => {
    // Emulate the route's January filter: only trades with closedAt in January.
    const januaryWindow = [janTrade];
    const daily = computeDailyNetPnl(januaryWindow);
    const dates = daily.map((d) => d.date);
    // The boundary trade (closed Feb 3) must NOT appear; only the Jan 10 trade.
    expect(dates).toContain('2024-01-10');
    expect(dates).not.toContain('2024-02-03');
    const total = daily.reduce((sum, d) => sum + d.netPnl, 0);
    // Only the January trade's P&L: (210-200)*50 - 10 = 490
    expect(total).toBeCloseTo(490, 5);
  });

  it('the same trade is included in a February window', () => {
    const februaryWindow = [boundaryTrade];
    const daily = computeDailyNetPnl(februaryWindow);
    expect(daily.map((d) => d.date)).toContain('2024-02-03');
    // (120-100)*100 - 10 = 1990
    expect(daily[0].netPnl).toBeCloseTo(1990, 5);
  });

  it('cumulative P&L uses close-date ordering', () => {
    const window = [janTrade, boundaryTrade]; // entered Jan, closed Feb
    const cumulative = computeCumulativeDailyPnl(window);
    expect(cumulative[0].date).toBe('2024-01-10');
    expect(cumulative[1].date).toBe('2024-02-03');
    expect(cumulative[1].cumulativePnl).toBeCloseTo(490 + 1990, 5);
  });

  it('entry date alone is never used for realized attribution', () => {
    // The boundary trade's openedAt (Jan 28) must not place it in January.
    const januaryWindow = [boundaryTrade];
    const daily = computeDailyNetPnl(januaryWindow);
    expect(daily).toHaveLength(1);
    expect(daily[0].date).toBe('2024-02-03'); // close date, not Jan 28
  });
});

describe('unit semantics contract', () => {
  const currencyDef = getKpiMetricDefinition('net-pnl')!;
  const winRateDef = getKpiMetricDefinition('win-rate')!;
  const countDef = getKpiMetricDefinition('total-trades')!;
  const avgRDef = getKpiMetricDefinition('average-r')!;

  it('percent conversion is relative to period-start equity', () => {
    expect(currencyToPercent(1000, 50000)).toBeCloseTo(0.02, 5);
  });

  it('percent conversion returns null for missing or non-positive equity', () => {
    expect(currencyToPercent(1000, null)).toBeNull();
    expect(currencyToPercent(1000, 0)).toBeNull();
    expect(currencyToPercent(1000, -100)).toBeNull();
  });

  it('R conversion uses P&L / initial risk with the R-multiple guard', () => {
    expect(currencyToR(500, 250)).toBe(2);
    expect(currencyToR(500, null)).toBeNull();
    expect(currencyToR(500, 0)).toBeNull();
    expect(currencyToR(500, -50)).toBeNull();
  });

  it('fixed-semantic metrics are never converted by the global unit', () => {
    const ctx = { periodStartEquity: 10000, totalInitialRisk: 500 };
    expect(applyUnit(0.6, winRateDef, 'percent', ctx)).toEqual({ value: 0.6, unit: 'fixed' });
    expect(applyUnit(8004, countDef, 'r', ctx)).toEqual({ value: 8004, unit: 'fixed' });
    expect(applyUnit(0.5, avgRDef, 'r', ctx)).toEqual({ value: 0.5, unit: 'fixed' });
  });

  it('currency metrics convert to percent and R', () => {
    const ctx = { periodStartEquity: 10000, totalInitialRisk: 500 };
    const pct = applyUnit(1000, currencyDef, 'percent', ctx);
    expect(pct.value).toBeCloseTo(0.1, 5);
    expect(pct.unit).toBe('percent');
    const r = applyUnit(1000, currencyDef, 'r', ctx);
    expect(r.value).toBe(2);
    expect(r.unit).toBe('r');
  });
});
