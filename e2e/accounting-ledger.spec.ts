/**
 * Accounting Ledger — e2e smoke test.
 *
 * Exercises the real POST /api/accounts/:id/financial-events endpoint
 * through a running dev server. Tests the full opening-balance flow:
 *
 * 1. Create an account
 * 2. Post opening cash through the endpoint
 * 3. Validate the balanced debit/credit response shape
 * 4. Reject duplicate idempotency key (409)
 * 5. Reject post to non-existent account (404)
 *
 * This is the smoke path that downstream slices (trade execution posting,
 * account rollforward, etc.) will extend.
 *
 * Run: npx playwright test -- e2e/accounting-ledger.spec.ts
 */

import { test, expect } from '@playwright/test';

test.describe('Accounting Ledger — opening balance flow', () => {
  test('posts opening balance, validates balanced response, rejects duplicates', async ({ page }) => {
    // 1. Create an account for the test
    const accRes = await page.request.post('/api/accounts', {
      data: {
        name: 'Ledger Flow Account',
        broker: 'E2E Broker',
        currency: 'USD',
        startingBalance: 0,
      },
    });
    expect(accRes.ok()).toBeTruthy();
    const account = await accRes.json();
    expect(account.id).toBeDefined();
    const accountId: string = account.id;

    // 2. Post opening balance through the real endpoint
    const eventRes = await page.request.post(`/api/accounts/${accountId}/financial-events`, {
      data: {
        eventType: 'opening_balance',
        amount: '5000.00',
        description: 'E2E opening balance test',
      },
    });
    expect(eventRes.status()).toBe(201);

    const body = await eventRes.json();
    expect(body.event).toBeDefined();
    expect(body.entry).toBeDefined();
    expect(body.postings).toBeDefined();

    // 3. Validate the event shape
    expect(body.event.accountId).toBe(accountId);
    expect(body.event.eventType).toBe('opening_balance');
    expect(body.event.description).toBe('E2E opening balance test');

    // 4. Validate balanced debit/credit postings
    const { debit, credit } = body.postings;
    expect(debit.side).toBe('debit');
    expect(debit.amount).toBe('5000.00');

    expect(credit.side).toBe('credit');
    expect(credit.amount).toBe('5000.00');

    // Debit and credit have the same amount (balanced)
    expect(debit.amountMicros).toBe(5_000_000_000);
    expect(credit.amountMicros).toBe(5_000_000_000);

    // Sequential ordering: debit before credit
    expect(credit.sequence).toBe(debit.sequence + 1);

    // Debit links back to the entry
    expect(debit.ledgerEntryId).toBe(body.entry.id);
    expect(credit.ledgerEntryId).toBe(body.entry.id);

    // 5. Duplicate idempotency key rejection
    const idempotencyKey = crypto.randomUUID();
    const dupRes1 = await page.request.post(`/api/accounts/${accountId}/financial-events`, {
      data: {
        eventType: 'opening_balance',
        amount: '3000.00',
        idempotencyKey,
      },
    });
    expect(dupRes1.status()).toBe(201);

    // Same key → must be 409
    const dupRes2 = await page.request.post(`/api/accounts/${accountId}/financial-events`, {
      data: {
        eventType: 'opening_balance',
        amount: '9999.00',
        idempotencyKey,
      },
    });
    expect(dupRes2.status()).toBe(409);

    const dupBody = await dupRes2.json();
    expect(dupBody.error).toBe('Duplicate idempotency key');

    // 6. Non-existent account returns 404
    const fakeId = crypto.randomUUID();
    const notFoundRes = await page.request.post(`/api/accounts/${fakeId}/financial-events`, {
      data: {
        eventType: 'opening_balance',
        amount: '100.00',
      },
    });
    expect(notFoundRes.status()).toBe(404);

    const notFoundBody = await notFoundRes.json();
    expect(notFoundBody.error).toBe('Account not found');
  });
});
