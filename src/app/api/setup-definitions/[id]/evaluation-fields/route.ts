import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { setupDefinitions, playEvaluationFields } from '@/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { z } from 'zod';

const createSchema = z.object({
  fieldKey: z
    .string()
    .trim()
    .min(1, 'Field key is required')
    .max(50, 'Field key must be 50 chars or fewer'),
  label: z.string().trim().min(1, 'Label is required').max(100),
  description: z.string().nullable().optional(),
  fieldType: z.enum(['boolean', 'score_1_5', 'score_1_10', 'text']),
  weight: z.number().min(0).max(1).optional(),
  minLookbackDays: z.number().int().positive().max(3650).nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

const updateSchema = z.object({
  fieldKey: z
    .string()
    .trim()
    .min(1, 'Field key is required')
    .max(50, 'Field key must be 50 chars or fewer')
    .optional(),
  label: z.string().trim().min(1, 'Label is required').max(100).optional(),
  description: z.string().nullable().optional(),
  fieldType: z.enum(['boolean', 'score_1_5', 'score_1_10', 'text']).optional(),
  weight: z.number().min(0).max(1).optional(),
  minLookbackDays: z.number().int().positive().max(3650).nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/setup-definitions/[id]/evaluation-fields
 *
 * List all evaluation fields for a play definition.
 * Supports ?includeInactive=true to include inactive fields.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const setupExists = db
      .select({ id: setupDefinitions.id })
      .from(setupDefinitions)
      .where(eq(setupDefinitions.id, id))
      .get();

    if (!setupExists) {
      return NextResponse.json(
        { error: 'Setup definition not found' },
        { status: 404 },
      );
    }

    const { searchParams } = new URL(request.url);
    const includeInactive = searchParams.get('includeInactive') === 'true';

    let rows;
    if (includeInactive) {
      rows = db
        .select()
        .from(playEvaluationFields)
        .where(eq(playEvaluationFields.setupDefinitionId, id))
        .orderBy(desc(playEvaluationFields.sortOrder))
        .all();
    } else {
      rows = db
        .select()
        .from(playEvaluationFields)
        .where(
          and(
            eq(playEvaluationFields.setupDefinitionId, id),
            eq(playEvaluationFields.isActive, true),
          ),
        )
        .orderBy(desc(playEvaluationFields.sortOrder))
        .all();
    }

    return NextResponse.json({ data: rows });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch evaluation fields', details: String(error) },
      { status: 500 },
    );
  }
}

/**
 * POST /api/setup-definitions/[id]/evaluation-fields
 *
 * Create a new evaluation field for a play definition.
 * The fieldKey must be unique within the play definition.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const setupExists = db
      .select({ id: setupDefinitions.id })
      .from(setupDefinitions)
      .where(eq(setupDefinitions.id, id))
      .get();

    if (!setupExists) {
      return NextResponse.json(
        { error: 'Setup definition not found' },
        { status: 404 },
      );
    }

    const body = await request.json();
    const parsed = createSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    // Check unique fieldKey within this setup definition
    const existing = db
      .select()
      .from(playEvaluationFields)
      .where(
        and(
          eq(playEvaluationFields.setupDefinitionId, id),
          eq(playEvaluationFields.fieldKey, parsed.data.fieldKey),
        ),
      )
      .get();

    if (existing) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: {
            fieldErrors: {
              fieldKey: [
                'A field with this key already exists for this play definition',
              ],
            },
          },
        },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    const fieldId = crypto.randomUUID();

    db.insert(playEvaluationFields)
      .values({
        id: fieldId,
        setupDefinitionId: id,
        fieldKey: parsed.data.fieldKey,
        label: parsed.data.label,
        description: parsed.data.description ?? null,
        fieldType: parsed.data.fieldType,
        weight: parsed.data.weight ?? 1.0,
        minLookbackDays: parsed.data.minLookbackDays ?? null,
        sortOrder: parsed.data.sortOrder ?? 0,
        isActive: parsed.data.isActive ?? true,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const row = db
      .select()
      .from(playEvaluationFields)
      .where(eq(playEvaluationFields.id, fieldId))
      .get();

    return NextResponse.json(row, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to create evaluation field', details: String(error) },
      { status: 500 },
    );
  }
}

/**
 * PUT /api/setup-definitions/[id]/evaluation-fields?id=<fieldId>
 *
 * Update an existing evaluation field for a play definition.
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const fieldId = searchParams.get('id');

    if (!fieldId) {
      return NextResponse.json(
        { error: 'Field id query parameter is required' },
        { status: 400 },
      );
    }

    const setupExists = db
      .select({ id: setupDefinitions.id })
      .from(setupDefinitions)
      .where(eq(setupDefinitions.id, id))
      .get();

    if (!setupExists) {
      return NextResponse.json(
        { error: 'Setup definition not found' },
        { status: 404 },
      );
    }

    const existingField = db
      .select()
      .from(playEvaluationFields)
      .where(
        and(
          eq(playEvaluationFields.id, fieldId),
          eq(playEvaluationFields.setupDefinitionId, id),
        ),
      )
      .get();

    if (!existingField) {
      return NextResponse.json(
        { error: 'Evaluation field not found' },
        { status: 404 },
      );
    }

    const body = await request.json();
    const parsed = updateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    // If changing fieldKey, check uniqueness
    if (
      parsed.data.fieldKey !== undefined &&
      parsed.data.fieldKey !== existingField.fieldKey
    ) {
      const duplicate = db
        .select()
        .from(playEvaluationFields)
        .where(
          and(
            eq(playEvaluationFields.setupDefinitionId, id),
            eq(playEvaluationFields.fieldKey, parsed.data.fieldKey),
          ),
        )
        .get();

      if (duplicate) {
        return NextResponse.json(
          {
            error: 'Validation failed',
            details: {
              fieldErrors: {
                fieldKey: [
                  'A field with this key already exists for this play definition',
                ],
              },
            },
          },
          { status: 409 },
        );
      }
    }

    const now = new Date().toISOString();
    const updateData: Record<string, unknown> = { updatedAt: now };

    if (parsed.data.fieldKey !== undefined)
      updateData.fieldKey = parsed.data.fieldKey;
    if (parsed.data.label !== undefined) updateData.label = parsed.data.label;
    if (parsed.data.description !== undefined)
      updateData.description = parsed.data.description;
    if (parsed.data.fieldType !== undefined)
      updateData.fieldType = parsed.data.fieldType;
    if (parsed.data.weight !== undefined) updateData.weight = parsed.data.weight;
    if (parsed.data.minLookbackDays !== undefined)
      updateData.minLookbackDays = parsed.data.minLookbackDays;
    if (parsed.data.sortOrder !== undefined)
      updateData.sortOrder = parsed.data.sortOrder;
    if (parsed.data.isActive !== undefined)
      updateData.isActive = parsed.data.isActive;

    if (Object.keys(updateData).length > 1) {
      db.update(playEvaluationFields)
        .set(updateData)
        .where(eq(playEvaluationFields.id, fieldId))
        .run();
    }

    const row = db
      .select()
      .from(playEvaluationFields)
      .where(eq(playEvaluationFields.id, fieldId))
      .get();

    return NextResponse.json(row);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to update evaluation field', details: String(error) },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/setup-definitions/[id]/evaluation-fields?id=<fieldId>
 *
 * Soft-delete an evaluation field by setting isActive=false.
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const fieldId = searchParams.get('id');

    if (!fieldId) {
      return NextResponse.json(
        { error: 'Field id query parameter is required' },
        { status: 400 },
      );
    }

    const setupExists = db
      .select({ id: setupDefinitions.id })
      .from(setupDefinitions)
      .where(eq(setupDefinitions.id, id))
      .get();

    if (!setupExists) {
      return NextResponse.json(
        { error: 'Setup definition not found' },
        { status: 404 },
      );
    }

    const existingField = db
      .select()
      .from(playEvaluationFields)
      .where(
        and(
          eq(playEvaluationFields.id, fieldId),
          eq(playEvaluationFields.setupDefinitionId, id),
        ),
      )
      .get();

    if (!existingField) {
      return NextResponse.json(
        { error: 'Evaluation field not found' },
        { status: 404 },
      );
    }

    const now = new Date().toISOString();
    db.update(playEvaluationFields)
      .set({ isActive: false, updatedAt: now })
      .where(eq(playEvaluationFields.id, fieldId))
      .run();

    const row = db
      .select()
      .from(playEvaluationFields)
      .where(eq(playEvaluationFields.id, fieldId))
      .get();

    return NextResponse.json(row);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to delete evaluation field', details: String(error) },
      { status: 500 },
    );
  }
}
