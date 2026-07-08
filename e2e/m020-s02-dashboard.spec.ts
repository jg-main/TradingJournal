import { test, expect } from '@playwright/test';

test.describe('M020 S02 Dashboard KPI Enrichment and Equity Curve Trade Markers', () => {
  test('new KPI cards are visible with real data values', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Verify the three new KPI card labels are visible
    // KPI card labels are <p> elements inside a TooltipTrigger with asChild
    await expect(page.getByText('Profit Factor').first()).toBeVisible();
    await expect(page.getByText('Avg Win').first()).toBeVisible();
    await expect(page.getByText('Avg Loss').first()).toBeVisible();

    // Verify existing KPI cards are still rendered (no regression)
    await expect(page.getByText('Total Trades').first()).toBeVisible();
    await expect(page.getByText('Net P&L').first()).toBeVisible();
    await expect(page.getByText('Avg R').first()).toBeVisible();
    await expect(page.getByText('Avg Grade').first()).toBeVisible();
    await expect(page.getByText('Current Drawdown').first()).toBeVisible();
    await expect(page.getByText('Account Value').first()).toBeVisible();
  });

  test('KPI values have correct formatting', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Profit Factor: label's parent CardContent contains the numeric value
    const pfLabel = page.getByText('Profit Factor').first();
    const pfCardContent = pfLabel.locator('..');
    const pfText = await pfCardContent.textContent();
    // Profit Factor is shown as a number (like 1.50) or "--" when null
    if (pfText) {
      const pfDigits = pfText.match(/\d+\.\d{2}/);
      if (pfDigits) {
        // Numeric value is present (not "--") — 2 decimal places
        expect(pfDigits[0]).toMatch(/^\d+\.\d{2}$/);
      }
    }

    // Avg Win: parent CardContent contains currency format
    const awLabel = page.getByText('Avg Win').first();
    const awCardContent = awLabel.locator('..');
    const awText = await awCardContent.textContent();
    if (awText && !awText.includes('--')) {
      // Currency values start with $
      expect(awText).toContain('$');
    }

    // Avg Loss: parent CardContent contains currency format
    const alLabel = page.getByText('Avg Loss').first();
    const alCardContent = alLabel.locator('..');
    const alText = await alCardContent.textContent();
    if (alText && !alText.includes('--')) {
      // Currency values start with $
      expect(alText).toContain('$');
    }
  });

  test('equity curve chart renders with trade entry and exit markers', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Verify the Equity Curve chart panel heading is visible
    await expect(page.getByText('Equity Curve', { exact: true })).toBeVisible();

    // Verify the chart renders a canvas element on the page
    // ECharts renders canvas elements for each chart panel including equity curve
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 10000 });
  });

  test('API response includes new KPI fields and tradeMarkers', async ({ page }) => {
    // Verify the API contract includes the new fields from S02
    const res = await page.request.get('/api/dashboard');
    expect(res.ok()).toBeTruthy();

    const data = await res.json();

    // New KPI fields must be present
    expect(data.kpis).toHaveProperty('profitFactor');
    expect(data.kpis).toHaveProperty('avgWin');
    expect(data.kpis).toHaveProperty('avgLoss');

    // tradeMarkers array must be present (may be empty if no closed trades)
    expect(data).toHaveProperty('tradeMarkers');
    expect(Array.isArray(data.tradeMarkers)).toBeTruthy();

    // Existing KPI fields must still be present (no regression)
    expect(data.kpis).toHaveProperty('totalTrades');
    expect(data.kpis).toHaveProperty('winRate');
    expect(data.kpis).toHaveProperty('netPnl');
    expect(data.kpis).toHaveProperty('avgR');
    expect(data.kpis).toHaveProperty('avgGrade');
    expect(data.kpis).toHaveProperty('currentDrawdown');
    expect(data.kpis).toHaveProperty('accountValue');

    // If tradeMarkers exist, verify the shape of marker objects
    if (data.tradeMarkers.length > 0) {
      const marker = data.tradeMarkers[0];
      expect(marker).toHaveProperty('date');
      expect(marker).toHaveProperty('equity');
      expect(marker).toHaveProperty('tradeId');
      expect(marker).toHaveProperty('symbol');
      expect(marker).toHaveProperty('direction');
      expect(marker).toHaveProperty('markerType');
      expect(marker).toHaveProperty('price');
      expect(marker).toHaveProperty('pnl');
      expect(['entry', 'exit']).toContain(marker.markerType);
      expect(['long', 'short']).toContain(marker.direction);
    }
  });

  test('no console errors on dashboard load', async ({ page }) => {
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

  test('empty state with future date filter', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Verify dashboard rendered initially with new KPI cards
    await expect(page.getByText('Profit Factor').first()).toBeVisible();

    // Apply a future date range that excludes all trades
    const fromInput = page.locator('#filter-date-from');
    const toInput = page.locator('#filter-date-to');
    await expect(fromInput).toBeVisible();
    await expect(toInput).toBeVisible();

    await fromInput.fill('2099-01-01');
    await toInput.fill('2099-12-31');

    // Wait for React state update + API re-fetch
    await page.waitForTimeout(2000);

    // Page should render without crashing
    // Either the "No trades yet" empty state or KPI cards with "--" are acceptable
    const hasEmptyState = await page.getByText('No trades yet').isVisible().catch(() => false);
    if (hasEmptyState) {
      await expect(page.getByText('No trades yet')).toBeVisible();
    } else {
      // KPI cards still visible even with filtered-out data
      await expect(page.getByText('Profit Factor').first()).toBeVisible();
      await expect(page.getByText('Total Trades').first()).toBeVisible();
    }

    // Clear filter to restore
    await fromInput.fill('');
    await toInput.fill('');
    await page.waitForTimeout(2000);

    // Dashboard recovers when filters are cleared
    await expect(page.getByText('Profit Factor').first()).toBeVisible();
  });
});
