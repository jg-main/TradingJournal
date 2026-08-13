import { test, expect } from '@playwright/test';

test.describe('Dashboard KPI enrichment and equity markers', () => {
  test('production dense default exposes account state stats without a KPI strip', async ({ page }) => {
    await page.goto('/');

    // Dense S02: the KPI band is removed from the workstation catalogue —
    // period KPIs now live in the Performance panel stat rows.
    await expect(page.getByTestId('ws-panel-kpis')).toHaveCount(0);

    // Account Value moved to the Account State panel as NAV (with qualification).
    const accountState = page.getByTestId('ws-panel-account-state');
    await expect(accountState.getByTestId('ws-account-state-nav')).toContainText('NAV');
    await expect(accountState.getByTestId('ws-account-state-drawdown')).toBeVisible();
  });

  test('account state panel is stat-only; the equity chart leaves the summary row (M017/S02)', async ({ page }) => {
    await page.goto('/dev/workstation?scenario=default');

    const accountState = page.getByTestId('ws-panel-account-state');
    await expect(accountState).toBeVisible();
    // Dense S02: no chart inside the Account State summary panel — the
    // equity/drawdown chart moves to the future analysis workspace.
    await expect(accountState.getByTestId('ws-equity-chart')).toHaveCount(0);
    await expect(accountState.getByTestId('ws-account-state-metrics')).toBeVisible();
  });

  test('API response retains enriched KPIs and trade markers', async ({ request }) => {
    const res = await request.get('/api/dashboard');
    expect(res.ok()).toBeTruthy();
    const data = await res.json();

    expect(data.kpis).toHaveProperty('profitFactor');
    expect(data.kpis).toHaveProperty('avgWin');
    expect(data.kpis).toHaveProperty('avgLoss');
    expect(data).toHaveProperty('tradeMarkers');
    expect(Array.isArray(data.tradeMarkers)).toBe(true);

    if (data.tradeMarkers.length > 0) {
      expect(data.tradeMarkers[0]).toEqual(
        expect.objectContaining({
          date: expect.any(String),
          equity: expect.any(Number),
          tradeId: expect.any(String),
          symbol: expect.any(String),
          direction: expect.stringMatching(/^(long|short)$/),
          markerType: expect.stringMatching(/^(entry|exit)$/),
          price: expect.any(Number),
          pnl: expect.any(Number),
        }),
      );
    }
  });

  test('production workstation loads without console errors', async ({ page }) => {
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
