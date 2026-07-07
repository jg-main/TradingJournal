import { test, expect } from '@playwright/test';

/**
 * Minimal valid 1x1 PNG (base64). Small enough to inline, but contains
 * valid IHDR/IDAT/IEND chunks so the server's MIME check passes.
 */
const MINIMAL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test.describe('Trade Assets Lightbox', () => {
  test.describe.configure({ mode: 'serial' });

  test('click thumbnail opens lightbox, close button dismisses it', async ({ page }) => {
    // ── Seed account and trade ────────────────────────────────
    const accRes = await page.request.post('/api/accounts', {
      data: { name: 'Lightbox Test', isActive: true },
    });
    expect(accRes.ok()).toBeTruthy();
    const account = await accRes.json();

    const tradeRes = await page.request.post('/api/trades', {
      data: { symbol: 'LBOX', direction: 'long', accountId: account.id },
    });
    expect(tradeRes.ok()).toBeTruthy();
    const trade = await tradeRes.json();

    // ── Upload a screenshot via multipart FormData ────────────
    const pngBuffer = Buffer.from(MINIMAL_PNG_BASE64, 'base64');
    const uploadRes = await page.request.post(`/api/trades/${trade.id}/assets`, {
      multipart: {
        file: {
          name: 'test-screenshot.png',
          mimeType: 'image/png',
          buffer: pngBuffer,
        },
        phase: 'pre_trade',
        label: 'Test chart screenshot',
      },
    });
    expect(uploadRes.ok()).toBeTruthy();
    const asset = await uploadRes.json();
    expect(asset.filePath).toBeTruthy();

    // ── Navigate to trade detail page ─────────────────────────
    await page.goto(`/trades/${trade.id}`, { waitUntil: 'networkidle' });

    // ── Verify thumbnail is visible (cursor-pointer identifies clickable images) ──
    const thumbnail = page.locator('img.cursor-pointer').first();
    await expect(thumbnail).toBeVisible();

    // ── Click thumbnail to open lightbox ──────────────────────
    await thumbnail.click();

    // ── Verify the lightbox overlay appears ───────────────────
    const expandedImage = page.locator('img[alt="Full-size screenshot"]');
    await expect(expandedImage).toBeVisible();

    // ── Verify close button is visible ────────────────────────
    const closeButton = page.locator('button[aria-label="Close lightbox"]');
    await expect(closeButton).toBeVisible();

    // ── Click the close button ────────────────────────────────
    await closeButton.click();

    // ── Verify the lightbox overlay is gone ───────────────────
    await expect(expandedImage).not.toBeVisible();

    // ── Clean up: delete the trade ────────────────────────────
    const delRes = await page.request.delete(`/api/trades/${trade.id}`);
    expect(delRes.ok()).toBeTruthy();
  });

  test('backdrop click dismisses the lightbox', async ({ page }) => {
    // ── Seed account and trade ────────────────────────────────
    const accRes = await page.request.post('/api/accounts', {
      data: { name: 'Lightbox Backdrop Test', isActive: true },
    });
    expect(accRes.ok()).toBeTruthy();
    const account = await accRes.json();

    const tradeRes = await page.request.post('/api/trades', {
      data: { symbol: 'LBOX2', direction: 'long', accountId: account.id },
    });
    expect(tradeRes.ok()).toBeTruthy();
    const trade = await tradeRes.json();

    // ── Upload a screenshot via multipart FormData ────────────
    const pngBuffer = Buffer.from(MINIMAL_PNG_BASE64, 'base64');
    const uploadRes = await page.request.post(`/api/trades/${trade.id}/assets`, {
      multipart: {
        file: {
          name: 'test-screenshot-2.png',
          mimeType: 'image/png',
          buffer: pngBuffer,
        },
        phase: 'pre_trade',
      },
    });
    expect(uploadRes.ok()).toBeTruthy();

    // ── Navigate to trade detail page ─────────────────────────
    await page.goto(`/trades/${trade.id}`, { waitUntil: 'networkidle' });

    // ── Click thumbnail to open lightbox ──────────────────────
    const thumbnail = page.locator('img.cursor-pointer').first();
    await expect(thumbnail).toBeVisible();
    await thumbnail.click();

    // ── Verify lightbox is open ───────────────────────────────
    const expandedImage = page.locator('img[alt="Full-size screenshot"]');
    await expect(expandedImage).toBeVisible();

    // ── Click the backdrop (fixed overlay) to dismiss ─────────
    // Click in the top-left margin area to avoid hitting the image itself
    // which has onClick(e) => e.stopPropagation().
    const backdrop = page.locator('.fixed.inset-0.z-50');
    await backdrop.click({ position: { x: 10, y: 10 } });

    // ── Verify the lightbox is closed ─────────────────────────
    await expect(expandedImage).not.toBeVisible();

    // ── Clean up: delete the trade ────────────────────────────
    const delRes = await page.request.delete(`/api/trades/${trade.id}`);
    expect(delRes.ok()).toBeTruthy();
  });
});
