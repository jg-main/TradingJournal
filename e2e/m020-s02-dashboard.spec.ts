import { test, expect } from '@playwright/test';

test.describe('Dashboard KPI enrichment and equity markers', () => {
  test('production KPI strip exposes enriched metrics', async ({ page }) => {
    await page.goto('/');
    const kpis = page.getByTestId('ws-panel-kpis');

    await expect(kpis.getByText('Profit Factor', { exact: true })).toBeVisible();
    await expect(kpis.getByText('Net P&L', { exact: true })).toBeVisible();
    await expect(kpis.getByText('Avg R', { exact: true })).toBeVisible();
    await expect(kpis.getByText('Drawdown', { exact: true })).toBeVisible();
    await expect(kpis.getByText('Account Value', { exact: true })).toBeVisible();
  });

  test('deterministic equity chart renders with marker-capable fixture data', async ({ page }) => {
    await page.goto('/dev/workstation?scenario=default');

    const equity = page.getByTestId('ws-panel-equity');
    await expect(equity).toBeVisible();
    await expect(equity.getByTestId('ws-equity-chart').locator('canvas')).toBeVisible();
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
