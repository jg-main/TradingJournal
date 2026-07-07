import { test, expect } from '@playwright/test';

/**
 * M016 Checklist Flow — End-to-end E2E spec.
 *
 * Validates the entire pre-execution checklist workflow across all M016 slices:
 * 1. Defining account and setup checks via API
 * 2. Checklist gating in the execute dialog (UI flow)
 * 3. Check results persisted atomically during execution
 * 4. Pre-Execution Checklist audit panel on the trade detail page (open & closed)
 */

test.describe('M016 Checklist Flow', () => {
  test.describe.configure({ mode: 'serial' });

  test('full checklist workflow: define checks -> execute via UI -> verify audit panel', async ({ page }) => {
    // ── 1. Create a test account ──────────────────────────────────────
    const accRes = await page.request.post('/api/accounts', {
      data: {
        name: 'E2E M016 Checklist',
        isActive: true,
        startingBalance: 50000,
      },
    });
    expect(accRes.ok()).toBeTruthy();
    const account = await accRes.json();
    expect(account.id).toBeDefined();

    // ── 2. Create a setup definition (lowercase name to match lookup resolution) ──
    const setupName1 = `m016-tsla-${Date.now()}`;
    const setupRes = await page.request.post('/api/setup-definitions', {
      data: {
        name: setupName1,
        description: 'E2E test setup for M016 checklist flow',
      },
    });
    expect(setupRes.ok()).toBeTruthy();
    const setupDef = await setupRes.json();
    const setupId = setupDef.id;
    expect(setupId).toBeDefined();

    // ── 3. Add 2 account-level checks ─────────────────────────────────
    const check1Res = await page.request.post(`/api/accounts/${account.id}/checks`, {
      data: { description: 'Market is open for trading' },
    });
    expect(check1Res.ok()).toBeTruthy();
    const check1 = await check1Res.json();

    const check2Res = await page.request.post(`/api/accounts/${account.id}/checks`, {
      data: { description: 'Sufficient buying power for this position' },
    });
    expect(check2Res.ok()).toBeTruthy();
    const check2 = await check2Res.json();

    // ── 4. Add 1 setup-specific check ─────────────────────────────────
    const check3Res = await page.request.post(`/api/setups/${setupId}/checks`, {
      data: { description: 'Setup pattern confirmed on daily chart' },
    });
    expect(check3Res.ok()).toBeTruthy();
    const check3 = await check3Res.json();

    // ── 5. Create a planned trade with both accountId and setupId ─────
    const tradeRes = await page.request.post('/api/trades', {
      data: {
        symbol: 'M016-TSLA',
        direction: 'long',
        accountId: account.id,
        setupId: setupId,
        plannedEntry: 250.0,
        plannedStop: 240.0,
        plannedQuantity: 100,
      },
    });
    expect(tradeRes.ok()).toBeTruthy();
    const trade = await tradeRes.json();
    expect(trade.status).toBe('planned');

    // ── 6. Navigate to the trade detail page ──────────────────────────
    await page.goto(`/trades/${trade.id}`, { waitUntil: 'networkidle' });
    await expect(page.locator('h1')).toContainText('M016-TSLA');

    // Verify the "Planned" badge is visible
    await expect(page.locator('[data-slot="badge"]').filter({ hasText: 'Planned' }).first()).toBeVisible();

    // ── 7. Click the Execute button (visible in planned phase header) ─
    const executeButton = page.locator('button').filter({ hasText: 'Execute' });
    await expect(executeButton).toBeVisible();

    // Wait for the merged checklist API response before interacting
    const checklistResponse = page.waitForResponse(
      (resp) =>
        resp.url().includes('/api/checks/merged') &&
        resp.request().method() === 'GET' &&
        resp.status() === 200,
    );

    await executeButton.click();

    // ── 8. Wait for the checklist step to load ────────────────────────
    await checklistResponse;

    // Wait for checkboxes to appear in the dialog
    await page.waitForSelector('div[role="dialog"] input[type="checkbox"]', { timeout: 5000 });

    // Verify all 3 checklist items are rendered
    const checkboxes = page.locator('div[role="dialog"] input[type="checkbox"]');
    await expect(checkboxes).toHaveCount(3);

    // Verify the checklist heading is visible
    await expect(page.locator('div[role="dialog"] h3').filter({ hasText: 'Pre-Execution Checklist' })).toBeVisible();

    // ── 9. Check all 3 checkboxes ────────────────────────────────────
    const checkboxElements = await checkboxes.all();
    for (const cb of checkboxElements) {
      await cb.check();
    }

    // Verify all are checked
    for (const cb of checkboxElements) {
      await expect(cb).toBeChecked();
    }

    // ── 10. Click the Proceed button ──────────────────────────────────
    const proceedButton = page.locator('div[role="dialog"] button').filter({ hasText: 'Proceed' });
    await expect(proceedButton).toBeEnabled();
    await proceedButton.click();

    // ── 11. Fill the entry form ───────────────────────────────────────
    // Wait for entry form to render
    await page.waitForSelector('#entryPrice', { timeout: 5000 });

    // Fill Entry Price, Stop Price, and Size
    await page.fill('#entryPrice', '250.00');
    await page.fill('#stopPrice', '240.00');
    await page.fill('#entryQuantity', '100');

    // ── 12. Click the Execute submit button ───────────────────────────
    const executeResponse = page.waitForResponse(
      (resp) =>
        resp.url().includes('/api/trades/') &&
        resp.url().includes('/execute') &&
        resp.request().method() === 'POST' &&
        resp.status() === 201,
    );

    // Click the Execute submit button
    await page.locator('div[role="dialog"] button[type="submit"]').click();

    // Wait for the execute API call to complete
    await executeResponse;

    // ── 13. Wait for the dialog to close ──────────────────────────────
    await page.waitForSelector('div[role="dialog"]', { state: 'hidden', timeout: 8000 }).catch(() => {
      // Dialog may close before we check
    });

    // ── 14. Navigate to trade detail page fresh to see Open state ─────
    // The page should now show ActivePhaseView with the audit card
    await page.goto(`/trades/${trade.id}`, { waitUntil: 'networkidle' });

    // Verify the trade is now Open
    await expect(page.locator('[data-slot="badge"]').filter({ hasText: 'Open' }).first()).toBeVisible();

    // ── 15. Verify the Pre-Execution Checklist audit panel ────────────
    await expect(page.locator('[data-slot="card-title"]').filter({ hasText: 'Pre-Execution Checklist' })).toBeVisible();

    // Verify all 3 check descriptions are shown
    await expect(page.getByText('Market is open for trading')).toBeVisible();
    await expect(page.getByText('Sufficient buying power for this position')).toBeVisible();
    await expect(page.getByText('Setup pattern confirmed on daily chart')).toBeVisible();

    // Verify timestamps are shown
    const verifiedLabels = page.locator('text=Verified');
    await expect(verifiedLabels).toHaveCount(3);

    // Verify both passed indicators (CheckCircle2 icons) are visible
    // Each passed check has an SVG check icon — 3 passed checks
    const svgIcons = page.locator('ul.space-y-3 svg');
    await expect(svgIcons).toHaveCount(3);
  });

  test('trade with setup checks only (no account checks) shows correct audit', async ({ page }) => {
    // ── 1. Create a test account (no checks) ──────────────────────────
    const accRes = await page.request.post('/api/accounts', {
      data: {
        name: 'E2E M016 Setup-Only',
        isActive: true,
        startingBalance: 50000,
      },
    });
    expect(accRes.ok()).toBeTruthy();
    const account = await accRes.json();
    expect(account.id).toBeDefined();

    // ── 2. Create a setup definition ──────────────────────────────────
    const setupName2 = `m016-aapl-${Date.now()}`;
    const setupRes = await page.request.post('/api/setup-definitions', {
      data: {
        name: setupName2,
        description: 'E2E test setup for M016 setup-only checks',
      },
    });
    expect(setupRes.ok()).toBeTruthy();
    const setupDef = await setupRes.json();
    const setupId = setupDef.id;
    expect(setupId).toBeDefined();

    // ── 3. Add 1 setup-specific check ─────────────────────────────────
    const checkRes = await page.request.post(`/api/setups/${setupId}/checks`, {
      data: { description: 'Breakout above resistance confirmed' },
    });
    expect(checkRes.ok()).toBeTruthy();
    const checkItem = await checkRes.json();
    expect(checkItem.id).toBeDefined();

    // ── 4. Create a planned trade ─────────────────────────────────────
    const tradeRes = await page.request.post('/api/trades', {
      data: {
        symbol: 'M016-AAPL',
        direction: 'long',
        accountId: account.id,
        setupId: setupId,
      },
    });
    expect(tradeRes.ok()).toBeTruthy();
    const trade = await tradeRes.json();
    expect(trade.status).toBe('planned');

    // ── 5. Execute via API with checkResults ───────────────────────────
    const execRes = await page.request.post(`/api/trades/${trade.id}/execute`, {
      data: {
        entryPrice: 200.0,
        entryQuantity: 50,
        stopPrice: 190.0,
        fees: 2.0,
        checkResults: [
          {
            checklistDefinitionId: checkItem.id,
            passed: true,
          },
        ],
      },
    });
    expect(execRes.ok()).toBeTruthy();
    const execData = await execRes.json();
    expect(execData.trade.status).toBe('open');

    // ── 6. Navigate to trade detail page ──────────────────────────────
    await page.goto(`/trades/${trade.id}`, { waitUntil: 'networkidle' });
    await expect(page.locator('h1')).toContainText('M016-AAPL');

    // Verify the trade is Open
    await expect(page.locator('[data-slot="badge"]').filter({ hasText: 'Open' }).first()).toBeVisible();

    // ── 7. Verify Pre-Execution Checklist card shows 1 check result ──
    await expect(page.locator('[data-slot="card-title"]').filter({ hasText: 'Pre-Execution Checklist' })).toBeVisible();

    // Verify the setup check description is visible
    await expect(page.getByText('Breakout above resistance confirmed')).toBeVisible();

    // Verify exactly 1 timestamp
    await expect(page.getByText('Verified')).toHaveCount(1);

    // Verify exactly 1 check icon
    const svgIcons = page.locator('ul.space-y-3 svg');
    await expect(svgIcons).toHaveCount(1);
  });

  test('drag-and-drop reorder persists across page reload on account settings', async ({ page }) => {
    // ── 1. Create a test account ──────────────────────────────────────
    const accRes = await page.request.post('/api/accounts', {
      data: {
        name: 'E2E M016 Reorder',
        isActive: true,
        startingBalance: 50000,
      },
    });
    expect(accRes.ok()).toBeTruthy();
    const account = await accRes.json();
    expect(account.id).toBeDefined();

    // ── 2. Create 3 account-level checks via API in a known order ───
    const c1Res = await page.request.post(`/api/accounts/${account.id}/checks`, {
      data: { description: 'First check' },
    });
    expect(c1Res.ok()).toBeTruthy();

    const c2Res = await page.request.post(`/api/accounts/${account.id}/checks`, {
      data: { description: 'Second check' },
    });
    expect(c2Res.ok()).toBeTruthy();

    const c3Res = await page.request.post(`/api/accounts/${account.id}/checks`, {
      data: { description: 'Third check' },
    });
    expect(c3Res.ok()).toBeTruthy();

    // ── 3. Navigate to account settings page ─────────────────────────
    await page.goto(`/settings/accounts/${account.id}`, { waitUntil: 'networkidle' });

    // Wait for checks to load
    await expect(page.getByText('Account Entry Checks')).toBeVisible();
    await expect(page.getByText('First check')).toBeVisible();
    await expect(page.getByText('Third check')).toBeVisible();

    // ── 4. Verify initial order ──────────────────────────────────────
    const checkItems = page.locator('[aria-label^="Edit check:"]');
    let texts = await checkItems.allTextContents();
    expect(texts).toEqual(['First check', 'Second check', 'Third check']);

    // ── 5. Drag "First check" grip to below "Third check" ─────────────
    const firstGrip = page.locator('[aria-label="Drag to reorder"]').first();
    const thirdItem = page.locator('[aria-label^="Edit check:"]').nth(2);

    // Manual mouse drag — @dnd-kit PointerSensor activates after 5px movement
    const firstBox = await firstGrip.boundingBox();
    const thirdBox = await thirdItem.boundingBox();

    if (firstBox && thirdBox) {
      // Start drag from center of first grip handle
      await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2);
      await page.mouse.down();
      // Move >5px right to activate PointerSensor (activationConstraint: { distance: 5 })
      await page.mouse.move(firstBox.x + firstBox.width / 2 + 15, firstBox.y + firstBox.height / 2, { steps: 3 });
      await page.waitForTimeout(150);
      // Drag down below the third item
      await page.mouse.move(thirdBox.x + thirdBox.width / 2, thirdBox.y + thirdBox.height + 20, { steps: 10 });
      await page.waitForTimeout(150);
      await page.mouse.up();
    }

    // Wait for reorder API call to complete
    await page.waitForResponse(
      (resp) =>
        resp.url().includes('/api/checks/reorder') &&
        resp.request().method() === 'POST' &&
        resp.status() === 200,
      { timeout: 5000 },
    );

    // ── 6. Verify new order after drag ───────────────────────────────
    texts = await checkItems.allTextContents();
    expect(texts).toEqual(['Second check', 'Third check', 'First check']);

    // ── 7. Hard reload and verify order persisted ─────────────────────
    await page.reload({ waitUntil: 'networkidle' });

    await expect(page.getByText('Account Entry Checks')).toBeVisible();
    await expect(page.getByText('First check')).toBeVisible();

    texts = await checkItems.allTextContents();
    expect(texts).toEqual(['Second check', 'Third check', 'First check']);
  });

  test('trade with no checks shows empty state audit panel', async ({ page }) => {
    // ── 1. Create a test account (no checks, no setup) ────────────────
    const accRes = await page.request.post('/api/accounts', {
      data: {
        name: 'E2E M016 No-Checks',
        isActive: true,
        startingBalance: 50000,
      },
    });
    expect(accRes.ok()).toBeTruthy();
    const account = await accRes.json();
    expect(account.id).toBeDefined();

    // ── 2. Create a trade without a setup (no checks at all) ──────────
    const tradeRes = await page.request.post('/api/trades', {
      data: {
        symbol: 'M016-NOCHK',
        direction: 'long',
        accountId: account.id,
        // No setupId — no checks will match
      },
    });
    expect(tradeRes.ok()).toBeTruthy();
    const trade = await tradeRes.json();
    expect(trade.status).toBe('planned');

    // ── 3. Execute via API (no checkResults needed since no checks) ───
    const execRes = await page.request.post(`/api/trades/${trade.id}/execute`, {
      data: {
        entryPrice: 150.0,
        entryQuantity: 30,
        stopPrice: 145.0,
        fees: 1.0,
      },
    });
    expect(execRes.ok()).toBeTruthy();
    const execData = await execRes.json();
    expect(execData.trade.status).toBe('open');

    // ── 4. Navigate to trade detail page ──────────────────────────────
    await page.goto(`/trades/${trade.id}`, { waitUntil: 'networkidle' });

    // Verify Open badge
    await expect(page.locator('[data-slot="badge"]').filter({ hasText: 'Open' }).first()).toBeVisible();

    // ── 5. Verify Pre-Execution Checklist card shows empty state ──────
    await expect(page.locator('[data-slot="card-title"]').filter({ hasText: 'Pre-Execution Checklist' })).toBeVisible();

    // Empty state text should be shown
    await expect(page.getByText('No pre-execution checks were verified for this trade.')).toBeVisible();

    // No SVG icons should be present inside the card content
    await expect(page.locator('ul.space-y-3')).not.toBeVisible();
  });
});
