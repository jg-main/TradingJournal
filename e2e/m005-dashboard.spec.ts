import { test, expect, type APIRequestContext } from '@playwright/test';

/**
 * Seed an active account so the no-accountId API contract tests resolve an
 * account deterministically. Playwright gives each invocation a fresh
 * disposable DB (playwright.config.ts), so GET /api/dashboard without an
 * accountId would otherwise 400 "No active account found".
 */
async function seedActiveAccount(request: APIRequestContext): Promise<void> {
  const create = await request.post('/api/accounts', {
    data: { name: 'Dashboard Contract Account', broker: 'E2E', currency: 'USD' },
  });
  expect(create.status()).toBe(201);
  const account = (await create.json()) as { id: string };
  const activate = await request.put(`/api/accounts/${account.id}`, {
    data: { isActive: true },
  });
  expect(activate.ok()).toBeTruthy();
}

test.describe('Dashboard API and production workstation', () => {
  test('production root renders the live workstation and application shell', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('ws-toolbar')).toBeVisible();
    await expect(page.getByTestId('ws-live-badge')).toBeVisible();
    await expect(page.getByTestId('ws-grid')).toBeVisible();
    await expect(page.locator('aside').first()).toBeVisible();
  });

  test('dense summary row exposes the current operational metrics', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // The dense layout removed the period KPI band; NAV now renders in the
    // Account State panel and period KPIs in the Performance panel (empty
    // state until trades exist on a fresh database).
    await expect(page.getByTestId('ws-panel-kpis')).toHaveCount(0);

    const accountState = page.getByTestId('ws-panel-account-state');
    await expect(accountState).toBeVisible();
    await expect(accountState.getByText('NAV')).toBeVisible();

    await expect(page.getByTestId('ws-panel-performance')).toBeVisible();
  });

  test('production workstation renders all operational panels', async ({ page }) => {
    await page.goto('/');

    // Dense curated default (Risk & Positions): full-width Main Risk
    // Metrics, the trades workspace, and the compact Account State |
    // Performance summary row. Process Review is not part of the default —
    // it lives in its own dedicated system view.
    for (const area of ['risk', 'positions', 'account-state', 'performance']) {
      await expect(page.getByTestId(`ws-panel-${area}`)).toBeVisible();
    }
    // Non-default / retired surfaces have no cells in the dense default:
    // Process Review (dedicated system view), the period KPI band, the
    // equity chart rail, and the insights panel. Watchlist stays out of the
    // curated flow (available via saved views / its page).
    for (const area of ['process-review', 'watchlist', 'kpis', 'equity', 'insights']) {
      await expect(page.getByTestId(`ws-panel-${area}`)).toHaveCount(0);
    }
  });

  test('API returns the canonical dashboard contract', async ({ request }) => {
    await seedActiveAccount(request);
    const res = await request.get('/api/dashboard');
    expect(res.ok()).toBeTruthy();

    const data = await res.json();
    for (const field of [
      'kpis',
      'equityCurve',
      'drawdown',
      'monthlyPerformance',
      'rDistribution',
      'directionalPerformance',
      'processScoreDistribution',
    ]) {
      expect(data).toHaveProperty(field);
    }
    expect(data.kpis).toHaveProperty('totalTrades');
    expect(data.kpis).toHaveProperty('winRate');
    expect(data.kpis).toHaveProperty('netPnl');
    expect(Array.isArray(data.equityCurve)).toBe(true);
    expect(Array.isArray(data.drawdown)).toBe(true);
  });

  test('API gracefully returns an empty baseline for an unknown account', async ({ request }) => {
    const res = await request.get('/api/dashboard?accountId=nonexistent');
    expect(res.ok()).toBeTruthy();

    const data = await res.json();
    expect(data.kpis.totalTrades).toBe(0);
    expect(data.kpis.netPnl).toBe(0);
  });

  test('API accepts a valid date range', async ({ request }) => {
    await seedActiveAccount(request);
    const res = await request.get(
      '/api/dashboard?dateFrom=2026-01-01&dateTo=2026-12-31',
    );
    expect(res.ok()).toBeTruthy();
    expect(await res.json()).toHaveProperty('kpis');
  });

  test('production workstation renders in dark mode without console errors', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('ws-grid')).toBeVisible();

    expect(
      consoleErrors.filter((error) => !error.includes('Failed to load resource')),
    ).toEqual([]);
  });
});
