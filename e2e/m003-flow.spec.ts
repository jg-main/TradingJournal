import { test, expect } from '@playwright/test';

test.describe('M003 cross-slice flow', () => {
  test('full flow: create trade + stop adjustment + external link + verify on detail page', async ({ page }) => {
    // ── Step 1: Create an account (needed for trade creation) ──────────────
    const accRes = await page.request.post('/api/accounts', {
      data: { name: 'M003 Flow Test Account', isActive: true },
    });
    expect(accRes.ok()).toBeTruthy();

    // ── Step 2: Create a trade ─────────────────────────────────────────────
    const tradeRes = await page.request.post('/api/trades', {
      data: { symbol: 'M003FLOW', direction: 'long' },
    });
    expect(tradeRes.ok()).toBeTruthy();
    const trade = await tradeRes.json();
    expect(trade.id).toBeDefined();
    expect(trade.symbol).toBe('M003FLOW');
    expect(trade.status).toBe('planned');
    console.log(`Created trade ${trade.id} (${trade.tradeCode})`);

    // ── Step 3: Navigate to trade detail page and verify lifecycle stepper ─
    await page.goto(`/trades/${trade.id}`);
    await page.waitForLoadState('networkidle');

    // The lifecycle stepper should be visible with step labels
    // Use exact match for stepper step labels — 'Plan' without 'ned', 'Exit' without 'ed', etc.
    await expect(page.getByText('Plan', { exact: true })).toBeVisible();
    await expect(page.getByText('Manage', { exact: true })).toBeVisible();
    await expect(page.getByText('Exit', { exact: true })).toBeVisible();
    // Grade step label (also visible)
    await expect(page.getByText('Grade', { exact: true })).toBeVisible();
    console.log('Lifecycle stepper visible with all step labels');

    // h1 should show the symbol
    await expect(page.locator('h1')).toContainText('M003FLOW');
    console.log('Trade detail page renders correctly');

    // ── Step 4: Execute the trade so it becomes 'open' ───────────────────────
    // PlannedPhaseView does not render stop adjustments; the trade must be open first
    const execRes = await page.request.post(`/api/trades/${trade.id}/executions`, {
      data: {
        action: 'buy',
        quantity: 100,
        price: 152.00,
        fees: 2.50,
      },
    });
    expect(execRes.ok()).toBeTruthy();
    const tAfter = await (await page.request.get(`/api/trades/${trade.id}`)).json();
    expect(tAfter.status).toBe('open');
    console.log(`Trade status after execution: ${tAfter.status}`);

    // ── Step 5: Add a stop adjustment via API ──────────────────────────────
    const adjRes = await page.request.post(`/api/trades/${trade.id}/stop-adjustments`, {
      data: {
        previousStop: 150.00,
        newStop: 155.50,
        reason: 'Earnings support level',
        notes: 'Moved stop above earnings support',
      },
    });
    expect(adjRes.ok()).toBeTruthy();
    const adjustment = await adjRes.json();
    expect(adjustment.id).toBeDefined();
    expect(adjustment.reason).toBe('Earnings support level');
    console.log(`Created stop adjustment ${adjustment.id}`);

    // ── Step 6: Navigate to trade detail and verify stop adjustment appears ─
    await page.goto(`/trades/${trade.id}`);
    await page.waitForLoadState('networkidle');

    // The stop adjustment should be visible somewhere on the page
    // TradeStopAdjustmentsCard renders the reason in a table cell for 'open' trades
    await expect(page.getByText('Earnings support level', { exact: false })).toBeVisible();
    console.log('Stop adjustment visible on trade detail page');

    // ── Step 6: Add an external link as an asset via API ───────────────────
    const assetRes = await page.request.post(`/api/trades/${trade.id}/assets`, {
      data: {
        assetType: 'link',
        phase: 'entry',
        externalUrl: 'https://example.com/m003-chart',
        label: 'M003 Reference Chart',
        notes: 'Key support/resistance levels',
      },
    });
    expect(assetRes.ok()).toBeTruthy();
    const asset = await assetRes.json();
    expect(asset.id).toBeDefined();
    expect(asset.externalUrl).toBe('https://example.com/m003-chart');
    console.log(`Created asset ${asset.id}`);

    // ── Step 7: Navigate to trade detail and verify asset gallery ──────────
    await page.goto(`/trades/${trade.id}`);
    await page.waitForLoadState('networkidle');

    // The asset label should be visible in the gallery section
    await expect(page.getByText('M003 Reference Chart', { exact: false })).toBeVisible();
    console.log('Asset label visible on trade detail page');

    // ── Step 8: Verify /checks page still renders correctly ────────────────
    await page.goto('/checks');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('h1')).toContainText('Checks & Validation');
    await expect(page.getByRole('button', { name: 'Pre-Trade Checklists' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Validation Rules' })).toBeVisible();
    console.log('/checks page renders correctly after cross-slice flow');

    console.log('FLOW_RESULT: PASS');
  });
});
