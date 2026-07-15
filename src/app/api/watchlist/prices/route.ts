import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveQuoteProvider } from '@/lib/market-data-resolver';
import type { QuoteResult } from '@/lib/market-quote';

const symbolRegex = /^[A-Za-z0-9.]{1,20}$/;

const querySchema = z.object({
  symbols: z.string().min(1, 'symbols parameter is required'),
});

/**
 * GET /api/watchlist/prices?symbols=AAPL,MSFT,GOOGL
 *
 * Batch-resolves live prices for the given symbols using the configured
 * MarketQuoteProvider (YahooFinanceProvider by default). Returns prices as a
 * Record<string, QuoteResult> keyed by uppercase symbol.
 *
 * Validation:
 *  - symbols parameter is required and must be a comma-separated list
 *  - Each symbol: 1-20 alphanumeric characters, optionally with dots
 *  - Maximum 100 symbols per request
 *  - Duplicates are deduplicated (first occurrence wins order)
 *
 * Response shape:
 * ```json
 * {
 *   "prices": {
 *     "AAPL": { "symbol": "AAPL", "price": 178.5, "marketState": "REGULAR", "source": "yahoo", "fetchedAt": "..." },
 *     "MSFT": { "symbol": "MSFT", "price": null, "marketState": "UNKNOWN", "source": "yahoo", "fetchedAt": "...", "error": "..." }
 *   },
 *   "fetchedAt": "2026-07-15T..."
 * }
 * ```
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const parsed = querySchema.safeParse({
      symbols: searchParams.get('symbols'),
    });

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const rawSymbols = parsed.data.symbols
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (rawSymbols.length === 0) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: {
            fieldErrors: {
              symbols: ['At least one symbol is required'],
            },
          },
        },
        { status: 400 },
      );
    }

    // Validate each symbol format
    const invalidSymbols = rawSymbols.filter((s) => !symbolRegex.test(s));
    if (invalidSymbols.length > 0) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: {
            fieldErrors: {
              symbols: [
                `Invalid symbol format: ${invalidSymbols.join(', ')}. Symbols must be 1-20 alphanumeric characters, optionally with dots.`,
              ],
            },
          },
        },
        { status: 400 },
      );
    }

    // Limit to 100 symbols
    if (rawSymbols.length > 100) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: {
            fieldErrors: {
              symbols: ['Maximum of 100 symbols allowed'],
            },
          },
        },
        { status: 400 },
      );
    }

    // Deduplicate preserving insertion order
    const symbols = [...new Set(rawSymbols)];

    const provider = resolveQuoteProvider();
    const quotes = await provider.getQuote(symbols);

    // Build Record<string, QuoteResult> keyed by symbol
    const prices: Record<string, QuoteResult> = {};
    for (const quote of quotes) {
      prices[quote.symbol] = quote;
    }

    return NextResponse.json({
      prices,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Watchlist prices endpoint error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch prices', details: String(error) },
      { status: 500 },
    );
  }
}
