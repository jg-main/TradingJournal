import { test, expect } from '@playwright/test';

const KNOWN_TRADE_ID = 'de87857a-03c5-4617-97ab-39a529989772';

test.describe('Smoke tests — new M002 pages', () => {
  test('/sizing renders with Position Sizing heading', async ({ page }) => {
    await page.goto('/sizing');
    await expect(page.locator('h1')).toContainText('Position Sizing');
    // No JS errors should have occurred
  });

  test('/trades renders without crash', async ({ page }) => {
    await page.goto('/trades');
    await expect(page.locator('h1')).toContainText('Trade Log');
    // Page should load even with empty or populated trade list
  });

  test('/trades/[id] renders trade detail for a known trade', async ({ page }) => {
    await page.goto(`/trades/${KNOWN_TRADE_ID}`);
    // The heading should render the trade symbol (AAPL)
    await expect(page.locator('h1')).toContainText('AAPL');
    // Verify lifecycle status badge is present
    await expect(page.locator('h1 + *')).toBeVisible();
  });
});
