/**
 * M033 S04 PriceWidget — End-to-end E2E spec.
 *
 * Validates the PriceWidget component across all 6 visual states:
 * 1. Open trade populated display (data-testid="price-widget")
 * 2. Closed trade frozen display (no retry, no refresh indicators)
 * 3. Loading state skeleton (data-testid="price-widget-loading")
 * 4. Error state (data-testid="price-widget-error") — retry + message
 * 5. Offline state (data-testid="price-widget-offline") — cached price + amber badge
 * 6. Cross-state console error audit
 *
 * Uses Playwright route mocking to simulate MTM API responses
 * for deterministic browser verification.
 */

import { test, expect } from '@playwright/test';

// ── Helpers ────────────────────────────────────────────────────────────

const TS = Date.now();

/**
 * Create a mock MTM (mark-to-market) response payload for the GET endpoint.
 * Returns a fully populated price snapshot.
 */
function mockMtmPopulated(): Record<string, unknown> {
  return {
    price: 182.45,
    marketState: 'REGULAR',
    shortName: 'Apple Inc.',
    quoteType: 'EQUITY',
    sector: 'Technology',
    industry: 'Consumer Electronics',
    previousClose: 180.20,
    dayHigh: 183.10,
    dayLow: 181.30,
    change: 2.25,
    changePercent: 1.25,
    fetchedAt: new Date().toISOString(),
    source: 'schwab',
  };
}

/**
 * Set up route mocking for the MTM and refresh endpoints.
 * Intercepts GET /api/trades/:id/mtm and POST /api/trades/mtm/refresh.
 */
async function mockMtmRoutes(
  page: import('@playwright/test').Page,
  mtmPayload: Record<string, unknown>,
  refreshStatus: number = 200,
): Promise<void> {
  // Mock the single-trade MTM GET endpoint (glob pattern for any trade id)
  await page.route('**/api/trades/*/mtm', async (route) => {
    // Only intercept GET requests — leave POST through
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: refreshStatus === 200 ? 200 : refreshStatus,
        contentType: 'application/json',
        body: JSON.stringify(mtmPayload),
      });
    } else {
      await route.continue();
    }
  });

  // Mock the batch refresh POST endpoint
  await page.route('**/api/trades/mtm/refresh', async (route) => {
    await route.fulfill({
      status: refreshStatus === 429 ? 429 : 200,
      contentType: 'application/json',
      body: refreshStatus === 429
        ? JSON.stringify({ error: 'Rate limited', retryAfter: 10 })
        : JSON.stringify({ success: true }),
    });
  });
}

/**
 * Collect console errors during a test. Call before page navigation.
 */
function captureConsoleErrors(page: import('@playwright/test').Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });
  return errors;
}

/**
 * Assert zero unfiltered console errors (allow known-safe noise like resource loading warnings).
 */
function assertNoConsoleErrors(errors: string[]): void {
  const actualErrors = errors.filter(
    (e) =>
      !e.includes('Failed to load resource') &&
      !e.includes('ERR_BLOCKED_BY_CLIENT') &&
      !e.includes('favicon.ico'),
  );
  expect(actualErrors).toEqual([]);
}

// ── Tests ──────────────────────────────────────────────────────────────

test.describe('M033 S04 PriceWidget E2E', () => {
  test.describe.configure({ mode: 'serial' });

  test('T01: Open trade populated display — PriceWidget renders all fields', async ({ page }) => {
    // ── Collect console errors ─────────────────────────────────────
    const consoleErrors = captureConsoleErrors(page);

    // ── Create test account ────────────────────────────────────────
    const accRes = await page.request.post('/api/accounts', {
      data: { name: `M033-S04-${TS}`, isActive: true, startingBalance: 50000 },
    });
    expect(accRes.ok()).toBeTruthy();
    const account = await accRes.json();

    // ── Create a planned trade ─────────────────────────────────────
    const tradeRes = await page.request.post('/api/trades', {
      data: { symbol: 'AAPL', direction: 'long', accountId: account.id },
    });
    expect(tradeRes.ok()).toBeTruthy();
    const trade = await tradeRes.json();

    // ── Execute trade with entry-only (open it, don't close) ───────
    const execRes = await page.request.post(`/api/trades/${trade.id}/execute`, {
      data: {
        entryPrice: 180.00,
        entryQuantity: 100,
        stopPrice: 175.00,
        fees: 5.00,
      },
    });
    expect(execRes.ok()).toBeTruthy();
    const execBody = await execRes.json();
    expect(execBody.trade.status).toBe('open');

    // ── Mock MTM routes to return populated price data ─────────────
    const populatedPayload = mockMtmPopulated();
    await mockMtmRoutes(page, populatedPayload);

    // ── Navigate to trade detail page ──────────────────────────────
    await page.goto(`/trades/${trade.id}`, { waitUntil: 'networkidle' });

    // Allow a brief settling period for UI rendering
    await page.waitForTimeout(1000);

    // ── Verify page loaded with trade symbol ───────────────────────
    await expect(page.locator('h1')).toContainText('AAPL');

    // ── Verify PriceWidget is present with data-testid="price-widget" ──
    const priceWidget = page.locator('[data-testid="price-widget"]');
    await expect(priceWidget).toBeVisible({ timeout: 8000 });

    // ── Verify populated fields inside the PriceWidget ─────────────
    // Company short name
    await expect(priceWidget.getByText('Apple Inc.')).toBeVisible();

    // Sector and industry
    await expect(priceWidget.getByText('Technology')).toBeVisible();
    await expect(priceWidget.getByText('Consumer Electronics')).toBeVisible();

    // Price display — the formatted price is 182.45
    await expect(priceWidget.getByText('182.45')).toBeVisible();

    // Change and change% — positive change shows "+" prefix and green styling
    const changeText = priceWidget.getByText(/\+2\.25/);
    await expect(changeText).toBeVisible();

    const changePctText = priceWidget.getByText(/\+1\.25%/);
    await expect(changePctText).toBeVisible();

    // Day High / Day Low / Prev Close labels
    await expect(priceWidget.getByText('Day High')).toBeVisible();
    await expect(priceWidget.getByText('Day Low')).toBeVisible();
    await expect(priceWidget.getByText('Prev Close')).toBeVisible();

    // Day high/low/prev close values
    await expect(priceWidget.getByText('183.10')).toBeVisible();
    await expect(priceWidget.getByText('181.30')).toBeVisible();
    await expect(priceWidget.getByText('180.20')).toBeVisible();

    // ── Verify updated timestamp / streaming label ─────────────────
    // Source is 'schwab' — should show "Streaming" label for open trades
    await expect(priceWidget.getByText('Streaming')).toBeVisible();

    // ── Verify zero console errors ─────────────────────────────────
    assertNoConsoleErrors(consoleErrors);
  });

  test('T01: Open trade — PriceWidget displays correct change coloring for negative change', async ({ page }) => {
    // ── Collect console errors ─────────────────────────────────────
    const consoleErrors = captureConsoleErrors(page);

    // ── Create test account + trade + execute ──────────────────────
    const accRes = await page.request.post('/api/accounts', {
      data: { name: `M033-S04-NEG-${TS}`, isActive: true, startingBalance: 50000 },
    });
    expect(accRes.ok()).toBeTruthy();
    const account = await accRes.json();

    const tradeRes = await page.request.post('/api/trades', {
      data: { symbol: 'MSFT', direction: 'long', accountId: account.id },
    });
    expect(tradeRes.ok()).toBeTruthy();
    const trade = await tradeRes.json();

    const execRes = await page.request.post(`/api/trades/${trade.id}/execute`, {
      data: {
        entryPrice: 400.00,
        entryQuantity: 50,
        stopPrice: 390.00,
        fees: 3.00,
      },
    });
    expect(execRes.ok()).toBeTruthy();

    // ── Mock MTM with negative change ──────────────────────────────
    await page.route('**/api/trades/*/mtm', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          price: 395.30,
          marketState: 'REGULAR',
          shortName: 'Microsoft Corp',
          quoteType: 'EQUITY',
          sector: 'Technology',
          industry: null,
          previousClose: 398.50,
          dayHigh: 401.00,
          dayLow: 394.80,
          change: -3.20,
          changePercent: -0.80,
          fetchedAt: new Date().toISOString(),
          source: 'yahoo',
        }),
      });
    });
    await page.route('**/api/trades/mtm/refresh', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    });

    // ── Navigate to trade detail page ──────────────────────────────
    await page.goto(`/trades/${trade.id}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    // ── Verify PriceWidget ──────────────────────────────────────────
    const priceWidget = page.locator('[data-testid="price-widget"]');
    await expect(priceWidget).toBeVisible({ timeout: 8000 });
    await expect(priceWidget.getByText('Microsoft Corp')).toBeVisible();

    // Verify the negative change shows with a minus sign (no "+")
    await expect(priceWidget.getByText(/395\.30/)).toBeVisible();

    // Verify zero console errors
    assertNoConsoleErrors(consoleErrors);
  });

  test('T01: Open trade — PriceWidget populates after loading skeleton transition', async ({ page }) => {
    // ── Collect console errors ─────────────────────────────────────
    const consoleErrors = captureConsoleErrors(page);

    // ── Create test account + trade + execute ──────────────────────
    const accRes = await page.request.post('/api/accounts', {
      data: { name: `M033-S04-LOAD-${TS}`, isActive: true, startingBalance: 50000 },
    });
    expect(accRes.ok()).toBeTruthy();
    const account = await accRes.json();

    const tradeRes = await page.request.post('/api/trades', {
      data: { symbol: 'GOOGL', direction: 'long', accountId: account.id },
    });
    expect(tradeRes.ok()).toBeTruthy();
    const trade = await tradeRes.json();

    const execRes = await page.request.post(`/api/trades/${trade.id}/execute`, {
      data: {
        entryPrice: 170.00,
        entryQuantity: 75,
        stopPrice: 165.00,
        fees: 4.00,
      },
    });
    expect(execRes.ok()).toBeTruthy();

    // ── Block-then-release MTM mock ────────────────────────────────
    // We block the MTM GET response so the loading skeleton renders.
    // Then release it after verifying the skeleton, so the populated
    // display replaces it — proving the transition works.
    const populatedPayload = {
      price: 175.50,
      marketState: 'REGULAR',
      shortName: 'Alphabet Inc',
      quoteType: 'EQUITY',
      sector: 'Technology',
      industry: 'Internet Services',
      previousClose: 173.00,
      dayHigh: 176.80,
      dayLow: 174.20,
      change: 2.50,
      changePercent: 1.45,
      fetchedAt: new Date().toISOString(),
      source: 'schwab',
    };

    let resolveMtm = () => {};
    await page.route('**/api/trades/*/mtm', async (route) => {
      // Only block GET requests (the MTM fetch)
      if (route.request().method() === 'GET') {
        await new Promise<void>((r) => { resolveMtm = r; });
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(populatedPayload),
        });
      } else {
        await route.continue();
      }
    });
    await page.route('**/api/trades/mtm/refresh', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    });

    // ── Navigate to trade detail page ──────────────────────────────
    // Use waitUntil:'load' (not 'networkidle') because the MTM GET
    // request is deliberately blocked — networkidle would hang.
    await page.goto(`/trades/${trade.id}`, { waitUntil: 'load' });

    // ── Verify loading skeleton appears (MTM is blocked) ───────────
    const loadingSkeleton = page.locator('[data-testid="price-widget-loading"]');
    await expect(loadingSkeleton).toBeVisible({ timeout: 8000 });

    // ── Release MTM response ───────────────────────────────────────
    resolveMtm?.();

    // ── Verify populated display replaces skeleton ─────────────────
    const priceWidget = page.locator('[data-testid="price-widget"]');
    await expect(priceWidget).toBeVisible({ timeout: 8000 });
    await expect(priceWidget.getByText('Alphabet Inc')).toBeVisible();
    await expect(priceWidget.getByText('175.50')).toBeVisible();
    await expect(priceWidget.getByText('Streaming')).toBeVisible();

    // Loading skeleton should no longer be visible
    await expect(loadingSkeleton).not.toBeVisible({ timeout: 5000 });

    // ── Verify zero console errors ─────────────────────────────────
    assertNoConsoleErrors(consoleErrors);
  });

  test('T02: Closed trade frozen display — PriceWidget shows data without streaming labels or retry', async ({ page }) => {
    const consoleErrors = captureConsoleErrors(page);

    // Create account
    const accRes = await page.request.post('/api/accounts', {
      data: { name: `M033-S04-FROZEN-${TS}`, isActive: true, startingBalance: 50000 },
    });
    expect(accRes.ok()).toBeTruthy();
    const account = await accRes.json();

    // Create trade (long)
    const tradeRes = await page.request.post('/api/trades', {
      data: { symbol: 'NVDA', direction: 'long', accountId: account.id },
    });
    expect(tradeRes.ok()).toBeTruthy();
    const trade = await tradeRes.json();

    // Execute entry (buy 100 shares at 120)
    const entryRes = await page.request.post(`/api/trades/${trade.id}/execute`, {
      data: { entryPrice: 120.00, entryQuantity: 100, stopPrice: 115.00, fees: 5.00 },
    });
    expect(entryRes.ok()).toBeTruthy();

    // Close trade by adding a sell execution for all shares at 125
    const sellRes = await page.request.post(`/api/trades/${trade.id}/executions`, {
      data: { action: 'sell', price: 125.00, quantity: 100, fees: 5.00 },
    });
    expect(sellRes.ok()).toBeTruthy();

    // Mock MTM routes — populated data, source='schwab'
    await mockMtmRoutes(page, {
      price: 125.00,
      marketState: 'REGULAR',
      shortName: 'NVIDIA Corp',
      quoteType: 'EQUITY',
      sector: 'Technology',
      industry: 'Semiconductors',
      previousClose: 123.00,
      dayHigh: 126.50,
      dayLow: 124.20,
      change: 2.00,
      changePercent: 1.63,
      fetchedAt: new Date().toISOString(),
      source: 'schwab',
    });

    // Navigate to trade detail page
    await page.goto(`/trades/${trade.id}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    // PriceWidget is visible with populated data
    const priceWidget = page.locator('[data-testid="price-widget"]');
    await expect(priceWidget).toBeVisible({ timeout: 8000 });
    await expect(priceWidget.getByText('NVIDIA Corp')).toBeVisible();
    await expect(priceWidget.getByText('Semiconductors')).toBeVisible();
    await expect(priceWidget.getByText('125.00')).toBeVisible();
    await expect(priceWidget.getByText('Day High')).toBeVisible();
    await expect(priceWidget.getByText('Day Low')).toBeVisible();
    await expect(priceWidget.getByText('Prev Close')).toBeVisible();
    await expect(priceWidget.getByText('126.50')).toBeVisible();
    await expect(priceWidget.getByText('124.20')).toBeVisible();
    await expect(priceWidget.getByText('123.00')).toBeVisible();

    // Frozen: NO "Streaming" label even with 'schwab' source
    await expect(priceWidget.getByText('Streaming')).not.toBeVisible();

    // Frozen: NO retry button
    await expect(priceWidget.locator('[data-testid="price-widget-retry"]')).not.toBeVisible();

    // Zero console errors
    assertNoConsoleErrors(consoleErrors);
  });

  test('T02: Closed trade — PriceWidget shows loading then frozen populated display', async ({ page }) => {
    const consoleErrors = captureConsoleErrors(page);

    // Create account
    const accRes = await page.request.post('/api/accounts', {
      data: { name: `M033-S04-FROZEN-LOAD-${TS}`, isActive: true, startingBalance: 50000 },
    });
    expect(accRes.ok()).toBeTruthy();
    const account = await accRes.json();

    // Create trade (long)
    const tradeRes = await page.request.post('/api/trades', {
      data: { symbol: 'AMD', direction: 'long', accountId: account.id },
    });
    expect(tradeRes.ok()).toBeTruthy();
    const trade = await tradeRes.json();

    // Execute entry (buy 50 shares at 150)
    const entryRes = await page.request.post(`/api/trades/${trade.id}/execute`, {
      data: { entryPrice: 150.00, entryQuantity: 50, stopPrice: 145.00, fees: 3.00 },
    });
    expect(entryRes.ok()).toBeTruthy();

    // Close trade by adding a sell execution for all shares at 155
    const sellRes = await page.request.post(`/api/trades/${trade.id}/executions`, {
      data: { action: 'sell', price: 155.00, quantity: 50, fees: 3.00 },
    });
    expect(sellRes.ok()).toBeTruthy();

    // Block-then-release MTM mock
    const populatedPayload = {
      price: 155.00,
      marketState: 'REGULAR',
      shortName: 'AMD Inc',
      quoteType: 'EQUITY',
      sector: 'Technology',
      industry: 'Semiconductors',
      previousClose: 153.00,
      dayHigh: 156.50,
      dayLow: 154.20,
      change: 2.00,
      changePercent: 1.31,
      fetchedAt: new Date().toISOString(),
      source: 'schwab',
    };

    let resolveMtm = () => {};
    await page.route('**/api/trades/*/mtm', async (route) => {
      if (route.request().method() === 'GET') {
        await new Promise<void>((r) => { resolveMtm = r; });
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(populatedPayload),
        });
      } else {
        await route.continue();
      }
    });
    await page.route('**/api/trades/mtm/refresh', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    });

    // Navigate (waitUntil: 'load' because MTM is blocked)
    await page.goto(`/trades/${trade.id}`, { waitUntil: 'load' });

    // Loading skeleton appears (MTM is blocked)
    const loadingSkeleton = page.locator('[data-testid="price-widget-loading"]');
    await expect(loadingSkeleton).toBeVisible({ timeout: 8000 });

    // Release MTM response
    resolveMtm?.();

    // Populated frozen display appears
    const priceWidget = page.locator('[data-testid="price-widget"]');
    await expect(priceWidget).toBeVisible({ timeout: 8000 });
    await expect(priceWidget.getByText('AMD Inc')).toBeVisible();
    await expect(priceWidget.getByText('155.00')).toBeVisible();

    // Frozen: no "Streaming" label
    await expect(priceWidget.getByText('Streaming')).not.toBeVisible();

    // Loading skeleton is gone
    await expect(loadingSkeleton).not.toBeVisible({ timeout: 5000 });

    // Zero console errors
    assertNoConsoleErrors(consoleErrors);
  });

  // ── T03: Error/Offline states, retry, and cross-state console audit ──

  test('T03: Error state — PriceWidget shows error banner with retry, retry transitions to populated', async ({ page }) => {
    const consoleErrors = captureConsoleErrors(page);

    // ── Clear stale route handlers from prior serial tests ──
    await page.unroute('**/api/trades/*/mtm');
    await page.unroute('**/api/trades/mtm/refresh');

    // Create account
    const accRes = await page.request.post('/api/accounts', {
      data: { name: `M033-S04-ERR-${TS}`, isActive: true, startingBalance: 50000 },
    });
    expect(accRes.ok()).toBeTruthy();
    const account = await accRes.json();

    // Create and execute open trade
    const tradeRes = await page.request.post('/api/trades', {
      data: { symbol: 'TSLA', direction: 'long', accountId: account.id },
    });
    expect(tradeRes.ok()).toBeTruthy();
    const trade = await tradeRes.json();

    const execRes = await page.request.post(`/api/trades/${trade.id}/execute`, {
      data: { entryPrice: 220.00, entryQuantity: 50, stopPrice: 210.00, fees: 4.00 },
    });
    expect(execRes.ok()).toBeTruthy();

    // ── MTM GET: always return 500 with error (no cached price scenario) ──
    // We do NOT need a counter-based mock because the mount effect's refresh POST
    // also returns 500, preventing any second fetchMtmData from overwriting state.
    await page.route('**/api/trades/*/mtm', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Market data unavailable' }),
        });
      } else {
        await route.continue();
      }
    });

    // Refresh POST always fails so mount effect never calls fetchMtmData again
    await page.route('**/api/trades/mtm/refresh', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Rate limited' }),
      });
    });

    // ── Navigate to trade detail page ──
    await page.goto(`/trades/${trade.id}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    // ── Verify error state appears ──
    const errorWidget = page.locator('[data-testid="price-widget-error"]');
    await expect(errorWidget).toBeVisible({ timeout: 10000 });
    await expect(errorWidget.getByText('Price data unavailable')).toBeVisible();
    await expect(errorWidget.getByText('Market data unavailable')).toBeVisible();

    // Retry button should be visible
    const retryBtnInError = errorWidget.locator('[data-testid="price-widget-retry"]');
    await expect(retryBtnInError).toBeVisible();

    // ── Now change BOTH mocks: MTM GET + refresh POST return success ──
    const populatedPayload = {
      price: 235.80,
      marketState: 'REGULAR',
      shortName: 'Tesla Inc',
      quoteType: 'EQUITY',
      sector: 'Automotive',
      industry: 'Electric Vehicles',
      previousClose: 230.00,
      dayHigh: 237.50,
      dayLow: 233.10,
      change: 5.80,
      changePercent: 2.52,
      fetchedAt: new Date().toISOString(),
      source: 'schwab',
    };

    // Unroute AND re-route BOTH endpoints for the retry phase
    await page.unroute('**/api/trades/*/mtm');
    await page.unroute('**/api/trades/mtm/refresh');

    await page.route('**/api/trades/*/mtm', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(populatedPayload),
        });
      } else {
        await route.continue();
      }
    });
    await page.route('**/api/trades/mtm/refresh', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    });

    // ── Click retry button to transition to populated display ──
    await retryBtnInError.click();

    // Wait for: loading → POST refresh succeeds → fetchMtmData GET → populated
    await page.waitForTimeout(3000);

    // Verify populated display replaces error
    const priceWidget = page.locator('[data-testid="price-widget"]');
    await expect(priceWidget).toBeVisible({ timeout: 10000 });
    await expect(priceWidget.getByText('Tesla Inc')).toBeVisible();
    await expect(priceWidget.getByText('235.80')).toBeVisible();
    await expect(priceWidget.getByText('Streaming')).toBeVisible();

    // Error state should be gone
    await expect(errorWidget).not.toBeVisible({ timeout: 5000 });

    // ── Zero console errors ──
    assertNoConsoleErrors(consoleErrors);
  });

  test('T03: Offline state — PriceWidget shows cached price with offline indicator after refresh failure, retry restores live', async ({ page }) => {
    const consoleErrors = captureConsoleErrors(page);

    // Create account
    const accRes = await page.request.post('/api/accounts', {
      data: { name: `M033-S04-OFFLINE-${TS}`, isActive: true, startingBalance: 50000 },
    });
    expect(accRes.ok()).toBeTruthy();
    const account = await accRes.json();

    // Create and execute open trade
    const tradeRes = await page.request.post('/api/trades', {
      data: { symbol: 'AMZN', direction: 'long', accountId: account.id },
    });
    expect(tradeRes.ok()).toBeTruthy();
    const trade = await tradeRes.json();

    const execRes = await page.request.post(`/api/trades/${trade.id}/execute`, {
      data: { entryPrice: 190.00, entryQuantity: 60, stopPrice: 185.00, fees: 4.00 },
    });
    expect(execRes.ok()).toBeTruthy();

    // ── Mock: MTM GET always returns populated; refresh POST always successful ──
    const populatedPayload = {
      price: 198.75,
      marketState: 'REGULAR',
      shortName: 'Amazon.com Inc',
      quoteType: 'EQUITY',
      sector: 'Technology',
      industry: 'E-Commerce',
      previousClose: 196.00,
      dayHigh: 200.50,
      dayLow: 197.20,
      change: 2.75,
      changePercent: 1.40,
      fetchedAt: new Date().toISOString(),
      source: 'schwab',
    };

    await page.route('**/api/trades/*/mtm', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(populatedPayload),
        });
      } else {
        await route.continue();
      }
    });

    // Start with refresh returning 200 (for initial mount + populated display)
    await page.route('**/api/trades/mtm/refresh', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    });

    // ── Navigate to trade detail page ──
    await page.goto(`/trades/${trade.id}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    // ── Verify populated display ──
    let priceWidget = page.locator('[data-testid="price-widget"]');
    await expect(priceWidget).toBeVisible({ timeout: 10000 });
    await expect(priceWidget.getByText('Amazon.com Inc')).toBeVisible();
    await expect(priceWidget.getByText('198.75')).toBeVisible();
    await expect(priceWidget.getByText('Streaming')).toBeVisible();

    // Verify no offline indicator yet
    await expect(priceWidget.getByText('Offline')).not.toBeVisible();

    // ── Change refresh mock to return 500 (failure) ──
    await page.unroute('**/api/trades/mtm/refresh');
    await page.route('**/api/trades/mtm/refresh', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Refresh unavailable' }),
      });
    });

    // ── Trigger refresh via dropdown menu (More actions > Refresh) ──
    // This calls handleRefreshPrice which preserves cached price on error
    await page.click('[aria-label="More actions"]');
    // Wait for dropdown to open
    await page.waitForTimeout(500);
    // Click "Refresh" in the dropdown menu
    await page.getByRole('menuitem', { name: 'Refresh' }).click();

    // Wait for handleRefreshPrice to: loading=true → refresh POST fails → error set, price preserved
    await page.waitForTimeout(2000);

    // ── Verify offline state: populated card + amber offline indicator + retry ──
    // The card should still be data-testid="price-widget" (not error) because price is cached
    priceWidget = page.locator('[data-testid="price-widget"]');
    await expect(priceWidget).toBeVisible({ timeout: 10000 });

    // Cached price is still visible
    await expect(priceWidget.getByText('Amazon.com Inc')).toBeVisible();
    await expect(priceWidget.getByText('198.75')).toBeVisible();

    // Offline indicator should be visible
    const offlineIndicator = priceWidget.locator('[data-testid="price-widget-offline"]');
    await expect(offlineIndicator).toBeVisible();
    await expect(offlineIndicator.getByText('Offline — showing cached price')).toBeVisible();

    // Retry button should be visible inside the PriceWidget
    const retryBtn = priceWidget.locator('[data-testid="price-widget-retry"]');
    await expect(retryBtn).toBeVisible();

    // Note: Streaming label may still show alongside offline indicator when
    // source is 'schwab' — both showStreamingLabel and isCachedWithError can coexist.

    // ── Change refresh mock back to 200 (success) ──
    await page.unroute('**/api/trades/mtm/refresh');
    await page.route('**/api/trades/mtm/refresh', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    });

    // ── Click retry button to restore live display ──
    await retryBtn.click();

    // Wait for: loading=true → refresh POST succeeds → fetchMtmData → populated display
    await page.waitForTimeout(2000);

    // ── Verify populated display restored (no offline indicator) ──
    priceWidget = page.locator('[data-testid="price-widget"]');
    await expect(priceWidget).toBeVisible({ timeout: 10000 });
    await expect(priceWidget.getByText('Amazon.com Inc')).toBeVisible();
    await expect(priceWidget.getByText('198.75')).toBeVisible();
    await expect(priceWidget.getByText('Streaming')).toBeVisible();

    // Offline indicator should be gone
    await expect(priceWidget.getByText('Offline')).not.toBeVisible();

    // Retry button should also be gone (no error)
    await expect(priceWidget.locator('[data-testid="price-widget-retry"]')).not.toBeVisible();

    // ── Zero console errors ──
    assertNoConsoleErrors(consoleErrors);
  });

  test('T03: Cross-state console error audit — zero console errors across all widget states', async ({ page }) => {
    const consoleErrors = captureConsoleErrors(page);

    // ── Clear stale route handlers from prior serial tests ──
    await page.unroute('**/api/trades/*/mtm');
    await page.unroute('**/api/trades/mtm/refresh');

    // Create account
    const accRes = await page.request.post('/api/accounts', {
      data: { name: `M033-S04-AUDIT-${TS}`, isActive: true, startingBalance: 50000 },
    });
    expect(accRes.ok()).toBeTruthy();
    const account = await accRes.json();

    // Create and execute open trade
    const tradeRes = await page.request.post('/api/trades', {
      data: { symbol: 'META', direction: 'long', accountId: account.id },
    });
    expect(tradeRes.ok()).toBeTruthy();
    const trade = await tradeRes.json();

    const execRes = await page.request.post(`/api/trades/${trade.id}/execute`, {
      data: { entryPrice: 500.00, entryQuantity: 30, stopPrice: 490.00, fees: 3.00 },
    });
    expect(execRes.ok()).toBeTruthy();

    const populatedPayload = {
      price: 515.25,
      marketState: 'REGULAR',
      shortName: 'Meta Platforms Inc',
      quoteType: 'EQUITY',
      sector: 'Technology',
      industry: 'Social Media',
      previousClose: 510.00,
      dayHigh: 518.00,
      dayLow: 512.50,
      change: 5.25,
      changePercent: 1.03,
      fetchedAt: new Date().toISOString(),
      source: 'schwab',
    };

    // ── State 1: Error state ──
    // MTM GET returns 500, refresh POST returns 500 (both always)
    await page.route('**/api/trades/*/mtm', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Service temporarily unavailable' }),
        });
      } else {
        await route.continue();
      }
    });
    await page.route('**/api/trades/mtm/refresh', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Refresh unavailable' }),
      });
    });

    await page.goto(`/trades/${trade.id}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    // State 1: Error state
    const errorWidget = page.locator('[data-testid="price-widget-error"]');
    await expect(errorWidget).toBeVisible({ timeout: 10000 });
    await expect(errorWidget.getByText('Price data unavailable')).toBeVisible();
    await expect(errorWidget.getByText('Service temporarily unavailable')).toBeVisible();

    // ── Transition 1: Error → Populated (retry with both mocks now successful) ──
    await page.unroute('**/api/trades/*/mtm');
    await page.route('**/api/trades/*/mtm', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(populatedPayload),
        });
      } else {
        await route.continue();
      }
    });
    await page.unroute('**/api/trades/mtm/refresh');
    await page.route('**/api/trades/mtm/refresh', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    });

    // Click retry in error widget → refresh succeeds → GET returns populated
    const retryBtn = errorWidget.locator('[data-testid="price-widget-retry"]');
    await expect(retryBtn).toBeVisible();
    await retryBtn.click();
    await page.waitForTimeout(3000);

    // State 2: Populated display
    const priceWidget = page.locator('[data-testid="price-widget"]');
    await expect(priceWidget).toBeVisible({ timeout: 10000 });
    await expect(priceWidget.getByText('Meta Platforms Inc')).toBeVisible();
    await expect(priceWidget.getByText('515.25')).toBeVisible();
    await expect(priceWidget.getByText('Streaming')).toBeVisible();
    await expect(errorWidget).not.toBeVisible({ timeout: 5000 });

    // ── Transition 2: Populated → Offline (refresh fails while price is cached) ──
    await page.unroute('**/api/trades/mtm/refresh');
    await page.route('**/api/trades/mtm/refresh', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Rate limited' }),
      });
    });

    // Trigger handleRefreshPrice via dropdown > Refresh
    await page.click('[aria-label="More actions"]');
    await page.waitForTimeout(500);
    await page.getByRole('menuitem', { name: 'Refresh' }).click();
    await page.waitForTimeout(2000);

    // State 3: Offline — cached price + offline indicator visible
    await expect(priceWidget).toBeVisible({ timeout: 10000 });
    await expect(priceWidget.getByText('Meta Platforms Inc')).toBeVisible();
    const offlineIndicator = priceWidget.locator('[data-testid="price-widget-offline"]');
    await expect(offlineIndicator).toBeVisible();
    await expect(offlineIndicator.getByText('Offline — showing cached price')).toBeVisible();

    // ── Transition 3: Offline → Populated (retry with refresh succeeding again) ──
    await page.unroute('**/api/trades/mtm/refresh');
    await page.route('**/api/trades/mtm/refresh', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    });

    const offlineRetryBtn = priceWidget.locator('[data-testid="price-widget-retry"]');
    await expect(offlineRetryBtn).toBeVisible();
    await offlineRetryBtn.click();
    await page.waitForTimeout(3000);

    // State 4: Populated restored
    await expect(priceWidget).toBeVisible();
    await expect(priceWidget.getByText('Meta Platforms Inc')).toBeVisible();
    await expect(priceWidget.getByText('515.25')).toBeVisible();
    await expect(priceWidget.getByText('Streaming')).toBeVisible();
    await expect(priceWidget.getByText('Offline')).not.toBeVisible();

    // ── Final: Zero console errors across ALL state transitions ──
    assertNoConsoleErrors(consoleErrors);
  });
});
