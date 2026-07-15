/**
 * GET /api/watchlist/ohlc?symbol=AAPL
 *
 * Returns OHLC daily bars (date, close) for a symbol, covering ~60 calendar
 * days to ensure ~30 trading days for 14-period RSI computation.
 *
 * Resolution chain:
 *   1. resolveOhlcProvider() → ClickHouse (or Schwab if configured)
 *   2. If primary provider returns no bars → fall back to Yahoo Finance chart()
 *   3. If both fail → 502 with combined diagnostics
 *
 * Response shape:
 * ```json
 * {
 *   "symbol": "AAPL",
 *   "bars": [{ "date": "2026-06-15", "close": 178.5 }, ...],
 *   "source": "clickhouse",
 *   "fetchedAt": "2026-07-15T..."
 * }
 * ```
 *
 * Validation:
 *  - symbol: required, 1-20 alphanumeric/dot characters
 *
 * Error shapes:
 * - 400: Validation failure (missing/invalid symbol)
 * - 502: Both primary provider and Yahoo Finance fallback failed
 * - 500: Unexpected server error
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveOhlcProvider } from '@/lib/market-data-resolver';
import { fetchYahooOhlcBars } from '@/lib/market-quote';
import type { OhlcBarResponse } from '@/lib/market-quote';

const symbolRegex = /^[A-Za-z0-9.]{1,20}$/;

const querySchema = z.object({
  symbol: z.string().min(1, 'symbol parameter is required'),
});

/**
 * Compute a date string N days before today in YYYY-MM-DD format.
 */
function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const rawSymbol = (searchParams.get('symbol') ?? '').trim();
    const parsed = querySchema.safeParse({
      symbol: rawSymbol,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const symbol = parsed.data.symbol.toUpperCase();

    if (!symbolRegex.test(symbol)) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: {
            fieldErrors: {
              symbol: [
                'Symbol must be 1-20 alphanumeric characters, optionally with dots',
              ],
            },
          },
        },
        { status: 400 },
      );
    }

    // Query ~60 calendar days to ensure ~30 trading days for 14-period RSI
    const today = new Date().toISOString().split('T')[0];
    const daysBack = daysAgo(60);

    const fetchedAt = new Date().toISOString();

    // Step 1: Try primary OHLC provider (ClickHouse or Schwab)
    let bars: OhlcBarResponse[] = [];
    let source = '';
    let primaryError: string | undefined;

    try {
      const provider = resolveOhlcProvider('clickhouse');
      const result = await provider.getOhlc({
        symbol,
        startDate: daysBack,
        endDate: today,
      });

      if (result.error || result.ohlc.length === 0) {
        primaryError = result.error ?? 'No OHLC data from primary provider';
      } else {
        bars = result.ohlc
          .filter((bar) => bar.close > 0)
          .map((bar) => ({
            date: bar.date,
            close: bar.close,
          }));
        source = provider.name;
      }
    } catch (err: unknown) {
      primaryError = err instanceof Error ? err.message : String(err);
    }

    // Step 2: Fall back to Yahoo Finance when primary returned nothing
    if (bars.length === 0) {
      try {
        bars = await fetchYahooOhlcBars(symbol, daysBack, today);
        source = 'yahoo';

        console.log(
          JSON.stringify({
            event: 'ohlc_endpoint_fallback',
            symbol,
            barCount: bars.length,
            primaryError,
          }),
        );
      } catch (fallbackErr: unknown) {
        const fallbackError =
          fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);

        console.error(
          JSON.stringify({
            event: 'ohlc_endpoint_both_failed',
            symbol,
            primaryError,
            fallbackError,
          }),
        );

        return NextResponse.json(
          {
            error: 'Failed to fetch OHLC data',
            details: `Primary provider: ${primaryError ?? 'unknown'}. Fallback: ${fallbackError}`,
          },
          { status: 502 },
        );
      }
    }

    return NextResponse.json({
      symbol,
      bars,
      source,
      fetchedAt,
    });
  } catch (error: unknown) {
    console.error('Watchlist OHLC endpoint error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch OHLC data', details: String(error) },
      { status: 500 },
    );
  }
}
