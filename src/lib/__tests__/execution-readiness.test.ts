/**
 * execution-readiness.test.ts
 *
 * Unit tests for the pure execution-readiness gate (T04 / S02, D2).
 *
 * Run: npx vitest run src/lib/__tests__/execution-readiness.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  checkExecutionReadiness,
  type ExecutionReadinessInput,
} from '../execution-readiness';

/** Fully-ready baseline: every check passes with these inputs. */
function baseInput(
  overrides: Partial<ExecutionReadinessInput> = {},
): ExecutionReadinessInput {
  return {
    account: {
      isActive: true,
      currency: 'USD',
      maxRiskPerTradePct: 1, // 1% of equity
      defaultCommission: 1,
    },
    settings: {
      maxRiskPerTradePct: 2, // fallback — ignored while account override is set
      defaultCommission: 1.5, // global commission fallback (A1)
      
    },
    tradeStatus: 'planned',
    initialRiskAmount: 500, // below 1% of 100000 = 1000
    equityAtOpen: 100000,
    hasUsableEquity: true,
    requiredChecklistPassed: true,
    ...overrides,
  };
}

function codesOf(input: ExecutionReadinessInput) {
  return checkExecutionReadiness(input).failures.map((f) => f.code);
}

describe('checkExecutionReadiness', () => {
  it('returns ready with no failures when every check passes', () => {
    const result = checkExecutionReadiness(baseInput());
    expect(result.ready).toBe(true);
    expect(result.failures).toEqual([]);
  });

  // ── a. account-not-active ──────────────────────────────────────────

  it('fails with account-not-active when the account is inactive', () => {
    const result = checkExecutionReadiness(
      baseInput({ account: { ...baseInput().account, isActive: false } }),
    );
    expect(result.ready).toBe(false);
    const failure = result.failures.find((f) => f.code === 'account-not-active');
    expect(failure?.message).toBe('Account not active');
  });

  // ── b. account-not-trading-ready ───────────────────────────────────

  it('A1: fails with account-not-trading-ready when effective maxRiskPerTradePct is missing (account + global both null)', () => {
    const result = checkExecutionReadiness(
      baseInput({
        account: { ...baseInput().account, maxRiskPerTradePct: null },
        settings: {
          maxRiskPerTradePct: null,
          defaultCommission: 1.5,
          
        },
      }),
    );
    expect(result.ready).toBe(false);
    const failure = result.failures.find(
      (f) => f.code === 'account-not-trading-ready',
    );
    expect(failure?.message).toBe('Account setup incomplete for trading');
  });

  it('A1: does NOT fail trading-ready when account maxRisk is null but the global default resolves', () => {
    const input = baseInput({
      account: { ...baseInput().account, maxRiskPerTradePct: null },
    });
    expect(codesOf(input)).not.toContain('account-not-trading-ready');
    expect(checkExecutionReadiness(input).ready).toBe(true);
  });

  it('A1: fails with account-not-trading-ready when effective defaultCommission is missing (account + global both null)', () => {
    const input = baseInput({
      account: { ...baseInput().account, defaultCommission: null },
      settings: {
        maxRiskPerTradePct: 2,
        defaultCommission: null,
        
      },
    });
    expect(codesOf(input)).toContain('account-not-trading-ready');
    expect(input.settings.defaultCommission).toBeNull();
    expect(checkExecutionReadiness(input).ready).toBe(false);
  });

  it('A1: does NOT fail trading-ready when account commission is null but the global default resolves', () => {
    const input = baseInput({
      account: { ...baseInput().account, defaultCommission: null },
      settings: {
        maxRiskPerTradePct: 2,
        defaultCommission: 1.5,
        
      },
    });
    expect(codesOf(input)).not.toContain('account-not-trading-ready');
    expect(checkExecutionReadiness(input).ready).toBe(true);
  });

  it('fails with account-not-trading-ready when there is no opening cash', () => {
    const result = checkExecutionReadiness(baseInput({ hasUsableEquity: false }));
    expect(codesOf(baseInput({ hasUsableEquity: false }))).toContain(
      'account-not-trading-ready',
    );
    expect(result.ready).toBe(false);
  });

  it('fails with account-not-trading-ready for a non-USD account', () => {
    const result = checkExecutionReadiness(
      baseInput({ account: { ...baseInput().account, currency: 'EUR' } }),
    );
    expect(codesOf(baseInput({ account: { ...baseInput().account, currency: 'EUR' } }))).toContain(
      'account-not-trading-ready',
    );
    expect(result.ready).toBe(false);
  });

  // ── c. trade-not-planned ───────────────────────────────────────────

  it('fails with trade-not-planned when the trade is not in planned status', () => {
    const result = checkExecutionReadiness(baseInput({ tradeStatus: 'open' }));
    const failure = result.failures.find((f) => f.code === 'trade-not-planned');
    expect(failure?.message).toBe('Trade not in planned status');
    expect(result.ready).toBe(false);
  });

  it('does not fail with trade-not-planned while the trade is planned', () => {
    expect(codesOf(baseInput())).not.toContain('trade-not-planned');
  });

  // ── d. checklist-not-passed ────────────────────────────────────────

  it('fails with checklist-not-passed when required checklist items are not passed', () => {
    const result = checkExecutionReadiness(
      baseInput({ requiredChecklistPassed: false }),
    );
    const failure = result.failures.find((f) => f.code === 'checklist-not-passed');
    expect(failure?.message).toBe('Required checklist items not passed');
    expect(result.ready).toBe(false);
  });

  // ── e. max-risk-exceeded ───────────────────────────────────────────

  it('fails with max-risk-exceeded (overrideable) when initial risk exceeds the limit', () => {
    // 2% of 100000 = 2000 limit; 2500 proposed risk exceeds it.
    const result = checkExecutionReadiness(
      baseInput({
        account: { ...baseInput().account, maxRiskPerTradePct: 2 },
        initialRiskAmount: 2500,
      }),
    );
    const failure = result.failures.find((f) => f.code === 'max-risk-exceeded');
    expect(failure).toBeDefined();
    expect(failure?.message).toBe('Max risk exceeded');
    expect(failure?.limit).toBe(2000);
    expect(failure?.computed).toBe(2500);
    expect(failure?.overrideable).toBe(true);
    expect(result.ready).toBe(false);
  });

  it('does not fail max-risk when initial risk is exactly at the limit', () => {
    // 1% of 100000 = 1000; exactly 1000 is allowed (strict > comparison).
    const result = checkExecutionReadiness(baseInput({ initialRiskAmount: 1000 }));
    expect(codesOf(baseInput({ initialRiskAmount: 1000 }))).not.toContain(
      'max-risk-exceeded',
    );
    expect(result.ready).toBe(true);
  });

  it('does not fail max-risk when initial risk is within the limit', () => {
    const result = checkExecutionReadiness(baseInput());
    expect(codesOf(baseInput())).not.toContain('max-risk-exceeded');
    expect(result.ready).toBe(true);
  });

  // ── Account override → settings fallback cascade ───────────────────

  it('uses the account maxRiskPerTradePct override over the settings fallback', () => {
    // Account 1% → limit 1000; settings 2% would allow 2000.
    const overLimit = checkExecutionReadiness(baseInput({ initialRiskAmount: 1500 }));
    expect(codesOf(baseInput({ initialRiskAmount: 1500 }))).toContain('max-risk-exceeded');
    expect(
      overLimit.failures.find((f) => f.code === 'max-risk-exceeded')?.limit,
    ).toBe(1000);
  });

  it('uses the effective settings maxRiskPerTradePct when the account has none (A1 global fallback is trading-ready)', () => {
    // Account has no threshold → settings 2% → limit = 2% of 100000 = 2000.
    // A1: the global default makes the account trading-ready (no
    // account-not-trading-ready failure) AND the max-risk threshold uses it.
    const withinLimit = baseInput({
      account: { ...baseInput().account, maxRiskPerTradePct: null },
      initialRiskAmount: 1500,
    });
    expect(codesOf(withinLimit)).not.toContain('max-risk-exceeded');
    expect(codesOf(withinLimit)).not.toContain('account-not-trading-ready');
    expect(checkExecutionReadiness(withinLimit).ready).toBe(true);

    // 2500 exceeds the settings-derived limit (2000) → max-risk failure whose
    // limit proves the settings value was used, not the account's.
    const overLimit = baseInput({
      account: { ...baseInput().account, maxRiskPerTradePct: null },
      initialRiskAmount: 2500,
    });
    const result = checkExecutionReadiness(overLimit);
    const failure = result.failures.find((f) => f.code === 'max-risk-exceeded');
    expect(failure).toBeDefined();
    expect(failure?.limit).toBe(2000);
    expect(failure?.computed).toBe(2500);
    expect(codesOf(overLimit)).not.toContain('account-not-trading-ready');
  });

  it('A1: global defaultCommission makes the account trading-ready', () => {
    // Account commission null → settings defaultCommission 1.5 → configured.
    const input = baseInput({
      account: { ...baseInput().account, defaultCommission: null },
      settings: {
        maxRiskPerTradePct: 2,
        defaultCommission: 1.5,
        
      },
    });
    expect(codesOf(input)).not.toContain('account-not-trading-ready');
    expect(checkExecutionReadiness(input).ready).toBe(true);
  });

  it('A1: explicit zero commission counts as configured (not missing)', () => {
    const input = baseInput({
      account: { ...baseInput().account, defaultCommission: 0 },
    });
    expect(codesOf(input)).not.toContain('account-not-trading-ready');
    expect(checkExecutionReadiness(input).ready).toBe(true);
  });

  it('A1: mixed fallback — account max risk + global commission', () => {
    const input = baseInput({
      account: {
        ...baseInput().account,
        maxRiskPerTradePct: 1,
        defaultCommission: null,
      },
      settings: {
        maxRiskPerTradePct: 2,
        defaultCommission: 1.5,
        
      },
    });
    expect(codesOf(input)).not.toContain('account-not-trading-ready');
    expect(checkExecutionReadiness(input).ready).toBe(true);
    // Max-risk threshold uses the ACCOUNT override (1% → 1000), not the global.
    const over = checkExecutionReadiness(
      baseInput({
        account: {
          ...baseInput().account,
          maxRiskPerTradePct: 1,
          defaultCommission: null,
        },
        settings: {
          maxRiskPerTradePct: 2,
          defaultCommission: 1.5,
          
        },
        initialRiskAmount: 1500,
      }),
    );
    const failure = over.failures.find((f) => f.code === 'max-risk-exceeded');
    expect(failure?.limit).toBe(1000);
  });

  it('A1: mixed fallback — global max risk + account commission', () => {
    const input = baseInput({
      account: {
        ...baseInput().account,
        maxRiskPerTradePct: null,
        defaultCommission: 0.75,
      },
      settings: {
        maxRiskPerTradePct: 2,
        defaultCommission: 1.5,
        
      },
    });
    expect(codesOf(input)).not.toContain('account-not-trading-ready');
    expect(checkExecutionReadiness(input).ready).toBe(true);
    // Max-risk threshold uses the GLOBAL risk (2% → 2000), commission is the
    // account override 0.75.
    const at = checkExecutionReadiness(
      baseInput({
        account: {
          ...baseInput().account,
          maxRiskPerTradePct: null,
          defaultCommission: 0.75,
        },
        settings: {
          maxRiskPerTradePct: 2,
          defaultCommission: 1.5,
          
        },
        initialRiskAmount: 2500,
      }),
    );
    const failure = at.failures.find((f) => f.code === 'max-risk-exceeded');
    expect(failure?.limit).toBe(2000);
  });

  it('A1: missing risk at both levels remains not-ready even when commission resolves', () => {
    const input = baseInput({
      account: {
        ...baseInput().account,
        maxRiskPerTradePct: null,
        defaultCommission: 1,
      },
      settings: {
        maxRiskPerTradePct: null,
        defaultCommission: 1.5,
        
      },
    });
    expect(codesOf(input)).toContain('account-not-trading-ready');
    expect(codesOf(input)).not.toContain('max-risk-exceeded');
  });

  it('A1: missing commission at both levels remains not-ready even when risk resolves', () => {
    const input = baseInput({
      account: {
        ...baseInput().account,
        maxRiskPerTradePct: 1,
        defaultCommission: null,
      },
      settings: {
        maxRiskPerTradePct: 2,
        defaultCommission: null,
        
      },
    });
    expect(codesOf(input)).toContain('account-not-trading-ready');
    expect(codesOf(input)).not.toContain('max-risk-exceeded');
  });

  it('A1: account-level override wins over the global default for BOTH fields', () => {
    const input = baseInput({
      account: { ...baseInput().account, maxRiskPerTradePct: 1, defaultCommission: 0.75 },
      settings: {
        maxRiskPerTradePct: 2,
        defaultCommission: 2,
        
      },
    });
    expect(codesOf(input)).not.toContain('account-not-trading-ready');
    expect(checkExecutionReadiness(input).ready).toBe(true);
    const over = checkExecutionReadiness(
      baseInput({
        account: { ...baseInput().account, maxRiskPerTradePct: 1, defaultCommission: 0.75 },
        settings: {
          maxRiskPerTradePct: 2,
          defaultCommission: 2,
          
        },
        initialRiskAmount: 1500,
      }),
    );
    const failure = over.failures.find((f) => f.code === 'max-risk-exceeded');
    expect(failure?.limit).toBe(1000); // account 1%, not global 2%
  });

  it('skips the max-risk check entirely when no threshold is configured anywhere', () => {
    const input = baseInput({
      account: {
        ...baseInput().account,
        maxRiskPerTradePct: null,
        defaultCommission: 1,
      },
      settings: { maxRiskPerTradePct: null, defaultCommission: 1.5 },
      initialRiskAmount: 999999,
    });
    // No max-risk failure — but the account is not trading-ready (no risk
    // parameter), so the gate still reports account-not-trading-ready.
    expect(codesOf(input)).not.toContain('max-risk-exceeded');
    expect(codesOf(input)).toContain('account-not-trading-ready');
  });

  // ── D1: null-not-zero for initial risk ─────────────────────────────

  it('does not trigger the max-risk block when initialRiskAmount is null (no valid stop)', () => {
    const input = baseInput({ initialRiskAmount: null });
    expect(codesOf(input)).not.toContain('max-risk-exceeded');
    // Account is fully configured, so the gate otherwise passes.
    expect(input.account.maxRiskPerTradePct).not.toBeNull();
    expect(checkExecutionReadiness(input).ready).toBe(true);
  });

  it('does not trigger the max-risk block when equityAtOpen is null (unavailable)', () => {
    const input = baseInput({ initialRiskAmount: 500000, equityAtOpen: null });
    expect(codesOf(input)).not.toContain('max-risk-exceeded');
  });

  it('does not trigger the max-risk block when equityAtOpen is zero or negative', () => {
    expect(codesOf(baseInput({ initialRiskAmount: 500, equityAtOpen: 0 }))).not.toContain(
      'max-risk-exceeded',
    );
    expect(codesOf(baseInput({ initialRiskAmount: 500, equityAtOpen: -100 }))).not.toContain(
      'max-risk-exceeded',
    );
  });

  // ── Multiple failures are collected, not short-circuited ───────────

  it('collects every failure instead of short-circuiting', () => {
    const input = baseInput({
      account: {
        isActive: false,
        currency: 'USD',
        maxRiskPerTradePct: null,
        defaultCommission: null,
      },
      settings: { maxRiskPerTradePct: null, defaultCommission: 1.5 },
      tradeStatus: 'open',
      requiredChecklistPassed: false,
      initialRiskAmount: 5000,
      equityAtOpen: 100000,
      hasUsableEquity: false,
    });
    const result = checkExecutionReadiness(input);
    expect(result.ready).toBe(false);
    const codes = result.failures.map((f) => f.code);
    expect(codes).toContain('account-not-active');
    expect(codes).toContain('account-not-trading-ready');
    expect(codes).toContain('trade-not-planned');
    expect(codes).toContain('checklist-not-passed');
    // max-risk check requires a threshold — none configured, so no failure.
    expect(codes).not.toContain('max-risk-exceeded');
  });

  it('reports max-risk alongside other failures when a threshold exists', () => {
    const input = baseInput({
      tradeStatus: 'open',
      requiredChecklistPassed: false,
      initialRiskAmount: 5000,
    });
    const result = checkExecutionReadiness(input);
    const codes = result.failures.map((f) => f.code);
    expect(codes).toContain('trade-not-planned');
    expect(codes).toContain('checklist-not-passed');
    expect(codes).toContain('max-risk-exceeded');
  });
});
