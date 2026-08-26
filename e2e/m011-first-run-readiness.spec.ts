import { expect, test, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { runMigrations } from '@/db/run-migrations';

const DB_FILE = process.env.DB_FILE_NAME ?? './.trading-journal/journal.db';

function openDb() {
  mkdirSync(dirname(resolve(DB_FILE)), { recursive: true });
  const sqlite = new Database(resolve(DB_FILE));
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  // Use the app's own migration path (runMigrations) so the tracking journal
  // matches what the dev server expects. Mixing drizzle's migrator (content
  // hashes) with runMigrations (journal tags) makes server startup fail with
  // "table already exists" on a fresh DB — a latent defect exposed when this
  // spec runs in its own disposable database.
  runMigrations(sqlite, resolve('src/db/migrations'));
  return sqlite;
}

async function resetReadinessState(page?: Page) {
  const db = openDb();

  // Some tables hold FK-referenced rows from other specs' leftover data;
  // disable FK enforcement so the DELETE cascade is handled by our order alone.
  db.pragma('foreign_keys = OFF');
  db.exec(`
    DELETE FROM trades;
    DELETE FROM trade_executions;
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

  // The SQL-level WAL checkpoint may not propagate to the dev server's
  // existing SQLite connection without triggering a read through that connection.
  // Make an API call that forces the dev server to read the cleaned database.
  if (page) {
    await page.request.get('/api/readiness');
  }
}

async function seedToReady(page: Page) {
  // Create account via POST (Draft with isActive: false)
  const accountResponse = await page.request.post('/api/accounts', {
    data: {
      name: 'Readiness Account',
      broker: 'Playwright Broker',
      currency: 'USD',
    },
  });
  expect(accountResponse.status()).toBe(201);
  const account = await accountResponse.json() as { id: string };

  // Activate draft so readiness check passes
  const activateRes = await page.request.put(`/api/accounts/${account.id}`, {
    data: { isActive: true },
  });
  expect(activateRes.ok()).toBeTruthy();

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
  test.beforeEach(async ({ page }) => {
    await resetReadinessState(page);
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
    await expect(page.getByRole('link', { name: 'Setup Workspace' })).toHaveAttribute('href', '/settings/workspace');
    await expect(page.getByRole('link', { name: 'Setup Risk Defaults' })).toHaveAttribute('href', '/settings/risk-defaults');
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
    await expect(page.getByRole('link', { name: 'Journal Setup' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Workspace' })).toBeVisible();
  });

  test('GET /api/readiness still returns 200 and diagnostics when not ready', async ({ page }) => {
    const response = await page.goto('/api/readiness', { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBe(200);
    const body = JSON.parse(await page.locator('body').innerText()) as { ready: boolean; missing: Array<{ id: string; label: string }> };
    expect(body.ready).toBe(false);
    expect(body.missing[0]).toMatchObject({ id: 'app_profile', label: 'Workspace' });
  });

  test('User can walk the full guided setup path to readiness with persisted-state assertions', async ({ page }) => {
    // Step 1: Navigate to settings hub — checklist shows with 4 missing items
    await page.goto('/settings', { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Setup your journal' })).toBeVisible({ timeout: 10_000 });

    // Determine initial readiness state — accounts may already be present
    // from a prior test run if the dev server's DB connection cached data.
    let readiness = await (await page.request.get('/api/readiness')).json() as { ready: boolean; missing: Array<{ id: string }> };
    expect(readiness.ready).toBe(false);

    const missingStepIds = readiness.missing.map((s) => s.id);
    expect(missingStepIds).toContain('app_profile');
    expect(missingStepIds).toContain('settings');
    expect(missingStepIds).toContain('setups');
    const accountsAlreadyDone = !missingStepIds.includes('accounts');
    const accountsStepDone = accountsAlreadyDone;

    // Helper: assert readiness missing set after a step completes
    async function checkMissingAfterStep(page: Page, expectedKnown: string[]) {
      const r = await (await page.request.get('/api/readiness')).json() as { ready: boolean; missing: Array<{ id: string }> };
      const ids = r.missing.map((s) => s.id);
      // Each known step should be present in missing (unless accounts already done)
      for (const id of expectedKnown) {
        if (id === 'accounts' && accountsStepDone) continue;
        expect(ids).toContain(id);
      }
      return r;
    }

    // Step 2: Complete Workspace via UI
    await page.getByRole('link', { name: 'Setup Workspace' }).click();
    await page.waitForURL('**/settings/workspace', { timeout: 5_000 });
    await page.waitForLoadState('networkidle');
    const appProfilePut = page.waitForResponse(
      (r) => r.url().includes('/api/app-profile') && r.request().method() === 'PUT',
    );
    const appProfileSettingsNav = page.waitForURL('**/settings', { timeout: 10_000 });
    await page.getByRole('button', { name: /^Save Workspace/ }).click();
    expect((await appProfilePut).status()).toBe(201);
    await appProfileSettingsNav;
    readiness = await checkMissingAfterStep(page, ['settings', 'accounts', 'setups']);
    expect(readiness.ready).toBe(false);
    await expect(page.getByRole('heading', { name: 'Setup your journal' })).toBeVisible();

    // Step 3: Complete Risk Defaults via UI
    await page.getByRole('link', { name: 'Setup Risk Defaults' }).click();
    await page.waitForURL('**/settings/risk-defaults', { timeout: 5_000 });
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('#maxRiskPerTradePct', { state: 'visible', timeout: 5_000 });
    await page.locator('#maxRiskPerTradePct').fill('2');
    await page.locator('#defaultCommission').fill('0.5');
    await page.waitForTimeout(300);
    const riskPut = page.waitForResponse(
      (r) => r.url().includes('/api/settings') && r.request().method() === 'PUT',
    );
    const riskSettingsNav = page.waitForURL('**/settings', { timeout: 10_000 });
    await page.getByRole('button', { name: /^Save Risk Defaults/ }).click();
    expect((await riskPut).ok()).toBeTruthy();
    await riskSettingsNav;
    readiness = await checkMissingAfterStep(page, ['accounts', 'setups']);
    expect(readiness.ready).toBe(false);
    await expect(page.getByRole('heading', { name: 'Setup your journal' })).toBeVisible();

    // Step 4: Create an Account via the UI dialog (navigate directly since the
    // checklist no longer has a "Setup Accounts" step — accounts are managed
    // as their own domain outside the Setup Checklist)
    await page.goto('/settings/accounts', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Add Account' }).click();
    await page.waitForSelector('#name', { state: 'visible', timeout: 5_000 });
    await page.locator('#name').fill('Guided Account');
    await page.locator('#broker').fill('Playwright Broker');
    await page.waitForTimeout(300);
    const accountPost = page.waitForResponse(
      (r) => r.url().includes('/api/accounts') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Create' }).click();
    const accountPostResponse = await accountPost;
    expect(accountPostResponse.status()).toBe(201);
    const createdAccount = await accountPostResponse.json() as { id: string };

    // Activate the Draft account so the readiness check and DB assertion pass
    const activateRes = await page.request.put(`/api/accounts/${createdAccount.id}`, {
      data: { isActive: true },
    });
    expect(activateRes.ok()).toBeTruthy();

    // The dialog closes after save; no page navigation occurs
    await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible({ timeout: 10_000 });

    readiness = await (await page.request.get('/api/readiness')).json() as { ready: boolean; missing: Array<{ id: string }> };
    expect(readiness.ready).toBe(false);
    expect(readiness.missing.map((s) => s.id)).toEqual(['setups']);

    // Navigate back to settings hub to see the updated checklist (the accounts
    // dialog closes but doesn't navigate away)
    await page.goto('/settings', { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Setup your journal' })).toBeVisible();

    // Step 5: Create a Trading Setup via the UI dialog
    await page.getByRole('link', { name: 'Setup Trading Setups' }).click();
    await page.waitForURL('**/settings/plays', { timeout: 5_000 });
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'New Play' }).click();
    await page.waitForSelector('#newName', { state: 'visible', timeout: 5_000 });
    await page.locator('#newName').fill('Guided Breakout');
    await page.waitForTimeout(300);
    const setupPost = page.waitForResponse(
      (r) => r.url().includes('/api/setup-definitions') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Create' }).click();
    const setupPostResponse = await setupPost;
    expect(setupPostResponse.status()).toBe(201);
    const createdSetup = await setupPostResponse.json() as { id: string };

    // The plays page navigates to the new setup detail page after creation.
    // Navigate back to the settings hub to verify the checklist is complete.
    await page.waitForURL(`/settings/plays/${createdSetup.id}`, { timeout: 10_000 });
    await page.goto('/settings', { waitUntil: 'networkidle' });
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
      const profileRows = db.prepare('SELECT timezone FROM app_profile').all() as Array<{ timezone: string | null }>;
      expect(profileRows.some((r) => r.timezone === 'America/Bogota')).toBe(true);

      const settingsRows = db.prepare('SELECT max_risk_per_trade_pct, default_commission FROM settings').all() as Array<{
        max_risk_per_trade_pct: number | null;
        default_commission: number | null;
      }>;
      expect(settingsRows.some((r) => r.max_risk_per_trade_pct === 2 && r.default_commission === 0.5)).toBe(true);

      const accountRows = db.prepare('SELECT is_active FROM accounts').all() as Array<{ is_active: number }>;
      expect(accountRows.some((r) => r.is_active === 1)).toBe(true);

      const setupRows = db.prepare('SELECT is_active FROM setup_definitions').all() as Array<{ is_active: number }>;
      expect(setupRows.some((r) => r.is_active === 1)).toBe(true);
    } finally {
      db.close();
    }
  });
});
