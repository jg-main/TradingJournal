import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

test.describe('Accounts', () => {
  test('page renders with Accounts heading', async ({ page }) => {
    await page.goto('/accounts');
    await expect(page.locator('h1')).toContainText('Accounts');
  });

  test('shows empty state when no accounts exist', async ({ page }) => {
    await page.goto('/accounts');
    await page.waitForLoadState('networkidle');

    // Either shows empty state or table with accounts
    const emptyState = page.getByText('No accounts yet.');
    const tableRows = page.locator('tbody tr');

    const rowCount = await tableRows.count();
    if (rowCount === 0) {
      await expect(emptyState).toBeVisible();
    }
  });

  test('Add Account button opens the create form', async ({ page }) => {
    await page.goto('/accounts');
    await page.waitForLoadState('networkidle');

    // Click Add Account button
    await page.getByRole('button', { name: 'Add Account' }).click();

    // Form should be visible
    await expect(page.getByText('New Account')).toBeVisible();

    // Form fields should exist
    await expect(page.locator('#name')).toBeVisible();
    await expect(page.locator('#broker')).toBeVisible();
    await expect(page.locator('#currency')).toBeVisible();

    // Cancel button should close the form
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('New Account')).not.toBeVisible();
  });

  test('creating a new account succeeds', async ({ page }) => {
    const uniqueName = `E2E Test ${Date.now()}`;

    await page.goto('/accounts');
    await page.waitForLoadState('networkidle');

    // Click Add Account
    await page.getByRole('button', { name: 'Add Account' }).click();

    // Fill the form
    await page.locator('#name').fill(uniqueName);
    await page.locator('#broker').fill('Playwright Broker');
    await page.locator('#currency').fill('USD');

    // Submit
    await page.getByRole('button', { name: 'Create' }).click();

    // Wait for the account to appear in the table (success message is cleared
    // by React batching since resetForm() nullifies the message immediately)
    await expect(page.getByRole('cell', { name: uniqueName })).toBeVisible({ timeout: 5000 });
  });

  test('edit button opens edit form with populated data', async ({ page }) => {
    await page.goto('/accounts');
    await page.waitForLoadState('networkidle');

    const tableRows = page.locator('tbody tr');
    const rowCount = await tableRows.count();
    test.skip(rowCount === 0, 'no accounts to edit');

    // Click Edit on the first row
    await page.getByRole('button', { name: 'Edit' }).first().click();

    // Edit form should appear
    await expect(page.getByText('Edit Account')).toBeVisible();

    // Verify name field is populated
    const nameVal = await page.locator('#name').inputValue();
    expect(nameVal.length).toBeGreaterThan(0);

    // Cancel
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('Edit Account')).not.toBeVisible();
  });

  test('deactivate account via confirm dialog', async ({ page }) => {
    await page.goto('/accounts');
    await page.waitForLoadState('networkidle');

    const deactivateButtons = page.getByRole('button', { name: 'Deactivate' });
    const deactivateCount = await deactivateButtons.count();
    test.skip(deactivateCount === 0, 'no active accounts to deactivate');

    // Override confirm to auto-accept
    await page.evaluate(() => { window.confirm = () => true; });
    await deactivateButtons.first().click();

    // Wait for success message
    await expect(page.getByText('Account deactivated.')).toBeVisible({ timeout: 5000 });
  });

  test('creating an account with empty name shows validation error', async ({ page }) => {
    await page.goto('/accounts');
    await page.waitForLoadState('networkidle');

    // Open form
    await page.getByRole('button', { name: 'Add Account' }).click();

    // Leave name empty and submit
    await page.locator('#name').fill('');
    await page.getByRole('button', { name: 'Create' }).click();

    // Should see validation error
    await expect(page.getByText('Account name is required.')).toBeVisible();
  });

  test('/account page renders its own heading', async ({ page }) => {
    await page.goto('/account');
    await expect(page.locator('h1')).toContainText('Account');

    // Should show the empty state with account overview description
    await expect(page.getByText('Account overview')).toBeVisible();
    await expect(page.getByText('View your account details')).toBeVisible();
  });
});
