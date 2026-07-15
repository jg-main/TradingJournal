/**
 * Watchlist OHLC endpoint vitest test
 *
 * Tests GET /api/watchlist/ohlc — verifies the route resolves OHLC bars
 * from the primary provider (ClickHouse/Schwab) with fallback to Yahoo
 * Finance chart() when the primary returns no data.
 *
 * Uses a controllable mock provider that reads from mockProviderCtx and
 * a controllable mock Yahoo Finance fallback.
 *
 * Run: npx vitest run src/app/api/watchlist/ohlc/__tests__/route.test.ts
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── Hoisted: controllable mock provider state ─────────────────────────────

const mockProviderCtx = vi.hoisted(() => {
  const getOhlcResults = new Map<string, unknown>();
  let shouldThrow = false;
  let emptyResults = false;

  return {
    getOhlcResults,
    getShouldThrow() {
      return shouldThrow;
    },
    getEmptyResults() {
      return emptyResults;
    },
    setResult(symbol: string, bars: Array<{ date: string; close: number }>) {
      getOhlcResults.set(symbol, {
        symbol,
        ohlc: bars.map((b) => ({
          date: b.date,
          open: b.close - 1,
          high: b.close + 0.5,
          low: b.close - 1.5,
          close: b.close,
          volume: 1000000,
          vwap: b.close - 0.1,
        })),
        notes: [],
      });
    },
    setEmpty(symbol: string) {
      getOhlcResults.set(symbol, {
        symbol,
        ohlc: [],
        notes: ['No data'],
      });
    },
    setThrow(t: boolean) {
      shouldThrow = t;
    },
    setEmptyResults(e: boolean) {
      emptyResults = e;
    },
    reset() {
      getOhlcResults.clear();
      shouldThrow = false;
      emptyResults = false;
    },
  };
});

// ── Hoisted: controllable Yahoo Finance fallback state ────────────────────

const mockYahooCtx = vi.hoisted(() => {
  const fallbackResults = new Map<string, Array<{ date: string; close: number }>>();
  let shouldThrow = false;

  return {
    fallbackResults,
    getShouldThrow() {
      return shouldThrow;
    },
    setResult(symbol: string, bars: Array<{ date: string; close: number }>) {
      fallbackResults.set(symbol, bars);
    },
    setThrow(t: boolean) {
      shouldThrow = t;
    },
    reset() {
      fallbackResults.clear();
      shouldThrow = false;
    },
  };
});

// ── Mock market-data-resolver ─────────────────────────────────────────────
// Route calls resolveOhlcProvider() to get the primary OHLC provider.
// Our mock returns a controllable provider that reads from mockProviderCtx.

vi.mock('@/lib/market-data-resolver', () => ({
  resolveOhlcProvider: () => ({
    name: 'clickhouse',
    async getOhlc(params: { symbol: string; startDate: string; endDate: string }) {
      if (mockProviderCtx.getShouldThrow()) {
        throw new Error('Simulated ClickHouse provider failure');
      }
      const upper = params.symbol.toUpperCase();
      const result = mockProviderCtx.getOhlcResults.get(upper) as
        | { symbol: string; ohlc: Array<Record<string, unknown>>; notes: string[] }
        | undefined;
      if (result) {
        return result;
      }
      return {
        symbol: upper,
        ohlc: [],
        notes: [`No data for symbol: ${upper}`],
      };
    },
    async getFeatureTimeSeries() {
      return [];
    },
    async checkFreshness() {
      return { status: 'unknown', message: 'mock' };
    },
  }),
  readActiveMarketDataSettings: () => ({ activeProvider: 'clickhouse' }),
}));

// ── Mock market-quote ─────────────────────────────────────────────────────
// Route imports fetchYahooOhlcBars as the Yahoo Finance fallback.

vi.mock('@/lib/market-quote', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    fetchYahooOhlcBars: async (symbol: string) => {
      if (mockYahooCtx.getShouldThrow()) {
        throw new Error('Simulated Yahoo Finance failure');
      }
      const upper = symbol.toUpperCase();
      const bars = mockYahooCtx.fallbackResults.get(upper);
      if (bars) {
        return bars;
      }
      throw new Error(`No Yahoo Finance data for symbol: ${upper}`);
    },
  };
});

// ── Module-level imports (after mocks) ────────────────────────────────────

import { GET } from '../route';

// ── Test helper ───────────────────────────────────────────────────────────

async function callGet(
  url: string,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const request = new Request(url) as never;
  const response = await GET(request);
  const data = (await response.json()) as Record<string, unknown>;
  return { status: response.status, data };
}

function makeBars(days: number, basePrice = 200): Array<{ date: string; close: number }> {
  const bars: Array<{ date: string; close: number }> = [];
  for (let i = days; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const date = d.toISOString().split('T')[0];
    // Skip weekends for realism
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) {
      bars.push({ date, close: basePrice + Math.sin(i * 0.5) * 10 });
    }
  }
  return bars;
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('GET /api/watchlist/ohlc', () => {
  beforeEach(() => {
    mockProviderCtx.reset();
    mockYahooCtx.reset();
  });

  // ── Happy path: primary provider returns bars ───────────────────────────

  it('returns OHLC bars from primary provider', async () => {
    const bars = makeBars(30, 200);
    mockProviderCtx.setResult('AAPL', bars);

    const { status, data } = await callGet(
      'http://localhost/api/watchlist/ohlc?symbol=AAPL',
    );

    expect(status).toBe(200);
    expect(data).toHaveProperty('symbol', 'AAPL');
    expect(data).toHaveProperty('source', 'clickhouse');
    expect(data).toHaveProperty('fetchedAt');
    expect((data.fetchedAt as string)).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const resultBars = data.bars as Array<Record<string, unknown>>;
    expect(resultBars.length).toBeGreaterThan(0);
    expect(resultBars[0]).toHaveProperty('date');
    expect(resultBars[0]).toHaveProperty('close');
  });

  it('returns bars with positive close prices only', async () => {
    const bars = makeBars(20, 200);
    mockProviderCtx.setResult('AAPL', bars);

    const { status, data } = await callGet(
      'http://localhost/api/watchlist/ohlc?symbol=AAPL',
    );

    expect(status).toBe(200);
    const resultBars = data.bars as Array<Record<string, unknown>>;
    for (const bar of resultBars) {
      expect((bar.close as number)).toBeGreaterThan(0);
    }
  });

  // ── Fallback: primary returns empty → Yahoo Finance used ────────────────

  it('falls back to Yahoo Finance when primary provider returns no data', async () => {
    mockProviderCtx.setEmpty('AAPL');

    const yahooBars = makeBars(25, 205);
    mockYahooCtx.setResult('AAPL', yahooBars);

    const { status, data } = await callGet(
      'http://localhost/api/watchlist/ohlc?symbol=AAPL',
    );

    expect(status).toBe(200);
    expect(data).toHaveProperty('symbol', 'AAPL');
    expect(data).toHaveProperty('source', 'yahoo');

    const resultBars = data.bars as Array<Record<string, unknown>>;
    expect(resultBars.length).toBeGreaterThan(0);
  });

  it('falls back to Yahoo Finance when primary provider errors', async () => {
    mockProviderCtx.setThrow(true);

    const yahooBars = makeBars(20, 210);
    mockYahooCtx.setResult('AAPL', yahooBars);

    const { status, data } = await callGet(
      'http://localhost/api/watchlist/ohlc?symbol=AAPL',
    );

    expect(status).toBe(200);
    expect(data).toHaveProperty('source', 'yahoo');
  });

  it('returns 502 when both primary and Yahoo fallback fail', async () => {
    mockProviderCtx.setEmpty('AAPL');
    mockYahooCtx.setThrow(true);

    const { status, data } = await callGet(
      'http://localhost/api/watchlist/ohlc?symbol=AAPL',
    );

    expect(status).toBe(502);
    expect(data.error).toBe('Failed to fetch OHLC data');
    expect(data.details).toContain('Primary provider');
    expect(data.details).toContain('Fallback');
  });

  it('returns 502 when primary throws and Yahoo fallback also throws', async () => {
    mockProviderCtx.setThrow(true);
    mockYahooCtx.setThrow(true);

    const { status, data } = await callGet(
      'http://localhost/api/watchlist/ohlc?symbol=AAPL',
    );

    expect(status).toBe(502);
    expect(data.error).toBe('Failed to fetch OHLC data');
  });

  // ── Validation ──────────────────────────────────────────────────────────

  it('returns 400 when symbol parameter is missing', async () => {
    const { status, data } = await callGet(
      'http://localhost/api/watchlist/ohlc',
    );

    expect(status).toBe(400);
    expect(data.error).toBe('Validation failed');
  });

  it('returns 400 when symbol parameter is empty', async () => {
    const { status, data } = await callGet(
      'http://localhost/api/watchlist/ohlc?symbol=',
    );

    expect(status).toBe(400);
    expect(data.error).toBe('Validation failed');
  });

  it('returns 400 for invalid symbol with special characters', async () => {
    const { status, data } = await callGet(
      'http://localhost/api/watchlist/ohlc?symbol=AAPL$',
    );

    expect(status).toBe(400);
    expect(data.error).toBe('Validation failed');
  });

  it('returns 400 for symbol exceeding max length', async () => {
    const longSymbol = 'A'.repeat(21);
    const { status, data } = await callGet(
      `http://localhost/api/watchlist/ohlc?symbol=${longSymbol}`,
    );

    expect(status).toBe(400);
    expect(data.error).toBe('Validation failed');
  });

  // ── Edge cases ──────────────────────────────────────────────────────────

  it('allows symbols with dots like BRK.B', async () => {
    const bars = makeBars(10, 450);
    mockProviderCtx.setResult('BRK.B', bars);

    const { status, data } = await callGet(
      'http://localhost/api/watchlist/ohlc?symbol=BRK.B',
    );

    expect(status).toBe(200);
    expect(data).toHaveProperty('symbol', 'BRK.B');
    const resultBars = data.bars as Array<Record<string, unknown>>;
    expect(resultBars.length).toBeGreaterThan(0);
  });

  it('upper-cases lowercase symbol input', async () => {
    const bars = makeBars(20, 178);
    mockProviderCtx.setResult('AAPL', bars);

    const { status, data } = await callGet(
      'http://localhost/api/watchlist/ohlc?symbol=aapl',
    );

    expect(status).toBe(200);
    expect(data).toHaveProperty('symbol', 'AAPL');
    const resultBars = data.bars as Array<Record<string, unknown>>;
    expect(resultBars.length).toBeGreaterThan(0);
  });

  it('trims whitespace from symbol', async () => {
    const bars = makeBars(15, 178);
    mockProviderCtx.setResult('AAPL', bars);

    const { status, data } = await callGet(
      'http://localhost/api/watchlist/ohlc?symbol=  AAPL  ',
    );

    expect(status).toBe(200);
    expect(data).toHaveProperty('symbol', 'AAPL');
  });

  it('uppercases the symbol', async () => {
    const bars = makeBars(15, 178);
    mockProviderCtx.setResult('AAPL', bars);

    const { status, data } = await callGet(
      'http://localhost/api/watchlist/ohlc?symbol=aapl',
    );

    expect(status).toBe(200);
    expect(data).toHaveProperty('symbol', 'AAPL');
  });

  // ── Provider errors ─────────────────────────────────────────────────────

  it('returns 502 when both providers fail (no wall-to-500 path escapes)', async () => {
    // Simulate a crash before the try-catch by passing an invalid request
    // We already tested provider failure -> fallback -> 502 scenario.
    // For 500, we need something that escapes the inner try/catch.
    // The route's outer catch handles everything else.

    // Mock a situation where symbol is valid but the resolved data fails
    mockProviderCtx.setThrow(true);
    mockYahooCtx.setThrow(true);

    const { status, data } = await callGet(
      'http://localhost/api/watchlist/ohlc?symbol=AAPL',
    );

    // Both primary and fallback fail -> 502 (NOT 500, because we handle it explicitly)
    expect(status).toBe(502);
  });
});
