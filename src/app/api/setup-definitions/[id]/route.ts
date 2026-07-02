import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { setupDefinitions, lookupValues } from '@/db/schema';
import { eq } from 'drizzle-orm';

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const row = db
      .select()
      .from(setupDefinitions)
      .where(eq(setupDefinitions.id, id))
      .get();

    if (!row) {
      return NextResponse.json(
        { error: 'Setup definition not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(row);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch setup definition', details: String(error) },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const existing = db
      .select()
      .from(setupDefinitions)
      .where(eq(setupDefinitions.id, id))
      .get();

    if (!existing) {
      return NextResponse.json(
        { error: 'Setup definition not found' },
        { status: 404 }
      );
    }

    const body = await request.json();
    const now = new Date().toISOString();

    // Build update data from allowed fields
    const updateData: Record<string, unknown> = { updatedAt: now };

    const stringFields = ['name', 'description', 'howToPlay', 'entryRules', 'exitRules', 'tags', 'positionSizingRules', 'chartPatterns'] as const;
    for (const field of stringFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field];
      }
    }

    if (body.defaultRiskPct !== undefined) {
      updateData.defaultRiskPct = body.defaultRiskPct;
    }

    if (body.isActive !== undefined) {
      updateData.isActive = body.isActive;
    }

    // Prevent duplicate name if name changed
    if (body.name !== undefined && body.name !== existing.name) {
      const dup = db
        .select()
        .from(setupDefinitions)
        .where(eq(setupDefinitions.name, body.name))
        .get();
      if (dup) {
        return NextResponse.json(
          { error: 'Validation failed', details: { fieldErrors: { name: ['A setup with this name already exists'] } } },
          { status: 409 }
        );
      }
    }

    db.update(setupDefinitions)
      .set(updateData)
      .where(eq(setupDefinitions.id, id))
      .run();

    // Sync lookupValues on name/description/isActive changes
    const lookupUpdate: Record<string, unknown> = { updatedAt: now };
    if (body.name !== undefined) lookupUpdate.value = body.name.toLowerCase();
    if (body.description !== undefined) lookupUpdate.description = body.description;
    if (body.isActive !== undefined) lookupUpdate.isActive = body.isActive;

    if (Object.keys(lookupUpdate).length > 1) {
      db.update(lookupValues)
        .set(lookupUpdate)
        .where(eq(lookupValues.id, id))
        .run();
    }

    const row = db
      .select()
      .from(setupDefinitions)
      .where(eq(setupDefinitions.id, id))
      .get();

    return NextResponse.json(row);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to update setup definition', details: String(error) },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const existing = db
      .select()
      .from(setupDefinitions)
      .where(eq(setupDefinitions.id, id))
      .get();

    if (!existing) {
      return NextResponse.json(
        { error: 'Setup definition not found' },
        { status: 404 }
      );
    }

    // Soft delete: deactivate instead of removing (preserves FK references)
    const now = new Date().toISOString();
    db.update(setupDefinitions)
      .set({ isActive: false, updatedAt: now })
      .where(eq(setupDefinitions.id, id))
      .run();

    // Also deactivate in lookupValues
    db.update(lookupValues)
      .set({ isActive: false, updatedAt: now })
      .where(eq(lookupValues.id, id))
      .run();

    return NextResponse.json({ message: 'Setup definition deactivated' });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to deactivate setup definition', details: String(error) },
      { status: 500 }
    );
  }
}
