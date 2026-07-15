import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { alertLog } from '@/db/schema';
import { eq, desc, and, sql } from 'drizzle-orm';
import { z } from 'zod';

const createAlertLogSchema = z.object({
  watchlistItemId: z.string().min(1, 'watchlistItemId is required'),
  symbol: z.string().trim().min(1, 'Symbol is required').max(20),
  condition: z.enum(['above', 'below', 'rsiAbove', 'rsiBelow']),
  threshold: z.number().nullable().optional(),
  actualValue: z.number().nullable().optional(),
  firedAt: z.string().min(1, 'firedAt is required'),
});

/**
 * GET /api/alert-log
 *
 * Returns alert log entries sorted by firedAt descending.
 * Optional query params:
 *   - watchlist_item_id: filter to a specific watchlist item
 *   - limit: max results (default 100, max 500)
 *   - since: ISO-8601 timestamp, only return entries fired after this
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const watchlistItemId = searchParams.get('watchlist_item_id');
    const limitParam = searchParams.get('limit');
    const since = searchParams.get('since');

    const limit = Math.min(Math.max(parseInt(limitParam || '100', 10) || 100, 1), 500);

    const conditions = [];

    if (watchlistItemId) {
      conditions.push(eq(alertLog.watchlistItemId, watchlistItemId));
    }

    if (since) {
      conditions.push(sql`${alertLog.firedAt} >= ${since}`);
    }

    const query = db
      .select()
      .from(alertLog)
      .orderBy(desc(alertLog.firedAt))
      .limit(limit);

    if (conditions.length > 0) {
      query.where(and(...conditions));
    }

    const rows = query.all();
    return NextResponse.json(rows);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch alert log', details: String(error) },
      { status: 500 }
    );
  }
}

/**
 * POST /api/alert-log
 *
 * Creates a new alert log entry. Used by the alert polling engine
 * when a condition transitions from unmet to met.
 *
 * Body: { watchlistItemId, symbol, condition, threshold?, actualValue?, firedAt }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = createAlertLogSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    db.insert(alertLog)
      .values({
        id,
        watchlistItemId: parsed.data.watchlistItemId,
        symbol: parsed.data.symbol,
        condition: parsed.data.condition,
        threshold: parsed.data.threshold ?? null,
        actualValue: parsed.data.actualValue ?? null,
        firedAt: parsed.data.firedAt,
        createdAt: now,
      })
      .run();

    const row = db
      .select()
      .from(alertLog)
      .where(eq(alertLog.id, id))
      .get();

    return NextResponse.json(row, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to create alert log entry', details: String(error) },
      { status: 500 }
    );
  }
}
