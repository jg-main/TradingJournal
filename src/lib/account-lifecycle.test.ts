import { describe, expect, it } from 'vitest';
import { canDeactivateAccount, canDeleteAccount, canReactivateAccount, classifyAccountLifecycle } from './account-lifecycle';

describe('account lifecycle classification', () => {
  it('classifies an empty account', () => {
    const empty = classifyAccountLifecycle([]);
    expect(empty.hasTrades).toBe(false);
    expect(empty.hasClosedTrades).toBe(false);
    expect(empty.hasOpenTrades).toBe(false);
  });

  it('classifies a historical account', () => {
    const historical = classifyAccountLifecycle([{ status: 'closed' }]);
    expect(historical.hasTrades).toBe(true);
    expect(historical.hasClosedTrades).toBe(true);
    expect(historical.hasOpenTrades).toBe(false);
  });

  it('classifies a mixed account with open trades', () => {
    const open = classifyAccountLifecycle([{ status: 'open' }, { status: 'closed' }]);
    expect(open.hasTrades).toBe(true);
    expect(open.hasClosedTrades).toBe(true);
    expect(open.hasOpenTrades).toBe(true);
  });
});

describe('account lifecycle rules', () => {
  it('allows deletion only when no trades exist', () => {
    expect(canDeleteAccount([])).toBe(true);
    expect(canDeleteAccount([{ status: 'closed' }])).toBe(false);
  });

  it('blocks inactivation and reactivation when open trades exist', () => {
    expect(canDeactivateAccount([{ status: 'open' }])).toBe(false);
    expect(canReactivateAccount([{ status: 'open' }])).toBe(false);
  });

  it('allows inactivation and reactivation when only closed trades exist', () => {
    expect(canDeactivateAccount([{ status: 'closed' }])).toBe(true);
    expect(canReactivateAccount([{ status: 'closed' }])).toBe(true);
  });
});
