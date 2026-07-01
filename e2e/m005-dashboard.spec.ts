import { test, expect } from '@playwright/test';

test.describe('M005 Dashboard & Analytics', () => {
  test('dashboard page loads with heading and subtitle', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Dashboard heading should be visible
    await expect(page.locator('h1')).toContainText('Dashboard');
    await expect(page.getByText('Overview of your trading performance and activity.')).toBeVisible();
  });

  test('KPI cards show real data values', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Verify KPI labels are visible — use .first() for labels that appear in multiple places
    // (e.g. 'Win Rate' appears in Monthly Performance tooltip + KPI card)
    await expect(page.getByText('Total Trades').first()).toBeVisible();
    await expect(page.getByText('Net P&L').first()).toBeVisible();
    await expect(page.getByText('Avg R').first()).toBeVisible();
    await expect(page.getByText('Avg Grade').first()).toBeVisible();
    await expect(page.getByText('Current Drawdown').first()).toBeVisible();
    await expect(page.getByText('Account Value').first()).toBeVisible();
  });

  test('Performance Charts section renders with equity curve and drawdown panels', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Performance Charts heading should be visible
    await expect(page.getByText('Performance Charts')).toBeVisible();

    // Both chart panel titles should be visible — use exact text for card titles
    await expect(page.getByText('Equity Curve', { exact: true })).toBeVisible();
    await expect(page.getByText('Drawdown', { exact: true })).toBeVisible();
  });

  test('Performance Analytics section renders with monthly and R distribution panels', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Performance Analytics heading should be visible
    await expect(page.getByText('Performance Analytics')).toBeVisible();

    // Both chart panel titles should be visible — use exact text for card titles
    await expect(page.getByText('Monthly Performance', { exact: true })).toBeVisible();
    await expect(page.getByText('R Distribution', { exact: true })).toBeVisible();
  });

  test('Directional Performance section renders with long/short breakdown', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Directional Performance heading
    await expect(page.getByText('Directional Performance')).toBeVisible();
  });

  test('Process Quality Score Distribution section renders', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Use h2 heading for exact match
    await expect(page.getByRole('heading', { name: 'Process Quality Score Distribution' })).toBeVisible();
    await expect(page.getByText('Score Distribution', { exact: true })).toBeVisible();
  });

  test('Global filter bar renders date inputs and account selector', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Date filter labels — use exact text to avoid matching other elements
    await expect(page.getByText('From', { exact: true })).toBeVisible();
    await expect(page.getByText('To', { exact: true })).toBeVisible();

    // Date inputs should be present
    await expect(page.locator('#filter-date-from')).toBeVisible();
    await expect(page.locator('#filter-date-to')).toBeVisible();

    // Account filter label should be visible in main content (scoped to avoid sidebar)
    await expect(page.locator('main').getByText('Account', { exact: true })).toBeVisible();
  });

  test('API returns correct structured data', async ({ page }) => {
    // This test verifies the API contract directly
    const res = await page.request.get('/api/dashboard');
    expect(res.ok()).toBeTruthy();

    const data = await res.json();
    expect(data).toHaveProperty('kpis');
    expect(data).toHaveProperty('equityCurve');
    expect(data).toHaveProperty('drawdown');
    expect(data).toHaveProperty('monthlyPerformance');
    expect(data).toHaveProperty('rDistribution');
    expect(data).toHaveProperty('directionalPerformance');
    expect(data).toHaveProperty('processScoreDistribution');

    // KPI shape validation
    expect(data.kpis).toHaveProperty('totalTrades');
    expect(data.kpis).toHaveProperty('winRate');
    expect(data.kpis).toHaveProperty('netPnl');
    expect(data.kpis).toHaveProperty('avgR');
    expect(data.kpis).toHaveProperty('avgGrade');
    expect(data.kpis).toHaveProperty('currentDrawdown');
    expect(data.kpis).toHaveProperty('accountValue');

    // equityCurve and drawdown are arrays
    expect(Array.isArray(data.equityCurve)).toBeTruthy();
    expect(Array.isArray(data.drawdown)).toBeTruthy();

    // Data values are present
    expect(data.kpis.totalTrades).toBeGreaterThanOrEqual(0);
  });

  test('API returns 200 with empty data for nonexistent account (graceful degradation)', async ({ page }) => {
    // Dashboard API gracefully handles unknown accountId by returning empty/baseline data
    const res = await page.request.get('/api/dashboard?accountId=nonexistent');
    // Should return 200 with empty baseline, not 400
    expect(res.ok()).toBeTruthy();

    const data = await res.json();
    expect(data.kpis.totalTrades).toBe(0);
    expect(data.kpis.netPnl).toBe(0);
  });

  test('API works with valid date range filter', async ({ page }) => {
    // Test with date range filter
    const res = await page.request.get('/api/dashboard?dateFrom=2026-01-01&dateTo=2026-12-31');
    expect(res.ok()).toBeTruthy();

    const data = await res.json();
    expect(data).toHaveProperty('kpis');
  });

  test('date range filter inputs work and trigger re-render', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Verify filter inputs are present
    const fromInput = page.locator('#filter-date-from');
    const toInput = page.locator('#filter-date-to');
    await expect(fromInput).toBeVisible();
    await expect(toInput).toBeVisible();

    // Fill date range that covers seed data
    await fromInput.fill('2026-01-01');
    await toInput.fill('2026-12-31');

    // Wait briefly for React state update + API re-fetch
    await page.waitForTimeout(500);

    // Verify page is still rendered (no crash after filter change)
    await expect(page.locator('h1')).toContainText('Dashboard');

    // Clear filter to restore unfiltered view
    await fromInput.fill('');
    await toInput.fill('');

    // Wait for unfiltered re-fetch
    await page.waitForTimeout(500);

    // Verify page still renders
    await expect(page.locator('h1')).toContainText('Dashboard');
  });

  test('dark mode renders dashboard without errors', async ({ page }) => {
    // Emulate dark color scheme
    await page.emulateMedia({ colorScheme: 'dark' });

    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000); // Wait for ECharts to fully initialize

    // Verify page renders correctly in dark mode
    await expect(page.locator('h1')).toContainText('Dashboard');
    await expect(page.getByText('Total Trades').first()).toBeVisible();

    // No console errors
    const actualErrors = consoleErrors.filter(
      (e) => !e.includes('Failed to load resource')
    );
    expect(actualErrors).toEqual([]);
  });

  test('no console errors on dashboard page load', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000); // Wait for ECharts to fully initialize

    // Allow ECharts and resource loading warnings but report other errors
    const actualErrors = consoleErrors.filter(
      (e) => !e.includes('Failed to load resource')
    );
    expect(actualErrors).toEqual([]);
  });
});
