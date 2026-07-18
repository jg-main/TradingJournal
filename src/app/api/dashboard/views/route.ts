/**
 * /api/dashboard/views route handler
 *
 * CRUD operations for persisted dashboard views in SQLite.
 *
 * GET    /api/dashboard/views                  — List all views (ordered by createdAt)
 * POST   /api/dashboard/views                  — Create a new view (upsert by id)
 * DELETE /api/dashboard/views?id=<viewId>      — Delete a user view by id
 *
 * Error shape follows the standardized pattern from other route handlers:
 * - 400 for validation errors with { error, details }
 * - 404 for not found with { error }
 * - 500 for unexpected failures with { error }
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { dashboardViews } from '@/db/schema';
import { eq } from 'drizzle-orm';

// ── Zod Schemas ─────────────────────────────────────────────────────────

import { z } from 'zod';

/**
 * Schema for creating/upserting a single dashboard view.
 * layout and hiddenWidgetIds are JSON-serialized arrays.
 */
const createViewSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  layout: z.string().default('[]'),
  hiddenWidgetIds: z.string().default('[]'),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  isSystem: z.boolean().default(false),
  isDefault: z.boolean().default(false),
});

/**
 * Schema for the migration endpoint — accepts the full localStorage payload
 * shape { version, views, activeViewId }.
 */
const migrateSchema = z.object({
  views: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1).max(200),
      layout: z.union([z.string(), z.array(z.any())]).default('[]'),
      hiddenWidgetIds: z.union([z.string(), z.array(z.any())]).default('[]'),
      createdAt: z.string().min(1),
      updatedAt: z.string().min(1),
      isSystem: z.boolean().default(false),
      isDefault: z.boolean().default(false),
    }),
  ),
  activeViewId: z.string().optional(),
});

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Safely serialize the layout/hiddenWidgetIds fields to JSON strings.
 * Accepts either a JSON string or an array and normalises to string.
 */
function serializeJsonField(value: unknown): string {
  if (typeof value === 'string') {
    // Already a JSON string — validate it parses
    try {
      JSON.parse(value);
      return value;
    } catch {
      // Not valid JSON — wrap as array
      return '[]';
    }
  }
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }
  return '[]';
}

/**
 * Parse a DashboardView row from the database (snake_case columns) to a
 * camelCase JSON object matching the DashboardView interface.
 */
function parseViewRow(row: typeof dashboardViews.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    layout: safeParseJson(row.layout, []),
    hiddenWidgetIds: safeParseJson(row.hiddenWidgetIds, []),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    isSystem: row.isSystem,
    isDefault: row.isDefault,
  };
}

function safeParseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

// ── GET — List all views ──────────────────────────────────────────────

export async function GET() {
  try {
    const rows = db
      .select()
      .from(dashboardViews)
      .orderBy(dashboardViews.createdAt)
      .all();

    const views = rows.map(parseViewRow);
    return NextResponse.json(views);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch dashboard views', details: String(error) },
      { status: 500 },
    );
  }
}

// ── POST — Create or upsert a view ─────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = createViewSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const data = parsed.data;

    // Check if a view with this id already exists
    const existing = db
      .select()
      .from(dashboardViews)
      .where(eq(dashboardViews.id, data.id))
      .get();

    const layoutStr = serializeJsonField(data.layout);
    const hiddenStr = serializeJsonField(data.hiddenWidgetIds);

    if (existing) {
      // Update existing view
      db.update(dashboardViews)
        .set({
          name: data.name,
          layout: layoutStr,
          hiddenWidgetIds: hiddenStr,
          updatedAt: data.updatedAt,
          isDefault: data.isDefault,
        })
        .where(eq(dashboardViews.id, data.id))
        .run();
    } else {
      // Insert new view
      db.insert(dashboardViews)
        .values({
          id: data.id,
          name: data.name,
          layout: layoutStr,
          hiddenWidgetIds: hiddenStr,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
          isSystem: data.isSystem,
          isDefault: data.isDefault,
        })
        .run();
    }

    // Fetch and return the created/updated view
    const saved = db
      .select()
      .from(dashboardViews)
      .where(eq(dashboardViews.id, data.id))
      .get();

    if (!saved) {
      return NextResponse.json(
        { error: 'View not found after save' },
        { status: 500 },
      );
    }

    return NextResponse.json(parseViewRow(saved), { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to save dashboard view', details: String(error) },
      { status: 500 },
    );
  }
}

// ── DELETE — Delete a user view ───────────────────────────────────────

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id || typeof id !== 'string') {
      return NextResponse.json(
        { error: 'Missing required query parameter: id' },
        { status: 400 },
      );
    }

    const existing = db
      .select()
      .from(dashboardViews)
      .where(eq(dashboardViews.id, id))
      .get();

    if (!existing) {
      return NextResponse.json(
        { error: 'View not found' },
        { status: 404 },
      );
    }

    if (existing.isSystem) {
      return NextResponse.json(
        { error: 'Cannot delete a system view' },
        { status: 400 },
      );
    }

    db.delete(dashboardViews)
      .where(eq(dashboardViews.id, id))
      .run();

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to delete dashboard view', details: String(error) },
      { status: 500 },
    );
  }
}
