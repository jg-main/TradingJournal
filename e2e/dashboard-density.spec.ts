import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 } });

test.describe('Risk & Positions document flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dev/workstation');
    await page.waitForLoadState('networkidle');
  });

  test('keeps curated panels horizontally contained and excludes Watchlist from the default', async ({ page }) => {
    for (const area of ['account-state', 'positions', 'risk', 'process-review', 'performance']) {
      const panel = page.getByTestId(`ws-panel-${area}`);
      await expect(panel).toBeVisible();
      const box = await panel.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(1440);
    }
    // Dense S02: the KPI band was removed from the workstation catalogue and
    // is not part of the document flow; period KPIs live in the Performance
    // panel stat rows. Watchlist is also excluded from the curated default.
    await expect(page.getByTestId('ws-panel-kpis')).toHaveCount(0);
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

  test('tabbed trades workspace renders tabs without nested scroll (M017/S03)', async ({ page }) => {
    // The full-width Trades workspace is a tabbed panel: Open positions /
    // Closed trades. Both tab labels render inside the ws-panel-positions
    // wrapper, and the tab content stays on the page scroll path — no
    // nested scrollbar inside the panel body.
    const trades = page.getByTestId('ws-panel-positions');
    await expect(trades.getByText('Trades Workspace')).toBeVisible();
    await expect(trades.getByTestId('ws-trades-tab-open')).toBeVisible();
    await expect(trades.getByTestId('ws-trades-tab-closed')).toBeVisible();

    // The panel body follows the document flow (overflow visible) with the
    // open table active by default.
    const body = trades.locator('.ws-panel-body').first();
    expect(await body.evaluate((element) => getComputedStyle(element).overflowY)).toBe('visible');
    await expect(trades.getByTestId('ws-positions-table')).toBeVisible();

    // Switching to Closed (fixture mode → API returns the empty universe)
    // keeps the same document-flow body: no nested scroll appears.
    await trades.getByTestId('ws-trades-tab-closed').click();
    await expect(page.getByTestId('ws-trades-closed-empty')).toBeVisible();
    const closedContent = page.getByTestId('ws-trades-closed-content');
    expect(await closedContent.evaluate((element) => getComputedStyle(element).overflowY)).toBe('visible');

    // The document still scrolls as one page.
    const dimensions = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  });
});
