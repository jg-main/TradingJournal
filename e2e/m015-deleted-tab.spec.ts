import { test, expect } from '@playwright/test';

/**
 * M015/S03: Deleted tab + leak prevention.
 *
 * R027/D057 contract: scratched (soft-deleted) trades are an explicit audit
 * view, reachable from the Trades list via the fourth "Deleted" tab. The API
 * opts in with ?status=deleted; every unfiltered consumer excludes them.
 *
 * This spec pins the browser-visible half of the contract (the API leak fixes
 * are pinned by route contract tests in T01/T02):
 *  1. The Deleted tab renders scratched trades with its own audit column set
 *     (planned-only fields), a count badge, a count-only "Scratched Trades"
 *     footer (no P&L aggregates for scratched rows), and the "Showing X of Y
 *     deleted trades" line.
 *  2. The Deleted tab shows the "No scratched trades" empty state when the
 *     account has none — and planned (unscratched) trades stay in the Planned
 *     tab.
 *  3. Navigation from a Deleted-tab row reaches DeletedPhaseView on the trade
 *     detail page ("This trade has been deleted" + Back to Trades).
 *  4. Leak prevention: scratched trades are absent from the unfiltered
 *     trades listing, from GET /api/dashboard KPIs (totalTrades), and from the
 *     export CSV — while visible via ?status=deleted.
 *
 * Seeding is done through the API (the scratch UI flow itself is covered by
 * m015-trade-scratch-ui.spec.ts); this spec focuses on the Deleted tab surface.
 *
 * Uses unique per-run symbols so leftover rows from prior runs (soft-deletes
 * persist in the shared test DB) never trip Playwright strict mode.
 *
 * Interaction robustness notes (learned building the S02 spec):
 *  - The trades page restores persisted filters after hydration (setTimeout +
 *    router.replace re-render); a tab click issued immediately after load can
 *    be dropped. Waiting for the Open tab's initial fetch to settle before
 *    clicking, then asserting aria-selected, makes the switch deterministic.
 *  - All tabs fetch on mount (debounced 300ms); the Deleted tab's count badge
 *    appears once its fetch settles with count > 0.
 */
const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Create a fully usable test account: creates the account, sets risk params,
 * activates it, and posts opening cash. Returns { id, name }.
 */
async function setupAccount(page: import('@playwright/test').Page, name: string) {
  const createResp = await page.request.post('/api/accounts', {
    data: { name: `${name} ${RUN_ID}`, currency: 'USD' },
  });
  expect(createResp.status()).toBe(201);
  const account = (await createResp.json()) as { id: string; name: string };

  // Set risk parameters
  const configResp = await page.request.put(`/api/accounts/${account.id}`, {
    data: { maxRiskPerTradePct: 2, defaultCommission: 1 },
  });
  expect(configResp.status()).toBe(200);

  // Activate the account
  const activateResp = await page.request.put(`/api/accounts/${account.id}`, {
    data: { isActive: true },
  });
  expect(activateResp.status()).toBe(200);

  // Post opening balance (the trade creation API requires a financial event)
  const cashResp = await page.request.post(`/api/accounts/${account.id}/financial-events`, {
    data: { eventType: 'opening_balance', amount: '50000.00' },
  });
  expect(cashResp.status()).toBe(201);

  return account;
}

/** Create a planned trade via the API; returns the created trade. */
async function createPlannedTrade(
  page: import('@playwright/test').Page,
  accountId: string,
  symbol: string,
) {
  const res = await page.request.post('/api/trades', {
    data: { symbol, direction: 'long', accountId },
  });
  expect(res.ok()).toBeTruthy();
  const trade = (await res.json()) as { id: string; status: string; symbol: string };
  expect(trade.status).toBe('planned');
  return trade;
}

/** Create a fully closed trade (execute + full exit) so it has real P&L. */
async function createClosedTrade(
  page: import('@playwright/test').Page,
  accountId: string,
  symbol: string,
) {
  const trade = await createPlannedTrade(page, accountId, symbol);
  const execRes = await page.request.post(`/api/trades/${trade.id}/execute`, {
    data: { entryPrice: 50, entryQuantity: 100, exit1Price: 55, exit1Quantity: 100, fees: 3 },
  });
  expect(execRes.ok()).toBeTruthy();
  const closed = (await execRes.json()).trade as { id: string; status: string };
  expect(closed.status).toBe('closed');
  return closed;
}

/** Scratch a planned trade via the API (DELETE contract: 200 'Trade scratched'). */
async function scratchTrade(page: import('@playwright/test').Page, tradeId: string) {
  const res = await page.request.delete(`/api/trades/${tradeId}`);
  expect(res.status()).toBe(200);
  expect(((await res.json()) as { message?: string }).message).toBe('Trade scratched');
}

/**
 * Switch to the Deleted tab on the Trades list page.
 *
 * The page restores persisted filters after hydration (setTimeout + a
 * filter-sync effect that calls router.replace), so a tab click issued
 * immediately after load can be dropped by the re-render. Wait for the Open
 * tab's initial fetch to settle (content text renders: either the
 * "Showing … open trades" line or the "No open trades" empty state) before
 * clicking, then assert aria-selected. When the account has scratched trades,
 * the Deleted tab's count badge is an extra settle signal.
 */
async function openDeletedTab(page: import('@playwright/test').Page) {
  // The Open tab is the default active tab; wait for its content to settle.
  const openTab = page.getByRole('tab', { name: /open/i });
  await expect(openTab).toHaveAttribute('aria-selected', 'true', { timeout: 10_000 });
  await expect(
    page
      .locator('text=/Showing\\s+[\\d,]+\\s+of\\s+[\\d,]+\\s+open\\s+trades/')
      .or(page.getByText('No open trades')),
  ).toBeVisible({ timeout: 15_000 });

  const deletedTab = page.getByRole('tab', { name: /deleted/i });
  // Optional badge wait: renders once the initial deleted fetch settles with
  // count > 0. When there are no scratched trades the fetch settles with 0 and
  // no badge appears — proceed either way.
  const badge = deletedTab.locator('span');
  try {
    await badge.waitFor({ state: 'visible', timeout: 5_000 });
  } catch {
    // No scratched trades — the deleted fetch has settled with count 0.
  }
  await deletedTab.click();
  await expect(deletedTab).toHaveAttribute('aria-selected', 'true', { timeout: 5_000 });
}

test.describe('M015 Deleted Tab', () => {
  test.describe.configure({ mode: 'serial' });

  test('Deleted tab renders scratched trades with audit columns, count badge, count-only footer, and DeletedPhaseView detail', async ({ page }) => {
    const account = await setupAccount(page, 'M015 Deleted Tab');
    const symbol = `DLL${RUN_ID}`; // ≤ 20 chars (trade symbol validation limit)
    const trade = await createPlannedTrade(page, account.id, symbol);
    await scratchTrade(page, trade.id);

    // Navigate to the trade log scoped to this account (the Deleted tab's
    // count badge and the footer/pagination counts are per-filter; leaving the
    // filter at 'all accounts' would aggregate scratched trades from other
    // tests sharing the run DB) and switch to the Deleted tab.
    await page.goto(`/trades?accountId=${account.id}`);
    await expect(page.locator('h1')).toContainText('Trades');
    await openDeletedTab(page);

    // The scratched trade renders in the Deleted tab with a count badge of 1
    const row = page.locator('tr').filter({ hasText: symbol }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    const deletedTab = page.getByRole('tab', { name: /deleted/i });
    await expect(deletedTab.locator('span')).toHaveText('1');

    // R027 audit column set: planned-only fields (scratched trades have no
    // executions, risk snapshots, or P&L — those columns are deliberately
    // omitted from the Deleted tab).
    const auditHeaders = [
      'Symbol',
      'Direction',
      'Setup',
      'Planned Date',
      'Planned Size',
      'Entry Trigger',
      'Stop',
      'Target',
      'Planned Risk',
    ];
    for (const header of auditHeaders) {
      await expect(page.locator('th').filter({ hasText: header })).toBeVisible();
    }
    // Metrics-derived columns must NOT appear in the audit view
    await expect(page.locator('th').filter({ hasText: 'Unrealized P&L' })).not.toBeVisible();
    await expect(page.locator('th').filter({ hasText: 'Net P&L' })).not.toBeVisible();

    // Pagination line: "Showing 1 of 1 deleted trades"
    await expect(
      page.locator('text=/Showing\\s+1\\s+of\\s+1\\s+deleted\\s+trades/'),
    ).toBeVisible({ timeout: 10_000 });

    // Count-only footer: 'Scratched Trades' heading with a Trades count of 1
    // and no P&L aggregates (scratched trades carry no realized/unrealized P&L).
    // The footer root is the nearest div ancestor of the heading.
    const footer = page
      .getByText('Scratched Trades', { exact: true })
      .locator('xpath=ancestor::div[1]');
    await expect(footer).toBeVisible();
    await expect(footer).toContainText('Trades');
    await expect(footer.getByText('1', { exact: true })).toBeVisible();
    await expect(footer).not.toContainText('Net P&L');
    await expect(footer).not.toContainText('Gross P&L');

    // Navigate from the list row to the trade detail → DeletedPhaseView
    await row.getByRole('link', { name: /View trade/ }).click();
    await expect(page).toHaveURL(new RegExp(`/trades/${trade.id}$`));
    await expect(page.locator('h1')).toContainText(symbol);
    // Scratched status badge on the detail header
    await expect(page.getByText('Deleted', { exact: true })).toBeVisible();
    // DeletedPhaseView terminal state + escape hatch. The detail page also
    // renders a page-level "Back to Trades" breadcrumb above the view, so the
    // DeletedPhaseView action is the LAST matching link.
    await expect(page.getByText('This trade has been deleted')).toBeVisible();
    const backLink = page.getByRole('link', { name: 'Back to Trades' }).last();
    await expect(backLink).toBeVisible();
    await backLink.click();
    await expect(page).toHaveURL(/\/trades\/?$/);

    // Leak prevention at the list level: the scratched trade must NOT appear
    // in the Planned tab (it was a planned trade before the scratch).
    const plannedTab = page.getByRole('tab', { name: /planned/i });
    const plannedBadge = plannedTab.locator('span');
    try {
      await plannedBadge.waitFor({ state: 'visible', timeout: 5_000 });
    } catch {
      // No planned trades — the planned fetch has settled with count 0.
    }
    await plannedTab.click();
    await expect(plannedTab).toHaveAttribute('aria-selected', 'true', { timeout: 5_000 });
    await expect(page.locator('tr').filter({ hasText: symbol })).not.toBeVisible({
      timeout: 10_000,
    });
  });

  test('Deleted tab shows the audit empty state when no trades were scratched', async ({ page }) => {
    const account = await setupAccount(page, 'M015 Deleted Empty');
    const symbol = `EMP${RUN_ID}`;
    // A planned trade that was NOT scratched — it must stay in the Planned tab.
    await createPlannedTrade(page, account.id, symbol);

    // Same account scoping as the first test: the Deleted tab empty state must
    // reflect THIS account, not deleted trades from other tests in the run DB.
    await page.goto(`/trades?accountId=${account.id}`);
    await expect(page.locator('h1')).toContainText('Trades');
    await openDeletedTab(page);

    // No count badge on the Deleted tab (zero scratched trades)
    const deletedTab = page.getByRole('tab', { name: /deleted/i });
    await expect(deletedTab.locator('span')).not.toBeVisible();

    // R027 empty state for the audit view
    await expect(page.getByText('No scratched trades')).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByText('Scratched trades appear here after you remove a planned trade. This is an audit view of soft-deleted trades.'),
    ).toBeVisible();

    // The unscratched planned trade remains in the Planned tab, not Deleted
    await expect(page.locator('tr').filter({ hasText: symbol })).not.toBeVisible();
    const plannedTab = page.getByRole('tab', { name: /planned/i });
    await plannedTab.click();
    await expect(plannedTab).toHaveAttribute('aria-selected', 'true', { timeout: 5_000 });
    await expect(page.locator('tr').filter({ hasText: symbol }).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test('leak prevention: dashboard KPI, export CSV, and unfiltered listing exclude scratched trades', async ({ page }) => {
    const account = await setupAccount(page, 'M015 Leak Guard');

    // One real closed trade (the KPI baseline) + one scratched planned trade
    const closed = await createClosedTrade(page, account.id, `LKP${RUN_ID}`);
    const scratched = await createPlannedTrade(page, account.id, `LKS${RUN_ID}`);
    await scratchTrade(page, scratched.id);

    // ── GET /api/dashboard: totalTrades must count only the closed trade ──
    const dashRes = await page.request.get(`/api/dashboard?accountId=${account.id}`);
    expect(dashRes.status()).toBe(200);
    const dash = (await dashRes.json()) as { kpis?: { totalTrades?: number } };
    expect(dash.kpis?.totalTrades).toBe(1);

    // ── GET /api/trades/export: CSV contains the closed trade only ──
    // (The CSV has Trade Code/Symbol columns, not the raw trade id, so the
    // assertions use the unique per-run symbols.)
    const csvRes = await page.request.get(`/api/trades/export?accountId=${account.id}`);
    expect(csvRes.status()).toBe(200);
    const csv = await csvRes.text();
    expect(csv).toContain(`LKP${RUN_ID}`);
    expect(csv).not.toContain(`LKS${RUN_ID}`);

    // ── GET /api/trades (unfiltered): scratched trade excluded ──
    const listRes = await page.request.get(`/api/trades?accountId=${account.id}`);
    expect(listRes.status()).toBe(200);
    const list = (await listRes.json()) as { data: Array<{ id: string; symbol: string }> };
    const listIds = list.data.map((t) => t.id);
    expect(listIds).toContain(closed.id);
    expect(listIds).not.toContain(scratched.id);

    // ── GET /api/trades?status=deleted: the audit opt-in still sees it ──
    const deletedRes = await page.request.get(
      `/api/trades?status=deleted&accountId=${account.id}`,
    );
    expect(deletedRes.status()).toBe(200);
    const deleted = (await deletedRes.json()) as { data: Array<{ id: string; status: string }> };
    const deletedIds = deleted.data.map((t) => t.id);
    expect(deletedIds).toContain(scratched.id);
    expect(deleted.data[0].status).toBe('deleted');
  });
});
