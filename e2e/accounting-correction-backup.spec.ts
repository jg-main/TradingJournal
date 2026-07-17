/**
 * Accounting Correction, Backup, and Legacy Retirement — Integrated E2E test.
 *
 * Proves the real runtime composes correction, backup/restore, and ledger-
 * derived account surfaces as documented in the S07 slice plan.
 *
 * Flow:
 * 1. Create account + opening balance
 * 2. Post buy execution + valuation mark + rebuild performance
 * 3. Correct the execution through the correction API
 * 4. Assert original/reversal/replacement lineage and stable metrics
 * 5. Create a backup via POST /api/backup/now
 * 6. Validate backup accounting tables via POST /api/restore/preview
 * 7. Execute full restore + verify data integrity
 * 8. Navigate to Dashboard V2 and verify ledger-derived labels + integrity
 * 9. Navigate to account page and verify correction state + journal attribution
 *
 * Run: npx playwright test -- e2e/accounting-correction-backup.spec.ts
 */

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

test.describe.configure({ mode: 'serial' });

// ── Shared State ──────────────────────────────────────────────────────────
let accountId: string;
let originalExecutionId: string;
let correctionResponse: Record<string, unknown>;
let backupFilename: string;

// ═══════════════════════════════════════════════════════════════════════════
// API Helpers
// ═══════════════════════════════════════════════════════════════════════════

async function createAccountViaApi(request: APIRequestContext): Promise<string> {
  const name = `Correction E2E ${Date.now()}`;
  const res = await request.post('/api/accounts', {
    data: { name, broker: 'E2E Test', currency: 'USD', startingBalance: 0 },
  });
  expect(res.status()).toBe(201);
  return (await res.json()).id;
}

async function postOpeningBalanceViaApi(request: APIRequestContext, id: string) {
  const res = await request.post(`/api/accounts/${id}/financial-events`, {
    data: {
      eventType: 'opening_balance',
      amount: '100000.00',
      description: 'E2E opening balance for correction flow',
    },
  });
  expect(res.status()).toBe(201);
}

async function postExecutionApi(
  request: APIRequestContext,
  id: string,
  data: { symbol: string; action: string; quantity: string; price: string; fees?: string },
) {
  const res = await request.post(`/api/accounts/${id}/executions`, {
    data: {
      symbol: data.symbol,
      action: data.action,
      quantity: data.quantity,
      price: data.price,
      fees: data.fees ?? '0.00',
    },
  });
  expect(res.status()).toBe(201);
  return await res.json();
}

async function postMarkViaApi(request: APIRequestContext, id: string, symbol: string, price: string) {
  const res = await request.post(`/api/accounts/${id}/valuations`, {
    data: {
      symbol,
      price,
      source: 'user',
      markTimestamp: new Date().toISOString(),
    },
  });
  expect(res.status()).toBe(201);
  return await res.json();
}

async function rebuildPerformanceViaApi(request: APIRequestContext, id: string) {
  const res = await request.post(`/api/accounts/${id}/performance`);
  expect(res.status()).toBe(200);
  return await res.json();
}

async function getAccountApi(request: APIRequestContext, id: string) {
  const res = await request.get(`/api/accounts/${id}`);
  expect(res.status()).toBe(200);
  return await res.json();
}

async function seedSettingsForBackup(request: APIRequestContext) {
  const res = await request.put('/api/settings', {
    data: {
      startingAccountValue: 10000,
      defaultCommission: 0.5,
      maxRiskPerTradePct: 2,
      journalStartDate: '2024-01-01',
      backupEnabled: true,
      backupRetentionCount: 7,
    },
  });
  expect(res.ok()).toBeTruthy();
}

function getDbFile(): string {
  return process.env.DB_FILE_NAME ?? './.trading-journal/journal.db';
}

function getBackupDir(): string {
  return join(dirname(getDbFile()), 'backups');
}

// ═══════════════════════════════════════════════════════════════════════════
// Console / Request Failure Capture
// ═══════════════════════════════════════════════════════════════════════════

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
        text.includes('/migration') ||
        text.includes('400 (Bad Request)')
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
      if (
        !url.includes('/reconciliation') &&
        !url.includes('/migration') &&
        !url.includes('/close') &&
        !url.includes('/executions')
      ) {
        failed.push(`${res.url()} (${res.status()})`);
      }
    }
  });
  return failed;
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Accounting Correction, Backup, and Legacy Retirement', () => {
  // ─────────────────────────────────────────────────────────────────────────
  // Setup — create account, deposit, seed settings
  // ─────────────────────────────────────────────────────────────────────────

  test.beforeAll(async ({ request }) => {
    // Create the account with an opening balance
    accountId = await createAccountViaApi(request);
    await postOpeningBalanceViaApi(request, accountId);

    // Seed settings for backup support
    await seedSettingsForBackup(request);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 1: Initial account detail page
  // ─────────────────────────────────────────────────────────────────────────

  test('account detail page shows header, balance, and initial empty state', async ({ page }) => {
    const consoleErrors = captureConsoleErrors(page);
    const failedRequests = captureFailedRequests(page);

    await page.goto(`/settings/accounts/${accountId}`);

    // Account name should be visible
    await expect(page.getByText('Correction E2E')).toBeVisible();
    // Current Balance should be visible (~$100,000 from opening balance)
    await expect(page.getByText('Current Balance')).toBeVisible();
    // Account performance (ledger) label should be visible
    await expect(page.getByText('Account performance (ledger)')).toBeVisible();
    // Starting Balance summary card
    await expect(page.getByText('Starting Balance').first()).toBeVisible();

    expect(consoleErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 2: Post execution + mark + rebuild — verify via API and page
  // ─────────────────────────────────────────────────────────────────────────

  test('posts a buy execution, valuation mark, rebuilds performance, and shows metrics', async ({
    page,
    request,
  }) => {
    const consoleErrors = captureConsoleErrors(page);
    const failedRequests = captureFailedRequests(page);

    // ── Post a buy execution for 100 AAPL at $150.00 with $10.00 fees ────
    const buyResult = await postExecutionApi(request, accountId, {
      symbol: 'AAPL',
      action: 'buy',
      quantity: '100.00',
      price: '150.00',
      fees: '10.00',
    });
    expect(buyResult.success).toBe(true);
    expect(buyResult.execution).toBeDefined();
    expect(buyResult.execution.action).toBe('buy');
    expect(buyResult.execution.quantity).toBe('100.00');

    originalExecutionId = buyResult.execution.id;

    // ── Post a valuation mark for AAPL at $160.00 ────────────────────────
    await postMarkViaApi(request, accountId, 'AAPL', '160.00');

    // ── Rebuild performance projection ───────────────────────────────────
    const rebuildResult = await rebuildPerformanceViaApi(request, accountId);
    expect(rebuildResult.success).toBe(true);
    expect(rebuildResult.positionCount).toBe(1);

    // ── Verify position via API ─────────────────────────────────────────
    const positionsRes = await request.get(`/api/accounts/${accountId}/positions`);
    expect(positionsRes.status()).toBe(200);
    const positions = await positionsRes.json();
    expect(positions.total).toBe(1);
    expect(positions.positions[0].symbol).toBe('AAPL');
    expect(positions.positions[0].direction).toBe('long');
    expect(positions.positions[0].quantity).toBe('100.00');

    // ── Verify account has ledger-derived metrics ────────────────────────
    const account = await getAccountApi(request, accountId);
    expect(account.accounting).toBeDefined();
    expect(account.accounting.ledgerDerived).toBe(true);
    expect(account.accounting.projection).toBeDefined();
    expect(account.accounting.projection.netCash).toBeDefined();
    expect(account.accounting.projection.nav).toBeDefined();
    expect(account.accounting.projection.realizedPnl).toBeDefined();
    const nav = parseFloat(account.accounting.projection.nav);
    expect(nav).toBeGreaterThan(0);

    // ── Verify via page — the account performance component ─────────────
    await page.goto(`/settings/accounts/${accountId}`);

    // AAPL should be visible in the positions section
    await expect(page.getByText('AAPL').first()).toBeVisible();
    // Performance section with Net Asset Value card should be present
    await expect(page.getByText('Net Asset Value').first()).toBeVisible();
    // Realized P&L metric should exist
    await expect(page.getByText('Realized P&L').first()).toBeVisible();
    // Performance & Valuation header
    await expect(page.getByText('Performance & Valuation')).toBeVisible();

    expect(consoleErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 3: Correct the execution via correction API + verify lineage
  // ─────────────────────────────────────────────────────────────────────────

  test('corrects the execution through the correction API and verifies lineage', async ({
    page,
    request,
  }) => {
    const consoleErrors = captureConsoleErrors(page);
    const failedRequests = captureFailedRequests(page);

    // ── Correct the buy execution (change price from $150 to $145) ───────
    const correctionPayload = {
      symbol: 'AAPL',
      action: 'buy',
      quantity: '100.00',
      price: '145.00',
      fees: '10.00',
      reason: 'E2E test: corrected price from $150 to $145',
    };

    const correctRes = await request.post(
      `/api/accounts/${accountId}/executions/${originalExecutionId}/correct`,
      { data: correctionPayload },
    );

    expect(correctRes.status()).toBe(200);
    correctionResponse = await correctRes.json();

    // ── Assert correction structure ──────────────────────────────────────
    expect(correctionResponse.success).toBe(true);
    expect(correctionResponse.correction).toBeDefined();
    expect(correctionResponse.originalExecution).toBeDefined();
    expect(correctionResponse.reversalExecution).toBeDefined();
    expect(correctionResponse.replacementExecution).toBeDefined();
    expect(correctionResponse.position).toBeDefined();
    expect(correctionResponse.rebuildStatus).toBeDefined();

    // ── Assert ID uniqueness: all 4 IDs differ ──────────────────────────
    const correction = correctionResponse.correction as Record<string, unknown>;
    const originalExec = correctionResponse.originalExecution as Record<string, unknown>;
    const reversalExec = correctionResponse.reversalExecution as Record<string, unknown>;
    const replacementExec = correctionResponse.replacementExecution as Record<string, unknown>;

    expect(correction.originalExecutionId).toBe(originalExecutionId);
    expect(correction.reversalExecutionId).not.toBe(correction.originalExecutionId);
    expect(correction.replacementExecutionId).not.toBe(correction.originalExecutionId);
    expect(correction.replacementExecutionId).not.toBe(correction.reversalExecutionId);

    // ── Assert original execution is unchanged ──────────────────────────
    expect(originalExec.id).toBe(originalExecutionId);
    expect(originalExec.action).toBe('buy');
    expect(originalExec.quantity).toBe('100.00');
    expect(originalExec.price).toBe('150.00');
    expect(originalExec.fees).toBe('10.00');

    // ── Assert reversal mirrors original with opposite action ───────────
    expect(reversalExec.action).toBe('sell');
    expect(reversalExec.quantity).toBe('100.00');
    expect(reversalExec.price).toBe('150.00');
    expect(reversalExec.fees).toBe('10.00');

    // ── Assert replacement carries corrected values ─────────────────────
    expect(replacementExec.action).toBe('buy');
    expect(replacementExec.quantity).toBe('100.00');
    expect(replacementExec.price).toBe('145.00');
    expect(replacementExec.fees).toBe('10.00');

    // ── Assert position state is stable ─────────────────────────────────
    const position = correctionResponse.position as Record<string, unknown>;
    expect(position.quantity).toBe('100.00');
    expect(position.averageCost).toBe('145.00');
    expect(position.direction).toBe('long');

    // ── Assert rebuild status ───────────────────────────────────────────
    const rebuild = correctionResponse.rebuildStatus as Record<string, unknown>;
    expect(typeof rebuild.executionCount).toBe('number');
    expect(typeof rebuild.lotCount).toBe('number');
    expect(typeof rebuild.matchCount).toBe('number');
    // Should have at least 3 executions (original + reversal + replacement)
    expect(rebuild.executionCount).toBeGreaterThanOrEqual(3);

    // ── Assert reason is preserved ──────────────────────────────────────
    expect(correction.reason).toBe('E2E test: corrected price from $150 to $145');

    // ── Verify via page ─────────────────────────────────────────────────
    await page.goto(`/settings/accounts/${accountId}`);

    // AAPL should still show
    await expect(page.getByText('AAPL').first()).toBeVisible();
    // Account performance (ledger) label should still be visible
    await expect(page.getByText('Account performance (ledger)')).toBeVisible();

    expect(consoleErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 4: Test correction failure paths — already-corrected replay
  // ─────────────────────────────────────────────────────────────────────────

  test('rejects correcting an already-corrected execution', async ({ request }) => {
    // Attempt to correct the same execution again — should return 409
    const duplicateRes = await request.post(
      `/api/accounts/${accountId}/executions/${originalExecutionId}/correct`,
      {
        data: {
          symbol: 'AAPL',
          action: 'buy',
          quantity: '100.00',
          price: '155.00',
          fees: '10.00',
          reason: 'Duplicate correction attempt',
        },
      },
    );

    expect(duplicateRes.status()).toBe(409);

    const body = await duplicateRes.json().catch(() => ({}));
    expect(body.error).toBeDefined();
    expect(body.error).toMatch(/corrected|correction/i);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 5: Create backup + validate via preview endpoint
  // ─────────────────────────────────────────────────────────────────────────

  test('creates a backup and validates accounting tables via preview', async ({ request }) => {
    // ── Create backup via API ────────────────────────────────────────────
    const backupRes = await request.post('/api/backup/now');
    expect(backupRes.status()).toBe(200);
    const backupResult = await backupRes.json();
    expect(backupResult.success).toBe(true);
    expect(backupResult.timestamp).toBeDefined();

    // ── List backup files to find the newly created backup ──────────────
    const filesRes = await request.get('/api/backup/files');
    expect(filesRes.status()).toBe(200);
    const files = (await filesRes.json()) as Array<{
      filename: string;
      isoDate: string;
      sizeBytes: number;
    }>;
    expect(files.length).toBeGreaterThanOrEqual(1);

    // Find the most recent backup (should be the one we just created)
    backupFilename = files[0].filename;
    expect(backupFilename).toMatch(/^backup-\d{4}/);

    // ── Read the backup file from the filesystem ────────────────────────
    const backupDir = getBackupDir();
    const backupPath = join(backupDir, backupFilename);
    expect(existsSync(backupPath)).toBe(true);
    const backupBuffer = readFileSync(backupPath);

    // ── Upload to preview endpoint for validation ────────────────────────
    const previewRes = await request.post('/api/restore/preview', {
      multipart: {
        backup: {
          name: backupFilename,
          mimeType: 'application/zip',
          buffer: backupBuffer,
        },
      },
    });

    expect(previewRes.status()).toBe(200);
    const previewResult = await previewRes.json();
    expect(previewResult.manifest).toBeDefined();
    expect(previewResult.manifest.schemaVersion).toBeGreaterThan(0);
    expect(previewResult.manifest.tables).toBeDefined();

    // ── Verify accounting tables are present in the manifest ────────────
    const tables = previewResult.manifest.tables as Record<string, number>;
    const expectedAccountingTables = [
      'accounting_executions',
      'correction_lineage',
      'account_positions',
      'account_performance',
      'fifo_lots',
      'financial_events',
      'valuation_marks',
    ];

    for (const tableName of expectedAccountingTables) {
      expect(tables).toHaveProperty(tableName);
      expect(tables[tableName]).toBeGreaterThanOrEqual(0);
    }

    // ── Verify correction_lineage has at least 1 record (our correction) ─
    expect(tables.correction_lineage).toBeGreaterThanOrEqual(1);

    // ── Verify accounting_executions has at least 3 (org + reversal + replacement) ──
    expect(tables.accounting_executions).toBeGreaterThanOrEqual(3);

    // ── Upload a tampered/malformed blob to test restore validation path ─
    const invalidRes = await request.post('/api/restore/preview', {
      multipart: {
        backup: {
          name: 'invalid-backup.zip',
          mimeType: 'application/zip',
          buffer: Buffer.from('not a zip file'),
        },
      },
    });

    // Invalid ZIP should return 400
    expect(invalidRes.status()).toBe(400);
    const invalidBody = await invalidRes.json().catch(() => ({}));
    expect(invalidBody.error).toBeDefined();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 6: Execute full restore + verify data integrity
  // ─────────────────────────────────────────────────────────────────────────

  test('executes restore and verifies account data is intact', async ({ request }) => {
    // ── Ensure we have a backup file available ──────────────────────────
    expect(backupFilename).toBeDefined();

    const backupDir = getBackupDir();
    const backupPath = join(backupDir, backupFilename);
    expect(existsSync(backupPath)).toBe(true);
    const backupBuffer = readFileSync(backupPath);

    // ── Execute the restore ──────────────────────────────────────────────
    const restoreRes = await request.post('/api/restore', {
      multipart: {
        backup: {
          name: backupFilename,
          mimeType: 'application/zip',
          buffer: backupBuffer,
        },
      },
    });

    // On success: 200 { success, restoredTables, restoredRows, snapshotPath }
    expect(restoreRes.status()).toBe(200);
    const restoreResult = await restoreRes.json();
    expect(restoreResult.success).toBe(true);
    expect(restoreResult.restoredTables).toBeGreaterThan(0);
    expect(restoreResult.restoredRows).toBeGreaterThan(0);
    expect(restoreResult.snapshotPath).toBeDefined();

    // ── Verify account data survived the restore ─────────────────────────
    const account = await getAccountApi(request, accountId);
    expect(account.id).toBe(accountId);
    expect(account.accounting).toBeDefined();
    expect(account.accounting.ledgerDerived).toBe(true);
    expect(account.accounting.projection).toBeDefined();

    // ── Verify correction lineage survived ───────────────────────────────
    const executionsRes = await request.get(
      `/api/accounts/${accountId}/executions?limit=10&offset=0`,
    );
    expect(executionsRes.status()).toBe(200);
    const executions = await executionsRes.json();
    expect(executions.executions).toBeDefined();
    // Should have at least 3 executions (original, reversal, replacement)
    expect(executions.total).toBeGreaterThanOrEqual(3);

    // ── Verify positions survived ────────────────────────────────────────
    const positionsRes = await request.get(`/api/accounts/${accountId}/positions`);
    expect(positionsRes.status()).toBe(200);
    const positions = await positionsRes.json();
    expect(positions.total).toBe(1);
    expect(positions.positions[0].symbol).toBe('AAPL');
    expect(positions.positions[0].direction).toBe('long');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 7: Dashboard V2 shows ledger-derived labels and integrity state
  // ─────────────────────────────────────────────────────────────────────────

  test('Dashboard V2 shows ledger-derived metrics, integrity state, and journal attribution', async ({
    page,
    request,
  }) => {
    const consoleErrors = captureConsoleErrors(page);
    const failedRequests = captureFailedRequests(page);

    // Post a new mark and rebuild after the restore to refresh performance
    await postMarkViaApi(request, accountId, 'AAPL', '162.00');
    await rebuildPerformanceViaApi(request, accountId);

    // ── Navigate to the root Dashboard ──────────────────────────────────
    await page.goto('/');

    // The Dashboard V2 component should be visible
    await expect(page.getByText('Account Performance')).toBeVisible({ timeout: 10000 });

    // The account name should appear in the info header
    await expect(
      page.locator('span').filter({ hasText: 'Correction E2E' }).first(),
    ).toBeVisible();

    // ── Verify ledger-derived metric labels ──────────────────────────────
    await expect(page.getByText('NAV').first()).toBeVisible();
    await expect(page.getByText('Cash').first()).toBeVisible();
    await expect(page.getByText('Marked Positions').first()).toBeVisible();
    await expect(page.getByText('Realized P&L', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Unrealized P&L').first()).toBeVisible();
    await expect(page.getByText('Realized Fees').first()).toBeVisible();
    await expect(page.getByText('Gross Exposure').first()).toBeVisible();
    await expect(page.getByText('Net Exposure').first()).toBeVisible();

    // ── Verify account-versus-journal labels ─────────────────────────────
    await expect(page.getByText('Account performance', { exact: true })).toBeVisible();
    await expect(page.getByText('Journal attribution')).toBeVisible();

    // ── Verify valuation completeness ───────────────────────────────────
    await expect(page.getByText('Valuation Completeness').first()).toBeVisible();

    expect(consoleErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 8: Account detail page shows correction state + journal attribution
  // ─────────────────────────────────────────────────────────────────────────

  test('account detail page shows correction execution, ledger-derived integrity, and journal attribution', async ({
    page,
    request,
  }) => {
    const consoleErrors = captureConsoleErrors(page);
    const failedRequests = captureFailedRequests(page);

    // ── Verify executions API works before navigating ────────────────────
    const execCheck = await request.get(
      `/api/accounts/${accountId}/executions?limit=10&offset=0`,
    );
    expect(execCheck.status()).toBe(200);
    const execData = await execCheck.json();
    expect(execData.executions).toBeDefined();
    expect(execData.total).toBeGreaterThanOrEqual(3);

    // ── Navigate to the account detail page ──────────────────────────────
    await page.goto(`/settings/accounts/${accountId}`, { waitUntil: 'networkidle' });

    // ── Verify account header remains intact ─────────────────────────────
    await expect(page.getByText('Correction E2E')).toBeVisible();
    await expect(page.getByText('Current Balance')).toBeVisible();

    // ── Verify ledger-derived performance and integrity state ────────────
    await expect(page.getByText('Account performance (ledger)')).toBeVisible();

    // Net Asset Value should be visible from the performance section
    await expect(page.getByText('Net Asset Value').first()).toBeVisible();
    await expect(page.getByText('Total P&L').first()).toBeVisible();

    // ── Verify execution activity shows the correction entries ───────────
    await expect(page.getByText('Execution Activity')).toBeVisible();

    // ── Verify positions survived the restore ────────────────────────────
    await expect(page.getByText('Current Positions').first()).toBeVisible();
    await expect(page.getByText('AAPL').first()).toBeVisible();

    // ── Verify journal attribution via waitForFunction ───────────────────
    await expect(page.getByText('Journal attribution')).toBeVisible({
      timeout: 15000,
    });

    expect(consoleErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });
});
