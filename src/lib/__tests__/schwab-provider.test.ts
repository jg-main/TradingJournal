/**
 * schwab-provider test
 *
 * Tests the SchwabProvider implementation:
 *   - getOhlc() with daily and 10m frequencies
 *   - getQuote() with various response scenarios
 *   - getFeatureTimeSeries() returns empty results with error notes
 *   - checkFreshness() with configured/missing/expired tokens
 *   - fromAuthClient() factory
 *   - Error handling for network failures
 *
 * Pattern: mock SchwabApiClient injected via constructor (DI).
 * Uses vi.hoisted() for mock variable declarations.
 *
 * Run: npx vitest run src/lib/__tests__/schwab-provider.test.ts
 */

import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';

// ── Hoisted mock vars ──────────────────────────────────────────────

const mockFns = vi.hoisted(() => ({
  mockGetQuotes: vi.fn(),
  mockGetPriceHistory: vi.fn(),
}));

const mockAuthFns = vi.hoisted(() => ({
  mockGetTokenData: vi.fn(),
  mockGetAuthClient: vi.fn(),
  mockSchwabIsConfigured: vi.fn(),
  mockEnsureTokenFreshness: vi.fn(),
}));

// ── Mock server-only ───────────────────────────────────────────────

vi.mock('server-only', () => ({}));

// ── Mock @/db ──────────────────────────────────────────────────────

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '@/db/schema';

const sqlite = new Database(':memory:');
const testDb = drizzle(sqlite, { schema });

vi.mock('@/db', () => ({
  db: testDb,
  initializeDatabase: () => testDb,
  getSqliteHandle: () => sqlite,
}));

// ── Mock @sudowealth/schwab-api ────────────────────────────────────

vi.mock('@sudowealth/schwab-api', () => {
  const mockApiClient = {
    marketData: {
      quotes: {
        getQuotes: mockFns.mockGetQuotes,
      },
      priceHistory: {
        getPriceHistory: mockFns.mockGetPriceHistory,
      },
    },
    all: {
      marketData: {
        quotes: { getQuotes: mockFns.mockGetQuotes },
        priceHistory: { getPriceHistory: mockFns.mockGetPriceHistory },
      },
    },
  };

  return {
    createSchwabAuth: vi.fn(() => ({
      getAuthorizationUrl: vi.fn(),
      exchangeCode: vi.fn(),
      getTokenData: mockAuthFns.mockGetTokenData,
      clearTokens: vi.fn(),
      supportsRefresh: vi.fn().mockReturnValue(true),
    })),
    createApiClient: vi.fn(() => mockApiClient),
    AuthStrategy: { ENHANCED: 'enhanced' },
    EnhancedTokenManager: class Mock {},
  };
});

// ── Mock schwab-auth (partial) ─────────────────────────────────────

vi.mock('../schwab-auth', () => ({
  getAuthClient: mockAuthFns.mockGetAuthClient,
  schwabIsConfigured: mockAuthFns.mockSchwabIsConfigured,
  resetAuthClient: vi.fn(),
  ensureTokenFreshness: mockAuthFns.mockEnsureTokenFreshness,
}));

// ── Import after mocks ─────────────────────────────────────────────

import { SchwabProvider } from '../schwab-provider';
import type {
  MarketEvidence,
  OhlcBar,
  FeatureTimeSeries,
  FreshnessCheck,
} from '../clickhouse-client';
import type { QuoteResult } from '../market-quote';
import type {
  OhlcQueryParams,
  FeatureTimeSeriesQueryParams,
} from '../market-ohlc-provider';

// ── Helpers ────────────────────────────────────────────────────────

const FIXED_NOW = '2026-07-14T12:00:00.000Z';

function mockSchwabCandle(
  dateStr: string,
  open: number,
  high: number,
  low: number,
  close: number,
  volume: number,
) {
  return {
    datetime: new Date(dateStr + 'T00:00:00Z').getTime(),
    open,
    high,
    low,
    close,
    volume,
  };
}

function createProvider(): SchwabProvider {
  // Create provider with DI — pass a minimal mock SchwabApiClient
  const mockClient = {
    marketData: {
      quotes: {
        getQuotes: mockFns.mockGetQuotes,
      },
      priceHistory: {
        getPriceHistory: mockFns.mockGetPriceHistory,
      },
    },
    all: {
      marketData: {
        quotes: { getQuotes: mockFns.mockGetQuotes },
        priceHistory: { getPriceHistory: mockFns.mockGetPriceHistory },
      },
    },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return new SchwabProvider(mockClient);
}

function createMockQuoteEntry(
  symbol: string,
  lastPrice: number | null,
  securityStatus: string = 'Normal',
  shortName?: string,
  sector?: string,
  industry?: string,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entry: Record<string, any> = {
    assetMainType: 'EQUITY',
    symbol,
    quote: lastPrice != null
      ? { lastPrice, securityStatus }
      : undefined,
  };
  if (shortName) entry.shortName = shortName;
  if (sector || industry) {
    entry.reference = {
      fundamental: { sector: sector ?? null, industry: industry ?? null },
    };
  }
  return [symbol, entry];
}

// ── Setup ──────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(FIXED_NOW));
  mockAuthFns.mockEnsureTokenFreshness.mockResolvedValue(true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.restoreAllMocks();

  delete process.env.SCHWAB_CLIENT_ID;
  delete process.env.SCHWAB_CLIENT_SECRET;
  delete process.env.SCHWAB_REDIRECT_URI;
});

// ── Tests: Provider Creation ───────────────────────────────────────

describe('SchwabProvider construction', () => {
  it('can be instantiated with a mock API client (DI)', () => {
    const provider = createProvider();
    expect(provider).toBeInstanceOf(SchwabProvider);
    expect(provider.name).toBe('schwab');
  });

  it('fromAuthClient returns null when not configured', () => {
    mockAuthFns.mockSchwabIsConfigured.mockReturnValue(false);
    const provider = SchwabProvider.fromAuthClient();
    expect(provider).toBeNull();
  });

  it('fromAuthClient returns null when getAuthClient returns null', () => {
    mockAuthFns.mockSchwabIsConfigured.mockReturnValue(true);
    mockAuthFns.mockGetAuthClient.mockReturnValue(null);
    const provider = SchwabProvider.fromAuthClient();
    expect(provider).toBeNull();
  });

  it('fromAuthClient returns provider when configured and auth available', () => {
    mockAuthFns.mockSchwabIsConfigured.mockReturnValue(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockAuthFns.mockGetAuthClient.mockReturnValue({} as any);
    const provider = SchwabProvider.fromAuthClient();
    expect(provider).toBeInstanceOf(SchwabProvider);
  });
});

// ── Tests: getQuote ────────────────────────────────────────────────

describe('getQuote', () => {
  it('returns empty array for empty symbols', async () => {
    const provider = createProvider();
    const results = await provider.getQuote([]);
    expect(results).toEqual([]);
  });

  it('does not call Schwab quote APIs when the token cannot be refreshed', async () => {
    mockAuthFns.mockEnsureTokenFreshness.mockResolvedValue(false);
    const provider = createProvider();

    const results = await provider.getQuote(['AAPL']);

    expect(mockFns.mockGetQuotes).not.toHaveBeenCalled();
    expect(results).toMatchObject([
      {
        symbol: 'AAPL',
        price: null,
        source: 'schwab',
        error: expect.stringContaining('Reconnect Schwab'),
      },
    ]);
  });

  it('returns mapped quotes for valid symbols with dayHigh/dayLow', async () => {
    mockFns.mockGetQuotes.mockResolvedValue({
      AAPL: {
        assetMainType: 'EQUITY',
        symbol: 'AAPL',
        shortName: 'Apple Inc.',
        quote: {
          lastPrice: 178.5,
          securityStatus: 'Normal',
          highPrice: 182.0,
          lowPrice: 176.5,
          netChange: 2.5,
          closePrice: 176.0,
        },
        reference: {
          fundamental: { sector: 'Technology', industry: 'Consumer Electronics' },
        },
      },
    });

    const provider = createProvider();
    const results = await provider.getQuote(['AAPL']);

    expect(results).toHaveLength(1);
    expect(results[0].symbol).toBe('AAPL');
    expect(results[0].price).toBe(178.5);
    expect(results[0].marketState).toBe('REGULAR');
    expect(results[0].source).toBe('schwab');
    expect(results[0].shortName).toBe('Apple Inc.');
    expect(results[0].sector).toBe('Technology');
    expect(results[0].industry).toBe('Consumer Electronics');
    expect(results[0].quoteType).toBe('EQUITY');
    expect(results[0].dayHigh).toBe(182.0);
    expect(results[0].dayLow).toBe(176.5);
    expect(results[0].change).toBe(2.5);
    expect(results[0].previousClose).toBe(176.0);
    expect(results[0].changePercent).toBeCloseTo(1.42, 1);
    expect(results[0].error).toBeUndefined();
    expect(results[0].fetchedAt).toBeDefined();
  });

  it('handles missing dayHigh/dayLow gracefully', async () => {
    mockFns.mockGetQuotes.mockResolvedValue({
      AAPL: {
        assetMainType: 'EQUITY',
        symbol: 'AAPL',
        quote: { lastPrice: 178.5, securityStatus: 'Normal' },
      },
    });

    const provider = createProvider();
    const results = await provider.getQuote(['AAPL']);

    expect(results[0].dayHigh).toBeUndefined();
    expect(results[0].dayLow).toBeUndefined();
  });

  it('returns error for symbols with no quote data', async () => {
    mockFns.mockGetQuotes.mockResolvedValue({
      AAPL: { assetMainType: 'EQUITY', symbol: 'AAPL' }, // no `quote` block
    });

    const provider = createProvider();
    const results = await provider.getQuote(['AAPL']);

    expect(results).toHaveLength(1);
    expect(results[0].symbol).toBe('AAPL');
    expect(results[0].price).toBeNull();
    expect(results[0].marketState).toBe('UNKNOWN');
    expect(results[0].error).toBe('No quote data available for symbol');
  });

  it('returns error for symbols not in response', async () => {
    mockFns.mockGetQuotes.mockResolvedValue({
      MSFT: {
        assetMainType: 'EQUITY',
        symbol: 'MSFT',
        quote: { lastPrice: 420.0, securityStatus: 'Normal' },
      },
    });

    const provider = createProvider();
    const results = await provider.getQuote(['AAPL']);

    expect(results).toHaveLength(1);
    expect(results[0].symbol).toBe('AAPL');
    expect(results[0].price).toBeNull();
    expect(results[0].error).toContain('No response data');
  });

  it('preserves input order across multiple symbols', async () => {
    mockFns.mockGetQuotes.mockResolvedValue({
      MSFT: {
        assetMainType: 'EQUITY',
        symbol: 'MSFT',
        quote: { lastPrice: 420.0, securityStatus: 'Normal' },
      },
      AAPL: {
        assetMainType: 'EQUITY',
        symbol: 'AAPL',
        quote: { lastPrice: 178.5, securityStatus: 'Normal' },
      },
    });

    const provider = createProvider();
    const results = await provider.getQuote(['AAPL', 'MSFT']);

    expect(results).toHaveLength(2);
    expect(results[0].symbol).toBe('AAPL');
    expect(results[1].symbol).toBe('MSFT');
  });

  it('maps Delayed securityStatus to REGULAR marketState', async () => {
    mockFns.mockGetQuotes.mockResolvedValue({
      AAPL: {
        assetMainType: 'EQUITY',
        symbol: 'AAPL',
        quote: { lastPrice: 178.5, securityStatus: 'Delayed' },
      },
    });

    const provider = createProvider();
    const results = await provider.getQuote(['AAPL']);

    expect(results[0].marketState).toBe('REGULAR');
  });

  it('maps Closed securityStatus to CLOSED marketState', async () => {
    mockFns.mockGetQuotes.mockResolvedValue({
      AAPL: {
        assetMainType: 'EQUITY',
        symbol: 'AAPL',
        quote: { lastPrice: 178.5, securityStatus: 'Closed' },
      },
    });

    const provider = createProvider();
    const results = await provider.getQuote(['AAPL']);

    expect(results[0].marketState).toBe('CLOSED');
  });

  it('handles API errors gracefully', async () => {
    mockFns.mockGetQuotes.mockRejectedValue(new Error('Network failure'));

    const provider = createProvider();
    const results = await provider.getQuote(['AAPL']);

    expect(results).toHaveLength(1);
    expect(results[0].symbol).toBe('AAPL');
    expect(results[0].price).toBeNull();
    expect(results[0].error).toContain('Schwab quote API error');
    expect(results[0].error).toContain('Network failure');
  });

  it('returns price=null when lastPrice is null in response', async () => {
    mockFns.mockGetQuotes.mockResolvedValue({
      AAPL: {
        assetMainType: 'EQUITY',
        symbol: 'AAPL',
        quote: { lastPrice: null, securityStatus: 'Normal' },
      },
    });

    const provider = createProvider();
    const results = await provider.getQuote(['AAPL']);

    expect(results).toHaveLength(1);
    expect(results[0].price).toBeNull();
    expect(results[0].marketState).toBe('REGULAR');
  });
});

// ── Tests: getOhlc ─────────────────────────────────────────────────

describe('getOhlc', () => {
  const baseParams: OhlcQueryParams = {
    symbol: 'AAPL',
    startDate: '2026-07-01',
    endDate: '2026-07-10',
  };

  it('returns mapped OhlcBar[] for daily frequency', async () => {
    mockFns.mockGetPriceHistory.mockResolvedValue({
      candles: [
        mockSchwabCandle('2026-07-01', 150.0, 152.0, 149.5, 151.0, 1000000),
        mockSchwabCandle('2026-07-02', 151.0, 153.5, 150.5, 152.5, 1200000),
      ],
    });

    const provider = createProvider();
    const result = await provider.getOhlc(baseParams);

    expect(result.symbol).toBe('AAPL');
    expect(result.ohlc).toHaveLength(2);
    expect(result.error).toBeUndefined();

    expect(result.ohlc[0]).toEqual({
      date: '2026-07-01',
      open: 150.0,
      high: 152.0,
      low: 149.5,
      close: 151.0,
      volume: 1000000,
      vwap: 0,
    });

    expect(result.ohlc[1]).toEqual({
      date: '2026-07-02',
      open: 151.0,
      high: 153.5,
      low: 150.5,
      close: 152.5,
      volume: 1200000,
      vwap: 0,
    });
  });

  it('uses minute frequency with frequency=10 for 10m intraday', async () => {
    mockFns.mockGetPriceHistory.mockResolvedValue({
      candles: [
        mockSchwabCandle('2026-07-01', 150.0, 151.0, 149.0, 150.5, 50000),
      ],
    });

    const provider = createProvider();
    const result = await provider.getOhlc({
      ...baseParams,
      frequency: '10m',
    });

    expect(result.ohlc).toHaveLength(1);
    expect(result.ohlc[0].date).toBe('2026-07-01');

    // Verify the API was called with 10m params
    const callArgs = mockFns.mockGetPriceHistory.mock.calls[0][0];
    expect(callArgs.queryParams.frequencyType).toBe('minute');
    expect(callArgs.queryParams.frequency).toBe(10);
    expect(callArgs.queryParams.periodType).toBe('day');
  });

  it('returns empty evidence when no candles returned', async () => {
    mockFns.mockGetPriceHistory.mockResolvedValue({
      candles: [],
      empty: true,
    });

    const provider = createProvider();
    const result = await provider.getOhlc(baseParams);

    expect(result.ohlc).toHaveLength(0);
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]).toContain('No price history data');
    expect(result.error).toBeUndefined();
  });

  it('handles API errors gracefully', async () => {
    mockFns.mockGetPriceHistory.mockRejectedValue(
      new Error('Schwab price history API error'),
    );

    const provider = createProvider();
    const result = await provider.getOhlc(baseParams);

    expect(result.ohlc).toHaveLength(0);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('Schwab price history API error');
    expect(result.notes).toHaveLength(1);
  });

  it('skips candles with invalid numeric data', async () => {
    mockFns.mockGetPriceHistory.mockResolvedValue({
      candles: [
        mockSchwabCandle('2026-07-01', 150.0, 152.0, 149.5, 151.0, 1000000),
        { datetime: new Date('2026-07-02').getTime(), open: NaN, high: NaN, low: NaN, close: NaN, volume: NaN },
        mockSchwabCandle('2026-07-03', 152.0, 154.0, 151.0, 153.0, 1100000),
      ],
    });

    const provider = createProvider();
    const result = await provider.getOhlc(baseParams);

    expect(result.ohlc).toHaveLength(2);
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]).toContain('1 candle(s) had invalid data');
  });
});

// ── Tests: getFeatureTimeSeries ────────────────────────────────────

describe('getFeatureTimeSeries', () => {
  it('returns empty arrays with error for each feature', async () => {
    const provider = createProvider();
    const params: FeatureTimeSeriesQueryParams = {
      symbol: 'AAPL',
      features: [
        { id: 'rsi_14', label: 'RSI (14)' },
        { id: 'vwap', label: 'VWAP' },
      ],
      startDate: '2026-07-01',
      endDate: '2026-07-10',
    };

    const results = await provider.getFeatureTimeSeries(params);

    expect(results).toHaveLength(2);
    expect(results[0].id).toBe('rsi_14');
    expect(results[0].data).toEqual([]);
    expect(results[0].error).toContain('does not support feature time series');
    expect(results[1].id).toBe('vwap');
    expect(results[1].data).toEqual([]);
    expect(results[1].error).toContain('does not support feature time series');
  });
});

// ── Tests: checkFreshness ──────────────────────────────────────────

describe('checkFreshness', () => {
  it('returns error when Schwab is not configured', async () => {
    mockAuthFns.mockSchwabIsConfigured.mockReturnValue(false);

    const provider = createProvider();
    const result = await provider.checkFreshness();

    expect(result.status).toBe('error');
    expect(result.message).toContain('not configured');
    expect(result.threshold).toBeDefined();
  });

  it('returns stale when no token data available', async () => {
    mockAuthFns.mockSchwabIsConfigured.mockReturnValue(true);
    mockAuthFns.mockGetAuthClient.mockReturnValue({
      getTokenData: mockAuthFns.mockGetTokenData,
    });
    mockAuthFns.mockGetTokenData.mockResolvedValue(null);

    const provider = createProvider();
    const result = await provider.checkFreshness();

    expect(result.status).toBe('stale');
    expect(result.message).toContain('No Schwab tokens found');
  });

  it('returns stale when tokens are expired', async () => {
    mockAuthFns.mockSchwabIsConfigured.mockReturnValue(true);
    mockAuthFns.mockGetAuthClient.mockReturnValue({
      getTokenData: mockAuthFns.mockGetTokenData,
    });
    const expiredAt = new Date('2026-07-10T00:00:00Z').getTime();
    mockAuthFns.mockGetTokenData.mockResolvedValue({
      accessToken: 'expired-token',
      expiresAt: expiredAt,
    });

    const provider = createProvider();
    const result = await provider.checkFreshness();

    expect(result.status).toBe('stale');
    expect(result.message).toContain('expired');
    expect(result.message).toContain('re-authenticate');
  });

  it('returns fresh when tokens are valid', async () => {
    mockAuthFns.mockSchwabIsConfigured.mockReturnValue(true);
    mockAuthFns.mockGetAuthClient.mockReturnValue({
      getTokenData: mockAuthFns.mockGetTokenData,
    });
    const futureExpiry = new Date('2026-07-20T00:00:00Z').getTime();
    mockAuthFns.mockGetTokenData.mockResolvedValue({
      accessToken: 'fresh-token',
      refreshToken: 'fresh-refresh',
      expiresAt: futureExpiry,
    });

    const provider = createProvider();
    const result = await provider.checkFreshness();

    expect(result.status).toBe('fresh');
    expect(result.message).toContain('authenticated');
    expect(result.latestDate).toBeDefined();
    expect(result.threshold).toBeDefined();
  });

  it('respects custom thresholdDays', async () => {
    mockAuthFns.mockSchwabIsConfigured.mockReturnValue(true);
    mockAuthFns.mockGetAuthClient.mockReturnValue({
      getTokenData: mockAuthFns.mockGetTokenData,
    });
    const futureExpiry = new Date('2026-07-20T00:00:00Z').getTime();
    mockAuthFns.mockGetTokenData.mockResolvedValue({
      accessToken: 'fresh-token',
      expiresAt: futureExpiry,
    });

    const provider = createProvider();
    const result = await provider.checkFreshness({ thresholdDays: 7 });

    expect(result.status).toBe('fresh');
    expect(result.threshold).toBe('2026-07-07'); // 7 days before fixed_now
  });

  it('handles token data error gracefully', async () => {
    mockAuthFns.mockSchwabIsConfigured.mockReturnValue(true);
    mockAuthFns.mockGetAuthClient.mockReturnValue({
      getTokenData: mockAuthFns.mockGetTokenData,
    });
    mockAuthFns.mockGetTokenData.mockRejectedValue(new Error('DB connection error'));

    const provider = createProvider();
    const result = await provider.checkFreshness();

    expect(result.status).toBe('error');
    expect(result.message).toContain('Schwab token status check failed');
  });
});
