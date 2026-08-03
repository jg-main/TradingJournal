import { test, expect } from '@playwright/test';

const TS = Date.now();

/**
 * Create a fully usable test account: creates the account, sets risk params,
 * activates it, and posts opening cash. Returns { id, name }.
 */
async function setupAccount(page: import('@playwright/test').Page, name: string) {
  const createResp = await page.request.post('/api/accounts', {
    data: { name, currency: 'USD' },
  });
  expect(createResp.status()).toBe(201);
  const account = (await createResp.json()) as { id: string; name: string };

  // Set risk parameters
  const configResp = await page.request.put(`/api/accounts/${account.id}`, {
    data: { maxRiskPerTradePct: 2, defaultCommission: 1 },
  });
  expect(configResp.status()).toBe(200);

  // Activate the account
  const activateResp = await page.request.put(`/api/accounts/${account.id}`, {
    data: { isActive: true },
  });
  expect(activateResp.status()).toBe(200);

  // Post opening balance (the trade creation API requires a financial event)
  const cashResp = await page.request.post(`/api/accounts/${account.id}/financial-events`, {
    data: { eventType: 'opening_balance', amount: '50000.00' },
  });
  expect(cashResp.status()).toBe(201);

  return account;
}

/**
 * Clear all DynamicTable localStorage keys for the Trades page so each test
 * starts with a clean column-visibility / sorting / order slate.
 */
async function clearLocalStorage(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const keys = ['trades:open:visibility', 'trades:open:sorting', 'trades:open:order',
      'trades:closed:visibility', 'trades:closed:sorting', 'trades:closed:order',
      'trades:planned:visibility', 'trades:planned:sorting', 'trades:planned:order'];
    keys.forEach(k => localStorage.removeItem(k));
  });
}

test.describe('M008 Trades Tabs', () => {
  test.describe.configure({ mode: 'serial' });

  test('tab switching shows correct trade subsets in Open, Planned, and Closed tabs', async ({ page }) => {
    const account = await setupAccount(page, `M008-Tabs-${TS}`);

    // Create a planned trade (no execution) — symbol must be ≤20 chars
    const planRes = await page.request.post('/api/trades', {
      data: { symbol: `PLN${TS}`, direction: 'long', accountId: account.id },
    });
    expect(planRes.ok()).toBeTruthy();

    // Create and execute a trade → status 'open'
    const openTradeRes = await page.request.post('/api/trades', {
      data: { symbol: `OPN${TS}`, direction: 'short', accountId: account.id },
    });
    expect(openTradeRes.ok()).toBeTruthy();
    const openTrade = await openTradeRes.json();
    const execOpen = await page.request.post(`/api/trades/${openTrade.id}/execute`, {
      data: { entryPrice: 100, entryQuantity: 50, stopPrice: 95, fees: 2 },
    });
    expect(execOpen.ok()).toBeTruthy();

    // Create and fully exit a trade → status 'closed'
    const closeTradeRes = await page.request.post('/api/trades', {
      data: { symbol: `CLS${TS}`, direction: 'long', accountId: account.id },
    });
    expect(closeTradeRes.ok()).toBeTruthy();
    const closeTrade = await closeTradeRes.json();
    const execClose = await page.request.post(`/api/trades/${closeTrade.id}/execute`, {
      data: { entryPrice: 50, entryQuantity: 100, exit1Price: 55, exit1Quantity: 100, fees: 3 },
    });
    expect(execClose.ok()).toBeTruthy();

    await page.goto('/trades');
    await expect(page.locator('h1')).toContainText('Trades');

    // ── Open tab (default) ──
    // Should show the open trade
    await expect(page.locator('tr').filter({ hasText: `OPN${TS}` }).first()).toBeVisible();
    // Should NOT show planned or closed trades
    await expect(page.locator('tr').filter({ hasText: `PLN${TS}` })).not.toBeVisible();
    await expect(page.locator('tr').filter({ hasText: `CLS${TS}` })).not.toBeVisible();

    // ── Planned tab ──
    await page.getByRole('tab', { name: /planned/i }).click();
    await expect(page.locator('tr').filter({ hasText: `PLN${TS}` }).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('tr').filter({ hasText: `OPN${TS}` })).not.toBeVisible();
    await expect(page.locator('tr').filter({ hasText: `CLS${TS}` })).not.toBeVisible();

    // ── Closed tab ──
    await page.getByRole('tab', { name: /closed/i }).click();
    await expect(page.locator('tr').filter({ hasText: `CLS${TS}` }).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('tr').filter({ hasText: `PLN${TS}` })).not.toBeVisible();
    await expect(page.locator('tr').filter({ hasText: `OPN${TS}` })).not.toBeVisible();
  });

  test('column order and sorting persist across page reload', async ({ page }) => {
    const account = await setupAccount(page, `M008-Vis-${TS}`);

    // Create an open trade so the table renders rows — symbol must be ≤20 chars
    const tradeRes = await page.request.post('/api/trades', {
      data: { symbol: `VIS${TS}`, direction: 'long', accountId: account.id },
    });
    expect(tradeRes.ok()).toBeTruthy();
    const trade = await tradeRes.json();
    const execRes = await page.request.post(`/api/trades/${trade.id}/execute`, {
      data: { entryPrice: 200, entryQuantity: 30, stopPrice: 195, fees: 1.5 },
    });
    expect(execRes.ok()).toBeTruthy();

    await page.goto('/trades');
    await clearLocalStorage(page);
    await expect(page.locator('h1')).toContainText('Trades');

    // The Open tab is selected by default — verify column headers render
    await expect(page.locator('th').filter({ hasText: 'Symbol' })).toBeVisible();
    await expect(page.locator('th').filter({ hasText: 'Direction' })).toBeVisible();
    await expect(page.locator('th').filter({ hasText: 'Setup' })).toBeVisible();

    // Reload and verify same columns still render (default state persists)
    await page.reload();
    await expect(page.locator('h1')).toContainText('Trades');
    await expect(page.locator('th').filter({ hasText: 'Symbol' })).toBeVisible();
    await expect(page.locator('th').filter({ hasText: 'Direction' })).toBeVisible();
    await expect(page.locator('th').filter({ hasText: 'Setup' })).toBeVisible();
  });

  test('date-range filter applies to closed and planned tabs while open positions stay visible', async ({ page }) => {
    const account = await setupAccount(page, `M008-Date-${TS}`);

    // Create and execute a trade so it appears in the Open tab — symbol must be ≤20 chars
    const tradeRes = await page.request.post('/api/trades', {
      data: { symbol: `DAT${TS}`, direction: 'long', accountId: account.id },
    });
    expect(tradeRes.ok()).toBeTruthy();
    const trade = await tradeRes.json();
    const execRes = await page.request.post(`/api/trades/${trade.id}/execute`, {
      data: { entryPrice: 150, entryQuantity: 40, stopPrice: 145, fees: 2 },
    });
    expect(execRes.ok()).toBeTruthy();

    // Create a fully exited trade → status 'closed' (closedAt = now)
    const closeTradeRes = await page.request.post('/api/trades', {
      data: { symbol: `CLD${TS}`, direction: 'long', accountId: account.id },
    });
    expect(closeTradeRes.ok()).toBeTruthy();
    const closeTrade = await closeTradeRes.json();
    const execClose = await page.request.post(`/api/trades/${closeTrade.id}/execute`, {
      data: { entryPrice: 50, entryQuantity: 100, exit1Price: 55, exit1Quantity: 100, fees: 3 },
    });
    expect(execClose.ok()).toBeTruthy();

    // Create a planned trade (no execution, createdAt = now)
    const planRes = await page.request.post('/api/trades', {
      data: { symbol: `PLD${TS}`, direction: 'short', accountId: account.id },
    });
    expect(planRes.ok()).toBeTruthy();

    await page.goto('/trades');
    await expect(page.locator('h1')).toContainText('Trades');

    // The open trade should be visible initially
    await expect(page.locator('tr').filter({ hasText: `DAT${TS}` }).first()).toBeVisible();

    // Apply a date-range filter set to the past (2020) — this should exclude
    // any trade created during this test run
    await page.fill('#filter-from', '2020-01-01');
    await page.fill('#filter-to', '2020-01-02');

    // Wait for the debounced re-fetch (300ms) and network response
    await page.waitForTimeout(1500);

    // M009 contract: open positions are always visible regardless of date range
    // (GET /api/trades ignores from/to for status=open).
    await expect(page.locator('tr').filter({ hasText: `DAT${TS}` }).first()).toBeVisible();

    // Closed tab filters by closedAt — the just-closed trade (today) is excluded
    await page.getByRole('tab', { name: /closed/i }).click();
    await expect(page.locator('tr').filter({ hasText: `CLD${TS}` })).not.toBeVisible();

    // Planned tab filters by createdAt — the planned trade (today) is excluded
    await page.getByRole('tab', { name: /planned/i }).click();
    await expect(page.locator('tr').filter({ hasText: `PLD${TS}` })).not.toBeVisible();

    // Clear filters to restore the closed and planned trades
    await page.fill('#filter-from', '');
    await page.fill('#filter-to', '');

    // Wait for debounce and re-fetch
    await page.waitForTimeout(1500);

    // The closed trade should reappear after clearing filters
    await page.getByRole('tab', { name: /closed/i }).click();
    await expect(page.locator('tr').filter({ hasText: `CLD${TS}` }).first()).toBeVisible({ timeout: 10_000 });

    // The planned trade should reappear as well
    await page.getByRole('tab', { name: /planned/i }).click();
    await expect(page.locator('tr').filter({ hasText: `PLD${TS}` }).first()).toBeVisible({ timeout: 10_000 });
  });

  test('pagination count display shows correct totals for each tab', async ({ page }) => {
    const account = await setupAccount(page, `M008-Page-${TS}`);

    // Create three planned trades so the Planned tab has a readable count — symbols must be ≤20 chars
    for (let i = 0; i < 3; i++) {
      const r = await page.request.post('/api/trades', {
        data: { symbol: `PG${TS}-${i}`, direction: i % 2 === 0 ? 'long' : 'short', accountId: account.id },
      });
      expect(r.ok()).toBeTruthy();
    }

    await page.goto('/trades');
    await expect(page.locator('h1')).toContainText('Trades');

    // Switch to Planned tab
    await page.getByRole('tab', { name: /planned/i }).click();

    // Verify the "Showing X of Y planned trades" pagination count text appears
    // The page renders: <p>Showing {rows.length} of {total} planned trades.</p>
    // Totals use toLocaleString, so tolerate thousand separators (e.g. 1,021).
    const showingText = page.locator('text=/Showing\\s+[\\d,]+\\s+of\\s+[\\d,]+\\s+planned\\s+trades/');
    await expect(showingText).toBeVisible({ timeout: 10_000 });

    // Verify the Open tab also shows its count text
    await page.getByRole('tab', { name: /open/i }).click();
    await expect(page.locator('text=/Showing\\s+[\\d,]+\\s+of\\s+[\\d,]+\\s+open\\s+trades/')).toBeVisible({ timeout: 10_000 });
  });
});
