/**
 * M002 S09 T02 — M002 trading lifecycle browser UAT at laptop viewport in
 * light and dark themes.
 *
 * Closes the milestone criterion "long and short lifecycle UAT ... laptop
 * viewport, and light/dark checks all pass" with one coherent browser spec:
 * every scenario is API-seeded through the real routes (accounts, trades,
 * execute, executions) and then asserted in the rendered UI at the 1366×768
 * laptop viewport. No database is written directly — all data arrives through
 * the same public API the product uses.
 *
 *   1. Full long lifecycle at 1366px — entry (buy) → add → reduce → close;
 *      the Closed tab shows the trade with its Net P&L and R-Multiple, the
 *      detail page shows the closed state (no active management actions, all
 *      six lifecycle steps), the dashboard Account State reflects the trade's
 *      P&L, and the account overview NAV does too. No horizontal overflow on
 *      any page.
 *   2. Full short lifecycle at 1366px — sell_short → add → reduce →
 *      buy_to_cover, staged as a losing trade so the negative P&L identity
 *      (red) and the Short direction badge are asserted.
 *   3. Open trade management UI at 1366px — an entry-only open trade exposes
 *      the management actions (Add Fill, Adjust Stop, Adjust Target) in the
 *      Trade Details panel; the buttons render fully inside the viewport and
 *      the lifecycle timeline shows all phases.
 *   4. Light and dark theme matrix across lifecycle pages — /trades, the
 *      dashboard, and the trade detail page each render in light and dark at
 *      1366px. Theme tokens are sampled through a 1×1 canvas readback (oklch
 *      declarations are converted to sRGB by the canvas fillStyle round-trip,
 *      per the m026-s04 pattern): body and card surfaces are near-white in
 *      light (>600 channel sum) and graphite in dark (<300), body text is
 *      dark in light / light in dark, and each theme really changes the
 *      sampled colors (delta assertions, not just class presence).
 *
 * Theme contract under test (identical to the (legacy) layout that hosts all
 * lifecycle pages): a pre-paint inline script reads localStorage['theme']
 * (falling back to prefers-color-scheme) and applies/omits the `.dark` class
 * on <html>. This spec drives the real contract by setting the storage key
 * and reloading before each assertion.
 *
 * Firefox note (dev server): a page that has already visited /trades or the
 * dashboard aborts subsequent full navigations with NS_BINDING_ABORTED
 * ("frame was detached") while the Next dev client/HMR settles. Each
 * cross-page visit therefore gets a fresh page (the m012 pattern); reloads
 * in place are safe.
 *
 * Isolation: each test seeds its own timestamp-prefixed account through the
 * API, so the suite is parallel-safe; `serial` mode is declared to match the
 * repo convention for lifecycle suites. The Playwright invocation owns a
 * disposable database (playwright.config.ts), so fixed symbols are unique
 * within the run.
 *
 * Run: npx playwright test e2e/m002-lifecycle-uat.spec.ts --project=chromium
 *      npx playwright test e2e/m002-lifecycle-uat.spec.ts --project=firefox
 */

import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { hideDevOverlay } from './helpers';

const TS = Date.now();

/**
 * Unique symbol per invocation. The two Playwright projects in one run
 * share the disposable DB, so fixed symbols would collide across projects;
 * a per-test random suffix keeps every row lookup unambiguous.
 */
function uniqueSymbol(base: string): string {
  return `${base}${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

/** localStorage key owned by the theme system (ThemeToggle + layout script). */
const THEME_STORAGE_KEY = 'theme';

/** Standard laptop viewport required by the milestone UAT. */
const LAPTOP_VIEWPORT = { width: 1366, height: 768 } as const;

/** Opening balance posted by setupAccount (deterministic NAV denominator). */
const OPENING_BALANCE = 50_000;

// ── Seeding helpers (mirror trades-identity-uat / m012 patterns) ────────

/**
 * Create a fully usable test account: create account, set risk params, then
 * initialize it (opening balance + activation in one server-side
 * transaction). Also seeds the deterministic global equity fallback the
 * execution-readiness gate reads (settings.starting_account_value — the
 * product sets this during first-run setup; Playwright's disposable DB
 * starts empty, so mirror trades-identity-uat and seed it directly).
 * Returns { id, name }.
 */
async function setupAccount(page: Page, name: string) {
  const createResp = await page.request.post('/api/accounts', {
    data: { name, currency: 'USD' },
  });
  expect(createResp.status(), 'account creation should return 201').toBe(201);
  const account = (await createResp.json()) as { id: string; name: string };

  const configResp = await page.request.put(`/api/accounts/${account.id}`, {
    data: { maxRiskPerTradePct: 2, defaultCommission: 1 },
  });
  expect(configResp.ok()).toBeTruthy();

  const initResp = await page.request.post(`/api/accounts/${account.id}/initialize`, {
    data: { mode: 'opening_balance', amount: `${OPENING_BALANCE}.00` },
  });
  expect(initResp.status(), 'initialization should succeed').toBe(201);

  await seedDeterministicEquity();

  return account;
}

/**
 * Upsert the settings row the execution-readiness gate and trades routes
 * read (id = 'default') so equity-at-open falls back to a deterministic
 * 50,000. Test-only WAL-safe write mirroring the app's read contract —
 * identical to the trades-identity-uat pattern.
 */
async function seedDeterministicEquity() {
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(
    process.env.DB_FILE_NAME || './.trading-journal/playwright-readiness.db',
  );
  try {
    db.prepare(
      `INSERT INTO settings (id, starting_account_value) VALUES ('default', ${OPENING_BALANCE})
       ON CONFLICT(id) DO UPDATE SET starting_account_value = ${OPENING_BALANCE}, updated_at = current_timestamp`,
    ).run();
  } finally {
    db.close();
  }
}

async function createTrade(page: Page, accountId: string, data: Record<string, unknown>) {
  // Retry transient SQLITE_BUSY 500s with a short backoff (shared readiness DB).
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const res = await page.request.post('/api/trades', {
      data: { accountId, ...data },
    });
    if (res.ok()) return (await res.json()) as { id: string };
    const details = await res.json().catch(() => null);
    const retryable =
      res.status() >= 500 && /sqlite_busy|database is locked/i.test(JSON.stringify(details ?? ''));
    if (!retryable) {
      expect(res.ok(), `trade creation for ${String(data.symbol)} should succeed`).toBeTruthy();
      return (await res.json()) as { id: string };
    }
    await new Promise((r) => setTimeout(r, 200 * attempt));
  }
  throw new Error(`trade creation for ${String(data.symbol)} failed after 4 retries`);
}

async function executeTrade(page: Page, id: string, data: Record<string, unknown>) {
  const res = await page.request.post(`/api/trades/${id}/execute`, { data });
  expect(res.ok(), `execute ${id} should succeed`).toBeTruthy();
  return res.json();
}

async function addExecution(page: Page, id: string, data: Record<string, unknown>) {
  const res = await page.request.post(`/api/trades/${id}/executions`, { data });
  expect(res.status(), `execution on ${id} should return 201`).toBe(201);
  return res.json();
}

/** Fetch the canonical trade detail (same response the detail page renders). */
async function fetchTradeDetail(page: Page, id: string) {
  const res = await page.request.get(`/api/trades/${id}`);
  expect(res.ok(), `GET /api/trades/${id} should succeed`).toBeTruthy();
  return res.json();
}

/**
 * Fetch the account overview snapshot (the accounting projection the
 * dashboard Account State panel and the account overview page render).
 */
async function fetchAccountOverview(page: Page, accountId: string) {
  const res = await page.request.get(`/api/accounts/${accountId}/overview`);
  expect(res.ok(), `GET /api/accounts/${accountId}/overview should succeed`).toBeTruthy();
  return res.json();
}

// ── Formatters mirroring src/lib/trade-formatters.tsx ───────────────────

function fmtCurrency(value: number): string {
  const abs = Math.abs(value);
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(abs);
  return value < 0 ? `-${formatted}` : formatted;
}

function fmtRMultiple(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}R`;
}

// ── Viewport / navigation / theme / overflow helpers ────────────────────

function setLaptopViewport(page: Page) {
  return page.setViewportSize(LAPTOP_VIEWPORT);
}

/**
 * Wait until the application shell is hydrated and interactive. The sidebar
 * account trigger only renders after the AccountProvider's /api/accounts
 * fetch resolves post-hydration, so it is a strong "app is interactive"
 * signal (same signal trades-identity-uat waits on before interacting). The
 * first visit to a route in dev compiles its chunk server-side, which can
 * delay hydration well past the default 5s expect timeout under load
 * (observed as a cold-start flake in the S09 combined chromium+firefox run:
 * the dashboard sidebar trigger and the /trades closed-tab row both raced
 * it). Generous timeout; on warm routes this resolves in ms.
 */
async function waitForAppShell(page: Page) {
  await expect(page.getByTestId('sidebar-account-trigger')).toBeVisible({ timeout: 20_000 });
}

/**
 * Open a fresh page for a page visit at the laptop viewport. In Firefox the
 * Next dev client aborts full navigations from a page that previously visited
 * /trades or the dashboard (NS_BINDING_ABORTED), so every cross-page visit
 * gets its own page — reloads in place remain safe. Callers close the page.
 */
async function freshPage(context: BrowserContext, url: string): Promise<Page> {
  const p = await context.newPage();
  await p.setViewportSize(LAPTOP_VIEWPORT);
  await p.goto(url, { waitUntil: 'domcontentloaded' });
  await hideDevOverlay(p);
  await waitForAppShell(p);
  return p;
}

/**
 * Sample the computed background color of the first element matching
 * `selector` through a 1×1 canvas readback. Identity tokens are declared in
 * oklch (Tailwind v4), so getComputedStyle serializes them as
 * lab(...)/oklch(...); Chrome/Firefox canvas fillStyle preserves the color
 * space and the pixel readback is always true sRGB rgb(r, g, b).
 */
async function sampleBackground(page: Page, selector: string): Promise<string> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const color = el
      ? getComputedStyle(el as HTMLElement).backgroundColor
      : 'transparent';
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `rgb(${r}, ${g}, ${b})`;
  }, selector);
}

/** Sum of the RGB channels of an `rgb(r, g, b)` string (0–765). */
function channelSum(rgb: string): number {
  const m = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(rgb);
  expect(m, `color sample should be rgb (got ${rgb})`).not.toBeNull();
  return Number(m![1]) + Number(m![2]) + Number(m![3]);
}

/** True when red is the dominant channel (red identity token family). */
function redHue(rgb: string): boolean {
  const m = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(rgb);
  return !!m && Number(m[1]) > Number(m[2]) && Number(m[1]) > Number(m[3]);
}

/**
 * Sample the computed text color of a locator through a 1×1 canvas readback
 * (oklch-declared Tailwind v4 tokens convert to true sRGB on readback).
 */
async function sampleTextColor(locator: Locator): Promise<string> {
  return locator.evaluate((el) => {
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.fillStyle = getComputedStyle(el as HTMLElement).color;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `rgb(${r}, ${g}, ${b})`;
  });
}

/**
 * Assert the theme-token contract on a lifecycle page: the `.dark` class
 * matches the requested theme, body background (--background) and a card
 * surface (--card, sampled via `.bg-card` like the account-viewport spec)
 * resolve to the correct family, and body text (--foreground) is dark in
 * light / light in dark. Returns the sampled colors for delta assertions.
 */
async function assertThemeTokens(
  page: Page,
  theme: 'light' | 'dark',
): Promise<{ body: string; card: string; text: string }> {
  const hasDark = await page.evaluate(() =>
    document.documentElement.classList.contains('dark'),
  );
  expect(hasDark, `documentElement .dark class should match ${theme} theme`).toBe(
    theme === 'dark',
  );

  const body = await sampleBackground(page, 'body');
  const card = await sampleBackground(page, '.bg-card');
  const textSample = await page.evaluate(() => {
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.fillStyle = getComputedStyle(document.body).color;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `rgb(${r}, ${g}, ${b})`;
  });

  if (theme === 'dark') {
    expect(channelSum(body), `dark body background should be graphite (got ${body})`).toBeLessThan(300);
    expect(channelSum(card), `dark card surface should be graphite (got ${card})`).toBeLessThan(300);
    expect(channelSum(textSample), `dark body text should be light (got ${textSample})`).toBeGreaterThan(450);
  } else {
    expect(channelSum(body), `light body background should be near-white (got ${body})`).toBeGreaterThan(600);
    expect(channelSum(card), `light card surface should be near-white (got ${card})`).toBeGreaterThan(600);
    expect(channelSum(textSample), `light body text should be dark (got ${textSample})`).toBeLessThan(300);
  }
  return { body, card, text: textSample };
}

/** No document-level horizontal overflow at the current viewport width. */
async function assertNoHorizontalOverflow(page: Page, viewportWidth: number) {
  const dims = await page.evaluate(() => ({
    docScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  for (const [name, scrollWidth] of [
    ['documentElement', dims.docScrollWidth],
    ['body', dims.bodyScrollWidth],
  ] as const) {
    expect(
      scrollWidth,
      `no ${name} horizontal overflow at ${viewportWidth}px ` +
        `(scrollWidth ${scrollWidth} > innerWidth ${dims.innerWidth})`,
    ).toBeLessThanOrEqual(dims.innerWidth + 1);
  }
}

/**
 * Verify the theme-token contract on a page: load, set the real theme storage
 * key, reload (drives the layout pre-paint script), then assert the token
 * contract, no horizontal overflow, and the page-specific data assertion.
 * Returns the sampled body color for light/dark delta proof. The caller
 * passes a page whose next navigation is either its first or an in-place
 * reload (safe in Firefox — see freshPage).
 */
async function verifyPageTheme(
  page: Page,
  url: string,
  theme: 'light' | 'dark',
  assertData: (page: Page) => Promise<void>,
): Promise<{ body: string; card: string; text: string }> {
  await page.goto(url);
  await page.evaluate(
    ([key, value]) => localStorage.setItem(key, value),
    [THEME_STORAGE_KEY, theme] as const,
  );
  await page.reload();
  const tokens = await assertThemeTokens(page, theme);
  await assertNoHorizontalOverflow(page, LAPTOP_VIEWPORT.width);
  await assertData(page);
  return tokens;
}

/**
 * Select an account through the sidebar global account selector. The first
 * dashboard visit in dev compiles the (workstation) route chunk, which can
 * delay the AccountProvider hydration past the default 5s expect timeout
 * (observed as a cold-start flake in the S09 combined chromium+firefox run
 * at line 437). Use the trades-identity-uat pattern (10s) with headroom.
 */
async function selectAccountOnDashboard(page: Page, name: string) {
  await expect(page.getByTestId('sidebar-account-trigger')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('sidebar-account-trigger').click();
  await page
    .getByRole('listbox')
    .getByRole('option', { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) })
    .click();
}

test.describe('M002 trading lifecycle browser UAT at laptop viewport', () => {
  test.describe.configure({ mode: 'serial' });

  test('full long lifecycle UI at 1366px laptop viewport', async ({ page, context }) => {
    await setLaptopViewport(page);

    // ── Seed: account + long trade, entry → add → reduce → close ──
    const account = await setupAccount(page, `M002 Long Lifecycle ${TS}`);
    const symbol = uniqueSymbol('LONGLIFE');
    const trade = await createTrade(page, account.id, {
      symbol,
      direction: 'long',
      thesis: 'Long lifecycle UAT thesis.',
      invalidationCondition: 'Invalidation below the opening-range low.',
      preTradePlan: 'Scale in after confirmation, respect the stop.',
    });
    await executeTrade(page, trade.id, {
      entryPrice: 100, entryQuantity: 10, stopPrice: 95, fees: 1,
    });
    await addExecution(page, trade.id, { action: 'add', quantity: 5, price: 102, fees: 0 });
    await addExecution(page, trade.id, { action: 'reduce', quantity: 3, price: 105, fees: 0 });
    await addExecution(page, trade.id, { action: 'sell', quantity: 12, price: 108, fees: 0 });

    // API truth for the UI assertions (same metrics the UI renders).
    const detail = await fetchTradeDetail(page, trade.id);
    expect(detail.status, 'trade should be closed after the full lifecycle').toBe('closed');
    const netPnl = Number(detail.metrics.realizedPnl.netRealizedPnl);
    const rMultiple = Number(detail.metrics.returnMetrics.rMultiple);
    expect(netPnl).toBeGreaterThan(0);
    const overview = await fetchAccountOverview(page, account.id);
    const projectedRealized = Number(overview.snapshot.realizedPnl);
    const projectedNav = Number(overview.snapshot.nav);
    expect(projectedRealized).toBeGreaterThan(0);

    // ── /trades: the closed trade in the Closed tab with P&L and R ──
    await page.goto('/trades');
    await hideDevOverlay(page);
    // Cold-compile headroom: the first /trades visit compiles the route chunk
    // in dev and the closed tab lazily fetches its rows — wait for the shell
    // to be interactive before interacting, then allow the fetch to land.
    await waitForAppShell(page);
    await expect(page.locator('h1')).toContainText('Trades');
    await page.getByRole('tab', { name: /closed/i }).click();
    const closedRow = page.locator('tbody tr').filter({ hasText: symbol });
    await expect(closedRow).toBeVisible({ timeout: 15_000 });
    await expect(closedRow).toContainText(fmtCurrency(netPnl));
    await expect(closedRow).toContainText(fmtRMultiple(rMultiple));
    await assertNoHorizontalOverflow(page, LAPTOP_VIEWPORT.width);

    // ── Trade detail (fresh page): closed state, no management actions,
    //    full lifecycle timeline ──
    const detailPage = await freshPage(context, `/trades/${trade.id}`);
    // The detail page renders no h1 while its data fetch is in flight, and the
    // first visit to a route compiles the chunk in dev — allow time to settle.
    await expect(detailPage.locator('h1')).toHaveText(symbol, { timeout: 15_000 });
    await expect(detailPage.locator('[data-slot="badge"]').filter({ hasText: 'Closed' }).first()).toBeVisible();
    const lifecyclePanel = detailPage.locator('.td-panel[data-area="lifecycle"]');
    for (const step of ['Plan', 'Size', 'Execute', 'Manage', 'Exit', 'Grade']) {
      await expect(lifecyclePanel.getByText(step, { exact: true })).toBeVisible();
    }
    const detailsPanel = detailPage.locator('.td-panel[data-area="details"]');
    await expect(detailsPanel.getByRole('button', { name: 'Add Fill' })).toHaveCount(0);
    await expect(detailsPanel.getByRole('button', { name: 'Adjust Stop' })).toHaveCount(0);
    await expect(detailsPanel.getByRole('button', { name: 'Adjust Target' })).toHaveCount(0);
    await expect(detailPage.getByText('Realized P&L', { exact: true })).toBeVisible();
    await assertNoHorizontalOverflow(detailPage, LAPTOP_VIEWPORT.width);
    await detailPage.screenshot({
      path: test.info().outputPath('long-lifecycle-detail.png'),
      fullPage: true,
    });
    await detailPage.close();

    // ── Dashboard (fresh page): Account State reflects the closed trade's
    //    P&L. The panel renders the accounting projection
    //    (account_performance.realized_pnl/nav), which reports realized P&L
    //    before allocated fees — distinct from the journal's net figure, so
    //    assert against the same projection API the panel renders.
    const dashPage = await freshPage(context, '/');
    const accountState = dashPage.getByTestId('ws-panel-account-state');
    // Cold-compile headroom: the first dashboard visit compiles the
    // workstation chunk in dev; the AccountProvider fetch resolves after
    // hydration (see selectAccountOnDashboard).
    await expect(accountState).toBeVisible({ timeout: 15_000 });
    await selectAccountOnDashboard(dashPage, account.name);
    await expect(accountState.getByTestId('ws-account-state-realized')).toContainText(fmtCurrency(projectedRealized));
    await expect(accountState.getByTestId('ws-account-state-nav')).toContainText(fmtCurrency(projectedNav));
    await assertNoHorizontalOverflow(dashPage, LAPTOP_VIEWPORT.width);
    await dashPage.close();

    // ── Account overview (fresh page): NAV reflects the trade's economics ──
    const overviewPage = await freshPage(context, `/settings/accounts/${account.id}`);
    await expect(overviewPage.getByText('Net Asset Value', { exact: true })).toBeVisible();
    const expectedNav = fmtCurrency(projectedNav);
    await expect(overviewPage.getByText(expectedNav, { exact: true }).first()).toBeVisible();
    await assertNoHorizontalOverflow(overviewPage, LAPTOP_VIEWPORT.width);
    await overviewPage.close();
  });

  test('full short lifecycle UI at 1366px laptop viewport', async ({ page, context }) => {
    await setLaptopViewport(page);

    // ── Seed: account + short trade, staged as a losing trade so the
    //    negative P&L identity (red text) is exercised ──
    const account = await setupAccount(page, `M002 Short Lifecycle ${TS}`);
    const symbol = uniqueSymbol('SHORTLIFE');
    const trade = await createTrade(page, account.id, {
      symbol,
      direction: 'short',
      thesis: 'Short lifecycle UAT thesis.',
      invalidationCondition: 'Cover above the opening-range high.',
      preTradePlan: 'Short the failed breakout.',
    });
    await executeTrade(page, trade.id, {
      entryPrice: 100, entryQuantity: 10, stopPrice: 105, fees: 1,
    });
    await addExecution(page, trade.id, { action: 'add', quantity: 5, price: 102, fees: 0 });
    await addExecution(page, trade.id, { action: 'reduce', quantity: 3, price: 104, fees: 0 });
    await addExecution(page, trade.id, { action: 'buy_to_cover', quantity: 12, price: 106, fees: 0 });

    const detail = await fetchTradeDetail(page, trade.id);
    expect(detail.status, 'short trade should be closed after the full lifecycle').toBe('closed');
    const netPnl = Number(detail.metrics.realizedPnl.netRealizedPnl);
    const rMultiple = Number(detail.metrics.returnMetrics.rMultiple);
    expect(netPnl).toBeLessThan(0);

    // ── /trades: Closed tab shows the losing short with negative P&L ──
    await page.goto('/trades');
    await hideDevOverlay(page);
    await waitForAppShell(page);
    await page.getByRole('tab', { name: /closed/i }).click();
    const closedRow = page.locator('tbody tr').filter({ hasText: symbol });
    await expect(closedRow).toBeVisible({ timeout: 15_000 });
    await expect(closedRow.getByText('Short', { exact: true })).toBeVisible();
    // Negative P&L renders in the red identity token (light theme red-600,
    // declared in oklch — read back through the canvas as true sRGB and
    // assert red dominance). Under cold-start dev load the row can still be
    // settling when it first becomes visible and the canvas round-trip can
    // transiently read black; poll until the red sample holds (bounded).
    const pnlText = fmtCurrency(netPnl);
    await expect
      .poll(async () => redHue(await sampleTextColor(closedRow.getByText(pnlText).first())), {
        message: `negative P&L should be red`,
        timeout: 10_000,
        intervals: [250, 500, 1000, 2000],
      })
      .toBe(true);
    await expect(closedRow).toContainText(fmtRMultiple(rMultiple));
    await assertNoHorizontalOverflow(page, LAPTOP_VIEWPORT.width);

    // ── Trade detail (fresh page): closed short, negative P&L visible ──
    const detailPage = await freshPage(context, `/trades/${trade.id}`);
    await expect(detailPage.locator('h1')).toHaveText(symbol, { timeout: 15_000 });
    await expect(detailPage.locator('[data-slot="badge"]').filter({ hasText: 'Closed' }).first()).toBeVisible();
    await expect(detailPage.getByText('Realized P&L', { exact: true })).toBeVisible();
    await expect(detailPage.getByText(pnlText).first()).toBeVisible();
    await assertNoHorizontalOverflow(detailPage, LAPTOP_VIEWPORT.width);
    await detailPage.screenshot({
      path: test.info().outputPath('short-lifecycle-detail.png'),
      fullPage: true,
    });
    await detailPage.close();
  });

  test('open trade management UI at 1366px laptop viewport', async ({ page, context }) => {
    await setLaptopViewport(page);

    // ── Seed: entry-only open trade (remains Open, management active) ──
    const account = await setupAccount(page, `M002 Open Mgmt ${TS}`);
    const symbol = uniqueSymbol('OPENTRADE');
    const trade = await createTrade(page, account.id, {
      symbol,
      direction: 'long',
      thesis: 'Open management UAT thesis.',
      invalidationCondition: 'Invalidation below the stop.',
      preTradePlan: 'Plan the entry, manage the position.',
    });
    await executeTrade(page, trade.id, {
      entryPrice: 100, entryQuantity: 10, stopPrice: 95, fees: 1,
    });
    const detail = await fetchTradeDetail(page, trade.id);
    expect(detail.status, 'entry-only trade should stay open').toBe('open');

    // ── Trade detail: management actions visible and usable at 1366 ──
    await page.goto(`/trades/${trade.id}`);
    await hideDevOverlay(page);
    await expect(page.locator('h1')).toHaveText(symbol, { timeout: 15_000 });
    await expect(page.locator('[data-slot="badge"]').filter({ hasText: 'Open' }).first()).toBeVisible();

    const detailsPanel = page.locator('.td-panel[data-area="details"]');
    const addFill = detailsPanel.getByRole('button', { name: 'Add Fill' });
    const adjustStop = detailsPanel.getByRole('button', { name: 'Adjust Stop' });
    const adjustTarget = detailsPanel.getByRole('button', { name: 'Adjust Target' });
    await expect(addFill).toBeVisible();
    await expect(adjustStop).toBeVisible();
    await expect(adjustTarget).toBeVisible();

    // Management controls fit inside the 1366px viewport with no overlap.
    const addFillBox = await addFill.boundingBox();
    const adjustStopBox = await adjustStop.boundingBox();
    const adjustTargetBox = await adjustTarget.boundingBox();
    expect(addFillBox).not.toBeNull();
    expect(adjustStopBox).not.toBeNull();
    expect(adjustTargetBox).not.toBeNull();
    for (const box of [addFillBox!, adjustStopBox!, adjustTargetBox!]) {
      expect(box.x, 'management control should start inside the viewport').toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, 'management control should end inside the viewport')
        .toBeLessThanOrEqual(LAPTOP_VIEWPORT.width);
    }
    // Add Fill sits above the stop/target rows (no overlap between rows).
    expect(adjustStopBox!.y).toBeGreaterThanOrEqual(addFillBox!.y + addFillBox!.height);
    // Stop and Target edit buttons live in separate stacked rows — the Target
    // row renders below the Stop row without overlap.
    expect(adjustTargetBox!.y).toBeGreaterThanOrEqual(adjustStopBox!.y + adjustStopBox!.height);

    // Lifecycle timeline shows all phases for the open trade.
    const lifecyclePanel = page.locator('.td-panel[data-area="lifecycle"]');
    for (const step of ['Plan', 'Size', 'Execute', 'Manage', 'Exit', 'Grade']) {
      await expect(lifecyclePanel.getByText(step, { exact: true })).toBeVisible();
    }
    await assertNoHorizontalOverflow(page, LAPTOP_VIEWPORT.width);

    // ── /trades (fresh page): Open tab shows the trade with management
    //    affordance ──
    const tradesPage = await freshPage(context, '/trades');
    await expect(tradesPage.locator('h1')).toContainText('Trades');
    await tradesPage.getByRole('tab', { name: /open/i }).click();
    const openRow = tradesPage.locator('tbody tr').filter({ hasText: symbol });
    await expect(openRow).toBeVisible({ timeout: 10_000 });
    await expect(openRow.getByText('Long', { exact: true })).toBeVisible();
    await assertNoHorizontalOverflow(tradesPage, LAPTOP_VIEWPORT.width);
    await tradesPage.close();
  });

  test('light and dark theme rendering across lifecycle pages at 1366px', async ({ page, context }) => {
    await setLaptopViewport(page);

    // ── Seed: one account with an open and a closed trade ──
    const account = await setupAccount(page, `M002 Theme Matrix ${TS}`);
    const openSymbol = uniqueSymbol('THEMEOPEN');
    const closeSymbol = uniqueSymbol('THEMECLOSE');
    const openTrade = await createTrade(page, account.id, {
      symbol: openSymbol, direction: 'long',
      thesis: 'Theme matrix open trade.', invalidationCondition: 'Below stop.', preTradePlan: 'Planned.',
    });
    await executeTrade(page, openTrade.id, {
      entryPrice: 100, entryQuantity: 10, stopPrice: 95, fees: 1,
    });
    const closedTrade = await createTrade(page, account.id, {
      symbol: closeSymbol, direction: 'long',
      thesis: 'Theme matrix closed trade.', invalidationCondition: 'Below stop.', preTradePlan: 'Planned.',
    });
    await executeTrade(page, closedTrade.id, {
      entryPrice: 180, entryQuantity: 50, exit1Price: 190, exit1Quantity: 50, fees: 3,
    });
    expect((await fetchTradeDetail(page, closedTrade.id)).status).toBe('closed');

    const lifecyclePages: Array<{
      name: string;
      url: string;
      assertData: (page: Page) => Promise<void>;
    }> = [
      {
        name: 'trades list',
        url: '/trades',
        assertData: async (p) => {
          // Open tab (default) shows the open trade; data renders in both themes.
          await expect(p.locator('tbody tr').filter({ hasText: openSymbol }).first()).toBeVisible({
            timeout: 10_000,
          });
          await expect(p.getByText('Open Positions Total')).toBeVisible();
        },
      },
      {
        name: 'dashboard',
        url: '/',
        assertData: async (p) => {
          await expect(p.getByTestId('ws-panel-risk')).toBeVisible();
          await expect(p.getByTestId('ws-panel-account-state')).toBeVisible();
        },
      },
      {
        name: 'trade detail',
        url: `/trades/${closedTrade.id}`,
        assertData: async (p) => {
          await expect(p.locator('h1')).toHaveText(closeSymbol, { timeout: 15_000 });
          await expect(p.locator('[data-slot="badge"]').filter({ hasText: 'Closed' }).first()).toBeVisible();
          await expect(p.getByText('Realized P&L', { exact: true })).toBeVisible();
        },
      },
    ];

    // 3 pages × 2 themes = 6 page visits, each verifying the token contract,
    // no horizontal overflow, and the page's data rendering. Each page gets
    // its own page object (in-place reloads are Firefox-safe).
    const lightSamples: Record<string, string> = {};
    const darkSamples: Record<string, string> = {};
    const pageErrors: string[] = [];

    for (const lifecyclePage of lifecyclePages) {
      const themePage = await context.newPage();
      await themePage.setViewportSize(LAPTOP_VIEWPORT);
      themePage.on('pageerror', (err) => pageErrors.push(String(err)));
      await test.step(`${lifecyclePage.name} in light theme`, async () => {
        const tokens = await verifyPageTheme(themePage, lifecyclePage.url, 'light', lifecyclePage.assertData);
        lightSamples[lifecyclePage.name] = tokens.body;
      });
      await test.step(`${lifecyclePage.name} in dark theme`, async () => {
        const tokens = await verifyPageTheme(themePage, lifecyclePage.url, 'dark', lifecyclePage.assertData);
        darkSamples[lifecyclePage.name] = tokens.body;
      });
      await themePage.close();
    }

    // Theme deltas are real token differences, not just class presence.
    for (const lifecyclePage of lifecyclePages) {
      expect(darkSamples[lifecyclePage.name], `${lifecyclePage.name} dark body differs from light`).not.toBe(
        lightSamples[lifecyclePage.name],
      );
    }
    // No uncaught page errors across any of the six theme×page visits.
    expect(pageErrors, 'no uncaught page errors in the theme matrix').toEqual([]);
  });
});
