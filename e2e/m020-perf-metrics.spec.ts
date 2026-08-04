import { test, expect } from '@playwright/test';
import { prepareAccountForTrading } from './helpers/trading-account';

test.describe('M020 Per-Trade Performance Metrics', () => {
  test.describe.configure({ mode: 'serial' });

  test('closed trade detail page shows Duration, Return %, and Total Fees on P&L-R Metrics card', async ({ page }) => {
    // Create a test account
    const accRes = await page.request.post('/api/accounts', {
      data: { name: 'E2E Perf Closed', isActive: true, startingBalance: 50000 },
    });
    expect(accRes.ok()).toBeTruthy();
    const account = await accRes.json();
    await prepareAccountForTrading(page.request, account.id);

    // Create a trade
    const tradeRes = await page.request.post('/api/trades', {
      data: { symbol: 'PERF-C', direction: 'long', accountId: account.id },
    });
    expect(tradeRes.ok()).toBeTruthy();
    const trade = await tradeRes.json();

    // Execute with full exit (entry=180 qty=50, exit=190 qty=50, fees=3.0)
    // P&L before fees = (190-180)*50 = $500
    // Fees = $3.00 (on entry, exit has $0)
    // totalRealizedPnL (after fee subtraction) = 500 - 3 = $497.00
    // Return % = 497 / (180*50) * 100 = 5.522... → "5.52%"
    const execRes = await page.request.post(`/api/trades/${trade.id}/execute`, {
      data: {
        entryPrice: 180.0,
        entryQuantity: 50,
        exit1Price: 190.0,
        exit1Quantity: 50,
        fees: 3.0,
      },
    });
    expect(execRes.ok()).toBeTruthy();
    const execData = await execRes.json();
    expect(execData.trade.status).toBe('closed');

    // Navigate to trade detail page
    await page.goto(`/trades/${trade.id}`);
    await expect(page.locator('h1')).toContainText('PERF-C');

    const card = page.locator('[data-slot="card"]').filter({
      has: page.getByText('Total Fees', { exact: true }),
    }).first();
    await expect(card).toBeVisible();

    // Verify Duration label and value
    await expect(card.getByText('Duration')).toBeVisible();
    // Both executions share the same timestamp, so duration is 0ms = "<1m"
    await expect(card.getByText('<1m')).toBeVisible();

    // Verify Return % label and value
    await expect(card.getByText('Return %')).toBeVisible();
    await expect(card.getByText('+5.52%')).toBeVisible();

    // Verify Total Fees label and value
    await expect(card.getByText('Total Fees')).toBeVisible();
    await expect(card.getByText('$3.00')).toBeVisible();

    // Verify existing P&L-R Metrics fields still render correctly
    await expect(card.getByText('Realized P&L')).toBeVisible();
    await expect(card.getByText('+$497.00')).toBeVisible();
    await expect(card.getByText('R Multiple')).toBeVisible();
    await expect(card.getByText('Avg Entry')).toBeVisible();
    await expect(card.getByText('180.00')).toBeVisible();
  });

  test('open trade detail page shows Duration, Return %, and Total Fees on P&L-R Metrics card', async ({ page }) => {
    // Create a test account
    const accRes = await page.request.post('/api/accounts', {
      data: { name: 'E2E Perf Open', isActive: true, startingBalance: 50000 },
    });
    expect(accRes.ok()).toBeTruthy();
    const account = await accRes.json();
    await prepareAccountForTrading(page.request, account.id);

    // Create a trade
    const tradeRes = await page.request.post('/api/trades', {
      data: { symbol: 'PERF-O', direction: 'long', accountId: account.id },
    });
    expect(tradeRes.ok()).toBeTruthy();
    const trade = await tradeRes.json();

    // Execute entry-only (no exit) → status becomes 'open'
    // Entry: buy 100 x $50.00, zero fees (so P&L stays $0.00 and Return % = 0.00%)
    const execRes = await page.request.post(`/api/trades/${trade.id}/execute`, {
      data: {
        entryPrice: 50.0,
        entryQuantity: 100,
        stopPrice: 45.0,
        fees: 0,
      },
    });
    expect(execRes.ok()).toBeTruthy();
    const execData = await execRes.json();
    expect(execData.trade.status).toBe('open');

    // Navigate to trade detail page
    await page.goto(`/trades/${trade.id}`, { waitUntil: 'networkidle' });
    await expect(page.locator('h1')).toContainText('PERF-O');

    const card = page.locator('[data-slot="card"]').filter({
      has: page.getByText('Total Fees', { exact: true }),
    }).first();
    await expect(card).toBeVisible();

    // Verify Duration label — value is dynamic (now - openedAt)
    await expect(card.getByText('Duration')).toBeVisible();

    // Without a current market mark, canonical open-trade return is unknown.
    const returnMetric = card.getByText('Return %').locator('..');
    await expect(returnMetric).toContainText('—');

    // Verify Total Fees label — zero fees for this test
    await expect(card.getByText('Total Fees')).toBeVisible();
    await expect(card.getByText('$0.00').first()).toBeVisible();

    // Verify existing fields still render
    await expect(card.getByText('Realized P&L')).toBeVisible();
  });

  test('planned trade with no executions does not render P&L-R Metrics card', async ({ page }) => {
    // Create a test account
    const accRes = await page.request.post('/api/accounts', {
      data: { name: 'E2E Perf Planned', isActive: true, startingBalance: 50000 },
    });
    expect(accRes.ok()).toBeTruthy();
    const account = await accRes.json();
    await prepareAccountForTrading(page.request, account.id);

    // Create a planned trade (no executions)
    const tradeRes = await page.request.post('/api/trades', {
      data: { symbol: 'PERF-P', direction: 'long', accountId: account.id },
    });
    expect(tradeRes.ok()).toBeTruthy();
    const trade = await tradeRes.json();
    expect(trade.status).toBe('planned');

    // Navigate to trade detail page
    await page.goto(`/trades/${trade.id}`);
    await expect(page.locator('h1')).toContainText('PERF-P');

    // Performance metrics are not rendered for planned trades.
    await expect(page.getByText('Total Fees', { exact: true })).toHaveCount(0);
  });

  test('negative P&L trade shows negative Return % correctly', async ({ page }) => {
    // Create a test account
    const accRes = await page.request.post('/api/accounts', {
      data: { name: 'E2E Perf Neg', isActive: true, startingBalance: 50000 },
    });
    expect(accRes.ok()).toBeTruthy();
    const account = await accRes.json();
    await prepareAccountForTrading(page.request, account.id);

    // Create a losing trade
    const tradeRes = await page.request.post('/api/trades', {
      data: { symbol: 'PERF-L', direction: 'long', accountId: account.id },
    });
    expect(tradeRes.ok()).toBeTruthy();
    const trade = await tradeRes.json();

    // Execute with a loss (exit price < entry price)
    // Entry: buy 100 x $100, fees $5.00
    // Exit: sell 100 x $80, fees $0
    // P&L before fees = (80-100)*100 = -$2,000
    // totalRealizedPnL = -2000 - 5.0 = -$2,005.00
    // Return % = -2005 / (100*100) * 100 = -20.05%
    const execRes = await page.request.post(`/api/trades/${trade.id}/execute`, {
      data: {
        entryPrice: 100.0,
        entryQuantity: 100,
        exit1Price: 80.0,
        exit1Quantity: 100,
        fees: 5.0,
      },
    });
    expect(execRes.ok()).toBeTruthy();
    const execData = await execRes.json();
    expect(execData.trade.status).toBe('closed');

    // Navigate to trade detail page
    await page.goto(`/trades/${trade.id}`);
    await expect(page.locator('h1')).toContainText('PERF-L');

    const card = page.locator('[data-slot="card"]').filter({
      has: page.getByText('Total Fees', { exact: true }),
    }).first();
    await expect(card).toBeVisible();

    // Verify negative Return %: (-2000 - 5 fees) / 10000 * 100 = -20.05%
    await expect(card.getByText('Return %')).toBeVisible();
    await expect(card.getByText('-20.05%')).toBeVisible();

    // Verify labels are correct (not prefixed)
    await expect(card.getByText('Realized P&L')).toBeVisible();

    // Verify total fees: $5.00
    await expect(card.getByText('Total Fees')).toBeVisible();
    await expect(card.getByText('$5.00')).toBeVisible();

    // Verify Duration: <1m
    await expect(card.getByText('<1m')).toBeVisible();
  });
});
