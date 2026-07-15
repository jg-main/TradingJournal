/**
 * schwab-provider.ts
 *
 * Schwab market data provider implementing both MarketOhlcProvider and
 * MarketQuoteProvider by wrapping @sudowealth/schwab-api.
 *
 * Maps Schwab's priceHistory candles to MarketEvidence (OhlcBar[]) and
 * Schwab's quote responses to QuoteResult[] with source='schwab'.
 * Handles TOKEN_EXPIRED gracefully by returning structured error results
 * instead of throwing.
 *
 * Usage (production):
 *   import { SchwabProvider } from './schwab-provider';
 *   const provider = SchwabProvider.fromAuthClient();
 *   if (provider) {
 *     const evidence = await provider.getOhlc({ symbol: 'AAPL', ... });
 *   }
 *
 * Usage (test / DI):
 *   const provider = new SchwabProvider(mockApiClient);
 *   const results = await provider.getQuote(['AAPL']);
 *
 * Pattern: interface-based provider (src/lib/market-ohlc-provider.ts),
 * src/lib/market-quote.ts. Constructor injection for testability.
 * Dependencies: @sudowealth/schwab-api, schwab-auth.ts.
 */

import { createApiClient } from '@sudowealth/schwab-api';
import type { SchwabApiClient } from '@sudowealth/schwab-api';
import { getAuthClient, schwabIsConfigured } from './schwab-auth';
import type {
  MarketOhlcProvider,
  OhlcQueryParams,
  FeatureTimeSeriesQueryParams,
  FreshnessQueryParams,
} from './market-ohlc-provider';
import type { MarketQuoteProvider, QuoteResult } from './market-quote';
import type {
  MarketEvidence,
  OhlcBar,
  FeatureTimeSeries,
  FreshnessCheck,
} from './clickhouse-client';

// ── Types ───────────────────────────────────────────────────────────────

/**
 * Internal type for a raw Schwab candle returned by the price history API.
 */
interface SchwabCandle {
  datetime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Internal type for a raw Schwab price history response.
 */
interface SchwabPriceHistoryResponse {
  candles?: SchwabCandle[];
  empty?: boolean;
  symbol?: string;
}

/**
 * Internal type for a raw Schwab quote response per symbol.
 */
interface SchwabQuoteData {
  assetMainType?: string;
  symbol?: string;
  shortName?: string;
  quote?: {
    lastPrice?: number;
    bidPrice?: number;
    askPrice?: number;
    securityStatus?: string;
    totalVolume?: number;
    netChange?: number;
    openPrice?: number;
    highPrice?: number;
    lowPrice?: number;
    closePrice?: number;
  };
  reference?: {
    cusip?: string;
    description?: string;
    exchange?: string;
    exchangeName?: string;
    isHardToBorrow?: boolean;
    isShortable?: boolean;
    fundamental?: {
      sector?: string;
      industry?: string;
    };
  };
}

// ── SchwabProvider ──────────────────────────────────────────────────────

/**
 * Schwab market data provider implementing both MarketOhlcProvider and
 * MarketQuoteProvider.
 *
 * Wraps the @sudowealth/schwab-api client and maps its responses to the
 * project's canonical market data types. All methods return structured
 * results — never throw.
 */
export class SchwabProvider implements MarketOhlcProvider, MarketQuoteProvider {
  readonly name = 'schwab';

  private apiClient: SchwabApiClient;

  /**
   * Create a SchwabProvider wrapping an existing SchwabApiClient instance.
   *
   * @param apiClient - A configured SchwabApiClient from @sudowealth/schwab-api
   */
  constructor(apiClient: SchwabApiClient) {
    this.apiClient = apiClient;
  }

  /**
   * Convenience factory: creates a SchwabProvider using the existing auth
   * client singleton from schwab-auth.ts.
   *
   * Applies rate-limit and retry middleware to the API client:
   *   - Rate limit: SCHWAB_RATE_LIMIT_RPM env var (default 120 req/min)
   *   - Retry attempts: SCHWAB_RETRY_MAX_ATTEMPTS env var (default 3)
   *   - Retry base delay: SCHWAB_RETRY_BASE_DELAY_MS env var (default 1000ms)
   *
   * Returns null when Schwab is not configured (env vars missing).
   * Use the constructor directly for tests with a mock API client.
   */
  static fromAuthClient(): SchwabProvider | null {
    if (!schwabIsConfigured()) return null;

    const authClient = getAuthClient();
    if (!authClient) return null;

    const rpm = SchwabProvider.readEnvInt('SCHWAB_RATE_LIMIT_RPM', 120);
    const retryAttempts = SchwabProvider.readEnvInt('SCHWAB_RETRY_MAX_ATTEMPTS', 3);
    const retryBaseDelayMs = SchwabProvider.readEnvInt('SCHWAB_RETRY_BASE_DELAY_MS', 1_000);

    const client = createApiClient({
      auth: authClient,
      middleware: {
        rateLimit: { maxRequests: rpm, windowMs: 60_000 },
        retry: { maxAttempts: retryAttempts, baseDelayMs: retryBaseDelayMs },
      },
    });
    return new SchwabProvider(client);
  }

  /**
   * Read an integer env var with a fallback default.
   * Returns the default if the env var is unset, empty, or not a valid integer.
   */
  private static readEnvInt(key: string, fallback: number): number {
    const raw = process.env[key];
    if (!raw) return fallback;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  // ── MarketQuoteProvider Implementation ────────────────────────────────

  /**
   * Fetch current quotes from Schwab for one or more symbols.
   *
   * Maps Schwab's quote response (keyed by symbol) to QuoteResult[],
   * preserving input order. Symbols that cannot be resolved or have errors
   * get price=null with an error message.
   */
  async getQuote(symbols: string[]): Promise<QuoteResult[]> {
    if (symbols.length === 0) return [];

    const now = new Date().toISOString();

    try {
      const response = (await this.apiClient.marketData.quotes.getQuotes({
        queryParams: {
          symbols: symbols,
          fields: ['quote', 'reference'],
        },
      })) as Record<string, SchwabQuoteData>;

      return symbols.map((symbol) => {
        const upper = symbol.toUpperCase();
        const data = response[upper];

        if (!data || !data.quote) {
          return {
            symbol: upper,
            price: null,
            marketState: 'UNKNOWN',
            fetchedAt: now,
            source: 'schwab',
            error: data
              ? 'No quote data available for symbol'
              : `No response data for symbol: ${symbol}`,
          };
        }

        return this.mapQuoteResult(data, upper, now);
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return symbols.map((symbol) => ({
        symbol: symbol.toUpperCase(),
        price: null,
        marketState: 'UNKNOWN',
        fetchedAt: now,
        source: 'schwab',
        error: `Schwab quote API error: ${message}`,
      }));
    }
  }

  /**
   * Map a single Schwab quote response entry to our canonical QuoteResult.
   */
  private mapQuoteResult(
    data: SchwabQuoteData,
    symbol: string,
    fetchedAt: string,
  ): QuoteResult {
    const price =
      data.quote?.lastPrice != null ? Number(data.quote.lastPrice) : null;

    // Map Schwab securityStatus to our marketState convention
    const marketState = this.mapSecurityStatus(data.quote?.securityStatus);

    // Resolve sector/industry from reference data if available
    const sector =
      typeof data.reference?.fundamental?.sector === 'string'
        ? data.reference.fundamental.sector
        : undefined;
    const industry =
      typeof data.reference?.fundamental?.industry === 'string'
        ? data.reference.fundamental.industry
        : undefined;

    // Schwab sometimes returns company name as reference.description instead
    // of top-level shortName.
    const shortName =
      typeof data.shortName === 'string'
        ? data.shortName
        : typeof data.reference?.description === 'string'
          ? data.reference.description
          : undefined;

    // Derive change, changePercent, dayHigh, dayLow, and previousClose from Schwab quote data
    // netChange: absolute price change from previous close
    // closePrice: previous trading day's close price (used as fallback for previousClose)
    // highPrice / lowPrice: current trading day's high and low prices
    const netChange =
      data.quote?.netChange != null ? Number(data.quote.netChange) : undefined;
    const previousClose =
      data.quote?.closePrice != null ? Number(data.quote.closePrice) : undefined;
    const dayHigh =
      data.quote?.highPrice != null ? Number(data.quote.highPrice) : undefined;
    const dayLow =
      data.quote?.lowPrice != null ? Number(data.quote.lowPrice) : undefined;
    const changePercent =
      netChange != null && previousClose != null && previousClose !== 0
        ? (netChange / previousClose) * 100
        : undefined;

    return {
      symbol,
      price,
      marketState,
      fetchedAt,
      source: 'schwab',
      shortName,
      quoteType: typeof data.assetMainType === 'string'
        ? data.assetMainType
        : typeof data.reference?.exchangeName === 'string'
          ? data.reference.exchangeName
          : undefined,
      sector,
      industry,
      change: netChange,
      changePercent: changePercent != null ? Math.round(changePercent * 100) / 100 : undefined,
      previousClose,
      dayHigh,
      dayLow,
    };
  }

  /**
   * Map Schwab's securityStatus to the project's marketState convention.
   *
   * Schwab's securityStatus describes data quality/timeliness:
   *   'Normal'    → Real-time data (market is likely open) → 'REGULAR'
   *   'Delayed'   → Delayed data (market may be open, data is 15-min delayed) → 'REGULAR'
   *   'Closed'    → Market is closed → 'CLOSED'
   *   null/other  → Can't determine → 'UNKNOWN'
   */
  private mapSecurityStatus(status?: string | null): string {
    if (!status) return 'UNKNOWN';

    const s = status.toLowerCase();
    if (s === 'normal' || s === 'delayed') return 'REGULAR';
    if (s === 'closed') return 'CLOSED';
    return 'UNKNOWN';
  }

  // ── MarketOhlcProvider Implementation ─────────────────────────────────

  /**
   * Retrieve OHLC price bars from Schwab's price history API.
   *
   * Maps Schwab priceHistory candles (datetime, open, high, low, close,
   * volume) to OhlcBar[] with vwap set to 0 (Schwab does not provide VWAP
   * in price history responses).
   *
   * For 'daily' frequency, uses Schwab's daily frequency type.
   * For '10m' frequency, uses Schwab's minute frequency type with frequency=10.
   */
  async getOhlc(params: OhlcQueryParams): Promise<MarketEvidence> {
    const startMs = new Date(params.startDate + 'T00:00:00Z').getTime();
    const endMs = new Date(params.endDate + 'T23:59:59Z').getTime();

    const isIntraday = params.frequency === '10m';

    try {
      const response = (await this.apiClient.marketData.priceHistory.getPriceHistory(
        {
          queryParams: {
            symbol: params.symbol,
            periodType: isIntraday ? 'day' : 'year',
            frequencyType: isIntraday ? 'minute' : 'daily',
            frequency: isIntraday ? 10 : 1,
            startDate: startMs,
            endDate: endMs,
            needExtendedHoursData: false,
          },
        },
      )) as SchwabPriceHistoryResponse;

      const candles = response.candles ?? [];

      if (candles.length === 0) {
        return {
          symbol: params.symbol,
          dataDateRange: { start: params.startDate, end: params.endDate },
          ohlc: [],
          notes: [
            `No price history data returned for '${params.symbol}' between ${params.startDate} and ${params.endDate}`,
          ],
        };
      }

      const bars: OhlcBar[] = [];
      for (const candle of candles) {
        const bar = this.mapCandleToOhlcBar(candle);
        if (bar) bars.push(bar);
      }

      const notes: string[] = [];
      if (bars.length < candles.length) {
        notes.push(
          `${candles.length - bars.length} candle(s) had invalid data and were skipped`,
        );
      }

      return {
        symbol: params.symbol,
        dataDateRange: { start: params.startDate, end: params.endDate },
        ohlc: bars,
        notes,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        symbol: params.symbol,
        dataDateRange: { start: params.startDate, end: params.endDate },
        ohlc: [],
        notes: [`Schwab price history API error: ${message}`],
        error: message,
      };
    }
  }

  /**
   * Map a single Schwab candle to our OhlcBar type.
   *
   * Returns null if the candle has invalid numeric data.
   * Schwab does not provide VWAP in price history, so we set vwap to 0.
   */
  private mapCandleToOhlcBar(candle: SchwabCandle): OhlcBar | null {
    const open = Number(candle.open);
    const high = Number(candle.high);
    const low = Number(candle.low);
    const close = Number(candle.close);
    const volume = Number(candle.volume);

    if (
      !Number.isFinite(open) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(close) ||
      !Number.isFinite(volume)
    ) {
      return null;
    }

    // Convert epoch ms to YYYY-MM-DD date string
    const date = new Date(candle.datetime).toISOString().slice(0, 10);

    return {
      date,
      open,
      high,
      low,
      close,
      volume,
      vwap: 0, // Schwab does not provide VWAP in price history
    };
  }

  /**
   * Retrieve feature time-series data from Schwab.
   *
   * Schwab does not provide feature indicator data (e.g., RSI, MACD, VWAP).
   * Returns an empty time series for each requested feature with an error
   * note explaining that Schwab does not support this query.
   */
  async getFeatureTimeSeries(
    params: FeatureTimeSeriesQueryParams,
  ): Promise<FeatureTimeSeries[]> {
    return params.features.map((feat) => ({
      id: feat.id,
      label: feat.label,
      data: [],
      error: `Schwab provider does not support feature time series. ` +
        `Use a ClickHouse-backed provider for indicator data.`,
    }));
  }

  /**
   * Check whether Schwab market data is "fresh".
   *
   * Since Schwab does not have a local database to query, this checks
   * the OAuth token status as a proxy:
   *   - Not configured → 'error'
   *   - Token expired / no tokens → 'stale' (re-authentication needed)
   *   - Valid token → 'fresh' (API is available for queries)
   *
   * Note: This does NOT verify that actual market data from a specific
   * date range is available — it only checks whether the provider is
   * capable of making API calls.
   */
  async checkFreshness(params?: FreshnessQueryParams): Promise<FreshnessCheck> {
    const thresholdDays = params?.thresholdDays ?? 1;
    const thresholdDate = new Date(
      Date.now() - thresholdDays * 86_400_000,
    );
    const thresholdStr = thresholdDate.toISOString().slice(0, 10);

    if (!schwabIsConfigured()) {
      return {
        status: 'error',
        threshold: thresholdStr,
        message:
          'Schwab API is not configured. Set SCHWAB_CLIENT_ID, SCHWAB_CLIENT_SECRET, and SCHWAB_REDIRECT_URI.',
      };
    }

    const authClient = getAuthClient();
    if (!authClient) {
      return {
        status: 'error',
        threshold: thresholdStr,
        message:
          'Schwab auth client could not be initialized. Check configuration and environment variables.',
      };
    }

    try {
      const tokenData = await authClient.getTokenData();

      if (!tokenData) {
        return {
          status: 'stale',
          threshold: thresholdStr,
          message:
            'No Schwab tokens found. The user must connect Schwab via the OAuth flow.',
        };
      }

      if (tokenData.expiresAt && tokenData.expiresAt < Date.now()) {
        const expiredDate = new Date(tokenData.expiresAt).toISOString();
        return {
          status: 'stale',
          threshold: thresholdStr,
          message: `Schwab tokens expired at ${expiredDate}. The user must re-authenticate via OAuth.`,
        };
      }

      return {
        status: 'fresh',
        latestDate: new Date().toISOString().slice(0, 10),
        threshold: thresholdStr,
        message:
          'Schwab provider is authenticated and tokens are valid. Market data API is available.',
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        status: 'error',
        threshold: thresholdStr,
        message: `Schwab token status check failed: ${message}`,
      };
    }
  }
}
