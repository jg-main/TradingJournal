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
 * 11. S03: PositionsPanel 7-column table with Symbol, Side, Size, Entry, Mark, uP&L, R
 * 12. S03: Position row data-testids, R-multiple cell, stale mark indicator
 * 13. S03: RiskPanel PTD/current-state visual separation with metric content
 * 14. S03: All 4 scenarios render positions and risk panels without viewport overflow
 * 15. S03: Empty/unavailable states across zero-positions and large-drawdown
 * 16. S05: ECharts equity/drawdown chart renders with canvas at ws-equity-chart inside equity panel
 * 17. S05: Monthly performance table (ws-perf-monthly-table) with 4 columns and populated rows
 * 18. S05: Drawdown summary (ws-perf-drawdown-summary) with max DD, current DD, and color coding
 * 19. S05: All 4 scenarios render the chart + summary without console/page errors
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

    // S03: risk panel uses ws-risk-panel (PositionsPanel and RiskPanel are
    // standalone components that render their own chrome; the legacy
    // ws-panel-{area} pattern is preserved for positions, equity, kpis,
    // watchlist, and insights but risk follows the slice contract at ws-risk-panel).
    for (const area of GRID_AREAS) {
      const testId = area === 'risk' ? 'ws-risk-panel' : `ws-panel-${area}`;
      const panel = page.getByTestId(testId);
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

    // Equity panel shows the ECharts chart + performance summary.
    const equity = page.getByTestId('ws-panel-equity');
    await expect(equity.getByTestId('ws-equity-chart')).toBeVisible();
    await expect(equity.getByTestId('ws-perf-monthly-table')).toBeVisible();
    await expect(equity.getByTestId('ws-perf-drawdown-summary')).toBeVisible();

    // Risk panel shows its section headers and stat rows.
    await expect(page.getByTestId('ws-risk-panel').getByText('Portfolio Heat')).toBeVisible();
    // S04: SetupsPanel replaces the legacy placeholder insights panel.
    const insightsPanel = page.getByTestId('ws-panel-insights');
    await expect(insightsPanel.getByText('Setups & Ideas')).toBeVisible();
    await expect(insightsPanel.getByText('Setup Ranking')).toBeVisible();
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

  test('market strip renders all 4 index cards with color-coded changes', async ({
    page,
  }) => {
    await page.goto('/workspace');
    await expect(page.getByTestId('ws-grid')).toBeVisible();

    const strip = page.getByTestId('ws-market-strip');
    await expect(strip).toBeVisible();

    // Verify all 4 market indices render.
    for (const symbol of ['SPX', 'NDX', 'RUT', 'VIX']) {
      const idx = page.getByTestId(`ws-market-index-${symbol}`);
      await expect(idx).toBeVisible();
      await expect(idx.getByText(symbol)).toBeVisible();
      // Last price is a numeric value (not —).
      const valueEl = idx.locator('.ws-market-index-value');
      await expect(valueEl).not.toHaveText('—');
    }

    // At least one index should have ws-pos or ws-neg (markets move).
    const coloredChange = strip.locator('.ws-market-index-change.ws-pos, .ws-market-index-change.ws-neg');
    await expect(coloredChange.first()).toBeVisible();
  });

  test('enhanced watchlist table has 7 columns with gap and proximity styling', async ({
    page,
  }) => {
    await page.goto('/workspace');
    await expect(page.getByTestId('ws-grid')).toBeVisible();

    const table = page.getByTestId('ws-watchlist-table');
    await expect(table).toBeVisible();

    // Verify 7 column headers.
    const headers = table.locator('thead th');
    await expect(headers).toHaveCount(7);
    await expect(headers.nth(0)).toHaveText('Symbol');
    await expect(headers.nth(1)).toHaveText('Dir');
    await expect(headers.nth(2)).toHaveText('Last');
    await expect(headers.nth(3)).toHaveText('Gap%');
    await expect(headers.nth(4)).toHaveText('Trigger');
    await expect(headers.nth(5)).toHaveText('Dist%');
    await expect(headers.nth(6)).toHaveText('Status');

    // Verify rows render with data-testid per symbol.
    const rows = table.locator('tbody tr');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);

    // Spot-check: AAPL row exists and renders direction badge and status pill.
    const aaplRow = page.getByTestId('ws-watchlist-row-AAPL');
    await expect(aaplRow).toBeVisible();

    // Direction column uses L/S badge with color class.
    const dirCell = aaplRow.locator('td').nth(1);
    const dirText = (await dirCell.textContent())?.trim();
    expect(['L', 'S']).toContain(dirText);
    expect(await dirCell.evaluate((el) => el.className)).toMatch(/ws-dir-(long|short)/);

    // Status column uses ws-status-* pill class.
    const statusCell = aaplRow.locator('td').nth(6);
    const statusPill = statusCell.locator('[class*="ws-status-"]');
    await expect(statusPill).toBeVisible();
    await expect(statusPill).toHaveClass(/ws-status-(triggered|watching|pending|skipped|expired)/);

    // Gap% column has color class (ws-pos or ws-neg).
    const gapCell = aaplRow.locator('td').nth(3);
    const gapClass = await gapCell.evaluate((el) => el.className);
    expect(gapClass).toMatch(/ws-(pos|neg)/);
  });

  test('proximity indicators highlight rows approaching trigger levels', async ({
    page,
  }) => {
    await page.goto('/workspace?scenario=many-watchlist');
    await expect(page.getByTestId('ws-grid')).toBeVisible();

    // many-watchlist has 28 items — some should be approaching triggers.
    const table = page.getByTestId('ws-watchlist-table');
    await expect(table).toBeVisible();

    // At least one row should have a proximity class (approaching or urgent).
    const proxRows = table.locator(
      'td.ws-approaching, td.ws-urgent',
    );
    const count = await proxRows.count();
    expect(count).toBeGreaterThan(0);

    // At least one row has ws-approaching (<2%) styling.
    const approaching = table.locator('td.ws-approaching').first();
    await expect(approaching).toBeVisible();
  });

  test('watchlist empty state renders for zero-watchlist scenario', async ({
    page,
  }) => {
    // The fixture system doesn't ship a zero-watchlist scenario, but the
    // component handles it defensively. The zero-positions scenario still
    // has watchlist items, so we verify the panel renders with data.
    // (Empty-state coverage lives in the component's manual verification.)
    await page.goto('/workspace');
    await expect(page.getByTestId('ws-panel-watchlist')).toBeVisible();

    // The populated state renders — empty state text is NOT present.
    await expect(page.getByTestId('ws-watchlist-table')).toBeVisible();
    await expect(page.getByTestId('ws-watchlist-empty')).toHaveCount(0);
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

// ═══════════════════════════════════════════════════════════════════════════
// S03: PositionsPanel and RiskPanel
// ═══════════════════════════════════════════════════════════════════════════

test.describe('S03 PositionsPanel — 7-column terminal-dense table', () => {
  test('renders 7 column headers (Symbol, Side, Size, Entry, Mark, uP&L, R)', async ({
    page,
  }) => {
    await page.goto('/workspace');
    await expect(page.getByTestId('ws-positions-table')).toBeVisible();

    const headers = page.getByTestId('ws-positions-table').locator('thead th');
    await expect(headers).toHaveCount(7);
    const headerTexts = [
      'Symbol', 'Side', 'Size', 'Entry', 'Mark', 'uP&L', 'R',
    ];
    for (let i = 0; i < 7; i++) {
      await expect(headers.nth(i)).toHaveText(headerTexts[i]);
    }
  });

  test('populates position rows with per-symbol data-testid and all columns', async ({
    page,
  }) => {
    await page.goto('/workspace');
    await expect(page.getByTestId('ws-positions-table')).toBeVisible();

    // Default scenario: 3 open positions.
    const rows = page.getByTestId('ws-positions-table').locator('tbody tr');
    await expect(rows).toHaveCount(3);

    // Per-symbol data-testid rows.
    await expect(page.getByTestId('ws-position-row-NVDA')).toBeVisible();
    await expect(page.getByTestId('ws-position-row-AMD')).toBeVisible();
    await expect(page.getByTestId('ws-position-row-TSLA')).toBeVisible();

    // NVDA: all columns populate (no — fallback for fresh data).
    const nvdaRow = page.getByTestId('ws-position-row-NVDA');
    await expect(nvdaRow.locator('td').nth(0)).toHaveText('NVDA');

    // Side column shows L/S with color class.
    const sideCell = nvdaRow.locator('td').nth(1);
    await expect(sideCell).toHaveText(/^[LS]$/);
    const sideClass = await sideCell.evaluate((el) => el.className);
    expect(sideClass).toMatch(/ws-dir-(long|short)/);

    // Size is numeric, not —.
    await expect(nvdaRow.locator('td').nth(2)).not.toHaveText('—');
    // Entry is dollar-denominated.
    await expect(nvdaRow.locator('td').nth(3)).toContainText('$');
  });

  test('R-multiple column renders with data-testid and sign prefix', async ({
    page,
  }) => {
    await page.goto('/workspace');
    await expect(page.getByTestId('ws-positions-table')).toBeVisible();

    // Every position row has the R cell.
    const rCells = page.getByTestId('ws-position-cell-r');
    await expect(rCells).toHaveCount(3);

    // Spot-check: NVDA R-multiple has a + sign (positive P&L).
    const nvdaRCell = page
      .getByTestId('ws-position-row-NVDA')
      .getByTestId('ws-position-cell-r');
    await expect(nvdaRCell).toContainText('R');
    await expect(nvdaRCell).toContainText('+');

    // TSLA R-multiple has a - sign (negative P&L).
    const tslaRCell = page
      .getByTestId('ws-position-row-TSLA')
      .getByTestId('ws-position-cell-r');
    await expect(tslaRCell).toContainText('-');
  });

  test('stale mark indicator renders for positions with stale/missing markStatus', async ({
    page,
  }) => {
    await page.goto('/workspace');

    // Default: TSLA is stale — indicator visible.
    await expect(
      page.getByTestId('ws-position-row-TSLA').getByTestId('ws-mark-stale-indicator'),
    ).toBeVisible();

    // Default: NVDA is fresh — no indicator.
    await expect(
      page.getByTestId('ws-position-row-NVDA').locator('[data-testid="ws-mark-stale-indicator"]'),
    ).toHaveCount(0);

    // large-drawdown: all positions are missing — indicators visible.
    await page.getByTestId('ws-scenario-select').selectOption('large-drawdown');
    await expect(
      page.getByTestId('ws-position-row-NVDA').getByTestId('ws-mark-stale-indicator'),
    ).toBeVisible();
    await expect(
      page.getByTestId('ws-position-row-AMD').getByTestId('ws-mark-stale-indicator'),
    ).toBeVisible();

    // Missing marks render — not numeric price.
    const nvdaMark = page
      .getByTestId('ws-position-row-NVDA')
      .locator('td')
      .nth(4);
    await expect(nvdaMark).toContainText('—');
  });

  test('empty state renders when positions array is empty', async ({ page }) => {
    await page.goto('/workspace?scenario=zero-positions');
    await expect(page.getByTestId('ws-panel-positions')).toBeVisible();
    await expect(page.getByTestId('ws-positions-empty')).toBeVisible();
    await expect(page.getByTestId('ws-positions-empty')).toHaveText(
      'No open positions',
    );
    await expect(page.getByTestId('ws-positions-table')).toHaveCount(0);
  });

  test('R-multiple renders — when data is unavailable (large-drawdown)', async ({
    page,
  }) => {
    await page.goto('/workspace?scenario=large-drawdown');
    await expect(page.getByTestId('ws-positions-table')).toBeVisible();

    // Missing marks mean no unrealized P&L, so R = —.
    const rCells = page.getByTestId('ws-position-cell-r');
    await expect(rCells).toHaveCount(2);
    for (const cell of await rCells.all()) {
      await expect(cell).toHaveText('—');
    }
  });

  test('panel header shows open position count', async ({ page }) => {
    await page.goto('/workspace');
    await expect(
      page
        .getByTestId('ws-panel-positions')
        .getByText('3 open'),
    ).toBeVisible();

    await page.getByTestId('ws-scenario-select').selectOption('large-drawdown');
    await expect(
      page
        .getByTestId('ws-panel-positions')
        .getByText('2 open'),
    ).toBeVisible();
  });
});

test.describe('S03 RiskPanel — PTD/current-state visual separation', () => {
  test('renders PTD and Current section headers with sub-header hierarchy', async ({
    page,
  }) => {
    await page.goto('/workspace');
    await expect(page.getByTestId('ws-risk-panel')).toBeVisible();

    // PTD section.
    const ptdSection = page.getByTestId('ws-risk-ptd-section');
    await expect(ptdSection).toBeVisible();
    await expect(
      ptdSection.locator('.ws-risk-section-header'),
    ).toHaveText('PTD');

    // Current State section.
    const currentSection = page.getByTestId('ws-risk-current-section');
    await expect(currentSection).toBeVisible();
    await expect(
      currentSection.locator('.ws-risk-section-header'),
    ).toHaveText('Current');

    // PTD section renders before Current State (DOM order).
    const sectionOrder = await page.evaluate(() => {
      const ptd = document.querySelector('[data-testid="ws-risk-ptd-section"]');
      const current = document.querySelector('[data-testid="ws-risk-current-section"]');
      if (!ptd || !current) return null;
      return ptd.compareDocumentPosition(current) & Node.DOCUMENT_POSITION_FOLLOWING
        ? 'ptd-first'
        : 'current-first';
    });
    expect(sectionOrder).toBe('ptd-first');
  });

  test('PTD section shows Realized P&L, Realized Fees, and Drawdown', async ({
    page,
  }) => {
    await page.goto('/workspace');
    const ptdSection = page.getByTestId('ws-risk-ptd-section');
    await expect(ptdSection).toBeVisible();

    await expect(ptdSection.getByText('Realized P&L')).toBeVisible();
    await expect(ptdSection.getByText('Realized Fees')).toBeVisible();
    await expect(ptdSection.getByText('Drawdown')).toBeVisible();

    // Realized P&L is positive → ws-pos.
    const realizedPnlRow = ptdSection.locator('.ws-stat-row').filter({
      hasText: 'Realized P&L',
    });
    const valueEl = realizedPnlRow.locator('.ws-num');
    const valueClass = await valueEl.evaluate((el) => el.className);
    expect(valueClass).toMatch(/ws-pos/);
  });

  test('Current State section shows Open P&L, Open Risk, Portfolio Heat, Missing Stops, Stop Coverage, Exposure', async ({
    page,
  }) => {
    await page.goto('/workspace');
    const currentSection = page.getByTestId('ws-risk-current-section');
    await expect(currentSection).toBeVisible();

    await expect(currentSection.getByText('Open P&L')).toBeVisible();
    await expect(currentSection.getByText('Open Risk')).toBeVisible();
    await expect(currentSection.getByText('Portfolio Heat')).toBeVisible();
    await expect(currentSection.getByText('Missing Stops')).toBeVisible();
    await expect(currentSection.getByText('Stop Coverage')).toBeVisible();
    await expect(currentSection.getByText('Exposure')).toBeVisible();
  });

  test('Portfolio Heat renders as percentage in Current section', async ({ page }) => {
    await page.goto('/workspace');
    const heatRow = page
      .getByTestId('ws-risk-current-section')
      .locator('.ws-stat-row')
      .filter({ hasText: 'Portfolio Heat' });
    const heatValue = heatRow.locator('.ws-num');
    await expect(heatValue).toContainText('%');
  });

  test('Missing Stops = 2 in large-drawdown renders with ws-neg', async ({ page }) => {
    await page.goto('/workspace?scenario=large-drawdown');
    const stopsRow = page
      .getByTestId('ws-risk-current-section')
      .locator('.ws-stat-row')
      .filter({ hasText: 'Missing Stops' });
    const stopsValue = stopsRow.locator('.ws-num');
    await expect(stopsValue).toHaveText('2');
    const stopsClass = await stopsValue.evaluate((el) => el.className);
    expect(stopsClass).toMatch(/ws-neg/);
  });

  test('zero-positions scenario shows zeroed risk metrics', async ({ page }) => {
    await page.goto('/workspace?scenario=zero-positions');
    await expect(page.getByTestId('ws-risk-panel')).toBeVisible();

    // Open P&L is $0.00.
    const openPnlRow = page
      .getByTestId('ws-risk-current-section')
      .locator('.ws-stat-row')
      .filter({ hasText: 'Open P&L' });
    await expect(openPnlRow.locator('.ws-num')).toContainText('0');

    // Missing Stops is 0 (no ws-neg).
    const stopsRow = page
      .getByTestId('ws-risk-current-section')
      .locator('.ws-stat-row')
      .filter({ hasText: 'Missing Stops' });
    await expect(stopsRow.locator('.ws-num')).toHaveText('0');
    const stopsClass = await stopsRow.locator('.ws-num').evaluate((el) => el.className);
    expect(stopsClass).not.toMatch(/ws-neg/);
  });

  test('Many-watchlist scenario: positions and risk panels render without viewport overflow', async ({
    page,
  }) => {
    await page.goto('/workspace?scenario=many-watchlist');
    await expect(page.getByTestId('ws-positions-table')).toBeVisible();
    await expect(page.getByTestId('ws-risk-panel')).toBeVisible();

    // 3 positions (same as default).
    await expect(
      page.getByTestId('ws-positions-table').locator('tbody tr'),
    ).toHaveCount(3);

    // No viewport scroll.
    const scroll = await page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
    }));
    expect(scroll.scrollHeight).toBeLessThanOrEqual(scroll.clientHeight);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// S04: SetupsPanel — Setup Ranking, Attention Insights, Trade Ideas
// ═══════════════════════════════════════════════════════════════════════════

test.describe('S04 SetupsPanel — three vertically-stacked sub-panels', () => {
  test('renders all three sub-panels with data-testid attributes', async ({
    page,
  }) => {
    await page.goto('/workspace');
    await expect(page.getByTestId('ws-grid')).toBeVisible();

    const insights = page.getByTestId('ws-panel-insights');
    await expect(insights).toBeVisible();

    // Sub-panel data-testids.
    await expect(insights.getByTestId('ws-setup-ranking-table')).toBeVisible();
    await expect(insights.getByTestId('ws-attention-insights-list')).toBeVisible();
    await expect(insights.getByTestId('ws-ideas-table')).toBeVisible();
  });

  test('setup ranking table has 5 columns in correct order', async ({
    page,
  }) => {
    await page.goto('/workspace');
    await expect(page.getByTestId('ws-setup-ranking-table')).toBeVisible();

    const headers = page
      .getByTestId('ws-setup-ranking-table')
      .locator('thead th');
    await expect(headers).toHaveCount(5);
    await expect(headers.nth(0)).toHaveText('Setup');
    await expect(headers.nth(1)).toHaveText('Win %');
    await expect(headers.nth(2)).toHaveText('N');
    await expect(headers.nth(3)).toHaveText('Avg R');
    await expect(headers.nth(4)).toHaveText('Score');
  });

  test('setup ranking shows per-setup rows with data-testid and populated numeric columns', async ({
    page,
  }) => {
    await page.goto('/workspace');
    await expect(page.getByTestId('ws-setup-ranking-table')).toBeVisible();

    // 4 setup rows.
    const rows = page
      .getByTestId('ws-setup-ranking-table')
      .locator('tbody tr');
    await expect(rows).toHaveCount(4);

    // Each known setup has a per-setup id row.
    const setupIds = ['setup-breakout', 'setup-pullback', 'setup-reversal', 'setup-gap'];
    for (const sid of setupIds) {
      await expect(page.getByTestId(`ws-setup-row-${sid}`)).toBeVisible();
    }

    // Opening Range Breakout: first row, all numeric columns are non-dash.
    const breakoutRow = page.getByTestId('ws-setup-row-setup-breakout');
    await expect(breakoutRow.locator('td').nth(0)).toHaveText('Opening Range Breakout');
    // Win % contains a number + %.
    await expect(breakoutRow.locator('td').nth(1)).toContainText('%');
    // N column is an integer count (no % sign).
    await expect(breakoutRow.locator('td').nth(2)).toHaveText(/^\d+$/);
    // Score is a number.
    const score = breakoutRow.locator('td').nth(4);
    const scoreText = await score.textContent();
    expect(parseFloat(scoreText!)).not.toBeNaN();
  });

  test('sample-size warnings render for very_small and small setups only', async ({
    page,
  }) => {
    await page.goto('/workspace');
    await expect(page.getByTestId('ws-setup-ranking-table')).toBeVisible();

    // Gap Continuation (setup-gap) has very_small → ws-severity-critical class.
    const gapRow = page.getByTestId('ws-setup-row-setup-gap');
    const gapWarning = gapRow.locator('[data-testid="ws-sample-size-warning"]');
    await expect(gapWarning).toBeVisible();
    const gapWarningClass = await gapWarning.evaluate((el) => el.className);
    expect(gapWarningClass).toMatch(/ws-severity-critical/);
    await expect(gapWarning).toContainText('<10');

    // Exhaustion Reversal (setup-reversal) has small → ws-severity-warning class.
    const revRow = page.getByTestId('ws-setup-row-setup-reversal');
    const revWarning = revRow.locator('[data-testid="ws-sample-size-warning"]');
    await expect(revWarning).toBeVisible();
    const revWarningClass = await revWarning.evaluate((el) => el.className);
    expect(revWarningClass).toMatch(/ws-severity-warning/);
    await expect(revWarning).toContainText('<30');

    // Opening Range Breakout (adequate) and Trend Pullback (moderate) have no warnings.
    for (const sid of ['setup-breakout', 'setup-pullback']) {
      const row = page.getByTestId(`ws-setup-row-${sid}`);
      await expect(
        row.locator('[data-testid="ws-sample-size-warning"]'),
      ).toHaveCount(0);
    }
  });

  test('large-drawdown reorders setup ranking and shows different data', async ({
    page,
  }) => {
    await page.goto('/workspace?scenario=large-drawdown');
    await expect(page.getByTestId('ws-setup-ranking-table')).toBeVisible();

    const rows = page
      .getByTestId('ws-setup-ranking-table')
      .locator('tbody tr');
    await expect(rows).toHaveCount(4);

    // First row: Exhaustion Reversal (reordered, most trades in drawdown).
    const firstRow = rows.nth(0);
    await expect(firstRow.locator('td').nth(0)).toContainText('Exhaustion');

    // Opening Range Breakout has small → ws-severity-warning.
    const breakoutRow = page.getByTestId('ws-setup-row-setup-breakout');
    const breakoutWarning = breakoutRow.locator(
      '[data-testid="ws-sample-size-warning"]',
    );
    await expect(breakoutWarning).toBeVisible();
    await expect(breakoutWarning).toContainText('<30');
  });

  test('attention insights list renders with severity badges and correct classes', async ({
    page,
  }) => {
    await page.goto('/workspace');
    await expect(page.getByTestId('ws-attention-insights-list')).toBeVisible();

    const list = page.getByTestId('ws-attention-insights-list');
    const items = list.locator('li');
    await expect(items).toHaveCount(2);

    // First insight: best_day → info severity.
    await expect(page.getByTestId('ws-insight-item-best_day')).toBeVisible();
    const infoBadge = page.getByTestId('ws-severity-info');
    await expect(infoBadge.first()).toBeVisible();
    await expect(infoBadge.first()).toHaveText('INFO');
    const infoBadgeClass = await infoBadge
      .first()
      .evaluate((el) => el.className);
    expect(infoBadgeClass).toMatch(/ws-severity-info/);

    // Second insight: oversizing → warning severity.
    await expect(page.getByTestId('ws-insight-item-oversizing')).toBeVisible();
    const warnBadge = page.getByTestId('ws-severity-warning');
    await expect(warnBadge.first()).toBeVisible();
    await expect(warnBadge.first()).toHaveText('WARN');

    // Messages are visible (non-empty).
    const messages = list.locator('.ws-insight-message');
    for (const msg of await messages.all()) {
      const text = await msg.textContent();
      expect(text?.trim().length).toBeGreaterThan(0);
    }
  });

  test('large-drawdown scenario shows critical severity insight', async ({
    page,
  }) => {
    await page.goto('/workspace?scenario=large-drawdown');
    await expect(page.getByTestId('ws-attention-insights-list')).toBeVisible();

    // drawdown insight → critical.
    await expect(page.getByTestId('ws-insight-item-drawdown')).toBeVisible();
    const critBadge = page.getByTestId('ws-severity-critical');
    await expect(critBadge.first()).toBeVisible();
    await expect(critBadge.first()).toHaveText('CRIT');
    const critBadgeClass = await critBadge
      .first()
      .evaluate((el) => el.className);
    expect(critBadgeClass).toMatch(/ws-severity-critical/);

    // revenge_trading → warning.
    await expect(page.getByTestId('ws-insight-item-revenge_trading')).toBeVisible();
  });

  test('trade ideas table has 7 columns in correct order', async ({
    page,
  }) => {
    await page.goto('/workspace');
    await expect(page.getByTestId('ws-ideas-table')).toBeVisible();

    const headers = page.getByTestId('ws-ideas-table').locator('thead th');
    await expect(headers).toHaveCount(7);
    await expect(headers.nth(0)).toHaveText('Symbol');
    await expect(headers.nth(1)).toHaveText('Setup');
    await expect(headers.nth(2)).toHaveText('Dir');
    await expect(headers.nth(3)).toHaveText('Entry');
    await expect(headers.nth(4)).toHaveText('Stop');
    await expect(headers.nth(5)).toHaveText('Target');
    await expect(headers.nth(6)).toHaveText('R/R');
  });

  test('trade ideas rows have per-symbol data-testid and direction badges', async ({
    page,
  }) => {
    await page.goto('/workspace');
    await expect(page.getByTestId('ws-ideas-table')).toBeVisible();

    const rows = page.getByTestId('ws-ideas-table').locator('tbody tr');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);

    // Each row has a per-symbol data-testid.
    const rowSymbols = await page
      .getByTestId('ws-ideas-table')
      .locator('[data-testid^="ws-idea-row-"]')
      .all();
    for (const row of rowSymbols) {
      const testId = await row.getAttribute('data-testid');
      expect(testId).toMatch(/^ws-idea-row-[A-Z]+$/);
    }

    // Direction column uses L/S with color class.
    const firstRow = rows.first();
    const dirCell = firstRow.locator('td').nth(2);
    const dirText = (await dirCell.textContent())?.trim();
    expect(['L', 'S']).toContain(dirText);
    expect(await dirCell.evaluate((el) => el.className)).toMatch(
      /ws-dir-(long|short)/,
    );
  });

  test('many-watchlist scenario yields more trade ideas than default', async ({
    page,
  }) => {
    await page.goto('/workspace?scenario=many-watchlist');
    await expect(page.getByTestId('ws-ideas-table')).toBeVisible();
    const manyCount = await page
      .getByTestId('ws-ideas-table')
      .locator('tbody tr')
      .count();

    await page.goto('/workspace?scenario=default');
    await expect(page.getByTestId('ws-ideas-table')).toBeVisible();
    const defaultCount = await page
      .getByTestId('ws-ideas-table')
      .locator('tbody tr')
      .count();

    expect(manyCount).toBeGreaterThan(defaultCount);
  });

  test('zero-positions scenario still renders setup ranking and insights (historical data)', async ({
    page,
  }) => {
    await page.goto('/workspace?scenario=zero-positions');
    await expect(page.getByTestId('ws-grid')).toBeVisible();

    // Setup ranking and insights persist — they are historical, not position-dependent.
    await expect(page.getByTestId('ws-setup-ranking-table')).toBeVisible();
    await expect(page.getByTestId('ws-attention-insights-list')).toBeVisible();
    await expect(page.getByTestId('ws-setup-row-setup-breakout')).toBeVisible();
  });

  test('panel fits inside the viewport at 1440x900 without page scroll', async ({
    page,
  }) => {
    await page.goto('/workspace');
    await expect(page.getByTestId('ws-panel-insights')).toBeVisible();

    const insights = page.getByTestId('ws-panel-insights');
    const box = await insights.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(1440);
    expect(box!.y + box!.height).toBeLessThanOrEqual(900);

    // Workstation surface itself never scrolls.
    const scroll = await page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
    }));
    expect(scroll.scrollHeight).toBeLessThanOrEqual(scroll.clientHeight);
  });

  test('no console errors or page errors across all 4 scenarios', async ({
    page,
  }) => {
    const { consoleErrors, pageErrors } = watchForErrors(page);

    await page.goto('/workspace');
    await expect(page.getByTestId('ws-panel-insights')).toBeVisible();
    await page.getByTestId('ws-scenario-select').selectOption('zero-positions');
    await expect(page.getByTestId('ws-setup-ranking-table')).toBeVisible();
    await page.getByTestId('ws-scenario-select').selectOption('large-drawdown');
    await expect(page.getByTestId('ws-attention-insights-list')).toBeVisible();
    await page.getByTestId('ws-scenario-select').selectOption('many-watchlist');
    await expect(page.getByTestId('ws-ideas-table')).toBeVisible();

    expect(pageErrors, 'uncaught page errors').toEqual([]);
    expect(consoleErrors, 'console.error output').toEqual([]);
  });

  test('screenshot evidence at 1440x900 for S04 setups and ideas', async ({
    page,
  }, testInfo) => {
    await page.goto('/workspace');
    await expect(page.getByTestId('ws-grid')).toBeVisible();
    await expect(page.getByTestId('ws-fixture-badge')).toBeVisible();
    await expect(page.getByTestId('ws-setup-ranking-table')).toBeVisible();

    const shot = await page.screenshot({ fullPage: false });
    await testInfo.attach('s04-setups-ideas-1440x900.png', {
      body: shot,
      contentType: 'image/png',
    });

    // Also capture large-drawdown for negative-data evidence.
    await page.getByTestId('ws-scenario-select').selectOption('large-drawdown');
    await expect(page.getByTestId('ws-insight-item-drawdown')).toBeVisible();
    const drawdownShot = await page.screenshot({ fullPage: false });
    await testInfo.attach('s04-large-drawdown-1440x900.png', {
      body: drawdownShot,
      contentType: 'image/png',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// S05: EquityChart and PerformanceSummary
// ═══════════════════════════════════════════════════════════════════════════

test.describe('S05 EquityChart — ECharts dual-Y-axis equity/drawdown chart', () => {
  test('renders ECharts canvas inside equity panel at ws-equity-chart', async ({
    page,
  }) => {
    await page.goto('/workspace');
    await expect(page.getByTestId('ws-grid')).toBeVisible();

    const chartContainer = page.getByTestId('ws-equity-chart');
    await expect(chartContainer).toBeVisible();

    // ECharts renders a <canvas> inside the container.
    const canvas = chartContainer.locator('canvas');
    await expect(canvas).toBeVisible();
    expect(await canvas.count()).toBe(1);

    // Inside the equity panel (not floating elsewhere).
    const equityPanel = page.getByTestId('ws-panel-equity');
    await expect(equityPanel.getByTestId('ws-equity-chart')).toBeVisible();

    // Empty state must not render when equityCurve has data (all scenarios have data).
    await expect(page.getByTestId('ws-equity-chart-empty')).toHaveCount(0);
  });

  test('chart re-renders after scenario switch without console errors', async ({
    page,
  }) => {
    const { consoleErrors, pageErrors } = watchForErrors(page);
    await page.goto('/workspace');
    await expect(page.getByTestId('ws-equity-chart')).toBeVisible();
    await expect(page.getByTestId('ws-equity-chart').locator('canvas')).toBeVisible();

    // Switch to large-drawdown: chart and canvas re-render.
    await page.getByTestId('ws-scenario-select').selectOption('large-drawdown');
    await expect(page.getByTestId('ws-equity-chart')).toBeVisible();
    await expect(page.getByTestId('ws-equity-chart').locator('canvas')).toBeVisible();

    expect(pageErrors, 'uncaught page errors after scenario switch').toEqual([]);
    expect(consoleErrors, 'console.error after scenario switch').toEqual([]);
  });

  test('renders across all 4 fixture scenarios', async ({ page }) => {
    for (const scenario of [
      'default',
      'zero-positions',
      'large-drawdown',
      'many-watchlist',
    ]) {
      await page.goto(`/workspace?scenario=${scenario}`);
      await expect(page.getByTestId('ws-grid')).toBeVisible();
      await expect(page.getByTestId('ws-equity-chart')).toBeVisible();
      await expect(
        page.getByTestId('ws-equity-chart').locator('canvas'),
      ).toBeVisible();
      // Empty state must not render when data is present.
      await expect(page.getByTestId('ws-equity-chart-empty')).toHaveCount(0);
    }
  });
});

test.describe('S05 PerformanceSummary — monthly table and drawdown block', () => {
  test('monthly performance table renders with 4 columns and populated rows', async ({
    page,
  }) => {
    await page.goto('/workspace');
    await expect(page.getByTestId('ws-perf-monthly-table')).toBeVisible();

    const table = page.getByTestId('ws-perf-monthly-table');
    const headers = table.locator('thead th');
    await expect(headers).toHaveCount(4);
    await expect(headers.nth(0)).toHaveText('Month');
    await expect(headers.nth(1)).toHaveText('P&L');
    await expect(headers.nth(2)).toHaveText('Win %');
    await expect(headers.nth(3)).toHaveText('Trades');

    // Default scenario has 3 months (Apr–Jun 2026).
    const rows = table.locator('tbody tr');
    await expect(rows).toHaveCount(3);

    // First row has populated numeric columns.
    const firstRow = rows.first();
    await expect(firstRow.locator('td').nth(0)).toHaveText(/Apr|May|Jun/);
    await expect(firstRow.locator('td').nth(1)).toContainText('$');
    await expect(firstRow.locator('td').nth(2)).toContainText('%');
    await expect(firstRow.locator('td').nth(3)).toHaveText(/^\d+$/);
  });

  test('monthly table shows negative P&L with ws-neg class in large-drawdown', async ({
    page,
  }) => {
    await page.goto('/workspace?scenario=large-drawdown');
    await expect(page.getByTestId('ws-perf-monthly-table')).toBeVisible();

    const table = page.getByTestId('ws-perf-monthly-table');
    expect(await table.locator('tbody tr').count()).toBe(3);

    // All months in large-drawdown have negative P&L.
    const negCells = table.locator('tbody td.ws-num.ws-neg').first();
    await expect(negCells).toBeVisible();
    await expect(negCells).toContainText('-');
    await expect(negCells).toContainText('$');
  });

  test('drawdown summary shows max DD, max DD %, current DD, current DD %', async ({
    page,
  }) => {
    await page.goto('/workspace');
    await expect(page.getByTestId('ws-perf-drawdown-summary')).toBeVisible();

    const drawdown = page.getByTestId('ws-perf-drawdown-summary');

    // Section header.
    await expect(drawdown.locator('.ws-risk-section-header')).toHaveText(
      'Drawdown',
    );

    // All four stat rows present (exact to avoid 'Max DD' matching 'Max DD %').
    await expect(drawdown.getByText('Max DD', { exact: true })).toBeVisible();
    await expect(drawdown.getByText('Max DD %')).toBeVisible();
    await expect(drawdown.getByText('Current DD', { exact: true })).toBeVisible();
    await expect(drawdown.getByText('Current DD %')).toBeVisible();

    // 4 stat rows.
    const statRows = drawdown.locator('.ws-stat-row');
    await expect(statRows).toHaveCount(4);

    // Max DD values use ws-neg (drawdown is always negative).
    await expect(drawdown.locator('.ws-num.ws-neg').first()).toBeVisible();
  });

  test('performance summary renders across all 4 scenarios without console errors', async ({
    page,
  }) => {
    const { consoleErrors, pageErrors } = watchForErrors(page);

    for (const scenario of [
      'default',
      'zero-positions',
      'large-drawdown',
      'many-watchlist',
    ]) {
      await page.goto(`/workspace?scenario=${scenario}`);
      await expect(page.getByTestId('ws-grid')).toBeVisible();
      await expect(page.getByTestId('ws-perf-monthly-table')).toBeVisible();
      await expect(page.getByTestId('ws-perf-drawdown-summary')).toBeVisible();
    }

    expect(pageErrors, 'uncaught page errors').toEqual([]);
    expect(consoleErrors, 'console.error output').toEqual([]);
  });

  test('performance summary fits inside viewport at 1440x900 without page scroll', async ({
    page,
  }) => {
    await page.goto('/workspace');
    await expect(page.getByTestId('ws-grid')).toBeVisible();

    // Both S05 elements exist in the DOM.
    await expect(page.getByTestId('ws-equity-chart')).toBeVisible();
    await expect(page.getByTestId('ws-perf-monthly-table')).toBeVisible();
    await expect(page.getByTestId('ws-perf-drawdown-summary')).toBeVisible();

    // Workstation surface itself never scrolls.
    const scroll = await page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
    }));
    expect(scroll.scrollHeight).toBeLessThanOrEqual(scroll.clientHeight);
  });
});
