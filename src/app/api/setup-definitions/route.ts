import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { setupDefinitions, lookupValues } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';
import { z } from 'zod';

const createSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  description: z.string().nullable().optional(),
  howToPlay: z.string().nullable().optional(),
  entryRules: z.string().nullable().optional(),
  exitRules: z.string().nullable().optional(),
  tags: z.string().nullable().optional(),
  defaultRiskPct: z.number().min(0).max(100).nullable().optional(),
  positionSizingRules: z.string().nullable().optional(),
  chartPatterns: z.string().nullable().optional(),
});

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const includeInactive = searchParams.get('includeInactive') === 'true';

    let rows;
    if (includeInactive) {
      rows = db.select().from(setupDefinitions).orderBy(desc(setupDefinitions.createdAt)).all();
    } else {
      rows = db
        .select()
        .from(setupDefinitions)
        .where(eq(setupDefinitions.isActive, true))
        .orderBy(desc(setupDefinitions.createdAt))
        .all();
    }
    return NextResponse.json({ data: rows });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch setup definitions', details: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = createSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // Check for duplicate name
    const existing = db
      .select()
      .from(setupDefinitions)
      .where(eq(setupDefinitions.name, parsed.data.name))
      .get();

    if (existing) {
      return NextResponse.json(
        { error: 'Validation failed', details: { fieldErrors: { name: ['A setup with this name already exists'] } } },
        { status: 409 }
      );
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    // Dual-write: insert into setup_definitions and lookupValues with same UUID
    db.insert(setupDefinitions)
      .values({
        id,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        howToPlay: parsed.data.howToPlay ?? null,
        entryRules: parsed.data.entryRules ?? null,
        exitRules: parsed.data.exitRules ?? null,
        tags: parsed.data.tags ?? null,
        defaultRiskPct: parsed.data.defaultRiskPct ?? null,
        positionSizingRules: parsed.data.positionSizingRules ?? null,
        chartPatterns: parsed.data.chartPatterns ?? null,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    // Also insert into lookupValues for backward compat with trades.setupId FK
    db.insert(lookupValues)
      .values({
        id,
        type: 'setup',
        value: parsed.data.name.toLowerCase(),
        description: parsed.data.description ?? null,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const row = db
      .select()
      .from(setupDefinitions)
      .where(eq(setupDefinitions.id, id))
      .get();

    return NextResponse.json(row, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to create setup definition', details: String(error) },
      { status: 500 }
    );
  }
}
