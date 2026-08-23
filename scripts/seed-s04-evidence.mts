/**
 * Seed a rich closed trade for M020/S04/T02 browser evidence.
 *
 * Uses an explicitly supplied isolated server's API to create the
 * account → trade → execute (entry+exit+checkResults) → grade → mistakes →
 * link asset chain, then writes the isolated checklist prerequisite, the two
 * DB-only fields (exit_notes, lesson), and an assessment snapshot directly
 * into the supplied evidence database —
 * mirroring the m021-s06 e2e seeding pattern (the AI provider is not
 * configured in this environment, and the trade PUT API has no exitNotes
 * write path).
 */
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required. Run this helper only against an isolated evidence server/database.`);
  }
  return value;
}

const BASE = requiredEnv('M020_EVIDENCE_BASE_URL').replace(/\/$/, '');
const DB_PATH = requiredEnv('M020_EVIDENCE_DB_PATH');
const FIXTURE_PATH = requiredEnv('M020_EVIDENCE_FIXTURE_PATH');
const productionJournalPath = path.resolve(process.cwd(), '.trading-journal', 'journal.db');
if (path.resolve(DB_PATH) === productionJournalPath) {
  throw new Error('M020 evidence must use a disposable database, never the local journal database.');
}
try {
  fs.accessSync(DB_PATH, fs.constants.W_OK);
} catch {
  throw new Error(`M020 evidence database must exist and be writable by this helper: ${DB_PATH}`);
}
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
const fe = await api(`/api/accounts/${accountId}/initialize`, {
  method: 'POST',
  body: JSON.stringify({ mode: 'opening_balance', amount: '50000.00' }),
});
console.log('initialize:', fe.status ?? 'ok');

// A fresh evidence database has no account checklist definitions. Create the
// prerequisite locally instead of relying on an ID from a user journal.
const evidenceCheckId = randomUUID();
const prerequisiteDb = new Database(DB_PATH);
try {
  const now = new Date().toISOString();
  prerequisiteDb.prepare(`
    INSERT INTO checklist_definitions
      (id, account_id, description, sort_order, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    evidenceCheckId,
    accountId,
    'Confirm entry, risk, and invalidation before execution.',
    0,
    1,
    now,
    now,
  );
} finally {
  prerequisiteDb.close();
}

const trade = await api('/api/trades', {
  method: 'POST',
  body: JSON.stringify({
    symbol: SYMBOL,
    direction: 'long',
    accountId,
    thesis: 'Breakout continuation after a strong earnings gap with volume confirmation.',
    invalidationCondition: 'Exit if price loses the opening-range low on sustained volume.',
    preTradePlan: 'Enter on the first orderly pullback, risk 2%, and hold the second target.',
  }),
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
      { checklistDefinitionId: evidenceCheckId, passed: true },
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

fs.mkdirSync(path.dirname(FIXTURE_PATH), { recursive: true });
fs.writeFileSync(FIXTURE_PATH, `${JSON.stringify({ tradeId }, null, 2)}\n`, 'utf-8');
console.log('TRADE_ID=' + tradeId);
