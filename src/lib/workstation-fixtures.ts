/**
 * Workstation fixture data system.
 *
 * Provides deterministic, realistic trading scenarios for the greenfield
 * /workspace workstation while live API integration is deferred to S06.
 * Every fixture matches the exact response shape of the API route it stands
 * in for, so the S06 swap from fixtures to live fetches requires no
 * component changes:
 *
 *   dashboard    → GET /api/dashboard      (DashboardResponse, src/app/(legacy)/page.tsx)
 *   dashboardV2  → GET /api/dashboard/v2   (DashboardV2Response, src/lib/accounting/dashboard-v2.ts)
 *   watchlist    → GET /api/watchlist      (watchlist_items row, src/db/schema.ts)
 *
 * Scenario coverage:
 *   default         — active account, 3 open positions, healthy integrity
 *   zero-positions  — flat account, no open trades, all valuation counts 0
 *   large-drawdown  — ~18% drawdown, critical integrity, stressed KPIs
 *   many-watchlist  — 28 watchlist items across all statuses (density test)
 *
 * Determinism: all generated series use a seeded PRNG (mulberry32) so test
 * assertions and browser screenshots are reproducible.
 *
 * @module workstation-fixtures
 */

import type { KpiMetrics, MtmData } from '@/components/dashboard/kpi-widgets';
import type {
  EquityDataPoint,
  DrawdownDataPoint,
  TradeMarkerPoint,
} from '@/lib/equity';
import type {
  MonthlyPerformanceItem,
  RDistributionBin,
  DirectionalPerformanceResult,
  ProcessScoreBin,
} from '@/lib/dashboard';
import type { CalendarHeatmapYearData } from '@/lib/calendar-heatmap';
import type { PeriodMatrixResult } from '@/lib/period-matrix';
import type { SetupPerfResult } from '@/lib/review-dashboard';
import type { AttentionInsight } from '@/lib/attention-insights';
import type { DashboardV2Response } from '@/lib/accounting/dashboard-v2';

// ═══════════════════════════════════════════════════════════════════════════
// Response Shapes (mirrors of the API route contracts)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Shape returned by GET /api/dashboard. Mirrors the `DashboardResponse`
 * interface consumed by the legacy dashboard at src/app/(legacy)/page.tsx.
 * Kept here (composed from the exported sub-types) because the legacy page
 * does not export its interface.
 */
export interface DashboardResponse {
  kpis: KpiMetrics;
  mtm: MtmData;
  equityCurve: EquityDataPoint[];
  drawdown: DrawdownDataPoint[];
  monthlyPerformance: MonthlyPerformanceItem[];
  rDistribution: RDistributionBin[];
  directionalPerformance?: DirectionalPerformanceResult;
  processScoreDistribution?: ProcessScoreBin[];
  tradeMarkers?: TradeMarkerPoint[];
  calendarHeatmap: CalendarHeatmapYearData[];
  periodMatrix: Record<string, PeriodMatrixResult>;
  setupRanking: SetupPerfResult[];
  attentionInsights: { insights: AttentionInsight[]; tradeCount: number };
}

/**
 * Shape of one row returned by GET /api/watchlist. Mirrors the
 * `watchlist_items` table select in src/db/schema.ts (text columns are
 * nullable; alertConfig is a JSON-serialized string or null).
 */
export interface WorkstationWatchlistItem {
  id: string;
  dateAdded: string | null;
  symbol: string;
  sectorId: string | null;
  name: string | null;
  sector: string | null;
  industry: string | null;
  setupId: string | null;
  direction: 'long' | 'short';
  thesis: string | null;
  marketContext: string | null;
  keyLevel: number | null;
  triggerPrice: number | null;
  plannedStop: number | null;
  targetPrice: number | null;
  status: 'pending' | 'watching' | 'triggered' | 'skipped' | 'expired';
  notes: string | null;
  promotedTradeId: string | null;
  alertConfig: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export const WORKSTATION_WATCHLIST_STATUSES = [
  'pending',
  'watching',
  'triggered',
  'skipped',
  'expired',
] as const;

/** Snapshot of a major market index at the current minute. */
export interface MarketIndexSnapshot {
  symbol: string;
  lastPrice: number;
  change: number;
  changePct: number;
}

/** Per-symbol price data for enhanced watchlist rendering.
 *  gap / gapPct: difference between lastPrice and previousClose.
 *  distanceToTrigger / distanceToTriggerPct: how far lastPrice is from triggerPrice,
 *  expressed as absolute percentages so components can apply proximity CSS classes
 *  (ws-approaching < 2%, ws-urgent < 0.5%) without recomputing.
 */
export interface SymbolPriceData {
  symbol: string;
  lastPrice: number;
  previousClose: number;
  gap: number;
  gapPct: number;
  triggerPrice: number | null;
  distanceToTrigger: number | null;
  distanceToTriggerPct: number | null;
}

/** Known market indices rendered by the MarketStrip component. */
export const MARKET_INDEX_SYMBOLS = ['SPX', 'NDX', 'RUT', 'VIX'] as const;

/**
 * A single open position enriched with risk-deck data for the
 * PositionsPanel 7-column terminal-dense table.
 */
export interface WorkstationPosition {
  instrumentId: string;
  symbol: string;
  direction: string | null;
  quantity: string;
  averageCost: string;
  markStatus: string;
  markPrice: string | null;
  markedValue: string | null;
  unrealizedPnl: string | null;
  markTimestamp: string | null;
  markAgeMinutes: number | null;
  /** Initial risk amount (1R) for this position in account currency. */
  initialRiskAmount: string | null;
  /** R-multiple: unrealizedPnl / initialRiskAmount, formatted to 2 decimal places.
   *  Null when either operand is null or initialRiskAmount <= 0. */
  rMultiple: string | null;
}

/**
 * Risk-deck data consumed by the RiskPanel with PTD and current-state
 * visual sections.
 */
export interface WorkstationRisk {
  /** Period-to-Date (PTD) metrics. */
  ptd: {
    realizedPnl: string;
    realizedFees: string;
    drawdown: string | null;
    drawdownPct: string | null;
  };
  /** Current-state metrics. */
  current: {
    openPnl: string;
    openRisk: string;
    portfolioHeat: string | null;
    missingStops: number;
    positionsWithStop: number;
    /** Gross exposure as a canonical decimal string. */
    exposure: string;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Scenarios
// ═══════════════════════════════════════════════════════════════════════════

export const WORKSTATION_SCENARIO_IDS = [
  'default',
  'zero-positions',
  'large-drawdown',
  'many-watchlist',
] as const;

export type WorkstationScenarioId = (typeof WORKSTATION_SCENARIO_IDS)[number];

export function isWorkstationScenarioId(value: string): value is WorkstationScenarioId {
  return (WORKSTATION_SCENARIO_IDS as readonly string[]).includes(value);
}

/** The complete fixture payload for one scenario, keyed by API surface. */
export interface WorkstationFixtures {
  scenario: WorkstationScenarioId;
  account: { id: string; name: string; currency: string };
  dashboard: DashboardResponse;
  dashboardV2: DashboardV2Response;
  watchlist: WorkstationWatchlistItem[];
  /** Market index snapshots (SPX, NDX, RUT, VIX) for the MarketStrip. */
  marketIndices: MarketIndexSnapshot[];
  /** Per-symbol price data keyed by symbol for the WatchlistPanel. */
  symbolPrices: Record<string, SymbolPriceData>;
  /** Open positions enriched with risk-deck data for the PositionsPanel. */
  positions: WorkstationPosition[];
  /** Risk-deck data for the RiskPanel (PTD + current-state sections). */
  risk: WorkstationRisk;
}

/**
 * Emit the runtime fixture-mode signal required by the slice verification
 * contract (console.warn on fixture data load). Browser-safe: no-ops when
 * console is unavailable.
 */
export function warnFixtureMode(scenario: WorkstationScenarioId): void {
  if (typeof console !== 'undefined' && typeof console.warn === 'function') {
    console.warn(
      `[workstation] FIXTURE MODE — scenario "${scenario}". ` +
        'Panels render synthetic data; live API integration lands in S06.',
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Deterministic generation helpers
// ═══════════════════════════════════════════════════════════════════════════

/** mulberry32 — small seeded PRNG for reproducible fixture series. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Compute R-multiple from unrealized P&L and initial risk amount.
 * Returns null when either value is null, non-finite, or when
 * initialRiskAmount <= 0 (the guard from the trade-calc R-multiple contract).
 */
function computeRMultiple(
  unrealizedPnl: string | null,
  initialRiskAmount: string | null,
): string | null {
  if (unrealizedPnl === null || initialRiskAmount === null) return null;
  const pnl = parseFloat(unrealizedPnl);
  const risk = parseFloat(initialRiskAmount);
  if (!isFinite(pnl) || !isFinite(risk) || risk <= 0) return null;
  return (pnl / risk).toFixed(2);
}

/** Format a Date as YYYY-MM-DD (UTC). */
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Enumerate weekdays (Mon–Fri) from startDate for `count` trading days. */
function tradingDays(startDate: string, count: number): string[] {
  const days: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00Z`);
  while (days.length < count) {
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) days.push(isoDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

interface EquityWalkOptions {
  startDate: string;
  tradingDayCount: number;
  startingEquity: number;
  /** Average daily P&L drift in currency units. */
  dailyDrift: number;
  /** Daily P&L volatility in currency units. */
  dailyVolatility: number;
  seed: number;
}

/** Build a coherent equityCurve + drawdown pair from one simulated P&L walk. */
function buildEquityWalk(opts: EquityWalkOptions): {
  equityCurve: EquityDataPoint[];
  drawdown: DrawdownDataPoint[];
  dailyPnl: { date: string; pnl: number }[];
} {
  const rand = mulberry32(opts.seed);
  const days = tradingDays(opts.startDate, opts.tradingDayCount);
  const equityCurve: EquityDataPoint[] = [];
  const drawdown: DrawdownDataPoint[] = [];
  const dailyPnl: { date: string; pnl: number }[] = [];

  let equity = opts.startingEquity;
  let highWaterMark = equity;
  let cumulativePnl = 0;

  for (const date of days) {
    // Box–Muller-ish normal sample from two uniform draws.
    const u1 = Math.max(rand(), 1e-9);
    const u2 = rand();
    const normal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const pnl = round2(opts.dailyDrift + normal * opts.dailyVolatility);

    equity = round2(equity + pnl);
    cumulativePnl = round2(cumulativePnl + pnl);
    highWaterMark = Math.max(highWaterMark, equity);
    const drawdownAmount = round2(equity - highWaterMark);
    const drawdownPct = highWaterMark > 0 ? round2((drawdownAmount / highWaterMark) * 1000) / 1000 : 0;

    equityCurve.push({ date, equity, cumulativePnl, highWaterMark });
    drawdown.push({ date, drawdownAmount, drawdownPct: round2(drawdownPct * 1000) / 1000 });
    dailyPnl.push({ date, pnl });
  }

  return { equityCurve, drawdown, dailyPnl };
}

// ═══════════════════════════════════════════════════════════════════════════
// Shared fixture building blocks
// ═══════════════════════════════════════════════════════════════════════════

const FIXTURE_ACCOUNT = {
  id: 'f1xtur3-0000-4000-8000-000000000001',
  name: 'Primary Margin',
  currency: 'USD',
};

const SETUPS: { id: string; name: string }[] = [
  { id: 'setup-breakout', name: 'Opening Range Breakout' },
  { id: 'setup-pullback', name: 'Trend Pullback' },
  { id: 'setup-reversal', name: 'Exhaustion Reversal' },
  { id: 'setup-gap', name: 'Gap Continuation' },
];

const WATCHLIST_SYMBOLS: { symbol: string; name: string; sector: string; industry: string }[] = [
  { symbol: 'AAPL', name: 'Apple Inc.', sector: 'Technology', industry: 'Consumer Electronics' },
  { symbol: 'NVDA', name: 'NVIDIA Corporation', sector: 'Technology', industry: 'Semiconductors' },
  { symbol: 'MSFT', name: 'Microsoft Corporation', sector: 'Technology', industry: 'Software—Infrastructure' },
  { symbol: 'AMD', name: 'Advanced Micro Devices', sector: 'Technology', industry: 'Semiconductors' },
  { symbol: 'TSLA', name: 'Tesla, Inc.', sector: 'Consumer Cyclical', industry: 'Auto Manufacturers' },
  { symbol: 'META', name: 'Meta Platforms, Inc.', sector: 'Communication Services', industry: 'Internet Content & Information' },
  { symbol: 'AMZN', name: 'Amazon.com, Inc.', sector: 'Consumer Cyclical', industry: 'Internet Retail' },
  { symbol: 'AVGO', name: 'Broadcom Inc.', sector: 'Technology', industry: 'Semiconductors' },
  { symbol: 'SMCI', name: 'Super Micro Computer', sector: 'Technology', industry: 'Computer Hardware' },
  { symbol: 'PLTR', name: 'Palantir Technologies', sector: 'Technology', industry: 'Software—Infrastructure' },
  { symbol: 'COIN', name: 'Coinbase Global', sector: 'Financial Services', industry: 'Financial Data & Exchanges' },
  { symbol: 'MARA', name: 'MARA Holdings', sector: 'Financial Services', industry: 'Capital Markets' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', sector: 'Communication Services', industry: 'Internet Content & Information' },
  { symbol: 'NFLX', name: 'Netflix, Inc.', sector: 'Communication Services', industry: 'Entertainment' },
  { symbol: 'CRWD', name: 'CrowdStrike Holdings', sector: 'Technology', industry: 'Software—Infrastructure' },
  { symbol: 'ARM', name: 'Arm Holdings', sector: 'Technology', industry: 'Semiconductors' },
  { symbol: 'MU', name: 'Micron Technology', sector: 'Technology', industry: 'Semiconductors' },
  { symbol: 'SOFI', name: 'SoFi Technologies', sector: 'Financial Services', industry: 'Credit Services' },
  { symbol: 'HOOD', name: 'Robinhood Markets', sector: 'Financial Services', industry: 'Capital Markets' },
  { symbol: 'UBER', name: 'Uber Technologies', sector: 'Technology', industry: 'Software—Application' },
  { symbol: 'SHOP', name: 'Shopify Inc.', sector: 'Technology', industry: 'Software—Application' },
  { symbol: 'SQ', name: 'Block, Inc.', sector: 'Technology', industry: 'Software—Infrastructure' },
  { symbol: 'DKNG', name: 'DraftKings Inc.', sector: 'Consumer Cyclical', industry: 'Gambling' },
  { symbol: 'RBLX', name: 'Roblox Corporation', sector: 'Communication Services', industry: 'Electronic Gaming' },
  { symbol: 'SNOW', name: 'Snowflake Inc.', sector: 'Technology', industry: 'Software—Application' },
  { symbol: 'DDOG', name: 'Datadog, Inc.', sector: 'Technology', industry: 'Software—Application' },
  { symbol: 'NET', name: 'Cloudflare, Inc.', sector: 'Technology', industry: 'Software—Infrastructure' },
  { symbol: 'IONQ', name: 'IonQ, Inc.', sector: 'Technology', industry: 'Computer Hardware' },
];

function buildWatchlistItems(count: number): WorkstationWatchlistItem[] {
  const rand = mulberry32(20260720);
  const statuses = WORKSTATION_WATCHLIST_STATUSES;
  const items: WorkstationWatchlistItem[] = [];

  for (let i = 0; i < count; i++) {
    const meta = WATCHLIST_SYMBOLS[i % WATCHLIST_SYMBOLS.length];
    const basePrice = round2(20 + rand() * 480);
    const keyLevel = round2(basePrice * (0.95 + rand() * 0.1));
    const status = statuses[i % statuses.length];
    const direction: 'long' | 'short' = rand() > 0.25 ? 'long' : 'short';
    const added = new Date(Date.UTC(2026, 5, 1 + (i % 28), 14, 30));

    items.push({
      id: `wl-fixture-${String(i + 1).padStart(3, '0')}`,
      dateAdded: added.toISOString(),
      symbol: meta.symbol,
      sectorId: null,
      name: meta.name,
      sector: meta.sector,
      industry: meta.industry,
      setupId: rand() > 0.3 ? SETUPS[i % SETUPS.length].id : null,
      direction,
      thesis:
        status === 'pending' || status === 'watching'
          ? `${direction === 'long' ? 'Breakout' : 'Breakdown'} over ${keyLevel} with volume confirmation.`
          : null,
      marketContext: rand() > 0.5 ? 'NQ leading; sector rotation into semis.' : null,
      keyLevel,
      triggerPrice: status === 'triggered' || status === 'watching' ? round2(keyLevel * 1.005) : null,
      plannedStop: direction === 'long' ? round2(keyLevel * 0.97) : round2(keyLevel * 1.03),
      targetPrice: direction === 'long' ? round2(keyLevel * 1.08) : round2(keyLevel * 0.92),
      status,
      notes: status === 'skipped' ? 'Skipped — spread too wide at trigger.' : null,
      promotedTradeId: status === 'triggered' && rand() > 0.5 ? `trade-fixture-${i}` : null,
      alertConfig:
        status === 'watching'
          ? JSON.stringify({ condition: direction === 'long' ? 'above' : 'below', price: keyLevel })
          : null,
      createdAt: added.toISOString(),
      updatedAt: added.toISOString(),
    });
  }

  return items;
}

/**
 * Generate deterministic market index snapshots (SPX, NDX, RUT, VIX).
 * Each scenario gets its own seed so market conditions match scenario mood
 * (bullish for default, flat for zero-positions, bearish for large-drawdown).
 */
function buildMarketIndices(scenario: WorkstationScenarioId): MarketIndexSnapshot[] {
  const SEEDS: Record<WorkstationScenarioId, number> = {
    default: 100,
    'zero-positions': 200,
    'large-drawdown': 300,
    'many-watchlist': 400,
  };
  const rand = mulberry32(SEEDS[scenario]);

  // Base prices: [SPX, NDX, RUT, VIX]
  const bases: { symbol: string; basePrice: number; tickSize: number; volatilityPct: number }[] = [
    { symbol: 'SPX', basePrice: 5700, tickSize: 0.1, volatilityPct: 0.012 },
    { symbol: 'NDX', basePrice: 20000, tickSize: 0.25, volatilityPct: 0.015 },
    { symbol: 'RUT', basePrice: 2100, tickSize: 0.01, volatilityPct: 0.018 },
    { symbol: 'VIX', basePrice: 16, tickSize: 0.01, volatilityPct: 0.08 },
  ];

  // Scenario-specific drift multipliers
  const driftMultipliers: Record<WorkstationScenarioId, number> = {
    default: 0.3,
    'zero-positions': 0.0,
    'large-drawdown': -0.8,
    'many-watchlist': 0.25,
  };
  const driftMul = driftMultipliers[scenario];

  return bases.map(({ symbol, basePrice, volatilityPct }) => {
    const u1 = Math.max(rand(), 1e-9);
    const u2 = rand();
    const normal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const changePct = round2(normal * volatilityPct * 100 + driftMul * 0.3);
    const change = round2(basePrice * (changePct / 100));
    const lastPrice = round2(basePrice + change);

    return { symbol, lastPrice, change, changePct };
  });
}

/**
 * Generate deterministic per-symbol price data from a watchlist.
 * Derives lastPrice around each item's keyLevel (or a random base if null),
 * computes a believable previousClose, and computes gap + distance-to-trigger.
 *
 * The distanceToTriggerPct is stored as an absolute percentage so the
 * WatchlistPanel can apply `ws-approaching` (< 2%) and `ws-urgent` (< 0.5%)
 * CSS classes without recalculating.
 */
function buildSymbolPrices(
  watchlist: WorkstationWatchlistItem[],
  scenario: WorkstationScenarioId,
): Record<string, SymbolPriceData> {
  const SEEDS: Record<WorkstationScenarioId, number> = {
    default: 500,
    'zero-positions': 600,
    'large-drawdown': 700,
    'many-watchlist': 800,
  };
  const rand = mulberry32(SEEDS[scenario]);

  const result: Record<string, SymbolPriceData> = {};

  for (const item of watchlist) {
    // Anchor around keyLevel (or a fallback range if missing)
    const anchor = item.keyLevel ?? round2(50 + rand() * 200);
    // Small random jitter: ±2% around anchor to simulate intraday movement
    const jitter = round2(anchor * (rand() - 0.5) * 0.04);
    const lastPrice = round2(anchor + jitter);

    // Previous close: offset from last price by -1.5% to +1.5%
    const prevCloseJitter = round2(anchor * (rand() - 0.5) * 0.03);
    const previousClose = round2(anchor + prevCloseJitter);

    const gap = round2(lastPrice - previousClose);
    const gapPct = previousClose !== 0
      ? round2((gap / previousClose) * 100)
      : 0;

    const triggerPrice = item.triggerPrice;
    const distanceToTrigger = triggerPrice !== null
      ? round2(lastPrice - triggerPrice)
      : null;
    const distanceToTriggerPct = triggerPrice !== null && triggerPrice !== 0
      ? round2(Math.abs((distanceToTrigger! / triggerPrice) * 100))
      : null;

    result[item.symbol] = {
      symbol: item.symbol,
      lastPrice,
      previousClose,
      gap,
      gapPct,
      triggerPrice,
      distanceToTrigger,
      distanceToTriggerPct,
    };
  }

  return result;
}

function buildTradeMarkers(
  dailyPnl: { date: string; pnl: number }[],
  equityCurve: EquityDataPoint[],
): TradeMarkerPoint[] {
  const symbols = ['NVDA', 'AAPL', 'TSLA', 'AMD', 'MSFT', 'META'];
  // Mark the 8 largest-|pnl| days as exits with a matching entry marker.
  const ranked = [...dailyPnl].sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl)).slice(0, 8);
  const markers: TradeMarkerPoint[] = [];
  ranked.forEach((day, i) => {
    const point = equityCurve.find((p) => p.date === day.date);
    if (!point) return;
    const symbol = symbols[i % symbols.length];
    const direction: 'long' | 'short' = i % 4 === 3 ? 'short' : 'long';
    markers.push({
      date: day.date,
      equity: point.equity,
      tradeId: `trade-fixture-${i}`,
      symbol,
      direction,
      markerType: 'exit',
      price: round2(100 + i * 17.5),
      pnl: day.pnl,
    });
  });
  return markers.sort((a, b) => a.date.localeCompare(b.date));
}

function buildCalendarHeatmap(dailyPnl: { date: string; pnl: number }[]): CalendarHeatmapYearData[] {
  const byYear = new Map<number, { date: string; pnl: number }[]>();
  for (const day of dailyPnl) {
    const year = Number(day.date.slice(0, 4));
    const list = byYear.get(year) ?? [];
    list.push({ date: day.date, pnl: day.pnl });
    byYear.set(year, list);
  }
  return [...byYear.entries()].map(([year, days]) => ({ year, days }));
}

const R_DISTRIBUTION: RDistributionBin[] = [
  { label: '< -3', count: 0 },
  { label: '-3 to -2', count: 1 },
  { label: '-2 to -1', count: 9 },
  { label: '-1 to 0', count: 21 },
  { label: '0 to 1', count: 18 },
  { label: '1 to 2', count: 19 },
  { label: '2 to 3', count: 11 },
  { label: '> 3', count: 5 },
];

const PROCESS_SCORE_DISTRIBUTION: ProcessScoreBin[] = [
  { label: 'A (54-60)', count: 26, minScore: 54 },
  { label: 'B (48-53)', count: 31, minScore: 48 },
  { label: 'C (42-47)', count: 19, minScore: 42 },
  { label: 'D (36-41)', count: 8, minScore: 36 },
  { label: 'F (0-35)', count: 3, minScore: 0 },
];

const SETUP_RANKING: SetupPerfResult[] = [
  { setupName: 'Opening Range Breakout', setupId: 'setup-breakout', count: 34, winRate: 0.6176, avgR: 0.58, avgProcessScore: 51.2, sampleSizeWarning: 'adequate' },
  { setupName: 'Trend Pullback', setupId: 'setup-pullback', count: 27, winRate: 0.5926, avgR: 0.41, avgProcessScore: 49.8, sampleSizeWarning: 'moderate' },
  { setupName: 'Exhaustion Reversal', setupId: 'setup-reversal', count: 15, winRate: 0.4667, avgR: 0.12, avgProcessScore: 44.6, sampleSizeWarning: 'small' },
  { setupName: 'Gap Continuation', setupId: 'setup-gap', count: 8, winRate: 0.5, avgR: -0.08, avgProcessScore: 42.1, sampleSizeWarning: 'very_small' },
];

const DIRECTIONAL_PERFORMANCE: DirectionalPerformanceResult = {
  long: { netPnl: 10984.2, winRate: 0.6047, tradeCount: 71 },
  short: { netPnl: 1454.35, winRate: 0.4615, tradeCount: 13 },
};

function buildPeriodMatrix(dailyPnl: { date: string; pnl: number }[]): Record<string, PeriodMatrixResult> {
  // Derive the last two ISO weeks from the walk so the matrix agrees with
  // the equity curve fixture.
  const last = dailyPnl.slice(-10);
  const prevWeek = last.slice(0, 5);
  const currWeek = last.slice(5, 10);
  const sum = (rows: { pnl: number }[]) => round2(rows.reduce((acc, r) => acc + r.pnl, 0));

  const mkMetrics = (periodId: string, label: string, rows: { date: string; pnl: number }[], winRate: number, avgR: number) => ({
    periodId,
    periodLabel: label,
    startDate: rows[0]?.date ?? '',
    endDate: rows[rows.length - 1]?.date ?? '',
    winRate,
    pnl: sum(rows),
    tradeCount: rows.length * 2,
    avgR,
  });

  const curr = mkMetrics('2026-W29', 'Week 29', currWeek, 0.6, 0.45);
  const prev = mkMetrics('2026-W28', 'Week 28', prevWeek, 0.5, 0.3);

  const wow: PeriodMatrixResult = {
    comparisonType: 'wow',
    rows: [
      {
        current: curr,
        previous: prev,
        delta: {
          winRate: round2((curr.winRate ?? 0) - (prev.winRate ?? 0)),
          pnl: round2(curr.pnl - prev.pnl),
          tradeCount: curr.tradeCount - prev.tradeCount,
          avgR: round2((curr.avgR ?? 0) - (prev.avgR ?? 0)),
        },
      },
    ],
  };

  const mom: PeriodMatrixResult = {
    comparisonType: 'mom',
    rows: [
      {
        current: {
          periodId: '2026-06',
          periodLabel: 'June 2026',
          startDate: '2026-06-01',
          endDate: '2026-06-30',
          winRate: 0.5862,
          pnl: 3842.1,
          tradeCount: 29,
          avgR: 0.42,
        },
        previous: {
          periodId: '2026-05',
          periodLabel: 'May 2026',
          startDate: '2026-05-01',
          endDate: '2026-05-31',
          winRate: 0.55,
          pnl: 2910.45,
          tradeCount: 20,
          avgR: 0.35,
        },
        delta: { winRate: 0.0362, pnl: 931.65, tradeCount: 9, avgR: 0.07 },
      },
    ],
  };

  const qoq: PeriodMatrixResult = {
    comparisonType: 'qoq',
    rows: [
      {
        current: {
          periodId: '2026-Q2',
          periodLabel: 'Q2 2026',
          startDate: '2026-04-01',
          endDate: '2026-06-30',
          winRate: 0.5862,
          pnl: 12438.55,
          tradeCount: 87,
          avgR: 0.42,
        },
        previous: {
          periodId: '2026-Q1',
          periodLabel: 'Q1 2026',
          startDate: '2026-01-01',
          endDate: '2026-03-31',
          winRate: 0.5122,
          pnl: 8210.3,
          tradeCount: 82,
          avgR: 0.28,
        },
        delta: { winRate: 0.074, pnl: 4228.25, tradeCount: 5, avgR: 0.14 },
      },
    ],
  };

  return { wow, mom, qoq };
}

function buildDashboardV2(opts: {
  cash: string;
  nav: string;
  markedPositions: string;
  realizedPnl: string;
  unrealizedPnl: string;
  totalPnl: string;
  drawdown: string | null;
  drawdownPct: string | null;
  positions: DashboardV2Response['valuation']['positions'];
  riskSummary: DashboardV2Response['riskSummary'];
  integrity: DashboardV2Response['integrity'];
}): DashboardV2Response {
  return {
    account: { ...FIXTURE_ACCOUNT },
    metrics: {
      cash: opts.cash,
      nav: opts.nav,
      markedPositions: opts.markedPositions,
      realizedPnl: opts.realizedPnl,
      unrealizedPnl: opts.unrealizedPnl,
      totalPnl: opts.totalPnl,
      realizedFees: '512.30',
      grossExposure: opts.markedPositions,
      netExposure: opts.markedPositions,
      drawdown: opts.drawdown,
      drawdownPct: opts.drawdownPct,
      modifiedDietzReturn: '0.0524',
      twr: '0.0518',
    },
    valuation: {
      positionsTotal: opts.positions.length,
      fresh: opts.positions.filter((p) => p.markStatus === 'fresh').length,
      stale: opts.positions.filter((p) => p.markStatus === 'stale').length,
      missing: opts.positions.filter((p) => p.markStatus === 'missing').length,
      positions: opts.positions,
    },
    journalAttribution: {
      hasJournalTrades: opts.positions.length > 0,
      journalExecutionCount: 214,
      accountOnlyExecutionCount: 3,
    },
    reconciliation: {
      eligible: true,
      refusalReasons: [],
      comparisons: null,
      totals: null,
    },
    riskSummary: opts.riskSummary,
    integrity: opts.integrity,
    computedAt: '2026-07-17T20:15:00.000Z',
  };
}

const DEFAULT_POSITIONS: DashboardV2Response['valuation']['positions'] = [
  {
    instrumentId: 'inst-nvda',
    symbol: 'NVDA',
    direction: 'long',
    quantity: '120',
    averageCost: '128.40',
    markStatus: 'fresh',
    markPrice: '131.85',
    markedValue: '15822.00',
    unrealizedPnl: '414.00',
    markTimestamp: '2026-07-17T19:58:00.000Z',
    markAgeMinutes: 17,
  },
  {
    instrumentId: 'inst-amd',
    symbol: 'AMD',
    direction: 'long',
    quantity: '80',
    averageCost: '112.10',
    markStatus: 'fresh',
    markPrice: '118.42',
    markedValue: '9473.60',
    unrealizedPnl: '505.60',
    markTimestamp: '2026-07-17T19:58:00.000Z',
    markAgeMinutes: 17,
  },
  {
    instrumentId: 'inst-tsla',
    symbol: 'TSLA',
    direction: 'short',
    quantity: '25',
    averageCost: '246.80',
    markStatus: 'stale',
    markPrice: '249.93',
    markedValue: '6248.25',
    unrealizedPnl: '-78.25',
    markTimestamp: '2026-07-16T20:00:00.000Z',
    markAgeMinutes: 1455,
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// Scenario builders
// ═══════════════════════════════════════════════════════════════════════════

function buildDefaultScenario(): WorkstationFixtures {
  const walk = buildEquityWalk({
    startDate: '2026-04-01',
    tradingDayCount: 60,
    startingEquity: 50000,
    dailyDrift: 210,
    dailyVolatility: 780,
    seed: 42,
  });
  const lastPoint = walk.equityCurve[walk.equityCurve.length - 1];
  const lastDrawdown = walk.drawdown[walk.drawdown.length - 1];

  const dashboard: DashboardResponse = {
    kpis: {
      totalTrades: 87,
      openTrades: 3,
      winRate: 0.5862,
      netPnl: lastPoint.cumulativePnl,
      avgR: 0.42,
      avgGrade: 48.3,
      currentDrawdown: lastDrawdown.drawdownAmount,
      currentDrawdownPct: lastDrawdown.drawdownPct,
      accountValue: lastPoint.equity,
      profitFactor: 1.62,
      avgWin: 486.2,
      avgLoss: -299.75,
    },
    mtm: {
      netUnrealizedPnl: 841.35,
      openTradeCount: 3,
      tradesWithPrices: 3,
      tradesAwaitingData: 0,
    },
    equityCurve: walk.equityCurve,
    drawdown: walk.drawdown,
    monthlyPerformance: [
      { month: '2026-04', netPnl: 5686.0, winRate: 0.6316, tradeCount: 38 },
      { month: '2026-05', netPnl: 2910.45, winRate: 0.55, tradeCount: 20 },
      { month: '2026-06', netPnl: 3842.1, winRate: 0.5862, tradeCount: 29 },
    ],
    rDistribution: R_DISTRIBUTION,
    directionalPerformance: DIRECTIONAL_PERFORMANCE,
    processScoreDistribution: PROCESS_SCORE_DISTRIBUTION,
    tradeMarkers: buildTradeMarkers(walk.dailyPnl, walk.equityCurve),
    calendarHeatmap: buildCalendarHeatmap(walk.dailyPnl),
    periodMatrix: buildPeriodMatrix(walk.dailyPnl),
    setupRanking: SETUP_RANKING,
    attentionInsights: {
      insights: [
        {
          type: 'best_day',
          severity: 'info',
          title: 'Tuesday is your best trading day',
          message: 'You average +$312 on Tuesdays across 14 trades (71% win rate).',
          value: 312,
        },
        {
          type: 'oversizing',
          severity: 'warning',
          title: 'Position size creep on losing streaks',
          message: 'Average size increases 34% after two consecutive losses.',
        },
      ],
      tradeCount: 84,
    },
  };

  const dashboardV2 = buildDashboardV2({
    cash: '24150.75',
    nav: String(lastPoint.equity.toFixed(2)),
    markedPositions: '31543.85',
    realizedPnl: '11596.40',
    unrealizedPnl: '841.35',
    totalPnl: '12437.75',
    drawdown: String(lastDrawdown.drawdownAmount.toFixed(2)),
    drawdownPct: String((lastDrawdown.drawdownPct * 100).toFixed(2)),
    positions: DEFAULT_POSITIONS,
    riskSummary: {
      openPnl: '841.35',
      openRisk: '1450.00',
      portfolioHeat: '2.80',
      missingStops: 1,
      positionsWithStop: 2,
    },
    integrity: {
      status: 'warning',
      warnings: ['TSLA mark is stale (24h old) — refresh before relying on unrealized P&L.'],
    },
  });

  const watchlist = buildWatchlistItems(12);

  const positions: WorkstationPosition[] = [
    {
      instrumentId: 'inst-nvda',
      symbol: 'NVDA',
      direction: 'long',
      quantity: '120',
      averageCost: '128.40',
      markStatus: 'fresh',
      markPrice: '131.85',
      markedValue: '15822.00',
      unrealizedPnl: '414.00',
      markTimestamp: '2026-07-17T19:58:00.000Z',
      markAgeMinutes: 17,
      initialRiskAmount: '300.00',
      rMultiple: computeRMultiple('414.00', '300.00'),
    },
    {
      instrumentId: 'inst-amd',
      symbol: 'AMD',
      direction: 'long',
      quantity: '80',
      averageCost: '112.10',
      markStatus: 'fresh',
      markPrice: '118.42',
      markedValue: '9473.60',
      unrealizedPnl: '505.60',
      markTimestamp: '2026-07-17T19:58:00.000Z',
      markAgeMinutes: 17,
      initialRiskAmount: '250.00',
      rMultiple: computeRMultiple('505.60', '250.00'),
    },
    {
      instrumentId: 'inst-tsla',
      symbol: 'TSLA',
      direction: 'short',
      quantity: '25',
      averageCost: '246.80',
      markStatus: 'stale',
      markPrice: '249.93',
      markedValue: '6248.25',
      unrealizedPnl: '-78.25',
      markTimestamp: '2026-07-16T20:00:00.000Z',
      markAgeMinutes: 1455,
      initialRiskAmount: '200.00',
      rMultiple: computeRMultiple('-78.25', '200.00'),
    },
  ];

  const risk: WorkstationRisk = {
    ptd: {
      realizedPnl: '11596.40',
      realizedFees: '512.30',
      drawdown: String(lastDrawdown.drawdownAmount.toFixed(2)),
      drawdownPct: String((lastDrawdown.drawdownPct * 100).toFixed(2)),
    },
    current: {
      openPnl: '841.35',
      openRisk: '1450.00',
      portfolioHeat: '2.80',
      missingStops: 1,
      positionsWithStop: 2,
      exposure: '31543.85',
    },
  };

  return {
    scenario: 'default',
    account: { ...FIXTURE_ACCOUNT },
    dashboard,
    dashboardV2,
    watchlist,
    marketIndices: buildMarketIndices('default'),
    symbolPrices: buildSymbolPrices(watchlist, 'default'),
    positions,
    risk,
  };
}

function buildZeroPositionsScenario(): WorkstationFixtures {
  const base = buildDefaultScenario();
  const dashboard: DashboardResponse = {
    ...base.dashboard,
    kpis: {
      ...base.dashboard.kpis,
      openTrades: 0,
      currentDrawdown: 0,
      currentDrawdownPct: 0,
    },
    mtm: {
      netUnrealizedPnl: 0,
      openTradeCount: 0,
      tradesWithPrices: 0,
      tradesAwaitingData: 0,
    },
    tradeMarkers: base.dashboard.tradeMarkers,
  };

  const dashboardV2 = buildDashboardV2({
    cash: '51842.30',
    nav: '51842.30',
    markedPositions: '0.00',
    realizedPnl: '12437.75',
    unrealizedPnl: '0.00',
    totalPnl: '12437.75',
    drawdown: '0.00',
    drawdownPct: '0.00',
    positions: [],
    riskSummary: {
      openPnl: '0.00',
      openRisk: '0.00',
      portfolioHeat: '0.00',
      missingStops: 0,
      positionsWithStop: 0,
    },
    integrity: { status: 'healthy', warnings: [] },
  });
  dashboardV2.journalAttribution = {
    hasJournalTrades: true,
    journalExecutionCount: 214,
    accountOnlyExecutionCount: 0,
  };

  const watchlist = buildWatchlistItems(4);

  return {
    ...base,
    scenario: 'zero-positions',
    dashboard,
    dashboardV2,
    watchlist,
    marketIndices: buildMarketIndices('zero-positions'),
    symbolPrices: buildSymbolPrices(watchlist, 'zero-positions'),
    positions: [],
    risk: {
      ptd: {
        realizedPnl: '12437.75',
        realizedFees: '512.30',
        drawdown: '0.00',
        drawdownPct: '0.00',
      },
      current: {
        openPnl: '0.00',
        openRisk: '0.00',
        portfolioHeat: '0.00',
        missingStops: 0,
        positionsWithStop: 0,
        exposure: '0.00',
      },
    },
  };
}

function buildLargeDrawdownScenario(): WorkstationFixtures {
  const walk = buildEquityWalk({
    startDate: '2026-04-01',
    tradingDayCount: 60,
    startingEquity: 50000,
    dailyDrift: -150,
    dailyVolatility: 1250,
    seed: 1337,
  });
  const lastPoint = walk.equityCurve[walk.equityCurve.length - 1];
  const worstDrawdown = walk.drawdown.reduce((worst, d) =>
    d.drawdownAmount < worst.drawdownAmount ? d : worst,
  );

  const dashboard: DashboardResponse = {
    kpis: {
      totalTrades: 92,
      openTrades: 2,
      winRate: 0.413,
      netPnl: lastPoint.cumulativePnl,
      avgR: -0.18,
      avgGrade: 41.7,
      currentDrawdown: worstDrawdown.drawdownAmount,
      currentDrawdownPct: worstDrawdown.drawdownPct,
      accountValue: lastPoint.equity,
      profitFactor: 0.84,
      avgWin: 398.1,
      avgLoss: -412.6,
    },
    mtm: {
      netUnrealizedPnl: -1234.8,
      openTradeCount: 2,
      tradesWithPrices: 1,
      tradesAwaitingData: 1,
    },
    equityCurve: walk.equityCurve,
    drawdown: walk.drawdown,
    monthlyPerformance: [
      { month: '2026-04', netPnl: -3210.5, winRate: 0.4211, tradeCount: 38 },
      { month: '2026-05', netPnl: -4480.2, winRate: 0.38, tradeCount: 25 },
      { month: '2026-06', netPnl: -1549.3, winRate: 0.4483, tradeCount: 29 },
    ],
    rDistribution: [
      { label: '< -3', count: 2 },
      { label: '-3 to -2', count: 7 },
      { label: '-2 to -1', count: 18 },
      { label: '-1 to 0', count: 26 },
      { label: '0 to 1', count: 17 },
      { label: '1 to 2', count: 13 },
      { label: '2 to 3', count: 6 },
      { label: '> 3', count: 3 },
    ],
    directionalPerformance: {
      long: { netPnl: -6810.4, winRate: 0.4058, tradeCount: 69 },
      short: { netPnl: -2429.6, winRate: 0.4348, tradeCount: 23 },
    },
    processScoreDistribution: [
      { label: 'A (54-60)', count: 9, minScore: 54 },
      { label: 'B (48-53)', count: 21, minScore: 48 },
      { label: 'C (42-47)', count: 30, minScore: 42 },
      { label: 'D (36-41)', count: 22, minScore: 36 },
      { label: 'F (0-35)', count: 10, minScore: 0 },
    ],
    tradeMarkers: buildTradeMarkers(walk.dailyPnl, walk.equityCurve),
    calendarHeatmap: buildCalendarHeatmap(walk.dailyPnl),
    periodMatrix: buildPeriodMatrix(walk.dailyPnl),
    setupRanking: [
      { setupName: 'Exhaustion Reversal', setupId: 'setup-reversal', count: 31, winRate: 0.3548, avgR: -0.42, avgProcessScore: 39.8, sampleSizeWarning: 'adequate' },
      { setupName: 'Gap Continuation', setupId: 'setup-gap', count: 24, winRate: 0.4167, avgR: -0.21, avgProcessScore: 42.3, sampleSizeWarning: 'moderate' },
      { setupName: 'Trend Pullback', setupId: 'setup-pullback', count: 22, winRate: 0.4545, avgR: -0.05, avgProcessScore: 44.9, sampleSizeWarning: 'moderate' },
      { setupName: 'Opening Range Breakout', setupId: 'setup-breakout', count: 15, winRate: 0.4667, avgR: 0.08, avgProcessScore: 46.1, sampleSizeWarning: 'small' },
    ],
    attentionInsights: {
      insights: [
        {
          type: 'drawdown',
          severity: 'critical',
          title: 'Drawdown exceeds 15%',
          message: 'Account is down 18.2% from the high-water mark. Consider reducing size.',
          value: worstDrawdown.drawdownPct,
        },
        {
          type: 'revenge_trading',
          severity: 'warning',
          title: 'Losses cluster in the final hour',
          message: '62% of losses this month occurred after 15:00 ET.',
        },
      ],
      tradeCount: 92,
    },
  };

  const dashboardV2 = buildDashboardV2({
    cash: '18210.40',
    nav: String(lastPoint.equity.toFixed(2)),
    markedPositions: '22549.60',
    realizedPnl: '-8005.20',
    unrealizedPnl: '-1234.80',
    totalPnl: '-9240.00',
    drawdown: String(worstDrawdown.drawdownAmount.toFixed(2)),
    drawdownPct: String((worstDrawdown.drawdownPct * 100).toFixed(2)),
    positions: DEFAULT_POSITIONS.slice(0, 2).map((p) => ({ ...p, markStatus: 'missing', markPrice: null, markedValue: null, unrealizedPnl: null, markTimestamp: null, markAgeMinutes: null })),
    riskSummary: {
      openPnl: '-1234.80',
      openRisk: '2100.00',
      portfolioHeat: '5.15',
      missingStops: 2,
      positionsWithStop: 0,
    },
    integrity: {
      status: 'critical',
      warnings: [
        '2 positions have no valuation mark — NAV is understated.',
        '2 open trades are missing planned stops.',
      ],
    },
  });

  const watchlist = buildWatchlistItems(8);

  const positions: WorkstationPosition[] = [
    {
      instrumentId: 'inst-nvda',
      symbol: 'NVDA',
      direction: 'long',
      quantity: '120',
      averageCost: '128.40',
      markStatus: 'missing',
      markPrice: null,
      markedValue: null,
      unrealizedPnl: null,
      markTimestamp: null,
      markAgeMinutes: null,
      initialRiskAmount: '350.00',
      rMultiple: computeRMultiple(null, '350.00'),
    },
    {
      instrumentId: 'inst-amd',
      symbol: 'AMD',
      direction: 'long',
      quantity: '80',
      averageCost: '112.10',
      markStatus: 'missing',
      markPrice: null,
      markedValue: null,
      unrealizedPnl: null,
      markTimestamp: null,
      markAgeMinutes: null,
      initialRiskAmount: '280.00',
      rMultiple: computeRMultiple(null, '280.00'),
    },
  ];

  return {
    scenario: 'large-drawdown',
    account: { ...FIXTURE_ACCOUNT },
    dashboard,
    dashboardV2,
    watchlist,
    marketIndices: buildMarketIndices('large-drawdown'),
    symbolPrices: buildSymbolPrices(watchlist, 'large-drawdown'),
    positions,
    risk: {
      ptd: {
        realizedPnl: '-8005.20',
        realizedFees: '512.30',
        drawdown: String(worstDrawdown.drawdownAmount.toFixed(2)),
        drawdownPct: String((worstDrawdown.drawdownPct * 100).toFixed(2)),
      },
      current: {
        openPnl: '-1234.80',
        openRisk: '2100.00',
        portfolioHeat: '5.15',
        missingStops: 2,
        positionsWithStop: 0,
        exposure: '22549.60',
      },
    },
  };
}

function buildManyWatchlistScenario(): WorkstationFixtures {
  const base = buildDefaultScenario();
  const watchlist = buildWatchlistItems(28);

  return {
    ...base,
    scenario: 'many-watchlist',
    watchlist,
    marketIndices: buildMarketIndices('many-watchlist'),
    symbolPrices: buildSymbolPrices(watchlist, 'many-watchlist'),
    positions: base.positions,
    risk: base.risk,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════

const SCENARIO_BUILDERS: Record<WorkstationScenarioId, () => WorkstationFixtures> = {
  default: buildDefaultScenario,
  'zero-positions': buildZeroPositionsScenario,
  'large-drawdown': buildLargeDrawdownScenario,
  'many-watchlist': buildManyWatchlistScenario,
};

/**
 * Return the complete fixture payload for a scenario. Each call builds fresh
 * objects (no shared mutable state) so callers may mutate freely.
 *
 * @throws {Error} when the scenario id is not a known WorkstationScenarioId.
 */
export function getWorkstationFixtures(scenario: WorkstationScenarioId = 'default'): WorkstationFixtures {
  const builder = SCENARIO_BUILDERS[scenario];
  if (!builder) {
    throw new Error(
      `Unknown workstation fixture scenario: "${scenario}". ` +
        `Expected one of: ${WORKSTATION_SCENARIO_IDS.join(', ')}.`,
    );
  }
  return builder();
}
