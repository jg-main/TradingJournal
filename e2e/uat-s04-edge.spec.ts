import { test, expect } from '@playwright/test';

test('/checks renders defaults after localStorage clear', async ({ page }) => {
  await page.goto('/checks');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForLoadState('networkidle');

  // H1 should render
  await expect(page.locator('h1')).toContainText('Checks & Validation');

  // Tab buttons visible
  const checklistsBtn = page.getByRole('button', { name: 'Pre-Trade Checklists' });
  const validationBtn = page.getByRole('button', { name: 'Validation Rules' });
  await expect(checklistsBtn).toBeVisible();
  await expect(validationBtn).toBeVisible();

  // Click checklists tab and count templates using getByText
  await checklistsBtn.click();
  await page.waitForTimeout(500);

  // Template names appear as visible text in CardTitle
  await expect(page.getByText('Standard Pre-Trade', { exact: false })).toBeVisible();
  await expect(page.getByText('Earnings Play', { exact: false })).toBeVisible();
  await expect(page.getByText('OCO Bracket', { exact: false })).toBeVisible();
  console.log('All 3 default templates visible');

  // Also verify no empty state is shown
  await expect(page.getByText('No checklists configured')).not.toBeVisible();
  console.log('Empty state not shown (templates loaded)');

  // Click validation rules tab and count all 8 rule names
  await validationBtn.click();
  await page.waitForTimeout(500);

  const ruleNames = [
    'Max Risk Per Trade',
    'Minimum Reward-to-Risk Ratio',
    'Position Size Limit',
    'Stop Distance from Entry',
    'Direction-Action Consistency',
    'R-Multiple Positive Expectancy',
    'Open Quantity Integrity',
    'Fees Included in P&L',
  ];
  for (const name of ruleNames) {
    await expect(page.getByText(name, { exact: false })).toBeVisible();
  }
  console.log('All 8 validation rules visible');

  // Verify summary card shows correct counts
  await expect(page.getByText('2 Error rules')).toBeVisible();
  await expect(page.getByText('2 Warning rules')).toBeVisible();
  await expect(page.getByText('4 Info rules')).toBeVisible();
  console.log('Summary counts verified: 2 Error, 2 Warning, 4 Info');

  // Verify no blank page
  const bodyText = await page.locator('body').textContent();
  expect(bodyText).toContain('Checks & Validation');
  console.log('EDGE_RESULT: PASS');
});
