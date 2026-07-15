/**
 * alert-polling.ts
 *
 * Client-side alert polling engine. Evaluates alert conditions against
 * current price data on each poll cycle, detects condition transitions
 * (unmet→met), and returns actionable alert events.
 *
 * Pure computation — no side effects, no DOM, no network. State is
 * maintained externally and passed in.
 *
 * Pattern: M026 — no DB imports, self-contained types, vitest-tested.
 */

import {
  evaluateAlertConditions,
  type AlertConfig,
  type PriceSnapshot,
} from './alert-engine';

// ── Types ─────────────────────────────────────────────────────────────────

/**
 * Previously evaluated conditions for a single symbol.
 * Used by evaluateAlertPoll to detect unmet→met transitions.
 */
export interface AlertStateEntry {
  /** Map of condition name → whether it was active last poll */
  conditions: Record<string, boolean>;
}

/**
 * Mapping of symbol → AlertStateEntry, persisting across poll cycles.
 */
export type AlertState = Record<string, AlertStateEntry>;

/**
 * A single alert event produced when a condition transitions from
 * unmet to met during a poll cycle.
 */
export interface AlertEvent {
  /** Ticker symbol */
  symbol: string;
  /** Condition identifier (e.g. 'price_above_keyLevel') */
  condition: string;
  /** Human-readable message for display/notification */
  message: string;
  /** Watchlist item ID for API logging */
  watchlistItemId?: string;
  /** Actual price/value that triggered the condition */
  actualValue?: number | null;
  /** Threshold that was crossed */
  threshold?: number | null;
}

/**
 * Parameters for evaluating a single watchlist item's alerts during a
 * poll cycle. Mirrors the fields consumed by evaluateAlertConditions.
 */
export interface AlertItemInput {
  /** Watchlist item ID */
  id: string;
  /** Ticker symbol */
  symbol: string;
  /** Alert configuration (null if no alerts configured) */
  alertConfig: AlertConfig | null;
  /** Current market price (null if quote unavailable) */
  currentPrice: number | null;
  /** Computed RSI value (null if not yet computed or insufficient data) */
  rsi: number | null;
  /** Key price levels from the watchlist item */
  keyLevel?: number | null;
  triggerPrice?: number | null;
  plannedStop?: number | null;
  targetPrice?: number | null;
}

// ── State Management ─────────────────────────────────────────────────────

/**
 * Create a fresh, empty alert state.
 * Call this in useRef on component mount.
 */
export function createAlertState(): AlertState {
  return {};
}

// ── Core Evaluation ──────────────────────────────────────────────────────

/**
 * Evaluate alert conditions for all items in a single poll cycle.
 *
 * Pure function:
 * - Takes previous state + current item data
 * - Returns new events (unmet→met transitions) + updated state
 * - Items without alertConfig or price are skipped (prior state preserved)
 *
 * @param prevState - Alert state from the previous poll cycle
 * @param items - Watchlist items with current prices and alert configs
 * @returns New alert events and updated state for the next cycle
 */
export function evaluateAlertPoll(
  prevState: AlertState,
  items: AlertItemInput[],
): { events: AlertEvent[]; nextState: AlertState } {
  const nextState: AlertState = {};
  const events: AlertEvent[] = [];

  for (const item of items) {
    if (item.currentPrice == null) {
      // No price data — preserve prior state if it exists
      if (prevState[item.symbol]) {
        nextState[item.symbol] = prevState[item.symbol];
      }
      continue;
    }

    const config = item.alertConfig;
    if (!config || !hasEnabledAlert(config)) {
      // No alert config — preserve prior state if it exists
      if (prevState[item.symbol]) {
        nextState[item.symbol] = prevState[item.symbol];
      }
      continue;
    }

    // Build PriceSnapshot for the alert engine
    const snapshot: PriceSnapshot = {
      currentPrice: item.currentPrice,
      rsi: item.rsi,
      keyLevel: item.keyLevel ?? null,
      triggerPrice: item.triggerPrice ?? null,
      stopPrice: item.plannedStop ?? null,
      targetPrice: item.targetPrice ?? null,
    };

    // Evaluate current conditions
    const triggered = evaluateAlertConditions(config, snapshot);

    // Build current conditions map
    const currentConditions: Record<string, boolean> = {};
    for (const t of triggered) {
      currentConditions[t.condition] = true;
    }

    // Detect transitions: condition was NOT active before, but IS now
    const prev = prevState[item.symbol]?.conditions ?? {};
    for (const t of triggered) {
      if (!prev[t.condition]) {
        events.push({
          symbol: item.symbol,
          condition: t.condition,
          message: t.message,
          watchlistItemId: item.id,
          actualValue: item.currentPrice,
          threshold: getThresholdForCondition(config, t.condition, item),
        });
      }
    }

    nextState[item.symbol] = { conditions: currentConditions };
  }

  return { events, nextState };
}

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Check whether an AlertConfig has any enabled conditions.
 */
export function hasEnabledAlert(config: AlertConfig): boolean {
  const keys = Object.keys(config) as (keyof AlertConfig)[];
  for (const key of keys) {
    const val = config[key];
    if (val && typeof val === 'object' && 'enabled' in val && val.enabled) {
      return true;
    }
  }
  return false;
}

/**
 * Check whether an AlertConfig has any RSI-based conditions enabled.
 */
export function hasRsiAlert(config: AlertConfig): boolean {
  return (
    (config.rsiAbove?.enabled === true) ||
    (config.rsiBelow?.enabled === true)
  );
}

/**
 * Build a PriceSnapshot from a watchlist item's stored price levels
 * and current price data.
 */
export function buildPriceSnapshot(
  currentPrice: number,
  levels: {
    keyLevel?: number | null;
    triggerPrice?: number | null;
    plannedStop?: number | null;
    targetPrice?: number | null;
  },
  rsi: number | null,
): PriceSnapshot {
  return {
    currentPrice,
    rsi,
    keyLevel: levels.keyLevel ?? null,
    triggerPrice: levels.triggerPrice ?? null,
    stopPrice: levels.plannedStop ?? null,
    targetPrice: levels.targetPrice ?? null,
  };
}

/**
 * Extract the numeric threshold for a given condition from the alert config
 * or the item's price levels.
 */
function getThresholdForCondition(
  config: AlertConfig,
  condition: string,
  item: AlertItemInput,
): number | null | undefined {
  switch (condition) {
    case 'price_above_keyLevel':
    case 'price_below_keyLevel':
      return item.keyLevel ?? null;
    case 'price_above_trigger':
    case 'price_below_trigger':
      return item.triggerPrice ?? null;
    case 'price_above_stop':
    case 'price_below_stop':
      return item.plannedStop ?? null;
    case 'price_above_target':
    case 'price_below_target':
      return item.targetPrice ?? null;
    case 'rsi_above':
      return config.rsiAbove?.threshold ?? null;
    case 'rsi_below':
      return config.rsiBelow?.threshold ?? null;
    default:
      return null;
  }
}

/**
 * Map an alert engine condition identifier to the alert-log API's
 * condition enum value ('above', 'below', 'rsiAbove', 'rsiBelow').
 */
export function mapConditionToApi(condition: string): string {
  if (condition.startsWith('price_above')) return 'above';
  if (condition.startsWith('price_below')) return 'below';
  if (condition === 'rsi_above') return 'rsiAbove';
  if (condition === 'rsi_below') return 'rsiBelow';
  return 'above';
}

/**
 * Parse the alertConfig JSON from a watchlist item's API response into
 * an AlertConfig object. Handles null, string-JSON, and already-parsed
 * object forms.
 */
export function parseAlertConfig(raw: unknown): AlertConfig | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as AlertConfig;
    } catch {
      return null;
    }
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as AlertConfig;
  }
  return null;
}
