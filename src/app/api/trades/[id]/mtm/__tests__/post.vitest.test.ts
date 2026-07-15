/**
 * Single trade MTM POST route vitest test
 *
 * Tests POST /api/trades/[id]/mtm — verifies the route uses the provider
 * resolver (resolveQuoteProvider) to fetch a single trade's quote, persists
 * a price snapshot, updates the trade's current_price, and enriches
 * sector/industry from Yahoo profiles when the primary provider omits them.
 *
 * Uses in-memory SQLite for the DB and mocks resolveQuoteProvider to return
 * a controllable mock provider.
 *
 * Run: npx vitest run 'src/app/api/trades/[id]/mtm/__tests__/post.vitest.test.ts'
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── Hoisted: in-memory SQLite DB ──────────────────────────────────────────
// Provides a drizzle instance for @/db mock with tables the route needs.

const testCtx = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3');
  const sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = OFF'); // OFF so we can seed trades without accounts

  // Create tables matching the schema that the route queries
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      broker TEXT,
      currency TEXT DEFAULT 'USD',
      is_active INTEGER DEFAULT 1,
      max_risk_per_trade_pct REAL,
      default_commission REAL,
      starting_balance REAL,
      created_at TEXT DEFAULT (current_timestamp),
      updated_at TEXT DEFAULT (current_timestamp)
    );
    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY NOT NULL,
      trade_code TEXT UNIQUE NOT NULL,
      account_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      direction TEXT NOT NULL,
      sector_id TEXT,
      setup_id TEXT,
      market_condition_id TEXT,
      status TEXT NOT NULL,
      planned_entry REAL,
      planned_stop REAL,
      planned_target_1 REAL,
      planned_target_2 REAL,
      planned_quantity REAL,
      thesis TEXT,
      invalidation_condition TEXT,
      pre_trade_plan TEXT,
      opened_at TEXT,
      closed_at TEXT,
      exit_notes TEXT,
      lesson TEXT,
      current_price REAL,
      current_price_fetched_at TEXT,
      created_at TEXT DEFAULT (current_timestamp),
      updated_at TEXT DEFAULT (current_timestamp)
    );
    CREATE TABLE IF NOT EXISTS position_price_snapshots (
      id TEXT PRIMARY KEY NOT NULL,
      trade_id TEXT NOT NULL,
      price REAL NOT NULL,
      source TEXT NOT NULL DEFAULT 'yahoo',
      market_state TEXT,
      short_name TEXT,
      quote_type TEXT,
      sector TEXT,
      industry TEXT,
      fetched_at TEXT NOT NULL,
      created_at TEXT DEFAULT (current_timestamp)
    );
    CREATE INDEX IF NOT EXISTS idx_snapshots_trade_fetched
      ON position_price_snapshots(trade_id, fetched_at);
  `);

  return { sqlite };
});

// ── Hoisted: controllable mock provider state ─────────────────────────────

const mockProviderCtx = vi.hoisted(() => {
  const quotes = new Map<string, unknown>();
  let shouldThrow = false;

  return {
    quotes,
    getShouldThrow() { return shouldThrow; },
    setQuotes(q: Map<string, unknown>) {
      quotes.clear();
      for (const [k, v] of q) quotes.set(k, v);
    },
    setThrow(t: boolean) {
      shouldThrow = t;
    },
    reset() {
      quotes.clear();
      shouldThrow = false;
    },
  };
});

// ── Hoisted: controllable mock enricher state ────────────────────────────────

const mockEnricherCtx = vi.hoisted(() => {
  const profileData = new Map<string, { sector?: string; industry?: string }>();
  let shouldThrow = false;

  return {
    profileData,
    getShouldThrow() { return shouldThrow; },
    setProfile(symbol: string, sector?: string, industry?: string) {
      profileData.set(symbol.toUpperCase(), { sector, industry });
    },
    setThrow(t: boolean) { shouldThrow = t; },
    reset() {
      profileData.clear();
      shouldThrow = false;
    },
  };
});

// ── Mock @/db ─────────────────────────────────────────────────────────────
// Route imports { db } from '@/db'. We replace it with a drizzle instance
// wrapping our in-memory SQLite.

vi.mock('@/db', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { drizzle } = require('drizzle-orm/better-sqlite3');
  const db = drizzle(testCtx.sqlite);
  return { db };
});

// ── Mock market-data-resolver ─────────────────────────────────────────────
// Route calls resolveQuoteProvider() to get the quote provider.
// Our mock returns a controllable provider that reads from mockProviderCtx.

vi.mock('@/lib/market-data-resolver', () => ({
  resolveQuoteProvider: () => ({
    async getQuote(symbols: string[]): Promise<unknown[]> {
      if (mockProviderCtx.getShouldThrow()) {
        throw new Error('Simulated provider failure');
      }
      const now = new Date().toISOString();
      return symbols.map((symbol) => {
        const upper = symbol.toUpperCase();
        const q = mockProviderCtx.quotes.get(upper) as Record<string, unknown> | undefined;
        if (q) {
          return { ...q, fetchedAt: now };
        }
        return {
          symbol: upper,
          price: null,
          marketState: 'UNKNOWN',
          fetchedAt: now,
          source: 'mock',
          error: `No mock quote configured for symbol: ${symbol}`,
        };
      });
    },
  }),
}));

// ── Mock profile-enricher ──────────────────────────────────────────────────
// Route calls fetchYahooProfiles() after persisting the snapshot to enrich
// rows where the primary provider (e.g. Schwab) returned NULL sector/industry.

vi.mock('@/lib/profile-enricher', () => ({
  fetchYahooProfiles: async (symbols: string[]) => {
    if (mockEnricherCtx.getShouldThrow()) {
      throw new Error('Simulated enricher failure');
    }
    const map = new Map<string, { symbol: string; sector?: string; industry?: string }>();
    for (const sym of symbols) {
      const up = sym.toUpperCase();
      const p = mockEnricherCtx.profileData.get(up);
      if (p) {
        map.set(up, { symbol: up, sector: p.sector, industry: p.industry });
      }
    }
    return map;
  },
}));

// ── Module-level imports (after mocks) ────────────────────────────────────

import { randomUUID } from 'node:crypto';
import { eq, desc } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { POST } from '../route';

// ── Test helpers ───────────────────────────────────────────────────────────

const TEST_ACCOUNT_ID = 'test-account-id';

function cleanup() {
  testCtx.sqlite.exec('DELETE FROM position_price_snapshots;');
  testCtx.sqlite.exec('DELETE FROM trades;');
  testCtx.sqlite.exec('DELETE FROM accounts;');
}

function seedAccount(id = TEST_ACCOUNT_ID) {
  const now = new Date().toISOString();
  db.insert(schema.accounts)
    .values({
      id,
      name: 'Test Account',
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

function seedOpenTrade(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.trades)
    .values({
      id,
      tradeCode: `T-${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}`,
      accountId: TEST_ACCOUNT_ID,
      symbol: 'AAPL',
      direction: 'long',
      status: 'open',
      createdAt: now,
      updatedAt: now,
      currentPrice: null,
      currentPriceFetchedAt: null,
      ...overrides,
    })
    .run();
  return id;
}

async function callPost(tradeId: string): Promise<{
  status: number;
  data: Record<string, unknown>;
}> {
  const request = new Request(`http://localhost/api/trades/${tradeId}/mtm`, {
    method: 'POST',
  });
  const response = await POST(request as never, {
    params: Promise.resolve({ id: tradeId }),
  } as never);
  const data = await response.json() as Record<string, unknown>;
  return { status: response.status, data };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('POST /api/trades/[id]/mtm', () => {
  beforeEach(() => {
    cleanup();
    mockProviderCtx.reset();
    mockEnricherCtx.reset();
  });

  // ── Happy path ──────────────────────────────────────────────────────────

  it('fetches quote, persists snapshot, and updates trade current_price', async () => {
    seedAccount();
    const tradeId = seedOpenTrade({ symbol: 'AAPL' });

    mockProviderCtx.setQuotes(
      new Map([['AAPL', {
        symbol: 'AAPL',
        price: 178.5,
        marketState: 'REGULAR',
        source: 'yahoo',
        shortName: 'Apple Inc.',
        quoteType: 'EQUITY',
        sector: 'Technology',
        industry: 'Consumer Electronics',
      }]]),
    );

    const { status, data } = await callPost(tradeId);

    expect(status).toBe(200);
    expect(data.price).toBe(178.5);
    expect(data.marketState).toBe('REGULAR');
    expect(data.source).toBe('yahoo');
    expect(data.shortName).toBe('Apple Inc.');
    expect(data.quoteType).toBe('EQUITY');
    expect(data.sector).toBe('Technology');
    expect(data.industry).toBe('Consumer Electronics');
    expect(data.fetchedAt).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));

    // Verify snapshot was persisted
    const snapshotCount = (testCtx.sqlite
      .prepare('SELECT COUNT(*) as cnt FROM position_price_snapshots')
      .get() as { cnt: number }).cnt;
    expect(snapshotCount).toBe(1);

    // Verify trade's current price was updated
    const trade = db
      .select({ cp: schema.trades.currentPrice })
      .from(schema.trades)
      .where(eq(schema.trades.id, tradeId))
      .get() as { cp: number | null };
    expect(trade.cp).toBe(178.5);
  });

  // ── Non-existent trade ─────────────────────────────────────────────────

  it('returns 404 when trade does not exist', async () => {
    const { status, data } = await callPost('nonexistent-trade');

    expect(status).toBe(404);
    expect(data.error).toBe('Trade not found');
  });

  // ── Provider failure ────────────────────────────────────────────────────

  it('returns 502 when provider returns null price', async () => {
    seedAccount();
    const tradeId = seedOpenTrade({ symbol: 'BAD' });

    mockProviderCtx.setQuotes(
      new Map([['BAD', {
        symbol: 'BAD',
        price: null,
        marketState: 'UNKNOWN',
        source: 'yahoo',
        error: 'No data',
      }]]),
    );

    const { status, data } = await callPost(tradeId);

    expect(status).toBe(502);
    expect(data.error).toBe('Could not fetch price');
  });

  it('returns 500 when provider throws', async () => {
    seedAccount();
    const tradeId = seedOpenTrade({ symbol: 'AAPL' });

    mockProviderCtx.setThrow(true);

    const { status, data } = await callPost(tradeId);

    expect(status).toBe(500);
    expect(data.error).toBe('Failed to refresh price');
    expect(data.details).toBeDefined();
  });

  // ── Enrichment: Yahoo profile fills NULL sector/industry ─────────────────

  it('enriches NULL sector/industry from Yahoo profiles when provider omits them', async () => {
    seedAccount();
    const tradeId = seedOpenTrade({ symbol: 'WKC' });

    // Mock quote WITHOUT sector/industry (simulates Schwab provider behavior)
    mockProviderCtx.setQuotes(
      new Map([['WKC', {
        symbol: 'WKC',
        price: 25.0,
        marketState: 'REGULAR',
        source: 'schwab',
        shortName: 'WKC',
        quoteType: 'EQUITY',
        // sector and industry intentionally omitted
      }]]),
    );

    // Setup mock enricher to return sector/industry for WKC
    mockEnricherCtx.setProfile('WKC', 'Energy', 'Oil & Gas');

    const { status, data } = await callPost(tradeId);

    expect(status).toBe(200);
    expect(data.price).toBe(25.0);
    expect(data.source).toBe('schwab');
    expect(data.sector).toBe('Energy');
    expect(data.industry).toBe('Oil & Gas');

    // Verify the snapshot was enriched with Yahoo profile data
    const snapshot = testCtx.sqlite
      .prepare('SELECT sector, industry FROM position_price_snapshots')
      .get() as { sector: string | null; industry: string | null };
    expect(snapshot.sector).toBe('Energy');
    expect(snapshot.industry).toBe('Oil & Gas');
  });

  // ── Enrichment: non-fatal when Yahoo enricher fails ──────────────────────

  it('non-fatal when Yahoo profile enrichment fails', async () => {
    seedAccount();
    const tradeId = seedOpenTrade({ symbol: 'AAPL' });

    mockProviderCtx.setQuotes(
      new Map([['AAPL', {
        symbol: 'AAPL',
        price: 150.0,
        marketState: 'REGULAR',
        source: 'yahoo',
        shortName: 'Apple Inc.',
        quoteType: 'EQUITY',
      }]]),
    );

    // Make the enricher throw — enrichment should fail silently
    mockEnricherCtx.setThrow(true);

    const { status, data } = await callPost(tradeId);

    expect(status).toBe(200);
    expect(data.price).toBe(150.0);

    // Snapshot should still exist — enrichment failure does not block the refresh
    const snapshotCount = (testCtx.sqlite
      .prepare('SELECT COUNT(*) as cnt FROM position_price_snapshots')
      .get() as { cnt: number }).cnt;
    expect(snapshotCount).toBe(1);

    // Trade price should still be updated
    const trade = db
      .select({ cp: schema.trades.currentPrice })
      .from(schema.trades)
      .where(eq(schema.trades.id, tradeId))
      .get() as { cp: number | null };
    expect(trade.cp).toBe(150.0);
  });

  // ── Enrichment: does not overwrite sector/industry when provider already has them ──

  it('does not overwrite sector/industry already provided by primary provider', async () => {
    seedAccount();
    const tradeId = seedOpenTrade({ symbol: 'AAPL' });

    // Mock quote WITH sector/industry (simulates Yahoo provider behavior)
    mockProviderCtx.setQuotes(
      new Map([['AAPL', {
        symbol: 'AAPL',
        price: 178.5,
        marketState: 'REGULAR',
        source: 'yahoo',
        shortName: 'Apple Inc.',
        quoteType: 'EQUITY',
        sector: 'Technology',
        industry: 'Consumer Electronics',
      }]]),
    );

    // Setup mock enricher with DIFFERENT values — should NOT overwrite
    mockEnricherCtx.setProfile('AAPL', 'Healthcare', 'Pharma');

    const { status, data } = await callPost(tradeId);

    expect(status).toBe(200);
    // The primary provider's values should be preserved
    expect(data.sector).toBe('Technology');
    expect(data.industry).toBe('Consumer Electronics');
  });

  // ── Works for any trade status (closed, planned) ─────────────────────────

  it('works for closed trades', async () => {
    seedAccount();
    const tradeId = seedOpenTrade({ symbol: 'MSFT', status: 'closed' });

    mockProviderCtx.setQuotes(
      new Map([['MSFT', {
        symbol: 'MSFT',
        price: 415.2,
        marketState: 'REGULAR',
        source: 'yahoo',
        shortName: 'Microsoft',
        quoteType: 'EQUITY',
      }]]),
    );

    const { status, data } = await callPost(tradeId);

    expect(status).toBe(200);
    expect(data.price).toBe(415.2);
  });

  it('works for planned trades', async () => {
    seedAccount();
    const tradeId = seedOpenTrade({ symbol: 'GOOGL', status: 'planned' });

    mockProviderCtx.setQuotes(
      new Map([['GOOGL', {
        symbol: 'GOOGL',
        price: 175.0,
        marketState: 'REGULAR',
        source: 'yahoo',
        shortName: 'Alphabet',
        quoteType: 'EQUITY',
      }]]),
    );

    const { status, data } = await callPost(tradeId);

    expect(status).toBe(200);
    expect(data.price).toBe(175.0);
  });
});
