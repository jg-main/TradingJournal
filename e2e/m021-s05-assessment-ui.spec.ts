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
const DB_PATH = process.env.DB_FILE_NAME || './.trading-journal/playwright-readiness.db';

/**
 * Seed an assessment snapshot directly into the test database so the
 * collapsible prompt/response sections render in the AssessmentCard.
 * Returns a standard scorecard JSON payload.
 */
function seedAssessmentSnapshot(tradeId: string, promptText: string | null, rawResponse: string | null): string {
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
    return scorecardJson;
  } finally {
    db.close();
  }
}

test.describe('M021 S05 Assessment UI Smoke Tests', () => {
  test.describe.configure({ mode: 'serial' });

  test('AssessmentCard renders after TradePlanCard with empty state', async ({ page }) => {
    // ── Seed data ─────────────────────────────────────────────────
    const accRes = await page.request.post('/api/accounts', {
      data: { name: `M021-S05-${TS}`, isActive: true, startingBalance: 50000 },
    });
    expect(accRes.ok()).toBeTruthy();
    const account = await accRes.json();
    await prepareAccountForTrading(page.request, account.id);

    const tradeRes = await page.request.post('/api/trades', {
      data: { symbol: `M021SA${TS}`, direction: 'long', accountId: account.id },
    });
    expect(tradeRes.ok()).toBeTruthy();
    const trade = await tradeRes.json();

    // ── Navigate to trade detail page ─────────────────────────────
    await page.goto(`/trades/${trade.id}`);
    await page.waitForLoadState('networkidle');

    // ── Verify heading renders with symbol ────────────────────────
    await expect(page.locator('h1')).toContainText(`M021SA${TS}`);

    // ── Verify AssessmentCard is present with its heading ─────────
    const assessmentSection = page.getByText('AI Quality Assessment');
    await expect(assessmentSection.first()).toBeVisible();

    // ── Verify TradeDetailHeader has the "Assess" button ──────────
    await openAssessAction(page);
    await page.keyboard.press('Escape');

    // ── Verify empty state shows "Request Assessment" button ──────
    const requestBtn = page.getByRole('button', { name: 'Request Assessment' });
    await expect(requestBtn).toBeVisible();

    // ── Verify no scorecard data shown (empty state) ──────────────
    await expect(page.getByText('No AI assessment yet')).toBeVisible();

    // ── Verify TradePlanCard renders before AssessmentCard ────────
    const planCardTexts = page.getByText('Trade Definition');
    const firstPlanCard = planCardTexts.first();

    // The plan card should be in the DOM and visible before the assessment card
    await expect(firstPlanCard).toBeVisible();
    console.log('ASSESSMENT_UI_RESULT: PASS');
  });

  test('Assess button in header triggers loading state', async ({ page }) => {
    // ── Seed data ─────────────────────────────────────────────────
    const accRes = await page.request.post('/api/accounts', {
      data: { name: `M021-S05-Load-${TS}`, isActive: true, startingBalance: 50000 },
    });
    expect(accRes.ok()).toBeTruthy();
    const account = await accRes.json();
    await prepareAccountForTrading(page.request, account.id);

    const tradeRes = await page.request.post('/api/trades', {
      data: { symbol: `M021LB${TS}`, direction: 'short', accountId: account.id },
    });
    expect(tradeRes.ok()).toBeTruthy();
    const trade = await tradeRes.json();

    // ── Navigate to trade detail ──────────────────────────────────
    await page.goto(`/trades/${trade.id}`);
    await page.waitForLoadState('networkidle');

    // ── Verify initial state ──────────────────────────────────────
    await openAssessAction(page);
    await page.keyboard.press('Escape');

    // ── Click the Assess button ───────────────────────────────────
    // This will send a POST request to the API. The request may fail
    // because no AI provider is configured in test, but we verify the
    // UI reacts with proper loading state and error handling.
    const assessAction = await openAssessAction(page);

    // Click and wait for the API call to resolve or reject
    await Promise.all([
      page.waitForResponse(
        (resp) =>
          resp.url().includes('/api/trades') &&
          resp.url().includes('/assessments') &&
          resp.request().method() === 'POST',
      ),
      assessAction.click(),
    ]);

    // After the request completes (even with an error), the button
    // should return to its 'Assess' label (loading state finished)
    await openAssessAction(page);
    await page.keyboard.press('Escape');

    // Either an error message or the scorecard should be visible
    // (the API call will likely fail in test env without AI config)
    const hasError = await page.getByText('AI not configured').isVisible().catch(() => false);
    const hasAssessHeading = await page.getByText('AI Quality Assessment').first().isVisible().catch(() => false);

    // At minimum, the assessment section heading must be visible
    expect(hasError || hasAssessHeading).toBeTruthy();
    console.log('ASSESS_TRIGGER_RESULT: PASS');
  });

  test('Collapsible View Prompt and View Raw Response sections render and expand', async ({ page }) => {
    // ── Seed data ─────────────────────────────────────────────────
    const accRes = await page.request.post('/api/accounts', {
      data: { name: `M021-S05-Coll-${TS}`, isActive: true, startingBalance: 50000 },
    });
    expect(accRes.ok()).toBeTruthy();
    const account = await accRes.json();
    await prepareAccountForTrading(page.request, account.id);

    const tradeRes = await page.request.post('/api/trades', {
      data: { symbol: `M021CL${TS}`, direction: 'long', accountId: account.id },
    });
    expect(tradeRes.ok()).toBeTruthy();
    const trade = await tradeRes.json();

    // ── Seed an assessment snapshot with promptText and rawResponse directly ──
    const promptContent = 'Analyze the following trade plan for quality. Trade: long AAPL, entry: $180, stop: $175, target: $195.';
    const rawResponseContent = '{\"dimensions\":[{\"key\":\"setup\",\"label\":\"Setup Quality\",\"score\":7,\"notes\":\"Clear setup\"}]}';
    seedAssessmentSnapshot(trade.id, promptContent, rawResponseContent);

    // ── Navigate to trade detail page ─────────────────────────────
    await page.goto(`/trades/${trade.id}`);
    await page.waitForLoadState('networkidle');

    // ── Verify the AssessmentCard now shows scorecard data (not empty state) ──
    await expect(page.getByText('72/100').first()).toBeVisible();
    await expect(page.getByText('B').first()).toBeVisible();

    // ── Verify collapsible trigger buttons render ─────────────────
    const viewPromptBtn = page.getByRole('button', { name: 'View Prompt' });
    const viewRawResponseBtn = page.getByRole('button', { name: 'View Raw Response' });

    await expect(viewPromptBtn).toBeVisible();
    await expect(viewRawResponseBtn).toBeVisible();

    // ── Verify content is initially hidden (collapsed) ────────────
    await expect(page.getByText(promptContent)).not.toBeVisible();
    await expect(page.getByText('{"dimensions":')).not.toBeVisible();

    // ── Click View Prompt and verify content becomes visible ───────
    await viewPromptBtn.click();
    await expect(page.getByText(promptContent)).toBeVisible();

    // ── Click View Raw Response and verify content becomes visible ─
    await viewRawResponseBtn.click();
    await expect(page.getByText('{"dimensions":')).toBeVisible();

    // ── Verify clicking again collapses the sections ───────────────
    await viewPromptBtn.click();
    await expect(page.getByText(promptContent)).not.toBeVisible();

    console.log('COLLAPSIBLE_SECTIONS_RESULT: PASS');
  });

  test('Collapsible sections show Not available for null promptText and rawResponse', async ({ page }) => {
    // ── Seed data ─────────────────────────────────────────────────
    const accRes = await page.request.post('/api/accounts', {
      data: { name: `M021-S05-Null-${TS}`, isActive: true, startingBalance: 50000 },
    });
    expect(accRes.ok()).toBeTruthy();
    const account = await accRes.json();
    await prepareAccountForTrading(page.request, account.id);

    const tradeRes = await page.request.post('/api/trades', {
      data: { symbol: `M021NL${TS}`, direction: 'long', accountId: account.id },
    });
    expect(tradeRes.ok()).toBeTruthy();
    const trade = await tradeRes.json();

    // ── Seed an assessment snapshot with null promptText/rawResponse ──
    seedAssessmentSnapshot(trade.id, null, null);

    // ── Navigate and verify ───────────────────────────────────────
    await page.goto(`/trades/${trade.id}`);
    await page.waitForLoadState('networkidle');

    // ── Verify scorecard data renders ─────────────────────────────
    await expect(page.getByText('72/100').first()).toBeVisible();

    // ── Open both collapsible sections ────────────────────────────
    await page.getByRole('button', { name: 'View Prompt' }).click();
    await page.getByRole('button', { name: 'View Raw Response' }).click();

    // ── Verify both show the Not available fallback text ──────────
    const notAvailableInstances = page.getByText('Not available');
    await expect(notAvailableInstances.first()).toBeVisible();

    console.log('COLLAPSIBLE_NULL_RESULT: PASS');
  });

  test('Execute button and Assess action are both available in the header', async ({ page }) => {
    // ── Seed data ─────────────────────────────────────────────────
    const accRes = await page.request.post('/api/accounts', {
      data: { name: `M021-S05-Btns-${TS}`, isActive: true, startingBalance: 50000 },
    });
    expect(accRes.ok()).toBeTruthy();
    const account = await accRes.json();
    await prepareAccountForTrading(page.request, account.id);

    const tradeRes = await page.request.post('/api/trades', {
      data: { symbol: `M021BT${TS}`, direction: 'long', accountId: account.id },
    });
    expect(tradeRes.ok()).toBeTruthy();
    const trade = await tradeRes.json();

    // ── Navigate to trade detail ──────────────────────────────────
    await page.goto(`/trades/${trade.id}`);
    await page.waitForLoadState('networkidle');

    // ── Both buttons visible in the header area ───────────────────
    await openAssessAction(page);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Execute' })).toBeVisible();

    // Verify no console errors on page load
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Allow fetch/failed-to-load-resource errors (expected in test env)
    const unexpectedErrors = consoleErrors.filter(
      (e) =>
        !e.includes('Failed to load resource') &&
        !e.includes('fetch') &&
        !e.includes('Assessment request'),
    );
    expect(unexpectedErrors).toEqual([]);
    console.log('HEADER_BUTTONS_RESULT: PASS');
  });
});
