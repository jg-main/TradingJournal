import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { trades, positionPriceSnapshots } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';

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
        fetchedAt: null,
        source: null,
        message: 'No price snapshot',
      });
    }

    return NextResponse.json({
      price: snapshot.price,
      marketState: snapshot.marketState,
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
