import { test, expect } from '@playwright/test';
import { hideDevOverlay } from './helpers';

/**
 * M014 S02 — Sidebar shell evidence.
 *
 * Covers: grouped navigation sections (Trading/Accounts/Analysis/System),
 * active rail, collapsed icon-only mode, collapse persistence across reload
 * (saved browser state), and tooltip labels in collapsed mode.
 */

const COLLAPSE_TOGGLE = 'button[aria-label="Collapse sidebar"]';
const EXPAND_TOGGLE = 'button[aria-label="Expand sidebar"]';

test.describe('Sidebar Shell', () => {
  test('renders Trading/Accounts/Analysis/System sections in order with expected items', async ({ page }) => {
    await page.goto('/trades');
    const nav = page.locator('aside nav');

    const headers = nav.locator('div.uppercase');
    await expect(headers).toHaveText(['Trading', 'Accounts', 'Analysis', 'System']);

    // Trading section contains the daily workflow: Dashboard, Watchlist, Trades, Reviews, Checks
    const tradingSection = nav.locator('div', { has: page.locator('div.uppercase', { hasText: 'Trading' }) }).first();
    for (const label of ['Dashboard', 'Watchlist', 'Trades', 'Reviews', 'Checks']) {
      await expect(tradingSection.getByRole('link', { name: label })).toBeVisible();
    }

    // Accounts section contains the Accounts link
    const accountsSection = nav.locator('div', { has: page.locator('div.uppercase', { hasText: 'Accounts' }) }).first();
    await expect(accountsSection.getByRole('link', { name: 'Accounts' })).toBeVisible();

    // Analysis section contains Sizing
    const analysisSection = nav.locator('div', { has: page.locator('div.uppercase', { hasText: 'Analysis' }) }).first();
    await expect(analysisSection.getByRole('link', { name: 'Sizing' })).toBeVisible();

    // System section contains Alerts, Settings, Help
    const systemSection = nav.locator('div', { has: page.locator('div.uppercase', { hasText: 'System' }) }).first();
    for (const label of ['Alerts', 'Settings', 'Help']) {
      await expect(systemSection.getByRole('link', { name: label })).toBeVisible();
    }
  });

  test('active route shows primary rail', async ({ page }) => {
    await page.goto('/trades');
    const tradesLink = page.locator('aside').getByRole('link', { name: 'Trades' });

    // Active link carries the before: rail (bg-sidebar-primary) and the sidebar
    // accent fill (bg-sidebar-accent) — T02 migrated the active state off bg-muted
    const cls = await tradesLink.getAttribute('class');
    expect(cls).toContain('before:bg-sidebar-primary');
    expect(cls).toContain('bg-sidebar-accent');

    // Inactive link has no rail
    const reviewsLink = page.locator('aside').getByRole('link', { name: 'Reviews' });
    const reviewsCls = await reviewsLink.getAttribute('class');
    expect(reviewsCls).not.toContain('before:bg-sidebar-primary');
  });

  test('collapse switches to icon-only mode and persists across reload', async ({ page }) => {
    await page.goto('/trades');
    await hideDevOverlay(page);

    const aside = page.locator('aside');
    await expect(aside).toHaveCSS('width', '224px'); // w-56

    await page.locator(COLLAPSE_TOGGLE).click();
    await expect(aside).toHaveCSS('width', '56px'); // w-14

    // Labels hidden, section headers replaced by separators
    await expect(aside.locator('nav div.uppercase')).toHaveCount(0);
    await expect(aside.getByRole('link', { name: 'Trades' }).locator('span')).toHaveCount(0);

    // Persistence: reload and verify still collapsed
    await page.reload();
    await hideDevOverlay(page);
    await expect(page.locator('aside')).toHaveCSS('width', '56px');
    await expect(page.locator(EXPAND_TOGGLE)).toBeVisible();

    const stored = await page.evaluate(() => localStorage.getItem('sidebar:collapsed'));
    expect(stored).toBe('1');

    // Expand again
    await page.locator(EXPAND_TOGGLE).click();
    await expect(page.locator('aside')).toHaveCSS('width', '224px');
    await expect(page.locator('aside nav div.uppercase').first()).toHaveText('Trading');
  });

  test('hydrates cleanly when collapsed mode was persisted before navigation', async ({ page }) => {
    const browserErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text());
    });
    page.on('pageerror', (error) => browserErrors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('sidebar:collapsed', '1'));

    await page.goto('/trades');
    await hideDevOverlay(page);
    await expect(page.locator(EXPAND_TOGGLE)).toBeVisible();
    await expect(page.locator('aside')).toHaveCSS('width', '56px');

    expect(browserErrors.filter((message) => /hydrat|server rendered html/i.test(message))).toEqual([]);
  });

  test('collapsed mode shows tooltip labels on hover', async ({ page }) => {
    await page.goto('/trades');
    await hideDevOverlay(page);
    await page.locator(COLLAPSE_TOGGLE).click();

    await page.locator('aside').getByRole('link', { name: 'Reviews' }).hover();
    const tooltip = page.locator('[data-slot="tooltip-content"]', { hasText: 'Reviews' });
    await expect(tooltip).toBeVisible();
  });

  test('sidebar screenshots (expanded and collapsed)', async ({ page }, testInfo) => {
    await page.goto('/trades');
    await hideDevOverlay(page);
    await page.screenshot({ path: testInfo.outputPath('sidebar-expanded.png'), fullPage: false });

    await page.locator(COLLAPSE_TOGGLE).click();
    await expect(page.locator('aside')).toHaveCSS('width', '56px');
    await page.screenshot({ path: testInfo.outputPath('sidebar-collapsed.png'), fullPage: false });
  });
});
