/**
 * E2E UAT tests for the Trades page Direction filter (S06).
 *
 * Covers:
 * - Direction filter shows "All" by default (both long and short trades visible)
 * - Filtering by "Long" shows only long trades
 * - Filtering by "Short" shows only short trades
 * - Direction filter selection persists on page reload
 *
 * Run: npx playwright test e2e/trades-s06-uat.spec.ts
 */

import { test, expect } from '@playwright/test';

const TS = Date.now();

/**
 * Create a fully usable test account: creates the account, sets risk params,
 * activates it, and posts opening cash. Returns { id, name }.
 */
async function setupAccount(page: import('@playwright/test').Page, name: string) {
  const createResp = await page.request.post('/api/accounts', {
    data: { name, currency: 'USD' },
  });
  expect(createResp.status()).toBe(201);
  const account = (await createResp.json()) as { id: string; name: string };

  // Set risk parameters
  const configResp = await page.request.put(`/api/accounts/${account.id}`, {
    data: { maxRiskPerTradePct: 2, defaultCommission: 1 },
  });
  expect(configResp.status()).toBe(200);

  // Initialize the account: opening balance + activation in one server-side
  // transaction (A2) — the trade creation API requires an active, funded account.
  const initResp = await page.request.post(`/api/accounts/${account.id}/initialize`, {
    data: { mode: 'opening_balance', amount: '50000.00' },
  });
  expect(initResp.status()).toBe(201);

  return account;
}

/**
 * Clear direction-related localStorage keys so each test starts clean.
 */
async function clearLocalStorage(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const keys = ['trades:direction', 'trades:fromDate', 'trades:toDate',
      'trades:open:visibility', 'trades:open:sorting', 'trades:open:order',
      'trades:closed:visibility', 'trades:closed:sorting', 'trades:closed:order',
      'trades:planned:visibility', 'trades:planned:sorting', 'trades:planned:order'];
    keys.forEach(k => localStorage.removeItem(k));
  });
}

test.describe('Direction filter', () => {
  test.describe.configure({ mode: 'serial' });

  test('All filter shows both long and short trades', async ({ page }) => {
    const account = await setupAccount(page, `S06-All-${TS}`);

    // Create one long planned trade
    const longRes = await page.request.post('/api/trades', {
      data: { symbol: `LONG${TS}`, direction: 'long', accountId: account.id },
    });
    expect(longRes.ok()).toBeTruthy();

    // Create one short planned trade
    const shortRes = await page.request.post('/api/trades', {
      data: { symbol: `SHRT${TS}`, direction: 'short', accountId: account.id },
    });
    expect(shortRes.ok()).toBeTruthy();

    await page.goto('/trades');
    await clearLocalStorage(page);

    // Switch to Planned tab
    await page.getByRole('tab', { name: /planned/i }).click();

    // Both trades should be visible with the 'All' (default) filter
    await expect(page.locator('tr').filter({ hasText: `LONG${TS}` }).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('tr').filter({ hasText: `SHRT${TS}` }).first()).toBeVisible({ timeout: 10_000 });
  });

  test('Long filter shows only long trades', async ({ page }) => {
    const account = await setupAccount(page, `S06-Long-${TS}`);

    // Create one long and one short planned trade
    const longRes = await page.request.post('/api/trades', {
      data: { symbol: `LONG${TS}`, direction: 'long', accountId: account.id },
    });
    expect(longRes.ok()).toBeTruthy();

    const shortRes = await page.request.post('/api/trades', {
      data: { symbol: `SHRT${TS}`, direction: 'short', accountId: account.id },
    });
    expect(shortRes.ok()).toBeTruthy();

    await page.goto('/trades');
    await clearLocalStorage(page);

    // Switch to Planned tab
    await page.getByRole('tab', { name: /planned/i }).click();
    await expect(page.locator('tr').filter({ hasText: `LONG${TS}` }).first()).toBeVisible({ timeout: 10_000 });

    // Open the direction filter dropdown and select "Long"
    await page.locator('#filter-direction').click();
    await page.getByRole('option', { name: /^long$/i }).click();

    // Wait for debounced re-fetch
    await page.waitForTimeout(1500);

    // Long trade should be visible
    await expect(page.locator('tr').filter({ hasText: `LONG${TS}` }).first()).toBeVisible({ timeout: 10_000 });
    // Short trade should NOT be visible
    await expect(page.locator('tr').filter({ hasText: `SHRT${TS}` })).not.toBeVisible();
  });

  test('Short filter shows only short trades', async ({ page }) => {
    const account = await setupAccount(page, `S06-Short-${TS}`);

    // Create one long and one short planned trade
    const longRes = await page.request.post('/api/trades', {
      data: { symbol: `LONG${TS}`, direction: 'long', accountId: account.id },
    });
    expect(longRes.ok()).toBeTruthy();

    const shortRes = await page.request.post('/api/trades', {
      data: { symbol: `SHRT${TS}`, direction: 'short', accountId: account.id },
    });
    expect(shortRes.ok()).toBeTruthy();

    await page.goto('/trades');
    await clearLocalStorage(page);

    // Switch to Planned tab
    await page.getByRole('tab', { name: /planned/i }).click();
    await expect(page.locator('tr').filter({ hasText: `SHRT${TS}` }).first()).toBeVisible({ timeout: 10_000 });

    // Open the direction filter dropdown and select "Short"
    await page.locator('#filter-direction').click();
    await page.getByRole('option', { name: /^short$/i }).click();

    // Wait for debounced re-fetch
    await page.waitForTimeout(1500);

    // Short trade should be visible
    await expect(page.locator('tr').filter({ hasText: `SHRT${TS}` }).first()).toBeVisible({ timeout: 10_000 });
    // Long trade should NOT be visible
    await expect(page.locator('tr').filter({ hasText: `LONG${TS}` })).not.toBeVisible();
  });

  test('direction filter persists on page reload', async ({ page }) => {
    const account = await setupAccount(page, `S06-Pers-${TS}`);

    // Create one long and one short planned trade
    const longRes = await page.request.post('/api/trades', {
      data: { symbol: `LONG${TS}`, direction: 'long', accountId: account.id },
    });
    expect(longRes.ok()).toBeTruthy();

    const shortRes = await page.request.post('/api/trades', {
      data: { symbol: `SHRT${TS}`, direction: 'short', accountId: account.id },
    });
    expect(shortRes.ok()).toBeTruthy();

    await page.goto('/trades');
    await clearLocalStorage(page);

    // Switch to Planned tab
    await page.getByRole('tab', { name: /planned/i }).click();
    await expect(page.locator('tr').filter({ hasText: `SHRT${TS}` }).first()).toBeVisible({ timeout: 10_000 });

    // Select Long filter
    await page.locator('#filter-direction').click();
    await page.getByRole('option', { name: /^long$/i }).click();

    // Wait for debounce
    await page.waitForTimeout(1500);

    // Verify Long filter is active
    await expect(page.locator('tr').filter({ hasText: `LONG${TS}` }).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('tr').filter({ hasText: `SHRT${TS}` })).not.toBeVisible();

    // Reload the page
    await page.reload();
    await page.waitForTimeout(1500);

    // Switch to Planned tab again
    await page.getByRole('tab', { name: /planned/i }).click();
    await page.waitForTimeout(1500);

    // After reload, the Long filter should still be active
    await expect(page.locator('tr').filter({ hasText: `LONG${TS}` }).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('tr').filter({ hasText: `SHRT${TS}` })).not.toBeVisible();
  });
});
