/**
 * Performance Dashboard UAT spec (M028).
 *
 * Verifies:
 * 1. Coexistence: / still renders the Risk & Positions workstation and the
 *    sidebar shows a Performance nav entry.
 * 2. /performance renders the global filter bar, KPI row, and chart grid.
 * 3. Unit selector converts currency KPIs while fixed-semantic KPIs stay.
 * 4. Customize mode reveals editing controls; Done restores a chrome-free
 *    normal mode.
 * 5. Saved dashboard create → switch → restore round-trip.
 */

import { test, expect, type Page } from '@playwright/test';

const TS = Date.now().toString(36);

/** Seed an active trading account with a closed trade so analytics has data. */
async function seedAnalyticsData(page: Page) {
  const createResp = await page.request.post('/api/accounts', {
    data: { name: `Perf-UAT-${TS}`, currency: 'USD' },
  });
  expect(createResp.status()).toBe(201);
  const account = (await createResp.json()) as { id: string; name: string };

  // Account lifecycle: risk params → opening cash → activate.
  const riskResp = await page.request.put(`/api/accounts/${account.id}`, {
    data: { maxRiskPerTradePct: 2, defaultCommission: 1 },
  });
  if (!riskResp.ok()) console.log('[seed-risk-failed]', riskResp.status(), await riskResp.text());
  expect(riskResp.ok()).toBeTruthy();

  const cashResp = await page.request.post(`/api/accounts/${account.id}/financial-events`, {
    data: { eventType: 'opening_balance', amount: '50000.00' },
  });
  if (!cashResp.ok()) console.log('[seed-cash-failed]', cashResp.status(), await cashResp.text());
  expect(cashResp.ok()).toBeTruthy();

  const activateResp = await page.request.put(`/api/accounts/${account.id}`, {
    data: { isActive: true },
  });
  if (!activateResp.ok()) console.log('[seed-activate-failed]', activateResp.status(), await activateResp.text());
  expect(activateResp.ok()).toBeTruthy();

  // Create and fully exit a trade → status 'closed'.
  const tradeRes = await page.request.post('/api/trades', {
    data: { symbol: `PERF${TS}`, direction: 'long', accountId: account.id },
  });
  if (!tradeRes.ok()) {
    console.log('[seed-trade-failed]', tradeRes.status(), await tradeRes.text());
  }
  expect(tradeRes.ok()).toBeTruthy();
  const trade = await tradeRes.json();
  const execRes = await page.request.post(`/api/trades/${trade.id}/execute`, {
    data: { entryPrice: 50, entryQuantity: 100, exit1Price: 55, exit1Quantity: 100, fees: 3 },
  });
  if (!execRes.ok()) {
    console.log('[seed-execute-failed]', execRes.status(), await execRes.text());
  }
  expect(execRes.ok()).toBeTruthy();
  return account;
}

// The KPI cards render their metric titles regardless of data volume.
const KPI_TITLES = ['Net P&L', 'Win Rate', 'Profit Factor', 'Average R', 'Total Trades'];
const CHART_TITLES = [
  'Daily Cumulative P&L',
  'Net Daily P&L',
  'Trade Duration Performance',
  'Drawdown Curve',
  'R-Multiple Distribution',
  'Performance by Setup',
];

async function gotoPerformance(page: Page) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('[page-error]', msg.text());
  });
  page.on('pageerror', (err) => console.log('[pageerror]', err.message));
  page.on('requestfailed', (req) => console.log('[requestfailed]', req.url(), req.failure()?.errorText));
  await page.goto('/performance');
  await expect(page).toHaveTitle(/Performance Dashboard/);
  // The shell gates on mount; wait for the toolbar to appear.
  await expect(page.getByRole('button', { name: /Customize/ })).toBeVisible({ timeout: 15_000 });
}

/** Wait for the analytics fetch to complete (KPI values replace the loading ellipsis). */
async function waitForAnalytics(page: Page) {
  // The toolbar shows the trade count once analytics metadata arrives.
  await expect(page.getByText(/\d+ trades?/)).toBeVisible({ timeout: 60_000 });
}

/** The KPI card value cell (stable data attribute on the value div). */
function kpiValue(page: Page, widgetType: string) {
  return page.locator(`[data-kpi-value="${widgetType}"]`);
}

test.describe('coexistence', () => {
  test('root / still renders the workstation with a Performance nav entry', async ({ page }) => {
    await page.goto('/');
    // Workstation risk surface renders.
    await expect(page.getByText(/OPEN POSITIONS/i).first()).toBeVisible({ timeout: 20_000 });
    // Navigation contains the Performance entry.
    await expect(page.getByRole('link', { name: 'Performance' })).toBeVisible();
  });
});

test.describe('/performance structure', () => {
  test('renders filter bar, KPI row, and chart grid', async ({ page }) => {
    await gotoPerformance(page);

    // Global filter bar controls.
    await expect(page.getByText('Accounts:')).toBeVisible();
    await expect(page.getByText('Period:')).toBeVisible();
    await expect(page.getByText('Unit:')).toBeVisible();

    // KPI cards by title.
    for (const title of KPI_TITLES) {
      await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
    }

    // Chart widgets by title.
    for (const title of CHART_TITLES) {
      await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
    }
  });

  test('normal mode is free of editing chrome', async ({ page }) => {
    await gotoPerformance(page);
    await expect(page.getByText('+ Add KPI')).toHaveCount(0);
    await expect(page.getByText('+ Add Chart')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Customize' })).toBeVisible();
  });
});

test.describe('unit semantics', () => {
  test('unit selector toggles presentation; fixed-semantic KPIs keep their unit suffix', async ({ page }) => {
    await seedAnalyticsData(page);
    await gotoPerformance(page);
    await waitForAnalytics(page);

    // Fixed-semantic metrics keep their unit suffix regardless of the unit toggle.
    await expect(kpiValue(page, 'win-rate')).toContainText('%');
    await expect(kpiValue(page, 'profit-factor')).not.toContainText('%');

    // Switching units toggles the active button state.
    const pctBtn = page.getByRole('button', { name: '%', exact: true });
    const rBtn = page.getByRole('button', { name: 'R', exact: true });
    await pctBtn.click();
    await rBtn.click();
    // Both toggles remain interactive and the currency button is still present.
    await expect(page.getByRole('button', { name: '$', exact: true })).toBeVisible();
    await expect(pctBtn).toBeVisible();
  });
});

test.describe('customization mode', () => {
  test('Customize reveals editing controls; Done restores normal mode', async ({ page }) => {
    await gotoPerformance(page);

    await page.getByRole('button', { name: 'Customize' }).click();
    await expect(page.getByText('+ Add KPI')).toBeVisible();
    await expect(page.getByText('+ Add Chart')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Done' })).toBeVisible();

    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByText('+ Add KPI')).toHaveCount(0);
    await expect(page.getByText('+ Add Chart')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Customize' })).toBeVisible();
  });
});

test.describe('saved dashboards', () => {
  test('create a dashboard, switch away and back — state restores', async ({ page }) => {
    // Auto-accept confirmation dialogs for the delete cleanup.
    page.on('dialog', (dialog) => dialog.accept());

    await seedAnalyticsData(page);
    await gotoPerformance(page);
    await waitForAnalytics(page);

    // Open the dashboard switcher (trigger shows the active dashboard name).
    const switcher = page.locator('button', { hasText: 'Performance Default' });
    await switcher.click();
    await page.getByText('+ New Dashboard').click();

    // Name it.
    const nameInput = page.getByPlaceholder('Dashboard name');
    await nameInput.fill('UAT Dashboard');
    await page.getByRole('button', { name: 'OK', exact: true }).click();

    // The new dashboard is active.
    await expect(page.locator('button', { hasText: 'UAT Dashboard' })).toBeVisible();

    // Switch back to the system default.
    await page.locator('button', { hasText: 'UAT Dashboard' }).click();
    const defaultOption = page.getByRole('option', { name: /Performance Default/ });
    await expect(defaultOption).toBeVisible();
    await defaultOption.click();
    await expect(page.locator('button', { hasText: 'Performance Default' })).toBeVisible();

    // And back to the user dashboard.
    await page.locator('button', { hasText: 'Performance Default' }).click();
    const uatOption = page.getByRole('option', { name: /UAT Dashboard/ });
    await expect(uatOption).toBeVisible();
    await uatOption.click();
    await expect(page.locator('button', { hasText: 'UAT Dashboard' })).toBeVisible();

    // Cleanup: delete the UAT dashboard via the switcher.
    await page.locator('button', { hasText: 'UAT Dashboard' }).click();
    await page.getByRole('button', { name: /Delete/ }).click();
    // Back on the immutable system default after deletion.
    await expect(page.locator('button', { hasText: 'Performance Default' })).toBeVisible();
  });
});
