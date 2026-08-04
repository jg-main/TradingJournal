import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import * as schema from '@/db/schema';

const DB_FILE = process.env.DB_FILE_NAME ?? './.trading-journal/journal.db';

function wipeMarketDataSettings() {
  mkdirSync(dirname(resolve(DB_FILE)), { recursive: true });
  const sqlite = new Database(resolve(DB_FILE));
  sqlite.pragma('journal_mode = WAL');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: resolve('src/db/migrations') });

  sqlite.pragma('foreign_keys = OFF');
  sqlite.exec(`DELETE FROM market_data_settings;`);
  sqlite.pragma('wal_checkpoint(TRUNCATE)');
  sqlite.close();
}

// UI-only tests (no DB writes) run in parallel safely
test.describe('Market Data Settings — UI', () => {

  test('page renders with heading and back link', async ({ page }) => {
    await page.goto('/settings/market-data');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('h1')).toContainText('Market Data');
    await expect(page.getByRole('link', { name: /back to settings/i })).toBeVisible();
  });

  test('renders Provider Status section', async ({ page }) => {
    await page.goto('/settings/market-data');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('h2', { hasText: 'Provider Status' })).toBeVisible();
    await expect(page.locator('select').filter({ has: page.locator('option[value="clickhouse"]') })).toHaveValue('clickhouse');
  });

  test('renders ClickHouse Configuration section with all fields', async ({ page }) => {
    await page.goto('/settings/market-data');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('h2', { hasText: 'ClickHouse Configuration' })).toBeVisible();

    // All four input fields are present
    await expect(page.locator('#chHost')).toBeVisible();
    await expect(page.locator('#chPort')).toBeVisible();
    await expect(page.locator('#chUser')).toBeVisible();
    await expect(page.locator('#chDatabase')).toBeVisible();

    // Password field is present and must be password type (redaction constraint)
    await expect(page.locator('#chPassword')).toBeVisible();
    await expect(page.locator('#chPassword')).toHaveAttribute('type', 'password');
  });

  test('Save and Test Connection buttons are present', async ({ page }) => {
    await page.goto('/settings/market-data');
    await page.waitForLoadState('networkidle');

    const clickHouseSection = page.getByRole('heading', { name: 'ClickHouse Configuration' }).locator('..');
    await expect(clickHouseSection.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
    await expect(clickHouseSection.getByRole('button', { name: 'Test Connection' })).toBeVisible();
  });

  test('changing any ClickHouse field clears connection result', async ({ page }) => {
    await page.goto('/settings/market-data');
    await page.waitForLoadState('networkidle');

    await page.route('**/api/market-data/clickhouse/test-connection', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'Connection unavailable for test.' }),
      });
    });

    await page.getByRole('button', { name: /test connection/i }).click();
    await expect(page.getByText('Connection unavailable for test.', { exact: true })).toBeVisible({ timeout: 5000 });

    // Typing in any field should clear the connection result
    await page.locator('#chHost').fill('new-host');
    await expect(page.getByText('Connection unavailable for test.', { exact: true })).not.toBeVisible();
  });

  test('renders Enrich Missing Profiles section with button', async ({ page }) => {
    await page.goto('/settings/market-data');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('h2', { hasText: 'Enrich Missing Profiles' })).toBeVisible();
    await expect(page.getByRole('button', { name: /enrich missing profiles/i })).toBeVisible();
  });
});

// Form submission tests must be serial because they all write to the shared
// market_data_settings row in SQLite (single-row table). Parallel workers would
// overwrite each other's data.
test.describe('Market Data Settings — Save and Persist', () => {
  test.describe.configure({ mode: 'serial' });

  test('fills form, submits, shows success feedback, and persists data', async ({ page }) => {
    wipeMarketDataSettings();

    await page.goto('/settings/market-data');
    await page.waitForLoadState('networkidle');

    // Fill in the form
    await page.locator('#chHost').fill('my-clickhouse.internal');
    await page.locator('#chPort').fill('8443');
    await page.locator('#chUser').fill('trader');
    await page.locator('#chPassword').fill('secret123');
    await page.locator('#chDatabase').fill('analysis');

    // Submit the form
    const clickHouseSection = page.getByRole('heading', { name: 'ClickHouse Configuration' }).locator('..');
    await clickHouseSection.getByRole('button', { name: 'Save', exact: true }).click();

    // Verify success message appears
    await expect(page.getByText('ClickHouse configuration saved.')).toBeVisible({ timeout: 5000 });

    // Verify data was persisted via the API directly
    const resp = await page.request.get('/api/market-data/settings');
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();

    expect(data.activeProvider).toBe('clickhouse');
    expect(data.providers.clickhouse.host).toBe('my-clickhouse.internal');
    expect(data.providers.clickhouse.port).toBe(8443);
    expect(data.providers.clickhouse.user).toBe('trader');
    expect(data.providers.clickhouse.database).toBe('analysis');
    // password must be absent from GET response (redaction constraint)
    expect(data.providers.clickhouse).not.toHaveProperty('password');
  });

  test('loads existing settings into form fields', async ({ page }) => {
    wipeMarketDataSettings();

    // Navigate, fill form, and save to create the initial record
    await page.goto('/settings/market-data');
    await page.waitForLoadState('networkidle');

    await page.locator('#chHost').fill('ch.example.com');
    await page.locator('#chPort').fill('9000');
    await page.locator('#chUser').fill('analyst');
    await page.locator('#chPassword').fill('secret');
    await page.locator('#chDatabase').fill('marketdata');

    await page.getByRole('heading', { name: 'ClickHouse Configuration' }).locator('..').getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('ClickHouse configuration saved.')).toBeVisible({ timeout: 5000 });

    // Reload and verify fields are populated from GET
    await page.goto('/settings/market-data');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('#chHost')).toHaveValue('ch.example.com');
    await expect(page.locator('#chPort')).toHaveValue('9000');
    await expect(page.locator('#chUser')).toHaveValue('analyst');
    await expect(page.locator('#chDatabase')).toHaveValue('marketdata');
    // Password must not be populated from GET (redaction constraint)
    await expect(page.locator('#chPassword')).toHaveValue('');
  });

  test('submits partial update without losing existing providers', async ({ page }) => {
    wipeMarketDataSettings();

    // Navigate, fill all fields, and save to create the initial record
    await page.goto('/settings/market-data');
    await page.waitForLoadState('networkidle');

    await page.locator('#chHost').fill('initial-host');
    await page.locator('#chPort').fill('8123');
    await page.locator('#chUser').fill('user1');
    await page.locator('#chPassword').fill('password1');
    await page.locator('#chDatabase').fill('market');

    await page.getByRole('heading', { name: 'ClickHouse Configuration' }).locator('..').getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('ClickHouse configuration saved.')).toBeVisible({ timeout: 5000 });

    // Now reload the page, fill only password (all other fields populated from GET), and save
    await page.goto('/settings/market-data');
    await page.waitForLoadState('networkidle');

    await page.locator('#chPassword').fill('new-password');
    await page.getByRole('heading', { name: 'ClickHouse Configuration' }).locator('..').getByRole('button', { name: 'Save', exact: true }).click();

    await expect(page.getByText('ClickHouse configuration saved.')).toBeVisible({ timeout: 5000 });

    // Verify via API that existing data was preserved
    const resp = await page.request.get('/api/market-data/settings');
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();

    expect(data.providers.clickhouse.host).toBe('initial-host');
    expect(data.providers.clickhouse.port).toBe(8123);
    expect(data.providers.clickhouse.user).toBe('user1');
    expect(data.providers.clickhouse.database).toBe('market');
    // password must be absent from GET response (redaction constraint)
    expect(data.providers.clickhouse).not.toHaveProperty('password');
  });
});

// Settings Hub tests are independent and can run in parallel
test.describe('Settings Hub — Market Data Route', () => {
  test('settings hub exposes Market Data through Integrations', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    await page.getByRole('link', { name: /integrations/i }).click();
    await expect(page).toHaveURL('/settings/integrations');
    await expect(page.getByRole('link', { name: /market data/i })).toBeVisible();
    await expect(page.getByText('Configure market data providers and connection settings.')).toBeVisible();
  });

  test('clicking Market Data card navigates to market data settings', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    await page.getByRole('link', { name: /integrations/i }).click();
    await expect(page).toHaveURL('/settings/integrations');
    await page.getByRole('link', { name: /^Market Data/ }).click();

    await expect(page).toHaveURL('/settings/market-data');
    await expect(page.getByRole('heading', { name: 'Market Data', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: /back to settings/i })).toBeVisible();
  });
});
