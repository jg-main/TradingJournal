import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 } });

test.describe('Production workstation density', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('keeps every core panel inside the first 1440x900 viewport', async ({ page }) => {
    for (const area of ['kpis', 'equity', 'positions', 'watchlist', 'risk', 'insights']) {
      const panel = page.getByTestId(`ws-panel-${area}`);
      await expect(panel).toBeVisible();
      const box = await panel.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(1440);
      expect(box!.y + box!.height).toBeLessThanOrEqual(900);
    }
  });

  test('does not introduce page-level scrolling', async ({ page }) => {
    const dimensions = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      height: document.documentElement.clientHeight,
      scrollHeight: document.documentElement.scrollHeight,
    }));

    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width);
    expect(dimensions.scrollHeight).toBeLessThanOrEqual(dimensions.height);
  });

  test('uses dense internal rows and keeps retired dashboard controls absent', async ({ page }) => {
    const row = page.locator('.ws-stat-row').first();
    await expect(row).toBeVisible();
    const box = await row.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeLessThanOrEqual(28);

    await expect(page.getByTestId('view-switcher-trigger')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /customize dashboard/i })).toHaveCount(0);
  });
});
