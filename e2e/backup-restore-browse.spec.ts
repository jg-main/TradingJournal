import { test, expect } from '@playwright/test';
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';

/**
 * Seed the settings table and backup directory.
 *
 * Creates a mock scheduled backup file in the backup directory (derived from
 * DB_FILE_NAME) so the GET /api/backup/files endpoint returns entries and the
 * browse tab has data to display.
 */
const DB_FILE = process.env.DB_FILE_NAME ?? './.trading-journal/journal.db';
const BACKUP_DIR = join(dirname(DB_FILE), 'backups');
const SOURCE_BACKUP_PATH = join(
  process.cwd(),
  'data',
  'trading-journal-backup-2026-07-29.zip',
);

const SEED_BACKUP_FILENAME = 'backup-2026-07-15T14-00-00-000Z.zip';
const SEED_BACKUP_PATH = join(BACKUP_DIR, SEED_BACKUP_FILENAME);

async function seedBackupSettings(
  request: { put: (url: string, data: { data?: unknown }) => Promise<{ ok(): boolean }> },
  overrides: { backupEnabled?: boolean; backupRetentionCount?: number } = {},
) {
  const res = await request.put('/api/settings', {
    data: {
      startingAccountValue: 10000,
      defaultCommission: 0.5,
      maxRiskPerTradePct: 2,
      journalStartDate: '2024-01-01',
      backupEnabled: overrides.backupEnabled ?? true,
      backupRetentionCount: overrides.backupRetentionCount ?? 7,
    },
  });
  if (!res.ok()) throw new Error(`seedBackupSettings: PUT /api/settings failed`);
}

test.describe('RestoreModal — Browse Scheduled Backups', () => {
  test.beforeAll(async () => {
    // Create backup directory and seed a test backup file
    mkdirSync(BACKUP_DIR, { recursive: true });
    if (existsSync(SOURCE_BACKUP_PATH)) {
      copyFileSync(SOURCE_BACKUP_PATH, SEED_BACKUP_PATH);
      console.log(`[seed] Copied backup fixture → ${SEED_BACKUP_PATH}`);
    } else if (!existsSync(SEED_BACKUP_PATH)) {
      // The committed fixture is absent — generate a REAL backup through the
      // running server (the same pipeline /api/backup/now uses) and rename it
      // to the canonical seeded filename so the browse tab lists a valid
      // backup without depending on a binary fixture in the repo.
      const port = process.env.PLAYWRIGHT_PORT ?? '31000';
      const settingsRes = await fetch(`http://localhost:${port}/api/settings`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          startingAccountValue: 10000,
          defaultCommission: 0.5,
          maxRiskPerTradePct: 2,
          journalStartDate: '2024-01-01',
          backupEnabled: true,
          backupRetentionCount: 7,
        }),
      });
      if (settingsRes.ok) {
        await fetch(`http://localhost:${port}/api/backup/now`, { method: 'POST' });
      }
      const zipFiles = existsSync(BACKUP_DIR)
        ? readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.zip')).sort()
        : [];
      const newest = zipFiles[zipFiles.length - 1];
      if (newest && !existsSync(SEED_BACKUP_PATH)) {
        renameSync(join(BACKUP_DIR, newest), SEED_BACKUP_PATH);
        console.log(`[seed] Generated real backup → ${SEED_BACKUP_PATH}`);
      }
    }
  });

  test.beforeEach(() => {
    // Re-seed backup file before each test (parallel-safe)
    mkdirSync(BACKUP_DIR, { recursive: true });
    if (existsSync(SOURCE_BACKUP_PATH) && !existsSync(SEED_BACKUP_PATH)) {
      copyFileSync(SOURCE_BACKUP_PATH, SEED_BACKUP_PATH);
      console.log(`[seed] Re-seeded ${SEED_BACKUP_PATH}`);
    }
  });

  test.afterAll(() => {
    // Cleanup seeded backup file
    try {
      if (existsSync(SEED_BACKUP_PATH)) {
        unlinkSync(SEED_BACKUP_PATH);
        console.log(`[cleanup] Removed ${SEED_BACKUP_PATH}`);
      }
    } catch {
      // Non-fatal cleanup
    }
  });

  test('RestoreModal opens and shows browse tab with uploaded tab default', async ({ page, request }) => {
    await seedBackupSettings(request);

    // Navigate directly to /settings/backup and open the RestoreModal via Upload Backup
    await page.goto('/settings/backup');
    await page.waitForLoadState('networkidle');

    // Click Upload Backup to open the RestoreModal
    await page.getByRole('button', { name: /upload backup/i }).click();

    // Verify modal is open
    const modal = page.getByRole('dialog', { name: /restore backup/i });
    await expect(modal).toBeVisible();

    // Verify the tab bar is visible with both tabs
    await expect(modal.getByRole('button', { name: /upload a backup file/i })).toBeVisible();
    await expect(modal.getByRole('button', { name: /browse scheduled backups/i })).toBeVisible();

    // Default tab should be "upload" — verify upload heading is visible
    await expect(modal.getByText(/restore from backup/i)).toBeVisible();

    // Close the modal
    await modal.getByRole('button', { name: /close restore modal/i }).click();
    await expect(modal).not.toBeVisible();
  });

  test('browse tab switches and lists backup files', async ({ page, request }) => {
    await seedBackupSettings(request);

    // Navigate directly to /settings/backup and open the RestoreModal
    await page.goto('/settings/backup');
    await page.waitForLoadState('networkidle');

    // Click Upload Backup to open the RestoreModal
    await page.getByRole('button', { name: /upload backup/i }).click();

    const modal = page.getByRole('dialog', { name: /restore backup/i });
    await expect(modal).toBeVisible();

    // Switch to browse tab
    await modal.getByRole('button', { name: /browse scheduled backups/i }).click();

    // Verify browse heading is visible
    await expect(modal.getByRole('heading', { name: /browse scheduled backups/i })).toBeVisible();

    // Verify file table renders (the seeded backup file should be listed)
    const fileTable = modal.locator('table');
    await expect(fileTable).toBeVisible({ timeout: 10000 });

    // Verify at least one backup file row exists with a Restore button
    const restoreFileButton = modal.getByRole('button', { name: /restore/i });
    await expect(restoreFileButton.first()).toBeVisible();

    // The date column should display "Jul 15, 2026"
    await expect(modal.getByText(/Jul 15/)).toBeVisible();
  });

  test('selecting a browse file advances to confirm step', async ({ page, request }) => {
    await seedBackupSettings(request);

    // Navigate directly to /settings/backup and open the RestoreModal
    await page.goto('/settings/backup');
    await page.waitForLoadState('networkidle');

    // Click Upload Backup to open the RestoreModal
    await page.getByRole('button', { name: /upload backup/i }).click();

    const modal = page.getByRole('dialog', { name: /restore backup/i });

    // Switch to browse tab
    await modal.getByRole('button', { name: /browse scheduled backups/i }).click();

    // Wait for file table to render
    await expect(modal.locator('table')).toBeVisible();

    // Click the "Restore" button on the first file row
    const restoreFileButton = modal.locator('table tbody tr').first().getByRole('button', { name: /restore/i });
    await restoreFileButton.click();

    // Should advance to confirm step — heading "Confirm Restore" is visible
    await expect(modal.getByRole('heading', { name: /confirm restore/i })).toBeVisible();

    // The RESTORE text input should be visible
    await expect(modal.getByPlaceholder(/restore/i)).toBeVisible();

    // The "Confirm Restore" button should be disabled until text is typed
    const confirmButton = modal.getByRole('button', { name: /confirm restore/i });
    await expect(confirmButton).toBeVisible();
    await expect(confirmButton).toBeDisabled();
  });

  test('back button on confirm returns to browse step', async ({ page, request }) => {
    await seedBackupSettings(request);

    // Navigate directly to /settings/backup and open the RestoreModal
    await page.goto('/settings/backup');
    await page.waitForLoadState('networkidle');

    // Open RestoreModal via Upload Backup → browse → select file → confirm
    await page.getByRole('button', { name: /upload backup/i }).click();
    const modal = page.getByRole('dialog', { name: /restore backup/i });

    await modal.getByRole('button', { name: /browse scheduled backups/i }).click();
    await expect(modal.locator('table')).toBeVisible();

    await modal.locator('table tbody tr').first().getByRole('button', { name: /restore/i }).click();
    await expect(modal.getByRole('heading', { name: /confirm restore/i })).toBeVisible();

    // Click the "Cancel" button to return to browse
    await modal.getByRole('button', { name: /cancel/i }).click();

    // Should be back on browse tab with file table visible
    await expect(modal.getByRole('heading', { name: /browse scheduled backups/i })).toBeVisible();
    await expect(modal.locator('table')).toBeVisible();
  });

  test('empty state shows when no backup files exist', async ({ page, request }) => {
    await seedBackupSettings(request);
    await page.route('**/api/backup/files', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '[]',
      });
    });

    // Navigate directly to /settings/backup and open the RestoreModal
    await page.goto('/settings/backup');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /upload backup/i }).click();
    const modal = page.getByRole('dialog', { name: /restore backup/i });

    // Switch to browse tab
    await modal.getByRole('button', { name: /browse scheduled backups/i }).click();

    // Empty state: "No scheduled backups found." should appear
    await expect(modal.getByText(/no scheduled backups found/i)).toBeVisible();
  });
});
