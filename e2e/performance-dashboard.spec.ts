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
 * 7. S05 (R005): one consistent ⋯ actions menu (Configure/Duplicate/Remove/
 *    Reset) on every widget in Customize mode; Configure opens the shared
 *    typed dialog (chart series + KPI metric); Duplicate/Remove/Reset drive
 *    the instance model; normal mode stays chrome-free.
 */

import { test, expect, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hideDevOverlay } from './helpers';

const TS = Date.now().toString(36);

/** Seed an active trading account with a closed trade so analytics has data. */
async function seedAnalyticsData(page: Page) {
  const createResp = await page.request.post('/api/accounts', {
    data: { name: `Perf-UAT-${TS}`, currency: 'USD' },
  });
  expect(createResp.status()).toBe(201);
  const account = (await createResp.json()) as { id: string; name: string };

  // Account lifecycle: risk params → initialize (opening cash + activation in
  // one server-side transaction, A2).
  const riskResp = await page.request.put(`/api/accounts/${account.id}`, {
    data: { maxRiskPerTradePct: 2, defaultCommission: 1 },
  });
  if (!riskResp.ok()) console.log('[seed-risk-failed]', riskResp.status(), await riskResp.text());
  expect(riskResp.ok()).toBeTruthy();

  const initResp = await page.request.post(`/api/accounts/${account.id}/initialize`, {
    data: { mode: 'opening_balance', amount: '50000.00' },
  });
  if (!initResp.ok()) console.log('[seed-init-failed]', initResp.status(), await initResp.text());
  expect(initResp.ok()).toBeTruthy();

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

    // Compact analytical filter bar (CT7): the redundant visible form labels
    // are gone; every control keeps an explicit accessible name. No local
    // account selector exists — the sidebar AccountProvider is the sole
    // account owner (M007/D037), so the retired control must be absent.
    await expect(page.getByText('Accounts:', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Period:', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Unit:', { exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Performance accounts')).toHaveCount(0);
    await expect(page.locator('#perf-account-scope')).toHaveCount(0);
    await expect(page.getByLabel('Performance period')).toBeVisible();
    await expect(page.getByLabel('Performance filters')).toBeVisible();
    await expect(page.getByLabel('Performance unit')).toBeVisible();

    // KPI row and chart grid remain present.
    await expect(page.locator('section[aria-label="Performance KPI row"]')).toBeVisible();
    await expect(page.locator('section[aria-label="Performance charts"]')).toBeVisible();

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
// Proves that every global filter dimension (Period, Direction, Setup, Result,
// Symbol) pushes into the shared /api/performance/analytics query and that
// every analytical widget reacts to the SAME response — no per-widget
// independent fetching. Account scope is owned by the sidebar AccountProvider
// (M007/D037): the initial request is already forced to the default global
// account and no page-local account selector exists. Also proves unit toggles
// are client-side only and that no mixed-currency warning can surface under
// the USD-only, single-global-account model.
// ────────────────────────────────────────────────────────────────────────────

const PROP = Date.now().toString(36);

/**
 * Select an account through the sidebar global account selector (M007/D037).
 * The application-wide sidebar control is the sole account-selection owner for
 * /performance; Performance renders no account selector of its own. Matches
 * the anchored + listbox-scoped pattern used by the other e2e suites.
 */
async function selectGlobalAccount(page: Page, name: string) {
  await expect(page.getByTestId('sidebar-account-trigger')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('sidebar-account-trigger').click();
  await page
    .getByRole('listbox')
    .getByRole('option', { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) })
    .click();
}

/**
 * Seed two current-dated accounts for the global account-switch proof.
 *
 * Unlike the backdated propagation fixture (whose historical executedAt dates
 * hit the A2/A2.1 equity-at-open rejection when the opening balance is posted
 * at initialize-time), every trade here is executed WITHOUT an executedAt
 * override, so the fills land at the current timestamp and the canonical
 * equity projection is positive at execution time. 2 closed trades on A,
 * 1 on B → the analytics tradeCount distinguishes the two scopes.
 *
 * Account B is created FIRST so the default global account (newest first =
 * accounts[0] from GET /api/accounts desc(createdAt)) is account A.
 */
async function seedSwitchFixture(page: Page, tag = `SW${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`) {
  const accountB = await seedAccount(page, `SwitchB-${tag}`, 'USD');
  const accountA = await seedAccount(page, `SwitchA-${tag}`, 'USD');

  const closeTrade = async (accountId: string, symbol: string) => {
    const tr = await page.request.post('/api/trades', {
      data: { symbol, direction: 'long', accountId },
    });
    expect(tr.ok()).toBeTruthy();
    const trade = (await tr.json()) as { id: string };
    const exec = await page.request.post(`/api/trades/${trade.id}/execute`, {
      data: { entryPrice: 50, entryQuantity: 10, exit1Price: 55, exit1Quantity: 10, fees: 2 },
    });
    expect(exec.ok()).toBeTruthy();
  };

  await closeTrade(accountA.id, `SWA1${tag}`);
  await closeTrade(accountA.id, `SWA2${tag}`);
  await closeTrade(accountB.id, `SWB1${tag}`);
  return { accountA, accountB };
}

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
async function seedAccount(page: Page, name: string, currency: string, postedAt?: string, maxRiskPerTradePct = 2) {
  const createResp = await page.request.post('/api/accounts', {
    data: { name, currency },
  });
  expect(createResp.status()).toBe(201);
  const account = (await createResp.json()) as { id: string; name: string };

  const riskResp = await page.request.put(`/api/accounts/${account.id}`, {
    data: { maxRiskPerTradePct, defaultCommission: 1 },
  });
  expect(riskResp.ok()).toBeTruthy();

  // Canonical initialization. An optional backdated postedAt places the
  // opening balance strictly before an account's earliest historical fill so
  // the frozen A2 equity-at-open rule has canonical funding at that timestamp.
  const initData: Record<string, unknown> = { mode: 'opening_balance', amount: '50000.00' };
  if (postedAt) initData.postedAt = postedAt;
  const initResp = await page.request.post(`/api/accounts/${account.id}/initialize`, {
    data: initData,
  });
  expect(initResp.ok()).toBeTruthy();

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

/**
 * Persist a coherent account_rollforward row derived from the canonical state
 * the real execution engine just produced for a completed historical trade.
 *
 * The A2 resolver trusts `historical_rollforward` (bounded `date <= asOf`), so
 * a subsequent historical fill on the same account can be risk-checked against
 * the economically correct prior ending equity instead of failing closed. The
 * values are derived from the actual executions (signed cash flows + fees), the
 * prior ending equity and the running high-water mark — never an arbitrary
 * constant. Rows are inserted directly into the Playwright-owned disposable DB
 * (the same pattern the analytics unit test and the unit-toggle test use); the
 * product never writes these rows.
 */
function persistHistoricalRollforward(
  db: Database.Database,
  accountId: string,
  executedAt: string,
  prevEndingEquity: number,
  prevHighWaterMark: number,
  executions: Array<{ action: string; quantity: number; price: number; fees: number | null }>,
): number {
  let cashFlow = 0;
  let totalFees = 0;
  for (const x of executions) {
    const amount = x.quantity * x.price;
    cashFlow += x.action === 'buy' || x.action === 'buy_to_cover' ? -amount : amount;
    totalFees += x.fees ?? 0;
  }
  const realizedGross = cashFlow;
  const endingEquity = prevEndingEquity + realizedGross - totalFees;
  const highWaterMark = Math.max(prevHighWaterMark, endingEquity);
  const drawdownAmount = Math.max(0, highWaterMark - endingEquity);
  const drawdownPct = highWaterMark > 0 ? drawdownAmount / highWaterMark : 0;
  const ts = new Date().toISOString();
  db.prepare(
    `INSERT INTO account_rollforward
       (id, account_id, date, beginning_equity, deposits_withdrawals, realized_gross_pnl, fees,
        ending_equity, cumulative_pnl, high_water_mark, drawdown_amount, drawdown_pct, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    crypto.randomUUID(),
    accountId,
    executedAt.slice(0, 10),
    prevEndingEquity,
    realizedGross,
    totalFees,
    endingEquity,
    endingEquity - 50000,
    highWaterMark,
    drawdownAmount,
    drawdownPct,
    ts,
    ts,
  );
  return endingEquity;
}

/**
 * Create + fully exit a HISTORICAL trade and persist the coherent rollforward
 * row required for the next historical fill on the same account. Executions
 * must be issued in chronological order per account.
 */
async function seedHistoricalTrade(
  page: Page,
  db: Database.Database,
  accountId: string,
  spec: SeededTradeSpec,
  prevEndingEquity: number,
  prevHighWaterMark: number,
): Promise<number> {
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
  expect(execResp.ok(), `historical fill ${spec.symbol} @ ${spec.executedAt} should succeed`).toBeTruthy();
  const body = await execResp.json();
  return persistHistoricalRollforward(db, accountId, spec.executedAt, prevEndingEquity, prevHighWaterMark, body.executions);
}

/**
 * Seed the deterministic multi-dimension fixture used by the propagation test.
 *
 * Trade matrix (net P&L per trade, R = net / initialRisk):
 *  T1  A  long  alpha  win   2026-03-15  +95  1.90R
 *  T2  A  short alpha  loss  2026-04-20  -55  -0.55R
 *  T3  A  long  beta   win   PREV-11-10  +190 1.90R  (outside YTD)
 *  T4  B  long  alpha  loss  2026-05-05  -55  -2.20R  (account B / USD)
 *  T5  A  long  beta   loss  2026-06-10  -55  -2.75R
 *  T6  A  long  alpha  loss  2026-07-01  -55  -2.75R
 *
 * Every drive in the sequence (Whole→YTD, All→Long, All→alpha, All→Winner)
 * changes the trade set {6,5,4,3,2,1} under the global account-A scope, so
 * each changes at least one KPI and the monthly chart slice.
 *
 * Account B is created FIRST so the default global account (newest first =
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
  // Both accounts open BEFORE their earliest historical fill (account A's
  // earliest is T3 at prev-11-10, account B's is T4 at y-05-05) so A2 has
  // canonical funding at every backdated execution timestamp.
  const accountB = await seedAccount(page, `PropB-${tag}`, 'USD', `${prev}-01-01T00:00:00.000Z`);
  const accountA = await seedAccount(page, `PropA-${tag}`, 'USD', `${prev}-01-01T00:00:00.000Z`);

  const trades: SeededTradeSpec[] = [
    { account: 'A', symbol: 'AAAA', direction: 'long', setup: alphaName, entryPrice: 100, entryQuantity: 10, exitPrice: 110, exitQuantity: 10, stopPrice: 95, fees: 5, executedAt: `${y}-03-15T15:00:00.000Z` },
    { account: 'A', symbol: 'BBBB', direction: 'short', setup: alphaName, entryPrice: 100, entryQuantity: 10, exitPrice: 105, exitQuantity: 10, stopPrice: 110, fees: 5, executedAt: `${y}-04-20T15:00:00.000Z` },
    { account: 'A', symbol: 'CCCC', direction: 'long', setup: betaName, entryPrice: 50, entryQuantity: 20, exitPrice: 60, exitQuantity: 20, stopPrice: 45, fees: 10, executedAt: `${prev}-11-10T15:00:00.000Z` },
    { account: 'B', symbol: 'AAAA', direction: 'long', setup: alphaName, entryPrice: 200, entryQuantity: 5, exitPrice: 190, exitQuantity: 5, stopPrice: 195, fees: 5, executedAt: `${y}-05-05T15:00:00.000Z` },
    { account: 'A', symbol: 'DDDD', direction: 'long', setup: betaName, entryPrice: 80, entryQuantity: 10, exitPrice: 75, exitQuantity: 10, stopPrice: 78, fees: 5, executedAt: `${y}-06-10T15:00:00.000Z` },
    { account: 'A', symbol: 'EEEE', direction: 'long', setup: alphaName, entryPrice: 60, entryQuantity: 10, exitPrice: 55, exitQuantity: 10, stopPrice: 58, fees: 5, executedAt: `${y}-07-01T15:00:00.000Z` },
  ];

  // Execute each account's fills in CHRONOLOGICAL order (the array above is not
  // chronological) and persist the coherent rollforward row after each one, so
  // every historical fill has a trusted A2 equity source at its timestamp. The
  // trade data — symbols, setups, directions, prices, quantities, stops, fees,
  // account assignment and executedAt — is preserved exactly.
  const db = new Database(process.env.DB_FILE_NAME as string);
  try {
    const equity: Record<'A' | 'B', number> = { A: 50000, B: 50000 };
    const highWaterMark: Record<'A' | 'B', number> = { A: 50000, B: 50000 };
    for (const t of [...trades].sort((a, b) => a.executedAt.localeCompare(b.executedAt))) {
      const accountId = t.account === 'A' ? accountA.id : accountB.id;
      equity[t.account] = await seedHistoricalTrade(page, db, accountId, t, equity[t.account], highWaterMark[t.account]);
      highWaterMark[t.account] = Math.max(highWaterMark[t.account], equity[t.account]);
    }
  } finally {
    db.close();
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

    // ── 1. Account scope: the sidebar global account is the sole owner ──
    // The default global account (newest active, desc createdAt) is account
    // A, so the initial analytics request is already scoped to it — there is
    // no page-local selector to drive (M007/D037) and never accountScope=all.
    const firstUrl = analytics.analyticsRequests[0];
    expect(firstUrl).toContain(`accountScope=single&accountIds=${accountA.id}`);
    expect(firstUrl).not.toContain('accountScope=all');

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

  test('no mixed-currency warning surfaces under the global USD account model', async ({ page }) => {
    const analytics = observeAnalytics(page);
    // USD-only contract (A1): the API rejects non-USD creation, so every
    // account is USD and the mixed-currency warning must never appear.
    const mixB = await seedAccount(page, `MixB-${PROP}`, 'USD');
    const mixA = await seedAccount(page, `MixA-${PROP}`, 'USD');
    await gotoPerformance(page);
    await waitForInitialAnalytics(page, analytics);

    // The retired Performance-local multi-account mode is gone (M007/D037):
    // no page-local account selector, no single/multi pickers, and no
    // mixed-currency warning anywhere under the single-global-account model.
    await expect(page.getByLabel('Performance accounts')).toHaveCount(0);
    await expect(page.locator('#perf-account-scope')).toHaveCount(0);
    await expect(page.getByTestId('account-single-select')).toHaveCount(0);
    await expect(page.getByTestId('account-multi-select')).toHaveCount(0);
    await expect(page.getByTestId('mixed-currency-warning')).toHaveCount(0);

    // Switching globally between the two USD accounts (real sidebar control)
    // keeps the warning absent on the single-account analytical scope.
    for (const account of [mixB, mixA]) {
      await selectGlobalAccount(page, account.name);
      await expect(page.getByTestId('mixed-currency-warning')).toHaveCount(0);
    }
  });
});

test.describe('global account scope (M007/D037)', () => {
  test('sidebar account switch A → B drives a scoped Performance refetch without a reload', async ({ page }) => {
    const analytics = observeAnalytics(page);
    const { accountA, accountB } = await seedSwitchFixture(page);
    await gotoPerformance(page);
    await waitForInitialAnalytics(page, analytics);

    // The initial request is already scoped to the default global account
    // (the newest active account = A) — never accountScope=all.
    const initialUrl = analytics.analyticsRequests[0];
    expect(initialUrl).toContain(`accountScope=single&accountIds=${accountA.id}`);
    expect(initialUrl).not.toContain('accountScope=all');
    const initialBody = analytics.lastBody();
    expect(initialBody?.metadata?.accountCount).toBe(1);
    expect(initialBody?.metadata?.tradeCount).toBe(2);

    // Switch the application-wide (sidebar) account to B.
    const beforeResponses = analytics.analyticsResponses.length;
    await selectGlobalAccount(page, accountB.name);

    // A new analytics request fires scoped to B — no page reload required.
    await expect.poll(() => analytics.analyticsResponses.length).toBeGreaterThan(beforeResponses);
    const lastUrl = analytics.analyticsRequests[analytics.analyticsRequests.length - 1];
    expect(lastUrl).toContain(`accountScope=single&accountIds=${accountB.id}`);
    expect(lastUrl).not.toContain('accountScope=all');

    // No request in the session ever broadens to All Accounts.
    expect(analytics.analyticsRequests.every((u) => !u.includes('accountScope=all'))).toBeTruthy();

    // Performance reflects the newly selected account (B's single trade)
    // while staying on /performance.
    await expect(page).toHaveURL(/\/performance$/);
    await expect.poll(() => analytics.lastBody()?.metadata?.tradeCount).toBe(1);
    await expect(page.getByTestId('sidebar-account-trigger')).toContainText(accountB.name);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// S03 (R003): KPI rail equal geometry + reorder persistence
//
// Proves at 1440px that the five curated default KPI cards share one row with
// equal geometry (same top/bottom edges, height delta ≤ 2px, each inside the
// 124-132px window, Corrective Task 1) and that microvisualizations stay inside
// the card bounds without changing card height. Then proves the customize
// persistence contract:
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

    // Microviz slots require analytics data: sparkline (Net P&L), donut (Win Rate),
    // split bar (Profit Factor), split bar (Payoff Ratio). Average R stays value-first.
    await expect(page.locator('[data-kpi-microviz-slot]')).toHaveCount(4, { timeout: 60_000 });

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

    // Every card sits inside the 124-132px window (Corrective Task 1 geometry).
    for (const h of heights) {
      expect(h).toBeGreaterThanOrEqual(124);
      expect(h).toBeLessThanOrEqual(132);
    }
    // Shared top and bottom edges (delta ≤ 1px guards subpixel rounding).
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(1);
    expect(Math.max(...bottoms) - Math.min(...bottoms)).toBeLessThanOrEqual(1);
    // Equal heights across all five cards: delta ≤ 2px.
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(2);

    // Microviz does not change card height: a card WITH a slot (net-pnl) has the
    // same height as a card WITHOUT (average-r is value-first).
    const withViz = geometry.find((g) => g.id === 'net-pnl');
    const withoutViz = geometry.find((g) => g.id === 'average-r');
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
    expect(containment).toHaveLength(4);
    expect(containment.every((inside) => inside)).toBe(true);
  });
});

test.describe('KPI reorder persistence (S03 R003)', () => {
  test('direct drag reorder → Save → reload restores order; dashboards keep independent orders', async ({ page }) => {
    page.on('dialog', (dialog) => dialog.accept());

    await seedPropagationFixture(page);
    await page.addInitScript(() => localStorage.setItem('theme', 'dark'));
    await gotoPerformance(page);
    await waitForAnalytics(page);
    // Let the mount-time API hydrate settle: its GET /api/dashboard/views
    // response REPLACES the dashboards state, so any create/save racing it
    // would be dropped and the active dashboard fall back to the system
    // default (documented persistence gotcha). Network-idle guarantees the
    // hydrate response has landed before the dashboard work starts.
    await page.waitForLoadState('networkidle');

    // CT6 evidence: the normal KPI rail at 1440 dark (approved presentation,
    // no drag affordance).
    await page.screenshot({ path: '/tmp/ct6-kpi-normal-1440-dark.png' });

    const dashA = `Reorder A ${TS}`;
    const dashB = `Reorder B ${TS}`;

    /** Create a user dashboard (system default is immutable for persistence).
     *  `currentName` is the switcher's active dashboard before opening it. */
    async function createDashboard(name: string, currentName: string) {
      await page.locator('button', { hasText: currentName }).click();
      await page.getByText('+ New Dashboard').click();
      await page.getByPlaceholder('Dashboard name').fill(name);
      const createResp = page.waitForResponse(
        (resp) => resp.url().includes('/api/dashboard/views') && resp.request().method() === 'POST',
      );
      await page.getByRole('button', { name: 'OK', exact: true }).click();
      await createResp;
      await expect(page.locator('button', { hasText: name })).toBeVisible();
    }

    /** Real pointer drag: grab the source card's drag handle and drop it onto
     *  the target card's center. Not an arrow-click emulation. */
    async function dragKpi(from: string, to: string) {
      const handle = page.locator(`[data-kpi-card="${from}"] [data-kpi-drag-handle]`);
      await expect(handle).toBeVisible();
      const handleBox = (await handle.boundingBox())!;
      const targetBox = (await page.locator(`[data-kpi-card="${to}"]`).boundingBox())!;
      await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, {
        steps: 30,
      });
      await page.mouse.up();
      // dnd-kit suppresses the click event for ~50ms after a drag ends (to
      // avoid accidental activation of the drop target); wait it out so the
      // subsequent Done/Save clicks are never swallowed.
      await page.waitForTimeout(200);
      await expect.poll(() => readKpiOrder(page)).not.toEqual(KPI_IDS);
    }

    /** Save the current Customize state and wait for the server write. */
    async function saveCustomize() {
      const saveResp = page.waitForResponse(
        (resp) => resp.url().includes('/api/dashboard/views') && resp.request().method() === 'POST',
      );
      await page.getByRole('button', { name: 'Save' }).click();
      await saveResp;
    }

    // ── Dashboard A: drag Payoff Ratio between Net P&L and Win Rate ──────
    await createDashboard(dashA, 'Performance Default');
    await page.getByRole('button', { name: 'Customize' }).click();
    await expect(page.getByRole('button', { name: 'Done' })).toBeVisible();
    await expect(page.locator('[data-kpi-card]')).toHaveCount(5);
    expect(await readKpiOrder(page)).toEqual(KPI_IDS);
    // CT6 evidence: Customize mode shows the explicit grip drag handles.
    await expect(page.locator('[data-kpi-drag-handle]')).toHaveCount(5);
    await page.screenshot({ path: '/tmp/ct6-kpi-customize-1440-dark.png' });

    // Actual drag: Payoff Ratio (last) onto Win Rate → lands at index 1:
    // [net-pnl, payoff-ratio, win-rate, profit-factor, average-r]
    await dragKpi('payoff-ratio', 'win-rate');
    await expect.poll(() => readKpiOrder(page)).toEqual([
      'net-pnl', 'payoff-ratio', 'win-rate', 'profit-factor', 'average-r',
    ]);
    // CT6 evidence: the reordered rail (Payoff Ratio now second).
    await page.screenshot({ path: '/tmp/ct6-kpi-reordered-1440-dark.png' });

    // Normal mode: drag affordance disappears; direct drag no longer reorders.
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.locator('[data-kpi-drag-handle]')).toHaveCount(0);
    await expect(page.locator('[aria-label^="Actions for"]')).toHaveCount(0);
    const normalOrder = await readKpiOrder(page);
    // No handles + the pointer sensor is disabled in normal mode: a drag
    // gesture across the rail cannot move a card.
    const firstBox = (await page.locator('[data-kpi-card]').first().boundingBox())!;
    const lastBox = (await page.locator('[data-kpi-card]').last().boundingBox())!;
    await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(lastBox.x + lastBox.width / 2, lastBox.y + lastBox.height / 2, { steps: 20 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    expect(await readKpiOrder(page)).toEqual(normalOrder);

    // Back to Customize and Save → reload restores the dragged order.
    await page.getByRole('button', { name: 'Customize' }).click();
    await saveCustomize();
    await page.reload();
    await expect(page.getByRole('button', { name: /Customize/ })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('button', { hasText: dashA })).toBeVisible();
    await expect(page.locator('[data-kpi-card]')).toHaveCount(5, { timeout: 15_000 });
    await expect.poll(() => readKpiOrder(page)).toEqual([
      'net-pnl', 'payoff-ratio', 'win-rate', 'profit-factor', 'average-r',
    ]);

    // ── Dashboard B: a different order — must stay isolated from A ───────
    // (The reload above reset edit mode; re-enter Customize before creating B
    // so the subsequent drag has handles. Save does not exit edit mode.)
    await page.getByRole('button', { name: 'Customize' }).click();
    await createDashboard(dashB, dashA);
    await expect(page.locator('[data-kpi-card]')).toHaveCount(5);
    // A new dashboard snapshots the current instance composition (the same
    // model as Duplicate), so B starts from A's dragged order — then a second
    // drag gives B its OWN distinct order, which is the isolation claim.
    await dragKpi('average-r', 'net-pnl');
    await expect.poll(() => readKpiOrder(page)).toEqual([
      'average-r', 'net-pnl', 'payoff-ratio', 'win-rate', 'profit-factor',
    ]);
    await saveCustomize();

    // Leave Customize before dashboard switching (Save keeps edit mode on).
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.locator('[data-kpi-drag-handle]')).toHaveCount(0);

    // Switch A → B → A: each dashboard restores its own KPI order.
    await page.locator('button', { hasText: dashB }).click();
    await page.getByRole('option', { name: dashA }).click();
    await expect(page.locator('button', { hasText: dashA })).toBeVisible();
    await expect.poll(() => readKpiOrder(page)).toEqual([
      'net-pnl', 'payoff-ratio', 'win-rate', 'profit-factor', 'average-r',
    ]);

    await page.locator('button', { hasText: dashA }).click();
    await page.getByRole('option', { name: dashB }).click();
    await expect(page.locator('button', { hasText: dashB })).toBeVisible();
    await expect.poll(() => readKpiOrder(page)).toEqual([
      'average-r', 'net-pnl', 'payoff-ratio', 'win-rate', 'profit-factor',
    ]);

    // ── Accessibility path still works inside Customize (menu Move right) ─
    await page.getByRole('button', { name: 'Customize' }).click();
    await page.getByRole('button', { name: 'Actions for Average R', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Move right' }).click();
    await expect.poll(() => readKpiOrder(page)).toEqual([
      'net-pnl', 'average-r', 'payoff-ratio', 'win-rate', 'profit-factor',
    ]);
    await page.getByRole('button', { name: 'Done' }).click();

    // Cleanup: delete both user dashboards (confirm dialogs auto-accepted).
    // Deleting the active dashboard returns the switcher to the system default.
    await page.locator('button', { hasText: dashB }).click();
    await page.getByRole('button', { name: /Delete/ }).click();
    await expect(page.locator('button', { hasText: 'Performance Default' })).toBeVisible();
    await page.locator('button', { hasText: 'Performance Default' }).click();
    await page.getByRole('option', { name: dashA }).click();
    await page.locator('button', { hasText: dashA }).click();
    await page.getByRole('button', { name: /Delete/ }).click();
    await expect(page.locator('button', { hasText: 'Performance Default' })).toBeVisible();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// S04 (R004): dense responsive chart grid + drag/resize persistence
//
// Proves at 1440px that the six default-visible analytical charts form the
// dense R004 composition (three per row, no full-width stacking, no horizontal
// document overflow), that the first analytical row keeps 2-3 charts at
// 1280px and 1024px, and that Customize-mode drag and resize genuinely
// interact AND persist through Save → reload on a user-owned dashboard (the
// immutable system default skips server-side persistence, so the round-trip
// is proven on a user dashboard exactly like the S03 KPI reorder test).
// ────────────────────────────────────────────────────────────────────────────

interface ChartBox {
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Locate a chart widget's RGL grid item by its rendered title text. */
function chartItem(page: Page, title: string) {
  return page.locator('section[aria-label="Performance charts"] .react-grid-item').filter({ hasText: title });
}

/** Wait until every default chart widget has mounted inside the RGL grid. */
async function waitForChartGrid(page: Page) {
  for (const title of CHART_TITLES) {
    await expect(page.getByText(title, { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  }
}

/** Read the six chart grid-item bounding boxes keyed by title. */
async function readChartBoxes(page: Page): Promise<ChartBox[]> {
  const boxes: ChartBox[] = [];
  for (const title of CHART_TITLES) {
    const box = await chartItem(page, title).boundingBox();
    if (!box) throw new Error(`No bounding box for chart "${title}"`);
    boxes.push({ title, x: box.x, y: box.y, width: box.width, height: box.height });
  }
  return boxes;
}

/** Charts sharing the first analytical row: tops within 1px of the minimum. */
function firstAnalyticalRow(boxes: ChartBox[]): ChartBox[] {
  const minTop = Math.min(...boxes.map((b) => b.y));
  return boxes.filter((b) => Math.abs(b.y - minTop) <= 1);
}

/** Horizontal document overflow in px (≤ 1 tolerates subpixel rounding). */
function docOverflowX(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/** Grid pixel width (RGL container), used to prove w:4 = ~1/3, never full-width. */
function chartGridWidth(page: Page): Promise<number> {
  return page
    .locator('section[aria-label="Performance charts"] .react-grid-layout')
    .evaluate((el) => el.clientWidth);
}

/** Create a user dashboard (system default is immutable → server persistence). */
async function createUserDashboard(page: Page, name: string) {
  await page.locator('button', { hasText: 'Performance Default' }).click();
  await page.getByText('+ New Dashboard').click();
  await page.getByPlaceholder('Dashboard name').fill(name);
  const createResp = page.waitForResponse(
    (resp) => resp.url().includes('/api/dashboard/views') && resp.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await createResp;
  await expect(page.locator('button', { hasText: name })).toBeVisible();
}

/** Click Save, wait for the server write, then reload and wait for the shell. */
async function saveAndReload(page: Page) {
  const saveResp = page.waitForResponse(
    (resp) => resp.url().includes('/api/dashboard/views') && resp.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Save' }).click();
  await saveResp;
  await page.reload();
  await expect(page.getByRole('button', { name: /Customize/ })).toBeVisible({ timeout: 15_000 });
}

/** Delete the user dashboard via the switcher (confirm dialog auto-accepted). */
async function deleteUserDashboard(page: Page, name: string) {
  await page.locator('button', { hasText: name }).click();
  await page.getByRole('button', { name: /Delete/ }).click();
  await expect(page.locator('button', { hasText: 'Performance Default' })).toBeVisible();
}

test.describe('dense chart grid (S04 R004)', () => {
  test.describe('at 1440px', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('three charts share the first analytical row with no full-width stacking or horizontal overflow', async ({ page }) => {
      await gotoPerformance(page);
      await waitForChartGrid(page);

      const boxes = await readChartBoxes(page);
      expect(boxes).toHaveLength(6);

      // Uniform h:5 geometry across the six default charts (equal row heights).
      const heights = boxes.map((b) => b.height);
      expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(2);

      // Dense R004 composition: row 1 = Cumulative / NetDaily / TradeDuration.
      const row1 = firstAnalyticalRow(boxes);
      expect(row1).toHaveLength(3);
      expect([...row1.map((b) => b.title)].sort()).toEqual(
        ['Daily Cumulative P&L', 'Net Daily P&L', 'Trade Duration Performance'].sort(),
      );

      // Row 2 holds the remaining three at the next row edge (also 3 per row).
      const row1Titles = new Set(row1.map((b) => b.title));
      const row2Top = Math.min(...boxes.filter((b) => !row1Titles.has(b.title)).map((b) => b.y));
      const row2 = boxes.filter((b) => Math.abs(b.y - row2Top) <= 1);
      expect(row2).toHaveLength(3);

      // w:4 cells ≈ 1/3 of the grid — prove none is full- or half-width stacked.
      const gridWidth = await chartGridWidth(page);
      for (const b of boxes) {
        expect(b.width / gridWidth).toBeGreaterThan(0.28);
        expect(b.width / gridWidth).toBeLessThan(0.45);
      }

      // No horizontal document overflow (R004 must-have).
      expect(await docOverflowX(page)).toBeLessThanOrEqual(1);
    });
  });

  test.describe('responsive first row at 1280px and 1024px', () => {
    for (const vp of [
      { width: 1280, height: 900 },
      { width: 1024, height: 900 },
    ]) {
      test(`at ${vp.width}px the first analytical row holds 2-3 charts with no overflow`, async ({ page }) => {
        await page.setViewportSize(vp);
        await gotoPerformance(page);
        await waitForChartGrid(page);

        const boxes = await readChartBoxes(page);
        const row1 = firstAnalyticalRow(boxes);
        expect(row1.length).toBeGreaterThanOrEqual(2); // never a lone chart unless forced
        expect(row1.length).toBeLessThanOrEqual(3); // dense ceiling

        const gridWidth = await chartGridWidth(page);
        for (const b of boxes) {
          expect(b.width / gridWidth).toBeLessThan(0.45); // no full-width stacking
        }
        expect(await docOverflowX(page)).toBeLessThanOrEqual(1);
      });
    }
  });
});

test.describe('chart drag/resize persistence (S04 R004)', () => {
  // Tall viewport so the whole chart grid (including row-2 resize grips) is
  // on screen for real mouse interaction.
  test.use({ viewport: { width: 1440, height: 1000 } });

  /** Grid-unit column/row of a chart item — immune to container-width pixel drift. */
  async function chartSlot(page: Page, title: string): Promise<{ col: number; row: number }> {
    const grid = page.locator('section[aria-label="Performance charts"] .react-grid-layout');
    const gridBox = await grid.boundingBox();
    const box = await chartItem(page, title).boundingBox();
    if (!gridBox || !box) throw new Error(`missing boxes for ${title}`);
    const gridWidth = await grid.evaluate((el) => el.clientWidth);
    const colWidth = (gridWidth - 110) / 12; // margin[0] × 11
    return {
      col: Math.round((box.x - gridBox.x - 10) / (colWidth + 10)),
      row: Math.round((box.y - gridBox.y - 10) / 50), // rowHeight 40 + margin 10
    };
  }

  test('Customize drag → Save → reload restores the dragged chart position', async ({ page }) => {
    page.on('dialog', (dialog) => dialog.accept());
    const dashName = `S04 Drag ${TS}`;

    await gotoPerformance(page);
    await waitForChartGrid(page);
    await createUserDashboard(page, dashName);

    // Enter Customize: every chart gains a drag handle (6 widgets).
    await page.getByRole('button', { name: 'Customize' }).click();
    await expect(page.getByRole('button', { name: 'Done' })).toBeVisible();
    await expect(page.locator('section[aria-label="Performance charts"] .drag-handle')).toHaveCount(6);

    const rdist = chartItem(page, 'R-Multiple Distribution');
    const netDaily = chartItem(page, 'Net Daily P&L');

    // Baseline: R-Multiple Distribution sits BELOW Net Daily P&L (row 2 vs row 1).
    const beforeRDist = await rdist.boundingBox();
    const beforeNetDaily = await netDaily.boundingBox();
    if (!beforeRDist || !beforeNetDaily) throw new Error('missing baseline chart boxes');
    expect(beforeRDist.y).toBeGreaterThan(beforeNetDaily.y + 100);

    // Drag R-Multiple Distribution's handle up 250px (5 rows × 50px): it swaps
    // into row 1 and Net Daily P&L is pushed down to row 2 (order-stable
    // vertical compaction makes the swap persist). Grab the strip's left edge,
    // clear of the duplicate/remove buttons on the right.
    const handle = rdist.locator('.drag-handle');
    await handle.scrollIntoViewIfNeeded();
    const hb = await handle.boundingBox();
    if (!hb) throw new Error('missing drag handle box');
    const grabX = hb.x + 20;
    const grabY = hb.y + hb.height / 2;
    await page.mouse.move(grabX, grabY);
    await page.mouse.down();
    await page.mouse.move(grabX, grabY - 250, { steps: 12 });
    await page.mouse.up();

    // The swap commits on drop; wait out the 200ms grid transition, then read.
    await expect.poll(async () => {
      const r = await rdist.boundingBox();
      const n = await netDaily.boundingBox();
      return r && n ? r.y - n.y : 0;
    }).toBeLessThan(-100);

    const afterRDist = await rdist.boundingBox();
    const afterNetDaily = await netDaily.boundingBox();
    if (!afterRDist || !afterNetDaily) throw new Error('missing post-drag chart boxes');
    expect(afterRDist.y).toBeLessThan(afterNetDaily.y - 100); // swap completed
    const afterSlot = await chartSlot(page, 'R-Multiple Distribution');
    expect(afterSlot).toEqual({ col: 4, row: 0 }); // row 1 middle — the swapped slot (RGL packs y10 → row 0)

    // Save → reload → re-enter Customize so grid y-offsets match the pre-save
    // edit session, then assert the dragged geometry is restored. Grid-unit
    // slots are compared exactly (pixel-independent); pixel x may drift by
    // sub-column amounts when the container width changes by a scrollbar, so
    // it uses a colWidth-aware tolerance that still distinguishes columns.
    await saveAndReload(page);
    await expect(page.locator('button', { hasText: dashName })).toBeVisible();
    await waitForChartGrid(page);
    await page.getByRole('button', { name: 'Customize' }).click();
    await expect(page.getByRole('button', { name: 'Done' })).toBeVisible();

    await expect.poll(async () => {
      const r = await rdist.boundingBox();
      const n = await netDaily.boundingBox();
      return r && n ? r.y - n.y : 0;
    }).toBeLessThan(-100);

    const restoredR = await rdist.boundingBox();
    const restoredN = await netDaily.boundingBox();
    if (!restoredR || !restoredN) throw new Error('missing restored chart boxes');
    // Same grid slot after reload (geometry restored).
    expect(await chartSlot(page, 'R-Multiple Distribution')).toEqual(afterSlot);
    // Pixel positions restored within colWidth-aware tolerance.
    const gridWidth = await chartGridWidth(page);
    const colWidth = (gridWidth - 110) / 12;
    expect(Math.abs(restoredR.x - afterRDist.x)).toBeLessThanOrEqual(colWidth * 0.35);
    expect(Math.abs(restoredR.y - afterRDist.y)).toBeLessThanOrEqual(3);
    // And still different from the pre-drag baseline (moved up / pushed down).
    expect(restoredR.y).toBeLessThan(beforeRDist.y - 100);
    expect(restoredN.y).toBeGreaterThan(beforeNetDaily.y + 100);

    // Cleanup: exit edit mode, delete the user dashboard.
    await page.getByRole('button', { name: 'Done' }).click();
    await deleteUserDashboard(page, dashName);
  });

  test('Customize resize → Save → reload restores the resized chart geometry', async ({ page }) => {
    page.on('dialog', (dialog) => dialog.accept());
    const dashName = `S04 Resize ${TS}`;

    await gotoPerformance(page);
    await waitForChartGrid(page);
    await createUserDashboard(page, dashName);

    await page.getByRole('button', { name: 'Customize' }).click();
    await expect(page.getByRole('button', { name: 'Done' })).toBeVisible();

    const drawdown = chartItem(page, 'Drawdown Curve');
    const before = await drawdown.boundingBox();
    if (!before) throw new Error('missing baseline box');

    // Resize via the SE grip: drag straight down 150px → h grows 5 → 8 rows
    // (Drawdown is row-2 col-1 with nothing below, so the growth overlaps no
    // neighbor; maxH 8 is the registry ceiling and is not exceeded).
    const grip = drawdown.locator('[aria-label="Resize widget"]');
    await expect(grip).toBeVisible();
    await grip.scrollIntoViewIfNeeded();
    const gb = await grip.boundingBox();
    if (!gb) throw new Error('missing resize grip box');
    const gripX = gb.x + gb.width / 2;
    const gripY = gb.y + gb.height / 2;
    await page.mouse.move(gripX, gripY);
    await page.mouse.down();
    await page.mouse.move(gripX, gripY + 150, { steps: 10 });
    await page.mouse.up();

    // Height grows by ~150px (3 rows); width stays put (pure SE downward drag).
    await expect
      .poll(async () => (await drawdown.boundingBox())?.height ?? -1)
      .toBeGreaterThan(before.height + 80);
    const after = await drawdown.boundingBox();
    if (!after) throw new Error('missing post-resize box');
    expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(3);
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(3);
    expect(after.height).toBeGreaterThan(before.height + 80);

    // Save → reload → re-enter Customize so grid y-offsets match the pre-save
    // edit session, then assert the resized geometry is restored. Height/width
    // are mode-independent and compared tightly; the widget must also stay in
    // its original grid column and row.
    await saveAndReload(page);
    await expect(page.locator('button', { hasText: dashName })).toBeVisible();
    await waitForChartGrid(page);
    await page.getByRole('button', { name: 'Customize' }).click();
    await expect(page.getByRole('button', { name: 'Done' })).toBeVisible();

    await expect
      .poll(async () => (await drawdown.boundingBox())?.height ?? -1)
      .toBeGreaterThan(before.height + 80);
    const restored = await drawdown.boundingBox();
    if (!restored) throw new Error('missing restored box');
    expect(Math.abs(restored.height - after.height)).toBeLessThanOrEqual(3);
    expect(Math.abs(restored.x - after.x)).toBeLessThanOrEqual(3);
    expect(Math.abs(restored.y - after.y)).toBeLessThanOrEqual(3);
    expect(await chartSlot(page, 'Drawdown Curve')).toEqual({ col: 0, row: 5 });

    // Cleanup: exit edit mode, delete the user dashboard.
    await page.getByRole('button', { name: 'Done' }).click();
    await deleteUserDashboard(page, dashName);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// S05 (R005): consistent widget actions menu (⋯)
//
// Proves the R005 contract end-to-end:
// 1. In Customize mode every configurable widget (5 KPI cards + 6 default
//    charts) shows ONE consistent ⋯ actions menu with Configure / Duplicate /
//    Remove (destructive) / Reset; the chart drag-handle bar keeps its grip +
//    'Drag to move' label with the +/× controls gone from the bar; normal mode
//    shows zero triggers, drag handles, resize grips, or edit frames.
// 2. Configure opens the shared typed ConfigureDialog (chart series
//    visibility + title override; KPI metric + unit that follows the metric)
//    and the changes persist through the saved-dashboard Save → reload flow on
//    a user dashboard (the immutable system default skips server persistence).
// 3. Duplicate creates a second widget; Remove deletes one; Reset restores
//    the widget's registry default config.
// ────────────────────────────────────────────────────────────────────────────

/** Read the persisted instance config for one widget type from localStorage. */
async function readStoredInstanceConfig(page: Page, category: 'kpi' | 'chart', widgetType: string) {
  return page.evaluate(
    ({ key, type }: { key: string; type: string }) => {
      const raw = window.localStorage.getItem(key);
      if (!raw) return null;
      const instances = JSON.parse(raw) as Array<{ widgetType: string; config: Record<string, unknown> }>;
      return instances.find((i) => i.widgetType === type)?.config ?? null;
    },
    { key: `performance:${category}-instances:v1`, type: widgetType },
  );
}

/** Assert the open ⋯ menu offers the full R005 item set (Remove destructive). */
async function expectActionsMenuItems(page: Page) {
  await expect(page.getByRole('menuitem', { name: 'Configure' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Duplicate' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Remove' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Remove' })).toHaveAttribute('data-variant', 'destructive');
  await expect(page.getByRole('menuitem', { name: 'Reset' })).toBeVisible();
}

test.describe('widget actions menu (S05 R005)', () => {
  test('Customize shows one ⋯ actions menu per widget; normal mode stays clean', async ({ page }) => {
    await gotoPerformance(page);

    const actionsTrigger = page.locator('[aria-label^="Actions for"]');
    const dragHandles = page.locator('section[aria-label="Performance charts"] .drag-handle');
    const resizeGrips = page.locator('[aria-label="Resize widget"]');
    const editFrames = page.locator('.chart-edit-frame');

    // Normal mode: zero editing chrome — no ⋯ triggers, drag handles, resize
    // grips, or edit frames anywhere on the dashboard.
    await expect(actionsTrigger).toHaveCount(0);
    await expect(dragHandles).toHaveCount(0);
    await expect(resizeGrips).toHaveCount(0);
    await expect(editFrames).toHaveCount(0);

    // Enter Customize: every widget gains the ⋯ menu (5 KPI + 6 charts = 11),
    // and every chart gains a drag handle, resize grip, and edit frame (6).
    await page.getByRole('button', { name: 'Customize' }).click();
    await expect(page.getByRole('button', { name: 'Done' })).toBeVisible();
    await expect(actionsTrigger).toHaveCount(11);
    await expect(dragHandles).toHaveCount(6);
    await expect(resizeGrips).toHaveCount(6);
    await expect(editFrames).toHaveCount(6);

    // The chart drag-handle bar keeps its grip + 'Drag to move' label; the +/×
    // controls are gone — the only control left is the ⋯ actions menu.
    const handleBar = dragHandles.first();
    await expect(handleBar.getByText('Drag to move')).toBeVisible();
    await expect(handleBar.getByRole('button', { name: /Actions for/ })).toBeVisible();
    await expect(handleBar.getByText('+', { exact: true })).toHaveCount(0);
    await expect(handleBar.getByText('×', { exact: true })).toHaveCount(0);

    // A chart widget's menu offers the full R005 item set.
    await page.getByRole('button', { name: 'Actions for Daily Cumulative P&L', exact: true }).click();
    await expectActionsMenuItems(page);
    await page.keyboard.press('Escape');

    // A KPI card's menu offers the same item set.
    await page.getByRole('button', { name: 'Actions for Net P&L', exact: true }).click();
    await expectActionsMenuItems(page);
    await page.keyboard.press('Escape');

    // Done restores the chrome-free normal mode.
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(actionsTrigger).toHaveCount(0);
    await expect(dragHandles).toHaveCount(0);
    await expect(resizeGrips).toHaveCount(0);
    await expect(editFrames).toHaveCount(0);
  });

  test('Configure opens typed settings that persist; Duplicate/Remove/Reset drive the instance model', async ({ page }) => {
    page.on('dialog', (dialog) => dialog.accept());
    const dashName = `S05 Actions ${TS}`;

    await seedAnalyticsData(page);
    await gotoPerformance(page);
    await waitForAnalytics(page);
    await createUserDashboard(page, dashName);

    await page.getByRole('button', { name: 'Customize' }).click();
    await expect(page.getByRole('button', { name: 'Done' })).toBeVisible();

    // ── Configure a chart: title override (single-series contract) ──────
    await page.getByRole('button', { name: 'Actions for Drawdown Curve', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Configure' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Configure Drawdown Curve' })).toBeVisible();
    // Drawdown is a single downside series driven by the global unit selector
    // (CT5) — no dual-series visibility multi-select remains; the typed dialog
    // offers the shared legend boolean and title text.
    await expect(dialog.getByRole('checkbox', { name: 'Amount ($)' })).toHaveCount(0);
    await expect(dialog.getByRole('checkbox', { name: 'Percent (%)' })).toHaveCount(0);
    await expect(dialog.getByRole('checkbox', { name: 'Show legend' })).not.toBeChecked();
    await dialog.getByLabel('Title').fill('My Drawdown Curve');
    await dialog.getByRole('button', { name: 'Save' }).click();

    // The widget re-renders with the override and the instance model holds it.
    await expect(page.getByText('My Drawdown Curve', { exact: true })).toBeVisible();
    await expect.poll(() => readStoredInstanceConfig(page, 'chart', 'drawdown-curve')).toEqual({
      titleOverride: 'My Drawdown Curve',
    });

    // ── Configure a KPI: metric change (unit field follows the metric) ────
    await page.getByRole('button', { name: 'Actions for Net P&L', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Configure' }).click();
    await expect(dialog.getByRole('heading', { name: 'Configure Net P&L' })).toBeVisible();
    // Net P&L supports $/%/R → a per-widget Unit override is offered…
    await expect(dialog.getByLabel('Metric')).toBeVisible();
    await expect(dialog.getByLabel('Unit')).toBeVisible();
    await dialog.getByLabel('Metric').click();
    await page.getByRole('option', { name: 'Total Trades' }).click();
    // …but Total Trades is fixed-count → the Unit field disappears live.
    await expect(dialog.getByLabel('Unit')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Save' }).click();

    await expect(page.locator('[data-kpi-card="total-trades"]')).toBeVisible();
    await expect(page.locator('[data-kpi-value="total-trades"]')).toBeVisible();
    await expect.poll(() => readStoredInstanceConfig(page, 'kpi', 'net-pnl')).toEqual({
      metricId: 'total-trades',
    });

    // ── Configure changes persist through the saved-dashboard flow ────────
    await saveAndReload(page);
    await expect(page.locator('button', { hasText: dashName })).toBeVisible();
    await expect(page.getByText('My Drawdown Curve', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-kpi-card="total-trades"]')).toBeVisible({ timeout: 20_000 });

    // ── Re-enter Customize: Duplicate creates a second widget ─────────────
    await page.getByRole('button', { name: 'Customize' }).click();
    await expect(page.getByRole('button', { name: 'Done' })).toBeVisible();
    await expect(page.locator('[data-kpi-card]')).toHaveCount(5);
    await page.getByRole('button', { name: 'Actions for Win Rate', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Duplicate' }).click();
    await expect(page.locator('[data-kpi-card]')).toHaveCount(6);
    await expect(page.locator('[data-kpi-value="win-rate"]')).toHaveCount(2);

    // ── Remove deletes one (the duplicated card, appended last) ───────────
    await page.getByRole('button', { name: 'Actions for Win Rate', exact: true }).last().click();
    await page.getByRole('menuitem', { name: 'Remove' }).click();
    await expect(page.locator('[data-kpi-card]')).toHaveCount(5);
    await expect(page.locator('[data-kpi-value="win-rate"]')).toHaveCount(1);

    // ── Reset restores the registry default config on the configured chart ──
    await page.getByRole('button', { name: 'Actions for Drawdown Curve', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Reset' }).click();
    await expect(page.getByText('My Drawdown Curve', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Drawdown Curve', { exact: true })).toBeVisible();
    await expect.poll(() => readStoredInstanceConfig(page, 'chart', 'drawdown-curve')).toEqual({});

    // Cleanup: exit edit mode, delete the user dashboard.
    await page.getByRole('button', { name: 'Done' }).click();
    await deleteUserDashboard(page, dashName);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// S06 (R006): Visual UAT screenshot matrix
//
// Captures the full visual UAT matrix for /performance at
// 1440/1280/1024 × dark/light (6 captures) using the localStorage 'theme'
// script to set dark/light. Every capture walks the R006 review checklist
// (sidebar continuity, page hierarchy, filter-bar density, KPI equal-height
// geometry, chart proportions, charts per row, empty space usage, widget
// chrome, Customize affordances, alignment, spacing rhythm, responsive
// wrapping, empty/loading states, dark/light quality) and records per-capture
// PASS/notes findings. Customize mode (1440 dark + light), the loading state
// (analytics delayed → skeletons) and the empty state (no-trade custom
// period → em dashes + 'No data for this period') get dedicated captures.
// Captures + findings land in a per-run artifact directory
// (PERF_UAT_ARTIFACT_DIR or /tmp/perf-uat-S06-<run>) referenced as the UAT
// evidence record.
// ────────────────────────────────────────────────────────────────────────────

const UAT_ARTIFACT_DIR = process.env.PERF_UAT_ARTIFACT_DIR ?? join('/tmp', `perf-uat-S06-${TS}`);
mkdirSync(UAT_ARTIFACT_DIR, { recursive: true });

/** One R006 checklist finding for a capture. */
interface ChecklistFinding {
  item: string;
  status: 'PASS' | 'note' | 'FAIL';
  detail: string;
}

/**
 * Seed a realistic single-currency visual fixture (YTD window, all past):
 * one USD account + 3 setups + 21 trades across Jan..current month-1 with
 * varied symbols/directions/results so every chart renders populated data
 * and the KPI semantics show real signed/threshold coloring.
 */
async function seedVisualFixture(page: Page, tag = `VIS${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`) {
  // Opening balance posted at the start of the year so every generated
  // historical fill (Jan .. current month-1) has canonical A2 funding. The
  // account's max-risk config (5%) is aligned with the fixture's intentionally
  // varied deterministic trade sizes (|entry-stop| × qty spans up to ~1,260):
  // this fixture exercises chart rendering across a wide P&L/risk range, and
  // the risk-limit configuration is not its subject. Trade prices, quantities,
  // stops, fees, setups, directions and P&L are otherwise unchanged, so every
  // KPI, monthly chart and rollforward-derived equity value is identical to the
  // intended visual fixture economics.
  const account = await seedAccount(page, `Visual-${tag}`, 'USD', `${new Date().getFullYear()}-01-01T00:00:00.000Z`, 5);
  const setupA = await seedSetup(page, `visual alpha ${tag}`);
  const setupB = await seedSetup(page, `visual beta ${tag}`);
  const setupC = await seedSetup(page, `visual gamma ${tag}`);
  const setups = [setupA.value, setupB.value, setupC.value];
  const symbols = ['AAAU', 'BBBV', 'CCCW', 'DDDX', 'EEEY'];
  const y = new Date().getFullYear();
  const currentMonth = new Date().getMonth(); // 0-based
  const specs: SeededTradeSpec[] = [];
  for (let i = 0; i < 21; i++) {
    const month = i % Math.max(1, currentMonth); // Jan .. month-1 (all past)
    const day = 5 + ((i * 5) % 19);
    const direction = i % 2 === 0 ? 'long' : 'short';
    const win = i % 5 !== 3; // ~80% wins, mixed
    const entry = 50 + ((i * 17) % 120);
    const qty = 10 + ((i * 7) % 90);
    const movePct = win ? 0.03 + ((i % 3) * 0.025) : -(0.02 + ((i % 3) * 0.02));
    const signedMove = direction === 'short' ? -movePct : movePct;
    const exit = Math.round(entry * (1 + signedMove) * 100) / 100;
    specs.push({
      account: 'A',
      symbol: symbols[i % symbols.length],
      direction,
      setup: setups[i % 3],
      entryPrice: entry,
      entryQuantity: qty,
      exitPrice: exit,
      exitQuantity: qty,
      stopPrice: Math.round(entry * (direction === 'long' ? 0.9 : 1.1) * 100) / 100,
      fees: 2 + (i % 4),
      executedAt: `${y}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T15:00:00.000Z`,
    });
  }
  // Execute the 21 fills in CHRONOLOGICAL order (the generated dates are not
  // monotonic) and persist a coherent rollforward row after each one so every
  // historical fill has a trusted A2 equity source at its timestamp.
  const db = new Database(process.env.DB_FILE_NAME as string);
  try {
    let equity = 50000;
    let highWaterMark = 50000;
    for (const t of [...specs].sort((a, b) => a.executedAt.localeCompare(b.executedAt))) {
      equity = await seedHistoricalTrade(page, db, account.id, t, equity, highWaterMark);
      highWaterMark = Math.max(highWaterMark, equity);
    }
  } finally {
    db.close();
  }
  return { account, tradeCount: specs.length };
}

/** Set the theme via the localStorage 'theme' script + reload, then wait for the shell + data. */
async function loadPerformanceWithTheme(page: Page, width: number, theme: 'dark' | 'light') {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/performance');
  await expect(page).toHaveTitle(/Performance Dashboard/);
  await page.evaluate((t) => localStorage.setItem('theme', t), theme);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await hideDevOverlay(page);
  await expect(page.getByRole('button', { name: /Customize/ })).toBeVisible({ timeout: 15_000 });
  await waitForAnalytics(page);
  await waitForChartGrid(page);
}

/** Scroll the app's <main> scroll container to the bottom (second chart row). */
async function scrollMainToBottom(page: Page) {
  await page.evaluate(() => {
    const main = document.querySelector('main');
    if (main) main.scrollTop = main.scrollHeight;
  });
  await page.waitForTimeout(300);
}

/** The filter-bar control locators (density + alignment targets). */
function filterBarControls(page: Page) {
  return [
    { name: 'date-period', loc: page.locator('#perf-date-period') },
    { name: 'filters', loc: page.getByTestId('filters-trigger') },
    { name: 'unit', loc: page.locator('[aria-label="Performance unit"]') },
  ];
}

/** Group rects into rows by shared top edge (2px tolerance). */
function clusterRows<T extends { top: number }>(items: T[]): T[][] {
  const sorted = [...items].sort((a, b) => a.top - b.top);
  const rows: T[][] = [];
  for (const it of sorted) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(it.top - last[0].top) <= 2) last.push(it);
    else rows.push([it]);
  }
  return rows;
}

/**
 * Walk the full R006 review checklist for one capture. Records findings for
 * every item (PASS/note/FAIL) without throwing, so all 6 captures always
 * complete; the matrix test asserts no FAIL status at the end.
 */
async function walkChecklist(
  page: Page,
  width: number,
  theme: 'dark' | 'light',
): Promise<ChecklistFinding[]> {
  const f: ChecklistFinding[] = [];
  const rec = (item: string, status: ChecklistFinding['status'], detail: string) => f.push({ item, status, detail });
  const note = (item: string, detail: string) => rec(item, 'note', detail);
  const fail = (item: string, detail: string) => rec(item, 'FAIL', detail);

  // 1. Sidebar continuity
  const aside = page.locator('aside');
  const asideVisible = await aside.isVisible();
  const asideW = (await aside.boundingBox())?.width ?? 0;
  if (asideVisible && asideW > 0) rec('sidebar continuity', 'PASS', `aside visible, width ${Math.round(asideW)}px`);
  else fail('sidebar continuity', `aside visible=${asideVisible}, width=${Math.round(asideW)}px`);

  // 2. Page hierarchy: toolbar → filter bar → KPI rail → charts
  const toolbarBox = await page.getByRole('button', { name: /Customize/ }).boundingBox();
  const filterLabel = await page.locator('#perf-date-period').boundingBox();
  const kpiSection = await page.locator('section[aria-label="Performance KPI row"]').boundingBox();
  const chartsSection = await page.locator('section[aria-label="Performance charts"]').boundingBox();
  if (toolbarBox && filterLabel && kpiSection && chartsSection && toolbarBox.y < filterLabel.y && filterLabel.y < kpiSection.y && kpiSection.y < chartsSection.y) {
    rec('page hierarchy', 'PASS', `toolbar(${Math.round(toolbarBox.y)}) < filter(${Math.round(filterLabel.y)}) < KPI(${Math.round(kpiSection.y)}) < charts(${Math.round(chartsSection.y)})`);
  } else {
    fail('page hierarchy', `y: toolbar=${Math.round(toolbarBox?.y ?? -1)} filter=${Math.round(filterLabel?.y ?? -1)} KPI=${Math.round(kpiSection?.y ?? -1)} charts=${Math.round(chartsSection?.y ?? -1)}`);
  }

  // 3. Filter-bar density: every control at the 36px lg height, row-aligned tops
  const ctrlBoxes: Array<{ name: string; top: number; height: number }> = [];
  for (const { name, loc } of filterBarControls(page)) {
    const b = await loc.boundingBox();
    if (b) ctrlBoxes.push({ name, top: b.y, height: b.height });
  }
  const ctrlRows = clusterRows(ctrlBoxes);
  const heightOk = ctrlBoxes.length === 3 && ctrlBoxes.every((c) => Math.abs(c.height - 36) <= 1.5);
  const topsOk = ctrlRows.every((row) => Math.max(...row.map((c) => c.top)) - Math.min(...row.map((c) => c.top)) <= 1.5);
  if (ctrlBoxes.length === 3 && heightOk && topsOk) {
    rec('filter-bar density', 'PASS', `controls=${ctrlBoxes.map((c) => `${c.name}:${Math.round(c.height)}px`).join(', ')} rows=${ctrlRows.length}`);
  } else {
    fail('filter-bar density', `controls=${ctrlBoxes.map((c) => `${c.name}:${Math.round(c.height)}px@y${Math.round(c.top)}`).join(', ') || 'missing'} rows=${ctrlRows.length}`);
  }

  // 4. KPI equal-height geometry (row-aware: 5 in a row ≥1280, 3+2 at 1024)
  const cards = page.locator('[data-kpi-card]');
  const cardCount = await cards.count();
  const cardGeo = await cards.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.getAttribute('data-kpi-card'), top: r.top, bottom: r.bottom, height: r.height };
    }),
  );
  const kpiRows = clusterRows(cardGeo);
  const kpiGeometryOk =
    cardCount === 5 &&
    kpiRows.every((row) => {
      const tops = row.map((c) => c.top);
      const bottoms = row.map((c) => c.bottom);
      return Math.max(...tops) - Math.min(...tops) <= 1 && Math.max(...bottoms) - Math.min(...bottoms) <= 1 && row.every((c) => c.height >= 124 && c.height <= 132);
    });
  if (kpiGeometryOk) {
    rec('KPI equal-height geometry', 'PASS', `cards=5 rows=${kpiRows.length} heights=${cardGeo.map((c) => Math.round(c.height)).join('/')}`);
  } else {
    fail('KPI equal-height geometry', `cards=${cardCount} rows=${kpiRows.length} heights=${cardGeo.map((c) => Math.round(c.height)).join('/')}`);
  }

  // 5. Chart proportions: 6 widgets, uniform row heights, sane header/body split
  const chartItems = page.locator('section[aria-label="Performance charts"] .react-grid-item');
  const chartCount = await chartItems.count();
  const chartHeights = await chartItems.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
  const firstHeader = await chartItems.first().locator('h4').boundingBox();
  const uniformHeights = chartCount === 6 && Math.max(...chartHeights) - Math.min(...chartHeights) <= 2;
  const proportionsOk = uniformHeights && firstHeader !== null && firstHeader.height <= 60;
  if (proportionsOk) {
    rec('chart proportions', 'PASS', `charts=6 uniform heights=[${chartHeights.map((h) => Math.round(h)).join('/')}] header=${Math.round(firstHeader?.height ?? 0)}px`);
  } else {
    fail('chart proportions', `charts=${chartCount} heights=[${chartHeights.map((h) => Math.round(h)).join('/')}] header=${Math.round(firstHeader?.height ?? -1)}px`);
  }

  // 6. Charts per row (dense R004: 3 at 1440, 2-3 at 1280/1024) + no full-width
  const chartBoxes = await readChartBoxes(page);
  const row1 = firstAnalyticalRow(chartBoxes);
  const gridW = await chartGridWidth(page);
  const row1Ok = width >= 1440 ? row1.length === 3 : row1.length >= 2 && row1.length <= 3;
  const widthRatioOk = chartBoxes.every((b) => b.width / gridW > 0.28 && b.width / gridW < 0.45);
  if (row1Ok && widthRatioOk) {
    rec('charts per row', 'PASS', `row1=${row1.length} widthRatio=${chartBoxes.map((b) => (b.width / gridW).toFixed(2)).join('/')}`);
  } else {
    fail('charts per row', `row1=${row1.length} (expect ${width >= 1440 ? 3 : '2-3'}) widthRatio=${chartBoxes.map((b) => (b.width / gridW).toFixed(2)).join('/')}`);
  }

  // 7. Empty space usage: no horizontal document overflow
  const overflowX = await docOverflowX(page);
  if (overflowX <= 1) rec('empty space usage', 'PASS', `doc overflowX=${overflowX}px, grid ${Math.round(gridW)}px`);
  else fail('empty space usage', `doc overflowX=${overflowX}px`);

  // 8. Widget chrome: normal mode is free of editing chrome
  const chromeSelectors = ['[aria-label^="Actions for"]', 'section[aria-label="Performance charts"] .drag-handle', '[aria-label="Resize widget"]', '.chart-edit-frame'];
  let chromeCount = 0;
  for (const sel of chromeSelectors) chromeCount += await page.locator(sel).count();
  if (chromeCount === 0) rec('widget chrome', 'PASS', 'zero editing chrome in normal mode');
  else fail('widget chrome', `editing chrome elements=${chromeCount}`);

  // 9. Customize affordances (trigger visible; editing chrome captured separately)
  const customizeVisible = await page.getByRole('button', { name: 'Customize' }).isVisible();
  if (customizeVisible) rec('Customize affordances', 'PASS', 'Customize trigger visible; editing chrome captured in dedicated 1440 dark/light captures');
  else fail('Customize affordances', 'Customize trigger not visible');

  // 10. Alignment: KPI value tops aligned within each row; toolbar buttons at 36px
  const valueRects = await page.locator('[data-kpi-value]').evaluateAll((els) => els.map((el) => ({ top: el.getBoundingClientRect().top, height: el.getBoundingClientRect().height })));
  const valueRows = clusterRows(valueRects);
  const valueAlignOk = valueRows.every((row) => Math.max(...row.map((v) => v.top)) - Math.min(...row.map((v) => v.top)) <= 1.5);
  const customizeBtn = await page.getByRole('button', { name: 'Customize' }).boundingBox();
  const btn36 = customizeBtn !== null && Math.abs(customizeBtn.height - 36) <= 1.5;
  if (valueAlignOk && btn36) rec('alignment', 'PASS', `KPI value rows=${valueRows.length} aligned; Customize btn ${Math.round(customizeBtn?.height ?? 0)}px`);
  else fail('alignment', `valueRows=${valueRows.length} aligned=${valueAlignOk} btnH=${Math.round(customizeBtn?.height ?? -1)}`);

  // 11. Spacing rhythm: uniform KPI card gap (gap-4 = 16px)
  const cardRects = await cards.evaluateAll((els) => els.map((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top };
  }));
  const firstRowCards = clusterRows(cardRects)[0] ?? [];
  const sorted = [...firstRowCards].sort((a, b) => a.left - b.left);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) gaps.push(sorted[i].left - sorted[i - 1].right);
  const rhythmOk = gaps.length > 0 && gaps.every((g) => Math.abs(g - 16) <= 2);
  if (rhythmOk) rec('spacing rhythm', 'PASS', `KPI card gaps=[${gaps.map((g) => Math.round(g)).join(',')}]px (gap-4=16)`);
  else note('spacing rhythm', `KPI card gaps=[${gaps.map((g) => Math.round(g)).join(',')}]px`);

  // 12. Responsive wrapping
  const kpiRowCount = kpiRows.length;
  const wrapOk = width >= 1280 ? kpiRowCount === 1 : kpiRowCount === 2;
  if (wrapOk && row1Ok) rec('responsive wrapping', 'PASS', `KPI rows=${kpiRowCount} (expect ${width >= 1280 ? 1 : 2}), charts row1=${row1.length}`);
  else fail('responsive wrapping', `KPI rows=${kpiRowCount} (expect ${width >= 1280 ? 1 : 2}), charts row1=${row1.length}`);

  // 13. Empty/loading states: populated captures show data, no skeletons
  const skeletonCount = await page.locator('[data-testid^="kpi-skeleton-"], [data-testid^="chart-skeleton-"]').count();
  const netPnl = await page.locator('[data-kpi-value="net-pnl"]').textContent();
  if (skeletonCount === 0 && netPnl && netPnl !== '—') rec('empty/loading states', 'PASS', `no skeletons; net-pnl=${netPnl} (loading/empty captured separately)`);
  else fail('empty/loading states', `skeletons=${skeletonCount} netPnl=${netPnl}`);

  // 14. Dark/light quality: .dark class matches theme; card bg resolves per theme
  const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  const cardBg = await page.locator('[data-kpi-card]').first().evaluate((el) => getComputedStyle(el).backgroundColor);
  const themeOk = isDark === (theme === 'dark');
  if (themeOk) rec('dark/light quality', 'PASS', `theme=${theme} html.dark=${isDark} cardBg=${cardBg}`);
  else fail('dark/light quality', `theme=${theme} html.dark=${isDark} cardBg=${cardBg}`);

  return f;
}

/** Render the findings as a markdown table section for the artifact record. */
function renderFindingsMd(captures: Array<{ name: string; findings: ChecklistFinding[] }>): string {
  const lines: string[] = ['# S06 (R006) /performance Visual UAT Matrix — findings', ''];
  for (const { name, findings } of captures) {
    lines.push(`## ${name}`, '');
    lines.push('| Checklist item | Status | Detail |', '|---|---|---|');
    for (const f of findings) lines.push(`| ${f.item} | ${f.status} | ${f.detail} |`);
    lines.push('');
  }
  return lines.join('\n');
}

test.describe('S06 visual UAT matrix (R006)', () => {
  test('captures the 6-combo matrix (1440/1280/1024 × dark/light) with checklist findings', async ({ page }) => {
    await seedVisualFixture(page);

    const combos: Array<{ width: number; theme: 'dark' | 'light' }> = [
      { width: 1440, theme: 'dark' },
      { width: 1440, theme: 'light' },
      { width: 1280, theme: 'dark' },
      { width: 1280, theme: 'light' },
      { width: 1024, theme: 'dark' },
      { width: 1024, theme: 'light' },
    ];
    const captures: Array<{ name: string; findings: ChecklistFinding[] }> = [];
    const asideWidths = new Set<number>();
    const cardBgs: Record<string, string> = {};

    for (const { width, theme } of combos) {
      await loadPerformanceWithTheme(page, width, theme);
      const findings = await walkChecklist(page, width, theme);
      const asideW = (await page.locator('aside').boundingBox())?.width ?? 0;
      asideWidths.add(asideW);
      const cardBg = await page.locator('[data-kpi-card]').first().evaluate((el) => getComputedStyle(el).backgroundColor);
      cardBgs[`${width}-${theme}`] = cardBg;

      const name = `${width}-${theme}`;
      const topFile = join(UAT_ARTIFACT_DIR, `${name}-top.png`);
      await page.screenshot({ path: topFile });
      await scrollMainToBottom(page);
      const bottomFile = join(UAT_ARTIFACT_DIR, `${name}-bottom.png`);
      await page.screenshot({ path: bottomFile });
      captures.push({ name, findings });
      console.log(`[S06-UAT] ${name}: top=${topFile} bottom=${bottomFile}`);
    }

    // Cross-capture continuity: sidebar width stable, themes resolve to different card bg.
    const sidebarContinuityOk = asideWidths.size === 1;
    if (!sidebarContinuityOk) {
      captures.push({ name: 'cross-capture', findings: [{ item: 'sidebar continuity (cross)', status: 'FAIL', detail: `aside widths varied: ${[...asideWidths].map((w) => Math.round(w)).join(', ')}px` }] });
    }
    for (const width of [1440, 1280, 1024]) {
      if (cardBgs[`${width}-dark`] === cardBgs[`${width}-light`]) {
        captures.push({ name: `cross-${width}`, findings: [{ item: 'dark/light quality (cross)', status: 'FAIL', detail: `card bg identical in dark+light: ${cardBgs[`${width}-dark`]}` }] });
      }
    }

    writeFileSync(join(UAT_ARTIFACT_DIR, 'findings.md'), renderFindingsMd(captures));
    writeFileSync(join(UAT_ARTIFACT_DIR, 'captures.json'), JSON.stringify(captures, null, 2));

    const allFailing = captures.flatMap((c) => c.findings.filter((f) => f.status === 'FAIL'));
    const passCount = captures.flatMap((c) => c.findings).filter((f) => f.status === 'PASS').length;
    console.log(`[S06-UAT] artifact dir: ${UAT_ARTIFACT_DIR} (passes=${passCount}, fails=${allFailing.length})`);
    expect(allFailing, JSON.stringify(allFailing, null, 2)).toEqual([]);

    // 6 primary captures (top) + 6 bottom captures exist.
    for (const { width, theme } of combos) {
      expect(existsSync(join(UAT_ARTIFACT_DIR, `${width}-${theme}-top.png`))).toBeTruthy();
      expect(existsSync(join(UAT_ARTIFACT_DIR, `${width}-${theme}-bottom.png`))).toBeTruthy();
    }
  });

  test('captures Customize mode at 1440 dark and light with editing chrome verified', async ({ page }) => {
    await seedVisualFixture(page);
    for (const theme of ['dark', 'light'] as const) {
      await loadPerformanceWithTheme(page, 1440, theme);
      await page.getByRole('button', { name: 'Customize' }).click();
      await expect(page.getByRole('button', { name: 'Done' })).toBeVisible();
      await expect(page.getByText('+ Add KPI')).toBeVisible();
      await expect(page.getByText('+ Add Chart')).toBeVisible();
      await expect(page.locator('[aria-label^="Actions for"]')).toHaveCount(11);
      await expect(page.locator('section[aria-label="Performance charts"] .drag-handle')).toHaveCount(6);
      await expect(page.locator('[aria-label="Resize widget"]')).toHaveCount(6);
      await expect(page.locator('.chart-edit-frame')).toHaveCount(6);
      const file = join(UAT_ARTIFACT_DIR, `customize-1440-${theme}.png`);
      await page.screenshot({ path: file });
      console.log(`[S06-UAT] customize-1440-${theme}: ${file}`);
      // Done restores chrome-free normal mode.
      await page.getByRole('button', { name: 'Done' }).click();
      await expect(page.locator('[aria-label^="Actions for"]')).toHaveCount(0);
      await expect(page.locator('.chart-edit-frame')).toHaveCount(0);
    }
  });

  test('captures loading and empty states at 1440', async ({ page }) => {
    await seedVisualFixture(page);

    // ── Loading state: delay the analytics response, capture skeletons. ──
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/performance');
    await page.evaluate(() => localStorage.setItem('theme', 'dark'));
    await page.route('**/api/performance/analytics*', async (route) => {
      await new Promise((r) => setTimeout(r, 4000));
      await route.continue();
    });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await hideDevOverlay(page);
    await expect(page.getByRole('button', { name: /Customize/ })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid^="kpi-skeleton-"]').first()).toBeVisible({ timeout: 10_000 });
    const loadingFile = join(UAT_ARTIFACT_DIR, 'loading-1440-dark.png');
    await page.screenshot({ path: loadingFile });
    console.log(`[S06-UAT] loading-1440-dark: ${loadingFile}`);
    await page.unroute('**/api/performance/analytics*');
    await waitForAnalytics(page);
    await expect(page.locator('[data-testid^="kpi-skeleton-"]')).toHaveCount(0, { timeout: 60_000 });

    // ── Empty state: custom 2020 period → em dashes + 'No data for this period'. ──
    await page.getByTestId('filters-trigger'); // ensure filter bar mounted
    await page.locator('#perf-date-period').click();
    await page.getByRole('option', { name: 'Custom' }).click();
    await page.getByLabel('Custom from date').fill('2020-01-01');
    await page.getByLabel('Custom to date').fill('2020-12-31');
    await page.getByRole('button', { name: 'Apply' }).click();
    for (const id of KPI_IDS) {
      await expect(page.locator(`[data-kpi-value="${id}"]`)).toHaveText('—', { timeout: 15_000 });
    }
    await expect(page.getByText('No data for this period')).toHaveCount(6, { timeout: 15_000 });
    const emptyFile = join(UAT_ARTIFACT_DIR, 'empty-1440-dark.png');
    await page.screenshot({ path: emptyFile });
    console.log(`[S06-UAT] empty-1440-dark: ${emptyFile}`);
  });
});

// ── Corrective Task 2: global $ / % / R unit propagation ────────────────────
//
// Proves the full unit contract in the browser with deterministic seeded data:
//  - convertible KPI (Net P&L) changes value under % and R using canonical
//    metadata denominators (periodStartEquity, totalInitialRisk);
//  - convertible chart series (Daily Cumulative P&L) change under % and R;
//  - fixed-semantic KPIs (Win Rate, Profit Factor, Average R, Payoff Ratio)
//    remain byte-identical;
//  - switching units never triggers a new /api/performance/analytics request.
//
// Chart series state is read from the live ECharts instance (echarts-for-react
// registers instances via echarts.getInstanceByDom), not from a unit label.

test.describe('global unit propagation (CT2)', () => {
  test('unit toggles convert KPI + chart series while fixed KPIs hold and no refetch occurs', async ({ page }) => {
    const analytics = observeAnalytics(page);
    // Deterministic fixture: two accounts with win/loss trades across days,
    // plus a rollforward row so periodStartEquity is a real number.
    const seeded = await seedPropagationFixture(page);
    void seeded;

    // Seed a deterministic rollforward equity row directly into the
    // Playwright-owned disposable DB (same pattern the analytics route unit
    // test uses) so metadata.periodStartEquity is populated for the % proof.
    const dbFile = process.env.DB_FILE_NAME;
    expect(dbFile).toBeTruthy();
    const db = new Database(dbFile as string);
    const accounts = db.prepare('SELECT id FROM accounts ORDER BY created_at ASC LIMIT 1').all() as Array<{ id: string }>;
    const accountId = accounts[0]?.id;
    expect(accountId).toBeTruthy();
    // Two rollforward dates with declining equity so the derived drawdown is
    // non-zero (the multi-account merge recomputes drawdown from the combined
    // equity series). periodStartEquity = earliest equity = 10000; drawdown
    // amount at the last date = 10000 - 9500 = 500.
    const rfInsert = db.prepare(
      'INSERT OR REPLACE INTO account_rollforward (id, account_id, date, beginning_equity, deposits_withdrawals, realized_gross_pnl, fees, ending_equity, cumulative_pnl, high_water_mark, drawdown_amount, drawdown_pct, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0, 0, ?, ?, ?, 0, 0, ?, ?)'
    );
    const ts = new Date().toISOString();
    rfInsert.run(crypto.randomUUID(), accountId, '2026-01-15', 10000, 10000, 10000, 10000, ts, ts);
    rfInsert.run(crypto.randomUUID(), accountId, '2026-01-31', 9500, 9500, 9500, 9500, ts, ts);
    db.close();

    await gotoPerformance(page);
    await waitForInitialAnalytics(page, analytics);

    const reqBefore = analytics.analyticsRequests.length;
    const baseline = analytics.lastBody();
    expect(baseline).not.toBeNull();
    const equity = baseline!.metadata.periodStartEquity as number | null;
    const risk = baseline!.metadata.totalInitialRisk as number | null;
    expect(typeof equity).toBe('number');
    expect(typeof risk).toBe('number');
    if (equity === null || risk === null) throw new Error('seeded fixture must provide both denominators');
    const netPnl = baseline!.kpiMetrics.netPnl as number;

    /** Read the primary chart series via the inspectable data contract. */
    const readChartSeries = async (widgetType: string): Promise<number[]> => {
      const raw = (await page.locator(`[data-widget-type="${widgetType}"]`).getAttribute('data-chart-series')) ?? '';
      if (!raw) return [];
      return raw.split(',').map((v) => Number(v));
    };

    // Baseline under $: convertible KPI is raw currency; cumulative chart
    // series ends at the raw cumulative Net P&L.
    const kpiBaseline = (await page.locator('[data-kpi-value="net-pnl"]').textContent()) ?? '';
    expect(kpiBaseline).toMatch(/^\$\d/);
    const fixedBaseline = {
      winRate: (await page.locator('[data-kpi-value="win-rate"]').textContent()) ?? '',
      profitFactor: (await page.locator('[data-kpi-value="profit-factor"]').textContent()) ?? '',
      avgR: (await page.locator('[data-kpi-value="average-r"]').textContent()) ?? '',
      payoff: (await page.locator('[data-kpi-value="payoff-ratio"]').textContent()) ?? '',
    };
    const chartBaseline = await readChartSeries('daily-cumulative-pnl');
    expect(chartBaseline.length).toBeGreaterThan(0);
    expect(Math.abs(chartBaseline[chartBaseline.length - 1] - netPnl)).toBeLessThan(0.01);

    // % toggle: convertible KPI becomes percent-of-equity; chart converts; no refetch.
    await page.getByRole('button', { name: '%', exact: true }).click();
    await expect(page.getByRole('button', { name: '%', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await page.locator('[data-kpi-value="net-pnl"]').textContent()) ?? '').toMatch(/%$/);
    const pctKpi = await page.locator('[data-kpi-value="net-pnl"]').textContent();
    const expectedPct = ((netPnl / equity) * 100).toFixed(1);
    expect(pctKpi).toBe(`${expectedPct}%`);
    const pctChart = await readChartSeries('daily-cumulative-pnl');
    expect(pctChart.length).toBeGreaterThan(0);
    expect(Math.abs(pctChart[pctChart.length - 1] - netPnl / equity)).toBeLessThan(1e-6);
    await expect.poll(async () => ({
      winRate: (await page.locator('[data-kpi-value="win-rate"]').textContent()) ?? '',
      profitFactor: (await page.locator('[data-kpi-value="profit-factor"]').textContent()) ?? '',
      avgR: (await page.locator('[data-kpi-value="average-r"]').textContent()) ?? '',
      payoff: (await page.locator('[data-kpi-value="payoff-ratio"]').textContent()) ?? '',
    })).toEqual(fixedBaseline);
    expect(analytics.analyticsRequests.length).toBe(reqBefore);

    // R toggle: convertible KPI becomes R-multiple; chart converts; no refetch.
    await page.getByRole('button', { name: 'R', exact: true }).click();
    await expect(page.getByRole('button', { name: 'R', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await page.locator('[data-kpi-value="net-pnl"]').textContent()) ?? '').toMatch(/R$/);
    const rKpi = await page.locator('[data-kpi-value="net-pnl"]').textContent();
    const expectedR = (netPnl / risk).toFixed(2);
    expect(rKpi).toBe(`${expectedR}R`);
    const rChart = await readChartSeries('daily-cumulative-pnl');
    expect(rChart.length).toBeGreaterThan(0);
    expect(Math.abs(rChart[rChart.length - 1] - netPnl / risk)).toBeLessThan(1e-6);

    // CT2A: registry enforcement under global R — Drawdown Curve (supportedUnits
    // [currency, percent]) must keep its amount in currency, and R-Multiple
    // Distribution (fixed) must stay unchanged.
    const ddSeries = await readChartSeries('drawdown-curve');
    expect(ddSeries.length).toBeGreaterThan(0);
    // CT5 downside semantics: the plotted series is the negated currency
    // amount (≤ 0, 0 = at high-water mark). No drawdown point equals
    // amount/risk (R conversion). The magnitude is fixture-dependent (derived
    // from the combined rollforward series and account scope), so the
    // assertion targets the conversion invariant, not a hardcoded value.
    const ddMin = Math.min(...ddSeries);
    expect(ddMin).toBeLessThan(0);
    expect(Math.abs(ddMin - ddMin / risk)).toBeGreaterThan(0.01);
    // Non-zero drawdown points stay currency (0 points are the recovery/peak
    // observations and are trivially invariant).
    expect(ddSeries.filter((v) => v !== 0).every((v) => Math.abs(v - v / risk) > 0.01)).toBe(true);
    const rDistSeries = await readChartSeries('r-distribution');
    expect(rDistSeries.length).toBeGreaterThan(0);
    // counts are never converted.
    expect(rDistSeries.every((v) => Number.isInteger(v))).toBe(true);
    await expect.poll(async () => (await page.locator('[data-kpi-value="net-pnl"]').textContent()) ?? '').toMatch(/R$/);
    await expect.poll(async () => ({
      winRate: (await page.locator('[data-kpi-value="win-rate"]').textContent()) ?? '',
      profitFactor: (await page.locator('[data-kpi-value="profit-factor"]').textContent()) ?? '',
      avgR: (await page.locator('[data-kpi-value="average-r"]').textContent()) ?? '',
      payoff: (await page.locator('[data-kpi-value="payoff-ratio"]').textContent()) ?? '',
    })).toEqual(fixedBaseline);
    // No refetch on any unit toggle.
    await page.waitForTimeout(700);
    expect(analytics.analyticsRequests.length).toBe(reqBefore);
    expect(analytics.analyticsRequests.every((u) => !u.includes('unit='))).toBeTruthy();
  });
});
