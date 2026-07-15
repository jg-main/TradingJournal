import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { trades, positionPriceSnapshots } from '@/db/schema';
import { eq, desc, and } from 'drizzle-orm';
import { resolveQuoteProvider } from '@/lib/market-data-resolver';
import { fetchYahooProfiles } from '@/lib/profile-enricher';

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    // Verify trade exists
    const trade = db
      .select()
      .from(trades)
      .where(eq(trades.id, id))
      .get();

    if (!trade) {
      return NextResponse.json(
        { error: 'Trade not found' },
        { status: 404 },
      );
    }

    // Query latest price snapshot
    const snapshot = db
      .select({
        price: positionPriceSnapshots.price,
        marketState: positionPriceSnapshots.marketState,
        shortName: positionPriceSnapshots.shortName,
        quoteType: positionPriceSnapshots.quoteType,
        sector: positionPriceSnapshots.sector,
        industry: positionPriceSnapshots.industry,
        previousClose: positionPriceSnapshots.previousClose,
        dayHigh: positionPriceSnapshots.dayHigh,
        dayLow: positionPriceSnapshots.dayLow,
        change: positionPriceSnapshots.change,
        changePercent: positionPriceSnapshots.changePercent,
        fetchedAt: positionPriceSnapshots.fetchedAt,
        source: positionPriceSnapshots.source,
      })
      .from(positionPriceSnapshots)
      .where(eq(positionPriceSnapshots.tradeId, id))
      .orderBy(desc(positionPriceSnapshots.fetchedAt))
      .limit(1)
      .get();

    if (!snapshot) {
      return NextResponse.json({
        price: null,
        marketState: null,
        shortName: null,
        quoteType: null,
        sector: null,
        industry: null,
        previousClose: null,
        dayHigh: null,
        dayLow: null,
        change: null,
        changePercent: null,
        fetchedAt: null,
        source: null,
        message: 'No price snapshot',
      });
    }

    return NextResponse.json({
      price: snapshot.price,
      marketState: snapshot.marketState,
      shortName: snapshot.shortName ?? null,
      quoteType: snapshot.quoteType ?? null,
      sector: snapshot.sector ?? null,
      industry: snapshot.industry ?? null,
      previousClose: snapshot.previousClose ?? null,
      dayHigh: snapshot.dayHigh ?? null,
      dayLow: snapshot.dayLow ?? null,
      change: snapshot.change ?? null,
      changePercent: snapshot.changePercent ?? null,
      fetchedAt: snapshot.fetchedAt,
      source: snapshot.source,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch MTM snapshot', details: String(error) },
      { status: 500 },
    );
  }
}

/**
 * POST /api/trades/[id]/mtm — Refresh a single trade's price data from Yahoo.
 * Works for any trade status (open, closed, planned).
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const trade = db.select().from(trades).where(eq(trades.id, id)).get();
    if (!trade) {
      return NextResponse.json({ error: 'Trade not found' }, { status: 404 });
    }

    const provider = resolveQuoteProvider();
    const results = await provider.getQuote([trade.symbol]);
    const quote = results[0];

    if (!quote || quote.price == null) {
      return NextResponse.json({
        error: 'Could not fetch price',
        details: quote?.error ?? 'No data returned',
      }, { status: 502 });
    }

    // Persist snapshot
    const now = new Date().toISOString();
    db.insert(positionPriceSnapshots).values({
      id: crypto.randomUUID(),
      tradeId: id,
      price: quote.price,
      source: quote.source,
      marketState: quote.marketState ?? null,
      shortName: quote.shortName ?? null,
      quoteType: quote.quoteType ?? null,
      sector: quote.sector ?? null,
      industry: quote.industry ?? null,
      previousClose: quote.previousClose ?? null,
      dayHigh: quote.dayHigh ?? null,
      dayLow: quote.dayLow ?? null,
      change: quote.change ?? null,
      changePercent: quote.changePercent ?? null,
      fetchedAt: now,
    }).run();

    // Update trade's current price
    db.update(trades)
      .set({ currentPrice: quote.price, currentPriceFetchedAt: now })
      .where(eq(trades.id, id))
      .run();

    // ── Enrich NULL sector/industry from Yahoo profiles ────────────────
    // When the primary quote provider (e.g. Schwab) does not return
    // sector or industry metadata, fetch it from Yahoo Finance as
    // non-blocking enrichment. Only fills null fields — never overwrites
    // sector/industry already provided by the primary provider.
    // Failure is non-fatal — the snapshot remains as-is.
    const needsSector = quote.sector == null;
    const needsIndustry = quote.industry == null;
    if (needsSector || needsIndustry) {
      try {
        const profiles = await fetchYahooProfiles([trade.symbol]);
        const profile = profiles.get(trade.symbol.toUpperCase());
        if (profile) {
          const update: Record<string, string | null> = {};
          if (needsSector && profile.sector) update.sector = profile.sector;
          if (needsIndustry && profile.industry) update.industry = profile.industry;
          if (Object.keys(update).length > 0) {
            db.update(positionPriceSnapshots)
              .set(update)
              .where(
                and(
                  eq(positionPriceSnapshots.tradeId, id),
                  eq(positionPriceSnapshots.fetchedAt, now),
                ),
              )
              .run();
            console.log(
              JSON.stringify({
                event: 'mtm-single.enrichment',
                tradeId: id,
                symbol: trade.symbol,
                enriched: 1,
                unchanged: 0,
                errored: 0,
                total: 1,
                timestamp: now,
              }),
            );
          } else {
            console.log(
              JSON.stringify({
                event: 'mtm-single.enrichment',
                tradeId: id,
                symbol: trade.symbol,
                enriched: 0,
                unchanged: 1,
                errored: 0,
                total: 1,
                timestamp: now,
              }),
            );
          }
        } else {
          console.log(
            JSON.stringify({
              event: 'mtm-single.enrichment',
              tradeId: id,
              symbol: trade.symbol,
              enriched: 0,
              unchanged: 0,
              errored: 1,
              total: 1,
              timestamp: now,
            }),
          );
        }
      } catch (err) {
        // Non-fatal — enrichment failure leaves snapshots as-is.
        console.log(
          JSON.stringify({
            event: 'mtm-single.enrichment.error',
            tradeId: id,
            symbol: trade.symbol,
            error: String(err),
            timestamp: now,
          }),
        );
      }
    }

    // Read back the snapshot to return current state (possibly enriched)
    const enrichedSnapshot = db
      .select({
        price: positionPriceSnapshots.price,
        marketState: positionPriceSnapshots.marketState,
        shortName: positionPriceSnapshots.shortName,
        quoteType: positionPriceSnapshots.quoteType,
        sector: positionPriceSnapshots.sector,
        industry: positionPriceSnapshots.industry,
        previousClose: positionPriceSnapshots.previousClose,
        dayHigh: positionPriceSnapshots.dayHigh,
        dayLow: positionPriceSnapshots.dayLow,
        change: positionPriceSnapshots.change,
        changePercent: positionPriceSnapshots.changePercent,
        fetchedAt: positionPriceSnapshots.fetchedAt,
        source: positionPriceSnapshots.source,
      })
      .from(positionPriceSnapshots)
      .where(
        and(
          eq(positionPriceSnapshots.tradeId, id),
          eq(positionPriceSnapshots.fetchedAt, now),
        ),
      )
      .get();

    const result = enrichedSnapshot ?? {
      price: quote.price,
      marketState: quote.marketState ?? null,
      shortName: quote.shortName ?? null,
      quoteType: quote.quoteType ?? null,
      sector: quote.sector ?? null,
      industry: quote.industry ?? null,
      previousClose: quote.previousClose ?? null,
      dayHigh: quote.dayHigh ?? null,
      dayLow: quote.dayLow ?? null,
      change: quote.change ?? null,
      changePercent: quote.changePercent ?? null,
      fetchedAt: now,
      source: quote.source,
    };

    return NextResponse.json({
      price: result.price,
      marketState: result.marketState,
      shortName: result.shortName ?? null,
      quoteType: result.quoteType ?? null,
      sector: result.sector ?? null,
      industry: result.industry ?? null,
      previousClose: result.previousClose ?? null,
      dayHigh: result.dayHigh ?? null,
      dayLow: result.dayLow ?? null,
      change: result.change ?? null,
      changePercent: result.changePercent ?? null,
      fetchedAt: result.fetchedAt,
      source: result.source,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to refresh price', details: String(error) },
      { status: 500 },
    );
  }
}
