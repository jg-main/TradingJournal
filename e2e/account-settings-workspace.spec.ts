/**
 * E2E browser test for the Account Settings workspace.
 *
 * Verifies:
 * 1. Deep-link to /settings/accounts/[id]/settings renders identity & trading defaults
 * 2. No legacy performance/balance/transaction sections on the settings tab
 * 3. Edit identity and reload values (persistence)
 * 4. Close account with confirmation dialog and closure summary
 * 5. Reactivate account from inactive state
 * 6. Settings tab direct route: /settings/accounts/[id]/settings renders identity, defaults, lifecycle
 * 7. Unknown account 404 error state on the settings tab
 * 8. Console/request diagnostics
 *
 * S05 lifecycle refinements covered here:
 * 9. Broker editing persistence through the UI (fill + save + reload)
 * 10. Base currency rendered as a read-only disabled field
 * 11. Currency mutation guard: 409 when the account has financial history
 * 12. Close-route open-trade guard: 409 (API + UI error surface)
 * 13. Default-account clearing when the default is deactivated (PUT + close)
 * 14. Consumer fallback to an active account when no default is set
 *
 * Precondition: Next.js dev-server running on port 3000.
 */

import { expect, test, type Page } from '@playwright/test';
import { prepareAccountForTrading } from './helpers/trading-account';

/**
 * Wait one animation frame so React commits controlled-input state after a
 * fill(). Without it, a fast Save click can read the stale pre-fill value from
 * component state under dev-server load (observed in the combined
 * chromium+firefox run), producing a PUT body with the old value.
 */
async function settleReactInput(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Create an account via the API.
 */
async function createAccount(page: Page, name: string) {
  const response = await page.request.post('/api/accounts', {
    data: {
      name,
      broker: 'E2E Broker',
      currency: 'USD',
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
      const account = await createAccount(page, accountName);
      accountId = account.id;
      await setAccountRiskParams(page, accountId);
      await activateAccount(page, accountId);
      await postDeposit(page, accountId, '10000.00', 'E2E test deposit');
      await page.close();
    });

    test('renders account identity section with name field and status badge', async ({ page }) => {
      await page.goto(`/settings/accounts/${accountId}/settings`);

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
      await page.goto(`/settings/accounts/${accountId}/settings`);

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

      // Opening cash is ledger-owned and is not editable as an account default.
      await expect(page.locator('#settings-starting-balance')).toHaveCount(0);
    });

    test('does NOT show legacy performance, balance, or transaction sections', async ({ page }) => {
      await page.goto(`/settings/accounts/${accountId}/settings`);

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
      await page.goto(`/settings/accounts/${accountId}/settings`);

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
      const account = await createAccount(page, `Edit Test ${ts}`);
      testAccountId = account.id;
      await setAccountRiskParams(page, testAccountId);
      await activateAccount(page, testAccountId);
      await page.close();
    });

    test('loads initial account values, then persists values via API and verifies after reload', async ({ page }) => {
      const errorCapture = setupErrorCapture(page);

      await page.goto(`/settings/accounts/${testAccountId}/settings`);
      await page.waitForResponse(
        (res) => res.url().includes(`/api/accounts/${testAccountId}`) && res.status() === 200,
      );

      // ── Verify initial values from API setup ────────────────────────
      await expect(page.getByLabel(/account name/i)).toHaveValue(/^Edit Test/);
      await expect(page.locator('#settings-max-risk')).toHaveValue('2');
      await expect(page.locator('#settings-default-commission')).toHaveValue('1');

      // ── Persist updated values via direct API call ───────────────────
      const apiResponse = await page.request.put(`/api/accounts/${testAccountId}`, {
        data: {
          name: 'Renamed Account',
          maxRiskPerTradePct: 3.5,
          defaultCommission: 2.5,
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
      await expect(page.locator('#settings-default-commission')).toHaveValue('2.5');

      // ── Verify no API or page errors (filter turbopack dev HMR infra) ─
      const appErrors = errorCapture.errors.filter(
        (e) => !e.includes('[turbopack]') && !e.includes('Failed to load chunk'),
      );
      expect(appErrors).toEqual([]);
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
      const account = await createAccount(page, lifecycleAccountName);
      lifecycleAccountId = account.id;
      await setAccountRiskParams(page, lifecycleAccountId);
      await activateAccount(page, lifecycleAccountId);
      await postDeposit(page, lifecycleAccountId, '50000.00', 'Initial funding');
      await page.close();
    });

    test('close account with confirmation dialog and closure summary', async ({ page }) => {
      await page.goto(`/settings/accounts/${lifecycleAccountId}/settings`);
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
      // Register listener before click to avoid race condition
      const closeApiResponse = page.waitForResponse(
        (res) =>
          res.url().includes(`/api/accounts/${lifecycleAccountId}/close`) && res.ok(),
      );
      await confirmButton.click();
      await closeApiResponse;

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
      await page.goto(`/settings/accounts/${lifecycleAccountId}/settings`);
      await page.waitForResponse(
        (res) => res.url().includes(`/api/accounts/${lifecycleAccountId}`) && res.status() === 200,
      );

      // Verify inactive state
      await expect(page.getByText('Inactive', { exact: true }).first()).toBeVisible();

      // ── Click Reactivate ────────────────────────────────────────────
      const reactivateButton = page.getByRole('button', { name: /reactivate account/i });
      await expect(reactivateButton).toBeVisible();
      // Register both listeners before click to avoid race conditions
      const putReactivate = page.waitForResponse(
        (res) =>
          res.url().includes(`/api/accounts/${lifecycleAccountId}`) &&
          res.request().method() === 'PUT' &&
          res.status() === 200,
      );
      const getRefresh = page.waitForResponse(
        (res) =>
          res.url().includes(`/api/accounts/${lifecycleAccountId}`) &&
          res.request().method() === 'GET' &&
          res.status() === 200,
      );
      await reactivateButton.click();

      // Wait for the PUT reactivation
      await putReactivate;

      // Wait for the GET refresh that follows the PUT
      await getRefresh;

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

  test.describe('Settings tab direct route and unknown account', () => {
    test('/settings/accounts/[id]/settings renders identity and lifecycle controls', async ({ page }) => {
      // Use the account created in the first test group
      const ts = Date.now();
      const testAccount = await createAccount(page, `Direct Route E2E ${ts}`);
      await activateAccount(page, testAccount.id);

      // Navigate directly to the Settings tab
      await page.goto(`/settings/accounts/${testAccount.id}/settings`);

      // Should land at the same URL (no redirect)
      await expect(page).toHaveURL(`/settings/accounts/${testAccount.id}/settings`);

      // Verify settings content rendered
      await page.waitForResponse(
        (res) => res.url().includes(`/api/accounts/${testAccount.id}`) && res.status() === 200,
      );
      await expect(page.getByRole('heading', { name: /account identity/i })).toBeVisible();
    });

    test('shows not-found error for unknown account UUID', async ({ page }) => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';
      await page.goto(`/settings/accounts/${nonExistentId}/settings`);

      // Wait for the account API to return 404
      await page.waitForResponse(
        (res) => res.url().includes(`/api/accounts/${nonExistentId}`) && res.status() === 404,
      );

      // The layout handles the not-found state with error message and back link
      await expect(page.getByText('Account not found.')).toBeVisible();
      await expect(page.getByRole('link', { name: /back to accounts/i })).toBeVisible();
    });
  });

  test.describe('S05: Broker editing and read-only currency display', () => {
    let brokerAccountId: string;

    test.beforeAll(async ({ browser }) => {
      const page = await browser.newPage();
      const ts = Date.now();
      const account = await createAccount(page, `Broker Edit E2E ${ts}`);
      brokerAccountId = account.id;
      await setAccountRiskParams(page, brokerAccountId);
      await activateAccount(page, brokerAccountId);
      await page.close();
    });

    test('renders broker value and base currency as a read-only disabled field', async ({ page }) => {
      await page.goto(`/settings/accounts/${brokerAccountId}/settings`);
      await page.waitForResponse(
        (res) => res.url().includes(`/api/accounts/${brokerAccountId}`) && res.status() === 200,
      );

      // ── Broker field shows the value from account creation ─────────
      const brokerInput = page.locator('#settings-account-broker');
      await expect(brokerInput).toBeVisible();
      await expect(brokerInput).toHaveValue('E2E Broker');

      // ── Base currency: read-only disabled input with creation hint ──
      const currencyInput = page.locator('#settings-account-currency');
      await expect(currencyInput).toBeVisible();
      await expect(currencyInput).toBeDisabled();
      await expect(currencyInput).toHaveValue('USD');
      await expect(
        page.getByText(/Base currency is set when the account is created/i),
      ).toBeVisible();
    });

    test('edits the broker through the UI and persists after reload', async ({ page }) => {
      await page.goto(`/settings/accounts/${brokerAccountId}/settings`);
      await page.waitForResponse(
        (res) => res.url().includes(`/api/accounts/${brokerAccountId}`) && res.status() === 200,
      );

      // ── Edit the broker field ──────────────────────────────────────
      const brokerInput = page.locator('#settings-account-broker');
      await brokerInput.fill('IBKR Pro');
      // Settle so React commits the new value before Save reads it.
      await settleReactInput(page);

      // ── Save and wait for the PUT round trip ───────────────────────
      const putResponse = page.waitForResponse(
        (res) =>
          res.url().includes(`/api/accounts/${brokerAccountId}`) &&
          res.request().method() === 'PUT' &&
          res.status() === 200,
      );
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await putResponse;
      await expect(page.getByText('Settings saved successfully.')).toBeVisible();

      // ── Reload: broker persists through the real API ───────────────
      await page.reload();
      await page.waitForResponse(
        (res) => res.url().includes(`/api/accounts/${brokerAccountId}`) && res.status() === 200,
      );
      await expect(page.locator('#settings-account-broker')).toHaveValue('IBKR Pro');
    });

    test('clearing the broker field saves null (removes the reference)', async ({ page }) => {
      await page.goto(`/settings/accounts/${brokerAccountId}/settings`);
      await page.waitForResponse(
        (res) => res.url().includes(`/api/accounts/${brokerAccountId}`) && res.status() === 200,
      );

      const brokerInput = page.locator('#settings-account-broker');
      await expect(brokerInput).toHaveValue('IBKR Pro');

      // Clear the field and save
      await brokerInput.fill('');
      // Settle so React commits the cleared value before Save reads it.
      await settleReactInput(page);
      const putResponse = page.waitForResponse(
        (res) =>
          res.url().includes(`/api/accounts/${brokerAccountId}`) &&
          res.request().method() === 'PUT' &&
          res.status() === 200,
      );
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await putResponse;

      // Server stores null
      const account = await (await page.request.get(`/api/accounts/${brokerAccountId}`)).json();
      expect(account.broker).toBeNull();
    });
  });

  test.describe('S05: Currency mutation guard', () => {
    let guardedAccountId: string;

    test.beforeAll(async ({ browser }) => {
      const page = await browser.newPage();
      const ts = Date.now();
      const account = await createAccount(page, `Currency Guard E2E ${ts}`);
      guardedAccountId = account.id;
      await setAccountRiskParams(page, guardedAccountId);
      // A6 lifecycle: activate BEFORE the deposit (inactive accounts cannot
      // originate new financial activity); the deposit creates financial
      // history (financial_events row) used by the currency-mutation guard.
      await activateAccount(page, guardedAccountId);
      await postDeposit(page, guardedAccountId, '10000.00', 'Creates financial history');
      await page.close();
    });

    test('rejects currency mutation to EUR with 400 (USD-only contract)', async ({ page }) => {
      // Attempt to change the base currency of an account to a non-USD value.
      // The USD-only contract rejects this at validation (400) — even with
      // financial history, and even without it — never silently coerced.
      const response = await page.request.put(`/api/accounts/${guardedAccountId}`, {
        data: { currency: 'EUR' },
      });
      expect(response.status()).toBe(400);

      const body = await response.json();
      expect(body.error).toBe('Validation failed');

      // The declared currency is unchanged
      const account = await (await page.request.get(`/api/accounts/${guardedAccountId}`)).json();
      expect(account.currency).toBe('USD');
    });
  });

  test.describe('S05: Close-route open-trade guard', () => {
    let openTradeAccountId: string;

    test.beforeAll(async ({ browser }) => {
      const page = await browser.newPage();
      const ts = Date.now();
      const account = await createAccount(page, `Open Trade Guard E2E ${ts}`);
      openTradeAccountId = account.id;
      // Full trading setup: risk params + opening cash + activation
      await prepareAccountForTrading(page.request, openTradeAccountId);

      // A planned trade is a non-closed status → counts as open for the guard
      const tradeRes = await page.request.post('/api/trades', {
        data: { symbol: 'GUARD', direction: 'long', accountId: openTradeAccountId },
      });
      expect(tradeRes.status()).toBe(201);
      await page.close();
    });

    test('API: close returns 409 with a descriptive error and leaves the account active', async ({ page }) => {
      const response = await page.request.post(`/api/accounts/${openTradeAccountId}/close`);
      expect(response.status()).toBe(409);

      const body = await response.json();
      expect(body.error).toContain('Cannot close account with open trades');

      // Account remains active — no mutation occurred
      const account = await (await page.request.get(`/api/accounts/${openTradeAccountId}`)).json();
      expect(account.isActive).toBe(true);
    });

    test('UI: close dialog surfaces the guard error and keeps the account active', async ({ page }) => {
      await page.goto(`/settings/accounts/${openTradeAccountId}/settings`);
      await page.waitForResponse(
        (res) => res.url().includes(`/api/accounts/${openTradeAccountId}`) && res.status() === 200,
      );

      // ── Open the close dialog and confirm ──────────────────────────
      await page.getByRole('button', { name: /close account/i }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();

      // Register the 409 listener before the confirm click
      const closeResponse = page.waitForResponse(
        (res) =>
          res.url().includes(`/api/accounts/${openTradeAccountId}/close`) &&
          res.status() === 409,
      );
      await dialog.getByRole('button', { name: /confirm close/i }).click();
      await closeResponse;

      // ── Wait for the guard error banner (proves the 409 handler ran
      // and re-enabled the dialog buttons) before dismissing ──────────
      await expect(page.getByText(/Cannot close account with open trades/i)).toBeVisible();

      // ── Dismiss the dialog (the guard blocked closure) ─────────────
      await dialog.getByRole('button', { name: /cancel/i }).click();
      await expect(dialog).not.toBeVisible();

      // ── Error banner still shows the actionable guard message ──────
      await expect(page.getByText(/Cannot close account with open trades/i)).toBeVisible();

      // ── Account is still active with the Close Account button ───────
      await expect(page.getByText('Active', { exact: true }).first()).toBeVisible();
      await expect(page.getByRole('button', { name: /close account/i })).toBeVisible();
    });
  });

  test.describe('S05: Default-account clearing on deactivation', () => {
    let defaultAccountId: string;
    let fallbackAccountId: string;

    test.beforeAll(async ({ browser }) => {
      const page = await browser.newPage();
      const ts = Date.now();
      const defaultAccount = await createAccount(page, `Default Acct E2E ${ts}`);
      defaultAccountId = defaultAccount.id;
      await setAccountRiskParams(page, defaultAccountId);
      await activateAccount(page, defaultAccountId);

      // A fully-prepared fallback account (active, funded) for consumer fallback
      const fallbackAccount = await createAccount(page, `Fallback Acct E2E ${ts}`);
      fallbackAccountId = fallbackAccount.id;
      await prepareAccountForTrading(page.request, fallbackAccountId);

      // Make the first account the settings default
      const settingsRes = await page.request.put('/api/settings', {
        data: { defaultAccountId: defaultAccountId },
      });
      expect([200, 201]).toContain(settingsRes.status());
      await page.close();
    });

    test('deactivating the default account via PUT clears settings.defaultAccountId', async ({ page }) => {
      // Confirm the default reference is set
      const before = await (await page.request.get('/api/settings')).json();
      expect(before.defaultAccountId).toBe(defaultAccountId);

      // Deactivate via PUT {isActive: false}
      const deactivate = await page.request.put(`/api/accounts/${defaultAccountId}`, {
        data: { isActive: false },
      });
      expect(deactivate.status()).toBe(200);

      // Default reference is cleared (silent — consumers fall back to first active)
      const after = await (await page.request.get('/api/settings')).json();
      expect(after.defaultAccountId).toBeNull();
    });

    test('deactivating a non-default account preserves the default reference', async ({ page }) => {
      // Set the fallback account as the default first
      const setDefault = await page.request.put('/api/settings', {
        data: { defaultAccountId: fallbackAccountId },
      });
      expect([200, 201]).toContain(setDefault.status());

      // The original default account is inactive from the previous test; reactivate it
      const reactivate = await page.request.put(`/api/accounts/${defaultAccountId}`, {
        data: { isActive: true },
      });
      expect(reactivate.status()).toBe(200);

      // Deactivate the non-default account
      const deactivate = await page.request.put(`/api/accounts/${defaultAccountId}`, {
        data: { isActive: false },
      });
      expect(deactivate.status()).toBe(200);

      // The default reference survives — only the default's own deactivation clears it
      const settings = await (await page.request.get('/api/settings')).json();
      expect(settings.defaultAccountId).toBe(fallbackAccountId);
    });

    test('closing the default account via the close route clears settings.defaultAccountId', async ({ page }) => {
      // Set the fallback account as default, then close it
      const setDefault = await page.request.put('/api/settings', {
        data: { defaultAccountId: fallbackAccountId },
      });
      expect([200, 201]).toContain(setDefault.status());

      const closeRes = await page.request.post(`/api/accounts/${fallbackAccountId}/close`);
      expect(closeRes.status()).toBe(200);

      // Close-path deactivation also clears the stale reference
      const settings = await (await page.request.get('/api/settings')).json();
      expect(settings.defaultAccountId).toBeNull();
    });

    test('consumer fallback: a trade without accountId resolves to an active account when default is null', async ({ page }) => {
      // defaultAccountId is null at this point (cleared by the close-route test)
      const settings = await (await page.request.get('/api/settings')).json();
      expect(settings.defaultAccountId).toBeNull();

      // Create a trade with no explicit accountId
      const tradeRes = await page.request.post('/api/trades', {
        data: { symbol: 'FALLBACK', direction: 'long' },
      });
      expect(tradeRes.status()).toBe(201);
      const trade = await tradeRes.json();

      // It must have landed on an ACTIVE account (not the closed default)
      const account = await (await page.request.get(`/api/accounts/${trade.accountId}`)).json();
      expect(account.isActive).toBe(true);
    });
  });
});
