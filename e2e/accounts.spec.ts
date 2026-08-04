import { expect, test, type Page } from '@playwright/test';

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
    await expect(page).toHaveURL(/\/settings\/accounts$/);
    await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible();
    const accountLink = page.getByRole('link', { name: `Open account ${accountName}` });
    await expect(accountLink).toBeVisible();
    await accountLink.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/settings/accounts/${account.id}$`));
    await expect(page.getByRole('heading', { name: accountName })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Settings', exact: true })).toBeVisible();

    await page.goto('/accounts');
    await expect(page).toHaveURL(/\/settings\/accounts$/);
    await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible();
  });
});
