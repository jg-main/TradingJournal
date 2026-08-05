import { test, expect } from '@playwright/test';

/**
 * M015/S02: Scratch (planned-only soft-delete) UI flow.
 *
 * Two entry points per R027/D057:
 *  1. Planned trade row menu on the Trades list page (ActionsCell "Scratch")
 *  2. Planned detail view dropdown (PlannedPhaseView "Scratch")
 *
 * Both open a destructive ConfirmDialog. Confirming calls
 * DELETE /api/trades/[id] (S01 contract: 200 'Trade scratched', 400
 * descriptive error, 404 not found). The list page refetches the Planned tab
 * so the scratched trade disappears; the detail page navigates back to
 * /trades. Error states are logged via console.error (app pattern — no toast
 * system).
 *
 * Uses unique per-run symbols so leftover rows from prior tests/runs (the
 * scratch is a soft-delete; rows persist in the shared test DB) never trip
 * Playwright strict mode.
 *
 * Interaction robustness notes (learned while building this spec):
 *  - On the trades list, every row is clickable (navigates to the detail
 *    page). Radix overlays (dropdown menu, dialog) close on activation, and a
 *    pointer click issued right at that moment can fall through to the row
 *    beneath, triggering navigation and losing the DELETE response
 *    observation (observed on Chromium and Firefox). The spec therefore
 *    activates menu items and dialog buttons via focus + Enter (keyboard),
 *    which fires no pointer events. The row's "Trade actions" trigger keeps
 *    its pointer click — it stops propagation itself.
 *  - The trades page restores persisted filters after hydration
 *    (setTimeout + router.replace re-render); a tab click issued immediately
 *    after load can be dropped. Waiting for the planned fetch to settle
 *    (count badge appears) before clicking, then asserting aria-selected,
 *    makes the tab switch deterministic.
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

/**
 * Switch to the Planned tab on the Trades list page.
 *
 * The page restores persisted filters after hydration (setTimeout + a
 * filter-sync effect that calls router.replace), so a tab click issued
 * immediately after load can be dropped by the re-render — the click would
 * resolve but the Open tab stays selected. Waiting for the planned fetch to
 * settle (the count badge span appears once tabTotal.planned > 0) before
 * clicking, then asserting aria-selected, makes the switch deterministic.
 */
async function openPlannedTab(page: import('@playwright/test').Page) {
  const plannedTab = page.getByRole('tab', { name: /planned/i });
  const badge = plannedTab.locator('span');
  try {
    // Badge renders once the initial planned fetch settles (count > 0).
    await badge.waitFor({ state: 'visible', timeout: 5_000 });
  } catch {
    // No planned trades — the fetch has settled with count 0; proceed anyway.
  }
  await plannedTab.click();
  await expect(plannedTab).toHaveAttribute('aria-selected', 'true', { timeout: 5_000 });
}

/**
 * Activate the "Scratch" item in an open dropdown menu via keyboard.
 *
 * Radix focuses the first menu item when the menu opens; focusing the Scratch
 * item directly and pressing Enter selects it without dispatching pointer
 * events, so no click falls through to clickable rows beneath.
 */
async function pickScratchMenuItem(page: import('@playwright/test').Page) {
  const scratchItem = page.getByRole('menuitem', { name: 'Scratch', exact: true });
  await expect(scratchItem).toBeVisible();
  await scratchItem.focus();
  await page.keyboard.press('Enter');
}

/**
 * Activate a dialog button (confirm/cancel) via keyboard.
 *
 * The ConfirmDialog closes before its confirm handler runs; a pointer click
 * can be retried by the browser mid-close and land on a row beneath (row
 * navigation). Focus + Enter avoids pointer events entirely.
 */
async function pressDialogButton(
  page: import('@playwright/test').Page,
  dialog: ReturnType<import('@playwright/test').Page['getByRole']>,
  name: string,
) {
  const button = dialog.getByRole('button', { name, exact: true });
  await expect(button).toBeVisible();
  await button.focus();
  await page.keyboard.press('Enter');
}

test.describe('M015 Trade Scratch UI', () => {
  test.describe.configure({ mode: 'serial' });

  test('scratch a planned trade from the list row menu with confirmation and refetch', async ({ page }) => {
    const account = await setupAccount(page, 'M015 List Scratch');
    const symbol = `LST${RUN_ID}`; // ≤ 20 chars (trade symbol validation limit)
    const trade = await createPlannedTrade(page, account.id, symbol);

    // Navigate to the trade log and switch to the Planned tab
    await page.goto('/trades');
    await expect(page.locator('h1')).toContainText('Trades');
    await openPlannedTab(page);

    // Verify the planned trade row appears with its actions menu
    const row = page.locator('tr').filter({ hasText: symbol }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    const actionsButton = row.getByRole('button', { name: 'Trade actions' });
    await expect(actionsButton).toBeVisible();

    // Open the row menu and pick Scratch (Trash2 icon present per M015 must-have)
    await actionsButton.click();
    const scratchItem = page.getByRole('menuitem', { name: 'Scratch', exact: true });
    await expect(scratchItem).toBeVisible();
    await expect(scratchItem.locator('svg')).toHaveCount(1);

    // Track the DELETE request (fires before any response/navigation race).
    // The dialog's focus-restoration can navigate the list page to the trade
    // detail page on some browsers (see header note), which aborts delivery of
    // the DELETE *response* even though the server commits the scratch — so
    // observing the request + durable outcomes is the reliable signal.
    let deleteIssued = false;
    page.on('request', (req) => {
      if (req.method() === 'DELETE' && req.url().includes(`/api/trades/${trade.id}`)) {
        deleteIssued = true;
      }
    });

    await pickScratchMenuItem(page);

    // ConfirmDialog opens with destructive styling and a trade-specific title
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(`Scratch ${symbol}?`)).toBeVisible();
    const confirmButton = dialog.getByRole('button', { name: 'Scratch', exact: true });
    await expect(confirmButton).toHaveClass(/text-destructive/);

    // Confirm → DELETE /api/trades/[id] is issued for the correct trade
    await pressDialogButton(page, dialog, 'Scratch');
    await expect.poll(() => deleteIssued, { timeout: 10_000 }).toBe(true);

    // Durable server outcome: the trade is soft-deleted (status='deleted',
    // row preserved — not hard-deleted). The 200/400/404 response shapes are
    // pinned by the API-contract test below.
    await expect
      .poll(
        async () => {
          const res = await page.request.get(`/api/trades/${trade.id}`);
          return ((await res.json()) as { status?: string }).status;
        },
        { timeout: 10_000 },
      )
      .toBe('deleted');

    // The Planned tab refetches and the scratched trade disappears. If the
    // focus-restoration quirk navigated us to the detail page, re-enter the
    // list to pin the durable UI outcome.
    await page.waitForTimeout(300);
    if (!page.url().match(/\/trades\/?(\?.*)?$/)) {
      await page.goto('/trades');
      await openPlannedTab(page);
    }
    await expect(page.locator('tr').filter({ hasText: symbol })).not.toBeVisible({
      timeout: 10_000,
    });
  });

  test('scratch a planned trade from the detail view and navigate back to /trades', async ({ page }) => {
    const account = await setupAccount(page, 'M015 Detail Scratch');
    const symbol = `DTL${RUN_ID}`;
    const trade = await createPlannedTrade(page, account.id, symbol);

    // Navigate to the planned trade detail page
    await page.goto(`/trades/${trade.id}`);
    await expect(page.locator('h1')).toContainText(symbol);

    // Open the PlannedPhaseView dropdown and pick Scratch (Trash2 icon present)
    await page.getByRole('button', { name: 'More actions' }).click();
    const scratchItem = page.getByRole('menuitem', { name: 'Scratch', exact: true });
    await expect(scratchItem).toBeVisible();
    await expect(scratchItem.locator('svg')).toHaveCount(1);

    // Track the DELETE request (same rationale as the list test: the response
    // can be aborted by navigation races; the request + durable outcomes are
    // the reliable signals).
    let deleteIssued = false;
    page.on('request', (req) => {
      if (req.method() === 'DELETE' && req.url().includes(`/api/trades/${trade.id}`)) {
        deleteIssued = true;
      }
    });

    await pickScratchMenuItem(page);

    // Destructive ConfirmDialog owned by the trade detail page
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(`Scratch ${symbol}?`)).toBeVisible();
    const confirmButton = dialog.getByRole('button', { name: 'Scratch', exact: true });
    await expect(confirmButton).toHaveClass(/text-destructive/);

    // Confirm → DELETE issued → navigate back to the trades list
    await pressDialogButton(page, dialog, 'Scratch');
    await expect.poll(() => deleteIssued, { timeout: 10_000 }).toBe(true);

    await expect(page).toHaveURL(/\/trades\/?$/);
    await expect(page.locator('h1')).toContainText('Trades');

    // The scratched trade is no longer in the Planned tab after the refetch
    await openPlannedTab(page);
    await expect(page.locator('tr').filter({ hasText: symbol })).not.toBeVisible({ timeout: 10_000 });

    // Soft-delete: row preserved with status='deleted'
    const getRes = await page.request.get(`/api/trades/${trade.id}`);
    expect(getRes.ok()).toBeTruthy();
    expect((await getRes.json()).status).toBe('deleted');
  });

  test('cancelling the confirm dialog leaves the planned trade untouched', async ({ page }) => {
    const account = await setupAccount(page, 'M015 Cancel Scratch');
    const symbol = `CNC${RUN_ID}`;
    const trade = await createPlannedTrade(page, account.id, symbol);

    // Track whether any DELETE is issued for this trade during the test
    let deleteIssued = false;
    page.on('request', (req) => {
      if (req.method() === 'DELETE' && req.url().includes(`/api/trades/${trade.id}`)) {
        deleteIssued = true;
      }
    });

    await page.goto('/trades');
    await expect(page.locator('h1')).toContainText('Trades');
    await openPlannedTab(page);

    const row = page.locator('tr').filter({ hasText: symbol }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });

    // Open the dialog, then dismiss it with Cancel (keyboard, no pointer)
    await row.getByRole('button', { name: 'Trade actions' }).click();
    await pickScratchMenuItem(page);
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(`Scratch ${symbol}?`)).toBeVisible();
    await pressDialogButton(page, dialog, 'Cancel');

    // Dialog closes, no DELETE fired, and the trade is still planned
    await expect(dialog).not.toBeVisible();
    expect(deleteIssued).toBe(false);
    const getRes = await page.request.get(`/api/trades/${trade.id}`);
    expect((await getRes.json()).status).toBe('planned');

    // Verify the durable outcome on the list page. (Closing the dialog can
    // leave the SPA on the trade detail page via a Radix focus-restoration
    // quirk on the clickable row — a timing race, not a user action. The
    // must-have behavior is that cancel does NOT scratch: the trade is still
    // planned and still listed. A fresh navigation pins that deterministically.)
    await page.goto('/trades');
    await expect(page.locator('h1')).toContainText('Trades');
    await openPlannedTab(page);
    const rowAfter = page.locator('tr').filter({ hasText: symbol }).first();
    await expect(rowAfter).toBeVisible({ timeout: 10_000 });
  });

  test('DELETE failure is logged to console.error and the trade stays planned', async ({ page }) => {
    const account = await setupAccount(page, 'M015 Error Scratch');
    const symbol = `ERR${RUN_ID}`;
    const trade = await createPlannedTrade(page, account.id, symbol);

    // Force the scratch DELETE to fail with a descriptive 400 (S01 error shape)
    await page.route(`**/api/trades/${trade.id}`, async (route) => {
      if (route.request().method() === 'DELETE') {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'Only planned trades can be scratched; this trade is open.',
          }),
        });
      } else {
        await route.continue();
      }
    });

    // Capture console.error output (app pattern: error states are logged)
    const errorLogs: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errorLogs.push(msg.text());
    });

    await page.goto('/trades');
    await expect(page.locator('h1')).toContainText('Trades');
    await openPlannedTab(page);

    const row = page.locator('tr').filter({ hasText: symbol }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });

    await row.getByRole('button', { name: 'Trade actions' }).click();
    await pickScratchMenuItem(page);
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await pressDialogButton(page, dialog, 'Scratch');

    // The trade stays visible in the Planned tab and the failure is logged
    await expect(row).toBeVisible();
    await expect
      .poll(() => errorLogs.some((l) => l.includes('Scratch trade failed')))
      .toBe(true);

    // API confirms the trade is untouched
    const getRes = await page.request.get(`/api/trades/${trade.id}`);
    expect((await getRes.json()).status).toBe('planned');
  });

  test('DELETE /api/trades/[id] contract: 200 scratched, 400 descriptive, 404 missing', async ({ page }) => {
    const account = await setupAccount(page, 'M015 API Contract');

    // ── 200: planned trade → scratched ──
    const planned = await createPlannedTrade(page, account.id, `API${RUN_ID}`);
    const del200 = await page.request.delete(`/api/trades/${planned.id}`);
    expect(del200.status()).toBe(200);
    expect((await del200.json()).message).toBe('Trade scratched');

    // ── 400: already-scratched trade is rejected idempotently ──
    const del400a = await page.request.delete(`/api/trades/${planned.id}`);
    expect(del400a.status()).toBe(400);
    expect((await del400a.json()).error).toBe('Trade is already scratched.');

    // ── 400: open trades cannot be scratched ──
    const open = await createPlannedTrade(page, account.id, `APO${RUN_ID}`);
    const execRes = await page.request.post(`/api/trades/${open.id}/execute`, {
      data: { entryPrice: 100, entryQuantity: 50, stopPrice: 95, fees: 2 },
    });
    expect(execRes.ok()).toBeTruthy();
    expect((await execRes.json()).trade.status).toBe('open');
    const del400b = await page.request.delete(`/api/trades/${open.id}`);
    expect(del400b.status()).toBe(400);
    expect((await del400b.json()).error).toContain('Only planned trades can be scratched');

    // ── 404: unknown trade id ──
    const del404 = await page.request.delete(`/api/trades/${crypto.randomUUID()}`);
    expect(del404.status()).toBe(404);
    expect((await del404.json()).error).toBe('Trade not found');
  });
});
