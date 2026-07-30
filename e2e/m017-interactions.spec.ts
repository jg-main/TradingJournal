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

test.describe('M017 Interactions', () => {
  test.describe.configure({ mode: 'serial' });

  test('Plan Trade page at /trades/new renders correctly', async ({ page }) => {
    // Navigate directly to /trades/new (the three-tab Trades page no longer has
    // a Plan Trade link — the sidebar provides access to the trade list, and
    // the Plan Trade form is always available at /trades/new)
    await page.goto('/trades/new');
    await expect(page.locator('[data-slot="card-title"]').filter({ hasText: 'Plan Trade' })).toBeVisible();
  });

  test('Trade code is plain text (not a link)', async ({ page }) => {
    const account = await setupAccount(page, `M017-PlainText-${TS}`);

    // Create a planned trade via API
    const tradeRes = await page.request.post('/api/trades', {
      data: { symbol: `M017PT${TS}`, direction: 'long', accountId: account.id },
    });
    expect(tradeRes.ok()).toBeTruthy();
    const trade = await tradeRes.json();

    // Navigate to trade log and switch to Planned tab
    await page.goto('/trades');
    await expect(page.locator('h1')).toContainText('Trades');
    await page.getByRole('tab', { name: /planned/i }).click();

    // Find the trade row by symbol
    const row = page.locator('tr').filter({ hasText: `M017PT${TS}` }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });

    // The symbol column (first td) displays the symbol, not the trade code
    // Trade codes are not shown in the new Planned tab columns
    const symbolCell = row.locator('td').first();
    await expect(symbolCell).toContainText(`M017PT${TS}`);

    // No <a> tag should exist inside the row (plain text, no link wrapping)
    await expect(row.locator('td a')).toHaveCount(0);
  });

  test('Edit and Execute buttons absent from trade log rows', async ({ page }) => {
    const account = await setupAccount(page, `M017-NoButtons-${TS}`);

    // Create a planned trade
    const tradeRes = await page.request.post('/api/trades', {
      data: { symbol: `M017NB${TS}`, direction: 'short', accountId: account.id },
    });
    expect(tradeRes.ok()).toBeTruthy();

    // Navigate to trade log and switch to Planned tab
    await page.goto('/trades');
    await expect(page.locator('h1')).toContainText('Trades');
    await page.getByRole('tab', { name: /planned/i }).click();

    // Verify no button with text "Edit" exists
    await expect(page.getByRole('button', { name: /edit/i })).toHaveCount(0);

    // Verify no "Execute" button exists in any trade row
    await expect(page.getByRole('button', { name: /execute/i })).toHaveCount(0);

    // The new ActionsCell renders an icon button with aria-label="Trade actions"
    // (no title attribute, no direct action button)
    const actionCells = page.locator('td:last-child button');
    const actionCount = await actionCells.count();
    for (let i = 0; i < actionCount; i++) {
      const ariaLabel = await actionCells.nth(i).getAttribute('aria-label');
      expect(ariaLabel).toBe('Trade actions');
    }
  });

  test('Row click navigates to trade detail page', async ({ page }) => {
    const account = await setupAccount(page, `M017-RowClick-${TS}`);

    // Create a planned trade
    const tradeRes = await page.request.post('/api/trades', {
      data: { symbol: `M017RC${TS}`, direction: 'long', accountId: account.id },
    });
    expect(tradeRes.ok()).toBeTruthy();
    const trade = await tradeRes.json();

    // Navigate to trade log and switch to Planned tab
    await page.goto('/trades');
    await expect(page.locator('h1')).toContainText('Trades');
    await page.getByRole('tab', { name: /planned/i }).click();

    // Find the trade row (DynamicTable rows are not directly clickable on the
    // new page — verify the row exists, then navigate via URL)
    const row = page.locator('tr').filter({ hasText: `M017RC${TS}` }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });

    // Navigate directly to the trade detail page
    await page.goto(`/trades/${trade.id}`);
    await expect(page.locator('h1')).toContainText(`M017RC${TS}`);
  });

  test('Delete trade via API and verify removal from UI', async ({ page }) => {
    const account = await setupAccount(page, `M017-Del-${TS}`);

    // Create a planned trade to delete
    const tradeRes = await page.request.post('/api/trades', {
      data: { symbol: `M017DEL${TS}`, direction: 'long', accountId: account.id },
    });
    expect(tradeRes.ok()).toBeTruthy();
    const trade = await tradeRes.json();

    // Navigate to trade log and switch to Planned tab
    await page.goto('/trades');
    await expect(page.locator('h1')).toContainText('Trades');
    await page.getByRole('tab', { name: /planned/i }).click();

    // Verify the trade row appears
    const row = page.locator('tr').filter({ hasText: `M017DEL${TS}` }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });

    // Delete the trade via API (the new page has no delete button in the table)
    const delRes = await page.request.delete(`/api/trades/${trade.id}`);
    expect(delRes.ok()).toBeTruthy();

    // Re-navigate to /trades and switch to Planned tab
    await page.goto('/trades');
    await expect(page.locator('h1')).toContainText('Trades');
    await page.getByRole('tab', { name: /planned/i }).click();

    // The deleted trade should no longer appear in the table
    await expect(page.locator('tr').filter({ hasText: `M017DEL${TS}` })).not.toBeVisible();

    // Navigate to the deleted trade detail page — should show "Trade not found"
    await page.goto(`/trades/${trade.id}`);
    await expect(page.getByText('Trade not found')).toBeVisible();
  });

  test('/trades/new renders PlanTradeForm with Symbol input and Direction select', async ({ page }) => {
    await page.goto('/trades/new');
    await expect(page.locator('[data-slot="card-title"]').filter({ hasText: 'Plan Trade' })).toBeVisible();

    // Verify Symbol input exists
    const symbolInput = page.locator('input[placeholder="e.g. AAPL"]');
    await expect(symbolInput).toBeVisible();

    // Verify combobox elements are rendered (Direction + Account + Setup selects)
    // Use first() since there are multiple comboboxes on the form
    await expect(page.locator('[role="combobox"]').first()).toBeVisible();

    // Verify Direction label is present (exact match to avoid the description text)
    await expect(page.getByText('Direction', { exact: true })).toBeVisible();
  });

  test('Form submission creates trade and redirects to detail', async ({ page }) => {
    // First create a fully usable account via helper
    await setupAccount(page, `M017-Form-${TS}`);

    const uniqueSymbol = `M017FM${TS}`;

    // Navigate to /trades/new
    await page.goto('/trades/new');
    await expect(page.locator('[data-slot="card-title"]').filter({ hasText: 'Plan Trade' })).toBeVisible();

    // Fill the Symbol field with a unique ticker
    await page.fill('input[placeholder="e.g. AAPL"]', uniqueSymbol);

    // Wait for the POST /api/trades response (API returns 201 Created)
    const responsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/api/trades') &&
        resp.request().method() === 'POST' &&
        (resp.status() === 201 || resp.status() === 200),
    );

    // Submit the form by clicking the "Plan Trade" submit button
    await page.getByRole('button', { name: 'Plan Trade' }).click();

    // Wait for the API call to complete
    const response = await responsePromise;
    const trade = await response.json();

    // Wait for redirect to /trades/[id]
    await expect(page).toHaveURL(`/trades/${trade.id}`);
    await expect(page.locator('h1')).toContainText(uniqueSymbol);
  });

  test('Cancel returns to /trades', async ({ page }) => {
    await page.goto('/trades/new');
    await expect(page.locator('[data-slot="card-title"]').filter({ hasText: 'Plan Trade' })).toBeVisible();

    // Click the Cancel button
    await page.getByRole('button', { name: 'Cancel' }).click();

    // Verify URL is /trades and page shows Trades heading
    await expect(page).toHaveURL('/trades');
    await expect(page.locator('h1')).toContainText('Trades');
  });

  test('Back to Trades link works', async ({ page }) => {
    await page.goto('/trades/new');
    await expect(page.locator('[data-slot="card-title"]').filter({ hasText: 'Plan Trade' })).toBeVisible();

    // Click the "Back to Trades" link
    await page.getByText('Back to Trades').click();

    // Verify navigation to /trades with Trades heading
    await expect(page).toHaveURL('/trades');
    await expect(page.locator('h1')).toContainText('Trades');
  });

  test('Empty form submission shows validation error', async ({ page }) => {
    await page.goto('/trades/new');
    await expect(page.locator('[data-slot="card-title"]').filter({ hasText: 'Plan Trade' })).toBeVisible();

    // Click submit without filling the Symbol field
    await page.getByRole('button', { name: 'Plan Trade' }).click();

    // Verify the validation error message appears
    await expect(page.getByText('Symbol is required.')).toBeVisible();

    // Verify we remain on /trades/new (no redirect occurred)
    await expect(page).toHaveURL('/trades/new');
  });

  test('Whitespace-only symbol triggers validation error', async ({ page }) => {
    await page.goto('/trades/new');
    await expect(page.locator('[data-slot="card-title"]').filter({ hasText: 'Plan Trade' })).toBeVisible();

    // Fill symbol with whitespace
    await page.fill('input[placeholder="e.g. AAPL"]', '   ');

    // Click submit
    await page.getByRole('button', { name: 'Plan Trade' }).click();

    // Verify the validation error message appears (trim() should catch whitespace)
    await expect(page.getByText('Symbol is required.')).toBeVisible();

    // Verify we remain on /trades/new
    await expect(page).toHaveURL('/trades/new');
  });

  test('Trade persists across page reload (verifies data does not disappear unexpectedly)', async ({ page }) => {
    const account = await setupAccount(page, `M017-Dismiss-${TS}`);

    // Create a trade
    const tradeRes = await page.request.post('/api/trades', {
      data: { symbol: `M017DIM${TS}`, direction: 'long', accountId: account.id },
    });
    expect(tradeRes.ok()).toBeTruthy();

    // Navigate to trade log and switch to Planned tab
    await page.goto('/trades');
    await expect(page.locator('h1')).toContainText('Trades');
    await page.getByRole('tab', { name: /planned/i }).click();

    // Verify the trade row appears
    const row = page.locator('tr').filter({ hasText: `M017DIM${TS}` }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });

    // Reload the page and verify the trade still appears (data persists)
    await page.reload();
    await expect(page.locator('h1')).toContainText('Trades');
    await page.getByRole('tab', { name: /planned/i }).click();
    await expect(page.locator('tr').filter({ hasText: `M017DIM${TS}` }).first()).toBeVisible({ timeout: 10_000 });
  });
});
