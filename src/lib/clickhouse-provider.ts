/**
 * clickhouse-provider.ts
 *
 * Concrete MarketOhlcProvider implementation backed by ClickHouse.
 *
 * Wraps the existing clickhouse-client as a MarketOhlcProvider, mapping
 * the interface's param-object-style methods to the client's positional-
 * argument-style methods.
 *
 * Usage (production):
 *   import { createDefaultClickHouseClient } from './clickhouse-client';
 *   import { ClickHouseProvider } from './clickhouse-provider';
 *   const provider = ClickHouseProvider.fromDefaultClient();
 *
 * Usage (test / DI):
 *   const client = createClickHouseClient(config);
 *   const provider = new ClickHouseProvider(client);
 *
 * Pattern: src/lib/market-ohlc-provider.ts (interface-based, composable)
 */

import type { MarketOhlcProvider, OhlcQueryParams, FeatureTimeSeriesQueryParams, FreshnessQueryParams } from './market-ohlc-provider';
import type { MarketEvidence, FeatureTimeSeries, FreshnessCheck, ClickHouseConfig } from './clickhouse-client';
import { createClickHouseClient, createDefaultClickHouseClient } from './clickhouse-client';

// ── Type Guard ───────────────────────────────────────────────────────────

/**
 * Narrowing guard: checks whether an object is a clickhouse-client instance
 * (has the `getMarketEvidence` method) vs. a plain ClickHouseConfig.
 */
function isClientInstance(
  value: ClickHouseConfig | ReturnType<typeof createClickHouseClient>,
): value is ReturnType<typeof createClickHouseClient> {
  return typeof (value as ReturnType<typeof createClickHouseClient>).getMarketEvidence === 'function';
}

// ── ClickHouseProvider ───────────────────────────────────────────────────

/**
 * MarketOhlcProvider implementation backed by ClickHouse.
 *
 * Delegates all data operations to the clickhouse-client and maps the
 * interface's param-object signatures to the client's positional args.
 */
export class ClickHouseProvider implements MarketOhlcProvider {
  readonly name = 'clickhouse';

  private client: ReturnType<typeof createClickHouseClient>;

  /**
   * Create a ClickHouseProvider wrapping an existing client instance
   * (for DI / testing) or a ClickHouseConfig (creates its own client).
   *
   * @param clientOrConfig - A clickhouse-client instance or a ClickHouseConfig
   */
  constructor(clientOrConfig: ClickHouseConfig | ReturnType<typeof createClickHouseClient>) {
    if (isClientInstance(clientOrConfig)) {
      this.client = clientOrConfig;
    } else {
      this.client = createClickHouseClient(clientOrConfig);
    }
  }

  /**
   * Convenience factory: creates a ClickHouseProvider using the default
   * client (resolves config from DB row, env vars, and defaults).
   */
  static fromDefaultClient(configOverride?: Partial<ClickHouseConfig>): ClickHouseProvider {
    const client = createDefaultClickHouseClient(configOverride);
    return new ClickHouseProvider(client);
  }

  // ── MarketOhlcProvider Implementation ─────────────────────────────────

  /**
   * Retrieve OHLC data from ClickHouse.
   *
   * Delegates to the client's getMarketEvidence.  When frequency is '10m',
   * returns an empty result with a note — intraday ClickHouse queries are
   * not yet implemented.
   */
  async getOhlc(params: OhlcQueryParams): Promise<MarketEvidence> {
    // Intraday (10m) frequency is not yet backed by ClickHouse
    if (params.frequency === '10m') {
      return {
        symbol: params.symbol,
        dataDateRange: { start: params.startDate, end: params.endDate },
        ohlc: [],
        notes: [
          `Intraday (10m) frequency not yet implemented for ClickHouse provider`,
        ],
      };
    }

    // Default: delegate to the daily OHLC query
    return this.client.getMarketEvidence({
      symbol: params.symbol,
      startDate: params.startDate,
      endDate: params.endDate,
    });
  }

  /**
   * Retrieve feature time-series data from ClickHouse.
   *
   * Unpacks the param-object signature to positional arguments for the
   * underlying clickhouse-client.
   */
  async getFeatureTimeSeries(
    params: FeatureTimeSeriesQueryParams,
  ): Promise<FeatureTimeSeries[]> {
    return this.client.getFeatureTimeSeries(
      params.symbol,
      params.features,
      params.startDate,
      params.endDate,
    );
  }

  /**
   * Check market data freshness in ClickHouse.
   *
   * Unpacks the optional param object to a positional thresholdDays argument.
   */
  async checkFreshness(params?: FreshnessQueryParams): Promise<FreshnessCheck> {
    return this.client.checkFreshness(params?.thresholdDays);
  }
}
