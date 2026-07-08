import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { trades, lookupValues, tradeMistakes } from '@/db/schema';
import { eq, and, like } from 'drizzle-orm';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';

const PHASE = ['pre_trade', 'entry', 'management', 'exit', 'review'] as const;
const SEVERITY = ['minor', 'moderate', 'major', 'critical'] as const;
const STATUS = ['open', 'addressed', 'improved', 'resolved'] as const;

const createMistakeSchema = z.object({
  mistakeType: z.string().trim().min(1, 'Mistake type is required'),
  phase: z.enum(PHASE),
  severity: z.enum(SEVERITY),
  rootCause: z.string().trim().min(1, 'Root cause is required'),
  correctiveAction: z.string().trim().min(1, 'Corrective action is required'),
  status: z.enum(STATUS).optional().default('open'),
});

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

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

    const mistakes = db
      .select()
      .from(tradeMistakes)
      .where(eq(tradeMistakes.tradeId, id))
      .orderBy(tradeMistakes.createdAt)
      .all();

    return NextResponse.json(mistakes);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch mistakes', details: String(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = createMistakeSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: { fieldErrors: parsed.error.flatten().fieldErrors } },
        { status: 400 },
      );
    }

    // Check trade exists
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

    // Resolve mistakeType to lookup value UUID (follows setup->setupId pattern)
    const lowerValue = parsed.data.mistakeType.toLowerCase();
    const lookup = db
      .select()
      .from(lookupValues)
      .where(and(eq(lookupValues.type, 'mistake_type'), like(lookupValues.value, lowerValue)))
      .get();

    if (!lookup) {
      const validTypes = db
        .select()
        .from(lookupValues)
        .where(and(eq(lookupValues.type, 'mistake_type'), eq(lookupValues.isActive, true)))
        .all();
      const typeList = validTypes.map(t => t.value).join(', ');
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: {
            fieldErrors: {
              mistakeType: [`Unknown mistake type "${parsed.data.mistakeType}". Valid types: ${typeList || '(none configured)'}`],
            },
          },
        },
        { status: 400 },
      );
    }

    const mistakeId = randomUUID();
    const now = new Date().toISOString();

    db.insert(tradeMistakes)
      .values({
        id: mistakeId,
        tradeId: id,
        mistakeTypeId: lookup.id,
        phase: parsed.data.phase,
        severity: parsed.data.severity,
        rootCause: parsed.data.rootCause,
        correctiveAction: parsed.data.correctiveAction,
        status: parsed.data.status,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const created = db
      .select()
      .from(tradeMistakes)
      .where(eq(tradeMistakes.id, mistakeId))
      .get();

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to create mistake', details: String(error) },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: tradeId } = await params;
    const { searchParams } = new URL(request.url);
    const mistakeId = searchParams.get('id');

    if (!mistakeId) {
      return NextResponse.json(
        { error: 'Mistake id query parameter is required' },
        { status: 400 },
      );
    }

    const trade = db
      .select()
      .from(trades)
      .where(eq(trades.id, tradeId))
      .get();

    if (!trade) {
      return NextResponse.json(
        { error: 'Trade not found' },
        { status: 404 },
      );
    }

    const mistake = db
      .select()
      .from(tradeMistakes)
      .where(eq(tradeMistakes.id, mistakeId))
      .get();

    if (!mistake) {
      return NextResponse.json(
        { error: 'Mistake not found' },
        { status: 404 },
      );
    }

    db.delete(tradeMistakes)
      .where(eq(tradeMistakes.id, mistakeId))
      .run();

    return NextResponse.json({ message: 'Mistake removed' });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to delete mistake', details: String(error) },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: tradeId } = await params;
    const { searchParams } = new URL(request.url);
    const mistakeId = searchParams.get('id');

    if (!mistakeId) {
      return NextResponse.json(
        { error: 'Mistake id query parameter is required' },
        { status: 400 },
      );
    }

    // Check trade exists
    const trade = db
      .select()
      .from(trades)
      .where(eq(trades.id, tradeId))
      .get();

    if (!trade) {
      return NextResponse.json(
        { error: 'Trade not found' },
        { status: 404 },
      );
    }

    // Check mistake exists
    const existing = db
      .select()
      .from(tradeMistakes)
      .where(eq(tradeMistakes.id, mistakeId))
      .get();

    if (!existing) {
      return NextResponse.json(
        { error: 'Mistake not found' },
        { status: 404 },
      );
    }

    const body = await request.json();

    // Validate update fields
    const updateSchema = z.object({
      mistakeType: z.string().trim().min(1).optional(),
      phase: z.enum(PHASE).optional(),
      severity: z.enum(SEVERITY).optional(),
      rootCause: z.string().trim().min(1).optional(),
      correctiveAction: z.string().trim().min(1).optional(),
      status: z.enum(STATUS).optional(),
    });

    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: { fieldErrors: parsed.error.flatten().fieldErrors } },
        { status: 400 },
      );
    }

    // If updating mistakeType, resolve the new lookup value
    let newMistakeTypeId = existing.mistakeTypeId;
    if (parsed.data.mistakeType) {
      const lowerValue = parsed.data.mistakeType.toLowerCase();
      const lookup = db
        .select()
        .from(lookupValues)
        .where(and(eq(lookupValues.type, 'mistake_type'), like(lookupValues.value, lowerValue)))
        .get();

      if (!lookup) {
        const validTypes = db
          .select()
          .from(lookupValues)
          .where(and(eq(lookupValues.type, 'mistake_type'), eq(lookupValues.isActive, true)))
          .all();
        const typeList = validTypes.map(t => t.value).join(', ');
        return NextResponse.json(
          {
            error: 'Validation failed',
            details: {
              fieldErrors: {
                mistakeType: [`Unknown mistake type "${parsed.data.mistakeType}". Valid types: ${typeList || '(none configured)'}`],
              },
            },
          },
          { status: 400 },
        );
      }
      newMistakeTypeId = lookup.id;
    }

    const now = new Date().toISOString();
    const updateData: Record<string, unknown> = { updatedAt: now };

    if (newMistakeTypeId !== existing.mistakeTypeId) updateData.mistakeTypeId = newMistakeTypeId;
    if (parsed.data.phase !== undefined) updateData.phase = parsed.data.phase;
    if (parsed.data.severity !== undefined) updateData.severity = parsed.data.severity;
    if (parsed.data.rootCause !== undefined) updateData.rootCause = parsed.data.rootCause;
    if (parsed.data.correctiveAction !== undefined) updateData.correctiveAction = parsed.data.correctiveAction;
    if (parsed.data.status !== undefined) updateData.status = parsed.data.status;

    db.update(tradeMistakes)
      .set(updateData)
      .where(eq(tradeMistakes.id, mistakeId))
      .run();

    const updated = db
      .select()
      .from(tradeMistakes)
      .where(eq(tradeMistakes.id, mistakeId))
      .get();

    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to update mistake', details: String(error) },
      { status: 500 },
    );
  }
}
