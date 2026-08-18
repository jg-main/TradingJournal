/**
 * M024-hcx7u3 S02 T03 — Weekly review write flow from the Review Metrics
 * panel (browser e2e)
 *
 * Proves the S02 demo end-to-end on the live root dashboard (/):
 *
 *   1. A user view with the Review Metrics panel visible is active (seeded
 *      through the app's own `workstation:views:v1` localStorage contract —
 *      the same persistence surface the view store uses on every mount).
 *   2. A closed, graded trade for the current week is seeded through the
 *      app's own APIs (trades + executions + grade), so the weekly review
 *      generator has deterministic auto-computed metrics to show.
 *   3. The Review Metrics panel starts with "No review this week" (its
 *      panel-local GET /api/reviews/weekly fetch found nothing).
 *   4. "Update review" opens the ReviewWriteSheet; the sheet auto-generates
 *      the current week's review via POST /api/reviews/weekly and displays
 *      the auto-computed metrics (1 trade, $1,490.00, 100.0% win rate,
 *      grade B).
 *   5. Notes and focus-next-week are edited and saved via
 *      PUT /api/reviews/weekly/[id]; the sheet closes and the panel summary
 *      refreshes to the saved review — no page reload.
 *   6. Reopening the sheet loads the same review with the notes/focus
 *      preserved (the POST upsert keeps existing notes).
 *
 * SPA continuity is asserted with a `framenavigated` counter: zero full
 * navigations may occur after the initial load (no router navigation, no
 * reload — the sheet and panel refresh purely through client state).
 *
 * Run: npx playwright test e2e/m024-s02-review-write-flow.spec.ts --project=chromium
 */

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { hideDevOverlay } from './helpers';

test.use({ viewport: { width: 1440, height: 900 } });

test.describe.configure({ mode: 'serial' });

// ── Seed data ────────────────────────────────────────────────────────────
// A long trade with deterministic P&L: buy 100 @ 120.00 + $5 fee, sell
// 100 @ 135.00 + $5 fee → net realized P&L = $1,490.00, win rate 100.0%.
// Graded with the canonical m004 field set → total 50 → grade B.
const TRADE_SYMBOL = `RVW${Date.now().toString().slice(-6)}`;
const ENTRY_PRICE = 120.0;
const EXIT_PRICE = 135.0;
const FEE = 5.0;
const QUANTITY = 100;

const GRADE_FIELDS = {
  setupScore: 9,
  riskScore: 8,
  entryScore: 9,
  managementScore: 8,
  exitScore: 9,
  reviewScore: 7,
};
const GRADE_TOTAL = 50; // → 'B' per GRADE_RUBRIC (B >= 42)

const NOTES_TEXT = 'E2E weekly review notes — disciplined week.';
const FOCUS_TEXT = 'E2E focus next week: follow the plan, wait for setup.';

// ── Shared state ─────────────────────────────────────────────────────────
let liveAccountId: string;
let liveAccountName: string;

// ── Seeded user view ─────────────────────────────────────────────────────
// The curated templates hide the Review Metrics panel by default (M018
// dense contract). A real user reaches the panel by saving a custom view
// with it visible; the e2e seeds that exact persisted state through the
// app's own localStorage view-store contract (`workstation:views:v1`), so
// the root dashboard hydrates with the Review Metrics panel rendered. The
// config mirrors createViewFromTemplate('risk-positions') with 'review'
// placed in the compact summary row beside account/perf and only the
// watchlist hidden (catalogue-consistent, validated by
// migrateWorkstationViewConfig on read).
const USER_VIEW = {
  id: 'ws-e2e-review-write',
  name: 'E2E Review Write',
  config: {
    templateId: 'risk-positions',
    version: 2,
    areas: [
      ['risk', 'risk', 'risk'],
      ['account', 'review', 'perf'],
      ['trades', 'trades', 'trades'],
    ],
    hiddenPanels: ['watchlist'],
  },
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  isSystem: false,
  isStartup: true,
};

const VIEW_STORE = {
  version: 1,
  views: [USER_VIEW],
  activeViewId: USER_VIEW.id,
};

// ── Current-week window (mirrors the sheet + weekly review route) ────────
// The sheet computes the current week's Monday in browser-local time; the
// /api/reviews/weekly route treats that date as UTC midnight. Seeding the
// trade's executions inside the UTC window [weekStart, weekStart+6d] makes
// the closed trade count for the current week regardless of the host
// timezone and of exactly when the run happens.
function mondayIsoDate(now: Date): string {
  const date = new Date(now);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date.toISOString().split('T')[0];
}
const WEEK_START = mondayIsoDate(new Date());

// ── API helpers (mirror e2e/m024-s01-watchlist-crud.spec.ts conventions) ─

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

  const configResp = await request.put(`/api/accounts/${account.id}`, {
    data: { maxRiskPerTradePct: 2, defaultCommission: 1 },
  });
  expect(configResp.status()).toBe(200);
  const activateResp = await request.put(`/api/accounts/${account.id}`, {
    data: { isActive: true },
  });
  expect(activateResp.status()).toBe(200);

  return { id: account.id, name };
}

async function postOpeningBalance(request: APIRequestContext, id: string) {
  const res = await request.post(`/api/accounts/${id}/financial-events`, {
    data: {
      eventType: 'opening_balance',
      amount: '100000.00',
      description: 'E2E opening balance for review write flow',
    },
  });
  expect(res.status()).toBe(201);
}

/** Create a closed + graded trade whose close lands inside the current
 *  week's review window (UTC Monday noon → 1pm), so the weekly review
 *  generator's auto-computed metrics are deterministic. */
async function seedClosedGradedTrade(request: APIRequestContext, accountId: string) {
  const tradeRes = await request.post('/api/trades', {
    data: { symbol: TRADE_SYMBOL, direction: 'long', accountId },
  });
  expect(tradeRes.ok()).toBeTruthy();
  const trade = (await tradeRes.json()) as { id: string };

  const entryRes = await request.post(`/api/trades/${trade.id}/executions`, {
    data: {
      action: 'buy',
      quantity: QUANTITY,
      price: ENTRY_PRICE,
      fees: FEE,
      executedAt: `${WEEK_START}T12:00:00.000Z`,
    },
  });
  expect(entryRes.ok()).toBeTruthy();

  const exitRes = await request.post(`/api/trades/${trade.id}/executions`, {
    data: {
      action: 'sell',
      quantity: QUANTITY,
      price: EXIT_PRICE,
      fees: FEE,
      executedAt: `${WEEK_START}T13:00:00.000Z`,
    },
  });
  expect(exitRes.ok()).toBeTruthy();

  const closed = (await (
    await request.get(`/api/trades/${trade.id}`)
  ).json()) as { status: string; closedAt: string | null };
  expect(closed.status).toBe('closed');
  expect(closed.closedAt).toBeTruthy();

  const gradeRes = await request.put(`/api/trades/${trade.id}/grade`, {
    data: { ...GRADE_FIELDS, followedPlan: true, ruleViolation: false },
  });
  expect(gradeRes.ok()).toBeTruthy();
  const grade = (await gradeRes.json()) as { totalScore: number };
  expect(grade.totalScore).toBe(GRADE_TOTAL);

  return trade.id;
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

// ── Console / Request error capture (workstation-live.spec.ts filters) ──

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

function captureFailedRequests(page: Page): string[] {
  const failed: string[] = [];
  page.on('requestfailed', (req) => {
    failed.push(`${req.url()} (${req.failure()?.errorText ?? 'unknown'})`);
  });
  page.on('response', (res) => {
    if (!res.ok() && res.status() >= 400) {
      const url = res.url();
      if (!url.includes('/reconciliation') && !url.includes('/migration')) {
        failed.push(`${res.url()} (${res.status()})`);
      }
    }
  });
  return failed;
}

// ── Setup: app profile + live account + closed graded trade ─────────────

test.beforeAll(async ({ request }) => {
  await ensureAppProfile(request);
  const liveAccount = await createLiveAccount(request);
  liveAccountId = liveAccount.id;
  liveAccountName = liveAccount.name;
  await postOpeningBalance(request, liveAccountId);
  await seedClosedGradedTrade(request, liveAccountId);
});

// ═══════════════════════════════════════════════════════════════════════════
// The S02 demo journey: generate → edit → save → panel refreshes, all
// SPA-continuous.
// ═══════════════════════════════════════════════════════════════════════════

test('weekly review write flow from the Review Metrics panel without a reload', async ({
  page,
  request,
}) => {
  const consoleErrors = captureConsoleErrors(page);
  const failedRequests = captureFailedRequests(page);

  // Seed the saved user view (Review Metrics panel visible) before first paint.
  await page.addInitScript((store) => {
    window.localStorage.setItem('workstation:views:v1', JSON.stringify(store));
  }, VIEW_STORE);

  await page.goto('/', { waitUntil: 'networkidle' });
  await hideDevOverlay(page);

  // Live mode is active on the root dashboard (no fixture chrome).
  await expect(page.getByTestId('ws-toolbar')).toBeVisible();
  await expect(page.getByTestId('ws-live-badge')).toHaveText(/^(LIVE|IDLE)$/);
  await expect(page.getByTestId('ws-fixture-badge')).not.toBeVisible();

  // Select the seeded account so live dashboard data loads.
  await selectApplicationAccount(page, liveAccountId, liveAccountName);

  // The hydrated user view renders the Review Metrics panel with the weekly
  // review summary section. No review exists yet → the panel-local fetch
  // (GET /api/reviews/weekly) settles on the empty state.
  const reviewPanel = page.getByTestId('ws-panel-process-review');
  await expect(reviewPanel).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('ws-weekly-review-empty')).toHaveText(
    'No review this week',
    { timeout: 15_000 },
  );

  // ── SPA continuity tracking: no full navigation after this point ──
  let navigations = 0;
  page.on('framenavigated', () => {
    navigations += 1;
  });
  const expectSpaContinuity = async () => {
    expect(navigations).toBe(0);
    expect(new URL(page.url()).pathname).toBe('/');
  };

  // ── OPEN THE SHEET → auto-generate the current week's review ──────
  const generateResponse = page.waitForResponse(
    (res) =>
      res.request().method() === 'POST' &&
      new URL(res.url()).pathname === '/api/reviews/weekly' &&
      res.ok(),
  );
  await page.getByTestId('ws-update-review').click();
  await generateResponse;

  // The sheet opens anchored to the panel and shows the auto-computed
  // metrics from the seeded closed trade.
  await expect(page.getByTestId('ws-review-sheet')).toBeVisible();
  await expect(page.getByTestId('ws-review-sheet-week')).toBeVisible();
  await expect(page.getByTestId('ws-review-sheet-metric-trades')).toHaveText('1');
  await expect(page.getByTestId('ws-review-sheet-metric-netpnl')).toHaveText(
    '$1,490.00',
  );
  await expect(page.getByTestId('ws-review-sheet-metric-winrate')).toHaveText(
    '100.0%',
  );
  await expect(page.getByTestId('ws-review-sheet-metric-grade')).toHaveText(
    'B (50.0)',
  );
  await expectSpaContinuity();

  // ── EDIT notes + focus-next-week ─────────────────────────────────
  await page.getByTestId('ws-review-sheet-notes').fill(NOTES_TEXT);
  await page.getByTestId('ws-review-sheet-focus').fill(FOCUS_TEXT);

  // ── SAVE via PUT /api/reviews/weekly/[id] ────────────────────────
  const saveResponse = page.waitForResponse(
    (res) =>
      res.request().method() === 'PUT' &&
      /^\/api\/reviews\/weekly\/[^/]+$/.test(new URL(res.url()).pathname) &&
      res.ok(),
  );
  await page.getByTestId('ws-review-sheet-save').click();
  await saveResponse;

  // The sheet closes and the panel summary refreshes to the saved review —
  // without a page reload.
  await expect(page.getByTestId('ws-review-sheet')).not.toBeVisible();
  await expect(page.getByTestId('ws-weekly-review-week')).toBeVisible();
  await expect(page.getByTestId('ws-weekly-review-metric-trades')).toHaveText(
    '1',
    { timeout: 15_000 },
  );
  await expect(page.getByTestId('ws-weekly-review-metric-netpnl')).toHaveText(
    '$1,490.00',
  );
  await expect(page.getByTestId('ws-weekly-review-metric-winrate')).toHaveText(
    '100.0%',
  );
  await expect(page.getByTestId('ws-weekly-review-metric-grade')).toHaveText(
    'B (50.0)',
  );
  await expect(page.getByTestId('ws-weekly-review-empty')).toHaveCount(0);
  await expectSpaContinuity();

  // ── REOPEN → generate-or-load keeps the saved notes/focus ─────────
  const reloadResponse = page.waitForResponse(
    (res) =>
      res.request().method() === 'POST' &&
      new URL(res.url()).pathname === '/api/reviews/weekly' &&
      res.ok(),
  );
  await page.getByTestId('ws-update-review').click();
  await reloadResponse;

  await expect(page.getByTestId('ws-review-sheet')).toBeVisible();
  await expect(page.getByTestId('ws-review-sheet-notes')).toHaveValue(NOTES_TEXT);
  await expect(page.getByTestId('ws-review-sheet-focus')).toHaveValue(FOCUS_TEXT);
  await expect(page.getByTestId('ws-review-sheet-metric-trades')).toHaveText('1');
  await page.getByTestId('ws-review-sheet-cancel').click();
  await expect(page.getByTestId('ws-review-sheet')).not.toBeVisible();
  await expectSpaContinuity();

  // ── Persistence: the PUT row is the persisted source of truth ─────
  const reviewsRes = await request.get(
    `/api/reviews/weekly?accountId=${liveAccountId}`,
  );
  expect(reviewsRes.ok()).toBeTruthy();
  const rows = (await reviewsRes.json()) as Array<{
    weekStart: string;
    closedTrades: number;
    netPnl: number;
    winRate: number;
    avgProcessScore: number | null;
    notes: string | null;
    focusNextWeek: string | null;
  }>;
  const current = rows.find((r) => r.weekStart === WEEK_START);
  expect(current).toBeTruthy();
  expect(current!.closedTrades).toBe(1);
  expect(current!.netPnl).toBe(1490);
  expect(current!.winRate).toBe(1);
  expect(current!.avgProcessScore).toBe(GRADE_TOTAL);
  expect(current!.notes).toBe(NOTES_TEXT);
  expect(current!.focusNextWeek).toBe(FOCUS_TEXT);

  // The whole journey stayed on the root dashboard with no page errors and
  // no [review-panel]/[review-sheet] diagnostics in the console.
  expect(consoleErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
});
