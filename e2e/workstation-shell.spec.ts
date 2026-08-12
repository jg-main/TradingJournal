/**
 * M005-22kf6a S01 T04 — Workstation Shell browser evidence at 1440x900.
 *
 * Proves the dense /dev/workstation dashboard concept: the Risk & Positions
 * shell uses a single document-scroll path while panels populate with realistic fixture
 * data, the FIXTURE badge and console.warn signal fixture mode, scenario
 * switching works, malformed scenario params degrade safely, and the legacy
 * dashboard at / is unaffected.
 *
 * The fixture scenario never touches the database, so this spec needs no
 * API stubbing — /dev/workstation renders entirely from src/lib/workstation-fixtures.
 *
 * Coverage:
 * 1. Toolbar renders: brand, account selector, scenario selector, FIXTURE badge
 * 2. Curated grid panels render (risk, positions, account-state, performance,
 *    process-review, kpis); Watchlist stays outside the default setup
 * 3. One page scroll at 1440x900; operational panels do not scroll internally
 * 4. Fixture data populates the curated panels
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
 * 16. S05: AccountStatePanel renders §6.7 labels (Cash+as-of, Marked, NAV qualifier,
 *    scoped P&L, negative-only Drawdown) and the equity chart
 * 17. S05: PerformancePanel renders Tier 2 KPIs, monthly table, R distribution,
 *    setup ranking, and Tier 3 metrics gated to Unavailable
 * 18. S05: ProcessReviewPanel renders process score distribution, directional
 *    performance, and attention items with severity badges
 * 19. S05: All 4 scenarios render the S05 panels without console/page errors
 */

import { test, expect, type Page } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 } });

const GRID_AREAS = [
  'kpis',
  'account-state',
  'positions',
  'risk',
  'process-review',
  'performance',
] as const;

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
    await page.goto('/dev/workstation');

    const toolbar = page.getByTestId('ws-toolbar');
    await expect(toolbar).toBeVisible();
    await expect(toolbar.getByText('Workstation')).toBeVisible();

    // Account selector is populated with the fixture account.
    const accountSelect = toolbar.getByLabel('Active account');
    await expect(accountSelect).toBeVisible();
    await expect(accountSelect.locator('option')).toHaveCount(1);
    await expect(accountSelect.locator('option').first()).toHaveText('Primary Margin');

    // Scenario selector exposes all six fixture scenarios.
    const scenarioSelect = page.getByTestId('ws-scenario-select');
    await expect(scenarioSelect.locator('option')).toHaveText([
      'default',
      'zero-positions',
      'large-drawdown',
      'many-watchlist',
      'dash-ac-01-healthy',
      'dash-ac-02-partial',
    ]);

    // Slice verification contract: FIXTURE badge visible in fixture mode.
    await expect(page.getByTestId('ws-fixture-badge')).toBeVisible();
    await expect(page.getByTestId('ws-fixture-badge')).toHaveText(/fixture/i);

    // Toolbar is compact (40px per the density tokens; allow small slack).
    const box = await toolbar.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeLessThanOrEqual(48);
  });

  test('curated grid panels render without horizontal overflow in one document-scroll flow', async ({
    page,
  }) => {
    await page.goto('/dev/workstation');

    const grid = page.getByTestId('ws-grid');
    await expect(grid).toBeVisible();

    // All standalone panels now use the unified ws-panel-{area} pattern.
    for (const area of GRID_AREAS) {
      const testId = `ws-panel-${area}`;
      const panel = page.getByTestId(testId);
      await expect(panel).toBeVisible();
      const box = await panel.boundingBox();
      expect(box, `panel ${area} has layout box`).not.toBeNull();
      expect(box!.x, `panel ${area} inside left edge`).toBeGreaterThanOrEqual(0);
      expect(box!.y, `panel ${area} inside top edge`).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, `panel ${area} inside right edge`).toBeLessThanOrEqual(1440);
    }
    await expect(page.getByTestId('ws-panel-watchlist')).toHaveCount(0);

    // The browser document, rather than a panel body, is the normal flow.
    const scroll = await page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
    }));
    expect(scroll.scrollHeight).toBeGreaterThan(scroll.clientHeight);
  });

  test('fixture data populates KPI strip and data panels', async ({ page }) => {
    await page.goto('/dev/workstation');

    const kpis = page.getByTestId('ws-panel-kpis');
    await expect(kpis.getByText('Net P&L')).toBeVisible();
    await expect(kpis.getByText('Win Rate')).toBeVisible();
    await expect(kpis.getByText('Profit Factor')).toBeVisible();
    // KPI values are rendered (not all placeholder dashes).
    await expect(kpis.locator('.ws-kpi-value').first()).not.toHaveText('—');

    // Default scenario: positions table has real rows; Watchlist is not part
    // of the curated Risk & Positions setup.
    const positions = page.getByTestId('ws-panel-positions');
    await expect(positions.locator('tbody tr').first()).toBeVisible();
    expect(await positions.locator('tbody tr').count()).toBeGreaterThan(0);

    await expect(page.getByTestId('ws-panel-watchlist')).toHaveCount(0);

    // Account State panel shows §6.7 cells and the equity chart.
    const accountState = page.getByTestId('ws-panel-account-state');
    await expect(accountState.getByTestId('ws-equity-chart')).toBeVisible();
    await expect(accountState.getByTestId('ws-account-state-cash')).toBeVisible();
    await expect(accountState.getByTestId('ws-account-state-nav')).toBeVisible();
    await expect(accountState.getByTestId('ws-account-state-drawdown')).toBeVisible();

    // Performance panel shows Tier 2 catalogue sections.
    const performance = page.getByTestId('ws-panel-performance');
    await expect(performance.getByTestId('ws-performance-kpis')).toBeVisible();
    await expect(performance.getByTestId('ws-performance-monthly')).toBeVisible();
    await expect(performance.getByTestId('ws-performance-tier3')).toBeVisible();

    // Process Review panel shows discipline and attention sections.
    const processReview = page.getByTestId('ws-panel-process-review');
    await expect(processReview.getByTestId('ws-process-score-dist')).toBeVisible();
    await expect(processReview.getByTestId('ws-directional-performance')).toBeVisible();
    await expect(processReview.getByTestId('ws-attention-items')).toBeVisible();

    // Risk panel shows its section headers and stat rows.
    await expect(page.getByTestId('ws-panel-risk').getByText('Portfolio Heat')).toBeVisible();
  });

  test('fixture mode emits console.warn runtime signal', async ({ page }) => {
    const warnings: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'warning') warnings.push(msg.text());
    });
    await page.goto('/dev/workstation');
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
    await page.goto('/dev/workstation');
    await expect(page.getByTestId('ws-grid')).toBeVisible();

    // The grid is SSR-visible before hydration; wait for the FIXTURE MODE
    // client-effect signal so selectOption reaches the React onChange handler
    // (same pattern as the 'fixture mode emits console.warn' test below).
    const warnings: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'warning') warnings.push(msg.text());
    });
    await expect
      .poll(
        () => warnings.some((w) => w.includes('[workstation] FIXTURE MODE')),
        { timeout: 10_000 },
      )
      .toBe(true);

    // zero-positions: positions panel shows its empty state.
    await page.getByTestId('ws-scenario-select').selectOption('zero-positions');
    await expect(page.getByTestId('ws-panel-positions').getByText('No open account positions')).toBeVisible();
    await expect(page.getByTestId('ws-fixture-badge')).toBeVisible();

    // large-drawdown: negative drawdown KPI renders with the negative class.
    await page.getByTestId('ws-scenario-select').selectOption('large-drawdown');
    const drawdownKpi = page
      .getByTestId('ws-panel-kpis')
      .locator('.ws-kpi', { hasText: 'Drawdown' })
      .locator('.ws-kpi-value');
    await expect(drawdownKpi).toHaveClass(/ws-neg/);

    // many-watchlist keeps the fixture route healthy even though Watchlist is
    // intentionally absent from the curated default.
    await page.getByTestId('ws-scenario-select').selectOption('many-watchlist');
    await expect(page.getByTestId('ws-panel-positions')).toBeVisible();
    await expect(page.getByTestId('ws-panel-watchlist')).toHaveCount(0);
  });

  test('malformed ?scenario= param degrades to default without crashing', async ({ page }) => {
    const { pageErrors } = watchForErrors(page);
    await page.goto('/dev/workstation?scenario=bogus-scenario');

    await expect(page.getByTestId('ws-grid')).toBeVisible();
    await expect(page.getByTestId('ws-scenario-select')).toHaveValue('default');
    await expect(page.getByTestId('ws-fixture-badge')).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test('no unexpected console errors or page errors during the full flow', async ({ page }) => {
    const { consoleErrors, pageErrors } = watchForErrors(page);

    await page.goto('/dev/workstation');
    await expect(page.getByTestId('ws-grid')).toBeVisible();
    await page.getByTestId('ws-scenario-select').selectOption('zero-positions');
    await page.getByTestId('ws-scenario-select').selectOption('many-watchlist');
    await page.getByTestId('ws-scenario-select').selectOption('default');

    expect(pageErrors, 'uncaught page errors').toEqual([]);
    expect(consoleErrors, 'console.error output').toEqual([]);
  });

  test('production root renders the live workstation inside the application sidebar', async ({
    page,
  }) => {
    await page.goto('/');

    await expect(
      page.getByRole('complementary').getByRole('link', { name: 'Dashboard' }),
    ).toBeVisible();
    await expect(page.getByTestId('ws-toolbar')).toBeVisible();
    await expect(page.getByTestId('ws-grid')).toBeVisible();
    await expect(page.getByTestId('ws-live-badge')).toBeVisible();
    await expect(page.getByTestId('ws-fixture-badge')).toHaveCount(0);
    await expect(page.getByTestId('ws-scenario-select')).toHaveCount(0);
  });

  test('/dev/workstation has no legacy sidebar (isolation proof)', async ({ page }) => {
    await page.goto('/dev/workstation');
    await expect(page.getByTestId('ws-grid')).toBeVisible();
    await expect(
      page.getByRole('button', { name: /open sidebar|close sidebar/i }),
    ).toHaveCount(0);
  });

  test('screenshot evidence at 1440x900', async ({ page }, testInfo) => {
    await page.goto('/dev/workstation');
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
// S04: RiskPositionsTable and RiskPanel
// ═══════════════════════════════════════════════════════════════════════════

test.describe('S04 RiskPositionsTable — 9-column risk-first table (S04 T03)', () => {
  test('renders 9 column headers (Symbol, Attribution, Side/qty, Avg cost, Mark, Unrealized P&L, Active stop, Current risk to stop, Exposure)', async ({
    page,
  }) => {
    await page.goto('/dev/workstation');
    await expect(page.getByTestId('ws-positions-table')).toBeVisible();

    const headers = page.getByTestId('ws-positions-table').locator('thead th');
    await expect(headers).toHaveCount(9);
    const headerTexts = [
      'Symbol', 'Attribution', 'Side/qty', 'Avg cost', 'Mark',
      'Unrealized P&L', 'Active stop', 'Current risk to stop', 'Exposure',
    ];
    for (let i = 0; i < 9; i++) {
      await expect(headers.nth(i)).toHaveText(headerTexts[i]);
    }
  });

  test('renders rows in risk-first sort order (missing stops first)', async ({
    page,
  }) => {
    await page.goto('/dev/workstation');
    await expect(page.getByTestId('ws-positions-table')).toBeVisible();

    // Default scenario: 3 open positions.
    const rows = page.getByTestId('ws-positions-table').locator('tbody tr');
    await expect(rows).toHaveCount(3);

    // Risk-first order: TSLA (no valid stop, stale mark) first, then NVDA
    // and AMD by largest current risk (474.00 > 257.60).
    await expect(rows.nth(0).locator('td').nth(0)).toHaveText('TSLA');
    await expect(rows.nth(1).locator('td').nth(0)).toHaveText('NVDA');
    await expect(rows.nth(2).locator('td').nth(0)).toHaveText('AMD');

    // Per-symbol data-testid rows (stable for the keynav suite).
    await expect(page.getByTestId('ws-position-row-TSLA')).toBeVisible();
    await expect(page.getByTestId('ws-position-row-NVDA')).toBeVisible();
    await expect(page.getByTestId('ws-position-row-AMD')).toBeVisible();
  });

  test('renders attribution, side/qty, and avg cost columns', async ({ page }) => {
    await page.goto('/dev/workstation');
    const tslaRow = page.getByTestId('ws-position-row-TSLA');

    // Attribution: Account only (no linked count sub-line).
    await expect(tslaRow.locator('td').nth(1)).toHaveText('Account only');
    // NVDA is Journal with the linked-journal-trade count.
    const nvdaAttribution = page.getByTestId('ws-position-row-NVDA').locator('td').nth(1);
    await expect(nvdaAttribution).toContainText('Journal');
    await expect(nvdaAttribution).toContainText('linked');
    // AMD is Mixed with the linked count.
    await expect(page.getByTestId('ws-position-row-AMD').locator('td').nth(1)).toContainText('Mixed');

    // Side/qty: L/S with direction color class.
    const sideCell = page.getByTestId('ws-position-row-NVDA').getByTestId('ws-position-cell-side');
    await expect(sideCell).toHaveText(/^L \d+$/);
    const sideClass = await sideCell.evaluate((el) => el.className);
    expect(sideClass).toMatch(/ws-dir-(long|short)/);

    // Avg cost is dollar-denominated.
    await expect(page.getByTestId('ws-position-row-NVDA').locator('td').nth(3)).toContainText('$');
  });

  test('renders active stop and current risk (or No valid stop / Incomplete)', async ({
    page,
  }) => {
    await page.goto('/dev/workstation');
    await expect(page.getByTestId('ws-positions-table')).toBeVisible();

    // Every position row has the risk cell.
    const riskCells = page.getByTestId('ws-position-cell-risk');
    await expect(riskCells).toHaveCount(3);

    // NVDA: remaining risk-to-stop + effective stop.
    await expect(
      page.getByTestId('ws-position-row-NVDA').getByTestId('ws-position-cell-risk'),
    ).toHaveText('$474.00');
    await expect(page.getByTestId('ws-position-row-NVDA')).toContainText('$127.90');

    // AMD: remaining risk-to-stop.
    await expect(
      page.getByTestId('ws-position-row-AMD').getByTestId('ws-position-cell-risk'),
    ).toHaveText('$257.60');

    // TSLA: no valid stop → Incomplete risk + 'No valid stop'.
    await expect(
      page.getByTestId('ws-position-row-TSLA').getByTestId('ws-position-cell-risk'),
    ).toHaveText('Incomplete');
    await expect(page.getByTestId('ws-position-row-TSLA')).toContainText('No valid stop');
  });

  test('stale mark renders visible state text with source and as-of (not dot-only)', async ({
    page,
  }) => {
    await page.goto('/dev/workstation');

    // Default: TSLA is stale — visible 'Stale · source · as-of' text plus the
    // amber dot as an accent (state is never conveyed by the dot alone).
    const tslaMarkState = page
      .getByTestId('ws-position-row-TSLA')
      .getByTestId('ws-position-cell-mark-state');
    await expect(tslaMarkState).toContainText('Stale');
    await expect(tslaMarkState).toContainText('user');
    await expect(tslaMarkState).toContainText('UTC');
    await expect(
      page.getByTestId('ws-position-row-TSLA').getByTestId('ws-mark-stale-indicator'),
    ).toBeVisible();

    // Default: NVDA is fresh — no indicator, price rendered.
    await expect(
      page.getByTestId('ws-position-row-NVDA').locator('[data-testid="ws-mark-stale-indicator"]'),
    ).toHaveCount(0);

    // large-drawdown: all marks missing — indicators visible.
    await page.getByTestId('ws-scenario-select').selectOption('large-drawdown');
    await expect(
      page.getByTestId('ws-position-row-NVDA').getByTestId('ws-mark-stale-indicator'),
    ).toBeVisible();
    await expect(
      page.getByTestId('ws-position-row-AMD').getByTestId('ws-mark-stale-indicator'),
    ).toBeVisible();
  });

  test('missing marks render Unpriced with no numeric price (large-drawdown)', async ({
    page,
  }) => {
    await page.goto('/dev/workstation?scenario=large-drawdown');
    await expect(page.getByTestId('ws-positions-table')).toBeVisible();

    // Mark cell: 'Unpriced' with the 'Missing mark' state sub-line — never a
    // bare em dash and never a numeric price.
    const nvdaMark = page
      .getByTestId('ws-position-row-NVDA')
      .locator('td')
      .nth(4);
    await expect(nvdaMark).toContainText('Unpriced');
    await expect(nvdaMark).toContainText('Missing mark');
    await expect(nvdaMark).not.toContainText('$');

    // Unrealized P&L is — when incalculable (never zero).
    const pnlCells = page.getByTestId('ws-position-cell-pnl');
    await expect(pnlCells).toHaveCount(2);
    for (const cell of await pnlCells.all()) {
      await expect(cell).toHaveText('—');
    }
    // Current risk is Incomplete without a mark.
    for (const cell of await page.getByTestId('ws-position-cell-risk').all()) {
      await expect(cell).toHaveText('Incomplete');
    }
  });

  test('empty state renders with the R034 text and no table', async ({ page }) => {
    await page.goto('/dev/workstation?scenario=zero-positions');
    await expect(page.getByTestId('ws-panel-positions')).toBeVisible();
    await expect(page.getByTestId('ws-positions-empty')).toBeVisible();
    await expect(page.getByTestId('ws-positions-empty')).toHaveText(
      'No open account positions',
    );
    await expect(page.getByTestId('ws-positions-table')).toHaveCount(0);
  });

  test('panel header shows the open position count (R034 title)', async ({ page }) => {
    await page.goto('/dev/workstation');
    await expect(page.getByTestId('ws-grid')).toBeVisible();

    // Wait for hydration (FIXTURE MODE client effect) before driving the
    // scenario select so the onChange handler is attached.
    const warnings: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'warning') warnings.push(msg.text());
    });
    await expect
      .poll(
        () => warnings.some((w) => w.includes('[workstation] FIXTURE MODE')),
        { timeout: 10_000 },
      )
      .toBe(true);

    await expect(
      page.getByTestId('ws-panel-positions').getByText('Open account positions: 3'),
    ).toBeVisible();

    await page.getByTestId('ws-scenario-select').selectOption('large-drawdown');
    await expect(
      page.getByTestId('ws-panel-positions').getByText('Open account positions: 2'),
    ).toBeVisible();
  });
});

test.describe('S03 RiskPanel — current exposure and risk summary band (S04 T02)', () => {
  test('renders the risk band with all eight current-state cells', async ({ page }) => {
    await page.goto('/dev/workstation');
    await expect(page.getByTestId('ws-panel-risk')).toBeVisible();

    await expect(page.getByTestId('ws-risk-cell-positions')).toBeVisible();
    await expect(page.getByTestId('ws-risk-cell-open-pnl')).toBeVisible();
    await expect(page.getByTestId('ws-risk-cell-initial-risk')).toBeVisible();
    await expect(page.getByTestId('ws-risk-cell-open-risk')).toBeVisible();
    await expect(page.getByTestId('ws-risk-cell-heat')).toBeVisible();
    await expect(page.getByTestId('ws-risk-cell-coverage')).toBeVisible();
    await expect(page.getByTestId('ws-risk-cell-gross')).toBeVisible();
    await expect(page.getByTestId('ws-risk-cell-net')).toBeVisible();
  });

  test('partial-valuation scenario renders the qualified presentation label', async ({ page }) => {
    await page.goto('/dev/workstation?scenario=dash-ac-02-partial');
    const openPnl = page.getByTestId('ws-risk-cell-open-pnl');
    // DASH-AC-02: a partial sum is never presented as a signed total.
    await expect(openPnl.locator('.ws-risk-value')).toHaveText('— Partial — 1 unpriced');
    // Marked-subset sub-line renders the known fresh-marked amount.
    await expect(openPnl.locator('.ws-risk-sub')).toContainText('Marked subset');
  });

  test('default scenario: partial stop coverage qualifies open risk, heat, and coverage', async ({ page }) => {
    await page.goto('/dev/workstation');
    // DASH-AC-06: no deceptively complete numeric total when a stop is missing.
    for (const id of ['open-risk', 'heat', 'coverage']) {
      await expect(
        page.getByTestId(`ws-risk-cell-${id}`).locator('.ws-risk-value'),
      ).toHaveText('Incomplete — 1 without a valid stop');
    }
  });

  test('default scenario: positions count and gross/net exposure render', async ({ page }) => {
    await page.goto('/dev/workstation');
    await expect(
      page.getByTestId('ws-risk-cell-positions').locator('.ws-risk-value'),
    ).toHaveText('3');
    await expect(
      page.getByTestId('ws-risk-cell-gross').locator('.ws-risk-value'),
    ).toContainText('$');
    await expect(
      page.getByTestId('ws-risk-cell-net').locator('.ws-risk-value'),
    ).toContainText('$');
  });

  test('zero-positions scenario shows zeroed complete risk metrics', async ({ page }) => {
    await page.goto('/dev/workstation?scenario=zero-positions');
    await expect(page.getByTestId('ws-panel-risk')).toBeVisible();

    // Open P&L is $0.00 (complete state → signed value).
    await expect(
      page.getByTestId('ws-risk-cell-open-pnl').locator('.ws-risk-value'),
    ).toHaveText('$0.00');
    await expect(
      page.getByTestId('ws-risk-cell-open-risk').locator('.ws-risk-value'),
    ).toHaveText('$0.00');
    await expect(
      page.getByTestId('ws-risk-cell-heat').locator('.ws-risk-value'),
    ).toHaveText('0.00%');
    await expect(
      page.getByTestId('ws-risk-cell-coverage').locator('.ws-risk-value'),
    ).toHaveText('0/0');
    // Journal trade count differs from account positions → sub-line appears.
    await expect(
      page.getByTestId('ws-risk-cell-positions').locator('.ws-risk-sub'),
    ).toContainText('journal');
  });

  test('large-drawdown: unavailable valuation and partial coverage render qualified labels', async ({ page }) => {
    await page.goto('/dev/workstation?scenario=large-drawdown');
    await expect(page.getByTestId('ws-panel-risk')).toBeVisible();

    await expect(
      page.getByTestId('ws-risk-cell-open-pnl').locator('.ws-risk-value'),
    ).toHaveText('— Unavailable — 2 unpriced');
    for (const id of ['open-risk', 'heat', 'coverage']) {
      await expect(
        page.getByTestId(`ws-risk-cell-${id}`).locator('.ws-risk-value'),
      ).toHaveText('Incomplete — 2 without a valid stop');
    }
  });

  test('Many-watchlist fixture: positions and risk panels render in the document flow', async ({ page }) => {
    await page.goto('/dev/workstation?scenario=many-watchlist');
    await expect(page.getByTestId('ws-positions-table')).toBeVisible();
    await expect(page.getByTestId('ws-panel-risk')).toBeVisible();
    await expect(
      page.getByTestId('ws-panel-risk').getByTestId('ws-risk-cell-open-pnl'),
    ).toBeVisible();

    // 3 positions (same as default).
    await expect(
      page.getByTestId('ws-positions-table').locator('tbody tr'),
    ).toHaveCount(3);

    // The default remains a page-scrolling document regardless of the
    // fixture's Watchlist data volume.
    const scroll = await page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
    }));
    expect(scroll.scrollHeight).toBeGreaterThan(scroll.clientHeight);
  });
});
// ═══════════════════════════════════════════════════════════════════════════
// S05: PerformancePanel — Tier 2 metric catalogue with Tier 3 gating
// ═══════════════════════════════════════════════════════════════════════════

test.describe('S05 PerformancePanel — Tier 2 catalogue and Tier 3 gating', () => {
  test('renders period-performance KPI rows with populated values', async ({ page }) => {
    await page.goto('/dev/workstation');
    const panel = page.getByTestId('ws-panel-performance');
    await expect(panel).toBeVisible();

    const kpis = panel.getByTestId('ws-performance-kpis');
    for (const label of ['Net P&L', 'Win Rate', 'Profit Factor', 'Avg R', 'Avg Win', 'Avg Loss', 'All Trades', 'Open Trades']) {
      await expect(kpis.getByText(label, { exact: true })).toBeVisible();
    }
    // Default fixture: 87 total trades, 3 open.
    await expect(kpis.getByTestId('ws-perf-total-trades')).toContainText('87');
    await expect(kpis.getByTestId('ws-perf-open-trades')).toContainText('3');
    // Values render (not placeholder dashes).
    await expect(kpis.getByTestId('ws-perf-net-pnl').locator('.ws-num')).not.toHaveText('—');
  });

  test('monthly performance table renders with 4 columns and 3 populated rows', async ({ page }) => {
    await page.goto('/dev/workstation');
    const section = page.getByTestId('ws-performance-monthly');
    await expect(section).toBeVisible();

    const headers = section.locator('thead th');
    await expect(headers).toHaveCount(4);
    await expect(headers.nth(0)).toHaveText('Month');
    await expect(headers.nth(1)).toHaveText('P&L');
    await expect(headers.nth(2)).toHaveText('Win%');
    await expect(headers.nth(3)).toHaveText('Trades');

    // Default scenario has 3 months (Apr–Jun 2026).
    const rows = section.locator('tbody tr');
    await expect(rows).toHaveCount(3);

    const firstRow = rows.first();
    await expect(firstRow.locator('td').nth(0)).toHaveText(/Apr|May|Jun/);
    await expect(firstRow.locator('td').nth(1)).toContainText('$');
    await expect(firstRow.locator('td').nth(2)).toContainText('%');
    await expect(firstRow.locator('td').nth(3)).toHaveText(/^\d+$/);
  });

  test('monthly table shows negative P&L with ws-neg class in large-drawdown', async ({ page }) => {
    await page.goto('/dev/workstation?scenario=large-drawdown');
    const section = page.getByTestId('ws-performance-monthly');
    await expect(section).toBeVisible();

    expect(await section.locator('tbody tr').count()).toBe(3);

    // All months in large-drawdown have negative P&L.
    const negCells = section.locator('tbody td.ws-num.ws-neg').first();
    await expect(negCells).toBeVisible();
    await expect(negCells).toContainText('-');
    await expect(negCells).toContainText('$');
  });

  test('R distribution renders all 8 bins with counts', async ({ page }) => {
    await page.goto('/dev/workstation');
    const section = page.getByTestId('ws-performance-r-dist');
    await expect(section).toBeVisible();

    for (const label of ['< -3', '-3 to -2', '-2 to -1', '-1 to 0', '0 to 1', '1 to 2', '2 to 3', '> 3']) {
      await expect(section.getByTestId(`ws-r-bin-${label}`)).toBeVisible();
    }
    // Default fixture: '-1 to 0' bin has 21 trades.
    await expect(section.getByTestId('ws-r-bin--1 to 0')).toContainText('21');
  });

  test('setup ranking renders top 3 setups with populated columns', async ({ page }) => {
    await page.goto('/dev/workstation');
    const section = page.getByTestId('ws-performance-setups');
    await expect(section).toBeVisible();

    const headers = section.locator('thead th');
    await expect(headers).toHaveCount(3);
    await expect(headers.nth(0)).toHaveText('Setup');
    await expect(headers.nth(1)).toHaveText('N');
    await expect(headers.nth(2)).toHaveText('Avg R');

    // Top 3 by count in default: breakout, pullback, reversal.
    const rows = section.locator('tbody tr');
    await expect(rows).toHaveCount(3);
    await expect(section.getByTestId('ws-setup-setup-breakout')).toContainText('Opening Range Breakout');
    await expect(section.getByTestId('ws-setup-setup-breakout')).toContainText('34');
    await expect(section.getByTestId('ws-setup-setup-pullback')).toContainText('Trend Pullback');
    await expect(section.getByTestId('ws-setup-setup-reversal')).toContainText('Exhaustion Reversal');
  });

  test('large-drawdown reorders setup ranking', async ({ page }) => {
    await page.goto('/dev/workstation?scenario=large-drawdown');
    const section = page.getByTestId('ws-performance-setups');
    await expect(section).toBeVisible();

    // Exhaustion Reversal leads in large-drawdown (count 31), not breakout.
    const firstRow = section.locator('tbody tr').first();
    await expect(firstRow).toContainText('Exhaustion Reversal');
    await expect(section.getByTestId('ws-setup-setup-reversal')).toContainText('31');
  });

  test('Tier 3 metrics are gated to Unavailable with prerequisite titles', async ({ page }) => {
    await page.goto('/dev/workstation');
    const section = page.getByTestId('ws-performance-tier3');
    await expect(section).toBeVisible();

    for (const [testId, prerequisite] of [
      ['ws-tier3-mae-mfe', 'intratrade price history'],
      ['ws-tier3-sharpe-sortino', 'documented return series'],
      ['ws-tier3-risk-of-ruin', 'approved statistical model'],
      ['ws-tier3-pips-points', 'asset-specific unit definitions'],
    ] as const) {
      const row = section.getByTestId(testId);
      await expect(row).toContainText('Unavailable');
      const title = await row.locator('.ws-num').getAttribute('title');
      expect(title).toContain(prerequisite);
    }
  });

  test('renders across all 4 scenarios without console errors', async ({ page }) => {
    const { consoleErrors, pageErrors } = watchForErrors(page);

    for (const scenario of ['default', 'zero-positions', 'large-drawdown', 'many-watchlist']) {
      await page.goto(`/dev/workstation?scenario=${scenario}`);
      await expect(page.getByTestId('ws-panel-performance')).toBeVisible();
      await expect(page.getByTestId('ws-performance-tier3')).toBeVisible();
    }

    expect(pageErrors, 'uncaught page errors').toEqual([]);
    expect(consoleErrors, 'console.error output').toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// S05: ProcessReviewPanel — discipline metrics and attention items
// ═══════════════════════════════════════════════════════════════════════════

test.describe('S05 ProcessReviewPanel — discipline metrics and attention items', () => {
  test('renders process score distribution with all 5 grade bins', async ({ page }) => {
    await page.goto('/dev/workstation');
    const panel = page.getByTestId('ws-panel-process-review');
    await expect(panel).toBeVisible();

    const scoreDist = panel.getByTestId('ws-process-score-dist');
    await expect(scoreDist.locator('[data-testid="ws-process-score-row"]')).toHaveCount(5);
    // Default fixture: B (48-53) bin has the highest count (31).
    await expect(scoreDist.getByText('B (48-53)')).toBeVisible();
  });

  test('renders directional performance with long and short blocks', async ({ page }) => {
    await page.goto('/dev/workstation');
    const panel = page.getByTestId('ws-panel-process-review');

    const longBlock = panel.getByTestId('ws-dir-perf-long');
    await expect(longBlock.getByText('Long', { exact: true })).toBeVisible();
    await expect(longBlock.getByText('71', { exact: true })).toBeVisible(); // default long trade count

    const shortBlock = panel.getByTestId('ws-dir-perf-short');
    await expect(shortBlock.getByText('Short', { exact: true })).toBeVisible();
    await expect(shortBlock.getByText('13', { exact: true })).toBeVisible(); // default short trade count
  });

  test('attention items render with severity badges', async ({ page }) => {
    await page.goto('/dev/workstation');
    const panel = page.getByTestId('ws-panel-process-review');
    const items = panel.getByTestId('ws-attention-items');

    // Default fixture: best_day (info) + oversizing (warning).
    await expect(items.locator('.ws-attention-item').first()).toBeVisible();
    await expect(items.getByTestId('ws-severity-info').first()).toHaveText('INFO');
    await expect(items.getByTestId('ws-severity-warning').first()).toHaveText('WARN');
    await expect(items.getByTestId('ws-attention-item-0')).toBeVisible();
  });

  test('large-drawdown scenario shows critical severity insight', async ({ page }) => {
    await page.goto('/dev/workstation?scenario=large-drawdown');
    const items = page.getByTestId('ws-attention-items');
    await expect(items).toBeVisible();

    const critBadge = items.getByTestId('ws-severity-critical').first();
    await expect(critBadge).toBeVisible();
    await expect(critBadge).toHaveText('CRIT');
    await expect(items.getByTestId('ws-severity-warning').first()).toHaveText('WARN');
  });

  test('zero-positions scenario keeps historical discipline and insights', async ({ page }) => {
    await page.goto('/dev/workstation?scenario=zero-positions');
    await expect(page.getByTestId('ws-grid')).toBeVisible();

    // Historical catalogue persists — not position-dependent.
    await expect(page.getByTestId('ws-performance-setups')).toBeVisible();
    await expect(page.getByTestId('ws-process-score-dist')).toBeVisible();
    await expect(page.getByTestId('ws-attention-items')).toBeVisible();
    await expect(page.getByTestId('ws-panel-account-state')).toBeVisible();
  });

  test('overview and review panels follow the document flow at 1440x900', async ({ page }) => {
    await page.goto('/dev/workstation');
    for (const testId of ['ws-panel-account-state', 'ws-panel-performance', 'ws-panel-process-review']) {
      const panel = page.getByTestId(testId);
      await expect(panel).toBeVisible();
      const box = await panel.boundingBox();
      expect(box, `${testId} has layout box`).not.toBeNull();
      expect(box!.x, `${testId} inside left edge`).toBeGreaterThanOrEqual(0);
      expect(box!.y, `${testId} inside top edge`).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, `${testId} inside right edge`).toBeLessThanOrEqual(1440);
    }

    const scroll = await page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
    }));
    expect(scroll.scrollHeight).toBeGreaterThan(scroll.clientHeight);
  });

  test('no console errors or page errors across all 4 scenarios', async ({ page }) => {
    const { consoleErrors, pageErrors } = watchForErrors(page);

    await page.goto('/dev/workstation');
    await expect(page.getByTestId('ws-panel-process-review')).toBeVisible();
    await page.getByTestId('ws-scenario-select').selectOption('zero-positions');
    await expect(page.getByTestId('ws-performance-setups')).toBeVisible();
    await page.getByTestId('ws-scenario-select').selectOption('large-drawdown');
    await expect(page.getByTestId('ws-attention-items')).toBeVisible();
    await page.getByTestId('ws-scenario-select').selectOption('many-watchlist');
    await expect(page.getByTestId('ws-panel-performance')).toBeVisible();

    expect(pageErrors, 'uncaught page errors').toEqual([]);
    expect(consoleErrors, 'console.error output').toEqual([]);
  });

  test('screenshot evidence at 1440x900 for S05 panels', async ({ page }, testInfo) => {
    await page.goto('/dev/workstation');
    await expect(page.getByTestId('ws-grid')).toBeVisible();
    await expect(page.getByTestId('ws-fixture-badge')).toBeVisible();
    await expect(page.getByTestId('ws-panel-account-state')).toBeVisible();
    await expect(page.getByTestId('ws-panel-performance')).toBeVisible();
    await expect(page.getByTestId('ws-panel-process-review')).toBeVisible();

    const shot = await page.screenshot({ fullPage: false });
    await testInfo.attach('s05-panels-1440x900.png', {
      body: shot,
      contentType: 'image/png',
    });

    // Also capture large-drawdown for negative-data evidence.
    await page.getByTestId('ws-scenario-select').selectOption('large-drawdown');
    await expect(page.getByTestId('ws-severity-critical').first()).toBeVisible();
    const drawdownShot = await page.screenshot({ fullPage: false });
    await testInfo.attach('s05-large-drawdown-1440x900.png', {
      body: drawdownShot,
      contentType: 'image/png',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════
// S05: AccountStatePanel — §6.7 unambiguous labels
// ═══════════════════════════════════════════════════════════════════════════

test.describe('S05 AccountStatePanel — §6.7 unambiguous labels', () => {
  test('renders Cash with effective time from provenance asOf', async ({ page }) => {
    await page.goto('/dev/workstation');
    const panel = page.getByTestId('ws-panel-account-state');
    await expect(panel).toBeVisible();

    const cash = panel.getByTestId('ws-account-state-cash');
    await expect(cash.getByText('Cash', { exact: true })).toBeVisible();
    await expect(cash.locator('.ws-num')).toContainText('$');
    // Effective-time sub-line renders a date/time (not a placeholder).
    await expect(cash.locator('.ws-mono')).not.toHaveText('—');
  });

  test('NAV and marked positions inherit valuation completeness qualification', async ({ page }) => {
    await page.goto('/dev/workstation?scenario=dash-ac-02-partial');
    const panel = page.getByTestId('ws-panel-account-state');

    // The partial-valuation scenario uses qualified, rather than deceptively
    // complete, NAV and marked-position values.
    await expect(panel.getByTestId('ws-account-state-nav')).toContainText('Partial');
    await expect(panel.getByTestId('ws-account-state-marked')).toContainText('Partial valuation');

    // Header meta declares the raw valuation state.
    await expect(panel.locator('.ws-panel-header')).toContainText('partial');
  });

  test('scoped Realized / Unrealized / Total P&L rows render', async ({ page }) => {
    await page.goto('/dev/workstation');
    const panel = page.getByTestId('ws-panel-account-state');

    for (const testId of ['ws-account-state-realized', 'ws-account-state-unrealized', 'ws-account-state-total']) {
      const row = panel.getByTestId(testId);
      await expect(row).toBeVisible();
      await expect(row.locator('.ws-num')).toContainText('$');
    }
    // Realized is scoped to closed positions.
    await expect(panel.getByTestId('ws-account-state-realized')).toContainText('Closed positions');
  });

  test('drawdown is always negative-coloured and never positive', async ({ page }) => {
    await page.goto('/dev/workstation');
    const panel = page.getByTestId('ws-panel-account-state');

    const dd = panel.getByTestId('ws-account-state-drawdown');
    await expect(dd.locator('.ws-num.ws-neg')).toBeVisible();
    await expect(dd.locator('.ws-num.ws-neg')).toContainText('-');

    // Compact 'Current drawdown' row is also negative-coloured.
    const summary = panel.getByTestId('ws-account-state-dd-summary');
    await expect(summary.locator('.ws-num.ws-neg')).toBeVisible();
  });

  test('equity chart renders ECharts canvas inside account state panel', async ({ page }) => {
    await page.goto('/dev/workstation');
    const panel = page.getByTestId('ws-panel-account-state');

    const chartContainer = panel.getByTestId('ws-equity-chart');
    await expect(chartContainer).toBeVisible();
    await expect(chartContainer.locator('canvas')).toBeVisible();

    // Empty state must not render when equityCurve has data (all scenarios have data).
    await expect(page.getByTestId('ws-equity-chart-empty')).toHaveCount(0);
  });

  test('chart re-renders after scenario switch without console errors', async ({ page }) => {
    const { consoleErrors, pageErrors } = watchForErrors(page);
    await page.goto('/dev/workstation');
    await expect(page.getByTestId('ws-panel-account-state').getByTestId('ws-equity-chart')).toBeVisible();

    // Switch to large-drawdown: chart and canvas re-render.
    await page.getByTestId('ws-scenario-select').selectOption('large-drawdown');
    await expect(page.getByTestId('ws-panel-account-state').getByTestId('ws-equity-chart')).toBeVisible();
    await expect(page.getByTestId('ws-panel-account-state').getByTestId('ws-equity-chart').locator('canvas')).toBeVisible();

    expect(pageErrors, 'uncaught page errors after scenario switch').toEqual([]);
    expect(consoleErrors, 'console.error after scenario switch').toEqual([]);
  });

  test('renders across all 4 fixture scenarios', async ({ page }) => {
    for (const scenario of ['default', 'zero-positions', 'large-drawdown', 'many-watchlist']) {
      await page.goto(`/dev/workstation?scenario=${scenario}`);
      await expect(page.getByTestId('ws-grid')).toBeVisible();
      const panel = page.getByTestId('ws-panel-account-state');
      await expect(panel).toBeVisible();
      await expect(panel.getByTestId('ws-equity-chart')).toBeVisible();
      await expect(panel.getByTestId('ws-account-state-drawdown')).toBeVisible();
    }
  });
});
