/**
 * M016 S07 T01 — DASH-AC acceptance scenarios in a populated browser.
 *
 * Exercises all ten DASH-AC acceptance scenarios (requirements §9) against
 * the deterministic /dev/workstation fixture harness and asserts the visible
 * UI state, per the §11 release gate: "targeted browser tests with realistic
 * populated fixtures/data for the ten acceptance scenarios".
 *
 * Scenario → fixture mapping:
 *   DASH-AC-01  → dash-ac-01-healthy (new): all positions fresh + valid stops
 *   DASH-AC-02  → dash-ac-02-partial (new): one missing mark; two marked rows
 *                 total exactly +$10.94 (the +$10.94 partial-total defect)
 *   DASH-AC-03  → default: 3 open account positions · 2 open journal trades;
 *                 account-only position visibly attributed; reconciliation
 *                 provenance complete (no journal-divergence alert)
 *   DASH-AC-04  → default: journal-linked FIFO/fees/partial-exit values match
 *                 the positions table (avg cost / remaining qty) and no
 *                 journal-divergence alert renders (exact comparison statuses
 *                 are covered by dashboard-journal-linked unit tests)
 *   DASH-AC-05  → default: TSLA price exists but is stale → explicit
 *                 'Stale · source · as-of' row text + qualified aggregate
 *   DASH-AC-06  → default: TSLA has no valid stop → 'No valid stop' +
 *                 'Incomplete — 1 without a valid stop' coverage labels
 *   DASH-AC-07  → zero-positions: compact no-position state, $0.00 current
 *                 Open P&L, 0/0 coverage, no stale indicators, no live-mark
 *                 polling claim
 *   DASH-AC-08  → default: period-performance metrics update while current
 *                 positions/risk/Open P&L retain their current-state scope.
 *                 NOTE: the fixture harness ships no interactive period
 *                 selector (period controls live on the legacy live surface);
 *                 scenario switching is the deterministic stand-in that
 *                 changes period data while current-state cells keep scope.
 *   DASH-AC-09  → default: saved-view layout changes persist only in the
 *                 saved view; returning to Risk & Positions restores the
 *                 immutable default; normal mode has no editing chrome.
 *                 (Full user-view CRUD/persistence is e2e/workstation-views.)
 *   DASH-AC-10  → default at 2560×1440 and effective 1536×960: first screen
 *                 shows command/state bar, material alert, risk summary, and
 *                 a usable open-position table without clipped columns.
 *
 * Run: npx playwright test e2e/dash-acceptance.spec.ts --project=chromium
 */

import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 2560, height: 1440 } });

/** Collect console errors + page errors for audit assertions. */
function watchForErrors(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  return { consoleErrors, pageErrors };
}

// ── DASH-AC-01: healthy baseline — all fresh marks + all valid stops ────

test('DASH-AC-01: all positions fresh with valid stops — complete current values with source/as-of', async ({
  page,
}, testInfo) => {
  const { consoleErrors, pageErrors } = watchForErrors(page);
  await page.goto('/dev/workstation?scenario=dash-ac-01-healthy');
  await expect(page.getByTestId('ws-grid')).toBeVisible();

  // Risk band: complete valuation → normal signed Open P&L total, not a label.
  const openPnl = page.getByTestId('ws-risk-cell-open-pnl');
  await expect(openPnl.locator('.ws-risk-value')).toHaveText('$841.35');
  // No marked-subset sub-line in the complete state.
  await expect(openPnl.locator('.ws-risk-sub')).toHaveCount(0);

  // Stop coverage complete 3/3; header meta declares current state.
  await expect(
    page.getByTestId('ws-risk-cell-coverage').locator('.ws-risk-value'),
  ).toHaveText('3/3');
  await expect(
    page.getByTestId('ws-panel-risk').locator('.ws-panel-meta'),
  ).toHaveText('current · complete coverage');

  // R032: four distinct risk labels with distinct aggregates — Initial risk
  // (sum of initialRiskAmount, riskSummary.openRisk) is never conflated with
  // Open risk (sum of current risk to stop, riskSummary.openRiskToStop).
  await expect(
    page.getByTestId('ws-risk-cell-initial-risk').locator('.ws-risk-label'),
  ).toHaveText('Initial risk');
  await expect(
    page.getByTestId('ws-risk-cell-initial-risk').locator('.ws-risk-value'),
  ).toHaveText('$1,450.00');
  await expect(
    page.getByTestId('ws-risk-cell-open-risk').locator('.ws-risk-label'),
  ).toHaveText('Open risk');
  await expect(
    page.getByTestId('ws-risk-cell-open-risk').locator('.ws-risk-value'),
  ).toHaveText('$783.35');
  await expect(
    page.getByTestId('ws-risk-cell-heat').locator('.ws-risk-value'),
  ).toHaveText('2.80%');
  // Per-position label 'Current risk to stop' renders in the table header.
  await expect(
    page.getByTestId('ws-positions-table').getByText('Current risk to stop'),
  ).toBeVisible();

  // Positions table: three rows, all fresh, no stale/missing indicators.
  const rows = page.getByTestId('ws-positions-table').locator('tbody tr');
  await expect(rows).toHaveCount(3);
  for (const symbol of ['NVDA', 'AMD', 'TSLA']) {
    const row = page.getByTestId(`ws-position-row-${symbol}`);
    await expect(row).toBeVisible();
    await expect(row.getByTestId('ws-mark-stale-indicator')).toHaveCount(0);
    await expect(row).not.toContainText('Unpriced');
    await expect(row).not.toContainText('No valid stop');
  }

  // Account state: NAV qualifies as Full (complete valuation).
  await expect(page.getByTestId('ws-account-state-nav')).toContainText('Full');

  // Healthy integrity: no data-quality alert strip at all.
  await expect(page.getByTestId('ws-data-quality-alert-strip')).toHaveCount(0);

  await testInfo.attach('dash-ac-01-healthy.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });

  expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
});

// ── DASH-AC-02: the +$10.94 partial-total defect is visibly impossible ──

test('DASH-AC-02: primary Open P&L is the qualified label, not +$10.94', async ({
  page,
}, testInfo) => {
  const { consoleErrors, pageErrors } = watchForErrors(page);
  await page.goto('/dev/workstation?scenario=dash-ac-02-partial');
  await expect(page.getByTestId('ws-grid')).toBeVisible();

  // The primary value is the qualified label — never the marked subset total.
  const openPnl = page.getByTestId('ws-risk-cell-open-pnl');
  await expect(openPnl.locator('.ws-risk-value')).toHaveText(
    '— Partial — 1 unpriced',
  );
  await expect(openPnl.locator('.ws-risk-value')).not.toContainText('10.94');
  // The known marked-subset amount is subordinate and explicitly labelled.
  await expect(openPnl.locator('.ws-risk-sub')).toHaveText('Marked subset $10.94');

  // Positions table: two marked rows (+$10.74, +$0.20) and one Unpriced row.
  const rows = page.getByTestId('ws-positions-table').locator('tbody tr');
  await expect(rows).toHaveCount(3);
  await expect(
    page.getByTestId('ws-position-row-VCTR').getByTestId('ws-position-cell-pnl'),
  ).toHaveText('$10.74');
  await expect(
    page.getByTestId('ws-position-row-AMRX').getByTestId('ws-position-cell-pnl'),
  ).toHaveText('$0.20');
  const cakeRow = page.getByTestId('ws-position-row-CAKE');
  await expect(cakeRow).toContainText('Unpriced');
  await expect(cakeRow).toContainText('Missing mark');
  await expect(cakeRow.getByTestId('ws-position-cell-pnl')).toHaveText('—');

  // The valuation alert carries the same qualified label (never a total).
  const alert = page.getByTestId('ws-dq-alert-valuation');
  await expect(alert).toBeVisible();
  await expect(alert.getByTestId('ws-dq-state-valuation')).toHaveText('partial');
  await expect(alert.getByTestId('ws-dq-label-valuation')).toHaveText(
    '— Partial — 1 unpriced',
  );

  await testInfo.attach('dash-ac-02-partial-defect.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });

  expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
});

// ── DASH-AC-03: journal trades vs account-only attribution ──────────────

test('DASH-AC-03: 3 open account positions · 2 open journal trades with visible attribution', async ({
  page,
}) => {
  await page.goto('/dev/workstation'); // default scenario
  await expect(page.getByTestId('ws-grid')).toBeVisible();

  // The dashboard states the account-position count and the journal-trade
  // count as a sub-line when they differ.
  const positionsCell = page.getByTestId('ws-risk-cell-positions');
  await expect(positionsCell.locator('.ws-risk-value')).toHaveText('3');
  await expect(positionsCell.locator('.ws-risk-sub')).toHaveText('2 journal trades');

  // The account-only position is visibly attributed, not silently included
  // in journal performance.
  await expect(
    page.getByTestId('ws-position-row-TSLA').locator('td').nth(1),
  ).toHaveText('Account only');
  await expect(
    page.getByTestId('ws-position-row-NVDA').locator('td').nth(1),
  ).toContainText('Journal');
  await expect(
    page.getByTestId('ws-position-row-AMD').locator('td').nth(1),
  ).toContainText('Mixed');

  // Journal reconciliation provenance is complete → no divergence alert.
  await expect(page.getByTestId('ws-dq-alert-journal-linked')).toHaveCount(0);
});

// ── DASH-AC-04: journal-linked FIFO / fees / partial exit ───────────────

test('DASH-AC-04: journal-linked positions render values matching the Trades kernel', async ({
  page,
}) => {
  await page.goto('/dev/workstation'); // default scenario
  await expect(page.getByTestId('ws-grid')).toBeVisible();

  // Remaining quantity + average cost per journal-linked position (the same
  // kernel the Trades list/detail uses; comparison statuses are asserted at
  // the unit level in dashboard-journal-linked tests).
  const nvda = page.getByTestId('ws-position-row-NVDA');
  await expect(nvda.getByTestId('ws-position-cell-side')).toHaveText('L 120');
  await expect(nvda.locator('td').nth(3)).toContainText('$128.40');
  const amd = page.getByTestId('ws-position-row-AMD');
  await expect(amd.getByTestId('ws-position-cell-side')).toHaveText('L 80');
  await expect(amd.locator('td').nth(3)).toContainText('$112.10');

  // No journal divergence surfaces anywhere in the data-quality strip.
  await expect(page.getByTestId('ws-dq-alert-journal-linked')).toHaveCount(0);
});

// ── DASH-AC-05: stale price fails freshness policy ──────────────────────

test('DASH-AC-05: stale mark renders explicit Stale state with source/as-of and a qualified aggregate', async ({
  page,
}) => {
  await page.goto('/dev/workstation'); // default scenario
  await expect(page.getByTestId('ws-grid')).toBeVisible();

  // The stale row carries visible text — never a dot-only signal.
  const tslaMarkState = page
    .getByTestId('ws-position-row-TSLA')
    .getByTestId('ws-position-cell-mark-state');
  await expect(tslaMarkState).toContainText('Stale');
  await expect(tslaMarkState).toContainText('user');
  await expect(tslaMarkState).toContainText('UTC');
  await expect(
    page.getByTestId('ws-position-row-TSLA').getByTestId('ws-mark-stale-indicator'),
  ).toBeVisible();

  // No fully current aggregate presentation remains: Open P&L is qualified.
  await expect(
    page.getByTestId('ws-risk-cell-open-pnl').locator('.ws-risk-value'),
  ).toHaveText('— Partial — 1 unpriced');
  await expect(page.getByTestId('ws-account-state-nav')).toContainText('Partial');
});

// ── DASH-AC-06: one open position without a valid stop ──────────────────

test('DASH-AC-06: no valid stop renders Incomplete coverage, never a deceptive total', async ({
  page,
}) => {
  await page.goto('/dev/workstation'); // default scenario
  await expect(page.getByTestId('ws-grid')).toBeVisible();

  // The row says it explicitly.
  await expect(page.getByTestId('ws-position-row-TSLA')).toContainText('No valid stop');
  await expect(
    page.getByTestId('ws-position-row-TSLA').getByTestId('ws-position-cell-risk'),
  ).toHaveText('Incomplete');

  // Risk band: open risk / heat / coverage all carry the qualified label.
  for (const id of ['open-risk', 'heat', 'coverage']) {
    await expect(
      page.getByTestId(`ws-risk-cell-${id}`).locator('.ws-risk-value'),
    ).toHaveText('Incomplete — 1 without a valid stop');
  }

  // R032 distinct meanings: Initial risk is snapshot-derived and historical,
  // so it stays visible while the current-risk aggregates are qualified.
  await expect(
    page.getByTestId('ws-risk-cell-initial-risk').locator('.ws-risk-value'),
  ).toHaveText('$1,450.00');
});

// ── DASH-AC-07: no non-flat account positions ───────────────────────────

test('DASH-AC-07: flat account shows compact no-position state with $0.00 current Open P&L', async ({
  page,
}) => {
  await page.goto('/dev/workstation?scenario=zero-positions');
  await expect(page.getByTestId('ws-grid')).toBeVisible();

  // Compact empty state — not a large inert pane.
  await expect(page.getByTestId('ws-positions-empty')).toBeVisible();
  await expect(page.getByTestId('ws-positions-empty')).toHaveText(
    'No open account positions',
  );
  await expect(page.getByTestId('ws-positions-table')).toHaveCount(0);

  // Current Open P&L is $0.00; no price coverage implied.
  await expect(
    page.getByTestId('ws-risk-cell-open-pnl').locator('.ws-risk-value'),
  ).toHaveText('$0.00');
  await expect(
    page.getByTestId('ws-risk-cell-coverage').locator('.ws-risk-value'),
  ).toHaveText('0/0');

  // No mark-state indicators anywhere (no live-mark polling claim).
  await expect(page.getByTestId('ws-mark-stale-indicator')).toHaveCount(0);
});

// ── DASH-AC-08: retrospective period change keeps current-state scope ───

test('DASH-AC-08: period-performance metrics update while current-state cells retain scope', async ({
  page,
}) => {
  // The fixture harness signals hydration via the FIXTURE MODE console.warn
  // (client effect). Waiting for it before driving the scenario select avoids
  // racing React hydration (see workstation-shell.spec.ts pattern).
  const warnings: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'warning') warnings.push(msg.text());
  });
  await page.goto('/dev/workstation'); // default scenario
  await expect(page.getByTestId('ws-grid')).toBeVisible();
  await expect
    .poll(() => warnings.some((w) => w.includes('[workstation] FIXTURE MODE')), {
      timeout: 10_000,
    })
    .toBe(true);

  const netPnl = page.getByTestId('ws-perf-net-pnl').locator('.ws-num');
  const defaultNetPnl = await netPnl.textContent();

  // Switch the retrospective period data (fixture stand-in): period metrics
  // update, current positions/risk/Open P&L keep their current-state scope.
  await page.getByTestId('ws-scenario-select').selectOption('large-drawdown');
  await expect(page.getByTestId('ws-panel-performance')).toBeVisible();
  // Auto-retrying: the KPI text must change after the scenario switch.
  await expect(netPnl).not.toHaveText(defaultNetPnl ?? '');

  // Current-state cells did not disappear or become period-filtered.
  await expect(
    page.getByTestId('ws-risk-cell-positions').locator('.ws-risk-value'),
  ).toHaveText('2');
  await expect(
    page.getByTestId('ws-risk-cell-open-pnl').locator('.ws-risk-value'),
  ).toHaveText('— Unavailable — 2 unpriced');
  await expect(page.getByTestId('ws-positions-table')).toBeVisible();
});

// ── DASH-AC-09: saved Performance view vs normal Risk & Positions ───────

test('DASH-AC-09: saved-view layout changes are view-scoped; normal mode has no editing chrome', async ({
  page,
}) => {
  await page.goto('/dev/workstation');
  await expect(page.getByTestId('ws-grid')).toBeVisible();

  // Normal mode: no customize bar, no hide overlays, no per-cell wrappers.
  await expect(page.getByTestId('ws-customize-bar')).toHaveCount(0);
  await expect(page.getByTestId('ws-customize-hide-watchlist')).toHaveCount(0);
  await expect(page.getByTestId('ws-customize-cell-watchlist')).toHaveCount(0);

  // Switch to the Performance view: layout changes (watchlist leaves grid).
  const trigger = page.getByTestId('ws-view-switcher-trigger');
  await trigger.click();
  await expect(page.getByTestId('ws-view-switcher-content')).toBeVisible();
  await page.getByTestId('ws-view-item-ws-system-performance').click();
  await expect(page.getByTestId('ws-view-switcher-content')).toHaveCount(0);
  await expect(page.getByTestId('ws-view-switcher-current-name')).toHaveText(
    'Performance',
  );
  await expect(page.getByTestId('ws-panel-performance')).toBeVisible();
  await expect(page.getByTestId('ws-panel-watchlist')).toHaveCount(0);

  // Fixed safety/data-quality panels remain in every view.
  await expect(page.getByTestId('ws-panel-risk')).toBeVisible();
  await expect(page.getByTestId('ws-panel-positions')).toBeVisible();
  await expect(page.getByTestId('ws-data-quality-alert-strip')).toBeVisible();

  // Returning to normal Risk & Positions restores the immutable default.
  await trigger.click();
  await expect(page.getByTestId('ws-view-switcher-content')).toBeVisible();
  await page.getByTestId('ws-view-item-ws-system-risk-positions').click();
  await expect(page.getByTestId('ws-view-switcher-content')).toHaveCount(0);
  await expect(page.getByTestId('ws-view-switcher-current-name')).toHaveText(
    'Risk & Positions',
  );
  await expect(page.getByTestId('ws-panel-watchlist')).toBeVisible();
  await expect(page.getByTestId('ws-customize-bar')).toHaveCount(0);
});

// ── DASH-AC-10: both target viewports with realistic populated data ─────

test('DASH-AC-10: first screen usable at 2560×1440 with populated data', async ({
  page,
}, testInfo) => {
  const { consoleErrors, pageErrors } = watchForErrors(page);
  await page.goto('/dev/workstation'); // default — populated + material alerts
  await expect(page.getByTestId('ws-grid')).toBeVisible();

  // Command/state bar, material alert, risk summary, usable positions table.
  await expect(page.getByTestId('ws-toolbar')).toBeVisible();
  await expect(page.getByTestId('ws-data-quality-alert-strip')).toBeVisible();
  await expect(page.getByTestId('ws-panel-risk')).toBeVisible();
  const table = page.getByTestId('ws-positions-table');
  await expect(table).toBeVisible();
  await expect(table.locator('tbody tr')).toHaveCount(3);

  // All 9 critical columns are rendered and inside the viewport width.
  const headers = table.locator('thead th');
  await expect(headers).toHaveCount(9);
  const tableBox = await table.boundingBox();
  expect(tableBox).not.toBeNull();
  expect(tableBox!.x).toBeGreaterThanOrEqual(0);
  expect(tableBox!.x + tableBox!.width).toBeLessThanOrEqual(2560);

  // No horizontal overflow on the surface.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(overflow).toBe(false);

  await testInfo.attach('dash-ac-10-2560x1440.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });

  expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
});

test('DASH-AC-10: first screen usable at effective 1536×960 with populated data', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1536, height: 960 });
  await page.goto('/dev/workstation');
  await expect(page.getByTestId('ws-grid')).toBeVisible();

  await expect(page.getByTestId('ws-toolbar')).toBeVisible();
  await expect(page.getByTestId('ws-data-quality-alert-strip')).toBeVisible();
  await expect(page.getByTestId('ws-panel-risk')).toBeVisible();
  const table = page.getByTestId('ws-positions-table');
  await expect(table).toBeVisible();
  await expect(table.locator('tbody tr')).toHaveCount(3);

  const headers = table.locator('thead th');
  await expect(headers).toHaveCount(9);
  const tableBox = await table.boundingBox();
  expect(tableBox).not.toBeNull();
  expect(tableBox!.x).toBeGreaterThanOrEqual(0);
  expect(tableBox!.x + tableBox!.width).toBeLessThanOrEqual(1536);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(overflow).toBe(false);

  await testInfo.attach('dash-ac-10-1536x960.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});
