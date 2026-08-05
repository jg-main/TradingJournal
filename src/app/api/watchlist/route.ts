import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { watchlistItems } from '@/db/schema';
import { eq, ne, desc } from 'drizzle-orm';
import { z } from 'zod';
import { YahooFinanceProvider } from '@/lib/market-quote';
import { fetchYahooProfiles } from '@/lib/profile-enricher';

const createWatchlistItemSchema = z.object({
  symbol: z.string().trim().min(1, 'Symbol is required').max(20),
  keyLevel: z.number().nullable().optional(),
  alertConfig: z.any().nullable().optional(),
});


export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');

    const query = db
      .select()
      .from(watchlistItems)
      .orderBy(desc(watchlistItems.createdAt));

    if (status) {
      query.where(eq(watchlistItems.status, status as 'pending' | 'watching' | 'triggered' | 'skipped' | 'expired'));
    } else {
      // Default view excludes soft-deleted (expired) rows so "Remove" behaves
      // like a delete. Pass ?status=expired to audit removed items.
      query.where(ne(watchlistItems.status, 'expired'));
    }

    const rows = query.all();
    return NextResponse.json(rows);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch watchlist items', details: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = createWatchlistItemSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    db.insert(watchlistItems)
      .values({
        id,
        dateAdded: now,
        symbol: parsed.data.symbol,
        name: null,
        sector: null,
        industry: null,
        sectorId: null,
        setupId: null,
        direction: 'long',
        thesis: null,
        marketContext: null,
        keyLevel: parsed.data.keyLevel ?? null,
        triggerPrice: null,
        plannedStop: null,
        targetPrice: null,
        status: 'pending',
        notes: null,
        promotedTradeId: null,
        alertConfig: parsed.data.alertConfig != null ? JSON.stringify(parsed.data.alertConfig) : null,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    // Auto-enrich name/sector/industry from Yahoo (separate from price provider)
    try {
      const yahoo = new YahooFinanceProvider();
      const quotes = await yahoo.getQuote([parsed.data.symbol]);
      const quote = quotes?.[0];
      const name = quote?.shortName ?? null;

      // Also fetch sector/industry from Yahoo assetProfile
      const profiles = await fetchYahooProfiles([parsed.data.symbol]);
      const profile = profiles.get(parsed.data.symbol.toUpperCase());
      const sector = profile?.sector ?? null;
      const industry = profile?.industry ?? null;

      if (name || sector || industry) {
        db.update(watchlistItems)
          .set({ name, sector, industry, updatedAt: now })
          .where(eq(watchlistItems.id, id))
          .run();
      }
    } catch {
      // Enrichment is best-effort — item created without profile data
    }

    const row = db
      .select()
      .from(watchlistItems)
      .where(eq(watchlistItems.id, id))
      .get();

    return NextResponse.json(row, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to create watchlist item', details: String(error) },
      { status: 500 }
    );
  }
}
