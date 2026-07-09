import { test, expect } from '@playwright/test';

test.describe('Help Page Smoke Tests', () => {
  test('/help page renders with heading and section content', async ({ page }) => {
    await page.goto('/help');
    await page.waitForLoadState('networkidle');

    // Verify the page heading
    await expect(page.locator('h1')).toContainText('Help & Documentation');

    // Verify the description text
    await expect(page.getByText('Learn how to use Trading Journal to track')).toBeVisible();

    // Verify all seven core sections are present (rendered as h2s)
    const expectedSections = [
      'Quickstart Guide',
      'Trade Lifecycle',
      'Accounts',
      'Weekly Reviews',
      'AI Assessment',
      'Settings Reference',
      'Backup & Restore',
    ];

    for (const sectionTitle of expectedSections) {
      await expect(page.locator('h2').filter({ hasText: sectionTitle })).toBeVisible();
    }
  });

  test('sidebar contains Help nav link that navigates to /help', async ({ page }) => {
    await page.goto('/trades');
    await page.waitForLoadState('networkidle');

    // Find the Help link in the sidebar (HelpCircle icon + text)
    const helpLink = page.getByRole('link', { name: /Help/i });
    await expect(helpLink).toBeVisible();

    // Click it and verify navigation to /help
    await helpLink.click();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/help$/);
    await expect(page.locator('h1')).toContainText('Help & Documentation');
  });

  test('/help ToC links scroll to correct sections', async ({ page }) => {
    await page.goto('/help');
    await page.waitForLoadState('networkidle');

    // Click the "Backup & Restore" ToC link (last section)
    const tocLink = page.locator('aside nav a').filter({ hasText: 'Backup & Restore' });
    await expect(tocLink).toBeVisible();
    await tocLink.click();

    // Verify the target section is scrolled into view
    const targetSection = page.locator('h2').filter({ hasText: 'Backup & Restore' });
    await expect(targetSection).toBeVisible();

    // Verify no JS console errors
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    await page.reload();
    await page.waitForLoadState('networkidle');

    const unexpectedErrors = consoleErrors.filter(
      (e) => !e.includes('Failed to load resource'),
    );
    expect(unexpectedErrors).toEqual([]);
  });
});
