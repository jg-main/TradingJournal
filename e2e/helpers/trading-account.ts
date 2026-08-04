import { expect, type APIRequestContext } from '@playwright/test';

type TradingAccount = {
  id: string;
  name: string;
};

/**
 * Complete the account lifecycle required by the trade API.
 *
 * Account creation intentionally produces a Draft account. Tests that create
 * trades must configure risk defaults, fund the account, and activate it just
 * as the product workflow does.
 */
export async function prepareAccountForTrading(
  request: APIRequestContext,
  accountId: string,
): Promise<void> {
  const configResponse = await request.put(`/api/accounts/${accountId}`, {
    data: { maxRiskPerTradePct: 2, defaultCommission: 1 },
  });
  expect(configResponse.status()).toBe(200);

  const activationResponse = await request.put(`/api/accounts/${accountId}`, {
    data: { isActive: true },
  });
  expect(activationResponse.status()).toBe(200);

  const cashResponse = await request.post(`/api/accounts/${accountId}/financial-events`, {
    data: { eventType: 'opening_balance', amount: '50000.00' },
  });
  expect(cashResponse.status()).toBe(201);
}

export async function createTradingAccount(
  request: APIRequestContext,
  name: string,
): Promise<TradingAccount> {
  const createResponse = await request.post('/api/accounts', {
    data: { name, currency: 'USD' },
  });
  expect(createResponse.status()).toBe(201);

  const account = (await createResponse.json()) as TradingAccount;
  await prepareAccountForTrading(request, account.id);
  return account;
}
