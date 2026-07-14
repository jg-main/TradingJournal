import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import * as schema from '@/db/schema';

const DB_FILE = process.env.DB_FILE_NAME ?? './.trading-journal/journal.db';

function openDb() {
  mkdirSync(dirname(resolve(DB_FILE)), { recursive: true });
  const sqlite = new Database(resolve(DB_FILE));
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: resolve('src/db/migrations') });
  return sqlite;
}

function resetReadinessState() {
  const db = openDb();

  // Temporarily disable FK checks during bulk cleanup since parallel workers
  // may have rows in trades/account_transactions/etc referencing these tables
  db.pragma('foreign_keys = OFF');
  db.exec(`
    DELETE FROM settings;
    DELETE FROM app_profile;
    DELETE FROM accounts;
    DELETE FROM setup_definitions;
    DELETE FROM lookup_values WHERE type = 'setup';
  `);

  // Force WAL checkpoint so the dev server's connection sees the deletes
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.close();
}

test.describe('Settings', () => {
  test('page renders with Settings heading', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.locator('h1')).toContainText('Settings');
  });

  test.describe('first-run checklist', () => {
    test('first-run checklist exposes a continue path and refreshes after a risk save', async ({ page }) => {
      // Reset readiness tables at test start so the DB is clean regardless of
      // what other specs left behind. This is the same WAL-isolated
      // resetReadinessState pattern used by the m011 spec, applied here so the
      // settings spec is self-cleaning (the original bug was relying on other
      // specs to leave a clean DB).
      resetReadinessState();

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
      await expect(continueLink).toHaveAttribute('href', '/settings/risk');

      await continueLink.click();
      await expect(page).toHaveURL(/\/settings\/risk$/);

      await page.locator('#startingAccountValue').fill('25000');
      await page.locator('#defaultCommission').fill('0.5');
      await page.locator('#maxRiskPerTradePct').fill('1.5');
      await page.locator('#journalStartDate').fill('2025-01-01');

      // Wait for the save API response before checking the redirect
      const saveRespPromise = page.waitForResponse(
        (r) => r.url().includes('/api/settings') && r.request().method() === 'PUT',
      );
      await page.getByRole('button', { name: 'Save Risk Settings' }).click();
      expect((await saveRespPromise).ok()).toBeTruthy();

      await expect(page).toHaveURL(/\/settings$/);
      await page.waitForLoadState('networkidle');
      await expect(page.getByRole('link', { name: /continue setup/i })).toHaveAttribute('href', '/settings/accounts');
    });
  });

  test.describe('Danger Zone reset flow', () => {
    test('full reset flow from Danger Zone button to setup checklist', async ({ page }) => {
      // Reset readiness tables at test start
      resetReadinessState();

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

      // Navigate to Settings
      await page.goto('/settings');
      await page.waitForLoadState('networkidle');

      // Verify Danger Zone section is visible
      await expect(page.getByText('Danger Zone')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Reset Journal' })).toBeVisible();

      // Open reset dialog
      await page.getByRole('button', { name: 'Reset Journal' }).click();

      // Verify dialog is visible with Factory Reset heading
      const resetDialog = page.getByRole('dialog', { name: 'Factory reset' });
      await expect(resetDialog).toBeVisible();
      await expect(
        resetDialog.getByRole('heading', { name: 'Factory Reset' }),
      ).toBeVisible();
      await expect(resetDialog.getByText('Download Backup')).toBeVisible();

      // Click Download Backup — the onClick sets backupDownloaded = true
      // The browser also triggers a download via the <a download> attribute.
      // We catch the download event gracefully; success in our test is the
      // state change, not the file landing on disk.
      const downloadPromise = page
        .waitForEvent('download', { timeout: 5000 })
        .catch(() => null);
      await page.getByText('Download Backup').click();
      await downloadPromise;

      // Verify backup downloaded indicator appears
      await expect(
        page.getByText('I have downloaded and saved a backup'),
      ).toBeVisible();

      // Click Next to advance to confirm step
      await resetDialog.getByRole('button', { name: 'Next' }).click();

      // Verify confirm step and type RESET
      await expect(
        page.getByPlaceholder('Type RESET to confirm'),
      ).toBeVisible();
      await page.getByPlaceholder('Type RESET to confirm').fill('RESET');

      // Click Confirm Reset
      await resetDialog.getByRole('button', { name: 'Confirm Reset' }).click();

      // Wait for success state (RESET sent, 17 tables wiped)
      await expect(resetDialog.getByText('Reset Complete')).toBeVisible({
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
      resetReadinessState();

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

      // Navigate to Settings
      await page.goto('/settings');
      await page.waitForLoadState('networkidle');

      // Download backup ZIP for restore source
      const response = await page.request.get('/api/backup');
      expect(response.ok()).toBeTruthy();
      const zipBuffer = await response.body();

      // Click Restore button (the non-Link card in the grid)
      await page.locator('button').filter({ has: page.locator('h2:text-is("Restore")') }).click();

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

      // Wait for preview step after upload completes
      await expect(restoreDialog.getByText('Backup Preview')).toBeVisible({ timeout: 5000 });

      // Verify the table with row counts is visible
      await expect(restoreDialog.locator('table')).toBeVisible();

      // Advance to confirm by clicking "Restore" in preview footer
      // Use .last() because the close button's aria-label also contains "Restore" as a substring
      await restoreDialog.getByRole('button', { name: 'Restore' }).last().click();

      // Confirm step: verify warning text
      await expect(restoreDialog.getByText(/permanently replace ALL existing data/i)).toBeVisible();

      // Type RESTORE to confirm
      await restoreDialog.getByPlaceholder('Type RESTORE to confirm').fill('RESTORE');

      // Click Confirm Restore
      await restoreDialog.getByRole('button', { name: 'Confirm Restore' }).click();

      // Verify success state
      await expect(restoreDialog.getByText('Restore Complete')).toBeVisible({ timeout: 10000 });
    });

    test('showOpenFilePicker success path', async ({ page, browserName }) => {
      test.skip(browserName !== 'chromium', 'showOpenFilePicker is Chromium-only');

      // Seed prerequisite data so the backup API returns content
      resetReadinessState();

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

      // Download a fresh backup ZIP to provide as mock file data
      const response = await page.request.get('/api/backup');
      expect(response.ok()).toBeTruthy();
      const zipBuffer = Buffer.from(await response.body());
      const base64Zip = zipBuffer.toString('base64');

      // Click Upload Backup to open the restore dialog
      await page.getByRole('button', { name: 'Upload Backup' }).click();

      // Scope to the dialog
      const restoreDialog = page.getByRole('dialog', { name: 'Restore backup' });
      await expect(restoreDialog).toBeVisible();

      // Mock showOpenFilePicker to return a valid File wrapping the backup ZIP data
      await page.evaluate(async (b64) => {
        const binaryStr = atob(b64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).showOpenFilePicker = async () => {
          const file = new File([bytes], 'test-backup.zip', { type: 'application/zip' });
          return [{ getFile: async () => file }];
        };
      }, base64Zip);

      // Click the upload area — handleChooseFile will call the mocked showOpenFilePicker
      // Use getByRole('button') instead of getByText to avoid ambiguity with the
      // description paragraph that also contains "choose a backup ZIP file"
      await restoreDialog.getByRole('button', { name: /choose/i }).click();

      // The modal should advance to the confirm step (preview API succeeded)
      await expect(restoreDialog.getByPlaceholder('Type RESTORE to confirm')).toBeVisible({ timeout: 10000 });
    });

    test('showOpenFilePicker exception via hidden input fallback', async ({ page, browserName }) => {
      test.skip(browserName !== 'chromium', 'showOpenFilePicker is Chromium-only');

      // Seed prerequisite data so the backup API returns content
      resetReadinessState();

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

      // Download a fresh backup ZIP to provide as the file via the hidden input fallback
      const response = await page.request.get('/api/backup');
      expect(response.ok()).toBeTruthy();
      const zipBuffer = Buffer.from(await response.body());

      // Click Upload Backup to open the restore dialog
      await page.getByRole('button', { name: 'Upload Backup' }).click();

      // Scope to the dialog
      const restoreDialog = page.getByRole('dialog', { name: 'Restore backup' });
      await expect(restoreDialog).toBeVisible();

      // Mock showOpenFilePicker to throw (simulating Brave Shields blocking the permission).
      // handleChooseFile catches non-AbortError exceptions and falls through to the
      // hidden input fallback (fileInputRef.current.click()).
      await page.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).showOpenFilePicker = async () => {
          throw new Error('Browser blocked the File System Access API');
        };
      });

      // Click the upload area — handleChooseFile will call the mocked showOpenFilePicker,
      // it throws, then falls through to fileInputRef.current.click() which opens
      // the native file picker.
      const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 5000 });
      await restoreDialog.getByRole('button', { name: /choose/i }).click();
      const fileChooser = await fileChooserPromise;
      await fileChooser.setFiles({
        name: 'test-backup.zip',
        mimeType: 'application/zip',
        buffer: zipBuffer,
      });

      // The bridge picks up the file and calls previewSelectedFile which uploads
      // to /api/restore/preview. On success the modal advances to confirm.
      await expect(restoreDialog.getByPlaceholder('Type RESTORE to confirm')).toBeVisible({ timeout: 10000 });
    });

    test('preview API error shows error step with role=alert', async ({ page }) => {
      // This test works in ALL browsers. We mock showOpenFilePicker to throw
      // so the component falls through to the hidden input fallback
      // (fileInputRef.current.click()) regardless of whether the real
      // showOpenFilePicker exists in the browser.

      // Seed prerequisite data so the app is in a valid state
      resetReadinessState();

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

      // Mock showOpenFilePicker to throw so we always hit the hidden input
      // fallback (fileInputRef.current.click()) regardless of browser.
      await page.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).showOpenFilePicker = async () => {
          throw new Error('Browser blocked the File System Access API');
        };
      });

      // Click the upload button to trigger handleChooseFile.
      // The mocked showOpenFilePicker throws, handleChooseFile catches it,
      // and falls through to fileInputRef.current.click(), which triggers
      // the filechooser event.
      const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 5000 });
      await restoreDialog.getByRole('button', { name: /choose/i }).click();
      const fileChooser = await fileChooserPromise;

      // Upload an invalid file (plain text, not a valid ZIP) to trigger
      // a 400 rejection from POST /api/restore/preview.
      await fileChooser.setFiles({
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
      resetReadinessState();

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

      // Set up download listener before clicking the link
      const downloadPromise = page
        .waitForEvent('download', { timeout: 10000 })
        .catch(() => null);

      // Click the Export & Backup card (Next.js Link -> /api/backup)
      await page.getByRole('link', { name: /export.*backup/i }).click();

      // Verify download was triggered
      const download = await downloadPromise;
      expect(download).not.toBeNull();
      expect(download!.suggestedFilename()).toContain('trading-journal-backup');
    });
  });
});
