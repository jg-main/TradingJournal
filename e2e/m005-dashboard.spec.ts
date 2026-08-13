import { test, expect } from '@playwright/test';

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

    // Dense curated default: risk, trades workspace, and the compact
    // summary row (account state / performance / process review).
    for (const area of ['risk', 'positions', 'account-state', 'performance', 'process-review']) {
      await expect(page.getByTestId(`ws-panel-${area}`)).toBeVisible();
    }
    // Retired surfaces have no cells in the dense default: the period KPI
    // band, the equity chart rail, and the insights panel. Watchlist stays
    // out of the curated flow (available via saved views / its page).
    for (const area of ['kpis', 'equity', 'insights', 'watchlist']) {
      await expect(page.getByTestId(`ws-panel-${area}`)).toHaveCount(0);
    }
  });

  test('API returns the canonical dashboard contract', async ({ request }) => {
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
