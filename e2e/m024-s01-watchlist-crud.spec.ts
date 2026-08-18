/**
 * M024-hcx7u3 S01 T04 — Watchlist CRUD on the live dashboard (browser e2e)
 *
 * Proves the S01 demo end-to-end on the live root dashboard (/):
 *
 *   1. A user view with the Watchlist panel visible is active (seeded through
 *      the app's own `workstation:views:v1` localStorage contract, the same
 *      persistence surface the view store uses on every mount).
 *   2. Add a unique test symbol via the panel's '+ Add' dialog — the row
 *      appears without a page reload.
 *   3. Edit its trigger price and status — the row reflects both without a
 *      page reload.
 *   4. Delete it — the confirm dialog flows, the row disappears, and the
 *      panel returns to its empty state without a page reload.
 *
 * SPA continuity is asserted with a `framenavigated` counter: zero full
 * navigations may occur after the initial load (the panel refetches through
 * refreshLiveData() — no router navigation, no reload).
 *
 * Run: npx playwright test e2e/m024-s01-watchlist-crud.spec.ts --project=chromium
 */

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { hideDevOverlay } from './helpers';

test.use({ viewport: { width: 1440, height: 900 } });

test.describe.configure({ mode: 'serial' });

// ── Test identity ────────────────────────────────────────────────────────
// Unique symbol created by the journey. The fresh per-run DB makes the
// Date.now() suffix belt-and-suspenders; it also lets afterAll cleanup
// target exactly this run's row.
const TEST_SYMBOL = `WLS${Date.now().toString().slice(-6)}`;

// ── Shared state ─────────────────────────────────────────────────────────
let liveAccountId: string;
let liveAccountName: string;

// ── Seeded user view ─────────────────────────────────────────────────────
// The curated templates hide the Watchlist panel by default (M018 dense
// contract). A real user reaches the panel by saving a custom view with it
// visible; the e2e seeds that exact persisted state through the app's own
// localStorage view-store contract (`workstation:views:v1`), so the root
// dashboard hydrates with the Watchlist panel rendered. The config mirrors
// createViewFromTemplate('risk-positions') plus a full-width watchlist row
// and 'review' moved into hiddenPanels (catalogue-consistent, validated by
// migrateWorkstationViewConfig on read).
const USER_VIEW = {
  id: 'ws-e2e-watchlist-crud',
  name: 'E2E Watchlist CRUD',
  config: {
    templateId: 'risk-positions',
    version: 2,
    areas: [
      ['risk', 'risk', 'risk'],
      ['account', 'perf', 'perf'],
      ['trades', 'trades', 'trades'],
      ['watchlist', 'watchlist', 'watchlist'],
    ],
    hiddenPanels: ['review'],
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

// ── API helpers (mirror e2e/workstation-live.spec.ts conventions) ───────

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

  // Configure risk params and activate so the live dashboard accepts it.
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
      description: 'E2E opening balance for watchlist CRUD',
    },
  });
  expect(res.status()).toBe(201);
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

// ── Setup: app profile + live account ────────────────────────────────────

test.beforeAll(async ({ request }) => {
  await ensureAppProfile(request);
  const liveAccount = await createLiveAccount(request);
  liveAccountId = liveAccount.id;
  liveAccountName = liveAccount.name;
  await postOpeningBalance(request, liveAccountId);
});

// ── Cleanup: remove any leftover row for this run's symbol ───────────────
// The journey deletes its row in-flow; this guard covers a mid-flow failure
// so the run never leaves its own row behind (soft-delete marks it expired,
// which the default GET already excludes).
test.afterAll(async ({ request }) => {
  const res = await request.get('/api/watchlist');
  if (!res.ok()) return;
  const items = (await res.json()) as Array<{ id: string; symbol: string }>;
  for (const item of items.filter((i) => i.symbol === TEST_SYMBOL)) {
    await request.delete(`/api/watchlist/${item.id}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// The S01 demo journey: add → edit → delete, all SPA-continuous.
// ═══════════════════════════════════════════════════════════════════════════

test('watchlist CRUD on the live dashboard: add, edit trigger/status, delete without reload', async ({
  page,
}) => {
  const consoleErrors = captureConsoleErrors(page);
  const failedRequests = captureFailedRequests(page);

  // Seed the saved user view (Watchlist panel visible) before first paint.
  await page.addInitScript((store) => {
    window.localStorage.setItem('workstation:views:v1', JSON.stringify(store));
  }, VIEW_STORE);

  await page.goto('/', { waitUntil: 'networkidle' });
  await hideDevOverlay(page);

  // Live mode is active on the root dashboard. The badge reads LIVE while
  // MTM polling runs (open positions > 0) or IDLE when there is nothing to
  // poll (fresh account with no positions) — either proves a live-mode
  // connection; the fixture badge is the real discriminator.
  await expect(page.getByTestId('ws-toolbar')).toBeVisible();
  await expect(page.getByTestId('ws-live-badge')).toHaveText(/^(LIVE|IDLE)$/);
  await expect(page.getByTestId('ws-fixture-badge')).not.toBeVisible();
  await expect(page.getByTestId('ws-scenario-select')).not.toBeVisible();

  // Select the seeded account so live dashboard data (and the global
  // watchlist) load; refreshLiveData() is a no-op until an account resolves.
  await selectApplicationAccount(page, liveAccountId, liveAccountName);

  // The hydrated user view renders the Watchlist panel. A fresh per-run DB
  // starts empty, so the panel shows its live-mode empty state with Add
  // actions (proving the CRUD chrome is gated on live mode).
  const watchlistPanel = page.getByTestId('ws-panel-watchlist');
  await expect(watchlistPanel).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('ws-watchlist-empty')).toBeVisible();
  await expect(page.getByTestId('ws-watchlist-add')).toBeVisible();

  // ── SPA continuity tracking: no full navigation after this point ──
  let navigations = 0;
  page.on('framenavigated', () => {
    navigations += 1;
  });
  const expectSpaContinuity = async () => {
    expect(navigations).toBe(0);
    expect(new URL(page.url()).pathname).toBe('/');
  };

  // ── ADD ────────────────────────────────────────────────────────────
  await page.getByTestId('ws-watchlist-add').click();
  await expect(page.getByTestId('ws-watchlist-dialog')).toBeVisible();
  await expect(page.getByTestId('ws-watchlist-dialog')).toContainText(
    'Add to watchlist',
  );

  await page.getByTestId('ws-watchlist-form-symbol').fill(TEST_SYMBOL);
  // Direction → short (proves the direction field persists through the API).
  await page.getByTestId('ws-watchlist-form-direction').click();
  await page.getByRole('option', { name: 'Short', exact: true }).click();
  // Trigger price 123.45 (proves the triggerPrice write contract).
  await page.getByTestId('ws-watchlist-form-trigger').fill('123.45');

  const addResponse = page.waitForResponse(
    (res) =>
      res.request().method() === 'POST' &&
      new URL(res.url()).pathname === '/api/watchlist' &&
      res.ok(),
  );
  await page.getByTestId('ws-watchlist-form-submit').click();
  await addResponse;

  // The row appears in the panel without a reload.
  const row = page.getByTestId(`ws-watchlist-row-${TEST_SYMBOL}`);
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row.locator('td').nth(1)).toHaveText('S'); // Dir
  await expect(row.locator('td').nth(4)).toHaveText('123.45'); // Trigger
  await expect(page.getByTestId(`ws-status-${TEST_SYMBOL}`)).toHaveText('pending');
  await expect(page.getByTestId('ws-watchlist-empty')).toHaveCount(0);
  await expectSpaContinuity();

  // ── EDIT ───────────────────────────────────────────────────────────
  await page.getByTestId(`ws-watchlist-row-${TEST_SYMBOL}-edit`).click();
  await expect(page.getByTestId('ws-watchlist-dialog')).toBeVisible();
  await expect(page.getByTestId('ws-watchlist-dialog')).toContainText(
    `Edit ${TEST_SYMBOL}`,
  );

  await page.getByTestId('ws-watchlist-form-trigger').fill('234.56');
  // Status → watching (proves the status write contract).
  await page.getByTestId('ws-watchlist-form-status').click();
  await page.getByRole('option', { name: 'watching', exact: true }).click();

  const putResponse = page.waitForResponse(
    (res) =>
      res.request().method() === 'PUT' &&
      /^\/api\/watchlist\/[^/]+$/.test(new URL(res.url()).pathname) &&
      res.ok(),
  );
  await page.getByTestId('ws-watchlist-form-submit').click();
  await putResponse;

  // The row reflects both edits without a reload.
  await expect(row.locator('td').nth(4)).toHaveText('234.56');
  await expect(page.getByTestId(`ws-status-${TEST_SYMBOL}`)).toHaveText('watching');
  await expectSpaContinuity();

  // ── DELETE ─────────────────────────────────────────────────────────
  await page.getByTestId(`ws-watchlist-row-${TEST_SYMBOL}-remove`).click();
  await expect(page.getByTestId('ws-watchlist-confirm-delete')).toBeVisible();
  await expect(page.getByTestId('ws-watchlist-confirm-delete')).toContainText(
    `Remove ${TEST_SYMBOL}?`,
  );

  const deleteResponse = page.waitForResponse(
    (res) =>
      res.request().method() === 'DELETE' &&
      /^\/api\/watchlist\/[^/]+$/.test(new URL(res.url()).pathname) &&
      res.ok(),
  );
  await page.getByTestId('ws-watchlist-confirm-delete-yes').click();
  await deleteResponse;

  // The row disappears and the panel returns to its empty state — all
  // without a reload.
  await expect(page.getByTestId(`ws-watchlist-row-${TEST_SYMBOL}`)).toHaveCount(0);
  await expect(page.getByTestId('ws-watchlist-empty')).toBeVisible({
    timeout: 15_000,
  });
  await expectSpaContinuity();

  // The whole journey stayed on the root dashboard with no page errors.
  expect(consoleErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
});
