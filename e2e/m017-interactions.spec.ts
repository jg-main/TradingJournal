import { test, expect } from '@playwright/test';

const TS = Date.now();

test.describe('M017 Interactions', () => {
  test.describe.configure({ mode: 'serial' });

  test('Plan Trade button navigates to /trades/new', async ({ page }) => {
    await page.goto('/trades');
    await expect(page.locator('h1')).toContainText('Trade Log');

    // Find the Plan Trade link by role (more reliable than text selector on all browsers)
    const planTradeBtn = page.getByRole('link', { name: /plan trade/i });
    await expect(planTradeBtn).toBeVisible();

    // Click and verify navigation to /trades/new
    await planTradeBtn.click();
    await expect(page).toHaveURL('/trades/new');

    // Verify the /trades/new page renders with Plan Trade CardTitle
    await expect(page.locator('[data-slot="card-title"]').filter({ hasText: 'Plan Trade' })).toBeVisible();
  });

  test('Trade code is plain text (not a link)', async ({ page }) => {
    // Create a test account
    const accRes = await page.request.post('/api/accounts', {
      data: { name: `M017-PlainText-${TS}`, isActive: true, startingBalance: 50000 },
    });
    expect(accRes.ok()).toBeTruthy();
    const account = await accRes.json();

    // Create a planned trade via API
    const tradeRes = await page.request.post('/api/trades', {
      data: { symbol: `M017PT${TS}`, direction: 'long', accountId: account.id },
    });
    expect(tradeRes.ok()).toBeTruthy();
    const trade = await tradeRes.json();

    // Navigate to trade log
    await page.goto('/trades');
    await expect(page.locator('h1')).toContainText('Trade Log');

    // Find the trade row by symbol
    const row = page.locator('tr').filter({ hasText: `M017PT${TS}` }).first();
    await expect(row).toBeVisible();

    // The trade code cell should contain the code text
    const tradeCodeCell = row.locator('td').first();
    await expect(tradeCodeCell).toContainText(trade.tradeCode);

    // But should NOT contain any <a> tag inside the row (plain text, not a link)
    await expect(row.locator('td a')).toHaveCount(0);
  });

  test('Edit and Execute buttons absent from trade log rows', async ({ page }) => {
    // Create a test account
    const accRes = await page.request.post('/api/accounts', {
      data: { name: `M017-NoButtons-${TS}`, isActive: true, startingBalance: 50000 },
    });
    expect(accRes.ok()).toBeTruthy();
    const account = await accRes.json();

    // Create a planned trade
    const tradeRes = await page.request.post('/api/trades', {
      data: { symbol: `M017NB${TS}`, direction: 'short', accountId: account.id },
    });
    expect(tradeRes.ok()).toBeTruthy();

    // Navigate to trade log
    await page.goto('/trades');
    await expect(page.locator('h1')).toContainText('Trade Log');

    // Verify no button with text "Edit" exists
    await expect(page.getByRole('button', { name: /edit/i })).toHaveCount(0);

    // Verify no "Execute" button exists in any trade row
    await expect(page.getByRole('button', { name: /execute/i })).toHaveCount(0);

    // Verify no Play icon buttons exist (the Execute button used a Play icon in prior versions)
    // Only the Remove (Trash2) button should exist in the actions column
    // Each row has exactly one action button (Remove)
    const actionCells = page.locator('td:last-child button');
    const actionCount = await actionCells.count();
    for (let i = 0; i < actionCount; i++) {
      const title = await actionCells.nth(i).getAttribute('title');
      expect(title).toBe('Remove');
    }
  });

  test('Row click navigates to trade detail page', async ({ page }) => {
    // Create a test account
    const accRes = await page.request.post('/api/accounts', {
      data: { name: `M017-RowClick-${TS}`, isActive: true, startingBalance: 50000 },
    });
    expect(accRes.ok()).toBeTruthy();
    const account = await accRes.json();

    // Create a planned trade
    const tradeRes = await page.request.post('/api/trades', {
      data: { symbol: `M017RC${TS}`, direction: 'long', accountId: account.id },
    });
    expect(tradeRes.ok()).toBeTruthy();
    const trade = await tradeRes.json();

    // Navigate to trade log
    await page.goto('/trades');
    await expect(page.locator('h1')).toContainText('Trade Log');

    // Find the trade row and click it
    const row = page.locator('tr').filter({ hasText: `M017RC${TS}` }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.click();

    // Verify URL changes to /trades/[id]
    await expect(page).toHaveURL(`/trades/${trade.id}`);
    await expect(page.locator('h1')).toContainText(`M017RC${TS}`);
  });

  test('Delete with window.confirm() and verify removal', async ({ page }) => {
    // Create a test account
    const accRes = await page.request.post('/api/accounts', {
      data: { name: `M017-Del-${TS}`, isActive: true, startingBalance: 50000 },
    });
    expect(accRes.ok()).toBeTruthy();
    const account = await accRes.json();

    // Create a trade to delete
    const tradeRes = await page.request.post('/api/trades', {
      data: { symbol: `M017DEL${TS}`, direction: 'long', accountId: account.id },
    });
    expect(tradeRes.ok()).toBeTruthy();
    const trade = await tradeRes.json();

    // Navigate to trade log
    await page.goto('/trades');
    await expect(page.locator('h1')).toContainText('Trade Log');

    // Verify the trade row appears
    const row = page.locator('tr').filter({ hasText: `M017DEL${TS}` }).first();
    await expect(row).toBeVisible();

    // Set up dialog handler BEFORE clicking Remove (accepts the confirm dialog)
    page.on('dialog', (dialog) => {
      expect(dialog.message()).toContain('Permanently remove');
      dialog.accept();
    });

    // Wait for the subsequent GET refresh from fetchItems
    const refreshPromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/api/trades') &&
        resp.request().method() === 'GET' &&
        resp.status() === 200,
    );

    // Click Remove button on the delete-me row
    await row.locator('[title="Remove"]').first().click();

    // Wait for the trade log to refresh after deletion
    await refreshPromise;

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
    // First create an account via API
    const accRes = await page.request.post('/api/accounts', {
      data: { name: `M017-Form-${TS}`, isActive: true, startingBalance: 50000 },
    });
    expect(accRes.ok()).toBeTruthy();
    await accRes.json();

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

    // Verify URL is /trades and page shows Trade Log heading
    await expect(page).toHaveURL('/trades');
    await expect(page.locator('h1')).toContainText('Trade Log');
  });

  test('Back to Trade Log link works', async ({ page }) => {
    await page.goto('/trades/new');
    await expect(page.locator('[data-slot="card-title"]').filter({ hasText: 'Plan Trade' })).toBeVisible();

    // Click the "Back to Trade Log" link
    await page.getByText('Back to Trade Log').click();

    // Verify navigation to /trades with Trade Log heading
    await expect(page).toHaveURL('/trades');
    await expect(page.locator('h1')).toContainText('Trade Log');
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

  test('Dialog dismiss (cancel delete) keeps trade visible', async ({ page }) => {
    // Create a test account
    const accRes = await page.request.post('/api/accounts', {
      data: { name: `M017-Dismiss-${TS}`, isActive: true, startingBalance: 50000 },
    });
    expect(accRes.ok()).toBeTruthy();
    const account = await accRes.json();

    // Create a trade
    const tradeRes = await page.request.post('/api/trades', {
      data: { symbol: `M017DIM${TS}`, direction: 'long', accountId: account.id },
    });
    expect(tradeRes.ok()).toBeTruthy();

    // Navigate to trade log
    await page.goto('/trades');
    await expect(page.locator('h1')).toContainText('Trade Log');

    // Verify the trade row appears
    const row = page.locator('tr').filter({ hasText: `M017DIM${TS}` }).first();
    await expect(row).toBeVisible();

    // Set up dialog handler that DISMISSES (does not accept)
    page.on('dialog', (dialog) => {
      expect(dialog.message()).toContain('Permanently remove');
      dialog.dismiss();
    });

    // Click Remove button
    await row.locator('[title="Remove"]').first().click();

    // Wait a moment for any UI updates
    await page.waitForTimeout(500);

    // The trade should still be visible since we dismissed the confirm dialog
    await expect(page.locator('tr').filter({ hasText: `M017DIM${TS}` }).first()).toBeVisible();
  });
});
