import { test, expect } from '@playwright/test';
import { resolve } from 'path';

const SEED_BACKUP_PATH = resolve(process.cwd(), 'data/settings_init.zip');

test('uploading a backup zip advances to the restore confirmation step', async ({ page }) => {
  await page.goto('/settings/backup');

  await page.getByRole('button', { name: /upload backup/i }).click();

  const modal = page.getByRole('dialog', { name: /restore backup/i });
  await expect(modal).toBeVisible();
  await expect(modal.getByText(/restore from backup/i)).toBeVisible();

  await modal.locator('input[type="file"]').setInputFiles(SEED_BACKUP_PATH);

  await expect(modal.getByRole('heading', { name: /backup uploaded\. confirm restore\./i })).toBeVisible();
  await expect(modal.getByText(/uploaded and validated successfully/i)).toBeVisible();
  await expect(modal.getByText(/schema version/i)).toBeVisible();
  await expect(modal.getByText(/tables/i)).toBeVisible();
  await expect(modal.getByRole('button', { name: /^confirm restore$/i })).toBeDisabled();

  await modal.getByLabel(/type restore to confirm/i).fill('RESTORE');
  await expect(modal.getByRole('button', { name: /^confirm restore$/i })).toBeEnabled();
});
