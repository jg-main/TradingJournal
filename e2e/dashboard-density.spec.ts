import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 } });

test.describe('Risk & Positions document flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dev/workstation');
    await page.waitForLoadState('networkidle');
  });

  test('keeps curated panels horizontally contained and excludes Watchlist from the default', async ({ page }) => {
    for (const area of ['kpis', 'account-state', 'positions', 'risk', 'process-review', 'performance']) {
      const panel = page.getByTestId(`ws-panel-${area}`);
      await expect(panel).toBeVisible();
      const box = await panel.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(1440);
    }
    await expect(page.getByTestId('ws-panel-watchlist')).toHaveCount(0);
  });

  test('uses the browser page rather than nested panel scrollbars', async ({ page }) => {
    const dimensions = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      height: document.documentElement.clientHeight,
      scrollHeight: document.documentElement.scrollHeight,
    }));

    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width);
    expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.height);

    for (const area of ['account-state', 'performance', 'positions', 'process-review']) {
      const body = page.getByTestId(`ws-panel-${area}`).locator('.ws-panel-body').first();
      await expect(body).toBeVisible();
      expect(await body.evaluate((element) => getComputedStyle(element).overflowY)).toBe('visible');
    }
  });

  test('uses dense internal rows and keeps retired dashboard controls absent', async ({ page }) => {
    const row = page.locator('.ws-risk-cell').first();
    await expect(row).toBeVisible();
    const box = await row.boundingBox();
    expect(box).not.toBeNull();
    // The risk band remains compact, but has enough vertical room for the
    // readable label/value pairing at the target desktop density.
    expect(box!.height).toBeLessThanOrEqual(88);

    await expect(page.getByTestId('view-switcher-trigger')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /customize dashboard/i })).toHaveCount(0);
  });
});
