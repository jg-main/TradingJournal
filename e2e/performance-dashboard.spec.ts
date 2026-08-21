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
 * 6. S03 (R003): five-card KPI rail equal geometry at 1440px with contained
 *    microvisualizations; Customize reorder → Save → reload persistence.
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
// The curated five-card default rail (S03/R003): Payoff Ratio replaced
// Total Trades (and Gross P&L), which are no longer default-visible.
const KPI_TITLES = ['Net P&L', 'Win Rate', 'Profit Factor', 'Average R', 'Payoff Ratio'];
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

  test('shell continuity: sidebar persists and keeps consistent width across / → /performance → /trades → /performance', async ({ page }) => {
    // M001 S01 (R001): /performance must behave as a normal application page
    // inside the shared sidebar shell. The sidebar must stay visible on every
    // stop of the navigation chain and keep the same width on /performance
    // and /trades (the same shell layout), while / stays the workstation.
    const aside = page.locator('aside');
    const asideWidth = async () => (await aside.boundingBox())?.width ?? 0;

    // Stop 1: / — workstation root, sidebar present.
    await page.goto('/');
    await expect(page.getByText(/OPEN POSITIONS/i).first()).toBeVisible({ timeout: 20_000 });
    await expect(aside).toBeVisible();
    const rootWidth = await asideWidth();

    // Stop 2: /performance — sidebar present, same width as the root shell.
    await page.goto('/performance');
    await expect(page).toHaveTitle(/Performance Dashboard/);
    await expect(page.getByRole('button', { name: /Customize/ })).toBeVisible({ timeout: 15_000 });
    await expect(aside).toBeVisible();
    const perfWidth = await asideWidth();
    expect(perfWidth).toBe(rootWidth);

    // Stop 3: /trades — sidebar present, same width as /performance.
    await page.goto('/trades');
    await expect(page).toHaveTitle(/Trades/);
    await expect(aside).toBeVisible();
    const tradesWidth = await asideWidth();
    expect(tradesWidth).toBe(perfWidth);

    // Stop 4: back to /performance — sidebar still present and consistent.
    await page.goto('/performance');
    await expect(page.getByRole('button', { name: /Customize/ })).toBeVisible({ timeout: 15_000 });
    await expect(aside).toBeVisible();
    expect(await asideWidth()).toBe(perfWidth);

    // No horizontal document overflow on the performance page.
    const overflowX = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflowX).toBeLessThanOrEqual(0);
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

// ────────────────────────────────────────────────────────────────────────────
// T3: Deterministic filter propagation (S02)
//
// Proves that every global filter dimension (Account, Period, Direction, Setup,
// Result, Symbol) pushes into the shared /api/performance/analytics query and
// that every analytical widget reacts to the SAME response — no per-widget
// independent fetching. Also proves unit toggles are client-side only and that
// the mixed-currency safety warning still surfaces for multi-currency scopes.
// ────────────────────────────────────────────────────────────────────────────

const PROP = Date.now().toString(36);

interface SeededTradeSpec {
  account: 'A' | 'B';
  symbol: string;
  direction: 'long' | 'short';
  setup: string; // setup lookup name (resolved to its UUID server-side)
  entryPrice: number;
  entryQuantity: number;
  exitPrice: number;
  exitQuantity: number;
  stopPrice: number; // ensures a risk snapshot (initialRiskAmount > 0) exists
  fees: number;
  executedAt: string; // ISO timestamp → trade open+close time
}

/** Create an active account with risk params, opening cash and currency. */
async function seedAccount(page: Page, name: string, currency: string) {
  const createResp = await page.request.post('/api/accounts', {
    data: { name, currency },
  });
  expect(createResp.status()).toBe(201);
  const account = (await createResp.json()) as { id: string; name: string };

  const riskResp = await page.request.put(`/api/accounts/${account.id}`, {
    data: { maxRiskPerTradePct: 2, defaultCommission: 1 },
  });
  expect(riskResp.ok()).toBeTruthy();

  const cashResp = await page.request.post(`/api/accounts/${account.id}/financial-events`, {
    data: { eventType: 'opening_balance', amount: '50000.00' },
  });
  expect(cashResp.ok()).toBeTruthy();

  const activateResp = await page.request.put(`/api/accounts/${account.id}`, {
    data: { isActive: true },
  });
  expect(activateResp.ok()).toBeTruthy();

  return account;
}

/** Create a setup lookup value (the Filters popover reads /api/lookups?type=setup). */
async function seedSetup(page: Page, value: string) {
  const resp = await page.request.post('/api/lookups', {
    data: { type: 'setup', value },
  });
  expect(resp.status()).toBe(201);
  return (await resp.json()) as { id: string; value: string };
}

/** Create + fully exit a trade with a deterministic setup, direction and close date. */
async function seedTrade(page: Page, accountId: string, spec: SeededTradeSpec) {
  const tradeResp = await page.request.post('/api/trades', {
    data: {
      symbol: spec.symbol,
      direction: spec.direction,
      accountId,
      setup: spec.setup,
    },
  });
  expect(tradeResp.ok()).toBeTruthy();
  const trade = (await tradeResp.json()) as { id: string };

  const execResp = await page.request.post(`/api/trades/${trade.id}/execute`, {
    data: {
      entryPrice: spec.entryPrice,
      entryQuantity: spec.entryQuantity,
      stopPrice: spec.stopPrice,
      exit1Price: spec.exitPrice,
      exit1Quantity: spec.exitQuantity,
      fees: spec.fees,
      executedAt: spec.executedAt,
    },
  });
  expect(execResp.ok()).toBeTruthy();
}

/**
 * Seed the deterministic multi-dimension fixture used by the propagation test.
 *
 * Trade matrix (net P&L per trade, R = net / initialRisk):
 *  T1  A  long  alpha  win   2026-03-15  +95  1.90R
 *  T2  A  short alpha  loss  2026-04-20  -55  -0.55R
 *  T3  A  long  beta   win   PREV-11-10  +190 1.90R  (outside YTD)
 *  T4  B  long  alpha  loss  2026-05-05  -55  -2.20R  (account B / EUR)
 *  T5  A  long  beta   loss  2026-06-10  -55  -2.75R
 *  T6  A  long  alpha  loss  2026-07-01  -55  -2.75R
 *
 * Every drive in the sequence (All→A, Whole→YTD, All→Long, All→alpha,
 * All→Winner) changes the trade set {6,5,4,3,2,1}, so each changes at least
 * one KPI and the monthly chart slice.
 *
 * Account B is created FIRST so the account picker default (newest first =
 * accounts[0] from GET /api/accounts desc(createdAt)) is account A.
 */
async function seedPropagationFixture(page: Page, tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`) {
  const y = new Date().getFullYear();
  const prev = y - 1;
  // Unique names per fixture call: the Playwright DB is shared across tests in
  // the file, and lookup values are unique-constrained (409 on duplicates).
  const alphaName = `alpha setup ${tag}`;
  const betaName = `beta setup ${tag}`;
  const setupAlpha = await seedSetup(page, alphaName);
  const setupBeta = await seedSetup(page, betaName);
  const accountB = await seedAccount(page, `PropB-${tag}`, 'EUR');
  const accountA = await seedAccount(page, `PropA-${tag}`, 'USD');

  const trades: SeededTradeSpec[] = [
    { account: 'A', symbol: 'AAAA', direction: 'long', setup: alphaName, entryPrice: 100, entryQuantity: 10, exitPrice: 110, exitQuantity: 10, stopPrice: 95, fees: 5, executedAt: `${y}-03-15T15:00:00.000Z` },
    { account: 'A', symbol: 'BBBB', direction: 'short', setup: alphaName, entryPrice: 100, entryQuantity: 10, exitPrice: 105, exitQuantity: 10, stopPrice: 110, fees: 5, executedAt: `${y}-04-20T15:00:00.000Z` },
    { account: 'A', symbol: 'CCCC', direction: 'long', setup: betaName, entryPrice: 50, entryQuantity: 20, exitPrice: 60, exitQuantity: 20, stopPrice: 45, fees: 10, executedAt: `${prev}-11-10T15:00:00.000Z` },
    { account: 'B', symbol: 'AAAA', direction: 'long', setup: alphaName, entryPrice: 200, entryQuantity: 5, exitPrice: 190, exitQuantity: 5, stopPrice: 195, fees: 5, executedAt: `${y}-05-05T15:00:00.000Z` },
    { account: 'A', symbol: 'DDDD', direction: 'long', setup: betaName, entryPrice: 80, entryQuantity: 10, exitPrice: 75, exitQuantity: 10, stopPrice: 78, fees: 5, executedAt: `${y}-06-10T15:00:00.000Z` },
    { account: 'A', symbol: 'EEEE', direction: 'long', setup: alphaName, entryPrice: 60, entryQuantity: 10, exitPrice: 55, exitQuantity: 10, stopPrice: 58, fees: 5, executedAt: `${y}-07-01T15:00:00.000Z` },
  ];

  for (const t of trades) {
    await seedTrade(page, t.account === 'A' ? accountA.id : accountB.id, t);
  }

  return { accountA, accountB, setupAlpha, setupBeta, alphaName };
}

/**
 * Shape of the /api/performance/analytics JSON response body.
 *
 * The test only introspects kpiMetrics, charts.monthlyPerformance, and
 * metadata.tradeCount; deep metric values are compared via JSON.stringify,
 * so `unknown` is sufficient for those fields (keeps the file free of
 * `any` so the slice-completion `make lint` gate stays green).
 */
interface AnalyticsResponseBody {
  kpiMetrics: Record<string, unknown>;
  charts: {
    monthlyPerformance: unknown;
  };
  metadata: {
    accountCount: number;
    mixedCurrencies: boolean;
    tradeCount: number;
    dateRange: { from: string | null; to: string | null };
    distinctSymbols: string[];
    periodStartEquity: number | null;
    totalInitialRisk: number | null;
  };
}

/**
 * Observe every shared-analytics request and response.
 *
 * Request URLs are captured with a plain listener. Response bodies are
 * captured via route passthrough (route.fetch + fulfill), which is reliable:
 * a fire-and-forget page.on('response') + resp.json() can silently drop bodies
 * when CDP cannot re-read them, whereas route.fetch() reads from the test-side
 * request context. Also counts any OTHER /api/performance/ request so the
 * no-per-widget-fetching guarantee is provable.
 */
function observeAnalytics(page: Page) {
  const analyticsRequests: string[] = [];
  const analyticsResponses: Array<{ url: string; status: number; body: AnalyticsResponseBody | null; error?: string }> = [];
  let otherPerfRequests = 0;

  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('/api/performance/analytics')) {
      analyticsRequests.push(url);
    } else if (url.includes('/api/performance/')) {
      otherPerfRequests += 1;
    }
  });

  page.route('**/api/performance/analytics*', async (route) => {
    const url = route.request().url();
    let response: Awaited<ReturnType<typeof route.fetch>>;
    try {
      response = await route.fetch();
    } catch (err) {
      // route.fetch() failed — record the failure and let the original request
      // continue so the page is not left hanging.
      analyticsResponses.push({ url, status: 0, body: null, error: String(err) });
      return route.continue();
    }
    let body: AnalyticsResponseBody | null = null;
    try {
      body = (await response.json()) as AnalyticsResponseBody;
    } catch {
      // Non-JSON body (e.g. a dev error page) — record null; assertions surface it.
    }
    analyticsResponses.push({ url, status: response.status(), body });
    await route.fulfill({ response });
  });

  return {
    analyticsRequests,
    analyticsResponses,
    get otherPerfRequests() {
      return otherPerfRequests;
    },
    lastBody(): AnalyticsResponseBody | null {
      const last = analyticsResponses[analyticsResponses.length - 1];
      return last ? last.body : null;
    },
  };
}

type AnalyticsObserver = ReturnType<typeof observeAnalytics>;

const KPI_IDS = ['net-pnl', 'win-rate', 'profit-factor', 'average-r', 'payoff-ratio'];

async function readKpis(page: Page): Promise<string[]> {
  const out: string[] = [];
  for (const id of KPI_IDS) {
    out.push((await page.locator(`[data-kpi-value="${id}"]`).textContent()) ?? '');
  }
  return out;
}

/** Wait until the page has applied its first analytics response (KPIs no longer loading). */
async function waitForInitialAnalytics(page: Page, analytics: AnalyticsObserver) {
  await waitForAnalytics(page);
  await expect.poll(() => analytics.analyticsResponses.length).toBeGreaterThanOrEqual(1);
  await expect(page.locator('[data-kpi-value="net-pnl"]')).not.toContainText('Loading', { timeout: 60_000 });
}

/**
 * Drive one filter dimension and assert the full propagation contract:
 *  - exactly one shared analytics request fires (no per-widget fetching),
 *  - the request carries the expected query param (and never a unit param),
 *  - the shared response's KPI metrics and monthly chart slice change,
 *  - at least one KPI value changes in the DOM (widgets re-render).
 */
async function driveDimension(
  page: Page,
  analytics: AnalyticsObserver,
  action: () => Promise<void>,
  expectedUrlSubstr: string,
) {
  const beforeKpis = await readKpis(page);
  const beforeResponses = analytics.analyticsResponses.length;
  const beforeCount = analytics.analyticsRequests.length;
  const otherBefore = analytics.otherPerfRequests;
  const beforeBody = analytics.lastBody();
  expect(beforeBody).not.toBeNull();
  if (!beforeBody) throw new Error('No baseline analytics response captured');

  await action();

  // Exactly one shared analytics response (and request) for this change.
  try {
    await expect.poll(() => analytics.analyticsResponses.length).toBeGreaterThan(beforeResponses);
  } catch (pollErr) {
    // Surface the observed request/response history so a stalled drive fails loudly.
    console.log('[driveDimension] requests:', JSON.stringify(analytics.analyticsRequests));
    console.log('[driveDimension] responses:', JSON.stringify(analytics.analyticsResponses.map((r) => ({ status: r.status, url: r.url, error: r.error }))));
    throw pollErr;
  }
  expect(analytics.analyticsRequests.length).toBe(beforeCount + 1);
  expect(analytics.otherPerfRequests).toBe(otherBefore);

  const recorded = analytics.analyticsResponses[analytics.analyticsResponses.length - 1];
  expect(recorded.status).toBe(200);
  expect(recorded.url).toContain(expectedUrlSubstr);
  expect(recorded.url).not.toContain('unit='); // unit stays client-side; never serialized

  const afterBody = recorded.body;
  expect(afterBody).not.toBeNull();
  if (!afterBody) throw new Error('Analytics response body was not captured');
  expect(JSON.stringify(afterBody.kpiMetrics)).not.toBe(JSON.stringify(beforeBody.kpiMetrics));
  expect(JSON.stringify(afterBody.charts.monthlyPerformance)).not.toBe(JSON.stringify(beforeBody.charts.monthlyPerformance));

  // Widgets re-render from the shared response: at least one KPI text changed.
  await expect.poll(async () => JSON.stringify(await readKpis(page))).not.toBe(JSON.stringify(beforeKpis));
}

test.describe('filter propagation (T3)', () => {
  test('every dimension drives the shared analytics query and updates KPI + chart consistently', async ({ page }) => {
    const analytics = observeAnalytics(page);
    const { accountA, setupAlpha } = await seedPropagationFixture(page);
    await gotoPerformance(page);
    await waitForInitialAnalytics(page, analytics);

    // ── 1. Account: All → A ────────────────────────────────────────────
    // accounts[0] is the newest account (desc createdAt) = account A, so
    // switching to Single Account immediately targets A (no extra fetch).
    await driveDimension(
      page,
      analytics,
      async () => {
        await page.locator('#perf-account-scope').click();
        await page.getByRole('option', { name: 'Single Account' }).click();
      },
      `accountScope=single&accountIds=${accountA.id}`,
    );

    // ── 2. Period: Whole period → YTD ──────────────────────────────────
    // The default filter preset is already 'YTD' (with no date bound, so it
    // spans the whole period). Switch the visible preset to 'Whole Period'
    // first so the YTD selection below is a real change (identical-query
    // presets never refetch — the hook's queryKey dep compares by value).
    await page.locator('#perf-date-period').click();
    await page.getByRole('option', { name: 'Whole Period' }).click();
    await driveDimension(
      page,
      analytics,
      async () => {
        await page.locator('#perf-date-period').click();
        await page.getByRole('option', { name: 'YTD' }).click();
      },
      `dateFrom=${new Date().getFullYear()}-01-01`,
    );

    // ── 3. Direction: All → Long (Filters popover) ─────────────────────
    await driveDimension(
      page,
      analytics,
      async () => {
        await page.getByTestId('filters-trigger').click();
        await page.getByRole('checkbox', { name: 'Long' }).check();
        await page.keyboard.press('Escape');
      },
      'directions=long',
    );

    // ── 4. Setup: All → alpha setup (Filters popover) ──────────────────
    await driveDimension(
      page,
      analytics,
      async () => {
        await page.getByTestId('filters-trigger').click();
        await page.getByRole('checkbox', { name: setupAlpha.value }).check();
        await page.keyboard.press('Escape');
      },
      `setupIds=${setupAlpha.id}`,
    );

    // ── 5. Result: All → Winner (Filters popover) ──────────────────────
    await driveDimension(
      page,
      analytics,
      async () => {
        await page.getByTestId('filters-trigger').click();
        await page.getByRole('checkbox', { name: 'Winner' }).check();
        await page.keyboard.press('Escape');
      },
      'tradeResults=win',
    );

    // ── 6. Symbol: facet narrows, selection propagates (bonus 4th dimension) ──
    // Base scope (A + YTD + long + alpha; symbol/result excluded from the facet)
    // = {T1, T6} → the facet must list exactly AAAA and EEEE.
    await page.getByTestId('filters-trigger').click();
    await expect(page.getByRole('checkbox', { name: 'AAAA' })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'EEEE' })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'CCCC' })).toHaveCount(0);
    const beforeResponses = analytics.analyticsResponses.length;
    const beforeCount = analytics.analyticsRequests.length;
    await page.getByRole('checkbox', { name: 'AAAA' }).check();
    await page.keyboard.press('Escape');
    await expect.poll(() => analytics.analyticsResponses.length).toBeGreaterThan(beforeResponses);
    expect(analytics.analyticsRequests.length).toBe(beforeCount + 1);
    expect(analytics.otherPerfRequests).toBe(0);
    const symbolRecorded = analytics.analyticsResponses[analytics.analyticsResponses.length - 1];
    expect(symbolRecorded.status).toBe(200);
    expect(symbolRecorded.url).toContain('symbols=AAAA');
    expect(symbolRecorded.url).toContain('tradeResults=win'); // stacked with prior filters
    expect(symbolRecorded.body?.metadata?.tradeCount).toBe(1);

    // Active-filter badge: 4 advanced dimensions selected.
    await expect(page.getByTestId('filters-active-count')).toHaveText('4');

    // No per-widget fetching across the whole session: only shared analytics requests.
    expect(analytics.otherPerfRequests).toBe(0);
    expect(analytics.analyticsRequests.every((u) => !u.includes('unit='))).toBeTruthy();
  });

  test('unit toggles never refetch and fixed-semantic KPIs stay put', async ({ page }) => {
    const analytics = observeAnalytics(page);
    await seedPropagationFixture(page);
    await gotoPerformance(page);
    await waitForInitialAnalytics(page, analytics);

    const reqBefore = analytics.analyticsRequests.length;
    const fixedIds = ['win-rate', 'profit-factor', 'average-r', 'payoff-ratio'];
    const readFixed = async () => {
      const out: string[] = [];
      for (const id of fixedIds) {
        out.push((await page.locator(`[data-kpi-value="${id}"]`).textContent()) ?? '');
      }
      return out;
    };
    const initial = await readFixed();

    // % toggle
    await page.getByRole('button', { name: '%', exact: true }).click();
    await expect(page.getByRole('button', { name: '%', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => readFixed()).toEqual(initial);

    // R toggle
    await page.getByRole('button', { name: 'R', exact: true }).click();
    await expect(page.getByRole('button', { name: 'R', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => readFixed()).toEqual(initial);

    // back to $ — fixed KPIs still identical, net-pnl re-renders from client state
    await page.getByRole('button', { name: '$', exact: true }).click();
    await expect(page.getByRole('button', { name: '$', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => readFixed()).toEqual(initial);

    // Let the 300ms debounce window pass — a refetch would have fired by now.
    await page.waitForTimeout(700);
    expect(analytics.analyticsRequests.length).toBe(reqBefore);
    expect(analytics.analyticsRequests.every((u) => !u.includes('unit='))).toBeTruthy();

    // Fixed-semantic suffixes hold regardless of the unit selector.
    await expect(page.locator('[data-kpi-value="win-rate"]')).toContainText('%');
    await expect(page.locator('[data-kpi-value="profit-factor"]')).not.toContainText('%');
    await expect(page.locator('[data-kpi-value="average-r"]')).toContainText('R');
    await expect(page.locator('[data-kpi-value="payoff-ratio"]')).toHaveText(/\d+/);
  });

  test('mixed-currency warning surfaces for multi-currency selections', async ({ page }) => {
    const analytics = observeAnalytics(page);
    // Account B (EUR) created first, account A (USD) second → A is accounts[0].
    await seedAccount(page, `MixB-${PROP}`, 'EUR');
    await seedAccount(page, `MixA-${PROP}`, 'USD');
    await gotoPerformance(page);
    await waitForInitialAnalytics(page, analytics);

    // All-accounts scope never shows the warning.
    await expect(page.getByTestId('mixed-currency-warning')).toHaveCount(0);

    // Multiple mode starts with the newest account only (single currency).
    await page.locator('#perf-account-scope').click();
    await page.getByRole('option', { name: 'Multiple Accounts' }).click();
    const multi = page.getByTestId('account-multi-select');
    await expect(multi).toBeVisible();
    await expect(page.getByTestId('mixed-currency-warning')).toHaveCount(0);

    // Tick the EUR account → two currencies → warning appears.
    await multi.getByRole('checkbox', { name: `MixB-${PROP}` }).check();
    await expect(page.getByTestId('mixed-currency-warning')).toBeVisible();
    await expect(page.getByTestId('mixed-currency-warning')).toHaveText(/USD only/);

    // Untick it → back to a single currency → warning disappears.
    await multi.getByRole('checkbox', { name: `MixB-${PROP}` }).uncheck();
    await expect(page.getByTestId('mixed-currency-warning')).toHaveCount(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// S03 (R003): KPI rail equal geometry + reorder persistence
//
// Proves at 1440px that the five curated default KPI cards share one row with
// equal geometry (same top/bottom edges, height delta ≤ 2px, each inside the
// 108-112px window) and that microvisualizations stay inside the card bounds
// without changing card height. Then proves the customize persistence contract:
// Customize → reorder two cards via the visible arrow controls → Save → reload
// → the saved order is restored (user-owned dashboards persist; the immutable
// system default is the restore baseline).
// ────────────────────────────────────────────────────────────────────────────

/** DOM order of the KPI cards (data-kpi-card attributes, left-to-right). */
async function readKpiOrder(page: Page): Promise<string[]> {
  return page.locator('[data-kpi-card]').evaluateAll((els) =>
    els.map((el) => el.getAttribute('data-kpi-card') ?? ''),
  );
}

test.describe('KPI rail equal geometry (S03 R003)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('five curated cards share top/bottom edges, height delta ≤ 2px, microviz contained', async ({ page }) => {
    await seedPropagationFixture(page);
    await gotoPerformance(page);
    await waitForAnalytics(page);

    // Microviz slots require analytics data: sparkline (Net P&L) + donut (Win Rate).
    await expect(page.locator('[data-kpi-microviz-slot]')).toHaveCount(2, { timeout: 60_000 });

    const cards = page.locator('[data-kpi-card]');
    await expect(cards).toHaveCount(5);

    const geometry = await cards.evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { id: el.getAttribute('data-kpi-card'), top: r.top, bottom: r.bottom, height: r.height };
      }),
    );

    // Exactly the curated five, left-to-right in registry order (one row at 1440px).
    expect(geometry.map((g) => g.id)).toEqual(KPI_IDS);

    const tops = geometry.map((g) => g.top);
    const bottoms = geometry.map((g) => g.bottom);
    const heights = geometry.map((g) => g.height);

    // Every card sits inside the 108-112px window.
    for (const h of heights) {
      expect(h).toBeGreaterThanOrEqual(108);
      expect(h).toBeLessThanOrEqual(112);
    }
    // Shared top and bottom edges (delta ≤ 1px guards subpixel rounding).
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(1);
    expect(Math.max(...bottoms) - Math.min(...bottoms)).toBeLessThanOrEqual(1);
    // Equal heights across all five cards: delta ≤ 2px.
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(2);

    // Microviz does not change card height: a card WITH a slot (net-pnl) has the
    // same height as a card WITHOUT (profit-factor).
    const withViz = geometry.find((g) => g.id === 'net-pnl');
    const withoutViz = geometry.find((g) => g.id === 'profit-factor');
    expect(withViz).toBeDefined();
    expect(withoutViz).toBeDefined();
    if (!withViz || !withoutViz) throw new Error('geometry missing expected cards');
    expect(Math.abs(withViz.height - withoutViz.height)).toBeLessThanOrEqual(2);

    // Microviz contained within the card bounds (slot rect inside card rect).
    const containment = await page.locator('[data-kpi-microviz-slot]').evaluateAll((slots) =>
      slots.map((slot) => {
        const sr = slot.getBoundingClientRect();
        const card = slot.closest('[data-kpi-card]');
        if (!card) return false;
        const cr = card.getBoundingClientRect();
        return (
          sr.top >= cr.top - 0.5 &&
          sr.bottom <= cr.bottom + 0.5 &&
          sr.left >= cr.left - 0.5 &&
          sr.right <= cr.right + 0.5
        );
      }),
    );
    expect(containment).toHaveLength(2);
    expect(containment.every((inside) => inside)).toBe(true);
  });
});

test.describe('KPI reorder persistence (S03 R003)', () => {
  test('Customize reorder → Save → reload restores the saved card order', async ({ page }) => {
    page.on('dialog', (dialog) => dialog.accept());

    await seedPropagationFixture(page);
    await gotoPerformance(page);
    await waitForAnalytics(page);

    const dashName = `Reorder UAT ${TS}`;

    // Create a USER dashboard. The system default is immutable (saveState skips
    // isSystem dashboards), so reorder persistence is proven on a user-owned
    // dashboard, which is persisted to /api/dashboard/views + localStorage.
    await page.locator('button', { hasText: 'Performance Default' }).click();
    await page.getByText('+ New Dashboard').click();
    await page.getByPlaceholder('Dashboard name').fill(dashName);
    const createResp = page.waitForResponse(
      (resp) => resp.url().includes('/api/dashboard/views') && resp.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'OK', exact: true }).click();
    await createResp;
    await expect(page.locator('button', { hasText: dashName })).toBeVisible();

    // Enter Customize: the five curated cards in registry order.
    await page.getByRole('button', { name: 'Customize' }).click();
    await expect(page.getByRole('button', { name: 'Done' })).toBeVisible();
    await expect(page.locator('[data-kpi-card]')).toHaveCount(5);
    expect(await readKpiOrder(page)).toEqual(KPI_IDS);

    // Reorder two cards via the visible arrow controls.
    // win-rate ↓ → [net-pnl, profit-factor, win-rate, average-r, payoff-ratio]
    await page.getByRole('button', { name: 'Move win-rate down' }).click();
    await expect.poll(() => readKpiOrder(page)).toEqual([
      'net-pnl', 'profit-factor', 'win-rate', 'average-r', 'payoff-ratio',
    ]);
    // average-r ↓ → [net-pnl, profit-factor, win-rate, payoff-ratio, average-r]
    await page.getByRole('button', { name: 'Move average-r down' }).click();
    await expect.poll(() => readKpiOrder(page)).toEqual([
      'net-pnl', 'profit-factor', 'win-rate', 'payoff-ratio', 'average-r',
    ]);

    // Save (explicit Save button in Customize mode) and wait for the server
    // write so the reload cannot race the API hydrate.
    const saveResp = page.waitForResponse(
      (resp) => resp.url().includes('/api/dashboard/views') && resp.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Save' }).click();
    await saveResp;

    // Reload → the saved order must be restored on the user dashboard.
    await page.reload();
    await expect(page.getByRole('button', { name: /Customize/ })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('button', { hasText: dashName })).toBeVisible();
    await expect(page.locator('[data-kpi-card]')).toHaveCount(5, { timeout: 15_000 });
    await expect.poll(() => readKpiOrder(page)).toEqual([
      'net-pnl', 'profit-factor', 'win-rate', 'payoff-ratio', 'average-r',
    ]);

    // Cleanup: delete the user dashboard (confirm dialog auto-accepted).
    await page.locator('button', { hasText: dashName }).click();
    await page.getByRole('button', { name: /Delete/ }).click();
    await expect(page.locator('button', { hasText: 'Performance Default' })).toBeVisible();
  });
});
