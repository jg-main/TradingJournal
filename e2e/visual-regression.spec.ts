/**
 * M005 S07 T03 — Playwright Visual Regression Baselines
 *
 * Captures visual baselines at 1440×900 for both workstation contexts:
 * 1. Production root (/) — live workstation inside the application shell
 * 2. Development harness (/dev/workstation) — all 4 fixture scenarios
 *
 * These baselines serve as automated visual diff detection for future
 * UI changes. When run with `--update-snapshots`, they overwrite the
 * current baselines.
 *
 * Visual assertions use Playwright's `toHaveScreenshot()` API.
 * Baselines live in e2e/__snapshots__/ (git-tracked).
 *
 * Viewport: 1440×900 as specified by the slice plan.
 */

import { test, expect } from '@playwright/test';

// ── Helpers ──────────────────────────────────────────────────────────

function captureConsoleErrors(page: import('@playwright/test').Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });
  return errors;
}

function assertNoConsoleErrors(errors: string[]): void {
  const actualErrors = errors.filter(
    (e) =>
      !e.includes('Failed to load resource') &&
      !e.includes('ERR_BLOCKED_BY_CLIENT') &&
      !e.includes('favicon.ico'),
  );
  expect(actualErrors).toEqual([]);
}

// ── Fixture Scenarios ───────────────────────────────────────────────

const WORKSTATION_SCENARIOS = [
  { id: 'default', label: 'default-scenario' },
  { id: 'zero-positions', label: 'zero-positions-scenario' },
  { id: 'large-drawdown', label: 'large-drawdown-scenario' },
  { id: 'many-watchlist', label: 'many-watchlist-scenario' },
] as const;

// ── Viewport ────────────────────────────────────────────────────────

const VIEWPORT = { width: 1440, height: 900 };

// ECharts axis glyph rasterization can vary by a few hundred pixels under
// parallel browser load without changing chart geometry.
const CHART_RASTERIZATION_MAX_DIFF_PIXELS = 300;

async function prepareProductionWorkstation(page: import('@playwright/test').Page): Promise<void> {
  const response = await page.request.post('/api/accounts', {
    data: {
      name: 'Visual Baseline Account',
      broker: 'Visual Regression',
      currency: 'USD',
    },
  });
  expect(response.status()).toBe(201);
  const account = await response.json() as { id: string };
  const settings = await page.request.put('/api/settings', {
    data: {
      defaultAccountId: account.id,
      startingAccountValue: 50000,
    },
  });
  expect(settings.ok()).toBeTruthy();
  const activate = await page.request.put(`/api/accounts/${account.id}`, {
    data: { isActive: true },
  });
  expect(activate.ok()).toBeTruthy();
  await page.addInitScript((accountId) => {
    localStorage.setItem('app:account', accountId);
  }, account.id);
}

async function waitForProductionWorkstation(page: import('@playwright/test').Page): Promise<void> {
  await expect(page.getByTestId('ws-external-account')).toHaveText(
    'Visual Baseline Account',
    { timeout: 15_000 },
  );
  // Live snapshot rendered: the Account State panel shows NAV with a
  // valuation qualification (Full / Partial / Ledger only). The legacy
  // 'Account Value' KPI with a fixed starting value moved out of the bottom
  // KPI strip, so we wait on the qualified NAV row instead of a dollar figure.
  const nav = page
    .getByTestId('ws-panel-account-state')
    .getByTestId('ws-account-state-nav');
  await expect(nav).toContainText('NAV');
  await expect(nav).toContainText(/Full|Partial|Ledger only/);
}

// ── Tests ───────────────────────────────────────────────────────────

test.describe('Visual Regression Baselines', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Tracked visual baselines use Chromium; functional specs cover every browser.');
    await page.setViewportSize(VIEWPORT);
  });

  // ── Production workstation root ──────────────────────────────────

  test('production workstation renders with the application shell at 1440x900', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    await prepareProductionWorkstation(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await waitForProductionWorkstation(page);
    // Allow ECharts and other chart libraries to finish painting
    await page.waitForTimeout(500);

    await expect(page.locator('aside').first()).toBeVisible();
    await expect(page.getByTestId('ws-live-badge')).toBeVisible();
    await expect(page.getByTestId('ws-grid')).toBeVisible();
    await expect(page.getByText('Net P&L').first()).toBeVisible();
    await expect(page.getByTestId('ws-scenario-select')).toHaveCount(0);

    // Visual baseline — full viewport screenshot
    await expect(page).toHaveScreenshot('production-workstation-1440x900.png', {
      fullPage: false,
      threshold: 0.3,
      // Font/chart antialiasing can shift a few dozen pixels under full-suite
      // load. Keep tolerance below 0.01% of this 1.3M-pixel viewport.
      maxDiffPixels: 100,
    });

    assertNoConsoleErrors(errors);
  });

  test('production workstation full-page layout at 1440x900', async ({ page }) => {
    await prepareProductionWorkstation(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await waitForProductionWorkstation(page);
    await page.waitForTimeout(500);

    // Full-page visual baseline (entire scrollable content)
    await expect(page).toHaveScreenshot('production-workstation-fullpage-1440x900.png', {
      fullPage: true,
      threshold: 0.3,
      maxDiffPixels: 100,
    });
  });

  // ── Workstation Scenarios ─────────────────────────────────────────

  for (const { id, label } of WORKSTATION_SCENARIOS) {
    test(`workstation ${label} renders correctly at 1440x900`, async ({ page }) => {
      const errors = captureConsoleErrors(page);

      await page.goto(`/dev/workstation?scenario=${id}`);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1500);

      // Toolbar should be visible
      await expect(page.getByTestId('ws-toolbar')).toBeVisible();

      // The curated Risk & Positions grid keeps Watchlist out of the default
      // setup while retaining the operational review panels.
      await expect(page.getByTestId('ws-panel-kpis')).toBeVisible();
      await expect(page.getByTestId('ws-panel-account-state')).toBeVisible();
      await expect(page.getByTestId('ws-panel-positions')).toBeVisible();
      await expect(page.getByTestId('ws-panel-watchlist')).toHaveCount(0);
      await expect(page.getByTestId('ws-panel-risk')).toBeVisible();
      await expect(page.getByTestId('ws-panel-process-review')).toBeVisible();
      await expect(page.getByTestId('ws-panel-performance')).toBeVisible();

      // Full-page baseline captures the document-scroll workflow.
      await expect(page).toHaveScreenshot(`workstation-${id}-1440x900.png`, {
        fullPage: true,
        threshold: 0.3,
        maxDiffPixels: CHART_RASTERIZATION_MAX_DIFF_PIXELS,
      });

      assertNoConsoleErrors(errors);
    });
  }

  test('workstation zero-positions scenario has empty Positions panel', async ({ page }) => {
    await page.goto('/dev/workstation?scenario=zero-positions');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);

    // Positions panel should still be present but empty
    await expect(page.getByTestId('ws-panel-positions')).toBeVisible();

    // Full-page visual baseline
    await expect(page).toHaveScreenshot('workstation-zero-positions-fullpage-1440x900.png', {
      fullPage: true,
      threshold: 0.3,
      maxDiffPixels: CHART_RASTERIZATION_MAX_DIFF_PIXELS,
    });
  });

  test('workstation large-drawdown scenario renders negative metrics', async ({ page }) => {
    await page.goto('/dev/workstation?scenario=large-drawdown');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);

    // Toolbar and panels should be visible
    await expect(page.getByTestId('ws-toolbar')).toBeVisible();
    await expect(page.getByTestId('ws-panel-risk')).toBeVisible();

    // Full-page visual baseline
    await expect(page).toHaveScreenshot('workstation-large-drawdown-fullpage-1440x900.png', {
      fullPage: true,
      threshold: 0.3,
      maxDiffPixels: CHART_RASTERIZATION_MAX_DIFF_PIXELS,
    });
  });

  test('workstation many-watchlist scenario keeps Watchlist outside the default', async ({ page }) => {
    await page.goto('/dev/workstation?scenario=many-watchlist');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);

    await expect(page.getByTestId('ws-panel-watchlist')).toHaveCount(0);

    // Full-page visual baseline
    await expect(page).toHaveScreenshot('workstation-many-watchlist-fullpage-1440x900.png', {
      fullPage: true,
      threshold: 0.3,
      maxDiffPixels: CHART_RASTERIZATION_MAX_DIFF_PIXELS,
    });
  });

  // ── Cross-Surface Visual Audit ──────────────────────────────────

  test('production shell and fixture harness remain visually distinct', async ({ page }) => {
    // Capture the production workstation with application chrome.
    await prepareProductionWorkstation(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await waitForProductionWorkstation(page);
    await page.waitForTimeout(500);
    const productionScreenshot = await page.screenshot({ fullPage: false });

    // Capture workstation default scenario
    await page.goto('/dev/workstation?scenario=default');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    const workstationScreenshot = await page.screenshot({ fullPage: false });

    // The panels are shared, but the production shell has the sidebar and
    // live controls while the deterministic harness exposes fixture controls.
    const productionBuffer = Buffer.from(productionScreenshot);
    const wsBuffer = Buffer.from(workstationScreenshot);
    const areSame = productionBuffer.equals(wsBuffer);
    expect(areSame).toBe(false);
  });
});
