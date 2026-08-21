/**
 * E2E coverage for the Financial Transaction Composer (S03/T03).
 *
 * Drives the real "Add Transaction" entry point on the account overview:
 *
 * 1. The dialog offers exactly the 7 R014-curated event types (Deposit,
 *    Withdrawal, Dividend, Interest, Fee, Tax, Manual Adjustment) — no
 *    opening_balance/transfer/stock_split in the composer.
 * 2. Deposit path: live economic-effect preview (Cash increase), canonical
 *    POST /api/accounts/:id/financial-events, perceivable success, dialog
 *    close, overview refetch (new event visible in Recent Events), net cash
 *    update, and a balanced double-entry posting (is_balanced, posting_count
 *    = 2) observable through the existing ledger API.
 * 3. Withdrawal path: preview flips to Cash decrease and the withdrawal event
 *    lands in Recent Events with a balanced posting.
 * 4. Client-side validation rejects empty, zero, negative (except manual
 *    adjustment) and >2-decimal amounts before any API round-trip, and
 *    manual_adjustment requires a non-zero signed amount plus a reason.
 * 5. API errors surface in role=alert banners: 400 field errors, 500 error
 *    strings, and a network-failure fallback. Retry keeps the entered values
 *    and succeeds once the API recovers.
 *
 * Precondition: Next.js dev-server running (Playwright webServer handles it).
 * Run: npx playwright test e2e/account-transaction-composer.spec.ts --project=chromium
 */

import { expect, test, type Locator, type Page } from '@playwright/test';
import { hideDevOverlay } from './helpers';

/** The curated event-type labels the composer must offer (R014). */
const CURATED_EVENT_TYPES = [
  'Deposit',
  'Withdrawal',
  'Dividend',
  'Interest',
  'Fee',
  'Tax',
  'Manual Adjustment',
] as const;

// ── Test Helpers ────────────────────────────────────────────────────────

/**
 * Create an account via the canonical API.
 */
async function createAccount(page: Page, name: string): Promise<{ id: string; name: string }> {
  const response = await page.request.post('/api/accounts', {
    data: { name, broker: 'E2E Broker', currency: 'USD' },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string; name: string };
}

/**
 * Fund the account with an opening deposit and activate it so the overview
 * leaves the draft initialization state and renders the Add Transaction
 * entry point (mirrors the product's setup path).
 */
async function fundAndActivate(page: Page, accountId: string, amount = '10000.00') {
  const depositResponse = await page.request.post(`/api/accounts/${accountId}/financial-events`, {
    data: { eventType: 'deposit', amount, description: 'E2E setup deposit' },
  });
  expect(depositResponse.status()).toBe(201);
  const activateResponse = await page.request.put(`/api/accounts/${accountId}`, {
    data: { isActive: true },
  });
  expect(activateResponse.status()).toBe(200);
}

/**
 * Navigate to the account overview and wait for the initial overview load.
 */
async function openOverview(page: Page, accountId: string) {
  await page.goto(`/settings/accounts/${accountId}`);
  await page.waitForResponse(
    (res) => res.url().includes(`/api/accounts/${accountId}/overview`) && res.status() === 200,
  );
  await expect(page.getByRole('button', { name: 'Add Transaction' })).toBeVisible();
}

/**
 * Open the FinancialTransactionComposer dialog from the Recent Events
 * header. Returns the dialog locator (scoped) for form interaction.
 */
async function openComposer(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Add Transaction' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Add Transaction' })).toBeVisible();
  return dialog;
}

/**
 * Create a fresh live account and open its overview composer. Each test gets
 * its own account so event counts and cash assertions stay deterministic.
 */
async function setupLiveAccount(page: Page, testName: string) {
  const account = await createAccount(page, `${testName} ${Date.now()}`);
  await fundAndActivate(page, account.id);
  await openOverview(page, account.id);
  return account;
}

/**
 * Submit the dialog and register the canonical API round-trip plus the
 * overview refetch that follows the success handoff.
 *
 * The success banner (POST_SUCCESS_DELAY_MS = 450ms) is rendered *before* the
 * refetch is triggered (onPosted fires from the same timeout), so callers must
 * poll the banner first and only then await the overview refresh.
 */
async function submitAndAwaitHandoff(
  page: Page,
  accountId: string,
  dialog: Locator,
): Promise<{ post: Awaited<ReturnType<Page['waitForResponse']>>; overviewRefresh: Promise<void> }> {
  const postResponse = page.waitForResponse(
    (res) =>
      res.url().includes(`/api/accounts/${accountId}/financial-events`) &&
      res.request().method() === 'POST',
  );
  const overviewRefresh = page
    .waitForResponse(
      (res) => res.url().includes(`/api/accounts/${accountId}/overview`) && res.status() === 200,
    )
    .then(() => undefined);
  await dialog.getByRole('button', { name: 'Post Transaction' }).click();
  const post = await postResponse;
  return { post, overviewRefresh };
}

/**
 * Assert the perceivable success banner. The banner is transient
 * (POST_SUCCESS_DELAY_MS = 450ms before the dialog closes), so poll with fast
 * intervals right after the POST resolves — the same pattern the
 * opening-balance E2E uses for its transient confirmation.
 */
async function expectSuccessBanner(page: Page, label: string) {
  await expect
    .poll(() => page.getByRole('status').filter({ hasText: `${label} posted` }).count(), {
      timeout: 5_000,
      intervals: [25],
    })
    .toBeGreaterThan(0);
}

/**
 * Assert the posted event is visible in the overview Recent Events table with
 * the right type badge and Posted status.
 */
async function expectEventRow(page: Page, description: string, badge: string) {
  const row = page.locator('table tbody tr').filter({ hasText: description });
  await expect(row).toContainText(badge);
  await expect(row).toContainText('Posted');
}

/**
 * Verify the ledger-level observability contract from the slice plan: each
 * successful POST created one financial_event row, one ledger_entry row, and
 * one balanced debit/credit posting pair (is_balanced=true, posting_count=2).
 */
async function expectBalancedPosting(page: Page, accountId: string, description: string) {
  const response = await page.request.get(`/api/accounts/${accountId}/financial-events?limit=200`);
  expect(response.status()).toBe(200);
  const body = (await response.json()) as {
    events: Array<{ event: { description: string | null }; status: Record<string, unknown> }>;
  };
  const match = body.events.find((e) => e.event.description === description);
  expect(match).toBeTruthy();
  expect(match!.status).toMatchObject({ hasEntry: true, isBalanced: true, postingCount: 2 });
}

/** Read the account overview snapshot's netCash as a number. */
async function readNetCash(page: Page, accountId: string): Promise<number> {
  const response = await page.request.get(`/api/accounts/${accountId}/overview`);
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { snapshot: { netCash: string | null } };
  return parseFloat(body.snapshot.netCash ?? 'NaN');
}

// ── Tests ───────────────────────────────────────────────────────────────

test.describe('Financial Transaction Composer (S03)', () => {
  test('event type selector offers exactly the 7 curated types with no init/transfer/split options', async ({ page }) => {
    await hideDevOverlay(page);
    await setupLiveAccount(page, 'Composer Selector');
    const dialog = await openComposer(page);

    const eventTypeSelect = dialog.getByLabel('Event Type');
    await expect(eventTypeSelect).toHaveValue('deposit');

    // Exactly the 7 R014-curated cash-flow types, in order.
    const optionTexts = (await dialog.locator('#ftc-event-type option').allTextContents()).map((t) =>
      t.trim(),
    );
    expect(optionTexts).toEqual([...CURATED_EVENT_TYPES]);

    // opening_balance (initialization-only), transfer, and stock_split are
    // intentionally NOT offered by the composer.
    for (const excluded of ['Opening Balance', 'Transfer', 'Stock Split']) {
      await expect(dialog.getByRole('option', { name: excluded })).toHaveCount(0);
    }
  });

  test('deposit flow: preview, canonical POST, success handoff, refresh, and balanced ledger', async ({ page }) => {
    await hideDevOverlay(page);
    const account = await setupLiveAccount(page, 'Composer Deposit');

    const dialog = await openComposer(page);
    const preview = dialog.getByTestId('ftc-effect-preview');

    // Empty amount → neutral preview.
    await expect(preview).toContainText('Effect');

    const description = 'Composer E2E deposit';
    await dialog.getByLabel('Amount (USD)').fill('500.00');
    await dialog.getByLabel('Description (optional)').fill(description);

    // Live economic-effect preview: deposit increases cash.
    await expect(preview).toContainText('Cash increase');
    await expect(preview).toContainText('USD 500.00');

    const { post, overviewRefresh } = await submitAndAwaitHandoff(page, account.id, dialog);
    expect(post.status()).toBe(201);

    // Perceivable success confirmation (transient), then the dialog closes.
    await expectSuccessBanner(page, 'Deposit');
    await overviewRefresh;
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Overview refetched: the new event is immediately visible in Recent
    // Events (2 total = setup deposit + composer deposit) with badge/status.
    await expect(page.getByText('(2 total)')).toBeVisible();
    await expectEventRow(page, description, 'Deposit');

    // Account cash updated by exactly the deposit amount.
    expect(await readNetCash(page, account.id)).toBe(10500);

    // Ledger observability contract: one event + one entry + balanced pair.
    await expectBalancedPosting(page, account.id, description);
  });

  test('withdrawal flow: decrease preview and balanced withdrawal event', async ({ page }) => {
    await hideDevOverlay(page);
    const account = await setupLiveAccount(page, 'Composer Withdrawal');

    const dialog = await openComposer(page);
    const preview = dialog.getByTestId('ftc-effect-preview');

    const description = 'Composer E2E withdrawal';
    await dialog.getByLabel('Event Type').selectOption('withdrawal');
    await dialog.getByLabel('Amount (USD)').fill('250.00');
    await dialog.getByLabel('Description (optional)').fill(description);

    // Live economic-effect preview: withdrawal decreases cash.
    await expect(preview).toContainText('Cash decrease');
    await expect(preview).toContainText('USD 250.00');

    const { post, overviewRefresh } = await submitAndAwaitHandoff(page, account.id, dialog);
    expect(post.status()).toBe(201);

    await expectSuccessBanner(page, 'Withdrawal');
    await overviewRefresh;
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await expect(page.getByText('(2 total)')).toBeVisible();
    await expectEventRow(page, description, 'Withdrawal');

    // Cash reduced by the withdrawal amount (10000 - 250).
    expect(await readNetCash(page, account.id)).toBe(9750);
    await expectBalancedPosting(page, account.id, description);
  });

  test('client-side validation rejects empty, zero, negative, and >2-decimal amounts before any API call', async ({ page }) => {
    await hideDevOverlay(page);
    await setupLiveAccount(page, 'Composer Validation');

    // Count API round-trips to prove validation blocks them.
    let postCount = 0;
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('/financial-events')) postCount += 1;
    });

    const dialog = await openComposer(page);
    const amount = dialog.getByLabel('Amount (USD)');
    const submit = dialog.getByRole('button', { name: 'Post Transaction' });

    // Empty amount.
    await submit.click();
    await expect(dialog.getByText('Enter an amount.')).toBeVisible();

    // Zero.
    await amount.fill('0');
    await submit.click();
    await expect(dialog.getByText('Enter a positive amount with up to 2 decimal places.')).toBeVisible();

    // Negative (rejected for deposit; only manual_adjustment allows signed).
    await amount.fill('-5');
    await submit.click();
    await expect(dialog.getByText('Enter a positive amount with up to 2 decimal places.')).toBeVisible();

    // More than two decimal places.
    await amount.fill('100.999');
    await submit.click();
    await expect(dialog.getByText('Enter a positive amount with up to 2 decimal places.')).toBeVisible();

    // Manual adjustment: zero is rejected with its own message.
    await dialog.getByLabel('Event Type').selectOption('manual_adjustment');
    await amount.fill('0');
    await submit.click();
    await expect(dialog.getByText('Enter a non-zero adjustment amount.')).toBeVisible();

    // Signed adjustment preview, then the required-reason gate.
    await amount.fill('-50.00');
    await expect(dialog.getByTestId('ftc-effect-preview')).toContainText('Cash decrease');
    await expect(dialog.getByTestId('ftc-effect-preview')).toContainText('USD 50.00');
    await submit.click();
    await expect(dialog.getByText('Enter a reason for the adjustment.')).toBeVisible();

    // None of these validation failures reached the API.
    expect(postCount).toBe(0);
  });

  test('API 400 field errors surface in a role=alert banner and retry keeps values and succeeds', async ({ page }) => {
    await hideDevOverlay(page);
    const account = await setupLiveAccount(page, 'Composer API 400');

    const dialog = await openComposer(page);
    const amount = dialog.getByLabel('Amount (USD)');

    // Server-side field validation failure.
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
    await dialog.getByRole('button', { name: 'Post Transaction' }).click();

    // The API message surfaces in a role=alert banner; the dialog stays open.
    await expect(dialog.getByRole('alert').filter({ hasText: 'Amount must be a positive number' })).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Add Transaction' })).toBeVisible();
    await expect(amount).toHaveValue('5000');
    await page.unroute(`**/api/accounts/${account.id}/financial-events`);

    // Retry with the same values succeeds and hands off.
    const description = 'Composer retry after 400';
    await dialog.getByLabel('Description (optional)').fill(description);
    const { post, overviewRefresh } = await submitAndAwaitHandoff(page, account.id, dialog);
    expect(post.status()).toBe(201);
    await expectSuccessBanner(page, 'Deposit');
    await overviewRefresh;
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expectEventRow(page, description, 'Deposit');
    await expectBalancedPosting(page, account.id, description);
  });

  test('API 500 error surfaces in a role=alert banner and can be dismissed', async ({ page }) => {
    await hideDevOverlay(page);
    const account = await setupLiveAccount(page, 'Composer API 500');

    await page.route(`**/api/accounts/${account.id}/financial-events`, async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Failed to post financial event', details: 'simulated failure' }),
        });
        return;
      }
      await route.fallback();
    });

    const dialog = await openComposer(page);
    await dialog.getByLabel('Amount (USD)').fill('1000.00');
    await dialog.getByRole('button', { name: 'Post Transaction' }).click();

    const banner = dialog.getByRole('alert').filter({ hasText: 'Failed to post financial event' });
    await expect(banner).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Add Transaction' })).toBeVisible();
    await page.unroute(`**/api/accounts/${account.id}/financial-events`);

    // Dismiss clears the banner; the dialog remains for another attempt.
    await banner.getByRole('button', { name: 'Dismiss' }).click();
    await expect(dialog.getByRole('alert')).toHaveCount(0);
  });

  test('network failure surfaces the fallback error and retains entered values for retry', async ({ page }) => {
    await hideDevOverlay(page);
    const account = await setupLiveAccount(page, 'Composer Network');

    await page.route(`**/api/accounts/${account.id}/financial-events`, async (route) => {
      if (route.request().method() === 'POST') {
        await route.abort('failed');
        return;
      }
      await route.fallback();
    });

    const dialog = await openComposer(page);
    const amount = dialog.getByLabel('Amount (USD)');
    await amount.fill('300.00');
    await dialog.getByRole('button', { name: 'Post Transaction' }).click();

    // Connection failure → fallback message, values preserved. Number inputs
    // may canonicalize "300.00" → "300", so assert retention via the live
    // effect preview (the user-visible contract) rather than the raw input.
    const banner = dialog.getByRole('alert').filter({ hasText: 'Could not post the transaction. Please try again.' });
    await expect(banner).toBeVisible();
    await expect(dialog.getByTestId('ftc-effect-preview')).toContainText('USD 300.00');
    await page.unroute(`**/api/accounts/${account.id}/financial-events`);

    // Retry with the same values succeeds.
    const description = 'Composer retry after network failure';
    await dialog.getByLabel('Description (optional)').fill(description);
    const { post, overviewRefresh } = await submitAndAwaitHandoff(page, account.id, dialog);
    expect(post.status()).toBe(201);
    await expectSuccessBanner(page, 'Deposit');
    await overviewRefresh;
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expectEventRow(page, description, 'Deposit');
    await expectBalancedPosting(page, account.id, description);
  });
});
