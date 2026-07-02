import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

test.describe('Accounts', () => {
  test('page renders with Accounts heading', async ({ page }) => {
    await page.goto('/settings/accounts');
    await expect(page.locator('h1')).toContainText('Accounts');
  });

  test('shows empty state when no accounts exist', async ({ page }) => {
    await page.goto('/settings/accounts');
    await page.waitForLoadState('networkidle');

    // Either shows empty state or table with accounts
    const emptyState = page.getByText('No accounts yet');
    const tableRows = page.locator('tbody tr');

    const rowCount = await tableRows.count();
    if (rowCount === 0) {
      await expect(emptyState).toBeVisible();
    }
  });

  test('Add Account button opens the create form', async ({ page }) => {
    await page.goto('/settings/accounts');
    await page.waitForLoadState('networkidle');

    // Click Add Account button
    await page.getByRole('button', { name: 'Add Account' }).click();

    // Form should be visible
    await expect(page.getByRole('heading', { name: 'Add Account' })).toBeVisible();

    // Form fields should exist
    await expect(page.locator('#account-name')).toBeVisible();
    await expect(page.locator('#account-broker')).toBeVisible();
    await expect(page.locator('#account-currency')).toBeVisible();

    // Cancel button should close the form
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('heading', { name: 'Add Account' })).not.toBeVisible();
  });

  test('creating a new account succeeds', async ({ page }) => {
    const uniqueName = `E2E Test ${Date.now()}`;

    await page.goto('/settings/accounts');
    await page.waitForLoadState('networkidle');

    // Click Add Account
    await page.getByRole('button', { name: 'Add Account' }).click();

    // Fill the form
    await page.locator('#account-name').fill(uniqueName);
    await page.locator('#account-broker').fill('Playwright Broker');
    await page.locator('#account-currency').fill('USD');

    // Submit
    await page.getByRole('button', { name: 'Create Account' }).click();

    // Wait for the account to appear in the table (success message is cleared
    // by React batching since resetForm() nullifies the message immediately)
    await expect(page.getByRole('cell', { name: uniqueName })).toBeVisible({ timeout: 5000 });
  });

  test('edit button opens edit form with populated data', async ({ page }) => {
    await page.goto('/settings/accounts');
    await page.waitForLoadState('networkidle');

    const tableRows = page.locator('tbody tr');
    const rowCount = await tableRows.count();
    test.skip(rowCount === 0, 'no accounts to edit');

    // Click Edit on the first row
    await page.getByRole('button', { name: 'Edit account' }).first().click();

    // Edit form should appear
    await expect(page.getByText('Edit Account')).toBeVisible();

    // Verify name field is populated
    const nameVal = await page.locator('#account-name').inputValue();
    expect(nameVal.length).toBeGreaterThan(0);

    // Cancel
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('Edit Account')).not.toBeVisible();
  });

  test('deactivate account via confirm dialog', async ({ page }) => {
    await page.goto('/settings/accounts');
    await page.waitForLoadState('networkidle');

    const deactivateButtons = page.getByRole('button', { name: 'Deactivate account' });
    const initialCount = await deactivateButtons.count();
    test.skip(initialCount === 0, 'no active accounts to deactivate');

    // Override confirm to auto-accept
    await page.evaluate(() => { window.confirm = () => true; });
    await deactivateButtons.first().click();

    // Wait for the re-fetched data after deactivation
    // Use a locator that re-queries: wait for count to decrease by 1
    await expect(async () => {
      const newCount = await deactivateButtons.count();
      expect(newCount).toBe(initialCount - 1);
    }).toPass({ timeout: 5000 });
  });

  test('creating an account with empty name shows validation error', async ({ page }) => {
    await page.goto('/settings/accounts');
    await page.waitForLoadState('networkidle');

    // Open form
    await page.getByRole('button', { name: 'Add Account' }).click();

    // Leave name empty — the Create Account button should be disabled
    await page.locator('#account-name').fill('');

    // The new page validates client-side: button is disabled when name is empty
    await expect(page.getByRole('button', { name: 'Create Account' })).toBeDisabled();
  });

  test('creating an account with risk fields succeeds', async ({ page }) => {
    const uniqueName = `Risk Account ${Date.now()}`;

    await page.goto('/settings/accounts');
    await page.waitForLoadState('networkidle');

    // Open create form
    await page.getByRole('button', { name: 'Add Account' }).click();

    // Fill basic fields
    await page.locator('#account-name').fill(uniqueName);
    await page.locator('#account-broker').fill('Risk Broker');
    await page.locator('#account-currency').fill('USD');

    // Fill risk fields
    await page.locator('#account-max-risk').fill('2');
    await page.locator('#account-default-commission').fill('1.50');
    await page.locator('#account-starting-balance').fill('25000');

    // Submit
    await page.getByRole('button', { name: 'Create Account' }).click();

    // Verify account appears in table
    await expect(page.getByRole('cell', { name: uniqueName })).toBeVisible({ timeout: 5000 });
  });

  test('edit dialog shows risk fields populated', async ({ page }) => {
    await page.goto('/settings/accounts');
    await page.waitForLoadState('networkidle');

    const tableRows = page.locator('tbody tr');
    const rowCount = await tableRows.count();
    test.skip(rowCount === 0, 'no accounts to edit');

    // Open edit dialog on the first account
    await page.getByRole('button', { name: 'Edit account' }).first().click();
    await expect(page.getByText('Edit Account')).toBeVisible();

    // Verify risk fields exist in the dialog
    await expect(page.locator('#account-max-risk')).toBeVisible();
    await expect(page.locator('#account-default-commission')).toBeVisible();
    await expect(page.locator('#account-starting-balance')).toBeVisible();

    // Cancel
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('Edit Account')).not.toBeVisible();
  });

});
