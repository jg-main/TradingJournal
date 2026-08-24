/**
 * economic-action.test.ts
 *
 * M002-A5 — economic action resolver + cash-side contract.
 *
 *   long:  buy→buy, add→buy, sell→sell, reduce→sell
 *   short: sell_short→sell_short, add→sell_short, buy_to_cover→buy_to_cover,
 *          reduce→buy_to_cover
 *   cash:  sell/sell_short → increase; buy/buy_to_cover → decrease
 *
 * Invalid pairs and unresolved generic aliases are rejected — the accounting
 * cash boundary never guesses direction from add/reduce alone.
 *
 * Run: npx vitest run src/lib/accounting/__tests__/economic-action.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  resolveEconomicExecutionAction,
  cashDirectionForEconomicAction,
  AmbiguousEconomicActionError,
  isGenericManagementAction,
  ECONOMIC_ACTIONS,
} from '../economic-action';

describe('resolveEconomicExecutionAction', () => {
  it('long: buy → buy, add → buy, sell → sell, reduce → sell', () => {
    expect(resolveEconomicExecutionAction('buy', 'long')).toBe('buy');
    expect(resolveEconomicExecutionAction('add', 'long')).toBe('buy');
    expect(resolveEconomicExecutionAction('sell', 'long')).toBe('sell');
    expect(resolveEconomicExecutionAction('reduce', 'long')).toBe('sell');
  });

  it('short: sell_short → sell_short, add → sell_short, buy_to_cover → buy_to_cover, reduce → buy_to_cover', () => {
    expect(resolveEconomicExecutionAction('sell_short', 'short')).toBe('sell_short');
    expect(resolveEconomicExecutionAction('add', 'short')).toBe('sell_short');
    expect(resolveEconomicExecutionAction('buy_to_cover', 'short')).toBe('buy_to_cover');
    expect(resolveEconomicExecutionAction('reduce', 'short')).toBe('buy_to_cover');
  });

  it('rejects invalid pairs for the direction (wrong side)', () => {
    expect(() => resolveEconomicExecutionAction('sell_short', 'long')).toThrow(AmbiguousEconomicActionError);
    expect(() => resolveEconomicExecutionAction('buy_to_cover', 'long')).toThrow(AmbiguousEconomicActionError);
    expect(() => resolveEconomicExecutionAction('buy', 'short')).toThrow(AmbiguousEconomicActionError);
    expect(() => resolveEconomicExecutionAction('sell', 'short')).toThrow(AmbiguousEconomicActionError);
  });

  it('rejects unknown actions', () => {
    expect(() => resolveEconomicExecutionAction('market_order', 'long')).toThrow(AmbiguousEconomicActionError);
  });
});

describe('cashDirectionForEconomicAction', () => {
  it('sell / sell_short increase cash; buy / buy_to_cover decrease cash', () => {
    expect(cashDirectionForEconomicAction('sell')).toBe('increase');
    expect(cashDirectionForEconomicAction('sell_short')).toBe('increase');
    expect(cashDirectionForEconomicAction('buy')).toBe('decrease');
    expect(cashDirectionForEconomicAction('buy_to_cover')).toBe('decrease');
  });

  it('every economic action is concrete (no generic aliases in ECONOMIC_ACTIONS)', () => {
    expect(ECONOMIC_ACTIONS).toEqual(['buy', 'sell', 'sell_short', 'buy_to_cover']);
    expect(ECONOMIC_ACTIONS).not.toContain('add');
    expect(ECONOMIC_ACTIONS).not.toContain('reduce');
  });
});

describe('isGenericManagementAction', () => {
  it('flags only add/reduce', () => {
    expect(isGenericManagementAction('add')).toBe(true);
    expect(isGenericManagementAction('reduce')).toBe(true);
    expect(isGenericManagementAction('buy')).toBe(false);
    expect(isGenericManagementAction('sell_short')).toBe(false);
  });
});
