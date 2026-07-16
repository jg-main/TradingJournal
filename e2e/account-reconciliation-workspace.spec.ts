/**
 * E2E browser test for the Account Reconciliation workspace.
 *
 * Verifies healthy (cutover-eligible) and blocked (no-migration) states
 * through actual browser navigation, not just API calls.
 *
 * Server precondition: Requires the dev server running on port 3000.
 *   The webServer block in playwright.config.ts launches it automatically.
 *
 * Run: npx playwright test -- e2e/account-reconciliation-workspace.spec.ts
 */

import { expect, test, type Page } from '@playwright/test';

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Create an account via the API with an optional starting balance.
 */
async function createAccount(page: Page, name: string, startingBalance = 0) {
  const response = await page.request.post('/api/accounts', {
    data: {
      name,
      broker: 'E2E Broker',
      currency: 'USD',
      startingBalance,
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string; name: string };
}

/**
 * Set risk parameters on an account (required before activation).
 */
async function setAccountRiskParams(page: Page, accountId: string) {
  const response = await page.request.put(`/api/accounts/${accountId}`, {
    data: {
      maxRiskPerTradePct: 2.0,
      defaultCommission: 1.0,
      startingBalance: 0,
    },
  });
  expect(response.status()).toBe(200);
}

/**
 * Activate an account so the header shows "Active".
 */
async function activateAccount(page: Page, accountId: string) {
  const response = await page.request.put(`/api/accounts/${accountId}`, {
    data: { isActive: true },
  });
  expect(response.status()).toBe(200);
}

/**
 * Run a full legacy migration for an account.
 */
async function runMigration(page: Page, accountId: string) {
  const response = await page.request.post(`/api/accounts/${accountId}/migration`);
  expect(response.ok()).toBeTruthy();
  return await response.json() as {
    status: string;
    runId: string;
    rebuildFingerprint: string | null;
  };
}

/**
 * Capture console errors and page errors for the lifetime of this page.
 * Returns a reference to the errors array so it can be inspected later.
 */
function setupErrorCapture(
  page: Page,
): { errors: string[]; failed: string[] } {
  const errors: string[] = [];
  const failed: string[] = [];

  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Filter out expected 400 responses (intentional no-migration state)
      // and benign extension/favicon noise
      if (
        !text.includes('favicon') &&
        !text.includes('extension') &&
        !text.includes('400 (Bad Request)')
      ) {
        errors.push(`[console.error] ${text}`);
      }
    }
  });
  page.on('requestfailed', (req) => {
    failed.push(`${req.url()} (${req.failure()?.errorText ?? 'unknown'})`);
  });
  page.on('response', (res) => {
    if (!res.ok() && res.status() >= 400) {
      // Expected reconciliation/migration errors are not diagnostic failures
      const url = res.url();
      if (
        !url.includes('/reconciliation') &&
        !url.includes('/migration')
      ) {
        failed.push(`${res.url()} (${res.status()})`);
      }
    }
  });

  return { errors, failed };
}

// ── Tests ───────────────────────────────────────────────────────────────

test.describe('Account Reconciliation Workspace', () => {
  test.describe.configure({ mode: 'serial' });

  let healthyAccountId: string;
  let healthyAccountName: string;
  let blockedAccountId: string;
  let blockedAccountName: string;

  // ═════════════════════════════════════════════════════════════════════
  // Test 1: Healthy / cutover-eligible journey
  // ═════════════════════════════════════════════════════════════════════

  test('shows cutover-eligible report with comparison dimensions after migration', async ({
    page,
  }) => {
    const { errors, failed } = setupErrorCapture(page);
    const ts = Date.now();

    // ── 1. Create & prepare account ────────────────────────────────
    healthyAccountName = `Recon Healthy ${ts}`;
    const account = await createAccount(page, healthyAccountName, 0);
    healthyAccountId = account.id;
    await setAccountRiskParams(page, account.id);
    await activateAccount(page, account.id);

    // ── 2. Run migration ───────────────────────────────────────────
    const migrationResult = await runMigration(page, account.id);
    expect(migrationResult.status).toBe('completed');
    expect(migrationResult.runId).toBeDefined();
    expect(typeof migrationResult.rebuildFingerprint).toBe('string');

    // ── 3. Navigate to the reconciliation workspace via deep link ───
    await page.goto(`/accounts/${account.id}/reconciliation`);

    // ── 4. Wait for the reconciliation API response ─────────────────
    // The component fetches the report on mount. Wait for the 200 response.
    await page.waitForResponse(
      (res) =>
        res.url().includes(`/api/accounts/${account.id}/reconciliation`) &&
        res.status() === 200,
    );

    // ── 5. Account workspace shell ──────────────────────────────────
    await expect(
      page.getByRole('heading', { name: healthyAccountName }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: /back to accounts/i }),
    ).toBeVisible();

    // ── 6. All workspace tabs are present ──────────────────────────
    await expect(
      page.getByRole('tab', { name: 'Overview' }),
    ).toBeVisible();
    await expect(
      page.getByRole('tab', { name: 'Ledger' }),
    ).toBeVisible();
    await expect(
      page.getByRole('tab', { name: 'Positions' }),
    ).toBeVisible();

    // ── 7. Reconciliation tab is active ─────────────────────────────
    const reconTab = page.getByRole('tab', { name: 'Reconciliation' });
    await expect(reconTab).toBeVisible();
    await expect(reconTab).toHaveAttribute('aria-selected', 'true');

    await expect(
      page.getByRole('tab', { name: 'Settings' }),
    ).toBeVisible();

    // ── 8. Cutover eligibility banner ──────────────────────────────
    const eligibleText = page.getByText('Account is eligible for cutover');
    await expect(eligibleText).toBeVisible();

    // ── 9. Summary stats grid (4-column) ───────────────────────────
    await expect(page.getByText('Comparisons').first()).toBeVisible();
    await expect(page.getByText('Matching').first()).toBeVisible();
    await expect(page.getByText('Explained').first()).toBeVisible();
    await expect(page.getByText('Issues').first()).toBeVisible();

    // Numeric values should be visible (tabular-nums)
    const comparisonsVal = page.locator('p.text-lg').filter({ hasText: /^[0-9]+$/ }).first();
    await expect(comparisonsVal).toBeVisible();

    // ── 10. Maintenance control buttons ────────────────────────────
    await expect(
      page.getByRole('button', { name: /dry-run/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /run migration/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /refresh reconciliation/i }),
    ).toBeVisible();

    // ── 11. Accessible action labels ────────────────────────────────
    // Each button has an explicit aria-label
    const inspectBtn = page.getByRole('button', {
      name: 'Run dry-run migration inspection',
    });
    await expect(inspectBtn).toBeVisible();
    await expect(inspectBtn).not.toBeDisabled();

    const refreshBtn = page.getByRole('button', {
      name: 'Refresh reconciliation report',
    });
    await expect(refreshBtn).toBeVisible();

    // ── 12. Expand comparison details ──────────────────────────────
    const expandTrigger = page.getByText(/comparison/);
    await expect(expandTrigger).toBeVisible();
    await expandTrigger.click();

    // After expanding, the comparison table renders with all 7 dimensions
    await expect(
      page.getByText('Net Cash (deposits - withdrawals)'),
    ).toBeVisible();
    await expect(
      page.getByText('Execution Count'),
    ).toBeVisible();
    await expect(
      page.getByText('Total Fees'),
    ).toBeVisible();
    await expect(
      page.getByText('Price Mark Count'),
    ).toBeVisible();
    await expect(
      page.getByText('Position Count'),
    ).toBeVisible();
    await expect(
      page.getByText('Position Market Value'),
    ).toBeVisible();
    await expect(
      page.getByText('Net Asset Value (Cash + Positions)'),
    ).toBeVisible();

    // Verify table column headers
    await expect(
      page.getByText('Dimension').first(),
    ).toBeVisible();
    await expect(
      page.getByText('Legacy').first(),
    ).toBeVisible();
    await expect(
      page.getByText('Accounting').first(),
    ).toBeVisible();
    await expect(
      page.getByText('Diff').first(),
    ).toBeVisible();
    await expect(
      page.getByText('Status').first(),
    ).toBeVisible();

    // Verify classification badges are present (all should be "Match"
    // since the account has no legacy data beyond what the migration
    // produced — all comparisons are zero-to-zero)
    const matchBadges = page.getByText('Match');
    await expect(matchBadges.first()).toBeVisible();

    // ── 13. Footer with run ID and timestamp ────────────────────────
    const footer = page.getByText(/Last Migration #/);
    await expect(footer).toBeVisible();
    const footerText = await footer.textContent();
    expect(footerText).toContain('Last Migration #');

    // ── 14. URL continuity — stays on the reconciliation route ─────
    await expect(page).toHaveURL(
      new RegExp(`/accounts/${account.id}/reconciliation$`),
    );

    // ── 15. No fabricated zero values for unavailable data ──────────
    // The comparison values should be "0" for both legacy and accounting
    // columns — this is the real value, not fabricated.
    // Verify that "Matching" stat shows the correct number
    const matchingStat = page
      .locator('p.tabular-nums.text-emerald-600')
      .first();
    await expect(matchingStat).toBeVisible();
    const matchingNum = await matchingStat.textContent();
    expect(matchingNum).toBe('7'); // all 7 comparisons match for a fresh account

    // ── 16. No console errors or failed network requests ────────────
    expect(errors).toEqual([]);
    expect(failed).toEqual([]);
  });

  // ═════════════════════════════════════════════════════════════════════
  // Test 2: Blocked state (no migration run)
  // ═════════════════════════════════════════════════════════════════════

  test('shows blocked state with No Migration Run instructions for fresh account', async ({
    page,
  }) => {
    const { errors, failed } = setupErrorCapture(page);
    const ts = Date.now();

    // ── 1. Create account with no migration ─────────────────────────
    blockedAccountName = `Recon Blocked ${ts}`;
    const account = await createAccount(page, blockedAccountName);
    blockedAccountId = account.id;
    await setAccountRiskParams(page, account.id);
    await activateAccount(page, account.id);

    // ── 2. Navigate direct to reconciliation deep link ──────────────
    await page.goto(`/accounts/${account.id}/reconciliation`);

    // ── 3. Wait for the reconciliation API 400 (no migration) ───────
    await page.waitForResponse(
      (res) =>
        res.url().includes(`/api/accounts/${account.id}/reconciliation`) &&
        res.status() === 400,
    );

    // ── 4. Account workspace shell ──────────────────────────────────
    await expect(
      page.getByRole('heading', { name: blockedAccountName }),
    ).toBeVisible();

    // ── 5. Reconciliation tab is selected ──────────────────────────
    const reconTab = page.getByRole('tab', { name: 'Reconciliation' });
    await expect(reconTab).toBeVisible();
    await expect(reconTab).toHaveAttribute('aria-selected', 'true');

    // ── 6. All workspace tabs are present ──────────────────────────
    await expect(
      page.getByRole('tab', { name: 'Overview' }),
    ).toBeVisible();
    await expect(
      page.getByRole('tab', { name: 'Ledger' }),
    ).toBeVisible();
    await expect(
      page.getByRole('tab', { name: 'Positions' }),
    ).toBeVisible();
    await expect(
      page.getByRole('tab', { name: 'Settings' }),
    ).toBeVisible();

    // ── 7. No-migration empty state ────────────────────────────────
    await expect(
      page.getByText('No migration run recorded.'),
    ).toBeVisible();

    // ── 8. Instruction text ─────────────────────────────────────────
    await expect(
      page.getByText(/Use the Inspect button above to preview/),
    ).toBeVisible();

    // ── 9. Action buttons present (Inspect, Run Migration, Refresh) ─
    await expect(
      page.getByRole('button', { name: /dry-run/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /run migration/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /refresh reconciliation/i }),
    ).toBeVisible();

    // ── 10. No eligibility banner (no report to compute) ────────────
    await expect(
      page.getByText('Account is eligible for cutover'),
    ).not.toBeVisible();
    await expect(
      page.getByText('Account is not eligible for cutover'),
    ).not.toBeVisible();

    // ── 11. No comparison summary stats ─────────────────────────────
    await expect(
      page.getByText('Comparisons').first(),
    ).not.toBeAttached();

    // ── 12. No legacy performance analytics or fabricated values ────
    // The no-migration state shows a BookOpen icon with dashed border
    // and instruction text — no numbers, no metrics, no tables.
    await expect(
      page.getByText('NET ASSET VALUE'),
    ).not.toBeAttached();
    await expect(
      page.getByText('REALIZED P&L'),
    ).not.toBeAttached();

    // ── 13. URL continuity — stays on the reconciliation route ─────
    await expect(page).toHaveURL(
      new RegExp(`/accounts/${account.id}/reconciliation$`),
    );

    // ── 14. No console errors or failed network requests ────────────
    // The 400 response from /reconciliation is intentionally filtered
    // out, so no diagnostic failures should be recorded.
    expect(errors).toEqual([]);
    expect(failed).toEqual([]);
  });
});
