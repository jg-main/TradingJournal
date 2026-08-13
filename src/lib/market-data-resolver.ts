/**
 * market-data-resolver.ts
 *
 * Provider resolver module that reads market_data_settings from the database
 * and resolves the correct MarketOhlcProvider and MarketQuoteProvider instances.
 *
 * Used by the assessment engine (per-setup provider selection, T03) and the MTM
 * refresh route (global active provider selection, T02).
 *
 * Pure provider-resolution functions (testable without DB mocking):
 *   - resolveQuoteProviderFromSettings(activeProvider): MarketQuoteProvider
 *   - resolveOhlcProvider(providerName): MarketOhlcProvider
 *
 * DB-aware convenience functions:
 *   - readActiveMarketDataSettings(): MarketDataSettings | null
 *   - resolveQuoteProvider(): MarketQuoteProvider
 *
 * Pattern: src/lib/position-sizing.ts (pure-ish — function composition, DB read wrapped)
 * Dependencies: @/db, drizzle-orm, clickhouse-provider, schwab-provider, market-quote
 */

import { db } from '@/db';
import { marketDataSettings } from '@/db/schema';
import { ClickHouseProvider } from './clickhouse-provider';
import { SchwabProvider } from './schwab-provider';
import { YahooFinanceProvider } from './market-quote';
import type { MarketQuoteProvider } from './market-quote';
import type { MarketOhlcProvider } from './market-ohlc-provider';
import { resolveMtmRefreshIntervalSeconds } from './market-data-refresh-interval';

// ── Types ───────────────────────────────────────────────────────────────

/**
 * Read projection of the market_data_settings row.
 */
export interface MarketDataSettings {
  /** Global active provider for quote fetching ('clickhouse' | 'schwab') */
  activeProvider: string;
  /** Configured cadence for refreshing open-position marks. */
  refreshIntervalSeconds: number;
}

// ── DB Access ───────────────────────────────────────────────────────────

/**
 * Read the active market data settings from the database.
 *
 * Returns the settings object with activeProvider, or null if no settings
 * row exists (first-time setup scenario).
 *
 * Structured logging:
 *   { event: 'read_market_data_settings', found: boolean, activeProvider: string | null }
 */
export function readActiveMarketDataSettings(): MarketDataSettings | null {
  try {
    const row = db.select().from(marketDataSettings).limit(1).get();

    if (!row) {
      console.log(
        JSON.stringify({
          event: 'read_market_data_settings',
          found: false,
          activeProvider: null,
        }),
      );
      return null;
    }

    console.log(
      JSON.stringify({
        event: 'read_market_data_settings',
        found: true,
        activeProvider: row.activeProvider,
      }),
    );

    return {
      activeProvider: row.activeProvider,
      refreshIntervalSeconds: resolveMtmRefreshIntervalSeconds(
        row.refreshIntervalSeconds,
      ),
    };
  } catch (err) {
    console.error(
      JSON.stringify({
        event: 'read_market_data_settings_error',
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return null;
  }
}

// ── Pure Provider Resolvers ─────────────────────────────────────────────

/**
 * Resolve a MarketQuoteProvider from a provider name string.
 *
 * This is a pure function — no DB access. Takes the provider name string
 * and returns the correct MarketQuoteProvider instance.
 *
 * - 'schwab': Returns SchwabProvider.fromAuthClient() (falls back to
 *   YahooFinanceProvider when Schwab is not configured)
 * - anything else: Returns YahooFinanceProvider
 *
 * Structured logging:
 *   { event: 'resolve_quote_provider', provider: activeProvider, resolved: 'schwab' | 'yahoo' }
 */
export function resolveQuoteProviderFromSettings(
  activeProvider: string,
): MarketQuoteProvider {
  const provider = activeProvider?.toLowerCase().trim();

  if (provider === 'schwab') {
    const schwab = SchwabProvider.fromAuthClient();
    if (schwab) {
      console.log(
        JSON.stringify({
          event: 'resolve_quote_provider',
          provider: activeProvider,
          resolved: 'schwab',
        }),
      );
      return schwab;
    }

    // Schwab configured as active but not connected — log and fall back
    console.log(
      JSON.stringify({
        event: 'resolve_quote_provider',
        provider: activeProvider,
        resolved: 'yahoo',
        fallback: 'schwab_not_configured',
      }),
    );
  } else {
    console.log(
      JSON.stringify({
        event: 'resolve_quote_provider',
        provider: activeProvider,
        resolved: 'yahoo',
      }),
    );
  }

  // Default: YahooFinanceProvider
  return new YahooFinanceProvider();
}

/**
 * Resolve a MarketOhlcProvider from a provider name string.
 *
 * This is a pure function — no DB access. Takes the provider name string
 * and returns the correct MarketOhlcProvider instance.
 *
 * - 'clickhouse': Returns ClickHouseProvider.fromDefaultClient()
 * - 'schwab': Returns SchwabProvider.fromAuthClient() — falls back to
 *   ClickHouseProvider when Schwab is not configured
 * - default: Returns ClickHouseProvider.fromDefaultClient()
 *
 * Structured logging:
 *   { event: 'resolve_ohlc_provider', provider: string, resolved: 'clickhouse' | 'schwab', fallback?: string }
 */
export function resolveOhlcProvider(
  providerName: string,
): MarketOhlcProvider {
  const provider = providerName?.toLowerCase().trim();

  if (provider === 'schwab') {
    const schwab = SchwabProvider.fromAuthClient();
    if (schwab) {
      console.log(
        JSON.stringify({
          event: 'resolve_ohlc_provider',
          provider: providerName,
          resolved: 'schwab',
        }),
      );
      return schwab;
    }

    // Schwab configured but not connected — fall back to ClickHouse
    console.log(
      JSON.stringify({
        event: 'resolve_ohlc_provider',
        provider: providerName,
        resolved: 'clickhouse',
        fallback: 'schwab_not_configured',
      }),
    );
  } else {
    console.log(
      JSON.stringify({
        event: 'resolve_ohlc_provider',
        provider: providerName ?? 'clickhouse',
        resolved: 'clickhouse',
      }),
    );
  }

  // Default: ClickHouseProvider
  return ClickHouseProvider.fromDefaultClient();
}

/**
 * Resolve the active MarketQuoteProvider by reading market_data_settings
 * from the database.
 *
 * Shorthand for readActiveMarketDataSettings() + resolveQuoteProviderFromSettings().
 * Falls back to YahooFinanceProvider when no settings row exists.
 *
 * Structured logging:
 *   { event: 'resolve_quote_provider_db', activeProvider: string | null, resolved: 'schwab' | 'yahoo' }
 */
export function resolveQuoteProvider(): MarketQuoteProvider {
  const settings = readActiveMarketDataSettings();
  const activeProvider = settings?.activeProvider ?? 'yahoo';
  return resolveQuoteProviderFromSettings(activeProvider);
}
