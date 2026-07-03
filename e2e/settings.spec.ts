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
});
