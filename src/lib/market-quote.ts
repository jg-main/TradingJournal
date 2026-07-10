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
  marketState?: string;
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
  source: "yahoo" | "mock";
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
      // Network error or unexpected API failure — every symbol gets an error result
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
    return symbols.map((symbol) => {
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
  }

  /**
   * Map a single Yahoo Finance quote response to our canonical QuoteResult.
   */
  private parseQuote(raw: YahooRawQuote): QuoteResult {
    const now = new Date().toISOString();

    // Note: regularMarketPrice may be undefined for delisted/pre-market symbols
    const price =
      raw.regularMarketPrice != null ? Number(raw.regularMarketPrice) : null;

    return {
      symbol: raw.symbol ?? "UNKNOWN",
      price,
      marketState: raw.marketState ?? "UNKNOWN",
      fetchedAt: now,
      source: "yahoo",
    };
  }
}
