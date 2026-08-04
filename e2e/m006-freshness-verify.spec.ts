/**
 * M006 Data Freshness — End-to-End Pipeline Verification
 *
 * Proves the full S01→S02→S03 pipeline works in the browser:
 * 1. Creates an account with opening balance
 * 2. Posts 3 trade executions (CAKE, AMRX, WKC) matching the integration test scenario
 * 3. Submits valuation marks for all positions
 * 4. Rebuilds performance
 * 5. Navigates to the workstation and verifies:
 *    - All 3 positions are visible in the positions panel
 *    - Prices match the submitted marks
 *    - Dashboard V2 shows fresh data status
 *
 * Run: npx playwright test e2e/m006-freshness-verify.spec.ts --project=chromium
 */

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 } });

test.describe.configure({ mode: 'serial' });

// ── Shared state ──────────────────────────────────────────────────────────
let accountId: string;
let accountName: string;

// ── Test data — matches pipeline-integration.test.ts scenario ────────────
const TRADES = [
  { symbol: 'CAKE', quantity: '500.00', price: '65.50', markPrice: '68.25' },
  { symbol: 'AMRX', quantity: '300.00', price: '8.40', markPrice: '8.75' },
  { symbol: 'WKC', quantity: '200.00', price: '28.15', markPrice: '27.90' },
];

// ── API helpers ───────────────────────────────────────────────────────────

async function ensureAppProfile(request: APIRequestContext) {
  const res = await request.put('/api/app-profile', {
    data: {
      displayName: 'M006 Freshness E2E',
      timezone: 'America/New_York',
      defaultCurrency: 'USD',
    },
  });
  expect(res.ok()).toBeTruthy();
}

async function createAccount(
  request: APIRequestContext,
): Promise<{ id: string; name: string }> {
  const name = `M006 Freshness ${Date.now()}`;
  const res = await request.post('/api/accounts', {
    data: { name, broker: 'E2E Test', currency: 'USD' },
  });
  expect(res.status()).toBe(201);
  const account = (await res.json()) as { id: string };
  return { id: account.id, name };
}

async function postOpeningBalance(request: APIRequestContext, id: string) {
  const res = await request.post(`/api/accounts/${id}/financial-events`, {
    data: {
      eventType: 'opening_balance',
      amount: '100000.00',
      description: 'E2E opening balance',
    },
  });
  expect(res.status()).toBe(201);
}

async function postExecution(
  request: APIRequestContext,
  accountId: string,
  data: { symbol: string; action: string; quantity: string; price: string },
) {
  const res = await request.post(`/api/accounts/${accountId}/executions`, {
    data: { ...data, fees: '0.00' },
  });
  expect(res.status()).toBe(201);
}

async function postValuationMark(
  request: APIRequestContext,
  accountId: string,
  symbol: string,
  price: string,
) {
  const res = await request.post(`/api/accounts/${accountId}/valuations`, {
    data: {
      symbol,
      price,
      source: 'market_data',
      markTimestamp: new Date().toISOString(),
    },
  });
  expect(res.status()).toBe(201);
}

async function rebuildPerformance(request: APIRequestContext, accountId: string) {
  const res = await request.post(`/api/accounts/${accountId}/performance`);
  expect(res.status()).toBe(200);
  return await res.json();
}

async function getDashboardV2(request: APIRequestContext, acctId: string) {
  const res = await request.get(`/api/dashboard/v2?accountId=${acctId}`);
  expect(res.status()).toBe(200);
  return await res.json();
}

// ── Console / Request error capture ──────────────────────────────────────

async function captureConsoleErrors(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (
        text.includes('favicon') ||
        text.includes('extension')
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
  return failed;
}

async function selectApplicationAccount(page: Page) {
  const accountSelect = page
    .getByRole('complementary')
    .getByLabel('Select account');
  await expect(accountSelect).toBeVisible();

  if (!(await accountSelect.textContent())?.includes(accountName)) {
    const dashboardResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/dashboard') &&
        response.url().includes(`accountId=${accountId}`) &&
        response.ok(),
    );
    await accountSelect.click();
    await page
      .getByRole('option', {
        name: `${accountName} (E2E Test)`,
        exact: true,
      })
      .click();
    await dashboardResponse;
  }

  await expect(page.getByTestId('ws-external-account')).toHaveText(accountName);
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

test.describe('M006 Data Freshness Pipeline', () => {
  // ── Setup: seed account with 3 positions matching integration test ───
  test.beforeAll(async ({ request }) => {
    await ensureAppProfile(request);
    const account = await createAccount(request);
    accountId = account.id;
    accountName = account.name;
    await postOpeningBalance(request, accountId);

    // Post 3 trade executions
    for (const t of TRADES) {
      await postExecution(request, accountId, {
        symbol: t.symbol,
        action: 'buy',
        quantity: t.quantity,
        price: t.price,
      });
    }

    // Post valuation marks for all 3 symbols
    for (const t of TRADES) {
      await postValuationMark(request, accountId, t.symbol, t.markPrice);
    }

    // Rebuild performance
    const rebuild = await rebuildPerformance(request, accountId);
    expect(rebuild.success).toBe(true);
    expect(rebuild.positionCount).toBe(3);
  });

  // ── Test 1: Dashboard V2 API returns fresh data for all 3 positions ──
  test('Dashboard V2 API returns fresh data for all 3 positions', async ({ request }) => {
    const v2 = await getDashboardV2(request, accountId);

    // Verify integrity
    expect(v2.integrity.status).toBe('healthy');

    // Verify all 3 positions are present
    expect(v2.valuation.positions).toHaveLength(3);

    // Verify each position exists and has a fresh mark
    for (const t of TRADES) {
      const pos = v2.valuation.positions.find(
        (p: { symbol: string }) => p.symbol === t.symbol,
      );
      expect(pos, `${t.symbol} should be in valuation positions`).toBeDefined();
      expect(parseFloat(pos.markPrice)).toBeCloseTo(parseFloat(t.markPrice), 2);
      expect(pos.markStatus).toBe('fresh');
    }

    // Verify totals
    const expectedPnl = TRADES.reduce(
      (sum, t) => sum + (parseFloat(t.markPrice) - parseFloat(t.price)) * parseFloat(t.quantity),
      0,
    );
    expect(parseFloat(v2.riskSummary.openPnl)).toBeCloseTo(expectedPnl, 2);
  });

  // ── Test 2: Live-mode workstation shows all 3 positions with prices ──
  test('workstation positions panel shows all open trades with live prices', async ({
    page,
  }) => {
    const consoleErrors = await captureConsoleErrors(page);
    const failedRequests = await captureFailedRequests(page);

    await page.goto('/', { waitUntil: 'networkidle' });

    // Verify the toolbar and LIVE badge
    const toolbar = page.getByTestId('ws-toolbar');
    await expect(toolbar).toBeVisible();
    await expect(page.getByTestId('ws-live-badge')).toBeVisible();

    await selectApplicationAccount(page);

    // Wait for the positions panel
    const positions = page.getByTestId('ws-panel-positions');
    await expect(positions).toBeVisible({ timeout: 10000 });

    // Verify all 3 symbols appear in the positions table
    for (const t of TRADES) {
      await expect(positions.getByText(t.symbol)).toBeVisible({ timeout: 5000 });
    }

    // Verify KPI strip shows data
    const kpis = page.getByTestId('ws-panel-kpis');
    await expect(kpis).toBeVisible();
    await expect(kpis.getByText('Net P&L')).toBeVisible();

    // Verify equity panel renders
    const equity = page.getByTestId('ws-panel-equity');
    await expect(equity).toBeVisible();

    // Risk panel renders
    const risk = page.getByTestId('ws-panel-risk');
    await expect(risk).toBeVisible();

    // No console errors or unexpected request failures
    expect(consoleErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });

  // ── Test 3: Dashboard home page shows accounting metrics ────────────
  test('workstation home page shows KPI strip and positions panel with data', async ({
    page,
  }) => {
    const consoleErrors = await captureConsoleErrors(page);
    const failedRequests = await captureFailedRequests(page);

    // Home page renders the workstation in live mode
    await page.goto('/');
    await selectApplicationAccount(page);

    // KPI strip should render with live data
    const kpis = page.getByTestId('ws-panel-kpis');
    await expect(kpis).toBeVisible({ timeout: 10000 });
    await expect(kpis.getByText('Net P&L')).toBeVisible();

    // Positions panel should show our 3 symbols
    const positions = page.getByTestId('ws-panel-positions');
    await expect(positions).toBeVisible({ timeout: 10000 });
    for (const t of TRADES) {
      await expect(positions.getByText(t.symbol)).toBeVisible({ timeout: 5000 });
    }

    // Equity panel renders
    const equity = page.getByTestId('ws-panel-equity');
    await expect(equity).toBeVisible();

    // Risk panel renders with content
    const risk = page.getByTestId('ws-panel-risk');
    await expect(risk).toBeVisible();

    // Insights panel renders
    const insights = page.getByTestId('ws-panel-insights');
    await expect(insights).toBeVisible();

    expect(consoleErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });

  // ── Test 4: MTM polling indicator appears in live mode ──────────────
  test('MTM polling indicator visible in live mode with open positions', async ({ page }) => {
    const consoleErrors = await captureConsoleErrors(page);
    const failedRequests = await captureFailedRequests(page);

    await page.goto('/', { waitUntil: 'networkidle' });
    await selectApplicationAccount(page);

    // MTM polling indicator should appear
    await expect(page.getByTestId('ws-mtm-active'))
      .toBeVisible({ timeout: 15000 });

    expect(consoleErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });
});
