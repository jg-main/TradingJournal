import { test, expect, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { prepareAccountForTrading } from './helpers/trading-account';

const TS = Date.now();

async function openAssessAction(page: Page) {
  await page.getByRole('button', { name: 'More actions' }).click();
  const action = page.getByRole('menuitem', { name: 'Assess', exact: true });
  await expect(action).toBeVisible();
  return action;
}

/**
 * Expand a collapsible review section by its header (M020/S04). Review
 * sections (grade / mistakes / AI assessment / exit notes) start collapsed
 * in the closed-phase grid, so their content must be expanded before
 * asserting it.
 */
async function expandReviewSection(page: Page, title: string): Promise<void> {
  const trigger = page.locator('.td-review-section-trigger').filter({ hasText: title });
  await expect(trigger).toBeVisible();
  await trigger.click();
  await expect(page.locator('.td-review-section').filter({ hasText: title }).first()).toHaveAttribute('data-state', 'open');
}
const DB_PATH = process.env.DB_FILE_NAME || './.trading-journal/playwright-readiness.db';

/**
 * Seed an assessment snapshot directly into the test database so the
 * collapsible prompt/response sections render in the AssessmentCard.
 */
function seedAssessmentSnapshot(tradeId: string, promptText: string | null, rawResponse: string | null): void {
  const db = new Database(DB_PATH);
  try {
    const scorecardJson = JSON.stringify({
      dimensions: [
        { key: 'setup', label: 'Setup Quality', score: 7 },
        { key: 'risk', label: 'Risk Management', score: 8 },
        { key: 'entry', label: 'Entry Timing', score: 6 },
      ],
      overallScore: 72,
      gradeLabel: 'B',
      assessmentType: 'ai_quality',
      summary: 'Good trade plan with clear risk parameters.',
      metadata: {
        modelUsed: 'gpt-4o',
        promptTokens: 520,
        completionTokens: 180,
        durationMs: 2340,
      },
    });

    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO trade_assessment_snapshots (id, trade_id, assessed_at, assessment_type, overall_score, scorecard_json, model_used, prompt_tokens, completion_tokens, prompt_text, raw_response, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      tradeId,
      now,
      'ai_quality',
      72,
      scorecardJson,
      'gpt-4o',
      520,
      180,
      promptText,
      rawResponse,
      now,
    );
  } finally {
    db.close();
  }
}

test.describe('M021 S06 After-Exit Assessment UI Smoke Tests', () => {
  test.describe.configure({ mode: 'serial' });

  test('Closed trade detail page shows Assess button and assessment sections', async ({ page }) => {
    // ── Seed data: create account + closed trade ───────────────────
    const accRes = await page.request.post('/api/accounts', {
      data: { name: `M021-S06-${TS}`, isActive: true, startingBalance: 50000 },
    });
    expect(accRes.ok()).toBeTruthy();
    const account = await accRes.json();
    await prepareAccountForTrading(page.request, account.id);

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

    // Assessment is available from the header's actions menu.
    await openAssessAction(page);
    await page.keyboard.press('Escape');

    // ── Verify the AI Assessment review section header is visible ──
    const assessSectionHeader = page.locator('.td-review-section-trigger').filter({ hasText: 'AI Assessment' });
    await expect(assessSectionHeader).toBeVisible();

    // ── Expand it (M020/S04: review sections start collapsed) ─────
    await expandReviewSection(page, 'AI Assessment');

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
    await prepareAccountForTrading(page.request, account.id);

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
    await openAssessAction(page);
    await page.keyboard.press('Escape');

    // ── Click Assess and wait for the POST to settle ───────────────
    const assessAction = await openAssessAction(page);
    const responsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/api/trades') &&
        resp.url().includes('/assessments') &&
        resp.request().method() === 'POST',
    );
    await assessAction.click();
    await responsePromise;

    // ── After request completes, button returns to 'Assess' text ───
    await openAssessAction(page);
    await page.keyboard.press('Escape');

    // ── Expand the AI Assessment section to surface the result ─────
    await expandReviewSection(page, 'AI Assessment');

    // ── Verify either error message OR assessment heading is shown ─
    const hasError = await page.getByText('AI not configured').isVisible().catch(() => false);
    const hasHeading = await page.getByText('AI Quality Assessment').first().isVisible().catch(() => false);
    expect(hasError || hasHeading).toBeTruthy();

    console.log('CLOSED_ASSESS_TRIGGER_RESULT: PASS');
  });

  test('Collapsible prompt/response sections visible in closed trade assessment card', async ({ page }) => {
    // ── Seed data: create account + closed trade ───────────────────
    const accRes = await page.request.post('/api/accounts', {
      data: { name: `M021-S06-Coll-${TS}`, isActive: true, startingBalance: 50000 },
    });
    expect(accRes.ok()).toBeTruthy();
    const account = await accRes.json();
    await prepareAccountForTrading(page.request, account.id);

    const tradeRes = await page.request.post('/api/trades', {
      data: { symbol: `M06CL${TS}`, direction: 'long', accountId: account.id },
    });
    expect(tradeRes.ok()).toBeTruthy();
    const trade = await tradeRes.json();

    // ── Execute trade to close it ─────────────────────────────────
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

    // ── Seed an assessment snapshot with promptText and rawResponse ──
    const promptContent = 'Analyze the following closed trade for quality. Trade: long AAPL, entry: $100.50, exit: $105.00, fees: $2.50.';
    const rawResponseContent = '{\"overall\":72,\"grade\":\"B\"}';
    seedAssessmentSnapshot(trade.id, promptContent, rawResponseContent);

    // ── Navigate to closed trade detail page ───────────────────────
    await page.goto(`/trades/${trade.id}`);
    await page.waitForLoadState('networkidle');

    // ── Expand the AI Assessment section (M020/S04: collapsed default) ──
    await expandReviewSection(page, 'AI Assessment');

    // ── Verify the AssessmentCard shows scorecard data ─────────────
    await expect(page.getByText('72/100').first()).toBeVisible();
    await expect(page.getByText('B').first()).toBeVisible();

    // ── Verify collapsible trigger buttons render ─────────────────
    await expect(page.getByRole('button', { name: 'View Prompt' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'View Raw Response' })).toBeVisible();

    // ── Click View Prompt and verify content becomes visible ───────
    await page.getByRole('button', { name: 'View Prompt' }).click();
    await expect(page.getByText(promptContent)).toBeVisible();

    // ── Click View Raw Response and verify content becomes visible ─
    await page.getByRole('button', { name: 'View Raw Response' }).click();
    await expect(page.getByText('{"overall":')).toBeVisible();

    console.log('CLOSED_COLLAPSIBLE_RESULT: PASS');
  });

  test('After-exit UI includes History feed, P&L card, and Grade card', async ({ page }) => {
    // ── Seed data ─────────────────────────────────────────────────
    const accRes = await page.request.post('/api/accounts', {
      data: { name: `M021-S06-Cards-${TS}`, isActive: true, startingBalance: 50000 },
    });
    expect(accRes.ok()).toBeTruthy();
    const account = await accRes.json();
    await prepareAccountForTrading(page.request, account.id);

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
    const pnlCard = page.getByText('Total Fees', { exact: true });
    await expect(pnlCard).toBeVisible();

    // ── Verify unified History feed renders (Executions card removed in S05) ──
    const historyCard = page.locator('[data-slot="card-title"]').filter({ hasText: /^History$/ });
    await expect(historyCard).toBeVisible();

    // ── Expand Grade + AI Assessment sections (M020/S04 collapsed default) ──
    await expandReviewSection(page, 'Grade');
    await expandReviewSection(page, 'AI Assessment');

    // ── Verify Grade card (only shown on closed trades) ────────────
    const gradeCard = page.getByText('Trade Grade').first();
    await expect(gradeCard).toBeVisible();

    // ── Verify the feed shows the exit execution row (old Executions/Stop
    //    Adjustments card data now lives in the unified timeline) ──
    await expect(page.getByText('Sell', { exact: true }).first()).toBeVisible();

    // ── Verify both Assess button and assessment sections ──────────
    await openAssessAction(page);
    await page.keyboard.press('Escape');
    await expect(page.getByText('AI Quality Assessment').first()).toBeVisible();
    await expect(page.getByText('Assessment History').first()).toBeVisible();

    // ── Verify lifecycle stepper shows all phases (stepper label spans
    //    are text-[11px]; the Grade review section title is 13px, so the
    //    stepper label is the exact match) ─────────────────────────
    await expect(page.locator('span.text-\\[11px\\]').filter({ hasText: /^Grade$/ })).toBeVisible();

    console.log('CLOSED_CARDS_RESULT: PASS');
  });
});
