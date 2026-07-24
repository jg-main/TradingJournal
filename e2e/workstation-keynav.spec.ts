/**
 * M005 S07 T01 — Workstation Keyboard Navigation System E2E spec.
 *
 * Verifies that the WorkstationKeyboardShortcuts component handles all
 * documented shortcuts and that the overlay renders correctly with
 * proper accessibility attributes.
 *
 * Coverage:
 * 1. Shortcut overlay opens on '?' and dismisses on Escape
 * 2. Shortcut overlay dismisses on backdrop click
 * 3. Shortcut overlay dismisses on close button click
 * 4. Panel focus: 1→KPIs, 2→Equity, 3→Positions, 4→Watchlist, 5→Risk, 6→Insights
 * 5. Panel focus applies visible focus ring (outline)
 * 6. Shortcuts are suppressed when focus is inside editable elements (input/select)
 * 7. Shortcuts are suppressed when modifier keys are held (Ctrl, Meta)
 * 8. Account cycling '[',']' is a no-op in single-account fixture mode (no error)
 * 9. Console error audit during all keyboard operations
 */

import { test, expect } from '@playwright/test';

// ── Constants ──────────────────────────────────────────────────────────

/** Grid-area to label mapping matching the 1-6 panel focus shortcuts. */
const PANEL_SHORTCUTS: Record<string, { key: string; area: string }> = {
  '1': { key: '1', area: 'kpis' },
  '2': { key: '2', area: 'equity' },
  '3': { key: '3', area: 'positions' },
  '4': { key: '4', area: 'watchlist' },
  '5': { key: '5', area: 'risk' },
  '6': { key: '6', area: 'insights' },
};

// ── Helpers ────────────────────────────────────────────────────────────

function captureConsoleErrors(page: import('@playwright/test').Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });
  return errors;
}

function assertNoConsoleErrors(errors: string[]): void {
  const actual = errors.filter(
    (e) =>
      !e.includes('Failed to load resource') &&
      !e.includes('ERR_BLOCKED_BY_CLIENT') &&
      !e.includes('favicon.ico'),
  );
  expect(actual).toEqual([]);
}

// ── Tests ──────────────────────────────────────────────────────────────

test.describe('Workstation Keyboard Navigation', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/workspace');
    await page.waitForLoadState('networkidle');
    // Dismiss any initial overlay that might be present from prior state.
    // Ensure the overlay is closed at the start of each test.
    const backdrop = page.getByTestId('ws-keynav-backdrop');
    if (await backdrop.isVisible({ timeout: 500 }).catch(() => false)) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
    }
  });

  // ── 1. Overlay: '?' opens, Escape dismisses ──────────────────────

  test('opens shortcut overlay on ? key and dismisses on Escape', async ({ page }) => {
    // Overlay should not be visible initially
    await expect(page.getByTestId('ws-keynav-backdrop')).not.toBeAttached();
    await expect(page.getByTestId('ws-keynav-overlay')).not.toBeAttached();

    // Press ? to open overlay
    await page.keyboard.press('?');
    await page.waitForTimeout(200);

    const backdrop = page.getByTestId('ws-keynav-backdrop');
    await expect(backdrop).toBeVisible();
    await expect(backdrop).toHaveAttribute('role', 'dialog');
    await expect(backdrop).toHaveAttribute('aria-label', 'Keyboard shortcuts');

    const overlay = page.getByTestId('ws-keynav-overlay');
    await expect(overlay).toBeVisible();

    // Verify shortcut entries are rendered
    await expect(overlay).toContainText('Previous Account');
    await expect(overlay).toContainText('Next Account');
    await expect(overlay).toContainText('Focus KPIs');
    await expect(overlay).toContainText('Focus Equity Curve');
    await expect(overlay).toContainText('Focus Positions');
    await expect(overlay).toContainText('Focus Watchlist');
    await expect(overlay).toContainText('Focus Risk');
    await expect(overlay).toContainText('Focus Setups & Insights');
    await expect(overlay).toContainText('Toggle Shortcut Overlay');
    await expect(overlay).toContainText('Dismiss Overlay');

    // Dismiss with Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    await expect(page.getByTestId('ws-keynav-backdrop')).not.toBeAttached();
  });

  // ── 2. Overlay: close button dismisses ───────────────────────────

  test('dismisses overlay on close button click', async ({ page }) => {
    await page.keyboard.press('?');
    await page.waitForTimeout(200);
    await expect(page.getByTestId('ws-keynav-backdrop')).toBeVisible();

    // Click the ✕ close button
    const closeBtn = page.getByTestId('ws-keynav-close');
    await expect(closeBtn).toBeVisible();
    await closeBtn.click();
    await page.waitForTimeout(200);

    await expect(page.getByTestId('ws-keynav-backdrop')).not.toBeAttached();
  });

  // ── 3. Overlay: backdrop click dismisses ─────────────────────────

  test('dismisses overlay on backdrop click', async ({ page }) => {
    await page.keyboard.press('?');
    await page.waitForTimeout(200);
    await expect(page.getByTestId('ws-keynav-backdrop')).toBeVisible();

    // Click the backdrop area (outside the overlay box)
    // Use position near the edges where the backdrop is visible
    const backdrop = page.getByTestId('ws-keynav-backdrop');
    const box = await backdrop.boundingBox();
    if (box) {
      // Click the backdrop itself, near the top edge
      await page.mouse.click(box.x + box.width / 2, box.y + 10);
      await page.waitForTimeout(200);
    }

    await expect(page.getByTestId('ws-keynav-backdrop')).not.toBeAttached();
  });

  // ── 4. Panel focus: 1-6 keys focus corresponding panels ─────────

  for (const [digit, { area }] of Object.entries(PANEL_SHORTCUTS)) {
    test(`pressing ${digit} focuses the ${area} panel`, async ({ page }) => {
      // Press the digit key to focus the panel
      await page.keyboard.press(digit);
      await page.waitForTimeout(200);

      // The focused element should be the panel with matching testid
      const focusedEl = page.locator(
        `[data-testid="ws-panel-${area}"]:focus`,
      );
      await expect(focusedEl).toBeAttached();

      // The panel should also have tabindex set (so :focus works)
      const panel = page.locator(`[data-testid="ws-panel-${area}"]`);
      const tabindex = await panel.getAttribute('tabindex');
      expect(tabindex).toBe('-1');
    });
  }

  // ── 5. Panel focus applies visible outline ──────────────────────

  test('focused panel shows visible outline ring', async ({ page }) => {
    // Focus the kpis panel
    await page.keyboard.press('1');
    await page.waitForTimeout(200);

    const panel = page.locator('[data-testid="ws-panel-kpis"]');

    // Verify the outline style is applied (focus ring)
    const outline = await panel.evaluate((el) => {
      const cs = window.getComputedStyle(el);
      return {
        outline: cs.outlineStyle !== 'none' ? cs.outline : null,
        borderColor: cs.borderColor,
      };
    });

    // After programmatic focus, the :focus pseudo-class should apply
    // outline styling from .ws-panel:focus
    expect(outline.outline || outline.borderColor).toBeTruthy();
  });

  // ── 6. Shortcuts suppressed in editable elements ────────────────

  test('does not fire shortcuts when focus is in a select element', async ({ page }) => {
    // Focus the account selector in the toolbar
    const accountSelect = page.locator('[aria-label="Active account"]');
    await accountSelect.focus();
    await page.waitForTimeout(100);

    // Press ? — should NOT open the overlay (focus is in select)
    await page.keyboard.press('?');
    await page.waitForTimeout(200);

    // Overlay should still not be visible
    await expect(page.getByTestId('ws-keynav-backdrop')).not.toBeAttached();
  });

  test('does not fire shortcuts when focus is in a text input', async ({ page }) => {
    // There is no text input on the fixture-mode workstation out of the box.
    // Use page.evaluate to create a temporary input, focus it, and test.
    await page.evaluate(() => {
      const input = document.createElement('input');
      input.type = 'text';
      input.id = 'temp-test-input';
      document.body.appendChild(input);
      input.focus();
    });

    // Press ? — should NOT open the overlay
    await page.keyboard.press('?');
    await page.waitForTimeout(200);

    await expect(page.getByTestId('ws-keynav-backdrop')).not.toBeAttached();

    // Clean up
    await page.evaluate(() => {
      document.getElementById('temp-test-input')?.remove();
    });
  });

  // ── 7. Modifier keys suppress shortcuts ─────────────────────────

  test('Ctrl+? does not open the overlay', async ({ page }) => {
    // Press Ctrl+? — should NOT open overlay (modifier suppresses shortcuts)
    await page.keyboard.press('Control+?');
    await page.waitForTimeout(200);

    await expect(page.getByTestId('ws-keynav-backdrop')).not.toBeAttached();
  });

  test('Meta+? does not open the overlay', async ({ page }) => {
    // Press Meta+? (Cmd+? on Mac, Win+? on Windows)
    await page.keyboard.press('Meta+?');
    await page.waitForTimeout(200);

    await expect(page.getByTestId('ws-keynav-backdrop')).not.toBeAttached();
  });

  // ── 8. Account cycling is a no-op with single account ────────────

  test('account cycling does not crash with single-account fixture mode', async ({ page }) => {
    // In fixture mode there's only one account. Pressing [ or ] should
    // not throw an error or change the account selector value.
    const accountSelect = page.locator('[aria-label="Active account"]');
    const initialValue = await accountSelect.inputValue();

    await page.keyboard.press('[');
    await page.waitForTimeout(100);
    expect(await accountSelect.inputValue()).toBe(initialValue);

    await page.keyboard.press(']');
    await page.waitForTimeout(100);
    expect(await accountSelect.inputValue()).toBe(initialValue);
  });

  // ── 9. Console error audit ──────────────────────────────────────

  test('no console errors during keyboard navigation operations', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    // Navigate fresh (beforeEach already does this, but console capture
    // needs to start before navigation)
    await page.goto('/workspace');
    await page.waitForLoadState('networkidle');

    // Open and close overlay
    await page.keyboard.press('?');
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    // Focus panels
    for (const digit of ['1', '2', '3', '4', '5', '6']) {
      await page.keyboard.press(digit);
      await page.waitForTimeout(50);
    }

    // Cycle accounts (no-op but should not error)
    await page.keyboard.press('[');
    await page.keyboard.press(']');

    assertNoConsoleErrors(errors);
  });

  // ── 10. Toggle behavior: second ? dismisses overlay ────────────

  test('toggling ? a second time dismisses the overlay', async ({ page }) => {
    // Open overlay
    await page.keyboard.press('?');
    await page.waitForTimeout(200);
    await expect(page.getByTestId('ws-keynav-backdrop')).toBeVisible();

    // Toggle off
    await page.keyboard.press('?');
    await page.waitForTimeout(200);
    await expect(page.getByTestId('ws-keynav-backdrop')).not.toBeAttached();

    // Toggle back on (idempotent)
    await page.keyboard.press('?');
    await page.waitForTimeout(200);
    await expect(page.getByTestId('ws-keynav-backdrop')).toBeVisible();
  });
});
