import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

async function resetReadinessState(page: Page) {
  const response = await page.request.post('/api/reset');
  const body = await response.json();
  expect(response.ok(), JSON.stringify(body)).toBeTruthy();
}

test.describe('Settings', () => {
  test('page renders with Settings heading', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.locator('h1')).toContainText('Settings');
  });

  test.describe('first-run checklist', () => {
    test('first-run checklist exposes a continue path and refreshes after a risk save', async ({ page }) => {
      // Reset through the production maintenance path so test setup preserves
      // the same FK and immutable-ledger guarantees as the application.
      await resetReadinessState(page);

      // Seed app_profile first so the first missing step is 'settings' (risk)
      const profileRes = await page.request.put('/api/app-profile', {
        data: {
          displayName: 'Playwright Trader',
          timezone: 'America/Bogota',
          defaultCurrency: 'USD',
        },
      });
      expect(profileRes.ok()).toBeTruthy();

      await page.goto('/settings');
      await page.waitForLoadState('networkidle');

      const continueLink = page.getByRole('link', { name: /continue setup/i }).first();
      await expect(continueLink).toHaveAttribute('href', '/settings/risk-defaults');

      await continueLink.click();
      await expect(page).toHaveURL(/\/settings\/risk-defaults$/);

      await page.locator('#maxRiskPerTradePct').fill('1.5');
      await page.locator('#defaultCommission').fill('0.5');

      // Wait for the save API response before checking the redirect
      const saveRespPromise = page.waitForResponse(
        (r) => r.url().includes('/api/settings') && r.request().method() === 'PUT',
      );
      await page.getByRole('button', { name: 'Save Risk Defaults' }).click();
      expect((await saveRespPromise).ok()).toBeTruthy();

      await expect(page).toHaveURL(/\/settings$/);
      await page.waitForLoadState('networkidle');
      await expect(page.getByRole('link', { name: /continue setup/i })).toHaveAttribute('href', '/settings/accounts');
    });
  });

  test.describe('Danger Zone reset flow', () => {
    test('full reset flow from Danger Zone page to setup checklist', async ({ page }) => {
      // Reset readiness tables at test start
      await resetReadinessState(page);

      // Seed prerequisite data so readiness is fully satisfied
      const profileRes = await page.request.put('/api/app-profile', {
        data: {
          displayName: 'Test Trader',
          timezone: 'America/New_York',
          defaultCurrency: 'USD',
        },
      });
      expect(profileRes.ok()).toBeTruthy();

      const settingsRes = await page.request.put('/api/settings', {
        data: {
          startingAccountValue: 10000,
          journalStartDate: '2024-01-01',
          defaultCommission: 0.5,
          maxRiskPerTradePct: 2,
        },
      });
      expect(settingsRes.ok()).toBeTruthy();

      const accountRes = await page.request.post('/api/accounts', {
        data: {
          name: 'Test Account',
          broker: 'Test Broker',
          currency: 'USD',
          isActive: true,
        },
      });
      expect(accountRes.ok()).toBeTruthy();

      const setupRes = await page.request.post('/api/setup-definitions', {
        data: {
          name: 'Breakout',
          description: 'Breakout trade setup',
        },
      });
      expect(setupRes.ok()).toBeTruthy();

      // Navigate to the standalone Danger Zone page
      await page.goto('/settings/danger-zone');
      await page.waitForLoadState('networkidle');

      // Verify page heading and Factory Reset section are visible
      await expect(page.getByRole('heading', { name: 'Danger Zone' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Factory Reset' })).toBeVisible();

      // Click Download Backup — the onClick sets backupDownloaded = true
      // The browser also triggers a download via the <a download> attribute.
      // We catch the download event gracefully; success in our test is the
      // state change, not the file landing on disk.
      const downloadPromise = page
        .waitForEvent('download', { timeout: 5000 })
        .catch(() => null);
      await page.getByRole('link', { name: 'Download Backup', exact: true }).click();
      await downloadPromise;

      // Verify backup downloaded indicator appears
      await expect(
        page.getByText('I have downloaded and saved a backup'),
      ).toBeVisible();

      // Click Next to advance to confirm step
      await page.getByRole('button', { name: 'Next', exact: true }).click();

      // Verify confirm step and type RESET
      await expect(
        page.getByPlaceholder('Type RESET to confirm'),
      ).toBeVisible();
      await page.getByPlaceholder('Type RESET to confirm').fill('RESET');

      // Click Confirm Reset
      const resetResponsePromise = page.waitForResponse(
        (response) => response.url().endsWith('/api/reset') && response.request().method() === 'POST',
      );
      await page.getByRole('button', { name: 'Confirm Reset' }).click();
      const resetResponse = await resetResponsePromise;
      const resetBody = await resetResponse.json();
      expect(resetResponse.ok(), JSON.stringify(resetBody)).toBeTruthy();

      // Wait for success state (RESET sent, data wiped)
      await expect(page.getByText('Reset Complete')).toBeVisible({
        timeout: 10000,
      });

      // Wait for redirect to dashboard (2s delay in component, then router.push('/'))
      await page.waitForURL('/', { timeout: 10000 });

      // Navigate to /settings to verify the setup checklist appears
      await page.goto('/settings');
      await page.waitForLoadState('networkidle');

      // Verify setup checklist appears (readiness is now false)
      await expect(page.getByText('Setup your journal')).toBeVisible();
    });
  });

  test.describe('Restore flow', () => {
    test.describe.configure({ mode: 'serial' });

    test('full restore flow from button upload to success', async ({ page }) => {
      await resetReadinessState(page);

      // Seed prerequisite data
      const profileRes = await page.request.put('/api/app-profile', {
        data: {
          displayName: 'Test Trader',
          timezone: 'America/New_York',
          defaultCurrency: 'USD',
        },
      });
      expect(profileRes.ok()).toBeTruthy();

      const settingsRes = await page.request.put('/api/settings', {
        data: {
          startingAccountValue: 10000,
          journalStartDate: '2024-01-01',
          defaultCommission: 0.5,
          maxRiskPerTradePct: 2,
        },
      });
      expect(settingsRes.ok()).toBeTruthy();

      const accountRes = await page.request.post('/api/accounts', {
        data: {
          name: 'Test Account',
          broker: 'Test Broker',
          currency: 'USD',
          isActive: true,
        },
      });
      expect(accountRes.ok()).toBeTruthy();

      const setupRes = await page.request.post('/api/setup-definitions', {
        data: {
          name: 'Breakout',
          description: 'Breakout trade setup',
        },
      });
      expect(setupRes.ok()).toBeTruthy();

      // Download backup ZIP for restore source
      const response = await page.request.get('/api/backup');
      expect(response.ok()).toBeTruthy();
      const zipBuffer = await response.body();

      // Navigate to Backup page (Restore is now accessed via Backup)
      await page.goto('/settings/backup');
      await page.waitForLoadState('networkidle');

      // Click Upload Backup button to open restore dialog
      await page.getByRole('button', { name: /upload backup/i }).click();

      // Scope all further locators to the dialog
      const restoreDialog = page.getByRole('dialog', { name: 'Restore backup' });
      await expect(restoreDialog).toBeVisible();

      // Upload step: set the ZIP file on the sr-only input
      // Try direct setInputFiles first; fall back to fileChooser if needed
      try {
        await restoreDialog.locator('input[type="file"]').setInputFiles({
          name: 'test-backup.zip',
          mimeType: 'application/zip',
          buffer: zipBuffer,
        });
      } catch {
        // Fallback: click the label text to trigger browser file chooser
        const fileChooserPromise = page.waitForEvent('filechooser');
        await restoreDialog.getByText('Choose a backup ZIP file').click();
        const fileChooser = await fileChooserPromise;
        await fileChooser.setFiles({
          name: 'test-backup.zip',
          mimeType: 'application/zip',
          buffer: zipBuffer,
        });
      }

      // Successful preview now advances directly to the confirmation step.
      await expect(restoreDialog.getByText(/permanently replace ALL existing data/i)).toBeVisible();
      await expect(restoreDialog.getByText('Backup date')).toBeVisible();

      // Type RESTORE to confirm
      await restoreDialog.getByPlaceholder('Type RESTORE to confirm').fill('RESTORE');

      // Click Confirm Restore
      const restoreResponsePromise = page.waitForResponse(
        (response) => response.url().endsWith('/api/restore') && response.request().method() === 'POST',
      );
      await restoreDialog.getByRole('button', { name: 'Confirm Restore' }).click();
      const restoreResponse = await restoreResponsePromise;
      const restoreBody = await restoreResponse.json();
      expect(restoreResponse.ok(), JSON.stringify(restoreBody)).toBeTruthy();

      // Verify success state
      await expect(restoreDialog.getByText('Restore Complete')).toBeVisible({ timeout: 10000 });
    });

    test('preview API error shows error step with role=alert', async ({ page }) => {
      // Seed prerequisite data so the app is in a valid state
      await resetReadinessState(page);

      const profileRes = await page.request.put('/api/app-profile', {
        data: {
          displayName: 'Test Trader',
          timezone: 'America/New_York',
          defaultCurrency: 'USD',
        },
      });
      expect(profileRes.ok()).toBeTruthy();

      const settingsRes = await page.request.put('/api/settings', {
        data: {
          startingAccountValue: 10000,
          journalStartDate: '2024-01-01',
          defaultCommission: 0.5,
          maxRiskPerTradePct: 2,
        },
      });
      expect(settingsRes.ok()).toBeTruthy();

      const accountRes = await page.request.post('/api/accounts', {
        data: {
          name: 'Test Account',
          broker: 'Test Broker',
          currency: 'USD',
          isActive: true,
        },
      });
      expect(accountRes.ok()).toBeTruthy();

      const setupRes = await page.request.post('/api/setup-definitions', {
        data: {
          name: 'Breakout',
          description: 'Breakout trade setup',
        },
      });
      expect(setupRes.ok()).toBeTruthy();

      // Navigate to /settings/backup to access the Upload Backup button
      await page.goto('/settings/backup');
      await page.waitForLoadState('networkidle');

      // Click Upload Backup to open the restore dialog
      await page.getByRole('button', { name: 'Upload Backup' }).click();

      // Scope to the dialog
      const restoreDialog = page.getByRole('dialog', { name: 'Restore backup' });
      await expect(restoreDialog).toBeVisible();

      // Upload an invalid file (plain text, not a valid ZIP) to trigger
      // a 400 rejection from POST /api/restore/preview.
      await restoreDialog.locator('input[type="file"]').setInputFiles({
        name: 'invalid-backup.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('This is not a valid ZIP file'),
      });

      // Wait for the error step with role='alert' to appear.
      // The component calls setStep('error') when the preview API returns
      // a non-OK response, which renders a <div role="alert">.</div>
      await expect(restoreDialog.locator('[role="alert"]')).toBeVisible({ timeout: 10000 });

      // Verify the error message mentions the invalid backup
      // Use .first() because both <h2>Restore Failed</h2> and <span>Invalid backup file</span>
      // match the regex, causing Playwright's strict mode violation.
      await expect(restoreDialog.getByText(/invalid|failed/i).first()).toBeVisible();
    });
  });

  test.describe('Backup download', () => {
    test.describe.configure({ mode: 'serial' });

    test('downloads backup ZIP via Export and Backup card', async ({ page }) => {
      await resetReadinessState(page);

      // Seed prerequisite data so backup has content
      const profileRes = await page.request.put('/api/app-profile', {
        data: {
          displayName: 'Test Trader',
          timezone: 'America/New_York',
          defaultCurrency: 'USD',
        },
      });
      expect(profileRes.ok()).toBeTruthy();

      const settingsRes = await page.request.put('/api/settings', {
        data: {
          startingAccountValue: 10000,
          journalStartDate: '2024-01-01',
          defaultCommission: 0.5,
          maxRiskPerTradePct: 2,
        },
      });
      expect(settingsRes.ok()).toBeTruthy();

      const accountRes = await page.request.post('/api/accounts', {
        data: {
          name: 'Test Account',
          broker: 'Test Broker',
          currency: 'USD',
          isActive: true,
        },
      });
      expect(accountRes.ok()).toBeTruthy();

      const setupRes = await page.request.post('/api/setup-definitions', {
        data: {
          name: 'Breakout',
          description: 'Breakout trade setup',
        },
      });
      expect(setupRes.ok()).toBeTruthy();

      // Navigate to Settings
      await page.goto('/settings');
      await page.waitForLoadState('networkidle');

      // Backup is a first-class Settings domain.
      await page.getByRole('link', { name: 'Backup' }).click();
      await page.waitForLoadState('networkidle');

      // Wait for backup page to load
      await expect(page).toHaveURL(/\/settings\/backup$/);

      // Set up download listener before clicking the download button
      const downloadPromise = page
        .waitForEvent('download', { timeout: 10000 })
        .catch(() => null);

      // Click Download Backup button on the backup page
      await page.getByRole('button', { name: /download backup/i }).click();

      // Verify download was triggered
      const download = await downloadPromise;
      expect(download).not.toBeNull();
      expect(download!.suggestedFilename()).toContain('trading-journal-backup');
    });
  });
});
