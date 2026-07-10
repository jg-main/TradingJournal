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
