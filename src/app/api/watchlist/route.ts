import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { watchlistItems, lookupValues } from '@/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { z } from 'zod';

const createWatchlistItemSchema = z.object({
  symbol: z.string().trim().min(1, 'Symbol is required').max(20),
  sectorId: z.string().nullable().optional(),
  setup: z.string().nullable().optional(),
  direction: z.enum(['long', 'short']),
  thesis: z.string().nullable().optional(),
  marketContext: z.string().nullable().optional(),
  keyLevel: z.number().nullable().optional(),
  triggerPrice: z.number().nullable().optional(),
  plannedStop: z.number().nullable().optional(),
  targetPrice: z.number().nullable().optional(),
  status: z
    .enum(['pending', 'watching', 'triggered', 'skipped', 'expired'])
    .default('pending'),
  notes: z.string().nullable().optional(),
  promotedTradeId: z.string().nullable().optional(),
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

    // Resolve setup string to UUID if provided
    let resolvedSetupId: string | null = null;
    if (parsed.data.setup) {
      const lowerValue = parsed.data.setup.toLowerCase();
      const lookup = db
        .select()
        .from(lookupValues)
        .where(and(eq(lookupValues.type, 'setup'), eq(lookupValues.value, lowerValue)))
        .get();
      if (!lookup) {
        return NextResponse.json(
          { error: 'Validation failed', details: { fieldErrors: { setup: ['Unknown setup value'] } } },
          { status: 400 }
        );
      }
      resolvedSetupId = lookup.id;
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    db.insert(watchlistItems)
      .values({
        id,
        dateAdded: now,
        symbol: parsed.data.symbol,
        sectorId: parsed.data.sectorId ?? null,
        setupId: resolvedSetupId,
        direction: parsed.data.direction,
        thesis: parsed.data.thesis ?? null,
        marketContext: parsed.data.marketContext ?? null,
        keyLevel: parsed.data.keyLevel ?? null,
        triggerPrice: parsed.data.triggerPrice ?? null,
        plannedStop: parsed.data.plannedStop ?? null,
        targetPrice: parsed.data.targetPrice ?? null,
        status: parsed.data.status,
        notes: parsed.data.notes ?? null,
        promotedTradeId: parsed.data.promotedTradeId ?? null,
        alertConfig: parsed.data.alertConfig != null ? JSON.stringify(parsed.data.alertConfig) : null,
        createdAt: now,
        updatedAt: now,
      })
      .run();

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
