/**
 * POST /api/market-data/enrich-profiles
 *
 * Backfill endpoint that fetches sector and industry metadata for all symbols
 * in position_price_snapshots where those fields are currently NULL, using
 * Yahoo Finance's assetProfile API.
 *
 * Strategy: JOIN position_price_snapshots with trades to resolve symbol,
 * fetch sector/industry from Yahoo for each distinct symbol, then UPDATE
 * snapshot rows whose linked trade matches an enriched symbol.
 *
 * Response: { enriched, errored, total, timestamp }
 * - total: number of distinct symbols that had null sector/industry
 * - enriched: count of those symbols successfully enriched with sector/industry
 * - errored: count of symbols where Yahoo returned no profile data (absent from response map)
 * - timestamp: ISO timestamp of when the backfill was run
 *
 * Graceful degradation:
 * - Zero null rows → all counters are 0
 * - Partial failures → only failed symbols count as errored
 * - Yahoo API connection failure → 500 error with details
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { trades, positionPriceSnapshots } from '@/db/schema';
import { isNull, or, eq, and, inArray } from 'drizzle-orm';
import { fetchYahooProfiles } from '@/lib/profile-enricher';

// ── POST handler ──────────────────────────────────────────────────────

export async function POST(_request: NextRequest) {
  try {
    void _request;
    const nowISO = new Date().toISOString();

    // ── Find distinct symbols with null sector/industry ────────────
    // Symbol is on trades, not position_price_snapshots, so we JOIN.
    const rows = db
      .select({ symbol: trades.symbol })
      .from(positionPriceSnapshots)
      .innerJoin(trades, eq(positionPriceSnapshots.tradeId, trades.id))
      .where(
        or(
          isNull(positionPriceSnapshots.sector),
          isNull(positionPriceSnapshots.industry),
        ),
      )
      .all();

    const distinctSymbols = [...new Set(rows.map((r) => r.symbol))];

    if (distinctSymbols.length === 0) {
      return NextResponse.json({
        enriched: 0,
        errored: 0,
        total: 0,
        timestamp: nowISO,
      });
    }

    // ── Fetch profiles from Yahoo Finance ─────────────────────────
    const profiles = await fetchYahooProfiles(distinctSymbols);

    // ── Update rows for each successfully enriched symbol ─────────
    // position_price_snapshots has tradeId, not symbol. We resolve
    // trade IDs from trades for each enriched symbol, then update
    // snapshot rows whose tradeId is in that set AND still have null
    // sector or industry.
    let enriched = 0;
    let errored = 0;
    const enrichedSymbols: string[] = [];
    const erroredSymbols: string[] = [];

    for (const symbol of distinctSymbols) {
      const profile = profiles.get(symbol.toUpperCase());

      if (!profile || (!profile.sector && !profile.industry)) {
        // Symbol not returned or has no sector/industry data → count as error
        errored++;
        erroredSymbols.push(symbol);
        continue;
      }

      // Resolve trade IDs for this symbol
      const matchingTradeIds = db
        .select({ id: trades.id })
        .from(trades)
        .where(eq(trades.symbol, symbol))
        .all()
        .map((r) => r.id);

      if (matchingTradeIds.length === 0) continue;

      // Update snapshot rows for those trades where sector/industry is still null
      db.update(positionPriceSnapshots)
        .set({
          sector: profile.sector ?? null,
          industry: profile.industry ?? null,
        })
        .where(
          and(
            inArray(positionPriceSnapshots.tradeId, matchingTradeIds),
            or(
              isNull(positionPriceSnapshots.sector),
              isNull(positionPriceSnapshots.industry),
            ),
          ),
        )
        .run();

      enriched++;
      enrichedSymbols.push(symbol);
    }

    console.log(
      JSON.stringify({
        event: 'enrich-profiles.backfill',
        enriched,
        errored,
        total: distinctSymbols.length,
        enrichedSymbols,
        erroredSymbols,
        timestamp: nowISO,
      }),
    );

    return NextResponse.json({
      enriched,
      errored,
      total: distinctSymbols.length,
      timestamp: nowISO,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to enrich profiles', details: String(error) },
      { status: 500 },
    );
  }
}
