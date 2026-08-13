import { test, expect, type APIRequestContext } from '@playwright/test';

/**
 * Seed an active account so the no-accountId MTM contract test resolves an
 * account deterministically. Playwright gives each invocation a fresh
 * disposable DB (playwright.config.ts), so GET /api/dashboard without an
 * accountId would otherwise 400 "No active account found".
 */
async function seedActiveAccount(request: APIRequestContext): Promise<void> {
  const create = await request.post('/api/accounts', {
    data: { name: 'MTM Contract Account', broker: 'E2E', currency: 'USD' },
  });
  expect(create.status()).toBe(201);
  const account = (await create.json()) as { id: string };
  const activate = await request.put(`/api/accounts/${account.id}`, {
    data: { isActive: true },
  });
  expect(activate.ok()).toBeTruthy();
}

test.describe('Dashboard mark-to-market contract', () => {
  test('API returns the MTM summary shape', async ({ request }) => {
    await seedActiveAccount(request);
    const response = await request.get('/api/dashboard');
    expect(response.ok()).toBeTruthy();
    const data = await response.json();

    expect(data.mtm).toEqual(
      expect.objectContaining({
        openTradeCount: expect.any(Number),
        tradesWithPrices: expect.any(Number),
        tradesAwaitingData: expect.any(Number),
      }),
    );
    expect(data.mtm).toHaveProperty('netUnrealizedPnl');
  });

  test('production workstation renders risk and MTM status', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByTestId('ws-panel-risk')).toBeVisible();
    await expect(page.getByTestId('ws-panel-risk').getByText('Open P&L')).toBeVisible();
    await expect(page.locator('[data-testid^="ws-mtm-"]')).toBeVisible();
  });

  test('production grid remains intact while MTM data loads', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('ws-grid')).toBeVisible();
    await expect(page.getByTestId('ws-panel-risk')).toBeVisible();
    expect(errors.filter((error) => !error.includes('favicon'))).toEqual([]);
  });
});
