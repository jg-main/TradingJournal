import { test, expect } from '@playwright/test';

test.describe('M012 Trade Lifecycle', () => {
  test('plan a trade via API and verify Planned status on trade log', async ({ page }) => {
    // Create a test account
    const accRes = await page.request.post('/api/accounts', {
      data: { name: 'E2E Plan Test', isActive: true, startingBalance: 50000 },
    });
    expect(accRes.ok()).toBeTruthy();
    const account = await accRes.json();

    // Create a trade via API — should default to "planned" status
    const tradeRes = await page.request.post('/api/trades', {
      data: { symbol: 'TSLA', direction: 'short', accountId: account.id },
    });
    expect(tradeRes.ok()).toBeTruthy();
    const trade = await tradeRes.json();
    expect(trade.status).toBe('planned');

    // Navigate to the trade log page
    await page.goto('/trades');
    await expect(page.locator('h1')).toContainText('Trade Log');

    // Verify the trade row appears with "Planned" status badge
    // Use first() because leftover data from prior runs may create multiple rows
    const row = page.locator('tr').filter({ hasText: 'TSLA' }).first();
    await expect(row).toBeVisible();
    await expect(row.getByText('Planned')).toBeVisible();
  });

  test('execute a planned trade via API and verify Open status on log and detail', async ({ page }) => {
    // Create a test account
    const accRes = await page.request.post('/api/accounts', {
      data: { name: 'E2E Execute Test', isActive: true, startingBalance: 50000 },
    });
    expect(accRes.ok()).toBeTruthy();
    const account = await accRes.json();

    // Create a planned trade
    const tradeRes = await page.request.post('/api/trades', {
      data: { symbol: 'NVDA', direction: 'long', accountId: account.id },
    });
    expect(tradeRes.ok()).toBeTruthy();
    const trade = await tradeRes.json();
    expect(trade.status).toBe('planned');

    // Execute the trade via API — creates execution + risk snapshot atomically
    const execRes = await page.request.post(`/api/trades/${trade.id}/execute`, {
      data: {
        entryPrice: 800.0,
        entryQuantity: 50,
        stopPrice: 780.0,
        fees: 5.0,
      },
    });
    expect(execRes.ok()).toBeTruthy();
    const execData = await execRes.json();
    expect(execData.trade.status).toBe('open');

    // Navigate to trade log and verify "Open" badge
    // Use first() because leftover data from prior runs may create multiple rows
    await page.goto('/trades');
    const row = page.locator('tr').filter({ hasText: 'NVDA' }).first();
    await expect(row).toBeVisible();
    await expect(row.getByText('Open')).toBeVisible();

    // Navigate to the trade detail page for the open trade
    await page.goto(`/trades/${trade.id}`);
    await expect(page.locator('h1')).toContainText('NVDA');

    // Open trades show "Open" badge in the header
    // Use first() to handle multiple matches from labels like "Opened At", "Open Qty"
    await expect(page.locator('[data-slot="badge"]').filter({ hasText: 'Open' }).first()).toBeVisible();

    // Lifecycle stepper is rendered — it always shows step labels like "Plan", "Execute"
    // Use exact text match to avoid matching the account name "E2E Execute Test" in description text
    await expect(page.getByText('Execute', { exact: true })).toBeVisible();

    // Open trades render TradeExecutionsCard with the entry execution action
    // CardTitle renders as a <div data-slot="card-title">, not a heading role
    await expect(page.locator('[data-slot="card-title"]').filter({ hasText: 'Executions' })).toBeVisible();
  });

  test('closed trade detail page renders correctly', async ({ page }) => {
    // Create a test account
    const accRes = await page.request.post('/api/accounts', {
      data: { name: 'E2E Closed Test', isActive: true, startingBalance: 50000 },
    });
    expect(accRes.ok()).toBeTruthy();
    const account = await accRes.json();

    // Create a trade
    const tradeRes = await page.request.post('/api/trades', {
      data: { symbol: 'AAPL', direction: 'long', accountId: account.id },
    });
    expect(tradeRes.ok()).toBeTruthy();
    const trade = await tradeRes.json();

    // Execute with full exit (exit1Quantity === entryQuantity) to create a closed trade
    const execRes = await page.request.post(`/api/trades/${trade.id}/execute`, {
      data: {
        entryPrice: 180.0,
        entryQuantity: 50,
        exit1Price: 190.0,
        exit1Quantity: 50,
        fees: 3.0,
      },
    });
    expect(execRes.ok()).toBeTruthy();
    const execData = await execRes.json();
    expect(execData.trade.status).toBe('closed');

    // Navigate to detail page
    await page.goto(`/trades/${trade.id}`);
    await expect(page.locator('h1')).toContainText('AAPL');

    // Closed badge is visible
    // Use first() to handle multiple matches from label like "Closed At"
    await expect(page.locator('[data-slot="badge"]').filter({ hasText: 'Closed' }).first()).toBeVisible();

    // Lifecycle stepper shows at least step 5 (Exit) for closed trades
    await expect(page.getByText('Exit')).toBeVisible();

    // Closed trades render TradeGradeCard (always rendered, even without grade data)
    // CardTitle renders as a <div data-slot="card-title">, not a heading role
    await expect(page.locator('[data-slot="card-title"]').filter({ hasText: 'Trade Grade' })).toBeVisible();
    // P&L-R Metrics is always present for closed trades with executions
    // Exit Notes is conditionally rendered only when exitNotes or lesson exist
    await expect(page.locator('[data-slot="card-title"]').filter({ hasText: 'P&L-R Metrics' })).toBeVisible();
  });

  test('delete a trade with confirmation and verify removal', async ({ page }) => {
    // Create a test account
    const accRes = await page.request.post('/api/accounts', {
      data: { name: 'E2E Delete Test', isActive: true, startingBalance: 50000 },
    });
    expect(accRes.ok()).toBeTruthy();
    const account = await accRes.json();

    // Create a trade
    const tradeRes = await page.request.post('/api/trades', {
      data: { symbol: 'M012-DEL', direction: 'long', accountId: account.id },
    });
    expect(tradeRes.ok()).toBeTruthy();
    const trade = await tradeRes.json();

    // Navigate to trade log
    await page.goto('/trades');
    await expect(page.locator('h1')).toContainText('Trade Log');

    // Set up dialog handler BEFORE clicking Remove (accepts the confirm dialog)
    page.on('dialog', (dialog) => {
      expect(dialog.message()).toContain('Delete trade');
      dialog.accept();
    });

    // Wait for the subsequent GET refresh from fetchItems
    const refreshPromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/api/trades') &&
        resp.request().method() === 'GET' &&
        resp.status() === 200,
    );

    // Click Remove on the M012-DEL row (use unique symbol to avoid clashing with other specs' MSFT data)
    await page.locator('tr').filter({ hasText: 'M012-DEL' }).getByText('Remove').first().click();

    // Wait for the trade log to refresh after deletion
    await refreshPromise;

    // M012-DEL should no longer appear in the table (hard delete)
    await expect(page.locator('tr').filter({ hasText: 'M012-DEL' })).not.toBeVisible();

    // Navigate to the deleted trade detail page — should show "Trade not found"
    await page.goto(`/trades/${trade.id}`);
    await expect(page.getByText('Trade not found')).toBeVisible();
  });
});
