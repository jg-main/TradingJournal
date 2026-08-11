/**
 * freshness-policy.test.ts
 *
 * Tests for the central freshness policy library: config resolution with
 * per-scope overrides and provenance, mark-status classification with an
 * injectable clock, completeness classification, and coverage percentage.
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_FRESHNESS_THRESHOLD_MINUTES,
  DEFAULT_FRESHNESS_POLICY_CONFIG,
  createFreshnessPolicy,
  resolveFreshnessPolicy,
  classifyMarkStatus,
  classifyCompleteness,
  computeCoveragePct,
  computeMarkAgeMinutes,
} from '../freshness-policy';

// Fixed reference time for clock injection: 2026-08-11T12:00:00.000Z
const FIXED_NOW = new Date('2026-08-11T12:00:00.000Z');
const MINUTE = 60_000;

function minutesAgo(minutes: number): string {
  return new Date(FIXED_NOW.getTime() - minutes * MINUTE).toISOString();
}

describe('resolveFreshnessPolicy — defaults and provenance', () => {
  it('resolves the canonical 24-hour default when no config or scope is given', () => {
    const resolved = resolveFreshnessPolicy(DEFAULT_FRESHNESS_POLICY_CONFIG);
    expect(resolved.thresholdMinutes).toBe(DEFAULT_FRESHNESS_THRESHOLD_MINUTES);
    expect(resolved.thresholdMinutes).toBe(1440);
    expect(resolved.resolvedFrom).toBe('default:1440');
  });

  it('honours a custom default threshold', () => {
    const resolved = resolveFreshnessPolicy({ defaultThresholdMinutes: 60 });
    expect(resolved.thresholdMinutes).toBe(60);
    expect(resolved.resolvedFrom).toBe('default:60');
  });

  it('falls back to the canonical default when config omits a threshold', () => {
    const resolved = resolveFreshnessPolicy({});
    expect(resolved.thresholdMinutes).toBe(DEFAULT_FRESHNESS_THRESHOLD_MINUTES);
  });

  it('applies the default when overrides exist but no scope is provided', () => {
    const resolved = resolveFreshnessPolicy({
      defaultThresholdMinutes: 90,
      overrides: [{ scope: { provider: 'user' }, thresholdMinutes: 30 }],
    });
    expect(resolved.thresholdMinutes).toBe(90);
    expect(resolved.resolvedFrom).toBe('default:90');
  });
});

describe('resolveFreshnessPolicy — per-scope overrides', () => {
  const config = {
    defaultThresholdMinutes: 1440,
    overrides: [
      { scope: { provider: 'user' }, thresholdMinutes: 30 },
      { scope: { assetClass: 'option' }, thresholdMinutes: 45 },
      { scope: { marketSession: 'pre' }, thresholdMinutes: 15 },
      { scope: { account: 'acc-1' }, thresholdMinutes: 60 },
    ],
  };

  it('matches an override by provider', () => {
    const resolved = resolveFreshnessPolicy(config, { provider: 'user' });
    expect(resolved.thresholdMinutes).toBe(30);
    expect(resolved.resolvedFrom).toBe('override:provider=user (30 minutes)');
  });

  it('matches an override by asset class', () => {
    const resolved = resolveFreshnessPolicy(config, { assetClass: 'option' });
    expect(resolved.thresholdMinutes).toBe(45);
    expect(resolved.resolvedFrom).toBe('override:assetClass=option (45 minutes)');
  });

  it('matches an override by market session', () => {
    const resolved = resolveFreshnessPolicy(config, { marketSession: 'pre' });
    expect(resolved.thresholdMinutes).toBe(15);
    expect(resolved.resolvedFrom).toContain('marketSession=pre');
  });

  it('matches an override by account', () => {
    const resolved = resolveFreshnessPolicy(config, { account: 'acc-1' });
    expect(resolved.thresholdMinutes).toBe(60);
    expect(resolved.resolvedFrom).toContain('account=acc-1');
  });

  it('falls back to the default when no override matches the scope', () => {
    const resolved = resolveFreshnessPolicy(config, { provider: 'market_data' });
    expect(resolved.thresholdMinutes).toBe(1440);
    expect(resolved.resolvedFrom).toBe('default:1440');
  });

  it('treats absent override dimensions as wildcards', () => {
    // provider=user override applies regardless of asset class.
    const resolved = resolveFreshnessPolicy(config, {
      provider: 'user',
      assetClass: 'stock',
    });
    expect(resolved.thresholdMinutes).toBe(30);
  });

  it('picks the most specific matching override over a wildcard one', () => {
    const specificConfig = {
      defaultThresholdMinutes: 1440,
      overrides: [
        { scope: { assetClass: 'stock' }, thresholdMinutes: 90 },
        { scope: { assetClass: 'stock', provider: 'market_data' }, thresholdMinutes: 45 },
      ],
    };
    const resolved = resolveFreshnessPolicy(specificConfig, {
      assetClass: 'stock',
      provider: 'market_data',
    });
    expect(resolved.thresholdMinutes).toBe(45);
    expect(resolved.resolvedFrom).toBe(
      'override:assetClass=stock,provider=market_data (45 minutes)',
    );
  });

  it('resolves the last equally-specific override (documented tie rule)', () => {
    const tieConfig = {
      defaultThresholdMinutes: 1440,
      overrides: [
        { scope: { provider: 'user' }, thresholdMinutes: 30 },
        { scope: { provider: 'user' }, thresholdMinutes: 20 },
      ],
    };
    const resolved = resolveFreshnessPolicy(tieConfig, { provider: 'user' });
    expect(resolved.thresholdMinutes).toBe(20);
  });

  it('does not match an override whose dimensions differ from the scope', () => {
    const resolved = resolveFreshnessPolicy(
      { overrides: [{ scope: { provider: 'user' }, thresholdMinutes: 30 }] },
      { provider: 'market_data' },
    );
    expect(resolved.thresholdMinutes).toBe(DEFAULT_FRESHNESS_THRESHOLD_MINUTES);
  });
});

describe('computeMarkAgeMinutes', () => {
  it('computes rounded age in minutes from a timestamp against a fixed now', () => {
    expect(computeMarkAgeMinutes(minutesAgo(30), FIXED_NOW)).toBe(30);
    expect(computeMarkAgeMinutes(minutesAgo(90), FIXED_NOW)).toBe(90);
    expect(computeMarkAgeMinutes(FIXED_NOW.toISOString(), FIXED_NOW)).toBe(0);
  });

  it('returns null for an unparseable timestamp', () => {
    expect(computeMarkAgeMinutes('not-a-date', FIXED_NOW)).toBeNull();
  });
});

describe('classifyMarkStatus', () => {
  it('classifies a null timestamp as missing', () => {
    expect(classifyMarkStatus(null, null, FIXED_NOW, 1440)).toBe('missing');
  });

  it('classifies an empty timestamp as missing', () => {
    expect(classifyMarkStatus('', null, FIXED_NOW, 1440)).toBe('missing');
  });

  it('classifies a pre-computed age at or below the threshold as fresh', () => {
    expect(classifyMarkStatus(minutesAgo(59), 59, FIXED_NOW, 60)).toBe('fresh');
    // Boundary: exactly at the threshold is still fresh.
    expect(classifyMarkStatus(minutesAgo(60), 60, FIXED_NOW, 60)).toBe('fresh');
  });

  it('classifies a pre-computed age above the threshold as stale', () => {
    expect(classifyMarkStatus(minutesAgo(61), 61, FIXED_NOW, 60)).toBe('stale');
  });

  it('derives age from timestamps when no pre-computed age is given', () => {
    expect(classifyMarkStatus(minutesAgo(30), null, FIXED_NOW, 60)).toBe('fresh');
    expect(classifyMarkStatus(minutesAgo(90), null, FIXED_NOW, 60)).toBe('stale');
  });

  it('treats future timestamps as fresh', () => {
    const future = new Date(FIXED_NOW.getTime() + 10 * MINUTE).toISOString();
    expect(classifyMarkStatus(future, null, FIXED_NOW, 60)).toBe('fresh');
  });

  it('never classifies an unparseable timestamp as fresh — it is stale', () => {
    // A mark exists (price is populated) but cannot be dated. JS Date parsing
    // yields NaN rather than throwing, and NaN <= threshold is false, so the
    // mark is classified stale — never fresh. This matches the legacy
    // dashboard-v2 classifier and the product stance: undateable marks are
    // shown but flagged as not fresh.
    expect(classifyMarkStatus('garbage', null, FIXED_NOW, 60)).toBe('stale');
  });

  it('trusts an explicit pre-computed age even when the timestamp is unparseable', () => {
    // The pre-computed age takes precedence over timestamp parsing: an age of
    // 5 minutes is fresh regardless of the unparseable timestamp string.
    expect(classifyMarkStatus('garbage', 5, FIXED_NOW, 60)).toBe('fresh');
    expect(classifyMarkStatus('garbage', 65, FIXED_NOW, 60)).toBe('stale');
  });

  it('classifies boundary age without rounding in the timestamp-derived path', () => {
    // 30.5 minutes old, threshold 30 → stale in the unrounded path.
    const ts = new Date(FIXED_NOW.getTime() - 30.5 * MINUTE).toISOString();
    expect(classifyMarkStatus(ts, null, FIXED_NOW, 30)).toBe('stale');
  });
});

describe('classifyCompleteness', () => {
  it('classifies zero positions as complete (vacuous truth)', () => {
    expect(classifyCompleteness(0, 0, 0, 0)).toBe('complete');
  });

  it('classifies all missing as unavailable', () => {
    expect(classifyCompleteness(3, 0, 0, 3)).toBe('unavailable');
  });

  it('classifies all fresh as complete', () => {
    expect(classifyCompleteness(2, 2, 0, 0)).toBe('complete');
  });

  it('classifies all stale as stale', () => {
    expect(classifyCompleteness(2, 0, 2, 0)).toBe('stale');
  });

  it('classifies mixed coverage as partial', () => {
    expect(classifyCompleteness(3, 1, 0, 2)).toBe('partial');
    expect(classifyCompleteness(3, 1, 1, 1)).toBe('partial');
    expect(classifyCompleteness(2, 0, 1, 1)).toBe('partial');
  });
});

describe('computeCoveragePct', () => {
  it('returns null for zero positions (0/0 is not a percentage)', () => {
    expect(computeCoveragePct(0, 0)).toBeNull();
  });

  it('computes canonical coverage percentages', () => {
    expect(computeCoveragePct(4, 2)).toBe('50.00');
    expect(computeCoveragePct(3, 1)).toBe('33.33');
    expect(computeCoveragePct(2, 2)).toBe('100.00');
    expect(computeCoveragePct(2, 0)).toBe('0.00');
  });
});

describe('createFreshnessPolicy — injectable policy and clock', () => {
  it('exposes the resolved threshold and provenance on the policy', () => {
    const policy = createFreshnessPolicy({ defaultThresholdMinutes: 30 });
    expect(policy.thresholdMinutes).toBe(30);
    expect(policy.resolvedFrom).toBe('default:30');
  });

  it('uses the injected clock for age derivation and classification', () => {
    const policy = createFreshnessPolicy(
      { defaultThresholdMinutes: 60 },
      undefined,
      () => FIXED_NOW,
    );
    // 30 minutes before the fixed clock → fresh; 90 minutes → stale.
    expect(policy.classifyMarkStatus(minutesAgo(30))).toBe('fresh');
    expect(policy.classifyMarkStatus(minutesAgo(90))).toBe('stale');
    expect(policy.computeMarkAgeMinutes(minutesAgo(45))).toBe(45);
  });

  it('honours a pre-computed age over the injected clock', () => {
    const policy = createFreshnessPolicy(
      { defaultThresholdMinutes: 60 },
      undefined,
      () => FIXED_NOW,
    );
    // Even though the timestamp would be stale by the clock, the explicit age
    // (fresh) wins — mirroring dashboard-v2 behaviour.
    expect(policy.classifyMarkStatus(minutesAgo(90), 10)).toBe('fresh');
  });

  it('resolves per-scope overrides at construction time', () => {
    const policy = createFreshnessPolicy(
      {
        defaultThresholdMinutes: 1440,
        overrides: [{ scope: { provider: 'user' }, thresholdMinutes: 30 }],
      },
      { provider: 'user' },
    );
    expect(policy.thresholdMinutes).toBe(30);
    expect(policy.resolvedFrom).toContain('provider=user');
    // A mark 45 minutes old is stale under the 30-minute override.
    expect(policy.classifyMarkStatus(minutesAgo(45), 45)).toBe('stale');
  });

  it('defaults to the canonical config when no arguments are given', () => {
    const policy = createFreshnessPolicy();
    expect(policy.thresholdMinutes).toBe(DEFAULT_FRESHNESS_THRESHOLD_MINUTES);
    expect(policy.resolvedFrom).toBe('default:1440');
  });

  it('binds completeness and coverage helpers to the policy', () => {
    const policy = createFreshnessPolicy();
    expect(policy.classifyCompleteness(2, 1, 0, 1)).toBe('partial');
    expect(policy.classifyCompleteness(0, 0, 0, 0)).toBe('complete');
    expect(policy.computeCoveragePct(4, 2)).toBe('50.00');
    expect(policy.computeCoveragePct(0, 0)).toBeNull();
  });
});
