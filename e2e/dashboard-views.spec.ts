/**
 * M002 S03 T05 — Dashboard View Management E2E spec.
 *
 * Covers the full view management lifecycle:
 * 1. View switcher renders with default "Default" view
 * 2. Create new view via dropdown
 * 3. Switch between views (instant layout restore)
 * 4. Rename a user view via Manage Views dialog
 * 5. Duplicate a view
 * 6. Delete a view
 * 7. Persistence across page reload (localStorage)
 * 8. System views are read-only (no delete/rename)
 * 9. Creating a view while in customization mode exits customization first
 * 10. Console error audit during view operations
 */

import { test, expect } from '@playwright/test';

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Minimal empty dashboard API response so the page renders without error.
 */
function emptyDashboardResponse(): Record<string, unknown> {
  return {
    kpis: {
      totalTrades: 0,
      winRate: null,
      netPnl: 0,
      avgR: null,
      avgGrade: null,
      currentDrawdown: null,
      accountValue: null,
      profitFactor: null,
      avgWin: null,
      avgLoss: null,
    },
    mtm: null,
    equityCurve: [],
    drawdown: [],
    monthlyPerformance: [],
    rDistribution: [],
    directionalPerformance: null,
    processScoreDistribution: null,
    tradeMarkers: [],
    calendarHeatmap: [],
    periodMatrix: {},
    setupRanking: [],
    attentionInsights: { insights: [], tradeCount: 0 },
  };
}

/**
 * Minimal empty V2 dashboard response.
 */
function emptyDashboardV2Response(): Record<string, unknown> {
  return {
    trades: [],
    accountPeriod: null,
    accounts: [],
    totalAccounts: 0,
  };
}

/**
 * Mock the two dashboard API endpoints with empty data so the page
 * renders without a real database and does not show error states.
 */
async function mockDashboardApi(page: import('@playwright/test').Page): Promise<void> {
  await page.route('**/api/dashboard', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(emptyDashboardResponse()),
      });
    } else {
      await route.continue();
    }
  });

  await page.route('**/api/dashboard/v2', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(emptyDashboardV2Response()),
      });
    } else {
      await route.continue();
    }
  });
}

/**
 * Collect console errors during a test. Call before page navigation.
 */
function captureConsoleErrors(page: import('@playwright/test').Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });
  return errors;
}

/**
 * Assert zero unfiltered console errors.
 */
function assertNoConsoleErrors(errors: string[]): void {
  const actualErrors = errors.filter(
    (e) =>
      !e.includes('Failed to load resource') &&
      !e.includes('ERR_BLOCKED_BY_CLIENT') &&
      !e.includes('favicon.ico'),
  );
  expect(actualErrors).toEqual([]);
}

/**
 * Open the view switcher dropdown and wait for content to appear.
 */
async function openViewSwitcher(page: import('@playwright/test').Page): Promise<void> {
  await page.getByTestId('view-switcher-trigger').click();
  await expect(page.getByTestId('view-switcher-content')).toBeVisible();
}

/**
 * Assert that the view switcher trigger shows a given name.
 */
async function assertCurrentViewName(page: import('@playwright/test').Page, name: string): Promise<void> {
  await expect(page.getByTestId('view-switcher-current-name')).toHaveText(name);
}

/**
 * Accept a window.prompt() dialog by waiting for it, typing a name, and clicking OK.
 * For cancelled prompts, use dismissDialog(page).
 */
async function acceptPrompt(page: import('@playwright/test').Page, name: string): Promise<void> {
  const dialog = await page.waitForEvent('dialog');
  expect(dialog.type()).toBe('prompt');
  await dialog.accept(name);
}

/**
 * Dismiss (cancel) a window.prompt() dialog.
 */
async function dismissDialog(page: import('@playwright/test').Page): Promise<void> {
  const dialog = await page.waitForEvent('dialog');
  await dialog.dismiss();
}

/**
 * Create a new user view with the given name.
 * Opens the view switcher, clicks "Create New View", accepts the prompt.
 */
async function createView(page: import('@playwright/test').Page, name: string): Promise<void> {
  await openViewSwitcher(page);
  const clickPromise = page.getByTestId('view-create-new').click();
  await acceptPrompt(page, name);
  await clickPromise;
  await page.waitForTimeout(300);
}

/**
 * Open the Manage Views dialog from the view switcher dropdown.
 * Assumes the dropdown is already open.
 */
async function openManageViews(page: import('@playwright/test').Page): Promise<void> {
  await page.getByTestId('view-manage-views').click();
  await expect(page.getByTestId('manage-views-dialog')).toBeVisible();
}

// ── Tests ──────────────────────────────────────────────────────────────

test.describe('Dashboard View Management', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await mockDashboardApi(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // Clear localStorage and reload to start with a clean view state
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForLoadState('networkidle');
  });

  // ── 1. View Switcher Renders ───────────────────────────────────────

  test('view switcher shows "Default" view name', async ({ page }) => {
    // The view switcher trigger should show "Default" (first system view with isDefault)
    await expect(page.getByTestId('view-switcher-trigger')).toBeVisible();
    await assertCurrentViewName(page, 'Default');
  });

  test('view switcher dropdown lists all system views and actions', async ({ page }) => {
    await openViewSwitcher(page);

    // All four system views should be listed
    await expect(page.getByTestId('view-item-system-default')).toContainText('Default');
    await expect(page.getByTestId('view-item-system-trading-risk')).toContainText('Trading Risk');
    await expect(page.getByTestId('view-item-system-performance')).toContainText('Performance');
    await expect(page.getByTestId('view-item-system-process-review')).toContainText('Process Review');

    // "Create New View" and "Manage Views…" action items should be present
    await expect(page.getByTestId('view-create-new')).toBeVisible();
    await expect(page.getByTestId('view-manage-views')).toBeVisible();

    // The active view ("Default") should have a checkmark
    const activeItem = page.getByTestId('view-item-system-default');
    await expect(activeItem.locator('svg.lucide-check')).toBeVisible();
  });

  // ── 2. Create New View ─────────────────────────────────────────────

  test('creates a new view and switches to it', async ({ page }) => {
    await createView(page, 'My Custom View');

    // After creation, the view switcher should show the new view name
    await assertCurrentViewName(page, 'My Custom View');

    // Re-open the dropdown — the new view name should appear in the content
    await openViewSwitcher(page);
    await expect(page.getByTestId('view-switcher-content')).toContainText('My Custom View');
  });

  test('create new view with cancelled prompt does nothing', async ({ page }) => {
    await openViewSwitcher(page);

    // Click create and cancel the prompt
    const clickPromise = page.getByTestId('view-create-new').click();
    await dismissDialog(page);
    await clickPromise;
    await page.waitForTimeout(300);

    // Should still show "Default"
    await assertCurrentViewName(page, 'Default');
  });

  // ── 3. Switch Between Views ────────────────────────────────────────

  test('switches to a different system view', async ({ page }) => {
    await openViewSwitcher(page);

    // Click "Trading Risk"
    await page.getByTestId('view-item-system-trading-risk').click();
    await page.waitForTimeout(300);

    // Should now show "Trading Risk"
    await assertCurrentViewName(page, 'Trading Risk');
  });

  test('switches between user views', async ({ page }) => {
    // Create view "Alpha"
    await createView(page, 'Alpha');

    // Create view "Beta"
    await createView(page, 'Beta');

    // Should be on Beta (most recently created)
    await assertCurrentViewName(page, 'Beta');

    // Switch back to Alpha by finding it by text in the dropdown
    await openViewSwitcher(page);
    await page.getByTestId('view-switcher-content').getByText('Alpha').click();
    await page.waitForTimeout(300);
    await assertCurrentViewName(page, 'Alpha');
  });

  test('remembers the last active view after switching', async ({ page }) => {
    await createView(page, 'Memory');
    await assertCurrentViewName(page, 'Memory');

    // Switch to Default
    await openViewSwitcher(page);
    await page.getByTestId('view-item-system-default').click();
    await page.waitForTimeout(300);
    await assertCurrentViewName(page, 'Default');

    // Switch back to Memory
    await openViewSwitcher(page);
    await page.getByTestId('view-switcher-content').getByText('Memory').click();
    await page.waitForTimeout(300);
    await assertCurrentViewName(page, 'Memory');
  });

  // ── 4. Manage Views: Rename ────────────────────────────────────────

  test('renames a user view via Manage Views dialog', async ({ page }) => {
    // Create a user view first
    await createView(page, 'Old Name');

    // Open Manage Views dialog
    await openViewSwitcher(page);
    await openManageViews(page);

    const dialogBody = page.getByTestId('manage-views-body');
    const userSection = page.getByTestId('user-views-section');
    await expect(userSection).toContainText('Old Name');

    // Hover the view row to reveal action buttons (opacity transition)
    const viewRow = userSection.locator('[data-testid^="manage-view-"]').filter({ hasText: 'Old Name' }).first();
    await viewRow.hover();
    await page.waitForTimeout(300);

    // Click the rename button scoped to this row
    const renameBtn = viewRow.locator('[data-testid$="-rename"]');
    await renameBtn.click();
    await page.waitForTimeout(200);

    // Inline rename input should appear
    await expect(page.getByTestId('inline-rename-input')).toBeVisible();

    // Type a new name
    await page.getByTestId('inline-rename-input').fill('Renamed View');
    await page.getByTestId('inline-rename-save').click();
    await page.waitForTimeout(300);

    // The dialog should now show "Renamed View" and not "Old Name"
    await expect(dialogBody).toContainText('Renamed View');
    await expect(dialogBody).not.toContainText('Old Name');

    // Close dialog via Escape and verify the dropdown also shows the new name
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await assertCurrentViewName(page, 'Renamed View');
  });

  test('inline rename can be cancelled', async ({ page }) => {
    await createView(page, 'Cancel Rename');

    await openViewSwitcher(page);
    await openManageViews(page);

    const userSection = page.getByTestId('user-views-section');
    const viewRow = userSection.locator('[data-testid^="manage-view-"]').filter({ hasText: 'Cancel Rename' }).first();
    await viewRow.hover();
    await page.waitForTimeout(300);

    // Click rename scoped to this row
    const renameBtn = viewRow.locator('[data-testid$="-rename"]');
    await renameBtn.click();
    await page.waitForTimeout(200);

    // Cancel the rename
    await page.getByTestId('inline-rename-cancel').click();
    await page.waitForTimeout(200);

    // View name should still be the original
    await expect(userSection).toContainText('Cancel Rename');
  });

  // ── 5. Manage Views: Duplicate ─────────────────────────────────────

  test('duplicates a user view', async ({ page }) => {
    await createView(page, 'Original View');

    await openViewSwitcher(page);
    await openManageViews(page);

    const userSection = page.getByTestId('user-views-section');

    // Hover to reveal action buttons
    const viewRow = userSection.locator('[data-testid^="manage-view-"]').filter({ hasText: 'Original View' }).first();
    await viewRow.hover();
    await page.waitForTimeout(300);

    // Click duplicate scoped to this row
    const duplicateBtn = viewRow.locator('[data-testid$="-duplicate"]');
    await duplicateBtn.click();
    await page.waitForTimeout(300);

    // A new view "Original View (Copy)" should appear
    await expect(userSection).toContainText('Original View (Copy)');

    // Close dialog and verify we switched to the copy
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await assertCurrentViewName(page, 'Original View (Copy)');
  });

  test('duplicates a system view via Edit button', async ({ page }) => {
    await openViewSwitcher(page);
    await openManageViews(page);

    // The "Edit" (copy) button on system-default should exist and be clickable
    const editBtn = page.getByTestId('manage-view-system-default-edit');
    await expect(editBtn).toBeVisible();
    await editBtn.click();
    await page.waitForTimeout(300);

    // A user copy named "Default (Copy)" should appear in User Views
    const userSection = page.getByTestId('user-views-section');
    await expect(userSection).toContainText('Default (Copy)');

    // We should now be on the copy
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await assertCurrentViewName(page, 'Default (Copy)');
  });

  // ── 6. Manage Views: Delete ────────────────────────────────────────

  test('deletes a user view with confirmation', async ({ page }) => {
    // Need at least two user views (can't delete the last one)
    await createView(page, 'View A');
    await createView(page, 'View B');

    await openViewSwitcher(page);
    await openManageViews(page);

    const userSection = page.getByTestId('user-views-section');
    await expect(userSection).toContainText('View B');
    await expect(userSection).toContainText('View A');

    // Locate the specific view row for View B using data-testid prefix
    const viewBRow = userSection.locator('[data-testid^="manage-view-"]').filter({ hasText: 'View B' }).first();
    await viewBRow.hover();
    await page.waitForTimeout(300);

    // Find the delete button scoped to this row
    const deleteBtn = viewBRow.locator('[data-testid$="-delete"]');
    await deleteBtn.click();
    await page.waitForTimeout(200);

    // Confirm prompt should appear
    await expect(page.getByTestId('confirm-prompt')).toBeVisible();
    await page.getByTestId('confirm-prompt-yes').click();
    await page.waitForTimeout(300);

    // View B should be gone, View A should remain
    await expect(userSection).not.toContainText('View B');
    await expect(userSection).toContainText('View A');

    // Close dialog — should now be on the first view (Default, since View B was active)
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await assertCurrentViewName(page, 'Default');
  });

  test('delete confirmation can be cancelled', async ({ page }) => {
    // Create two user views
    await createView(page, 'Keep Me');
    await createView(page, 'Temp');

    await openViewSwitcher(page);
    await openManageViews(page);

    const userSection = page.getByTestId('user-views-section');

    // Locate the specific view row for "Temp"
    const tempRow = userSection.locator('[data-testid^="manage-view-"]').filter({ hasText: 'Temp' }).first();
    await tempRow.hover();
    await page.waitForTimeout(300);

    // Find the delete button scoped to this row
    const deleteBtn = tempRow.locator('[data-testid$="-delete"]');
    await deleteBtn.click();
    await page.waitForTimeout(200);

    // Cancel the confirmation
    await expect(page.getByTestId('confirm-prompt')).toBeVisible();
    await page.getByTestId('confirm-prompt-no').click();
    await page.waitForTimeout(200);

    // The view should still be there
    await expect(userSection).toContainText('Temp');
    await expect(page.getByTestId('confirm-prompt')).not.toBeVisible();
  });

  // ── 7. Persistence Across Reload ───────────────────────────────────

  test('views persist across page reload (localStorage)', async ({ page }) => {
    await createView(page, 'Persisted View');
    await assertCurrentViewName(page, 'Persisted View');

    // Reload the page — views should be restored from localStorage
    await page.reload();
    await page.waitForLoadState('networkidle');

    // The view switcher should still show "Persisted View"
    await assertCurrentViewName(page, 'Persisted View');

    // Verify localStorage has the expected structure
    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem('dashboard:views:v2');
      if (!raw) return null;
      return JSON.parse(raw);
    });
    expect(stored).not.toBeNull();
    expect(stored!.version).toBe(2);
    expect(Array.isArray(stored!.views)).toBe(true);
    expect(stored!.views.length).toBeGreaterThanOrEqual(5); // 4 system + 1 user
    const userView = stored!.views.find((v: { isSystem: boolean }) => !v.isSystem);
    expect(userView).toBeDefined();
    expect(userView!.name).toBe('Persisted View');
  });

  test('localStorage schema is well-formed after view operations', async ({ page }) => {
    // Perform a sequence of view operations
    await createView(page, 'V1');
    await createView(page, 'V2');
    await createView(page, 'V3');

    // Delete V3
    await openViewSwitcher(page);
    await openManageViews(page);
    const userSection = page.getByTestId('user-views-section');
    const v3Row = userSection.locator('[data-testid^="manage-view-"]').filter({ hasText: 'V3' }).first();
    await v3Row.hover();
    await page.waitForTimeout(300);
    const deleteBtn = v3Row.locator('[data-testid$="-delete"]');
    await deleteBtn.click();
    await page.waitForTimeout(200);
    await page.getByTestId('confirm-prompt-yes').click();
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // Verify localStorage structure
    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem('dashboard:views:v2');
      if (!raw) return null;
      return JSON.parse(raw);
    });
    expect(stored).not.toBeNull();
    expect(stored!.version).toBe(2);
    expect(stored!.activeViewId).toBeTruthy();

    // Should have 4 system + 2 user views
    expect(stored!.views.length).toBe(6);

    // All views must have required fields
    for (const view of stored!.views) {
      expect(view).toHaveProperty('id');
      expect(view).toHaveProperty('name');
      expect(view).toHaveProperty('layout');
      expect(view).toHaveProperty('hiddenWidgetIds');
      expect(view).toHaveProperty('isSystem');
      expect(typeof view.isSystem).toBe('boolean');
    }
  });

  // ── 8. System Views Are Read-Only ─────────────────────────────────

  test('system views are read-only in Manage Views dialog', async ({ page }) => {
    await openViewSwitcher(page);
    await openManageViews(page);

    // System views should have "System" badge
    const systemDefaultRow = page.getByTestId('manage-view-system-default');
    await expect(systemDefaultRow).toContainText('System');

    // System views should have an "Edit" (copy) button
    const editBtn = page.getByTestId('manage-view-system-default-edit');
    await expect(editBtn).toBeVisible();
  });

  test('system views lack rename and delete buttons', async ({ page }) => {
    await openViewSwitcher(page);
    await openManageViews(page);

    // System views should not have rename or delete buttons
    const defaultRow = page.getByTestId('manage-view-system-default');
    const renameBtn = defaultRow.locator('[data-testid$="-rename"]');
    const deleteBtn = defaultRow.locator('[data-testid$="-delete"]');
    await expect(renameBtn).toHaveCount(0);
    await expect(deleteBtn).toHaveCount(0);
  });

  // ── 9. Customization + View Management Interaction ─────────────────

  test('creating a view during customization keeps customization active', async ({ page }) => {
    // Enter customization mode — opens the Add/Remove widgets dialog
    await page.getByRole('button', { name: 'Edit Layout' }).click();
    await page.waitForTimeout(200);

    // Verify the AddRemoveWidgetsDialog appeared
    const addRemoveDialog = page.getByRole('dialog', { name: 'Widgets' });
    await expect(addRemoveDialog).toBeVisible();

    // Close the dialog with Escape to reveal the toolbar buttons
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await expect(addRemoveDialog).not.toBeVisible();

    // Now customization buttons should be visible in the toolbar
    await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Cancel/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reset' })).toBeVisible();

    // Open the view switcher and create a new view
    await openViewSwitcher(page);
    const clickPromise = page.getByTestId('view-create-new').click();
    await acceptPrompt(page, 'Customization View');
    await clickPromise;
    await page.waitForTimeout(300);

    // Creating a view switches to the new view but does NOT exit customization
    await assertCurrentViewName(page, 'Customization View');
    await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Cancel/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit Layout' })).not.toBeVisible();
  });

  test('switching views while in customization mode exits customization first', async ({ page }) => {
    // Enter customization mode
    await page.getByRole('button', { name: 'Edit Layout' }).click();
    await page.waitForTimeout(200);

    // Close the AddRemoveWidgetsDialog
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // Verify customization is active
    await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();

    // Switch to a different view via the dropdown
    await openViewSwitcher(page);
    await page.getByTestId('view-item-system-trading-risk').click();
    await page.waitForTimeout(300);

    // Switching views should exit customization mode
    await assertCurrentViewName(page, 'Trading Risk');
    await expect(page.getByRole('button', { name: 'Edit Layout' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save' })).not.toBeVisible();
  });

  // ── 10. Console Error Audit ────────────────────────────────────────

  test('no console errors during view operations', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    // Create a view
    await createView(page, 'Error Test View');

    // Switch to Default
    await openViewSwitcher(page);
    await page.getByTestId('view-item-system-default').click();
    await page.waitForTimeout(300);

    // Switch back
    await openViewSwitcher(page);
    await page.getByTestId('view-switcher-content').getByText('Error Test View').click();
    await page.waitForTimeout(300);

    // Open Manage Views, rename, duplicate, delete
    await openViewSwitcher(page);
    await openManageViews(page);

    const userSection = page.getByTestId('user-views-section');

    // Rename — scope to the specific view row
    let viewRow = userSection.locator('[data-testid^="manage-view-"]').filter({ hasText: 'Error Test View' }).first();
    await viewRow.hover();
    await page.waitForTimeout(300);
    const renameBtn = viewRow.locator('[data-testid$="-rename"]');
    await renameBtn.click();
    await page.waitForTimeout(200);
    await page.getByTestId('inline-rename-input').fill('Renamed');
    await page.getByTestId('inline-rename-save').click();
    await page.waitForTimeout(300);
    await expect(userSection).toContainText('Renamed');

    // Duplicate — scope to the renamed view row
    let renamedRow = userSection.locator('[data-testid^="manage-view-"]').filter({ hasText: 'Renamed' }).first();
    await renamedRow.hover();
    await page.waitForTimeout(300);
    const duplicateBtn = renamedRow.locator('[data-testid$="-duplicate"]');
    await duplicateBtn.click();
    await page.waitForTimeout(300);
    await expect(userSection).toContainText('Renamed (Copy)');

    // Delete the copy — scope to the copy view row
    let copyRow = userSection.locator('[data-testid^="manage-view-"]').filter({ hasText: 'Renamed (Copy)' }).first();
    await copyRow.hover();
    await page.waitForTimeout(300);
    const deleteBtn = copyRow.locator('[data-testid$="-delete"]');
    await deleteBtn.click();
    await page.waitForTimeout(200);
    await page.getByTestId('confirm-prompt-yes').click();
    await page.waitForTimeout(300);

    // Close dialog
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // Assert no console errors
    assertNoConsoleErrors(errors);
  });
});
