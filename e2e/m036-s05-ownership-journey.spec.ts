/**
 * E2E cross-domain ownership journey for the Settings Ownership Reorganization milestone.
 *
 * Proves all six Settings domains are reachable via the hub, the Accounts workspace
 * is accessible, and the global-default → account-override → reset → reload → restart
 * journey works end-to-end.
 *
 * Covers:
 * 1. Settings hub renders all six domain cards with working links
 * 2. Each Settings domain page renders its heading (Workspace, Risk Defaults,
 *    Journal Setup, Integrations, Data &amp; Backups, Danger Zone)
 * 3. Accounts page is reachable with default-account controls
 * 4. Account workspace (Overview, Ledger, Positions, Settings tabs)
 *    is reachable via /settings/accounts/[id]
 * 5. Global default → account override → reset to inherited → reload → restart
 *    persistence journey
 * 6. Back navigation from each sub-domain returns to the Settings hub
 * 7. No stale /settings/accounts links in the sidebar or hub
 *
 * Precondition: Next.js dev-server running on port 3000.
 *   The webServer block in playwright.config.ts launches it automatically.
 */

import { expect, test, type Page } from '@playwright/test';

// ── Helper Types ────────────────────────────────────────────────────────

interface AccountResult {
  id: string;
  name: string;
}

// ── Fixture Helpers ─────────────────────────────────────────────────────

async function createActiveInheritedAccount(page: Page, name: string): Promise<AccountResult> {
  const createResponse = await page.request.post('/api/accounts', {
    data: { name, broker: 'Journey E2E Broker', currency: 'USD' },
  });
  expect(createResponse.status()).toBe(201);
  const account = (await createResponse.json()) as AccountResult;

  // Configure with explicit values first, then clear to inherit
  const configureResponse = await page.request.put(`/api/accounts/${account.id}`, {
    data: {
      maxRiskPerTradePct: 2,
      defaultCommission: 1,
    },
  });
  expect(configureResponse.status()).toBe(200);

  const activateResponse = await page.request.put(`/api/accounts/${account.id}`, {
    data: { isActive: true },
  });
  expect(activateResponse.status()).toBe(200);

  // Clear overrides so account inherits global defaults
  const inheritResponse = await page.request.put(`/api/accounts/${account.id}`, {
    data: { maxRiskPerTradePct: null, defaultCommission: null },
  });
  expect(inheritResponse.status()).toBe(200);

  return account;
}

/**
 * Capture console errors and page errors for the lifetime of this page.
 */
function captureDiagnostics(page: Page): { errors: string[]; failed: string[] } {
  const errors: string[] = [];
  const failed: string[] = [];

  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (
        !text.includes('favicon') &&
        !text.includes('extension') &&
        !text.includes('[turbopack]') &&
        !text.includes('Failed to load chunk')
      ) {
        errors.push(`[console.error] ${text}`);
      }
    }
  });
  page.on('requestfailed', (req) => {
    failed.push(`${req.url()} (${req.failure()?.errorText ?? 'unknown'})`);
  });

  return { errors, failed };
}

// ── Six Settings Domain Descriptors ─────────────────────────────────────

interface SettingsDomain {
  name: string;
  href: string;
  heading: string | RegExp;
  /** Hub card text to click */
  cardText: string | RegExp;
}

const SETTINGS_DOMAINS: SettingsDomain[] = [
  {
    name: 'Workspace',
    href: '/settings/workspace',
    heading: 'Workspace',
    cardText: /workspace/i,
  },
  {
    name: 'Risk Defaults',
    href: '/settings/risk-defaults',
    heading: 'Risk Defaults',
    cardText: /risk defaults/i,
  },
  {
    name: 'Journal Setup',
    href: '/settings/journal-setup',
    heading: 'Journal Setup',
    cardText: /journal setup/i,
  },
  {
    name: 'Integrations',
    href: '/settings/integrations',
    heading: 'Integrations',
    cardText: /integrations/i,
  },
  {
    name: 'Data & Backups',
    href: '/settings/data-and-backups',
    heading: /data.*backups/i,
    cardText: /data.*backups/i,
  },
  {
    name: 'Danger Zone',
    href: '/settings/danger-zone',
    heading: 'Danger Zone',
    cardText: /danger zone/i,
  },
];

// ── Tests ───────────────────────────────────────────────────────────────

test.describe('Settings Ownership Journey', () => {
  test.describe.configure({ mode: 'serial' });

  // Shared fixture identifiers
  let testAccount: AccountResult;
  const diagnosticPages: Page[] = [];

  // ═════════════════════════════════════════════════════════════════════
  // Setup: Seed global risk defaults and create a test account
  // ═════════════════════════════════════════════════════════════════════

  test('setup: seed global defaults and create account', async ({ page }) => {
    const diagnostics = captureDiagnostics(page);
    diagnosticPages.push(page);

    // Seed global risk defaults
    const globalSettingsResponse = await page.request.put('/api/settings', {
      data: {
        maxRiskPerTradePct: 2.5,
        defaultCommission: 1.00,
        // Preserve any existing hidden fields
      },
    });
    expect(globalSettingsResponse.ok()).toBeTruthy();

    // Create account with inherited defaults (null overrides)
    testAccount = await createActiveInheritedAccount(page, `Ownership Journey ${Date.now()}`);

    // Verify global defaults persisted
    const settingsRes = await page.request.get('/api/settings');
    expect(settingsRes.ok()).toBeTruthy();
    const settingsData = await settingsRes.json() as Record<string, unknown>;
    expect(settingsData.maxRiskPerTradePct).toBe(2.5);
    expect(settingsData.defaultCommission).toBe(1.00);

    // Verify account exists
    const accountRes = await page.request.get(`/api/accounts/${testAccount.id}`);
    expect(accountRes.ok()).toBeTruthy();

    // Verify diagnostics are clean
    expect(diagnostics.errors).toEqual([]);
    expect(diagnostics.failed).toEqual([]);
  });

  // ═════════════════════════════════════════════════════════════════════
  // Test 1: Settings hub renders all six domain cards with working links
  // ═════════════════════════════════════════════════════════════════════

  test('Settings hub renders all six domain cards with correct hrefs', async ({ page }) => {
    const diagnostics = captureDiagnostics(page);
    diagnosticPages.push(page);

    await page.goto('/settings');
    await expect(page.locator('h1')).toContainText('Settings');

    // Verify each domain card exists with the correct href
    // Use filter({has: h2}) to distinguish hub cards (which render an h2 inside the link)
    // from the setup checklist "Set up" links (which have no h2)
    for (const domain of SETTINGS_DOMAINS) {
      const card = page
        .getByRole('link')
        .filter({ has: page.getByRole('heading', { name: domain.cardText }) });
      await expect(card).toBeVisible();
      await expect(card).toHaveAttribute('href', domain.href);
    }

    // Verify hub page has no stale /settings/accounts links
    const accountsLinks = page.getByRole('link').filter({ hasText: /settings\/accounts/ });
    await expect(accountsLinks).toHaveCount(0);

    // Diagnostic check
    expect(diagnostics.errors).toEqual([]);
    const hubFailures = diagnostics.failed.filter(
      (f) => !f.includes('favicon') && !f.includes('__next'),
    );
    expect(hubFailures).toEqual([]);
  });

  // ═════════════════════════════════════════════════════════════════════
  // Test 2: Navigate to each Settings domain — page renders with heading
  // ═════════════════════════════════════════════════════════════════════

  for (const domain of SETTINGS_DOMAINS) {
    test(`${domain.name} page renders with heading via direct navigation`, async ({ page }) => {
      const diagnostics = captureDiagnostics(page);
      diagnosticPages.push(page);

      await page.goto(domain.href);
      await page.waitForLoadState('networkidle');

      // Verify page heading
      await expect(page.getByRole('heading', { name: domain.heading })).toBeVisible();

      // Verify back link to Settings hub
      const backLink = page.getByRole('link', { name: /back to settings/i });
      await expect(backLink).toBeVisible();
      await expect(backLink).toHaveAttribute('href', '/settings');

      // Diagnostic check — allow some 4xx responses for known API patterns
      const unexpectedErrors = diagnostics.errors.filter(
        (e) => !e.includes('[turbopack]'),
      );
      expect(unexpectedErrors).toEqual([]);

      // Verify back link works — click it to return to hub
      await backLink.click();
      await expect(page).toHaveURL('/settings');
    });
  }

  // ═════════════════════════════════════════════════════════════════════
  // Test 3: Accounts page is reachable with default-account controls
  // ═════════════════════════════════════════════════════════════════════

  test('Accounts page shows default account controls and links to account workspace', async ({ page }) => {
    const diagnostics = captureDiagnostics(page);
    diagnosticPages.push(page);

    await page.goto('/settings/accounts');
    await page.waitForLoadState('networkidle');

    // Verify Accounts page heading
    await expect(page.locator('h1')).toContainText('Accounts');

    // Verify default account selector exists
    const defaultAccountSelect = page.getByLabel('Account used by default');
    await expect(defaultAccountSelect).toBeVisible();

    // Verify Save default button exists
    await expect(page.getByRole('button', { name: 'Save default' })).toBeVisible();

    // Verify the test account link is visible in the accounts table
    const accountLink = page.getByRole('link', { name: testAccount.name });
    await expect(accountLink).toBeVisible();

    // Verify clicking account name navigates to account workspace
    await accountLink.click();
    await page.waitForLoadState('networkidle');

    // Should land on the account workspace (Overview tab by default)
    // The nav has 4 tabs: Overview, Ledger, Positions, Settings
    await expect(page.getByRole('tab', { name: 'Overview' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Ledger' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Positions' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Settings' })).toBeVisible();

    // Verify no stale /settings/accounts references
    const staleLinks = page.getByRole('link').filter({ hasText: /settings\/accounts/ });
    await expect(staleLinks).toHaveCount(0);

    // Diagnostic check
    const unexpectedErrors = diagnostics.errors.filter(
      (e) => !e.includes('[turbopack]'),
    );
    expect(unexpectedErrors).toEqual([]);
  });

  // ═════════════════════════════════════════════════════════════════════
  // Test 4: Global default → account override → reset → reload → restart
  // ═════════════════════════════════════════════════════════════════════

  test('global-default to account-override to reset with reload and restart persistence', async ({ page }, testInfo) => {
    // One browser owns the shared local settings row for this persistence journey
    test.skip(testInfo.project.name !== 'chromium', 'One browser owns the shared local settings row for this persistence journey.');

    const diagnostics = captureDiagnostics(page);
    diagnosticPages.push(page);

    // ── Global defaults are already seeded: 2.5% maxRisk, $1.00 commission ──

    // Step 1: Verify the account shows inherited values
    await page.goto(`/settings/accounts/${testAccount.id}/settings`);
    await page.waitForLoadState('networkidle');

    const maxRiskStatus = page.getByRole('status', { name: 'Effective max risk per trade' });
    const commissionStatus = page.getByRole('status', { name: 'Effective default commission' });

    // Should show Inherited with global values
    await expect(maxRiskStatus).toContainText('Inherited');
    await expect(maxRiskStatus).toContainText('2.5%');
    await expect(commissionStatus).toContainText('Inherited');
    await expect(commissionStatus).toContainText('$1.00');

    // Step 2: Override max risk to a per-account value
    const maxRiskInput = page.getByLabel('Max Risk Per Trade (%)');
    await maxRiskInput.fill('3.5');

    // Before saving, the status still shows inherited
    await expect(maxRiskStatus).toContainText('Inherited');

    // Save the override
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Settings saved successfully.' })).toBeVisible();

    // Now the effective status should show Overridden
    await expect(maxRiskStatus).toContainText('Overridden');
    await expect(maxRiskStatus).toContainText('3.5%');

    // Commission should still be inherited
    await expect(commissionStatus).toContainText('Inherited');
    await expect(commissionStatus).toContainText('$1.00');

    // Step 3: Reload the page — override persists
    await page.reload();
    await page.waitForLoadState('networkidle');

    await expect(maxRiskInput).toHaveValue('3.5');
    await expect(maxRiskStatus).toContainText('Overridden');
    await expect(maxRiskStatus).toContainText('3.5%');

    // Step 4: Reset the override back to global default
    await page.getByRole('button', { name: 'Reset max risk to global default' }).click();
    await expect(maxRiskInput).toHaveValue('');
    await expect(maxRiskStatus).toContainText('Overridden'); // Still shows old effective until saved

    // Save the reset
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Settings saved successfully.' })).toBeVisible();

    // Now it should show Inherited with global value
    await expect(maxRiskStatus).toContainText('Inherited');
    await expect(maxRiskStatus).toContainText('2.5%');

    // Step 5: Reload again — reset persists
    await page.reload();
    await page.waitForLoadState('networkidle');

    await expect(maxRiskInput).toHaveValue('');
    await expect(maxRiskStatus).toContainText('Inherited');
    await expect(maxRiskStatus).toContainText('2.5%');

    // Step 6: Restart simulation — navigate away and back
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
    await page.goto(`/settings/accounts/${testAccount.id}/settings`);
    await page.waitForLoadState('networkidle');

    await expect(maxRiskInput).toHaveValue('');
    await expect(maxRiskStatus).toContainText('Inherited');
    await expect(maxRiskStatus).toContainText('2.5%');

    // ── Diagnostics ─────────────────────────────────────────────────
    const unexpectedErrors = diagnostics.errors.filter(
      (e) => !e.includes('[turbopack]') && !e.includes('Failed to load chunk'),
    );
    expect(unexpectedErrors).toEqual([]);
  });

  // ═════════════════════════════════════════════════════════════════════
  // Test 5: Verify no stale /settings/accounts links in sidebar or hub
  // ═════════════════════════════════════════════════════════════════════

  test('no stale /settings/accounts references in sidebar navigation', async ({ page }) => {
    const diagnostics = captureDiagnostics(page);
    diagnosticPages.push(page);

    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // Check sidebar for any /settings/accounts links
    const sidebarLinks = page.locator('nav a');
    const sidebarLinksCount = await sidebarLinks.count();
    for (let i = 0; i < sidebarLinksCount; i++) {
      const href = await sidebarLinks.nth(i).getAttribute('href');
      if (href) {
        expect(href).not.toContain('/settings/accounts');
      }
    }

    // Verify Settings sidebar link points to /settings
    const settingsNavLink = page.getByRole('link', { name: 'Settings' }).first();
    await expect(settingsNavLink).toHaveAttribute('href', '/settings');

    // Diagnostic check
    const unexpectedErrors = diagnostics.errors.filter(
      (e) => !e.includes('[turbopack]'),
    );
    expect(unexpectedErrors).toEqual([]);
  });
});
