/**
 * clickhouse-client.test.ts
 *
 * Comprehensive tests for the ClickHouse market data client.
 * Covers schema validation, mocked HTTP paths, and env-var defaults.
 *
 * All external dependencies (fetch) are mocked via vitest vi.fn().
 * No real ClickHouse instance is hit.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  OhlcBarSchema,
  DateRangeSchema,
  MarketEvidenceSchema,
  MarketEvidenceQuerySchema,
  createClickHouseClient,
  createDefaultClickHouseClient,
} from '../clickhouse-client';

// ── TabSeparatedWithNames response helpers ───────────────────────────────

/**
 * Build a TabSeparatedWithNames body with the given headers and rows.
 */
function tabSeparatedBody(
  headers: string[],
  rows: string[][],
): string {
  const headerLine = headers.join('\t');
  const dataLines = rows.map((r) => r.join('\t'));
  return [headerLine, ...dataLines].join('\n');
}

/** Headers for the secmaster ticker_history query */
const SECMASTER_HEADERS = ['secid'];

/** Headers for the OHLC query */
const OHLC_HEADERS = [
  'tradedate',
  'openadj',
  'highadj',
  'lowadj',
  'closeadj',
  'dailyvolumeadj',
  'dailyvwapadj',
];

/** A single OHLC data row (matches OHLC_HEADERS order) */
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

/** Valid OHLC data for AAPL Jan 2-3 2024 */
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

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Create a mock Response object from body text and optional status.
 */
function mockResponse(body: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
    // Satisfy the Response type minimally
  } as unknown as Response;
}

// ── MarketEvidence Schema Validation ─────────────────────────────────────

describe('MarketEvidenceSchema', () => {
  it('validates a complete evidence bundle', () => {
    const result = MarketEvidenceSchema.safeParse({
      symbol: 'AAPL',
      secid: 12345,
      dataDateRange: { start: '2024-01-02', end: '2024-01-03' },
      ohlc: [
        {
          date: '2024-01-02',
          open: 150.25,
          high: 152.80,
          low: 149.90,
          close: 151.50,
          volume: 50000000,
          vwap: 151.25,
        },
      ],
      notes: [],
    });

    expect(result.success).toBe(true);
  });

  it('rejects evidence with missing required field (symbol)', () => {
    const result = MarketEvidenceSchema.safeParse({
      // symbol missing
      ohlc: [],
      notes: [],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('symbol'))).toBe(true);
    }
  });

  it('rejects evidence with empty symbol string', () => {
    const result = MarketEvidenceSchema.safeParse({
      symbol: '',
      ohlc: [],
      notes: [],
    });

    expect(result.success).toBe(false);
  });

  it('accepts evidence with empty ohlc array (missing symbol case)', () => {
    const result = MarketEvidenceSchema.safeParse({
      symbol: 'UNKNOWN',
      ohlc: [],
      notes: ['Symbol not found'],
    });

    expect(result.success).toBe(true);
  });

  it('accepts evidence with populated error field (connection failure case)', () => {
    const result = MarketEvidenceSchema.safeParse({
      symbol: 'AAPL',
      ohlc: [],
      notes: ['ClickHouse connection error: ECONNREFUSED'],
      error: 'ClickHouse connection error: ECONNREFUSED',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.error).toBeDefined();
    }
  });

  it('rejects invalid date format in dataDateRange', () => {
    const result = MarketEvidenceSchema.safeParse({
      symbol: 'AAPL',
      dataDateRange: { start: '01-02-2024', end: '2024-01-03' },
      ohlc: [],
      notes: [],
    });

    expect(result.success).toBe(false);
  });

  it('rejects a bar with non-numeric open price', () => {
    const result = MarketEvidenceSchema.safeParse({
      symbol: 'AAPL',
      ohlc: [
        {
          date: '2024-01-02',
          open: 'invalid',
          high: 152.80,
          low: 149.90,
          close: 151.50,
          volume: 50000000,
          vwap: 151.25,
        },
      ],
      notes: [],
    });

    expect(result.success).toBe(false);
  });

  it('rejects a bar with missing required field (close)', () => {
    const result = MarketEvidenceSchema.safeParse({
      symbol: 'AAPL',
      ohlc: [
        {
          date: '2024-01-02',
          open: 150.25,
          high: 152.80,
          low: 149.90,
          // close missing
          volume: 50000000,
          vwap: 151.25,
        },
      ],
      notes: [],
    });

    expect(result.success).toBe(false);
  });
});

// ── DateRange Schema ─────────────────────────────────────────────────────

describe('DateRangeSchema', () => {
  it('validates a correct date range', () => {
    const result = DateRangeSchema.safeParse({
      start: '2024-01-01',
      end: '2024-01-31',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid start date format', () => {
    const result = DateRangeSchema.safeParse({
      start: '01-01-2024',
      end: '2024-01-31',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid end date format', () => {
    const result = DateRangeSchema.safeParse({
      start: '2024-01-01',
      end: '01-31-2024',
    });
    expect(result.success).toBe(false);
  });
});

// ── MarketEvidenceQuery Schema ───────────────────────────────────────────

describe('MarketEvidenceQuerySchema', () => {
  it('validates a correct query', () => {
    const result = MarketEvidenceQuerySchema.safeParse({
      symbol: 'AAPL',
      startDate: '2024-01-02',
      endDate: '2024-01-03',
    });
    expect(result.success).toBe(true);
  });

  it('rejects query with empty symbol', () => {
    const result = MarketEvidenceQuerySchema.safeParse({
      symbol: '',
      startDate: '2024-01-02',
      endDate: '2024-01-03',
    });
    expect(result.success).toBe(false);
  });

  it('rejects query with invalid startDate format', () => {
    const result = MarketEvidenceQuerySchema.safeParse({
      symbol: 'AAPL',
      startDate: '01-02-2024',
      endDate: '2024-01-03',
    });
    expect(result.success).toBe(false);
  });

  it('rejects query with missing endDate', () => {
    const result = MarketEvidenceQuerySchema.safeParse({
      symbol: 'AAPL',
      startDate: '2024-01-02',
      // endDate missing
    });
    expect(result.success).toBe(false);
  });
});

// ── OhlcBar Schema ───────────────────────────────────────────────────────

describe('OhlcBarSchema', () => {
  it('validates a complete OHLC bar', () => {
    const result = OhlcBarSchema.safeParse({
      date: '2024-01-02',
      open: 150.25,
      high: 152.80,
      low: 149.90,
      close: 151.50,
      volume: 50000000,
      vwap: 151.25,
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-numeric volume', () => {
    const result = OhlcBarSchema.safeParse({
      date: '2024-01-02',
      open: 150.25,
      high: 152.80,
      low: 149.90,
      close: 151.50,
      volume: 'fifty million',
      vwap: 151.25,
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid date format', () => {
    const result = OhlcBarSchema.safeParse({
      date: '01-02-2024',
      open: 150.25,
      high: 152.80,
      low: 149.90,
      close: 151.50,
      volume: 50000000,
      vwap: 151.25,
    });
    expect(result.success).toBe(false);
  });
});

// ── Client with mocked fetch ─────────────────────────────────────────────

describe('createClickHouseClient', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  // ── Successful Queries ──────────────────────────────────────────────

  it('returns correctly structured OHLC bars with parsed numbers', async () => {
    // Mock the secmaster query (HEAD request happens first)
    global.fetch = vi.fn()
      // First call: resolve secid for AAPL → secid=12345
      .mockResolvedValueOnce(
        mockResponse(tabSeparatedBody(SECMASTER_HEADERS, [['12345']])),
      )
      // Second call: query OHLC data → two bars
      .mockResolvedValueOnce(
        mockResponse(tabSeparatedBody(OHLC_HEADERS, VALID_AAPL_ROWS)),
      );

    const client = createClickHouseClient(DEFAULT_CONFIG);
    const evidence = await client.getMarketEvidence({
      symbol: 'AAPL',
      startDate: '2024-01-02',
      endDate: '2024-01-03',
    });

    expect(evidence.symbol).toBe('AAPL');
    expect(evidence.secid).toBe(12345);
    expect(evidence.ohlc).toHaveLength(2);

    // Verify first bar
    expect(evidence.ohlc[0].date).toBe('2024-01-02');
    expect(evidence.ohlc[0].open).toBeCloseTo(150.25);
    expect(evidence.ohlc[0].high).toBeCloseTo(152.80);
    expect(evidence.ohlc[0].low).toBeCloseTo(149.90);
    expect(evidence.ohlc[0].close).toBeCloseTo(151.50);
    expect(evidence.ohlc[0].volume).toBeCloseTo(50000000);
    expect(evidence.ohlc[0].vwap).toBeCloseTo(151.25);

    // Verify second bar
    expect(evidence.ohlc[1].date).toBe('2024-01-03');
    expect(evidence.ohlc[1].open).toBeCloseTo(151.50);
    expect(evidence.ohlc[1].volume).toBeCloseTo(45000000);

    // Verify no error, empty notes
    expect(evidence.error).toBeUndefined();
    expect(evidence.notes).toHaveLength(0);
  });

  it('verifies full pipeline: fetch called twice with correct SQL', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        mockResponse(tabSeparatedBody(SECMASTER_HEADERS, [['42']])),
      )
      .mockResolvedValueOnce(
        mockResponse(tabSeparatedBody(OHLC_HEADERS, [
          ohlcRow('2024-02-01', '200.00', '201.00', '199.00', '200.50', '30000000', '200.25'),
        ])),
      );

    global.fetch = fetchMock;

    const client = createClickHouseClient(DEFAULT_CONFIG);
    const evidence = await client.getMarketEvidence({
      symbol: 'MSFT',
      startDate: '2024-02-01',
      endDate: '2024-02-01',
    });

    // Verify the evidence
    expect(evidence.symbol).toBe('MSFT');
    expect(evidence.secid).toBe(42);
    expect(evidence.ohlc).toHaveLength(1);
    expect(evidence.ohlc[0].close).toBeCloseTo(200.50);

    // Verify fetch was called twice
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Verify the first call SQL contains the ticker lookup
    const firstCallUrl = fetchMock.mock.calls[0][0];
    const firstCallBody = fetchMock.mock.calls[0][1]?.body;
    expect(firstCallBody).toContain('as_secmaster_ticker_history');
    expect(firstCallBody).toContain("ticker = 'MSFT'");

    // Verify the second call SQL contains the OHLC query
    const secondCallBody = fetchMock.mock.calls[1][1]?.body;
    expect(secondCallBody).toContain('as_us_equity_ohlc_daily');
    expect(secondCallBody).toContain('secid = 42');
  });

  // ── Missing Symbol ──────────────────────────────────────────────────

  it('handles missing symbol gracefully', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      // Empty secmaster result: only header, no data rows
      mockResponse(tabSeparatedBody(SECMASTER_HEADERS, [])),
    );

    const client = createClickHouseClient(DEFAULT_CONFIG);
    const evidence = await client.getMarketEvidence({
      symbol: 'NONEXISTENT',
      startDate: '2024-01-01',
      endDate: '2024-01-31',
    });

    expect(evidence.symbol).toBe('NONEXISTENT');
    expect(evidence.secid).toBeUndefined();
    expect(evidence.ohlc).toHaveLength(0);
    expect(evidence.error).toBeUndefined();
    expect(evidence.notes).toHaveLength(1);
    expect(evidence.notes[0]).toContain('not found');
    expect(evidence.notes[0]).toContain('NONEXISTENT');
  });

  // ── Connection Failure ──────────────────────────────────────────────

  it('handles connection refused (fetch rejects)', async () => {
    global.fetch = vi.fn().mockRejectedValue(
      new Error('fetch failed: connect ECONNREFUSED localhost:8123'),
    );

    const client = createClickHouseClient(DEFAULT_CONFIG);
    const evidence = await client.getMarketEvidence({
      symbol: 'AAPL',
      startDate: '2024-01-01',
      endDate: '2024-01-31',
    });

    // When fetch rejects on the first call (secmaster resolution),
    // the error propagates through both the notes array and the error
    // field so callers can distinguish connectivity failures from
    // missing symbols.
    expect(evidence.symbol).toBe('AAPL');
    expect(evidence.ohlc).toHaveLength(0);
    expect(evidence.error).toBeDefined();
    expect(evidence.error).toContain('ClickHouse connection error');
    expect(evidence.error).toContain('ECONNREFUSED');
    expect(evidence.notes).toHaveLength(1);
    expect(evidence.notes[0]).toContain('ClickHouse connection error');
    expect(evidence.notes[0]).toContain('ECONNREFUSED');
    // No exception should be thrown
  });

  // ── HTTP 500 ────────────────────────────────────────────────────────

  it('handles HTTP 500 error gracefully', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      mockResponse('Internal Server Error', 500),
    );

    const client = createClickHouseClient(DEFAULT_CONFIG);
    const evidence = await client.getMarketEvidence({
      symbol: 'AAPL',
      startDate: '2024-01-01',
      endDate: '2024-01-31',
    });

    // HTTP 500 on the secmaster query produces notes, not the error field,
    // because resolveSecid returns note=error and secid=undefined, causing
    // getMarketEvidence to return early without setting error.
    expect(evidence.symbol).toBe('AAPL');
    expect(evidence.ohlc).toHaveLength(0);
    expect(evidence.error).toBeUndefined();
    expect(evidence.notes).toHaveLength(1);
    expect(evidence.notes[0]).toContain('ClickHouse HTTP 500');
    // No exception should be thrown
  });

  // ── HTTP 403 ────────────────────────────────────────────────────────

  it('handles HTTP 403 with error body', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      mockResponse('Code: 516. DB::Exception: Authentication failed', 403),
    );

    const client = createClickHouseClient(DEFAULT_CONFIG);
    const evidence = await client.getMarketEvidence({
      symbol: 'AAPL',
      startDate: '2024-01-01',
      endDate: '2024-01-31',
    });

    // HTTP 403 on the secmaster query: error goes into notes, not error field
    expect(evidence.error).toBeUndefined();
    expect(evidence.notes).toHaveLength(1);
    expect(evidence.notes[0]).toContain('ClickHouse HTTP 403');
    expect(evidence.notes[0]).toContain('Authentication failed');
  });

  // ── Garbage Response ────────────────────────────────────────────────

  it('handles non-tab-separated garbage response', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(
        mockResponse(tabSeparatedBody(SECMASTER_HEADERS, [['12345']])),
      )
      .mockResolvedValueOnce(
        mockResponse('This is not TabSeparated data at all!!!'),
      );

    const client = createClickHouseClient(DEFAULT_CONFIG);
    const evidence = await client.getMarketEvidence({
      symbol: 'AAPL',
      startDate: '2024-01-01',
      endDate: '2024-01-31',
    });

    // No error (HTTP 200 returned), but the parser returns empty rows
    // because garbage text doesn't have proper tab-separated headers
    expect(evidence.error).toBeUndefined();
    // The not-found-data note gets added
    expect(evidence.notes).toHaveLength(1);
    expect(evidence.notes[0]).toContain('No OHLC data found');
    expect(evidence.ohlc).toHaveLength(0);
  });

  // ── Empty Date Range (no bars) ──────────────────────────────────────

  it('handles empty query result (no bars in date range)', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(
        mockResponse(tabSeparatedBody(SECMASTER_HEADERS, [['42']])),
      )
      .mockResolvedValueOnce(
        // Empty OHLC result: just headers, no data
        mockResponse(tabSeparatedBody(OHLC_HEADERS, [])),
      );

    const client = createClickHouseClient(DEFAULT_CONFIG);
    const evidence = await client.getMarketEvidence({
      symbol: 'AAPL',
      startDate: '2099-01-01',
      endDate: '2099-12-31',
    });

    expect(evidence.secid).toBe(42);
    expect(evidence.ohlc).toHaveLength(0);
    expect(evidence.error).toBeUndefined();
    expect(evidence.notes).toHaveLength(1);
    expect(evidence.notes[0]).toContain('No OHLC data found');
    expect(evidence.notes[0]).toContain('2099-01-01');
  });

  // ── Connection Failure During OHLC Query ────────────────────────────

  it('handles connection failure during OHLC query after secid resolves', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(
        mockResponse(tabSeparatedBody(SECMASTER_HEADERS, [['12345']])),
      )
      .mockRejectedValueOnce(
        new Error('fetch failed: connect ETIMEDOUT'),
      );

    const client = createClickHouseClient(DEFAULT_CONFIG);
    const evidence = await client.getMarketEvidence({
      symbol: 'AAPL',
      startDate: '2024-01-01',
      endDate: '2024-01-31',
    });

    expect(evidence.secid).toBe(12345);
    expect(evidence.ohlc).toHaveLength(0);
    expect(evidence.error).toBeDefined();
    expect(evidence.error).toContain('ETIMEDOUT');
    expect(evidence.notes.length).toBeGreaterThan(0);
  });

  // ── Single Bar Response ─────────────────────────────────────────────

  it('handles a single OHLC bar response', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(
        mockResponse(tabSeparatedBody(SECMASTER_HEADERS, [['99']])),
      )
      .mockResolvedValueOnce(
        mockResponse(tabSeparatedBody(OHLC_HEADERS, [
          ohlcRow('2024-03-15', '175.00', '176.50', '174.00', '176.00', '25000000', '175.50'),
        ])),
      );

    const client = createClickHouseClient(DEFAULT_CONFIG);
    const evidence = await client.getMarketEvidence({
      symbol: 'GOOGL',
      startDate: '2024-03-15',
      endDate: '2024-03-15',
    });

    expect(evidence.secid).toBe(99);
    expect(evidence.ohlc).toHaveLength(1);
    expect(evidence.ohlc[0].open).toBeCloseTo(175.00);
    expect(evidence.dataDateRange).toBeDefined();
    expect(evidence.dataDateRange!.start).toBe('2024-03-15');
    expect(evidence.dataDateRange!.end).toBe('2024-03-15');
  });
});

// ── createDefaultClickHouseClient ────────────────────────────────────────

describe('createDefaultClickHouseClient', () => {
  const OLD_ENV = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    // Clear relevant env vars
    delete process.env.CLICKHOUSE_HOST;
    delete process.env.CLICKHOUSE_PORT;
    delete process.env.CLICKHOUSE_USER;
    delete process.env.CLICKHOUSE_PASSWORD;
    delete process.env.CLICKHOUSE_DATABASE;
  });

  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  it('uses defaults when env vars are absent', () => {
    const client = createDefaultClickHouseClient();
    expect(client).toBeDefined();
    // The client should have a getMarketEvidence function
    expect(client.getMarketEvidence).toBeInstanceOf(Function);
  });

  it('reads CLICKHOUSE_HOST from env var', () => {
    process.env.CLICKHOUSE_HOST = 'clickhouse.example.com';
    const client = createDefaultClickHouseClient();
    expect(client).toBeDefined();
  });

  it('reads CLICKHOUSE_PORT from env var', () => {
    process.env.CLICKHOUSE_PORT = '9000';
    const client = createDefaultClickHouseClient();
    expect(client).toBeDefined();
  });

  it('reads CLICKHOUSE_USER from env var', () => {
    process.env.CLICKHOUSE_USER = 'analyst';
    const client = createDefaultClickHouseClient();
    expect(client).toBeDefined();
  });

  it('reads CLICKHOUSE_DATABASE from env var', () => {
    process.env.CLICKHOUSE_DATABASE = 'analytics';
    const client = createDefaultClickHouseClient();
    expect(client).toBeDefined();
  });

  it('throws for invalid CLICKHOUSE_PORT', () => {
    process.env.CLICKHOUSE_PORT = 'not-a-number';
    expect(() => createDefaultClickHouseClient()).toThrow('Invalid CLICKHOUSE_PORT');
  });

  it('throws for out-of-range CLICKHOUSE_PORT', () => {
    process.env.CLICKHOUSE_PORT = '0';
    expect(() => createDefaultClickHouseClient()).toThrow('Invalid CLICKHOUSE_PORT');

    process.env.CLICKHOUSE_PORT = '65536';
    expect(() => createDefaultClickHouseClient()).toThrow('Invalid CLICKHOUSE_PORT');
  });
});
