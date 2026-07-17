import { expect, test, type Page } from '@playwright/test';

const depositAmount = '1250';
const withdrawalAmount = '325';

async function createAccount(page: Page, name: string) {
  const response = await page.request.post('/api/accounts', {
    data: {
      name,
      broker: 'Deterministic Broker',
      currency: 'USD',
    },
  });

  expect(response.status()).toBe(201);
  const account = await response.json();
  expect(account).toMatchObject({
    name,
    broker: 'Deterministic Broker',
    currency: 'USD',
  });

  // POST /api/accounts creates Draft accounts (isActive: false).
  // Activate so the account shows in the main table on the list page.
  const activateResponse = await page.request.put(`/api/accounts/${account.id}`, {
    data: { isActive: true },
  });
  expect(activateResponse.ok()).toBeTruthy();
  const activatedAccount = await activateResponse.json();

  return activatedAccount as { id: string; name: string };
}

async function createOpenTrade(page: Page, accountId: string) {
  const tradeResponse = await page.request.post('/api/trades', {
    data: {
      symbol: 'AAPL',
      direction: 'long',
      accountId,
      thesis: 'Deterministic lifecycle regression seed',
    },
  });

  expect(tradeResponse.status()).toBe(201);
  const trade = (await tradeResponse.json()) as { id: string };

  const executionResponse = await page.request.post(`/api/trades/${trade.id}/executions`, {
    data: {
      action: 'buy',
      quantity: 1,
      price: 100,
    },
  });

  expect(executionResponse.status()).toBe(201);
  return trade;
}

test.describe.configure({ mode: 'serial' });

test.describe('Accounts', () => {
  test('exposes only the canonical Settings navigation entry', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Settings', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Settings', exact: true })).toHaveAttribute('href', '/settings');
    await expect(page.getByRole('link', { name: 'Account', exact: true })).toHaveCount(0);
  });

  test('redirects the legacy /account route into Settings-owned accounts', async ({ page }) => {
    const accountName = `Settings Workflow ${Date.now()}-legacy-account-redirect`;
    const account = await createAccount(page, accountName);

    await page.goto('/account');
    await expect(page).toHaveURL(/\/settings\/accounts/);
    await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible();
    // Account name is rendered inside a clickable <TableRow>, not an <a>/<Link> element.
    // Use a cell or row locator instead of getByRole('link').
    await expect(page.getByRole('cell', { name: accountName, exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Settings', exact: true })).toBeVisible();
    expect(account.id).toBeTruthy();
  });

  test('persists deposit and withdrawal through Settings workflow', async ({ page }) => {
    const accountName = `Settings Workflow ${Date.now()}-deposit-withdrawal`;
    const account = await createAccount(page, accountName);

    await page.goto('/settings/accounts');
    await expect(page).toHaveURL(/\/settings\/accounts$/);
    await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible();
    await expect(page.getByRole('cell', { name: accountName, exact: true })).toBeVisible();

    await page.getByRole('cell', { name: accountName, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/accounts/${account.id}`));
    await expect(page.getByRole('heading', { name: accountName })).toBeVisible();
    await expect(page.getByText('Current Balance')).toBeVisible();
    await expect(page.getByText('No transactions yet.')).toBeVisible();

    await page.getByRole('button', { name: 'Add Funds' }).click();
    await page.getByLabel('Amount ($)').fill(depositAmount);
    await page.getByLabel('Notes').fill('Initial funding');
    await page.getByRole('button', { name: 'Add Funds' }).click();

    await expect(page.getByText('Deposit recorded.')).toBeVisible();
    await expect(page.locator('p').filter({ hasText: '$1,250.00' }).first()).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Deposit' })).toBeVisible();
    await expect(page.getByRole('cell', { name: '$1,250.00', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Withdraw' }).click();
    await page.getByLabel('Amount ($)').fill(withdrawalAmount);
    await page.getByLabel('Notes').fill('Risk reduction');
    await page.getByRole('button', { name: 'Withdraw' }).click();

    await expect(page.getByText('Withdrawal recorded.')).toBeVisible();
    await expect(page.locator('p').filter({ hasText: '$925.00' }).first()).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Withdrawal' })).toBeVisible();
    await expect(page.getByRole('cell', { name: '$925.00', exact: true })).toBeVisible();

    await page.reload();
    await expect(page).toHaveURL(new RegExp(`/accounts/${account.id}`));
    await expect(page.locator('p').filter({ hasText: '$925.00' }).first()).toBeVisible();
    await expect(page.getByRole('row', { name: /Deposit/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /Withdrawal/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: accountName })).toBeVisible();
  });

  test('prevents withdrawal beyond balance', async ({ page }) => {
    const accountName = `Settings Workflow ${Date.now()}-withdrawal-guard`;
    const account = await createAccount(page, accountName);

    await page.goto(`/settings/accounts/${account.id}`);
    await expect(page.getByRole('heading', { name: accountName })).toBeVisible();

    await page.getByRole('button', { name: 'Withdraw' }).click();
    await page.getByLabel('Amount ($)').fill('1');
    await page.getByRole('button', { name: 'Withdraw' }).click();

    await expect(page.getByText('Insufficient balance. Current balance: $0.00')).toBeVisible();
    await expect(page.getByText('No transactions yet.')).toBeVisible();
  });

  test('moves an account through inactive and active Settings states', async ({ page }) => {
    const accountName = `Settings Workflow ${Date.now()}-reactivate-inactive`;
    const account = await createAccount(page, accountName);

    await page.goto(`/settings/accounts/${account.id}`);
    await expect(page).toHaveURL(new RegExp(`/accounts/${account.id}`));
    await expect(page.getByRole('heading', { name: accountName })).toBeVisible();
    await expect(page.getByText('Active', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Close Account' }).click();
    await page.getByRole('button', { name: 'Confirm Close' }).click();

    await expect(page.getByText('Closed')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reactivate Account' })).toBeVisible();

    await page.goto('/settings/accounts');
    await page.getByText(/Inactive accounts/).click();
    await expect(page.getByRole('cell', { name: accountName, exact: true })).toBeVisible();
    const accountCell = page.getByRole('cell', { name: accountName, exact: true });
    await accountCell.click();
    await expect(page).toHaveURL(new RegExp(`/accounts/${account.id}`));

    await expect(page).toHaveURL(new RegExp(`/accounts/${account.id}`));
    await expect(page.getByText('Closed')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reactivate Account' })).toBeVisible();

    await page.getByRole('button', { name: 'Reactivate Account' }).click();

    await expect(page.getByText('Active', { exact: true })).toBeVisible();

    await page.goto('/settings/accounts');
    await expect(page.getByRole('cell', { name: accountName, exact: true })).toBeVisible();
  });

  test('blocks deactivate, close, and delete lifecycle actions when trades exist', async ({ page }) => {
    const accountName = `Settings Workflow ${Date.now()}-blocked-lifecycle`;
    const account = await createAccount(page, accountName);
    await createOpenTrade(page, account.id);

    await page.goto(`/settings/accounts/${account.id}`);
    await expect(page).toHaveURL(new RegExp(`/accounts/${account.id}`));
    await expect(page.getByRole('heading', { name: accountName })).toBeVisible();

    const deactivateResponse = await page.request.put(`/api/accounts/${account.id}`, {
      data: { isActive: false },
    });
    expect(deactivateResponse.status()).toBe(409);
    const deactivateBody = (await deactivateResponse.json()) as { error: string };
    expect(deactivateBody.error).toBe('Cannot deactivate account with open trades');

    await page.getByRole('button', { name: 'Close Account' }).click();
    await page.getByRole('button', { name: 'Confirm Close' }).click();
    await expect(page).toHaveURL(new RegExp(`/accounts/${account.id}`));
    await expect(page.getByText('Cannot deactivate account with open trades')).toBeVisible();

    const deleteResponse = await page.request.delete(`/api/accounts/${account.id}`);
    expect(deleteResponse.status()).toBe(409);
    const deleteBody = (await deleteResponse.json()) as { error: string };
    expect(deleteBody.error).toBe('Cannot delete account with any trade history');
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`/accounts/${account.id}`));
    await expect(page.getByRole('heading', { name: accountName })).toBeVisible();
  });

  test('cancels the Close Account dialog without state change', async ({ page }) => {
    const accountName = `Settings Workflow ${Date.now()}-cancel-close`;
    const account = await createAccount(page, accountName);

    await page.goto(`/settings/accounts/${account.id}`);
    await expect(page).toHaveURL(new RegExp(`/accounts/${account.id}`));
    await expect(page.getByText('Active', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Close Account' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('Confirm Close')).toBeVisible();

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.getByText('Active', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close Account' })).toBeVisible();
  });

  test('deletes account with no trades from the list page', async ({ page }) => {
    const accountName = `Settings Workflow ${Date.now()}-delete-no-trades`;
    await createAccount(page, accountName);

    await page.goto('/settings/accounts');
    await expect(page.getByRole('cell', { name: accountName, exact: true })).toBeVisible();

    // Target the deactivate button in THIS account's row, not the first one in the list
    const row = page.locator('tr').filter({ hasText: accountName });
    const deletePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/api/accounts') &&
        resp.request().method() === 'DELETE' &&
        resp.status() < 500,
    );
    page.on('dialog', (dialog) => dialog.accept());
    await row.locator('[title="Deactivate account"]').click();
    await deletePromise;
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('cell', { name: accountName, exact: true })).not.toBeVisible();
  });
});
