import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

test.describe('Watchlist', () => {
  test('page renders with Watchlist heading', async ({ page }) => {
    await page.goto('/watchlist');
    await expect(page.locator('h1')).toContainText('Watchlist');
  });

  test('shows table with items or empty state', async ({ page }) => {
    await page.goto('/watchlist');
    await page.waitForLoadState('networkidle');

    const tableRows = page.locator('tbody tr');
    const rowCount = await tableRows.count();
    if (rowCount === 0) {
      await expect(page.getByText('No stocks on watch')).toBeVisible();
    } else {
      await expect(tableRows.first()).toBeVisible();
    }
  });

  test('Add Symbol dialog opens, shows form, and creates an item', async ({ page }) => {
    await page.goto('/watchlist');
    await page.waitForLoadState('networkidle');

    // Click Add Symbol button
    await page.getByRole('button', { name: 'Add Symbol' }).first().click();

    // Dialog title should appear
    await expect(page.getByText('Add to Watchlist')).toBeVisible();

    // Fill the current watchlist form. Trigger direction is configured through
    // Alert Conditions rather than a second trigger-price field.
    await page.locator('#symbol').fill('META');
    await page.locator('#keyLevel').fill('500');

    // Submit with "Add" button
    await page.getByRole('button', { name: 'Add' }).click();

    // Dialog should close after successful save
    await expect(page.getByText('Add to Watchlist')).not.toBeVisible();

    // META should appear in the table (use first() in case it already exists)
    await expect(page.getByRole('cell', { name: 'META' }).first()).toBeVisible({ timeout: 5000 });
  });

  test('delete marks an item as expired via confirm dialog', async ({ page }) => {
    await page.goto('/watchlist');
    await page.waitForLoadState('networkidle');

    const rowsBefore = await page.locator('tbody tr').count();
    test.skip(rowsBefore === 0, 'no rows to delete');

    // Override confirm to auto-accept
    await page.evaluate(() => { window.confirm = () => true; });
    await page.getByRole('button', { name: 'Remove' }).first().click();

    // Wait for the success message banner after delete
    await expect(page.getByText(/removed from watchlist/i)).toBeVisible({ timeout: 5000 });
  });

  test('status filter is present and selectable', async ({ page }) => {
    await page.goto('/watchlist');
    await page.waitForLoadState('networkidle');

    const filterTrigger = page.getByRole('combobox', { name: 'Filter:' });
    await expect(filterTrigger).toBeVisible();

    await filterTrigger.click();

    const pendingOption = page.getByRole('option', { name: 'Pending' });
    await expect(pendingOption).toBeVisible();
    await pendingOption.click();

    await expect(filterTrigger).toContainText('Pending');
  });
});
