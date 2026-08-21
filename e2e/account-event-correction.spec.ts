/**
 * Financial Event Correction — end-to-end workflow test (S04/T03).
 *
 * Proves the full correction stack composes through the real browser and the
 * real API: the ledger page, the Correct row action, the reversal+replacement
 * correction dialog (required reason), the POST /financial-events/:id/correct
 * route, the canonical posting kernel, and the ledger projection's
 * corrected-state presentation with expandable lineage.
 *
 * Coverage:
 * 1. Ledger eligibility — Correct action on an eligible deposit row, and no
 *    Correct action on an ineligible opening_balance row.
 * 2. Dialog validation — pre-filled amount/description, required reason
 *    enforced client-side, confirm-step comparison, back/cancel navigation.
 * 3. Full user flow — open dialog, enter replacement values + reason, review,
 *    submit, success confirmation, auto-close, ledger refetch showing the
 *    Corrected badge with expandable lineage, and no Correct action on the
 *    corrected group row.
 * 4. Failure signals (slice contract) — 409 EVENT_ALREADY_CORRECTED,
 *    409 DUPLICATE_CORRECTION_IDEMPOTENCY_KEY, 422 EVENT_NOT_CORRECTABLE.
 * 5. Immutable lineage + netting via the ledger API — one group row per
 *    correction (original/reversal/replacement IDs + reason), no standalone
 *    constituent rows, and the cash projection nets the corrected stream.
 *
 * Precondition: Next.js dev-server running (Playwright webServer auto-starts).
 * Run: npx playwright test e2e/account-event-correction.spec.ts --project=chromium
 */

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { hideDevOverlay } from './helpers';

test.describe.configure({ mode: 'serial' });

// ── Shared State ──────────────────────────────────────────────────────────
let accountId: string;
/** Original deposit event corrected through the UI (5000.00 → 7500.00). */
let uiDepositEventId: string;
/** Second deposit used for the idempotency-key guard via the API. */
let guardDepositEventId: string;
/** Ineligible control event (opening_balance). */
let openingEventId: string;
/** Captured from the UI correction POST response. */
let uiReversalEventId: string;
let uiReplacementEventId: string;
/** Idempotency key used by the API-level guard correction (must be a canonical UUID). */
const guardIdempotencyKey = crypto.randomUUID();

// ── Constants ─────────────────────────────────────────────────────────────
const OPENING_DESCRIPTION = 'E2E opening balance';
const UI_DEPOSIT_DESCRIPTION = 'E2E deposit for correction';
const GUARD_DEPOSIT_DESCRIPTION = 'E2E deposit for idempotency guard';
const REPLACEMENT_DESCRIPTION = 'Corrected deposit (E2E)';
const CORRECTION_REASON = 'E2E correction: wrong deposit amount';

// ── API Helpers ───────────────────────────────────────────────────────────

async function createAccount(request: APIRequestContext, name: string): Promise<string> {
  const res = await request.post('/api/accounts', {
    data: { name, broker: 'E2E Broker', currency: 'USD' },
  });
  expect(res.status(), `create account: ${res.status()}`).toBe(201);
  const body = (await res.json()) as { id: string };
  return body.id;
}

async function postFinancialEvent(
  request: APIRequestContext,
  id: string,
  eventType: string,
  amount: string,
  description: string,
): Promise<{ event: { id: string; eventType: string } }> {
  const res = await request.post(`/api/accounts/${id}/financial-events`, {
    data: { eventType, amount, description },
  });
  expect(res.status(), `post ${eventType}: ${res.status()}`).toBe(201);
  return (await res.json()) as { event: { id: string; eventType: string } };
}

async function correctFinancialEventApi(
  request: APIRequestContext,
  id: string,
  eventId: string,
  data: { amount: string; reason: string; description?: string; idempotencyKey?: string },
) {
  return request.post(`/api/accounts/${id}/financial-events/${eventId}/correct`, {
    data,
  });
}

// ── Console / Request Failure Capture ─────────────────────────────────────

function captureConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (
        text.includes('favicon') ||
        text.includes('extension') ||
        text.includes('/reconciliation') ||
        text.includes('/migration')
      ) {
        return;
      }
      errors.push(`[console.error] ${text}`);
    }
  });
  return errors;
}

function captureFailedRequests(page: Page): string[] {
  const failed: string[] = [];
  page.on('requestfailed', (req) => {
    failed.push(`${req.url()} (${req.failure()?.errorText ?? 'unknown'})`);
  });
  page.on('response', (res) => {
    if (!res.ok() && res.status() >= 400) {
      const url = res.url();
      if (!url.includes('/reconciliation') && !url.includes('/migration')) {
        failed.push(`${res.url()} (${res.status()})`);
      }
    }
  });
  return failed;
}

/** Wait for the ledger to load after navigation. */
async function waitForLedger(page: Page, id: string) {
  await page.waitForResponse(
    (res) => res.url().includes(`/api/accounts/${id}/ledger`) && res.status() === 200,
    { timeout: 15_000 },
  );
}

// ══════════════════════════════════════════════════════════════════════════
// Tests
// ══════════════════════════════════════════════════════════════════════════

test.describe('Financial Event Correction workflow', () => {
  // ───────────────────────────────────────────────────────────────────────
  // Setup — account + opening balance + two deposits
  // ───────────────────────────────────────────────────────────────────────

  test('setup: creates account, posts opening balance and two deposits', async ({ request }) => {
    accountId = await createAccount(request, `Event Correction E2E ${Date.now()}`);

    const opening = await postFinancialEvent(
      request,
      accountId,
      'opening_balance',
      '10000.00',
      OPENING_DESCRIPTION,
    );
    openingEventId = opening.event.id;

    const uiDeposit = await postFinancialEvent(
      request,
      accountId,
      'deposit',
      '5000.00',
      UI_DEPOSIT_DESCRIPTION,
    );
    uiDepositEventId = uiDeposit.event.id;

    const guardDeposit = await postFinancialEvent(
      request,
      accountId,
      'deposit',
      '1000.00',
      GUARD_DEPOSIT_DESCRIPTION,
    );
    guardDepositEventId = guardDeposit.event.id;

    // Sanity: all three events are distinct and present in the ledger.
    const ledgerRes = await request.get(`/api/accounts/${accountId}/ledger?limit=50`);
    expect(ledgerRes.status()).toBe(200);
    const ledger = (await ledgerRes.json()) as {
      events: Array<{ eventId: string; eventType: string; cashImpact: string | null }>;
    };
    expect(ledger.events).toHaveLength(3);
    const ids = new Set(ledger.events.map((e) => e.eventId));
    expect(ids.has(openingEventId)).toBe(true);
    expect(ids.has(uiDepositEventId)).toBe(true);
    expect(ids.has(guardDepositEventId)).toBe(true);
    const uiDepositRow = ledger.events.find((e) => e.eventId === uiDepositEventId);
    expect(uiDepositRow?.cashImpact).toBe('5000.00');
  });

  // ───────────────────────────────────────────────────────────────────────
  // Ledger eligibility — Correct action on eligible rows only
  // ───────────────────────────────────────────────────────────────────────

  test('ledger shows Correct on the eligible deposit row but not on opening_balance', async ({
    page,
  }) => {
    const consoleErrors = captureConsoleErrors(page);
    const failedRequests = captureFailedRequests(page);
    await hideDevOverlay(page);

    await page.goto(`/settings/accounts/${accountId}/ledger`);
    await waitForLedger(page, accountId);

    // Eligible deposit row renders the Correct action.
    const depositRow = page.locator('tr', { hasText: UI_DEPOSIT_DESCRIPTION });
    await expect(depositRow.getByLabel(/^Correct deposit event/)).toBeVisible();

    // Ineligible opening_balance row must NOT render a Correct action.
    const openingRow = page.locator('tr', { hasText: OPENING_DESCRIPTION });
    await expect(openingRow.getByLabel(/^Correct opening_balance event/)).toHaveCount(0);

    // Cash impacts render for the deposit rows.
    await expect(depositRow.getByText('$5,000.00')).toBeVisible();
    await expect(page.getByText(GUARD_DEPOSIT_DESCRIPTION)).toBeVisible();

    expect(consoleErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });

  // ───────────────────────────────────────────────────────────────────────
  // Dialog validation — pre-fill, required reason, confirm comparison
  // ───────────────────────────────────────────────────────────────────────

  test('correction dialog pre-fills values and enforces the required reason', async ({ page }) => {
    const consoleErrors = captureConsoleErrors(page);
    const failedRequests = captureFailedRequests(page);
    await hideDevOverlay(page);

    await page.goto(`/settings/accounts/${accountId}/ledger`);
    await waitForLedger(page, accountId);

    // Open the correction dialog on the eligible deposit.
    await page
      .locator('tr', { hasText: UI_DEPOSIT_DESCRIPTION })
      .getByLabel(/^Correct deposit event/)
      .click();

    await expect(page.getByRole('dialog', { name: 'Correct Financial Event' })).toBeVisible();
    await expect(page.getByText('Original Event', { exact: true })).toBeVisible();

    // Pre-filled amount and description from the ledger row.
    await expect(page.locator('#corr-amount')).toHaveValue('5000.00');
    await expect(page.locator('#corr-description')).toHaveValue(UI_DEPOSIT_DESCRIPTION);

    // Required reason: submitting with an empty reason stays on the form step.
    await page.getByRole('button', { name: 'Review Correction' }).click();
    await expect(page.getByText('Correction reason is required')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirm Correction' })).toHaveCount(0);

    // Fill the replacement values and a reason, then review.
    await page.locator('#corr-amount').fill('7500.00');
    await page.locator('#corr-description').fill(REPLACEMENT_DESCRIPTION);
    await page.locator('#corr-reason').fill(CORRECTION_REASON);
    await page.getByRole('button', { name: 'Review Correction' }).click();

    // Confirm step shows the comparison table with original vs replacement.
    await expect(page.getByText('Confirm Correction').first()).toBeVisible();
    await expect(page.getByText('$7,500.00').first()).toBeVisible();
    await expect(page.getByText(CORRECTION_REASON)).toBeVisible();
    await expect(page.getByText(REPLACEMENT_DESCRIPTION)).toBeVisible();

    // Back returns to the form; Cancel closes the dialog without submitting.
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByRole('button', { name: 'Review Correction' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog', { name: 'Correct Financial Event' })).toHaveCount(0);

    expect(consoleErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });

  // ───────────────────────────────────────────────────────────────────────
  // Full correction flow — submit through the UI and verify corrected state
  // ───────────────────────────────────────────────────────────────────────

  test('corrects the deposit through the dialog and sees the lineage in the ledger', async ({
    page,
  }) => {
    const consoleErrors = captureConsoleErrors(page);
    const failedRequests = captureFailedRequests(page);
    await hideDevOverlay(page);

    await page.goto(`/settings/accounts/${accountId}/ledger`);
    await waitForLedger(page, accountId);

    // Open the correction dialog.
    await page
      .locator('tr', { hasText: UI_DEPOSIT_DESCRIPTION })
      .getByLabel(/^Correct deposit event/)
      .click();
    await expect(page.getByRole('dialog', { name: 'Correct Financial Event' })).toBeVisible();

    // Enter replacement values + required reason.
    await page.locator('#corr-amount').fill('7500.00');
    await page.locator('#corr-description').fill(REPLACEMENT_DESCRIPTION);
    await page.locator('#corr-reason').fill(CORRECTION_REASON);
    await page.getByRole('button', { name: 'Review Correction' }).click();

    // Submit and capture the API response.
    const correctResponsePromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/accounts/${accountId}/financial-events/`) &&
        res.url().endsWith('/correct') &&
        res.status() === 200,
      { timeout: 15_000 },
    );
    await page.getByRole('button', { name: 'Confirm Correction' }).click();

    // Success confirmation appears.
    await expect(page.getByText('Correction Posted')).toBeVisible({ timeout: 15_000 });

    const correctResponse = await correctResponsePromise;
    const correctionBody = (await correctResponse.json()) as {
      success: boolean;
      correction: {
        id: string;
        originalEventId: string;
        reversalEventId: string;
        replacementEventId: string;
        reason: string;
      };
      originalEvent: { id: string; amount: string };
      reversalEvent: { id: string };
      replacementEvent: { id: string };
    };
    expect(correctionBody.success).toBe(true);
    expect(correctionBody.correction.originalEventId).toBe(uiDepositEventId);
    expect(correctionBody.correction.reason).toBe(CORRECTION_REASON);
    expect(correctionBody.correction.reversalEventId).not.toBe(uiDepositEventId);
    expect(correctionBody.correction.replacementEventId).not.toBe(correctionBody.correction.reversalEventId);

    uiReversalEventId = correctionBody.correction.reversalEventId;
    uiReplacementEventId = correctionBody.correction.replacementEventId;

    // Dialog auto-closes after success and the ledger refetches.
    await expect(page.getByRole('dialog', { name: 'Correct Financial Event' })).toHaveCount(0, {
      timeout: 10_000,
    });

    // Corrected-state presentation: group row with Corrected badge and $7,500.00.
    const groupRow = page.locator('tr', { hasText: REPLACEMENT_DESCRIPTION });
    await expect(groupRow).toBeVisible({ timeout: 15_000 });
    await expect(groupRow.getByText('Corrected', { exact: true })).toBeVisible();
    await expect(groupRow.getByText('$7,500.00')).toBeVisible();

    // The original row is gone — the group substituted it.
    await expect(page.getByText('$5,000.00')).toHaveCount(0);
    await expect(page.getByText(UI_DEPOSIT_DESCRIPTION)).toHaveCount(0);

    // No Correct action on the corrected group row.
    await expect(groupRow.getByLabel(/^Correct deposit event/)).toHaveCount(0);

    // Expand the group row: full correction lineage with the required reason.
    await groupRow.getByLabel('Expand details').click();
    await expect(page.getByText('Correction Lineage')).toBeVisible();
    await expect(page.getByText('Original:', { exact: false })).toBeVisible();
    await expect(page.getByText('Reversal:', { exact: false })).toBeVisible();
    await expect(page.getByText('Replacement:', { exact: false })).toBeVisible();
    await expect(page.getByText(`Reason: ${CORRECTION_REASON}`)).toBeVisible();
    await expect(page.getByText(/Corrected: /)).toBeVisible();

    // Lineage constituent IDs match the API response.
    await expect(page.getByText(uiReversalEventId.slice(0, 12))).toBeVisible();
    await expect(page.getByText(uiReplacementEventId.slice(0, 12))).toBeVisible();

    expect(consoleErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });

  // ───────────────────────────────────────────────────────────────────────
  // Failure signals — 409/422 readable error codes (slice contract)
  // ───────────────────────────────────────────────────────────────────────

  test('rejects already-corrected, duplicate idempotency, and non-correctable events', async ({
    request,
  }) => {
    // 1. Replaying a correction on the already-corrected original → 409.
    const alreadyRes = await correctFinancialEventApi(request, accountId, uiDepositEventId, {
      amount: '8000.00',
      reason: 'E2E duplicate attempt',
    });
    expect(alreadyRes.status()).toBe(409);
    const alreadyBody = (await alreadyRes.json()) as { error: string; code?: string };
    expect(alreadyBody.code).toBe('EVENT_ALREADY_CORRECTED');

    // 2. Correcting an ineligible event type → 422.
    const ineligibleRes = await correctFinancialEventApi(request, accountId, openingEventId, {
      amount: '20000.00',
      reason: 'E2E ineligible attempt',
    });
    expect(ineligibleRes.status()).toBe(422);
    const ineligibleBody = (await ineligibleRes.json()) as { error: string; code?: string };
    expect(ineligibleBody.code).toBe('EVENT_NOT_CORRECTABLE');

    // 3. First correction with an idempotency key succeeds.
    const firstIdemRes = await correctFinancialEventApi(request, accountId, guardDepositEventId, {
      amount: '1200.00',
      reason: 'E2E idempotent correction',
      idempotencyKey: guardIdempotencyKey,
    });
    expect(firstIdemRes.status()).toBe(200);
    const firstIdemBody = (await firstIdemRes.json()) as {
      correction: { originalEventId: string };
    };
    expect(firstIdemBody.correction.originalEventId).toBe(guardDepositEventId);

    // 4. Replaying the same idempotency key → 409 (checked before already-corrected).
    const dupIdemRes = await correctFinancialEventApi(request, accountId, guardDepositEventId, {
      amount: '9999.00',
      reason: 'E2E idempotency replay',
      idempotencyKey: guardIdempotencyKey,
    });
    expect(dupIdemRes.status()).toBe(409);
    const dupIdemBody = (await dupIdemRes.json()) as { error: string; code?: string };
    expect(dupIdemBody.code).toBe('DUPLICATE_CORRECTION_IDEMPOTENCY_KEY');
  });

  // ───────────────────────────────────────────────────────────────────────
  // Immutable lineage + netting via the ledger API
  // ───────────────────────────────────────────────────────────────────────

  test('ledger projection shows one group row per correction with netted cash', async ({
    request,
  }) => {
    const ledgerRes = await request.get(`/api/accounts/${accountId}/ledger?limit=50`);
    expect(ledgerRes.status()).toBe(200);
    const ledger = (await ledgerRes.json()) as {
      events: Array<{
        eventId: string;
        eventType: string;
        description: string | null;
        cashImpact: string | null;
        correctionGroup: {
          correctionId: string;
          originalEventId: string;
          reversalEventId: string;
          replacementEventId: string;
          reason: string | null;
          correctedAt: string;
        } | null;
      }>;
    };

    // UI correction group row — replacement data with full lineage.
    const uiGroupRow = ledger.events.find((e) => e.description === REPLACEMENT_DESCRIPTION);
    expect(uiGroupRow).toBeDefined();
    expect(uiGroupRow!.eventType).toBe('deposit');
    expect(uiGroupRow!.cashImpact).toBe('7500.00');
    expect(uiGroupRow!.correctionGroup).not.toBeNull();
    expect(uiGroupRow!.correctionGroup!.originalEventId).toBe(uiDepositEventId);
    expect(uiGroupRow!.correctionGroup!.reversalEventId).toBe(uiReversalEventId);
    expect(uiGroupRow!.correctionGroup!.replacementEventId).toBe(uiReplacementEventId);
    expect(uiGroupRow!.correctionGroup!.reason).toBe(CORRECTION_REASON);
    expect(uiGroupRow!.eventId).toBe(uiGroupRow!.correctionGroup!.correctionId);

    // API-guarded correction group row exists too.
    const guardGroupRows = ledger.events.filter(
      (e) => e.correctionGroup !== null && e.correctionGroup!.originalEventId === guardDepositEventId,
    );
    expect(guardGroupRows).toHaveLength(1);
    expect(guardGroupRows[0].cashImpact).toBe('1200.00');

    // Immutability: original, reversal, and replacement are NOT standalone rows.
    const primaryEventIds = ledger.events.map((e) => e.eventId);
    expect(primaryEventIds).not.toContain(uiDepositEventId);
    expect(primaryEventIds).not.toContain(uiReversalEventId);
    expect(primaryEventIds).not.toContain(uiReplacementEventId);
    expect(primaryEventIds).not.toContain(guardDepositEventId);

    // Netting: opening 10000 + corrected deposit 7500 + corrected guard 1200.
    const totalCash = ledger.events.reduce(
      (acc, e) => acc + parseFloat(e.cashImpact ?? '0'),
      0,
    );
    expect(totalCash).toBe(18_700);

    // No duplicates: every event id appears at most once.
    const uniqueIds = new Set(primaryEventIds);
    expect(uniqueIds.size).toBe(primaryEventIds.length);
  });
});
