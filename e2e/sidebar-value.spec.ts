import { test, expect } from '@playwright/test';
import { hideDevOverlay } from './helpers';

/**
 * M014 S02 — Sidebar value block evidence.
 *
 * Covers: Live indicator rendering (expanded + collapsed) driven by the
 * accounts summary endpoint, and endpoint response shape.
 *
 * The monetary total was removed from the sidebar value block per user
 * request (pre-M014); the block now shows only a Live badge when open
 * trades exist. Assertions therefore check the badge, not a balance.
 */

test.describe('Sidebar Value Block', () => {
  test('LIVE indicator reflects open trade count from summary endpoint', async ({ page }) => {
    await page.goto('/');
    await hideDevOverlay(page);

    // Fetch the endpoint directly to know expected state.
    const res = await page.request.get('/api/accounts/summary');
    const body = await res.json();

    const valueBlock = page.getByTestId('sidebar-value');
    // Expanded-mode Live dot carries the --positive token (T03 migration).
    const dot = valueBlock.locator('span.bg-positive');
    const liveLabel = valueBlock.locator('text=LIVE');

    if (body.openTradeCount > 0) {
      await expect(valueBlock).toBeVisible();
      await expect(dot).toBeVisible();
      await expect(liveLabel).toBeVisible();
    } else {
      // No open trades → the block renders nothing.
      await expect(valueBlock).toHaveCount(0);
      await expect(liveLabel).toHaveCount(0);
    }
  });

  test('collapsed mode shows Live dot', async ({ page }) => {
    await page.goto('/');
    await hideDevOverlay(page);

    const res = await page.request.get('/api/accounts/summary');
    const body = await res.json();

    await page.locator('button[aria-label="Collapse sidebar"]').click();
    await expect(page.locator('aside')).toHaveCSS('width', '56px');

    if (body.openTradeCount > 0) {
      // Collapsed: the block renders the compact Live dot only — no label.
      const valueBlock = page.getByTestId('sidebar-value');
      await expect(valueBlock).toBeVisible();
      await expect(valueBlock.getByTestId('sidebar-value-live-dot')).toBeVisible();
      await expect(valueBlock.locator('text=LIVE')).toHaveCount(0);
    } else {
      await expect(page.getByTestId('sidebar-value')).toHaveCount(0);
    }
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
