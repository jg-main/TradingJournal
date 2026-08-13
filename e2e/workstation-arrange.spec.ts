/**
 * M017 S04 T04 — Workstation Saved-View Arrangement Mode E2E
 *
 * End-to-end proof for the S04 slice contract on the deterministic fixture
 * harness (/dev/workstation), covering every item in the slice verification:
 *
 * 1. Enter/exit arrangement mode: the Arrange toggle in the customize bar
 *    swaps the hide/show CSS grid for the react-grid-layout arrangement
 *    grid (data-testid ws-arrange-mode / ws-arrange-grid); exiting via the
 *    toggle or Escape returns to the hide/show CSS grid with the draft
 *    intact.
 * 2. Drag-handle visibility: labelled drag handles (ws-arrange-handle-*,
 *    role=button, aria-label "Drag <Title> to move") appear on eligible
 *    panels only (account, perf, review) — never on the protected anchors
 *    (risk, trades) or hidden panels (watchlist).
 * 3. Resize-handle visibility: exactly one southeast resize handle
 *    (.react-resizable-handle-se) per eligible panel and none on fixed
 *    anchors (data-ws-arrange-fixed="true" cells render no handle).
 * 4. Keyboard move/grow/shrink: Arrow keys move the focused panel one cell
 *    (swap semantics in the packed summary row); Shift+Arrow grows/shrinks
 *    within the catalogue bounds; boundary moves into fixed anchors or the
 *    grid edge are silent no-ops (no dirty state).
 * 5. Pointer drag is constrained: dragging an eligible handle commits the
 *    placement only when it is representable (free target cell); pointer
 *    input on a fixed anchor cannot start a drag.
 * 6. Save persists the layout: the arranged config lands in the shared
 *    /api/dashboard/views row (R035 validated on write) and is restored
 *    after a page refresh — normal mode then renders the saved arrangement
 *    with no editing chrome.
 * 7. Cancel discards the draft: the persisted view and its arrangement stay
 *    untouched and a fresh session starts clean from the saved base.
 * 8. Undo reverts step by step: each keyboard/pointer commit is undoable,
 *    and undoing back to the session base clears the dirty indicator.
 * 9. Reset restores the template base grid (draft-only, undoable).
 * 10. Normal mode has no drag/resize handles: outside a customize session —
 *    and in the hide/show sub-mode while customizing — there are no
 *    arrangement handles, no RGL resize handles, and no arrange grid.
 *
 * Isolation: each test starts from a pristine store — the shared disposable
 * per-run database is cleaned of workstation rows (ws-*) and the test
 * context starts with empty localStorage — so API hydration always lands on
 * the three default system templates regardless of earlier tests.
 *
 * Run: npx playwright test e2e/workstation-arrange.spec.ts --project=chromium
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

/** react-grid-layout gutter between arrangement items (ARRANGE_GRID_MARGIN). */
const ARRANGE_GRID_MARGIN = 8;

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

/** Select a view by testid and wait for the dropdown to close. */
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

/** Enter the arrangement (drag/resize) sub-mode and wait for the RGL grid. */
async function enterArrangeMode(page: Page) {
  const toggle = page.getByTestId('ws-customize-arrange-toggle');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('ws-arrange-mode')).toBeVisible();
  await expect(page.getByTestId('ws-arrange-grid')).toBeVisible();
  await expect(page.getByTestId('ws-grid')).toHaveCount(0);
}

/** Exit arrangement mode with Escape, back to the hide/show CSS grid. */
async function exitArrangeWithEscape(page: Page) {
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('ws-arrange-mode')).toHaveCount(0);
  await expect(page.getByTestId('ws-grid')).toBeVisible();
}

/**
 * The grid's inline style. The browser serializes the shell's
 * grid-template-rows/columns/areas either as longhands or collapsed into
 * the `grid-template` shorthand; the quoted area strings (e.g.
 * `"risk risk risk"`) appear in both forms, so assertions target those.
 */
async function readGridTemplate(page: Page): Promise<string> {
  const style = await page.getByTestId('ws-grid').getAttribute('style');
  return style ?? '';
}

/** Focus a panel's arrangement drag handle and confirm the focus landed. */
async function focusArrangeHandle(page: Page, panelId: string) {
  const handle = page.getByTestId(`ws-arrange-handle-${panelId}`);
  await handle.focus();
  await expect(handle).toBeFocused();
}

test.describe('workstation arrangement mode', () => {
  test('enter/exit arrangement mode; labelled drag + SE resize handles on eligible panels only; none in normal/hide-show modes', async ({
    page,
    request,
  }, testInfo) => {
    const { consoleErrors, pageErrors } = watchForErrors(page);
    await resetViewStore(page, request);
    await page.goto('/dev/workstation');

    // ── Normal mode (system view, no session): zero editing chrome ──
    await expect(page.getByTestId('ws-customize-bar')).toHaveCount(0);
    await expect(page.getByTestId('ws-arrange-grid')).toHaveCount(0);
    await expect(page.locator('[data-testid^="ws-arrange-handle-"]')).toHaveCount(0);
    await expect(page.locator('.react-resizable-handle')).toHaveCount(0);

    // ── Customize session in hide/show mode: still zero drag/resize chrome ──
    await createUserView(page, 'Arrange Handles');
    await enterCustomize(page);
    await expect(page.getByTestId('ws-grid')).toBeVisible();
    await expect(page.getByTestId('ws-arrange-grid')).toHaveCount(0);
    await expect(page.locator('[data-testid^="ws-arrange-handle-"]')).toHaveCount(0);
    await expect(page.locator('.react-resizable-handle')).toHaveCount(0);

    // ── Enter arrangement mode: the RGL grid replaces the CSS grid ──
    await enterArrangeMode(page);
    await expect(page.getByTestId('ws-arrange-hint')).toBeVisible();
    await expect(page.getByTestId('ws-arrange-hint')).toContainText('Arrow: move');
    await expect(page.getByTestId('ws-arrange-hint')).toContainText('Shift+Arrow: resize');

    // ── Drag handles: labelled, role=button, on eligible panels only ──
    for (const id of ['account', 'perf', 'review']) {
      const handle = page.getByTestId(`ws-arrange-handle-${id}`);
      await expect(handle).toBeVisible();
      await expect(handle).toHaveAttribute('role', 'button');
      await expect(handle).toHaveAttribute('aria-label', /^Drag .* to move$/);
    }
    // Protected anchors and the hidden watchlist render no drag handles.
    for (const id of ['risk', 'trades', 'watchlist']) {
      await expect(page.getByTestId(`ws-arrange-handle-${id}`)).toHaveCount(0);
    }

    // ── Resize handles: exactly the three eligible panels, none on fixed anchors ──
    const seHandles = page.locator('.ws-arrange .react-resizable-handle-se');
    await expect(seHandles).toHaveCount(3);
    await expect(seHandles.first()).toBeVisible();
    await expect(page.getByTestId('ws-arrange-cell-risk').locator('.react-resizable-handle')).toHaveCount(0);
    await expect(page.getByTestId('ws-arrange-cell-trades').locator('.react-resizable-handle')).toHaveCount(0);

    // The cells carry the protected-anchor flag consumed by the CSS.
    await expect(page.getByTestId('ws-arrange-cell-risk')).toHaveAttribute('data-ws-arrange-fixed', 'true');
    await expect(page.getByTestId('ws-arrange-cell-trades')).toHaveAttribute('data-ws-arrange-fixed', 'true');
    await expect(page.getByTestId('ws-arrange-cell-account')).toHaveAttribute('data-ws-arrange-fixed', 'false');

    // The real panel components still render inside the arrangement cells.
    await expect(page.getByTestId('ws-arrange-cell-account').getByTestId('ws-panel-account-state')).toBeVisible();
    await expect(page.getByTestId('ws-arrange-cell-risk').getByTestId('ws-panel-risk')).toBeVisible();

    const screenshotPath = testInfo.outputPath('arrange-mode-handles.png');
    await page.screenshot({ path: screenshotPath });
    await testInfo.attach('arrange-mode-handles.png', {
      path: screenshotPath,
      contentType: 'image/png',
    });

    // ── Exit via the toggle: back to the hide/show CSS grid, draft intact ──
    await page.getByTestId('ws-customize-arrange-toggle').click();
    await expect(page.getByTestId('ws-arrange-mode')).toHaveCount(0);
    await expect(page.getByTestId('ws-grid')).toBeVisible();
    await expect(page.getByTestId('ws-arrange-hint')).toHaveCount(0);
    await expect(page.getByTestId('ws-customize-bar')).toBeVisible();

    // ── Re-enter and exit via Escape ──
    await enterArrangeMode(page);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('ws-arrange-mode')).toHaveCount(0);
    await expect(page.getByTestId('ws-grid')).toBeVisible();

    expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });

  test('keyboard move swaps panels in the draft; Escape preserves it; Undo reverts step by step', async ({
    page,
    request,
  }) => {
    const { consoleErrors, pageErrors } = watchForErrors(page);
    await resetViewStore(page, request);
    await page.goto('/dev/workstation');
    await createUserView(page, 'Keyboard Move');
    await enterCustomize(page);
    await enterArrangeMode(page);

    // Move the focused account handle one cell right → swaps with perf
    // (window-manager semantics: the summary row is fully packed).
    await focusArrangeHandle(page, 'account');
    await page.keyboard.press('ArrowRight');

    // The commit landed: the draft is dirty and Undo is armed.
    await expect(page.getByTestId('ws-customize-dirty')).toBeVisible();
    await expect(page.getByTestId('ws-customize-undo')).toBeEnabled();

    // Escape exits arrangement mode but keeps the dirty draft: the hide/show
    // CSS grid now renders the re-projected areas (account ↔ perf swapped).
    await exitArrangeWithEscape(page);
    expect(await readGridTemplate(page)).toContain('"perf account review"');

    // ── Re-enter: the draft is still the swapped arrangement ──
    await enterArrangeMode(page);
    await focusArrangeHandle(page, 'account');
    // ArrowLeft swaps back (perf ↔ account) → the template arrangement. The
    // draft now equals the session-start snapshot, so the dirty indicator
    // clears even though a commit happened — dirty tracks "differs from the
    // session base", not "any change".
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('ws-customize-dirty')).toHaveCount(0);
    await expect(page.getByTestId('ws-customize-undo')).toBeEnabled();
    await exitArrangeWithEscape(page);
    expect(await readGridTemplate(page)).toContain('"account perf review"');

    // ── Undo #1: reverts the ArrowLeft → back to the swapped arrangement ──
    await enterArrangeMode(page);
    await page.getByTestId('ws-customize-undo').click();
    await expect(page.getByTestId('ws-customize-dirty')).toBeVisible();
    await exitArrangeWithEscape(page);
    expect(await readGridTemplate(page)).toContain('"perf account review"');

    // ── Undo #2: reverts the ArrowRight → back to the session base ──
    await enterArrangeMode(page);
    await page.getByTestId('ws-customize-undo').click();
    await expect(page.getByTestId('ws-customize-dirty')).toHaveCount(0);
    await expect(page.getByTestId('ws-customize-save')).toBeDisabled();
    await exitArrangeWithEscape(page);
    expect(await readGridTemplate(page)).toContain('"account perf review"');

    expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });

  test('keyboard grow/shrink resizes panels within catalogue bounds; boundary moves are silent', async ({
    page,
    request,
  }) => {
    const { consoleErrors, pageErrors } = watchForErrors(page);
    await resetViewStore(page, request);
    await page.goto('/dev/workstation');

    // A user view from the Performance template: account spans 2 columns
    // with a free third cell, and perf is a 2-row full-width band below the
    // trades workspace — both have room to grow/shrink.
    await selectView(page, SYSTEM_VIEW_IDS.PERFORMANCE);
    await createUserView(page, 'Perf Arrange');
    await enterCustomize(page);
    await enterArrangeMode(page);

    // Grow account right: Shift+ArrowRight widens 2→3 (the '.' cell frees it).
    await focusArrangeHandle(page, 'account');
    await page.keyboard.press('Shift+ArrowRight');
    await expect(page.getByTestId('ws-customize-dirty')).toBeVisible();
    await exitArrangeWithEscape(page);
    expect(await readGridTemplate(page)).toContain('"account account account"');

    // Shrink account left: Shift+ArrowLeft narrows 3→2, restoring the '.'.
    await enterArrangeMode(page);
    await focusArrangeHandle(page, 'account');
    await page.keyboard.press('Shift+ArrowLeft');
    await exitArrangeWithEscape(page);
    expect(await readGridTemplate(page)).toContain('"account account ."');

    // Grow perf down: Shift+ArrowDown grows the 2-row band to 3 rows.
    await enterArrangeMode(page);
    await focusArrangeHandle(page, 'perf');
    await page.keyboard.press('Shift+ArrowDown');
    await exitArrangeWithEscape(page);
    const grownStyle = await readGridTemplate(page);
    expect(grownStyle.match(/"perf perf perf"/g)?.length).toBe(3);

    // ── Fresh session: boundary moves are silent no-ops (no dirty) ──
    await page.getByTestId('ws-customize-cancel').click();
    await expect(page.getByTestId('ws-customize-bar')).toHaveCount(0);
    await enterCustomize(page);
    await enterArrangeMode(page);

    // account at x=0: ArrowLeft is clamped at the grid edge, ArrowUp
    // targets the fixed risk row → both blocked.
    await focusArrangeHandle(page, 'account');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowUp');
    // perf above the bottom edge: ArrowUp targets the fixed trades row → blocked.
    await focusArrangeHandle(page, 'perf');
    await page.keyboard.press('ArrowUp');
    await expect(page.getByTestId('ws-customize-dirty')).toHaveCount(0);
    await expect(page.getByTestId('ws-customize-save')).toBeDisabled();

    expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });

  test('pointer drag commits a constrained move to a free cell; fixed anchors cannot be dragged', async ({
    page,
    request,
  }) => {
    const { consoleErrors, pageErrors } = watchForErrors(page);
    await resetViewStore(page, request);
    await page.goto('/dev/workstation');
    await selectView(page, SYSTEM_VIEW_IDS.PERFORMANCE);
    await createUserView(page, 'Drag Arrange');
    await enterCustomize(page);
    await enterArrangeMode(page);

    // ── Fixed anchors render no drag surface: pointer input on the risk
    //    panel body must not start a drag or dirty the draft ──
    const riskCell = page.getByTestId('ws-arrange-cell-risk');
    const riskBox = await riskCell.boundingBox();
    expect(riskBox).not.toBeNull();
    await page.mouse.move(riskBox!.x + riskBox!.width / 2, riskBox!.y + riskBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(riskBox!.x + riskBox!.width / 2 + 200, riskBox!.y + riskBox!.height / 2 + 60, {
      steps: 8,
    });
    await page.mouse.up();
    await expect(page.getByTestId('ws-customize-dirty')).toHaveCount(0);

    // ── Drag the account handle right by ~one column. The performance
    //    template's summary row has a free third cell, so the placement is
    //    representable and applyLayout commits it (constrained drag) ──
    const grid = page.getByTestId('ws-arrange-grid');
    const gridBox = await grid.boundingBox();
    expect(gridBox).not.toBeNull();
    const colWidth = (gridBox!.width - 2 * ARRANGE_GRID_MARGIN) / 3;
    const handle = page.getByTestId('ws-arrange-handle-account');
    const handleBox = await handle.boundingBox();
    expect(handleBox).not.toBeNull();
    const startX = handleBox!.x + handleBox!.width / 2;
    const startY = handleBox!.y + handleBox!.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + colWidth + ARRANGE_GRID_MARGIN, startY, { steps: 12 });
    await page.mouse.up();

    // The drag committed: dirty + undo armed, and the account now occupies
    // the free right-hand cells (x=1, w=2 → row 1 = ". account account").
    await expect(page.getByTestId('ws-customize-dirty')).toBeVisible();
    await expect(page.getByTestId('ws-customize-undo')).toBeEnabled();
    await exitArrangeWithEscape(page);
    expect(await readGridTemplate(page)).toContain('". account account"');

    expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });

  test('Save persists the arrangement (API + localStorage); page refresh restores it', async ({
    page,
    request,
  }) => {
    const { consoleErrors, pageErrors } = watchForErrors(page);
    await resetViewStore(page, request);
    await page.goto('/dev/workstation');
    await createUserView(page, 'Saved Arrange');
    await enterCustomize(page);
    await enterArrangeMode(page);

    // Keyboard swap account ↔ perf, then exit arrange and Save.
    await focusArrangeHandle(page, 'account');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('ws-customize-dirty')).toBeVisible();
    await exitArrangeWithEscape(page);
    expect(await readGridTemplate(page)).toContain('"perf account review"');
    await page.getByTestId('ws-customize-save').click();
    await expect(page.getByTestId('ws-customize-bar')).toHaveCount(0);

    // Normal mode renders the saved arrangement with no editing chrome.
    await expect(page.locator('[data-testid^="ws-arrange-handle-"]')).toHaveCount(0);
    await expect(page.locator('.react-resizable-handle')).toHaveCount(0);

    // ── Mark the view as startup so a reload restores it ──
    await openViewSwitcher(page);
    await page.getByTestId('ws-view-set-startup').click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('ws-view-switcher-content')).toHaveCount(0);

    // The shared API row now carries the arranged config with the startup
    // flag (R035 validated on write; the view store overrides localStorage
    // from the API on load, so both must settle before reload).
    await expect
      .poll(
        async () => {
          const res = await request.get('/api/dashboard/views');
          const rows = (await res.json()) as Array<{
            name: string;
            isDefault?: boolean;
            layout: unknown;
          }>;
          const row = rows.find((r) => r.name === 'Saved Arrange');
          if (!row || row.isDefault !== true) return null;
          const config = row.layout as { areas: string[][] };
          return JSON.stringify(config.areas);
        },
        { timeout: 10_000 },
      )
      .toContain('"perf","account","review"');

    // ── Reload: the saved arrangement is restored as the startup view ──
    await page.reload();
    await expect(page.getByTestId('ws-view-switcher-current-name')).toHaveText(
      'Saved Arrange',
    );
    await expect(page.getByTestId('ws-grid')).toBeVisible();
    expect(await readGridTemplate(page)).toContain('"perf account review"');
    await expect(page.locator('[data-testid^="ws-arrange-handle-"]')).toHaveCount(0);
    await expect(page.locator('.react-resizable-handle')).toHaveCount(0);

    // Re-entering customize starts from the saved arrangement as a clean base.
    await enterCustomize(page);
    await expect(page.getByTestId('ws-customize-dirty')).toHaveCount(0);
    await enterArrangeMode(page);
    await exitArrangeWithEscape(page);
    expect(await readGridTemplate(page)).toContain('"perf account review"');

    expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });

  test('Cancel discards the arrangement; the persisted view stays untouched', async ({
    page,
    request,
  }) => {
    const { consoleErrors, pageErrors } = watchForErrors(page);
    await resetViewStore(page, request);
    await page.goto('/dev/workstation');
    await createUserView(page, 'Cancel View');
    await enterCustomize(page);
    await enterArrangeMode(page);

    // Commit a swap, then Cancel while still in arrangement mode.
    await focusArrangeHandle(page, 'account');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('ws-customize-dirty')).toBeVisible();
    await page.getByTestId('ws-customize-cancel').click();
    await expect(page.getByTestId('ws-customize-bar')).toHaveCount(0);

    // Normal mode renders the persisted (template) arrangement.
    expect(await readGridTemplate(page)).toContain('"account perf review"');

    // Re-entering customize starts clean from the persisted template layout.
    await enterCustomize(page);
    await expect(page.getByTestId('ws-customize-dirty')).toHaveCount(0);
    await enterArrangeMode(page);
    await exitArrangeWithEscape(page);
    expect(await readGridTemplate(page)).toContain('"account perf review"');

    // The API row never received the swap.
    let row: { name: string; layout: unknown } | null = null;
    await expect
      .poll(
        async () => {
          const res = await request.get('/api/dashboard/views');
          const rows = (await res.json()) as Array<{ name: string; layout: unknown }>;
          row = rows.find((r) => r.name === 'Cancel View') ?? null;
          return row;
        },
        { timeout: 10_000 },
      )
      .not.toBeNull();
    expect(
      JSON.stringify((row!.layout as { areas: string[][] }).areas),
    ).toContain('"account","perf","review"');

    expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });

  test('Reset returns the draft to the template base grid without persisting', async ({
    page,
    request,
  }) => {
    const { consoleErrors, pageErrors } = watchForErrors(page);
    await resetViewStore(page, request);
    await page.goto('/dev/workstation');
    await createUserView(page, 'Reset View');
    await enterCustomize(page);
    await enterArrangeMode(page);

    // Commit a swap, then Reset while still in arrangement mode.
    await focusArrangeHandle(page, 'account');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('ws-customize-dirty')).toBeVisible();
    await page.getByTestId('ws-customize-reset').click();

    // The draft is back to the template base: clean session, template grid.
    await expect(page.getByTestId('ws-customize-dirty')).toHaveCount(0);
    await expect(page.getByTestId('ws-customize-save')).toBeDisabled();
    await exitArrangeWithEscape(page);
    expect(await readGridTemplate(page)).toContain('"account perf review"');

    // Reset touched only the draft: Cancel leaves the persisted view intact.
    await page.getByTestId('ws-customize-cancel').click();
    let row: { name: string; layout: unknown } | null = null;
    await expect
      .poll(
        async () => {
          const res = await request.get('/api/dashboard/views');
          const rows = (await res.json()) as Array<{ name: string; layout: unknown }>;
          row = rows.find((r) => r.name === 'Reset View') ?? null;
          return row;
        },
        { timeout: 10_000 },
      )
      .not.toBeNull();
    expect(
      JSON.stringify((row!.layout as { areas: string[][] }).areas),
    ).toContain('"account","perf","review"');

    expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });
});
