import { test, expect, type Page } from '@playwright/test';
import { hideDevOverlay } from './helpers';

/**
 * M007 S02 — Global account selector evidence.
 *
 * Covers: single /api/accounts fetch on / mount, sidebar as the only
 * visible selector on / (workstation toolbar converged), selection driving
 * workstation live data, persistence across reload, and collapsed-mode
 * account switching via dropdown.
 */

interface AccountRow {
  id: string;
  name: string;
  broker: string | null;
  currency: string;
  isActive: boolean | number;
}

async function fetchAccounts(page: Page): Promise<AccountRow[]> {
  const res = await page.request.get('/api/accounts');
  expect(res.ok()).toBeTruthy();
  return res.json();
}

test.describe('Sidebar Global Account Selector', () => {
  test('/ fires exactly one /api/accounts request on mount', async ({ page }) => {
    const accountRequests: string[] = [];
    page.on('response', (res) => {
      const url = new URL(res.url());
      if (url.pathname === '/api/accounts') accountRequests.push(res.url());
    });

    await page.goto('/');
    await hideDevOverlay(page);
    await expect(page.getByTestId('sidebar-account-trigger')).toBeVisible();
    // Allow any late effects to fire before asserting the count.
    await page.waitForTimeout(1000);

    expect(accountRequests.length).toBe(1);
  });

  test('workstation toolbar converges: no duplicate select, account shown read-only', async ({ page }) => {
    await page.goto('/');
    await hideDevOverlay(page);

    // Sidebar selector is present and shows the resolved account.
    const trigger = page.getByTestId('sidebar-account-trigger');
    await expect(trigger).toBeVisible();

    // The workstation toolbar must NOT render its own account <select>.
    await expect(page.locator('select[aria-label="Active account"]')).toHaveCount(0);

    // Fetch the account list AFTER mount: specs running in parallel (e.g.
    // M012 lifecycle) create and activate accounts concurrently in the shared
    // test DB, so a pre-navigation fetch can be stale by the time the client
    // resolves. Resolution order (src/lib/account-context.tsx): persisted id
    // (none in a fresh context) -> first active -> first account. Because the
    // exact winning account is timing-dependent under parallel execution, the
    // convergence contract asserted here is: the toolbar shows a valid
    // resolved account read-only (never a duplicate <select>) — accept any
    // active account, or the newest account when none are active.
    const accounts = await fetchAccounts(page);
    test.skip(accounts.length === 0, 'No accounts in test DB');
    const active = accounts.filter((a) => a.isActive === true || a.isActive === 1);
    const candidates = (active.length > 0 ? active : accounts).map((a) =>
      a.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    );
    const expected = new RegExp(`^(?:${candidates.join('|')})$`);

    // It shows the resolved account name read-only instead.
    const external = page.getByTestId('ws-external-account');
    await expect(external).toBeVisible();
    await expect(external).toHaveText(expected);
  });

  test('sidebar selection drives workstation live data and persists across reload', async ({ page }) => {
    const accounts = await fetchAccounts(page);
    test.skip(accounts.length < 2, 'Need at least 2 accounts in test DB');
    const target = accounts[1];

    const v2Requests: string[] = [];
    page.on('request', (req) => {
      const url = new URL(req.url());
      if (url.pathname === '/api/dashboard/v2') v2Requests.push(url.searchParams.get('accountId') ?? '');
    });

    await page.goto('/');
    await hideDevOverlay(page);
    await expect(page.getByTestId('sidebar-account-trigger')).toBeVisible();

    // Select the second account via the radix Select.
    await page.getByTestId('sidebar-account-trigger').click();
    await page.getByRole('option', { name: new RegExp(target.name) }).click();

    // Selection persisted.
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('app:account')))
      .toBe(target.id);

    // Workstation live data refetched for the new account.
    await expect.poll(() => v2Requests).toContain(target.id);

    // Toolbar read-only name follows.
    await expect(page.getByTestId('ws-external-account')).toHaveText(target.name);

    // Persistence across reload.
    await page.reload();
    await hideDevOverlay(page);
    await expect(page.getByTestId('sidebar-account-trigger')).toContainText(target.name);
    await expect(page.getByTestId('ws-external-account')).toHaveText(target.name);
  });

  test('collapsed sidebar switches accounts via icon dropdown', async ({ page }) => {
    const accounts = await fetchAccounts(page);
    test.skip(accounts.length < 2, 'Need at least 2 accounts in test DB');
    const target = accounts[1];

    await page.goto('/');
    await hideDevOverlay(page);
    await page.locator('button[aria-label="Collapse sidebar"]').click();
    await expect(page.locator('aside')).toHaveCSS('width', '56px');

    await page.getByTestId('sidebar-account-collapsed-trigger').click();
    await page.getByRole('menuitem', { name: new RegExp(target.name) }).click();

    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('app:account')))
      .toBe(target.id);
    await expect(page.getByTestId('ws-external-account')).toHaveText(target.name);
  });
});
