/**
 * market-quote.ts
 *
 * Price provider abstraction for fetching real-time and market-close stock quotes.
 * Defines the contract that all quote providers must implement, and the
 * canonical QuoteResult shape consumed by downstream consumers (trade
 * price snapshots, dashboard metrics, position sizing).
 *
 * Pattern: interface-based provider + default Yahoo Finance implementation.
 * Pure types and functions — no DB dependency.
 */

import YahooFinance from "yahoo-finance2";

// ── Yahoo Finance Raw Quote Shape ────────────────────────────────────────

/**
 * Minimum subset of fields we consume from Yahoo Finance's quote() response.
 * We use a string-indexed inline type to remain compatible with all Quote
 * union variants (QuoteBase defines [key: string]: any).
 */
type YahooRawQuote = Record<string, unknown> & {
  symbol?: string;
  regularMarketPrice?: number | null;
  regularMarketPreviousClose?: number | null;
  regularMarketDayHigh?: number | null;
  regularMarketDayLow?: number | null;
  regularMarketChange?: number | null;
  regularMarketChangePercent?: number | null;
  marketState?: string;
  shortName?: string;
  longName?: string;
  quoteType?: string;
};

// ── Quote Result Shape ───────────────────────────────────────────────────

export interface QuoteResult {
  /** Ticker symbol (e.g. "AAPL") */
  symbol: string;
  /** Latest traded price, or null when the market is closed / unavailable */
  price: number | null;
  /** Market state from the provider: "PRE", "REGULAR", "POST", "CLOSED", or "UNKNOWN" */
  marketState: string;
  /** ISO-8601 timestamp of when this quote was fetched */
  fetchedAt: string;
  /** Source identifier for provenance tracking */
  source: "yahoo" | "mock" | "schwab";
  /** Company short name from the provider (e.g. "Apple Inc.") */
  shortName?: string;
  /** Quote type from the provider (e.g. "EQUITY", "ETF") */
  quoteType?: string;
  /** Sector from the provider (e.g. "Technology") */
  sector?: string;
  /** Industry from the provider (e.g. "Consumer Electronics") */
  industry?: string;
  /** Previous trading day close price */
  previousClose?: number;
  /** Day high price */
  dayHigh?: number;
  /** Day low price */
  dayLow?: number;
  /** Absolute price change from previous close */
  change?: number;
  /** Percentage change from previous close */
  changePercent?: number;
  /** Human-readable error message when the quote could not be resolved */
  error?: string;
}

// ── Provider Contract ────────────────────────────────────────────────────

export interface MarketQuoteProvider {
  /**
   * Fetch current quotes for one or more symbols.
   * Returns one QuoteResult per input symbol, preserving input order.
   * When a symbol cannot be resolved, its result has price=null and an error message.
   */
  getQuote(symbols: string[]): Promise<QuoteResult[]>;
}

// ── Type guard ───────────────────────────────────────────────────────────

/**
 * Returns true when the quote has a valid (non-null) price.
 */
export function hasPrice(quote: QuoteResult): quote is QuoteResult & { price: number } {
  return quote.price !== null && quote.price !== undefined;
}

// ── Yahoo Finance Provider ───────────────────────────────────────────────

export class YahooFinanceProvider implements MarketQuoteProvider {
  private client: InstanceType<typeof YahooFinance>;

  constructor() {
    this.client = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
  }

  /**
   * Fetch current quotes for the given symbols from Yahoo Finance.
   * Preserves input order; missing/unresolved symbols get price=null + error.
   */
  async getQuote(symbols: string[]): Promise<QuoteResult[]> {
    if (symbols.length === 0) {
      return [];
    }

    let results: YahooRawQuote[];
    try {
      results = (await this.client.quote(symbols)) as YahooRawQuote[];
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const now = new Date().toISOString();
      return symbols.map((symbol) => ({
        symbol,
        price: null,
        marketState: "UNKNOWN",
        fetchedAt: now,
        source: "yahoo" as const,
        error: `Yahoo Finance API error: ${message}`,
      }));
    }

    const now = new Date().toISOString();
    const parsed = symbols.map((symbol) => {
      const match = results.find(
        (r) => r?.symbol?.toUpperCase() === symbol.toUpperCase(),
      );
      if (!match) {
        return {
          symbol,
          price: null,
          marketState: "UNKNOWN",
          fetchedAt: now,
          source: "yahoo" as const,
          error: `No quote data available for symbol: ${symbol}`,
        };
      }
      return this.parseQuote(match);
    });

    // ── Fetch asset profiles (sector/industry) ──
    const uniqueSymbols = [...new Set(parsed.filter(q => q.price != null).map(q => q.symbol))];
    const profiles = await this.fetchProfiles(uniqueSymbols);
    for (const quote of parsed) {
      const profile = profiles.get(quote.symbol);
      if (profile) {
        quote.sector = profile.sector;
        quote.industry = profile.industry;
      }
    }

    return parsed;
  }

  /**
   * Fetch asset profiles for symbols. Non-fatal — failures are logged but quotes still return.
   */
  private async fetchProfiles(symbols: string[]): Promise<Map<string, { sector?: string; industry?: string }>> {
    const map = new Map<string, { sector?: string; industry?: string }>();
    if (symbols.length === 0) return map;

    const results = await Promise.allSettled(
      symbols.map(async (symbol) => {
        const summary = await this.client.quoteSummary(symbol, { modules: ['assetProfile'] });
        const p = (summary as { assetProfile?: { sector?: string; industry?: string } })?.assetProfile;
        return {
          symbol,
          sector: typeof p?.sector === 'string' ? p.sector : undefined,
          industry: typeof p?.industry === 'string' ? p.industry : undefined,
        };
      }),
    );

    for (const r of results) {
      if (r.status === 'fulfilled') {
        map.set(r.value.symbol, { sector: r.value.sector, industry: r.value.industry });
      }
    }
    return map;
  }

  /**
   * Map a single Yahoo Finance quote response to our canonical QuoteResult.
   */
  private parseQuote(raw: YahooRawQuote): QuoteResult {
    const now = new Date().toISOString();

    // Note: regularMarketPrice may be undefined for delisted/pre-market symbols
    const price =
      raw.regularMarketPrice != null ? Number(raw.regularMarketPrice) : null;

    const previousClose =
      raw.regularMarketPreviousClose != null
        ? Number(raw.regularMarketPreviousClose)
        : null;
    const dayHigh =
      raw.regularMarketDayHigh != null
        ? Number(raw.regularMarketDayHigh)
        : null;
    const dayLow =
      raw.regularMarketDayLow != null
        ? Number(raw.regularMarketDayLow)
        : null;
    const change =
      raw.regularMarketChange != null
        ? Number(raw.regularMarketChange)
        : null;
    const changePercent =
      raw.regularMarketChangePercent != null
        ? Number(raw.regularMarketChangePercent)
        : null;

    return {
      symbol: raw.symbol ?? "UNKNOWN",
      price,
      previousClose: previousClose ?? undefined,
      dayHigh: dayHigh ?? undefined,
      dayLow: dayLow ?? undefined,
      change: change ?? undefined,
      changePercent: changePercent ?? undefined,
      marketState: raw.marketState ?? "UNKNOWN",
      fetchedAt: now,
      source: "yahoo",
      shortName: typeof raw.shortName === 'string' ? raw.shortName : undefined,
      quoteType: typeof raw.quoteType === 'string' ? raw.quoteType : undefined,
    };
  }
}

// ── Mock Provider (for testing) ──────────────────────────────────────────

/**
 * MockMarketQuoteProvider returns pre-configured quotes from a Map.
 * Symbols not in the map get an error result with price=null.
 * Use this in unit tests to avoid real network calls.
 *
 * @example
 * ```ts
 * const quotes = new Map([
 *   ['AAPL', createMockQuoteResult('AAPL', 178.5, 'REGULAR')],
 * ]);
 * const provider = new MockMarketQuoteProvider(quotes);
 * const results = await provider.getQuote(['AAPL']);
 * ```
 */
export class MockMarketQuoteProvider implements MarketQuoteProvider {
  private quotes: Map<string, QuoteResult>;

  constructor(quotes: Map<string, QuoteResult>) {
    this.quotes = quotes;
  }

  async getQuote(symbols: string[]): Promise<QuoteResult[]> {
    if (symbols.length === 0) {
      return [];
    }

    return symbols.map((symbol) => {
      const upper = symbol.toUpperCase();
      const q = this.quotes.get(upper);
      if (q) {
        return q;
      }
      return {
        symbol: upper,
        price: null,
        marketState: "UNKNOWN",
        fetchedAt: new Date().toISOString(),
        source: "mock" as const,
        error: `No mock quote configured for symbol: ${symbol}`,
      };
    });
  }
}

// ── OHLC Bar Type ────────────────────────────────────────────────────────

/**
 * A single OHLC close-price bar for RSI computation.
 * Only date and close are needed — no high/low/volume.
 */
export interface OhlcBarResponse {
  /** Trading date in YYYY-MM-DD format */
  date: string;
  /** Adjusted close price */
  close: number;
}

// ── Yahoo Finance OHLC Fallback ───────────────────────────────────────────

/**
 * Fetch OHLC daily close-price bars from Yahoo Finance.
 *
 * Used as a fallback when the primary OHLC provider (ClickHouse/Schwab)
 * is unavailable or returns empty data. Returns ~30 trading days of close
 * prices needed for 14-period RSI computation.
 *
 * Uses the yahoo-finance2 library's chart() method with daily interval
 * and 'array' return format.
 *
 * @param symbol - Ticker symbol (e.g. 'AAPL')
 * @param startDate - Start date YYYY-MM-DD (inclusive)
 * @param endDate - End date YYYY-MM-DD (inclusive)
 * @returns Array of { date, close } bars sorted by date ascending
 * @throws When the Yahoo Finance API call fails or returns no data
 *
 * Pattern: standalone async function (no class wrapper needed)
 */
export async function fetchYahooOhlcBars(
  symbol: string,
  startDate: string,
  endDate: string,
): Promise<OhlcBarResponse[]> {
  const yahoo = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

  const result = await yahoo.chart(symbol, {
    period1: startDate,
    period2: endDate,
    interval: '1d',
    return: 'array',
  });

  if (!result.quotes || result.quotes.length === 0) {
    throw new Error(`No OHLC data returned from Yahoo Finance for symbol: ${symbol}`);
  }

  return result.quotes
    .filter((q) => q.close != null)
    .map((q) => ({
      date: q.date.toISOString().split('T')[0],
      close: q.close!,
    }));
}

// ── Mock Quote Factory ───────────────────────────────────────────────────

/**
 * Factory function that creates a QuoteResult with source='mock'.
 * Useful in tests to build expected results with minimal boilerplate.
 *
 * @param symbol - Ticker symbol
 * @param price - Price value (or null for unavailable)
 * @param marketState - Market state string (defaults to "UNKNOWN")
 * @param dayHigh - Day high price (optional)
 * @param dayLow - Day low price (optional)
 */
export function createMockQuoteResult(
  symbol: string,
  price: number | null,
  marketState: string = "UNKNOWN",
  dayHigh?: number,
  dayLow?: number,
): QuoteResult {
  return {
    symbol,
    price,
    marketState,
    shortName: symbol,
    quoteType: 'EQUITY',
    sector: 'Technology',
    industry: 'Software',
    dayHigh,
    dayLow,
    fetchedAt: new Date().toISOString(),
    source: "mock",
  };
}
