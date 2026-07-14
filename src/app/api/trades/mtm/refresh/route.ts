/**
 * POST /api/trades/mtm/refresh
 *
 * Batch refresh: fetches current quotes for all open trades from Yahoo Finance,
 * persists position_price_snapshots, and updates trades.current_price.
 *
 * Rate-limited to one successful refresh every 10 seconds.
 * Failed refreshes (no open trades, provider error before any update) do NOT
 * reset the cooldown timer — the next caller can retry immediately.
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { db } from '@/db';
import { trades, positionPriceSnapshots } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { resolveQuoteProvider } from '@/lib/market-data-resolver';

// ── Rate-limit state (in-memory, per-process) ──────────────────────────
// Resets on server restart / cold start. This is intentional — the cooldown
// is a safety valve against accidental rapid refreshes, not a hard throttle
// across deployments.

const RATE_LIMIT_MS = 10_000; // 10 seconds
let lastRefreshTimestampMs = 0;

/**
 * Reset the rate-limit cooldown timer (for testability).
 */
export function _resetRateLimit(): void {
  lastRefreshTimestampMs = 0;
}

/**
 * Get the current rate-limit state (for testability).
 */
export function _getRateLimitMs(): number {
  return RATE_LIMIT_MS;
}

/**
 * Get the remaining cooldown milliseconds (for testability).
 * Returns 0 when no cooldown is active.
 */
export function _getRemainingCooldownMs(): number {
  const elapsed = Date.now() - lastRefreshTimestampMs;
  return elapsed < RATE_LIMIT_MS ? RATE_LIMIT_MS - elapsed : 0;
}

// ── POST handler ──────────────────────────────────────────────────────

export async function POST(_request: NextRequest) {
  try {
    void _request;

    // ── Rate-limit check ──────────────────────────────────────────
    const now = Date.now();
    const elapsed = now - lastRefreshTimestampMs;

    if (elapsed < RATE_LIMIT_MS) {
      const retryAfter = Math.ceil((RATE_LIMIT_MS - elapsed) / 1000);
      return NextResponse.json(
        { error: 'Rate limited', retryAfter },
        {
          status: 429,
          headers: { 'Retry-After': String(retryAfter) },
        },
      );
    }

    // ── Find open trades ──────────────────────────────────────────
    const openTrades = db
      .select({ id: trades.id, symbol: trades.symbol, direction: trades.direction })
      .from(trades)
      .where(eq(trades.status, 'open'))
      .all();

    if (openTrades.length === 0) {
      // No open trades = no refresh performed. Do NOT reset the timer.
      return NextResponse.json({
        updated: 0,
        failed: [],
        timestamp: new Date().toISOString(),
      });
    }

    // ── Fetch quotes ──────────────────────────────────────────────
    const symbols = [...new Set(openTrades.map((t) => t.symbol))];
    const provider = resolveQuoteProvider();
    const quotes = await provider.getQuote(symbols);

    // ── Persist snapshots & update trade prices ───────────────────
    const quoteMap = new Map(quotes.map((q) => [q.symbol.toUpperCase(), q]));
    const nowISO = new Date().toISOString();

    const failed: string[] = [];
    let updated = 0;
    const seenTrades = new Set<string>();

    for (const trade of openTrades) {
      // Avoid double-counting trades with the same symbol
      if (seenTrades.has(trade.id)) continue;
      seenTrades.add(trade.id);

      const symbolUpper = trade.symbol.toUpperCase();
      const quote = quoteMap.get(symbolUpper);

      if (!quote || quote.price === null || quote.error) {
        failed.push(trade.symbol);
        continue;
      }

      try {
        // Persist snapshot
        db.insert(positionPriceSnapshots)
          .values({
            id: randomUUID(),
            tradeId: trade.id,
            price: quote.price,
            source: quote.source,
            marketState: quote.marketState,
            shortName: quote.shortName ?? null,
            quoteType: quote.quoteType ?? null,
            sector: quote.sector ?? null,
            industry: quote.industry ?? null,
            fetchedAt: nowISO,
            createdAt: nowISO,
          })
          .run();

        // Update trade's current price
        db.update(trades)
          .set({
            currentPrice: quote.price,
            currentPriceFetchedAt: nowISO,
            updatedAt: nowISO,
          })
          .where(eq(trades.id, trade.id))
          .run();

        updated++;
      } catch {
        failed.push(trade.symbol);
      }
    }

    // ── Update cooldown timer (only on success) ───────────────────
    // The timer resets only when at least one quote was successfully
    // persisted. If all quotes failed, the caller can retry immediately.
    if (updated > 0) {
      lastRefreshTimestampMs = Date.now();
    }

    return NextResponse.json({
      updated,
      failed,
      timestamp: nowISO,
    });
  } catch (error) {
    // Provider error before any update — do NOT reset the timer,
    // the caller can retry immediately.
    return NextResponse.json(
      { error: 'Failed to refresh MTM prices', details: String(error) },
      { status: 500 },
    );
  }
}
