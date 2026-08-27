/**
 * market-data-resolver.test.ts
 *
 * Comprehensive Vitest tests for src/lib/market-data-resolver.ts.
 *
 * Tests the pure provider routing functions (resolveQuoteProviderFromSettings,
 * resolveOhlcProvider) and the DB-aware convenience functions
 * (readActiveMarketDataSettings, resolveQuoteProvider).
 *
 * Uses an in-memory SQLite database (via vi.hoisted + vi.mock) so
 * DB dependencies are satisfied without hitting a real database.
 *
 * Run: npx vitest run src/lib/__tests__/market-data-resolver.test.ts
 */

import { vi, test, expect } from 'vitest';

// ── Hoisted: in-memory SQLite DB ─────────────────────────────────────────
// Provides a drizzle instance for @/db mock. The market_data_settings
// table is NOT created here — tests verify graceful fallback when the
// table does not exist.

const testCtx = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3');

  const sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  return { sqlite };
});

// ── Mock @/db ───────────────────────────────────────────────────────────
// The resolver imports { db } from '@/db' and { marketDataSettings } from
// '@/db/schema'. We replace @/db with a bare drizzle instance wrapping our
// in-memory SQLite so DB operations are isolated.

vi.mock('@/db', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { drizzle } = require('drizzle-orm/better-sqlite3');
  const db = drizzle(testCtx.sqlite);
  return {
    db,
    getSqliteHandle: () => testCtx.sqlite,
    initializeDatabase: () => db,
  };
});

// ── Module-level imports ────────────────────────────────────────────────

import {
  resolveQuoteProviderFromSettings,
  resolveOhlcProvider,
  readActiveMarketDataSettings,
  resolveQuoteProvider,
  isPlaywrightMockMarketDataEnabled,
} from '../market-data-resolver';
import { ClickHouseProvider } from '../clickhouse-provider';
import {
  YahooFinanceProvider,
  DeterministicMarketQuoteProvider,
} from '../market-quote';

// ── Assertion helpers ────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    passed++;
    console.log(`  \u2705 ${msg}`);
  } else {
    failed++;
    console.error(`  \u274c ${msg} (FAILED)`);
  }
}

function assertEqual(actual: unknown, expected: unknown, msg: string) {
  if (actual === expected) {
    passed++;
    console.log(`  \u2705 ${msg}`);
  } else {
    failed++;
    console.error(
      `  \u274c ${msg} \u2014 expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)} (FAILED)`,
    );
  }
}

// ── Test Suite ──────────────────────────────────────────────────────────

test('Provider Resolver Module', async () => {
  console.log('\n=== resolveQuoteProviderFromSettings Tests (Pure Function) ===\n');

  // ── 1. 'schwab' → YahooFinanceProvider (Schwab not configured in CI) ──

  console.log('1. resolveQuoteProviderFromSettings("schwab") returns YahooFinanceProvider (Schwab not configured):');
  {
    const provider = resolveQuoteProviderFromSettings('schwab');
    assert(
      provider instanceof YahooFinanceProvider,
      'returns YahooFinanceProvider when Schwab is not configured',
    );
  }

  // ── 2. 'clickhouse' → YahooFinanceProvider ────────────────────────────
  // ClickHouse does NOT implement MarketQuoteProvider, so the resolver
  // returns YahooFinanceProvider as the fallback for all non-'schwab' values.

  console.log('2. resolveQuoteProviderFromSettings("clickhouse") returns YahooFinanceProvider:');
  {
    const provider = resolveQuoteProviderFromSettings('clickhouse');
    assert(provider instanceof YahooFinanceProvider, 'returns YahooFinanceProvider for clickhouse');
  }

  // ── 3. Empty string → YahooFinanceProvider ────────────────────────────

  console.log('3. resolveQuoteProviderFromSettings("") returns YahooFinanceProvider:');
  {
    const provider = resolveQuoteProviderFromSettings('');
    assert(provider instanceof YahooFinanceProvider, 'returns YahooFinanceProvider for empty string');
  }

  // ── 4. 'yahoo' → YahooFinanceProvider ────────────────────────────────

  console.log('4. resolveQuoteProviderFromSettings("yahoo") returns YahooFinanceProvider:');
  {
    const provider = resolveQuoteProviderFromSettings('yahoo');
    assert(provider instanceof YahooFinanceProvider, 'returns YahooFinanceProvider for yahoo');
  }

  // ── 5. Case insensitivity ─────────────────────────────────────────────

  console.log('5. resolveQuoteProviderFromSettings is case-insensitive:');
  {
    const provider = resolveQuoteProviderFromSettings('SCHWAB');
    assert(provider instanceof YahooFinanceProvider, 'handles SCHWAB (uppercase)');
  }

  console.log('\n=== resolveOhlcProvider Tests (Pure Function) ===\n');

  // ── 6. 'clickhouse' → ClickHouseProvider ──────────────────────────────

  console.log('6. resolveOhlcProvider("clickhouse") returns ClickHouseProvider:');
  {
    const provider = resolveOhlcProvider('clickhouse');
    assert(provider instanceof ClickHouseProvider, 'returns ClickHouseProvider');
    assertEqual(provider.name, 'clickhouse', 'provider.name is clickhouse');
  }

  // ── 7. 'schwab' → ClickHouseProvider (fallback, no Schwab in CI) ─────

  console.log('7. resolveOhlcProvider("schwab") returns ClickHouseProvider (Schwab fallback):');
  {
    const provider = resolveOhlcProvider('schwab');
    assert(provider instanceof ClickHouseProvider, 'returns ClickHouseProvider fallback');
    assertEqual(provider.name, 'clickhouse', 'provider.name is clickhouse (fallback)');
  }

  // ── 8. Empty string → ClickHouseProvider ──────────────────────────────

  console.log('8. resolveOhlcProvider("") returns ClickHouseProvider:');
  {
    const provider = resolveOhlcProvider('');
    assert(provider instanceof ClickHouseProvider, 'returns ClickHouseProvider for empty string');
    assertEqual(provider.name, 'clickhouse', 'provider.name is clickhouse');
  }

  // ── 9. Unknown provider name → ClickHouseProvider (default) ──────────

  console.log('9. resolveOhlcProvider("unknown") returns ClickHouseProvider:');
  {
    const provider = resolveOhlcProvider('unknown');
    assert(provider instanceof ClickHouseProvider, 'returns ClickHouseProvider for unknown provider');
    assertEqual(provider.name, 'clickhouse', 'provider.name is clickhouse (default)');
  }

  // ── 10. Case insensitivity ────────────────────────────────────────────

  console.log('10. resolveOhlcProvider is case-insensitive:');
  {
    const provider = resolveOhlcProvider('ClickHouse');
    assert(provider instanceof ClickHouseProvider, 'handles ClickHouse (mixed case)');
    assertEqual(provider.name, 'clickhouse', 'provider.name is clickhouse');
  }

  console.log('\n=== readActiveMarketDataSettings Tests ===\n');

  // ── 11. No table → null ───────────────────────────────────────────────
  // The in-memory DB has no market_data_settings table, so the function
  // gracefully catches the error and returns null.

  console.log('11. readActiveMarketDataSettings returns null when DB table does not exist:');
  {
    const settings = readActiveMarketDataSettings();
    assertEqual(settings, null, 'returns null when no market_data_settings table');
  }

  console.log('\n=== resolveQuoteProvider Tests ===\n');

  // ── 12. No settings → YahooFinanceProvider fallback ──────────────────

  console.log('12. resolveQuoteProvider returns YahooFinanceProvider when no DB row:');
  {
    const provider = resolveQuoteProvider();
    assert(
      provider instanceof YahooFinanceProvider,
      'returns YahooFinanceProvider fallback',
    );
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
});

test('Playwright deterministic-market-data fixture boundary', async () => {
  const localPassed = passed;
  const localFailed = failed;

  // process.env is typed readonly for NODE_ENV; use a mutable view for the
  // fixture-boundary assertions.
  const mutableEnv = process.env as Record<string, string | undefined>;
  const savedFlag = mutableEnv.PLAYWRIGHT_MOCK_MARKET_DATA;
  const savedNodeEnv = mutableEnv.NODE_ENV;

  try {
    // A. No flag → unchanged provider-resolution behavior (Yahoo path).
    delete mutableEnv.PLAYWRIGHT_MOCK_MARKET_DATA;
    mutableEnv.NODE_ENV = 'test';
    assert(
      isPlaywrightMockMarketDataEnabled() === false,
      'no flag → fixture disabled',
    );
    assert(
      resolveQuoteProviderFromSettings('yahoo') instanceof YahooFinanceProvider,
      'no flag → YahooFinanceProvider (unchanged resolution path)',
    );

    // B. Explicit flag + non-production → deterministic provider.
    mutableEnv.PLAYWRIGHT_MOCK_MARKET_DATA = '1';
    assert(
      isPlaywrightMockMarketDataEnabled() === true,
      'flag on (non-production) → fixture enabled',
    );
    const provider = resolveQuoteProviderFromSettings('schwab');
    assert(
      provider instanceof DeterministicMarketQuoteProvider,
      'flag on → DeterministicMarketQuoteProvider',
    );
    const quotes = await provider.getQuote(['AAPL', 'MSFT']);
    assertEqual(quotes.length, 2, 'two quotes returned');
    assert(
      quotes.every((q) => typeof q.price === 'number' && q.price !== null && q.price > 0),
      'all quotes have valid non-null prices',
    );
    assert(
      quotes.every((q) => q.source === 'mock'),
      'quote provenance source is mock',
    );
    // Determinism: repeated call returns identical prices.
    const again = await provider.getQuote(['AAPL', 'MSFT']);
    assertEqual(
      JSON.stringify(again.map((q) => q.price)),
      JSON.stringify(quotes.map((q) => q.price)),
      'repeated call returns identical deterministic prices',
    );

    // C. Arbitrary browser-test symbol still receives a deterministic quote.
    const arbitrary = await provider.getQuote(['OPENTRADEFFE3A']);
    assertEqual(arbitrary.length, 1, 'one quote for arbitrary symbol');
    assert(
      typeof arbitrary[0].price === 'number' && arbitrary[0].price !== null && arbitrary[0].price > 0,
      'arbitrary symbol gets a valid deterministic quote (no provider lookup)',
    );

    // D. Production guard: NODE_ENV=production + flag → NOT deterministic.
    mutableEnv.NODE_ENV = 'production';
    assert(
      isPlaywrightMockMarketDataEnabled() === false,
      'NODE_ENV=production + flag → fixture disabled',
    );
    assert(
      resolveQuoteProviderFromSettings('yahoo') instanceof YahooFinanceProvider,
      'NODE_ENV=production + flag → real provider path (never the fixture)',
    );
  } finally {
    // E. No flag leakage: restore prior environment so tests stay
    // order-independent.
    if (savedFlag === undefined) {
      delete mutableEnv.PLAYWRIGHT_MOCK_MARKET_DATA;
    } else {
      mutableEnv.PLAYWRIGHT_MOCK_MARKET_DATA = savedFlag;
    }
    if (savedNodeEnv === undefined) {
      delete mutableEnv.NODE_ENV;
    } else {
      mutableEnv.NODE_ENV = savedNodeEnv;
    }
  }

  const fixturePassed = passed - localPassed;
  const fixtureFailed = failed - localFailed;
  console.log(`\n=== Fixture boundary results: ${fixturePassed} passed, ${fixtureFailed} failed ===`);
});
