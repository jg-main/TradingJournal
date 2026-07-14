import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { trades, positionPriceSnapshots } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';
import { resolveQuoteProvider } from '@/lib/market-data-resolver';

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

    // Persist snapshot and update trade
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
      fetchedAt: now,
    }).run();

    db.update(trades)
      .set({ currentPrice: quote.price, currentPriceFetchedAt: now })
      .where(eq(trades.id, id))
      .run();

    return NextResponse.json({
      price: quote.price,
      marketState: quote.marketState,
      shortName: quote.shortName ?? null,
      quoteType: quote.quoteType ?? null,
      sector: quote.sector ?? null,
      industry: quote.industry ?? null,
      fetchedAt: now,
      source: quote.source,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to refresh price', details: String(error) },
      { status: 500 },
    );
  }
}
