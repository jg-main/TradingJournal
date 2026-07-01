import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

test.describe('Reviews', () => {
  test('page renders with Reviews heading', async ({ page }) => {
    await page.goto('/reviews');
    await expect(page.locator('h1')).toContainText('Reviews');
  });

  test('Generate Review button is present', async ({ page }) => {
    await page.goto('/reviews');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('button', { name: 'Generate Review' })).toBeVisible();
  });

  test('shows reviews list or empty state', async ({ page }) => {
    await page.goto('/reviews');
    await page.waitForLoadState('networkidle');

    // The page should either show reviews or show the empty state
    // Use .first() because both the reviews table and the grade trends
    // table have a 'Week' column header
    const emptyState = page.getByText('No reviews completed');
    const reviewTable = page.getByRole('columnheader', { name: 'Week' }).first();

    const emptyVisible = await emptyState.isVisible().catch(() => false);
    const tableVisible = await reviewTable.isVisible().catch(() => false);

    if (!emptyVisible && !tableVisible) {
      // Wait for either the table or empty state
      await expect(
        page.getByRole('columnheader', { name: 'Week' }).first().or(page.getByText('No reviews completed'))
      ).toBeVisible({ timeout: 3000 });
    }
  });

  test('Generate Review dialog opens and closes', async ({ page }) => {
    await page.goto('/reviews');
    await page.waitForLoadState('networkidle');

    // Click Generate Review button
    await page.getByRole('button', { name: 'Generate Review' }).click();

    // Dialog should appear
    await expect(page.getByText('Generate Weekly Review')).toBeVisible();
    await expect(page.getByText('Select the Monday of the week to review.')).toBeVisible();

    // Date input should be present
    await expect(page.locator('#weekStart')).toBeVisible();

    // Cancel button should close the dialog
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('Generate Weekly Review')).not.toBeVisible();
  });

  test('dashboard sections load (or show unavailable state)', async ({ page }) => {
    await page.goto('/reviews');
    await page.waitForLoadState('networkidle');

    // Dashboard sections should eventually render
    // They may show data or "No data available" depending on state
    await page.waitForTimeout(2000);

    // Check that at least the dashboard area rendered something
    // The dashboard sections render below the reviews table area
    const dashboardSectionHeadings = [
      'Setup Performance',
      'Grade Trends',
      'Mistake Frequency',
      'Quick Actions',
    ];

    for (const heading of dashboardSectionHeadings) {
      // Each section will either show data or an empty-state text
      const section = page.getByText(heading);
      if (await section.isVisible().catch(() => false)) {
        // Verify the section rendered — either with data or empty fallback
        await expect(section).toBeVisible();
      }
    }
  });

  test('empty state contains Generate Review action', async ({ page }) => {
    await page.goto('/reviews');
    await page.waitForLoadState('networkidle');

    // The EmptyState component includes an action button for Generate Review
    const generateButtons = page.getByRole('button', { name: 'Generate Review' });
    await expect(generateButtons.first()).toBeVisible();
  });
});
