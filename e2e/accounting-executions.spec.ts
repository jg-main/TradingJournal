import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * E2E tests for the accounting execution entry and FIFO position views.
 *
 * Tests the full lifecycle: create account → deposit funds → buy → partial sell
 * → sell short → cover → verify positions, lots, realized P&L, and error states.
 *
 * Uses the request fixture (not page) in beforeAll for setup,
 * then page for browser-based UI verification.
 */

test.describe.configure({ mode: 'serial' });

let accountId: string;
let accountName: string;

async function createAccountViaApi(request: APIRequestContext) {
  const name = `Accounting Exec E2E ${Date.now()}`;
  const response = await request.post('/api/accounts', {
    data: {
      name,
      broker: 'E2E Test Broker',
      currency: 'USD',
      startingBalance: 0,
    },
  });
  expect(response.status()).toBe(201);
  const account = await response.json();
  accountId = account.id;
  accountName = account.name;
}

async function postDepositViaApi(request: APIRequestContext) {
  const response = await request.post(`/api/accounts/${accountId}/transactions`, {
    data: {
      type: 'deposit',
      amount: 100000.0,
      notes: 'E2E test deposit',
    },
  });
  expect(response.status()).toBe(201);
}

async function postExecutionApi(
  request: APIRequestContext,
  data: {
    symbol: string;
    action: string;
    quantity: string;
    price: string;
    fees?: string;
    description?: string;
  },
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await request.post(`/api/accounts/${accountId}/executions`, {
    data: {
      symbol: data.symbol,
      action: data.action,
      quantity: data.quantity,
      price: data.price,
      fees: data.fees ?? '0.00',
      ...(data.description ? { description: data.description } : {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status(), body };
}

async function getPositionsApi(
  request: APIRequestContext,
): Promise<{ positions: Array<Record<string, unknown>>; total: number }> {
  const response = await request.get(`/api/accounts/${accountId}/positions`);
  expect(response.status()).toBe(200);
  return (await response.json()) as { positions: Array<Record<string, unknown>>; total: number };
}

test.describe('Accounting Executions — Setup account and verify access', () => {
  test.beforeAll(async ({ request }) => {
    await createAccountViaApi(request);
    await postDepositViaApi(request);
  });

  test('shows the Trade Executions section on the settings account page', async ({ page }) => {
    await page.goto(`/accounts/${accountId}`);
    await expect(page.getByText('Trade Executions')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Post Execution' })).toBeVisible();
    await expect(page.getByText('Current Positions')).toBeVisible();
    await expect(page.getByText('Execution Activity')).toBeVisible();
  });

  test('opens the Post Execution form and shows required fields', async ({ page }) => {
    await page.goto(`/accounts/${accountId}`);
    await page.getByRole('button', { name: 'Post Execution' }).click();

    // Check all form fields are visible
    await expect(page.getByText('Post Execution Fill')).toBeVisible();
    await expect(page.getByPlaceholder('e.g. AAPL')).toBeVisible();
    await expect(page.getByPlaceholder('e.g. 100')).toBeVisible();
    await expect(page.getByPlaceholder('e.g. 150.75')).toBeVisible();

    // Submit with empty fields triggers validation
    await page.getByRole('button', { name: 'Post Execution' }).click();
    await expect(page.getByText('Symbol is required.')).toBeVisible();
  });

  test('posts a buy execution and verifies positions and activity', async ({ page, request }) => {
    // Post a buy execution via API
    const buyResult = await postExecutionApi(request, {
      symbol: 'AAPL',
      action: 'buy',
      quantity: '100.00',
      price: '150.75',
      description: 'E2E test buy',
    });
    expect(buyResult.status).toBe(201);
    expect(buyResult.body.success).toBe(true);
    expect(buyResult.body.execution).toBeDefined();
    expect((buyResult.body.execution as Record<string, unknown>).action).toBe('buy');

    // Verify position exists via API
    const positions1 = await getPositionsApi(request);
    expect(positions1.total).toBe(1);
    const aaplPos = positions1.positions[0];
    expect(aaplPos.symbol).toBe('AAPL');
    expect(aaplPos.direction).toBe('long');
    expect(aaplPos.quantity).toBe('100.00');
    expect(aaplPos.openLots).toBeDefined();
    expect((aaplPos.openLots as Array<unknown>).length).toBe(1);

    // Verify the UI reflects the position
    await page.goto(`/accounts/${accountId}`);
    // Use first() for AAPL since it appears in both the positions card and execution activity table
    await expect(page.getByText('AAPL').first()).toBeVisible();
    await expect(page.getByText('long').first()).toBeVisible();
    await expect(page.getByText('100').first()).toBeVisible();

    // Verify execution activity shows the buy
    await expect(page.getByText('Buy').first()).toBeVisible();
  });

  test('posts a partial sell, verifies remaining lots and realized P&L', async ({ page, request }) => {
    // Post a partial sell via API
    const sellResult = await postExecutionApi(request, {
      symbol: 'AAPL',
      action: 'sell',
      quantity: '30.00',
      price: '160.00',
      fees: '5.00',
      description: 'E2E test partial sell',
    });
    expect(sellResult.status).toBe(201);
    expect(sellResult.body.success).toBe(true);
    expect((sellResult.body.execution as Record<string, unknown>).action).toBe('sell');

    // Verify position reduces to 70 remaining
    const positions2 = await getPositionsApi(request);
    expect(positions2.total).toBe(1);
    expect(positions2.positions[0].quantity).toBe('70.00');

    // Verify remaining lot and realized P&L
    const aaplPos2 = positions2.positions[0];
    expect(aaplPos2.realizedNetPnl).toBeDefined();

    // Verify the UI shows reduced position and P&L
    await page.goto(`/accounts/${accountId}`);
    await expect(page.getByText('AAPL').first()).toBeVisible();
    await expect(page.getByText('70').first()).toBeVisible();
  });

  test('sells short a different symbol and covers it', async ({ page, request }) => {
    // Post a sell_short via API
    const shortResult = await postExecutionApi(request, {
      symbol: 'TSLA',
      action: 'sell_short',
      quantity: '50.00',
      price: '200.00',
      fees: '10.00',
      description: 'E2E test short',
    });
    expect(shortResult.status).toBe(201);
    expect(shortResult.body.success).toBe(true);

    // Verify both positions exist
    const positions3 = await getPositionsApi(request);
    expect(positions3.total).toBe(2);

    const tslaPos = positions3.positions.find((p) => p.symbol === 'TSLA');
    expect(tslaPos).toBeDefined();
    expect(tslaPos!.direction).toBe('short');
    expect(tslaPos!.quantity).toBe('50.00');

    // Cover the short at a lower price
    const coverResult = await postExecutionApi(request, {
      symbol: 'TSLA',
      action: 'buy_to_cover',
      quantity: '50.00',
      price: '190.00',
      fees: '5.00',
      description: 'E2E test cover',
    });
    expect(coverResult.status).toBe(201);
    expect(coverResult.body.success).toBe(true);

    // TSLA should be gone from open positions or have zero quantity
    const positions4 = await getPositionsApi(request);
    const tslaPos2 = positions4.positions.find((p) => p.symbol === 'TSLA');
    if (tslaPos2) {
      expect(tslaPos2.quantity).toBe('0.00');
    }
  });

  test('rejects over-close with a clear error', async ({ request }) => {
    // AAPL has only 70 remaining, try to sell 100 — this is a reversal
    // because 100 > 70 would flip the position from long to short.
    const overCloseResult = await postExecutionApi(request, {
      symbol: 'AAPL',
      action: 'sell',
      quantity: '100.00',
      price: '170.00',
    });
    expect(overCloseResult.status).toBe(422);
    expect(overCloseResult.body.code).toBe('REVERSAL');
    expect(overCloseResult.body.message).toBeDefined();
  });

  test('rejects flip from long to short in one execution', async ({ request }) => {
    // The existing AAPL position is long 70; try to sell_short (flip)
    const flipResult = await postExecutionApi(request, {
      symbol: 'AAPL',
      action: 'sell_short',
      quantity: '10.00',
      price: '180.00',
    });
    expect(flipResult.status).toBe(422);
    expect(flipResult.body.code).toBe('UNSUPPORTED_FLIP');
    expect(flipResult.body.message).toBeDefined();
  });
});
