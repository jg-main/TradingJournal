import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { lookupValues } from '@/db/schema';
import { eq, asc, and } from 'drizzle-orm';
import { z } from 'zod';

const VALID_TYPES = [
  'sector', 'setup', 'market_condition', 'mistake_type',
  'execution_reason', 'asset_type', 'phase', 'severity',
  'source_type', 'action_item_status',
] as const;

const createLookupSchema = z.object({
  type: z.enum(VALID_TYPES),
  value: z.string().min(1, 'Value is required').max(200),
  description: z.string().max(500).nullable().optional(),
  sortOrder: z.number().int().min(0).optional().default(0),
});


export async function GET(request: NextRequest) {
  try {
    const typeFilter = request.nextUrl.searchParams.get('type') as typeof VALID_TYPES[number] | null;

    const rows = typeFilter && VALID_TYPES.includes(typeFilter)
      ? db.select().from(lookupValues).where(and(eq(lookupValues.type, typeFilter), eq(lookupValues.isActive, true))).orderBy(asc(lookupValues.sortOrder)).all()
      : db.select().from(lookupValues).where(eq(lookupValues.isActive, true)).orderBy(asc(lookupValues.type), asc(lookupValues.sortOrder)).all();

    if (!typeFilter) {
      const grouped: Record<string, typeof rows> = {};
      for (const row of rows) {
        if (!grouped[row.type]) grouped[row.type] = [];
        grouped[row.type].push(row);
      }
      return NextResponse.json(grouped);
    }

    return NextResponse.json(rows);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch lookups', details: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = createLookupSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // Check for duplicate type+value
    const existing = db
      .select()
      .from(lookupValues)
      .where(and(eq(lookupValues.type, parsed.data.type), eq(lookupValues.value, parsed.data.value.toLowerCase())))
      .get();

    if (existing) {
      return NextResponse.json(
        { error: `A lookup value "${parsed.data.value}" already exists for type "${parsed.data.type}".` },
        { status: 409 }
      );
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    db.insert(lookupValues)
      .values({
        id,
        type: parsed.data.type,
        // Always lowercase to match case-insensitive lookup pattern used by
        // trade mistakes API and setup resolver (lowercases input before querying)
        value: parsed.data.value.toLowerCase(),
        description: parsed.data.description ?? null,
        sortOrder: parsed.data.sortOrder,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const row = db.select().from(lookupValues).where(eq(lookupValues.id, id)).get();
    return NextResponse.json(row, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to create lookup', details: String(error) },
      { status: 500 }
    );
  }
}
