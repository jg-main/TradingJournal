/**
 * POST /api/market-data/enrich-profiles route test
 *
 * Tests the backfill endpoint that fetches sector/industry from Yahoo Finance
 * for symbols in position_price_snapshots with null sector/industry.
 *
 * The snapshot table has no symbol column — symbol is resolved via JOIN with trades.
 *
 * Uses in-memory SQLite for @/db and mocks @/lib/profile-enricher with a
 * controllable mock that returns test profile data.
 *
 * Run: npx vitest run src/app/api/market-data/enrich-profiles/__tests__/route.test.ts
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── Hoisted: in-memory SQLite DB ──────────────────────────────────────────

const testCtx = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3');
  const sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = OFF');

  // Create both tables the route queries
  // The trades table must include ALL columns from the schema because
  // Drizzle's insert builder generates column references for every schema column.
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY NOT NULL,
      trade_code TEXT UNIQUE NOT NULL,
      account_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      direction TEXT NOT NULL DEFAULT 'long',
      sector_id TEXT,
      setup_id TEXT,
      market_condition_id TEXT,
      status TEXT NOT NULL DEFAULT 'open',
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
      gross_realized_pnl REAL,
      net_realized_pnl REAL,
      realized_fees REAL,
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
      previous_close REAL,
      day_high REAL,
      day_low REAL,
      price_change REAL,
      change_percent REAL,
      fetched_at TEXT NOT NULL,
      created_at TEXT DEFAULT (current_timestamp)
    );
  `);

  return { sqlite };
});

// ── Hoisted: controllable mock enricher state ────────────────────────────

const mockEnricherCtx = vi.hoisted(() => {
  const profileData = new Map<string, { sector?: string; industry?: string }>();
  let shouldThrow = false;

  return {
    profileData,
    getShouldThrow() { return shouldThrow; },
    setProfile(symbol: string, sector?: string, industry?: string) {
      profileData.set(symbol.toUpperCase(), { sector, industry });
    },
    setThrow(t: boolean) {
      shouldThrow = t;
    },
    reset() {
      profileData.clear();
      shouldThrow = false;
    },
  };
});

// ── Mock @/db ─────────────────────────────────────────────────────────────

vi.mock('@/db', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { drizzle } = require('drizzle-orm/better-sqlite3');
  const db = drizzle(testCtx.sqlite);
  return { db };
});

// ── Mock @/lib/profile-enricher ────────────────────────────────────────────

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
import { db } from '@/db';
import * as schema from '@/db/schema';
import { POST } from '../route';

// ── Test helpers ──────────────────────────────────────────────────────────

function cleanup() {
  testCtx.sqlite.exec('DELETE FROM position_price_snapshots;');
  testCtx.sqlite.exec('DELETE FROM trades;');
}

function seedTrade(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.trades)
    .values({
      id,
      tradeCode: `T-${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}`,
      accountId: 'test-account',
      symbol: 'SYM_A',
      direction: 'long',
      status: 'open',
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .run();
  return id;
}

function seedSnapshot(overrides: Record<string, unknown> = {}) {
  const id = overrides.id as string || randomUUID();
  const tradeId = overrides.tradeId as string;
  const now = new Date().toISOString();
  db.insert(schema.positionPriceSnapshots)
    .values({
      id,
      tradeId: tradeId || 'no-such-trade',
      price: 150.0,
      source: 'yahoo',
      sector: null,
      industry: null,
      fetchedAt: now,
      createdAt: now,
      ...overrides,
    })
    .run();
  return id;
}

async function callPost(): Promise<{
  status: number;
  data: Record<string, unknown>;
}> {
  const response = await POST(new Request('http://localhost/api/market-data/enrich-profiles', { method: 'POST' }) as never);
  const data = await response.json() as Record<string, unknown>;
  return { status: response.status, data };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('POST /api/market-data/enrich-profiles', () => {
  beforeEach(() => {
    cleanup();
    mockEnricherCtx.reset();
  });

  describe('empty DB / no null rows', () => {
    it('returns all zeros when no snapshots exist', async () => {
      const { status, data } = await callPost();
      expect(status).toBe(200);
      expect(data.enriched).toBe(0);
      expect(data.errored).toBe(0);
      expect(data.total).toBe(0);
      expect(data.timestamp).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
    });

    it('returns all zeros when all rows have sector and industry populated', async () => {
      const tradeId = seedTrade({ symbol: 'AAPL' });
      seedSnapshot({ tradeId, sector: 'Technology', industry: 'Consumer Electronics' });

      const { status, data } = await callPost();
      expect(status).toBe(200);
      expect(data.enriched).toBe(0);
      expect(data.errored).toBe(0);
      expect(data.total).toBe(0);
    });
  });

  describe('null rows present', () => {
    it('enriches a single symbol with null sector/industry', async () => {
      const tradeId = seedTrade({ symbol: 'AAPL' });
      seedSnapshot({ tradeId });
      mockEnricherCtx.setProfile('AAPL', 'Technology', 'Consumer Electronics');

      const { status, data } = await callPost();
      expect(status).toBe(200);
      expect(data.enriched).toBe(1);
      expect(data.errored).toBe(0);
      expect(data.total).toBe(1);

      // Verify DB was updated
      const snapshots = db
        .select({ sector: schema.positionPriceSnapshots.sector, industry: schema.positionPriceSnapshots.industry })
        .from(schema.positionPriceSnapshots)
        .all() as Array<Record<string, unknown>>;
      expect(snapshots.length).toBe(1);
      expect(snapshots[0].sector).toBe('Technology');
      expect(snapshots[0].industry).toBe('Consumer Electronics');
    });

    it('enriches multiple distinct symbols', async () => {
      const aaplTradeId = seedTrade({ symbol: 'AAPL' });
      const msftTradeId = seedTrade({ symbol: 'MSFT' });
      const googlTradeId = seedTrade({ symbol: 'GOOGL' });
      seedSnapshot({ tradeId: aaplTradeId });
      seedSnapshot({ tradeId: msftTradeId });
      seedSnapshot({ tradeId: googlTradeId });
      mockEnricherCtx.setProfile('AAPL', 'Technology', 'Consumer Electronics');
      mockEnricherCtx.setProfile('MSFT', 'Technology', 'Software—Infrastructure');
      mockEnricherCtx.setProfile('GOOGL', 'Technology', 'Internet Content & Information');

      const { status, data } = await callPost();
      expect(status).toBe(200);
      expect(data.enriched).toBe(3);
      expect(data.errored).toBe(0);
      expect(data.total).toBe(3);

      // Verify all rows updated
      const snapshots = db
        .select({
          sector: schema.positionPriceSnapshots.sector,
          industry: schema.positionPriceSnapshots.industry,
        })
        .from(schema.positionPriceSnapshots)
        .all() as Array<Record<string, unknown>>;
      expect(snapshots.length).toBe(3);
      snapshots.forEach((s) => {
        expect(s.sector).toBe('Technology');
      });
    });

    it('only enriches rows with null fields, leaving already-populated rows alone', async () => {
      // AAPL snapshot has null sector/industry → should be picked up
      const aaplTradeId = seedTrade({ symbol: 'AAPL' });
      seedSnapshot({ tradeId: aaplTradeId, sector: null, industry: null });

      // MSFT snapshot already populated → should NOT be picked up
      const msftTradeId = seedTrade({ symbol: 'MSFT' });
      seedSnapshot({ tradeId: msftTradeId, sector: 'Technology', industry: 'Software' });

      mockEnricherCtx.setProfile('AAPL', 'Technology', 'Consumer Electronics');

      const { status, data } = await callPost();
      expect(status).toBe(200);
      expect(data.total).toBe(1);  // Only AAPL has null fields
      expect(data.enriched).toBe(1);
      expect(data.errored).toBe(0);

      // MSFT should remain unchanged
      const msft = testCtx.sqlite.prepare(
        "SELECT sector, industry FROM position_price_snapshots WHERE trade_id = ?",
      ).get(msftTradeId) as { sector: string | null; industry: string | null };
      expect(msft.sector).toBe('Technology');
      expect(msft.industry).toBe('Software');
    });

    it('handles duplicate symbols — only counts once in total', async () => {
      // Two separate trades for the same symbol AAPL, each with a snapshot
      const trade1Id = seedTrade({ symbol: 'AAPL' });
      const trade2Id = seedTrade({ symbol: 'AAPL' });
      seedSnapshot({ tradeId: trade1Id });
      seedSnapshot({ tradeId: trade2Id });
      mockEnricherCtx.setProfile('AAPL', 'Technology', 'Consumer Electronics');

      const { status, data } = await callPost();
      expect(status).toBe(200);
      // Only 1 distinct symbol with null fields
      expect(data.total).toBe(1);
      expect(data.enriched).toBe(1);
      expect(data.errored).toBe(0);

      // Verify both rows were updated
      const nullCount = testCtx.sqlite.prepare(
        "SELECT COUNT(*) as cnt FROM position_price_snapshots WHERE sector IS NULL",
      ).get() as { cnt: number };
      expect(nullCount.cnt).toBe(0);
    });
  });

  describe('error handling', () => {
    it('counts symbols not returned by enricher as errored', async () => {
      const aaplTradeId = seedTrade({ symbol: 'AAPL' });
      const msftTradeId = seedTrade({ symbol: 'MSFT' });
      seedSnapshot({ tradeId: aaplTradeId });
      seedSnapshot({ tradeId: msftTradeId });
      // Only AAPL has profile data; MSFT is absent from the mock enricher response
      mockEnricherCtx.setProfile('AAPL', 'Technology', 'Consumer Electronics');

      const { status, data } = await callPost();
      expect(status).toBe(200);
      expect(data.enriched).toBe(1);
      expect(data.errored).toBe(1);
      expect(data.total).toBe(2);

      // AAPL should be updated
      const aaplRow = testCtx.sqlite.prepare(
        "SELECT sector FROM position_price_snapshots WHERE trade_id = ?",
      ).get(aaplTradeId) as { sector: string | null };
      expect(aaplRow.sector).toBe('Technology');

      // MSFT should still have null sector
      const msftRow = testCtx.sqlite.prepare(
        "SELECT sector FROM position_price_snapshots WHERE trade_id = ?",
      ).get(msftTradeId) as { sector: string | null };
      expect(msftRow.sector).toBeNull();
    });

    it('counts symbols with empty sector/industry returned as errored', async () => {
      const tradeId = seedTrade({ symbol: 'SYM_A' });
      seedSnapshot({ tradeId });
      // Enricher returns a profile entry but with no sector/industry
      mockEnricherCtx.setProfile('SYM_A', undefined, undefined);

      const { status, data } = await callPost();
      expect(status).toBe(200);
      expect(data.enriched).toBe(0);
      expect(data.errored).toBe(1);
      expect(data.total).toBe(1);
    });

    it('handles Yahoo enricher throwing an exception gracefully (returns 500)', async () => {
      const tradeId = seedTrade({ symbol: 'AAPL' });
      seedSnapshot({ tradeId });
      mockEnricherCtx.setThrow(true);

      const { status, data } = await callPost();
      expect(status).toBe(500);
      expect(data.error).toBe('Failed to enrich profiles');
      expect(String(data.details)).toContain('Simulated enricher failure');
    });
  });

  describe('edge cases', () => {
    it('handles symbols where only sector is null but industry is not', async () => {
      const tradeId = seedTrade({ symbol: 'AAPL' });
      seedSnapshot({ tradeId, sector: null, industry: 'Consumer Electronics' });
      mockEnricherCtx.setProfile('AAPL', 'Technology', 'Consumer Electronics');

      const { status, data } = await callPost();
      expect(status).toBe(200);
      expect(data.total).toBe(1);
      expect(data.enriched).toBe(1);
      expect(data.errored).toBe(0);

      const row = testCtx.sqlite.prepare(
        "SELECT sector, industry FROM position_price_snapshots WHERE trade_id = ?",
      ).get(tradeId) as { sector: string | null; industry: string | null };
      expect(row.sector).toBe('Technology');
      expect(row.industry).toBe('Consumer Electronics');
    });

    it('handles symbols where only industry is null but sector is not', async () => {
      const tradeId = seedTrade({ symbol: 'AAPL' });
      seedSnapshot({ tradeId, sector: 'Technology', industry: null });
      mockEnricherCtx.setProfile('AAPL', 'Technology', 'Consumer Electronics');

      const { status, data } = await callPost();
      expect(status).toBe(200);
      expect(data.total).toBe(1);
      expect(data.enriched).toBe(1);
      expect(data.errored).toBe(0);

      const row = testCtx.sqlite.prepare(
        "SELECT sector, industry FROM position_price_snapshots WHERE trade_id = ?",
      ).get(tradeId) as { sector: string | null; industry: string | null };
      expect(row.sector).toBe('Technology');
      expect(row.industry).toBe('Consumer Electronics');
    });

    it('returns timestamp matching ISO-8601 format', async () => {
      const tradeId = seedTrade({ symbol: 'AAPL' });
      seedSnapshot({ tradeId });
      mockEnricherCtx.setProfile('AAPL', 'Technology', 'Consumer Electronics');

      const { data } = await callPost();
      expect(data.timestamp).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
    });
  });
});
