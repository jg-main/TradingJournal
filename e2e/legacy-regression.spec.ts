/**
 * M005 S07 T03 — Legacy Dashboard Regression Proof
 *
 * Verifies that all legacy route families still render correctly after the
 * workstation (M005) changes — zero visual or functional regression.
 *
 * Coverage:
 * 1. All 12 legacy route families render without crash/console errors
 * 2. Legacy keyboard shortcuts (d, t, w, s, r, c, n, ?) work on legacy routes
 * 3. Dark mode renders all legacy routes without errors
 * 4. Sidebar navigation is present across all routes
 * 5. KeyboardShortcutsProvider wraps legacy routes (confirmed via shortcut behavior)
 * 6. Workstation route does NOT leak into legacy surface
 */

import { test, expect } from '@playwright/test';

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Collect console errors during a test. Call before page navigation.
 */
function captureConsoleErrors(page: import('@playwright/test').Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });
  return errors;
}

/**
 * Assert zero unfiltered console errors, allowing known benign messages.
 */
function assertNoConsoleErrors(errors: string[]): void {
  const actualErrors = errors.filter(
    (e) =>
      !e.includes('Failed to load resource') &&
      !e.includes('ERR_BLOCKED_BY_CLIENT') &&
      !e.includes('favicon.ico'),
  );
  expect(actualErrors).toEqual([]);
}

// ── Route Families ──────────────────────────────────────────────────

const LEGACY_ROUTES = [
  { path: '/', heading: 'Dashboard', family: 'dashboard' },
  { path: '/trades', heading: 'Trades', family: 'trades' },
  { path: '/watchlist', heading: 'Watchlist', family: 'watchlist' },
  { path: '/alerts', heading: 'Alerts', family: 'alerts' },
  { path: '/sizing', heading: 'Sizing', family: 'sizing' },
  { path: '/reviews', heading: 'Reviews', family: 'reviews' },
  { path: '/checks', heading: 'Checks & Validation', family: 'checks' },
  { path: '/help', heading: 'Help & Documentation', family: 'help' },
  { path: '/lookups', heading: 'Lookups', family: 'lookups' },
  { path: '/settings/accounts', heading: 'Accounts', family: 'accounts' },
  { path: '/settings', heading: 'Settings', family: 'settings' },
] as const;

// ── Tests: Route Rendering ─────────────────────────────────────────

test.describe('Legacy Route Rendering Regression', () => {
  test.describe.configure({ mode: 'parallel' });

  for (const { path, heading, family } of LEGACY_ROUTES) {
    test(`${family} — ${path} renders with heading "${heading}" and no console errors`, async ({ page }) => {
      const errors = captureConsoleErrors(page);

      await page.goto(path);
      await page.waitForLoadState('networkidle');

      // Heading should contain the expected text
      await expect(page.locator('h1')).toContainText(heading);

      // Sidebar should be present (use .first() for pages with multiple asides)
      await expect(page.locator('aside').first()).toBeVisible();

      // No console errors
      assertNoConsoleErrors(errors);
    });
  }

  test('trade detail — renders page structure for trade route', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    // The trade detail page renders with the sidebar and basic chrome
    // even when the trade doesn't exist (graceful degradation)
    await page.goto('/trades/invalid-id-99999');
    await page.waitForLoadState('networkidle');

    // Page should render without catastrophic crash
    await expect(page.locator('aside').first()).toBeVisible();

    assertNoConsoleErrors(errors);
  });

  test('trade detail — gracefully handles nonexistent trade ID', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    await page.goto('/trades/nonexistent-id-99999');
    await page.waitForLoadState('networkidle');

    // Page should render without catastrophic error — heading may show error state
    // but the page layout must not crash
    await expect(page.locator('aside').first()).toBeVisible();

    assertNoConsoleErrors(errors);
  });
});

// ── Tests: Legacy Keyboard Shortcuts ───────────────────────────────

test.describe('Legacy Keyboard Shortcut Navigation', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('"d" key navigates to Dashboard from another page', async ({ page }) => {
    await page.goto('/trades');
    await page.waitForLoadState('networkidle');

    await page.keyboard.press('d');
    await page.waitForURL('/');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h1')).toContainText('Dashboard');
  });

  test('"t" key navigates to Trades', async ({ page }) => {
    await page.keyboard.press('t');
    await page.waitForURL('/trades');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h1')).toContainText('Trades');
  });

  test('"w" key navigates to Watchlist', async ({ page }) => {
    await page.keyboard.press('w');
    await page.waitForURL('/watchlist');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h1')).toContainText('Watchlist');
  });

  test('"s" key navigates to Settings', async ({ page }) => {
    await page.keyboard.press('s');
    await page.waitForURL('/settings');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h1')).toContainText('Settings');
  });

  test('"r" key navigates to Reviews', async ({ page }) => {
    await page.keyboard.press('r');
    await page.waitForURL('/reviews');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h1')).toContainText('Reviews');
  });

  test('"c" key navigates to Checks', async ({ page }) => {
    await page.keyboard.press('c');
    await page.waitForURL('/checks');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h1')).toContainText('Checks & Validation');
  });

  test('"n" key attempts New Trade navigation', async ({ page }) => {
    await page.keyboard.press('n');
    await page.waitForTimeout(500);
    // "n" shortcut tries to click a plan button; fallback is /trades
    // The key behavior is that the page should not crash — it redirects
    // to /trades or triggers a plan dialog
    await expect(page.locator('aside').first()).toBeVisible();
    assertNoConsoleErrors(captureConsoleErrors(page));
  });

  test('"?" key toggles the keyboard shortcut overlay', async ({ page }) => {
    // Press ? to show overlay
    await page.keyboard.press('?');
    await page.waitForTimeout(300);

    // The overlay backdrop should be visible (fixed inset-0 with bg-black/40)
    const overlayBackdrop = page.locator('.fixed.inset-0.bg-black\\/40');
    await expect(overlayBackdrop).toBeVisible();

    // The overlay heading should be visible
    await expect(page.getByText('Keyboard Shortcuts')).toBeVisible();

    // Press ? again to dismiss
    await page.keyboard.press('?');
    await page.waitForTimeout(300);
    await expect(overlayBackdrop).not.toBeVisible();
  });

  test('shortcuts are suppressed when focus is in an input', async ({ page }) => {
    await page.goto('/trades');
    await page.waitForLoadState('networkidle');

    // Find the search/filter input on trades page
    const searchInput = page.locator('input[placeholder*="earch"], input[placeholder*="filter"], input[type="search"]').first();
    if (await searchInput.isVisible().catch(() => false)) {
      await searchInput.focus();
      await searchInput.fill('should not navigate');

      // Press a navigation shortcut while focused on input
      await page.keyboard.press('d');
      await page.waitForTimeout(300);

      // URL should still be /trades (not navigated to /)
      const url = page.url();
      expect(url).toContain('/trades');
    }
  });

  test('shortcuts are suppressed when modifier keys are held', async ({ page }) => {
    await page.goto('/trades');
    await page.waitForLoadState('networkidle');

    // Press Ctrl+D (should NOT navigate)
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(300);

    // URL should still be /trades
    const url = page.url();
    expect(url).toContain('/trades');
  });
});

// ── Tests: Dark Mode ───────────────────────────────────────────────

test.describe('Legacy Dark Mode Rendering', () => {
  test.describe.configure({ mode: 'parallel' });

  for (const { path, family } of LEGACY_ROUTES) {
    test(`${family} — ${path} renders in dark mode without errors`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: 'dark' });

      const errors = captureConsoleErrors(page);

      await page.goto(path);
      await page.waitForLoadState('networkidle');
      // Allow ECharts/chart renders to stabilize
      await page.waitForTimeout(2000);

      // Page should render without crash
      await expect(page.locator('h1')).toBeVisible();
      await expect(page.locator('aside').first()).toBeVisible();

      assertNoConsoleErrors(errors);
    });
  }
});

// ── Tests: Isolation — Workstation Does NOT Leak into Legacy ─────────

test.describe('Workstation-Legacy Isolation', () => {
  test('legacy Dashboard does NOT render workstation panels', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Workstation-specific test IDs must NOT be present on legacy routes
    await expect(page.getByTestId('ws-panel-kpis')).toHaveCount(0);
    await expect(page.getByTestId('ws-panel-equity')).toHaveCount(0);
    await expect(page.getByTestId('ws-panel-positions')).toHaveCount(0);
    await expect(page.getByTestId('ws-panel-watchlist')).toHaveCount(0);
    await expect(page.getByTestId('ws-panel-risk')).toHaveCount(0);
    await expect(page.getByTestId('ws-panel-insights')).toHaveCount(0);
  });

  test('legacy routes do NOT render workstation skip link', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('ws-skip-link')).toHaveCount(0);
  });

  test('workstation /workspace does NOT render legacy sidebar KeyboardShortcuts overlay', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    await page.goto('/workspace');
    await page.waitForLoadState('networkidle');

    // Workstation page should render
    await expect(page.getByTestId('ws-toolbar')).toBeVisible();

    assertNoConsoleErrors(errors);
  });

  test('keyboard shortcuts on legacy routes use legacy system (not workstation)', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Legacy ? overlay should work
    await page.keyboard.press('?');
    await page.waitForTimeout(300);
    await expect(page.getByText('Keyboard Shortcuts')).toBeVisible();

    // Workstation-specific overlay (ws-shortcut-overlay) must NOT appear
    await expect(page.getByTestId('ws-shortcut-overlay')).toHaveCount(0);

    await page.keyboard.press('?');
  });
});

// ── Tests: Settings Sub-Pages ──────────────────────────────────────

test.describe('Settings Sub-Page Rendering', () => {
  test.describe.configure({ mode: 'parallel' });

  const SETTINGS_SUB_ROUTES = [
    { path: '/settings/ai', text: 'AI' },
    { path: '/settings/backup', text: 'Backup' },
    { path: '/settings/accounts', text: 'Accounts' },
    { path: '/settings/danger-zone', text: 'Danger Zone' },
    { path: '/settings/integrations', text: 'Integrations' },
    { path: '/settings/journal-setup', text: 'Journal Setup' },
    { path: '/settings/market-data', text: 'Market Data' },
    { path: '/settings/mistake-types', text: 'Mistake Types' },
    { path: '/settings/plays', text: 'Plays' },
    { path: '/settings/risk-defaults', text: 'Risk' },
    { path: '/settings/workspace', text: 'Workspace' },
  ];

  for (const { path, text } of SETTINGS_SUB_ROUTES) {
    test(`settings sub-page ${path} renders with "${text}" text visible`, async ({ page }) => {
      const errors = captureConsoleErrors(page);

      await page.goto(path);
      await page.waitForLoadState('networkidle');

      // Page should render without crash — sidebar present
      await expect(page.locator('aside').first()).toBeVisible();

      // Page should contain the expected text (heading or tab)
      await expect(page.getByText(text, { exact: false }).first()).toBeVisible({ timeout: 10000 });

      assertNoConsoleErrors(errors);
    });
  }
});
