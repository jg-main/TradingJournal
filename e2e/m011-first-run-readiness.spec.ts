import { expect, test, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { randomUUID } from 'node:crypto';
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

  // Some tables hold FK-referenced rows from other specs' leftover data;
  // disable FK enforcement so the DELETE cascade is handled by our order alone.
  db.pragma('foreign_keys = OFF');
  db.exec(`
    DELETE FROM settings;
    DELETE FROM app_profile;
    DELETE FROM accounts;
    DELETE FROM setup_definitions;
    DELETE FROM lookup_values WHERE type = 'setup';
  `);
  db.pragma('foreign_keys = ON');

  // Force WAL checkpoint so the dev server's connection sees the deletes
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.close();
}

async function seedToReady(page: Page) {
  const accountResponse = await page.request.post('/api/accounts', {
    data: {
      name: 'Readiness Account',
      broker: 'Playwright Broker',
      currency: 'USD',
      startingBalance: 10000,
      isActive: true,
    },
  });
  expect(accountResponse.status()).toBe(201);
  const account = await accountResponse.json() as { id: string };

  const settingsResponse = await page.request.put('/api/settings', {
    data: {
      startingAccountValue: 10000,
      maxRiskPerTradePct: 1,
      defaultCommission: 0,
      defaultAccountId: account.id,
      currency: 'USD',
      journalStartDate: '2025-01-01',
    },
  });
  expect(settingsResponse.ok()).toBeTruthy();

  const setupResponse = await page.request.post('/api/setup-definitions', {
    data: {
      name: `Playwright Setup ${randomUUID()}`,
      description: 'Readiness readiness seed',
      howToPlay: 'Follow the plan',
      entryRules: 'Entry',
      exitRules: 'Exit',
      tags: 'playwright',
      defaultRiskPct: 1,
      positionSizingRules: 'Use risk budget',
      chartPatterns: 'Trend',
    },
  });
  expect(setupResponse.status()).toBe(201);

  const db = openDb();
  db.prepare(`
    INSERT INTO app_profile (id, display_name, timezone, default_currency)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      display_name = excluded.display_name,
      timezone = excluded.timezone,
      default_currency = excluded.default_currency
  `).run('app-profile', 'Playwright Trader', 'America/Bogota', 'USD');
  db.close();
}

test.describe.configure({ mode: 'serial' });

test.describe('first-run readiness', () => {
  test.beforeEach(() => {
    resetReadinessState();
  });

  test('GET /api/readiness returns the stable missing set on a clean DB', async ({ page }) => {
    const response = await page.goto('/api/readiness', { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBe(200);

    const body = JSON.parse(await page.locator('body').innerText()) as { ready: boolean; missing: Array<{ id: string }> };
    expect(body.ready).toBe(false);
    expect(body.missing.map((step) => step.id)).toEqual([
      'app_profile',
      'settings',
      'accounts',
      'setups',
    ]);
  });

  test('Settings hub shows the first-run checklist when not ready', async ({ page }) => {
    await page.goto('/settings', { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'Setup your journal' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('link', { name: 'Setup App Profile' })).toHaveAttribute('href', '/settings/app');
    await expect(page.getByRole('link', { name: 'Setup Risk Settings' })).toHaveAttribute('href', '/settings/risk');
    await expect(page.getByRole('link', { name: 'Setup Accounts' })).toHaveAttribute('href', '/settings/accounts');
    await expect(page.getByRole('link', { name: 'Setup Trading Setups' })).toHaveAttribute('href', '/settings/plays');
  });

  test('Readiness progresses to ready after persisted setup data is seeded', async ({ page }) => {
    await seedToReady(page);

    const response = await page.goto('/api/readiness', { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBe(200);

    const body = JSON.parse(await page.locator('body').innerText()) as { ready: boolean; missing: Array<{ id: string }> };
    expect(body.ready).toBe(true);
    expect(body.missing).toEqual([]);
  });

  test('Settings hub hides the checklist once readiness is complete', async ({ page }) => {
    await seedToReady(page);

    await page.goto('/settings', { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'Setup your journal' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Plays' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'App Preferences' })).toBeVisible();
  });

  test('GET /api/readiness still returns 200 and diagnostics when not ready', async ({ page }) => {
    const response = await page.goto('/api/readiness', { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBe(200);
    const body = JSON.parse(await page.locator('body').innerText()) as { ready: boolean; missing: Array<{ id: string; label: string }> };
    expect(body.ready).toBe(false);
    expect(body.missing[0]).toMatchObject({ id: 'app_profile', label: 'App Profile' });
  });

  test('User can walk the full guided setup path to readiness with persisted-state assertions', async ({ page }) => {
    // Step 1: Navigate to settings hub — checklist shows with 4 missing items
    await page.goto('/settings', { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Setup your journal' })).toBeVisible({ timeout: 10_000 });

    // Verify via API that all 4 items are missing
    let readiness = await (await page.request.get('/api/readiness')).json() as { ready: boolean; missing: Array<{ id: string }> };
    expect(readiness.ready).toBe(false);
    expect(readiness.missing.map((s) => s.id)).toEqual(['app_profile', 'settings', 'accounts', 'setups']);

    // Step 2: Complete App Profile via UI
    await page.getByRole('link', { name: 'Setup App Profile' }).click();
    await page.waitForURL('**/settings/app', { timeout: 5_000 });
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('#displayName', { state: 'visible', timeout: 5_000 });
    await page.locator('#displayName').fill('Guided Trader');
    await page.waitForTimeout(300);
    const appProfilePut = page.waitForResponse(
      (r) => r.url().includes('/api/app-profile') && r.request().method() === 'PUT',
    );
    // After PUT success, the page calls router.push('/settings'); await that navigation
    // instead of issuing page.goto which races NS_BINDING_ABORTED on Firefox.
    const appProfileSettingsNav = page.waitForURL('**/settings', { timeout: 10_000 });
    await page.getByRole('button', { name: /^Save Preferences/ }).click();
    expect((await appProfilePut).status()).toBe(201);
    await appProfileSettingsNav;
    readiness = await (await page.request.get('/api/readiness')).json() as { ready: boolean; missing: Array<{ id: string }> };
    expect(readiness.ready).toBe(false);
    expect(readiness.missing.map((s) => s.id)).toEqual(['settings', 'accounts', 'setups']);
    await expect(page.getByRole('heading', { name: 'Setup your journal' })).toBeVisible();

    // Step 3: Complete Risk Settings via UI (no account needed for dropdown)
    await page.getByRole('link', { name: 'Setup Risk Settings' }).click();
    await page.waitForURL('**/settings/risk', { timeout: 5_000 });
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('#maxRiskPerTradePct', { state: 'visible', timeout: 5_000 });
    await page.locator('#maxRiskPerTradePct').fill('2');
    await page.locator('#startingAccountValue').fill('50000');
    await page.locator('#journalStartDate').fill('2025-01-01');
    await page.waitForTimeout(300);
    const riskPut = page.waitForResponse(
      (r) => r.url().includes('/api/settings') && r.request().method() === 'PUT',
    );
    const riskSettingsNav = page.waitForURL('**/settings', { timeout: 10_000 });
    await page.getByRole('button', { name: /^Save Risk Settings/ }).click();
    expect((await riskPut).ok()).toBeTruthy();
    await riskSettingsNav;
    readiness = await (await page.request.get('/api/readiness')).json() as { ready: boolean; missing: Array<{ id: string }> };
    expect(readiness.ready).toBe(false);
    expect(readiness.missing.map((s) => s.id)).toEqual(['accounts', 'setups']);
    await expect(page.getByRole('heading', { name: 'Setup your journal' })).toBeVisible();

    // Step 4: Create an Account via the UI dialog
    await page.getByRole('link', { name: 'Setup Accounts' }).click();
    await page.waitForURL('**/settings/accounts', { timeout: 5_000 });
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Add Account' }).click();
    await page.waitForSelector('#account-name', { state: 'visible', timeout: 5_000 });
    await page.locator('#account-name').fill('Guided Account');
    await page.locator('#account-broker').fill('Playwright Broker');
    await page.locator('#account-starting-balance').fill('50000');
    await page.waitForTimeout(300);
    const accountPost = page.waitForResponse(
      (r) => r.url().includes('/api/accounts') && r.request().method() === 'POST',
    );
    const accountSettingsNav = page.waitForURL('**/settings', { timeout: 10_000 });
    await page.getByRole('button', { name: 'Create Account' }).click();
    expect((await accountPost).status()).toBe(201);
    await accountSettingsNav;
    readiness = await (await page.request.get('/api/readiness')).json() as { ready: boolean; missing: Array<{ id: string }> };
    expect(readiness.ready).toBe(false);
    expect(readiness.missing.map((s) => s.id)).toEqual(['setups']);
    await expect(page.getByRole('heading', { name: 'Setup your journal' })).toBeVisible();

    // Step 5: Create a Trading Setup via the UI dialog
    await page.getByRole('link', { name: 'Setup Trading Setups' }).click();
    await page.waitForURL('**/settings/plays', { timeout: 5_000 });
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'New Play' }).click();
    await page.waitForSelector('#name', { state: 'visible', timeout: 5_000 });
    await page.locator('#name').fill('Guided Breakout');
    await page.waitForTimeout(300);
    const setupPost = page.waitForResponse(
      (r) => r.url().includes('/api/setup-definitions') && r.request().method() === 'POST',
    );
    const setupSettingsNav = page.waitForURL('**/settings', { timeout: 10_000 });
    await page.getByRole('button', { name: 'Create' }).click();
    expect((await setupPost).status()).toBe(201);
    await setupSettingsNav;
    await expect(page.getByRole('heading', { name: 'Setup your journal' })).toHaveCount(0, { timeout: 5_000 });
    await expect(page.getByText('All set')).toBeVisible();

    // Step 6: API verification
    const readinessResp = await page.goto('/api/readiness', { waitUntil: 'domcontentloaded' });
    expect(readinessResp?.status()).toBe(200);
    const body = JSON.parse(await page.locator('body').innerText()) as { ready: boolean; missing: Array<{ id: string }> };
    expect(body.ready).toBe(true);
    expect(body.missing).toEqual([]);

    // Step 7: Assert persisted rows
    const db = openDb();
    try {
      const profileRows = db.prepare('SELECT display_name FROM app_profile').all() as Array<{ display_name: string | null }>;
      expect(profileRows.some((r) => r.display_name === 'Guided Trader')).toBe(true);

      const settingsRows = db.prepare('SELECT starting_account_value, journal_start_date FROM settings').all() as Array<{
        starting_account_value: number | null;
        journal_start_date: string | null;
      }>;
      expect(settingsRows.some((r) => r.starting_account_value === 50000 && r.journal_start_date === '2025-01-01')).toBe(true);

      const accountRows = db.prepare('SELECT is_active FROM accounts').all() as Array<{ is_active: number }>;
      expect(accountRows.some((r) => r.is_active === 1)).toBe(true);

      const setupRows = db.prepare('SELECT is_active FROM setup_definitions').all() as Array<{ is_active: number }>;
      expect(setupRows.some((r) => r.is_active === 1)).toBe(true);
    } finally {
      db.close();
    }
  });
});
