import { test, expect } from '@playwright/test';
import { createTradingAccount } from './helpers/trading-account';

test.describe.configure({ mode: 'serial' });

const GRADE_FIELDS = {
  setupScore: 9,
  riskScore: 8,
  entryScore: 9,
  managementScore: 8,
  exitScore: 9,
  reviewScore: 7,
};
const GRADE_TOTAL = 50;
const GRADE_LABEL = 'B';

test.describe('M004 per-trade review system flow', () => {
  let tradeId: string;

  test('01 - create account and closed trade with executions', async ({ page }) => {
    const account = await createTradingAccount(page.request, 'M004 Review Account');

    // ── Create a long trade ──
    const tradeRes = await page.request.post('/api/trades', {
      data: { symbol: 'NVDA', direction: 'long', accountId: account.id },
    });
    expect(tradeRes.ok()).toBeTruthy();
    const trade = await tradeRes.json();
    tradeId = trade.id;
    expect(trade.status).toBe('planned');

    // ── Step 3: Add an entry execution (open the trade) ──
    let execRes = await page.request.post(`/api/trades/${tradeId}/executions`, {
      data: { action: 'buy', quantity: 100, price: 120.00, fees: 5.00 },
    });
    expect(execRes.ok()).toBeTruthy();
    const t1 = await (await page.request.get(`/api/trades/${tradeId}`)).json();
    expect(t1.status).toBe('open');

    // ── Step 4: Add exit execution (close the trade) ──
    execRes = await page.request.post(`/api/trades/${tradeId}/executions`, {
      data: { action: 'sell', quantity: 100, price: 135.00, fees: 5.00 },
    });
    expect(execRes.ok()).toBeTruthy();
    const t2 = await (await page.request.get(`/api/trades/${tradeId}`)).json();
    expect(t2.status).toBe('closed');

    console.log(`Created trade ${trade.tradeCode} (${tradeId}), status: closed`);
  });

  test('02 - grade the trade with all 6 quality scores', async ({ page }) => {
    // Grade the trade via API — field names match Zod schema (setupScore, not setupQualityScore)
    const gradeRes = await page.request.put(`/api/trades/${tradeId}/grade`, {
      data: {
        ...GRADE_FIELDS,
        followedPlan: true,
        ruleViolation: false,
      },
    });
    expect(gradeRes.ok()).toBeTruthy();
    const grade = await gradeRes.json();
    expect(grade.totalScore).toBe(GRADE_TOTAL);
    expect(grade.gradeLabel).toBe(GRADE_LABEL);
    console.log(`Grade: total ${grade.totalScore}, label ${grade.gradeLabel}`);
  });

  test('03 - add mistakes to the trade', async ({ page }) => {
    // The API expects mistakeType as a lookup value string (e.g. 'fv_entry_timing'), not a UUID
    // It resolves the string to a lookup ID internally

    // Seed the mistake_type lookup values the API needs
    const mistakeTypes = ['fv_entry_timing', 'fv_exit_discipline'];
    for (const mt of mistakeTypes) {
      await page.request.post('/api/lookups', {
        data: {
          type: 'mistake_type',
          value: mt,
          description: 'Seeded by test',
          sortOrder: 0,
        },
      });
    }

    // Add first mistake
    const mRes = await page.request.post(`/api/trades/${tradeId}/mistakes`, {
      data: {
        mistakeType: 'fv_entry_timing',
        phase: 'entry',
        severity: 'moderate',
        rootCause: 'FOMO entry, did not wait for confirmation',
        correctiveAction: 'Use limit orders, wait for candle close',
        status: 'open',
      },
    });
    expect(mRes.ok()).toBeTruthy();
    const m1 = await mRes.json();
    expect(m1.phase).toBe('entry');
    expect(m1.severity).toBe('moderate');

    // Add second mistake
    const mRes2 = await page.request.post(`/api/trades/${tradeId}/mistakes`, {
      data: {
        mistakeType: 'fv_exit_discipline',
        phase: 'exit',
        severity: 'minor',
        rootCause: 'Exited too early',
        correctiveAction: 'Hold to target, use trailing stop',
        status: 'addressed',
      },
    });
    expect(mRes2.ok()).toBeTruthy();
    const m2 = await mRes2.json();
    expect(m2.phase).toBe('exit');
    expect(m2.severity).toBe('minor');

    // Verify both mistakes appear in GET
    const mGet = await (await page.request.get(`/api/trades/${tradeId}/mistakes`)).json();
    expect(Array.isArray(mGet)).toBeTruthy();
    expect(mGet.length).toBe(2);
    console.log(`Created ${mGet.length} mistakes for trade`);
  });

  test('04 - verify trade detail page shows grade and mistakes UI', async ({ page }) => {
    await page.goto(`/trades/${tradeId}`);
    await page.waitForLoadState('networkidle');

    // h1 should show the symbol
    await expect(page.locator('h1')).toContainText('NVDA');

    // Grade section should be visible for closed trade
    await expect(page.getByText('Grade', { exact: false }).first()).toBeVisible();

    // Mistakes details live inside a collapsed review section (M020/S04
    // progressive disclosure); expand the Mistakes section to expose the
    // recorded root causes through the current UI.
    await page.getByRole('button', { name: /^Mistakes/ }).click();
    await expect(page.getByText('FOMO entry', { exact: false })).toBeVisible();
    await expect(page.getByText('Exited too early', { exact: false })).toBeVisible();

    console.log('Trade detail page shows grade and mistakes UI');
  });

  test('05 - verify existing pages still render after M004 changes', async ({ page }) => {
    // Verify /trades still renders (M002 page)
    await page.goto('/trades');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h1')).toContainText('Trades');

    // Verify /checks no longer renders the legacy page (M002 maintenance —
    // the canonical checklist subsystem lives in Settings + first-fill gate).
    await page.goto('/checks');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h1')).not.toContainText('Checks & Validation');

    console.log('Existing pages still render correctly after M004 changes');
  });

  test('06 - verify grade API validation rejects bad inputs', async ({ page }) => {
    // Score out of range (0 < 1)
    let res = await page.request.put(`/api/trades/${tradeId}/grade`, {
      data: { ...GRADE_FIELDS, setupScore: 0 },
    });
    expect(res.status()).toBe(400);

    // Score above max (11 > 10)
    res = await page.request.put(`/api/trades/${tradeId}/grade`, {
      data: { ...GRADE_FIELDS, riskScore: 11 },
    });
    expect(res.status()).toBe(400);

    // Missing required field
    res = await page.request.put(`/api/trades/${tradeId}/grade`, {
      data: { setupScore: 5, riskScore: 5 },
    });
    expect(res.status()).toBe(400);

    console.log('Grade API validation rejects bad inputs');
  });
});
