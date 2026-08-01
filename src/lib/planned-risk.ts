/**
 * planned-risk.ts
 *
 * Shared, direction-aware planned risk computation (R021).
 *
 * Planned risk is the absolute dollar amount at risk for a planned trade:
 *   long:  (entry - stop) * quantity   (valid only when entry > stop)
 *   short: (stop - entry) * quantity   (valid only when stop > entry)
 *
 * Returns null whenever the inputs are null/zero or the stop sits on the
 * wrong side of the entry (riskPerUnit <= 0), so invalid stop directions
 * never surface as misleading positive risk values.
 *
 * This is the single source of truth for planned-risk consumers:
 * the Planned Risk column, Planned Risk to Account, planned totals,
 * and trade planning validation.
 */

/** Canonical trade directions accepted by the helper. */
export type PlannedDirection = 'long' | 'short';

/**
 * Compute the planned trade risk amount (absolute dollar risk) with
 * direction awareness.
 *
 * Long  entry 100 stop 95  → (100 - 95) * quantity  (valid)
 * Long  entry 100 stop 105 → null                  (invalid direction)
 * Short entry 100 stop 105 → (105 - 100) * quantity (valid)
 * Short entry 100 stop 95  → null                  (invalid direction)
 *
 * Returns null when any input is null/zero, when quantity <= 0, when
 * direction is missing or not 'long'/'short', or when the per-unit
 * risk (entry - stop for long, stop - entry for short) is <= 0.
 */
export function computePlannedRiskAmount(
  direction: string | null | undefined,
  entry: number | null | undefined,
  stop: number | null | undefined,
  quantity: number | null | undefined,
): number | null {
  if (!entry || !stop || !quantity || quantity <= 0) return null;
  if (direction !== 'long' && direction !== 'short') return null;
  const diff = direction === 'long' ? entry - stop : stop - entry;
  if (diff <= 0) return null;
  return diff * quantity;
}
