import { expect, test } from '@playwright/test';
import { prepareAccountForTrading } from './helpers/trading-account';

/**
 * The active trade workstation is intentionally verified through the public
 * API and browser rather than the user journal. Playwright owns a disposable
 * database for this invocation (see playwright.config.ts).
 */
test.describe('Active trade detail management layout', () => {
  test('keeps management controls in their owning panels on the wide grid', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1600, height: 1200 });

    const accountResponse = await page.request.post('/api/accounts', {
      data: { name: `Trade detail layout ${Date.now()}`, currency: 'USD' },
    });
    expect(accountResponse.status()).toBe(201);
    const account = await accountResponse.json();
    await prepareAccountForTrading(page.request, account.id);

    const tradeResponse = await page.request.post('/api/trades', {
      data: {
        symbol: 'LAYOUT',
        direction: 'long',
        accountId: account.id,
        thesis: 'Initial thesis for the management layout.',
        invalidationCondition: 'Exit below the opening-range low.',
        preTradePlan: 'Enter only after confirmation and respect the stop.',
      },
    });
    expect(tradeResponse.status()).toBe(201);
    const trade = await tradeResponse.json();

    const executeResponse = await page.request.post(`/api/trades/${trade.id}/execute`, {
      data: {
        entryPrice: 100,
        entryQuantity: 10,
        stopPrice: 95,
        target1Price: 110,
        fees: 1,
      },
    });
    expect(executeResponse.status()).toBe(201);

    const assetResponse = await page.request.post(`/api/trades/${trade.id}/assets`, {
      data: {
        assetType: 'link',
        phase: 'management',
        label: 'Management chart',
        externalUrl: 'https://example.com/management-chart',
      },
    });
    expect(assetResponse.status()).toBe(201);

    await page.route('**/api/trades/*/mtm', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          price: 102,
          marketState: 'REGULAR',
          shortName: 'Layout Test Co.',
          previousClose: 101,
          dayHigh: 103,
          dayLow: 99,
          change: 1,
          changePercent: 0.99,
          fetchedAt: new Date().toISOString(),
          source: 'test',
        }),
      });
    });

    await page.goto(`/trades/${trade.id}`, { waitUntil: 'networkidle' });
    await expect(page.locator('h1')).toHaveText('LAYOUT');

    const grid = page.locator('.td-grid');
    await expect(grid).toHaveClass('td-grid');
    await expect(grid).not.toHaveClass(/td-grid--(?:planned|closed)/);
    const gridInfo = await grid.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        areas: style.gridTemplateAreas.replace(/\s+/g, ' ').trim(),
        columns: style.gridTemplateColumns.split(' ').length,
      };
    });
    expect(gridInfo.areas).toBe(
      '"lifecycle lifecycle lifecycle" "main main right"',
    );
    expect(gridInfo.columns).toBe(3);

    const primaryWorkspace = page.locator('.td-grid-main');
    const primaryInfo = await primaryWorkspace.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        areas: style.gridTemplateAreas.replace(/\s+/g, ' ').trim(),
        columns: style.gridTemplateColumns.split(' ').length,
      };
    });
    expect(primaryInfo.areas).toBe('"left details" "assets assets"');
    expect(primaryInfo.columns).toBe(2);

    const panelAreas = await page.locator('.td-panel').evaluateAll((panels) =>
      panels.map((panel) => panel.getAttribute('data-area')),
    );
    expect(panelAreas).toEqual([
      'lifecycle',
      'cockpit',
      'context',
      'details',
      'history',
      'assets',
      'risk',
      'review',
    ]);

    const panelBounds = await Promise.all(
      ['cockpit', 'context', 'details', 'history', 'risk', 'review'].map(async (area) => [
        area,
        await page.locator(`.td-panel[data-area="${area}"]`).boundingBox(),
      ] as const),
    );
    const bounds = Object.fromEntries(panelBounds) as Record<string, { y: number; height: number } | null>;
    for (const [top, bottom] of [['cockpit', 'context'], ['details', 'history'], ['risk', 'review']] as const) {
      expect(bounds[top]).not.toBeNull();
      expect(bounds[bottom]).not.toBeNull();
      const verticalGap = bounds[bottom]!.y - (bounds[top]!.y + bounds[top]!.height);
      expect(verticalGap).toBeGreaterThanOrEqual(5);
      expect(verticalGap).toBeLessThanOrEqual(7);
    }

    const columnBounds = await Promise.all(
      ['left', 'details', 'right'].map(async (area) => [
        area,
        await page.locator(`.td-grid-column[data-area="${area}"]`).boundingBox(),
      ] as const),
    );
    const columns = Object.fromEntries(columnBounds) as Record<string, { width: number } | null>;
    for (const [column, panels] of [
      ['left', ['cockpit', 'context']],
      ['details', ['details', 'history']],
      ['right', ['risk', 'review']],
    ] as const) {
      expect(columns[column]).not.toBeNull();
      for (const panel of panels) {
        const panelBox = await page.locator(`.td-panel[data-area="${panel}"]`).boundingBox();
        expect(panelBox).not.toBeNull();
        expect(Math.abs(panelBox!.width - columns[column]!.width)).toBeLessThanOrEqual(1);
      }
    }

    const cockpit = page.locator('.td-panel[data-area="cockpit"]');
    const details = page.locator('.td-panel[data-area="details"]');
    const context = page.locator('.td-panel[data-area="context"]');
    const assets = page.locator('.td-panel[data-area="assets"]');

    const assetBox = await assets.boundingBox();
    const leftBox = await page.locator('.td-grid-column[data-area="left"]').boundingBox();
    const detailsBox = await page.locator('.td-grid-column[data-area="details"]').boundingBox();
    expect(assetBox).not.toBeNull();
    expect(leftBox).not.toBeNull();
    expect(detailsBox).not.toBeNull();
    expect(Math.abs(assetBox!.x - leftBox!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs((assetBox!.x + assetBox!.width) - (detailsBox!.x + detailsBox!.width))).toBeLessThanOrEqual(1);
    expect(assetBox!.y).toBeGreaterThanOrEqual(Math.max(
      bounds.context!.y + bounds.context!.height,
      bounds.history!.y + bounds.history!.height,
    ) + 5);

    await expect(cockpit.getByRole('button', { name: /add exit/i })).toHaveCount(0);
    await expect(details.getByRole('button', { name: 'Add Fill' })).toBeVisible();
    await expect(details.getByText('Side', { exact: true })).toBeVisible();
    await expect(details.getByText('Avg Entry', { exact: true })).toBeVisible();
    await expect(details.getByText('Open Size', { exact: true })).toBeVisible();
    await expect(details.getByText('Target 1', { exact: true })).toHaveCount(0);
    await expect(details.getByRole('button', { name: 'Adjust Stop' })).toBeVisible();
    await expect(details.getByRole('button', { name: 'Adjust Target' })).toBeVisible();
    await expect(assets.getByText('Assets', { exact: true })).toBeVisible();

    await context.getByRole('button', { name: 'Edit Thesis' }).click();
    const thesisEditor = context.locator('textarea').first();
    await thesisEditor.fill('Updated thesis is saved from Context.');
    await context.getByRole('button', { name: 'Save' }).click();
    await expect(thesisEditor).toHaveCount(0);
    await expect(context.getByText('Updated thesis is saved from Context.')).toBeVisible();

    await page.screenshot({
      path: testInfo.outputPath('active-trade-management-layout.png'),
      fullPage: true,
    });
    await testInfo.attach('active-trade-management-layout', {
      path: testInfo.outputPath('active-trade-management-layout.png'),
      contentType: 'image/png',
    });
  });
});
