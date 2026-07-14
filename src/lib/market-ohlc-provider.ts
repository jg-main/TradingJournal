/**
 * market-ohlc-provider.ts
 *
 * Provider abstraction for OHLC market data sources.
 *
 * Defines a uniform interface (`MarketOhlcProvider`) so the assessment
 * engine and downstream consumers can query market data without depending
 * on a specific backend (ClickHouse, Schwab, Polygon, etc.).
 *
 * Re-exports all shared market-evidence types from clickhouse-client.ts
 * so consumers only need one import path.
 *
 * Pattern: src/lib/scorecard.ts (Zod-validated pure types, no DB dependency)
 */

// ── Re-exported Types ───────────────────────────────────────────────────

/**
 * Market evidence types are defined in clickhouse-client.ts alongside
 * their Zod schemas for validation.  We re-export them here so interface
 * consumers do not need to import from a concrete provider.
 */
export type {
  MarketEvidence,
  OhlcBar,
  DateRange,
  FeatureTimeSeries,
  FeatureDataPoint,
  FreshnessCheck,
  FreshnessStatus,
  MarketEvidenceQuery,
} from './clickhouse-client';

// ── Interface Query Params ───────────────────────────────────────────────

/**
 * Parameters for an OHLC data query.
 */
export interface OhlcQueryParams {
  /** Ticker symbol (e.g. 'AAPL') */
  symbol: string;
  /** Start date inclusive (YYYY-MM-DD) */
  startDate: string;
  /** End date inclusive (YYYY-MM-DD) */
  endDate: string;
  /** Bar frequency — daily (default) or 10-minute intraday */
  frequency?: 'daily' | '10m';
}

/**
 * Parameters for a feature time-series query.
 */
export interface FeatureTimeSeriesQueryParams {
  /** Ticker symbol (e.g. 'AAPL') */
  symbol: string;
  /** Feature columns to fetch, each with an id (column name) and human label */
  features: Array<{ id: string; label: string }>;
  /** Start date inclusive (YYYY-MM-DD) */
  startDate: string;
  /** End date inclusive (YYYY-MM-DD) */
  endDate: string;
}

/**
 * Optional parameters for a freshness check.
 */
export interface FreshnessQueryParams {
  /** Maximum allowed days since the latest data (default: 1) */
  thresholdDays?: number;
}

// ── Provider Interface ───────────────────────────────────────────────────

/**
 * Uniform contract for all OHLC market data providers.
 *
 * Every method returns a well-typed result — never throws — so callers
 * can uniformly inspect errors, notes, and result fields regardless of
 * which provider backs the implementation.
 */
export interface MarketOhlcProvider {
  /** Provider name for display and routing (e.g. 'clickhouse', 'schwab') */
  readonly name: string;

  /**
   * Retrieve OHLC price bars for a symbol over a date range.
   *
   * @param params - Query parameters including symbol, date range, and optional frequency
   * @returns A structured MarketEvidence bundle (never throws)
   */
  getOhlc(params: OhlcQueryParams): Promise<MarketEvidence>;

  /**
   * Retrieve time-series data for one or more feature columns.
   *
   * @param params - Query parameters including symbol, features, and date range
   * @returns One FeatureTimeSeries per requested column (never throws)
   */
  getFeatureTimeSeries(
    params: FeatureTimeSeriesQueryParams,
  ): Promise<FeatureTimeSeries[]>;

  /**
   * Check whether market data is fresh (within a threshold).
   *
   * @param params - Optional parameters (e.g. thresholdDays)
   * @returns A typed FreshnessCheck with status, latestDate, and message (never throws)
   */
  checkFreshness(params?: FreshnessQueryParams): Promise<FreshnessCheck>;
}
