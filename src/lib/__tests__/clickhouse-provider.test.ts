/**
 * clickhouse-provider.test.ts
 *
 * Comprehensive tests for the ClickHouseProvider class.
 *
 * Verifies the MarketOhlcProvider interface contract, param-object mapping,
 * frequency handling, and constructor patterns (client instance vs config).
 *
 * All external dependencies (fetch) are mocked via vitest vi.fn().
 * No real ClickHouse instance is hit.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createClickHouseClient } from '../clickhouse-client';
import { ClickHouseProvider } from '../clickhouse-provider';
import type {
  MarketEvidence,
  FeatureTimeSeries,
  FreshnessCheck,
  OhlcQueryParams,
  FeatureTimeSeriesQueryParams,
  FreshnessQueryParams,
  MarketOhlcProvider,
} from '../market-ohlc-provider';

// ── In-memory SQLite mock for @/db (needed because clickhouse-client imports it) ─

vi.mock('@/db', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3');
  const sqlite = new Database(':memory:');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { drizzle } = require('drizzle-orm/better-sqlite3');
  const db = drizzle(sqlite);
  return {
    db,
    getSqliteHandle: () => sqlite,
    initializeDatabase: () => db,
  };
});

// ── TabSeparatedWithNames response helpers ───────────────────────────────

const SECMASTER_HEADERS = ['secid'];

const OHLC_HEADERS = [
  'tradedate',
  'openadj',
  'highadj',
  'lowadj',
  'closeadj',
  'dailyvolumeadj',
  'dailyvwapadj',
];

function ohlcRow(
  date: string,
  open: string,
  high: string,
  low: string,
  close: string,
  volume: string,
  vwap: string,
): string[] {
  return [date, open, high, low, close, volume, vwap];
}

function tabSeparatedBody(headers: string[], rows: string[][]): string {
  const headerLine = headers.join('\t');
  const dataLines = rows.map((r) => r.join('\t'));
  return [headerLine, ...dataLines].join('\n');
}

const VALID_AAPL_ROWS = [
  ohlcRow('2024-01-02', '150.25', '152.80', '149.90', '151.50', '50000000', '151.25'),
  ohlcRow('2024-01-03', '151.50', '153.00', '150.00', '152.75', '45000000', '152.00'),
];

const DEFAULT_CONFIG = {
  host: 'localhost',
  port: 8123,
  user: 'default',
  password: '',
  database: 'market',
};

function mockResponse(body: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

// ── Interface Contract ───────────────────────────────────────────────────

describe('ClickHouseProvider interface contract', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('implements MarketOhlcProvider interface', () => {
    global.fetch = vi.fn().mockResolvedValue(mockResponse(''));
    const client = createClickHouseClient(DEFAULT_CONFIG);
    const provider = new ClickHouseProvider(client);

    // Structural interface check — all required methods exist
    const providerAny = provider as Record<string, unknown>;
    expect(typeof providerAny.name).toBe('string');
    expect(typeof providerAny.getOhlc).toBe('function');
    expect(typeof providerAny.getFeatureTimeSeries).toBe('function');
    expect(typeof providerAny.checkFreshness).toBe('function');
  });

  it('has name property set to "clickhouse"', () => {
    global.fetch = vi.fn().mockResolvedValue(mockResponse(''));
    const client = createClickHouseClient(DEFAULT_CONFIG);
    const provider = new ClickHouseProvider(client);

    expect(provider.name).toBe('clickhouse');
  });
});

// ── Constructor Patterns ─────────────────────────────────────────────────

describe('ClickHouseProvider constructor', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('accepts a client instance', () => {
    global.fetch = vi.fn().mockResolvedValue(mockResponse(''));
    const client = createClickHouseClient(DEFAULT_CONFIG);
    const provider = new ClickHouseProvider(client);

    expect(provider).toBeInstanceOf(ClickHouseProvider);
    expect(provider.name).toBe('clickhouse');
  });

  it('accepts a ClickHouseConfig and creates its own client', () => {
    global.fetch = vi.fn().mockResolvedValue(mockResponse(''));
    const provider = new ClickHouseProvider(DEFAULT_CONFIG);

    expect(provider).toBeInstanceOf(ClickHouseProvider);
    expect(provider.name).toBe('clickhouse');
  });

  it('accepts a config only when creating new client', () => {
    global.fetch = vi.fn().mockResolvedValue(mockResponse(''));
    const provider = new ClickHouseProvider({
      host: 'custom-host',
      port: 9999,
      user: 'custom_user',
      password: 'secret',
      database: 'custom_db',
    });

    expect(provider).toBeInstanceOf(ClickHouseProvider);
  });
});

// ── getOhlc ──────────────────────────────────────────────────────────────

describe('ClickHouseProvider.getOhlc', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns OHLC bars for a valid symbol with daily frequency', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(
        mockResponse(tabSeparatedBody(SECMASTER_HEADERS, [['12345']])),
      )
      .mockResolvedValueOnce(
        mockResponse(tabSeparatedBody(OHLC_HEADERS, VALID_AAPL_ROWS)),
      );

    const client = createClickHouseClient(DEFAULT_CONFIG);
    const provider = new ClickHouseProvider(client);

    const result = await provider.getOhlc({
      symbol: 'AAPL',
      startDate: '2024-01-02',
      endDate: '2024-01-03',
      frequency: 'daily',
    });

    expect(result.symbol).toBe('AAPL');
    expect(result.secid).toBe(12345);
    expect(result.ohlc).toHaveLength(2);
    expect(result.ohlc[0].date).toBe('2024-01-02');
    expect(result.ohlc[0].close).toBeCloseTo(151.50);
    expect(result.ohlc[1].close).toBeCloseTo(152.75);
    expect(result.error).toBeUndefined();
  });

  it('works without frequency (defaults to daily)', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(
        mockResponse(tabSeparatedBody(SECMASTER_HEADERS, [['42']])),
      )
      .mockResolvedValueOnce(
        mockResponse(tabSeparatedBody(OHLC_HEADERS, [
          ohlcRow('2024-02-01', '200.00', '201.00', '199.00', '200.50', '30000000', '200.25'),
        ])),
      );

    const client = createClickHouseClient(DEFAULT_CONFIG);
    const provider = new ClickHouseProvider(client);

    const result = await provider.getOhlc({
      symbol: 'MSFT',
      startDate: '2024-02-01',
      endDate: '2024-02-01',
    });

    expect(result.symbol).toBe('MSFT');
    expect(result.secid).toBe(42);
    expect(result.ohlc).toHaveLength(1);
    expect(result.ohlc[0].close).toBeCloseTo(200.50);
    expect(result.error).toBeUndefined();
  });

  it('returns empty result with note for 10m intraday frequency', async () => {
    const client = createClickHouseClient(DEFAULT_CONFIG);
    const provider = new ClickHouseProvider(client);

    const result = await provider.getOhlc({
      symbol: 'AAPL',
      startDate: '2024-01-02',
      endDate: '2024-01-03',
      frequency: '10m',
    });

    expect(result.symbol).toBe('AAPL');
    expect(result.ohlc).toHaveLength(0);
    expect(result.dataDateRange).toBeDefined();
    expect(result.dataDateRange!.start).toBe('2024-01-02');
    expect(result.dataDateRange!.end).toBe('2024-01-03');
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]).toContain('Intraday');
    expect(result.notes[0]).toContain('10m');
    expect(result.notes[0]).toContain('not yet implemented');
    expect(result.error).toBeUndefined();
  });

  it('handles missing symbol gracefully', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      mockResponse(tabSeparatedBody(SECMASTER_HEADERS, [])),
    );

    const client = createClickHouseClient(DEFAULT_CONFIG);
    const provider = new ClickHouseProvider(client);

    const result = await provider.getOhlc({
      symbol: 'NONEXISTENT',
      startDate: '2024-01-01',
      endDate: '2024-01-31',
    });

    expect(result.symbol).toBe('NONEXISTENT');
    expect(result.secid).toBeUndefined();
    expect(result.ohlc).toHaveLength(0);
    expect(result.error).toBeUndefined();
    expect(result.notes[0]).toContain('not found');
  });

  it('handles connection failure', async () => {
    global.fetch = vi.fn().mockRejectedValue(
      new Error('fetch failed: connect ECONNREFUSED'),
    );

    const client = createClickHouseClient(DEFAULT_CONFIG);
    const provider = new ClickHouseProvider(client);

    const result = await provider.getOhlc({
      symbol: 'AAPL',
      startDate: '2024-01-01',
      endDate: '2024-01-31',
    });

    expect(result.ohlc).toHaveLength(0);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('ECONNREFUSED');
  });

  it('handles empty result (no bars in date range)', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(
        mockResponse(tabSeparatedBody(SECMASTER_HEADERS, [['42']])),
      )
      .mockResolvedValueOnce(
        mockResponse(tabSeparatedBody(OHLC_HEADERS, [])),
      );

    const client = createClickHouseClient(DEFAULT_CONFIG);
    const provider = new ClickHouseProvider(client);

    const result = await provider.getOhlc({
      symbol: 'AAPL',
      startDate: '2099-01-01',
      endDate: '2099-12-31',
    });

    expect(result.secid).toBe(42);
    expect(result.ohlc).toHaveLength(0);
    expect(result.notes[0]).toContain('No OHLC data found');
  });
});

// ── getFeatureTimeSeries ─────────────────────────────────────────────────

describe('ClickHouseProvider.getFeatureTimeSeries', () => {
  let originalFetch: typeof global.fetch;

  const FEATURE_HEADERS = ['date', 'close', 'log_return_1d'];

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns feature time series for valid symbol and features', async () => {
    global.fetch = vi.fn()
      // First call: resolve secid
      .mockResolvedValueOnce(
        mockResponse(tabSeparatedBody(SECMASTER_HEADERS, [['12345']])),
      );

    const client = createClickHouseClient(DEFAULT_CONFIG);
    const provider = new ClickHouseProvider(client);

    // The getFeatureTimeSeries makes one fetch call per feature,
    // so after secmaster resolution, each feature gets its own call
    global.fetch = vi.fn()
      .mockResolvedValueOnce(
        mockResponse(tabSeparatedBody(SECMASTER_HEADERS, [['12345']])),
      )
      // First feature: close
      .mockResolvedValueOnce(
        mockResponse(tabSeparatedBody(
          ['date', 'close'],
          [['2024-01-02', '151.50'], ['2024-01-03', '152.75']],
        )),
      );

    const result = await provider.getFeatureTimeSeries({
      symbol: 'AAPL',
      features: [{ id: 'close', label: 'Close Price' }],
      startDate: '2024-01-02',
      endDate: '2024-01-03',
    });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('close');
    expect(result[0].label).toBe('Close Price');
    expect(result[0].data).toHaveLength(2);
    expect(result[0].data[0].value).toBeCloseTo(151.50);
    expect(result[0].data[1].value).toBeCloseTo(152.75);
    expect(result[0].error).toBeUndefined();
  });

  it('returns multiple feature series', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(
        mockResponse(tabSeparatedBody(SECMASTER_HEADERS, [['12345']])),
      )
      // close
      .mockResolvedValueOnce(
        mockResponse(tabSeparatedBody(
          ['date', 'close'],
          [['2024-01-02', '151.50']],
        )),
      )
      // log_return_1d
      .mockResolvedValueOnce(
        mockResponse(tabSeparatedBody(
          ['date', 'log_return_1d'],
          [['2024-01-02', '0.0125']],
        )),
      );

    const client = createClickHouseClient(DEFAULT_CONFIG);
    const provider = new ClickHouseProvider(client);

    const result = await provider.getFeatureTimeSeries({
      symbol: 'AAPL',
      features: [
        { id: 'close', label: 'Close Price' },
        { id: 'log_return_1d', label: '1-Day Log Return' },
      ],
      startDate: '2024-01-02',
      endDate: '2024-01-02',
    });

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('close');
    expect(result[0].data).toHaveLength(1);
    expect(result[1].id).toBe('log_return_1d');
    expect(result[1].data).toHaveLength(1);
  });

  it('returns error entry for unknown symbol', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      mockResponse(tabSeparatedBody(SECMASTER_HEADERS, [])),
    );

    const client = createClickHouseClient(DEFAULT_CONFIG);
    const provider = new ClickHouseProvider(client);

    const result = await provider.getFeatureTimeSeries({
      symbol: 'UNKNOWN',
      features: [{ id: 'close', label: 'Close Price' }],
      startDate: '2024-01-01',
      endDate: '2024-01-31',
    });

    expect(result).toHaveLength(1);
    expect(result[0].error).toBeDefined();
    expect(result[0].error).toContain('not found');
  });

  it('returns empty data array when no rows returned', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(
        mockResponse(tabSeparatedBody(SECMASTER_HEADERS, [['42']])),
      )
      .mockResolvedValueOnce(
        mockResponse(tabSeparatedBody(
          ['date', 'close'],
          [],
        )),
      );

    const client = createClickHouseClient(DEFAULT_CONFIG);
    const provider = new ClickHouseProvider(client);

    const result = await provider.getFeatureTimeSeries({
      symbol: 'AAPL',
      features: [{ id: 'close', label: 'Close Price' }],
      startDate: '2099-01-01',
      endDate: '2099-12-31',
    });

    expect(result).toHaveLength(1);
    expect(result[0].data).toHaveLength(0);
    expect(result[0].error).toBeUndefined();
  });
});

// ── checkFreshness ────────────────────────────────────────────────────────

describe('ClickHouseProvider.checkFreshness', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-04T12:00:00Z'));
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
  });

  it('returns fresh when data is within default threshold', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      mockResponse(tabSeparatedBody(['latest_date'], [['2024-01-03']])),
    );

    const client = createClickHouseClient(DEFAULT_CONFIG);
    const provider = new ClickHouseProvider(client);

    const result = await provider.checkFreshness();

    expect(result.status).toBe('fresh');
    expect(result.latestDate).toBe('2024-01-03');
    expect(result.threshold).toBe('2024-01-03');
  });

  it('returns stale when data exceeds custom threshold', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      mockResponse(tabSeparatedBody(['latest_date'], [['2024-01-02']])),
    );

    const client = createClickHouseClient(DEFAULT_CONFIG);
    const provider = new ClickHouseProvider(client);

    const result = await provider.checkFreshness({ thresholdDays: 1 });

    expect(result.status).toBe('stale');
    expect(result.latestDate).toBe('2024-01-02');
    expect(result.threshold).toBe('2024-01-03');
    expect(result.message).toContain('stale');
  });

  it('accepts thresholdDays via params object', async () => {
    // System time = 2024-01-04, thresholdDays=7 => threshold = 2023-12-28
    // latest_date = 2024-01-02 >= 2023-12-28 => fresh
    global.fetch = vi.fn().mockResolvedValueOnce(
      mockResponse(tabSeparatedBody(['latest_date'], [['2024-01-02']])),
    );

    const client = createClickHouseClient(DEFAULT_CONFIG);
    const provider = new ClickHouseProvider(client);

    const result = await provider.checkFreshness({ thresholdDays: 7 });

    expect(result.status).toBe('fresh');
    expect(result.threshold).toBe('2023-12-28');
  });

  it('returns error on connection failure', async () => {
    global.fetch = vi.fn().mockRejectedValue(
      new Error('fetch failed: connect ECONNREFUSED'),
    );

    const client = createClickHouseClient(DEFAULT_CONFIG);
    const provider = new ClickHouseProvider(client);

    const result = await provider.checkFreshness();

    expect(result.status).toBe('error');
    expect(result.message).toContain('Freshness check failed');
  });

  it('works without params object (undefined)', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      mockResponse(tabSeparatedBody(['latest_date'], [['2024-01-03']])),
    );

    const client = createClickHouseClient(DEFAULT_CONFIG);
    const provider = new ClickHouseProvider(client);

    const result = await provider.checkFreshness();

    expect(result.status).toBe('fresh');
  });
});

// ── Negative Tests ───────────────────────────────────────────────────────

describe('ClickHouseProvider negative tests', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('getOhlc handles empty symbol gracefully (returns no data)', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      mockResponse(tabSeparatedBody(SECMASTER_HEADERS, [])),
    );

    const client = createClickHouseClient(DEFAULT_CONFIG);
    const provider = new ClickHouseProvider(client);

    const result = await provider.getOhlc({
      symbol: '',
      startDate: '2024-01-01',
      endDate: '2024-01-31',
    });

    expect(result.ohlc).toHaveLength(0);
    expect(result.notes.some(n => n.includes('not found') || n.includes('empty'))).toBe(true);
  });

  it('getOhlc handles HTTP 500 error gracefully', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      mockResponse('Internal Server Error', 500),
    );

    const client = createClickHouseClient(DEFAULT_CONFIG);
    const provider = new ClickHouseProvider(client);

    const result = await provider.getOhlc({
      symbol: 'AAPL',
      startDate: '2024-01-01',
      endDate: '2024-01-31',
    });

    expect(result.ohlc).toHaveLength(0);
    expect(result.notes[0]).toContain('ClickHouse HTTP 500');
  });

  it('getOhlc never throws for any input', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const client = createClickHouseClient(DEFAULT_CONFIG);
    const provider = new ClickHouseProvider(client);

    // Various null/undefined/empty scenarios
    const result1 = await provider.getOhlc({
      symbol: 'AAPL',
      startDate: '',
      endDate: '',
    });
    expect(result1.ohlc).toHaveLength(0);

    const result2 = await provider.getOhlc({
      symbol: '',
      startDate: 'invalid',
      endDate: 'invalid',
    });
    expect(result2.ohlc).toHaveLength(0);
  });

  it('checkFreshness returns error for malformed date response', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      mockResponse(tabSeparatedBody(['latest_date'], [['not-a-date']])),
    );

    const client = createClickHouseClient(DEFAULT_CONFIG);
    const provider = new ClickHouseProvider(client);

    const result = await provider.checkFreshness();

    // The non-YYYY-MM-DD date falls through validation — the client
    // handles this as an error case
    expect(result.status).toBe('error');
    expect(result.message).toContain('Freshness');
  });

  it('getFeatureTimeSeries handles invalid feature column name', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      mockResponse(tabSeparatedBody(SECMASTER_HEADERS, [['42']])),
    );

    const client = createClickHouseClient(DEFAULT_CONFIG);
    const provider = new ClickHouseProvider(client);

    const result = await provider.getFeatureTimeSeries({
      symbol: 'AAPL',
      features: [{ id: 'invalid-column!', label: 'Bad Column' }],
      startDate: '2024-01-01',
      endDate: '2024-01-31',
    });

    expect(result).toHaveLength(1);
    expect(result[0].error).toBeDefined();
    expect(result[0].error).toContain('Invalid column name');
  });
});

// ── Provider Integration / Composition ───────────────────────────────────

describe('ClickHouseProvider composition', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('can be used polymorphically through MarketOhlcProvider type', () => {
    global.fetch = vi.fn().mockResolvedValue(mockResponse(''));
    const client = createClickHouseClient(DEFAULT_CONFIG);
    const provider: MarketOhlcProvider = new ClickHouseProvider(client);

    expect(provider.name).toBe('clickhouse');
    expect(typeof provider.getOhlc).toBe('function');
    expect(typeof provider.getFeatureTimeSeries).toBe('function');
    expect(typeof provider.checkFreshness).toBe('function');
  });

  it('creates provider with ClickHouseConfig in constructor', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(
        mockResponse(tabSeparatedBody(SECMASTER_HEADERS, [['99']])),
      )
      .mockResolvedValueOnce(
        mockResponse(tabSeparatedBody(OHLC_HEADERS, [
          ohlcRow('2024-03-15', '175.00', '176.50', '174.00', '176.00', '25000000', '175.50'),
        ])),
      );

    // Construct with config instead of client instance
    const provider = new ClickHouseProvider(DEFAULT_CONFIG);

    const result = await provider.getOhlc({
      symbol: 'GOOGL',
      startDate: '2024-03-15',
      endDate: '2024-03-15',
    });

    expect(result.secid).toBe(99);
    expect(result.ohlc).toHaveLength(1);
    expect(result.ohlc[0].close).toBeCloseTo(176.00);
  });

  it('supports sequential operations on the same provider instance', async () => {
    // System time = 2024-01-04, thresholdDays=1 => threshold = 2024-01-03
    // latest_date = 2024-01-03 >= 2024-01-03 => fresh
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-04T12:00:00Z'));

    global.fetch = vi.fn()
      .mockResolvedValueOnce(
        mockResponse(tabSeparatedBody(SECMASTER_HEADERS, [['42']])),
      )
      .mockResolvedValueOnce(
        mockResponse(tabSeparatedBody(OHLC_HEADERS, [
          ohlcRow('2024-01-02', '150.00', '151.00', '149.00', '150.50', '40000000', '150.25'),
        ])),
      )
      .mockResolvedValueOnce(
        mockResponse(tabSeparatedBody(['latest_date'], [['2024-01-03']])),
      );

    const client = createClickHouseClient(DEFAULT_CONFIG);
    const provider = new ClickHouseProvider(client);

    // First operation: getOhlc
    const ohlc = await provider.getOhlc({
      symbol: 'AAPL',
      startDate: '2024-01-02',
      endDate: '2024-01-02',
    });
    expect(ohlc.ohlc).toHaveLength(1);
    expect(ohlc.ohlc[0].close).toBeCloseTo(150.50);

    // Second operation: checkFreshness
    const freshness = await provider.checkFreshness({ thresholdDays: 1 });
    expect(freshness.status).toBe('fresh');

    vi.useRealTimers();
  });
});
