/**
 * profile-enricher.ts
 *
 * Standalone profile enrichment library that fetches sector and industry
 * metadata for stock ticker symbols via Yahoo Finance quoteSummary(assetProfile).
 *
 * Pure function — no DB dependency. Creates its own YahooFinance client instance.
 * Uses Promise.allSettled for concurrent per-symbol fetching so that a single
 * symbol failure does not block the remaining symbols.
 *
 * Pattern: standalone exported function, not a class method.
 */

import YahooFinance from "yahoo-finance2";

// ── Types ────────────────────────────────────────────────────────────────

/** Per-symbol profile result with sector and industry metadata. */
export interface ProfileResult {
  /** Ticker symbol (e.g. "AAPL") */
  symbol: string;
  /** Sector from Yahoo Finance assetProfile (e.g. "Technology") */
  sector?: string;
  /** Industry from Yahoo Finance assetProfile (e.g. "Consumer Electronics") */
  industry?: string;
  /** Human-readable error message when the profile could not be fetched */
  error?: string;
}

// ── Module-level client (lazy-initialized) ───────────────────────────────

let _client: InstanceType<typeof YahooFinance> | null = null;

function getClient(): InstanceType<typeof YahooFinance> {
  if (!_client) {
    _client = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
  }
  return _client;
}

// For testing: allow injecting a mock client
/** @internal */
export function __test__setClient(
  client: InstanceType<typeof YahooFinance> | null,
): void {
  _client = client;
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Fetch sector and industry profiles for the given stock ticker symbols.
 *
 * Each symbol is fetched independently via Promise.allSettled so that a
 * failure for one symbol does not prevent other symbols from resolving.
 * Symbols with no assetProfile or missing sector/industry return undefined
 * values rather than errors.
 *
 * @param symbols - Array of ticker symbols (case-insensitive, upper-cased internally)
 * @returns Map of symbol to ProfileResult with sector, industry, and optional error
 */
export async function fetchYahooProfiles(
  symbols: string[],
): Promise<Map<string, ProfileResult>> {
  const map = new Map<string, ProfileResult>();

  if (symbols.length === 0) {
    return map;
  }

  const client = getClient();
  const uniqueSymbols = [...new Set(symbols.map((s) => s.toUpperCase()))];

  const results = await Promise.allSettled(
    uniqueSymbols.map(async (symbol) => {
      const summary = await client.quoteSummary(symbol, {
        modules: ["assetProfile"],
      });
      const p = (
        summary as { assetProfile?: { sector?: string; industry?: string } }
      )?.assetProfile;
      return {
        symbol,
        sector: typeof p?.sector === "string" ? p.sector : undefined,
        industry: typeof p?.industry === "string" ? p.industry : undefined,
      };
    }),
  );

  for (const r of results) {
    if (r.status === "fulfilled") {
      map.set(r.value.symbol, {
        symbol: r.value.symbol,
        sector: r.value.sector,
        industry: r.value.industry,
      });
    }
    // Rejected symbols are silently skipped — the map omits them entirely
    // (callers interpret absence as "profile unavailable").
  }

  return map;
}
