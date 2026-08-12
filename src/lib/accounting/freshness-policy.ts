/**
 * Central freshness policy for valuation marks.
 *
 * Single source of truth for what counts as fresh / stale / missing and for
 * how price-derived aggregate completeness is derived from coverage counts.
 * No dashboard surface may silently apply its own hard-coded threshold —
 * the policy is resolved here, from one centrally configured config, and the
 * resolved threshold carries provenance (which config rule produced it).
 *
 * The policy is injectable in two independent dimensions:
 *   - policy config: default threshold plus per-scope overrides that may vary
 *     by provider, asset class, market session, or account;
 *   - clock: tests can pin the reference time without touching wall-clock.
 *
 * Pure module — no database or Next.js imports. Depends only on ./decimal.
 *
 * @module accounting/freshness-policy
 */

import { normalizeDecimal } from './decimal';

// ═══════════════════════════════════════════════════════════════════════════
// Public Types
// ═══════════════════════════════════════════════════════════════════════════

/** Freshness classification of a single valuation mark. */
export type MarkStatus = 'fresh' | 'stale' | 'missing';

/**
 * Completeness of a price-derived aggregate:
 * - 'complete': every open position has a fresh mark (or there are no positions)
 * - 'partial': one or more positions have no usable mark
 * - 'stale': every position has a mark and one or more marks are outdated
 * - 'unavailable': no mark exists for any open position
 */
export type SnapshotCompletenessState =
  | 'complete'
  | 'partial'
  | 'stale'
  | 'unavailable';

/** A clock function returning the current time. Injectable for tests. */
export type FreshnessClock = () => Date;

/** Default clock — real wall clock. */
export const realClock: FreshnessClock = () => new Date();

/**
 * Scope selector identifying the market-data dimension a threshold applies
 * to. Thresholds may vary by provider, asset class, market session, or
 * account. A scope dimension absent from an override is a wildcard; the
 * override with the most specified dimensions wins.
 */
export interface FreshnessScope {
  /** Data provider (e.g. 'user', 'market_data'). */
  provider?: string;
  /** Asset class (e.g. 'stock', 'option', 'future'). */
  assetClass?: string;
  /** Market session (e.g. 'regular', 'extended', 'pre', 'post'). */
  marketSession?: string;
  /** Account id. */
  account?: string;
}

/** One per-scope threshold override. */
export interface FreshnessPolicyOverride {
  /** Scope this override applies to. */
  scope: FreshnessScope;
  /** Max age in minutes for a mark to be considered fresh. */
  thresholdMinutes: number;
}

/**
 * Centrally configured freshness policy: one default threshold plus optional
 * per-scope overrides.
 */
export interface FreshnessPolicyConfig {
  /** Default max age in minutes for a fresh mark. */
  defaultThresholdMinutes?: number;
  /** Per-scope overrides; the most specific matching scope wins. */
  overrides?: FreshnessPolicyOverride[];
}

/** Default freshness threshold in minutes (24 hours). */
export const DEFAULT_FRESHNESS_THRESHOLD_MINUTES = 1440;

/** The canonical default config — every caller resolves from this. */
export const DEFAULT_FRESHNESS_POLICY_CONFIG: FreshnessPolicyConfig = {
  defaultThresholdMinutes: DEFAULT_FRESHNESS_THRESHOLD_MINUTES,
  overrides: [],
};

/**
 * Resolved effective policy: the threshold that applies plus provenance
 * describing which config rule produced it.
 */
export interface ResolvedFreshnessPolicy {
  /** Max age in minutes for a mark to be considered fresh. */
  thresholdMinutes: number;
  /**
   * Provenance of the threshold: 'default:...' when the default rule applied,
   * or 'override:dimension=value,...' when a per-scope override matched.
   */
  resolvedFrom: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Policy Resolution
// ═══════════════════════════════════════════════════════════════════════════

/** Stable key fragment for one scope dimension, or null when absent. */
function scopeDimensionKey(dimension: keyof FreshnessScope, value: string): string {
  return `${dimension}=${value}`;
}

/** Human-readable provenance for a matched override scope. */
function formatOverrideScope(scope: FreshnessScope): string {
  // Preserve the authoring order of the override's scope object so the
  // provenance string reads exactly as the rule was written.
  const parts: string[] = [];
  for (const dimension of Object.keys(scope) as Array<keyof FreshnessScope>) {
    const value = scope[dimension];
    if (value !== undefined) {
      parts.push(scopeDimensionKey(dimension, value));
    }
  }
  return parts.join(',');
}

/**
 * Resolve the effective freshness policy for a scope.
 *
 * Matching rules:
 * - An override matches when every dimension it specifies equals the query
 *   scope's corresponding dimension. Dimensions absent from the override are
 *   wildcards.
 * - Among matching overrides, the one with the most specified dimensions
 *   wins (most specific). Ties resolve to the last override in the array.
 * - No match → the default threshold applies.
 */
export function resolveFreshnessPolicy(
  config: FreshnessPolicyConfig,
  scope?: FreshnessScope,
): ResolvedFreshnessPolicy {
  const defaultThresholdMinutes =
    config.defaultThresholdMinutes ?? DEFAULT_FRESHNESS_THRESHOLD_MINUTES;

  const overrides = config.overrides ?? [];
  if (overrides.length === 0 || scope === undefined) {
    return {
      thresholdMinutes: defaultThresholdMinutes,
      resolvedFrom: `default:${defaultThresholdMinutes}`,
    };
  }

  let bestMatch: FreshnessPolicyOverride | undefined;
  let bestSpecificity = -1;

  for (const override of overrides) {
    let specified = 0;
    let matches = true;
    const o = override.scope;

    if (o.provider !== undefined) {
      specified++;
      if (o.provider !== scope.provider) matches = false;
    }
    if (o.assetClass !== undefined) {
      specified++;
      if (o.assetClass !== scope.assetClass) matches = false;
    }
    if (o.marketSession !== undefined) {
      specified++;
      if (o.marketSession !== scope.marketSession) matches = false;
    }
    if (o.account !== undefined) {
      specified++;
      if (o.account !== scope.account) matches = false;
    }

    if (matches && specified >= bestSpecificity) {
      // `>=` so later, equally-specific overrides win (documented tie rule).
      bestSpecificity = specified;
      bestMatch = override;
    }
  }

  if (bestMatch) {
    return {
      thresholdMinutes: bestMatch.thresholdMinutes,
      resolvedFrom: `override:${formatOverrideScope(bestMatch.scope)} (${bestMatch.thresholdMinutes} minutes)`,
    };
  }

  return {
    thresholdMinutes: defaultThresholdMinutes,
    resolvedFrom: `default:${defaultThresholdMinutes}`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Classification Primitives
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compute a mark's age in minutes from its timestamp, rounded to the nearest
 * minute. Returns null when the timestamp cannot be parsed into a valid age.
 */
export function computeMarkAgeMinutes(
  markTimestamp: string,
  now: Date,
): number | null {
  try {
    const markTime = new Date(markTimestamp).getTime();
    const ageMs = now.getTime() - markTime;
    const ageMinutes = Math.round(ageMs / 60_000);
    // Invalid Date parses to NaN without throwing — treat it as undateable.
    return Number.isFinite(ageMinutes) ? ageMinutes : null;
  } catch {
    return null;
  }
}

/**
 * Classify the freshness of a single valuation mark.
 *
 * - 'missing': no mark timestamp exists
 * - 'fresh': mark exists and its age is <= thresholdMinutes
 * - 'stale': mark exists but its age exceeds thresholdMinutes, or its
 *   timestamp cannot be dated (an undateable mark is never fresh)
 *
 * When markAgeMinutes is provided it is used directly; otherwise the age is
 * derived from markTimestamp against computedAt. Future timestamps are
 * treated as fresh.
 */
export function classifyMarkStatus(
  markTimestamp: string | null,
  markAgeMinutes: number | null,
  computedAt: Date,
  thresholdMinutes: number,
): MarkStatus {
  if (!markTimestamp) return 'missing';

  // If markAgeMinutes was pre-computed, use it
  if (markAgeMinutes !== null) {
    return markAgeMinutes <= thresholdMinutes ? 'fresh' : 'stale';
  }

  // Fall back to computing age from timestamps
  try {
    const markTime = new Date(markTimestamp).getTime();
    const now = computedAt.getTime();
    const ageMs = now - markTime;
    if (ageMs < 0) return 'fresh'; // Future timestamps are treated as fresh
    const ageMinutes = ageMs / 60_000;
    return ageMinutes <= thresholdMinutes ? 'fresh' : 'stale';
  } catch {
    return 'missing';
  }
}

/**
 * Classify the completeness of a price-derived aggregate from coverage counts.
 *
 * - total === 0            → 'complete' (nothing to mark; zero values are exact)
 * - missing === total      → 'unavailable' (no mark exists for any position)
 * - fresh === total        → 'complete'
 * - missing === 0 && stale > 0 → 'stale' (all positions are priced, but one
 *                                  or more marks are outdated)
 * - otherwise              → 'partial' (some positions are unpriced)
 */
export function classifyCompleteness(
  total: number,
  fresh: number,
  stale: number,
  missing: number,
): SnapshotCompletenessState {
  if (total === 0) return 'complete';
  if (missing === total) return 'unavailable';
  if (fresh === total) return 'complete';
  if (missing === 0 && stale > 0) return 'stale';
  return 'partial';
}

/** Freshness coverage as a percentage (canonical decimal), or null when no positions. */
export function computeCoveragePct(total: number, fresh: number): string | null {
  if (total === 0) return null;
  return normalizeDecimal((fresh / total) * 100);
}

// ═══════════════════════════════════════════════════════════════════════════
// Injectable Policy Object
// ═══════════════════════════════════════════════════════════════════════════

/**
 * An injectable freshness policy: resolved threshold + provenance + clock,
 * with the classification operations bound to them. Construct with
 * createFreshnessPolicy(config, scope?, clock?).
 */
export interface FreshnessPolicy {
  /** Max age in minutes for a mark to be considered fresh. */
  readonly thresholdMinutes: number;
  /** Provenance of the threshold: which config rule produced it. */
  readonly resolvedFrom: string;
  /** The injected clock used for age derivation when no age is supplied. */
  readonly clock: FreshnessClock;
  /** Classify one mark's freshness using the resolved threshold + clock. */
  classifyMarkStatus(
    markTimestamp: string | null,
    markAgeMinutes?: number | null,
  ): MarkStatus;
  /** Classify aggregate completeness from coverage counts. */
  classifyCompleteness(
    total: number,
    fresh: number,
    stale: number,
    missing: number,
  ): SnapshotCompletenessState;
  /** Coverage percentage (canonical decimal), or null when no positions. */
  computeCoveragePct(total: number, fresh: number): string | null;
  /** Derive a mark's age in minutes using the injected clock. */
  computeMarkAgeMinutes(markTimestamp: string): number | null;
}

/**
 * Create an injectable freshness policy.
 *
 * @param config - Centrally configured policy (defaults + per-scope overrides).
 * @param scope  - Optional scope (provider / asset class / market session /
 *                 account) used to resolve per-scope threshold overrides.
 * @param clock  - Optional clock; tests inject a fixed date. Defaults to the
 *                 real wall clock.
 */
export function createFreshnessPolicy(
  config: FreshnessPolicyConfig = DEFAULT_FRESHNESS_POLICY_CONFIG,
  scope?: FreshnessScope,
  clock: FreshnessClock = realClock,
): FreshnessPolicy {
  const resolved = resolveFreshnessPolicy(config, scope);

  return {
    thresholdMinutes: resolved.thresholdMinutes,
    resolvedFrom: resolved.resolvedFrom,
    clock,
    classifyMarkStatus(markTimestamp, markAgeMinutes = null) {
      return classifyMarkStatus(
        markTimestamp,
        markAgeMinutes,
        clock(),
        resolved.thresholdMinutes,
      );
    },
    classifyCompleteness(total, fresh, stale, missing) {
      return classifyCompleteness(total, fresh, stale, missing);
    },
    computeCoveragePct(total, fresh) {
      return computeCoveragePct(total, fresh);
    },
    computeMarkAgeMinutes(markTimestamp) {
      return computeMarkAgeMinutes(markTimestamp, clock());
    },
  };
}
