/**
 * M026-1bw68n S03 T01 — Workstation responsive architecture verification
 *
 * Verification-first browser proof for the responsive workstation contract
 * (requirements §11 Responsive Architecture / §21 Visual UAT, gap G2 from the
 * S01 audit). The workstation must render usefully at:
 *
 *   1440 px
 *   1280 px
 *   1024 px
 *
 * with:
 *  1. Risk state prominent at every width — the full-width risk band is the
 *     topmost panel and all eight current-state cells stay visible (safety
 *     content is never hidden to "solve" a compact width).
 *  2. Trades operationally usable — the 9-column risk-first table renders,
 *     rows are populated, the last (Exposure) column is reachable inside the
 *     panel, and nothing forces document-level horizontal overflow.
 *  3. Summary row panels readable — no nested scrollbars in the
 *     document-flow default and no horizontally clipped stat rows.
 *  4. No nested-scroll regression — the curated Risk & Positions surface
 *     keeps its single page-scroll path (document mode); the contained
 *     Performance / Process Review templates stay bounded to the viewport.
 *  5. Arrange/customize chrome only in explicit mode — normal mode at every
 *     width carries no customize bar, arrange grid, drag handles, or RGL
 *     resize handles; entering a customize session and the arrange sub-mode
 *     is the only way the chrome appears (proven at 1024 px).
 *
 * Every test runs on the deterministic fixture harness (/dev/workstation) and
 * exercises all three curated system templates (Risk & Positions, Performance,
 * Process Review) at the target width, attaching screenshot evidence per
 * width.
 *
 * Note on `ws-panel-trades`: the Trades workspace panel keeps the canonical
 * `ws-panel-positions` testid (the M017/S03 outer wrapper; the arrangement
 * cell is `ws-arrange-cell-trades`). `ws-panel-trades` is not a rendered
 * testid — the assertions below target `ws-panel-positions` and the arrange
 * cell, which is what the CSS contract actually pins.
 *
 * Isolation: each test starts from a pristine store — the shared disposable
 * per-run database is cleaned of user workstation rows (ws-*) and the test
 * context starts with empty localStorage — so API hydration always lands on
 * the three default system templates regardless of earlier tests
 * (same pattern as workstation-arrange.spec.ts / workstation-views.spec.ts).
 *
 * Run: npx playwright test e2e/workstation-responsive.spec.ts --project=chromium
 */

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

/** localStorage key owned by useWorkstationViews. */
const STORAGE_KEY = 'workstation:views:v1';

/** Canonical ids of the three curated system template views. */
const SYSTEM_VIEW_IDS = {
  RISK_POSITIONS: 'ws-system-risk-positions',
  PERFORMANCE: 'ws-system-performance',
  PROCESS_REVIEW: 'ws-system-process-review',
} as const;

/** The eight current-state cells of the risk band (never hidden at any width). */
const RISK_CELL_IDS = [
  'positions',
  'open-pnl',
  'initial-risk',
  'open-risk',
  'heat',
  'coverage',
  'gross',
  'net',
] as const;

/** Target viewport widths from §11 Responsive Architecture. */
const VIEWPORTS = [
  { name: '1440', width: 1440, height: 900 },
  { name: '1280', width: 1280, height: 900 },
  { name: '1024', width: 1024, height: 900 },
] as const;

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
 * Reset the workstation view store to its pristine defaults: delete every
 * user workstation row (ws-*, non-system) from the shared API table and
 * clear localStorage for the workstation views key on every navigation (see
 * workstation-views.spec.ts for the cold-dev-server retry rationale).
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
 * Wait for the client-side workstation view store to settle. The grid is
 * SSR-visible before hydration; the view-switcher current-name only reflects
 * the active view once useWorkstationViews has hydrated, so waiting on it
 * before driving the view switcher avoids racing the React handlers.
 */
async function waitForWorkstationHydration(page: Page) {
  await expect(page.getByTestId('ws-fixture-badge')).toBeVisible();
  await expect(page.getByTestId('ws-grid')).toBeVisible();
  await expect(page.getByTestId('ws-view-switcher-current-name')).toHaveText(
    'Risk & Positions',
    { timeout: 10_000 },
  );
}

/**
 * Open the view switcher dropdown and wait for its content. The Radix
 * dropdown is modal: while open it applies inline `pointer-events: none` to
 * <body>, so the trigger itself becomes un-clickable — close it first via
 * Escape (pattern from workstation-views.spec.ts).
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

/** Select a system template view by id and wait for the dropdown to close. */
async function selectView(page: Page, viewId: string) {
  await openViewSwitcher(page);
  await page.getByTestId(`ws-view-item-${viewId}`).click();
  await expect(page.getByTestId('ws-view-switcher-content')).toHaveCount(0);
}

/** Create a user view from the active template via the switcher prompt. */
async function createUserView(page: Page, name: string) {
  page.once('dialog', (dialog) => dialog.accept(name));
  await openViewSwitcher(page);
  await page.getByTestId('ws-view-create-new').click();
  await expect(page.getByTestId('ws-view-switcher-current-name')).toHaveText(name);
}

/** Open a customize session (the toolbar trigger enables on user views). */
async function enterCustomize(page: Page) {
  await page.getByTestId('ws-customize-trigger').click();
  await expect(page.getByTestId('ws-customize-bar')).toBeVisible();
}

// ── Contract assertions ──────────────────────────────────────────────────

/** No document-level horizontal overflow at the current viewport width. */
async function assertNoHorizontalOverflow(page: Page, viewportWidth: number) {
  const dims = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(
    dims.scrollWidth,
    `no document horizontal overflow at ${viewportWidth}px ` +
      `(scrollWidth ${dims.scrollWidth} > innerWidth ${dims.innerWidth})`,
  ).toBeLessThanOrEqual(dims.innerWidth + 1);
}

/** Normal mode carries no customize/arrange chrome at any width. */
async function assertNoEditingChrome(page: Page) {
  await expect(page.getByTestId('ws-customize-bar')).toHaveCount(0);
  await expect(page.getByTestId('ws-customize-hint')).toHaveCount(0);
  await expect(page.getByTestId('ws-arrange-mode')).toHaveCount(0);
  await expect(page.getByTestId('ws-arrange-grid')).toHaveCount(0);
  await expect(page.locator('[data-testid^="ws-arrange-handle-"]')).toHaveCount(0);
  await expect(page.locator('.react-resizable-handle')).toHaveCount(0);
  // The toolbar trigger exists but stays disabled for read-only system
  // presets — explicit mode is the only way to edit.
  await expect(page.getByTestId('ws-customize-trigger')).toBeDisabled();
}

/** Risk is the full-width topmost panel and all eight cells stay visible. */
async function assertRiskProminent(page: Page, viewportWidth: number) {
  const grid = page.getByTestId('ws-grid');
  await expect(grid).toBeVisible();
  const gridBox = await grid.boundingBox();
  expect(gridBox, 'grid has layout box').not.toBeNull();

  const risk = page.getByTestId('ws-panel-risk');
  await expect(risk).toBeVisible();
  const riskBox = await risk.boundingBox();
  expect(riskBox, 'risk panel has layout box').not.toBeNull();

  // The grid owns a content inset (var(--ws-space-3) = 6px padding), so the
  // full-width contract is measured against the grid's content box: risk
  // starts at content-left and ends at content-right at every width.
  const gridPadding = await grid.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { left: parseFloat(cs.paddingLeft), right: parseFloat(cs.paddingRight) };
  });
  const contentLeft = gridBox!.x + gridPadding.left;
  const contentRight = gridBox!.x + gridBox!.width - gridPadding.right;
  expect(
    riskBox!.x - contentLeft,
    `risk starts at grid content left edge at ${viewportWidth}px`,
  ).toBeLessThanOrEqual(2);
  expect(
    contentRight - (riskBox!.x + riskBox!.width),
    `risk ends at grid content right edge at ${viewportWidth}px`,
  ).toBeLessThanOrEqual(2);

  // Risk is the topmost panel (first grid item, below the toolbar).
  const gridPaddingTop = await grid.evaluate((el) =>
    parseFloat(getComputedStyle(el).paddingTop),
  );
  expect(
    riskBox!.y - (gridBox!.y + gridPaddingTop),
    `risk is the topmost panel at ${viewportWidth}px`,
  ).toBeLessThanOrEqual(2);

  // All eight current-state cells render — compact widths never hide
  // safety-critical risk state.
  for (const id of RISK_CELL_IDS) {
    await expect(
      page.getByTestId(`ws-risk-cell-${id}`),
      `risk cell ${id} visible at ${viewportWidth}px`,
    ).toBeVisible();
  }

  // Risk sits above the trades workspace in the document flow.
  const trades = page.getByTestId('ws-panel-positions');
  const tradesBox = await trades.boundingBox();
  expect(tradesBox, 'trades panel has layout box').not.toBeNull();
  expect(riskBox!.y + riskBox!.height).toBeLessThanOrEqual(tradesBox!.y + 1);
}

/** Trades workspace: table renders, rows populated, last column reachable. */
async function assertTradesUsable(page: Page, viewportWidth: number) {
  const trades = page.getByTestId('ws-panel-positions');
  await expect(trades).toBeVisible();
  const panelBox = await trades.boundingBox();
  expect(panelBox, 'trades panel has layout box').not.toBeNull();

  // Both universe tabs are reachable.
  await expect(page.getByTestId('ws-trades-tab-open')).toBeVisible();
  await expect(page.getByTestId('ws-trades-tab-closed')).toBeVisible();

  // The open-universe table renders its 9-column risk-first contract.
  const table = page.getByTestId('ws-positions-table');
  await expect(table).toBeVisible();
  await expect(table.locator('thead th')).toHaveCount(9);

  // Rows are populated (default fixture: 3 open positions).
  const rows = table.locator('tbody tr');
  const rowCount = await rows.count();
  expect(rowCount, `positions table has rows at ${viewportWidth}px`).toBeGreaterThan(0);

  // The last column (Exposure) is reachable inside the panel's right edge —
  // table content must never be clipped or force document-level overflow.
  const lastCell = rows.first().locator('td').last();
  await expect(lastCell).toBeVisible();
  const cellBox = await lastCell.boundingBox();
  expect(cellBox, 'exposure cell has layout box').not.toBeNull();
  expect(
    cellBox!.x + cellBox!.width,
    `trades last column inside panel right edge at ${viewportWidth}px`,
  ).toBeLessThanOrEqual(panelBox!.x + panelBox!.width + 1);
}

/**
 * Summary row panels are readable: stat rows render inside the panel's
 * horizontal bounds, and in document flow no descendant scrolls internally.
 * `contentSelector` targets the panel's stat rows for the bounds check.
 */
async function assertSummaryReadable(
  page: Page,
  panelTestIds: string[],
  options: { documentFlow: boolean; contentSelector: string },
) {
  for (const testId of panelTestIds) {
    const panel = page.getByTestId(testId);
    await expect(panel, `${testId} visible`).toBeVisible();
    const panelBox = await panel.boundingBox();
    expect(panelBox, `${testId} has layout box`).not.toBeNull();

    // At least one non-empty value renders (no placeholder dashes only).
    const values = panel.locator('.ws-num');
    expect(await values.count(), `${testId} renders values`).toBeGreaterThan(0);

    if (options.documentFlow) {
      // No nested scrollbar: no descendant of the panel scrolls internally.
      // (Document mode makes panel bodies overflow: visible — a scrollable
      // descendant would be a regression of the single page-scroll path.)
      const scrollables = await panel.evaluate((el) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT);
        const found: string[] = [];
        let node = walker.nextNode();
        while (node) {
          const n = node as HTMLElement;
          const overflowY = getComputedStyle(n).overflowY;
          if (
            (overflowY === 'auto' || overflowY === 'scroll') &&
            n.scrollHeight > n.clientHeight + 1
          ) {
            found.push(`${n.tagName.toLowerCase()}.${String(n.className).split(' ')[0]}`);
          }
          node = walker.nextNode();
        }
        return found;
      });
      expect(scrollables, `no nested scrollbar inside ${testId}`).toEqual([]);
    }

    // Content is not clipped horizontally: stat rows stay inside the panel.
    const rows = panel.locator(options.contentSelector);
    expect(await rows.count(), `${testId} renders stat rows`).toBeGreaterThan(0);
    const overflowing = await rows.evaluateAll(
      (els, panelRight) =>
        els.filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.right > panelRight + 1;
        }).length,
      panelBox!.x + panelBox!.width,
    );
    expect(
      overflowing,
      `${testId} stat rows inside panel right edge`,
    ).toBe(0);
  }
}

/** Grid/scroll-mode contract for a template at the current width. */
async function assertScrollMode(page: Page, mode: 'document' | 'contained') {
  await expect(page.getByTestId('ws-grid')).toHaveAttribute('data-scroll-mode', mode);
  const dims = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
  }));
  if (mode === 'document') {
    // Single page-scroll path: the document grows beyond the viewport.
    expect(dims.scrollHeight, 'document scrolls (single page-scroll path)').toBeGreaterThan(
      dims.clientHeight,
    );
  } else {
    // Contained template: the surface stays bounded to the viewport.
    expect(
      dims.scrollHeight,
      'contained template stays within the viewport height',
    ).toBeLessThanOrEqual(dims.clientHeight + 1);
  }
}

/** Run the full per-width contract against one template. */
async function assertTemplateContract(
  page: Page,
  options: {
    viewportWidth: number;
    scrollMode: 'document' | 'contained';
    summaryPanels: string[];
    contentSelector: string;
  },
) {
  await assertScrollMode(page, options.scrollMode);
  await assertNoHorizontalOverflow(page, options.viewportWidth);
  await assertNoEditingChrome(page);
  await assertRiskProminent(page, options.viewportWidth);
  await assertTradesUsable(page, options.viewportWidth);
  await assertSummaryReadable(page, options.summaryPanels, {
    documentFlow: options.scrollMode === 'document',
    contentSelector: options.contentSelector,
  });
}

// ── Responsive contract at 1440 / 1280 / 1024 ────────────────────────────

for (const vp of VIEWPORTS) {
  test(`workstation at ${vp.width}x${vp.height}: all three templates — risk prominent, trades usable, summary readable, no editing chrome`, async ({
    page,
    request,
  }, testInfo) => {
    const { consoleErrors, pageErrors } = watchForErrors(page);
    await resetViewStore(page, request);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto('/dev/workstation');
    await waitForWorkstationHydration(page);

    // ── Template 1: Risk & Positions (curated default, document flow) ──
    await expect(page.getByTestId('ws-view-switcher-current-name')).toHaveText(
      'Risk & Positions',
    );
    await assertTemplateContract(page, {
      viewportWidth: vp.width,
      scrollMode: 'document',
      summaryPanels: ['ws-panel-account-state', 'ws-panel-performance'],
      contentSelector: '.ws-stat-row, .ws-account-stat-row',
    });
    // The default is the dense risk-first workflow: review metrics and
    // watchlist stay out of the curated setup.
    await expect(page.getByTestId('ws-panel-process-review')).toHaveCount(0);
    await expect(page.getByTestId('ws-panel-watchlist')).toHaveCount(0);

    const defaultShot = await page.screenshot({ fullPage: false });
    await testInfo.attach(`responsive-${vp.name}-risk-positions.png`, {
      body: defaultShot,
      contentType: 'image/png',
    });

    // ── Template 2: Performance (contained grid, full-width perf panel) ──
    await selectView(page, SYSTEM_VIEW_IDS.PERFORMANCE);
    await expect(page.getByTestId('ws-panel-performance')).toBeVisible();
    await expect(page.getByTestId('ws-performance-kpis')).toBeVisible();
    await expect(page.getByTestId('ws-panel-process-review')).toHaveCount(0);
    await assertTemplateContract(page, {
      viewportWidth: vp.width,
      scrollMode: 'contained',
      summaryPanels: ['ws-panel-account-state', 'ws-panel-performance'],
      contentSelector: '.ws-stat-row, .ws-account-stat-row',
    });

    const perfShot = await page.screenshot({ fullPage: false });
    await testInfo.attach(`responsive-${vp.name}-performance.png`, {
      body: perfShot,
      contentType: 'image/png',
    });

    // ── Template 3: Process Review (contained grid, review panel) ──
    await selectView(page, SYSTEM_VIEW_IDS.PROCESS_REVIEW);
    await expect(page.getByTestId('ws-panel-process-review')).toBeVisible();
    await expect(page.getByTestId('ws-process-score-dist')).toBeVisible();
    await expect(page.getByTestId('ws-panel-performance')).toHaveCount(0);
    await assertTemplateContract(page, {
      viewportWidth: vp.width,
      scrollMode: 'contained',
      summaryPanels: ['ws-panel-account-state'],
      contentSelector: '.ws-account-stat-row',
    });
    // The review panel's score distribution renders (not clipped).
    const scoreDist = page.getByTestId('ws-process-score-dist');
    await expect(scoreDist.locator('[data-testid="ws-process-score-row"]').first()).toBeVisible();

    const reviewShot = await page.screenshot({ fullPage: false });
    await testInfo.attach(`responsive-${vp.name}-process-review.png`, {
      body: reviewShot,
      contentType: 'image/png',
    });

    expect(pageErrors, 'uncaught page errors').toEqual([]);
    expect(consoleErrors, 'console.error output').toEqual([]);
  });
}

// ── Explicit mode at the most constrained width ──────────────────────────

test('at 1024px, arrange/customize chrome appears only in explicit mode (customize session + arrange grid)', async ({
  page,
  request,
}, testInfo) => {
  const { consoleErrors, pageErrors } = watchForErrors(page);
  await resetViewStore(page, request);
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto('/dev/workstation');
  await waitForWorkstationHydration(page);

  // Normal mode at 1024 px: zero editing chrome (contract above).
  await assertNoEditingChrome(page);

  // Explicit customize session: the bar appears, but the hide/show sub-mode
  // still carries no drag/resize chrome.
  await createUserView(page, 'Responsive Explicit');
  await expect(page.getByTestId('ws-customize-trigger')).toBeEnabled();
  await enterCustomize(page);
  await expect(page.getByTestId('ws-grid')).toBeVisible();
  await expect(page.getByTestId('ws-arrange-grid')).toHaveCount(0);
  await expect(page.locator('[data-testid^="ws-arrange-handle-"]')).toHaveCount(0);
  await expect(page.locator('.react-resizable-handle')).toHaveCount(0);

  // Enter the arrangement sub-mode: the RGL grid replaces the CSS grid and
  // labelled handles appear on eligible panels only — and the arrange grid
  // stays within the 1024 px viewport (no horizontal overflow).
  await page.getByTestId('ws-customize-arrange-toggle').click();
  await expect(page.getByTestId('ws-arrange-mode')).toBeVisible();
  await expect(page.getByTestId('ws-arrange-grid')).toBeVisible();
  await expect(page.getByTestId('ws-arrange-hint')).toBeVisible();
  await assertNoHorizontalOverflow(page, 1024);

  // Protected anchors keep their fixed flag and never gain drag handles.
  await expect(page.getByTestId('ws-arrange-cell-risk')).toHaveAttribute(
    'data-ws-arrange-fixed',
    'true',
  );
  await expect(page.getByTestId('ws-arrange-cell-trades')).toHaveAttribute(
    'data-ws-arrange-fixed',
    'true',
  );
  await expect(page.getByTestId('ws-arrange-handle-risk')).toHaveCount(0);
  await expect(page.getByTestId('ws-arrange-handle-trades')).toHaveCount(0);
  // The curated default's eligible panels (account, perf) gain handles.
  await expect(page.getByTestId('ws-arrange-handle-account')).toBeVisible();
  await expect(page.getByTestId('ws-arrange-handle-perf')).toBeVisible();

  const arrangeShot = await page.screenshot({ fullPage: false });
  await testInfo.attach('responsive-1024-arrange-mode.png', {
    body: arrangeShot,
    contentType: 'image/png',
  });

  // Escape exits back to the hide/show CSS grid; Cancel ends the session.
  // Return to the read-only Risk & Positions preset so the full normal-mode
  // contract (including the disabled customize trigger for system presets)
  // applies, then confirm normal mode is again free of editing chrome.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('ws-arrange-mode')).toHaveCount(0);
  await expect(page.getByTestId('ws-grid')).toBeVisible();
  await page.getByTestId('ws-customize-cancel').click();
  await expect(page.getByTestId('ws-customize-bar')).toHaveCount(0);
  await selectView(page, SYSTEM_VIEW_IDS.RISK_POSITIONS);
  await expect(page.getByTestId('ws-view-switcher-current-name')).toHaveText(
    'Risk & Positions',
  );
  await assertNoEditingChrome(page);

  expect(pageErrors, 'uncaught page errors').toEqual([]);
  expect(consoleErrors, 'console.error output').toEqual([]);
});
