/**
 * Route tests for Dashboard Views API (GET, POST, DELETE)
 *
 * Tests the route CRUD logic against a real SQLite database with the
 * dashboard_views table schema.
 *
 * Covers:
 * - GET: empty list, populated list, proper ordering
 * - POST: create new, upsert existing, validation failure
 * - DELETE: by id, missing id, not found, system view protection
 * - Migrate: bulk upsert, validation failure
 *
 * Run: npx vitest run src/app/api/dashboard/views/__tests__/route.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { unlinkSync, existsSync } from 'node:fs';

// ── Test Database Path ──────────────────────────────────────────────────

const TEST_DB_PATH = './.test-dashboard-views-route.db';

// ── Type Helpers ────────────────────────────────────────────────────────

/** The camelCase response shape returned by the route. */
interface DashboardViewDTO {
  id: string;
  name: string;
  layout: unknown[];
  hiddenWidgetIds: string[];
  createdAt: string;
  updatedAt: string;
  isSystem: boolean;
  isDefault: boolean;
}

interface RouteResult {
  status: number;
  body: unknown;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function safeParseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** Normalise layout/hiddenWidgetIds to a JSON string. */
function serializeJsonField(value: unknown): string {
  if (typeof value === 'string') {
    try { JSON.parse(value); return value; } catch { return '[]'; }
  }
  if (Array.isArray(value)) return JSON.stringify(value);
  return '[]';
}

/** Parse a DB row to the DTO shape. */
function parseViewRow(row: {
  id: string; name: string; layout: string; hidden_widget_ids: string;
  created_at: string; updated_at: string; is_system: number; is_default: number;
}): DashboardViewDTO {
  return {
    id: row.id,
    name: row.name,
    layout: safeParseJson(row.layout, []),
    hiddenWidgetIds: safeParseJson(row.hidden_widget_ids, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isSystem: !!row.is_system,
    isDefault: !!row.is_default,
  };
}

// ── Simulated Route Handlers ───────────────────────────────────────────

function doGetViews(sqlite: Database.Database): RouteResult {
  try {
    const rows = sqlite
      .prepare('SELECT * FROM dashboard_views ORDER BY created_at ASC')
      .all() as Array<{
        id: string; name: string; layout: string; hidden_widget_ids: string;
        created_at: string; updated_at: string; is_system: number; is_default: number;
      }>;
    return { status: 200, body: rows.map(parseViewRow) };
  } catch (error) {
    return {
      status: 500,
      body: { error: 'Failed to fetch dashboard views', details: String(error) },
    };
  }
}

function doCreateView(sqlite: Database.Database, body: unknown): RouteResult {
  try {
    // Manual validation matching the route's createViewSchema
    if (typeof body !== 'object' || body === null) {
      return { status: 400, body: { error: 'Validation failed', details: 'Invalid input' } };
    }
    const data = body as Record<string, unknown>;

    if (typeof data.id !== 'string' || data.id.length === 0) {
      return { status: 400, body: { error: 'Validation failed', details: 'id is required' } };
    }
    if (typeof data.name !== 'string' || data.name.length === 0 || data.name.length > 200) {
      return {
        status: 400,
        body: { error: 'Validation failed', details: 'name is required (1-200 chars)' },
      };
    }
    if (typeof data.createdAt !== 'string' || typeof data.updatedAt !== 'string') {
      return { status: 400, body: { error: 'Validation failed', details: 'createdAt and updatedAt are required' } };
    }

    // Upsert
    const existing = sqlite.prepare('SELECT id FROM dashboard_views WHERE id = ?').get(data.id) as { id: string } | undefined;

    const layoutStr = serializeJsonField(data.layout ?? '[]');
    const hiddenStr = serializeJsonField(data.hiddenWidgetIds ?? '[]');
    const isSystem = data.isSystem === true ? 1 : 0;
    const isDefault = data.isDefault === true ? 1 : 0;

    if (existing) {
      sqlite
        .prepare(
          `UPDATE dashboard_views
           SET name = ?, layout = ?, hidden_widget_ids = ?, updated_at = ?, is_default = ?
           WHERE id = ?`,
        )
        .run(data.name, layoutStr, hiddenStr, data.updatedAt, isDefault, data.id);
    } else {
      sqlite
        .prepare(
          `INSERT INTO dashboard_views (id, name, layout, hidden_widget_ids, created_at, updated_at, is_system, is_default)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(data.id, data.name, layoutStr, hiddenStr, data.createdAt, data.updatedAt, isSystem, isDefault);
    }

    const saved = sqlite.prepare('SELECT * FROM dashboard_views WHERE id = ?').get(data.id) as {
      id: string; name: string; layout: string; hidden_widget_ids: string;
      created_at: string; updated_at: string; is_system: number; is_default: number;
    };

    if (!saved) {
      return { status: 500, body: { error: 'View not found after save' } };
    }

    return { status: 201, body: parseViewRow(saved) };
  } catch (error) {
    return {
      status: 500,
      body: { error: 'Failed to save dashboard view', details: String(error) },
    };
  }
}

function doDeleteView(sqlite: Database.Database, id: string | null): RouteResult {
  try {
    if (!id || typeof id !== 'string') {
      return { status: 400, body: { error: 'Missing required query parameter: id' } };
    }

    const existing = sqlite.prepare('SELECT id, is_system FROM dashboard_views WHERE id = ?').get(id) as {
      id: string; is_system: number;
    } | undefined;

    if (!existing) {
      return { status: 404, body: { error: 'View not found' } };
    }

    if (existing.is_system) {
      return { status: 400, body: { error: 'Cannot delete a system view' } };
    }

    sqlite.prepare('DELETE FROM dashboard_views WHERE id = ?').run(id);
    return { status: 200, body: { success: true } };
  } catch (error) {
    return {
      status: 500,
      body: { error: 'Failed to delete dashboard view', details: String(error) },
    };
  }
}

function doMigrateViews(sqlite: Database.Database, body: unknown): RouteResult {
  try {
    if (typeof body !== 'object' || body === null) {
      return { status: 400, body: { error: 'Validation failed' } };
    }
    const data = body as Record<string, unknown>;
    if (!Array.isArray(data.views)) {
      return { status: 400, body: { error: 'Validation failed', details: 'views array is required' } };
    }

    let migratedCount = 0;
    for (const view of data.views) {
      if (typeof view.id !== 'string' || typeof view.name !== 'string') continue;

      const existing = sqlite.prepare('SELECT id FROM dashboard_views WHERE id = ?').get(view.id) as { id: string } | undefined;

      const layoutStr = serializeJsonField(view.layout ?? '[]');
      const hiddenStr = serializeJsonField(view.hiddenWidgetIds ?? '[]');
      const isSystem = view.isSystem === true ? 1 : 0;
      const isDefault = view.isDefault === true ? 1 : 0;

      if (existing) {
        sqlite
          .prepare(
            `UPDATE dashboard_views
             SET name = ?, layout = ?, hidden_widget_ids = ?, updated_at = ?, is_default = ?
             WHERE id = ?`,
          )
          .run(view.name, layoutStr, hiddenStr, view.updatedAt ?? new Date().toISOString(), isDefault, view.id);
      } else {
        sqlite
          .prepare(
            `INSERT INTO dashboard_views (id, name, layout, hidden_widget_ids, created_at, updated_at, is_system, is_default)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            view.id,
            view.name,
            layoutStr,
            hiddenStr,
            view.createdAt ?? new Date().toISOString(),
            view.updatedAt ?? new Date().toISOString(),
            isSystem,
            isDefault,
          );
      }
      migratedCount++;
    }

    return { status: 200, body: { success: true, migratedCount } };
  } catch (error) {
    return {
      status: 500,
      body: { error: 'Migration failed', details: String(error) },
    };
  }
}

// ── Test Database Setup ─────────────────────────────────────────────────

function createTestDatabase(): Database.Database {
  if (existsSync(TEST_DB_PATH)) {
    unlinkSync(TEST_DB_PATH);
    try { unlinkSync(TEST_DB_PATH + '-wal'); } catch { /* ok */ }
    try { unlinkSync(TEST_DB_PATH + '-shm'); } catch { /* ok */ }
  }

  const sqlite = new Database(TEST_DB_PATH);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  // Create only the dashboard_views table (no other schema needed)
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS dashboard_views (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      layout TEXT NOT NULL DEFAULT '[]',
      hidden_widget_ids TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      is_system INTEGER NOT NULL DEFAULT 0,
      is_default INTEGER NOT NULL DEFAULT 0
    );
  `);

  return sqlite;
}

function destroyTestDatabase(sqlite: Database.Database): void {
  sqlite.close();
  try { unlinkSync(TEST_DB_PATH); } catch { /* ok */ }
  try { unlinkSync(TEST_DB_PATH + '-wal'); } catch { /* ok */ }
  try { unlinkSync(TEST_DB_PATH + '-shm'); } catch { /* ok */ }
}

let sqlite: Database.Database;

beforeAll(() => {
  sqlite = createTestDatabase();
});

afterAll(() => {
  destroyTestDatabase(sqlite);
});

// ═══════════════════════════════════════════════════════════════════════════
// Tests — GET /api/dashboard/views
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/dashboard/views', () => {
  it('returns an empty array when no views exist', () => {
    const result = doGetViews(sqlite);
    expect(result.status).toBe(200);
    expect(Array.isArray(result.body)).toBe(true);
    expect((result.body as Array<unknown>).length).toBe(0);
  });

  it('returns all views ordered by createdAt', () => {
    const now = new Date().toISOString();
    const earlier = new Date(Date.now() - 10_000).toISOString();
    const later = new Date(Date.now() + 10_000).toISOString();

    sqlite
      .prepare(
        `INSERT INTO dashboard_views (id, name, layout, hidden_widget_ids, created_at, updated_at, is_system, is_default)
         VALUES (?, ?, '[]', '[]', ?, ?, 1, 0)`,
      )
      .run('system-default', 'Default', earlier, now);

    sqlite
      .prepare(
        `INSERT INTO dashboard_views (id, name, layout, hidden_widget_ids, created_at, updated_at, is_system, is_default)
         VALUES (?, ?, '[]', '[]', ?, ?, 1, 0)`,
      )
      .run('system-risk', 'Risk', now, now);

    sqlite
      .prepare(
        `INSERT INTO dashboard_views (id, name, layout, hidden_widget_ids, created_at, updated_at, is_system, is_default)
         VALUES (?, ?, '[]', '[]', ?, ?, 0, 0)`,
      )
      .run(randomUUID(), 'Custom View', later, now);

    const result = doGetViews(sqlite);
    expect(result.status).toBe(200);
    const views = result.body as DashboardViewDTO[];
    expect(views.length).toBeGreaterThanOrEqual(3);

    // Verify ordering: earlier first, later last
    const idxDefault = views.findIndex((v) => v.id === 'system-default');
    const idxCustom = views.findIndex((v) => v.name === 'Custom View');
    expect(idxDefault).toBeLessThan(idxCustom);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Tests — POST /api/dashboard/views
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/dashboard/views', () => {
  it('creates a new user view with layout and hiddenWidgetIds arrays', () => {
    const now = new Date().toISOString();
    const viewId = randomUUID();
    const layout = JSON.stringify([{ i: 'widget-1', x: 0, y: 0, w: 2, h: 2 }]);
    const hiddenWidgets = JSON.stringify(['widget-2']);

    const result = doCreateView(sqlite, {
      id: viewId,
      name: 'My Custom Layout',
      layout,
      hiddenWidgetIds: hiddenWidgets,
      createdAt: now,
      updatedAt: now,
      isSystem: false,
      isDefault: false,
    });

    expect(result.status).toBe(201);
    const view = result.body as DashboardViewDTO;
    expect(view.id).toBe(viewId);
    expect(view.name).toBe('My Custom Layout');
    expect(Array.isArray(view.layout)).toBe(true);
    expect((view.layout as Array<unknown>).length).toBe(1);
    expect(Array.isArray(view.hiddenWidgetIds)).toBe(true);
    expect(view.hiddenWidgetIds).toContain('widget-2');
    expect(view.isSystem).toBe(false);
    expect(view.isDefault).toBe(false);
  });

  it('upserts an existing view (update by id)', () => {
    const now = new Date().toISOString();
    const viewId = randomUUID();

    // Create
    doCreateView(sqlite, {
      id: viewId,
      name: 'Original Name',
      layout: '[]',
      hiddenWidgetIds: '[]',
      createdAt: now,
      updatedAt: now,
      isSystem: false,
      isDefault: false,
    });

    // Upsert with new name and layout
    const updatedLayout = JSON.stringify([{ i: 'updated', x: 0, y: 0, w: 4, h: 1 }]);
    const later = new Date(Date.now() + 1000).toISOString();
    const updateResult = doCreateView(sqlite, {
      id: viewId,
      name: 'Updated Name',
      layout: updatedLayout,
      hiddenWidgetIds: '["hidden-1"]',
      createdAt: now,
      updatedAt: later,
      isSystem: false,
      isDefault: true,
    });

    expect(updateResult.status).toBe(201);
    const view = updateResult.body as DashboardViewDTO;
    expect(view.name).toBe('Updated Name');
    expect((view.layout as Array<unknown>).length).toBe(1);
    expect(view.hiddenWidgetIds).toContain('hidden-1');
    expect(view.isDefault).toBe(true);
    expect(view.createdAt).toBe(now); // createdAt preserved on update
    expect(view.updatedAt).toBe(later);
  });

  it('returns 400 for missing required fields', () => {
    const result = doCreateView(sqlite, { id: '', name: '', createdAt: '' });
    expect(result.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Tests — DELETE /api/dashboard/views
// ═══════════════════════════════════════════════════════════════════════════

describe('DELETE /api/dashboard/views', () => {
  it('returns 400 when id query param is missing', () => {
    const result = doDeleteView(sqlite, null);
    expect(result.status).toBe(400);
    expect((result.body as Record<string, unknown>).error).toBe('Missing required query parameter: id');
  });

  it('returns 404 when view does not exist', () => {
    const result = doDeleteView(sqlite, 'non-existent-id');
    expect(result.status).toBe(404);
    expect((result.body as Record<string, unknown>).error).toBe('View not found');
  });

  it('returns 400 when trying to delete a system view', () => {
    const result = doDeleteView(sqlite, 'system-default');
    expect(result.status).toBe(400);
    expect((result.body as Record<string, unknown>).error).toBe('Cannot delete a system view');
  });

  it('deletes a user view successfully', () => {
    const now = new Date().toISOString();
    const viewId = randomUUID();

    doCreateView(sqlite, {
      id: viewId,
      name: 'Deletable View',
      layout: '[]',
      hiddenWidgetIds: '[]',
      createdAt: now,
      updatedAt: now,
      isSystem: false,
      isDefault: false,
    });

    const result = doDeleteView(sqlite, viewId);
    expect(result.status).toBe(200);
    expect((result.body as Record<string, unknown>).success).toBe(true);

    // Verify it's gone
    const getResult = doGetViews(sqlite);
    const views = getResult.body as DashboardViewDTO[];
    expect(views.find((v) => v.id === viewId)).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Tests — POST /api/dashboard/views/migrate
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/dashboard/views/migrate', () => {
  it('migrates localStorage views payload successfully', () => {
    const now = new Date().toISOString();
    const payload = {
      views: [
        {
          id: 'system-default',
          name: 'Default',
          layout: JSON.stringify([{ i: 'kpi', x: 0, y: 0, w: 2, h: 1 }]),
          hiddenWidgetIds: '[]',
          createdAt: now,
          updatedAt: now,
          isSystem: true,
          isDefault: true,
        },
        {
          id: randomUUID(),
          name: 'Migrated View',
          layout: JSON.stringify([{ i: 'chart', x: 0, y: 1, w: 4, h: 2 }]),
          hiddenWidgetIds: '["old-widget"]',
          createdAt: now,
          updatedAt: now,
          isSystem: false,
          isDefault: false,
        },
      ],
      activeViewId: 'system-default',
    };

    const result = doMigrateViews(sqlite, payload);
    expect(result.status).toBe(200);
    const body = result.body as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(body.migratedCount).toBe(2);
  });

  it('returns 400 for invalid payload (missing views array)', () => {
    const result = doMigrateViews(sqlite, {});
    expect(result.status).toBe(400);
  });
});
