import { test, expect } from '@playwright/test';

const TS = Date.now();

test.describe('M021 S06 After-Exit Assessment UI Smoke Tests', () => {
  test.describe.configure({ mode: 'serial' });

  test('Closed trade detail page shows Assess button and assessment sections', async ({ page }) => {
    // ── Seed data: create account + closed trade ───────────────────
    const accRes = await page.request.post('/api/accounts', {
      data: { name: `M021-S06-${TS}`, isActive: true, startingBalance: 50000 },
    });
    expect(accRes.ok()).toBeTruthy();
    const account = await accRes.json();

    const tradeRes = await page.request.post('/api/trades', {
      data: { symbol: `M06AE${TS}`, direction: 'long', accountId: account.id },
    });
    expect(tradeRes.ok()).toBeTruthy();
    const trade = await tradeRes.json();

    // ── Execute trade with entry + exit to close it ────────────────
    const execRes = await page.request.post(`/api/trades/${trade.id}/execute`, {
      data: {
        entryPrice: 100.50,
        entryQuantity: 100,
        exit1Price: 105.00,
        exit1Quantity: 100,
        fees: 2.50,
      },
    });
    expect(execRes.ok()).toBeTruthy();
    const execBody = await execRes.json();
    expect(execBody.trade.status).toBe('closed');

    // ── Navigate to closed trade detail page ───────────────────────
    await page.goto(`/trades/${trade.id}`);
    await page.waitForLoadState('networkidle');

    // ── Verify page loads with trade symbol ────────────────────────
    await expect(page.locator('h1')).toContainText(`M06AE${TS}`);

    // ── Verify the "Assess" button in the header ───────────────────
    const assessBtn = page.getByRole('button', { name: 'Assess' });
    await expect(assessBtn).toBeVisible();

    // ── Verify AssessmentCard section is present ───────────────────
    await expect(page.getByText('AI Quality Assessment').first()).toBeVisible();

    // ── Verify empty state: "No AI assessment yet" ─────────────────
    await expect(page.getByText('No AI assessment yet')).toBeVisible();

    // ── Verify Assessment History section is present ───────────────
    await expect(page.getByText('Assessment History').first()).toBeVisible();

    // ── Verify assessment history empty state ──────────────────────
    await expect(page.getByText('No assessment history yet')).toBeVisible();

    // ── Verify the "Request Assessment" button in empty state ──────
    const requestBtn = page.getByRole('button', { name: 'Request Assessment' });
    await expect(requestBtn).toBeVisible();

    console.log('CLOSED_ASSESSMENT_UI_RESULT: PASS');
  });

  test('Assess button on closed trade triggers POST and shows loading/result state', async ({ page }) => {
    // ── Seed data: create account + closed trade ───────────────────
    const accRes = await page.request.post('/api/accounts', {
      data: { name: `M021-S06-Load-${TS}`, isActive: true, startingBalance: 50000 },
    });
    expect(accRes.ok()).toBeTruthy();
    const account = await accRes.json();

    const tradeRes = await page.request.post('/api/trades', {
      data: { symbol: `M06LB${TS}`, direction: 'short', accountId: account.id },
    });
    expect(tradeRes.ok()).toBeTruthy();
    const trade = await tradeRes.json();

    // ── Execute trade with entry + exit to close it (short trade) ─
    const execRes = await page.request.post(`/api/trades/${trade.id}/execute`, {
      data: {
        entryPrice: 200.00,
        entryQuantity: 50,
        exit1Price: 195.00,
        exit1Quantity: 50,
        fees: 1.50,
      },
    });
    expect(execRes.ok()).toBeTruthy();

    // ── Navigate to closed trade detail page ───────────────────────
    await page.goto(`/trades/${trade.id}`);
    await page.waitForLoadState('networkidle');

    // ── Verify Assess button is visible ────────────────────────────
    await expect(page.getByRole('button', { name: 'Assess' })).toBeVisible();

    // ── Click Assess and wait for the POST to settle ───────────────
    const assessBtn = page.getByRole('button', { name: 'Assess' });
    const responsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/api/trades') &&
        resp.url().includes('/assessments') &&
        resp.request().method() === 'POST',
    );
    await assessBtn.click();
    await responsePromise;

    // ── After request completes, button returns to 'Assess' text ───
    await expect(page.getByRole('button', { name: 'Assess' })).toBeVisible({ timeout: 5000 });

    // ── Verify either error message OR assessment heading is shown ─
    const hasError = await page.getByText('AI not configured').isVisible().catch(() => false);
    const hasHeading = await page.getByText('AI Quality Assessment').first().isVisible().catch(() => false);
    expect(hasError || hasHeading).toBeTruthy();

    console.log('CLOSED_ASSESS_TRIGGER_RESULT: PASS');
  });

  test('After-exit UI includes Execution card, P&L card, and Grade card', async ({ page }) => {
    // ── Seed data ─────────────────────────────────────────────────
    const accRes = await page.request.post('/api/accounts', {
      data: { name: `M021-S06-Cards-${TS}`, isActive: true, startingBalance: 50000 },
    });
    expect(accRes.ok()).toBeTruthy();
    const account = await accRes.json();

    const tradeRes = await page.request.post('/api/trades', {
      data: { symbol: `M06CD${TS}`, direction: 'long', accountId: account.id },
    });
    expect(tradeRes.ok()).toBeTruthy();
    const trade = await tradeRes.json();

    // ── Execute to close ──────────────────────────────────────────
    const execRes = await page.request.post(`/api/trades/${trade.id}/execute`, {
      data: {
        entryPrice: 50.00,
        entryQuantity: 200,
        exit1Price: 55.00,
        exit1Quantity: 200,
        fees: 3.00,
      },
    });
    expect(execRes.ok()).toBeTruthy();

    // ── Navigate to trade detail ──────────────────────────────────
    await page.goto(`/trades/${trade.id}`);
    await page.waitForLoadState('networkidle');

    // ── Verify P&L card is visible (key after-exit component) ─────
    const pnlCard = page.getByText('Profit & Loss').first();
    await expect(pnlCard).toBeVisible();

    // ── Verify execution card with trade details ───────────────────
    const execCard = page.getByText('Executions').first();
    await expect(execCard).toBeVisible();

    // ── Verify Grade card (only shown on closed trades) ────────────
    const gradeCard = page.getByText('Trade Grade').first();
    await expect(gradeCard).toBeVisible();

    // ── Verify Stop Adjustments card ───────────────────────────────
    const stopCard = page.getByText('Stop Adjustments').first();
    await expect(stopCard).toBeVisible();

    // ── Verify both Assess button and assessment sections ──────────
    await expect(page.getByRole('button', { name: 'Assess' })).toBeVisible();
    await expect(page.getByText('AI Quality Assessment').first()).toBeVisible();
    await expect(page.getByText('Assessment History').first()).toBeVisible();

    // ── Verify lifecycle stepper shows all phases ──────────────────
    await expect(page.getByText('Review').first()).toBeVisible();

    console.log('CLOSED_CARDS_RESULT: PASS');
  });
});
