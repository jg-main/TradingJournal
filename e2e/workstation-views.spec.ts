/**
 * M016 S06 T05 — Workstation Saved Views E2E (view switching + customization)
 *
 * End-to-end proof for the S06 slice contract on the deterministic fixture
 * harness (/dev/workstation):
 *
 * 1. Three curated system templates render (Risk & Positions — immutable
 *    startup default, Performance, Process Review) and the dynamic CSS grid
 *    adapts per template: optional panels that a template hides by default
 *    have no cells in the grid, while fixed safety panels (risk, trades
 *    workspace) render in every view.
 * 2. Browser evidence at 2560×1440 and effective 1536×960 confirms the grid
 *    renders without horizontal overflow at both sizes.
 * 3. Customize is an explicit editing mode (R035): the toolbar button is
 *    disabled for read-only system presets and mid-session; normal mode has
 *    no editing chrome (no bar, no hide overlays, no per-cell wrappers);
 *    the session provides Save (disabled until dirty), Cancel (discards),
 *    Undo (bounded history), and Reset (back to the template base).
 * 4. The data-quality alert strip stays outside the editable layout: it is
 *    a sibling of the grid (never a descendant) in normal mode and while a
 *    customize session is open, and the customize bar is likewise mounted
 *    between the strip and the grid, never inside it.
 * 5. User-view CRUD: create (prompt), duplicate ("{name} (Copy)"),
 *    rename (prompt), set-as-startup (star), persistence across reload
 *    (localStorage + API dual-write), and delete (confirm, falls back to
 *    the Risk & Positions preset).
 *
 * Isolation: each test starts from a pristine store — the shared disposable
 * per-run database is cleaned of workstation rows (ws-*) and the test
 * context starts with empty localStorage — so API hydration always lands on
 * the three default system templates regardless of earlier tests.
 *
 * Run: npx playwright test e2e/workstation-views.spec.ts --project=chromium
 */

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 } });

test.describe.configure({ mode: 'serial' });

/** localStorage key owned by useWorkstationViews. */
const STORAGE_KEY = 'workstation:views:v1';

/** Canonical ids of the three curated system template views. */
const SYSTEM_VIEW_IDS = {
  RISK_POSITIONS: 'ws-system-risk-positions',
  PERFORMANCE: 'ws-system-performance',
  PROCESS_REVIEW: 'ws-system-process-review',
} as const;

/** Catalogue panels visible in the curated Risk & Positions starting view. */
const RISK_POSITIONS_PANELS = [
  'risk',
  'positions',
  'account-state',
  'performance',
] as const;

/** The panels each system template renders (fixed panels always render). */
const TEMPLATE_PANELS: Record<string, readonly string[]> = {
  'Risk & Positions': RISK_POSITIONS_PANELS,
  Performance: ['risk', 'positions', 'account-state', 'performance'],
  'Process Review': ['risk', 'positions', 'account-state', 'process-review'],
};

/** Collect console errors + page errors for the audit assertion. */
function watchForErrors(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  return { consoleErrors, pageErrors };
}

/**
 * Reset the workstation view store to its pristine defaults:
 *  - delete every workstation row (ws-*) from the shared API table so the
 *    hook's API hydration cannot override localStorage with prior-run views;
 *  - clear localStorage for the workstation views key on every navigation.
 *
 * The dev server is cold at the start of a run: Next compiles /api routes on
 * first request, so the first GET can hang up. Retry until the route answers
 * (existing specs only touch the API after a page load has warmed the
 * server; this spec cleans up before the first navigation).
 */
async function resetViewStore(page: Page, request: APIRequestContext) {
  let rows: Array<{ id: string; isSystem: boolean }> | null = null;
  for (let attempt = 0; attempt < 30 && rows === null; attempt++) {
    try {
      const res = await request.get('/api/dashboard/views', { timeout: 10_000 });
      if (res.ok()) rows = (await res.json()) as Array<{ id: string; isSystem: boolean }>;
    } catch {
      /* cold dev server — keep retrying */
    }
    if (rows === null) await page.waitForTimeout(1_000);
  }
  expect(rows, 'GET /api/dashboard/views should become ready').not.toBeNull();
  for (const row of rows ?? []) {
    // System template rows are immutable (the API rejects deleting them) and
    // are byte-identical to the defaults, so they can stay; only user views
    // created by earlier tests in this run must be removed.
    if (row.id.startsWith('ws-') && !row.isSystem) {
      const del = await request.delete(
        `/api/dashboard/views?id=${encodeURIComponent(row.id)}`,
      );
      expect(del.ok()).toBeTruthy();
    }
  }
  await page.addInitScript((key) => {
    try {
      localStorage.removeItem(key);
    } catch {
      /* storage unavailable — context isolation already provides freshness */
    }
  }, STORAGE_KEY);
}

/**
 * Open the view switcher dropdown and wait for its content.
 *
 * The Radix dropdown is modal: while open it applies inline
 * `pointer-events: none` to <body>, which makes the trigger itself
 * un-clickable (hit-testing resolves to <html>). So we must never click
 * the trigger while the menu is open — close it first via Escape.
 */
async function openViewSwitcher(page: Page) {
  const trigger = page.getByTestId('ws-view-switcher-trigger');
  const content = page.getByTestId('ws-view-switcher-content');
  if (await content.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
    await expect(content).toHaveCount(0);
  }
  await trigger.click();
  try {
    await expect(content).toBeVisible({ timeout: 3_000 });
  } catch {
    // Belt-and-braces: a re-open immediately after a close can be
    // swallowed by the dropdown's close transition — click again once.
    await trigger.click();
    await expect(content).toBeVisible({ timeout: 3_000 });
  }
}

/** Select a view by testid and wait for the dropdown to close. */
async function selectView(page: Page, viewId: string) {
  await openViewSwitcher(page);
  await page.getByTestId(`ws-view-item-${viewId}`).click();
  await expect(page.getByTestId('ws-view-switcher-content')).toHaveCount(0);
}

/** Assert a set of panels is visible and another set is absent. */
async function expectPanels(
  page: Page,
  visible: readonly string[],
  hidden: readonly string[],
) {
  for (const id of visible) {
    await expect(page.getByTestId(`ws-panel-${id}`)).toBeVisible();
  }
  for (const id of hidden) {
    await expect(page.getByTestId(`ws-panel-${id}`)).toHaveCount(0);
  }
}

/**
 * The grid's inline style. The browser serializes the shell's
 * grid-template-rows/columns/areas either as longhands
 * (grid-template-areas:...) or collapsed into the `grid-template`
 * shorthand, depending on the row/column values — the quoted area strings
 * (e.g. `"risk risk"`) appear in both forms, so assertions target those.
 */
async function readGridTemplate(page: Page): Promise<string> {
  const style = await page.getByTestId('ws-grid').getAttribute('style');
  return style ?? '';
}

test.describe('workstation saved views', () => {
  test('three curated system templates render; grid adapts per template (2560x1440)', async ({
    page,
    request,
  }, testInfo) => {
    const { consoleErrors, pageErrors } = watchForErrors(page);
    await page.setViewportSize({ width: 2560, height: 1440 });
    await resetViewStore(page, request);
    await page.goto('/dev/workstation');

    // ── Default startup view: operational panels render, Watchlist and
    //    Review Metrics (M018) do not ──
    await expect(page.getByTestId('ws-toolbar')).toBeVisible();
    await expect(page.getByTestId('ws-view-switcher-current-name')).toHaveText(
      'Risk & Positions',
    );
    await expectPanels(page, TEMPLATE_PANELS['Risk & Positions'], [
      'watchlist',
      'process-review',
    ]);

    // The data-quality alert strip is visible (fixture valuation is
    // partial) and sits OUTSIDE the grid — a sibling, never a descendant.
    const strip = page.getByTestId('ws-data-quality-alert-strip');
    await expect(strip).toBeVisible();
    expect(
      await strip.evaluate((el) => el.closest('[data-testid="ws-grid"]') !== null),
    ).toBe(false);

    // The dynamic grid carries an inline template (computed from the view).
    // Dense v3 Risk & Positions (M018): full-width Main Risk Metrics, the
    // compact Account State | Performance summary row (Performance spans two
    // of the three columns), then the full-width Trades workspace. Chrome
    // serializes the three grid-template-* props either as longhands
    // (grid-template-areas:) or collapsed into the grid-template shorthand,
    // depending on the row/column values — the quoted area rows appear in
    // both forms, so assert on those.
    expect(await readGridTemplate(page)).toContain('"risk risk risk"');
    expect(await readGridTemplate(page)).toContain('"account perf perf"');
    expect(await readGridTemplate(page)).toContain('"trades trades trades"');

    // No horizontal overflow at 2560×1440.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(overflow).toBe(false);

    // ── Switcher lists the three curated templates with a Startup badge ──
    await openViewSwitcher(page);
    for (const name of ['Risk & Positions', 'Performance', 'Process Review']) {
      await expect(page.getByRole('menuitem', { name })).toBeVisible();
    }
    await expect(page.getByTestId('ws-view-startup-badge')).toBeVisible();

    // ── Performance template: watchlist + process-review have no cells ──
    await selectView(page, SYSTEM_VIEW_IDS.PERFORMANCE);
    await expect(page.getByTestId('ws-view-switcher-current-name')).toHaveText(
      'Performance',
    );
    await expectPanels(page, TEMPLATE_PANELS.Performance, ['watchlist', 'process-review']);
    // Performance template: watchlist has no cells in the serialized grid.
    expect(await readGridTemplate(page)).not.toContain('"watchlist');

    await page.screenshot({
      path: testInfo.outputPath('2560x1440-performance-template.png'),
    });

    // ── Process Review template: performance + watchlist have no cells ──
    await selectView(page, SYSTEM_VIEW_IDS.PROCESS_REVIEW);
    await expect(page.getByTestId('ws-view-switcher-current-name')).toHaveText(
      'Process Review',
    );
    await expectPanels(page, TEMPLATE_PANELS['Process Review'], [
      'performance',
      'watchlist',
    ]);

    // ── Back to the immutable default: the curated flow is restored ──
    await selectView(page, SYSTEM_VIEW_IDS.RISK_POSITIONS);
    await expect(page.getByTestId('ws-view-switcher-current-name')).toHaveText(
      'Risk & Positions',
    );
    await expectPanels(page, TEMPLATE_PANELS['Risk & Positions'], [
      'watchlist',
      'process-review',
    ]);

    expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });

  test('Risk & Positions uses one document scroll path with a compact Account State | Performance summary row (1536x960)', async ({
    page,
    request,
  }, testInfo) => {
    await page.setViewportSize({ width: 1536, height: 960 });
    await resetViewStore(page, request);
    await page.goto('/dev/workstation');

    const grid = page.getByTestId('ws-grid');
    await expect(grid).toHaveAttribute('data-scroll-mode', 'document');
    await expect(page.getByTestId('ws-panel-watchlist')).toHaveCount(0);
    // M018: Review Metrics leaves the curated default — its dedicated saved
    // view renders the review panel (asserted in the first test).
    await expect(page.getByTestId('ws-panel-process-review')).toHaveCount(0);

    // Dense summary row: Account State (one column) | Performance (two
    // grouped KPI columns) share one row below the full-width Main Risk
    // Metrics band. The Trades workspace then occupies its own full-width
    // document band.
    const [performanceBox, accountBox, positionsBox] = await Promise.all([
      page.getByTestId('ws-panel-performance').boundingBox(),
      page.getByTestId('ws-panel-account-state').boundingBox(),
      page.getByTestId('ws-panel-positions').boundingBox(),
    ]);
    expect(performanceBox).not.toBeNull();
    expect(accountBox).not.toBeNull();
    expect(positionsBox).not.toBeNull();
    // The two summary-row panels share one y; Performance spans two of the
    // three equal grid columns, so it is clearly wider than Account State
    // but still fits inside the full-width row.
    expect(Math.abs(performanceBox!.y - accountBox!.y)).toBeLessThanOrEqual(1);
    expect(performanceBox!.width).toBeGreaterThan(accountBox!.width);
    expect(performanceBox!.width).toBeLessThan(3 * accountBox!.width);
    // The full-width Trades workspace starts below the summary row.
    expect(positionsBox!.y).toBeGreaterThanOrEqual(
      Math.max(performanceBox!.y, accountBox!.y) + Math.max(performanceBox!.height, accountBox!.height),
    );
    // Document-flow rows size to their actual content. They must not inherit
    // the contained-workstation 1fr tracks and become large blank panels.
    expect(positionsBox!.height).toBeLessThan(500);
    expect(performanceBox!.height).toBeLessThan(700);

    // These panels must expand into the document. Their bodies must not have
    // separate scrollbars, and the browser document must be scrollable.
    for (const id of ['account-state', 'performance', 'positions']) {
      const body = page.getByTestId(`ws-panel-${id}`).locator('.ws-panel-body').first();
      await expect(body).toBeVisible();
      expect(await body.evaluate((element) => getComputedStyle(element).overflowY)).toBe('visible');
    }
    const pageScroll = await page.evaluate(() => ({
      height: document.documentElement.scrollHeight,
      viewport: document.documentElement.clientHeight,
    }));
    expect(pageScroll.height).toBeGreaterThan(pageScroll.viewport);

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    // The Trades workspace is the last band of the default document flow.
    await expect(page.getByTestId('ws-panel-positions')).toBeInViewport();

    const screenshotPath = testInfo.outputPath('risk-positions-document-flow-1536x960.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    await testInfo.attach('risk-positions-document-flow-1536x960.png', {
      path: screenshotPath,
      contentType: 'image/png',
    });
  });

  test('customize is an explicit editing mode with save/cancel/undo/reset (1536x960)', async ({
    page,
    request,
  }, testInfo) => {
    const { consoleErrors, pageErrors } = watchForErrors(page);
    await page.setViewportSize({ width: 1536, height: 960 });
    await resetViewStore(page, request);
    await page.goto('/dev/workstation');

    const trigger = page.getByTestId('ws-customize-trigger');

    // ── Normal mode: no editing chrome anywhere ──
    await expect(page.getByTestId('ws-customize-bar')).toHaveCount(0);
    await expect(page.getByTestId('ws-customize-hide-watchlist')).toHaveCount(0);
    await expect(page.getByTestId('ws-customize-cell-watchlist')).toHaveCount(0);

    // System presets are read-only (R035): Customize is disabled and the
    // view actions that mutate a view are disabled in the switcher.
    await expect(trigger).toBeDisabled();
    await openViewSwitcher(page);
    await expect(page.getByTestId('ws-view-rename')).toBeDisabled();
    await expect(page.getByTestId('ws-view-reset-template')).toBeDisabled();
    await expect(page.getByTestId('ws-view-delete')).toBeDisabled();
    await expect(page.getByTestId('ws-view-duplicate')).toBeEnabled();
    await page.keyboard.press('Escape');

    // ── Create a user view (prompt) — now customizable ──
    page.once('dialog', (dialog) => dialog.accept('My View'));
    await openViewSwitcher(page);
    await page.getByTestId('ws-view-create-new').click();
    await expect(page.getByTestId('ws-view-switcher-current-name')).toHaveText(
      'My View',
    );
    await expect(trigger).toBeEnabled();

    // ── Enter customize: explicit session chrome ──
    await trigger.click();
    const bar = page.getByTestId('ws-customize-bar');
    await expect(bar).toBeVisible();
    await expect(page.getByTestId('ws-customize-title')).toHaveText(
      'Customizing: My View',
    );
    // Watchlist is intentionally absent from the curated Risk & Positions
    // starting view, but a user-created view may explicitly add it back.
    await expect(page.getByTestId('ws-customize-all-visible')).toHaveCount(0);
    await expect(page.getByTestId('ws-customize-show-watchlist')).toBeVisible();
    await expect(page.getByTestId('ws-customize-fixed-note')).toHaveText(
      'Risk · Trades are always visible',
    );
    // Save/Undo start inert on a clean session.
    await expect(page.getByTestId('ws-customize-save')).toBeDisabled();
    await expect(page.getByTestId('ws-customize-undo')).toBeDisabled();
    // Fixed panels are not editable — no hide overlays on them.
    await expect(page.getByTestId('ws-customize-hide-risk')).toHaveCount(0);
    await expect(page.getByTestId('ws-customize-hide-positions')).toHaveCount(0);

    // Alert strip + customize bar both stay OUTSIDE the editable layout.
    const strip = page.getByTestId('ws-data-quality-alert-strip');
    await expect(strip).toBeVisible();
    expect(
      await bar.evaluate((el) => el.closest('[data-testid="ws-grid"]') !== null),
    ).toBe(false);
    expect(
      await strip.evaluate((el) => el.closest('[data-testid="ws-grid"]') !== null),
    ).toBe(false);

    await page.screenshot({
      path: testInfo.outputPath('1536x960-customize-session.png'),
    });

    // ── Watchlist remains available to an explicit saved-view choice ──
    await page.getByTestId('ws-customize-show-watchlist').click();
    await expect(page.getByTestId('ws-panel-watchlist')).toBeVisible();
    await expect(page.getByTestId('ws-customize-dirty')).toBeVisible();
    await page.getByTestId('ws-customize-undo').click();
    await expect(page.getByTestId('ws-panel-watchlist')).toHaveCount(0);
    await expect(page.getByTestId('ws-customize-dirty')).toHaveCount(0);

    // ── Hide an optional panel: live draft preview + dirty state ──
    await page.getByTestId('ws-customize-hide-perf').click();
    await expect(page.getByTestId('ws-panel-performance')).toHaveCount(0);
    await expect(page.getByTestId('ws-customize-dirty')).toBeVisible();
    await expect(page.getByTestId('ws-customize-save')).toBeEnabled();
    await expect(page.getByTestId('ws-customize-undo')).toBeEnabled();
    await expect(page.getByTestId('ws-customize-show-perf')).toBeVisible();

    // ── Undo restores the previous draft state ──
    await page.getByTestId('ws-customize-undo').click();
    await expect(page.getByTestId('ws-panel-performance')).toBeVisible();
    await expect(page.getByTestId('ws-customize-dirty')).toHaveCount(0);
    await expect(page.getByTestId('ws-customize-save')).toBeDisabled();

    // ── Reset returns the draft to the template base (clean session) ──
    await page.getByTestId('ws-customize-hide-perf').click();
    await page.getByTestId('ws-customize-reset').click();
    await expect(page.getByTestId('ws-panel-performance')).toBeVisible();
    await expect(page.getByTestId('ws-panel-watchlist')).toHaveCount(0);
    await expect(page.getByTestId('ws-customize-dirty')).toHaveCount(0);
    await expect(page.getByTestId('ws-customize-save')).toBeDisabled();

    // ── Cancel discards the draft; the persisted view is untouched ──
    await page.getByTestId('ws-customize-hide-perf').click();
    await page.getByTestId('ws-customize-cancel').click();
    await expect(bar).toHaveCount(0);
    await expect(page.getByTestId('ws-panel-performance')).toBeVisible();
    await expect(page.getByTestId('ws-customize-hide-perf')).toHaveCount(0);

    // ── Save persists the draft and exits the session ──
    await trigger.click();
    await page.getByTestId('ws-customize-hide-perf').click();
    await page.getByTestId('ws-customize-save').click();
    await expect(bar).toHaveCount(0);
    await expect(page.getByTestId('ws-panel-performance')).toHaveCount(0);
    await expect(page.getByTestId('ws-customize-hide-perf')).toHaveCount(0);

    // ── Re-enter on the persisted config: show chip + round-trip show ──
    await trigger.click();
    await expect(page.getByTestId('ws-customize-show-perf')).toBeVisible();
    await page.getByTestId('ws-customize-show-perf').click();
    await expect(page.getByTestId('ws-panel-performance')).toBeVisible();
    await expect(page.getByTestId('ws-customize-dirty')).toBeVisible();
    // Cancel keeps the persisted config (Performance hidden) intact.
    await page.getByTestId('ws-customize-cancel').click();
    await expect(bar).toHaveCount(0);
    await expect(page.getByTestId('ws-panel-watchlist')).toHaveCount(0);
    await expect(page.getByTestId('ws-panel-performance')).toHaveCount(0);

    // No horizontal overflow at effective 1536×960.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(overflow).toBe(false);

    expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });

  test('user-view CRUD: duplicate, rename, startup, persistence, delete', async ({
    page,
    request,
  }) => {
    const { consoleErrors, pageErrors } = watchForErrors(page);
    await resetViewStore(page, request);
    await page.goto('/dev/workstation');

    // ── Create "Alpha" from the active template ──
    page.once('dialog', (dialog) => dialog.accept('Alpha'));
    await openViewSwitcher(page);
    await page.getByTestId('ws-view-create-new').click();
    await expect(page.getByTestId('ws-view-switcher-current-name')).toHaveText(
      'Alpha',
    );

    // ── Duplicate → "Alpha (Copy)" becomes the active view ──
    await openViewSwitcher(page);
    await page.getByTestId('ws-view-duplicate').click();
    await expect(page.getByTestId('ws-view-switcher-current-name')).toHaveText(
      'Alpha (Copy)',
    );

    // ── Rename → "Alpha 2" ──
    page.once('dialog', (dialog) => dialog.accept('Alpha 2'));
    await openViewSwitcher(page);
    await page.getByTestId('ws-view-rename').click();
    await expect(page.getByTestId('ws-view-switcher-current-name')).toHaveText(
      'Alpha 2',
    );

    // ── Set as startup: the star badge moves to the selected view ──
    await openViewSwitcher(page);
    await page.getByTestId('ws-view-set-startup').click();
    await openViewSwitcher(page);
    const startupRow = page.getByRole('menuitem', { name: 'Alpha 2', exact: true });
    await expect(startupRow.getByTestId('ws-view-startup-badge')).toBeVisible();
    await page.keyboard.press('Escape');

    // ── Persistence: wait for the API dual-write, then reload. The
    //    startup view is restored on load (R035). ──
    await expect
      .poll(
        async () => {
          const res = await request.get('/api/dashboard/views');
          const rows = (await res.json()) as Array<{ name: string; isDefault: boolean }>;
          return rows.some((row) => row.name === 'Alpha 2' && row.isDefault === true);
        },
        { timeout: 5_000 },
      )
      .toBe(true);

    await page.reload();
    await expect(page.getByTestId('ws-view-switcher-current-name')).toHaveText(
      'Alpha 2',
    );

    // ── Delete the active user view: falls back to the Risk & Positions
    //    preset (immutable system default). ──
    page.once('dialog', (dialog) => dialog.accept());
    await openViewSwitcher(page);
    await expect(page.getByRole('menuitem', { name: 'Alpha', exact: true })).toBeVisible();
    await page.getByTestId('ws-view-delete').click();
    await expect(page.getByTestId('ws-view-switcher-current-name')).toHaveText(
      'Risk & Positions',
    );
    await openViewSwitcher(page);
    await expect(page.getByRole('menuitem', { name: 'Alpha', exact: true })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Alpha 2', exact: true })).toHaveCount(
      0,
    );
    await page.keyboard.press('Escape');

    expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });
});
