/**
 * M005 S07 T03 — Playwright Visual Regression Baselines
 *
 * Captures visual baselines at 1440×900 for both layouts:
 * 1. Legacy Dashboard (/) — the reference surface
 * 2. Workstation (/workspace) — all 4 fixture scenarios
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

// ── Tests ───────────────────────────────────────────────────────────

test.describe('Visual Regression Baselines', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
  });

  // ── Legacy Dashboard ──────────────────────────────────────────────

  test('legacy dashboard renders with correct layout at 1440x900', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // Allow ECharts and other chart libraries to finish painting
    await page.waitForTimeout(3000);

    // Primary heading should be visible
    await expect(page.locator('h1')).toContainText('Dashboard');

    // KPI cards should be visible
    await expect(page.getByText('Total Trades').first()).toBeVisible();
    await expect(page.getByText('Net P&L').first()).toBeVisible();

    // Visual baseline — full viewport screenshot
    await expect(page).toHaveScreenshot('legacy-dashboard-1440x900.png', {
      fullPage: false,
      threshold: 0.3,
    });

    assertNoConsoleErrors(errors);
  });

  test('legacy dashboard full-page layout at 1440x900', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Full-page visual baseline (entire scrollable content)
    await expect(page).toHaveScreenshot('legacy-dashboard-fullpage-1440x900.png', {
      fullPage: true,
      threshold: 0.3,
    });
  });

  // ── Workstation Scenarios ─────────────────────────────────────────

  for (const { id, label } of WORKSTATION_SCENARIOS) {
    test(`workstation ${label} renders correctly at 1440x900`, async ({ page }) => {
      const errors = captureConsoleErrors(page);

      await page.goto(`/workspace?scenario=${id}`);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1500);

      // Toolbar should be visible
      await expect(page.getByTestId('ws-toolbar')).toBeVisible();

      // All 6 panels should be visible
      await expect(page.getByTestId('ws-panel-kpis')).toBeVisible();
      await expect(page.getByTestId('ws-panel-equity')).toBeVisible();
      await expect(page.getByTestId('ws-panel-positions')).toBeVisible();
      await expect(page.getByTestId('ws-panel-watchlist')).toBeVisible();
      await expect(page.getByTestId('ws-panel-risk')).toBeVisible();
      await expect(page.getByTestId('ws-panel-insights')).toBeVisible();

      // Visual baseline
      await expect(page).toHaveScreenshot(`workstation-${id}-1440x900.png`, {
        fullPage: false,
        threshold: 0.3,
      });

      assertNoConsoleErrors(errors);
    });
  }

  test('workstation zero-positions scenario has empty Positions panel', async ({ page }) => {
    await page.goto('/workspace?scenario=zero-positions');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);

    // Positions panel should still be present but empty
    await expect(page.getByTestId('ws-panel-positions')).toBeVisible();

    // Full-page visual baseline
    await expect(page).toHaveScreenshot('workstation-zero-positions-fullpage-1440x900.png', {
      fullPage: true,
      threshold: 0.3,
    });
  });

  test('workstation large-drawdown scenario renders negative metrics', async ({ page }) => {
    await page.goto('/workspace?scenario=large-drawdown');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);

    // Toolbar and panels should be visible
    await expect(page.getByTestId('ws-toolbar')).toBeVisible();
    await expect(page.getByTestId('ws-panel-risk')).toBeVisible();

    // Full-page visual baseline
    await expect(page).toHaveScreenshot('workstation-large-drawdown-fullpage-1440x900.png', {
      fullPage: true,
      threshold: 0.3,
    });
  });

  test('workstation many-watchlist scenario renders full symbol list', async ({ page }) => {
    await page.goto('/workspace?scenario=many-watchlist');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);

    // Watchlist panel should show rows
    await expect(page.getByTestId('ws-panel-watchlist')).toBeVisible();

    // Full-page visual baseline
    await expect(page).toHaveScreenshot('workstation-many-watchlist-fullpage-1440x900.png', {
      fullPage: true,
      threshold: 0.3,
    });
  });

  // ── Cross-Surface Visual Audit ──────────────────────────────────

  test('legacy and workstation layouts are visually distinct (not leaking)', async ({ page }) => {
    // Capture legacy dashboard
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    const legacyScreenshot = await page.screenshot({ fullPage: false });

    // Capture workstation default scenario
    await page.goto('/workspace?scenario=default');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    const workstationScreenshot = await page.screenshot({ fullPage: false });

    // The two screenshots should be different — they're different surfaces
    // If they were identical, it'd mean the workstation leaked into legacy
    const legacyBuffer = Buffer.from(legacyScreenshot);
    const wsBuffer = Buffer.from(workstationScreenshot);
    const areSame = legacyBuffer.equals(wsBuffer);
    expect(areSame).toBe(false);
  });
});
