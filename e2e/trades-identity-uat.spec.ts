/**
 * M014 S06 T01 — Comprehensive Trades page identity UAT.
 *
 * The Trades page is the proving surface for the M014 Graphite + Steel Blue
 * visual identity. This spec seeds realistic data through the public API and
 * verifies, end to end in the browser:
 *
 *   1. Open tab — positive/negative unrealized P&L rendering (emerald/red),
 *      unpriced position indicator ("— Awaiting market price"),
 *      partial unrealized aggregate ("Partial — N unpriced"),
 *      portfolio heat values, and a partially-closed position (Size "100 / 50").
 *   2. Closed tab — gains and losses with the single-currency totals footer.
 *   3. Planned tab — long/short trades with valid/invalid planned-stop
 *      feedback and pagination (54 trades → 2 pages).
 *   4. Filters — direction (long/short/all), account selector, date presets —
 *      all persisted across reload via URL + localStorage.
 *   5. Action menus — correct items per status (planned: Edit; open:
 *      Add Exit/Adjust Stop; closed: Grade/Log Mistake; View Details always).
 *   6. Empty states for each tab when a filtered account has no trades.
 *   7. Loading skeleton during data fetch.
 *   8. Error state with a dismissible banner on API failure.
 *   9. Keyboard traversal — Tab through sidebar nav, header, filters, tabs,
 *      table rows and action menus, with a visible focus-visible indicator
 *      on every control, plus arrow-key tab switching.
 *  10. Light and dark themes via the `.dark` class on documentElement —
 *      Graphite surfaces + Steel Blue primary identity tokens verified at
 *      computed-style level, with rows still rendering in both themes.
 *
 * Determinism notes:
 *   - Open positions are priced by marking `trades.current_price` directly in
 *     the WAL SQLite DB (test-only seeding). All quote providers are
 *     network-backed, so the MTM refresh route is intentionally not used.
 *   - Every footer/count assertion is scoped through the sidebar account
 *     selection so leftover open trades from other specs running in the same
 *     DB cannot perturb totals.
 *
 * Run: npx playwright test e2e/trades-identity-uat.spec.ts --project=chromium
 */

import { test, expect, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { hideDevOverlay } from './helpers';
import { insertValidatedValuationMark } from '../src/lib/performance/valuation-repository';
import { rebuildAccountPerformance } from '../src/lib/performance/performance-rebuild';

const TS = Date.now();

// Mirror src/db/index.ts resolution plus the playwright.config.ts default so
// direct price marking writes to the same database the dev server uses.
const DB_FILE = process.env.DB_FILE_NAME || './.trading-journal/playwright-readiness.db';

// ── Seeding helpers ───────────────────────────────────────────────────

/**
 * Create a fully usable test account: create account, set risk params, and
 * initialize it through the canonical route (opening balance + activation).
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

  // Initialize the account: opening balance + activation in one server-side
  // transaction (A2).
  const initResp = await page.request.post(`/api/accounts/${account.id}/initialize`, {
    data: { mode: 'opening_balance', amount: '50000.00' },
  });
  expect(initResp.status(), 'initialization should succeed').toBe(201);

  return account;
}

async function createTrade(page: Page, accountId: string, data: Record<string, unknown>) {
  const symbol = String(data.symbol ?? 'trade');
  // Under fullyParallel execution, sibling specs seed the same SQLite
  // readiness DB, so transient SQLITE_BUSY ('database is locked') 500s can
  // surface mid-seed (the FILL-028 50-trade loop is the hottest spot). Retry
  // those with a short backoff; all other failures still fail immediately.
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const res = await page.request.post('/api/trades', {
      data: { accountId, ...data },
    });
    if (res.ok()) return (await res.json()) as { id: string };
    const details = await res.json().catch(() => null);
    const retryable =
      res.status() >= 500 && /sqlite_busy|database is locked/i.test(JSON.stringify(details ?? ''));
    if (!retryable) {
      expect(res.ok(), `trade creation for ${symbol} should succeed`).toBeTruthy();
      return (await res.json()) as { id: string };
    }
    await new Promise((r) => setTimeout(r, 200 * attempt));
  }
  throw new Error(`trade creation for ${symbol} failed after 4 retries`);
}

async function executeTrade(page: Page, id: string, data: Record<string, unknown>) {
  const res = await page.request.post(`/api/trades/${id}/execute`, { data });
  expect(res.ok(), `execute ${id} should succeed`).toBeTruthy();
  return res.json();
}

async function updateTrade(page: Page, id: string, data: Record<string, unknown>) {
  const res = await page.request.put(`/api/trades/${id}`, { data });
  expect(res.ok(), `update ${id} should succeed`).toBeTruthy();
  return res.json();
}

async function addExecution(page: Page, id: string, data: Record<string, unknown>) {
  const res = await page.request.post(`/api/trades/${id}/executions`, { data });
  expect(res.status(), `execution on ${id} should return 201`).toBe(201);
  return res.json();
}

/**
 * Mark deterministic current prices on open trades via a direct WAL-safe
 * SQLite write. Test-only seeding — the running dev server's connection sees
 * the committed WAL update on its next query, so the trades list API reports
 * the priced positions without any network dependency.
 */
function markOpenTradePrices(marks: { tradeId: string; price: number }[]) {
  const db = new Database(DB_FILE);
  try {
    const stmt = db.prepare(
      'UPDATE trades SET current_price = ?, current_price_fetched_at = ? WHERE id = ?',
    );
    const now = new Date().toISOString();
    for (const m of marks) {
      const res = stmt.run(m.price, now, m.tradeId);
      expect(res.changes, `price mark for trade ${m.tradeId} should hit one row`).toBe(1);
    }
  } finally {
    db.close();
  }
}

/**
 * Persist canonical valuation marks for the account's currently open positions
 * and rebuild the account performance projection through the PRODUCTION
 * functions, so a SUBSEQUENT first fill in the same account is risk-checked
 * against a complete marked valuation (frozen execution-equity contract: an
 * incomplete current projection is never usable execution equity, so a second
 * first fill while an earlier position is still open requires current marks).
 *
 * This is conceptually SEPARATE from markOpenTradePrices: valuation_marks +
 * account_performance drive execution-risk readiness, while trades.current_price
 * drives the Trades page's deterministic UI pricing. NOPX-style unpriced
 * browser states are preserved by leaving current_price unset.
 */
function markAccountPositionsForExecutionRisk(accountId: string, marks: { symbol: string; price: number }[]) {
  const db = new Database(DB_FILE);
  try {
    const nowIso = new Date().toISOString();
    for (const m of marks) {
      insertValidatedValuationMark(db, {
        accountId,
        instrumentSymbol: m.symbol,
        price: m.price,
        source: 'market_data',
        markTimestamp: nowIso,
      });
    }
    const rebuild = rebuildAccountPerformance(db, accountId);
    expect(rebuild.success, 'canonical projection rebuild after valuation marks should succeed').toBeTruthy();
  } finally {
    db.close();
  }
}

async function clearTradesStorage(page: Page) {
  await page.evaluate(() => {
    const keys = [
      'trades:direction', 'trades:fromDate', 'trades:toDate', 'trades:accountId', 'trades:preset',
      'trades:open:visibility', 'trades:open:sorting', 'trades:open:order',
      'trades:closed:visibility', 'trades:closed:sorting', 'trades:closed:order',
      'trades:planned:visibility', 'trades:planned:sorting', 'trades:planned:order',
    ];
    keys.forEach((k) => localStorage.removeItem(k));
  });
}

async function openTab(page: Page, name: 'open' | 'closed' | 'planned') {
  await page.getByRole('tab', { name: new RegExp(`^${name}`, 'i') }).click();
}

/**
 * Select a specific account through the canonical global sidebar account
 * selector (M007/D037). The sidebar AccountProvider is the single owner of
 * account scope — the trades page has no local account filter, so there is
 * nothing to debounce.
 */
async function selectSidebarAccount(page: Page, accountName: string) {
  const trigger = page.getByTestId('sidebar-account-trigger');
  await expect(trigger).toBeEnabled({ timeout: 15_000 });
  await trigger.click();
  await page.getByRole('option', { name: new RegExp(`^${accountName}$`) }).click();
  // Deterministic verification that AccountProvider adopted the selection.
  await expect(trigger).toContainText(accountName);
}

/** Select a direction in the page's Direction filter dropdown. */
async function selectDirectionFilter(page: Page, value: 'all' | 'long' | 'short') {
  await page.locator('#filter-direction').click();
  await page.getByRole('option', { name: new RegExp(`^${value}$`, 'i') }).click();
  // Same debounced all-tabs refetch as the account filter.
  await page.waitForTimeout(900);
}

function tradeRow(page: Page, symbol: string) {
  return page.locator('tbody tr').filter({ hasText: symbol });
}

// ── Computed-style helpers (identity token verification) ──────────────

function channelSum(rgb: string): number {
  const m = /rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(rgb);
  if (!m) return -1;
  return Number(m[1]) + Number(m[2]) + Number(m[3]);
}

function blueHue(rgb: string): boolean {
  const m = /rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(rgb);
  return !!m && Number(m[3]) > Number(m[1]);
}

function greenHue(rgb: string): boolean {
  const m = /rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(rgb);
  return !!m && Number(m[2]) > Number(m[1]) && Number(m[2]) > Number(m[3]);
}

function redHue(rgb: string): boolean {
  const m = /rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(rgb);
  return !!m && Number(m[1]) > Number(m[2]) && Number(m[1]) > Number(m[3]);
}

test.describe('M014 S06 — Trades page identity UAT', () => {
  // Serial within the file: tests share the dev server's SQLite DB and each
  // builds on a distinct seeded dataset, avoiding intra-file races.
  test.describe.configure({ mode: 'serial' });

  test('Open tab: positive/negative P&L, unpriced indicator, partial aggregate, portfolio heat', async ({ page }) => {
    const account = await setupAccount(page, `UAT-OPEN-A-${TS}`);

    const pos = await createTrade(page, account.id, { symbol: `POS-${TS}`, direction: 'long' });
    await executeTrade(page, pos.id, { entryPrice: 100, entryQuantity: 100, stopPrice: 95, fees: 5 });

    // POS is open and unmarked — the frozen execution-equity contract requires
    // a complete marked valuation before the NEXT first fill. Mark POS at the
    // same deterministic price the Trades UI later uses and rebuild.
    markAccountPositionsForExecutionRisk(account.id, [{ symbol: `POS-${TS}`, price: 110 }]);

    const neg = await createTrade(page, account.id, { symbol: `NEG-${TS}`, direction: 'short' });
    await executeTrade(page, neg.id, { entryPrice: 200, entryQuantity: 100, stopPrice: 210, fees: 5 });

    // Partially closed position: 100 entered, 50 sold → open qty 50.
    const part = await createTrade(page, account.id, { symbol: `PART-${TS}`, direction: 'long' });
    markAccountPositionsForExecutionRisk(account.id, [
      { symbol: `POS-${TS}`, price: 110 },
      { symbol: `NEG-${TS}`, price: 215 },
    ]);
    await executeTrade(page, part.id, { entryPrice: 50, entryQuantity: 100, stopPrice: 48, fees: 5 });
    await addExecution(page, part.id, { action: 'sell', quantity: 50, price: 55, fees: 2 });

    // Unpriced open position — no current price mark.
    const nopx = await createTrade(page, account.id, { symbol: `NOPX-${TS}`, direction: 'long' });
    markAccountPositionsForExecutionRisk(account.id, [
      { symbol: `POS-${TS}`, price: 110 },
      { symbol: `NEG-${TS}`, price: 215 },
      { symbol: `PART-${TS}`, price: 52 },
    ]);
    await executeTrade(page, nopx.id, { entryPrice: 30, entryQuantity: 100, stopPrice: 28, fees: 5 });

    markOpenTradePrices([
      { tradeId: pos.id, price: 110 }, // +$1,000 gross, $5 open fees → +$995.00 net
      { tradeId: neg.id, price: 215 }, // -$1,500 gross, $5 open fees → -$1,505.00 net
      { tradeId: part.id, price: 52 }, // remaining 50 @ +$2 → positive unrealized
    ]);

    await page.goto('/trades');
    await hideDevOverlay(page);
    await clearTradesStorage(page);
    await selectSidebarAccount(page, account.name);

    // Rows render for every open state.
    const posRow = tradeRow(page, `POS-${TS}`);
    const negRow = tradeRow(page, `NEG-${TS}`);
    const partRow = tradeRow(page, `PART-${TS}`);
    const nopxRow = tradeRow(page, `NOPX-${TS}`);
    for (const row of [posRow, negRow, partRow, nopxRow]) {
      await expect(row).toBeVisible({ timeout: 10_000 });
    }

    // Positive unrealized P&L renders with the emerald identity token.
    await expect(posRow.getByText('$995.00').first()).toBeVisible();
    await expect(posRow.locator('span.text-emerald-600').first()).toBeVisible();

    // Negative unrealized P&L renders with the red identity token.
    await expect(negRow.getByText('-$1,505.00').first()).toBeVisible();
    await expect(negRow.locator('span.text-red-600').first()).toBeVisible();

    // Partially-closed position: Size shows entry/exit quantities and P&L is positive.
    await expect(partRow.getByText('100 / 50')).toBeVisible();
    await expect(partRow.locator('span.text-emerald-600').first()).toBeVisible();

    // Unpriced position indicator on the row.
    await expect(nopxRow.getByText('— Awaiting market price')).toBeVisible();

    // Single-account scope so leftover open trades from other specs can't shift counts.
    await expect(page.getByText('Showing 4 of 4 open trades.')).toBeVisible();

    // Footer: partial unrealized aggregate (1 of 4 open positions unpriced).
    await expect(page.getByText('Open Positions Total')).toBeVisible();
    await expect(page.getByText('Partial — 1 unpriced')).toBeVisible();

    // Portfolio heat: deterministic open risk $1,800.00. The percentage is
    // UNAVAILABLE (M002-A9) — the account's intentionally unpriced NOPX open
    // position leaves no usable canonical equity denominator, so the footer
    // renders "—" rather than a legacy settings-based percentage.
    await expect(page.getByText('Portfolio Heat $', { exact: true })).toBeVisible();
    await expect(page.getByText('$1,800.00').first()).toBeVisible();
    await expect(page.getByText('Portfolio Heat %', { exact: true })).toBeVisible();
    const heatPctValue = page
      .getByText('Portfolio Heat %', { exact: true })
      .locator('xpath=following-sibling::*[1]');
    await expect(heatPctValue).toHaveText('—');

    // Open position count in the footer.
    await expect(page.getByText('Open Positions', { exact: true })).toBeVisible();
    await expect(page.getByText('4', { exact: true }).last()).toBeVisible();
  });

  test('Open tab: "Awaiting market prices" footer when every open position is unpriced', async ({ page }) => {
    const account = await setupAccount(page, `UAT-OPEN-B-${TS}`);

    const a = await createTrade(page, account.id, { symbol: `UNP1-${TS}`, direction: 'long' });
    await executeTrade(page, a.id, { entryPrice: 40, entryQuantity: 100, stopPrice: 38, fees: 5 });
    // a is open — mark it (canonical valuation) so b's first fill has complete
    // execution equity. The browser keeps BOTH positions unpriced: valuation
    // marks drive readiness only; trades.current_price drives the UI.
    markAccountPositionsForExecutionRisk(account.id, [{ symbol: `UNP1-${TS}`, price: 40 }]);
    const b = await createTrade(page, account.id, { symbol: `UNP2-${TS}`, direction: 'short' });
    await executeTrade(page, b.id, { entryPrice: 150, entryQuantity: 100, stopPrice: 155, fees: 5 });
    // No current-price marks — both positions stay unpriced in the browser.

    await page.goto('/trades');
    await hideDevOverlay(page);
    await clearTradesStorage(page);
    await selectSidebarAccount(page, account.name);

    await expect(tradeRow(page, `UNP1-${TS}`)).toBeVisible({ timeout: 10_000 });
    await expect(tradeRow(page, `UNP2-${TS}`)).toBeVisible();
    // Rows indicate the missing market mark.
    await expect(page.getByText('— Awaiting market price').first()).toBeVisible();
    // Aggregate is entirely unknown — never presented as a partial or zero.
    await expect(page.getByText('Awaiting market prices')).toBeVisible();
  });

  test('Closed tab: gains and losses render with the single-currency totals footer', async ({ page }) => {
    const account = await setupAccount(page, `UAT-CLOSED-${TS}`);

    const gain = await createTrade(page, account.id, { symbol: `GAIN-${TS}`, direction: 'long' });
    await executeTrade(page, gain.id, { entryPrice: 100, entryQuantity: 100, exit1Price: 120, exit1Quantity: 100, fees: 5 });

    const loss = await createTrade(page, account.id, { symbol: `LOSS-${TS}`, direction: 'short' });
    await executeTrade(page, loss.id, { entryPrice: 200, entryQuantity: 100, exit1Price: 220, exit1Quantity: 100, fees: 5 });

    await page.goto('/trades');
    await hideDevOverlay(page);
    await clearTradesStorage(page);
    await selectSidebarAccount(page, account.name);
    await openTab(page, 'closed');

    const gainRow = tradeRow(page, `GAIN-${TS}`);
    const lossRow = tradeRow(page, `LOSS-${TS}`);
    await expect(gainRow).toBeVisible({ timeout: 10_000 });
    await expect(lossRow).toBeVisible({ timeout: 10_000 });

    // Gain: +$2,000 gross, $5 fees → net +$1,995.00 emerald.
    await expect(gainRow.getByText('$1,995.00').first()).toBeVisible();
    await expect(gainRow.locator('span.text-emerald-600').first()).toBeVisible();

    // Loss: -$2,000 gross, $5 fees → net -$2,005.00 red.
    await expect(lossRow.getByText('-$2,005.00').first()).toBeVisible();
    await expect(lossRow.locator('span.text-red-600').first()).toBeVisible();

    // Single-currency totals footer: gross $0.00, fees $10.00, net -$10.00, 2 trades.
    // Scoped to the footer because 'Gross P&L'/'Fees'/'Net P&L' are also column headers.
    const closedFooter = page.getByText('Closed Trades Total').locator('..');
    await expect(closedFooter).toBeVisible();
    await expect(closedFooter.getByText('Gross P&L', { exact: true })).toBeVisible();
    await expect(closedFooter.getByText('$0.00', { exact: true })).toBeVisible();
    await expect(closedFooter.getByText('Fees', { exact: true })).toBeVisible();
    await expect(closedFooter.getByText('$10.00', { exact: true })).toBeVisible();
    await expect(closedFooter.getByText('Net P&L', { exact: true })).toBeVisible();
    await expect(closedFooter.getByText('-$10.00', { exact: true })).toBeVisible();
    await expect(closedFooter.getByText('Trades', { exact: true })).toBeVisible();
    await expect(closedFooter.getByText('2', { exact: true })).toBeVisible();
  });

  test('Planned tab: valid/invalid planned-stop feedback and pagination', async ({ page }) => {
    const account = await setupAccount(page, `UAT-PLAN-${TS}`);

    // Valid long: entry 100, stop 95, qty 50, target 115 → risk $250, R:R 1:3.0.
    await createTrade(page, account.id, {
      symbol: `VLNG-${TS}`, direction: 'long',
      plannedEntry: 100, plannedStop: 95, plannedQuantity: 50, plannedTarget1: 115,
    });
    // Invalid long: entry 100, stop 105 (above entry) → risk null → "—".
    const iLong = await createTrade(page, account.id, {
      symbol: `ILNG-${TS}`, direction: 'long', plannedEntry: 100, plannedQuantity: 50,
    });
    await updateTrade(page, iLong.id, { plannedStop: 105 });
    // Valid short: entry 200, stop 210, qty 50, target 180 → risk $500, R:R 1:2.0.
    await createTrade(page, account.id, {
      symbol: `VSHT-${TS}`, direction: 'short',
      plannedEntry: 200, plannedStop: 210, plannedQuantity: 50, plannedTarget1: 180,
    });
    // Invalid short: entry 200, stop 190 (below entry) → risk null → "—".
    const iShort = await createTrade(page, account.id, {
      symbol: `ISHT-${TS}`, direction: 'short', plannedEntry: 200, plannedQuantity: 50,
    });
    await updateTrade(page, iShort.id, { plannedStop: 190 });

    // 50 filler planned trades push the tab past one page (54 total).
    for (let i = 1; i <= 50; i += 1) {
      await createTrade(page, account.id, {
        symbol: `FILL-${String(i).padStart(3, '0')}`, direction: i % 2 === 0 ? 'short' : 'long',
      });
    }

    await page.goto('/trades');
    await hideDevOverlay(page);
    await clearTradesStorage(page);
    await selectSidebarAccount(page, account.name);
    await openTab(page, 'planned');

    // Page 1 shows the 50 newest (filler) trades.
    await expect(page.getByText('Showing 50 of 54 planned trades.')).toBeVisible({ timeout: 10_000 });
    const nextBtn = page.getByRole('button', { name: 'Next page' });
    const prevBtn = page.getByRole('button', { name: 'Previous page' });
    // Pagination control root also carries the 'Page X of Y' label.
    const pagination = nextBtn.locator('..').locator('..');
    await expect(pagination.getByText('Page 1 of 2')).toBeVisible();
    await expect(nextBtn).toBeEnabled();
    await expect(prevBtn).toBeDisabled();

    // Next page → the four specifically-shaped planned trades (oldest, created first).
    await nextBtn.click();
    await expect(page.getByText('Showing 4 of 54 planned trades.')).toBeVisible({ timeout: 10_000 });

    const vLongRow = tradeRow(page, `VLNG-${TS}`);
    const iLongRow = tradeRow(page, `ILNG-${TS}`);
    const vShortRow = tradeRow(page, `VSHT-${TS}`);
    const iShortRow = tradeRow(page, `ISHT-${TS}`);
    for (const row of [vLongRow, iLongRow, vShortRow, iShortRow]) {
      await expect(row).toBeVisible({ timeout: 10_000 });
    }

    // Valid stops surface computed risk and R:R.
    await expect(vLongRow.getByText('$250.00').first()).toBeVisible();
    await expect(vLongRow.getByText('1:3.0')).toBeVisible();
    await expect(vShortRow.getByText('$500.00').first()).toBeVisible();
    await expect(vShortRow.getByText('1:2.0')).toBeVisible();

    // Invalid stops show the stored stop but never a risk/R:R value.
    await expect(iLongRow.getByText('$105.00')).toBeVisible();
    await expect(iLongRow.getByText('$250.00')).toHaveCount(0);
    await expect(iLongRow.getByText('1:')).toHaveCount(0);
    await expect(iShortRow.getByText('$190.00')).toBeVisible();
    await expect(iShortRow.getByText('$500.00')).toHaveCount(0);
    await expect(iShortRow.getByText('1:')).toHaveCount(0);

    // Planned totals footer reflects the full filtered dataset. Scoped to the
    // footer because 'Planned Risk'/'Planned Capital' are also column headers.
    const plannedFooter = page.getByText('Planned Totals').locator('..');
    await expect(plannedFooter).toBeVisible();
    await expect(plannedFooter.getByText('Planned Risk', { exact: true })).toBeVisible();
    await expect(plannedFooter.getByText('$750.00')).toBeVisible();
    await expect(plannedFooter.getByText('Planned Capital', { exact: true })).toBeVisible();
    await expect(plannedFooter.getByText('$30,000.00')).toBeVisible();
    await expect(plannedFooter.getByText('54', { exact: true })).toBeVisible();

    // Previous returns to page 1.
    await prevBtn.click();
    await expect(pagination.getByText('Page 1 of 2')).toBeVisible({ timeout: 10_000 });
  });

  test('Filters: direction, account, date presets — persisted across reload', async ({ page }) => {
    const acctA = await setupAccount(page, `UAT-FLT-A-${TS}`);
    const acctB = await setupAccount(page, `UAT-FLT-B-${TS}`);

    // Account A: one planned long + one open long (priced).
    await createTrade(page, acctA.id, {
      symbol: `APLN-${TS}`, direction: 'long',
      plannedEntry: 10, plannedStop: 9, plannedQuantity: 100,
    });
    const aOpen = await createTrade(page, acctA.id, { symbol: `AOPN-${TS}`, direction: 'long' });
    await executeTrade(page, aOpen.id, { entryPrice: 20, entryQuantity: 100, stopPrice: 19, fees: 2 });
    markOpenTradePrices([{ tradeId: aOpen.id, price: 21 }]);

    // Account B: one planned short + one open short (priced).
    await createTrade(page, acctB.id, {
      symbol: `BPSH-${TS}`, direction: 'short',
      plannedEntry: 30, plannedStop: 31, plannedQuantity: 100,
    });
    const bOpen = await createTrade(page, acctB.id, { symbol: `BOPN-${TS}`, direction: 'short' });
    await executeTrade(page, bOpen.id, { entryPrice: 40, entryQuantity: 100, stopPrice: 41, fees: 2 });
    markOpenTradePrices([{ tradeId: bOpen.id, price: 42 }]);

    await page.goto('/trades');
    await hideDevOverlay(page);
    await clearTradesStorage(page);
    await openTab(page, 'planned');

    // ── Account selector narrows the dataset ─────────────────────────
    await selectSidebarAccount(page, acctB.name);
    await expect(tradeRow(page, `BPSH-${TS}`)).toBeVisible({ timeout: 10_000 });
    await expect(tradeRow(page, `APLN-${TS}`)).toHaveCount(0);

    await selectSidebarAccount(page, acctA.name);
    await expect(tradeRow(page, `APLN-${TS}`)).toBeVisible({ timeout: 10_000 });
    await expect(tradeRow(page, `BPSH-${TS}`)).toHaveCount(0);

    // ── Direction filter (scoped to account A which only has longs) ──
    await selectDirectionFilter(page, 'long');
    await expect(tradeRow(page, `APLN-${TS}`)).toBeVisible({ timeout: 10_000 });
    await selectDirectionFilter(page, 'short');
    await expect(tradeRow(page, `APLN-${TS}`)).toHaveCount(0);
    await selectDirectionFilter(page, 'all');
    await expect(tradeRow(page, `APLN-${TS}`)).toBeVisible({ timeout: 10_000 });

    // ── Date presets ─────────────────────────────────────────────────
    const ytd = `${new Date().getFullYear()}-01-01`;
    await page.getByRole('button', { name: 'YTD' }).click();
    await expect(page.locator('#filter-from')).toHaveValue(ytd);
    await expect(page).toHaveURL(new RegExp(`from=${ytd}`));
    // Planned trades created today still pass the YTD window.
    await expect(tradeRow(page, `APLN-${TS}`)).toBeVisible({ timeout: 10_000 });
    // Clear-date affordance appears and works.
    const clearBtn = page.getByTitle('Clear date filter');
    await expect(clearBtn).toBeVisible();
    await clearBtn.click();
    await expect(page.locator('#filter-from')).toHaveValue('');

    // ── Persistence across reload: account + direction + date preset ─
    await selectSidebarAccount(page, acctB.name);
    await selectDirectionFilter(page, 'short');
    await page.getByRole('button', { name: 'YTD' }).click();
    await expect(tradeRow(page, `BPSH-${TS}`)).toBeVisible({ timeout: 10_000 });

    await page.reload();
    await hideDevOverlay(page);
    // URL carries the full filter state.
    await expect(page).toHaveURL(new RegExp(`from=${ytd}`));
    await expect(page).toHaveURL(new RegExp(`accountId=${acctB.id}`));
    await expect(page).toHaveURL(/direction=short/);
    // Controls restore their values after accounts reload.
    await expect(page.locator('#filter-from')).toHaveValue(ytd);
    await expect(page.locator('#filter-direction')).toContainText('Short');
    await expect(page.locator('#filter-account')).toContainText(acctB.name, { timeout: 10_000 });
    // Filtered dataset is applied: B's short visible, A's long absent.
    await openTab(page, 'planned');
    await expect(tradeRow(page, `BPSH-${TS}`)).toBeVisible({ timeout: 10_000 });
    await expect(tradeRow(page, `APLN-${TS}`)).toHaveCount(0);
    // localStorage also carries the direction for plain sidebar navigation.
    const storedDirection = await page.evaluate(() => localStorage.getItem('trades:direction'));
    expect(storedDirection).toBe('short');
  });

  test('persisted filters hydrate without replacing the server-rendered trade shell', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('trades:fromDate', '2020-01-01');
      localStorage.setItem('trades:toDate', '');
      localStorage.setItem('trades:accountId', 'all');
      localStorage.setItem('trades:direction', 'short');
      localStorage.setItem('trades:preset', 'YTD');
    });

    const hydrationErrors: string[] = [];
    page.on('pageerror', (error) => {
      if (/hydration|server rendered html/i.test(error.message)) {
        hydrationErrors.push(error.message);
      }
    });

    await page.goto('/trades');
    await hideDevOverlay(page);

    await expect(page.locator('#filter-from')).toHaveValue('2020-01-01');
    await expect(page.locator('#filter-direction')).toContainText('Short');
    await expect(page.getByRole('button', { name: 'YTD' })).toHaveClass(/bg-primary/);
    await expect.poll(() => hydrationErrors).toEqual([]);
  });

  test('Action menus: correct items per trade status', async ({ page }) => {
    const account = await setupAccount(page, `UAT-MENU-${TS}`);

    await createTrade(page, account.id, { symbol: `MPLN-${TS}`, direction: 'long' });
    const open = await createTrade(page, account.id, { symbol: `MOPN-${TS}`, direction: 'long' });
    await executeTrade(page, open.id, { entryPrice: 10, entryQuantity: 100, stopPrice: 9, fees: 2 });
    // open is open — mark it so the closed trade's first fill has complete
    // execution equity.
    markAccountPositionsForExecutionRisk(account.id, [{ symbol: `MOPN-${TS}`, price: 10 }]);
    const closed = await createTrade(page, account.id, { symbol: `MCLS-${TS}`, direction: 'short' });
    await executeTrade(page, closed.id, { entryPrice: 10, entryQuantity: 100, exit1Price: 12, exit1Quantity: 100, fees: 2 });

    await page.goto('/trades');
    await hideDevOverlay(page);
    await clearTradesStorage(page);
    await selectSidebarAccount(page, account.name);

    const menuFor = async (symbol: string) =>
      tradeRow(page, symbol).getByRole('button', { name: 'Trade actions' });

    // ── Planned: View Details + Edit ─────────────────────────────────
    await openTab(page, 'planned');
    await expect(tradeRow(page, `MPLN-${TS}`)).toBeVisible({ timeout: 10_000 });
    await (await menuFor(`MPLN-${TS}`)).click();
    await expect(page.getByRole('menuitem', { name: 'View Details' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Edit', exact: true })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Add Exit' })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Adjust Stop' })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Grade' })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Log Mistake' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menuitem', { name: 'Edit' })).toHaveCount(0);

    // ── Open: View Details + Add Exit + Adjust Stop ──────────────────
    await openTab(page, 'open');
    await expect(tradeRow(page, `MOPN-${TS}`)).toBeVisible({ timeout: 10_000 });
    await (await menuFor(`MOPN-${TS}`)).click();
    await expect(page.getByRole('menuitem', { name: 'View Details' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Add Exit' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Adjust Stop' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Edit' })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Grade' })).toHaveCount(0);
    await page.keyboard.press('Escape');

    // ── Closed: View Details + Grade + Log Mistake ───────────────────
    await openTab(page, 'closed');
    await expect(tradeRow(page, `MCLS-${TS}`)).toBeVisible({ timeout: 10_000 });
    await (await menuFor(`MCLS-${TS}`)).click();
    await expect(page.getByRole('menuitem', { name: 'View Details' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Grade', exact: true })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Log Mistake' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Edit' })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Add Exit' })).toHaveCount(0);
    await page.keyboard.press('Escape');
  });

  test('Empty states render per tab when a filtered account has no trades', async ({ page }) => {
    const account = await setupAccount(page, `UAT-EMPTY-${TS}`);

    await page.goto('/trades');
    await hideDevOverlay(page);
    await clearTradesStorage(page);
    await selectSidebarAccount(page, account.name);

    await expect(page.getByRole('heading', { name: 'No open trades' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('You have no open positions. Open trades appear here once an execution is added.')).toBeVisible();

    await openTab(page, 'closed');
    await expect(page.getByRole('heading', { name: 'No closed trades' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Closed trades will appear here once you close a position and mark it complete.')).toBeVisible();

    await openTab(page, 'planned');
    await expect(page.getByRole('heading', { name: 'No planned trades' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Plan your next trade to see it here. Use the Plan Trade button to get started.')).toBeVisible();
  });

  test('Loading skeleton renders while trades are being fetched', async ({ page }) => {
    const account = await setupAccount(page, `SKEL-${TS}`);
    await createTrade(page, account.id, { symbol: `SKEL-${TS}`, direction: 'long' });

    // Delay the trades API so the skeleton is observable.
    await page.route('**/api/trades*', async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });

    await page.goto('/trades');
    await hideDevOverlay(page);
    await clearTradesStorage(page);

    // Skeleton rows render during the fetch.
    const skeleton = page.locator('[data-slot="skeleton"]');
    await expect(skeleton.first()).toBeVisible({ timeout: 5_000 });

    // Data arrives once the delayed fetch resolves. The seeded trade is
    // planned, so it appears on the Planned tab.
    await page.unroute('**/api/trades*');
    await openTab(page, 'planned');
    await expect(tradeRow(page, `SKEL-${TS}`)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0);
  });

  test('Error state: dismissible banner on API failure', async ({ page }) => {
    await page.route('**/api/trades*', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Seeded UAT failure' }),
      }),
    );

    await page.goto('/trades');
    await hideDevOverlay(page);
    await clearTradesStorage(page);

    await expect(page.getByText('Seeded UAT failure')).toBeVisible({ timeout: 10_000 });
    const dismiss = page.getByRole('button', { name: 'Dismiss error' });
    await expect(dismiss).toBeVisible();

    // Dismissing clears the banner; the tab then settles into its empty state.
    await dismiss.click();
    await expect(page.getByText('Seeded UAT failure')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'No open trades' })).toBeVisible({ timeout: 10_000 });

    await page.unroute('**/api/trades*');
  });

  test('Keyboard traversal: sidebar, header, filters, tabs, rows, action menus with focus-visible', async ({ page }) => {
    const account = await setupAccount(page, `UAT-KB-${TS}`);

    await createTrade(page, account.id, { symbol: `KBPL-${TS}`, direction: 'long' });
    const open = await createTrade(page, account.id, { symbol: `KBOP-${TS}`, direction: 'long' });
    await executeTrade(page, open.id, { entryPrice: 10, entryQuantity: 100, stopPrice: 9, fees: 2 });
    // open is open — mark it so the closed trade's first fill has complete
    // execution equity.
    markAccountPositionsForExecutionRisk(account.id, [{ symbol: `KBOP-${TS}`, price: 10 }]);
    const closed = await createTrade(page, account.id, { symbol: `KBCL-${TS}`, direction: 'short' });
    await executeTrade(page, closed.id, { entryPrice: 10, entryQuantity: 100, exit1Price: 12, exit1Quantity: 100, fees: 2 });

    await page.goto('/trades');
    await hideDevOverlay(page);
    await clearTradesStorage(page);
    await selectSidebarAccount(page, account.name);

    // Wait for sidebar chrome and filter controls to be interactive before walking.
    await expect(page.getByTestId('sidebar-account-trigger')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#filter-account')).toBeEnabled();
    await openTab(page, 'open');
    await expect(tradeRow(page, `KBOP-${TS}`)).toBeVisible({ timeout: 10_000 });

    // Start the walk from the document start. After the Radix select closed,
    // focus sits on the account trigger; Chrome keeps the sequential focus
    // navigation starting point at the last-focused element even after blur(),
    // so Tab would resume mid-document. Focusing <body> (via a temporary
    // tabindex) puts the starting point back at the top of the document.
    await page.evaluate(() => {
      const b = document.body;
      b.setAttribute('tabindex', '-1');
      b.focus();
    });

    interface FocusSnapshot {
      desc: string;
      focusVisible: boolean;
      indicator: boolean;
      isDateInput: boolean;
    }

    const seq: FocusSnapshot[] = [];
    for (let i = 0; i < 48; i += 1) {
      await page.keyboard.press('Tab');
      const snap = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const role = el.getAttribute('role');
        const aria = el.getAttribute('aria-label');
        const id = el.getAttribute('id');
        const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 50);
        const cs = getComputedStyle(el);
        const desc = [
          role ? `role=${role}` : null,
          aria ? `aria="${aria}"` : null,
          id ? `#${id}` : null,
          text ? `"${text}"` : null,
        ].filter(Boolean).join(' ');
        return {
          desc,
          focusVisible: el.matches(':focus-visible'),
          indicator: cs.outlineStyle !== 'none' || cs.boxShadow !== 'none',
          isDateInput: el instanceof HTMLInputElement && el.type === 'date',
        };
      });
      if (snap) seq.push(snap);
    }

    // Every keyboard-focused control must carry a visible focus indicator.
    // <input type="date"> is excluded: Chrome's native date input consumes
    // several Tab presses to navigate its internal calendar parts, during which
    // the host input keeps document.activeElement but :focus-visible does not
    // match — a user-agent behavior, not an app focus-ring gap. The date
    // input's own ring is verified separately below.
    for (const s of seq) {
      if (s.isDateInput) continue;
      expect(s.focusVisible, `:focus-visible must match on ${s.desc}`).toBe(true);
      expect(s.indicator, `visible focus ring/outline required on ${s.desc}`).toBe(true);
    }

    // Landmarks must be traversed in a logical document order. The walk is
    // adaptive: the native date inputs consume several Tab presses each to
    // navigate their internal calendar parts, so we keep tabbing until every
    // landmark has been seen (capped defensively at 80 presses).
    const landmarks = [
      'aria="Select account"', // sidebar account switcher
      '"Dashboard"',
      '"Watchlist"',
      '"Trades"',
      '"Reviews"',
      '"Checks"',
      '"Accounts"',
      '"Sizing"',
      '"Alerts"',
      '"Settings"',
      '"Help"',
      'aria="Toggle dark mode"',
      'aria="Collapse sidebar"',
      '"Plan Trade"',
      '"Export CSV"',
      '"Refresh Prices"',
      '#filter-from',
      '#filter-to',
      '"Max"',
      '"YTD"',
      '"1Y"',
      '"6M"',
      '"3M"',
      '"MTD"',
      '"1M"',
      '#filter-account',
      '#filter-direction',
      'role=tab',
      '"Columns"',
      `"KBOP-${TS}`,
      'aria="Trade actions"',
    ];
    for (let i = 0; i < 80 && !landmarks.every((l) => seq.some((s) => s.desc.includes(l))); i += 1) {
      await page.keyboard.press('Tab');
      const snap = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const role = el.getAttribute('role');
        const aria = el.getAttribute('aria-label');
        const id = el.getAttribute('id');
        const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 50);
        const desc = [
          role ? `role=${role}` : null,
          aria ? `aria="${aria}"` : null,
          id ? `#${id}` : null,
          text ? `"${text}"` : null,
        ].filter(Boolean).join(' ');
        return { desc };
      });
      if (snap) seq.push(snap as FocusSnapshot);
    }
    const idx = landmarks.map((l) => seq.findIndex((s) => s.desc.includes(l)));
    idx.forEach((ix, i) => {
      expect(ix, `landmark "${landmarks[i]}" should be reached in the tab order`).toBeGreaterThanOrEqual(0);
      if (i > 0) {
        expect(ix, `"${landmarks[i]}" should come after "${landmarks[i - 1]}"`).toBeGreaterThan(idx[i - 1]);
      }
    });

    // Date inputs have their own focus ring (focus-visible:ring-3) — verify it
    // directly, since the walk must skip their UA-internal Tab navigation.
    await page.locator('#filter-from').focus();
    const dateFocus = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const cs = getComputedStyle(el);
      return {
        fv: el.matches(':focus-visible'),
        ring: cs.boxShadow !== 'none' || cs.outlineStyle !== 'none',
      };
    });
    expect(dateFocus.fv, 'date input should match :focus-visible when focused').toBe(true);
    expect(dateFocus.ring, 'date input should show a visible focus ring').toBe(true);

    // Arrow-key roving tabindex: Open → Closed → Planned.
    await page.evaluate(() => {
      const tab = document.querySelector('[role="tab"]') as HTMLElement | null;
      tab?.focus();
    });
    await page.keyboard.press('ArrowRight');
    await expect
      .poll(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.textContent?.trim() ?? ''))
      .toContain('Closed');
    await page.keyboard.press('ArrowRight');
    await expect
      .poll(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.textContent?.trim() ?? ''))
      .toContain('Planned');

    // Action menu opens and closes with the keyboard. The roving-tabindex
    // walk above ended focused on the Planned tab (Open → Closed → Planned),
    // which activates that panel — return to the Open tab where the KBOP
    // open-position row lives.
    await openTab(page, 'open');
    await expect(tradeRow(page, `KBOP-${TS}`)).toBeVisible({ timeout: 10_000 });
    const actionBtn = tradeRow(page, `KBOP-${TS}`).getByRole('button', { name: 'Trade actions' });
    await actionBtn.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: 'Add Exit' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menuitem', { name: 'Add Exit' })).toHaveCount(0);
  });

  test('Light and dark themes apply the Graphite + Steel Blue identity', async ({ page }) => {
    const account = await setupAccount(page, `UAT-THEME-${TS}`);

    const longPos = await createTrade(page, account.id, { symbol: `THLG-${TS}`, direction: 'long' });
    await executeTrade(page, longPos.id, { entryPrice: 100, entryQuantity: 100, stopPrice: 95, fees: 5 });
    // longPos is open — mark it so the short's first fill has complete
    // execution equity.
    markAccountPositionsForExecutionRisk(account.id, [{ symbol: `THLG-${TS}`, price: 110 }]);
    const shortPos = await createTrade(page, account.id, { symbol: `THSH-${TS}`, direction: 'short' });
    await executeTrade(page, shortPos.id, { entryPrice: 200, entryQuantity: 100, stopPrice: 210, fees: 5 });
    markOpenTradePrices([
      { tradeId: longPos.id, price: 110 },
      { tradeId: shortPos.id, price: 215 },
    ]);

    await page.goto('/trades');
    await hideDevOverlay(page);
    await clearTradesStorage(page);
    await selectSidebarAccount(page, account.name);
    await expect(tradeRow(page, `THLG-${TS}`)).toBeVisible({ timeout: 10_000 });

    // M014 identity tokens are declared in oklch (Tailwind v4), so
    // getComputedStyle serializes them as lab(...)/oklch(...). Chrome's canvas
    // fillStyle getter preserves that color space (round-tripping the string
    // does NOT convert), so we draw the color into a 1x1 canvas and read the
    // pixel back — always true sRGB rgb(r, g, b). The channel/hue helpers
    // below stay format-agnostic.
    const bodyColor = () =>
      page.evaluate(() => {
        const ctx = document.createElement('canvas').getContext('2d')!;
        ctx.fillStyle = getComputedStyle(document.body).backgroundColor;
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        return `rgb(${r}, ${g}, ${b})`;
      });
    const sidebarColor = () =>
      page.locator('aside').evaluate((el) => {
        const ctx = document.createElement('canvas').getContext('2d')!;
        ctx.fillStyle = getComputedStyle(el as HTMLElement).backgroundColor;
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        return `rgb(${r}, ${g}, ${b})`;
      });
    const primaryColor = () =>
      page.getByRole('button', { name: 'Plan Trade' }).evaluate((el) => {
        const ctx = document.createElement('canvas').getContext('2d')!;
        ctx.fillStyle = getComputedStyle(el as HTMLElement).backgroundColor;
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        return `rgb(${r}, ${g}, ${b})`;
      });
    const posCellColor = () =>
      tradeRow(page, `THLG-${TS}`)
        .locator('span.text-emerald-600').first()
        .evaluate((el) => {
          const ctx = document.createElement('canvas').getContext('2d')!;
          ctx.fillStyle = getComputedStyle(el as HTMLElement).color;
          ctx.fillRect(0, 0, 1, 1);
          const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
          return `rgb(${r}, ${g}, ${b})`;
        });
    const negCellColor = () =>
      tradeRow(page, `THSH-${TS}`)
        .locator('span.text-red-600').first()
        .evaluate((el) => {
          const ctx = document.createElement('canvas').getContext('2d')!;
          ctx.fillStyle = getComputedStyle(el as HTMLElement).color;
          ctx.fillRect(0, 0, 1, 1);
          const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
          return `rgb(${r}, ${g}, ${b})`;
        });

    // ── Light theme (default, no .dark class) ────────────────────────
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(false);
    const lightBody = await bodyColor();
    const lightSidebar = await sidebarColor();
    const lightPrimary = await primaryColor();
    const lightPos = await posCellColor();
    const lightNeg = await negCellColor();
    // Near-white surface, light sidebar, steel-blue primary, emerald/red P&L.
    expect(channelSum(lightBody), `light body should be near-white (got ${lightBody})`).toBeGreaterThan(600);
    expect(channelSum(lightSidebar), `light sidebar should be light (got ${lightSidebar})`).toBeGreaterThan(600);
    expect(blueHue(lightPrimary), `light primary should be steel blue (got ${lightPrimary})`).toBe(true);
    expect(greenHue(lightPos), `positive P&L should be emerald (got ${lightPos})`).toBe(true);
    expect(redHue(lightNeg), `negative P&L should be red (got ${lightNeg})`).toBe(true);

    // ── Dark theme via the .dark class on documentElement ────────────
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(true);
    // The Plan Trade button carries `transition-colors` (150ms), so computed
    // style returns interpolated values mid-transition. Wait until the button
    // has actually reached its dark token before sampling the palette.
    await expect
      .poll(() => primaryColor(), 'primary button should settle on its dark token')
      .not.toBe(lightPrimary);

    const darkBody = await bodyColor();
    const darkSidebar = await sidebarColor();
    const darkPrimary = await primaryColor();
    const darkPos = await posCellColor();
    const darkNeg = await negCellColor();
    // Graphite surfaces: body and sidebar both dark.
    expect(channelSum(darkBody), `dark body should be graphite (got ${darkBody})`).toBeLessThan(300);
    expect(channelSum(darkSidebar), `dark sidebar should be graphite (got ${darkSidebar})`).toBeLessThan(300);
    // Steel-blue primary still blue, but a distinct (lighter) token than light mode.
    expect(blueHue(darkPrimary), `dark primary should stay steel blue (got ${darkPrimary})`).toBe(true);
    expect(darkPrimary).not.toBe(lightPrimary);
    // P&L identity tokens switch to their dark variants.
    expect(greenHue(darkPos), `dark positive P&L should stay emerald (got ${darkPos})`).toBe(true);
    expect(darkPos).not.toBe(lightPos);
    expect(redHue(darkNeg), `dark negative P&L should stay red (got ${darkNeg})`).toBe(true);
    expect(darkNeg).not.toBe(lightNeg);

    // The page still renders its data in dark mode.
    await expect(tradeRow(page, `THLG-${TS}`)).toBeVisible();
    await expect(page.getByText('Open Positions Total')).toBeVisible();

    // Toggling back removes the class and restores the light surface.
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(false);
    await expect
      .poll(() => primaryColor(), 'primary button should settle back on its light token')
      .toBe(lightPrimary);
    expect(await bodyColor()).toBe(lightBody);
  });
});
