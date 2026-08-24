/**
 * execution-config.ts
 *
 * M002-A1 — canonical effective execution-configuration resolver.
 *
 * Execution readiness requires effective risk and commission configuration,
 * where each resolves as:
 *
 *     account override
 *         ↓ when null
 *     global default (settings)
 *         ↓ when null
 *     unavailable
 *
 * An account-level null does NOT by itself mean "not trading-ready" — a valid
 * global default makes the parameter configured. Conversely, explicit zero is
 * a valid configured value (0 ?? fallback === 0 — never truthiness).
 *
 * This is the ONE canonical fallback implementation. Execution readiness
 * (execution-readiness.ts), the canonical engine (trade-execution-engine.ts)
 * and planned-risk preview (planned-risk-preview/route.ts) all consume it so
 * the same account/settings state yields identical effective values on every
 * surface (preview effective max risk === execution effective max risk).
 *
 * Pure function library: NO database access, NO NextResponse. The caller
 * supplies the account/settings values; this module only resolves them.
 */

/** Where an effective configuration value came from. */
export type ExecutionConfigSource = 'account' | 'global' | 'unavailable';

/** Account-side configuration fields relevant to execution readiness. */
export interface ExecutionConfigAccount {
  maxRiskPerTradePct: number | null;
  defaultCommission: number | null;
}

/** Global-settings-side configuration fields relevant to execution readiness. */
export interface ExecutionConfigSettings {
  maxRiskPerTradePct: number | null;
  defaultCommission: number | null;
}

/** Inputs to the effective-configuration resolver. */
export interface ExecutionConfigInput {
  account: ExecutionConfigAccount;
  settings: ExecutionConfigSettings;
}

/** Resolved effective execution configuration. */
export interface EffectiveExecutionConfig {
  /** Effective max risk per trade (account ?? global); null when neither. */
  maxRiskPerTradePct: number | null;
  /** Source of the effective max-risk value. */
  maxRiskSource: ExecutionConfigSource;
  /** Effective default commission (account ?? global); null when neither. */
  defaultCommission: number | null;
  /** Source of the effective default-commission value. */
  commissionSource: ExecutionConfigSource;
}

/**
 * Resolve the effective execution configuration for an account.
 *
 * Precedence for BOTH max risk and commission:
 *
 *     account override
 *         ↓ when null
 *     global default
 *         ↓ when null
 *     unavailable
 *
 * Uses `??` (nullish coalescing), never truthiness: an explicit zero is a
 * valid configured value and must not be treated as missing.
 *
 * @param input - The account and global-settings configuration values.
 * @returns The effective values plus their provenance.
 */
export function resolveEffectiveExecutionConfig(
  input: ExecutionConfigInput,
): EffectiveExecutionConfig {
  const maxRiskPerTradePct =
    input.account.maxRiskPerTradePct ?? input.settings.maxRiskPerTradePct;
  const defaultCommission =
    input.account.defaultCommission ?? input.settings.defaultCommission;

  return {
    maxRiskPerTradePct,
    maxRiskSource:
      input.account.maxRiskPerTradePct != null
        ? 'account'
        : input.settings.maxRiskPerTradePct != null
          ? 'global'
          : 'unavailable',
    defaultCommission,
    commissionSource:
      input.account.defaultCommission != null
        ? 'account'
        : input.settings.defaultCommission != null
          ? 'global'
          : 'unavailable',
  };
}
