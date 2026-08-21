/**
 * E2E flow for S02: Account creation and initialization.
 *
 * Verifies the full user journey that the S02 component tests cannot cover
 * end-to-end:
 *
 * 1. Add Account dialog → create → AccountProvider refresh → navigation into
 *    the new account workspace with the guided initialization state.
 * 2. Optional "Make this my default account" persists the default and marks
 *    the row on the accounts list.
 * 3. "Add opening balance" path posts an opening_balance financial event
 *    (never an account property), shows the success state, and transitions
 *    into the live overview (NAV/Net Cash, events table, active header).
 * 4. "Start with zero" path activates the account without fabricating a
 *    financial event.
 * 5. Failure modes from the slice verification: dialog inline validation plus
 *    API 400/409/500 error surfacing; activation API failure with a retryable
 *    initialization state; opening-balance form validation plus API error
 *    surfacing; AccountProvider refresh failure with the sidebar retry.
 *
 * Precondition: Next.js dev-server running (Playwright webServer handles it).
 * Run: npx playwright test e2e/account-creation-initialization.spec.ts
 */

import { expect, test, webkit, type Page } from '@playwright/test';
import { hideDevOverlay } from './helpers';

// ── Test Helpers ────────────────────────────────────────────────────────

async function createDraftAccount(page: Page, name: string): Promise<{ id: string; name: string }> {
  const response = await page.request.post('/api/accounts', {
    data: { name, broker: 'E2E Broker', currency: 'USD' },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string; name: string };
}

async function openAddAccountDialog(page: Page) {
  await page.goto('/settings/accounts');
  await expect(page.getByRole('heading', { name: 'Accounts', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '+ Add Account' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Add Account' })).toBeVisible();
  return dialog;
}

/**
 * Drive the real Add Account dialog: fill name/broker, optionally pick a
 * base currency and the make-default checkbox, submit, and wait for the
 * navigation into the new account workspace. Returns the new account id.
 */
async function createAccountViaDialog(
  page: Page,
  opts: { name: string; broker?: string; currency?: string; makeDefault?: boolean },
): Promise<string> {
  const dialog = await openAddAccountDialog(page);
  await dialog.getByLabel('Account name').fill(opts.name);
  if (opts.broker) await dialog.getByLabel('Broker').fill(opts.broker);
  if (opts.currency && opts.currency !== 'USD') {
    await dialog.getByLabel('Base currency').click();
    await page.getByRole('option', { name: opts.currency, exact: true }).click();
  }
  if (opts.makeDefault) {
    await dialog.getByRole('checkbox', { name: /Make this my default account/ }).check();
  }
  await dialog.getByRole('button', { name: 'Create Account' }).click();
  await expect(page).toHaveURL(/\/settings\/accounts\/[0-9a-f-]+$/);
  const match = page.url().match(/\/settings\/accounts\/([0-9a-f-]+)$/);
  if (!match) throw new Error(`Unexpected workspace URL: ${page.url()}`);
  return match[1];
}

/** The guided empty-account initialization state rendered by AccountOverview. */
async function expectInitializationState(page: Page, accountName: string) {
  await expect(page.getByRole('heading', { name: `Set up ${accountName}` })).toBeVisible();
  await expect(page.getByRole('button', { name: /Add opening balance/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Start with zero/ })).toBeVisible();
}

test.describe.configure({ mode: 'serial' });

test.describe('Account creation and initialization', () => {
  test.beforeAll(async ({ browserName }) => {
    // The WebKit project needs GTK/WPE system libraries (libwebkitgtk-6.0,
    // libicu74, libjpeg.so.8) that some dev hosts do not have. Probe the real
    // launch once and skip the webkit run cleanly instead of failing the whole
    // browser matrix; CI (quality-gate.yml) installs per-browser deps with
    // `npx playwright install --with-deps` and still runs webkit there. The
    // probe only ever launches webkit from the webkit worker (`browserName` is
    // a worker-scoped fixture), so chromium/firefox runs are untouched.
    if (browserName !== 'webkit') return;
    let launchable = false;
    try {
      const browser = await webkit.launch({ headless: true });
      await browser.close();
      launchable = true;
    } catch {
      // Launch failed → webkit tests are skipped below.
    }
    test.skip(
      !launchable,
      'WebKit cannot launch on this host (missing GTK/WPE system libraries); ' +
        'skipping so the matrix stays green. CI installs browser deps and runs webkit.',
    );
  });

  test('creates an account through the dialog and lands in the initialization workspace', async ({ page }) => {
    await hideDevOverlay(page);
    const accountName = `Dialog Journey ${Date.now()}`;
    const broker = 'E2E Broker';
    const id = await createAccountViaDialog(page, { name: accountName, broker });

    // Landed in the new account workspace with the guided initialization state.
    await expectInitializationState(page, accountName);

    // The account is a draft: the workspace header shows the inactive badge.
    await expect(page.getByText('Inactive', { exact: true })).toBeVisible();

    // AccountProvider refreshed and selected the new account in the sidebar.
    await expect(page.getByTestId('sidebar-account-trigger')).toContainText(`${accountName} (${broker})`);

    // Persisted as a draft: inactive with no financial events.
    const accountRes = await page.request.get(`/api/accounts/${id}`);
    expect(accountRes.ok()).toBeTruthy();
    const account = await accountRes.json();
    expect(account.isActive).toBe(false);
    expect(account.name).toBe(accountName);
    expect(account.broker).toBe(broker);
  });

  test('sets the new account as the saved default when requested', async ({ page }) => {
    await hideDevOverlay(page);
    const accountName = `Default Journey ${Date.now()}`;
    const id = await createAccountViaDialog(page, { name: accountName, broker: 'E2E Broker', makeDefault: true });

    // The settings row now points at the new account.
    const settingsRes = await page.request.get('/api/settings');
    expect(settingsRes.ok()).toBeTruthy();
    const settings = await settingsRes.json();
    expect(settings.defaultAccountId).toBe(id);

    // The accounts list marks the row as Default and selects it.
    await page.goto('/settings/accounts');
    const row = page.getByRole('row').filter({ hasText: accountName });
    await expect(row.getByText('Default', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Account used by default')).toHaveValue(id);
  });

  test('records an opening balance as a financial event and transitions to the live overview', async ({ page }) => {
    await hideDevOverlay(page);
    const pageErrors: string[] = [];
    const failedResponses: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('response', (response) => {
      if (response.status() >= 400) {
        failedResponses.push(`${response.status()} ${response.request().method()} ${response.url()}`);
      }
    });

    const accountName = `Opening Balance ${Date.now()}`;
    const id = await createAccountViaDialog(page, { name: accountName, broker: 'E2E Broker', currency: 'EUR' });

    // Workspace shows the initialization state and the chosen base currency.
    await expectInitializationState(page, accountName);
    await expect(page.getByText('EUR', { exact: true }).first()).toBeVisible();

    // Opening-balance panel posts a financial event — never an account property.
    await page.getByRole('button', { name: /Add opening balance/ }).click();
    const panel = page.getByRole('region', { name: 'Opening balance' });
    await expect(panel).toBeVisible();
    await panel.getByLabel('Amount (EUR)').fill('10000.00');
    await panel.getByLabel('Description (optional)').fill('Cash from previous broker');

    // The success banner is a transient state (POST_SUCCESS_DELAY_MS = 450ms)
    // shown right after the POST lands, then the view hands off to the live
    // overview. Wait for the POST response first so a cold-compiled route
    // handler in the first browser project can't push the banner past a fixed
    // assertion timeout, and poll for the banner so it is caught whenever it
    // appears within its short window.
    const postResponse = page.waitForResponse(
      (r) => r.url().includes(`/api/accounts/${id}/financial-events`) && r.request().method() === 'POST',
    );
    await panel.getByRole('button', { name: 'Record Opening Balance' }).click();
    expect((await postResponse).status()).toBe(201);
    await expect
      .poll(() => page.getByText('Opening balance recorded').count(), { timeout: 5_000, intervals: [50] })
      .toBeGreaterThan(0);

    // Success confirmation, then the handoff into the live overview.
    await expect(page.getByText('Net Asset Value')).toBeVisible();
    await expect(page.getByText('Net Cash')).toBeVisible();
    // NAV and Net Cash both reflect the posted balance.
    await expect(page.getByText('$10,000.00')).toHaveCount(2);

    // The event surfaces in Recent Events as an Opening entry.
    await expect(page.getByText('Opening', { exact: true })).toBeVisible();

    // Posting an opening balance is a financial event, not an activation: the
    // account remains a draft (inactive) and the header badge stays until the
    // account is activated through the lifecycle path.
    await expect(page.getByText('Inactive', { exact: true })).toBeVisible();

    // Persisted as a balanced double-entry posting.
    const eventsRes = await page.request.get(`/api/accounts/${id}/financial-events`);
    expect(eventsRes.ok()).toBeTruthy();
    const eventsBody = (await eventsRes.json()) as {
      total: number;
      events: Array<{ event: { eventType: string }; status: { hasEntry: boolean; isBalanced: boolean; postingCount: number } }>;
    };
    expect(eventsBody.total).toBe(1);
    expect(eventsBody.events[0].event.eventType).toBe('opening_balance');
    expect(eventsBody.events[0].status).toMatchObject({
      hasEntry: true,
      isBalanced: true,
      postingCount: 2,
    });

    const accountRes = await page.request.get(`/api/accounts/${id}`);
    const account = await accountRes.json();
    expect(account.isActive).toBe(false);

    const unexpectedPageErrors = pageErrors.filter(
      (error) => !error.includes('[turbopack]') && !error.includes('Failed to load chunk'),
    );
    expect(unexpectedPageErrors).toEqual([]);
    const unexpectedFailures = failedResponses.filter(
      (failure) => !failure.includes('favicon') && !failure.includes('__next'),
    );
    expect(unexpectedFailures).toEqual([]);
  });

  test('starts with zero by activating the account without a financial event', async ({ page }) => {
    await hideDevOverlay(page);
    const accountName = `Start With Zero ${Date.now()}`;
    const account = await createDraftAccount(page, accountName);
    await page.goto(`/settings/accounts/${account.id}`);
    await expectInitializationState(page, accountName);

    await page.getByRole('button', { name: /Start with zero/ }).click();

    // Transitions into the live overview; the inactive badge disappears.
    await expect(page.getByText('Net Asset Value')).toBeVisible();
    await expect(page.getByText('No events yet.')).toBeVisible();
    await expect(page.getByText('Inactive', { exact: true })).toHaveCount(0);

    // Activated with a zero balance — no financial event fabricated.
    const accountRes = await page.request.get(`/api/accounts/${account.id}`);
    expect(accountRes.ok()).toBeTruthy();
    const data = await accountRes.json();
    expect(data.isActive).toBe(true);

    const eventsRes = await page.request.get(`/api/accounts/${account.id}/financial-events`);
    expect(eventsRes.ok()).toBeTruthy();
    const eventsBody = (await eventsRes.json()) as { total: number };
    expect(eventsBody.total).toBe(0);
  });

  test('dialog surfaces inline validation and API errors without navigating away', async ({ page }) => {
    await hideDevOverlay(page);
    const dialog = await openAddAccountDialog(page);

    // Client-side validation: empty name.
    await dialog.getByRole('button', { name: 'Create Account' }).click();
    await expect(dialog.getByText('Account name is required.')).toBeVisible();
    await expect(page).toHaveURL(/\/settings\/accounts$/);

    // API conflict (409) surfaces the server error message.
    await page.route('**/api/accounts', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'An account with this name already exists' }),
        });
        return;
      }
      await route.fallback();
    });
    await dialog.getByLabel('Account name').fill(`Conflict Account ${Date.now()}`);
    await dialog.getByRole('button', { name: 'Create Account' }).click();
    await expect(dialog.getByRole('alert').filter({ hasText: 'An account with this name already exists' })).toBeVisible();
    await expect(page).toHaveURL(/\/settings\/accounts$/);
    await page.unroute('**/api/accounts');

    // Server error (500) surfaces in the same banner.
    await page.route('**/api/accounts', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Internal server error' }),
        });
        return;
      }
      await route.fallback();
    });
    await dialog.getByRole('button', { name: 'Create Account' }).click();
    await expect(dialog.getByRole('alert').filter({ hasText: 'Internal server error' })).toBeVisible();
    await expect(page).toHaveURL(/\/settings\/accounts$/);
    await page.unroute('**/api/accounts');
  });

  test('activation failure surfaces the API error and the initialization paths stay retryable', async ({ page }) => {
    await hideDevOverlay(page);
    const accountName = `Activation Retry ${Date.now()}`;
    const account = await createDraftAccount(page, accountName);
    await page.goto(`/settings/accounts/${account.id}`);
    await expectInitializationState(page, accountName);

    // Simulate a transient activation API failure.
    await page.route(`**/api/accounts/${account.id}`, async (route) => {
      if (route.request().method() === 'PUT') {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Account activation unavailable' }),
        });
        return;
      }
      await route.fallback();
    });
    await page.getByRole('button', { name: /Start with zero/ }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Account activation unavailable' })).toBeVisible();
    // Both paths remain available for a retry.
    await expect(page.getByRole('button', { name: /Add opening balance/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Start with zero/ })).toBeVisible();
    await page.unroute(`**/api/accounts/${account.id}`);

    // Retry succeeds and activates the account.
    await page.getByRole('button', { name: /Start with zero/ }).click();
    await expect(page.getByText('Net Asset Value')).toBeVisible();
    await expect(page.getByText('Inactive', { exact: true })).toHaveCount(0);

    const accountRes = await page.request.get(`/api/accounts/${account.id}`);
    const data = await accountRes.json();
    expect(data.isActive).toBe(true);
  });

  test('opening balance form validates input and surfaces API errors', async ({ page }) => {
    await hideDevOverlay(page);
    const accountName = `Opening Balance Errors ${Date.now()}`;
    const account = await createDraftAccount(page, accountName);
    await page.goto(`/settings/accounts/${account.id}`);
    await expectInitializationState(page, accountName);

    await page.getByRole('button', { name: /Add opening balance/ }).click();
    const panel = page.getByRole('region', { name: 'Opening balance' });
    await expect(panel).toBeVisible();
    const amount = panel.getByLabel('Amount (USD)');
    const submit = panel.getByRole('button', { name: 'Record Opening Balance' });

    // Empty amount.
    await submit.click();
    await expect(panel.getByText('Enter the opening balance amount.')).toBeVisible();

    // Zero and more than two decimal places are rejected client-side.
    await amount.fill('0');
    await submit.click();
    await expect(panel.getByText('Enter a positive amount with up to 2 decimal places.')).toBeVisible();

    await amount.fill('100.999');
    await submit.click();
    await expect(panel.getByText('Enter a positive amount with up to 2 decimal places.')).toBeVisible();

    // API validation failure surfaces the server field error.
    await page.route(`**/api/accounts/${account.id}/financial-events`, async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'Validation failed',
            details: { fieldErrors: { amount: ['Amount must be a positive number'] } },
          }),
        });
        return;
      }
      await route.fallback();
    });
    await amount.fill('5000');
    await submit.click();
    await expect(panel.getByRole('alert').filter({ hasText: 'Amount must be a positive number' })).toBeVisible();
    await page.unroute(`**/api/accounts/${account.id}/financial-events`);

    // Retry succeeds and hands off into the live overview. The success banner
    // is transient (POST_SUCCESS_DELAY_MS = 450ms) — wait for the POST response
    // and poll for the banner rather than racing its short visibility window.
    const retryResponse = page.waitForResponse(
      (r) => r.url().includes(`/api/accounts/${account.id}/financial-events`) && r.request().method() === 'POST',
    );
    await submit.click();
    expect((await retryResponse).status()).toBe(201);
    await expect
      .poll(() => page.getByText('Opening balance recorded').count(), { timeout: 5_000, intervals: [50] })
      .toBeGreaterThan(0);
    await expect(page.getByText('Net Asset Value')).toBeVisible();
  });

  test('AccountProvider refresh failure shows a sidebar retry that recovers', async ({ page }) => {
    await hideDevOverlay(page);
    // Guarantee at least one account exists so the selector renders after recovery.
    await createDraftAccount(page, `Sidebar Retry ${Date.now()}`);
    await page.goto('/settings/accounts');
    await expect(page.getByRole('heading', { name: 'Accounts', exact: true })).toBeVisible();

    // AccountProvider initial fetch fails → error state with retry in the sidebar.
    await page.route('**/api/accounts', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Accounts unavailable' }),
        });
        return;
      }
      await route.fallback();
    });
    await page.reload();
    await expect(page.getByRole('button', { name: 'Retry loading accounts' })).toBeVisible();
    await page.unroute('**/api/accounts');

    // Retry re-fetches and the account selector returns.
    await page.getByRole('button', { name: 'Retry loading accounts' }).click();
    await expect(page.getByTestId('sidebar-account-trigger')).toBeVisible();
  });
});
