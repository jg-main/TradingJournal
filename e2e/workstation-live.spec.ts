/**
 * M005-22kf6a S06 T04 — Live Mode E2E Playwright Verification
 *
 * Proves that the production root workstation connects to real /api/dashboard,
 * /api/dashboard/v2, /api/watchlist, and /api/accounts endpoints.
 * Account switching works end-to-end. Live MTM polling runs at 30s,
 * visibility-aware, gated on open positions > 0. All financial values
 * render correctly. The development fixture harness remains available for
 * deterministic scenario regression coverage.
 *
 * Uses the accounting execution flow (POST /api/accounts/:id/executions)
 * to create real accounting positions that populate the dashboard V2
 * valuation.positions array consumed by the workstation positions panel.
 *
 * Run: npx playwright test e2e/workstation-live.spec.ts --project=chromium
 */

import { expect, test, type APIRequestContext, type Page, type Request } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 } });

test.describe.configure({ mode: 'serial' });

// ── Shared state ──────────────────────────────────────────────────────────
let liveAccountId: string;
let liveAccountName: string;

// ── API helpers ───────────────────────────────────────────────────────────

async function ensureAppProfile(request: APIRequestContext) {
  const res = await request.put('/api/app-profile', {
    data: {
      displayName: 'Live Mode E2E',
      timezone: 'America/New_York',
      defaultCurrency: 'USD',
    },
  });
  expect(res.ok()).toBeTruthy();
}

async function createLiveAccount(
  request: APIRequestContext,
): Promise<{ id: string; name: string }> {
  const name = `Live E2E ${Date.now()}`;
  const res = await request.post('/api/accounts', {
    data: { name, broker: 'E2E Test', currency: 'USD' },
  });
  expect(res.status()).toBe(201);
  const account = (await res.json()) as { id: string };

  // Configure risk params and activate the account so the trade-creation API
  // (used by the dense Performance seeding in beforeAll) accepts it — the
  // route rejects accounts whose setup is incomplete.
  const configResp = await request.put(`/api/accounts/${account.id}`, {
    data: { maxRiskPerTradePct: 2, defaultCommission: 1 },
  });
  expect(configResp.status()).toBe(200);
  // Activation happens inside postOpeningBalance (initialize) — the opening
  // balance + activation are one server-side transaction (A2).

  return { id: account.id, name };
}

async function postOpeningBalance(request: APIRequestContext, id: string) {
  // Initialization endpoint (A2): opening balance + activation in one transaction.
  const res = await request.post(`/api/accounts/${id}/initialize`, {
    data: {
      mode: 'opening_balance',
      amount: '100000.00',
      description: 'E2E opening balance for live mode',
    },
  });
  expect(res.status()).toBe(201);
}

/**
 * Post an accounting execution (creates accounting_positions rows consumed
 * by the dashboard V2 valuation.positions array).
 */
async function postAccountingExecution(
  request: APIRequestContext,
  accountId: string,
  data: { symbol: string; action: string; quantity: string; price: string; fees?: string },
) {
  const res = await request.post(`/api/accounts/${accountId}/executions`, {
    data: {
      symbol: data.symbol,
      action: data.action,
      quantity: data.quantity,
      price: data.price,
      fees: data.fees ?? '0.00',
    },
  });
  expect(res.status()).toBe(201);
  return await res.json();
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
      source: 'user',
      markTimestamp: new Date().toISOString(),
    },
  });
  expect(res.status()).toBe(201);
  return await res.json();
}

async function rebuildPerformance(request: APIRequestContext, accountId: string) {
  const res = await request.post(`/api/accounts/${accountId}/performance`);
  expect(res.status()).toBe(200);
  return await res.json();
}

// ── Console / Request error capture ───────────────────────────────────────

function captureConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
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

function captureConsoleInfo(page: Page): string[] {
  const infos: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'info') {
      infos.push(msg.text());
    }
  });
  return infos;
}

interface RequestFailureEvent {
  request: Request;
  method: string;
  url: string;
  errorText: string;
}

function captureFailedRequests(
  page: Page,
  options: {
    /**
     * Optional classifier for intentional `net::ERR_ABORTED` lifecycle
     * cancellations. Evaluated LAZILY when `failures()` is read (after the
     * journey), so the ownership tracker has the complete request order.
     * Every other request failure and every HTTP error response stays
     * binding.
     */
    allowIntentionalAbort?: (failure: RequestFailureEvent) => boolean;
  } = {},
): { failures: () => string[] } {
  const rawFailures: RequestFailureEvent[] = [];
  const httpErrors: string[] = [];
  page.on('requestfailed', (req) => {
    rawFailures.push({
      request: req,
      method: req.method(),
      url: req.url(),
      errorText: req.failure()?.errorText ?? 'unknown',
    });
  });
  page.on('response', (res) => {
    if (!res.ok() && res.status() >= 400) {
      const url = res.url();
      if (
        !url.includes('/reconciliation') &&
        !url.includes('/migration') &&
        !url.includes('/close') &&
        !url.includes('/executions')
      ) {
        httpErrors.push(`${res.url()} (${res.status()})`);
      }
    }
  });
  return {
    failures: (): string[] => {
      const unexpected = rawFailures.filter(
        (failure) => !(options.allowIntentionalAbort?.(failure) ?? false),
      );
      return [
        ...unexpected.map((f) => `${f.method} ${f.url} (${f.errorText})`),
        ...httpErrors,
      ];
    },
  };
}

// ── Intentional account-switch cancellation classification ────────────────

/**
 * Paths whose requests the workstation intentionally aborts when the account
 * changes: `fetchAllLiveDashboardData` shares one AbortSignal across
 * /api/dashboard, /api/dashboard/v2, and /api/watchlist, and the MTM polling
 * lifecycle aborts its in-flight refresh (POST /api/trades/mtm/refresh) plus
 * its dashboard reload. Superseded batches surface as `net::ERR_ABORTED`
 * `requestfailed` events — expected transport behavior, not request failures.
 *
 * Route membership is only a SAFETY NARROWING, never the ownership proof:
 * the same paths are used by both the superseded and the newly selected
 * account, so an abort is classified as intentional ONLY when request
 * ownership says it was superseded.
 */
const WORKSTATION_LIVE_DATA_PATHS = [
  '/api/dashboard',
  '/api/dashboard/v2',
  '/api/watchlist',
  '/api/trades/mtm/refresh',
];

function isWorkstationLiveDataPath(url: string): boolean {
  try {
    return WORKSTATION_LIVE_DATA_PATHS.includes(new URL(url).pathname);
  } catch {
    return false;
  }
}

/** The accountId query parameter of a URL, or null when absent/unparseable. */
function urlAccountId(url: string): string | null {
  try {
    return new URL(url).searchParams.get('accountId');
  } catch {
    return null;
  }
}

/**
 * Track request start order and per-URL successors so the account-switch test
 * can draw an exact ownership boundary. Only concrete supersession evidence
 * counts:
 *  - the request started before the final account switch (pre-switch
 *    lifecycle), or
 *  - a NEWER request with the same URL started after it (e.g. the MTM polling
 *    lifecycle re-runs and supersedes its own in-flight dashboard reload), or
 *  - its URL names an account other than the final target (stale account
 *    work).
 * A request for the target account started after the switch with no successor
 * belongs to the target lifecycle and remains binding if it aborts.
 */
function trackWorkstationRequestOwnership(page: Page) {
  let seq = 0;
  let switched = false;
  let switchSeq = 0;
  const sequences = new Map<Request, number>();
  page.on('request', (req) => {
    seq += 1;
    sequences.set(req, seq);
  });
  return {
    /**
     * Mark the moment the target account selection is applied. Call
     * immediately before the switch action; any request that starts after
     * this point belongs to the newly selected target lifecycle.
     */
    markSwitch: (): void => {
      switched = true;
      switchSeq = seq;
    },
    /** True when the request started before the switch (pre-switch lifecycle). */
    isSuperseded: (req: Request): boolean => {
      const s = sequences.get(req);
      if (s === undefined) return false;
      if (!switched) return true; // switch not applied yet — still pre-switch
      return s <= switchSeq;
    },
    /**
     * True when a newer request with the SAME URL started after this request,
     * i.e. this request was superseded by its own lifecycle's successor (the
     * MTM polling reload re-run). A request with no such successor was the
     * latest of its kind and must not be ignored.
     */
    isSupersededByNewer: (req: Request): boolean => {
      const s = sequences.get(req);
      if (s === undefined) return false;
      const url = req.url();
      for (const [other, otherSeq] of sequences) {
        if (other !== req && otherSeq > s && other.url() === url) {
          return true;
        }
      }
      return false;
    },
  };
}

/**
 * Pure ownership classifier: a failed request is the intentional cancellation
 * of a superseded workstation live-data request ONLY when it terminated with
 * `net::ERR_ABORTED`, is on a workstation live-data route, AND it started
 * before the switch, OR a newer request for the same URL followed it, OR its
 * URL names an account other than the target (stale account work).
 *
 * A request for the TARGET account started after the switch with no newer
 * same-URL successor — including the newest target `/api/dashboard`,
 * `/api/dashboard/v2`, `/api/watchlist`, or `/api/trades/mtm/refresh` request
 * — is never intentional and stays a binding failure. Neither a prior
 * same-URL success nor the proximity of another failure is ownership
 * evidence. Route membership is only a safety narrowing, never the ownership
 * proof.
 */
function isSupersededLifecycleAbort(
  startedBeforeSwitch: boolean,
  supersededByNewer: boolean,
  errorText: string,
  url: string,
  targetAccountId: string,
): boolean {
  if (errorText !== 'net::ERR_ABORTED') return false;
  if (!isWorkstationLiveDataPath(url)) return false;
  if (startedBeforeSwitch || supersededByNewer) return true;
  const acct = urlAccountId(url);
  if (acct !== null && acct !== targetAccountId) return true; // stale account work
  return false;
}

/**
 * Build the lazy abort classifier for the account-switch journey. It allows
 * only superseded workstation live-data aborts (per
 * `isSupersededLifecycleAbort`); failure timestamps, same-batch proximity,
 * and prior same-URL success are NOT used as ownership evidence.
 */
function buildSwitchAbortClassifier(
  ownership: ReturnType<typeof trackWorkstationRequestOwnership>,
  targetAccountId: string,
): (failure: RequestFailureEvent) => boolean {
  return (failure) =>
    isSupersededLifecycleAbort(
      ownership.isSuperseded(failure.request),
      ownership.isSupersededByNewer(failure.request),
      failure.errorText,
      failure.url,
      targetAccountId,
    );
}

async function selectApplicationAccount(
  page: Page,
  accountId: string,
  accountName: string,
) {
  const accountSelect = page
    .getByRole('complementary')
    .getByLabel('Select account');
  await expect(accountSelect).toBeVisible();

  if (!(await accountSelect.textContent())?.includes(accountName)) {
    const dataResponse = page.waitForResponse(
      (res) =>
        res.url().includes('/api/dashboard') &&
        res.url().includes(`accountId=${accountId}`) &&
        res.ok(),
    );
    await accountSelect.click();
    await page
      .getByRole('option', { name: `${accountName} (E2E Test)`, exact: true })
      .click();
    await dataResponse;
  }

  await expect(page.getByTestId('ws-external-account')).toHaveText(accountName);
  return accountSelect;
}

/**
 * Select the Process Review system template via the view switcher (M018/S02:
 * Process Review is a dedicated saved view, not part of the curated default).
 * Pattern from m006-freshness-verify.spec.ts — the Radix dropdown is modal,
 * so close an open menu via Escape first.
 */
async function selectProcessReviewView(page: Page) {
  const trigger = page.getByTestId('ws-view-switcher-trigger');
  const content = page.getByTestId('ws-view-switcher-content');
  if (await content.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
    await expect(content).toHaveCount(0);
  }
  await trigger.click();
  await expect(content).toBeVisible({ timeout: 3_000 });
  await page.getByTestId('ws-view-item-ws-system-process-review').click();
  await expect(content).toHaveCount(0);
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Live Mode E2E', () => {
  // ── Setup: create account with opening balance + open position ──────
  test.beforeAll(async ({ request }) => {
    await ensureAppProfile(request);
    const liveAccount = await createLiveAccount(request);
    liveAccountId = liveAccount.id;
    liveAccountName = liveAccount.name;
    await postOpeningBalance(request, liveAccountId);

    // Post accounting execution to create an open position (AAPL long 100 shares @ $175).
    await postAccountingExecution(request, liveAccountId, {
      symbol: 'AAPL',
      action: 'buy',
      quantity: '100.00',
      price: '175.00',
      fees: '5.00',
    });

    // Mark AAPL at $180.00 so there is unrealized P&L.
    await postValuationMark(request, liveAccountId, 'AAPL', '180.00');

    // Account positions retain unsigned quantities for both sides. Seed a
    // profitable short through the live API so the browser journey proves
    // the dashboard's direction-aware valuation rather than a fixture-only
    // arithmetic path.
    await postAccountingExecution(request, liveAccountId, {
      symbol: 'SHRT',
      action: 'sell_short',
      quantity: '5.00',
      price: '100.00',
    });
    await postValuationMark(request, liveAccountId, 'SHRT', '90.00');

    // Dense S02: seed a closed trade so the Performance summary-row stat
    // rows populate with live KPI data (hasData = kpis.totalTrades > 0).
    // Without a closed trade the panel renders its compact empty state and
    // the populated-row assertions below would fail by design.
    const closedTradeRes = await request.post('/api/trades', {
      data: { symbol: 'CLSD', direction: 'long', accountId: liveAccountId },
    });
    expect(closedTradeRes.ok()).toBeTruthy();
    const closedTrade = (await closedTradeRes.json()) as { id: string };
    const enterRes = await request.post(`/api/trades/${closedTrade.id}/execute`, {
      data: { entryPrice: 100.0, entryQuantity: 10, stopPrice: 95.0, fees: 1.0 },
    });
    expect(enterRes.ok()).toBeTruthy();
    const exitRes = await request.post(`/api/trades/${closedTrade.id}/executions`, {
      data: { action: 'sell', quantity: 10, price: 110.0, fees: 1.0 },
    });
    expect(exitRes.status()).toBe(201);

    // Rebuild performance projection so dashboard V2 has positions. The
    // closed CLSD trade above also leaves a flat (quantity 0.00) accounting
    // projection row that the rebuild counts, so assert the two open
    // positions are covered rather than pinning an exact total.
    const rebuildResult = await rebuildPerformance(request, liveAccountId);
    expect(rebuildResult.success).toBe(true);
    expect(rebuildResult.positionCount).toBeGreaterThanOrEqual(2);
  });

  // ── Test 1: Live mode renders LIVE badge, not FIXTURE badge ─────────
  test('live mode renders LIVE badge and hides scenario switcher', async ({
    page,
  }) => {
    const consoleErrors = captureConsoleErrors(page);
    const failedRequests = captureFailedRequests(page);

    await page.goto('/', { waitUntil: 'networkidle' });

    const toolbar = page.getByTestId('ws-toolbar');
    await expect(toolbar).toBeVisible();

    // Account selector is populated with real accounts. Select the seeded
    // account so the badge proves an actively refreshing, live position set.
    const accountSelect = await selectApplicationAccount(
      page,
      liveAccountId,
      liveAccountName,
    );
    await expect(accountSelect).toContainText(liveAccountName);
    await expect(page.getByTestId('ws-mtm-active')).toBeVisible({ timeout: 15_000 });

    // LIVE badge visible, FIXTURE badge absent.
    await expect(page.getByTestId('ws-live-badge')).toBeVisible();
    await expect(page.getByTestId('ws-live-badge')).toHaveText('LIVE');
    await expect(page.getByTestId('ws-fixture-badge')).not.toBeVisible();

    // Scenario switcher hidden in live mode.
    await expect(page.getByTestId('ws-scenario-select')).not.toBeVisible();

    expect(consoleErrors).toEqual([]);
    expect(failedRequests.failures()).toEqual([]);
  });

  // ── Test 2: Curated grid panels render in one document-scroll flow ───
  test('curated grid panels render without horizontal overflow', async ({
    page,
  }) => {
    const consoleErrors = captureConsoleErrors(page);

    await page.goto('/', { waitUntil: 'networkidle' });

    const grid = page.getByTestId('ws-grid');
    await expect(grid).toBeVisible();

    // M018/S02 curated default (Risk & Positions): risk, positions (the
    // Trades workspace), account-state, and performance. Process Review is
    // NOT part of the default catalogue — it lives in its own system view.
    const GRID_AREAS = [
      'account-state',
      'positions',
      'risk',
      'performance',
    ] as const;
    for (const area of GRID_AREAS) {
      const panel = page.getByTestId(`ws-panel-${area}`);
      await expect(panel).toBeVisible();
      const box = await panel.boundingBox();
      expect(box, `panel ${area} has layout box`).not.toBeNull();
      expect(box!.x, `panel ${area} inside left edge`).toBeGreaterThanOrEqual(0);
      expect(box!.y, `panel ${area} inside top edge`).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, `panel ${area} inside right edge`).toBeLessThanOrEqual(1440);
    }

    // The curated default excludes Process Review (dedicated system view)
    // and Watchlist (own surface).
    await expect(page.getByTestId('ws-panel-process-review')).toHaveCount(0);
    await expect(page.getByTestId('ws-panel-watchlist')).toHaveCount(0);

    // Risk & Positions uses the browser document as its normal scroll path.
    const scroll = await page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
    }));
    expect(scroll.scrollHeight).toBeGreaterThan(scroll.clientHeight);

    expect(consoleErrors).toEqual([]);
  });

  // ── Test 3: Live data populates data panels and account state ─────────
  test('live data populates data panels and account state', async ({
    page,
  }) => {
    const consoleErrors = captureConsoleErrors(page);
    const failedRequests = captureFailedRequests(page);

    await page.goto('/', { waitUntil: 'networkidle' });
    await selectApplicationAccount(page, liveAccountId, liveAccountName);

    // Dense S02: the KPI band was removed from the workstation catalogue —
    // period KPIs now live in the Performance panel stat rows.
    await expect(page.getByTestId('ws-panel-kpis')).toHaveCount(0);
    const performance = page.getByTestId('ws-panel-performance');
    await expect(performance.getByTestId('ws-performance-empty')).toHaveCount(0);
    await expect(performance.getByTestId('ws-perf-net-pnl')).toBeVisible();

    // Positions panel shows real rows from the accounting position.
    const positions = page.getByTestId('ws-panel-positions');
    await expect(positions.locator('tbody tr').first()).toBeVisible({ timeout: 10000 });
    // AAPL should show in the positions table.
    await expect(positions.getByText('AAPL')).toBeVisible();

    // Account State panel: stat cells render live values; the equity chart
    // is removed from the summary row (M017/S02 dense contract — it moves to
    // the future analysis workspace).
    const accountState = page.getByTestId('ws-panel-account-state');
    await expect(accountState.getByTestId('ws-account-state-nav')).toBeVisible();
    await expect(accountState.getByTestId('ws-account-state-nav').locator('.ws-num')).toContainText('$');
    await expect(accountState.getByTestId('ws-equity-chart')).toHaveCount(0);
    await expect(accountState.getByTestId('ws-equity-chart-empty')).toHaveCount(0);

    // Risk panel has metric content.
    const risk = page.getByTestId('ws-panel-risk');
    await expect(risk.getByText('Portfolio heat')).toBeVisible({ timeout: 10000 });
    const riskCells = risk.locator('.ws-risk-cell');
    const riskCellCount = await riskCells.count();
    expect(riskCellCount).toBeGreaterThan(0);

    // Process Review is not part of the curated default; select its
    // dedicated system view (M018/S02), then assert the panel renders
    // (discipline + attention catalogue) with the live account data.
    await selectProcessReviewView(page);
    await expect(page.getByTestId('ws-panel-process-review')).toBeVisible();

    expect(consoleErrors).toEqual([]);
    expect(failedRequests.failures()).toEqual([]);
  });

  // ── Test 4: Trades workspace tabs switch open/closed universes ────────
  test('trades workspace tabs switch between open and closed universes', async ({
    page,
  }) => {
    const consoleErrors = captureConsoleErrors(page);
    const failedRequests = captureFailedRequests(page);

    await page.goto('/', { waitUntil: 'networkidle' });
    await selectApplicationAccount(page, liveAccountId, liveAccountName);

    // Tab labels pin their real universe (M017/S03).
    const openTab = page.getByTestId('ws-trades-tab-open');
    await expect(openTab).toBeVisible();
    await expect(openTab).toContainText('Open positions');
    const closedTab = page.getByTestId('ws-trades-tab-closed');
    await expect(closedTab).toBeVisible();
    await expect(closedTab).toContainText('Closed trades');

    // Open tab is the default active content with the live open table.
    await expect(page.getByTestId('ws-trades-open-content')).toHaveAttribute(
      'data-state',
      'active',
    );
    await expect(page.getByTestId('ws-positions-table')).toBeVisible();

    // Switch to Closed: the seeded CLSD trade is the only closed trade for
    // this account, and the footer total is the server-computed
    // closed-universe total (never an open/current account figure).
    await closedTab.click();
    await expect(page.getByTestId('ws-trades-closed-content')).toHaveAttribute(
      'data-state',
      'active',
    );
    await expect(page.getByTestId('ws-trades-closed-table')).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByTestId('ws-trades-closed-row-CLSD')).toBeVisible();
    // The universe line states what is shown; the footer label names the
    // exact scope of the figure.
    await expect(page.getByTestId('ws-trades-closed-scope')).toContainText(
      'closed trades',
    );
    await expect(page.getByTestId('ws-trades-closed-totals')).toContainText(
      'Net P&L · all closed trades',
    );
    await expect(page.getByTestId('ws-trades-closed-net-pnl')).toContainText('$');

    // One universe at a time: the open table is not visible while Closed
    // is the active content.
    await expect(page.getByTestId('ws-positions-table')).not.toBeVisible();

    // Switch back to Open: the current open workflow returns with its rows.
    await openTab.click();
    await expect(page.getByTestId('ws-trades-open-content')).toHaveAttribute(
      'data-state',
      'active',
    );
    await expect(page.getByTestId('ws-positions-table')).toBeVisible();
    await expect(page.getByTestId('ws-position-row-AAPL')).toBeVisible();

    expect(consoleErrors).toEqual([]);
    expect(failedRequests.failures()).toEqual([]);
  });

  test('live dashboard values a positive-quantity short position directionally', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await selectApplicationAccount(page, liveAccountId, liveAccountName);

    const shortRow = page.getByTestId('ws-position-row-SHRT');
    await expect(shortRow).toBeVisible({ timeout: 10000 });
    await expect(shortRow.getByTestId('ws-position-cell-side')).toContainText('S 5.00');
    await expect(shortRow.getByTestId('ws-position-cell-pnl')).toHaveText('$50.00');
  });

  // ── Test 5: Account switching re-fetches live data ──────────────────
  test('account switching re-fetches live data and updates panels', async ({
    page,
    request,
  }) => {
    const consoleErrors = captureConsoleErrors(page);

    // Track request start order so the intentional-cancellation allowance is
    // scoped by request OWNERSHIP, not by route: the workstation aborts the
    // superseded live-data lifecycle when the account changes, but a request
    // for the newly selected account must never be ignored.
    const ownership = trackWorkstationRequestOwnership(page);

    // Create the second (target) account with different data. Give it the
    // SAME number of open positions as the live account (AAPL + SHRT = 2): the
    // workstation MTM polling effect re-runs when liveData.positions.length
    // changes, and that re-run aborts the target's own in-flight dashboard
    // reload — leaving an intentional-but-successorless abort that the strict
    // ownership classifier (correctly) treats as binding. Equal counts keep
    // the lifecycle stable so the journey exercises only the superseded
    // pre-switch cancellations.
    const secondAccount = await createLiveAccount(request);
    const secondAccountId = secondAccount.id;
    await postOpeningBalance(request, secondAccountId);
    await postAccountingExecution(request, secondAccountId, {
      symbol: 'MSFT',
      action: 'buy',
      quantity: '50.00',
      price: '310.00',
      fees: '3.00',
    });
    await postValuationMark(request, secondAccountId, 'MSFT', '320.00');
    await postAccountingExecution(request, secondAccountId, {
      symbol: 'NFLX',
      action: 'buy',
      quantity: '20.00',
      price: '600.00',
      fees: '2.00',
    });
    await postValuationMark(request, secondAccountId, 'NFLX', '610.00');
    await rebuildPerformance(request, secondAccountId);

    const failedRequests = captureFailedRequests(page, {
      allowIntentionalAbort: buildSwitchAbortClassifier(ownership, secondAccountId),
    });

    // Regression: the classifier is scoped to SUPERSEDED requests only, using
    // ONLY concrete ownership evidence: started-before-switch, a newer
    // same-URL successor, or an accountId naming a non-target account.
    // Failure timestamps and prior same-URL success are NOT ownership
    // evidence. The TARGET lifecycle's LATEST request stays binding if it
    // aborts. Route membership is only a safety narrowing.
    const TARGET = 'TARGET-ACCOUNT';
    // A. OLD dashboard started before switch → allowed.
    expect(
      isSupersededLifecycleAbort(true, false, 'net::ERR_ABORTED', 'http://localhost/api/dashboard?accountId=OLD', TARGET),
    ).toBe(true);
    // B. OLD dashboard-v2 started before switch → allowed.
    expect(
      isSupersededLifecycleAbort(true, false, 'net::ERR_ABORTED', 'http://localhost/api/dashboard/v2?accountId=OLD', TARGET),
    ).toBe(true);
    // C. TARGET dashboard after switch, no newer successor → BINDING.
    expect(
      isSupersededLifecycleAbort(false, false, 'net::ERR_ABORTED', `http://localhost/api/dashboard?accountId=${TARGET}`, TARGET),
    ).toBe(false);
    // D. TARGET dashboard-v2 after switch, no newer successor → BINDING.
    expect(
      isSupersededLifecycleAbort(false, false, 'net::ERR_ABORTED', `http://localhost/api/dashboard/v2?accountId=${TARGET}`, TARGET),
    ).toBe(false);
    // D'. OLD-account dashboard-v2 after switch (stale account) → allowed.
    expect(
      isSupersededLifecycleAbort(false, false, 'net::ERR_ABORTED', 'http://localhost/api/dashboard/v2?accountId=OLD', TARGET),
    ).toBe(true);
    // E. TARGET watchlist after switch, no newer successor → BINDING.
    expect(
      isSupersededLifecycleAbort(false, false, 'net::ERR_ABORTED', 'http://localhost/api/watchlist', TARGET),
    ).toBe(false);
    // F. TARGET MTM-refresh after switch, no newer successor → BINDING.
    expect(
      isSupersededLifecycleAbort(false, false, 'net::ERR_ABORTED', 'http://localhost/api/trades/mtm/refresh', TARGET),
    ).toBe(false);
    // G. Pre-switch watchlist → allowed.
    expect(
      isSupersededLifecycleAbort(true, false, 'net::ERR_ABORTED', 'http://localhost/api/watchlist', TARGET),
    ).toBe(true);
    // H. Pre-switch MTM-refresh → allowed.
    expect(
      isSupersededLifecycleAbort(true, false, 'net::ERR_ABORTED', 'http://localhost/api/trades/mtm/refresh', TARGET),
    ).toBe(true);
    // I. TARGET watchlist A followed by newer watchlist B: A abort → allowed
    // (B superseded A); B abort with no newer successor → BINDING.
    expect(
      isSupersededLifecycleAbort(false, true, 'net::ERR_ABORTED', 'http://localhost/api/watchlist', TARGET),
    ).toBe(true);
    // J. TARGET MTM-refresh: newer same-URL successor → allowed; latest
    // (no successor) → BINDING.
    expect(
      isSupersededLifecycleAbort(false, true, 'net::ERR_ABORTED', 'http://localhost/api/trades/mtm/refresh', TARGET),
    ).toBe(true);
    // K. CRITICAL: an EARLIER successful TARGET request does NOT make a LATER
    // aborted TARGET request harmless. A prior same-URL success is not
    // ownership evidence — the later abort stays BINDING (the urlDelivered
    // defect).
    expect(
      isSupersededLifecycleAbort(false, false, 'net::ERR_ABORTED', `http://localhost/api/dashboard/v2?accountId=${TARGET}`, TARGET),
    ).toBe(false);
    expect(
      isSupersededLifecycleAbort(false, false, 'net::ERR_ABORTED', 'http://localhost/api/watchlist', TARGET),
    ).toBe(false);
    // L. CRITICAL: an OLD dashboard abort does NOT make a nearby TARGET
    // watchlist abort harmless — no failure-timestamp proximity is ownership
    // evidence. The target watchlist (no successor) stays BINDING (the 100ms
    // same-batch defect). There is no time/heuristic parameter in the
    // classifier at all.
    expect(
      isSupersededLifecycleAbort(false, false, 'net::ERR_ABORTED', 'http://localhost/api/watchlist', TARGET),
    ).toBe(false);
    // M. Non-abort network failure → binding regardless of lifecycle.
    expect(
      isSupersededLifecycleAbort(true, false, 'net::ERR_CONNECTION_REFUSED', 'http://localhost/api/dashboard', TARGET),
    ).toBe(false);
    // N. HTTP 4xx/5xx stays binding: the capture helper's response listener is
    // untouched (errors are never classified through the abort predicate).

    await page.goto('/', { waitUntil: 'networkidle' });

    const accountSelect = await selectApplicationAccount(
      page,
      liveAccountId,
      liveAccountName,
    );

    // Capture initial positions before switching (AAPL + SHRT live).
    const positions = page.getByTestId('ws-panel-positions');
    await expect(positions.getByText('AAPL')).toBeVisible({ timeout: 10000 });
    await expect(positions.getByText('SHRT')).toBeVisible();

    // Mark the ownership boundary immediately before applying the target
    // account selection: every request in flight now belongs to the
    // superseded lifecycle, and every request that starts after this point
    // belongs to the newly selected target account.
    ownership.markSwitch();

    // Switch to the second account.
    const switchedResponse = page.waitForResponse(
      (res) =>
        res.url().includes('/api/dashboard') &&
        res.url().includes(`accountId=${secondAccountId}`) &&
        res.ok(),
    );
    await accountSelect.click();
    await page
      .getByRole('option', {
        name: `${secondAccount.name} (E2E Test)`,
        exact: true,
      })
      .click();
    await switchedResponse;

    // Wait for data to reload.
    await page.waitForTimeout(2000);

    // After switching, data should be refreshed: MSFT replaces AAPL/SHRT.
    await expect(positions.getByText('MSFT')).toBeVisible({ timeout: 10000 });
    await expect(positions.getByText('AAPL')).toHaveCount(0);
    await expect(positions.getByText('SHRT')).toHaveCount(0);

    expect(consoleErrors).toEqual([]);
    expect(failedRequests.failures()).toEqual([]);
  });

  // ── Test 6: MTM polling indicator is visible in live mode ──────────
  test('MTM polling indicator is visible when live mode has open positions', async ({
    page,
  }) => {
    const consoleErrors = captureConsoleErrors(page);
    const failedRequests = captureFailedRequests(page);

    await page.goto('/', { waitUntil: 'networkidle' });
    await selectApplicationAccount(page, liveAccountId, liveAccountName);

    // With an open position, MTM polling should be active after data loads.
    await expect(page.getByTestId('ws-mtm-active'))
      .toBeVisible({ timeout: 15000 });

    const mtmIndicator = page.getByTestId('ws-mtm-active');
    await expect(mtmIndicator).toContainText('MTM Live');

    expect(consoleErrors).toEqual([]);
    expect(failedRequests.failures()).toEqual([]);
  });

  test('active live notices use the positive color token', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await selectApplicationAccount(page, liveAccountId, liveAccountName);

    const mtmIndicator = page.getByTestId('ws-mtm-active');
    const liveBadge = page.getByTestId('ws-live-badge');
    await expect(mtmIndicator).toBeVisible({ timeout: 15_000 });
    await expect(liveBadge).toHaveText('LIVE');

    const colors = await page.evaluate(() => {
      const tokenColor = (token: string) => {
        const probe = document.createElement('span');
        probe.style.color = `var(${token})`;
        document.body.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      };

      return {
        positive: tokenColor('--positive'),
        mtm: getComputedStyle(document.querySelector('[data-testid="ws-mtm-active"]')!).color,
        badge: getComputedStyle(document.querySelector('[data-testid="ws-live-badge"]')!).color,
      };
    });

    expect(colors.mtm).toBe(colors.positive);
    expect(colors.badge).toBe(colors.positive);
  });

  // ── Test 7: Console.info lifecycle messages fire ────────────────────
  test('console.info records live mode fetch lifecycle', async ({
    page,
  }) => {
    const consoleErrors = captureConsoleErrors(page);
    const failedRequests = captureFailedRequests(page);
    const consoleInfos = captureConsoleInfo(page);

    await page.goto('/', { waitUntil: 'networkidle' });

    // The global AccountProvider owns the account list on the production
    // shell, so the workstation must not perform a duplicate account fetch.
    expect(
      consoleInfos.some((m) => m.includes('LIVE MODE — fetching accounts')),
    ).toBe(false);

    const dataMsg = consoleInfos.find((m) =>
      m.includes('LIVE MODE — data fetched'),
    );
    expect(dataMsg).toBeDefined();

    expect(consoleErrors).toEqual([]);
    expect(failedRequests.failures()).toEqual([]);
  });

  // ── Test 8: No page errors or unexpected console errors ────────────
  test('no page errors or unhandled console errors in live mode', async ({
    page,
  }) => {
    const consoleErrors = captureConsoleErrors(page);
    const failedRequests = captureFailedRequests(page);

    await page.goto('/', { waitUntil: 'networkidle' });

    expect(consoleErrors).toEqual([]);
    expect(failedRequests.failures()).toEqual([]);
  });

  // ── Test 9: Regression — fixture mode still works ──────────────────
  test('fixture mode renders FIXTURE badge and scenario switcher (regression)', async ({
    page,
  }) => {
    const consoleErrors = captureConsoleErrors(page);
    const failedRequests = captureFailedRequests(page);

    await page.goto('/dev/workstation', { waitUntil: 'networkidle' });

    const toolbar = page.getByTestId('ws-toolbar');
    await expect(toolbar).toBeVisible();

    await expect(page.getByTestId('ws-fixture-badge')).toBeVisible();
    await expect(page.getByTestId('ws-fixture-badge')).toHaveText(/fixture/i);
    await expect(page.getByTestId('ws-live-badge')).not.toBeVisible();

    const scenarioSelect = page.getByTestId('ws-scenario-select');
    await expect(scenarioSelect).toBeVisible();

    // MTM indicator absent in fixture mode.
    await expect(
      toolbar.locator('[data-testid^="ws-mtm-"]'),
    ).not.toBeVisible();

    // M018/S02: the fixture harness shares the same curated default as
    // production — Process Review lives in its dedicated system view, so the
    // default fixture grid exposes the same four panels and excludes it.
    for (const area of ['account-state', 'positions', 'risk', 'performance']) {
      await expect(page.getByTestId(`ws-panel-${area}`)).toBeVisible();
    }
    await expect(page.getByTestId('ws-panel-process-review')).toHaveCount(0);

    expect(consoleErrors).toEqual([]);
    expect(failedRequests.failures()).toEqual([]);
  });

  // ── Test 10: Regression — scenario switching in fixture mode ────────
  test('scenario switching works in fixture mode (regression)', async ({
    page,
  }) => {
    const consoleErrors = captureConsoleErrors(page);

    await page.goto('/dev/workstation', { waitUntil: 'networkidle' });

    const scenarioSelect = page.getByTestId('ws-scenario-select');

    // Zero-positions scenario: positions table should be empty.
    await scenarioSelect.selectOption('zero-positions');
    await page.waitForTimeout(300);
    const zeroPositions = page.getByTestId('ws-panel-positions');
    await expect(zeroPositions).toBeVisible();
    const zeroRows = await zeroPositions.locator('tbody tr').count();
    expect(zeroRows).toBe(0);

    // Large-drawdown scenario: dense default has no KPI band — drawdown
    // renders in the Account State stat grid.
    await scenarioSelect.selectOption('large-drawdown');
    await page.waitForTimeout(300);
    await expect(page.getByTestId('ws-panel-kpis')).toHaveCount(0);
    await expect(
      page.getByTestId('ws-panel-account-state').getByTestId('ws-account-state-drawdown'),
    ).toBeVisible();

    // Many-watchlist remains valid fixture data, but Watchlist is intentionally
    // absent from the curated default.
    await scenarioSelect.selectOption('many-watchlist');
    await page.waitForTimeout(300);
    await expect(page.getByTestId('ws-panel-watchlist')).toHaveCount(0);

    expect(consoleErrors).toEqual([]);
  });
});
