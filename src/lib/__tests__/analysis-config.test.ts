/**
 * analysis-config test
 *
 * Tests for AnalysisConfig types, schema, default configs, and parser.
 *
 * Covers:
 *   - AnalysisConfigSchema z.object shape with defaults
 *   - DataProviderEnum values
 *   - QULLAMAGGIE_ANALYSIS_CONFIG includes dataProvider
 *   - defaultAnalysisConfig() returns clickhouse
 *   - parseAnalysisConfig handles null/undefined, valid JSON, invalid JSON
 *
 * Run: npx vitest run src/lib/__tests__/analysis-config.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  AnalysisConfigSchema,
  DataProviderEnum,
  FeatureSourceEnum,
  FeatureModeEnum,
  QULLAMAGGIE_ANALYSIS_CONFIG,
  defaultAnalysisConfig,
  parseAnalysisConfig,
} from '../analysis-config';

describe('AnalysisConfigSchema', () => {
  it('returns defaults when called with empty object', () => {
    const result = AnalysisConfigSchema.parse({});
    expect(result.ohlcYears).toBe(1);
    expect(result.featureMode).toBe('custom');
    expect(result.includeRawOhlcv).toBe(true);
    expect(result.features).toEqual([]);
    expect(result.dataProvider).toBe('clickhouse');
  });

  it('accepts explicit dataProvider="clickhouse"', () => {
    const result = AnalysisConfigSchema.parse({ dataProvider: 'clickhouse' });
    expect(result.dataProvider).toBe('clickhouse');
  });

  it('accepts explicit dataProvider="schwab"', () => {
    const result = AnalysisConfigSchema.parse({ dataProvider: 'schwab' });
    expect(result.dataProvider).toBe('schwab');
  });

  it('rejects invalid dataProvider values', () => {
    const result = AnalysisConfigSchema.safeParse({ dataProvider: 'yfinance' });
    expect(result.success).toBe(false);
  });
});

describe('DataProviderEnum', () => {
  it('allows clickhouse', () => {
    expect(DataProviderEnum.parse('clickhouse')).toBe('clickhouse');
  });

  it('allows schwab', () => {
    expect(DataProviderEnum.parse('schwab')).toBe('schwab');
  });

  it('rejects unknown values', () => {
    const result = DataProviderEnum.safeParse('bloomberg');
    expect(result.success).toBe(false);
  });
});

describe('QULLAMAGGIE_ANALYSIS_CONFIG', () => {
  it('includes dataProvider field', () => {
    expect(QULLAMAGGIE_ANALYSIS_CONFIG).toHaveProperty('dataProvider');
  });

  it('defaults to clickhouse', () => {
    expect(QULLAMAGGIE_ANALYSIS_CONFIG.dataProvider).toBe('clickhouse');
  });

  it('preserves existing fields', () => {
    expect(QULLAMAGGIE_ANALYSIS_CONFIG.ohlcYears).toBe(1);
    expect(QULLAMAGGIE_ANALYSIS_CONFIG.featureMode).toBe('all');
    expect(QULLAMAGGIE_ANALYSIS_CONFIG.includeRawOhlcv).toBe(true);
    expect(QULLAMAGGIE_ANALYSIS_CONFIG.features).toEqual([]);
  });
});

describe('defaultAnalysisConfig', () => {
  it('returns clickhouse data provider', () => {
    const config = defaultAnalysisConfig();
    expect(config.dataProvider).toBe('clickhouse');
  });

  it('returns all features mode with OHLCV included', () => {
    const config = defaultAnalysisConfig();
    expect(config.featureMode).toBe('all');
    expect(config.includeRawOhlcv).toBe(true);
    expect(config.features).toEqual([]);
    expect(config.ohlcYears).toBe(1);
  });
});

describe('parseAnalysisConfig', () => {
  it('returns defaults for null input', () => {
    const config = parseAnalysisConfig(null);
    expect(config.dataProvider).toBe('clickhouse');
    expect(config.featureMode).toBe('all');
  });

  it('returns defaults for undefined input', () => {
    const config = parseAnalysisConfig(undefined);
    expect(config.dataProvider).toBe('clickhouse');
  });

  it('parses valid JSON with dataProvider=schwab', () => {
    const config = parseAnalysisConfig(
      JSON.stringify({ dataProvider: 'schwab' }),
    );
    expect(config.dataProvider).toBe('schwab');
    expect(config.ohlcYears).toBe(1); // default
  });

  it('parses valid JSON with all fields', () => {
    const config = parseAnalysisConfig(
      JSON.stringify({
        ohlcYears: 2,
        featureMode: 'custom',
        features: [{ id: 'sma_20', label: 'SMA(20)', source: 'clickhouse' }],
        includeRawOhlcv: false,
        dataProvider: 'schwab',
      }),
    );
    expect(config.ohlcYears).toBe(2);
    expect(config.featureMode).toBe('custom');
    expect(config.features).toHaveLength(1);
    expect(config.features[0].id).toBe('sma_20');
    expect(config.includeRawOhlcv).toBe(false);
    expect(config.dataProvider).toBe('schwab');
  });

  it('returns defaults for invalid JSON string', () => {
    const config = parseAnalysisConfig('not-json');
    expect(config.dataProvider).toBe('clickhouse');
  });

  it('returns defaults for JSON with invalid schema', () => {
    const config = parseAnalysisConfig(
      JSON.stringify({ ohlcYears: -1, dataProvider: 'bogus' }),
    );
    expect(config.dataProvider).toBe('clickhouse');
    expect(config.ohlcYears).toBe(1);
  });
});
