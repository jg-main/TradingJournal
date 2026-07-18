/**
 * /api/dashboard/views/migrate route handler
 *
 * Accepts localStorage payloads ({ views: DashboardView[], activeViewId: string })
 * and bulk inserts/upserts all views into SQLite. Called once on first API
 * connection after the SQLite migration is live.
 *
 * POST /api/dashboard/views/migrate
 *
 * On success: returns { success: true, migratedCount: number }
 * On failure: logs to console and returns error JSON
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { dashboardViews } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

const migrationPayloadSchema = z.object({
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

/**
 * Safely serialize the layout/hiddenWidgetIds fields to JSON strings.
 */
function serializeJsonField(value: unknown): string {
  if (typeof value === 'string') {
    try {
      JSON.parse(value);
      return value;
    } catch {
      return '[]';
    }
  }
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }
  return '[]';
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = migrationPayloadSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { views } = parsed.data;
    let migratedCount = 0;

    // Upsert each view — insert or update by id
    for (const view of views) {
      const existing = db
        .select()
        .from(dashboardViews)
        .where(eq(dashboardViews.id, view.id))
        .get();

      const layoutStr = serializeJsonField(view.layout);
      const hiddenStr = serializeJsonField(view.hiddenWidgetIds);

      if (existing) {
        db.update(dashboardViews)
          .set({
            name: view.name,
            layout: layoutStr,
            hiddenWidgetIds: hiddenStr,
            updatedAt: view.updatedAt,
            isDefault: view.isDefault,
          })
          .where(eq(dashboardViews.id, view.id))
          .run();
      } else {
        db.insert(dashboardViews)
          .values({
            id: view.id,
            name: view.name,
            layout: layoutStr,
            hiddenWidgetIds: hiddenStr,
            createdAt: view.createdAt,
            updatedAt: view.updatedAt,
            isSystem: view.isSystem,
            isDefault: view.isDefault,
          })
          .run();
      }
      migratedCount++;
    }

    return NextResponse.json({
      success: true,
      migratedCount,
    });
  } catch (error) {
    console.error('[dashboard/views/migrate] Migration failed:', error);
    return NextResponse.json(
      { error: 'Migration failed', details: String(error) },
      { status: 500 },
    );
  }
}
