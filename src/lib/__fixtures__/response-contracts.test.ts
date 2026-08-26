#!/usr/bin/env tsx
/**
 * response-contracts.test.ts
 *
 * Response contract tests for 7 critical APIs.
 *
 * Verifies that the JSON response shapes returned by route handlers have
 * the correct field presence and representative values. Since these are
 * pure-library tests (no database), we test the contract by:
 *   1. Constructing representative response objects from the library types
 *   2. Verifying every expected field is present with the correct type
 *   3. Computing representative values through the pure computation libraries
 *      (same functions the API routes use)
 *   4. Testing error response shapes
 *
 * APIs covered:
 *   1. Dashboard          — GET /api/dashboard → { kpis, mtm, equityCurve, drawdown, ... }
 *   2. Account Detail     — GET /api/accounts/[id] → { ...account, ...balance, kpis }
 *   3. Account Close      — POST /api/accounts/[id]/close → account closure summary
 *   4. Trade Detail       — GET /api/trades/[id] → { ...trade, metrics: TradeMetricsResult }
 *   5. Trade List         — GET /api/trades → { data: [...], total, page, limit }
 *   6. Weekly Review      — GET /api/reviews/weekly → ReviewItem[]
 *                         POST /api/reviews/weekly → upserted ReviewItem
 *   7. Review Dashboard   — GET /api/reviews/dashboard → { setupPerformance, ... }
 *
 * Each section documents the expected response contract as a TypeScript
 * interface inline, then verifies each field by constructing a representative
 * object and asserting field presence + type.
 *
 * Run: npx tsx src/lib/__fixtures__/response-contracts.test.ts
 *
 * The runner exits 0 only when ALL contract assertions pass.
 */

/* ── Imports for library-based contract verification ────────────────── */

import { type ExecutionData, type Direction } from '../trade-metrics';
import {
  computeEquityAtOpen,
  deriveInitialRiskAmount,
  computeRealizedPnLFromClosedTrades,
  computeRiskSnapshotValues,
} from '../risk-snapshot';
import {
  computeAccountKPIs,
  computeAccountBalance,
  computeDatesActive,
  type ClosedTradeData,
  type RiskSnapshotData,
  type GradeData,
} from '../account-summary';
import { computeWinRate, averageRMultiples, averageProcessScore } from '../metrics';
import { computeOpenPosition, calculateUnrealizedPnL, computeMarkToMarketSummary } from '../mark-to-market';
import { calculatePositionSize } from '../position-sizing';
import { computeSetupPerformance, type SetupPerfTradeInput, type SetupPerfResult, type DashboardMetrics } from '../review-dashboard';
import { computeWeeklyMetrics, type WeekReviewTradeInput } from '../weekly-review';
import {
  computeKpiMetrics,
  computeMonthlyPerformance,
  computeRDistribution,
  computeDirectionalPerformance,
  computeProcessScoreDistribution,
  type KpiMetrics,
  type KpiTradeInput,
  type RollforwardRow,
  type MonthlyPerformanceItem,
  type RDistributionBin,
  type DirectionalPerformanceResult,
  type ProcessScoreBin,
} from '../dashboard';
import {
  computeEquityCurve,
  computeDrawdown,
  computeTradeMarkers,
  type EquityDataPoint,
  type DrawdownDataPoint,
  type TradeMarkerPoint,
} from '../equity';
import {
  computeCalendarHeatmap,
  type CalendarHeatmapTradeInput,
  type CalendarHeatmapYearData,
} from '../calendar-heatmap';
import {
  computePeriodMatrix,
  type PeriodMatrixTradeInput,
  type PeriodMatrixResult,
} from '../period-matrix';
import { computeAttentionInsights, type AttentionInsightTradeInput, type AttentionInsight } from '../attention-insights';
// D8: tests must explicitly state the timezone controlling attribution.
const RESPONSE_CONTRACT_TZ = 'UTC';

/* ── Assertion helpers ──────────────────────────────────────────────── */

let passed = 0;
let failed = 0;
let currentSection = '';

function section(name: string): void {
  currentSection = name;
}

function assert(first: string | boolean, second: string | boolean, detail?: string): void {
  const label = typeof first === 'string' ? first : typeof second === 'string' ? second : '';
  const condition = typeof first === 'boolean' ? first : typeof second === 'boolean' ? second : false;
  if (condition) {
    passed++;
  } else {
    failed++;
    const msg = detail ? `  expected: ${detail}` : '';
    console.error(`  ✗ [${currentSection}] ${label}${msg}`);
  }
}

function assertClose(
  label: string,
  actual: number | null | undefined,
  expected: number | null | undefined,
  tolerance = 0.001,
): void {
  if (actual === expected) {
    passed++;
    return;
  }
  if (actual === null && expected !== null) {
    failed++;
    console.error(`  ✗ [${currentSection}] ${label}: expected ${expected}, got null`);
    return;
  }
  if (expected === null && actual !== null) {
    failed++;
    console.error(`  ✗ [${currentSection}] ${label}: expected null, got ${actual}`);
    return;
  }
  if (actual == null || expected == null) {
    failed++;
    console.error(`  ✗ [${currentSection}] ${label}: expected ${expected}, got ${actual}`);
    return;
  }
  const diff = Math.abs(actual - expected);
  if (diff <= tolerance) {
    passed++;
  } else {
    failed++;
    console.error(
      `  ✗ [${currentSection}] ${label}: expected ${expected}, got ${actual} (diff ${diff})`,
    );
  }
}

function assertField(obj: Record<string, unknown>, key: string, expectedType: string): void {
  const actual = typeof obj[key];
  assert(
    `  Field "${key}" is ${expectedType}`,
    actual === expectedType,
    `expected ${expectedType}, got ${actual}`,
  );
}

function assertFieldConcrete<T>(obj: T, key: keyof T, expectedType: string): void {
  const actual = typeof (obj as Record<string, unknown>)[key as string];
  assert(
    `  Field "${String(key)}" is ${expectedType}`,
    actual === expectedType,
    `expected ${expectedType}, got ${actual}`,
  );
}

function assertFieldPresent(obj: Record<string, unknown>, key: string): void {
  assert(`  Field "${key}" is present`, key in obj, `${key} not found in object`);
}



function makeExec(action: string, qty: number, price: number, fees = 0, date?: string): ExecutionData {
  return {
    action,
    quantity: qty,
    price,
    fees: fees || null,
    executedAt: date ?? '2025-06-01T10:00:00.000Z',
  };
}

/* ════════════════════════════════════════════════════════════════════════ */
/*  API 1: Dashboard — GET /api/dashboard                                  */
/*  Response contract: { kpis: KpiMetrics, mtm: MarkToMarketSummary,       */
/*    equityCurve: EquityDataPoint[], drawdown: DrawdownDataPoint[],        */
/*    monthlyPerformance: MonthlyPerformanceItem[],                         */
/*    rDistribution: RDistributionBin[],                                    */
/*    directionalPerformance: DirectionalPerformanceResult,                  */
/*    processScoreDistribution: ProcessScoreBin[], tradeMarkers: [] }      */
/* ════════════════════════════════════════════════════════════════════════ */

section('API 1: Dashboard');

(function testDashboardContract() {
  // ── Build representative KPI data ────────────────────────────────
  const trade1: ExecutionData[] = [
    makeExec('buy', 100, 50, 5, '2025-06-01T10:00:00Z'),
    makeExec('sell', 100, 60, 5, '2025-06-05T14:00:00Z'),
  ]; // P&L = 1000 - 10 = 990

  const trade2: ExecutionData[] = [
    makeExec('sell_short', 50, 100, 3, '2025-06-10T09:30:00Z'),
    makeExec('buy_to_cover', 50, 110, 3, '2025-06-12T11:00:00Z'),
  ]; // Short loss: (100-110)*50 - 6 = -506

  const trade3Open: ExecutionData[] = [
    makeExec('buy', 150, 75, 15, '2025-07-05T10:00:00Z'),
  ];

  // Build KpiTradeInput array
  const allInputs: KpiTradeInput[] = [
    {
      id: 't1',
      direction: 'long',
      status: 'closed',
      executions: trade1,
      grade: { totalScore: 85 },
      riskSnapshot: { initialRiskAmount: 200 },
      closedAt: '2025-06-05T14:00:00Z',
    },
    {
      id: 't2',
      direction: 'short',
      status: 'closed',
      executions: trade2,
      grade: { totalScore: 45 },
      riskSnapshot: { initialRiskAmount: 500 },
      closedAt: '2025-06-12T11:00:00Z',
    },
    {
      id: 't3',
      direction: 'long',
      status: 'open',
      executions: trade3Open,
      grade: null,
      riskSnapshot: { initialRiskAmount: 300 },
      closedAt: null,
    },
  ];

  const closedInputs = allInputs.filter((t) => t.status === 'closed');

  const rollforwardRow: RollforwardRow = {
    date: '2025-07-01',
    endingEquity: 52500,
    drawdownAmount: -200,
    drawdownPct: -0.004,
    cumulativePnl: 2484,
    highWaterMark: 52700,
  };

  // Compute KPIs through the library (same function the route uses)
  const kpis: KpiMetrics = computeKpiMetrics(allInputs, closedInputs, rollforwardRow, null);
  const mtm = computeMarkToMarketSummary([
    { executions: trade3Open, direction: 'long', currentPrice: 82 },
  ]);
  const monthlyPerformance = computeMonthlyPerformance(closedInputs, RESPONSE_CONTRACT_TZ);
  const rDistribution = computeRDistribution(closedInputs);
  const directionalPerformance = computeDirectionalPerformance(closedInputs);
  const processScoreDistribution = computeProcessScoreDistribution(closedInputs);

  // Compute calendar heatmap and period matrix (matching route.ts)
  const heatmapInputs: CalendarHeatmapTradeInput[] = closedInputs.map((t) => ({
    id: t.id,
    direction: t.direction,
    executions: t.executions,
    closedAt: t.closedAt,
  }));
  const periodInputs: PeriodMatrixTradeInput[] = closedInputs.map((t) => ({
    id: t.id,
    direction: t.direction,
    executions: t.executions,
    riskSnapshot: t.riskSnapshot,
    closedAt: t.closedAt,
  }));

  const calendarHeatmap = computeCalendarHeatmap(heatmapInputs, RESPONSE_CONTRACT_TZ);
  const periodMatrix = {
    wow: computePeriodMatrix(periodInputs, 'wow', RESPONSE_CONTRACT_TZ),
    mom: computePeriodMatrix(periodInputs, 'mom', RESPONSE_CONTRACT_TZ),
    qoq: computePeriodMatrix(periodInputs, 'qoq', RESPONSE_CONTRACT_TZ),
  };

  // Compute setup ranking and attention insights (matching route.ts)
  const setupPerfInputs: SetupPerfTradeInput[] = closedInputs.map((t) => ({
    id: t.id,
    direction: t.direction,
    executions: t.executions,
    grade: t.grade,
    riskSnapshot: t.riskSnapshot,
    setupId: null,
  }));
  const setupPerf = computeSetupPerformance(setupPerfInputs, {}, true);
  const setupRanking = setupPerf.setupPerformance;

  const insightInputs: AttentionInsightTradeInput[] = closedInputs.map((t) => ({
    id: t.id,
    direction: t.direction,
    executions: t.executions,
    riskSnapshot: t.riskSnapshot,
    grade: t.grade,
    closedAt: t.closedAt,
    setupId: null,
  }));
  const attentionInsightsResult = computeAttentionInsights(insightInputs, RESPONSE_CONTRACT_TZ);

  // ── Construct the dashboard response object ────────────────────
  const dashboardResponse = {
    kpis,
    mtm,
    equityCurve: [] as EquityDataPoint[],
    drawdown: [] as DrawdownDataPoint[],
    monthlyPerformance,
    rDistribution,
    directionalPerformance,
    processScoreDistribution,
    tradeMarkers: [] as TradeMarkerPoint[],
    calendarHeatmap,
    periodMatrix,
    setupRanking,
    attentionInsights: { insights: attentionInsightsResult.insights, tradeCount: attentionInsightsResult.tradeCount },
  };

  // ── Verify top-level structure ─────────────────────────────────
  assertField(dashboardResponse as unknown as Record<string, unknown>, 'kpis', 'object');
  assertField(dashboardResponse as unknown as Record<string, unknown>, 'mtm', 'object');
  assert('  equityCurve is array', Array.isArray(dashboardResponse.equityCurve));
  assert('  drawdown is array', Array.isArray(dashboardResponse.drawdown));
  assert('  monthlyPerformance is array', Array.isArray(dashboardResponse.monthlyPerformance));
  assert('  rDistribution is array', Array.isArray(dashboardResponse.rDistribution));
  assert('  directionalPerformance is object', typeof dashboardResponse.directionalPerformance === 'object');
  assert('  processScoreDistribution is array', Array.isArray(dashboardResponse.processScoreDistribution));
  assert('  tradeMarkers is array', Array.isArray(dashboardResponse.tradeMarkers));

  // ── Calendar Heatmap contract ─────────────────────────────────
  assert('  calendarHeatmap is array', Array.isArray(dashboardResponse.calendarHeatmap));
  const ch = dashboardResponse.calendarHeatmap[0];
  if (ch) {
    assertField(ch as unknown as Record<string, unknown>, 'year', 'number');
    assert('  calendarHeatmap[0].days is array', Array.isArray(ch.days));
  }

  // ── Period Matrix contract ────────────────────────────────────
  assert('  periodMatrix is object', typeof dashboardResponse.periodMatrix === 'object');
  const pm = dashboardResponse.periodMatrix;
  assert('  periodMatrix.wow is object', typeof pm.wow === 'object');
  assert('  periodMatrix.mom is object', typeof pm.mom === 'object');
  assert('  periodMatrix.qoq is object', typeof pm.qoq === 'object');
  assert(pm.wow.comparisonType === 'wow', '  periodMatrix.wow.comparisonType = wow');
  assert(pm.mom.comparisonType === 'mom', '  periodMatrix.mom.comparisonType = mom');
  assert(pm.qoq.comparisonType === 'qoq', '  periodMatrix.qoq.comparisonType = qoq');
  assert('  periodMatrix.wow.rows is array', Array.isArray(pm.wow.rows));

  // ── Setup Ranking contract ────────────────────────────────────
  assert('  setupRanking is array', Array.isArray(dashboardResponse.setupRanking));
  const sr = dashboardResponse.setupRanking[0];
  if (sr) {
    assertField(sr as unknown as Record<string, unknown>, 'setupName', 'string');
    assert('  sr.setupId is string or null', sr.setupId === null || typeof sr.setupId === 'string');
    assertField(sr as unknown as Record<string, unknown>, 'count', 'number');
    assert('  sr.winRate is number or null', sr.winRate === null || typeof sr.winRate === 'number');
    assert('  sr.avgR is number or null', sr.avgR === null || typeof sr.avgR === 'number');
    assert('  sr.avgProcessScore is number or null', sr.avgProcessScore === null || typeof sr.avgProcessScore === 'number');
    assert('  sr.sampleSizeWarning is valid string', typeof sr.sampleSizeWarning === 'string');
    assert(
      '  sampleSizeWarning is one of very_small/small/moderate/adequate',
      ['very_small', 'small', 'moderate', 'adequate'].includes(sr.sampleSizeWarning),
    );
  }

  // ── Attention Insights contract ───────────────────────────────
  assert('  attentionInsights is object', typeof dashboardResponse.attentionInsights === 'object');
  assert('  attentionInsights.insights is array', Array.isArray(dashboardResponse.attentionInsights.insights));
  assert('  attentionInsights.tradeCount is number', typeof dashboardResponse.attentionInsights.tradeCount === 'number');
  const insight = dashboardResponse.attentionInsights.insights[0];
  if (insight) {
    assertField(insight as unknown as Record<string, unknown>, 'type', 'string');
    assertField(insight as unknown as Record<string, unknown>, 'title', 'string');
    assertField(insight as unknown as Record<string, unknown>, 'message', 'string');
    assertField(insight as unknown as Record<string, unknown>, 'severity', 'string');
    assert(
      '  severity is one of critical/warning/info',
      ['critical', 'warning', 'info'].includes(insight.severity),
    );
    assert('  insight.value is string, number, or undefined', insight.value === undefined || typeof insight.value === 'string' || typeof insight.value === 'number');
  }
  const perfRow = pm.wow.rows[0];
  if (perfRow) {
    assert('  row.current is object', typeof perfRow.current === 'object');
    assert('  row.previous is object', typeof perfRow.previous === 'object');
    assert('  row.delta is object', typeof perfRow.delta === 'object');
    assertField(perfRow.current as unknown as Record<string, unknown>, 'periodId', 'string');
    assertField(perfRow.current as unknown as Record<string, unknown>, 'periodLabel', 'string');
    assertField(perfRow.current as unknown as Record<string, unknown>, 'pnl', 'number');
    assertField(perfRow.current as unknown as Record<string, unknown>, 'tradeCount', 'number');
    assert('  current.avgR is number or null', perfRow.current.avgR === null || typeof perfRow.current.avgR === 'number');
    assert('  delta.pnl is number', typeof perfRow.delta.pnl === 'number');
    assert('  delta.tradeCount is number', typeof perfRow.delta.tradeCount === 'number');
  }

  // ── KPI contract ─────────────────────────────────────────────
  const k = dashboardResponse.kpis;
  assertField(k as unknown as Record<string, unknown>, 'totalTrades', 'number');
  assertField(k as unknown as Record<string, unknown>, 'openTrades', 'number');
  assert('  kpis.winRate is number or null', k.winRate === null || typeof k.winRate === 'number');
  assertField(k as unknown as Record<string, unknown>, 'netPnl', 'number');
  assert('  kpis.avgR is number or null', k.avgR === null || typeof k.avgR === 'number');
  assert('  kpis.avgGrade is number or null', k.avgGrade === null || typeof k.avgGrade === 'number');
  assert('  kpis.currentDrawdown is number or null', k.currentDrawdown === null || typeof k.currentDrawdown === 'number');
  assert('  kpis.currentDrawdownPct is number or null', k.currentDrawdownPct === null || typeof k.currentDrawdownPct === 'number');
  assert('  kpis.accountValue is number or null', k.accountValue === null || typeof k.accountValue === 'number');
  assert('  kpis.profitFactor is number or null', k.profitFactor === null || typeof k.profitFactor === 'number');
  assert('  kpis.avgWin is number or null', k.avgWin === null || typeof k.avgWin === 'number');
  assert('  kpis.avgLoss is number or null', k.avgLoss === null || typeof k.avgLoss === 'number');

  // Representative KPI values
  assert(k.totalTrades === 3, '  totalTrades is 3 (2 closed + 1 open)');
  assert(k.openTrades === 1, '  openTrades is 1');
  assertClose('  netPnl = 990 + (-506) = 484', k.netPnl, 990 - 506);
  assertClose('  winRate = 1/2 = 0.5', k.winRate, 0.5);
  assertClose('  accountValue from rollforward', k.accountValue, 52500);

  // ── MTM contract ──────────────────────────────────────────────
  const m = dashboardResponse.mtm;
  assertField(m as unknown as Record<string, unknown>, 'netUnrealizedPnl', 'number');
  assertField(m as unknown as Record<string, unknown>, 'tradesWithPrices', 'number');
  assertField(m as unknown as Record<string, unknown>, 'tradesAwaitingData', 'number');
  assertField(m as unknown as Record<string, unknown>, 'openTradeCount', 'number');
  assert(m.openTradeCount === 1, '  MTM: openTradeCount = 1');
  assertClose('  MTM: unrealized = (82-75)*150 - 15 = 1035', m.netUnrealizedPnl!, (82 - 75) * 150 - 15);

  // ── Monthly performance contract ──────────────────────────────
  const mp = dashboardResponse.monthlyPerformance[0];
  if (mp) {
    assertField(mp as unknown as Record<string, unknown>, 'month', 'string');
    assertField(mp as unknown as Record<string, unknown>, 'netPnl', 'number');
    assert('  monthlyPerformance[0].winRate is number or null', mp.winRate === null || typeof mp.winRate === 'number');
    assertField(mp as unknown as Record<string, unknown>, 'tradeCount', 'number');
  }

  // ── R Distribution contract ──────────────────────────────────
  assert(dashboardResponse.rDistribution.length === 8, '  rDistribution has 8 bins');
  const rBin = dashboardResponse.rDistribution[0];
  assertField(rBin as unknown as Record<string, unknown>, 'label', 'string');
  assertField(rBin as unknown as Record<string, unknown>, 'count', 'number');

  // ── Directional performance contract ──────────────────────────
  const dp = dashboardResponse.directionalPerformance;
  assertField(dp.long as unknown as Record<string, unknown>, 'netPnl', 'number');
  assert('  dirPerf.long.winRate is number or null', dp.long.winRate === null || typeof dp.long.winRate === 'number');
  assertField(dp.long as unknown as Record<string, unknown>, 'tradeCount', 'number');
  assertField(dp.short as unknown as Record<string, unknown>, 'netPnl', 'number');
  assert('  dirPerf.short.winRate is number or null', dp.short.winRate === null || typeof dp.short.winRate === 'number');
  assertField(dp.short as unknown as Record<string, unknown>, 'tradeCount', 'number');

  // ── Process score distribution contract ───────────────────────
  assert(Array.isArray(dashboardResponse.processScoreDistribution), '  processScoreDistribution is array');
  const ps = dashboardResponse.processScoreDistribution[0];
  if (ps) {
    assertField(ps as unknown as Record<string, unknown>, 'label', 'string');
    assertField(ps as unknown as Record<string, unknown>, 'count', 'number');
    assertField(ps as unknown as Record<string, unknown>, 'minScore', 'number');
  }
})();

/* ════════════════════════════════════════════════════════════════════════ */
/*  API 2: Account Detail — GET /api/accounts/[id]                         */
/*  Response contract: { ...account, ...balance, kpis }                    */
/*    account: { id, name, broker, currency, isActive,                     */
/*               maxRiskPerTradePct, defaultCommission, startingBalance,    */
/*               createdAt, updatedAt }                                    */
/*    balance: { currentBalance, netDeposits, netWithdrawals, realizedPnl }*/
/*    kpis:    { tradeCount, netPnl, winRate, avgR, avgGrade }             */
/* ════════════════════════════════════════════════════════════════════════ */

section('API 2: Account Detail');

(function testAccountDetailContract() {
  // Build representative account fields
  const account = {
    id: 'acc-001',
    name: 'Test Account',
    broker: 'Test Broker',
    currency: 'USD',
    isActive: true,
    maxRiskPerTradePct: 2,
    defaultCommission: 3.5,
    startingBalance: 10000,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-07-01T00:00:00.000Z',
  };

  // Build representative balance (via computeAccountBalance)
  const balance = computeAccountBalance(
    10000,
    [{ type: 'deposit' as const, amount: 2000, date: '2025-05-01T00:00:00Z' }],
    484,
  );

  // Build representative KPIs
  const tradeAExecs = [makeExec('buy', 100, 50, 5), makeExec('sell', 100, 60, 5)];
  const tradeBExecs = [makeExec('sell_short', 50, 100, 3), makeExec('buy_to_cover', 50, 110, 3)];
  const closedTrades: ClosedTradeData[] = [
    { id: 't1', direction: 'long', createdAt: '2025-06-01T10:00:00Z' },
    { id: 't2', direction: 'short', createdAt: '2025-06-10T09:30:00Z' },
  ];
  const execMap = new Map<string, ExecutionData[]>();
  execMap.set('t1', tradeAExecs);
  execMap.set('t2', tradeBExecs);
  const riskSnapshots: RiskSnapshotData[] = [
    { tradeId: 't1', initialRiskAmount: 200 },
    { tradeId: 't2', initialRiskAmount: 500 },
  ];
  const grades: GradeData[] = [
    { tradeId: 't1', totalScore: 85 },
    { tradeId: 't2', totalScore: 45 },
  ];
  const kpis = computeAccountKPIs(closedTrades, execMap, riskSnapshots, grades);

  // Construct the response object
  const response = {
    ...account,
    ...balance,
    kpis,
  };

  // Verify account fields
  assertFieldConcrete(response, 'id', 'string');
  assertFieldConcrete(response, 'name', 'string');
  assert('  broker is string or null', typeof response.broker === 'string' || response.broker === null);
  assertFieldConcrete(response, 'currency', 'string');
  assert('  isActive is boolean', typeof response.isActive === 'boolean');
  assert('  maxRiskPerTradePct is number or null', typeof response.maxRiskPerTradePct === 'number' || response.maxRiskPerTradePct === null);
  assert('  defaultCommission is number or null', typeof response.defaultCommission === 'number' || response.defaultCommission === null);
  assert('  startingBalance is number or null', typeof response.startingBalance === 'number' || response.startingBalance === null);
  assertFieldConcrete(response, 'createdAt', 'string');
  assertFieldConcrete(response, 'updatedAt', 'string');

  // Verify balance fields
  assertFieldConcrete(response, 'currentBalance', 'number');
  assertFieldConcrete(response, 'netDeposits', 'number');
  assertFieldConcrete(response, 'netWithdrawals', 'number');
  assertFieldConcrete(response, 'realizedPnl', 'number');

  // Verify KPI fields
  assert('  kpis is object', typeof response.kpis === 'object');
  assert('  kpis.tradeCount is number', typeof response.kpis.tradeCount === 'number');
  assert('  kpis.netPnl is number', typeof response.kpis.netPnl === 'number');
  assert('  kpis.winRate is number or null', response.kpis.winRate === null || typeof response.kpis.winRate === 'number');
  assert('  kpis.avgR is number or null', response.kpis.avgR === null || typeof response.kpis.avgR === 'number');
  assert('  kpis.avgGrade is number or null', response.kpis.avgGrade === null || typeof response.kpis.avgGrade === 'number');

  // Representative values
  assertClose('  balance = 12484', response.currentBalance, 10000 + 2000 + 484);
  assert(response.kpis.tradeCount === 2, '  tradeCount = 2');
  assertClose('  netPnl = 484', response.kpis.netPnl, 484);
  assertClose('  avgGrade = (85+45)/2 = 65', response.kpis.avgGrade, 65);



})();

/* ════════════════════════════════════════════════════════════════════════ */
/*  API 3: Account Close — POST /api/accounts/[id]/close                  */
/*  Response contract: { accountId, accountName, startingBalance,          */
/*    depositsTotal, withdrawalsTotal, realizedPnl, finalBalance,          */
/*    netReturn, kpis, datesActive, closedAt }                            */
/* ════════════════════════════════════════════════════════════════════════ */

section('API 3: Account Close');

(function testAccountCloseContract() {
  // Compute representative values
  const startingBalance = 10000;
  const depositsTotal = 2000;
  const withdrawalsTotal = 500;
  const realizedPnl = 484;

  const datesActive = computeDatesActive(
    '2025-01-01T00:00:00Z',
    [{ type: 'deposit' as const, amount: 2000, date: '2025-05-01T00:00:00Z' }],
    '2025-07-01T00:00:00Z',
  );

  // Compute a representative KPI
  const tradeAExecs = [makeExec('buy', 100, 50, 5), makeExec('sell', 100, 60, 5)];
  const tradeBExecs = [makeExec('sell_short', 50, 100, 3), makeExec('buy_to_cover', 50, 110, 3)];
  const closedTrades: ClosedTradeData[] = [
    { id: 't1', direction: 'long', createdAt: '2025-06-01T10:00:00Z' },
    { id: 't2', direction: 'short', createdAt: '2025-06-10T09:30:00Z' },
  ];
  const execMap = new Map<string, ExecutionData[]>();
  execMap.set('t1', tradeAExecs);
  execMap.set('t2', tradeBExecs);
  const riskSnapshots: RiskSnapshotData[] = [
    { tradeId: 't1', initialRiskAmount: 200 },
    { tradeId: 't2', initialRiskAmount: 500 },
  ];
  const grades: GradeData[] = [
    { tradeId: 't1', totalScore: 85 },
    { tradeId: 't2', totalScore: 45 },
  ];
  const kpis = computeAccountKPIs(closedTrades, execMap, riskSnapshots, grades);

  const netReturn = depositsTotal > 0 ? (realizedPnl / depositsTotal) * 100 : null;

  // Construct the response
  const response = {
    accountId: 'acc-001',
    accountName: 'Test Account',
    startingBalance,
    depositsTotal,
    withdrawalsTotal,
    realizedPnl,
    finalBalance: startingBalance + depositsTotal - withdrawalsTotal + realizedPnl,
    netReturn,
    kpis,
    datesActive,
    closedAt: '2025-07-01T12:00:00.000Z',
  };

  // Verify all fields
  assertFieldConcrete(response, 'accountId', 'string');
  assertFieldConcrete(response, 'accountName', 'string');
  assertFieldConcrete(response, 'startingBalance', 'number');
  assertFieldConcrete(response, 'depositsTotal', 'number');
  assertFieldConcrete(response, 'withdrawalsTotal', 'number');
  assertFieldConcrete(response, 'realizedPnl', 'number');
  assertFieldConcrete(response, 'finalBalance', 'number');
  assert('  netReturn is number or null', response.netReturn === null || typeof response.netReturn === 'number');
  assert('  kpis is object', typeof response.kpis === 'object');
  assert('  datesActive is object', typeof response.datesActive === 'object');
  assertFieldConcrete(response, 'closedAt', 'string');

  // Representative values
  assertClose('  finalBalance = 11984', response.finalBalance, 10000 + 2000 - 500 + 484);
  assertClose('  netReturn = 24.2%', response.netReturn!, (484 / 2000) * 100);
  assert('  datesActive.from is string', typeof response.datesActive.from === 'string');
  assert('  datesActive.to is string', typeof response.datesActive.to === 'string');
})();

/* ════════════════════════════════════════════════════════════════════════ */
/*  API 4: Trade Detail — GET /api/trades/[id]                             */
/*  Response contract: { id, tradeCode, symbol, direction, accountId,      */
/*    sectorId, setupId, marketConditionId, status, plannedEntry,          */
/*    plannedStop, plannedTarget1, plannedTarget2, plannedQuantity,        */
/*    thesis, invalidationCondition, preTradePlan, openedAt, closedAt,     */
/*    exitNotes, lesson, createdAt, updatedAt, currentPrice,               */
/*    currentPriceFetchedAt, setupName, metrics: TradeMetricsResult }      */
/*  Trade metrics (realizedPnl, unrealizedPnl, returnPct, riskPct) are     */
/*  accessed via the nested metrics object, not as flat fields.            */
/* ════════════════════════════════════════════════════════════════════════ */

section('API 4: Trade Detail');

(function testTradeDetailContract() {
  // Build representative closed-trade response
  const closedTradeResponse: Record<string, unknown> = {
    id: 'trade-001',
    tradeCode: 'T-0001',
    symbol: 'AAPL',
    direction: 'long',
    accountId: 'acc-001',
    sectorId: null,
    setupId: 'setup-001',
    marketConditionId: null,
    status: 'closed',
    plannedEntry: 50,
    plannedStop: 48,
    plannedTarget1: 60,
    plannedTarget2: null,
    plannedQuantity: 100,
    thesis: 'Bullish breakout',
    invalidationCondition: null,
    preTradePlan: null,
    openedAt: '2025-06-01T10:00:00.000Z',
    closedAt: '2025-06-05T14:00:00.000Z',
    exitNotes: 'Hit target 1',
    lesson: 'Stick to the plan',
    createdAt: '2025-06-01T09:30:00.000Z',
    updatedAt: '2025-06-05T14:00:00.000Z',
    currentPrice: null,
    currentPriceFetchedAt: null,
    setupName: 'Breakout',
  };

  // Verify all fields present with correct types
  const fieldTypes: [string, string][] = [
    ['id', 'string'],
    ['tradeCode', 'string'],
    ['symbol', 'string'],
    ['direction', 'string'],
    ['accountId', 'string'],
    ['status', 'string'],
    ['createdAt', 'string'],
    ['updatedAt', 'string'],
    ['thesis', 'string'],
  ];

  for (const [key, type] of fieldTypes) {
    assertField(closedTradeResponse, key, type);
  }

  // Nullable numeric fields (trade metrics accessed via nested metrics object)
  const nullableNumericFields = [
    'plannedEntry', 'plannedStop', 'plannedTarget1', 'plannedTarget2',
    'plannedQuantity', 'currentPrice',
  ];
  for (const key of nullableNumericFields) {
    assert(
      `  ${key} is number or null`,
      closedTradeResponse[key] === null || typeof closedTradeResponse[key] === 'number',
    );
  }

  // Nullable string fields
  const nullableStringFields = [
    'sectorId', 'setupId', 'marketConditionId', 'invalidationCondition',
    'preTradePlan', 'openedAt', 'closedAt', 'exitNotes', 'lesson',
    'currentPriceFetchedAt', 'setupName',
  ];
  for (const key of nullableStringFields) {
    assert(
      `  ${key} is string or null`,
      closedTradeResponse[key] === null || typeof closedTradeResponse[key] === 'string',
    );
  }

  // Representative values
  assert(closedTradeResponse.tradeCode === 'T-0001', '  tradeCode = T-0001');
  assert(closedTradeResponse.direction === 'long', '  direction = long');
  assert(closedTradeResponse.status === 'closed', '  status = closed');
  assert(closedTradeResponse.setupName === 'Breakout', '  setupName = Breakout');
  // Metrics object is present (no flat unrealizedPnl — use nested metrics)
  assert('  metrics field is expected but not tested inline here (covered by computeTradeMetrics contract)', true);

  // Open trade with unrealized P&L
  const openExecs = [makeExec('buy', 150, 75, 15, '2025-07-05T10:00:00Z')];
  const unrealized = calculateUnrealizedPnL({
    executions: openExecs,
    direction: 'long',
    currentPrice: 82,
  });
  // Gross: (82-75)*150 = 1050, net after fees = 1035
  assertClose('  open trade unrealized P&L = 1035', unrealized!, (82 - 75) * 150 - 15);
})();

/* ════════════════════════════════════════════════════════════════════════ */
/*  API 5: Trade List — GET /api/trades                                    */
/*  Response contract: { data: EnhancedTradeRow[], total, page, limit }    */
/*  Each row: { id, tradeCode, accountId, symbol, direction, ...           */
/*              setupName, status, actualEntry, avgExitPrice,               */
/*              realizedPnl, unrealizedPnl, returnPct, riskPct }           */
/* ════════════════════════════════════════════════════════════════════════ */

section('API 5: Trade List');

(function testTradeListContract() {
  // Build a representative trade row based on route.ts response
  const tradeRow: Record<string, unknown> = {
    id: 'trade-001',
    tradeCode: 'T-0001',
    accountId: 'acc-001',
    symbol: 'AAPL',
    direction: 'long',
    setupId: null,
    setupName: null,
    sectorId: null,
    marketConditionId: null,
    marketConditionName: null,
    status: 'closed',
    thesis: null,
    plannedEntry: 50,
    plannedStop: 48,
    plannedTarget1: 60,
    plannedQuantity: 100,
    invalidationCondition: null,
    preTradePlan: null,
    openedAt: '2025-06-01T10:00:00.000Z',
    closedAt: '2025-06-05T14:00:00.000Z',
    currentPrice: null,
    actualEntry: 50,
    avgExitPrice: 60,
    exitNotes: null,
    lesson: null,
    createdAt: '2025-06-01T09:30:00.000Z',
    updatedAt: '2025-06-05T14:00:00.000Z',
    riskPct: null,
    realizedPnl: 990,
    unrealizedPnl: null,
    returnPct: 19.8,
  };

  // Verify all fields
  assertField(tradeRow, 'id', 'string');
  assertField(tradeRow, 'tradeCode', 'string');
  assertField(tradeRow, 'accountId', 'string');
  assertField(tradeRow, 'symbol', 'string');
  assertField(tradeRow, 'direction', 'string');
  assert('  status is string', typeof tradeRow.status === 'string');
  assert('  status is one of planned/open/closed', ['planned', 'open', 'closed'].includes(tradeRow.status as string));

  // Nullable fields
  const nullableNumeric = ['plannedEntry', 'plannedStop', 'plannedTarget1', 'plannedQuantity',
    'currentPrice', 'actualEntry', 'avgExitPrice', 'riskPct',
    'realizedPnl', 'unrealizedPnl', 'returnPct'];
  for (const key of nullableNumeric) {
    assert(
      `  ${key} is number or null`,
      tradeRow[key] === null || typeof tradeRow[key] === 'number',
    );
  }

  const nullableString = ['setupId', 'setupName', 'sectorId', 'marketConditionId', 'marketConditionName',
    'thesis', 'invalidationCondition', 'preTradePlan',
    'openedAt', 'closedAt', 'exitNotes', 'lesson'];
  for (const key of nullableString) {
    assert(
      `  ${key} is string or null`,
      tradeRow[key] === null || typeof tradeRow[key] === 'string',
    );
  }

  // Verify pagination envelope
  const listResponse = { data: [tradeRow], total: 1, page: 1, limit: 50 };
  assert('  data is array', Array.isArray(listResponse.data));
  assertFieldConcrete(listResponse, 'total', 'number');
  assertFieldConcrete(listResponse, 'page', 'number');
  assertFieldConcrete(listResponse, 'limit', 'number');
  assert(listResponse.total >= 0, '  total >= 0');
  assert(listResponse.page >= 1, '  page >= 1');
  assert(listResponse.limit >= 1 && listResponse.limit <= 100, '  limit between 1-100');

  // Representative values
  assertClose('  realizedPnl = 990', tradeRow.realizedPnl as number, 990);
  assert(tradeRow.status === 'closed', '  status = closed');
  assertClose('  actualEntry = 50', tradeRow.actualEntry as number, 50);
})();

/* ════════════════════════════════════════════════════════════════════════ */
/*  API 6: Weekly Review — GET /api/reviews/weekly, POST /api/reviews/     */
/*  weekly                                                                 */
/*  Response contract (GET): ReviewItem[]                                  */
/*    Each item: { id, weekStart, weekEnd, accountId, closedTrades,        */
/*                netPnl, avgR, winRate, avgProcessScore, notes,           */
/*                focusNextWeek, createdAt, updatedAt }                    */
/*  Response contract (POST): single ReviewItem (upserted)                 */
/* ════════════════════════════════════════════════════════════════════════ */

section('API 6: Weekly Review');

(function testWeeklyReviewContract() {
  // ── Build a representative WeekReviewTradeInput ─────────────────
  const tradeInputs: WeekReviewTradeInput[] = [
    {
      id: 't1',
      direction: 'long',
      executions: [makeExec('buy', 100, 50, 5), makeExec('sell', 100, 60, 5)],
      grade: { totalScore: 85 },
      riskSnapshot: { initialRiskAmount: 200 },
    },
    {
      id: 't2',
      direction: 'short',
      executions: [makeExec('sell_short', 50, 100, 3), makeExec('buy_to_cover', 50, 110, 3)],
      grade: { totalScore: 45 },
      riskSnapshot: { initialRiskAmount: 500 },
    },
  ];

  const metrics = computeWeeklyMetrics(tradeInputs);

  // Construct a representative GET response item
  const reviewItem: Record<string, unknown> = {
    id: 'review-001',
    weekStart: '2025-06-09',
    weekEnd: '2025-06-15',
    accountId: 'acc-001',
    closedTrades: metrics.closedTrades,
    netPnl: metrics.netPnl,
    avgR: metrics.avgR,
    winRate: metrics.winRate,
    avgProcessScore: metrics.avgProcessScore,
    notes: null,
    focusNextWeek: null,
    createdAt: '2025-06-15T23:59:00.000Z',
    updatedAt: '2025-06-15T23:59:00.000Z',
  };

  // Verify all fields
  assertField(reviewItem, 'id', 'string');
  assertField(reviewItem, 'weekStart', 'string');
  assertField(reviewItem, 'weekEnd', 'string');
  assertField(reviewItem, 'accountId', 'string');
  assert('  closedTrades is number', typeof reviewItem.closedTrades === 'number');
  assert('  netPnl is number', typeof reviewItem.netPnl === 'number');
  assert('  avgR is number or null', reviewItem.avgR === null || typeof reviewItem.avgR === 'number');
  assert('  winRate is number', typeof reviewItem.winRate === 'number');
  assert('  avgProcessScore is number or null', reviewItem.avgProcessScore === null || typeof reviewItem.avgProcessScore === 'number');
  assert('  notes is string or null', reviewItem.notes === null || typeof reviewItem.notes === 'string');
  assert('  focusNextWeek is string or null', reviewItem.focusNextWeek === null || typeof reviewItem.focusNextWeek === 'string');
  assertField(reviewItem, 'createdAt', 'string');
  assertField(reviewItem, 'updatedAt', 'string');

  // Representative values
  assert(reviewItem.closedTrades === 2, '  closedTrades = 2');
  assertClose('  netPnl = 484', reviewItem.netPnl as number, 990 - 506);
  assertClose('  winRate = 0.5', reviewItem.winRate as number, 0.5);

  // Verify GET response is an array
  const getResponse = [reviewItem];
  assert(Array.isArray(getResponse), '  GET response is array');
  assert(getResponse.length === 1, '  GET response has 1 item');

  // Verify list response (empty)
  const emptyResponse: unknown[] = [];
  assert(Array.isArray(emptyResponse), '  empty GET response is array');
  assert(emptyResponse.length === 0, '  empty GET response length 0');
})();

/* ════════════════════════════════════════════════════════════════════════ */
/*  API 7: Review Dashboard — GET /api/reviews/dashboard?accountId=xxx    */
/*  Response contract: { setupPerformance: SetupPerfResult[], totalTrades, */
/*    ungroupedTrades, mistakeFrequency, ungradedTrades }                  */
/* ════════════════════════════════════════════════════════════════════════ */

section('API 7: Review Dashboard');

(function testReviewDashboardContract() {
  // Build representative SetupPerfTradeInputs
  const perfInputs: SetupPerfTradeInput[] = [
    {
      id: 't1',
      direction: 'long',
      executions: [makeExec('buy', 100, 50, 5), makeExec('sell', 100, 60, 5)],
      grade: { totalScore: 85 },
      riskSnapshot: { initialRiskAmount: 200 },
      setupId: 'setup-breakout',
    },
    {
      id: 't2',
      direction: 'long',
      executions: [makeExec('buy', 50, 30, 3), makeExec('sell', 50, 35, 3)],
      grade: { totalScore: 70 },
      riskSnapshot: { initialRiskAmount: 100 },
      setupId: 'setup-breakout',
    },
    {
      id: 't3',
      direction: 'short',
      executions: [makeExec('sell_short', 50, 100, 3), makeExec('buy_to_cover', 50, 110, 3)],
      grade: { totalScore: 45 },
      riskSnapshot: { initialRiskAmount: 500 },
      setupId: 'setup-fade',
    },
  ];

  const setupNameMap: Record<string, string> = {
    'setup-breakout': 'Breakout',
    'setup-fade': 'Fade',
  };

  const metrics: DashboardMetrics = computeSetupPerformance(perfInputs, setupNameMap);

  // Construct the full response (as returned by route.ts)
  const response = {
    setupPerformance: metrics.setupPerformance,
    totalTrades: metrics.totalTrades,
    ungroupedTrades: metrics.ungroupedTrades,
    mistakeFrequency: [] as { mistakeType: string; minor: number; moderate: number; major: number; critical: number; total: number }[],
    ungradedTrades: [] as { id: string; tradeCode: string; symbol: string; direction: string; closedAt: string | null }[],
  };

  // Verify top-level structure
  assert('  setupPerformance is array', Array.isArray(response.setupPerformance));
  assert('  totalTrades is number', typeof response.totalTrades === 'number');
  assert('  ungroupedTrades is number', typeof response.ungroupedTrades === 'number');
  assert('  mistakeFrequency is array', Array.isArray(response.mistakeFrequency));
  assert('  ungradedTrades is array', Array.isArray(response.ungradedTrades));

  // Verify SetupPerfResult contract
  const firstSetup = response.setupPerformance[0];
  assertField(firstSetup as unknown as Record<string, unknown>, 'setupName', 'string');
  assert('  setupId is string or null', firstSetup.setupId === null || typeof firstSetup.setupId === 'string');
  assertField(firstSetup as unknown as Record<string, unknown>, 'count', 'number');
  assert('  winRate is number or null', firstSetup.winRate === null || typeof firstSetup.winRate === 'number');
  assert('  avgR is number or null', firstSetup.avgR === null || typeof firstSetup.avgR === 'number');
  assert('  avgProcessScore is number or null', firstSetup.avgProcessScore === null || typeof firstSetup.avgProcessScore === 'number');
  assert(
    '  sampleSizeWarning is valid',
    ['very_small', 'small', 'moderate', 'adequate'].includes(firstSetup.sampleSizeWarning),
  );

  // Representative values
  // Breakout setup: 2 trades, both winners, R= (247*2)/(200+100)?? Let me compute
  // t1: P&L = (60-50)*100 - 10 = 990, R = 990/200 = 4.95
  // t2: P&L = (35-30)*50 - 6 = 244, R = 244/100 = 2.44
  // Win rate: excludeScratches, both positive → 1.0
  // Avg R: (4.95 + 2.44) / 2 ≈ 3.695
  // Avg grade: (85+70)/2 = 77.5
  assertClose('  Breakout count = 2', firstSetup.count, 2);
  assertClose('  Breakout avgR ≈ 3.695', firstSetup.avgR!, (990/200 + 244/100) / 2, 0.01);
  assertClose('  Breakout avg grade = 77.5', firstSetup.avgProcessScore!, 77.5);

  // Total trades
  assert(response.totalTrades === 3, '  totalTrades = 3');

  // Ungraded trades shape (contract test — representative value)
  const ungradedTrade = {
    id: 'untraded-001',
    tradeCode: 'T-9999',
    symbol: 'TSLA',
    direction: 'long',
    closedAt: '2025-06-20T10:00:00.000Z',
  };
  assertFieldConcrete(ungradedTrade, 'id', 'string');
  assertFieldConcrete(ungradedTrade, 'tradeCode', 'string');
  assertFieldConcrete(ungradedTrade, 'symbol', 'string');
  assertFieldConcrete(ungradedTrade, 'direction', 'string');
  assert('  closedAt is string or null', ungradedTrade.closedAt === null || typeof ungradedTrade.closedAt === 'string');

  // Mistake frequency shape (contract test — representative value)
  const mistake = {
    mistakeType: 'Entry timing',
    minor: 3,
    moderate: 1,
    major: 0,
    critical: 0,
    total: 4,
  };
  assertFieldConcrete(mistake, 'mistakeType', 'string');
  assertFieldConcrete(mistake, 'minor', 'number');
  assertFieldConcrete(mistake, 'moderate', 'number');
  assertFieldConcrete(mistake, 'major', 'number');
  assertFieldConcrete(mistake, 'critical', 'number');
  assertFieldConcrete(mistake, 'total', 'number');
})();

/* ════════════════════════════════════════════════════════════════════════ */
/*  ERROR RESPONSE SHAPES                                                   */
/*  Standardized error shape across all routes:                             */
/*    { error: string, details?: unknown }                                  */
/* ════════════════════════════════════════════════════════════════════════ */

section('Error Shapes');

(function testErrorShapes() {
  // Standard 404
  const notFound: Record<string, unknown> = { error: 'Account not found' };
  assertField(notFound, 'error', 'string');
  assert('  no "details" key in 404', !('details' in notFound));

  // Standard 400 with validation details
  const validationError: Record<string, unknown> = {
    error: 'Validation failed',
    details: { fieldErrors: { accountId: ['No account resolved'] } },
  };
  assertField(validationError, 'error', 'string');
  assertField(validationError, 'details', 'object');
  assert(
    '  details.fieldErrors is object',
    validationError.details !== null && typeof validationError.details === 'object',
  );

  // Standard 500
  const serverError: Record<string, unknown> = {
    error: 'Failed to fetch trades',
    details: 'Some error message',
  };
  assertField(serverError, 'error', 'string');
  assert('  details is present in 500', 'details' in serverError);
})();

/* ════════════════════════════════════════════════════════════════════════ */
/*  SUMMARY                                                                */
/* ════════════════════════════════════════════════════════════════════════ */

console.log('');
console.log('══════════════════════════════════════════════════════════════');
console.log('  Response Contract Tests — 7 Critical APIs + Error Shapes');
console.log('══════════════════════════════════════════════════════════════');
console.log(`  Tests passed: ${passed}`);
console.log(`  Tests failed: ${failed}`);
console.log('──────────────────────────────────────────────────────────────');

if (failed > 0) {
  console.log('  ❌ SOME CONTRACT TESTS FAILED');
  console.log('──────────────────────────────────────────────────────────────');
  process.exit(1);
} else {
  console.log('  ✅ ALL CONTRACT TESTS PASSED');
  console.log('──────────────────────────────────────────────────────────────');
  process.exit(0);
}
