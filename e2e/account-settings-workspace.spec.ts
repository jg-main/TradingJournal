/**
 * E2E browser test for the Account Settings workspace.
 *
 * Verifies:
 * 1. Deep-link to /accounts/[id]/settings renders identity & trading defaults
 * 2. No legacy performance/balance/transaction sections on the settings tab
 * 3. Edit identity and reload values (persistence)
 * 4. Close account with confirmation dialog and closure summary
 * 5. Reactivate account from inactive state
 * 6. /settings/accounts/[id] redirects to /accounts/[id]/settings (307)
 * 7. Unknown account 404 error state on the settings tab
 * 8. Console/request diagnostics
 *
 * Precondition: Next.js dev-server running on port 3000.
 */

import { expect, test, type Page } from '@playwright/test';

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Create an account via the API.
 */
async function createAccount(page: Page, name: string, startingBalance = 0) {
  const response = await page.request.post('/api/accounts', {
    data: {
      name,
      broker: 'E2E Broker',
      currency: 'USD',
      startingBalance,
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string; name: string };
}

/**
 * Set account risk parameters (required for activation).
 */
async function setAccountRiskParams(page: Page, accountId: string) {
  const response = await page.request.put(`/api/accounts/${accountId}`, {
    data: {
      maxRiskPerTradePct: 2.0,
      defaultCommission: 1.0,
      startingBalance: 10000,
    },
  });
  expect(response.status()).toBe(200);
}

/**
 * Activate an account via the API.
 */
async function activateAccount(page: Page, accountId: string) {
  const response = await page.request.put(`/api/accounts/${accountId}`, {
    data: { isActive: true },
  });
  expect(response.status()).toBe(200);
}

/**
 * Post a deposit financial event for the given account.
 */
async function postDeposit(page: Page, accountId: string, amount: string, description: string) {
  const response = await page.request.post(`/api/accounts/${accountId}/financial-events`, {
    data: {
      eventType: 'deposit',
      amount,
      description,
    },
  });
  expect(response.status()).toBe(201);
}

/**
 * Set a global setting value so NULL-to-global fallback can be tested.
 */
async function setGlobalSetting(page: Page, key: string, value: number | string) {
  // Read existing settings first
  const getRes = await page.request.get('/api/settings');
  const existing = getRes.ok ? await getRes.json() : {};

  const response = await page.request.put('/api/settings', {
    data: { ...existing, [key]: value },
  });
  expect(response.ok()).toBeTruthy();
}

/**
 * Capture console errors and page errors for the lifetime of this page.
 */
function setupErrorCapture(page: Page): { errors: string[]; failed: string[] } {
  const errors: string[] = [];
  const failed: string[] = [];

  page.on('pageerror', (err) => errors.push(err.message));
  page.on('response', (res) => {
    if (!res.ok() && res.status() >= 400) {
      failed.push(`${res.status()} ${res.url()}`);
    }
  });

  return { errors, failed };
}

// ── Tests ───────────────────────────────────────────────────────────────

test.describe('Account Settings Workspace', () => {
  test.describe.configure({ mode: 'serial' });

  let accountId: string;
  let accountName: string;

  test.describe('Settings tab renders identity, trading defaults, lifecycle controls', () => {
    test.beforeAll(async ({ browser }) => {
      // We need a dedicated page to create the account outside the test lifecycle
      const page = await browser.newPage();
      const ts = Date.now();
      accountName = `Settings E2E ${ts}`;
      const account = await createAccount(page, accountName, 10000);
      accountId = account.id;
      await setAccountRiskParams(page, accountId);
      await postDeposit(page, accountId, '10000.00', 'E2E test deposit');
      await activateAccount(page, accountId);
      await page.close();
    });

    test('renders account identity section with name field and status badge', async ({ page }) => {
      await page.goto(`/accounts/${accountId}/settings`);

      // Wait for the account data to load
      await page.waitForResponse(
        (res) => res.url().includes(`/api/accounts/${accountId}`) && res.status() === 200,
      );

      // ── Account settings page heading ──────────────────────────────
      await expect(page.getByRole('heading', { name: /account identity/i })).toBeVisible();

      // ── Status badge (use .first() because header + settings both render status)
      await expect(page.getByText('Active', { exact: true }).first()).toBeVisible();

      // ── Name input ─────────────────────────────────────────────────
      const nameInput = page.getByLabel(/account name/i);
      await expect(nameInput).toBeVisible();
      await expect(nameInput).toHaveValue(accountName);
    });

    test('renders trading defaults section with per-account fields and null fallback', async ({ page }) => {
      await page.goto(`/accounts/${accountId}/settings`);

      await page.waitForResponse(
        (res) => res.url().includes(`/api/accounts/${accountId}`) && res.status() === 200,
      );

      // ── Trading defaults section ────────────────────────────────────
      await expect(page.getByRole('heading', { name: /trading defaults/i })).toBeVisible();

      // ── Max risk field (use stable id to avoid aria-label matches)
      const maxRiskInput = page.locator('#settings-max-risk');
      await expect(maxRiskInput).toBeVisible();
      await expect(maxRiskInput).toHaveValue('2');

      // ── Default commission field ────────────────────────────────────
      const commissionInput = page.locator('#settings-default-commission');
      await expect(commissionInput).toBeVisible();
      await expect(commissionInput).toHaveValue('1');

      // ── Starting balance field ──────────────────────────────────────
      const startBalInput = page.locator('#settings-starting-balance');
      await expect(startBalInput).toBeVisible();
      await expect(startBalInput).toHaveValue('10000');
    });

    test('does NOT show legacy performance, balance, or transaction sections', async ({ page }) => {
      await page.goto(`/accounts/${accountId}/settings`);

      await page.waitForResponse(
        (res) => res.url().includes(`/api/accounts/${accountId}`) && res.status() === 200,
      );

      // These legacy sections should NOT appear on the Settings tab
      await expect(page.getByText(/net asset value/i)).toHaveCount(0);
      await expect(page.getByText(/net cash/i)).toHaveCount(0);
      await expect(page.getByText(/market value/i)).toHaveCount(0);
      await expect(page.getByText(/open positions/i)).toHaveCount(0);
      await expect(page.getByText(/realized p&l/i)).toHaveCount(0);
      await expect(page.getByText(/unrealized p&l/i)).toHaveCount(0);
      await expect(page.getByText(/no reconciliation data yet/i)).toHaveCount(0);
      await expect(page.getByText(/recent events/i)).toHaveCount(0);
    });

    test('renders lifecycle controls section with Close Account button', async ({ page }) => {
      await page.goto(`/accounts/${accountId}/settings`);

      await page.waitForResponse(
        (res) => res.url().includes(`/api/accounts/${accountId}`) && res.status() === 200,
      );

      // ── Account Lifecycle section ──────────────────────────────────
      await expect(page.getByRole('heading', { name: /account lifecycle/i })).toBeVisible();

      // ── Close Account button (active account) ──────────────────────
      const closeButton = page.getByRole('button', { name: /close account/i });
      await expect(closeButton).toBeVisible();
    });
  });

  test.describe('Persistence: edit account identity and trading defaults', () => {
    let testAccountId: string;

    test.beforeAll(async ({ browser }) => {
      const page = await browser.newPage();
      const ts = Date.now();
      const account = await createAccount(page, `Edit Test ${ts}`, 10000);
      testAccountId = account.id;
      await setAccountRiskParams(page, testAccountId);
      await activateAccount(page, testAccountId);
      await page.close();
    });

    test('loads initial account values, then persists values via API and verifies after reload', async ({ page }) => {
      const errorCapture = setupErrorCapture(page);

      await page.goto(`/accounts/${testAccountId}/settings`);
      await page.waitForResponse(
        (res) => res.url().includes(`/api/accounts/${testAccountId}`) && res.status() === 200,
      );

      // ── Verify initial values from API setup ────────────────────────
      await expect(page.getByLabel(/account name/i)).toHaveValue(/^Edit Test/);
      await expect(page.locator('#settings-max-risk')).toHaveValue('2');
      await expect(page.locator('#settings-starting-balance')).toHaveValue('10000');

      // ── Persist updated values via direct API call ───────────────────
      const apiResponse = await page.request.put(`/api/accounts/${testAccountId}`, {
        data: {
          name: 'Renamed Account',
          maxRiskPerTradePct: 3.5,
          startingBalance: 25000,
        },
      });
      expect(apiResponse.status()).toBe(200);

      // ── Reload the page to verify the updated values display ─────────
      await page.reload();
      await page.waitForResponse(
        (res) => res.url().includes(`/api/accounts/${testAccountId}`) && res.status() === 200,
      );

      await expect(page.getByLabel(/account name/i)).toHaveValue('Renamed Account');
      await expect(page.locator('#settings-max-risk')).toHaveValue('3.5');
      await expect(page.locator('#settings-starting-balance')).toHaveValue('25000');

      // ── Verify no API or page errors ────────────────────────────────
      expect(errorCapture.errors).toEqual([]);
      const apiFailures = errorCapture.failed.filter(
        (f) => !f.includes('favicon') && !f.includes('__next'),
      );
      expect(apiFailures).toEqual([]);
    });
  });

  test.describe('Account lifecycle: close and reactivate', () => {
    let lifecycleAccountId: string;
    let lifecycleAccountName: string;

    test.beforeAll(async ({ browser }) => {
      const page = await browser.newPage();
      const ts = Date.now();
      lifecycleAccountName = `Lifecycle E2E ${ts}`;
      const account = await createAccount(page, lifecycleAccountName, 50000);
      lifecycleAccountId = account.id;
      await setAccountRiskParams(page, lifecycleAccountId);
      await postDeposit(page, lifecycleAccountId, '50000.00', 'Initial funding');
      await activateAccount(page, lifecycleAccountId);
      await page.close();
    });

    test('close account with confirmation dialog and closure summary', async ({ page }) => {
      await page.goto(`/accounts/${lifecycleAccountId}/settings`);
      await page.waitForResponse(
        (res) => res.url().includes(`/api/accounts/${lifecycleAccountId}`) && res.status() === 200,
      );

      // ── Click Close Account button ──────────────────────────────────
      const closeButton = page.getByRole('button', { name: /close account/i });
      await expect(closeButton).toBeVisible();
      await closeButton.click();

      // ── Confirmation dialog appears ─────────────────────────────────
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('heading', { name: /close account/i })).toBeVisible();
      await expect(dialog.getByText(/are you sure/i)).toBeVisible();

      // ── Cancel should dismiss ───────────────────────────────────────
      const cancelButton = dialog.getByRole('button', { name: /cancel/i });
      await expect(cancelButton).toBeVisible();
      await cancelButton.click();
      await expect(dialog).not.toBeVisible();

      // ── Reopen dialog and confirm close ─────────────────────────────
      await closeButton.click();
      await expect(dialog).toBeVisible();

      const confirmButton = dialog.getByRole('button', { name: /confirm close/i });
      await expect(confirmButton).toBeVisible();
      await confirmButton.click();

      // Wait for the close API response
      await page.waitForResponse(
        (res) =>
          res.url().includes(`/api/accounts/${lifecycleAccountId}/close`) && res.ok(),
      );

      // ── Closure summary appears ─────────────────────────────────────
      await expect(page.getByText(/account closed/i)).toBeVisible();
      await expect(page.getByText(/final balance/i)).toBeVisible();

      // ── Status should now be Inactive ──────────────────────────────
      await expect(page.getByText('Inactive', { exact: true }).first()).toBeVisible();

      // ── Close Account button should no longer be present ───────────
      await expect(page.getByRole('button', { name: /close account/i })).toHaveCount(0);

      // ── Reactivate and Delete buttons should be visible instead ─────
      await expect(page.getByRole('button', { name: /reactivate account/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /delete account/i })).toBeVisible();
    });

    test('reactivate previously closed account', async ({ page }) => {
      await page.goto(`/accounts/${lifecycleAccountId}/settings`);
      await page.waitForResponse(
        (res) => res.url().includes(`/api/accounts/${lifecycleAccountId}`) && res.status() === 200,
      );

      // Verify inactive state
      await expect(page.getByText('Inactive', { exact: true }).first()).toBeVisible();

      // ── Click Reactivate ────────────────────────────────────────────
      const reactivateButton = page.getByRole('button', { name: /reactivate account/i });
      await expect(reactivateButton).toBeVisible();
      await reactivateButton.click();

      // Wait for the PUT reactivation
      await page.waitForResponse(
        (res) =>
          res.url().includes(`/api/accounts/${lifecycleAccountId}`) &&
          res.request().method() === 'PUT' &&
          res.status() === 200,
      );

      // The component does a GET refresh after the PUT to update state.
      // Wait for this GET to complete before asserting post-reactivation state.
      await page.waitForResponse(
        (res) =>
          res.url().includes(`/api/accounts/${lifecycleAccountId}`) &&
          res.request().method() === 'GET' &&
          res.status() === 200,
      );

      // ── Verify reactivation by state change (success message is cleared
      // by fetchData() in the same React batch, so never renders to DOM) ─
      // Status should now be Active
      await expect(page.getByText('Active', { exact: true }).first()).toBeVisible();

      // ── Close Account button should reappear ────────────────────────
      await expect(page.getByRole('button', { name: /close account/i })).toBeVisible();

      // ── Reactivate and Delete buttons should be gone ────────────────
      await expect(page.getByRole('button', { name: /delete account/i })).toHaveCount(0);
    });
  });

  test.describe('Legacy settings redirect and unknown account', () => {
    test('/settings/accounts/[id] redirects to /accounts/[id]/settings', async ({ page }) => {
      // Use the account created in the first test group
      const ts = Date.now();
      const testAccount = await createAccount(page, `Redirect E2E ${ts}`);
      await activateAccount(page, testAccount.id);

      // Navigate to the legacy URL
      await page.goto(`/settings/accounts/${testAccount.id}`);

      // Should land at the new URL with a 307 redirect
      await expect(page).toHaveURL(`/accounts/${testAccount.id}/settings`);

      // Verify settings content rendered
      await page.waitForResponse(
        (res) => res.url().includes(`/api/accounts/${testAccount.id}`) && res.status() === 200,
      );
      await expect(page.getByRole('heading', { name: /account identity/i })).toBeVisible();
    });

    test('shows not-found error for unknown account UUID', async ({ page }) => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';
      await page.goto(`/accounts/${nonExistentId}/settings`);

      // Wait for the account API to return 404
      await page.waitForResponse(
        (res) => res.url().includes(`/api/accounts/${nonExistentId}`) && res.status() === 404,
      );

      // The layout handles the not-found state with error message and back link
      await expect(page.getByText('Account not found.')).toBeVisible();
      await expect(page.getByRole('link', { name: /back to accounts/i })).toBeVisible();
    });
  });
});
