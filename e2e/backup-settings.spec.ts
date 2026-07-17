import { test, expect } from '@playwright/test';

/**
 * Seed the settings table by calling the PUT /api/settings endpoint.
 * This lets the server's own DB connection handle all writes, avoiding
 * WAL-mode visibility issues from separate test-process connections.
 */
async function seedBackupSettings(
  request: { put: (url: string, data: { data?: unknown }) => Promise<{ ok(): boolean; status(): number }> },
  overrides: {
    backupEnabled?: boolean;
    backupRetentionCount?: number;
    backupLastRunAt?: string | null;
    backupLastRunStatus?: 'success' | 'error' | null;
    startingAccountValue?: number;
    defaultCommission?: number;
    maxRiskPerTradePct?: number;
    journalStartDate?: string;
  } = {},
) {
  const payload: Record<string, unknown> = {
    startingAccountValue: overrides.startingAccountValue ?? 10000,
    defaultCommission: overrides.defaultCommission ?? 0.5,
    maxRiskPerTradePct: overrides.maxRiskPerTradePct ?? 2,
    journalStartDate: overrides.journalStartDate ?? '2024-01-01',
  };
  if (overrides.backupEnabled !== undefined) payload.backupEnabled = overrides.backupEnabled;
  if (overrides.backupRetentionCount !== undefined) payload.backupRetentionCount = overrides.backupRetentionCount;
  if (overrides.backupLastRunAt !== undefined) payload.backupLastRunAt = overrides.backupLastRunAt;
  if (overrides.backupLastRunStatus !== undefined) payload.backupLastRunStatus = overrides.backupLastRunStatus;

  const res = await request.put('/api/settings', { data: payload });
  if (!res.ok()) throw new Error(`seedBackupSettings: PUT /api/settings returned ${res.status()}`);
}

test.describe('Backup Settings UI', () => {
  test.describe.configure({ mode: 'serial' });

  test('page renders with heading and back link', async ({ page, request }) => {
    await seedBackupSettings(request);

    await page.goto('/settings/backup');
    await page.waitForLoadState('networkidle');

    // Verify heading
    await expect(page.getByRole('heading', { name: 'Backup', exact: true })).toBeVisible();

    // Verify back link points to hub
    const backLink = page.getByRole('link', { name: /back to settings/i });
    await expect(backLink).toBeVisible();
    await expect(backLink).toHaveAttribute('href', '/settings');

    // Verify the three sections are present
    await expect(page.getByRole('heading', { name: 'Status' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Automatic Backups' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Retention Count' })).toBeVisible();
  });

  test('toggle enables and disables scheduled backups', async ({ page, request }) => {
    await seedBackupSettings(request, { backupEnabled: false });

    await page.goto('/settings/backup');
    await page.waitForLoadState('networkidle');

    // Verify initial state: disabled, shows "Scheduled backups are disabled"
    const toggle = page.getByRole('switch');
    await expect(toggle).not.toBeChecked();
    await expect(page.getByText(/scheduled backups are disabled/i)).toBeVisible();

    // Click toggle to enable — wait for PUT response
    const enableRespPromise = page.waitForResponse(
      (r) =>
        r.url().includes('/api/settings') &&
        r.request().method() === 'PUT' &&
        r.request().postDataJSON()?.backupEnabled === true,
    );
    await toggle.click();
    expect((await enableRespPromise).ok()).toBeTruthy();

    // Verify toggle is now checked and shows "will run daily"
    await expect(toggle).toBeChecked();
    await expect(page.getByText(/will run daily/i)).toBeVisible();

    // Click toggle to disable — wait for PUT response
    const disableRespPromise = page.waitForResponse(
      (r) =>
        r.url().includes('/api/settings') &&
        r.request().method() === 'PUT' &&
        r.request().postDataJSON()?.backupEnabled === false,
    );
    await toggle.click();
    expect((await disableRespPromise).ok()).toBeTruthy();

    // Verify toggle is unchecked
    await expect(toggle).not.toBeChecked();
    await expect(page.getByText(/scheduled backups are disabled/i)).toBeVisible();
  });

  test('retention count dropdown saves changes', async ({ page, request }) => {
    await seedBackupSettings(request, { backupEnabled: true, backupRetentionCount: 7 });

    await page.goto('/settings/backup');
    await page.waitForLoadState('networkidle');

    // Verify default retention value is 7
    const retentionSelect = page.locator('#retentionCount');
    await expect(retentionSelect).toHaveValue('7');

    // Change retention count to 14
    await retentionSelect.selectOption('14');

    // Click Save — wait for PUT response with backupRetentionCount: 14
    const saveRespPromise = page.waitForResponse(
      (r) =>
        r.url().includes('/api/settings') &&
        r.request().method() === 'PUT' &&
        r.request().postDataJSON()?.backupRetentionCount === 14,
    );
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    expect((await saveRespPromise).ok()).toBeTruthy();

    // Verify success message appears
    await expect(page.getByText('Retention count saved')).toBeVisible();

    // Verify value is persisted (reload from server)
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#retentionCount')).toHaveValue('14');
  });

  test('status indicator shows last run info from settings', async ({ page, request }) => {
    await seedBackupSettings(request, {
      backupEnabled: true,
      backupRetentionCount: 7,
      backupLastRunAt: '2026-07-15T15:00:00.000Z',
      backupLastRunStatus: 'success',
    });

    await page.goto('/settings/backup');
    await page.waitForLoadState('networkidle');

    // Verify last run status shows the green dot (success)
    const lastRunRow = page.getByText('Last Run').locator('..');
    await expect(lastRunRow).toBeVisible();
    // UTC 15:00 = 11:00 AM ET, 8:00 AM PT — always Jul 15 in any US timezone
    await expect(page.getByText(/Jul 15/)).toBeVisible();

    // Verify green dot is present — CircleCheck icon (emerald/green)
    await expect(page.locator('svg.text-emerald-500')).toBeVisible();
  });

  test('status indicator shows Never and gray dot with no backup history', async ({ page, request }) => {
    await seedBackupSettings(request, {
      backupEnabled: false,
      backupRetentionCount: 7,
      backupLastRunAt: null,
      backupLastRunStatus: null,
    });

    await page.goto('/settings/backup');
    await page.waitForLoadState('networkidle');

    // Verify Last Run shows "Never"
    await expect(page.getByText('Never')).toBeVisible();

    // Verify gray dot is present — HelpCircle icon (zinc/gray)
    await expect(page.locator('svg.text-zinc-300')).toBeVisible();

    // Verify Next Scheduled Run shows "—" when disabled
    await expect(page.getByText('—')).toBeVisible();
  });

  test('navigation from Settings hub card works', async ({ page, request }) => {
    await seedBackupSettings(request);

    // Navigate to Settings hub
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // Click the Data & Backups card → lands on data-and-backups sub-hub
    await page.getByRole('link', { name: /data.*backups/i }).click();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/settings\/data-and-backups$/);

    // Click the Backup card on the sub-hub → lands on the backup page
    await page.getByRole('link', { name: 'Backup' }).click();
    await page.waitForLoadState('networkidle');

    // Verify we landed on the backup page
    await expect(page).toHaveURL(/\/settings\/backup$/);
    await expect(page.getByRole('heading', { name: 'Backup', exact: true })).toBeVisible();
  });

  test('toggle reverts on API failure', async ({ page, request }) => {
    await seedBackupSettings(request, { backupEnabled: false });

    await page.goto('/settings/backup');
    await page.waitForLoadState('networkidle');

    const toggle = page.getByRole('switch');
    await expect(toggle).not.toBeChecked();

    // Block the PUT /api/settings to simulate a failure
    await page.route('**/api/settings', async (route) => {
      if (route.request().method() === 'PUT') {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Simulated server error' }),
        });
      } else {
        await route.continue();
      }
    });

    // Click toggle — the revert logic should set it back to unchecked
    await toggle.click();

    // Wait a beat for the error handling to complete
    await page.waitForTimeout(500);

    // Verify toggle reverted (still unchecked)
    await expect(toggle).not.toBeChecked();

    // Verify error message is visible (server returns err.error from 500 response body)
    await expect(page.getByText('Simulated server error')).toBeVisible();

    // Cleanup: remove the route interception
    await page.unroute('**/api/settings');
  });

  test('page loads gracefully without settings row', async ({ page }) => {
    // No seeding — page should handle missing settings row gracefully

    await page.goto('/settings/backup');
    await page.waitForLoadState('networkidle');

    // The status section should appear even without settings data
    await expect(page.getByRole('heading', { name: 'Backup', exact: true })).toBeVisible();
    await expect(page.getByText('Status')).toBeVisible();
    await expect(page.getByText('Automatic Backups')).toBeVisible();

    // The toggle should default to unchecked
    const toggle = page.getByRole('switch');
    await expect(toggle).not.toBeChecked();

    // The retention count defaults to 7
    await expect(page.locator('#retentionCount')).toHaveValue('7');
  });
});
