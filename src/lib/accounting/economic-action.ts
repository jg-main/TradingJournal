/**
 * economic-action.ts
 *
 * M002-A5 — canonical economic action resolver.
 *
 * ONE shared resolver that maps a journal workflow action + position direction
 * to the concrete financial economic side BEFORE canonical accounting. The
 * accounting cash boundary NEVER infers direction from the raw generic
 * management aliases `add` / `reduce` — those are workflow intent (management
 * phase, timeline, UX), while canonical accounting (accounting_executions,
 * financial-event cash effects, FIFO economic replay) operates on the
 * unambiguous economic action.
 *
 *   journal action     long          short
 *   ──────────────────────────────────────────
 *   buy               buy           (rejected)
 *   sell              sell          (rejected)
 *   sell_short        (rejected)    sell_short
 *   buy_to_cover      (rejected)    buy_to_cover
 *   add               buy           sell_short
 *   reduce            sell          buy_to_cover
 *
 * Cash direction derives from the economic side only:
 *   sell / sell_short        → increase
 *   buy / buy_to_cover       → decrease
 *
 * Pure domain helper: no database or Next.js imports.
 */

/** Concrete financial economic actions understood by canonical accounting. */
export const ECONOMIC_ACTIONS = [
  'buy',
  'sell',
  'sell_short',
  'buy_to_cover',
] as const;

export type EconomicAction = (typeof ECONOMIC_ACTIONS)[number];

export type PositionDirection = 'long' | 'short';

/** Raised when a workflow action cannot map to an economic side (wrong side
 *  for the position direction, or a generic alias with no resolvable
 *  direction). Callers must resolve direction BEFORE accounting mutation. */
export class AmbiguousEconomicActionError extends Error {
  readonly action: string;
  readonly direction: PositionDirection | 'unknown';

  constructor(action: string, direction: PositionDirection | 'unknown') {
    super(
      `Action "${action}" cannot be resolved to an economic side for ${direction} — ` +
        'resolve trade/position direction before canonical accounting.',
    );
    this.name = 'AmbiguousEconomicActionError';
    this.action = action;
    this.direction = direction;
  }
}

const LONG_ECONOMIC_MAP: Record<string, EconomicAction> = {
  buy: 'buy',
  add: 'buy',
  sell: 'sell',
  reduce: 'sell',
};

const SHORT_ECONOMIC_MAP: Record<string, EconomicAction> = {
  sell_short: 'sell_short',
  add: 'sell_short',
  buy_to_cover: 'buy_to_cover',
  reduce: 'buy_to_cover',
};

/**
 * Resolve a journal workflow action to its concrete economic side for a known
 * position direction. Invalid combinations (wrong side for the direction)
 * are rejected — mirroring the journal action-direction guard.
 */
export function resolveEconomicExecutionAction(
  action: string,
  direction: PositionDirection,
): EconomicAction {
  const map = direction === 'long' ? LONG_ECONOMIC_MAP : SHORT_ECONOMIC_MAP;
  const resolved = map[action];
  if (!resolved) {
    throw new AmbiguousEconomicActionError(action, direction);
  }
  return resolved;
}

/**
 * Cash direction for a concrete economic action. Generic aliases (`add`,
 * `reduce`) are NOT accepted — resolveEconomicExecutionAction first.
 */
export function cashDirectionForEconomicAction(action: EconomicAction): 'increase' | 'decrease' {
  return action === 'sell' || action === 'sell_short' ? 'increase' : 'decrease';
}

/** True when the action is a generic workflow alias that must be resolved. */
export function isGenericManagementAction(action: string): boolean {
  return action === 'add' || action === 'reduce';
}
