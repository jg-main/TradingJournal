import { test, expect } from '@playwright/test';

/**
 * Unique per-run suffix for created accounts. The shared readiness DB
 * (playwright-readiness.db) persists across runs and the account DELETE API
 * refuses accounts with any trade history, so fixed names would accumulate
 * same-name duplicates on every run — and any spec clicking an account by
 * name would then trip Playwright strict mode. Each run's accounts get a
 * unique name (and are always the newest, which is what other specs resolve
 * to), so repeated batch runs stop accumulating duplicates.
 */
const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Create a fully usable test account: creates the account, sets risk params,
 * activates it, and posts opening cash. Returns { id, name }.
 */
async function setupAccount(page: import('@playwright/test').Page, name: string) {
  const createResp = await page.request.post('/api/accounts', {
    data: { name: `${name} ${RUN_ID}`, currency: 'USD' },
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

test.describe('M012 Trade Lifecycle', () => {
  test.describe.configure({ mode: 'serial' });
  test('plan a trade via API and verify Planned status on trade log', async ({ page }) => {
    // Create a test account with full setup
    const account = await setupAccount(page, 'E2E Plan Test');

    // Create a trade via API — should default to "planned" status
    const tradeRes = await page.request.post('/api/trades', {
      data: { symbol: 'TSLA', direction: 'short', accountId: account.id },
    });
    expect(tradeRes.ok()).toBeTruthy();
    const trade = await tradeRes.json();
    expect(trade.status).toBe('planned');

    // Navigate to the trade log page
    await page.goto('/trades');
    await expect(page.locator('h1')).toContainText('Trades');

    // Switch to Planned tab (page defaults to Open tab)
    await page.getByRole('tab', { name: /planned/i }).click();

    // Verify the trade row appears in the Planned tab
    // (The Planned tab only shows planned trades, so no status badge is rendered)
    // Use first() because leftover data from prior runs may create multiple rows
    const row = page.locator('tr').filter({ hasText: 'TSLA' }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row.getByText('short')).toBeVisible({
      timeout: 5_000,
    });
  });

  test('execute a planned trade via API and verify Open status on log and detail', async ({ page }) => {
    // Create a test account with full setup
    const account = await setupAccount(page, 'E2E Execute Test');

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

    // Navigate to trade log and verify the row appears in the Open tab (default)
    // Use first() because leftover data from prior runs may create multiple rows
    await page.goto('/trades');
    const row = page.locator('tr').filter({ hasText: 'NVDA' }).first();
    await expect(row).toBeVisible();
    // The Open tab only shows open trades, so the presence of the symbol confirms status
    await expect(row.getByText('long')).toBeVisible();

    // Navigate to the trade detail page for the open trade
    await page.goto(`/trades/${trade.id}`);
    await expect(page.locator('h1')).toContainText('NVDA');

    // Open trades show "Open" badge in the header
    // Use first() to handle multiple matches from labels like "Opened At", "Open Qty"
    await expect(page.locator('[data-slot="badge"]').filter({ hasText: 'Open' }).first()).toBeVisible();

    // Lifecycle stepper is rendered — it always shows step labels like "Plan", "Execute"
    // Use exact text match to avoid matching the account name "E2E Execute Test" in description text
    await expect(page.getByText('Execute', { exact: true })).toBeVisible();

    // Open trades render the unified History feed (M019/S03); the standalone
    // TradeExecutionsCard was removed in S05 and its data now shows as feed rows
    // CardTitle renders as a <div data-slot="card-title">, not a heading role
    await expect(page.locator('[data-slot="card-title"]').filter({ hasText: 'History' })).toBeVisible();
  });

  test('closed trade detail page renders correctly', async ({ page }) => {
    // Create a test account with full setup
    const account = await setupAccount(page, 'E2E Closed Test');

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
    await expect(page.getByText('Exit', { exact: true })).toBeVisible();

    // Closed trades render TradeGradeCard inside the collapsible Grade
    // review section (M020/S04) — expand the section first.
    // CardTitle renders as a <div data-slot="card-title">, not a heading role
    await page.locator('.td-review-section-trigger').filter({ hasText: 'Grade' }).click();
    await expect(page.locator('[data-slot="card-title"]').filter({ hasText: 'Trade Grade' })).toBeVisible();
    // TradePnlCard is always present for closed trades with executions;
    // it renders without a CardHeader/CardTitle, showing "Realized P&L" as a label
    await expect(page.getByText('Realized P&L', { exact: true })).toBeVisible();
    // Exit Notes is conditionally rendered only when exitNotes or lesson exist
  });

  test('open trade detail page renders and full lifecycle flows correctly', async ({ page }) => {
    // Create a test account with full setup
    const account = await setupAccount(page, 'E2E Lifecycle Test');

    // Create a planned trade
    const tradeRes = await page.request.post('/api/trades', {
      data: { symbol: 'META', direction: 'long', accountId: account.id },
    });
    expect(tradeRes.ok()).toBeTruthy();
    const trade = await tradeRes.json();
    expect(trade.status).toBe('planned');

    // Execute entry-only via API (no exit data) → status becomes 'open'
    const execRes = await page.request.post(`/api/trades/${trade.id}/execute`, {
      data: {
        entryPrice: 580.0,
        entryQuantity: 100,
        stopPrice: 560.0,
        fees: 5.0,
      },
    });
    expect(execRes.ok()).toBeTruthy();
    const execData = await execRes.json();
    expect(execData.trade.status).toBe('open');

    // Navigate to trade log → verify row appears in the Open tab (default)
    await page.goto('/trades');
    await expect(page.locator('h1')).toContainText('Trades');
    const row = page.locator('tr').filter({ hasText: 'META' }).first();
    await expect(row).toBeVisible();
    // The Open tab only shows open trades, so the presence of the direction confirms status
    await expect(row.getByText('long')).toBeVisible();

    // Navigate to trade detail → verify h1 contains 'META' (proves no ERR_ABORTED crash)
    await page.goto(`/trades/${trade.id}`, { waitUntil: 'networkidle' });
    await expect(page.locator('h1')).toContainText('META');

    // Verify Add Exit button is visible
    await expect(page.getByRole('button', { name: /add exit/i })).toBeVisible();

    // Verify lifecycle stepper shows Execute step
    await expect(page.getByText('Execute', { exact: true })).toBeVisible();

    // TradePnlCard renders (no CardHeader/CardTitle — P&L labels are inline text)
    // Label is "Unrealized P&L" when currentPrice/MTM data is available, "Realized P&L" otherwise
    await expect(page.getByText(/(Realized|Unrealized) P&L/)).toBeVisible();

    // Verify the unified History feed renders (Executions card removed in S05)
    await expect(page.locator('[data-slot="card-title"]').filter({ hasText: 'History' })).toBeVisible();

    // Add partial exit (sell, qty 50)
    const partialExitRes = await page.request.post(`/api/trades/${trade.id}/executions`, {
      data: { action: 'sell', quantity: 50, price: 600.0, fees: 2.0 },
    });
    expect(partialExitRes.status()).toBe(201);

    // Add full exit (sell, qty 50)
    const fullExitRes = await page.request.post(`/api/trades/${trade.id}/executions`, {
      data: { action: 'sell', quantity: 50, price: 610.0, fees: 2.0 },
    });
    expect(fullExitRes.status()).toBe(201);

    // Navigate to detail page → verify Closed badge
    await page.goto(`/trades/${trade.id}`, { waitUntil: 'networkidle' });
    await expect(page.locator('[data-slot="badge"]').filter({ hasText: 'Closed' }).first()).toBeVisible();
  });

  test('open trade History exposes a correction action for an execution', async ({ page }) => {
    const account = await setupAccount(page, 'E2E M019 Correction Test');
    const tradeRes = await page.request.post('/api/trades', {
      data: { symbol: 'M019CORR', direction: 'long', accountId: account.id },
    });
    expect(tradeRes.ok()).toBeTruthy();
    const trade = await tradeRes.json();

    const execRes = await page.request.post(`/api/trades/${trade.id}/execute`, {
      data: {
        entryPrice: 100,
        entryQuantity: 10,
        stopPrice: 95,
        fees: 1,
      },
    });
    expect(execRes.ok()).toBeTruthy();

    await page.goto(`/trades/${trade.id}`, { waitUntil: 'networkidle' });

    const correctButton = page.getByRole('button', { name: 'Correct Buy execution' });
    await expect(correctButton).toBeVisible();
    await correctButton.click();
    await expect(page.getByRole('dialog')).toContainText('Correct Execution: M019CORR');
  });

  test('Trade Details Current Qty tracks the remaining position after a partial exit', async ({ page }) => {
    const account = await setupAccount(page, 'E2E M019 Current Quantity Test');
    const tradeRes = await page.request.post('/api/trades', {
      data: { symbol: 'M019QTY', direction: 'long', accountId: account.id },
    });
    expect(tradeRes.ok()).toBeTruthy();
    const trade = await tradeRes.json();

    const execRes = await page.request.post(`/api/trades/${trade.id}/execute`, {
      data: {
        entryPrice: 100,
        entryQuantity: 10,
        stopPrice: 95,
        fees: 1,
      },
    });
    expect(execRes.ok()).toBeTruthy();

    const exitRes = await page.request.post(`/api/trades/${trade.id}/executions`, {
      data: { action: 'sell', quantity: 4, price: 110, fees: 1 },
    });
    expect(exitRes.status()).toBe(201);

    await page.goto(`/trades/${trade.id}`, { waitUntil: 'networkidle' });

    const tradeDetails = page.locator('[data-slot="card"]').filter({
      has: page.locator('[data-slot="card-title"]', { hasText: /^Trade Details$/ }),
    });
    await expect(tradeDetails.locator('tr').filter({ hasText: 'Qty' })).toContainText('6');
  });

  test('delete a trade via API and verify removal from UI', async ({ page }) => {
    // Create a test account with full setup
    const account = await setupAccount(page, 'E2E Delete Test');

    // Create a planned trade
    const tradeRes = await page.request.post('/api/trades', {
      data: { symbol: 'M012-DEL', direction: 'long', accountId: account.id },
    });
    expect(tradeRes.ok()).toBeTruthy();
    const trade = await tradeRes.json();

    // Navigate to trade log and switch to Planned tab
    await page.goto('/trades');
    await expect(page.locator('h1')).toContainText('Trades');
    await page.getByRole('tab', { name: /planned/i }).click();

    // Verify the trade row appears
    const row = page.locator('tr').filter({ hasText: 'M012-DEL' }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });

    // Delete the trade via API (the new page has no delete button in the table).
    // D057/R027: DELETE is a planned-only soft-delete (scratch) — the response
    // message distinguishes it from the old hard-delete 'Trade deleted'.
    const delRes = await page.request.delete(`/api/trades/${trade.id}`);
    expect(delRes.ok()).toBeTruthy();
    const delBody = await delRes.json();
    expect(delBody.message).toBe('Trade scratched');

    // Verify in a fresh page so pending client navigation from the original
    // Trades tab cannot race WebKit's explicit navigation.
    const verificationPage = await page.context().newPage();
    await verificationPage.goto('/trades');
    await expect(verificationPage.locator('h1')).toContainText('Trades');
    await verificationPage.getByRole('tab', { name: /planned/i }).click();

    // M012-DEL should no longer appear in the Planned tab — the scratch flips
    // the row to status='deleted', which the Planned tab (status=planned)
    // excludes. The row itself is preserved (soft-delete, not hard-delete).
    await expect(verificationPage.locator('tr').filter({ hasText: 'M012-DEL' })).not.toBeVisible();
    await verificationPage.close();

    // The scratched trade survives the DELETE: its detail page still renders
    // (row preserved), showing the soft-deleted state instead of a 404.
    const detailPage = await page.context().newPage();
    // networkidle: the deleted-phase view is compiled on first render (webpack
    // dev) — wait for the API fetch + chunk load to settle before asserting.
    await detailPage.goto(`/trades/${trade.id}`, { waitUntil: 'networkidle' });
    await expect(detailPage.locator('h1')).toContainText('M012-DEL');
    await expect(detailPage.getByText('This trade has been deleted')).toBeVisible();
    await detailPage.close();
  });
});
