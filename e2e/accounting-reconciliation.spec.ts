/**
 * Accounting Reconciliation — e2e test.
 *
 * Exercises the full legacy migration and reconciliation pipeline through
 * the real dev server and API surface:
 *
 * 1. Create an account, run a full legacy migration
 * 2. Retrieve the reconciliation report and assert a passing response with
 *    all 7 comparison dimensions present and cutover eligible
 * 3. Create a second account with no migration and assert the gate refuses
 *    with a 400 error when no migration run exists
 * 4. Verify no console errors or failed network requests during either flow
 *
 * Server precondition: Requires the dev server running on port 3000.
 *   Start: npm run dev -- -p 3000 at http://localhost:3000
 *
 * Run: npx playwright test -- e2e/accounting-reconciliation.spec.ts
 */

import { test, expect } from '@playwright/test';

test.describe('Accounting Reconciliation — e2e', () => {
  // ── Helper: collect page errors into an array ─────────────────────

  async function captureConsoleErrors(page: import('@playwright/test').Page): Promise<string[]> {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        // Filter out benign extension/background errors
        const text = msg.text();
        if (!text.includes('favicon') && !text.includes('extension')) {
          errors.push(`[console.error] ${text}`);
        }
      }
    });
    return errors;
  }

  // ── Helper: check for failed network requests ─────────────────────

  async function captureFailedRequests(
    page: import('@playwright/test').Page,
  ): Promise<string[]> {
    const failed: string[] = [];
    page.on('requestfailed', (req) => {
      failed.push(`${req.url()} (${req.failure()?.errorText ?? 'unknown'})`);
    });
    page.on('response', (res) => {
      if (!res.ok() && res.status() >= 400) {
        // Expected errors (like the 400 we test for) are not diagnostic failures
        const url = res.url();
        if (
          !url.includes('/reconciliation') &&
          !url.includes('/migration')
        ) {
          failed.push(`${res.url()} (${res.status()})`);
        }
      }
    });
    return failed;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Test 1: Passing reconciliation after migration
  // ═══════════════════════════════════════════════════════════════════════

  test('returns passing reconciliation report with cutover eligible after migration', async ({
    page,
  }) => {
    const consoleErrors = await captureConsoleErrors(page);
    const failedRequests = await captureFailedRequests(page);

    // ── 1. Create an account ──────────────────────────────────────────
    const accRes = await page.request.post('/api/accounts', {
      data: {
        name: 'Reconciliation Passing Account',
        broker: 'E2E Broker',
        currency: 'USD',
        startingBalance: 0,
      },
    });
    expect(accRes.ok()).toBeTruthy();
    const account = await accRes.json();
    expect(account.id).toBeDefined();
    const accountId: string = account.id;

    // ── 2. Run a legacy migration ─────────────────────────────────────
    const migRes = await page.request.post(`/api/accounts/${accountId}/migration`);
    expect(migRes.ok()).toBeTruthy();
    const migration = await migRes.json();
    expect(migration.status).toBe('completed');
    expect(migration.runId).toBeDefined();
    expect(typeof migration.rebuildFingerprint).toBe('string');
    expect(migration.totalRecords).toBeGreaterThanOrEqual(0);
    expect(migration.anomalyCount).toBeGreaterThanOrEqual(0);

    // ── 3. Retrieve the reconciliation report ─────────────────────────
    const recRes = await page.request.get(
      `/api/accounts/${accountId}/reconciliation`,
    );
    expect(recRes.status()).toBe(200);

    const report = await recRes.json();

    // ── 4. Assert full report structure ────────────────────────────────
    expect(report.runId).toBe(migration.runId);
    expect(report.accountId).toBe(accountId);
    expect(report.runStatus).toBe('completed');
    expect(typeof report.computedAt).toBe('string');
    expect(typeof report.rebuildFingerprint).toBe('string');

    // Totals
    expect(report.totals).toBeDefined();
    expect(report.totals.comparisons).toBe(7);
    expect(typeof report.totals.matching).toBe('number');
    expect(typeof report.totals.unexplained).toBe('number');

    // Comparisons — all 7 must be present
    const comparisons = report.comparisons as Array<Record<string, unknown>>;
    expect(comparisons.length).toBe(7);
    const expectedKeys = [
      'cash',
      'execution_count',
      'fee_total',
      'price_mark_count',
      'position_count',
      'position_exposure',
      'net_asset_value',
    ];
    const actualKeys = comparisons.map((c) => c.key);
    for (const key of expectedKeys) {
      expect(actualKeys).toContain(key);
    }

    // Every comparison must have a classification
    for (const c of comparisons) {
      expect(['match', 'explained', 'unexplained']).toContain(c.classification);
      expect(typeof c.legacyValue).toBe('string');
      expect(typeof c.accountingValue).toBe('string');
      expect(typeof c.difference).toBe('string');
    }

    // Anomaly summaries
    expect(Array.isArray(report.anomalies)).toBe(true);

    // Record status counts
    expect(report.recordStatusCounts).toBeDefined();
    expect(typeof report.recordStatusCounts.totalRecords).toBe('number');
    expect(typeof report.recordStatusCounts.mappedCount).toBe('number');

    // ── 5. Assert cutover eligibility ──────────────────────────────────
    expect(report.cutoverEligible).toBe(true);
    expect(report.cutoverRefusalReasons).toEqual([]);

    // ── 6. Verify no diagnostic errors ─────────────────────────────────
    expect(consoleErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Test 2: Failing gate — no migration run
  // ═══════════════════════════════════════════════════════════════════════

  test('refuses cutover gate with 400 when no migration has been run', async ({
    page,
  }) => {
    const consoleErrors = await captureConsoleErrors(page);
    const failedRequests = await captureFailedRequests(page);

    // ── 1. Create an account with no migration ────────────────────────
    const accRes = await page.request.post('/api/accounts', {
      data: {
        name: 'Reconciliation Failing Account',
        broker: 'E2E Broker',
        currency: 'USD',
        startingBalance: 0,
      },
    });
    expect(accRes.ok()).toBeTruthy();
    const account = await accRes.json();
    expect(account.id).toBeDefined();
    const accountId: string = account.id;

    // ── 2. Call reconciliation without running migration ───────────────
    const recRes = await page.request.get(
      `/api/accounts/${accountId}/reconciliation`,
    );
    expect(recRes.status()).toBe(400);

    const body = await recRes.json();
    expect(body.error).toBe('No migration run found');
    expect(body.details).toContain(accountId);
    expect(body.details).toContain('migration');

    // ── 3. Verify no diagnostic errors ─────────────────────────────────
    expect(consoleErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });
});
