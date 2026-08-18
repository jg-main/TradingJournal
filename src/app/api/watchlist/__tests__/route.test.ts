/**
 * watchlist route test
 *
 * Tests GET (list with status filter) and POST (create, validation) for
 * /api/watchlist using the real route handlers backed by an in-memory
 * SQLite DB. Yahoo enrichment is mocked so POST stays hermetic.
 *
 * Run: npx vitest run src/app/api/watchlist/__tests__/route.test.ts
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

// POST auto-enriches name/sector/industry from Yahoo; keep it hermetic.
vi.mock('@/lib/market-quote', () => ({
  YahooFinanceProvider: class {
    async getQuote() {
      return [];
    }
  },
}));

vi.mock('@/lib/profile-enricher', () => ({
  fetchYahooProfiles: async () => new Map(),
}));

// ── Module-level imports (after mocks) ────────────────────────────────────

const { GET, POST } = await import('../route');

// ── Test helpers ──────────────────────────────────────────────────────────

async function callGet(
  url: string,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const request = new Request(url) as never;
  const response = await GET(request);
  const data = (await response.json()) as Record<string, unknown>;
  return { status: response.status, data };
}

async function callPost(
  body: unknown,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const request = new Request('http://localhost/api/watchlist', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never;
  const response = await POST(request);
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

describe('GET /api/watchlist', () => {
  beforeEach(cleanup);

  it('returns an empty list when no items exist', async () => {
    const { status, data } = await callGet('http://localhost/api/watchlist');
    expect(status).toBe(200);
    expect(data).toEqual([]);
  });

  it('excludes expired items by default and returns them with ?status=expired', async () => {
    seedWatchlistItem({ symbol: 'AAPL', status: 'pending' });
    seedWatchlistItem({ symbol: 'MSFT', status: 'watching' });
    seedWatchlistItem({ symbol: 'GOOGL', status: 'triggered' });
    seedWatchlistItem({ symbol: 'NFLX', status: 'expired' });

    const { status, data } = await callGet('http://localhost/api/watchlist');
    expect(status).toBe(200);
    expect(data).toHaveLength(3);
    const symbols = (data as unknown as Array<Record<string, unknown>>).map((r) => r.symbol);
    expect(symbols).not.toContain('NFLX');

    const expired = await callGet(
      'http://localhost/api/watchlist?status=expired',
    );
    expect(expired.status).toBe(200);
    expect(expired.data).toHaveLength(1);
    expect((expired.data as unknown as Array<Record<string, unknown>>)[0].symbol).toBe('NFLX');
  });

  it('filters by status', async () => {
    seedWatchlistItem({ symbol: 'AAPL', status: 'pending' });
    seedWatchlistItem({ symbol: 'MSFT', status: 'watching' });

    const pending = await callGet(
      'http://localhost/api/watchlist?status=pending',
    );
    expect(pending.status).toBe(200);
    expect(pending.data).toHaveLength(1);
    const row = (pending.data as unknown as Array<Record<string, unknown>>)[0];
    expect(row.symbol).toBe('AAPL');
    expect(row.status).toBe('pending');

    const watching = await callGet(
      'http://localhost/api/watchlist?status=watching',
    );
    expect(watching.status).toBe(200);
    expect(watching.data).toHaveLength(1);
    expect((watching.data as unknown as Array<Record<string, unknown>>)[0].symbol).toBe('MSFT');
  });
});

describe('POST /api/watchlist', () => {
  beforeEach(cleanup);

  it('creates a watchlist item with valid data', async () => {
    const { status, data } = await callPost({ symbol: 'AAPL' });

    expect(status).toBe(201);
    expect(data.id).toBeDefined();
    expect(data.symbol).toBe('AAPL');
    expect(data.status).toBe('pending');
    expect(data.dateAdded).toBeDefined();
    expect(data.createdAt).toBeDefined();
    expect(data.updatedAt).toBeDefined();
  });

  it('returns 400 with fieldErrors for an empty symbol', async () => {
    const { status, data } = await callPost({ symbol: '' });
    expect(status).toBe(400);
    const details = data.details as { fieldErrors: Record<string, string[]> };
    expect(details.fieldErrors.symbol).toBeDefined();
    expect(details.fieldErrors.symbol.length).toBeGreaterThan(0);
  });

  it('creates with keyLevel', async () => {
    const { status, data } = await callPost({ symbol: 'AAPL', keyLevel: 150 });
    expect(status).toBe(201);
    expect(data.symbol).toBe('AAPL');
    expect(data.keyLevel).toBe(150);
  });

  it('persists alertConfig as a JSON string', async () => {
    const alertConfig = {
      priceAboveKeyLevel: { enabled: true },
      rsiAbove: { enabled: true, threshold: 70 },
    };

    const { status, data } = await callPost({ symbol: 'AAPL', alertConfig });
    expect(status).toBe(201);
    expect(typeof data.alertConfig).toBe('string');
    const parsed = JSON.parse(data.alertConfig as string);
    expect(parsed.priceAboveKeyLevel.enabled).toBe(true);
    expect(parsed.rsiAbove.enabled).toBe(true);
    expect(parsed.rsiAbove.threshold).toBe(70);
  });

  it('creates with triggerPrice, direction and status', async () => {
    const { status, data } = await callPost({
      symbol: 'TSLA',
      triggerPrice: 245.5,
      direction: 'short',
      status: 'watching',
    });

    expect(status).toBe(201);
    expect(data.symbol).toBe('TSLA');
    expect(data.triggerPrice).toBe(245.5);
    expect(data.direction).toBe('short');
    expect(data.status).toBe('watching');
  });

  it('defaults direction=long, status=pending and triggerPrice=null', async () => {
    const { status, data } = await callPost({ symbol: 'AAPL' });
    expect(status).toBe(201);
    expect(data.direction).toBe('long');
    expect(data.status).toBe('pending');
    expect(data.triggerPrice).toBeNull();
  });

  it('accepts explicit null triggerPrice/keyLevel', async () => {
    const { status, data } = await callPost({
      symbol: 'AAPL',
      triggerPrice: null,
      keyLevel: null,
    });
    expect(status).toBe(201);
    expect(data.triggerPrice).toBeNull();
    expect(data.keyLevel).toBeNull();
  });

  it('rejects invalid direction/status enums and non-numeric prices with fieldErrors', async () => {
    const badDir = await callPost({ symbol: 'AAPL', direction: 'sideways' });
    expect(badDir.status).toBe(400);
    expect(
      (badDir.data.details as { fieldErrors: Record<string, string[]> })
        .fieldErrors.direction,
    ).toBeDefined();

    const badStatus = await callPost({ symbol: 'AAPL', status: 'nope' });
    expect(badStatus.status).toBe(400);
    expect(
      (badStatus.data.details as { fieldErrors: Record<string, string[]> })
        .fieldErrors.status,
    ).toBeDefined();

    const badPrice = await callPost({ symbol: 'AAPL', triggerPrice: '12.5' });
    expect(badPrice.status).toBe(400);
    expect(
      (badPrice.data.details as { fieldErrors: Record<string, string[]> })
        .fieldErrors.triggerPrice,
    ).toBeDefined();
  });
});
