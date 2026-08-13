/**
 * Presentation contract for the Performance panel's P&L scope selector.
 *
 * Realized P&L is sourced from the account-performance projection, which
 * records every closed quantity (including partial exits). Open P&L is
 * sourced from the current risk snapshot and is only shown when all open
 * positions have a mark. Total is deliberately rebuilt from those two
 * declared sources so it stays live with mark polling rather than using the
 * persisted period projection's unrealized value.
 */

import { addDecimal, validateDecimal } from './accounting/decimal';
import type { SnapshotCompletenessState } from './accounting/dashboard-v2';

export const PERFORMANCE_PNL_SCOPES = ['realized', 'open', 'total'] as const;

export type PerformancePnlScope = (typeof PERFORMANCE_PNL_SCOPES)[number];

export const DEFAULT_PERFORMANCE_PNL_SCOPE: PerformancePnlScope = 'total';

export interface PerformancePnlScopeInput {
  scope: PerformancePnlScope;
  /** All realized P&L, including partial exits. */
  realizedPnl: string | null;
  /** Current MTM P&L for the remaining open quantity. */
  openPnl: string | null;
  /** Completeness of the current open-position valuation. */
  valuationState: SnapshotCompletenessState;
}

export interface PerformancePnlScopeResult {
  label: string;
  /** Canonical money amount, or null when the selected value cannot be trusted. */
  value: string | null;
  /** Short statement rendered beside the selected P&L scope. */
  description: string;
}

function isCanonicalMoney(value: string | null): value is string {
  return value !== null && validateDecimal(value).valid;
}

function valuationDescription(state: SnapshotCompletenessState): string {
  switch (state) {
    case 'partial':
      return 'Partial valuation';
    case 'unavailable':
      return 'Valuation unavailable';
    case 'stale':
      return 'Stale marks';
    case 'complete':
      return 'Current marks';
  }
}

/**
 * Select the one P&L total to make prominent in the Performance panel.
 *
 * A partial or unavailable valuation never produces an Open or Total P&L
 * number. Realized P&L remains valid because it comes from closed quantity,
 * not a live mark.
 */
export function computePerformancePnlScope(
  input: PerformancePnlScopeInput,
): PerformancePnlScopeResult {
  const hasRealized = isCanonicalMoney(input.realizedPnl);
  const hasOpen = isCanonicalMoney(input.openPnl);

  if (input.scope === 'realized') {
    return {
      label: 'Realized P&L',
      value: hasRealized ? input.realizedPnl : null,
      description: 'All exits, including partials',
    };
  }

  if (input.scope === 'open') {
    return {
      label: input.valuationState === 'stale' ? 'Stale Open P&L' : 'Open P&L',
      value: hasOpen ? input.openPnl : null,
      description: valuationDescription(input.valuationState),
    };
  }

  return {
    label: input.valuationState === 'stale' ? 'Stale Total P&L' : 'Total P&L',
    value: hasRealized && hasOpen ? addDecimal(input.realizedPnl!, input.openPnl!) : null,
    description:
      hasOpen
        ? input.valuationState === 'stale'
          ? 'Realized + stale marks'
          : 'Realized + current marks'
        : valuationDescription(input.valuationState),
  };
}
