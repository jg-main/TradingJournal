/**
 * live-historical-contract.test.ts — M026-1bw68n/S02/T02 (+ M004 9D.1)
 *
 * Contract tests for the Live vs Historical scope separation documented in
 * the "Live vs Historical scope contract" subsection of
 * docs/design-system/workstation.md (Data ownership section). Proves the
 * invariants pinned by the separation rule:
 *
 *   1. The CURRENT adapter surface (src/lib/workstation-live-adapter.ts)
 *      exposes no period or date filter. Every CURRENT fetch function takes
 *      at most an accountId, an AbortSignal, the documented skipAccounts
 *      option (or a symbol list for the market-price lookup), and no query
 *      the CURRENT path builds carries a period/date parameter. The adapter's
 *      single date-aware entry point is the V1 dashboard fetch, which may
 *      accept an already-resolved plain YMD range and serialize it only as
 *      dateFrom/dateTo (M004 9D.1 §4/§5/§6).
 *   2. No import edge connects the live data path to the P&L scope
 *      preference: workstation-live-adapter.ts and workstation-context.tsx
 *      never import use-performance-pnl-scope; only performance-panel.tsx
 *      consumes the hook (per-panel scope selector, no global date context).
 *   3. Changing the persisted period-scope preference never alters the live
 *      snapshot payload: fetchAllLiveDashboardData returns identical data
 *      and issues identical requests for every PERFORMANCE_PNL_SCOPES value
 *      and for an unset preference. Period selection is presentation-only.
 *
 * Structural groups read the same sources the workstation-docs contract
 * reads (source parsing from disk, matching the repo's contract-test style);
 * the behavioral group drives the real fetchAllLiveDashboardData through a
 * mocked global fetch. The jsdom environment provides localStorage for the
 * preference writes. A scanner self-test proves each matcher rejects drift.
 *
 * Run: npx vitest run src/lib/__tests__/live-historical-contract.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import path from 'node:path';

import {
  fetchAllLiveDashboardData,
  type LiveDashboardData,
} from '@/lib/workstation-live-adapter';
import { PERFORMANCE_PNL_SCOPE_STORAGE_KEY } from '@/hooks/use-performance-pnl-scope';
import { PERFORMANCE_PNL_SCOPES } from '@/lib/performance-pnl-scope';
import type { DashboardResponse } from '@/lib/workstation-fixtures';
import type { DashboardV2Response } from '@/lib/accounting/dashboard-v2';

/* ── Source loading (structural contract groups) ───────────────────────── */

const ADAPTER_PATH = path.resolve(process.cwd(), 'src/lib/workstation-live-adapter.ts');
const CONTEXT_PATH = path.resolve(process.cwd(), 'src/components/workstation/workstation-context.tsx');
const COMPONENTS_DIR = path.resolve(process.cwd(), 'src/components/workstation');

function loadSource(filePath: string, label: string, minLength = 100): string {
  const src = fs.readFileSync(filePath, 'utf-8');
  expect(src.length, `${label} should not be empty`).toBeGreaterThan(minLength);
  return src;
}

const adapterSource = loadSource(ADAPTER_PATH, 'src/lib/workstation-live-adapter.ts', 1000);
const contextSource = loadSource(CONTEXT_PATH, 'workstation-context.tsx', 1000);
const panelSource = loadSource(path.join(COMPONENTS_DIR, 'performance-panel.tsx'), 'performance-panel.tsx');

/** Non-test workstation component files — the import-edge inventory. */
const workstationComponentFiles = fs
  .readdirSync(COMPONENTS_DIR)
  .filter((f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx'))
  .map((f) => path.join(COMPONENTS_DIR, f));

/* ── Period/date filter vocabulary ─────────────────────────────────────── */

/** Words that mean a date-window or period filter. CURRENT fetch functions
 *  must never take a parameter or build a query key from this vocabulary. */
const PERIOD_DATE_PARAM_WORDS = [
  'period', 'periods', 'range', 'daterange', 'datefrom', 'dateto',
  'fromdate', 'todate', 'startdate', 'enddate', 'since', 'lookback',
  'timeframe', 'from', 'to', 'start', 'end', 'window', 'bucket',
] as const;

/** Query keys that would mean a period/date filter on a request URL. */
const PERIOD_DATE_QUERY_KEYS = [
  'period', 'periods', 'date', 'daterange', 'datefrom', 'dateto',
  'fromdate', 'todate', 'startdate', 'enddate', 'since', 'from', 'to',
  'start', 'end', 'range', 'timeframe', 'lookback', 'bucket',
] as const;

/** Whole-word banned-vocabulary hits in a snippet (lowercased). */
function bannedVocabularyHits(text: string): string[] {
  const lower = text.toLowerCase();
  return (PERIOD_DATE_PARAM_WORDS as readonly string[]).filter((word) =>
    new RegExp(`\\b${word}\\b`).test(lower),
  );
}

/* ── Adapter signature extraction ──────────────────────────────────────── */

interface ExportedFunction {
  name: string;
  isAsync: boolean;
  params: string[];
}

const EXPORTED_FN_RE = /^export\s+(async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm;

/** Split a parameter-list string on top-level commas, tracking (), [], {},
 *  <> and string literals so generic types and object defaults stay intact. */
function splitTopLevelParams(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  let quote: string | null = null;
  for (const ch of text) {
    if (quote !== null) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      current += ch;
      continue;
    }
    if ('({[<'.includes(ch)) depth += 1;
    if (')}]>'.includes(ch)) depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim() !== '') parts.push(current);
  return parts;
}

/** Extract exported function names and top-level parameter segments. */
function extractExportedFunctions(source: string): ExportedFunction[] {
  const fns: ExportedFunction[] = [];
  for (const m of source.matchAll(EXPORTED_FN_RE)) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let close = -1;
    for (let i = open; i < source.length; i += 1) {
      const ch = source[i];
      if (ch === '(') depth += 1;
      else if (ch === ')') {
        depth -= 1;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    if (close < 0) throw new Error(`Unbalanced parameter list for ${m[2]}`);
    const paramsText = source.slice(open + 1, close);
    fns.push({ name: m[2], isAsync: Boolean(m[1]), params: splitTopLevelParams(paramsText) });
  }
  return fns;
}

/** Leading parameter names of one segment. Destructured segments yield the
 *  identifiers inside the braces (type annotations stripped). */
function leadingParamNames(segment: string): string[] {
  const s = segment.trim();
  if (s.startsWith('{')) {
    const open = s.indexOf('{');
    const close = s.lastIndexOf('}');
    const inner = s.slice(open + 1, close).replace(/:\s*[^,}]+/g, '');
    return [...inner.matchAll(/([A-Za-z_$][\w$]*)\s*(?=[?,]|$)/g)].map((m) => m[1]);
  }
  const base = s.replace(/^\.\.\./, '');
  const m = /^([A-Za-z_$][\w$]*)/.exec(base);
  return m ? [m[0]] : [];
}

const adapterFunctions = extractExportedFunctions(adapterSource);

/** The adapter's date-aware entry points (M004 9D.1 §5/§6/§7): the V1
 *  dashboard fetch and its compatibility composition wrapper.  Every other
 *  exported async fetch is a CURRENT-state acquisition. */
const DATE_AWARE_FETCH_FNS = new Set(['fetchDashboardLive', 'fetchAllLiveDashboardData']);

/** Export surface the doc contract pins: CURRENT fetch functions may take at
 *  most accountId, an AbortSignal, the documented skipAccounts option, or a
 *  symbol list (price lookup).  The date-aware V1 fetch and its composition
 *  wrapper may additionally take the already-resolved `range` argument. */
const ALLOWED_FETCH_PARAMS = ['accountId', 'signal', 'options', 'skipAccounts', 'symbols'] as const;
const ALLOWED_DATE_AWARE_FETCH_PARAMS = [...ALLOWED_FETCH_PARAMS, 'range'] as const;

/** Query keys the adapter builds via URLSearchParams({ ... }). */
function urlSearchParamKeys(source: string): string[] {
  const keys: string[] = [];
  for (const m of source.matchAll(/URLSearchParams\(\{([^}]*)\}\)/g)) {
    keys.push(...[...m[1].matchAll(/[A-Za-z_$][\w$]*/g)].map((x) => x[0]));
  }
  return keys;
}

/** Full source text of one exported function (signature through the matching
 *  closing brace). */
function exportedFunctionBody(source: string, name: string): string | undefined {
  const re = new RegExp(`^export\\s+(?:async\\s+)?function\\s+${name}\\s*\\(`, 'gm');
  const m = re.exec(source);
  if (!m) return undefined;
  const start = m.index;
  let i = start + m[0].length;
  let depth = 0;
  for (; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  while (i < source.length && source[i] !== '{') i += 1;
  let braceDepth = 0;
  for (let j = i; j < source.length; j += 1) {
    const ch = source[j];
    if (ch === '{') braceDepth += 1;
    else if (ch === '}') {
      braceDepth -= 1;
      if (braceDepth === 0) return source.slice(start, j + 1);
    }
  }
  return undefined;
}

/* ── Behavioral group: mocked fetch ────────────────────────────────────── */

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.stubGlobal('fetch', mockFetch);

function makeFakeResponse(status: number, body: unknown): Response {
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: new Headers({ 'Content-Type': 'application/json' }),
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
    text: async () => bodyStr,
    clone() {
      return this;
    },
  } as Response;
}

/** Realistic dashboard V1 response (same shape the adapter test uses). */
function makeDashboardResponse(): DashboardResponse {
  return {
    kpis: {
      totalTrades: 87,
      openTrades: 3,
      winRate: 0.5862,
      netPnl: 12437.75,
      avgR: 0.42,
      avgGrade: 48.3,
      currentDrawdown: -420.5,
      currentDrawdownPct: -0.0082,
      accountValue: 62380.5,
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
    equityCurve: [{ date: '2026-07-24', equity: 62380.5, cumulativePnl: 12437.75, highWaterMark: 62801 }],
    drawdown: [{ date: '2026-07-24', drawdownAmount: -420.5, drawdownPct: -0.0082 }],
    monthlyPerformance: [{ month: '2026-07', netPnl: 842.1, winRate: 0.65, tradeCount: 12 }],
    rDistribution: [{ label: '0 to 1', count: 18 }],
    directionalPerformance: {
      long: { netPnl: 10984.2, winRate: 0.6047, tradeCount: 71 },
      short: { netPnl: 1454.35, winRate: 0.4615, tradeCount: 16 },
    },
    processScoreDistribution: [{ label: 'A (54-60)', count: 26, minScore: 54 }],
    tradeMarkers: [],
    calendarHeatmap: [{ year: 2026, days: [{ date: '2026-07-24', pnl: 842.1 }] }],
    periodMatrix: {
      wow: { comparisonType: 'wow', rows: [] },
      mom: { comparisonType: 'mom', rows: [] },
      qoq: { comparisonType: 'qoq', rows: [] },
    },
    setupRanking: [
      {
        setupName: 'ORB',
        setupId: 's1',
        count: 34,
        winRate: 0.61,
        avgR: 0.5,
        avgProcessScore: 50,
        sampleSizeWarning: 'adequate',
      },
    ],
    attentionInsights: { insights: [], tradeCount: 84 },
  };
}

/** Realistic dashboard V2 response (same shape the adapter test uses). */
function makeDashboardV2Response(): DashboardV2Response {
  return {
    snapshotId: 'snap:acct-1:2026-07-24T20:15:00.000Z',
    account: { id: 'acct-1', name: 'Primary Margin', currency: 'USD' },
    scopes: {
      accountPositions: {
        id: 'account_positions',
        section: 'valuation',
        description: 'Open positions with their latest valuation marks, attribution, and per-position risk.',
        source: 'account_positions + valuation_marks',
        asOf: '2026-07-24T19:58:00Z',
      },
      journalTrades: {
        id: 'journal_trades',
        section: 'journalAttribution',
        description: 'Journal trade linkage for accounting executions, attribution, and open-trade risk.',
        source: 'accounting_executions + trades',
        asOf: '2026-07-24T20:15:00.000Z',
      },
      periodPerformance: {
        id: 'period_performance',
        section: 'metrics',
        description: 'Period-to-date performance projection: cash, NAV, realized and unrealized P&L.',
        source: 'account_performance',
        asOf: '2026-07-24T20:00:00.000Z',
      },
    },
    metrics: {
      cash: '24150.75',
      nav: '62380.50',
      markedPositions: '31543.85',
      realizedPnl: '12437.75',
      unrealizedPnl: '841.35',
      totalPnl: '13279.10',
      realizedFees: '512.30',
      grossExposure: '31543.85',
      netExposure: '31543.85',
      drawdown: '-420.50',
      drawdownPct: '-0.82',
      modifiedDietzReturn: '0.0524',
      twr: '0.0518',
      provenance: {
        source: 'account_performance',
        asOf: '2026-07-24T20:00:00.000Z',
        computedAt: '2026-07-24T20:15:00.000Z',
        status: 'partial',
        presentationLabel: '— Partial — 1 unpriced',
      },
    },
    valuation: {
      positionsTotal: 3,
      fresh: 2,
      stale: 1,
      missing: 0,
      state: 'partial',
      coveragePct: '66.67',
      presentationLabel: '— Partial — 1 unpriced',
      markedSubsetPnl: '919.60',
      positions: [
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
          markTimestamp: '2026-07-24T19:58:00Z',
          markAgeMinutes: 17,
          attribution: { kind: 'journal', executionCount: 214, journalTradeCount: 214 },
          markProvenance: {
            source: 'market_data',
            asOf: '2026-07-24T19:58:00Z',
            computedAt: '2026-07-24T20:15:00.000Z',
            status: 'fresh',
          },
          risk: { hasValidStop: true, stopPrice: 127.9, currentRiskToStop: '474.00', openTrades: 1 },
          journalLinkedMetrics: {
            remainingQty: 120,
            openAvgCost: 128.4,
            grossRealizedPnl: 1210.5,
            netRealizedPnl: 1190.2,
            netUnrealizedPnl: 409.7,
            openFees: 4.3,
          },
        },
      ],
      provenance: {
        source: 'account_positions + valuation_marks',
        asOf: '2026-07-24T19:58:00Z',
        computedAt: '2026-07-24T20:15:00.000Z',
        status: 'partial',
        presentationLabel: '— Partial — 1 unpriced',
      },
    },
    journalAttribution: {
      hasJournalTrades: true,
      journalExecutionCount: 214,
      accountOnlyExecutionCount: 3,
      provenance: {
        source: 'accounting_executions',
        asOf: '2026-07-24T20:15:00.000Z',
        computedAt: '2026-07-24T20:15:00.000Z',
        status: 'complete',
        presentationLabel: null,
      },
    },
    journalLinked: {
      tradeCount: 3,
      positionCount: 2,
      remainingQty: '200.00',
      openAvgCost: '121.88',
      grossRealizedPnl: '1531.25',
      netRealizedPnl: '1501.65',
      netUnrealizedPnl: '912.80',
      openFees: '6.80',
      comparisons: [
        {
          key: 'remainingQty',
          description: 'Remaining open quantity',
          dashboardValue: '200.00',
          tradesValue: '200.00',
          difference: '0.00',
          status: 'match',
        },
      ],
      provenance: {
        source: 'accounting_executions + trades + trade_executions + trade_risk_snapshots + trade_stop_adjustments + fifo_lots',
        asOf: '2026-07-24T20:15:00.000Z',
        computedAt: '2026-07-24T20:15:00.000Z',
        status: 'complete',
        presentationLabel: null,
      },
    },
    reconciliation: {
      eligible: true,
      refusalReasons: [],
      comparisons: null,
      totals: null,
      provenance: {
        source: 'reconciliation_report',
        asOf: '2026-07-24T20:15:00.000Z',
        computedAt: '2026-07-24T20:15:00.000Z',
        status: 'complete',
        presentationLabel: null,
      },
    },
    riskSummary: {
      openPnl: '841.35',
      openRisk: '1450.00',
      portfolioHeat: '2.80',
      missingStops: 1,
      positionsWithStop: 2,
      openRiskToStop: '731.60',
      stopCoverage: {
        openTrades: 3,
        withStop: 2,
        withoutStop: 1,
        state: 'partial',
        presentationLabel: 'Incomplete — 1 without a valid stop',
      },
      provenance: {
        source: 'account_positions + trades + trade_risk_snapshots',
        asOf: '2026-07-24T19:58:00Z',
        computedAt: '2026-07-24T20:15:00.000Z',
        status: 'partial',
        presentationLabel: '— Partial — 1 unpriced',
      },
    },
    integrity: { status: 'warning', warnings: ['TSLA mark is stale.'] },
    computedAt: '2026-07-24T20:15:00.000Z',
  };
}

const dashFixture = makeDashboardResponse();
const v2Fixture = makeDashboardV2Response();
const accountRows = [{ id: 'acct-1', name: 'Primary Margin', currency: 'USD' }];

beforeEach(() => {
  localStorage.clear();
  mockFetch.mockReset();
  mockFetch.mockImplementation(async (input: unknown) => {
    const url = String(input);
    let body: unknown;
    // Most-specific prefixes first.
    if (url.startsWith('/api/dashboard/v2')) body = v2Fixture;
    else if (url.startsWith('/api/dashboard')) body = dashFixture;
    else if (url.startsWith('/api/watchlist/prices')) body = { prices: {} };
    else if (url.startsWith('/api/watchlist')) body = [];
    else if (url.startsWith('/api/accounts')) body = accountRows;
    else throw new Error(`Unexpected request URL in contract test: ${url}`);
    return makeFakeResponse(200, body);
  });
});

/** True when a request URL carries a period/date query parameter. */
function hasPeriodDateQueryParam(url: string): boolean {
  const query = url.split('?')[1];
  if (query === undefined) return false;
  return query.split('&').some((pair) => {
    const key = pair.split('=')[0].toLowerCase();
    return (PERIOD_DATE_QUERY_KEYS as readonly string[]).includes(key);
  });
}

/* ── 1. CURRENT adapter surface exposes no period/date filter ───────────── */

describe('CURRENT adapter surface exposes no period or date filter', () => {
  it('keeps a non-trivial exported fetch surface', () => {
    const fetchFns = adapterFunctions.filter((f) => f.isAsync);
    expect(fetchFns.length).toBeGreaterThanOrEqual(9);
    expect(adapterFunctions.map((f) => f.name)).toContain('fetchAllLiveDashboardData');
  });

  it('no CURRENT fetch parameter carries period/date vocabulary', () => {
    const hits = adapterFunctions
      .filter((f) => !DATE_AWARE_FETCH_FNS.has(f.name))
      .flatMap((fn) =>
        fn.params.flatMap((segment) => bannedVocabularyHits(segment).map((w) => `${fn.name}: ${w}`)),
      );
    expect(hits, 'period/date parameter vocabulary found in a CURRENT fetch').toEqual([]);
  });

  it('CURRENT fetch functions take at most accountId, AbortSignal, and the documented skipAccounts option', () => {
    const violations = adapterFunctions
      .filter((f) => f.isAsync)
      .flatMap((fn) =>
        fn.params
          .flatMap(leadingParamNames)
          .filter(
            (name) =>
              !(DATE_AWARE_FETCH_FNS.has(fn.name)
                ? (ALLOWED_DATE_AWARE_FETCH_PARAMS as readonly string[])
                : (ALLOWED_FETCH_PARAMS as readonly string[])
              ).includes(name),
          )
          .map((name) => `${fn.name}: ${name}`),
      );
    expect(
      violations,
      'a CURRENT fetch gained a parameter outside {accountId, signal, options, skipAccounts, symbols} — ' +
        'the doc contract says CURRENT fetches take no period/date filter',
    ).toEqual([]);
  });

  it('only the date-aware V1 fetch and its composition wrapper may take the resolved range', () => {
    for (const fn of adapterFunctions) {
      const hasRange = fn.params.some((segment) => /^range\b/.test(segment.trim()));
      if (DATE_AWARE_FETCH_FNS.has(fn.name)) {
        expect(hasRange, `${fn.name} may take the optional range`).toBe(true);
      } else {
        expect(hasRange, `${fn.name} must not take a range parameter`).toBe(false);
      }
    }
  });

  it('no query the CURRENT path builds carries a period/date key', () => {
    const keys = urlSearchParamKeys(adapterSource);
    expect(keys.length).toBeGreaterThanOrEqual(2);
    expect(bannedVocabularyHits(keys.join(' ')), 'period/date query key in a live URL').toEqual([]);
  });

  it('dateFrom/dateTo are serialized only inside the date-aware V1 fetch (9D.1 §10)', () => {
    const mentioners = adapterFunctions
      .filter((f) => f.isAsync)
      .map((f) => ({ name: f.name, body: exportedFunctionBody(adapterSource, f.name) }))
      .filter(({ body }) => body !== undefined)
      .filter(({ body }) => /\bdateFrom\b/.test(body!) || /\bdateTo\b/.test(body!))
      .map(({ name }) => name);
    expect(mentioners).toEqual(['fetchDashboardLive']);
  });
});

/* ── 2. No import edge between live data path and P&L scope ────────────── */

describe('no import edge between the live data path and the P&L scope preference', () => {
  it('the live adapter never imports the P&L scope modules', () => {
    expect(adapterSource).not.toMatch(/performance-pnl-scope/);
  });

  it('WorkstationContext never imports use-performance-pnl-scope', () => {
    expect(contextSource).not.toMatch(/performance-pnl-scope/);
  });

  it('only performance-panel.tsx consumes usePerformancePnlScope among workstation components', () => {
    const consumers = workstationComponentFiles
      .filter((file) => /from\s+['"][^'"]*use-performance-pnl-scope['"]/.test(fs.readFileSync(file, 'utf-8')))
      .map((file) => path.basename(file));
    expect(consumers, 'the per-panel P&L scope selector must stay panel-scoped').toEqual(['performance-panel.tsx']);
  });

  it('performance-panel.tsx actually imports the hook (positive control)', () => {
    expect(panelSource).toMatch(/from\s+['"]@\/hooks\/use-performance-pnl-scope['"]/);
  });
});

/* ── 3. Period-scope preference never alters the live snapshot payload ─── */

describe('period-scope preference never alters the live snapshot payload', () => {
  const ACCOUNT = 'acct-1';

  async function fetchSnapshotOnce(): Promise<{ payload: LiveDashboardData; urls: string[] }> {
    mockFetch.mockClear();
    const result = await fetchAllLiveDashboardData(ACCOUNT);
    expect(result.success, 'fetchAllLiveDashboardData should succeed').toBe(true);
    return {
      payload: result.success ? result.data : (null as unknown as LiveDashboardData),
      urls: mockFetch.mock.calls.map((c) => String(c[0])),
    };
  }

  it('issues the same four bundled requests with no period/date query parameters', async () => {
    const snap = await fetchSnapshotOnce();
    expect(snap.urls).toHaveLength(4);
    expect(snap.urls.some((u) => u.includes(`accountId=${ACCOUNT}`)), 'accountId is the only scope the adapter sends').toBe(true);
    for (const url of snap.urls) {
      expect(hasPeriodDateQueryParam(url), `${url} must not carry a period/date filter`).toBe(false);
    }
  });

  it('returns identical payloads for every scope value and for an unset preference', async () => {
    const preferenceStates: Array<string | null> = [null, ...PERFORMANCE_PNL_SCOPES];
    const snapshots: LiveDashboardData[] = [];
    for (const scope of preferenceStates) {
      if (scope === null) localStorage.removeItem(PERFORMANCE_PNL_SCOPE_STORAGE_KEY);
      else localStorage.setItem(PERFORMANCE_PNL_SCOPE_STORAGE_KEY, scope);
      snapshots.push((await fetchSnapshotOnce()).payload);
    }
    for (let i = 1; i < snapshots.length; i += 1) {
      expect(snapshots[i], `snapshot with scope preference must equal the unset-preference snapshot`).toEqual(snapshots[0]);
    }
    // Non-trivial live snapshot: positions and risk came back from the bundle.
    expect(snapshots[0].positions.length).toBeGreaterThan(0);
    expect(snapshots[0].risk.current.openRisk).toBe('1450.00');
  });

  it('issues identical requests regardless of the persisted scope', async () => {
    const urlSets: string[][] = [];
    for (const scope of PERFORMANCE_PNL_SCOPES) {
      localStorage.setItem(PERFORMANCE_PNL_SCOPE_STORAGE_KEY, scope);
      urlSets.push((await fetchSnapshotOnce()).urls);
    }
    for (let i = 1; i < urlSets.length; i += 1) {
      expect(urlSets[i], `requests for scope ${PERFORMANCE_PNL_SCOPES[i]} must match the first`).toEqual(urlSets[0]);
    }
  });

  it('writes the real storage key the Performance panel preference uses', () => {
    expect(PERFORMANCE_PNL_SCOPE_STORAGE_KEY).toBe('workstation:performance-pnl-scope:v1');
  });
});

/* ── 4. Scanner self-test (the contract rejects drift) ─────────────────── */

describe('contract scanner self-test (the contract rejects drift)', () => {
  it('flags a CURRENT fetch function that gains a period parameter', () => {
    const doctored = adapterSource.replace(
      'export async function fetchDashboardV2Live(\n  accountId: string,\n  signal?: AbortSignal,\n)',
      'export async function fetchDashboardV2Live(\n  accountId: string,\n  signal?: AbortSignal,\n  period: string,\n)',
    );
    const fns = extractExportedFunctions(doctored);
    const hits = fns
      .filter((f) => !DATE_AWARE_FETCH_FNS.has(f.name))
      .flatMap((fn) =>
        fn.params.flatMap((segment) => bannedVocabularyHits(segment).map((w) => `${fn.name}: ${w}`)),
      );
    expect(hits).toContain('fetchDashboardV2Live: period');
  });

  it('flags a raw date-window parameter on the batch fetch', () => {
    const doctored = adapterSource.replace(
      'export async function fetchAllLiveDashboardData(\n  accountId: string,\n  signal?: AbortSignal,\n  options?: { skipAccounts?: boolean },\n  range?: ResolvedDateRange,\n)',
      'export async function fetchAllLiveDashboardData(\n  accountId: string,\n  signal?: AbortSignal,\n  options?: { skipAccounts?: boolean },\n  dateFrom: string,\n)',
    );
    const fns = extractExportedFunctions(doctored);
    const violations = fns
      .filter((f) => f.isAsync)
      .flatMap((fn) =>
        fn.params
          .flatMap(leadingParamNames)
          .filter(
            (name) =>
              !(DATE_AWARE_FETCH_FNS.has(fn.name)
                ? (ALLOWED_DATE_AWARE_FETCH_PARAMS as readonly string[])
                : (ALLOWED_FETCH_PARAMS as readonly string[])
              ).includes(name),
          ),
      );
    expect(violations).toContain('dateFrom');
  });

  it('allows the resolved range on the date-aware V1 fetch (positive control)', () => {
    const fns = extractExportedFunctions(adapterSource);
    const violations = fns
      .filter((f) => f.isAsync)
      .flatMap((fn) =>
        fn.params
          .flatMap(leadingParamNames)
          .filter(
            (name) =>
              !(DATE_AWARE_FETCH_FNS.has(fn.name)
                ? (ALLOWED_DATE_AWARE_FETCH_PARAMS as readonly string[])
                : (ALLOWED_FETCH_PARAMS as readonly string[])
              ).includes(name),
          ),
      );
    expect(violations).toEqual([]);
  });

  it('flags a period query key in a URL the adapter builds', () => {
    const doctored = adapterSource.replace(
      'const params = new URLSearchParams({ accountId });',
      'const params = new URLSearchParams({ accountId, period });',
    );
    expect(bannedVocabularyHits(urlSearchParamKeys(doctored).join(' '))).toContain('period');
  });

  it('flags the live adapter importing the P&L scope module', () => {
    const doctored = `${adapterSource}\nimport { usePerformancePnlScope } from '@/hooks/use-performance-pnl-scope';\n`;
    expect(doctored).toMatch(/performance-pnl-scope/);
  });

  it('flags WorkstationContext importing the P&L scope hook', () => {
    const doctored = contextSource.replace(
      "import {\n  fetchAllLiveDashboardData,",
      "import { usePerformancePnlScope } from '@/hooks/use-performance-pnl-scope';\n\nimport {\n  fetchAllLiveDashboardData,",
    );
    expect(doctored).toMatch(/use-performance-pnl-scope/);
  });
});
