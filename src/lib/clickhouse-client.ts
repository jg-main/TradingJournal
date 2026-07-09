/**
 * clickhouse-client.ts
 *
 * Typed ClickHouse market data client.
 *
 * Resolves ticker symbols to secids, queries OHLC+volume data by symbol and
 * date range, and returns structured MarketEvidence bundles via Zod-validated
 * types. All external failures (connection errors, missing symbols, empty
 * results) are captured in the evidence return value — never thrown.
 *
 * Connects via the ClickHouse HTTP interface (port 8123 by default) using
 * Node native fetch(). Responses are parsed as TabSeparatedWithNames.
 *
 * Pattern: src/lib/scorecard.ts (Zod-validated pure functions, no DB dependency)
 */

import { z } from 'zod';

// ── Zod Schemas ──────────────────────────────────────────────────────────

/**
 * A single OHLC price bar with volume and VWAP.
 *
 * All prices are adjusted (split/dividend-adjusted) values from the
 * as_us_equity_ohlc_daily table's adj* columns.
 */
export const OhlcBarSchema = z.object({
  /** Trading date in YYYY-MM-DD format */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  /** Adjusted open price */
  open: z.number(),
  /** Adjusted high price */
  high: z.number(),
  /** Adjusted low price */
  low: z.number(),
  /** Adjusted close price */
  close: z.number(),
  /** Adjusted daily volume */
  volume: z.number(),
  /** Adjusted daily VWAP */
  vwap: z.number(),
});

export type OhlcBar = z.infer<typeof OhlcBarSchema>;

/**
 * Optional date range metadata for the evidence query.
 */
export const DateRangeSchema = z.object({
  /** Start date in YYYY-MM-DD format */
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Start date must be YYYY-MM-DD'),
  /** End date in YYYY-MM-DD format */
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'End date must be YYYY-MM-DD'),
});

export type DateRange = z.infer<typeof DateRangeSchema>;

/**
 * Market evidence bundle — the core return type for market data queries.
 *
 * Designed for S04's assessment engine: always returns a valid object, never
 * throws. Callers inspect `error` and `notes` to determine data quality.
 *
 * - If the symbol is unknown: empty ohlc[], notes explain the missing symbol.
 * - If the ClickHouse connection fails: error string with diagnostics, notes.
 * - If the query succeeds: ohlc[], dataDateRange, and notes for any warnings.
 */
export const MarketEvidenceSchema = z.object({
  /** Queried ticker symbol */
  symbol: z.string().min(1, 'Symbol is required'),
  /** Resolved AlgoSeek secid (undefined if symbol not found) */
  secid: z.number().int().positive().optional(),
  /** Date range that was queried (undefined for connection failures) */
  dataDateRange: DateRangeSchema.optional(),
  /** OHLC price bars matching the query */
  ohlc: z.array(OhlcBarSchema),
  /** Diagnostic notes (missing symbol, empty range, warnings) */
  notes: z.array(z.string()),
  /** Fatal error string for connection failures; undefined on success */
  error: z.string().optional(),
});

export type MarketEvidence = z.infer<typeof MarketEvidenceSchema>;

// ── Input Query Schema ───────────────────────────────────────────────────

/**
 * Input contract for getMarketEvidence.
 */
export const MarketEvidenceQuerySchema = z.object({
  /** Ticker symbol to query (e.g. 'AAPL') */
  symbol: z.string().min(1, 'Query symbol is required'),
  /** Start date inclusive (YYYY-MM-DD) */
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'startDate must be YYYY-MM-DD'),
  /** End date inclusive (YYYY-MM-DD) */
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'endDate must be YYYY-MM-DD'),
});

export type MarketEvidenceQuery = z.infer<typeof MarketEvidenceQuerySchema>;

// ── Freshness Check Types ──────────────────────────────────────────────────

/**
 * Status of a freshness check.
 * - 'fresh': The latest data date is within the threshold.
 * - 'stale': The latest data date is older than the threshold.
 * - 'error': A connection or query error occurred.
 */
export const FreshnessStatusSchema = z.enum(['fresh', 'stale', 'error']);

export type FreshnessStatus = z.infer<typeof FreshnessStatusSchema>;

/**
 * Result of a market data freshness check.
 *
 * Provides the status, latest data date found in the database, the
 * threshold used for comparison, and a human-readable message.
 * When status is 'error', latestDate is omitted.
 */
export const FreshnessCheckSchema = z.object({
  status: FreshnessStatusSchema,
  /** Most recent tradedate found in the database (YYYY-MM-DD); undefined on error */
  latestDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Threshold date string (YYYY-MM-DD) used for the comparison */
  threshold: z.string(),
  /** Human-readable diagnostic message */
  message: z.string(),
});

export type FreshnessCheck = z.infer<typeof FreshnessCheckSchema>;

// ── Configuration ────────────────────────────────────────────────────────

/**
 * ClickHouse HTTP interface connection configuration.
 */
export interface ClickHouseConfig {
  /** ClickHouse hostname (default: 'localhost') */
  host: string;
  /** ClickHouse HTTP port (default: 8123) */
  port: number;
  /** ClickHouse user (default: 'default') */
  user: string;
  /** ClickHouse password */
  password: string;
  /** Database name (default: 'market') */
  database: string;
}

// ── Internal Helpers ─────────────────────────────────────────────────────

/**
 * Escape a string value for safe use in a ClickHouse SQL string literal.
 *
 * ClickHouse string literals use single quotes; backslash and single-quote
 * characters must be escaped. This is NOT a full SQL-injection panacea but
 * is sufficient for parameterized ticker symbols and date strings that the
 * application controls.
 */
function escapeSqlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Build the ClickHouse HTTP URL for raw SQL queries.
 *
 * Credentials are passed as query parameters because Node's native fetch()
 * rejects URLs with embedded user:password@ credentials (Fetch API spec).
 */
function buildClickHouseUrl(config: ClickHouseConfig): string {
  const encodedUser = encodeURIComponent(config.user);
  const encodedPass = encodeURIComponent(config.password);
  const encodedDb = encodeURIComponent(config.database);
  return `http://${config.host}:${config.port}/?user=${encodedUser}&password=${encodedPass}&database=${encodedDb}&default_format=TabSeparatedWithNames`;
}

/**
 * Parse a ClickHouse TabSeparatedWithNames response into an array of row
 * objects, using the header line as field names.
 *
 * TabSeparatedWithNames format:
 *   col1\tcol2\n
 *   val1\tval2\n
 *   val3\tval4\n
 *
 * Returns an empty array for empty result sets.
 */
function parseTabSeparated(text: string): Record<string, string>[] {
  const lines = text.trim().split('\n');
  if (lines.length < 2) {
    return [];
  }

  const headers = lines[0].split('\t');
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.length === 0) continue;

    const values = line.split('\t');
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length && j < values.length; j++) {
      row[headers[j]] = values[j];
    }
    rows.push(row);
  }

  return rows;
}

/**
 * Parse a string value as a number, returning NaN if not parseable.
 */
function parseNumeric(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

// ── Client Factory ───────────────────────────────────────────────────────

/**
 * Create a ClickHouse market data client.
 *
 * @param config - Connection configuration
 * @returns An object with getMarketEvidence for querying market data
 */
export function createClickHouseClient(config: ClickHouseConfig) {
  const baseUrl = buildClickHouseUrl(config);

  // ── HTTP Helper ─────────────────────────────────────────────────────

  /**
   * Execute a raw SQL query against ClickHouse and return parsed rows.
   * Returns null on connection/HTTP error.
   */
  async function querySql(sql: string): Promise<{
    rows: Record<string, string>[];
    error: string | null;
  }> {
    try {
      const response = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
        },
        body: sql,
        // Default signal — no explicit timeout; callers should manage via AbortController
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '(no body)');
        return {
          rows: [],
          error: `ClickHouse HTTP ${response.status}: ${body.slice(0, 500)}`,
        };
      }

      const text = await response.text();
      const rows = parseTabSeparated(text);
      return { rows, error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        rows: [],
        error: `ClickHouse connection error: ${message}`,
      };
    }
  }

  // ── Symbol Resolution ────────────────────────────────────────────────

  /**
   * Resolve a ticker symbol to a secid via as_secmaster_ticker_history.
   *
   * Returns undefined if the symbol is not found or not listed.
   */
  async function resolveSecid(symbol: string): Promise<{
    secid: number | undefined;
    note: string | undefined;
  }> {
    const escapedSymbol = escapeSqlString(symbol.toUpperCase().trim());

    const sql = [
      `SELECT secid`,
      `FROM ${config.database}.as_secmaster_ticker_history`,
      `WHERE ticker = '${escapedSymbol}'`,
      `  AND liststatus = 'L'`,
      `ORDER BY start_date DESC`,
      `LIMIT 1`,
    ].join('\n');

    const { rows, error } = await querySql(sql);

    if (error) {
      // Connection error during symbol resolution — propagate as a note
      return { secid: undefined, note: error };
    }

    if (rows.length === 0) {
      return {
        secid: undefined,
        note: `Symbol '${symbol}' not found or not listed in ClickHouse security master`,
      };
    }

    const secidVal = parseNumeric(rows[0].secid);
    if (Number.isNaN(secidVal)) {
      return {
        secid: undefined,
        note: `Symbol '${symbol}' resolved but secid is invalid: ${rows[0].secid}`,
      };
    }

    return { secid: secidVal, note: undefined };
  }

  // ── OHLC Query ───────────────────────────────────────────────────────

  /**
   * Query OHLC price bars for a secid over a date range.
   */
  async function queryOhlc(
    secid: number,
    startDate: string,
    endDate: string,
  ): Promise<{
    bars: OhlcBar[];
    error: string | null;
  }> {
    const escapedStart = escapeSqlString(startDate);
    const escapedEnd = escapeSqlString(endDate);

    const sql = [
      `SELECT`,
      `  tradedate,`,
      `  openadj,`,
      `  highadj,`,
      `  lowadj,`,
      `  closeadj,`,
      `  dailyvolumeadj,`,
      `  dailyvwapadj`,
      `FROM ${config.database}.as_us_equity_ohlc_daily`,
      `WHERE secid = ${secid}`,
      `  AND tradedate BETWEEN '${escapedStart}' AND '${escapedEnd}'`,
      `ORDER BY tradedate`,
    ].join('\n');

    const { rows, error } = await querySql(sql);

    if (error) {
      return { bars: [], error };
    }

    const bars: OhlcBar[] = [];

    for (const row of rows) {
      const open = parseNumeric(row.openadj);
      const high = parseNumeric(row.highadj);
      const low = parseNumeric(row.lowadj);
      const close = parseNumeric(row.closeadj);
      const volume = parseNumeric(row.dailyvolumeadj);
      const vwap = parseNumeric(row.dailyvwapadj);

      // Skip rows with invalid numeric data
      if (
        Number.isNaN(open) ||
        Number.isNaN(high) ||
        Number.isNaN(low) ||
        Number.isNaN(close) ||
        Number.isNaN(volume)
      ) {
        continue;
      }

      bars.push({
        date: row.tradedate,
        open,
        high,
        low,
        close,
        volume,
        vwap: Number.isNaN(vwap) ? 0 : vwap,
      });
    }

    return { bars, error: null };
  }

  // ── Freshness Check ─────────────────────────────────────────────────

  /**
   * Query the most recent tradedate in the as_us_equity_ohlc_daily table.
   *
   * Returns the latest trading date found, or null if the table is empty.
   * Returns an error string on connection failure.
   */
  async function getLatestDate(): Promise<{
    latestDate: string | null;
    error: string | null;
  }> {
    const sql = [
      `SELECT max(tradedate) AS latest_date`,
      `FROM ${config.database}.as_us_equity_ohlc_daily`,
    ].join('\n');

    const { rows, error } = await querySql(sql);

    if (error) {
      return { latestDate: null, error };
    }

    if (rows.length === 0 || rows[0].latest_date === null || rows[0].latest_date === '') {
      return { latestDate: null, error: null };
    }

    const latestDate = rows[0].latest_date;
    // Validate the date format (should be YYYY-MM-DD from ClickHouse)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(latestDate)) {
      return {
        latestDate: null,
        error: `Unexpected date format from ClickHouse: '${latestDate}'`,
      };
    }

    return { latestDate, error: null };
  }

  // ── Public API ───────────────────────────────────────────────────────

  /**
   * Retrieve market evidence for a ticker symbol and date range.
   *
   * Always returns a valid MarketEvidence object — never throws.
   * Inspect `error` for connection failures and `notes` for diagnostics.
   */
  async function getMarketEvidence(
    query: MarketEvidenceQuery,
  ): Promise<MarketEvidence> {
    const notes: string[] = [];

    // Step 1: Resolve symbol to secid
    const { secid, note: resolveNote } = await resolveSecid(query.symbol);

    if (resolveNote) {
      notes.push(resolveNote);
    }

    // If symbol not resolved, return empty evidence with notes
    // If a note contains 'connection error', also populate the error field
    // so callers can distinguish connectivity failures from missing symbols.
    if (secid === undefined) {
      const connectionError = notes.find(n => n.startsWith('ClickHouse connection error'));
      return {
        symbol: query.symbol,
        dataDateRange: { start: query.startDate, end: query.endDate },
        ohlc: [],
        notes,
        error: connectionError ?? undefined,
      };
    }

    // Step 2: Query OHLC data
    const { bars, error: ohlcError } = await queryOhlc(
      secid,
      query.startDate,
      query.endDate,
    );

    if (ohlcError) {
      // Connection failure — return evidence with error and whatever notes
      // we accumulated during symbol resolution
      return {
        symbol: query.symbol,
        secid,
        dataDateRange: { start: query.startDate, end: query.endDate },
        ohlc: [],
        notes: [...notes, ohlcError],
        error: ohlcError,
      };
    }

    if (bars.length === 0) {
      notes.push(
        `No OHLC data found for symbol '${query.symbol}' (secid=${secid}) between ${query.startDate} and ${query.endDate}`,
      );
    }

    return {
      symbol: query.symbol,
      secid,
      dataDateRange: { start: query.startDate, end: query.endDate },
      ohlc: bars,
      notes,
    };
  }

  /**
   * Check whether market data in ClickHouse is fresh (within threshold).
   *
   * Queries the most recent tradedate in the database and compares it
   * against today minus `thresholdDays` (default: 1). Returns a typed
   * FreshnessCheck with status, latestDate, threshold, and message.
   *
   * - 'fresh': The latest data date is >= the threshold date.
   * - 'stale': The latest data date is < the threshold date (or null/empty).
   * - 'error': A connection or query error occurred.
   *
   * Logs structured JSON for observability:
   *   On success: { event: 'freshness_check', database, latestDate, status, thresholdDays }
   *   On error:   { event: 'freshness_error', database, status: 'error', error: string }
   *
   * @param thresholdDays - Maximum allowed days since the latest data (default: 1)
   */
  async function checkFreshness(thresholdDays: number = 1): Promise<FreshnessCheck> {
    const today = new Date();
    const thresholdDate = new Date(today.getTime() - thresholdDays * 86_400_000);
    const thresholdStr = thresholdDate.toISOString().slice(0, 10); // YYYY-MM-DD

    const { latestDate, error } = await getLatestDate();

    if (error) {
      // Connection error during freshness query
      const logEntry = {
        event: 'freshness_error',
        database: config.database,
        status: 'error' as const,
        error,
      };
      console.log(JSON.stringify(logEntry));

      return {
        status: 'error',
        threshold: thresholdStr,
        message: `Freshness check failed: ${error}`,
      };
    }

    if (latestDate === null) {
      // No data in the table
      console.log(
        JSON.stringify({
          event: 'freshness_check',
          database: config.database,
          latestDate: null,
          status: 'stale',
          thresholdDays,
        }),
      );

      return {
        status: 'stale',
        threshold: thresholdStr,
        message: `No market data found in ${config.database}.as_us_equity_ohlc_daily`,
      };
    }

    // Compare dates as strings (YYYY-MM-DD is lexicographically comparable)
    const isFresh = latestDate >= thresholdStr;
    const status: FreshnessStatus = isFresh ? 'fresh' : 'stale';

    console.log(
      JSON.stringify({
        event: 'freshness_check',
        database: config.database,
        latestDate,
        status,
        thresholdDays,
      }),
    );

    return {
      status,
      latestDate,
      threshold: thresholdStr,
      message: isFresh
        ? `Data is fresh: latest tradedate ${latestDate} is within ${thresholdDays} day(s)`
        : `Data is stale: latest tradedate ${latestDate} is older than ${thresholdDays} day(s) (threshold: ${thresholdStr})`,
    };
  }

  return { getMarketEvidence, checkFreshness };
}

// ── Convenience Default Client ───────────────────────────────────────────

/**
 * Create a ClickHouse client using environment variables for configuration.
 *
 * Environment variables:
 *   CLICKHOUSE_HOST     (default: 'localhost')
 *   CLICKHOUSE_PORT     (default: '8123')
 *   CLICKHOUSE_USER     (default: 'default')
 *   CLICKHOUSE_PASSWORD (default: '')
 *   CLICKHOUSE_DATABASE (default: 'market')
 *
 * @returns A ClickHouse client instance
 */
export function createDefaultClickHouseClient(): ReturnType<typeof createClickHouseClient> {
  const config: ClickHouseConfig = {
    host: process.env.CLICKHOUSE_HOST || 'localhost',
    port: parseInt(process.env.CLICKHOUSE_PORT || '8123', 10),
    user: process.env.CLICKHOUSE_USER || 'default',
    password: process.env.CLICKHOUSE_PASSWORD || '',
    database: process.env.CLICKHOUSE_DATABASE || 'market',
  };

  // Validate port
  if (Number.isNaN(config.port) || config.port < 1 || config.port > 65535) {
    throw new Error(
      `Invalid CLICKHOUSE_PORT: '${process.env.CLICKHOUSE_PORT}'. Must be a valid port number (1-65535).`,
    );
  }

  return createClickHouseClient(config);
}
