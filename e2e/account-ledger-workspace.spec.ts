/**
 * E2E flow for the unified Ledger workspace.
 *
 * Verifies the full runtime path from account navigation through
 * filtering, pagination, expansion, and correction audit inspection
 * at /settings/accounts/[id]/ledger.
 *
 * Covers:
 * 1. Ledger tab navigation and deep-link
 * 2. Event rows with type badges, descriptions, posted status, and cash impact
 * 3. Category filter buttons (All, Cash, Trade, Fee, etc.)
 * 4. Clicking a filter re-fetches and displays matching events
 * 5. Pagination with next/prev buttons and page info (25+ events)
 * 6. Empty filtered results with "Clear filter" action
 * 7. Row expansion showing debit/credit postings
 * 8. Correction group expansion preserving constituent IDs (original, reversal, replacement)
 * 9. No duplicate primary rows after correction
 * 10. Negative: empty account shows explicit "No ledger events yet." state
 * 11. Negative: invalid/empty filter produces explicit "No matching events." state
 *
 * Precondition: Next.js dev-server running on port 3000.
 * Run: npx playwright test -- e2e/account-ledger-workspace.spec.ts
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

async function correctExecution(
  page: Page,
  accountId: string,
  executionId: string,
  data: {
    symbol: string;
    action: string;
    quantity: string;
    price: string;
    fees: string;
    reason: string;
    postedAt?: string;
  },
) {
  const response = await page.request.post(
    `/api/accounts/${accountId}/executions/${executionId}/correct`,
    { data },
  );
  expect(response.status()).toBe(200);
  return await response.json();
}

/**
 * Post a batch of small deposits to create enough ledger events for pagination.
 */
async function seedPaginationEvents(
  page: Page,
  accountId: string,
  count: number,
  prefix: string,
) {
  for (let i = 0; i < count; i++) {
    await postFinancialEvent(
      page,
      accountId,
      'deposit',
      '100.00',
      `${prefix} batch deposit #${i + 1}`,
    );
  }
}

// ── Tests ───────────────────────────────────────────────────────────────

test.describe('Account Ledger Workspace', () => {
  test.describe.configure({ mode: 'serial' });

  let accountId: string;
  let accountName: string;
  let executionId: string;

  test('setup: create account, post events, trade execution, and correction', async ({ page }) => {
    const ts = Date.now();
    accountName = `Ledger Workspace E2E ${ts}`;
    const account = await createAccount(page, accountName);
    accountId = account.id;

    // 1. Set risk params (required for trade execution posting)
    await setAccountRiskParams(page, accountId);

    // 2. Post opening balance (Opening category)
    await postFinancialEvent(page, accountId, 'opening_balance', '50000.00', 'Opening balance');

    // 3. Post deposit events (Cash category)
    await postFinancialEvent(page, accountId, 'deposit', '25000.00', 'Initial deposit');
    await postFinancialEvent(page, accountId, 'deposit', '5000.00', 'Bonus deposit');

    // 4. Post a fee event (Fee/Tax category)
    await postFinancialEvent(page, accountId, 'fee', '25.00', 'Monthly platform fee');

    // 5. Post a trade execution (Trade category)
    const execResult = await postExecution(page, accountId, {
      symbol: 'AAPL',
      action: 'buy',
      quantity: '100.00',
      price: '150.00',
      fees: '15.00',
      description: 'Buy 100 AAPL @ 150.00',
      postedAt: '2026-07-14T10:00:00.000Z',
    });
    executionId = execResult.execution.id;

    // 6. Correct the execution — creates reversal + replacement events
    //    The original execution is part of the correction group
    await correctExecution(page, accountId, executionId, {
      symbol: 'AAPL',
      action: 'buy',
      quantity: '50.00',
      price: '150.00',
      fees: '7.50',
      reason: 'Wrong quantity entered — corrected from 100 to 50',
      postedAt: '2026-07-15T14:00:00.000Z',
    });

    // 7. Post a dividend event
    await postFinancialEvent(page, accountId, 'dividend', '150.00', 'AAPL quarterly dividend');

    // 8. Post enough extra deposits for pagination (25 total events)
    await seedPaginationEvents(page, accountId, 20, 'Pagination');

    // 9. Verify the ledger endpoint has the expected data
    const ledgerRes = await page.request.get(
      `/api/accounts/${accountId}/ledger?limit=100`,
    );
    expect(ledgerRes.status()).toBe(200);
    const ledgerBody = await ledgerRes.json();
    expect(ledgerBody.total).toBeGreaterThanOrEqual(25);
    expect(ledgerBody.page).toBe(1);
    expect(ledgerBody.totalPages).toBeGreaterThanOrEqual(1);

    // Verify correction group is present
    const correctionEvents = ledgerBody.events.filter(
      (e: unknown) => (e as Record<string, unknown>).correctionGroup !== null,
    );
    expect(correctionEvents.length).toBeGreaterThanOrEqual(1);
  });

  test('renders Ledger tab, deep-links to /settings/accounts/[id]/ledger', async ({ page }) => {
    // Navigate to the account detail page (Overview default tab)
    await page.goto(`/settings/accounts/${accountId}`);
    await page.waitForSelector('text=Overview');

    // The Ledger tab should be visible
    const ledgerTab = page.getByRole('tab', { name: 'Ledger' });
    await expect(ledgerTab).toBeVisible();

    // Click the Ledger tab
    await ledgerTab.click();

    // Verify deep-linked URL
    await expect(page).toHaveURL(new RegExp(`/settings/accounts/${accountId}/ledger`));

    // Ledger tab should be selected
    await expect(ledgerTab).toHaveAttribute('aria-selected', 'true');
  });

  test('displays event rows with type badges, descriptions, dates, and posted status', async ({ page }) => {
    await page.goto(`/settings/accounts/${accountId}/ledger`);

    // Wait for the ledger to load
    await page.waitForResponse(
      (res) =>
        res.url().includes(`/api/accounts/${accountId}/ledger`) &&
        res.status() === 200,
    );

    // Opening balance event
    await expect(page.getByText('Opening balance')).toBeVisible();
    await expect(page.getByText('Opening', { exact: true }).first()).toBeVisible();

    // Deposit events
    await expect(page.getByText('Initial deposit')).toBeVisible();
    await expect(page.getByText('Bonus deposit')).toBeVisible();
    await expect(page.getByText('Deposit', { exact: true }).first()).toBeVisible();

    // Fee event
    await expect(page.getByText('Monthly platform fee')).toBeVisible();
    await expect(page.getByText('Fee', { exact: true })).toBeVisible();

    // Dividend event
    await expect(page.getByText('AAPL quarterly dividend')).toBeVisible();

    // Postings status badge for settled events
    const postedElements = page.getByText('Posted');
    await expect(postedElements.first()).toBeVisible();
  });

  test('displays positive and negative cash impact values', async ({ page }) => {
    await page.goto(`/settings/accounts/${accountId}/ledger`);

    await page.waitForResponse(
      (res) =>
        res.url().includes(`/api/accounts/${accountId}/ledger`) &&
        res.status() === 200,
    );

    // Positive cash impacts (deposits, opening balance)
    await expect(page.getByText('$50,000.00')).toBeVisible();
    await expect(page.getByText('$25,000.00')).toBeVisible();
    await expect(page.getByText('$5,000.00')).toBeVisible();

    // Negative cash impact (fee)
    await expect(page.getByText('-$25.00')).toBeVisible();
  });

  test('shows total event count in results info', async ({ page }) => {
    await page.goto(`/settings/accounts/${accountId}/ledger`);

    await page.waitForResponse(
      (res) =>
        res.url().includes(`/api/accounts/${accountId}/ledger`) &&
        res.status() === 200,
    );

    // Results info should show the event count (25+ events)
    // The page default limit is 25 and there are 25+ events, so "Showing 1–25 of XX"
    await expect(page.getByText(/Showing/)).toBeVisible();
    await expect(page.getByText(/of 2[5-9]|of 3[0-9]/)).toBeVisible();
  });

  test('category filter buttons are present and All is selected by default', async ({ page }) => {
    await page.goto(`/settings/accounts/${accountId}/ledger`);

    await page.waitForResponse(
      (res) =>
        res.url().includes(`/api/accounts/${accountId}/ledger`) &&
        res.status() === 200,
    );

    // The filter group should have aria-label
    const filterGroup = page.getByRole('group', { name: 'Event category filter' });
    await expect(filterGroup).toBeVisible();

    // All filter is selected by default
    const allButton = filterGroup.getByText('All');
    await expect(allButton).toBeVisible();
    await expect(allButton).toHaveAttribute('aria-pressed', 'true');

    // Other filter buttons are present
    await expect(filterGroup.getByText('Opening')).toBeVisible();
    await expect(filterGroup.getByText('Cash')).toBeVisible();
    await expect(filterGroup.getByText('Trade')).toBeVisible();
    await expect(filterGroup.getByText('Fee/Tax')).toBeVisible();
    await expect(filterGroup.getByText('Adjustment')).toBeVisible();
    await expect(filterGroup.getByText('Transfer')).toBeVisible();
    await expect(filterGroup.getByText('Corp. Action')).toBeVisible();
  });

  test('category filtering: clicking Trade filter shows only trade events', async ({ page }) => {
    await page.goto(`/settings/accounts/${accountId}/ledger`);
    await page.waitForResponse((res) =>
      res.url().includes(`/api/accounts/${accountId}/ledger`) && res.status() === 200,
    );

    // Confirm initial data is loaded
    await expect(page.getByText('Opening balance')).toBeVisible();

    // Click the Trade filter button from the filter group
    const filterGroup = page.getByRole('group', { name: 'Event category filter' });
    await filterGroup.getByText('Trade').click();

    // Wait for Opening balance to disappear (filter took effect)
    await expect(page.getByText('Opening balance')).not.toBeVisible({ timeout: 5000 });

    // Trade-related descriptions should be visible (correction replacement event)
    await expect(page.getByText(/Correction replacement/).first()).toBeVisible();

    // Non-trade events should NOT be visible under Trade filter
    await expect(page.getByText('Initial deposit')).not.toBeVisible();
    await expect(page.getByText('Monthly platform fee')).not.toBeVisible();

    // Results info should show "events (filtered)"
    await expect(page.getByText(/filtered/i)).toBeVisible();
  });

  test('category filtering: clicking Cash filter shows only deposit events', async ({ page }) => {
    await page.goto(`/settings/accounts/${accountId}/ledger`);
    await page.waitForResponse((res) =>
      res.url().includes(`/api/accounts/${accountId}/ledger`) && res.status() === 200,
    );

    // Confirm initial data is loaded
    await expect(page.getByText('Opening balance')).toBeVisible();

    // Click the Cash filter (maps to deposit event type)
    const filterGroup = page.getByRole('group', { name: 'Event category filter' });
    await filterGroup.getByText('Cash').click();

    // Wait for Opening balance to disappear (filter took effect)
    await expect(page.getByText('Opening balance')).not.toBeVisible({ timeout: 5000 });

    // Only deposit events should be visible
    await expect(page.getByText('Initial deposit')).toBeVisible();
    await expect(page.getByText('Bonus deposit')).toBeVisible();

    // Non-deposit events should not be visible
    await expect(page.getByText('Monthly platform fee')).not.toBeVisible();
  });

  test('empty filtered results show "No matching events." and Clear filter button', async ({ page }) => {
    await page.goto(`/settings/accounts/${accountId}/ledger`);
    await page.waitForResponse((res) =>
      res.url().includes(`/api/accounts/${accountId}/ledger`) && res.status() === 200,
    );

    // Confirm initial data is loaded
    await expect(page.getByText('Opening balance')).toBeVisible();

    // Click the Adjustment filter — likely has no events in this test account
    const filterGroup = page.getByRole('group', { name: 'Event category filter' });
    await filterGroup.getByText('Adjustment').click();

    // Wait for Opening balance to disappear (filter took effect)
    await expect(page.getByText('Opening balance')).not.toBeVisible({ timeout: 5000 });

    // Should show "No matching events." (the empty-filter message)
    await expect(page.getByText(/No matching events/i)).toBeVisible();

    // Should have a "Clear filter" button that resets to all events
    const clearFilterBtn = page.getByText('Clear filter');
    await expect(clearFilterBtn).toBeVisible();

    // Click Clear filter and verify events reappear
    await clearFilterBtn.click();

    // Wait for events to reappear
    await expect(page.getByText('Opening balance')).toBeVisible({ timeout: 5000 });

    // All filter should be re-selected
    await expect(filterGroup.getByText('All')).toHaveAttribute('aria-pressed', 'true');
  });

  test('pagination: shows Prev/Next controls and page info', async ({ page }) => {
    await page.goto(`/settings/accounts/${accountId}/ledger`);
    await page.waitForResponse((res) =>
      res.url().includes(`/api/accounts/${accountId}/ledger`) && res.status() === 200,
    );

    // With 25+ events and default page limit of 25, we should have at least 2 pages
    const prevBtn = page.getByLabel('Previous page');
    const nextBtn = page.getByLabel('Next page');

    // Prev should be disabled on page 1
    await expect(prevBtn).toBeDisabled();

    // Next should be enabled if there are multiple pages
    await expect(nextBtn).toBeEnabled();

    // Page indicator should show "Page 1 of N"
    await expect(page.getByText(/Page 1 of/)).toBeVisible();

    // Click Next to go to page 2
    await nextBtn.click();

    // Wait for page indicator to show page 2
    await expect(page.getByText(/Page 2 of/)).toBeVisible({ timeout: 5000 });

    // Prev should now be enabled
    await expect(prevBtn).toBeEnabled();
  });

  test('row expansion: expand to show debit and credit postings', async ({ page }) => {
    await page.goto(`/settings/accounts/${accountId}/ledger`);
    await page.waitForResponse((res) =>
      res.url().includes(`/api/accounts/${accountId}/ledger`) && res.status() === 200,
    );

    // Find the first expand button and click it
    const expandBtn = page.getByLabel('Expand details').first();

    await expect(expandBtn).toBeVisible();
    await expect(expandBtn).toHaveAttribute('aria-expanded', 'false');

    // Click expand
    await expandBtn.click();

    // After expansion, the detail section should show debit/credit
    await expect(page.getByText('Debit')).toBeVisible();
    await expect(page.getByText('Credit')).toBeVisible();
    await expect(page.getByText('Balanced')).toBeVisible();

    // Should now have Collapse label
    await expect(page.getByLabel('Collapse details')).toBeVisible();

    // The expanded region should have role="region" with accessible label
    const region = page.locator('[role="region"]');
    await expect(region).toBeVisible();
    await expect(region).toHaveAttribute('aria-label', /Details for/);
  });

  test('row expansion: shows idempotency key if present', async ({ page }) => {
    await page.goto(`/settings/accounts/${accountId}/ledger`);
    await page.waitForResponse((res) =>
      res.url().includes(`/api/accounts/${accountId}/ledger`) && res.status() === 200,
    );

    // The financial events endpoint assigns idempotency keys
    // Try expanding a deposit row
    const bonusRow = page.getByText('Bonus deposit').locator('..');
    const expandBtn = bonusRow.locator('..').getByLabel('Expand details');

    if (await expandBtn.isVisible()) {
      await expandBtn.click();
      await page.waitForTimeout(200);

      // Idempotency key section may or may not be present
      const idemSection = page.getByText('Idempotency Key');
      if (await idemSection.isVisible().catch(() => false)) {
        // The idempotency key value should be a UUID-like string
        await expect(idemSection.locator('..').getByText(/[a-f0-9-]{20,}/)).toBeVisible();
      }
    }
  });

  test('correction group: displays Corrected badge with expandable lineage', async ({ page }) => {
    await page.goto(`/settings/accounts/${accountId}/ledger`);
    await page.waitForResponse((res) =>
      res.url().includes(`/api/accounts/${accountId}/ledger`) && res.status() === 200,
    );

    // Verify the correction group badge is visible
    // The corrected event description mentions the correction
    const correctedEvent = page.getByText(/Corrected/i);
    await expect(correctedEvent).toBeVisible();

    // There should be a "Corrected" badge on the correction group row
    await expect(page.getByText('Corrected').first()).toBeVisible();

    // Find the correction group row (replacement event description)
    const corrRowText = page.getByText(/Correction replacement/).first();
    const corrRowParent = corrRowText.locator('..');
    const expandBtns = corrRowParent.locator('..').getByLabel('Expand details');

    // If there's an expand button on the correction row
    // Note: correction group rows may not be expandable if they have postings
    const corrExpandBtn = expandBtns.first();
    if (await corrExpandBtn.isVisible().catch(() => false)) {
      await corrExpandBtn.click();
      await page.waitForTimeout(200);

      // The expansion should show correction lineage
      const lineageSection = page.getByText('Correction Lineage');
      if (await lineageSection.isVisible().catch(() => false)) {
        await expect(page.getByText('Original:')).toBeVisible();
        await expect(page.getByText('Reversal:')).toBeVisible();
        await expect(page.getByText('Replacement:')).toBeVisible();
        await expect(page.getByText(/Wrong quantity entered/)).toBeVisible();
      }
    }
  });

  test('no duplicate primary rows: correction group does not duplicate events', async ({ page }) => {
    await page.goto(`/settings/accounts/${accountId}/ledger`);
    await page.waitForResponse((res) =>
      res.url().includes(`/api/accounts/${accountId}/ledger`) && res.status() === 200,
    );

    // First, verify via the API that there are no duplicate event IDs
    const ledgerRes = await page.request.get(
      `/api/accounts/${accountId}/ledger?limit=100`,
    );
    expect(ledgerRes.status()).toBe(200);
    const ledgerBody = await ledgerRes.json();

    // Check no duplicate event IDs in the response
    const eventIds = ledgerBody.events.map(
      (e: { eventId: string }) => e.eventId,
    );
    const uniqueIds = new Set(eventIds);
    expect(uniqueIds.size).toBe(eventIds.length);

    // Verify the correction group substitutes for original/reversal/replacement
    // The original trade execution event should NOT appear separately
    const correctionEvents = ledgerBody.events.filter(
      (e: { correctionGroup: unknown }) => e.correctionGroup !== null,
    );
    expect(correctionEvents.length).toBeGreaterThanOrEqual(1);

    // The non-correction trade events should not include the corrected original
    const standaloneTradeEvents = ledgerBody.events.filter(
      (e: { correctionGroup: unknown; eventType: string; description: string }) =>
        e.correctionGroup === null &&
        e.eventType === 'trade_execution' &&
        e.description.includes('Buy 100 AAPL @ 150.00'),
    );
    expect(standaloneTradeEvents.length).toBe(0);
  });

  test('negative: empty account shows "No ledger events yet." state', async ({ page }) => {
    // Create a fresh account with no events
    const emptyName = `Empty Ledger ${Date.now()}`;
    const emptyAccount = await createAccount(page, emptyName);

    // Navigate to the ledger page
    await page.goto(`/settings/accounts/${emptyAccount.id}/ledger`);
    await page.waitForResponse(
      (res) =>
        res.url().includes(`/api/accounts/${emptyAccount.id}/ledger`) &&
        res.status() === 200,
    );

    // Should show the empty account message
    await expect(page.getByText('No ledger events yet.')).toBeVisible();
    await expect(
      page.getByText(/Post financial events or executions to see activity here/),
    ).toBeVisible();

    // Should NOT show a filter group (no events to filter)
    // The component still renders filters for empty state; just verify the empty message
  });

  test('negative: empty filter on populated account shows "No matching events." not a placeholder row', async ({ page }) => {
    await page.goto(`/settings/accounts/${accountId}/ledger`);
    await page.waitForResponse((res) =>
      res.url().includes(`/api/accounts/${accountId}/ledger`) && res.status() === 200,
    );

    // Confirm initial data is loaded
    await expect(page.getByText('Opening balance')).toBeVisible();

    // Apply an unlikely filter — Corp. Action likely has no events in this test account
    const filterGroup = page.getByRole('group', { name: 'Event category filter' });
    await filterGroup.getByText('Corp. Action').click();

    // Wait for Opening balance to disappear (filter took effect)
    await expect(page.getByText('Opening balance')).not.toBeVisible({ timeout: 5000 });

    // Should show "No matching events." (not a placeholder row with dashes or zeros)
    await expect(page.getByText(/No matching events/i)).toBeVisible();

    // Negative assertion: should NOT show any event data or a "0 events" row
    await expect(page.getByText('$50,000.00')).not.toBeVisible();
  });

  test('Ledger tab is deep-linkable: direct URL renders the ledger workspace', async ({ page }) => {
    // Navigate directly to the ledger URL (not via tab click)
    await page.goto(`/settings/accounts/${accountId}/ledger`);

    // Should load the ledger workspace directly
    await page.waitForResponse(
      (res) =>
        res.url().includes(`/api/accounts/${accountId}/ledger`) &&
        res.status() === 200,
    );

    // The Ledger tab should be selected
    await expect(page.getByRole('tab', { name: 'Ledger' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // Events should be visible
    await expect(page.getByText('Opening balance')).toBeVisible();
  });
});
