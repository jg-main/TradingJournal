/**
 * M005-22kf6a S01 T04 — Workstation Shell browser evidence at 1440x900.
 *
 * Proves the terminal-dense layout concept for the greenfield /workspace
 * workstation: the full shell (toolbar + CSS Grid panels) fits a 1440x900
 * viewport without page scrolling, panels populate with realistic fixture
 * data, the FIXTURE badge and console.warn signal fixture mode, scenario
 * switching works, malformed scenario params degrade safely, and the legacy
 * dashboard at / is unaffected.
 *
 * The fixture scenario never touches the database, so this spec needs no
 * API stubbing — /workspace renders entirely from src/lib/workstation-fixtures.
 *
 * Coverage:
 * 1. Toolbar renders: brand, account selector, scenario selector, FIXTURE badge
 * 2. All named grid panels render (kpis, equity, positions, watchlist, risk, insights)
 * 3. No page scroll at 1440x900; every panel fits inside the viewport
 * 4. Fixture data populates panels (KPIs, position rows, watchlist rows)
 * 5. console.warn fixture-mode signal fires on load
 * 6. Scenario switch: zero-positions shows empty state; large-drawdown renders
 * 7. Malformed ?scenario= param falls back to default without crashing
 * 8. No unexpected console errors or page errors during the flow
 * 9. Legacy dashboard at / still renders with its sidebar (zero regression)
 * 10. Screenshot evidence captured at 1440x900
 */

import { test, expect, type Page } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 } });

const GRID_AREAS = ['kpis', 'equity', 'positions', 'watchlist', 'risk', 'insights'] as const;

/** Collect console errors + page errors for the audit test. */
function watchForErrors(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  return { consoleErrors, pageErrors };
}

test.describe('workstation shell at 1440x900', () => {
  test('toolbar renders with account selector, scenario selector, and FIXTURE badge', async ({
    page,
  }) => {
    await page.goto('/workspace');

    const toolbar = page.getByTestId('ws-toolbar');
    await expect(toolbar).toBeVisible();
    await expect(toolbar.getByText('Workstation')).toBeVisible();

    // Account selector is populated with the fixture account.
    const accountSelect = toolbar.getByLabel('Active account');
    await expect(accountSelect).toBeVisible();
    await expect(accountSelect.locator('option')).toHaveCount(1);
    await expect(accountSelect.locator('option').first()).toHaveText('Primary Margin');

    // Scenario selector exposes all four fixture scenarios.
    const scenarioSelect = page.getByTestId('ws-scenario-select');
    await expect(scenarioSelect.locator('option')).toHaveText([
      'default',
      'zero-positions',
      'large-drawdown',
      'many-watchlist',
    ]);

    // Slice verification contract: FIXTURE badge visible in fixture mode.
    await expect(page.getByTestId('ws-fixture-badge')).toBeVisible();
    await expect(page.getByTestId('ws-fixture-badge')).toHaveText(/fixture/i);

    // Toolbar is compact (40px per the density tokens; allow small slack).
    const box = await toolbar.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeLessThanOrEqual(48);
  });

  test('all named grid panels render and fit inside the viewport without page scroll', async ({
    page,
  }) => {
    await page.goto('/workspace');

    const grid = page.getByTestId('ws-grid');
    await expect(grid).toBeVisible();

    for (const area of GRID_AREAS) {
      const panel = page.getByTestId(`ws-panel-${area}`);
      await expect(panel).toBeVisible();
      const box = await panel.boundingBox();
      expect(box, `panel ${area} has layout box`).not.toBeNull();
      expect(box!.x, `panel ${area} inside left edge`).toBeGreaterThanOrEqual(0);
      expect(box!.y, `panel ${area} inside top edge`).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, `panel ${area} inside right edge`).toBeLessThanOrEqual(1440);
      expect(box!.y + box!.height, `panel ${area} inside bottom edge`).toBeLessThanOrEqual(900);
    }

    // The surface itself never scrolls (panels scroll internally).
    const scroll = await page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
    }));
    expect(scroll.scrollHeight).toBeLessThanOrEqual(scroll.clientHeight);
  });

  test('fixture data populates KPI strip and data panels', async ({ page }) => {
    await page.goto('/workspace');

    const kpis = page.getByTestId('ws-panel-kpis');
    await expect(kpis.getByText('Net P&L')).toBeVisible();
    await expect(kpis.getByText('Win Rate')).toBeVisible();
    await expect(kpis.getByText('Profit Factor')).toBeVisible();
    // KPI values are rendered (not all placeholder dashes).
    await expect(kpis.locator('.ws-kpi-value').first()).not.toHaveText('—');

    // Default scenario: positions and watchlist tables have real rows.
    const positions = page.getByTestId('ws-panel-positions');
    await expect(positions.locator('tbody tr').first()).toBeVisible();
    expect(await positions.locator('tbody tr').count()).toBeGreaterThan(0);

    const watchlist = page.getByTestId('ws-panel-watchlist');
    await expect(watchlist.locator('tbody tr').first()).toBeVisible();
    await expect(watchlist.getByText('AAPL')).toBeVisible();

    // Equity panel shows the sparkline and stat rows.
    const equity = page.getByTestId('ws-panel-equity');
    await expect(equity.getByRole('img', { name: 'Equity curve sparkline' })).toBeVisible();
    await expect(equity.getByText('Cum P&L')).toBeVisible();

    // Risk + insights panels render stat rows.
    await expect(page.getByTestId('ws-panel-risk').getByText('Portfolio Heat')).toBeVisible();
    await expect(page.getByTestId('ws-panel-insights').getByText('Avg Win')).toBeVisible();
  });

  test('fixture mode emits console.warn runtime signal', async ({ page }) => {
    const warnings: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'warning') warnings.push(msg.text());
    });
    await page.goto('/workspace');
    await expect(page.getByTestId('ws-grid')).toBeVisible();

    // The grid is SSR-visible before hydration; warnFixtureMode fires in a
    // client effect during hydration, so poll instead of racing it.
    await expect
      .poll(
        () => warnings.some((w) => w.includes('[workstation] FIXTURE MODE')),
        { timeout: 10_000 },
      )
      .toBe(true);
  });

  test('scenario switching swaps fixture data; edge scenarios render correctly', async ({
    page,
  }) => {
    await page.goto('/workspace');
    await expect(page.getByTestId('ws-grid')).toBeVisible();

    // zero-positions: positions panel shows its empty state.
    await page.getByTestId('ws-scenario-select').selectOption('zero-positions');
    await expect(page.getByTestId('ws-panel-positions').getByText('No open positions')).toBeVisible();
    await expect(page.getByTestId('ws-fixture-badge')).toBeVisible();

    // large-drawdown: negative drawdown KPI renders with the negative class.
    await page.getByTestId('ws-scenario-select').selectOption('large-drawdown');
    const drawdownKpi = page
      .getByTestId('ws-panel-kpis')
      .locator('.ws-kpi', { hasText: 'Drawdown' })
      .locator('.ws-kpi-value');
    await expect(drawdownKpi).toHaveClass(/ws-neg/);

    // many-watchlist: more rows than the default scenario.
    await page.getByTestId('ws-scenario-select').selectOption('many-watchlist');
    const manyCount = await page.getByTestId('ws-panel-watchlist').locator('tbody tr').count();
    await page.getByTestId('ws-scenario-select').selectOption('default');
    const defaultCount = await page.getByTestId('ws-panel-watchlist').locator('tbody tr').count();
    expect(manyCount).toBeGreaterThan(defaultCount);
  });

  test('malformed ?scenario= param degrades to default without crashing', async ({ page }) => {
    const { pageErrors } = watchForErrors(page);
    await page.goto('/workspace?scenario=bogus-scenario');

    await expect(page.getByTestId('ws-grid')).toBeVisible();
    await expect(page.getByTestId('ws-scenario-select')).toHaveValue('default');
    await expect(page.getByTestId('ws-fixture-badge')).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test('no unexpected console errors or page errors during the full flow', async ({ page }) => {
    const { consoleErrors, pageErrors } = watchForErrors(page);

    await page.goto('/workspace');
    await expect(page.getByTestId('ws-grid')).toBeVisible();
    await page.getByTestId('ws-scenario-select').selectOption('zero-positions');
    await page.getByTestId('ws-scenario-select').selectOption('many-watchlist');
    await page.getByTestId('ws-scenario-select').selectOption('default');

    expect(pageErrors, 'uncaught page errors').toEqual([]);
    expect(consoleErrors, 'console.error output').toEqual([]);
  });

  test('legacy dashboard at / still renders with its sidebar (zero regression)', async ({
    page,
  }) => {
    await page.goto('/');
    // Legacy chrome: the sidebar nav renders (the open/close toggle button is
    // md:hidden and only exists below the 768px breakpoint).
    await expect(
      page.getByRole('complementary').getByRole('link', { name: 'Dashboard' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    // The workstation shell must not leak into the legacy route.
    await expect(page.getByTestId('ws-toolbar')).toHaveCount(0);
    await expect(page.getByTestId('ws-grid')).toHaveCount(0);
  });

  test('/workspace has no legacy sidebar (isolation proof)', async ({ page }) => {
    await page.goto('/workspace');
    await expect(page.getByTestId('ws-grid')).toBeVisible();
    await expect(
      page.getByRole('button', { name: /open sidebar|close sidebar/i }),
    ).toHaveCount(0);
  });

  test('screenshot evidence at 1440x900', async ({ page }, testInfo) => {
    await page.goto('/workspace');
    await expect(page.getByTestId('ws-grid')).toBeVisible();
    await expect(page.getByTestId('ws-fixture-badge')).toBeVisible();

    const shot = await page.screenshot({ fullPage: false });
    await testInfo.attach('workstation-shell-1440x900.png', {
      body: shot,
      contentType: 'image/png',
    });
  });
});
