import { test, expect } from '@playwright/test';
import { prepareAccountForTrading } from './helpers/trading-account';

test.describe('Smoke tests — new M002 pages', () => {
  test('/sizing renders with Sizing heading', async ({ page }) => {
    await page.goto('/sizing');
    await expect(page.locator('h1')).toContainText('Sizing');
    // No JS errors should have occurred
  });

  test('/trades renders without crash', async ({ page }) => {
    await page.goto('/trades');
    await expect(page.locator('h1')).toContainText('Trades');
    // Page should load even with empty or populated trade list
  });

  test('/checks no longer renders the legacy page', async ({ page }) => {
    // M002 maintenance: the obsolete localStorage-backed legacy page was
    // removed; the canonical checklist system is DB-backed and untouched.
    const res = await page.goto('/checks');
    expect(res?.status()).toBe(404);
  });

  test('/trades/[id] renders trade detail with lifecycle stepper', async ({ page }) => {
    // Dynamically seed an account and trade to avoid test-DB dependency on a hardcoded ID
    const accRes = await page.request.post('/api/accounts', {
      data: { name: 'Smoke Test Account', isActive: true },
    });
    expect(accRes.ok()).toBeTruthy();
    const account = await accRes.json();
    await prepareAccountForTrading(page.request, account.id);

    const tradeRes = await page.request.post('/api/trades', {
      data: { symbol: 'AAPL', direction: 'long', accountId: account.id },
    });
    expect(tradeRes.ok()).toBeTruthy();
    const trade = await tradeRes.json();

    await page.goto(`/trades/${trade.id}`);
    // The heading should render the trade symbol (AAPL)
    await expect(page.locator('h1')).toContainText('AAPL');
    // Verify lifecycle status badge is present (the sibling after h1)
    await expect(page.locator('h1 + *')).toBeVisible();
  });
});
