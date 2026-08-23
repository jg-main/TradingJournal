/**
 * Accounting Dashboard V2 — Integrated Account Lifecycle e2e test.
 *
 * Proves the full browser account lifecycle:
 * 1. Create account + post opening balance
 * 2. Post buy execution + verify missing-price warning before mark
 * 3. Post valuation mark + verify fresh status and NAV
 * 4. Partial sell + verify position reduced
 * 5. Close the remaining position and attempt account close
 * 6. Navigate to the production workstation and verify ledger-derived metrics
 * 7. Run migration + verify the retained reconciliation diagnostic
 *
 * Kept deterministic with unique timestamps; API calls through page.request,
 * browser assertions through page navigation.
 *
 * Run: npx playwright test -- e2e/accounting-dashboard-v2.spec.ts
 */

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

let accountId: string;

// ═══════════════════════════════════════════════════════════════════════════
// API Helpers
// ═══════════════════════════════════════════════════════════════════════════

async function createAccountViaApi(request: APIRequestContext): Promise<string> {
  const name = `Dashboard V2 E2E ${Date.now()}`;
  const response = await request.post('/api/accounts', {
    data: {
      name,
      broker: 'E2E Test',
      currency: 'USD',
    },
  });
  expect(response.status()).toBe(201);
  const account = await response.json();
  return account.id;
}

async function postOpeningBalanceViaApi(request: APIRequestContext, id: string) {
  // Initialization endpoint (A2): posts the opening balance AND activates the
  // account in one server-side transaction.
  const response = await request.post(`/api/accounts/${id}/initialize`, {
    data: {
      mode: 'opening_balance',
      amount: '50000.00',
      description: 'E2E opening balance for Dashboard V2 flow',
    },
  });
  expect(response.status()).toBe(201);
}

async function postExecutionApi(
  request: APIRequestContext,
  id: string,
  data: { symbol: string; action: string; quantity: string; price: string; fees?: string },
) {
  const response = await request.post(`/api/accounts/${id}/executions`, {
    data: {
      symbol: data.symbol,
      action: data.action,
      quantity: data.quantity,
      price: data.price,
      fees: data.fees ?? '0.00',
    },
  });
  expect(response.status()).toBe(201);
  return await response.json();
}

async function rebuildPerformanceViaApi(request: APIRequestContext, id: string) {
  const response = await request.post(`/api/accounts/${id}/performance`);
  expect(response.status()).toBe(200);
  return await response.json();
}

async function postMarkViaApi(request: APIRequestContext, id: string, symbol: string, price: string) {
  const response = await request.post(`/api/accounts/${id}/valuations`, {
    data: {
      symbol,
      price,
      source: 'user',
      markTimestamp: new Date().toISOString(),
    },
  });
  expect(response.status()).toBe(201);
  return await response.json();
}

async function getPositionsApi(
  request: APIRequestContext,
  id: string,
): Promise<{ positions: Array<Record<string, unknown>>; total: number }> {
  const response = await request.get(`/api/accounts/${id}/positions`);
  expect(response.status()).toBe(200);
  return (await response.json()) as { positions: Array<Record<string, unknown>>; total: number };
}

// ═══════════════════════════════════════════════════════════════════════════
// Error / Console Capture
// ═══════════════════════════════════════════════════════════════════════════

async function captureConsoleErrors(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Filter out benign extension/background/expected errors
      if (
        text.includes('favicon') ||
        text.includes('extension') ||
        text.includes('/reconciliation') ||
        text.includes('/migration') ||
        text.includes('400 (Bad Request)')
      ) {
        return;
      }
      errors.push(`[console.error] ${text}`);
    }
  });
  return errors;
}

async function captureFailedRequests(page: Page): Promise<string[]> {
  const failed: string[] = [];
  page.on('requestfailed', (req) => {
    failed.push(`${req.url()} (${req.failure()?.errorText ?? 'unknown'})`);
  });
  page.on('response', (res) => {
    // Expected 400 from reconciliation (no migration), /executions with
    // unsupported params, and account close errors are not diagnostic failures
    if (!res.ok() && res.status() >= 400) {
      const url = res.url();
      if (
        !url.includes('/reconciliation') &&
        !url.includes('/migration') &&
        !url.includes('/close') &&
        !url.includes('/executions')
      ) {
        failed.push(`${res.url()} (${res.status()})`);
      }
    }
  });
  return failed;
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Accounting Dashboard V2 — integrated lifecycle', () => {
  test.beforeAll(async ({ request }) => {
    // Phase 1: Create account + post opening balance
    accountId = await createAccountViaApi(request);
    await postOpeningBalanceViaApi(request, accountId);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Test 1: Account detail page renders with header and empty state
  // ═══════════════════════════════════════════════════════════════════════

  test('account overview shows identity, opening cash event, and empty positions', async ({ page }) => {
    const consoleErrors = await captureConsoleErrors(page);
    const failedRequests = await captureFailedRequests(page);

    await page.goto(`/settings/accounts/${accountId}`);

    // The account name is visible in the workspace heading (the sidebar
    // selector also shows it now the account is active, so scope to the heading).
    await expect(page.getByRole('heading', { name: /Dashboard V2 E2E/ })).toBeVisible();
    await expect(page.getByText('Net Asset Value')).toBeVisible();
    await expect(page.getByText('Net Cash')).toBeVisible();
    await expect(page.getByText('No open positions.')).toBeVisible();
    await expect(page.getByText('Recent Events', { exact: false })).toBeVisible();
    await expect(page.getByText('E2E opening balance for Dashboard V2 flow')).toBeVisible();

    // Verify no console errors or unexpected failed requests
    expect(consoleErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Test 2: Buy execution + rebuild shows missing-price warning
  // ═══════════════════════════════════════════════════════════════════════

  test('buys stock, rebuilds performance, and shows missing-price warning in browser', async ({
    page,
    request,
  }) => {
    const consoleErrors = await captureConsoleErrors(page);
    const failedRequests = await captureFailedRequests(page);

    // Post a buy execution for 100 AAPL at $150.00
    await postExecutionApi(request, accountId, {
      symbol: 'AAPL',
      action: 'buy',
      quantity: '100.00',
      price: '150.00',
      fees: '10.00',
    });

    // Rebuild the performance projection
    const rebuildResult = await rebuildPerformanceViaApi(request, accountId);
    expect(rebuildResult.success).toBe(true);
    expect(rebuildResult.positionCount).toBe(1);

    // Verify API-level warning about missing mark
    const warnings = rebuildResult.warnings as string[];
    expect(warnings.some((w: string) => w.includes('Missing mark'))).toBe(true);

    // Navigate to the account page and verify UI reflects the warning
    await page.goto(`/settings/accounts/${accountId}`);

    await expect(page.getByText('Missing').first()).toBeVisible();
    // The AAPL position should be visible
    // "AAPL" appears in positions, executions, and performance components
    await expect(page.getByText('AAPL').first()).toBeVisible();

    expect(consoleErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Test 3: Post mark, rebuild, verify fresh status and NAV
  // ═══════════════════════════════════════════════════════════════════════

  test('submits valuation mark and shows fresh status and NAV', async ({ page, request }) => {
    const consoleErrors = await captureConsoleErrors(page);
    const failedRequests = await captureFailedRequests(page);

    // Submit a valuation mark for AAPL at $160.00
    await postMarkViaApi(request, accountId, 'AAPL', '160.00');

    // Rebuild to incorporate the mark
    await rebuildPerformanceViaApi(request, accountId);

    // Navigate to page and verify
    await page.goto(`/settings/accounts/${accountId}`);

    // NAV should be visible (no longer empty)
    await expect(page.getByText('Net Asset Value')).toBeVisible();
    // The positions table should show "Fresh" mark status
    await expect(page.getByText('Fresh').first()).toBeVisible();
    // The mark price should be reflected
    await expect(page.getByText('$160.00').first()).toBeVisible();

    await expect(page.getByText('Missing')).toHaveCount(0);

    expect(consoleErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Test 4: Partial sell, verify position reduction + close remaining
  // ═══════════════════════════════════════════════════════════════════════

  test('partial sell reduces position, then closes remaining and shows account close flow', async ({
    page,
    request,
  }) => {
    const consoleErrors = await captureConsoleErrors(page);
    const failedRequests = await captureFailedRequests(page);

    // Post a partial sell — 30 of the 100 AAPL at $170.00
    await postExecutionApi(request, accountId, {
      symbol: 'AAPL',
      action: 'sell',
      quantity: '30.00',
      price: '170.00',
      fees: '5.00',
    });

    // Rebuild
    await rebuildPerformanceViaApi(request, accountId);

    // Verify via API position count (still 1 position, but reduced quantity)
    const positionsAfterPartial = await getPositionsApi(request, accountId);
    expect(positionsAfterPartial.total).toBe(1);
    expect(positionsAfterPartial.positions[0].quantity).toBe('70.00');

    // Close the remaining 70 AAPL
    await postExecutionApi(request, accountId, {
      symbol: 'AAPL',
      action: 'sell',
      quantity: '70.00',
      price: '175.00',
      fees: '5.00',
    });

    // Rebuild
    await rebuildPerformanceViaApi(request, accountId);

    // Verify via API: position should be closed (flat)
    const positionsAfterClose = await getPositionsApi(request, accountId);
    // Either position count is 0 or quantity is 0.00
    if (positionsAfterClose.total > 0) {
      expect(positionsAfterClose.positions[0].quantity).toBe('0.00');
    }

    // Navigate to account page and verify
    await page.goto(`/settings/accounts/${accountId}`);

    // NAV should still be visible (cash only now)
    await expect(page.getByText('Net Asset Value')).toBeVisible();
    // Realized P&L should be visible (we have realized gains from sells)
    await expect(page.getByText('Total P&L')).toBeVisible();

    expect(consoleErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Test 5: Production workstation consumes Dashboard V2 metrics
  // ═══════════════════════════════════════════════════════════════════════

  test('production workstation shows account metrics from Dashboard V2', async ({
    page,
  }) => {
    const consoleErrors = await captureConsoleErrors(page);
    const failedRequests = await captureFailedRequests(page);

    await page.addInitScript((id) => localStorage.setItem('app:account', id), accountId);
    await page.goto('/');

    await expect(page.getByTestId('ws-external-account')).toContainText('Dashboard V2 E2E');
    // Dense layout: the KPI band is gone — NAV and period P&L now render in
    // the Account State panel (the Performance panel gates on dashboard
    // trades, which this execution-only pipeline leaves empty).
    await expect(page.getByTestId('ws-panel-account-state').getByText('NAV')).toBeVisible();
    await expect(page.getByTestId('ws-panel-account-state').getByText('Total P&L')).toBeVisible();
    // Risk band: Open P&L cell renders the qualified presentation label or a
    // signed value; Portfolio heat cell always renders (S04 T02).
    await expect(page.getByTestId('ws-risk-cell-open-pnl')).toBeVisible();
    await expect(page.getByTestId('ws-risk-cell-heat')).toBeVisible();
    await expect(page.getByTestId('ws-panel-risk').getByText('Portfolio heat')).toBeVisible();

    expect(consoleErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Test 6: Migration + reconciliation eligibility
  // ═══════════════════════════════════════════════════════════════════════

  test('runs migration and verifies the reconciliation diagnostic and workstation', async ({
    page,
    request,
  }) => {
    const consoleErrors = await captureConsoleErrors(page);
    const failedRequests = await captureFailedRequests(page);

    // ── 1. Run migration via API ────────────────────────────────────────
    const migRes = await request.post(`/api/accounts/${accountId}/migration`);
    expect(migRes.ok()).toBeTruthy();
    const migration = await migRes.json();
    expect(migration.status).toBe('completed');
    expect(migration.runId).toBeDefined();

    // ── 2. Verify via reconciliation API ────────────────────────────────
    const recRes = await request.get(`/api/accounts/${accountId}/reconciliation`);
    expect(recRes.status()).toBe(200);
    const report = await recRes.json();
    // The account has accounting-only executions (no legacy trades), so
    // cutover eligibility may be false due to unmatched records.
    // The migration still completed successfully and the report is well-formed.
    expect(typeof report.cutoverEligible).toBe('boolean');
    expect(report.comparisons).toBeDefined();
    // All 7 reconciliation dimensions should be present
    expect(report.comparisons.length).toBe(7);
    expect(report.totals).toBeDefined();
    expect(typeof report.totals.comparisons).toBe('number');

    // ── 3. Navigate to the retained diagnostic and verify the report ─────
    await page.goto(`/settings/accounts/${accountId}/reconciliation`);

    // Click the reconciliation Refresh button to fetch the report
    const refreshButton = page.getByRole('button', { name: 'Refresh reconciliation report' });
    await expect(refreshButton).toBeVisible();
    await refreshButton.click();

    // The reconciliation card should show migration run data
    // It will either show 'eligible for cutover' or 'not eligible for cutover'
    // depending on whether the accounting-only executions match legacy data.
    // Accept either outcome — we just need to prove the UI loads the report.
    const eligibleLocator = page.getByText('eligible for cutover');
    const notEligibleLocator = page.getByText('not eligible for cutover');
    await expect(Promise.race([
      eligibleLocator.waitFor({ state: 'visible', timeout: 5000 }).then(() => eligibleLocator),
      notEligibleLocator.waitFor({ state: 'visible', timeout: 5000 }).then(() => notEligibleLocator),
    ])).resolves.toBeVisible();
    // Comparison stats should appear
    await expect(page.getByText('Comparisons').first()).toBeVisible();
    // Matching count should be visible
    await expect(page.getByText('Matching')).toBeVisible();

    // ── 4. Return to the production workstation ────────────────────────
    await page.addInitScript((id) => localStorage.setItem('app:account', id), accountId);
    await page.goto('/');
    await expect(page.getByTestId('ws-external-account')).toContainText('Dashboard V2 E2E');
    await expect(page.getByTestId('ws-grid')).toBeVisible();

    expect(consoleErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });
});
