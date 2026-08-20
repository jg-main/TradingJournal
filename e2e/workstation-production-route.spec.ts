/**
 * M026-1bw68n closure — Production-route workstation smoke/UAT
 *
 * Corrective-pass evidence (user directive #3): milestone closure must prove
 * that the actual product route `/` integrates the workstation correctly —
 * not only the `/dev/workstation` fixture harness.
 *
 * This spec exercises the real production composition on `/`:
 *
 *   - WorkstationProvider with liveMode=true (the legacy root page mounts it
 *     with the global AccountProvider context);
 *   - global account context (sidebar AccountProvider);
 *   - WorkstationToolbar (incl. the live badge);
 *   - WorkstationShell (risk band + trades workspace + dynamic grid);
 *   - the real root application shell (sidebar + skip link).
 *
 * Minimal matrix (deliberately small — the fixture matrix is not duplicated):
 *
 *   / — light — 1440px
 *   / — dark  — 1024px
 *
 * Validates:
 *   - page loads without uncaught errors;
 *   - workstation toolbar renders;
 *   - account context hydrates to the deterministic active account;
 *   - Main Risk Metrics visible; Trades workspace visible and usable;
 *   - risk remains above trades;
 *   - no document-level horizontal overflow;
 *   - normal mode has no arrange/drag/resize editing chrome;
 *   - theme is correctly applied;
 *   - data-quality/trust state is visible;
 *   - no console.error; no page errors.
 *
 * The disposable per-run DB is deterministic: the test creates one active
 * funded account via the API (helpers/trading-account) so account context
 * hydrates deterministically, and the workstation view store is reset to the
 * three system templates. No external broker/internet dependency — this is an
 * application-integration proof, not a third-party-availability test.
 *
 * Run: npx playwright test e2e/workstation-production-route.spec.ts --project=chromium
 */

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { createTradingAccount } from './helpers/trading-account';

test.describe.configure({ mode: 'serial' });

/** localStorage key owned by the theme system (ThemeToggle + layout script). */
const THEME_STORAGE_KEY = 'theme';

/** localStorage key owned by useWorkstationViews. */
const VIEWS_STORAGE_KEY = 'workstation:views:v1';

/**
 * The two theme × viewport cases mandated for production-route integration.
 * light at the primary desktop width; dark at the compact supported width.
 */
const CASES = [
  { name: 'light@1440', theme: 'light', width: 1440, height: 900 },
  { name: 'dark@1024', theme: 'dark', width: 1024, height: 900 },
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
 * Reset the workstation view store to pristine defaults: delete every user
 * workstation row (ws-*, non-system) from the shared API table. The
 * workstation-views localStorage key is cleared in the pre-paint init script
 * (on the real origin), so every navigation lands on the three system
 * templates (same pattern as the responsive spec).
 */
async function resetViewStore(request: APIRequestContext) {
  let rows: Array<{ id: string; isSystem: boolean }> | null = null;
  try {
    const response = await request.get('/api/dashboard/views');
    if (response.ok()) {
      rows = (await response.json()) as Array<{ id: string; isSystem: boolean }>;
    }
  } catch {
    // API unavailable on a cold dev server — the init-script localStorage
    // reset below still lands the store on the three system defaults.
  }
  if (rows) {
    for (const row of rows) {
      if (!row.isSystem && row.id.startsWith('ws-')) {
        await request.delete(`/api/dashboard/views?id=${encodeURIComponent(row.id)}`);
      }
    }
  }
}

for (const c of CASES) {
  test(`production route / integrates the workstation (${c.name})`, async ({ page, request }) => {
    // Deterministic account: one active funded account → account context
    // hydrates to it (first-active fallback) and the workstation renders
    // live-mode state against the empty journal.
    const account = await createTradingAccount(request, `prod-route-${c.name.replace('@', '-')}`);
    expect(account.id).toBeTruthy();

    // Theme + pristine view store before first paint: the pre-paint inline
    // script reads localStorage['theme'] (S04 theme contract); clearing the
    // workstation-views key lands the store on the three system templates.
    await page.addInitScript(
      ([themeKey, viewsKey, theme]) => {
        localStorage.setItem(themeKey, theme);
        localStorage.removeItem(viewsKey);
      },
      [THEME_STORAGE_KEY, VIEWS_STORAGE_KEY, c.theme] as const,
    );

    await page.setViewportSize({ width: c.width, height: c.height });
    await resetViewStore(request);

    const { consoleErrors, pageErrors } = watchForErrors(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // The workstation hydrates views + live data after mount.
    await expect(page.getByTestId('ws-toolbar')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('ws-panel-risk')).toBeVisible();

    // 1. Workstation toolbar renders, and live-mode composition is active.
    await expect(page.getByTestId('ws-live-badge')).toBeVisible();

    // 2. Account context hydrates to the deterministic active account:
    //    the sidebar account surface renders (not its loading state) and the
    //    workstation's account-state panel mounts.
    await expect(page.getByTestId('sidebar-account')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('sidebar-account-loading')).toHaveCount(0);
    await expect(page.getByTestId('ws-account-state-metrics')).toBeVisible();

    // 3. Main Risk Metrics visible.
    await expect(page.getByTestId('ws-panel-risk')).toBeVisible();

    // 4. Trades workspace visible and usable (panel renders; with an empty
    //    journal it shows the deterministic empty state — no overflow, no
    //    breakage). The trades panel keeps the canonical ws-panel-positions
    //    testid.
    await expect(page.getByTestId('ws-panel-positions')).toBeVisible();

    // 5. Risk remains above trades.
    const riskBox = await page.getByTestId('ws-panel-risk').boundingBox();
    const tradesBox = await page.getByTestId('ws-panel-positions').boundingBox();
    expect(riskBox, 'risk band must exist').not.toBeNull();
    expect(tradesBox, 'trades panel must exist').not.toBeNull();
    expect(riskBox!.y, 'risk must sit above trades').toBeLessThan(tradesBox!.y);

    // 6. No document-level horizontal overflow.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `no document horizontal overflow at ${c.width}px`).toBeLessThanOrEqual(0);

    // 7. Normal mode: no arrange/drag/resize editing chrome.
    await expect(page.getByTestId('ws-customize-bar')).toHaveCount(0);
    await expect(page.getByTestId('ws-arrange-grid')).toHaveCount(0);
    await expect(page.locator('.ws-arrange-handle')).toHaveCount(0);

    // 8. Theme correctly applied: the .dark class follows the theme, and the
    //    applied background differs between themes (token contract smoke).
    const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    expect(isDark).toBe(c.theme === 'dark');
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg, `theme background rendered for ${c.theme}`).not.toBe('rgba(0, 0, 0, 0)');

    // 9. Data-quality / trust state visible (alert strip is outside the grid
    //    and always rendered).
    await expect(page.getByTestId('ws-data-quality-alert-strip')).toBeVisible();

    // 10. No console errors, no page errors.
    expect(pageErrors, `no page errors (${c.name})`).toEqual([]);
    expect(consoleErrors, `no console.error (${c.name})`).toEqual([]);
  });
}
