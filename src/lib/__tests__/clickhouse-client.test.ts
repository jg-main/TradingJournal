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
  ClickHouseConfig,
  OhlcBarSchema,
  DateRangeSchema,
  MarketEvidenceSchema,
  MarketEvidenceQuerySchema,
  FreshnessCheckSchema,
  FreshnessStatusSchema,
  createClickHouseClient,
  createDefaultClickHouseClient,
} from '../clickhouse-client';

// ── In-memory SQLite for createDefaultClickHouseClient DB queries ────────

const mockSqlite = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3');
  const sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.exec(`
    CREATE TABLE ai_settings (
      id TEXT PRIMARY KEY NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      api_key TEXT,
      base_url TEXT,
      timeout_ms INTEGER DEFAULT 30000,
      temperature REAL DEFAULT 0.7,
      max_tokens INTEGER DEFAULT 4096,
      system_prompt TEXT,
      clickhouse_host TEXT DEFAULT 'localhost',
      clickhouse_port INTEGER DEFAULT 8123,
      clickhouse_user TEXT DEFAULT 'default',
      clickhouse_password TEXT,
      clickhouse_database TEXT DEFAULT 'market',
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (current_timestamp),
      updated_at TEXT DEFAULT (current_timestamp)
    );
    CREATE TABLE market_data_settings (
      id TEXT PRIMARY KEY NOT NULL,
      active_provider TEXT NOT NULL DEFAULT 'clickhouse',
      providers TEXT NOT NULL DEFAULT '{}',
      created_at TEXT DEFAULT (current_timestamp),
      updated_at TEXT DEFAULT (current_timestamp)
    );
  `);
  return { sqlite };
});

vi.mock('@/db', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { drizzle } = require('drizzle-orm/better-sqlite3');
  const db = drizzle(mockSqlite.sqlite);
  return {
    db,
    getSqliteHandle: () => mockSqlite.sqlite,
    initializeDatabase: () => db,
  };
});

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

// ── DB Helpers ────────────────────────────────────────────────────────────

let fakeIdCounter = 0;

/**
 * Seed the in-memory market_data_settings table with ClickHouse config values.
 * Clears any existing rows first.
 */
function seedClickHouseConfig(overrides: Record<string, unknown> = {}): void {
  mockSqlite.sqlite.exec('DELETE FROM market_data_settings;');
  fakeIdCounter++;
  const id = `test-mds-${fakeIdCounter}`;
  const host = (overrides.host as string) ?? 'db-host.example.com';
  const port = overrides.port !== undefined ? Number(overrides.port) : 9000;
  const user = (overrides.user as string) ?? 'db_user';
  const password = (overrides.password as string) ?? 'db_secret';
  const database = (overrides.database as string) ?? 'db_market';

  const providers = JSON.stringify({
    clickhouse: { host, port, user, password, database },
  });

  const stmt = mockSqlite.sqlite.prepare(
    'INSERT INTO market_data_settings (id, active_provider, providers) VALUES (?, ?, ?)'
  );
  stmt.run(id, 'clickhouse', providers);
}

/** Clear all market_data_settings rows */
function clearClickHouseConfig(): void {
  mockSqlite.sqlite.exec('DELETE FROM market_data_settings;');
}

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
    // Clear DB rows between tests
    clearClickHouseConfig();
  });

  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  // ── All-defaults (no DB, no env) ──────────────────────────────────────

  it('uses defaults when env vars and DB are absent', () => {
    const client = createDefaultClickHouseClient();
    expect(client).toBeDefined();
    expect(client.getMarketEvidence).toBeInstanceOf(Function);
  });

  // ── DB-only config (no env vars) ─────────────────────────────────────

  it('reads host from DB when no env vars are set', () => {
    seedClickHouseConfig({ host: 'db-clickhouse.local' });
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const client = createDefaultClickHouseClient();
    expect(client).toBeDefined();
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const logArg = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(logArg.event).toBe('clickhouse_config_resolution');
    expect(logArg.source).toBe('database');
    expect(logArg.host).toBe('db-clickhouse.local');
    expect(logArg.port).toBe(9000);
    expect(logArg.user).toBe('db_user');
    expect(logArg.database).toBe('db_market');
    expect(logArg.hasPassword).toBe(true);
    consoleSpy.mockRestore();
  });

  it('reads all ClickHouse fields from DB', () => {
    seedClickHouseConfig({
      host: 'ch-db.internal',
      port: 8443,
      user: 'analyst',
      password: 'analyst_pass',
      database: 'analytics',
    });

    // The only way to verify the config was used is to create the client
    // and check that the created client can do its job. We capture config
    // via the structured log emitted by createDefaultClickHouseClient.
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    createDefaultClickHouseClient();
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const logArg = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(logArg.host).toBe('ch-db.internal');
    expect(logArg.port).toBe(8443);
    expect(logArg.user).toBe('analyst');
    expect(logArg.database).toBe('analytics');
    expect(logArg.hasPassword).toBe(true);
    consoleSpy.mockRestore();
  });

  it('uses DB password when set to empty string in DB', () => {
    seedClickHouseConfig({ password: '' });
    // Empty password in DB means isSet returns false → falls through to env ''
    // which is also empty — so password resolves to ''. Verify via log.
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    createDefaultClickHouseClient();
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const logArg = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(logArg.hasPassword).toBe(false);
    consoleSpy.mockRestore();
  });

  it('falls back to env when DB field is empty string', () => {
    // Seed DB with empty host → isSet returns false
    seedClickHouseConfig({ host: '' });
    process.env.CLICKHOUSE_HOST = 'env-host.example.com';

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    createDefaultClickHouseClient();
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const logArg = JSON.parse(consoleSpy.mock.calls[0][0]);
    // DB has empty host, env has the value → env wins
    expect(logArg.host).toBe('env-host.example.com');
    consoleSpy.mockRestore();
  });

  // ── Env-only config (no DB row) ──────────────────────────────────────

  it('reads CLICKHOUSE_HOST from env var when DB is empty', () => {
    process.env.CLICKHOUSE_HOST = 'clickhouse.example.com';
    const client = createDefaultClickHouseClient();
    expect(client).toBeDefined();
  });

  it('reads CLICKHOUSE_PORT from env var when DB is empty', () => {
    process.env.CLICKHOUSE_PORT = '9000';
    const client = createDefaultClickHouseClient();
    expect(client).toBeDefined();
  });

  it('reads CLICKHOUSE_USER from env var when DB is empty', () => {
    process.env.CLICKHOUSE_USER = 'analyst';
    const client = createDefaultClickHouseClient();
    expect(client).toBeDefined();
  });

  it('reads CLICKHOUSE_DATABASE from env var when DB is empty', () => {
    process.env.CLICKHOUSE_DATABASE = 'analytics';
    const client = createDefaultClickHouseClient();
    expect(client).toBeDefined();
  });

  it('reports env as configuration source in structured log', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    process.env.CLICKHOUSE_HOST = 'env-only.example.com';
    createDefaultClickHouseClient();
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const logArg = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(logArg.source).toBe('env');
    expect(logArg.host).toBe('env-only.example.com');
    consoleSpy.mockRestore();
  });

  it('reports defaults as configuration source when nothing is configured', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    createDefaultClickHouseClient();
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const logArg = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(logArg.source).toBe('defaults');
    expect(logArg.host).toBe('localhost');
    expect(logArg.port).toBe(8123);
    expect(logArg.user).toBe('default');
    expect(logArg.database).toBe('market');
    consoleSpy.mockRestore();
  });

  // ── Mixed: DB wins over env vars ─────────────────────────────────────

  it('DB value takes precedence over env var (host)', () => {
    seedClickHouseConfig({ host: 'db-host.example.com' });
    process.env.CLICKHOUSE_HOST = 'env-host.example.com';

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    createDefaultClickHouseClient();
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const logArg = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(logArg.source).toBe('database');
    expect(logArg.host).toBe('db-host.example.com');
    consoleSpy.mockRestore();
  });

  it('DB value takes precedence over env var (port)', () => {
    seedClickHouseConfig({ port: 8443 });
    process.env.CLICKHOUSE_PORT = '9999';

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    createDefaultClickHouseClient();
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const logArg = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(logArg.port).toBe(8443);
    consoleSpy.mockRestore();
  });

  it('DB value takes precedence over env var (password)', () => {
    seedClickHouseConfig({ password: 'db_pass_123' });
    process.env.CLICKHOUSE_PASSWORD = 'env_pass_456';

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    createDefaultClickHouseClient();
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const logArg = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(logArg.hasPassword).toBe(true);
    consoleSpy.mockRestore();
  });

  // ── Override takes precedence over everything ─────────────────────────

  it('configOverride host takes precedence over DB', () => {
    seedClickHouseConfig({ host: 'db-host.example.com' });
    const override: Partial<ClickHouseConfig> = { host: 'override-host.example.com' };

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    createDefaultClickHouseClient(override);
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const logArg = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(logArg.source).toBe('override');
    expect(logArg.host).toBe('override-host.example.com');
    consoleSpy.mockRestore();
  });

  it('partial configOverride only overrides specified fields', () => {
    seedClickHouseConfig({
      host: 'db-host.example.com',
      port: 8443,
      user: 'db_user',
      password: 'db_pass',
      database: 'db_market',
    });
    // Only override host — port, user, password, database should come from DB
    const override: Partial<ClickHouseConfig> = { host: 'override-host.com' };

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    createDefaultClickHouseClient(override);
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const logArg = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(logArg.source).toBe('override');
    expect(logArg.host).toBe('override-host.com');
    expect(logArg.port).toBe(8443);
    expect(logArg.user).toBe('db_user');
    expect(logArg.database).toBe('db_market');
    expect(logArg.hasPassword).toBe(true);
    consoleSpy.mockRestore();
  });

  it('configOverride takes precedence over env vars when no DB row exists', () => {
    process.env.CLICKHOUSE_HOST = 'env-host.example.com';
    const override: Partial<ClickHouseConfig> = { host: 'override-host.com', port: 3000 };

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    createDefaultClickHouseClient(override);
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const logArg = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(logArg.source).toBe('override');
    expect(logArg.host).toBe('override-host.com');
    expect(logArg.port).toBe(3000);
    consoleSpy.mockRestore();
  });

  // ── Error cases ───────────────────────────────────────────────────────

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

  it('throws for invalid port from DB with source annotation', () => {
    seedClickHouseConfig({ port: -1 });
    expect(() => createDefaultClickHouseClient()).toThrow('Source: database');
  });

  it('throws for invalid port from override with source annotation', () => {
    expect(() => createDefaultClickHouseClient({ port: 0 })).toThrow('Source: override');
  });
});

// ── FreshnessStatus Schema ────────────────────────────────────────────────

describe('FreshnessStatusSchema', () => {
  it('accepts "fresh"', () => {
    expect(FreshnessStatusSchema.parse('fresh')).toBe('fresh');
  });

  it('accepts "stale"', () => {
    expect(FreshnessStatusSchema.parse('stale')).toBe('stale');
  });

  it('accepts "error"', () => {
    expect(FreshnessStatusSchema.parse('error')).toBe('error');
  });

  it('rejects unknown status values', () => {
    const result = FreshnessStatusSchema.safeParse('unknown');
    expect(result.success).toBe(false);
  });

  it('rejects empty string', () => {
    const result = FreshnessStatusSchema.safeParse('');
    expect(result.success).toBe(false);
  });
});

// ── FreshnessCheck Schema ─────────────────────────────────────────────────

describe('FreshnessCheckSchema', () => {
  it('validates a fresh check result', () => {
    const result = FreshnessCheckSchema.safeParse({
      status: 'fresh',
      latestDate: '2024-01-03',
      threshold: '2024-01-03',
      message: 'Data is fresh',
    });
    expect(result.success).toBe(true);
  });

  it('validates a stale check result', () => {
    const result = FreshnessCheckSchema.safeParse({
      status: 'stale',
      latestDate: '2024-01-02',
      threshold: '2024-01-03',
      message: 'Data is stale',
    });
    expect(result.success).toBe(true);
  });

  it('validates an error check result without latestDate', () => {
    const result = FreshnessCheckSchema.safeParse({
      status: 'error',
      threshold: '2024-01-03',
      message: 'Freshness check failed',
    });
    expect(result.success).toBe(true);
  });

  it('rejects check with missing threshold', () => {
    const result = FreshnessCheckSchema.safeParse({
      status: 'fresh',
      latestDate: '2024-01-03',
      message: 'Data is fresh',
    });
    expect(result.success).toBe(false);
  });

  it('rejects check with invalid status enum', () => {
    const result = FreshnessCheckSchema.safeParse({
      status: 'partial',
      latestDate: '2024-01-03',
      threshold: '2024-01-03',
      message: 'Data is fresh',
    });
    expect(result.success).toBe(false);
  });

  it('rejects check with invalid latestDate format', () => {
    const result = FreshnessCheckSchema.safeParse({
      status: 'fresh',
      latestDate: '01-03-2024',
      threshold: '2024-01-03',
      message: 'Data is fresh',
    });
    expect(result.success).toBe(false);
  });
});

// ── Freshness Check (via client) ─────────────────────────────────────────

describe('checkFreshness', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    vi.useFakeTimers();
    // Pin "today" to 2024-01-04T12:00:00Z so threshold comparison is deterministic
    vi.setSystemTime(new Date('2024-01-04T12:00:00Z'));
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
  });

  it('returns fresh when latest data is within threshold', async () => {
    // System time = 2024-01-04, thresholdDays=1 => threshold = '2024-01-03'
    // latest_date = '2024-01-03', '2024-01-03' >= '2024-01-03' => fresh
    global.fetch = vi.fn().mockResolvedValueOnce(
      mockResponse(tabSeparatedBody(['latest_date'], [['2024-01-03']])),
    );

    const client = createClickHouseClient(DEFAULT_CONFIG);
    const result = await client.checkFreshness(1);

    expect(result.status).toBe('fresh');
    expect(result.latestDate).toBe('2024-01-03');
    expect(result.threshold).toBe('2024-01-03');
    expect(result.message).toContain('Data is fresh');
    expect(result.message).toContain('2024-01-03');
  });

  it('returns stale when latest data is older than threshold', async () => {
    // threshold = '2024-01-03', latest_date = '2024-01-02'
    // '2024-01-02' < '2024-01-03' => stale
    global.fetch = vi.fn().mockResolvedValueOnce(
      mockResponse(tabSeparatedBody(['latest_date'], [['2024-01-02']])),
    );

    const client = createClickHouseClient(DEFAULT_CONFIG);
    const result = await client.checkFreshness(1);

    expect(result.status).toBe('stale');
    expect(result.latestDate).toBe('2024-01-02');
    expect(result.threshold).toBe('2024-01-03');
    expect(result.message).toContain('Data is stale');
  });

  it('returns stale when table is empty (no data rows)', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      mockResponse(tabSeparatedBody(['latest_date'], [])),
    );

    const client = createClickHouseClient(DEFAULT_CONFIG);
    const result = await client.checkFreshness(1);

    expect(result.status).toBe('stale');
    expect(result.latestDate).toBeUndefined();
    expect(result.threshold).toBe('2024-01-03');
    expect(result.message).toContain('No market data found');
  });

  it('returns error on connection failure', async () => {
    global.fetch = vi.fn().mockRejectedValue(
      new Error('fetch failed: connect ECONNREFUSED localhost:8123'),
    );

    const client = createClickHouseClient(DEFAULT_CONFIG);
    const result = await client.checkFreshness(1);

    expect(result.status).toBe('error');
    expect(result.latestDate).toBeUndefined();
    expect(result.threshold).toBe('2024-01-03');
    expect(result.message).toContain('Freshness check failed');
    expect(result.message).toContain('ECONNREFUSED');
  });

  it('returns fresh with default threshold when not specified', async () => {
    // No argument: thresholdDays defaults to 1 => threshold = '2024-01-03'
    // latest_date = '2024-01-03' >= '2024-01-03' => fresh
    global.fetch = vi.fn().mockResolvedValueOnce(
      mockResponse(tabSeparatedBody(['latest_date'], [['2024-01-03']])),
    );

    const client = createClickHouseClient(DEFAULT_CONFIG);
    const result = await client.checkFreshness();

    expect(result.status).toBe('fresh');
    expect(result.threshold).toBe('2024-01-03');
  });

  it('respects custom thresholdDays parameter', async () => {
    // System time = 2024-01-10, thresholdDays=7 => threshold = '2024-01-03'
    // latest_date = '2024-01-02' < '2024-01-03' => stale
    vi.setSystemTime(new Date('2024-01-10T12:00:00Z'));

    global.fetch = vi.fn().mockResolvedValueOnce(
      mockResponse(tabSeparatedBody(['latest_date'], [['2024-01-02']])),
    );

    const client = createClickHouseClient(DEFAULT_CONFIG);
    const result = await client.checkFreshness(7);

    expect(result.status).toBe('stale');
    expect(result.latestDate).toBe('2024-01-02');
    expect(result.threshold).toBe('2024-01-03');
  });

  it('considers exact boundary match as fresh', async () => {
    // System time = 2024-01-04, thresholdDays=2 => threshold = '2024-01-02'
    // latest_date = '2024-01-02' == '2024-01-02' => fresh (boundary match)
    global.fetch = vi.fn().mockResolvedValueOnce(
      mockResponse(tabSeparatedBody(['latest_date'], [['2024-01-02']])),
    );

    const client = createClickHouseClient(DEFAULT_CONFIG);
    const result = await client.checkFreshness(2);

    expect(result.status).toBe('fresh');
    expect(result.latestDate).toBe('2024-01-02');
    expect(result.threshold).toBe('2024-01-02');
  });

  it('logs structured event on successful freshness check', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    global.fetch = vi.fn().mockResolvedValueOnce(
      mockResponse(tabSeparatedBody(['latest_date'], [['2024-01-03']])),
    );

    const client = createClickHouseClient(DEFAULT_CONFIG);
    await client.checkFreshness(1);

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const logArg = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(logArg.event).toBe('freshness_check');
    expect(logArg.database).toBe('market');
    expect(logArg.latestDate).toBe('2024-01-03');
    expect(logArg.status).toBe('fresh');
    expect(logArg.thresholdDays).toBe(1);

    consoleSpy.mockRestore();
  });

  it('logs error event on connection failure', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    global.fetch = vi.fn().mockRejectedValue(
      new Error('fetch failed: connect ECONNREFUSED'),
    );

    const client = createClickHouseClient(DEFAULT_CONFIG);
    await client.checkFreshness(1);

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const logArg = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(logArg.event).toBe('freshness_error');
    expect(logArg.database).toBe('market');
    expect(logArg.status).toBe('error');
    expect(logArg.error).toContain('ECONNREFUSED');

    consoleSpy.mockRestore();
  });

  it('returns stale for date just before threshold', async () => {
    // threshold='2024-01-03', latest_date='2024-01-02' (1 day before)
    // '2024-01-02' < '2024-01-03' => stale
    global.fetch = vi.fn().mockResolvedValueOnce(
      mockResponse(tabSeparatedBody(['latest_date'], [['2024-01-02']])),
    );

    const client = createClickHouseClient(DEFAULT_CONFIG);
    const result = await client.checkFreshness(1);

    expect(result.status).toBe('stale');
  });

  it('returns fresh for data from same day as threshold', async () => {
    // threshold='2024-01-03', latest_date='2024-01-03' (same day as threshold)
    // '2024-01-03' >= '2024-01-03' => fresh
    global.fetch = vi.fn().mockResolvedValueOnce(
      mockResponse(tabSeparatedBody(['latest_date'], [['2024-01-03']])),
    );

    const client = createClickHouseClient(DEFAULT_CONFIG);
    const result = await client.checkFreshness(1);

    expect(result.status).toBe('fresh');
  });
});
