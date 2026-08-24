/**
 * execution-readiness.ts
 *
 * Unified execution-readiness gate (T04 / S02, audit-matrix D2; M002-A1
 * effective-defaults correction).
 *
 * Planning eligibility (active + USD account, enforced at trade creation) is
 * deliberately distinct from execution readiness. Before the first fill both
 * execution paths (P1 execute, P2 executions) call `checkExecutionReadiness`
 * to enforce, in order:
 *
 *   a. the account is active                       → 'Account not active'
 *   b. the account is trading-ready (EFFECTIVE risk params + commission +
 *      opening cash)                               → 'Account setup incomplete for trading'
 *   c. the trade is still 'planned' (first fill)   → 'Trade not in planned status'
 *   d. all required checklist items passed         → 'Required checklist items not passed'
 *   e. proposed initial risk within max-risk limit → 'Max risk exceeded'
 *      (effective maxRiskPerTradePct — account override ?? global default;
 *      the failure is marked overrideable so the caller may lift the block with an
 *      explicit `riskOverrideReason`, stored on the trade for the audit trail)
 *
 * A1 contract: risk and commission configuration resolve through the shared
 * resolveEffectiveExecutionConfig (account override → global default →
 * unavailable). An account-level null is NOT by itself not-trading-ready when
 * a valid global default exists; explicit zero is a valid configured value.
 * Readiness and the max-risk threshold use the SAME resolved value.
 *
 * Pure function library: NO database access, NO NextResponse. The caller
 * supplies the account/settings rows, the caller-computed initial risk amount,
 * equity-at-open and the hasOpeningCash flag, and decides how to surface each
 * failure (block, override, or bubble).
 */

import { isAccountTradingReady } from '@/lib/accounting/default-account-guard';
import { resolveEffectiveExecutionConfig } from '@/lib/execution-config';

/**
 * Stable failure codes surfaced to clients and used by callers to decide
 * whether a failure is overrideable.
 */
export type ReadinessFailureCode =
  | 'account-not-active'
  | 'account-not-trading-ready'
  | 'trade-not-planned'
  | 'checklist-not-passed'
  | 'max-risk-exceeded';

export interface ReadinessFailure {
  /** Stable machine-readable code. */
  code: ReadinessFailureCode;
  /** Stable human-readable message (surfaced verbatim to clients). */
  message: string;
  /** max-risk-exceeded only: the allowed dollar limit (maxRiskPct/100 * equityAtOpen). */
  limit?: number | null;
  /** max-risk-exceeded only: the proposed initial risk in dollars. */
  computed?: number | null;
  /** max-risk-exceeded only: true when a riskOverrideReason may lift the block. */
  overrideable?: boolean;
}

/** Account fields relevant to the readiness gate. */
export interface ExecutionReadinessAccount {
  isActive: boolean;
  currency: string | null;
  maxRiskPerTradePct: number | null;
  defaultCommission: number | null;
}

/** Global settings fields relevant to the readiness gate. */
export interface ExecutionReadinessSettings {
  maxRiskPerTradePct: number | null;
  /** Global default commission fallback (A1). */
  defaultCommission: number | null;
  startingAccountValue: number | null;
}

export interface ExecutionReadinessInput {
  account: ExecutionReadinessAccount;
  settings: ExecutionReadinessSettings;
  /** Current trade status ('planned' | 'open' | 'closed' | 'deleted'). */
  tradeStatus: string;
  /**
   * Proposed initial risk in dollars, computed by the caller.
   * null when there is no valid stop (D1: null-not-zero — a missing stop
   * never triggers the max-risk block).
   */
  initialRiskAmount: number | null;
  /** Account equity at open (canonical computeEquityAtOpen); null when unavailable. */
  equityAtOpen: number | null;
  /** Whether the account has posted opening cash (positive equity). */
  hasOpeningCash: boolean;
  /** Whether every required checklist item is recorded as passed. */
  requiredChecklistPassed: boolean;
}

export interface ExecutionReadinessResult {
  ready: boolean;
  failures: ReadinessFailure[];
}

/**
 * Run the full execution-readiness gate.
 *
 * Never throws and never reads/writes storage. Every violation is collected
 * (not short-circuited) so the caller can decide how to respond. The max-risk
 * failure carries { limit, computed, overrideable: true } so the caller can
 * either block with a 422 or allow the override when a reason is supplied.
 */
export function checkExecutionReadiness(
  input: ExecutionReadinessInput,
): ExecutionReadinessResult {
  const failures: ReadinessFailure[] = [];

  // a. Account must be active.
  if (!input.account.isActive) {
    failures.push({ code: 'account-not-active', message: 'Account not active' });
  }

  // b. Account must be fully configured for trading: EFFECTIVE risk
  //    parameters, EFFECTIVE default commission (each account override →
  //    global default → unavailable) and posted opening cash. A1: account
  //    nulls fall back to global defaults; explicit zero is configured.
  const effective = resolveEffectiveExecutionConfig({
    account: {
      maxRiskPerTradePct: input.account.maxRiskPerTradePct,
      defaultCommission: input.account.defaultCommission,
    },
    settings: {
      maxRiskPerTradePct: input.settings.maxRiskPerTradePct,
      defaultCommission: input.settings.defaultCommission,
    },
  });
  const tradingReady = isAccountTradingReady({
    isActive: input.account.isActive,
    currency: input.account.currency,
    effectiveMaxRiskPerTradePct: effective.maxRiskPerTradePct,
    effectiveDefaultCommission: effective.defaultCommission,
    hasOpeningCash: input.hasOpeningCash,
  });
  if (!tradingReady) {
    failures.push({
      code: 'account-not-trading-ready',
      message: 'Account setup incomplete for trading',
    });
  }

  // c. The gate applies only to the first fill (trade still 'planned').
  if (input.tradeStatus !== 'planned') {
    failures.push({
      code: 'trade-not-planned',
      message: 'Trade not in planned status',
    });
  }

  // d. Required checklist items must all be passed.
  if (!input.requiredChecklistPassed) {
    failures.push({
      code: 'checklist-not-passed',
      message: 'Required checklist items not passed',
    });
  }

  // e. Max-risk hard block (D2, A1): effective max risk = account override →
  //    global default, resolved ONCE above and used both for readiness and the
  //    threshold. Skipped when initialRiskAmount is null (no valid stop — D1
  //    null-not-zero) or when no threshold is configured or equity is
  //    unavailable.
  if (
    input.initialRiskAmount !== null &&
    effective.maxRiskPerTradePct != null &&
    input.equityAtOpen != null &&
    input.equityAtOpen > 0
  ) {
    const limit = (effective.maxRiskPerTradePct / 100) * input.equityAtOpen;
    if (input.initialRiskAmount > limit) {
      failures.push({
        code: 'max-risk-exceeded',
        message: 'Max risk exceeded',
        limit,
        computed: input.initialRiskAmount,
        overrideable: true,
      });
    }
  }

  return { ready: failures.length === 0, failures };
}
