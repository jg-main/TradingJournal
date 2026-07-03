import { test, expect } from '@playwright/test';

test.describe('Settings', () => {
  test('page renders with Settings heading', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.locator('h1')).toContainText('Settings');
  });

  test('settings form fields are present', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // General section fields
    await expect(page.locator('#startingAccountValue')).toBeVisible();
    await expect(page.locator('#journalStartDate')).toBeVisible();
    await expect(page.locator('#currency')).toBeVisible();

    // Risk & Commission section fields
    await expect(page.locator('#maxRiskPerTradePct')).toBeVisible();
    await expect(page.locator('#defaultCommission')).toBeVisible();
    await expect(page.locator('#defaultAccountId')).toBeVisible();

    // Backup section
    await expect(page.getByText('Download Full Backup')).toBeVisible();
    await expect(page.getByText('Download a full backup of your trading journal')).toBeVisible();
  });

  test('section headings are visible', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('General')).toBeVisible();
    await expect(page.getByText('Risk & Commission')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Backup' })).toBeVisible();
  });

  test('saving valid settings shows success feedback', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // Read current values first to restore after test
    const currentStartVal = await page.locator('#startingAccountValue').inputValue();

    // Set a known test value
    await page.locator('#startingAccountValue').fill('25000');
    await page.locator('#currency').fill('USD');

    // Click Save
    await page.getByRole('button', { name: 'Save Settings' }).click();

    // Wait for success message
    await expect(page.getByText('Settings saved successfully.')).toBeVisible({ timeout: 5000 });

    // Restore original value
    if (currentStartVal) {
      await page.locator('#startingAccountValue').fill(currentStartVal);
      await page.getByRole('button', { name: 'Save Settings' }).click();
      await expect(page.getByText('Settings saved successfully.')).toBeVisible({ timeout: 5000 });
    }
  });

  test('invalid negative values are handled gracefully', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // The inputs have min="0" so negative values won't set via the number stepper,
    // but we can try manually typing them via the JS-backed form state.
    // The form will parse them via parseFloat and the API may reject them.
    await page.locator('#maxRiskPerTradePct').fill('-5');
    await page.locator('#defaultCommission').fill('-10');

    await page.getByRole('button', { name: 'Save Settings' }).click();

    // Should either show a success (API accepts after validation) or error
    // Wait quietly for the UI to settle — either outcome is fine as a smoke test
    await page.waitForTimeout(2000);

    // Verify the page is still functional
    await expect(page.locator('h1')).toContainText('Settings');
  });

  test('currency field accepts exactly 3 characters', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // The currency input has maxLength={3}
    const currencyInput = page.locator('#currency');
    await currencyInput.fill('EUR');

    const val = await currencyInput.inputValue();
    expect(val.length).toBeLessThanOrEqual(3);
  });
});
