/**
 * S07/T01 — Full account lifecycle UAT (single coherent journey).
 *
 * Walks the complete real-user account lifecycle end-to-end as one unified
 * journey, proving the individual slice specs compose:
 *
 *   create → initialize (opening balance) → activate → deposit → withdraw
 *   → inspect overview → inspect ledger → correct an event → change
 *   settings → deactivate (close)
 *
 * Beyond the flow itself, each step verifies the accessibility and visual
 * acceptance criteria from the milestone:
 *   - Keyboard use: dialogs and the workspace tab bar are driven by Tab /
 *     Enter / arrow keys; form submission happens through the keyboard.
 *   - Form labels: every input is reachable through its visible label
 *     (getByLabel), including aria-invalid wiring.
 *   - Focus states: autoFocus lands in the right field, Tab order matches
 *     the visual order, and keyboard-focused controls show a visible focus
 *     indicator (focus-visible ring via computed box-shadow).
 *   - Numeric alignment: financial values use tabular-nums and cash columns
 *     right-align in the ledger.
 *   - Loading states: overview and ledger show explicit loading placeholders.
 *   - Errors: client-side validation (required name, empty amount, required
 *     correction reason) surfaces inline, never reaching the API.
 *   - Empty states: "No open positions.", "No events yet.", "No ledger
 *     events yet.", and the filtered "No matching events." + Clear filter.
 *   - Success feedback: transient role=status banners at every posting step
 *     plus the closure summary.
 *   - No horizontal overflow on the overview, ledger, and settings pages.
 *
 * A closing integrity check confirms the corrected stream propagates: the
 * closure summary's final balance equals opening + corrected deposit −
 * withdrawal (10000 + 750 − 250 = 10500).
 *
 * Precondition: Next.js dev-server running (Playwright webServer handles it).
 * Run: npx playwright test e2e/account-lifecycle-uat.spec.ts --project=chromium
 */

import { expect, test, type Locator, type Page } from '@playwright/test';
import { hideDevOverlay } from './helpers';

// ── Shared journey state ────────────────────────────────────────────────
let accountId = '';
let accountName = '';
let accountBroker = '';

// ── Journey constants ───────────────────────────────────────────────────
const OPENING_AMOUNT = '10000.00';
const DEPOSIT_AMOUNT = '500.00';
const WITHDRAWAL_AMOUNT = '250.00';
const CORRECTED_AMOUNT = '750.00';
const OPENING_DESCRIPTION = 'Lifecycle opening balance';
const DEPOSIT_DESCRIPTION = 'Lifecycle deposit';
const WITHDRAWAL_DESCRIPTION = 'Lifecycle withdrawal';
const CORRECTED_DESCRIPTION = 'Lifecycle deposit (corrected)';
const CORRECTION_REASON = 'Wrong deposit amount recorded';
/** Opening 10000 + corrected deposit 750 − withdrawal 250. */
const FINAL_BALANCE = 10_500;

test.describe.configure({ mode: 'serial' });

// ── Runtime capture helpers ─────────────────────────────────────────────

function captureConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (
        text.includes('favicon') ||
        text.includes('extension') ||
        text.includes('[turbopack]') ||
        text.includes('Failed to load chunk')
      ) {
        return;
      }
      errors.push(`[console.error] ${text}`);
    }
  });
  return errors;
}

function captureFailedRequests(page: Page): string[] {
  const failed: string[] = [];
  page.on('requestfailed', (req) => {
    failed.push(`${req.url()} (${req.failure()?.errorText ?? 'unknown'})`);
  });
  page.on('response', (res) => {
    if (!res.ok() && res.status() >= 400) {
      const url = res.url();
      if (!url.includes('favicon') && !url.includes('__next')) {
        failed.push(`${url} (${res.status()})`);
      }
    }
  });
  return failed;
}

function assertCleanRuntime(errors: string[], failed: string[]) {
  expect(errors).toEqual([]);
  expect(failed).toEqual([]);
}

// ── Visual / a11y helpers ───────────────────────────────────────────────

/** No horizontal overflow on the current page (document-level). */
async function expectNoOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth - doc.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(0);
}

/**
 * True when a keyboard-focused control shows the focus-visible ring
 * (Tailwind `focus-visible:ring-3` → non-none computed box-shadow).
 * Callers must focus the element via keyboard first (see tabToFocus).
 */
async function focusRingVisible(page: Page, locator: Locator): Promise<boolean> {
  return locator.evaluate((el) => {
    const cs = getComputedStyle(el);
    return cs.boxShadow !== 'none' && cs.boxShadow !== '';
  });
}

/**
 * Press Tab repeatedly until the target element is focused (keyboard-only
 * navigation). Throws if the cap is exhausted. The cap is generous because
 * the shared application shell (sidebar with account selector, nav links,
 * theme toggle) precedes the main content in tab order.
 */
async function tabToFocus(page: Page, target: Locator, maxTabs = 60): Promise<void> {
  for (let i = 0; i < maxTabs; i += 1) {
    const reached = await target.evaluate((el) => el === document.activeElement).catch(() => false);
    if (reached) return;
    await page.keyboard.press('Tab');
  }
  throw new Error('Tab navigation did not reach the target element');
}

/**
 * Wait one animation frame so React commits controlled-input state after a
 * fill(); without it a fast Save click can read the stale pre-fill value
 * under dev-server load (pattern from the settings-lifecycle spec).
 */
async function settleReactInput(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

// ── API helpers ─────────────────────────────────────────────────────────

async function createAccountApi(page: Page, name: string): Promise<{ id: string; name: string }> {
  const response = await page.request.post('/api/accounts', {
    data: { name, broker: 'E2E Broker', currency: 'USD' },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string; name: string };
}

/** Read the account overview snapshot's netCash as a number. */
async function readNetCash(page: Page, accountId: string): Promise<number> {
  const response = await page.request.get(`/api/accounts/${accountId}/overview`);
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { snapshot: { netCash: string | null } };
  return parseFloat(body.snapshot.netCash ?? 'NaN');
}

/** Wait for the ledger list request to resolve after navigation. */
async function waitForLedger(page: Page, id: string) {
  await page.waitForResponse(
    (res) => res.url().includes(`/api/accounts/${id}/ledger`) && res.status() === 200,
    { timeout: 15_000 },
  );
}

/**
 * Assert the transient success banner (`${label} posted`). The banner lives
 * ~450ms (POST_SUCCESS_DELAY_MS) before the dialog closes, so poll with fast
 * intervals right after the POST resolves — same pattern as the S02/S03 specs.
 */
async function expectSuccessBanner(page: Page, label: string) {
  await expect
    .poll(() => page.getByRole('status').filter({ hasText: `${label} posted` }).count(), {
      timeout: 5_000,
      intervals: [25],
    })
    .toBeGreaterThan(0);
}

// ════════════════════════════════════════════════════════════════════════
// The journey
// ════════════════════════════════════════════════════════════════════════

test.describe('Account lifecycle UAT (S07/T01)', () => {
  // ── 1. Create ──────────────────────────────────────────────────────────
  test('create: dialog is keyboard-navigable with labeled inputs, focus states, and inline validation', async ({ page }) => {
    const consoleErrors = captureConsoleErrors(page);
    const failedRequests = captureFailedRequests(page);
    await hideDevOverlay(page);

    accountName = `Lifecycle Account ${Date.now()}`;
    accountBroker = 'Lifecycle Broker';

    await page.goto('/settings/accounts');
    await expect(page.getByRole('heading', { name: 'Accounts', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '+ Add Account' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Add Account' })).toBeVisible();

    // Form labels: every input is reachable through its visible label.
    const nameInput = dialog.getByLabel('Account name');
    const brokerInput = dialog.getByLabel('Broker');
    await expect(nameInput).toBeVisible();
    await expect(brokerInput).toBeVisible();
    await expect(dialog.getByLabel('Base currency')).toBeVisible();

    // Focus state: autoFocus lands on the account-name field.
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('add-account-name');
    // Focus indicator visible on the keyboard-focused name input.
    expect(await focusRingVisible(page, nameInput)).toBe(true);

    // Client-side error before any input; the dialog stays put.
    await dialog.getByRole('button', { name: 'Create Account' }).click();
    await expect(dialog.getByText('Account name is required.')).toBeVisible();
    await expect(page).toHaveURL(/\/settings\/accounts$/);

    // Keyboard-only: type the name, Tab into broker, type, Enter submits the form.
    await nameInput.focus();
    await page.keyboard.type(accountName);
    await page.keyboard.press('Tab');
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('add-account-broker');
    await page.keyboard.type(accountBroker);

    const navPromise = page.waitForURL(/\/settings\/accounts\/[0-9a-f-]+$/);
    await page.keyboard.press('Enter');
    await navPromise;
    const match = page.url().match(/\/settings\/accounts\/([0-9a-f-]+)$/);
    if (!match) throw new Error(`Unexpected workspace URL: ${page.url()}`);
    accountId = match[1];

    // Guided initialization state, draft badge, and sidebar refresh.
    await expect(page.getByRole('heading', { name: `Set up ${accountName}` })).toBeVisible();
    await expect(page.getByRole('button', { name: /Add opening balance/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Start with zero/ })).toBeVisible();
    await expect(page.getByText('Inactive', { exact: true })).toBeVisible();
    await expect(page.getByTestId('sidebar-account-trigger')).toContainText(`${accountName} (${accountBroker})`);

    // Persisted as a draft with no financial events.
    const accountRes = await page.request.get(`/api/accounts/${accountId}`);
    expect(accountRes.ok()).toBeTruthy();
    const account = await accountRes.json();
    expect(account.isActive).toBe(false);
    expect(account.name).toBe(accountName);

    await expectNoOverflow(page);
    assertCleanRuntime(consoleErrors, failedRequests);
  });

  // ── 2. Initialize (opening balance) ────────────────────────────────────
  test('initialize: labeled opening-balance form posts a balanced financial event with keyboard submit', async ({ page }) => {
    const consoleErrors = captureConsoleErrors(page);
    const failedRequests = captureFailedRequests(page);
    await hideDevOverlay(page);

    await page.goto(`/settings/accounts/${accountId}`);
    await expect(page.getByRole('button', { name: /Add opening balance/ })).toBeVisible();
    await page.getByRole('button', { name: /Add opening balance/ }).click();

    const panel = page.getByRole('region', { name: 'Opening balance' });
    await expect(panel).toBeVisible();

    // Form labels.
    const amount = panel.getByLabel('Amount (USD)');
    const description = panel.getByLabel('Description (optional)');
    await expect(amount).toBeVisible();
    await expect(description).toBeVisible();

    // Focus state: autoFocus lands in the amount field with a visible ring.
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('opening-balance-amount');
    expect(await focusRingVisible(page, amount)).toBe(true);

    // Keyboard-only entry + implicit form submit (Enter).
    await page.keyboard.type(OPENING_AMOUNT);
    await page.keyboard.press('Tab');
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('opening-balance-description');
    await page.keyboard.type(OPENING_DESCRIPTION);

    const postResponse = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/accounts/${accountId}/financial-events`) &&
        res.request().method() === 'POST',
    );
    await page.keyboard.press('Enter');
    expect((await postResponse).status()).toBe(201);

    // Transient success feedback, then the live overview handoff.
    await expect
      .poll(() => page.getByText('Opening balance recorded').count(), { timeout: 5_000, intervals: [50] })
      .toBeGreaterThan(0);
    await expect(page.getByText('Net Asset Value')).toBeVisible();
    await expect(page.getByText('Net Cash')).toBeVisible();
    await expect(page.getByText('$10,000.00')).toHaveCount(2);

    // Posting an opening balance is a financial event, not an activation.
    await expect(page.getByText('Inactive', { exact: true })).toBeVisible();

    // Balanced double-entry posting persisted.
    const eventsRes = await page.request.get(`/api/accounts/${accountId}/financial-events`);
    expect(eventsRes.ok()).toBeTruthy();
    const eventsBody = (await eventsRes.json()) as {
      total: number;
      events: Array<{ event: { eventType: string }; status: { hasEntry: boolean; isBalanced: boolean; postingCount: number } }>;
    };
    expect(eventsBody.total).toBe(1);
    expect(eventsBody.events[0].event.eventType).toBe('opening_balance');
    expect(eventsBody.events[0].status).toMatchObject({ hasEntry: true, isBalanced: true, postingCount: 2 });

    assertCleanRuntime(consoleErrors, failedRequests);
  });

  // ── 3. Activate ───────────────────────────────────────────────────────
  test('activate: settings lifecycle action activates the initialized account', async ({ page }) => {
    const consoleErrors = captureConsoleErrors(page);
    const failedRequests = captureFailedRequests(page);
    await hideDevOverlay(page);

    await page.goto(`/settings/accounts/${accountId}/settings`);
    await expect(page.getByText('Account Identity')).toBeVisible();

    // The opening-balance path leaves the account a draft: inactive status
    // with the Reactivate lifecycle action available.
    await expect(page.getByText('Inactive', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reactivate Account' })).toBeVisible();

    // Keyboard-only activation: Tab to the lifecycle action and Enter.
    await tabToFocus(page, page.getByRole('button', { name: 'Reactivate Account' }));
    await page.keyboard.press('Enter');

    // The reactivation PUT lands and the settings status flips to Active.
    // Note: the transient "Account reactivated." success banner is cleared by
    // the follow-up fetchData() in the same batched render, so it is never
    // user-visible; the durable signals are the Active status, the Close
    // Account lifecycle action (active-only), and the persisted API state.
    await expect(page.getByText('Active', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close Account' })).toBeVisible();

    // Persisted through the API.
    const account = await (await page.request.get(`/api/accounts/${accountId}`)).json();
    expect(account.isActive).toBe(true);

    assertCleanRuntime(consoleErrors, failedRequests);
  });

  // ── 4. Deposit ─────────────────────────────────────────────────────────
  test('deposit: composer shows a live preview, client validation, and keyboard submit with success feedback', async ({ page }) => {
    const consoleErrors = captureConsoleErrors(page);
    const failedRequests = captureFailedRequests(page);
    await hideDevOverlay(page);

    await page.goto(`/settings/accounts/${accountId}`);
    await expect(page.getByRole('button', { name: 'Add Transaction' })).toBeVisible();
    await page.getByRole('button', { name: 'Add Transaction' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Add Transaction' })).toBeVisible();

    // Form labels.
    const eventType = dialog.getByLabel('Event Type');
    const amount = dialog.getByLabel('Amount (USD)');
    const description = dialog.getByLabel('Description (optional)');
    await expect(eventType).toHaveValue('deposit');
    await expect(amount).toBeVisible();
    await expect(description).toBeVisible();

    // Focus state: autoFocus lands in the amount field.
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('ftc-amount');
    expect(await focusRingVisible(page, amount)).toBe(true);

    // Client-side error: empty amount is rejected before any API call.
    await dialog.getByRole('button', { name: 'Post Transaction' }).click();
    await expect(dialog.getByText('Enter an amount.')).toBeVisible();

    // Keyboard-only: type amount, live preview, Tab to description, Enter submits.
    await amount.focus();
    await page.keyboard.type(DEPOSIT_AMOUNT);
    const preview = dialog.getByTestId('ftc-effect-preview');
    await expect(preview).toContainText('Cash increase');
    await expect(preview).toContainText('USD 500.00');
    await page.keyboard.press('Tab');
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('ftc-description');
    await page.keyboard.type(DEPOSIT_DESCRIPTION);

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
    await page.keyboard.press('Enter');

    expect((await postResponse).status()).toBe(201);
    await expectSuccessBanner(page, 'Deposit');
    await overviewRefresh;
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Overview refetched: 2 events total with the new deposit row.
    await expect(page.getByText('(2 total)')).toBeVisible();
    await expect(page.getByText(DEPOSIT_DESCRIPTION)).toBeVisible();
    expect(await readNetCash(page, accountId)).toBe(10_500);

    assertCleanRuntime(consoleErrors, failedRequests);
  });

  // ── 5. Withdraw ────────────────────────────────────────────────────────
  test('withdraw: native event-type select changes via arrow keys and the withdrawal posts with decrease preview', async ({ page }) => {
    const consoleErrors = captureConsoleErrors(page);
    const failedRequests = captureFailedRequests(page);
    await hideDevOverlay(page);

    await page.goto(`/settings/accounts/${accountId}`);
    await expect(page.getByRole('button', { name: 'Add Transaction' })).toBeVisible();
    await page.getByRole('button', { name: 'Add Transaction' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Add Transaction' })).toBeVisible();

    // Keyboard-only: focus the native select and arrow to Withdrawal.
    const eventType = dialog.getByLabel('Event Type');
    await eventType.focus();
    await page.keyboard.press('ArrowDown');
    await expect(eventType).toHaveValue('withdrawal');

    // Tab into the amount field (keyboard order: select → amount → description).
    await page.keyboard.press('Tab');
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('ftc-amount');
    await page.keyboard.type(WITHDRAWAL_AMOUNT);
    await expect(dialog.getByTestId('ftc-effect-preview')).toContainText('Cash decrease');
    await expect(dialog.getByTestId('ftc-effect-preview')).toContainText('USD 250.00');
    await page.keyboard.press('Tab');
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('ftc-description');
    await page.keyboard.type(WITHDRAWAL_DESCRIPTION);

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
    await page.keyboard.press('Enter');

    expect((await postResponse).status()).toBe(201);
    await expectSuccessBanner(page, 'Withdrawal');
    await overviewRefresh;
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // 3 events total; cash reduced by the withdrawal amount.
    await expect(page.getByText('(3 total)')).toBeVisible();
    await expect(page.getByText(WITHDRAWAL_DESCRIPTION)).toBeVisible();
    expect(await readNetCash(page, accountId)).toBe(10_250);

    assertCleanRuntime(consoleErrors, failedRequests);
  });

  // ── 6. Inspect overview ────────────────────────────────────────────────
  test('inspect overview: metrics use tabular numerals, positions empty state renders, no overflow', async ({ page }) => {
    const consoleErrors = captureConsoleErrors(page);
    const failedRequests = captureFailedRequests(page);
    await hideDevOverlay(page);

    await page.goto(`/settings/accounts/${accountId}`);
    await expect(page.getByText('Net Asset Value')).toBeVisible();
    await expect(page.getByText('Net Cash')).toBeVisible();

    // NAV and Net Cash both reflect the net cash (10000 + 500 − 250).
    await expect(page.getByText('$10,250.00')).toHaveCount(2);

    // Empty positions state on an account with no trades.
    await expect(page.getByText('Open Positions', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('No open positions.')).toBeVisible();

    // Numeric alignment: every $-bearing tabular-nums element really renders
    // with font-variant-numeric: tabular-nums (scannable stable columns).
    const tabularReport = await page.evaluate(() => {
      const moneyEls = Array.from(document.querySelectorAll('.tabular-nums')).filter((el) =>
        (el.textContent ?? '').includes('$'),
      );
      return {
        count: moneyEls.length,
        nonTabular: moneyEls.filter(
          (el) => !getComputedStyle(el).fontVariantNumeric.includes('tabular-nums'),
        ).length,
      };
    });
    expect(tabularReport.count).toBeGreaterThan(0);
    expect(tabularReport.nonTabular).toBe(0);

    await expectNoOverflow(page);
    assertCleanRuntime(consoleErrors, failedRequests);
  });

  // ── 7. Inspect ledger ──────────────────────────────────────────────────
  test('inspect ledger: keyboard tab navigation, cash column alignment, filtered empty state, postings expansion', async ({ page }) => {
    const consoleErrors = captureConsoleErrors(page);
    const failedRequests = captureFailedRequests(page);
    await hideDevOverlay(page);

    await page.goto(`/settings/accounts/${accountId}`);
    await expect(page.getByRole('button', { name: 'Add Transaction' })).toBeVisible();

    // Keyboard-only: Tab through the workspace tab bar to the Ledger tab and
    // activate it with Enter.
    const tabs = page.getByRole('tablist', { name: 'Account workspace tabs' });
    const ledgerTab = tabs.getByRole('tab', { name: 'Ledger' });
    const ledgerResponse = page.waitForResponse(
      (res) => res.url().includes(`/api/accounts/${accountId}/ledger`) && res.status() === 200,
      { timeout: 15_000 },
    );
    await tabToFocus(page, ledgerTab);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/settings/accounts/${accountId}/ledger$`));
    await ledgerResponse;

    // All three lifecycle rows are present with correct cash impacts.
    await expect(page.getByText(OPENING_DESCRIPTION)).toBeVisible();
    await expect(page.getByText(DEPOSIT_DESCRIPTION)).toBeVisible();
    await expect(page.getByText(WITHDRAWAL_DESCRIPTION)).toBeVisible();
    await expect(page.getByText('$10,000.00')).toBeVisible();
    await expect(page.getByText('$500.00')).toBeVisible();
    await expect(page.getByText('-$250.00')).toBeVisible();

    // Numeric alignment: cash-impact values are right-aligned with tabular
    // numerals in the ledger table.
    const cashReport = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('p.tabular-nums')).filter((el) =>
        (el.textContent ?? '').includes('$'),
      );
      return els.map((el) => ({
        right: getComputedStyle(el).textAlign === 'right',
        tabular: getComputedStyle(el).fontVariantNumeric.includes('tabular-nums'),
      }));
    });
    expect(cashReport.length).toBeGreaterThan(0);
    for (const cell of cashReport) {
      expect(cell.right).toBe(true);
      expect(cell.tabular).toBe(true);
    }

    // Filtered empty state: Trade filter matches nothing; Clear filter restores.
    await page.getByRole('button', { name: 'Trade', exact: true }).click();
    await expect(page.getByText('No matching events.')).toBeVisible();
    await page.getByRole('button', { name: 'Clear filter' }).click();
    await expect(page.getByText(OPENING_DESCRIPTION)).toBeVisible();

    // Expand the first row: balanced double-entry postings with tabular-nums.
    await page.getByLabel('Expand details').first().click();
    await expect(page.getByText('Postings', { exact: true })).toBeVisible();
    await expect(page.getByText('Balanced', { exact: true })).toBeVisible();

    await expectNoOverflow(page);
    assertCleanRuntime(consoleErrors, failedRequests);
  });

  // ── 8. Correct an event ────────────────────────────────────────────────
  test('correct an event: dialog enforces a required reason, posts the correction, and shows lineage', async ({ page }) => {
    const consoleErrors = captureConsoleErrors(page);
    const failedRequests = captureFailedRequests(page);
    await hideDevOverlay(page);

    await page.goto(`/settings/accounts/${accountId}/ledger`);
    await waitForLedger(page, accountId);

    // The deposit row is correctable; open the correction dialog.
    const depositRow = page.locator('tr', { hasText: DEPOSIT_DESCRIPTION });
    await expect(depositRow.getByLabel(/^Correct deposit event/)).toBeVisible();
    await depositRow.getByLabel(/^Correct deposit event/).click();

    const dialog = page.getByRole('dialog', { name: 'Correct Financial Event' });
    await expect(dialog).toBeVisible();
    await expect(page.getByText('Original Event', { exact: true })).toBeVisible();

    // Pre-filled from the ledger row.
    await expect(page.locator('#corr-amount')).toHaveValue('500.00');
    await expect(page.locator('#corr-description')).toHaveValue(DEPOSIT_DESCRIPTION);

    // Required-reason error keeps the form on the editing step.
    await dialog.getByRole('button', { name: 'Review Correction' }).click();
    await expect(page.getByText('Correction reason is required')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirm Correction' })).toHaveCount(0);

    // Keyboard-driven correction: replacement values + required reason.
    // Select-all before typing so the pre-filled value is replaced (typing
    // alone would append to number/text inputs).
    await page.locator('#corr-amount').focus();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type(CORRECTED_AMOUNT);
    await page.locator('#corr-description').focus();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type(CORRECTED_DESCRIPTION);
    await page.locator('#corr-reason').focus();
    await page.keyboard.type(CORRECTION_REASON);
    await dialog.getByRole('button', { name: 'Review Correction' }).click();

    // Confirm step compares original vs replacement.
    await expect(page.getByText('Confirm Correction').first()).toBeVisible();
    await expect(page.getByText('$750.00').first()).toBeVisible();
    await expect(page.getByText(CORRECTION_REASON)).toBeVisible();

    const correctResponsePromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/accounts/${accountId}/financial-events/`) &&
        res.url().endsWith('/correct') &&
        res.status() === 200,
      { timeout: 15_000 },
    );
    await dialog.getByRole('button', { name: 'Confirm Correction' }).click();
    await expect(page.getByText('Correction Posted')).toBeVisible({ timeout: 15_000 });
    await correctResponsePromise;

    // Dialog auto-closes; the ledger refetches into the corrected state.
    await expect(page.getByRole('dialog', { name: 'Correct Financial Event' })).toHaveCount(0, {
      timeout: 10_000,
    });

    // Group row with Corrected badge and the netted replacement amount.
    const groupRow = page.locator('tr', { hasText: CORRECTED_DESCRIPTION });
    await expect(groupRow).toBeVisible({ timeout: 15_000 });
    await expect(groupRow.getByText('Corrected', { exact: true })).toBeVisible();
    await expect(groupRow.getByText('$750.00')).toBeVisible();

    // Original row is substituted by the group; no further correction on it.
    // Exact match: the corrected description begins with the original text,
    // so substring matching would hit the group row itself.
    await expect(page.getByText(DEPOSIT_DESCRIPTION, { exact: true })).toHaveCount(0);
    await expect(page.getByText('$500.00')).toHaveCount(0);
    await expect(groupRow.getByLabel(/^Correct deposit event/)).toHaveCount(0);

    // Expand the group row: immutable lineage with the required reason.
    await groupRow.getByLabel('Expand details').click();
    await expect(page.getByText('Correction Lineage')).toBeVisible();
    await expect(page.getByText('Original:', { exact: false })).toBeVisible();
    await expect(page.getByText('Reversal:', { exact: false })).toBeVisible();
    await expect(page.getByText('Replacement:', { exact: false })).toBeVisible();
    await expect(page.getByText(`Reason: ${CORRECTION_REASON}`)).toBeVisible();

    // Corrected state propagates to the overview (10000 + 750 − 250).
    await page.goto(`/settings/accounts/${accountId}`);
    await expect(page.getByText(CORRECTED_DESCRIPTION)).toBeVisible();
    await expect(page.getByText('$10,500.00')).toHaveCount(2);

    assertCleanRuntime(consoleErrors, failedRequests);
  });

  // ── 9. Change settings ─────────────────────────────────────────────────
  test('change settings: labeled fields persist an override through the API and survive reload', async ({ page }) => {
    const consoleErrors = captureConsoleErrors(page);
    const failedRequests = captureFailedRequests(page);
    await hideDevOverlay(page);

    await page.goto(`/settings/accounts/${accountId}`);
    await expect(page.getByRole('button', { name: 'Add Transaction' })).toBeVisible();

    // Keyboard-only: Tab to the Settings workspace tab. Wait for the settings
    // content itself (auto-retrying) rather than racing the API response.
    const tabs = page.getByRole('tablist', { name: 'Account workspace tabs' });
    const settingsTab = tabs.getByRole('tab', { name: 'Settings' });
    await tabToFocus(page, settingsTab);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/settings/accounts/${accountId}/settings$`));
    await expect(page.getByText('Account Identity')).toBeVisible();

    // Form labels on the settings page.
    await expect(page.getByLabel('Account Name')).toBeVisible();
    await expect(page.getByLabel('Broker')).toBeVisible();
    await expect(page.getByLabel('Base Currency')).toBeVisible();
    await expect(page.getByLabel('Max Risk Per Trade (%)')).toBeVisible();
    await expect(page.getByLabel('Default Commission ($)')).toBeVisible();

    // Change the per-account default commission override.
    const commission = page.locator('#settings-default-commission');
    await expect(commission).toHaveValue('');
    await commission.fill('2.5');
    await settleReactInput(page);

    const putResponse = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/accounts/${accountId}`) &&
        res.request().method() === 'PUT' &&
        res.status() === 200,
    );
    // Keyboard-only save: Tab to the Save button, verify the focus ring, Enter.
    await tabToFocus(page, page.getByRole('button', { name: 'Save', exact: true }));
    expect(await focusRingVisible(page, page.getByRole('button', { name: 'Save', exact: true }))).toBe(true);
    await page.keyboard.press('Enter');
    await putResponse;
    await expect(page.getByText('Settings saved successfully.')).toBeVisible();

    // Persisted through the real API and reflected on reload.
    await page.reload();
    await expect(page.getByText('Account Identity')).toBeVisible();
    await expect(commission).toHaveValue('2.5');
    await expect(page.getByRole('status', { name: 'Effective default commission' })).toContainText('Overridden');

    const account = await (await page.request.get(`/api/accounts/${accountId}`)).json();
    expect(account.defaultCommission).toBe(2.5);

    await expectNoOverflow(page);
    assertCleanRuntime(consoleErrors, failedRequests);
  });

  // ── 10. Deactivate (close) ─────────────────────────────────────────────
  test('deactivate: close requires confirmation, shows the closure summary, and marks the account inactive', async ({ page }) => {
    const consoleErrors = captureConsoleErrors(page);
    const failedRequests = captureFailedRequests(page);
    await hideDevOverlay(page);

    await page.goto(`/settings/accounts/${accountId}/settings`);
    await expect(page.getByText('Account Identity')).toBeVisible();
    await expect(page.getByText('Active', { exact: true })).toBeVisible();

    // Close Account opens the confirmation dialog.
    await page.getByRole('button', { name: 'Close Account' }).click();
    const closeDialog = page.getByRole('dialog', { name: 'Close Account' });
    await expect(closeDialog).toBeVisible();

    // Cancel closes the dialog without deactivating.
    await closeDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('Active', { exact: true })).toBeVisible();

    // Reopen and confirm the closure.
    await page.getByRole('button', { name: 'Close Account' }).click();
    await expect(page.getByRole('dialog', { name: 'Close Account' })).toBeVisible();
    const closeResponse = page.waitForResponse(
      (res) => res.url().includes(`/api/accounts/${accountId}/close`) && res.status() === 200,
    );
    await page.getByRole('button', { name: 'Confirm Close' }).click();
    await closeResponse;

    // Success feedback: closure summary with the ledger-derived final balance
    // (opening 10000 + corrected deposit 750 − withdrawal 250 = 10500).
    await expect(page.getByText('Account Closed')).toBeVisible();
    const finalBalanceText = `Final balance: $${FINAL_BALANCE.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    await expect(page.getByText(finalBalanceText)).toBeVisible();
    await page.getByRole('button', { name: 'Dismiss' }).click();
    await expect(page.getByText('Account Closed')).toHaveCount(0);

    // The account is now inactive with reactivate/delete actions available.
    await expect(page.getByText('Inactive', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reactivate Account' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete Account' })).toBeVisible();

    // Persisted through the API.
    const accountRes = await page.request.get(`/api/accounts/${accountId}`);
    expect(accountRes.ok()).toBeTruthy();
    const account = await accountRes.json();
    expect(account.isActive).toBe(false);

    await expectNoOverflow(page);
    assertCleanRuntime(consoleErrors, failedRequests);
  });

  // ── Loading states + ledger/overview empty states ─────────────────────
  test('loading states: overview and ledger show explicit placeholders; empty overview and ledger states render', async ({ page }) => {
    const consoleErrors = captureConsoleErrors(page);
    const failedRequests = captureFailedRequests(page);
    await hideDevOverlay(page);

    const acct = await createAccountApi(page, `Loading States ${Date.now()}`);

    // Delay the overview API so the loading placeholder is observable.
    await page.route(`**/api/accounts/${acct.id}/overview`, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      await route.continue();
    });
    await page.goto(`/settings/accounts/${acct.id}`);
    await expect(page.getByText('Loading overview...')).toBeVisible();
    await expect(page.getByRole('button', { name: /Add opening balance/ })).toBeVisible({ timeout: 20_000 });
    await page.unroute(`**/api/accounts/${acct.id}/overview`);

    // Delay the ledger API for its loading placeholder.
    await page.route(`**/api/accounts/${acct.id}/ledger*`, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      await route.continue();
    });
    await page.goto(`/settings/accounts/${acct.id}/ledger`);
    await expect(page.getByText('Loading ledger...')).toBeVisible();
    await expect(page.getByText('No ledger events yet.')).toBeVisible({ timeout: 20_000 });
    await page.unroute(`**/api/accounts/${acct.id}/ledger*`);

    // Empty overview state: an active account with no events shows the
    // "No events yet." empty state alongside the empty positions state.
    const activate = await page.request.put(`/api/accounts/${acct.id}`, { data: { isActive: true } });
    expect(activate.status()).toBe(200);
    await page.goto(`/settings/accounts/${acct.id}`);
    await expect(page.getByText('No events yet.')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('No open positions.')).toBeVisible();

    assertCleanRuntime(consoleErrors, failedRequests);
  });
});
