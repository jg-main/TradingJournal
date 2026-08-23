/**
 * E2E flow for the Positions workspace.
 *
 * Verifies the full runtime path from account navigation through
 * populated positions table, FIFO lot expansion, missing-price state,
 * empty state, and 404 handling at /settings/accounts/[id]/positions.
 *
 * No valuation marks are inserted for the test account, so all positions
 * naturally show the "Missing" markStatus and "—" display values —
 * this tests the missing-price contract through the real pipeline.
 *
 * Covers:
 * 1. Positions tab navigation from account base route
 * 2. Direct deep-link to /settings/accounts/[id]/positions
 * 3. Populated state: summary strip with position count, table with
 *    symbols and column headers, "Current Positions" heading
 * 4. FIFO lot expansion: expand/collapse with lot detail columns
 *    (Side, Remaining, Original, Entry Price, Cost Basis, Fees)
 * 5. Missing-price state: "Missing" badges rendered, "—" for market
 *    value and unrealized P&L (never "$0.00")
 * 6. Empty state: "No open positions." with guidance text
 * 7. 404/error state: non-existent account shows error + Retry button
 * 8. Console errors: no JavaScript errors in the successful flow
 * 9. Network health: no failed requests in the successful flow
 *
 * Precondition: Next.js dev-server running on port 3000.
 * Run: npx playwright test -- e2e/account-positions-workspace.spec.ts
 */

import { expect, test, type Page } from '@playwright/test';

// ── Test Helpers ────────────────────────────────────────────────────────

async function createAccount(page: Page, name: string) {
  const response = await page.request.post('/api/accounts', {
    data: { name, broker: 'E2E Broker', currency: 'USD' },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string; name: string };
}

async function setAccountRiskParams(page: Page, accountId: string) {
  const response = await page.request.put(`/api/accounts/${accountId}`, {
    data: {
      maxRiskPerTradePct: 2.0,
      defaultCommission: 1.0,
    },
  });
  expect(response.status()).toBe(200);
}

async function postFinancialEvent(
  page: Page,
  accountId: string,
  eventType: string,
  amount: string,
  description: string,
) {
  // Opening balances are initialization-only (A2): they go through the
  // initialize endpoint, which posts the event AND activates the account in
  // one server-side transaction. The generic route rejects them with 409.
  if (eventType === 'opening_balance') {
    const response = await page.request.post(
      `/api/accounts/${accountId}/initialize`,
      { data: { mode: 'opening_balance', amount, description } },
    );
    expect(response.status()).toBe(201);
    return await response.json();
  }
  const response = await page.request.post(
    `/api/accounts/${accountId}/financial-events`,
    { data: { eventType, amount, description } },
  );
  expect(response.status()).toBe(201);
  return await response.json();
}

async function postExecution(
  page: Page,
  accountId: string,
  data: {
    symbol: string;
    action: string;
    quantity: string;
    price: string;
    fees: string;
    description: string;
    postedAt?: string;
  },
) {
  const response = await page.request.post(
    `/api/accounts/${accountId}/executions`,
    { data },
  );
  expect(response.status()).toBe(201);
  return (await response.json()) as { execution: { id: string } };
}

async function waitForPositionsResponse(page: Page, accountId: string) {
  await page.waitForResponse(
    (res) =>
      res.url().includes(`/api/accounts/${accountId}/positions`) &&
      res.status() === 200,
  );
}

// ── Tests ───────────────────────────────────────────────────────────────

test.describe('Account Positions Workspace', () => {
  test.describe.configure({ mode: 'serial' });

  let populatedAccountId: string;
  let populatedAccountName: string;

  test('setup: create account and post trade executions', async ({ page }) => {
    const ts = Date.now();
    populatedAccountName = `Positions Workspace E2E ${ts}`;
    const account = await createAccount(page, populatedAccountName);
    populatedAccountId = account.id;

    // 1. Set risk params (required for trade execution posting)
    await setAccountRiskParams(page, populatedAccountId);

    // 2. Post opening balance
    await postFinancialEvent(
      page,
      populatedAccountId,
      'opening_balance',
      '100000.00',
      'Opening balance',
    );

    // 3. Post a deposit for liquidity
    await postFinancialEvent(
      page,
      populatedAccountId,
      'deposit',
      '50000.00',
      'E2E test deposit',
    );

    // 4. Post trade executions (positions, no valuation marks)
    // Buy 100 AAPL at 150.00 — creates one open FIFO lot
    await postExecution(page, populatedAccountId, {
      symbol: 'AAPL',
      action: 'buy',
      quantity: '100.00',
      price: '150.00',
      fees: '15.00',
      description: 'Buy 100 AAPL @ 150.00',
      postedAt: '2026-07-15T10:00:00.000Z',
    });

    // Buy 50 MSFT at 300.00 — creates one open FIFO lot
    await postExecution(page, populatedAccountId, {
      symbol: 'MSFT',
      action: 'buy',
      quantity: '50.00',
      price: '300.00',
      fees: '10.00',
      description: 'Buy 50 MSFT @ 300.00',
      postedAt: '2026-07-15T11:00:00.000Z',
    });

    // 5. Verify positions endpoint has the expected data (no valuation marks)
    const positionsRes = await page.request.get(
      `/api/accounts/${populatedAccountId}/positions`,
    );
    expect(positionsRes.status()).toBe(200);
    const body = (await positionsRes.json()) as {
      positions: Array<Record<string, unknown>>;
      total: number;
    };
    expect(body.total).toBe(2);

    // Both positions should have markStatus 'missing' (no valuation marks inserted)
    const missingStatusPositions = body.positions.filter(
      (p) => p.markStatus === 'missing',
    );
    expect(missingStatusPositions.length).toBe(2);
  });

  test('Positions tab navigation: click tab navigates to /settings/accounts/[id]/positions', async ({
    page,
  }) => {
    // Navigate to the account detail page (Overview default tab)
    await page.goto(`/settings/accounts/${populatedAccountId}`);
    await page.waitForResponse(
      (res) =>
        res.url().includes(`/api/accounts/${populatedAccountId}/overview`) &&
        res.status() === 200,
    );

    // The Positions tab should be visible in the workspace tab bar
    const positionsTab = page.getByRole('tab', { name: 'Positions' });
    await expect(positionsTab).toBeVisible();

    // Click the Positions tab
    await positionsTab.click();

    // Verify deep-linked URL
    await expect(page).toHaveURL(
      new RegExp(`/settings/accounts/${populatedAccountId}/positions`),
    );

    // Positions tab should be selected
    await expect(positionsTab).toHaveAttribute('aria-selected', 'true');
  });

  test('deep link: direct URL renders populated positions workspace', async ({
    page,
  }) => {
    // Navigate directly to the positions workspace (not via tab click)
    await page.goto(`/settings/accounts/${populatedAccountId}/positions`);

    // Wait for the positions API to return
    await waitForPositionsResponse(page, populatedAccountId);

    // Positions tab should be selected
    const positionsTab = page.getByRole('tab', { name: 'Positions' });
    await expect(positionsTab).toHaveAttribute('aria-selected', 'true');

    // Account header should be visible
    await expect(
      page.getByRole('heading', { name: populatedAccountName }),
    ).toBeVisible();

    // "Current Positions" heading with total count
    await expect(page.getByText(/Current Positions/)).toBeVisible();
    await expect(page.getByText(/2 total/)).toBeVisible();

    // Summary strip — Open Positions count should show 2
    await expect(page.getByText('Open Positions')).toBeVisible();
    await expect(page.getByText('2').first()).toBeVisible();

    // Table column headers
    await expect(page.getByText('Symbol')).toBeVisible();
    await expect(page.getByText('Dir')).toBeVisible();
    await expect(page.getByText('Qty')).toBeVisible();
    await expect(page.getByText('Avg Cost')).toBeVisible();
    await expect(page.getByText('Mark/Quality')).toBeVisible();
    await expect(page.getByText('Mkt Value')).toBeVisible();
    await expect(page.getByText('Unreal. P&L')).toBeVisible();
    await expect(page.getByText('Real. Net P&L')).toBeVisible();
    await expect(page.getByText('Last Updated')).toBeVisible();

    // Position symbols should render
    await expect(page.getByText('AAPL')).toBeVisible();
    await expect(page.getByText('MSFT')).toBeVisible();

    // Direction icons — long positions show long direction text
    const longChips = page.getByText('long');
    await expect(longChips.first()).toBeVisible();
  });

  test('FIFO lot expansion: expand AAPL row and verify lot details', async ({
    page,
  }) => {
    await page.goto(`/settings/accounts/${populatedAccountId}/positions`);
    await waitForPositionsResponse(page, populatedAccountId);

    // Wait for the table to be fully rendered
    await expect(page.getByText('Current Positions')).toBeVisible();

    // Find the AAPL row explicitly; position ordering can change as later
    // executions update other symbols. After clicking,
    // its aria-label changes from "Expand FIFO lots" to "Collapse FIFO lots",
    // so we use the label transition for verification rather than
    // stale locator references.
    const aaplRow = page.getByRole('row', { name: /AAPL/ });
    const expandBtn = aaplRow.getByLabel('Expand FIFO lots');
    await expect(expandBtn).toBeVisible();

    // Verify initial collapsed state
    await expect(expandBtn).toHaveAttribute('aria-expanded', 'false');

    // Click the first expand button (AAPL row)
    await expandBtn.click();

    // After clicking, the button label changes to "Collapse FIFO lots"
    const collapseBtn = aaplRow.getByLabel('Collapse FIFO lots');
    await expect(collapseBtn).toBeVisible();

    // FIFO lot sub-table column headers should be visible
    await expect(page.getByText('Remaining')).toBeVisible();
    await expect(page.getByText('Entry Price')).toBeVisible();
    await expect(page.getByText('Cost Basis')).toBeVisible();
    await expect(page.getByText('Fees')).toBeVisible();
    await expect(page.getByText('Opening Exec')).toBeVisible();
    await expect(page.getByText('Opened')).toBeVisible();

    // The expanded region should have role="region" with accessible label
    const region = aaplRow.getByRole('region', { name: 'Open FIFO lots' });
    await expect(region).toBeVisible();

    // Lot detail values should be present (100 shares, $150.00 entry, $15.00 fees)
    await expect(page.getByText('long').first()).toBeVisible();
    await expect(page.getByText('$150.00').first()).toBeVisible();
    await expect(page.getByText('$15.00').first()).toBeVisible();

    // Collapse by clicking the "Collapse FIFO lots" button
    await collapseBtn.click();

    // After collapsing, the label reverts to "Expand FIFO lots"
    await expect(page.getByLabel('Expand FIFO lots').first()).toBeVisible();

    // Expanded region should no longer be visible
    await expect(region).not.toBeVisible();
  });

  test('missing-price: unmarked positions show Missing badge and — display', async ({
    page,
  }) => {
    // No valuation marks were inserted during setup — all positions
    // have markStatus='missing', markPrice=null, markedValue=null,
    // and unrealizedPnl=null
    await page.goto(`/settings/accounts/${populatedAccountId}/positions`);
    await waitForPositionsResponse(page, populatedAccountId);

    // Both positions should show "Missing" badge
    // (2 positions x 1 "Missing" badge each = 2)
    const missingBadges = page.getByText('Missing');
    await expect(missingBadges).toHaveCount(2);

    // The mark price, market value, and unrealized P&L columns should all
    // display "—" (not fabricated zeros) for unmarked positions.
    // Multiple "—" appear in the table — at least one per unmarked position
    // for mark price + market value + unrealized P&L.
    const dashElements = page.getByText('—');
    await expect(dashElements.first()).toBeVisible();

    // Refresh button should be present
    await expect(page.getByTitle('Refresh positions')).toBeVisible();
  });

  test('empty state: account with no positions shows guidance text', async ({
    page,
  }) => {
    // Create a fresh account with no executions
    const emptyName = `Empty Positions ${Date.now()}`;
    const emptyAccount = await createAccount(page, emptyName);

    // Navigate to the positions page
    await page.goto(`/settings/accounts/${emptyAccount.id}/positions`);
    await waitForPositionsResponse(page, emptyAccount.id);

    // Should show empty state
    await expect(page.getByText('No open positions.')).toBeVisible();
    await expect(
      page.getByText('Post an execution to open a position.'),
    ).toBeVisible();

    // Should NOT show the summary strip (no positions)
    // Use exact match to distinguish from the empty state text "No open positions."
    await expect(page.getByText('Open Positions', { exact: true })).not.toBeVisible();

    // Should NOT show the table with column headers
    await expect(page.getByText('Symbol')).not.toBeVisible();
  });

  test('404: non-existent account shows account-not-found error in layout', async ({
    page,
  }) => {
    const nonExistentId = '00000000-0000-0000-0000-000000000000';
    await page.goto(`/settings/accounts/${nonExistentId}/positions`);

    // The layout fetches /api/accounts/:id first; non-existent accounts
    // cause the layout to render an error state without loading children.
    await page.waitForResponse(
      (res) =>
        res.url().includes(`/api/accounts/${nonExistentId}`) &&
        res.status() === 404,
    );

    // Should show the layout-level account not-found error
    await expect(page.getByText('Account not found.')).toBeVisible();
    await expect(
      page.getByRole('link', { name: /back to accounts/i }),
    ).toBeVisible();

    // The positions content should NOT render (no positions table,
    // no workspace tabs since the account wasn't found)
    await expect(
      page.getByRole('tab', { name: 'Positions' }),
    ).not.toBeVisible();
  });

  test('no console errors and no failed network requests in populated flow', async ({
    page,
  }) => {
    // Collect console errors and failed requests
    const consoleErrors: Array<{ text: string; location: string }> = [];
    const failedRequests: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        // Filter out expected browser extension errors
        const text = msg.text();
        if (!text.includes('favicon.ico') && !text.includes('chrome-extension')) {
          consoleErrors.push({
            text,
            location: msg.location()?.url ?? 'unknown',
          });
        }
      }
    });

    page.on('requestfailed', (req) => {
      failedRequests.push(
        `${req.url()} — ${req.failure()?.errorText ?? 'unknown error'}`,
      );
    });

    // Exercise the populated flow
    await page.goto(`/settings/accounts/${populatedAccountId}/positions`);
    await waitForPositionsResponse(page, populatedAccountId);

    // Wait for table to render
    await expect(page.getByText('Current Positions')).toBeVisible();

    // Expand a FIFO lot to exercise the expansion code path
    const expandBtn = page.getByLabel('Expand FIFO lots').first();
    await expect(expandBtn).toBeVisible();
    await expandBtn.click();
    await page.waitForTimeout(200);

    // Assert no console errors
    expect(consoleErrors).toHaveLength(0);

    // Assert no failed network requests
    expect(failedRequests).toHaveLength(0);
  });
});
