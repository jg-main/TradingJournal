/**
 * watchlist item by id route test
 *
 * Tests GET (by id), PUT (update), and DELETE (soft-delete) handlers for
 * /api/watchlist/[id] using the real route handlers backed by an in-memory
 * SQLite DB.
 *
 * Run: npx vitest run 'src/app/api/watchlist/[id]/__tests__/route.test.ts'
 */

import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/db/schema';

const sqlite = new Database(':memory:');
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
const db = drizzle(sqlite, { schema });

// Mirror the real watchlist_items table (src/db/schema.ts). All FK columns
// are inserted as NULL, so referenced tables are never consulted.
sqlite.exec(`
  CREATE TABLE watchlist_items (
    id TEXT PRIMARY KEY NOT NULL,
    date_added TEXT,
    symbol TEXT NOT NULL,
    sector_id TEXT,
    name TEXT,
    sector TEXT,
    industry TEXT,
    setup_id TEXT,
    direction TEXT NOT NULL DEFAULT 'long',
    thesis TEXT,
    market_context TEXT,
    key_level REAL,
    trigger_price REAL,
    planned_stop REAL,
    target_price REAL,
    status TEXT NOT NULL DEFAULT 'pending',
    notes TEXT,
    promoted_trade_id TEXT,
    alert_config TEXT,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );
`);

vi.mock('@/db', () => ({
  db,
  getSqliteHandle: () => sqlite,
}));

// ── Module-level imports (after mocks) ────────────────────────────────────

const { GET, PUT, DELETE } = await import('../route');

// ── Test helpers ──────────────────────────────────────────────────────────

async function callGet(
  id: string,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const request = new Request(`http://localhost/api/watchlist/${id}`) as never;
  const response = await GET(request, { params: Promise.resolve({ id }) });
  const data = (await response.json()) as Record<string, unknown>;
  return { status: response.status, data };
}

async function callPut(
  id: string,
  body: unknown,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const request = new Request(`http://localhost/api/watchlist/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never;
  const response = await PUT(request, { params: Promise.resolve({ id }) });
  const data = (await response.json()) as Record<string, unknown>;
  return { status: response.status, data };
}

async function callDelete(
  id: string,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const request = new Request(`http://localhost/api/watchlist/${id}`, {
    method: 'DELETE',
  }) as never;
  const response = await DELETE(request, { params: Promise.resolve({ id }) });
  const data = (await response.json()) as Record<string, unknown>;
  return { status: response.status, data };
}

function cleanup() {
  sqlite.exec('DELETE FROM watchlist_items;');
}

function seedWatchlistItem(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.watchlistItems)
    .values({
      id,
      dateAdded: now,
      symbol: 'AAPL',
      direction: 'long',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .run();
  return db
    .select()
    .from(schema.watchlistItems)
    .where(eq(schema.watchlistItems.id, id))
    .get() as Record<string, unknown>;
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('GET /api/watchlist/[id]', () => {
  beforeEach(cleanup);

  it('returns the watchlist item by id', async () => {
    const item = seedWatchlistItem({ symbol: 'AAPL' });

    const { status, data } = await callGet(item.id as string);
    expect(status).toBe(200);
    expect(data.id).toBe(item.id);
    expect(data.symbol).toBe('AAPL');
  });

  it('returns 404 for a nonexistent id', async () => {
    const { status, data } = await callGet('nonexistent-id');
    expect(status).toBe(404);
    expect(data.error).toBe('Watchlist item not found');
  });
});

describe('PUT /api/watchlist/[id]', () => {
  beforeEach(cleanup);

  it('updates keyLevel', async () => {
    const item = seedWatchlistItem({ symbol: 'AAPL' });

    const { status, data } = await callPut(item.id as string, {
      keyLevel: 150,
    });
    expect(status).toBe(200);
    expect(data.keyLevel).toBe(150);
    expect(data.symbol).toBe('AAPL');
  });

  it('returns 404 for a nonexistent id', async () => {
    const { status, data } = await callPut('nonexistent-id', {
      keyLevel: 150,
    });
    expect(status).toBe(404);
    expect(data.error).toBe('Watchlist item not found');
  });

  it('persists alertConfig as a JSON string and null clears it', async () => {
    const item = seedWatchlistItem({ symbol: 'AAPL' });
    const alertConfig = {
      priceBelowKeyLevel: { enabled: true },
      rsiBelow: { enabled: true, threshold: 30 },
    };

    const { status, data } = await callPut(item.id as string, { alertConfig });
    expect(status).toBe(200);
    expect(typeof data.alertConfig).toBe('string');
    const parsed = JSON.parse(data.alertConfig as string);
    expect(parsed.priceBelowKeyLevel.enabled).toBe(true);
    expect(parsed.rsiBelow.enabled).toBe(true);
    expect(parsed.rsiBelow.threshold).toBe(30);

    const cleared = await callPut(item.id as string, { alertConfig: null });
    expect(cleared.status).toBe(200);
    expect(cleared.data.alertConfig).toBeNull();
  });

  it('updates triggerPrice, direction and status', async () => {
    const item = seedWatchlistItem({
      symbol: 'TSLA',
      direction: 'long',
      status: 'pending',
    });

    const { status, data } = await callPut(item.id as string, {
      triggerPrice: 245.5,
      direction: 'short',
      status: 'watching',
    });
    expect(status).toBe(200);
    expect(data.triggerPrice).toBe(245.5);
    expect(data.direction).toBe('short');
    expect(data.status).toBe('watching');
  });

  it('null clears triggerPrice and keyLevel', async () => {
    const item = seedWatchlistItem({
      symbol: 'TSLA',
      triggerPrice: 245.5,
      keyLevel: 250,
    });

    const { status, data } = await callPut(item.id as string, {
      triggerPrice: null,
      keyLevel: null,
    });
    expect(status).toBe(200);
    expect(data.triggerPrice).toBeNull();
    expect(data.keyLevel).toBeNull();
  });

  it('rejects invalid direction/status enums and non-numeric prices, leaving the row unchanged', async () => {
    const item = seedWatchlistItem({ symbol: 'TSLA' });

    const badDir = await callPut(item.id as string, { direction: 'sideways' });
    expect(badDir.status).toBe(400);
    expect(
      (badDir.data.details as { fieldErrors: Record<string, string[]> })
        .fieldErrors.direction,
    ).toBeDefined();

    const badStatus = await callPut(item.id as string, { status: 'nope' });
    expect(badStatus.status).toBe(400);
    expect(
      (badStatus.data.details as { fieldErrors: Record<string, string[]> })
        .fieldErrors.status,
    ).toBeDefined();

    const badPrice = await callPut(item.id as string, {
      triggerPrice: '12.5',
    });
    expect(badPrice.status).toBe(400);
    expect(
      (badPrice.data.details as { fieldErrors: Record<string, string[]> })
        .fieldErrors.triggerPrice,
    ).toBeDefined();

    const after = db
      .select()
      .from(schema.watchlistItems)
      .where(eq(schema.watchlistItems.id, item.id as string))
      .get() as Record<string, unknown>;
    expect(after.direction).toBe('long');
    expect(after.status).toBe('pending');
    expect(after.triggerPrice).toBeNull();
  });
});

describe('DELETE /api/watchlist/[id]', () => {
  beforeEach(cleanup);

  it('soft-deletes by setting status to expired', async () => {
    const item = seedWatchlistItem({ symbol: 'AAPL', status: 'pending' });

    const { status, data } = await callDelete(item.id as string);
    expect(status).toBe(200);
    expect(data.message).toBe('Watchlist item expired');

    const updated = db
      .select()
      .from(schema.watchlistItems)
      .where(eq(schema.watchlistItems.id, item.id as string))
      .get() as Record<string, unknown>;
    expect(updated.status).toBe('expired');
  });

  it('returns 404 for a nonexistent id', async () => {
    const { status, data } = await callDelete('nonexistent-id');
    expect(status).toBe(404);
    expect(data.error).toBe('Watchlist item not found');
  });
});
