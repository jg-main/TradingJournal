import { test, expect } from '@playwright/test';

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

  test('/checks renders the Checks & Validation heading', async ({ page }) => {
    await page.goto('/checks');
    await expect(page.locator('h1')).toContainText('Checks & Validation');
    // Verify the tab bar is present (checklists + validation rules tabs)
    await expect(page.getByRole('button', { name: 'Pre-Trade Checklists' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Validation Rules' })).toBeVisible();
  });

  test('/trades/[id] renders trade detail with lifecycle stepper', async ({ page }) => {
    // Dynamically seed an account and trade to avoid test-DB dependency on a hardcoded ID
    const accRes = await page.request.post('/api/accounts', {
      data: { name: 'Smoke Test Account', isActive: true },
    });
    expect(accRes.ok()).toBeTruthy();

    const tradeRes = await page.request.post('/api/trades', {
      data: { symbol: 'AAPL', direction: 'long' },
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
