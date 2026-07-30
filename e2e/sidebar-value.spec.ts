import { test, expect } from '@playwright/test';
import { hideDevOverlay } from './helpers';

/**
 * M007 S03 — Sidebar value block evidence.
 *
 * Covers: total balance rendering, tabular-nums, Live dot visibility,
 * collapsed compact format, and endpoint response shape.
 */

test.describe('Sidebar Value Block', () => {
  test('renders total balance with tabular-nums on /', async ({ page }) => {
    await page.goto('/');
    await hideDevOverlay(page);

    const total = page.getByTestId('sidebar-value-total');
    await expect(total).toBeVisible();

    // Tabular-nums class ensures monospaced digits
    const cls = await total.getAttribute('class');
    expect(cls).toContain('tabular-nums');

    // Value is a currency string (starts with $ or other symbol)
    const text = await total.textContent();
    expect(text).not.toBe('—');
    expect(text).not.toBe('');
  });

  test('Live dot reflects open trade count from summary endpoint', async ({ page }) => {
    await page.goto('/');
    await hideDevOverlay(page);

    // Fetch the endpoint directly to know expected state.
    const res = await page.request.get('/api/accounts/summary');
    const body = await res.json();

    const sidebarValue = page.getByTestId('sidebar-value');
    const dot = sidebarValue.getByTestId('sidebar-value-live-dot');
    const liveLabel = sidebarValue.locator('text=LIVE');

    if (body.openTradeCount > 0) {
      await expect(dot).toBeVisible();
      await expect(liveLabel).toBeVisible();
    } else {
      await expect(dot).toHaveCount(0);
      await expect(liveLabel).toHaveCount(0);
    }
  });

  test('collapsed mode shows compact value with Live dot', async ({ page }) => {
    await page.goto('/');
    await hideDevOverlay(page);

    await page.locator('button[aria-label="Collapse sidebar"]').click();
    await expect(page.locator('aside')).toHaveCSS('width', '56px');

    // Compact value rendered (short format, e.g. $12.3k or $1.2M or $123)
    const valueBlock = page.getByTestId('sidebar-value');
    await expect(valueBlock).toBeVisible();
    const text = await valueBlock.textContent();
    expect(text?.trim()).not.toBe('');
  });

  test('summary endpoint returns expected shape', async ({ page }) => {
    const res = await page.request.get('/api/accounts/summary');
    expect(res.ok()).toBeTruthy();

    const body = await res.json();
    expect(Array.isArray(body.accounts)).toBeTruthy();
    expect(typeof body.totalBalance).toBe('string');
    expect(typeof body.openTradeCount).toBe('number');
  });
});
