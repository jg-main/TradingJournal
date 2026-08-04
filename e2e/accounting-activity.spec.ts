/**
 * Accounting ledger activity — end-to-end coverage.
 *
 * Financial events are created through the authoritative API and inspected in
 * the current account Ledger workspace. Event creation is API-owned until the
 * account redesign adds its planned ledger quick actions.
 */

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

async function createAccount(request: APIRequestContext, name: string) {
  const response = await request.post('/api/accounts', {
    data: { name, broker: 'E2E Broker', currency: 'USD' },
  });
  expect(response.status()).toBe(201);
  return response.json() as Promise<{ id: string; name: string }>;
}

async function postEvent(
  request: APIRequestContext,
  accountId: string,
  data: Record<string, unknown>,
) {
  const response = await request.post(`/api/accounts/${accountId}/financial-events`, { data });
  expect(response.status()).toBe(201);
  return response;
}

function ledgerRow(page: Page, description: string) {
  return page.getByRole('row').filter({ hasText: description });
}

test.describe('Accounting ledger activity', () => {
  test('shows diverse authoritative events, filters them, and rejects duplicate idempotency keys', async ({ page }) => {
    const account = await createAccount(page.request, `Activity Test ${Date.now()}`);

    await postEvent(page.request, account.id, {
      eventType: 'opening_balance',
      amount: '10000.00',
      description: 'Opening balance',
    });
    await postEvent(page.request, account.id, {
      eventType: 'deposit',
      amount: '5000.00',
      description: 'Wire transfer deposit',
    });
    await postEvent(page.request, account.id, {
      eventType: 'withdrawal',
      amount: '2000.00',
      description: 'ATM withdrawal',
    });
    await postEvent(page.request, account.id, {
      eventType: 'stock_split',
      symbol: 'AAPL',
      ratio: '4:1',
      oldShares: 100,
      newShares: 400,
      oldPrice: '200.00',
      newPrice: '50.00',
      description: 'AAPL 4:1 stock split',
    });

    await page.goto(`/settings/accounts/${account.id}/ledger`);
    await expect(page.getByRole('tab', { name: 'Ledger' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('4 events')).toBeVisible();

    await expect(ledgerRow(page, 'Opening balance')).toContainText('Opening');
    await expect(ledgerRow(page, 'Opening balance')).toContainText('$10,000.00');
    await expect(ledgerRow(page, 'Wire transfer deposit')).toContainText('Deposit');
    await expect(ledgerRow(page, 'Wire transfer deposit')).toContainText('$5,000.00');
    await expect(ledgerRow(page, 'ATM withdrawal')).toContainText('Withdrawal');
    await expect(ledgerRow(page, 'ATM withdrawal')).toContainText('-$2,000.00');
    await expect(ledgerRow(page, 'AAPL 4:1 stock split')).toContainText('Split');
    await expect(ledgerRow(page, 'AAPL 4:1 stock split')).toContainText('Posted');

    await page.getByRole('button', { name: 'Cash', exact: true }).click();
    await expect(page.getByText('2 events (filtered)')).toBeVisible();
    await expect(ledgerRow(page, 'Wire transfer deposit')).toBeVisible();
    await expect(ledgerRow(page, 'ATM withdrawal')).toBeVisible();
    await expect(ledgerRow(page, 'Opening balance')).toHaveCount(0);

    const idempotencyKey = crypto.randomUUID();
    await postEvent(page.request, account.id, {
      eventType: 'interest',
      amount: '25.50',
      idempotencyKey,
      description: 'Duplicate key test',
    });
    const duplicate = await page.request.post(`/api/accounts/${account.id}/financial-events`, {
      data: {
        eventType: 'interest',
        amount: '999.99',
        idempotencyKey,
        description: 'This should conflict',
      },
    });
    expect(duplicate.status()).toBe(409);
    await expect(duplicate.json()).resolves.toMatchObject({ error: 'Duplicate idempotency key' });

    await page.reload();
    await expect(page.getByText('5 events')).toBeVisible();
    await expect(ledgerRow(page, 'Duplicate key test')).toBeVisible();
    await expect(page.getByText('This should conflict')).toHaveCount(0);
  });

  test('shows the current ledger empty state when no events exist', async ({ page }) => {
    const account = await createAccount(page.request, `Empty Activity ${Date.now()}`);

    await page.goto(`/settings/accounts/${account.id}/ledger`);

    await expect(page.getByText('No ledger events yet.')).toBeVisible();
    await expect(page.getByText('Post financial events or executions to see activity here.')).toBeVisible();
    await expect(page.getByText('No events', { exact: true })).toBeVisible();
  });

  test('renders positive and negative manual adjustments with balanced posting details', async ({ page }) => {
    const account = await createAccount(page.request, `Manual Adjustment ${Date.now()}`);

    await postEvent(page.request, account.id, {
      eventType: 'opening_balance',
      amount: '5000.00',
      description: 'Adjustment opening balance',
    });
    await postEvent(page.request, account.id, {
      eventType: 'manual_adjustment',
      amount: '250.00',
      reason: 'Rounding fix',
      description: 'Positive rounding adjustment',
    });
    await postEvent(page.request, account.id, {
      eventType: 'manual_adjustment',
      amount: '-100.00',
      reason: 'Over-credit fix',
      description: 'Negative rounding adjustment',
    });

    await page.goto(`/settings/accounts/${account.id}/ledger`);
    await page.getByRole('button', { name: 'Adjustment', exact: true }).click();
    await expect(page.getByText('2 events (filtered)')).toBeVisible();

    const positive = ledgerRow(page, 'Positive rounding adjustment');
    const negative = ledgerRow(page, 'Negative rounding adjustment');
    await expect(positive).toContainText('Adjust');
    await expect(positive).toContainText('$250.00');
    await expect(negative).toContainText('Adjust');
    await expect(negative).toContainText('-$100.00');

    await positive.getByRole('button', { name: 'Expand details' }).click();
    const details = page.getByRole('region', { name: /Positive rounding adjustment/ });
    await expect(details).toContainText('Debit');
    await expect(details).toContainText('Credit');
    await expect(details).toContainText('Balanced');
  });
});
