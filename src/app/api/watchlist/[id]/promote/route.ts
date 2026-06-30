import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { watchlistItems, trades, settings, accounts } from '@/db/schema';
import { eq, sql } from 'drizzle-orm';

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    // 1. Validate watchlist item exists
    const item = db
      .select()
      .from(watchlistItems)
      .where(eq(watchlistItems.id, id))
      .get();

    if (!item) {
      return NextResponse.json(
        { error: 'Watchlist item not found' },
        { status: 404 }
      );
    }

    // 2. Check it hasn't already been promoted
    if (item.promotedTradeId) {
      return NextResponse.json(
        { error: 'Watchlist item has already been promoted', promotedTradeId: item.promotedTradeId },
        { status: 409 }
      );
    }

    // 3. Find target account: settings.defaultAccountId first, then first active account
    const setting = db.select().from(settings).get();
    let accountId: string | undefined;

    if (setting?.defaultAccountId) {
      accountId = setting.defaultAccountId;
    } else {
      const firstActive = db
        .select()
        .from(accounts)
        .where(eq(accounts.isActive, true))
        .get();
      accountId = firstActive?.id;
    }

    if (!accountId) {
      return NextResponse.json(
        { error: 'No active account found. Create an account first or set a default account in settings.' },
        { status: 400 }
      );
    }

    // 4. Generate tradeCode: T-XXXX
    const countResult = db
      .select({ count: sql<number>`COUNT(*)` })
      .from(trades)
      .get();

    const nextNumber = (countResult?.count ?? 0) + 1;
    const tradeCode = `T-${String(nextNumber).padStart(4, '0')}`;

    // 5. Create the trade
    const tradeId = crypto.randomUUID();
    const now = new Date().toISOString();

    db.insert(trades)
      .values({
        id: tradeId,
        tradeCode,
        accountId,
        symbol: item.symbol,
        direction: item.direction,
        sectorId: item.sectorId,
        setupId: item.setupId,
        status: 'planned',
        thesis: item.thesis,
        plannedEntry: item.triggerPrice,
        plannedStop: item.plannedStop,
        plannedTarget1: item.targetPrice,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    // 6. Update watchlist item
    db.update(watchlistItems)
      .set({
        status: 'triggered',
        promotedTradeId: tradeId,
        updatedAt: now,
      })
      .where(eq(watchlistItems.id, id))
      .run();

    // 7. Fetch and return the created trade
    const trade = db
      .select()
      .from(trades)
      .where(eq(trades.id, tradeId))
      .get();

    return NextResponse.json(trade, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to promote watchlist item', details: String(error) },
      { status: 500 }
    );
  }
}
