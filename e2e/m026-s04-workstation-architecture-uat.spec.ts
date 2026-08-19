/**
 * M026-1bw68n S04 T01 — Workstation theme × viewport UAT
 *
 * Milestone-level UAT browser evidence for the workstation across the full
 * theme × viewport matrix mandated by S04 (Must-Have: "Playwright spec
 * produces browser evidence at 6 theme×viewport combinations (light+dark ×
 * 1440/1280/1024) showing risk prominent, trades usable, no console errors,
 * theme tokens applied"). The S01 audit confirmed the workstation themes via
 * the product-wide contract — localStorage 'theme' key + `.dark` class on
 * documentElement — and the S03 responsive spec covers viewports but not
 * theme variation; this spec closes that gap.
 *
 * Theme contract under test (identical on every root layout, verified here
 * on the /dev/workstation fixture harness):
 *   - A pre-paint inline script reads localStorage['theme'] (falling back to
 *     prefers-color-scheme) and applies/omits the `.dark` class on
 *     <html>. Setting the storage key before navigation therefore drives the
 *     real class application path.
 *   - The ThemeToggle on product surfaces toggles exactly two statements:
 *     `documentElement.classList.add/remove('dark')` +
 *     `localStorage.setItem('theme', 'dark'|'light')`. The theme-contract
 *     test below drives those same two statements to prove switching and
 *     persistence round-trip without a reload.
 *   - Tokens are sampled through a 1×1 canvas (Chrome preserves the oklch
 *     color space through fillStyle, readback is sRGB) so assertions are
 *     color-space agnostic: light surfaces are near-white (channel sum
 *     > 600), dark surfaces are graphite (channel sum < 300).
 *
 * Every matrix cell runs on the deterministic fixture harness
 * (/dev/workstation, default scenario: 3 open positions) and asserts the
 * S03 responsive contract at that width — risk band prominent with all
 * eight current-state cells, 9-column trades table populated with the last
 * (Exposure) column reachable, no document-level horizontal overflow, no
 * editing chrome, no console/page errors — plus the theme-token contract,
 * attaching screenshot evidence per combination.
 *
 * Isolation: each test starts from a pristine store — the shared disposable
 * per-run database is cleaned of user workstation rows (ws-*) and the test
 * context starts with empty workstation views localStorage — so API
 * hydration always lands on the three default system templates regardless
 * of earlier tests (same pattern as workstation-responsive.spec.ts /
 * workstation-views.spec.ts).
 *
 * Run: npx playwright test e2e/m026-s04-workstation-architecture-uat.spec.ts --project=chromium
 */

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

/** localStorage key owned by useWorkstationViews. */
const VIEWS_STORAGE_KEY = 'workstation:views:v1';

/** localStorage key owned by the theme system (ThemeToggle + layout script). */
const THEME_STORAGE_KEY = 'theme';

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

/** The two themes of the product theme contract. */
const THEMES = ['light', 'dark'] as const;

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
  }, VIEWS_STORAGE_KEY);
}

/**
 * Wait for the client-side workstation view store to settle. The grid is
 * SSR-visible before hydration; the view-switcher current-name only reflects
 * the active view once useWorkstationViews has hydrated, so waiting on it
 * before driving the workstation avoids racing the React handlers.
 */
async function waitForWorkstationHydration(page: Page) {
  await expect(page.getByTestId('ws-fixture-badge')).toBeVisible();
  await expect(page.getByTestId('ws-grid')).toBeVisible();
  await expect(page.getByTestId('ws-view-switcher-current-name')).toHaveText(
    'Risk & Positions',
    { timeout: 10_000 },
  );
}

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
  // full-width contract is measured against the grid's content box.
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
 * Summary row panels (Account State | Performance) are readable: values
 * render and stat rows stay inside each panel's horizontal bounds.
 */
async function assertSummaryReadable(page: Page) {
  for (const testId of ['ws-panel-account-state', 'ws-panel-performance']) {
    const panel = page.getByTestId(testId);
    await expect(panel, `${testId} visible`).toBeVisible();
    const panelBox = await panel.boundingBox();
    expect(panelBox, `${testId} has layout box`).not.toBeNull();

    // At least one non-empty value renders (no placeholder dashes only).
    const values = panel.locator('.ws-num');
    expect(await values.count(), `${testId} renders values`).toBeGreaterThan(0);

    // Content is not clipped horizontally: stat rows stay inside the panel.
    const rows = panel.locator('.ws-stat-row, .ws-account-stat-row');
    expect(await rows.count(), `${testId} renders stat rows`).toBeGreaterThan(0);
    const overflowing = await rows.evaluateAll(
      (els, panelRight) =>
        els.filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.right > panelRight + 1;
        }).length,
      panelBox!.x + panelBox!.width,
    );
    expect(overflowing, `${testId} stat rows inside panel right edge`).toBe(0);
  }
}

// ── Theme token sampling (color-space agnostic, per trades-identity-uat) ──

/**
 * Sample the computed background of the first element matching `selector`
 * through a 1×1 canvas. M014 identity tokens are declared in oklch (Tailwind
 * v4), so getComputedStyle serializes them as lab(...)/oklch(...); Chrome's
 * canvas fillStyle getter preserves that color space and the pixel readback
 * is always true sRGB rgb(r, g, b).
 */
async function sampleBackground(page: Page, selector: string): Promise<string> {
  return page.locator(selector).first().evaluate((el) => {
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.fillStyle = getComputedStyle(el as HTMLElement).backgroundColor;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `rgb(${r}, ${g}, ${b})`;
  });
}

/** Sum of the RGB channels of an `rgb(r, g, b)` string (0–765). */
function channelSum(rgb: string): number {
  const m = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(rgb);
  expect(m, `color sample should be rgb (got ${rgb})`).not.toBeNull();
  return Number(m![1]) + Number(m![2]) + Number(m![3]);
}

/**
 * Assert the theme-token contract on the workstation surface: the `.dark`
 * class matches the requested theme, the body (--background) and the risk
 * panel (--card) resolve to the correct surface family (near-white in light,
 * graphite in dark). Returns the sampled colors for delta assertions.
 */
async function assertThemeTokens(
  page: Page,
  theme: (typeof THEMES)[number],
): Promise<{ body: string; panel: string }> {
  const hasDark = await page.evaluate(() =>
    document.documentElement.classList.contains('dark'),
  );
  expect(hasDark, `documentElement .dark class should match ${theme} theme`).toBe(
    theme === 'dark',
  );

  const body = await sampleBackground(page, 'body');
  const panel = await sampleBackground(page, '[data-testid="ws-panel-risk"]');
  if (theme === 'dark') {
    expect(channelSum(body), `dark body should be graphite (got ${body})`).toBeLessThan(300);
    expect(channelSum(panel), `dark risk panel should be graphite (got ${panel})`).toBeLessThan(300);
  } else {
    expect(channelSum(body), `light body should be near-white (got ${body})`).toBeGreaterThan(600);
    expect(channelSum(panel), `light risk panel should be near-white (got ${panel})`).toBeGreaterThan(600);
  }
  return { body, panel };
}

/** Run the full per-combination contract against the default view. */
async function assertWorkstationContract(
  page: Page,
  options: { theme: (typeof THEMES)[number]; viewportWidth: number },
) {
  await assertNoHorizontalOverflow(page, options.viewportWidth);
  await assertNoEditingChrome(page);
  await assertRiskProminent(page, options.viewportWidth);
  await assertTradesUsable(page, options.viewportWidth);
  await assertSummaryReadable(page);
  await assertThemeTokens(page, options.theme);
}

// ── Theme × viewport matrix (light+dark × 1440/1280/1024) ────────────────

for (const theme of THEMES) {
  for (const vp of VIEWPORTS) {
    test(`[${theme}] workstation UAT at ${vp.width}x${vp.height}: risk prominent, trades usable, summary readable, theme tokens, no console errors`, async ({
      page,
      request,
    }, testInfo) => {
      const { consoleErrors, pageErrors } = watchForErrors(page);
      // Drive the real theme contract: the layout's pre-paint inline script
      // reads localStorage['theme'] and applies/omits the `.dark` class.
      await page.addInitScript(
        ({ key, theme: t }) => {
          try {
            localStorage.setItem(key, t);
          } catch {
            /* storage unavailable — defaults to light */
          }
        },
        { key: THEME_STORAGE_KEY, theme },
      );
      await resetViewStore(page, request);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/dev/workstation');
      await waitForWorkstationHydration(page);

      await assertWorkstationContract(page, {
        theme,
        viewportWidth: vp.width,
      });

      const shot = await page.screenshot({ fullPage: false });
      await testInfo.attach(`uat-${theme}-${vp.name}.png`, {
        body: shot,
        contentType: 'image/png',
      });

      expect(pageErrors, 'uncaught page errors').toEqual([]);
      expect(consoleErrors, 'console.error output').toEqual([]);
    });
  }
}

// ── Theme switching + persistence round-trip at 1440 px ───────────────────

test('theme switching: localStorage `theme` drives the .dark class and workstation tokens round-trip without reload', async ({
  page,
  request,
}, testInfo) => {
  const { consoleErrors, pageErrors } = watchForErrors(page);
  await resetViewStore(page, request);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/dev/workstation');
  await waitForWorkstationHydration(page);

  // Start light (default: no stored theme, prefers-color-scheme light).
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
    .toBe(false);
  const lightTokens = await assertThemeTokens(page, 'light');

  // Switch to dark with exactly the two statements ThemeToggle.toggle()
  // executes on product surfaces (class + localStorage).
  await page.evaluate((key) => {
    document.documentElement.classList.add('dark');
    localStorage.setItem(key, 'dark');
  }, THEME_STORAGE_KEY);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
    .toBe(true);
  // The panel background carries transition-colors — poll until it settles.
  await expect
    .poll(() => sampleBackground(page, '[data-testid="ws-panel-risk"]'))
    .not.toBe(lightTokens.panel);
  const darkTokens = await assertThemeTokens(page, 'dark');
  expect(darkTokens.panel, 'dark card token differs from light').not.toBe(lightTokens.panel);
  expect(darkTokens.body, 'dark background token differs from light').not.toBe(lightTokens.body);

  // Data still renders after the switch.
  await expect(page.getByTestId('ws-positions-table').locator('tbody tr').first()).toBeVisible();

  // Persistence round-trip: reload re-applies dark from localStorage via the
  // layout inline script (no FOUC path), tokens remain graphite.
  await page.reload();
  await waitForWorkstationHydration(page);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
    .toBe(true);
  await assertThemeTokens(page, 'dark');

  const darkShot = await page.screenshot({ fullPage: false });
  await testInfo.attach('uat-switching-dark-after-reload.png', {
    body: darkShot,
    contentType: 'image/png',
  });

  // Toggle back to light restores the light surface (token delta round-trip).
  await page.evaluate((key) => {
    document.documentElement.classList.remove('dark');
    localStorage.setItem(key, 'light');
  }, THEME_STORAGE_KEY);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
    .toBe(false);
  await expect
    .poll(() => sampleBackground(page, '[data-testid="ws-panel-risk"]'))
    .toBe(lightTokens.panel);
  await assertThemeTokens(page, 'light');

  expect(pageErrors, 'uncaught page errors').toEqual([]);
  expect(consoleErrors, 'console.error output').toEqual([]);
});
