/**
 * M007-S01 (D1) — browser/real-handler proof that a SHORT alias correction
 * posts economically correct cash.
 *
 * Seeded: ready account + open SHORT trade with one sell_short execution.
 * Action: correct the execution via the REAL trade-scoped correction route
 * with replacement action 'add' (a short add is economically sell_short).
 *
 * Verified:
 * - the correction response's reversal/replacement executions store the
 *   CONCRETE economic actions (never the 'add' alias)
 * - the replacement cash effect is INCREASE (short sale proceeds)
 * - account cash (overview) increases
 * - the trade detail UI reflects the corrected state
 */
import { test, expect } from '@playwright/test';

test('M007-S01 short alias correction posts economically concrete cash', async ({ page }) => {
  // 1. Ready account (active, configured, funded).
  const accRes = await page.request.post('/api/accounts', { data: { name: 'M007 S1' } });
  expect(accRes.ok()).toBeTruthy();
  const account = await accRes.json();
  const cfg = await page.request.put(`/api/accounts/${account.id}`, { data: { maxRiskPerTradePct: 2, defaultCommission: 1 } });
  expect(cfg.ok()).toBeTruthy();
  const init = await page.request.post(`/api/accounts/${account.id}/initialize`, { data: { mode: 'opening_balance', amount: '50000.00' } });
  expect(init.ok()).toBeTruthy();
  const act = await page.request.put(`/api/accounts/${account.id}`, { data: { isActive: true } });
  expect(act.ok()).toBeTruthy();

  // 2. Open SHORT trade with a sell_short execution.
  const trade = await (await page.request.post('/api/trades', {
    data: { symbol: 'S1X', direction: 'short', accountId: account.id, plannedEntry: 50, plannedStop: 55, plannedQuantity: 100 },
  })).json();
  const exec = await (await page.request.post(`/api/trades/${trade.id}/executions`, {
    data: { action: 'sell_short', quantity: 100, price: 50, fees: 1, executedAt: new Date().toISOString() },
  })).json();
  const executionId = exec.execution.id;

  const overviewBefore = await (await page.request.get(`/api/accounts/${account.id}/overview`)).json();
  const cashBefore = Number((overviewBefore as { snapshot?: { netCash?: string } }).snapshot?.netCash ?? 0);

  // 3. Correct the entry to action 'add' through the REAL trade-scoped route.
  const correct = await page.request.post(`/api/trades/${trade.id}/executions/${executionId}/correct`, {
    data: { symbol: 'S1X', action: 'add', quantity: '100.00', price: '55.00', fees: '1.00', reason: 'M007-S01 short alias correction' },
  });
  const correctBody = await correct.json().catch(() => ({}));
  expect(correct.ok(), `correction should succeed: ${correct.status()} ${JSON.stringify(correctBody)}`).toBeTruthy();

  // 4. Canonical invariant: reversal and replacement store CONCRETE actions
  //    — never the workflow alias 'add'.
  const reversalAction = (correctBody as { reversalExecution: { action: string } }).reversalExecution.action;
  const replacementAction = (correctBody as { replacementExecution: { action: string } }).replacementExecution.action;
  // Original sell_short → reversal buy_to_cover; replacement add → sell_short.
  expect(reversalAction).toBe('buy_to_cover');
  expect(replacementAction).toBe('sell_short');
  for (const a of [reversalAction, replacementAction]) {
    expect(['buy', 'sell', 'sell_short', 'buy_to_cover']).toContain(a);
  }

  // 5. Cash direction: the correction replaces a 50.00 short sale with a
  //    55.00 short sale — cash INCREASES (price improvement, fees net zero).
  const overviewAfter = await (await page.request.get(`/api/accounts/${account.id}/overview`)).json();
  const cashAfter = Number((overviewAfter as { snapshot?: { netCash?: string } }).snapshot?.netCash ?? 0);
  expect(cashAfter).toBeGreaterThan(cashBefore);
  expect(cashAfter - cashBefore).toBeCloseTo(500, 0);

  // 6. Trade detail still renders the corrected trade (open short).
  await page.goto(`/trades/${trade.id}`);
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('Open', { exact: true }).first()).toBeVisible({ timeout: 15000 });
});
