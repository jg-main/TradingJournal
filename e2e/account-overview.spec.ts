/**
 * E2E smoke flow for the Account Overview workspace.
 *
 * Verifies:
 * 1. Overview tab renders with four primary metric labels (NAV, Net Cash,
 *    Market Value, Open Positions) for an account with deposit data
 * 2. P&L summary section renders (Realized, Unrealized, Total, Fees)
 * 3. Reconciliation section renders stale/null state (no run performed)
 * 4. Positions section heading renders (may be empty without rebuild)
 * 5. Events preview table renders with deposit event type badge
 * 6. Empty state renders correctly for an account with no data
 * 7. Tab navigation: Overview is active at the base route
 * 8. 404 error state renders for non-existent account
 *
 * Precondition: Next.js dev-server running on port 3000.
 */

import { expect, test, type Page } from '@playwright/test';

// ── Test Helpers ────────────────────────────────────────────────────────

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
  const account = await response.json();
  return account as { id: string; name: string };
}

/**
 * Set account risk parameters (required before trade creation).
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
 * Activate an account via the API so the header shows Active.
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
  return await response.json();
}

// ── Tests ───────────────────────────────────────────────────────────────

test.describe('Account Overview Workspace', () => {
  test.describe.configure({ mode: 'serial' });

  let populatedAccountId: string;
  let populatedAccountName: string;

  test('Overview tab renders populated account with metrics, P&L, events, and workspace shell', async ({ page }) => {
    const ts = Date.now();
    populatedAccountName = `Overview E2E ${ts}`;
    const account = await createAccount(page, populatedAccountName);
    populatedAccountId = account.id;

    // Set risk params, post deposit, then activate - required setup for active account
    await setAccountRiskParams(page, account.id);
    await postDeposit(page, account.id, '10000.00', 'E2E test deposit');
    await activateAccount(page, account.id);

    // Navigate to the account detail page (Overview default tab)
    await page.goto(`/accounts/${account.id}`);

    // Wait for the overview API response before asserting
    await page.waitForResponse(
      (res) => res.url().includes(`/api/accounts/${account.id}/overview`) && res.status() === 200,
    );

    // ── Account header ─────────────────────────────────────────────
    await expect(page.getByRole('heading', { name: populatedAccountName })).toBeVisible();

    // ── Back link ───────────────────────────────────────────────────
    await expect(page.getByRole('link', { name: /back to accounts/i })).toBeVisible();

    // ── Workspace tab navigation ────────────────────────────────────
    const overviewTab = page.getByRole('tab', { name: 'Overview' });
    await expect(overviewTab).toBeVisible();
    await expect(overviewTab).toHaveAttribute('aria-selected', 'true');

    await expect(page.getByRole('tab', { name: 'Ledger' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Positions' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Reconciliation' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Settings' })).toBeVisible();

    // ── Primary metric cards (4-column grid) ────────────────────────
    // Use .first() since 'OPEN POSITIONS' / uppercase-CSS text may match
    // both the metric card label and the section heading
    await expect(page.getByText('NET ASSET VALUE').first()).toBeVisible();
    await expect(page.getByText('NET CASH').first()).toBeVisible();
    await expect(page.getByText('MARKET VALUE').first()).toBeVisible();
    await expect(page.getByText('OPEN POSITIONS').first()).toBeVisible();

    // ── P&L Summary section ─────────────────────────────────────────
    await expect(page.getByText('REALIZED P&L').first()).toBeVisible();
    await expect(page.getByText('UNREALIZED P&L').first()).toBeVisible();
    await expect(page.getByText('TOTAL P&L').first()).toBeVisible();
    await expect(page.getByText('REALIZED FEES').first()).toBeVisible();

    // ── Reconciliation section ───────────────────────────────────────
    // No reconciliation run performed, so stale/null state
    await expect(page.getByText(/no reconciliation data yet/i)).toBeVisible();

    // ── Positions section ────────────────────────────────────────────
    await expect(page.getByText('OPEN POSITIONS').first()).toBeVisible();

    // The positions table may be empty if rebuild hasn't run yet —
    // but the section heading and empty state should render
    await expect(page.getByText(/no open positions\./i)).toBeVisible();

    // ── Events section ───────────────────────────────────────────────
    await expect(page.getByText('RECENT EVENTS').first()).toBeVisible();

    // The deposit event type badge appears in the events table
    await expect(page.getByText('Deposit', { exact: true })).toBeVisible();
    await expect(page.getByText('E2E test deposit')).toBeVisible();
    await expect(page.getByText('Posted')).toBeVisible();

    // View all link for events (since we have at least one event)
    const viewAllLinks = page.getByRole('link', { name: /view all/i });
    await expect(viewAllLinks.first()).toBeVisible();
  });

  test('Tab navigation: clicking Ledger tab navigates to the Ledger sub-route', async ({ page }) => {
    // Navigate to the known populated account
    await page.goto(`/accounts/${populatedAccountId}`);

    // Wait for the overview to finish loading
    await page.waitForResponse(
      (res) => res.url().includes(`/api/accounts/${populatedAccountId}/overview`) && res.status() === 200,
    );

    // Click the Ledger tab
    await page.getByRole('tab', { name: 'Ledger' }).click();

    // Verify URL changed to include /ledger, proving deep-linkable navigation
    await expect(page).toHaveURL(new RegExp(`/accounts/${populatedAccountId}/ledger`));
  });

  test('Overview renders empty state for an account with no positions or events', async ({ page }) => {
    const ts = Date.now();
    const emptyAccount = await createAccount(page, `Empty Overview ${ts}`);
    await activateAccount(page, emptyAccount.id);

    // Navigate directly — no deposits, no trades, no events
    await page.goto(`/accounts/${emptyAccount.id}`);

    // Wait for the overview API response
    await page.waitForResponse(
      (res) => res.url().includes(`/api/accounts/${emptyAccount.id}/overview`) && res.status() === 200,
    );

    // ── Verify Overview tab is active ───────────────────────────────
    const overviewTab = page.getByRole('tab', { name: 'Overview' });
    await expect(overviewTab).toBeVisible();
    await expect(overviewTab).toHaveAttribute('aria-selected', 'true');

    // ── Primary metrics render with dashes for missing data ──────────
    await expect(page.getByText('NET ASSET VALUE').first()).toBeVisible();
    await expect(page.getByText('NET CASH').first()).toBeVisible();
    await expect(page.getByText('MARKET VALUE').first()).toBeVisible();
    await expect(page.getByText('OPEN POSITIONS').first()).toBeVisible();

    // Verify the metric value shows dash for null data
    await expect(page.getByText('—').first()).toBeVisible();

    // ── Empty positions state ────────────────────────────────────────
    await expect(page.getByText('No open positions.')).toBeVisible();
    await expect(page.getByText('Post an execution to open a position.')).toBeVisible();

    // ── Empty events state ───────────────────────────────────────────
    await expect(page.getByText('No events yet.')).toBeVisible();
    await expect(page.getByText('Post financial events to see activity here.')).toBeVisible();

    // ── Reconciliation stale state ───────────────────────────────────
    await expect(page.getByText(/no reconciliation data yet/i)).toBeVisible();

    // ── "View all" links should NOT be present when empty ────────────
    await expect(page.getByRole('link', { name: /view all/i })).toHaveCount(0);
  });

  test('returns 404 error state for non-existent account', async ({ page }) => {
    const nonExistentId = '00000000-0000-0000-0000-000000000000';
    await page.goto(`/accounts/${nonExistentId}`);

    // Wait for the account API to return 404
    await page.waitForResponse(
      (res) => res.url().includes(`/api/accounts/${nonExistentId}`) && res.status() === 404,
    );

    // Should show error text and back link
    await expect(page.getByText('Account not found.')).toBeVisible();
    await expect(page.getByRole('link', { name: /back to accounts/i })).toBeVisible();
  });
});
