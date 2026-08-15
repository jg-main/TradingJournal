/**
 * Seed a rich closed trade for M020/S04/T02 browser evidence.
 *
 * Uses the running dev server's API (http://localhost:4321) to create the
 * account → trade → execute (entry+exit+checkResults) → grade → mistakes →
 * link asset chain, then writes the two DB-only fields (exit_notes, lesson)
 * and an assessment snapshot directly into .trading-journal/journal.db —
 * mirroring the m021-s06 e2e seeding pattern (the AI provider is not
 * configured in this environment, and the trade PUT API has no exitNotes
 * write path).
 */
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

const BASE = 'http://localhost:4321';
const DB_PATH = './.trading-journal/journal.db';
const SYMBOL = 'S04EV';

async function api(path: string, options: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${options.method ?? 'GET'} ${path} -> ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  }
  return body;
}

const ts = Date.now();
const account = await api('/api/accounts', {
  method: 'POST',
  body: JSON.stringify({ name: `S04-T02-${ts}`, currency: 'USD' }),
});
const accountId = account.id ?? account.account?.id ?? account.data?.id;
if (!accountId) throw new Error(`No account id in ${JSON.stringify(account).slice(0, 200)}`);
console.log('account:', accountId);

// prepareAccountForTrading equivalent
await api(`/api/accounts/${accountId}`, { method: 'PUT', body: JSON.stringify({ maxRiskPerTradePct: 2, defaultCommission: 1 }) });
await api(`/api/accounts/${accountId}`, { method: 'PUT', body: JSON.stringify({ isActive: true }) });
const fe = await api(`/api/accounts/${accountId}/financial-events`, {
  method: 'POST',
  body: JSON.stringify({ eventType: 'opening_balance', amount: '50000.00' }),
});
console.log('financial event:', fe.status ?? 'ok');

const trade = await api('/api/trades', {
  method: 'POST',
  body: JSON.stringify({ symbol: SYMBOL, direction: 'long', accountId }),
});
const tradeId = trade.id ?? trade.trade?.id ?? trade.data?.id;
if (!tradeId) throw new Error(`No trade id in ${JSON.stringify(trade).slice(0, 200)}`);
console.log('trade:', tradeId);

// Execute entry + exit → closed, with one checklist result (must-have #5)
const exec = await api(`/api/trades/${tradeId}/execute`, {
  method: 'POST',
  body: JSON.stringify({
    entryPrice: 100.5,
    entryQuantity: 100,
    stopPrice: 92.0,
    exit1Price: 105.0,
    exit1Quantity: 100,
    fees: 2.5,
    checkResults: [
      { checklistDefinitionId: '733a4e22-5710-44ec-a134-f2a25c7e8358', passed: true },
    ],
  }),
});
console.log('execute → status:', exec.trade?.status ?? exec.status);

// Grade (B range)
await api(`/api/trades/${tradeId}/grade`, {
  method: 'PUT',
  body: JSON.stringify({
    setupScore: 8, riskScore: 7, entryScore: 9, managementScore: 6,
    exitScore: 8, reviewScore: 7, followedPlan: true,
    notes: 'Solid execution; exit could have been better managed.',
  }),
});
console.log('grade: saved');

// Two mistakes
await api(`/api/trades/${tradeId}/mistakes`, {
  method: 'POST',
  body: JSON.stringify({
    mistakeType: 'fv_entry_timing', phase: 'entry', severity: 'minor',
    rootCause: 'Entered 15 minutes after the open', correctiveAction: 'Wait for the first pullback', status: 'addressed',
  }),
});
await api(`/api/trades/${tradeId}/mistakes`, {
  method: 'POST',
  body: JSON.stringify({
    mistakeType: 'fv_patience', phase: 'management', severity: 'moderate',
    rootCause: 'Scaled out too early on strength', correctiveAction: 'Let winners run to target', status: 'open',
  }),
});
console.log('mistakes: saved');

// Link asset (review phase)
const asset = await api(`/api/trades/${tradeId}/assets`, {
  method: 'POST',
  body: JSON.stringify({
    assetType: 'link', phase: 'review',
    label: 'Post-mortem chart', externalUrl: 'https://example.com/s04-postmortem', notes: 'Weekly chart review',
  }),
});
console.log('asset:', asset.id ?? 'ok');

// ── Direct DB writes (exit_notes/lesson + assessment snapshot) ──
const db = new Database(DB_PATH);
try {
  const now = new Date().toISOString();
  db.prepare(
    'UPDATE trades SET exit_notes = ?, lesson = ?, updated_at = ? WHERE id = ?',
  ).run(
    'Exited into the closing strength auction after target 1 scaled out 50%. Position managed to plan.',
    'Let winners run to the second target instead of scaling out early.',
    now,
    tradeId,
  );

  const scorecardJson = JSON.stringify({
    dimensions: [
      { key: 'setup', label: 'Setup Quality', score: 8 },
      { key: 'risk', label: 'Risk Management', score: 7 },
      { key: 'entry', label: 'Entry Timing', score: 9 },
      { key: 'management', label: 'Management', score: 6 },
      { key: 'exit', label: 'Exit Timing', score: 8 },
      { key: 'review', label: 'Review Quality', score: 7 },
    ],
    overallScore: 75,
    gradeLabel: 'B',
    assessmentType: 'ai_quality',
    summary: 'Well-defined plan with a clear invalidation; exits left room for improvement.',
    metadata: { modelUsed: 'gpt-4o', promptTokens: 540, completionTokens: 190, durationMs: 2410 },
  });

  db.prepare(`
    INSERT INTO trade_assessment_snapshots
      (id, trade_id, assessed_at, assessment_type, overall_score, scorecard_json,
       model_used, prompt_tokens, completion_tokens, prompt_text, raw_response, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(), tradeId, now, 'ai_quality', 75, scorecardJson,
    'gpt-4o', 540, 190,
    'Analyze the following closed trade for quality. Trade: long S04EV, entry: $100.50, exit: $105.00, fees: $2.50.',
    JSON.stringify({ choices: [{ message: { content: 'Grade: B — solid plan, manage exits better.' } }] }),
    now,
  );
  console.log('db: exit_notes + lesson + assessment snapshot written');
} finally {
  db.close();
}

console.log('TRADE_ID=' + tradeId);
