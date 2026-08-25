/**
 * MTM refresh route test
 *
 * Tests POST /api/trades/mtm/refresh — batch quote fetching with rate-limit.
 *
 * Run: npx tsx src/app/api/trades/mtm/refresh/__tests__/route.test.ts
 * (uses testDbPath from src/lib/testing/test-db — OS temp, never the repo root)
 */

import { testDbPath } from '../../../../../../lib/testing/test-db';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';

import * as schema from '@/db/schema';
import { MockMarketQuoteProvider, createMockQuoteResult } from '@/lib/market-quote';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.error(`  ❌ ${msg} (FAILED)`);
  }
}

function assertEqual(actual: unknown, expected: unknown, msg: string) {
  if (actual === expected) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.error(`  ❌ ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)} (FAILED)`);
  }
}

function assertNotNull(value: unknown, msg: string) {
  if (value !== null && value !== undefined) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.error(`  ❌ ${msg} — value is null/undefined (FAILED)`);
  }
}

// ── Setup: test DB ──────────────────────────────────────────────────

const DB_FILE = process.env.DB_FILE_NAME || testDbPath('mtm-refresh');
const sqlite = new Database(DB_FILE);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
const db = drizzle(sqlite, { schema });

// Create tables
sqlite.exec(`
  DROP TABLE IF EXISTS position_price_snapshots;
  DROP TABLE IF EXISTS settings;
  DROP TABLE IF EXISTS account_rollforward;
  DROP TABLE IF EXISTS account_transactions;
  DROP TABLE IF EXISTS trade_stop_adjustments;
  DROP TABLE IF EXISTS trade_risk_snapshots;
  DROP TABLE IF EXISTS trade_mistakes;
  DROP TABLE IF EXISTS trade_grades;
  DROP TABLE IF EXISTS trade_executions;
  DROP TABLE IF EXISTS trade_assets;
  DROP TABLE IF EXISTS trades;
  DROP TABLE IF EXISTS watchlist_items;
  DROP TABLE IF EXISTS weekly_reviews;
  DROP TABLE IF EXISTS setup_definitions;
  DROP TABLE IF EXISTS lookup_values;
  DROP TABLE IF EXISTS accounts;
  CREATE TABLE accounts (
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
    risk_override_reason TEXT,
    opened_at TEXT,
    closed_at TEXT,
    reviewed_at TEXT,
    exit_notes TEXT,
    lesson TEXT,
    current_price REAL,
    current_price_fetched_at TEXT,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );
  CREATE TABLE IF NOT EXISTS position_price_snapshots (
    id TEXT PRIMARY KEY NOT NULL,
    trade_id TEXT NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
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
  CREATE INDEX IF NOT EXISTS idx_position_price_snapshots_trade_id_fetched_at
    ON position_price_snapshots(trade_id, fetched_at);
`);

// ── Simulated route logic (matching POST /api/trades/mtm/refresh) ────

/**
 * In-memory rate-limit state (mirrors the real route's module-level variable).
 * Reset before each test scenario that needs a fresh timer.
 */
let lastRefreshTimestampMs = 0;
const RATE_LIMIT_MS = 10_000;

function resetRateLimit() {
  lastRefreshTimestampMs = 0;
}

/**
 * Simulate POST /api/trades/mtm/refresh using a provided quote provider.
 *
 * @param provider - MarketQuoteProvider to use (MockMarketQuoteProvider in tests)
 * @param ignoreRateLimit - Skip rate-limit check (for positive tests that may run
 *   close together in wall-clock time)
 */
async function doRefresh(
  provider: MockMarketQuoteProvider,
  ignoreRateLimit = false,
): Promise<{ status: number; data: unknown; headers?: Record<string, string> }> {
  // ── Rate-limit check (skippable for sequential test scenarios) ──
  if (!ignoreRateLimit) {
    const now = Date.now();
    const elapsed = now - lastRefreshTimestampMs;
    if (elapsed < RATE_LIMIT_MS) {
      const retryAfter = Math.ceil((RATE_LIMIT_MS - elapsed) / 1000);
      return {
        status: 429,
        data: { error: 'Rate limited', retryAfter },
        headers: { 'Retry-After': String(retryAfter) },
      };
    }
  }

  try {
    // ── Find open trades ─────────────────────────────────────────
    const openTrades = db
      .select({ id: schema.trades.id, symbol: schema.trades.symbol, direction: schema.trades.direction })
      .from(schema.trades)
      .where(eq(schema.trades.status, 'open'))
      .all();

    if (openTrades.length === 0) {
      return {
        status: 200,
        data: {
          updated: 0,
          failed: [],
          timestamp: new Date().toISOString(),
        },
      };
    }

    // ── Fetch quotes ─────────────────────────────────────────────
    const symbols = [...new Set(openTrades.map((t) => t.symbol))];
    const quotes = await provider.getQuote(symbols);

    // ── Persist snapshots & update trade prices ──────────────────
    const quoteMap = new Map(quotes.map((q) => [q.symbol.toUpperCase(), q]));
    const nowISO = new Date().toISOString();

    const failed: string[] = [];
    let updated = 0;
    const seenTrades = new Set<string>();

    for (const trade of openTrades) {
      if (seenTrades.has(trade.id)) continue;
      seenTrades.add(trade.id);

      const symbolUpper = trade.symbol.toUpperCase();
      const quote = quoteMap.get(symbolUpper);

      if (!quote || quote.price === null || quote.error) {
        failed.push(trade.symbol);
        continue;
      }

      try {
        db.insert(schema.positionPriceSnapshots)
          .values({
            id: randomUUID(),
            tradeId: trade.id,
            price: quote.price,
            source: quote.source,
            marketState: quote.marketState,
            previousClose: quote.previousClose ?? null,
            dayHigh: quote.dayHigh ?? null,
            dayLow: quote.dayLow ?? null,
            change: quote.change ?? null,
            changePercent: quote.changePercent ?? null,
            fetchedAt: nowISO,
            createdAt: nowISO,
          })
          .run();

        db.update(schema.trades)
          .set({
            currentPrice: quote.price,
            currentPriceFetchedAt: nowISO,
            updatedAt: nowISO,
          })
          .where(eq(schema.trades.id, trade.id))
          .run();

        updated++;
      } catch {
        failed.push(trade.symbol);
      }
    }

    if (updated > 0) {
      lastRefreshTimestampMs = Date.now();
    }

    return {
      status: 200,
      data: { updated, failed, timestamp: nowISO },
    };
  } catch (error) {
    return {
      status: 500,
      data: { error: 'Failed to refresh MTM prices', details: String(error) },
    };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function cleanup() {
  sqlite.exec('DELETE FROM position_price_snapshots;');
  sqlite.exec('DELETE FROM trades;');
  sqlite.exec('DELETE FROM accounts;');
}

function seedAccount(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.accounts)
    .values({
      id,
      name: 'Test Account',
      broker: null,
      currency: 'USD',
      isActive: true,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .run();
  return db.select().from(schema.accounts).where(eq(schema.accounts.id, id)).get() as Record<string, unknown>;
}

function seedOpenTrade(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.trades)
    .values({
      id,
      tradeCode: `T-${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}`,
      accountId: 'test-account-id',
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
  return db.select().from(schema.trades).where(eq(schema.trades.id, id)).get() as Record<string, unknown>;
}

// ── Tests wrapped in async IIFE (required for tsx CJS compatibility) ─

async function main() {
  console.log('\n--- MTM Refresh API Tests ---\n');

  // ── 1. Multiple open trades → persists snapshots, returns {updated:2} ─

  console.log('\n1. Multiple open trades -> returns {updated:2}:');
  {
    cleanup();
    resetRateLimit();
    seedAccount({ id: 'test-account-id' });
    const trade1 = seedOpenTrade({ accountId: 'test-account-id', symbol: 'AAPL' });
    const trade2 = seedOpenTrade({ accountId: 'test-account-id', symbol: 'MSFT' });

    const quotes = new Map([
      ['AAPL', createMockQuoteResult('AAPL', 178.5, 'REGULAR')],
      ['MSFT', createMockQuoteResult('MSFT', 415.2, 'REGULAR')],
    ]);
    const provider = new MockMarketQuoteProvider(quotes);

    const result = await doRefresh(provider, true);
    assert(result.status === 200, 'returns 200');
    const data = result.data as Record<string, unknown>;
    assertEqual(data.updated, 2, 'updated = 2');
    assertEqual((data.failed as unknown[]).length, 0, 'failed is empty');
    assertNotNull(data.timestamp, 'timestamp is present');

    // Verify snapshots were persisted
    const snapshots = sqlite.prepare('SELECT COUNT(*) as cnt FROM position_price_snapshots').get() as { cnt: number };
    assertEqual(snapshots.cnt, 2, '2 snapshots persisted');

    // Verify trade prices were updated
    const t1 = db.select({ cp: schema.trades.currentPrice }).from(schema.trades).where(eq(schema.trades.id, trade1.id as string)).get() as { cp: number | null };
    assertEqual(t1.cp, 178.5, 'AAPL trade currentPrice updated to 178.5');
    const t2 = db.select({ cp: schema.trades.currentPrice }).from(schema.trades).where(eq(schema.trades.id, trade2.id as string)).get() as { cp: number | null };
    assertEqual(t2.cp, 415.2, 'MSFT trade currentPrice updated to 415.2');
  }

  // ── 2. No open trades → returns {updated:0} ──────────────────────────

  console.log('\n2. No open trades -> {updated:0}:');
  {
    cleanup();
    resetRateLimit();
    seedAccount({ id: 'test-account-id' });
    // Create a planned (not open) trade
    seedOpenTrade({ accountId: 'test-account-id', status: 'planned', symbol: 'AAPL' });

    const quotes = new Map([
      ['AAPL', createMockQuoteResult('AAPL', 180.0, 'REGULAR')],
    ]);
    const provider = new MockMarketQuoteProvider(quotes);

    const result = await doRefresh(provider, true);
    assert(result.status === 200, 'returns 200');
    const data = result.data as Record<string, unknown>;
    assertEqual(data.updated, 0, 'updated = 0');
    assertEqual((data.failed as unknown[]).length, 0, 'failed is empty');
  }

  // ── 3. Partial failure (one ticker fails) → updated:1, failed:['BAD'] ─

  console.log('\n3. Partial failure -> {updated:1, failed:[\'BAD\']}:');
  {
    cleanup();
    resetRateLimit();
    seedAccount({ id: 'test-account-id' });
    seedOpenTrade({ accountId: 'test-account-id', symbol: 'AAPL' });
    const _trade2 = seedOpenTrade({ accountId: 'test-account-id', symbol: 'BAD' });

    // Only provide a quote for AAPL — BAD will fail
    const quotes = new Map([
      ['AAPL', createMockQuoteResult('AAPL', 178.5, 'REGULAR')],
    ]);
    const provider = new MockMarketQuoteProvider(quotes);

    const result = await doRefresh(provider, true);
    assert(result.status === 200, 'returns 200');
    const data = result.data as Record<string, unknown>;
    assertEqual(data.updated, 1, 'updated = 1');
    assertEqual((data.failed as string[]).length, 1, 'failed has 1 entry');
    assertEqual((data.failed as string[])[0], 'BAD', 'failed contains BAD');

    // Only AAPL snapshot should exist
    const snapshots = sqlite.prepare('SELECT COUNT(*) as cnt FROM position_price_snapshots').get() as { cnt: number };
    assertEqual(snapshots.cnt, 1, 'only 1 snapshot persisted');

    // BAD trade should still have null currentPrice
    const t2 = db.select({ cp: schema.trades.currentPrice }).from(schema.trades).where(eq(schema.trades.id, _trade2.id as string)).get() as { cp: number | null };
    assertEqual(t2.cp, null, 'BAD trade currentPrice remains null');
  }

  // ── 4. Rate-limit → 429 ─────────────────────────────────────────────

  console.log('\n4. Rate-limit -> 429:');
  {
    cleanup();
    resetRateLimit();
    seedAccount({ id: 'test-account-id' });
    seedOpenTrade({ accountId: 'test-account-id', symbol: 'AAPL' });

    const quotes = new Map([
      ['AAPL', createMockQuoteResult('AAPL', 178.5, 'REGULAR')],
    ]);
    const provider = new MockMarketQuoteProvider(quotes);

    // First refresh succeeds
    const r1 = await doRefresh(provider, false);
    assert(r1.status === 200, 'first refresh succeeds');

    // Second immediate refresh should be rate-limited
    const r2 = await doRefresh(provider, false);
    assert(r2.status === 429, 'second refresh returns 429');
    const d2 = r2.data as Record<string, unknown>;
    assertEqual(d2.error, 'Rate limited', 'rate-limited error message');
    assertNotNull(d2.retryAfter, 'retryAfter is present');
    assertNotNull(r2.headers, 'Retry-After header present');
  }

  // ── 5. Provider throws → 500 ────────────────────────────────────────

  console.log('\n5. Provider throws -> 500:');
  {
    cleanup();
    resetRateLimit();
    seedAccount({ id: 'test-account-id' });
    seedOpenTrade({ accountId: 'test-account-id', symbol: 'AAPL' });

    // A mock provider that throws on getQuote
    const throwingProvider = {
      async getQuote(): Promise<never> {
        throw new Error('Network failure');
      },
    } as unknown as MockMarketQuoteProvider;

    try {
      const result = await doRefresh(throwingProvider, true);
      assert(result.status === 500, 'returns 500 on provider error');
      const data = result.data as Record<string, unknown>;
      assertEqual(data.error, 'Failed to refresh MTM prices', '500 error message');
    } catch {
      assert(false, 'doRefresh should not throw — it should return 500');
    }
  }

  // ── 6. All tickers fail → {updated:0, failed:['A','B']} ─────────────

  console.log('\n6. All tickers fail -> {updated:0, failed:[\'A\',\'B\']}:');
  {
    cleanup();
    resetRateLimit();
    seedAccount({ id: 'test-account-id' });
    seedOpenTrade({ accountId: 'test-account-id', symbol: 'A' });
    seedOpenTrade({ accountId: 'test-account-id', symbol: 'B' });

    // Empty quotes map — all symbols fail
    const quotes = new Map();
    const provider = new MockMarketQuoteProvider(quotes);

    const result = await doRefresh(provider, true);
    assert(result.status === 200, 'returns 200');
    const data = result.data as Record<string, unknown>;
    assertEqual(data.updated, 0, 'updated = 0');
    assertEqual((data.failed as string[]).length, 2, 'failed has 2 entries');
    assert(Array.isArray(data.failed), 'failed array is present');

    // Timer should NOT have been reset since nothing was updated
    // (if timer were reset, the next doRefresh without ignoreRateLimit would be blocked)
    const r2 = await doRefresh(provider, false);
    assert(r2.status === 200, 'retry is allowed when all tickers failed — timer not reset');
  }

  // ── 7. Duplicate symbols are not double-counted ─────────────────────

  console.log('\n7. Duplicate symbols not double-counted:');
  {
    cleanup();
    resetRateLimit();
    seedAccount({ id: 'test-account-id' });
    seedOpenTrade({ accountId: 'test-account-id', symbol: 'AAPL' });
    seedOpenTrade({ accountId: 'test-account-id', symbol: 'AAPL' }); // Same symbol, different trade

    const quotes = new Map([
      ['AAPL', createMockQuoteResult('AAPL', 180.0, 'REGULAR')],
    ]);
    const provider = new MockMarketQuoteProvider(quotes);

    const result = await doRefresh(provider, true);
    assert(result.status === 200, 'returns 200');
    const data = result.data as Record<string, unknown>;
    assertEqual(data.updated, 2, 'both AAPL trades are updated');
    assertEqual((data.failed as unknown[]).length, 0, 'no failures');

    // Both trades should have snapshots
    const snapshots = sqlite.prepare('SELECT COUNT(*) as cnt FROM position_price_snapshots').get() as { cnt: number };
    assertEqual(snapshots.cnt, 2, '2 snapshots for 2 trades with same symbol');
  }

  // ── Summary ──────────────────────────────────────────────────────────

  const total = passed + failed;
  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Results: ${passed}/${total} passed`);
  if (failed > 0) {
    console.error(`         ${failed}/${total} FAILED\n`);
    process.exit(1);
  } else {
    console.log('         All tests passed!\n');
  }
}

main().catch((err) => { console.error('Test error:', err); process.exit(1); });
