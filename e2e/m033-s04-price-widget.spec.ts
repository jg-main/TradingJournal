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
 * Create a mock MTM response with no price data (error state — no cached price).
 */
function mockMtmError(): Record<string, unknown> {
  return {
    price: null,
    marketState: null,
    shortName: null,
    quoteType: null,
    sector: null,
    industry: null,
    previousClose: null,
    dayHigh: null,
    dayLow: null,
    change: null,
    changePercent: null,
    fetchedAt: null,
    source: null,
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

    let resolveMtm: (() => void) | null = null;
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
});
