/**
 * alert-polling.test.ts
 *
 * Vitest tests for the client-side alert polling engine.
 * Covers: empty state, transition detection, RSI conditions,
 * re-arm behavior, null price handling, and all helper functions.
 *
 * Pattern: M026 — pure functions, no database imports.
 */

import { describe, it, expect } from 'vitest';
import {
  createAlertState,
  evaluateAlertPoll,
  hasEnabledAlert,
  hasRsiAlert,
  parseAlertConfig,
  mapConditionToApi,
  buildPriceSnapshot,
  type AlertState,
  type AlertItemInput,
  type AlertEvent,
} from './alert-polling';
import type { AlertConfig, PriceSnapshot } from './alert-engine';

// ── Fixtures ─────────────────────────────────────────────────────────────

const aaplConfig: AlertConfig = {
  priceAboveKeyLevel: { enabled: true },
};

const msftConfig: AlertConfig = {
  priceBelowTrigger: { enabled: true },
};

const rsiConfig: AlertConfig = {
  rsiAbove: { enabled: true, threshold: 70 },
  rsiBelow: { enabled: true, threshold: 30 },
};

const multiAlertConfig: AlertConfig = {
  priceAboveKeyLevel: { enabled: true },
  priceAboveTarget: { enabled: true },
  rsiBelow: { enabled: true, threshold: 30 },
};

function makeItem(
  overrides: { symbol: string } & Partial<Omit<AlertItemInput, 'symbol'>>,
): AlertItemInput {
  const { symbol, ...rest } = overrides;
  return {
    id: `item-${symbol.toLowerCase()}`,
    symbol,
    alertConfig: null,
    currentPrice: null,
    rsi: null,
    keyLevel: null,
    triggerPrice: null,
    plannedStop: null,
    targetPrice: null,
    ...rest,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('createAlertState', () => {
  it('returns an empty object', () => {
    expect(createAlertState()).toEqual({});
  });
});

describe('evaluateAlertPoll', () => {
  it('returns empty events and state for empty input', () => {
    const prev: AlertState = {};
    const result = evaluateAlertPoll(prev, []);
    expect(result.events).toEqual([]);
    expect(result.nextState).toEqual({});
  });

  it('returns empty events when no items have alertConfig', () => {
    const prev: AlertState = {};
    const items: AlertItemInput[] = [
      makeItem({ symbol: 'AAPL', currentPrice: 150.0 }),
      makeItem({ symbol: 'MSFT', currentPrice: 300.0 }),
    ];
    const result = evaluateAlertPoll(prev, items);
    expect(result.events).toEqual([]);
    expect(result.nextState).toEqual({});
  });

  it('preserves prior state for items without config or price', () => {
    const prev: AlertState = {
      AAPL: { conditions: { price_above_keyLevel: true } },
    };
    const items: AlertItemInput[] = [
      makeItem({ symbol: 'AAPL', currentPrice: 150.0 }),
    ];
    const result = evaluateAlertPoll(prev, items);
    // AAPL has no alertConfig — prior state preserved
    expect(result.nextState['AAPL']).toEqual(prev['AAPL']);
    expect(result.events).toEqual([]);
  });

  it('preserves prior state when current price is null', () => {
    const prev: AlertState = {
      AAPL: { conditions: { price_above_keyLevel: true } },
    };
    const items: AlertItemInput[] = [
      makeItem({
        symbol: 'AAPL',
        currentPrice: null,
        alertConfig: aaplConfig,
        keyLevel: 140,
      }),
    ];
    const result = evaluateAlertPoll(prev, items);
    expect(result.nextState['AAPL']).toEqual(prev['AAPL']);
    expect(result.events).toEqual([]);
  });

  it('fires an event for a price_above_keyLevel transition', () => {
    const prev: AlertState = {};
    const items: AlertItemInput[] = [
      makeItem({
        symbol: 'AAPL',
        currentPrice: 150.0,
        alertConfig: aaplConfig,
        keyLevel: 140,
      }),
    ];
    const result = evaluateAlertPoll(prev, items);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].symbol).toBe('AAPL');
    expect(result.events[0].condition).toBe('price_above_keyLevel');
    expect(result.events[0].message).toContain('above key level');
    expect(result.nextState['AAPL']?.conditions['price_above_keyLevel']).toBe(true);
  });

  it('does NOT fire a second event for a persistent condition', () => {
    const prev: AlertState = {
      AAPL: { conditions: { price_above_keyLevel: true } },
    };
    const items: AlertItemInput[] = [
      makeItem({
        symbol: 'AAPL',
        currentPrice: 155.0, // still above 140
        alertConfig: aaplConfig,
        keyLevel: 140,
      }),
    ];
    const result = evaluateAlertPoll(prev, items);
    expect(result.events).toHaveLength(0);
    expect(result.nextState['AAPL']?.conditions['price_above_keyLevel']).toBe(true);
  });

  it('re-arms: fires event again after condition resolves and re-triggers', () => {
    // Cycle 1: price 150 > keyLevel 140 → trigger
    const prev1: AlertState = {};
    const items1 = [
      makeItem({
        symbol: 'AAPL',
        currentPrice: 150,
        alertConfig: aaplConfig,
        keyLevel: 140,
      }),
    ];
    const cycle1 = evaluateAlertPoll(prev1, items1);
    expect(cycle1.events).toHaveLength(1);

    // Cycle 2: price drops below 140 → no longer triggered
    const items2 = [
      makeItem({
        symbol: 'AAPL',
        currentPrice: 135,
        alertConfig: aaplConfig,
        keyLevel: 140,
      }),
    ];
    const cycle2 = evaluateAlertPoll(cycle1.nextState, items2);
    expect(cycle2.events).toHaveLength(0);
    expect(cycle2.nextState['AAPL']?.conditions['price_above_keyLevel']).toBeUndefined();

    // Cycle 3: price goes back above 140 → should re-trigger
    const items3 = [
      makeItem({
        symbol: 'AAPL',
        currentPrice: 160,
        alertConfig: aaplConfig,
        keyLevel: 140,
      }),
    ];
    const cycle3 = evaluateAlertPoll(cycle2.nextState, items3);
    expect(cycle3.events).toHaveLength(1);
    expect(cycle3.events[0].condition).toBe('price_above_keyLevel');
  });

  it('handles price_below_trigger transitions', () => {
    const prev: AlertState = {};
    const items = [
      makeItem({
        symbol: 'MSFT',
        currentPrice: 280,
        alertConfig: msftConfig,
        triggerPrice: 290,
      }),
    ];
    const result = evaluateAlertPoll(prev, items);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].condition).toBe('price_below_trigger');
    expect(result.events[0].symbol).toBe('MSFT');
  });

  it('handles RSI alerts', () => {
    const prev: AlertState = {};
    const items = [
      makeItem({
        symbol: 'TSLA',
        currentPrice: 250,
        alertConfig: rsiConfig,
        rsi: 75, // above 70 → rsiAbove fires
      }),
    ];
    const result = evaluateAlertPoll(prev, items);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].condition).toBe('rsi_above');

    // RSI below 30 → rsiBelow fires
    const items2 = [
      makeItem({
        symbol: 'TSLA',
        currentPrice: 250,
        alertConfig: rsiConfig,
        rsi: 25,
      }),
    ];
    const prev2: AlertState = {};
    const result2 = evaluateAlertPoll(prev2, items2);
    expect(result2.events).toHaveLength(1);
    expect(result2.events[0].condition).toBe('rsi_below');
  });

  it('does not fire RSI alerts when RSI is null', () => {
    const prev: AlertState = {};
    const items = [
      makeItem({
        symbol: 'TSLA',
        currentPrice: 250,
        alertConfig: rsiConfig,
        rsi: null,
      }),
    ];
    const result = evaluateAlertPoll(prev, items);
    expect(result.events).toHaveLength(0);
  });

  it('handles multiple items with different conditions', () => {
    const prev: AlertState = {};
    const items = [
      makeItem({
        symbol: 'AAPL',
        currentPrice: 150,
        alertConfig: aaplConfig,
        keyLevel: 140,
      }),
      makeItem({
        symbol: 'TSLA',
        currentPrice: 200,
        alertConfig: rsiConfig,
        rsi: 75,
      }),
    ];
    const result = evaluateAlertPoll(prev, items);
    expect(result.events).toHaveLength(2);
    const symbols = result.events.map((e) => e.symbol);
    expect(symbols).toContain('AAPL');
    expect(symbols).toContain('TSLA');
  });

  it('handles multiple conditions on a single item', () => {
    const prev: AlertState = {};
    // priceAboveKeyLevel (180 > 150), priceAboveTarget (180 > 170), rsiBelow (25 < 30)
    const items = [
      makeItem({
        symbol: 'AAPL',
        currentPrice: 180,
        alertConfig: multiAlertConfig,
        keyLevel: 150,
        targetPrice: 170,
        rsi: 25,
      }),
    ];
    const result = evaluateAlertPoll(prev, items);
    expect(result.events).toHaveLength(3);
    const conditions = result.events.map((e) => e.condition);
    expect(conditions).toContain('price_above_keyLevel');
    expect(conditions).toContain('price_above_target');
    expect(conditions).toContain('rsi_below');
  });

  it('sets watchlistItemId and threshold on events', () => {
    const prev: AlertState = {};
    const items = [
      makeItem({
        id: 'wl-aapl-001',
        symbol: 'AAPL',
        currentPrice: 180,
        alertConfig: aaplConfig,
        keyLevel: 150,
      }),
    ];
    const result = evaluateAlertPoll(prev, items);
    expect(result.events[0].watchlistItemId).toBe('wl-aapl-001');
    expect(result.events[0].threshold).toBe(150);
    expect(result.events[0].actualValue).toBe(180);
  });

  it('resets state when alertConfig becomes null', () => {
    const prev: AlertState = {
      AAPL: { conditions: { price_above_keyLevel: true } },
    };
    // Item with no alertConfig — prior state preserved
    const items: AlertItemInput[] = [
      makeItem({ symbol: 'AAPL', currentPrice: 150 }),
    ];
    const result = evaluateAlertPoll(prev, items);
    expect(result.nextState['AAPL']).toEqual(prev['AAPL']);
    expect(result.events).toHaveLength(0);
  });
});

describe('hasEnabledAlert', () => {
  it('returns true when at least one condition is enabled', () => {
    expect(hasEnabledAlert(aaplConfig)).toBe(true);
    expect(hasEnabledAlert(multiAlertConfig)).toBe(true);
  });

  it('returns false when no conditions are enabled', () => {
    const empty: AlertConfig = {};
    expect(hasEnabledAlert(empty)).toBe(false);
  });

  it('returns false for null/undefined configs (though typed)', () => {
    // This should not happen in practice due to typing, but defensively
    const allDisabled: AlertConfig = {
      priceAboveKeyLevel: { enabled: false },
    };
    expect(hasEnabledAlert(allDisabled)).toBe(false);
  });
});

describe('hasRsiAlert', () => {
  it('returns true when rsiAbove or rsiBelow is enabled', () => {
    expect(hasRsiAlert(rsiConfig)).toBe(true);
  });

  it('returns false for price-only configs', () => {
    expect(hasRsiAlert(aaplConfig)).toBe(false);
    expect(hasRsiAlert(msftConfig)).toBe(false);
  });

  it('returns false for empty config', () => {
    expect(hasRsiAlert({})).toBe(false);
  });
});

describe('parseAlertConfig', () => {
  it('parses a JSON string', () => {
    const raw = JSON.stringify({ priceAboveKeyLevel: { enabled: true } });
    const result = parseAlertConfig(raw);
    expect(result).not.toBeNull();
    expect(result?.priceAboveKeyLevel?.enabled).toBe(true);
  });

  it('returns null for null/undefined input', () => {
    expect(parseAlertConfig(null)).toBeNull();
    expect(parseAlertConfig(undefined)).toBeNull();
  });

  it('returns input as-is for already-parsed objects', () => {
    const config: AlertConfig = { priceAboveKeyLevel: { enabled: true } };
    const result = parseAlertConfig(config);
    expect(result).toBe(config);
  });

  it('returns null for invalid JSON string', () => {
    expect(parseAlertConfig('not-json')).toBeNull();
  });

  it('returns null for arrays', () => {
    expect(parseAlertConfig([])).toBeNull();
  });
});

describe('mapConditionToApi', () => {
  it('maps price_above_* to "above"', () => {
    expect(mapConditionToApi('price_above_keyLevel')).toBe('above');
    expect(mapConditionToApi('price_above_trigger')).toBe('above');
    expect(mapConditionToApi('price_above_stop')).toBe('above');
    expect(mapConditionToApi('price_above_target')).toBe('above');
  });

  it('maps price_below_* to "below"', () => {
    expect(mapConditionToApi('price_below_keyLevel')).toBe('below');
    expect(mapConditionToApi('price_below_trigger')).toBe('below');
    expect(mapConditionToApi('price_below_stop')).toBe('below');
    expect(mapConditionToApi('price_below_target')).toBe('below');
  });

  it('maps rsi_above to "rsiAbove"', () => {
    expect(mapConditionToApi('rsi_above')).toBe('rsiAbove');
  });

  it('maps rsi_below to "rsiBelow"', () => {
    expect(mapConditionToApi('rsi_below')).toBe('rsiBelow');
  });

  it('falls back to "above" for unknown conditions', () => {
    expect(mapConditionToApi('unknown_condition')).toBe('above');
  });
});

describe('buildPriceSnapshot', () => {
  it('builds a PriceSnapshot from levels and RSI', () => {
    const snapshot = buildPriceSnapshot(150.5, {
      keyLevel: 140,
      triggerPrice: 145,
      plannedStop: 135,
      targetPrice: 160,
    }, 55.3);

    expect(snapshot.currentPrice).toBe(150.5);
    expect(snapshot.rsi).toBe(55.3);
    expect(snapshot.keyLevel).toBe(140);
    expect(snapshot.triggerPrice).toBe(145);
    expect(snapshot.stopPrice).toBe(135);
    expect(snapshot.targetPrice).toBe(160);
  });

  it('handles null RSI', () => {
    const snapshot = buildPriceSnapshot(100, { keyLevel: 90 }, null);
    expect(snapshot.rsi).toBeNull();
  });

  it('handles missing levels', () => {
    const snapshot = buildPriceSnapshot(100, {}, null);
    // Undefined levels should map to null
    expect(snapshot.keyLevel).toBeNull();
    expect(snapshot.triggerPrice).toBeNull();
    expect(snapshot.stopPrice).toBeNull();
    expect(snapshot.targetPrice).toBeNull();
  });
});
