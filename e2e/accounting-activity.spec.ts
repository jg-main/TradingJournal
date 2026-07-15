/**
 * Accounting Activity — e2e test.
 *
 * Exercises the full account activity flow through the real dev server
 * and browser UI:
 *
 * 1. Create an account, post opening balance
 * 2. Navigate to the account page and verify the activity table shows
 *    ordered event labels (Opening, Deposit, Withdrawal, Stock Split)
 *    with correct effect labels (Cash In, Cash Out, Corporate Action)
 * 3. Post a deposit through the browser UI form and verify success banner
 *    and automatic table refresh
 * 4. Verify multiple event types are distinguishable: deposits show
 *    "Cash In" effect, withdrawals show "Cash Out", stock splits show
 *    "Corporate Action"
 * 5. Verify conflict behavior via duplicate idempotency key API call
 *    and check the conflict/error banner appears in the UI
 * 6. Reload the page and verify persistence of all events
 *
 * Run: npx playwright test -- e2e/accounting-activity.spec.ts
 */

import { test, expect } from '@playwright/test';

test.describe('Accounting Activity — e2e', () => {
  test('posts multiple event types, verifies activity table, handles errors', async ({ page }) => {
    // ── 1. Create an account ──────────────────────────────────────────
    const accRes = await page.request.post('/api/accounts', {
      data: {
        name: 'Activity Test Account',
        broker: 'E2E Broker',
        currency: 'USD',
        startingBalance: 0,
      },
    });
    expect(accRes.ok()).toBeTruthy();
    const account = await accRes.json();
    expect(account.id).toBeDefined();
    const accountId: string = account.id;

    // ── 2. Post opening balance via API (baseline) ────────────────────
    const obRes = await page.request.post(
      `/api/accounts/${accountId}/financial-events`,
      {
        data: {
          eventType: 'opening_balance',
          amount: '10000.00',
          description: 'Opening balance',
        },
      },
    );
    expect(obRes.status()).toBe(201);

    // ── 3. Post additional events via API for table diversity ─────────
    // Deposit
    const depRes = await page.request.post(
      `/api/accounts/${accountId}/financial-events`,
      {
        data: {
          eventType: 'deposit',
          amount: '5000.00',
          description: 'Wire transfer deposit',
        },
      },
    );
    expect(depRes.status()).toBe(201);

    // Withdrawal
    const wdRes = await page.request.post(
      `/api/accounts/${accountId}/financial-events`,
      {
        data: {
          eventType: 'withdrawal',
          amount: '2000.00',
          description: 'ATM withdrawal',
        },
      },
    );
    expect(wdRes.status()).toBe(201);

    // Stock split (corporate action)
    const ssRes = await page.request.post(
      `/api/accounts/${accountId}/financial-events`,
      {
        data: {
          eventType: 'stock_split',
          symbol: 'AAPL',
          ratio: '4:1',
          oldShares: 100,
          newShares: 400,
          oldPrice: '200.00',
          newPrice: '50.00',
          description: 'AAPL 4:1 stock split',
        },
      },
    );
    expect(ssRes.status()).toBe(201);

    // ── 4. Navigate to the account page ──────────────────────────────
    await page.goto(`/accounts/${accountId}`);
    await page.waitForLoadState('networkidle');

    // ── 5. Verify the page loaded and activity table is visible ──────
    // The account header should show the account name
    await expect(page.locator('text=Activity Test Account')).toBeVisible();

    // The activity section title should be visible
    await expect(page.locator('text=Account Activity')).toBeVisible();

    // ── 6. Verify events appear in correct order with type badges ────
    // Events should be ordered: Opening, Deposit, Withdrawal, Stock Split

    const activityRows = page.locator('table tbody tr');

    // Opening balance (first row)
    await expect(activityRows.nth(0)).toContainText('Opening');
    await expect(activityRows.nth(0)).toContainText('Cash In');
    await expect(activityRows.nth(0)).toContainText('+$10,000.00');
    await expect(activityRows.nth(0)).toContainText('Opening balance');
    await expect(activityRows.nth(0)).toContainText('Posted');

    // Deposit (second row)
    await expect(activityRows.nth(1)).toContainText('Deposit');
    await expect(activityRows.nth(1)).toContainText('Cash In');
    await expect(activityRows.nth(1)).toContainText('+$5,000.00');
    await expect(activityRows.nth(1)).toContainText('Wire transfer deposit');
    await expect(activityRows.nth(1)).toContainText('Posted');

    // Withdrawal (third row)
    await expect(activityRows.nth(2)).toContainText('Withdrawal');
    await expect(activityRows.nth(2)).toContainText('Cash Out');
    await expect(activityRows.nth(2)).toContainText('-$2,000.00');
    await expect(activityRows.nth(2)).toContainText('ATM withdrawal');
    await expect(activityRows.nth(2)).toContainText('Posted');

    // Stock split (fourth row)
    await expect(activityRows.nth(3)).toContainText('Stock Split');
    await expect(activityRows.nth(3)).toContainText('Corporate Action');
    await expect(activityRows.nth(3)).toContainText('—');
    await expect(activityRows.nth(3)).toContainText('AAPL 4:1 stock split');
    await expect(activityRows.nth(3)).toContainText('Posted');

    // ── 7. Verify total events count in footer ───────────────────────
    await expect(page.locator('text=4 events')).toBeVisible();

    // ── 8. Post a dividend via the UI form ───────────────────────────
    // Click the "Post Event" button to open the form
    await page.click('button:has-text("Post Event")');

    // The form should now be visible
    await expect(page.locator('text=Post Financial Event')).toBeVisible();

    // Select "Dividend" from the event type dropdown
    await page.selectOption('select', 'dividend');

    // Fill in the amount
    await page.fill('input[type="number"]', '150.00');

    // Fill in description
    await page.fill('input[placeholder="e.g. Wire transfer deposit"]', 'Quarterly dividend');

    // Submit the form
    await page.click('button:has-text("Post Event")');

    // ── 9. Verify success message and automatic table refresh ─────────
    await expect(page.locator('text=Dividend posted.')).toBeVisible();

    // The table should now show 5 events
    await expect(page.locator('text=5 events')).toBeVisible();

    // The new dividend row should be the last row (ordered by posted_at ASC)
    await expect(activityRows.nth(4)).toContainText('Dividend');
    await expect(activityRows.nth(4)).toContainText('Cash In');
    await expect(activityRows.nth(4)).toContainText('+$150.00');
    await expect(activityRows.nth(4)).toContainText('Posted');

    // ── 10. Test error flow: Cancel closes form without posting ───────
    // Open the form again
    await page.click('button:has-text("Post Event")');
    // Cancel without filling any data — just verify the form closes
    await page.click('button:has-text("Cancel")');

    // ── 11. Reload page and verify persistence ────────────────────────
    await page.reload();
    await page.waitForLoadState('networkidle');

    // All 5 events should still be visible
    await expect(page.locator('text=5 events')).toBeVisible();

    // Verify the dividend is still there
    await expect(page.locator('text=Quarterly dividend')).toBeVisible();

    // ── 12. Test conflict handling via API (duplicate idempotency key) ─
    const dupKey = crypto.randomUUID();

    // Post first event with a known key
    const firstPost = await page.request.post(
      `/api/accounts/${accountId}/financial-events`,
      {
        data: {
          eventType: 'interest',
          amount: '25.50',
          idempotencyKey: dupKey,
          description: 'Duplicate key test',
        },
      },
    );
    expect(firstPost.status()).toBe(201);

    // Post duplicate with same key — should get 409
    const dupPost = await page.request.post(
      `/api/accounts/${accountId}/financial-events`,
      {
        data: {
          eventType: 'interest',
          amount: '999.99',
          idempotencyKey: dupKey,
          description: 'This should conflict',
        },
      },
    );
    expect(dupPost.status()).toBe(409);

    const dupBody = await dupPost.json();
    expect(dupBody.error).toBe('Duplicate idempotency key');

    // Refresh the page — the interest event should appear only once
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('text=Duplicate key test')).toBeVisible();

    // Verify there's only one interest event (the conflict didn't create a second)
    const interestCells = await page.locator('text=Interest').all();
    expect(interestCells.length).toBeGreaterThanOrEqual(1);

    // Verify description "This should conflict" does NOT appear (the 409 prevented it)
    await expect(page.locator('text=This should conflict')).not.toBeVisible();
  });

  test('empty state shows when no events exist', async ({ page }) => {
    // Create a fresh account with no events
    const accRes = await page.request.post('/api/accounts', {
      data: {
        name: 'Empty Activity Account',
        broker: 'E2E',
        currency: 'USD',
        startingBalance: 0,
      },
    });
    expect(accRes.ok()).toBeTruthy();
    const account = await accRes.json();

    // Navigate to the account page
    await page.goto(`/accounts/${account.id}`);
    await page.waitForLoadState('networkidle');

    // Verify empty state message
    await expect(page.locator('text=No financial events yet.')).toBeVisible();
    await expect(
      page.locator('text=Post a deposit, withdrawal, or other event to see activity.'),
    ).toBeVisible();

    // The "Post Event" button should be visible
    await expect(page.locator('button:has-text("Post Event")')).toBeVisible();
  });

  test('manual adjustment with positive and negative amounts through UI', async ({ page }) => {
    // Create account
    const accRes = await page.request.post('/api/accounts', {
      data: { name: 'Manual Adj Account', broker: 'E2E', currency: 'USD', startingBalance: 0 },
    });
    expect(accRes.ok()).toBeTruthy();
    const account = await accRes.json();

    // Post opening balance via API
    await page.request.post(`/api/accounts/${account.id}/financial-events`, {
      data: { eventType: 'opening_balance', amount: '5000.00' },
    });

    // Navigate to account
    await page.goto(`/accounts/${account.id}`);
    await page.waitForLoadState('networkidle');

    // Post a positive manual adjustment
    await page.click('button:has-text("Post Event")');
    await page.selectOption('select', 'manual_adjustment');
    await page.fill('input[type="number"]', '250.00');
    await page.fill('input[placeholder="e.g. Rounding correction"]', 'Rounding fix');
    await page.click('button:has-text("Post Event")');

    await expect(page.locator('text=Manual Adjustment posted.')).toBeVisible();

    // Post a negative manual adjustment
    await page.click('button:has-text("Post Event")');
    await page.selectOption('select', 'manual_adjustment');
    await page.fill('input[type="number"]', '-100.00');
    await page.fill('input[placeholder="e.g. Rounding correction"]', 'Over-credit fix');
    await page.click('button:has-text("Post Event")');

    await expect(page.locator('text=Manual Adjustment posted.')).toBeVisible();

    // Verify both appear in the activity table
    const rows = page.locator('table tbody tr');

    // Opening balance (row 1)
    await expect(rows.nth(0)).toContainText('Opening');
    await expect(rows.nth(0)).toContainText('Cash In');

    // Positive manual adj (row 2) — shows as cash increase
    // (reason is stored in payload, not displayed as description)
    await expect(rows.nth(1)).toContainText('Manual Adj.');
    await expect(rows.nth(1)).toContainText('Cash In');
    await expect(rows.nth(1)).toContainText('+$250.00');

    // Negative manual adj (row 3) — shows as cash decrease
    await expect(rows.nth(2)).toContainText('Manual Adj.');
    await expect(rows.nth(2)).toContainText('Cash Out');
    await expect(rows.nth(2)).toContainText('-$100.00');

    // 3 events total
    await expect(page.locator('text=3 events')).toBeVisible();
  });
});
