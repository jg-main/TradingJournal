import { test, expect } from '@playwright/test';

test.describe('Settings migration', () => {
  test('settings hub no longer advertises Risk Settings', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('h1')).toHaveText('Settings');
    await expect(page.locator('text=Risk Settings')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Accounts' })).toBeVisible();
  });

  test('account settings flow remains the live risk-editing surface', async ({ page }) => {
    await page.goto('/settings/accounts');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('h1')).toHaveText('Accounts');
    await expect(page.getByText('Create your first trading account to start tracking performance.')).toBeVisible();

    await page.getByRole('button', { name: 'Add Account' }).click();
    await expect(page.getByRole('dialog', { name: 'Add Account' })).toBeVisible();
    await expect(page.getByLabel('Max Risk Per Trade (%)')).toBeVisible();
    await expect(page.getByLabel('Default Commission ($)')).toBeVisible();
    await expect(page.getByLabel('Starting Balance ($)')).toBeVisible();
  });

  test('legacy risk route redirects to account settings', async ({ page }) => {
    await page.goto('/settings/risk');

    await expect(page).toHaveURL(/\/settings\/accounts/);
    await expect(page.locator('h1')).toHaveText('Accounts');
  });
});
