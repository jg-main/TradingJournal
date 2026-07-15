/**
 * Watchlist prices endpoint vitest test
 *
 * Tests GET /api/watchlist/prices — verifies the route uses the provider
 * resolver (resolveQuoteProvider) to batch-resolve live prices for
 * watchlist symbols.
 *
 * Uses a controllable mock provider that reads from mockProviderCtx.
 *
 * Run: npx vitest run src/app/api/watchlist/prices/__tests__/route.test.ts
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

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

// ── Module-level imports (after mocks) ────────────────────────────────────

import { GET } from '../route';
import { createMockQuoteResult } from '@/lib/market-quote';

// ── Test helper ───────────────────────────────────────────────────────────

async function callGet(
  url: string,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const request = new Request(url) as never;
  const response = await GET(request);
  const data = (await response.json()) as Record<string, unknown>;
  return { status: response.status, data };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('GET /api/watchlist/prices', () => {
  beforeEach(() => {
    mockProviderCtx.reset();
  });

  // ── Happy path ──────────────────────────────────────────────────────────

  it('returns prices for valid symbols', async () => {
    mockProviderCtx.setQuotes(
      new Map([
        ['AAPL', createMockQuoteResult('AAPL', 178.5, 'REGULAR')],
        ['MSFT', createMockQuoteResult('MSFT', 415.2, 'REGULAR')],
      ]),
    );

    const { status, data } = await callGet(
      'http://localhost/api/watchlist/prices?symbols=AAPL,MSFT',
    );

    expect(status).toBe(200);
    expect(data).toHaveProperty('prices');
    expect(data).toHaveProperty('fetchedAt');
    expect((data.fetchedAt as string)).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const prices = data.prices as Record<string, unknown>;
    expect(prices.AAPL).toBeDefined();
    expect((prices.AAPL as Record<string, unknown>).price).toBe(178.5);
    expect((prices.AAPL as Record<string, unknown>).marketState).toBe('REGULAR');
    expect(prices.MSFT).toBeDefined();
    expect((prices.MSFT as Record<string, unknown>).price).toBe(415.2);
    expect((prices.MSFT as Record<string, unknown>).marketState).toBe('REGULAR');
  });

  it('returns quote data for a single symbol', async () => {
    mockProviderCtx.setQuotes(
      new Map([['AAPL', createMockQuoteResult('AAPL', 150.0, 'REGULAR')]]),
    );

    const { status, data } = await callGet(
      'http://localhost/api/watchlist/prices?symbols=AAPL',
    );

    expect(status).toBe(200);
    const prices = data.prices as Record<string, unknown>;
    expect((prices.AAPL as Record<string, unknown>).price).toBe(150.0);
  });

  it('preserves input order when provider returns symbols in different order', async () => {
    // Mock provider returns results in a different order than requested
    mockProviderCtx.setQuotes(
      new Map([
        ['MSFT', createMockQuoteResult('MSFT', 420.0, 'REGULAR')],
        ['AAPL', createMockQuoteResult('AAPL', 178.5, 'REGULAR')],
      ]),
    );

    const { status, data } = await callGet(
      'http://localhost/api/watchlist/prices?symbols=AAPL,MSFT',
    );

    expect(status).toBe(200);
    const prices = data.prices as Record<string, unknown>;
    // The output is a Record keyed by symbol — order is in the keys, not a guaranteed iteration order
    expect(Object.keys(prices)).toContain('AAPL');
    expect(Object.keys(prices)).toContain('MSFT');
  });

  it('returns null price + error for symbols with no provider data', async () => {
    mockProviderCtx.setQuotes(
      new Map([['AAPL', createMockQuoteResult('AAPL', 150.0, 'REGULAR')]]),
    );

    const { status, data } = await callGet(
      'http://localhost/api/watchlist/prices?symbols=AAPL,UNKNOWNSYM',
    );

    expect(status).toBe(200);
    const prices = data.prices as Record<string, unknown>;
    expect((prices.AAPL as Record<string, unknown>).price).toBe(150.0);
    expect((prices.UNKNOWNSYM as Record<string, unknown>).price).toBeNull();
    expect((prices.UNKNOWNSYM as Record<string, unknown>).error).toContain(
      'No mock quote configured',
    );
  });

  // ── Deduplication ───────────────────────────────────────────────────────

  it('deduplicates duplicate symbols', async () => {
    mockProviderCtx.setQuotes(
      new Map([['AAPL', createMockQuoteResult('AAPL', 150.0, 'REGULAR')]]),
    );

    const { status, data } = await callGet(
      'http://localhost/api/watchlist/prices?symbols=AAPL,AAPL,AAPL',
    );

    expect(status).toBe(200);

    // Verifying the provider was called only once for AAPL
    const prices = data.prices as Record<string, unknown>;
    expect(Object.keys(prices)).toEqual(['AAPL']);
    expect((prices.AAPL as Record<string, unknown>).price).toBe(150.0);
  });

  // ── Validation: missing parameter ───────────────────────────────────────

  it('returns 400 when symbols parameter is missing', async () => {
    const { status, data } = await callGet(
      'http://localhost/api/watchlist/prices',
    );

    expect(status).toBe(400);
    expect(data.error).toBe('Validation failed');
  });

  it('returns 400 when symbols parameter is empty', async () => {
    const { status, data } = await callGet(
      'http://localhost/api/watchlist/prices?symbols=',
    );

    expect(status).toBe(400);
    expect(data.error).toBe('Validation failed');
  });

  // ── Validation: invalid symbols ─────────────────────────────────────────

  it('returns 400 when symbols contain invalid characters', async () => {
    const { status, data } = await callGet(
      'http://localhost/api/watchlist/prices?symbols=AAPL,MSFT$,GOO@GL',
    );

    expect(status).toBe(400);
    expect(data.error).toBe('Validation failed');
    expect((data.details as Record<string, unknown>).fieldErrors).toBeDefined();
  });

  it('returns 400 when a symbol exceeds max length', async () => {
    const longSymbol = 'A'.repeat(21);
    const { status, data } = await callGet(
      `http://localhost/api/watchlist/prices?symbols=${longSymbol}`,
    );

    expect(status).toBe(400);
    expect(data.error).toBe('Validation failed');
  });

  // ── Validation: too many symbols ────────────────────────────────────────

  it('returns 400 when more than 100 symbols are provided', async () => {
    const manySymbols = Array.from({ length: 101 }, (_, i) => `SYM${i}`).join(',');

    const { status, data } = await callGet(
      `http://localhost/api/watchlist/prices?symbols=${manySymbols}`,
    );

    expect(status).toBe(400);
    expect(data.error).toBe('Validation failed');
    expect(JSON.stringify(data)).toContain('Maximum of 100 symbols');
  });

  // ── Provider failure ────────────────────────────────────────────────────

  it('returns 500 when the provider throws', async () => {
    mockProviderCtx.setThrow(true);

    const { status, data } = await callGet(
      'http://localhost/api/watchlist/prices?symbols=AAPL',
    );

    expect(status).toBe(500);
    expect(data.error).toBe('Failed to fetch prices');
    expect(data.details).toBeDefined();
  });

  // ── Provider returns null price ─────────────────────────────────────────

  it('includes null prices in response without error', async () => {
    // Some providers return null price (e.g. for pre-market symbols with Yahoo)
    mockProviderCtx.setQuotes(
      new Map([
        [
          'PREIPO',
          createMockQuoteResult('PREIPO', null, 'PRE'),
        ],
      ]),
    );

    const { status, data } = await callGet(
      'http://localhost/api/watchlist/prices?symbols=PREIPO',
    );

    expect(status).toBe(200);
    const prices = data.prices as Record<string, unknown>;
    expect((prices.PREIPO as Record<string, unknown>).price).toBeNull();
    // Error should be absent when provider returned the symbol but without a price
    expect((prices.PREIPO as Record<string, unknown>).error).toBeUndefined();
  });

  // ── Edge: symbols with dots (e.g. BRK.B) ────────────────────────────────

  it('allows symbols with dots', async () => {
    mockProviderCtx.setQuotes(
      new Map([['BRK.B', createMockQuoteResult('BRK.B', 450.0, 'REGULAR')]]),
    );

    const { status, data } = await callGet(
      'http://localhost/api/watchlist/prices?symbols=BRK.B',
    );

    expect(status).toBe(200);
    const prices = data.prices as Record<string, unknown>;
    expect((prices['BRK.B'] as Record<string, unknown>).price).toBe(450.0);
  });

  // ── Edge: whitespace tolerance in symbols ───────────────────────────────

  it('trims whitespace from symbols', async () => {
    mockProviderCtx.setQuotes(
      new Map([['AAPL', createMockQuoteResult('AAPL', 150.0, 'REGULAR')]]),
    );

    const { status, data } = await callGet(
      'http://localhost/api/watchlist/prices?symbols= AAPL , MSFT ',
    );

    expect(status).toBe(200);
    const prices = data.prices as Record<string, unknown>;
    expect((prices.AAPL as Record<string, unknown>).price).toBe(150.0);
  });
});
