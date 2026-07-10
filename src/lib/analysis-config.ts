/**
 * analysis-config.ts
 *
 * Types and helpers for setup-specific analysis configuration.
 * Controls what market data features to fetch and how to present them to the AI.
 *
 * Each setup definition can declare:
 *   - How many years of OHLC to fetch
 *   - Which indicator time series to include (from ClickHouse or computed)
 *   - Whether to include raw OHLCV
 *
 * Pattern: src/lib/scorecard.ts (pure types + functions, no DB dependency)
 */

import { z } from 'zod';

// ── Feature Config ──────────────────────────────────────────────────────

/**
 * Source of a time-series feature.
 * - 'clickhouse': Fetch pre-computed values from ClickHouse's features_equity_indicators_daily
 * - 'compute': Compute server-side from raw OHLC data
 */
export const FeatureSourceEnum = z.enum(['clickhouse', 'compute']);
export type FeatureSource = z.infer<typeof FeatureSourceEnum>;

/**
 * A single feature to include in the assessment prompt.
 *
 * Each feature produces a time series sent to the AI alongside OHLCV data.
 */
export const FeatureConfigSchema = z.object({
  /** Column name in ClickHouse or computation identifier */
  id: z.string().min(1, 'Feature ID is required'),
  /** Human-readable label shown in the prompt (e.g. 'SMA(20)', 'ATR(14)') */
  label: z.string().min(1, 'Feature label is required'),
  /** Where the feature data comes from */
  source: FeatureSourceEnum,
  /** Optional: unit or format hint (e.g. '%', '$', 'ratio') */
  unit: z.string().optional(),
});

export type FeatureConfig = z.infer<typeof FeatureConfigSchema>;

// ── Analysis Config ─────────────────────────────────────────────────────

/**
 * Full analysis configuration for a single setup.
 *
 * Stored as a JSON string in setup_definitions.analysis_config.
 * Controls what the assessment engine fetches, computes, and presents.
 */
export const FeatureModeEnum = z.enum(['all', 'custom']);
export type FeatureMode = z.infer<typeof FeatureModeEnum>;

export const AnalysisConfigSchema = z.object({
  /**
   * How many years of historical data to fetch.
   * Default: 1 year (full annual context for trends and prior moves).
   */
  ohlcYears: z.number().min(0.25).max(5).default(1),

  /**
   * What features to send to the AI.
   * - 'all': send the FULL set of ~82 pre-computed indicator columns from ClickHouse
   * - 'custom': send only the specific features listed in the `features` array
   */
  featureMode: FeatureModeEnum.default('custom'),

  /**
   * Time-series features to include in the prompt (used when featureMode='custom').
   * Each feature generates a labelled time series block.
   */
  features: z.array(FeatureConfigSchema).default([]),

  /**
   * Whether to include the raw OHLCV time series in the prompt.
   * The AI uses this for pattern recognition beyond what features cover.
   */
  includeRawOhlcv: z.boolean().default(true),
});

export type AnalysisConfig = z.infer<typeof AnalysisConfigSchema>;

// ── Default Configs ─────────────────────────────────────────────────────

/**
 * Default analysis config for Qullamaggie Breakout / BO.
 *
 * Uses ClickHouse features for SMAs, ATR, relative strength, and range
 * compression — all pre-computed. OHLCV included for consolidation
 * pattern recognition (higher lows, tightening range).
 */
export const QULLAMAGGIE_ANALYSIS_CONFIG: AnalysisConfig = {
  ohlcYears: 1,
  featureMode: 'all',
  includeRawOhlcv: true,
  features: [],
};

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Parse an analysis_config JSON string from the database.
 * Returns the parsed config on success, or the default Qullamaggie config
 * if parsing fails (graceful fallback for unconfigured setups).
 */
export function parseAnalysisConfig(json: string | null | undefined): AnalysisConfig {
  if (!json) {
    // No config configured — return default (all features + OHLCV)
    return { ohlcYears: 1, featureMode: 'all', includeRawOhlcv: true, features: [] };
  }

  try {
    const parsed = JSON.parse(json);
    const result = AnalysisConfigSchema.safeParse(parsed);
    if (result.success) return result.data;
    console.warn('Failed to parse analysis_config:', result.error.message);
    return { ohlcYears: 1, featureMode: 'all', includeRawOhlcv: true, features: [] };
  } catch {
    console.warn('Failed to parse analysis_config JSON');
    return { ohlcYears: 1, featureMode: 'all', includeRawOhlcv: true, features: [] };
  }
}
