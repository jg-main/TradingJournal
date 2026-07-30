/**
 * MTM refresh route vitest test
 *
 * Tests POST /api/trades/mtm/refresh — verifies the route uses the provider
 * resolver (resolveQuoteProvider) instead of a hardcoded YahooFinanceProvider.
 *
 * Uses in-memory SQLite for the DB and mocks resolveQuoteProvider to return
 * a controllable mock provider.
 *
 * Run: npx vitest run src/app/api/trades/mtm/refresh/__tests__/route.vitest.test.ts
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
    CREATE TABLE IF NOT EXISTS instruments (
      id TEXT PRIMARY KEY NOT NULL,
      symbol TEXT NOT NULL UNIQUE,
      name TEXT,
      type TEXT DEFAULT 'stock' NOT NULL,
      currency TEXT DEFAULT 'USD' NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (current_timestamp),
      updated_at TEXT DEFAULT (current_timestamp)
    );
    CREATE TABLE IF NOT EXISTS valuation_marks (
      id TEXT PRIMARY KEY NOT NULL,
      account_id TEXT NOT NULL,
      instrument_id TEXT NOT NULL,
      price TEXT NOT NULL,
      price_micros INTEGER NOT NULL,
      source TEXT NOT NULL,
      mark_timestamp TEXT NOT NULL,
      idempotency_key TEXT,
      created_at TEXT DEFAULT (current_timestamp)
    );
    CREATE TABLE IF NOT EXISTS trade_executions (
      id TEXT PRIMARY KEY NOT NULL,
      trade_id TEXT NOT NULL,
      executed_at TEXT,
      action TEXT NOT NULL,
      quantity REAL NOT NULL,
      price REAL NOT NULL,
      fees REAL DEFAULT 0,
      reason_id TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (current_timestamp)
    );
    CREATE TABLE IF NOT EXISTS account_positions (
      id TEXT PRIMARY KEY NOT NULL,
      account_id TEXT NOT NULL,
      instrument_id TEXT NOT NULL,
      direction TEXT,
      quantity TEXT NOT NULL DEFAULT '0.00',
      average_cost TEXT NOT NULL DEFAULT '0.00',
      total_cost_basis TEXT NOT NULL DEFAULT '0.00',
      realized_gross_pnl TEXT NOT NULL DEFAULT '0.00',
      realized_fees TEXT NOT NULL DEFAULT '0.00',
      realized_net_pnl TEXT NOT NULL DEFAULT '0.00',
      last_updated TEXT NOT NULL,
      created_at TEXT DEFAULT (current_timestamp),
      updated_at TEXT DEFAULT (current_timestamp),
      UNIQUE(account_id, instrument_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_valuation_marks_idempotency
      ON valuation_marks(idempotency_key);
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
// Route calls fetchYahooProfiles() after persisting snapshots to enrich
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
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { POST } from '../route';
import { resetRateLimit } from '../rate-limit-state';
import { createMockQuoteResult } from '@/lib/market-quote';

// ── Test helpers ───────────────────────────────────────────────────────────

const TEST_ACCOUNT_ID = 'test-account-id';

function cleanup() {
  testCtx.sqlite.exec('DELETE FROM valuation_marks;');
  testCtx.sqlite.exec('DELETE FROM position_price_snapshots;');
  testCtx.sqlite.exec('DELETE FROM trades;');
  testCtx.sqlite.exec('DELETE FROM account_positions;');
  testCtx.sqlite.exec('DELETE FROM trade_executions;');
  testCtx.sqlite.exec('DELETE FROM instruments;');
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

function seedInstrument(symbol: string, overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  db.insert(schema.instruments)
    .values({
      id: randomUUID(),
      symbol,
      name: symbol,
      type: 'stock',
      currency: 'USD',
      createdAt: now,
      updatedAt: now,
      ...overrides,
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

function seedTradeExecution(tradeId: string, overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  db.insert(schema.tradeExecutions)
    .values({
      id: randomUUID(),
      tradeId,
      action: 'buy',
      quantity: 100,
      price: 50.0,
      fees: 0,
      executedAt: now,
      ...overrides,
    })
    .run();
}

async function callPost(): Promise<{
  status: number;
  data: Record<string, unknown>;
  headers?: Record<string, string>;
}> {
  const response = await POST(new Request('http://localhost/api/trades/mtm/refresh', { method: 'POST' }) as never);
  const data = await response.json() as Record<string, unknown>;
  const headers: Record<string, string> = {};
  response.headers.forEach((value: string, key: string) => {
    headers[key.toLowerCase()] = value;
  });
  return { status: response.status, data, headers };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('POST /api/trades/mtm/refresh', () => {
  beforeEach(() => {
    cleanup();
    resetRateLimit();
    mockProviderCtx.reset();
    mockEnricherCtx.reset();
  });

  it('uses resolveQuoteProvider (not hardcoded YahooFinanceProvider)', async () => {
    // Configures the mock provider and verifies the route uses it
    // by checking that the response reflects the mock's data
    seedAccount();
    seedOpenTrade({ symbol: 'AAPL' });

    mockProviderCtx.setQuotes(
      new Map([['AAPL', createMockQuoteResult('AAPL', 150.0, 'REGULAR')]]),
    );

    const { status, data } = await callPost();
    expect(status).toBe(200);
    expect(data.updated).toBe(1);
    expect((data.failed as unknown[]).length).toBe(0);

    // Verify trade price was updated via the mock provider's data
    const trade = db
      .select({ cp: schema.trades.currentPrice })
      .from(schema.trades)
      .where(eq(schema.trades.id, (db.select({ id: schema.trades.id }).from(schema.trades).where(eq(schema.trades.status, 'open')).all() as Array<{ id: string }>)[0]?.id ?? ''))
      .get() as { cp: number | null } | undefined;
    expect(trade?.cp).toBe(150.0);
  });

  it('resolves provider and returns updated count for multiple open trades', async () => {
    seedAccount();
    const trade1Id = seedOpenTrade({ symbol: 'AAPL' });
    const trade2Id = seedOpenTrade({ symbol: 'MSFT' });

    mockProviderCtx.setQuotes(
      new Map([
        ['AAPL', createMockQuoteResult('AAPL', 178.5, 'REGULAR')],
        ['MSFT', createMockQuoteResult('MSFT', 415.2, 'REGULAR')],
      ]),
    );

    const { status, data } = await callPost();
    expect(status).toBe(200);
    expect(data.updated).toBe(2);
    expect((data.failed as unknown[]).length).toBe(0);
    expect(data.timestamp).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));

    // Verify snapshots persisted
    const snapshotCount = (testCtx.sqlite.prepare('SELECT COUNT(*) as cnt FROM position_price_snapshots').get() as { cnt: number }).cnt;
    expect(snapshotCount).toBe(2);

    // Verify trade prices were updated
    const t1 = db.select({ cp: schema.trades.currentPrice }).from(schema.trades).where(eq(schema.trades.id, trade1Id)).get() as { cp: number | null };
    expect(t1.cp).toBe(178.5);

    const t2 = db.select({ cp: schema.trades.currentPrice }).from(schema.trades).where(eq(schema.trades.id, trade2Id)).get() as { cp: number | null };
    expect(t2.cp).toBe(415.2);
  });

  it('returns updated:0 when no open trades exist', async () => {
    seedAccount();
    // Seed a planned (non-open) trade
    seedOpenTrade({ status: 'planned', symbol: 'AAPL' });

    mockProviderCtx.setQuotes(
      new Map([['AAPL', createMockQuoteResult('AAPL', 180.0, 'REGULAR')]]),
    );

    const { status, data } = await callPost();
    expect(status).toBe(200);
    expect(data.updated).toBe(0);
    expect((data.failed as unknown[]).length).toBe(0);
  });

  it('handles partial failure with mixed results', async () => {
    seedAccount();
    seedOpenTrade({ symbol: 'AAPL' });
    const badTradeId = seedOpenTrade({ symbol: 'BAD' });

    // Only provide quote for AAPL — BAD will fail
    mockProviderCtx.setQuotes(
      new Map([['AAPL', createMockQuoteResult('AAPL', 178.5, 'REGULAR')]]),
    );

    const { status, data } = await callPost();
    expect(status).toBe(200);
    expect(data.updated).toBe(1);
    expect((data.failed as string[]).length).toBe(1);
    expect((data.failed as string[])[0]).toBe('BAD');

    // Only AAPL snapshot should exist
    const snapshotCount = (testCtx.sqlite.prepare('SELECT COUNT(*) as cnt FROM position_price_snapshots').get() as { cnt: number }).cnt;
    expect(snapshotCount).toBe(1);

    // BAD trade should still have null currentPrice
    const t2 = db.select({ cp: schema.trades.currentPrice }).from(schema.trades).where(eq(schema.trades.id, badTradeId)).get() as { cp: number | null };
    expect(t2.cp).toBeNull();
  });

  it('returns 429 on rate-limit', async () => {
    seedAccount();
    seedOpenTrade({ symbol: 'AAPL' });

    mockProviderCtx.setQuotes(
      new Map([['AAPL', createMockQuoteResult('AAPL', 178.5, 'REGULAR')]]),
    );

    // First refresh succeeds
    const r1 = await callPost();
    expect(r1.status).toBe(200);

    // Second immediate refresh should be rate-limited
    const r2 = await callPost();
    expect(r2.status).toBe(429);
    expect(r2.data.error).toBe('Rate limited');
    expect(r2.data.retryAfter).toBeDefined();
    expect(r2.headers?.['retry-after']).toBeDefined();
  });

  it('returns 500 when provider throws', async () => {
    seedAccount();
    seedOpenTrade({ symbol: 'AAPL' });

    // Configure mock provider to throw
    mockProviderCtx.setThrow(true);

    const { status, data } = await callPost();
    expect(status).toBe(500);
    expect(data.error).toBe('Failed to refresh MTM prices');
    expect(data.details).toBeDefined();
  });

  it('allows retry when all tickers fail (timer not reset)', async () => {
    seedAccount();
    seedOpenTrade({ symbol: 'A' });
    seedOpenTrade({ symbol: 'B' });

    // Empty quotes map — all symbols fail
    mockProviderCtx.setQuotes(new Map());

    // First call: all fail, updated=0, timer NOT reset
    const r1 = await callPost();
    expect(r1.status).toBe(200);
    expect(r1.data.updated).toBe(0);
    expect((r1.data.failed as string[]).length).toBe(2);

    // Since timer was not reset, a second call should NOT be rate-limited
    // But we need the rate limit to have passed, so add quotes now
    mockProviderCtx.setQuotes(
      new Map([['A', createMockQuoteResult('A', 100.0, 'REGULAR')]]),
    );
    const r2 = await callPost();
    expect(r2.status).toBe(200);
    expect(r2.data.updated).toBe(1);
  });

  it('writes valuation_marks when instrument exists', async () => {
    seedAccount();
    seedOpenTrade({ symbol: 'AAPL' });
    seedInstrument('AAPL');

    mockProviderCtx.setQuotes(
      new Map([['AAPL', createMockQuoteResult('AAPL', 150.25, 'REGULAR')]]),
    );

    const { status, data } = await callPost();
    expect(status).toBe(200);
    expect(data.updated).toBe(1);

    // Verify valuation_marks row was created
    const marks = testCtx.sqlite.prepare(
      `SELECT price, price_micros, source, idempotency_key, mark_timestamp
       FROM valuation_marks`,
    ).all() as Array<{
      price: string;
      price_micros: number;
      source: string;
      idempotency_key: string;
      mark_timestamp: string;
    }>;
    expect(marks).toHaveLength(1);
    expect(marks[0].price).toBe('150.25');
    expect(marks[0].price_micros).toBe(150250000);
    expect(marks[0].source).toBe('market_data');
    expect(marks[0].idempotency_key).toMatch(/^mtm-refresh:.+:.+$/);
    // mark_timestamp should be within the last minute
    const markTime = new Date(marks[0].mark_timestamp).getTime();
    const now = Date.now();
    expect(now - markTime).toBeLessThan(60_000);
  });

  it('auto-creates instrument when missing during refresh', async () => {
    seedAccount();
    seedOpenTrade({ symbol: 'SPY' });
    // No instrument seeded for SPY — should be auto-created

    mockProviderCtx.setQuotes(
      new Map([['SPY', createMockQuoteResult('SPY', 500.0, 'REGULAR')]]),
    );

    const { status, data } = await callPost();
    expect(status).toBe(200);
    expect(data.updated).toBe(1);

    // Verify instrument was auto-created with sensible defaults
    const instrument = testCtx.sqlite.prepare(
      'SELECT id, symbol, name, type, currency, is_active FROM instruments WHERE symbol = ?',
    ).get('SPY') as Record<string, unknown> | undefined;
    expect(instrument).toBeDefined();
    expect(instrument!.symbol).toBe('SPY');
    expect(instrument!.name).toBe('SPY');
    expect(instrument!.type).toBe('stock');
    expect(instrument!.currency).toBe('USD');
    expect(instrument!.is_active).toBe(1);

    // Valuation_mark should now be written (instrument exists)
    const markCount = (testCtx.sqlite.prepare(
      'SELECT COUNT(*) as cnt FROM valuation_marks',
    ).get() as { cnt: number }).cnt;
    expect(markCount).toBe(1);

    // Trade price was still updated
    const tradeId = (testCtx.sqlite.prepare(
      'SELECT id FROM trades WHERE symbol = ?',
    ).get('SPY') as { id: string }).id;
    const trade = db
      .select({ cp: schema.trades.currentPrice })
      .from(schema.trades)
      .where(eq(schema.trades.id, tradeId))
      .get() as { cp: number | null };
    expect(trade.cp).toBe(500.0);
  });

  it('writes valuation_marks for multiple trades with instruments', async () => {
    seedAccount();
    seedOpenTrade({ symbol: 'AAPL' });
    seedOpenTrade({ symbol: 'MSFT' });
    seedInstrument('AAPL');
    seedInstrument('MSFT');

    mockProviderCtx.setQuotes(
      new Map([
        ['AAPL', createMockQuoteResult('AAPL', 178.5, 'REGULAR')],
        ['MSFT', createMockQuoteResult('MSFT', 415.2, 'REGULAR')],
      ]),
    );

    const { status, data } = await callPost();
    expect(status).toBe(200);
    expect(data.updated).toBe(2);

    const markCount = (testCtx.sqlite.prepare(
      'SELECT COUNT(*) as cnt FROM valuation_marks',
    ).get() as { cnt: number }).cnt;
    expect(markCount).toBe(2);

    // Each mark has a unique idempotency key
    const keys = testCtx.sqlite.prepare(
      'SELECT idempotency_key FROM valuation_marks',
    ).all() as Array<{ idempotency_key: string }>;
    expect(keys[0].idempotency_key).not.toBe(keys[1].idempotency_key);
  });

  it('handles duplicate symbols without double-counting', async () => {
    seedAccount();
    seedOpenTrade({ symbol: 'AAPL' });
    seedOpenTrade({ symbol: 'AAPL' }); // Same symbol, different trade

    mockProviderCtx.setQuotes(
      new Map([['AAPL', createMockQuoteResult('AAPL', 180.0, 'REGULAR')]]),
    );

    const { status, data } = await callPost();
    expect(status).toBe(200);
    expect(data.updated).toBe(2);
    expect((data.failed as unknown[]).length).toBe(0);

    // Both trades should have snapshots
    const snapshotCount = (testCtx.sqlite.prepare('SELECT COUNT(*) as cnt FROM position_price_snapshots').get() as { cnt: number }).cnt;
    expect(snapshotCount).toBe(2);
  });

  it('returns expected shape when no trades at all exist', async () => {
    // No accounts, no trades — empty DB
    mockProviderCtx.setQuotes(new Map());

    const { status, data } = await callPost();
    expect(status).toBe(200);
    expect(data.updated).toBe(0);
    expect((data.failed as unknown[]).length).toBe(0);
    expect(data.timestamp).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
  });

  it('enriches NULL sector/industry from Yahoo profiles when provider omits them', async () => {
    seedAccount();
    seedOpenTrade({ symbol: 'WKC' });

    // Mock quote WITHOUT sector/industry (simulates Schwab provider behavior)
    mockProviderCtx.setQuotes(
      new Map([['WKC', {
        symbol: 'WKC',
        price: 25.0,
        marketState: 'REGULAR',
        source: 'schwab',
        shortName: 'WKC',
        quoteType: 'EQUITY',
      }]]),
    );

    // Set up mock enricher to return sector/industry for WKC
    mockEnricherCtx.setProfile('WKC', 'Energy', 'Oil & Gas');

    const { status, data } = await callPost();
    expect(status).toBe(200);
    expect(data.updated).toBe(1);
    expect((data.failed as unknown[]).length).toBe(0);

    // Verify the snapshot was enriched with Yahoo profile data
    const snapshot = testCtx.sqlite
      .prepare('SELECT sector, industry FROM position_price_snapshots')
      .get() as { sector: string | null; industry: string | null };

    expect(snapshot.sector).toBe('Energy');
    expect(snapshot.industry).toBe('Oil & Gas');
  });

  it('non-fatal when Yahoo profile enrichment fails', async () => {
    seedAccount();
    const tradeId = seedOpenTrade({ symbol: 'AAPL' });

    mockProviderCtx.setQuotes(
      new Map([['AAPL', createMockQuoteResult('AAPL', 150.0, 'REGULAR')]]),
    );

    // Make the enricher throw — enrichment should fail silently
    mockEnricherCtx.setThrow(true);

    const { status, data } = await callPost();
    expect(status).toBe(200);
    expect(data.updated).toBe(1);
    expect((data.failed as unknown[]).length).toBe(0);

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

  it('auto-creates account position when missing during refresh', async () => {
    seedAccount();
    const tradeId = seedOpenTrade({ symbol: 'AAPL' });
    seedInstrument('AAPL');
    // Seed two buy executions: 100 @ $50 and 50 @ $52
    seedTradeExecution(tradeId, { action: 'buy', quantity: 100, price: 50.0 });
    seedTradeExecution(tradeId, { action: 'buy', quantity: 50, price: 52.0 });
    // No account_position seeded — should be auto-created

    mockProviderCtx.setQuotes(
      new Map([['AAPL', createMockQuoteResult('AAPL', 60.0, 'REGULAR')]]),
    );

    const { status, data } = await callPost();
    expect(status).toBe(200);
    expect(data.updated).toBe(1);
    expect((data.failed as unknown[]).length).toBe(0);

    // Verify account_position was auto-created
    const instrument = testCtx.sqlite.prepare(
      'SELECT id FROM instruments WHERE symbol = ?',
    ).get('AAPL') as { id: string };

    const position = testCtx.sqlite.prepare(
      `SELECT direction, quantity, average_cost, total_cost_basis,
              realized_gross_pnl, realized_fees, realized_net_pnl
       FROM account_positions
       WHERE account_id = ? AND instrument_id = ?`,
    ).get(TEST_ACCOUNT_ID, instrument.id) as Record<string, unknown> | undefined;
    expect(position).toBeDefined();
    expect(position!.direction).toBe('long');
    // totalQty = 100 + 50 = 150
    expect(position!.quantity).toBe('150');
    // avgCost = (100*50 + 50*52) / 150 = (5000 + 2600) / 150 = 7600 / 150 = 50.666...
    expect(position!.average_cost).toBe(String((100 * 50 + 50 * 52) / 150));
    // totalCostBasis = 150 * 50.666...
    expect(position!.total_cost_basis).toBe(String(150 * (100 * 50 + 50 * 52) / 150));
    // Realized fields should be zero for a new position
    expect(position!.realized_gross_pnl).toBe('0.00');
    expect(position!.realized_fees).toBe('0.00');
    expect(position!.realized_net_pnl).toBe('0.00');

    // Valuation_mark should still be written
    const markCount = (testCtx.sqlite.prepare(
      'SELECT COUNT(*) as cnt FROM valuation_marks',
    ).get() as { cnt: number }).cnt;
    expect(markCount).toBe(1);
  });

  it('does not create duplicate account position if one already exists', async () => {
    seedAccount();
    const tradeId = seedOpenTrade({ symbol: 'AAPL' });
    seedInstrument('AAPL');
    seedTradeExecution(tradeId, { action: 'buy', quantity: 100, price: 50.0 });

    // Pre-seed an existing account position
    const instrument = testCtx.sqlite.prepare(
      'SELECT id FROM instruments WHERE symbol = ?',
    ).get('AAPL') as { id: string };
    const now = new Date().toISOString();
    db.insert(schema.accountPositions)
      .values({
        id: randomUUID(),
        accountId: TEST_ACCOUNT_ID,
        instrumentId: instrument.id,
        direction: 'long',
        quantity: '100',
        averageCost: '50.00',
        totalCostBasis: '5000.00',
        realizedGrossPnl: '0.00',
        realizedFees: '0.00',
        realizedNetPnl: '0.00',
        lastUpdated: now,
      })
      .run();

    mockProviderCtx.setQuotes(
      new Map([['AAPL', createMockQuoteResult('AAPL', 60.0, 'REGULAR')]]),
    );

    const { status, data } = await callPost();
    expect(status).toBe(200);
    expect(data.updated).toBe(1);

    // Verify no duplicate position was created — only 1 row
    const positionCount = (testCtx.sqlite.prepare(
      'SELECT COUNT(*) as cnt FROM account_positions WHERE account_id = ?',
    ).get(TEST_ACCOUNT_ID) as { cnt: number }).cnt;
    expect(positionCount).toBe(1);

    // Position should retain its original data
    const pos = testCtx.sqlite.prepare(
      'SELECT quantity, average_cost FROM account_positions WHERE account_id = ?',
    ).get(TEST_ACCOUNT_ID) as { quantity: string; average_cost: string };
    expect(pos.quantity).toBe('100');
    expect(pos.average_cost).toBe('50.00');
  });

  it('handles trade with no executions gracefully (no position created)', async () => {
    seedAccount();
    seedOpenTrade({ symbol: 'AAPL' });
    seedInstrument('AAPL');
    // No trade_executions seeded — trade has no fills

    mockProviderCtx.setQuotes(
      new Map([['AAPL', createMockQuoteResult('AAPL', 150.0, 'REGULAR')]]),
    );

    const { status, data } = await callPost();
    expect(status).toBe(200);
    expect(data.updated).toBe(1);
    expect((data.failed as unknown[]).length).toBe(0);

    // No account_position should exist
    const posCount = (testCtx.sqlite.prepare(
      'SELECT COUNT(*) as cnt FROM account_positions',
    ).get() as { cnt: number }).cnt;
    expect(posCount).toBe(0);

    // Valuation_mark should still be written
    const markCount = (testCtx.sqlite.prepare(
      'SELECT COUNT(*) as cnt FROM valuation_marks',
    ).get() as { cnt: number }).cnt;
    expect(markCount).toBe(1);
  });
});
