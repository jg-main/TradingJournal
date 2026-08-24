/**
 * planned-risk-preview route test
 *
 * Tests GET /api/trades/planned-risk-preview which returns the canonical
 * direction-aware planned risk plus account-relative risk (S02/T05):
 * - Valid long / short inputs → dollar risk, price risk %, account risk %,
 *   reward, R:R, equity-at-open, max-risk flag.
 * - Invalid (wrong-side) stop → null risk values (D1 null-not-zero).
 * - Missing accountId → 400; unknown account → 404.
 * - maxRiskExceeded with account override, settings fallback, no threshold.
 * - Equity-at-open includes deposits (canonical computeExecutionContext).
 *
 * Run: npx tsx src/app/api/trades/planned-risk-preview/__tests__/route.test.ts
 *      (also registered in vitest.config.ts include; run via
 *       `npx vitest run src/app/api/trades/planned-risk-preview/__tests__/route.test.ts`)
 */
/// <reference types="vitest/globals" />

import { testDbPath } from '../../../../../lib/testing/test-db';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { z } from 'zod';

import * as schema from '@/db/schema';
import { computePlannedRiskAmount } from '@/lib/planned-risk';
import { computeExecutionContext } from '@/lib/execution-context';

let passed = 0;
let failed = 0;

function assertEqual(actual: unknown, expected: unknown, msg: string) {
  if (actual === expected) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.error(`  ❌ ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)} (FAILED)`);
  }
}

function assertApprox(actual: number | null, expected: number, tolerance: number, msg: string) {
  if (actual === null) { failed++; console.error(`  ❌ ${msg} — got null, expected ~${expected} (FAILED)`); return; }
  const diff = Math.abs(actual - expected);
  if (diff <= tolerance) { passed++; console.log(`  ✅ ${msg} (${actual.toFixed(4)} ≈ ${expected})`); }
  else { failed++; console.error(`  ❌ ${msg} — got ${actual}, expected ~${expected} (diff ${diff.toFixed(4)}) (FAILED)`); }
}

function assertNull(value: unknown, msg: string) {
  if (value === null || value === undefined) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.error(`  ❌ ${msg} — expected null, got ${JSON.stringify(value)} (FAILED)`); }
}

// ── Setup: test DB ──────────────────────────────────────────────────

const DB_FILE = process.env.DB_FILE_NAME || testDbPath('planned-risk-preview');
const sqlite = new Database(DB_FILE);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
const db = drizzle(sqlite, { schema });

// Create the subset of tables computeExecutionContext reads: accounts,
// settings, account_transactions, trades, trade_executions.
sqlite.exec(`
  DROP TABLE IF EXISTS trade_executions;
  DROP TABLE IF EXISTS trades;
  DROP TABLE IF EXISTS account_transactions;
  DROP TABLE IF EXISTS settings;
  DROP TABLE IF EXISTS accounts;

  CREATE TABLE accounts (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    broker TEXT,
    currency TEXT DEFAULT 'USD',
    is_active INTEGER DEFAULT 1,
    max_risk_per_trade_pct REAL,
    default_commission REAL,
    starting_balance REAL,
    created_at TEXT,
    updated_at TEXT
  );

  CREATE TABLE settings (
    id TEXT PRIMARY KEY NOT NULL,
    default_account_id TEXT,
    starting_account_value REAL,
    max_risk_per_trade_pct REAL,
    default_commission REAL,
    journal_start_date TEXT,
    currency TEXT DEFAULT 'USD',
    backup_enabled INTEGER DEFAULT 0,
    backup_retention_count INTEGER DEFAULT 3,
    backup_last_run_at TEXT,
    backup_last_run_status TEXT,
    backup_cron_time TEXT DEFAULT '02:00',
    created_at TEXT,
    updated_at TEXT
  );

  CREATE TABLE account_transactions (
    id TEXT PRIMARY KEY NOT NULL,
    account_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('deposit', 'withdrawal')),
    amount REAL NOT NULL,
    balance_after REAL NOT NULL,
    date TEXT NOT NULL,
    notes TEXT,
    created_at TEXT
  );

  CREATE TABLE trades (
    id TEXT PRIMARY KEY NOT NULL,
    trade_code TEXT UNIQUE NOT NULL,
    account_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    direction TEXT NOT NULL CHECK(direction IN ('long', 'short')),
    sector_id TEXT,
    setup_id TEXT,
    market_condition_id TEXT,
    status TEXT NOT NULL CHECK(status IN ('planned', 'open', 'closed', 'deleted')),
    planned_entry REAL,
    planned_stop REAL,
    planned_target_1 REAL,
    planned_target_2 REAL,
    planned_quantity REAL,
    thesis TEXT,
    invalidation_condition TEXT,
    pre_trade_plan TEXT,
    risk_override_reason TEXT,
    opened_at TEXT,
    closed_at TEXT,
    exit_notes TEXT,
    lesson TEXT,
    current_price REAL,
    current_price_fetched_at TEXT,
    created_at TEXT,
    updated_at TEXT
  );

  CREATE TABLE trade_executions (
    id TEXT PRIMARY KEY NOT NULL,
    trade_id TEXT NOT NULL,
    executed_at TEXT,
    action TEXT NOT NULL CHECK(action IN ('buy', 'sell', 'buy_to_cover', 'sell_short', 'add', 'reduce')),
    quantity REAL NOT NULL,
    price REAL NOT NULL,
    fees REAL DEFAULT 0,
    reason_id TEXT,
    notes TEXT,
    created_at TEXT
  );
`);

// ── Seed helpers ────────────────────────────────────────────────────

function seedAccount(overrides: Partial<typeof schema.accounts.$inferInsert> = {}) {
  const id = overrides.id ?? randomUUID();
  db.insert(schema.accounts).values({
    id,
    name: overrides.name ?? 'Main Trading',
    broker: overrides.broker ?? null,
    currency: overrides.currency ?? 'USD',
    isActive: overrides.isActive ?? true,
    maxRiskPerTradePct: overrides.maxRiskPerTradePct ?? null,
    defaultCommission: overrides.defaultCommission ?? 0,
    startingBalance: overrides.startingBalance ?? null,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    updatedAt: overrides.updatedAt ?? new Date().toISOString(),
  }).run();
  return id;
}

function seedSettings(overrides: Partial<typeof schema.settings.$inferInsert> = {}) {
  const id = overrides.id ?? 'global-settings';
  const values = {
    id,
    startingAccountValue: overrides.startingAccountValue ?? null,
    maxRiskPerTradePct: overrides.maxRiskPerTradePct ?? null,
    defaultCommission: overrides.defaultCommission ?? null,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    updatedAt: overrides.updatedAt ?? new Date().toISOString(),
  };
  // settings is a singleton row ('global-settings'); upsert so each test seeds
  // the exact global state it needs regardless of execution order.
  db.insert(schema.settings)
    .values(values)
    .onConflictDoUpdate({ target: schema.settings.id, set: values })
    .run();
  return id;
}

function seedTransaction(accountId: string, type: 'deposit' | 'withdrawal', amount: number, date: string) {
  db.insert(schema.accountTransactions).values({
    id: randomUUID(),
    accountId,
    type,
    amount,
    balanceAfter: amount,
    date,
    notes: null,
    createdAt: new Date().toISOString(),
  }).run();
}

// ── Mirror of the route computation ──────────────────────────────────

const previewQuerySchema = z.object({
  accountId: z.string().min(1),
  direction: z.enum(['long', 'short']).default('long'),
  entry: z.coerce.number().positive().optional(),
  stop: z.coerce.number().positive().optional(),
  target1: z.coerce.number().positive().optional(),
  quantity: z.coerce.number().positive().optional(),
});

/** Mirror of GET /api/trades/planned-risk-preview (same schema, canonical libs). */
function doGetPreview(search: string): { status: number; data: Record<string, unknown> } {
  const params = Object.fromEntries(new URLSearchParams(search).entries());
  const parsed = previewQuerySchema.safeParse(params);
  if (!parsed.success) {
    return { status: 400, data: { error: 'Validation failed', details: parsed.error.flatten() } };
  }

  const { accountId, direction, entry, stop, target1, quantity } = parsed.data;

  const context = computeExecutionContext(db, accountId, new Date().toISOString());
  const account = context.account;
  const settings = context.globalSettings;

  if (!account) {
    return { status: 404, data: { error: 'Account not found' } };
  }

  const riskDollar = computePlannedRiskAmount(direction, entry, stop, quantity);

  let riskPct: number | null = null;
  if (entry != null && entry > 0 && stop != null && stop > 0) {
    const perUnit = direction === 'long' ? entry - stop : stop - entry;
    if (perUnit > 0) riskPct = (perUnit / entry) * 100;
  }

  let rewardPct: number | null = null;
  if (entry != null && entry > 0 && target1 != null && target1 > 0) {
    const perUnit = direction === 'long' ? target1 - entry : entry - target1;
    if (perUnit > 0) rewardPct = (perUnit / entry) * 100;
  }

  let rewardDollar: number | null = null;
  if (rewardPct != null && entry != null && quantity != null && quantity > 0) {
    rewardDollar = (rewardPct / 100) * entry * quantity;
  }

  const riskRewardRatio =
    riskPct != null && rewardPct != null && riskPct > 0 ? rewardPct / riskPct : null;

  const equityAtOpen = context.equityAtOpen;

  const accountRiskPct =
    equityAtOpen != null && equityAtOpen > 0 && riskDollar != null
      ? (riskDollar / equityAtOpen) * 100
      : null;

  const maxRiskPerTradePct =
    account.maxRiskPerTradePct ?? settings?.maxRiskPerTradePct ?? null;

  const maxRiskExceeded =
    accountRiskPct != null && maxRiskPerTradePct != null && accountRiskPct > maxRiskPerTradePct;

  return {
    status: 200,
    data: {
      riskDollar,
      riskPct,
      accountRiskPct,
      rewardDollar,
      rewardPct,
      riskRewardRatio,
      equityAtOpen,
      maxRiskPerTradePct,
      maxRiskExceeded,
    },
  };
}

// ── Tests ────────────────────────────────────────────────────────────

// 1. Valid long: entry 100 stop 95 qty 100 target 110, equity 10000,
//    account max-risk 2% → risk $500 (5%), account risk 5% → exceeded.
const accLong = seedAccount({ maxRiskPerTradePct: 2, startingBalance: 10000 });

console.log('\n1. Valid long preview:');
{
  const r = doGetPreview(`accountId=${accLong}&direction=long&entry=100&stop=95&target1=110&quantity=100`);
  assertEqual(r.status, 200, 'long valid → 200');
  assertApprox(r.data.riskDollar as number, 500, 1e-9, 'long riskDollar → 500');
  assertApprox(r.data.riskPct as number, 5, 1e-9, 'long riskPct (of entry) → 5');
  assertApprox(r.data.rewardPct as number, 10, 1e-9, 'long rewardPct → 10');
  assertApprox(r.data.rewardDollar as number, 1000, 1e-9, 'long rewardDollar → 1000');
  assertApprox(r.data.riskRewardRatio as number, 2, 1e-9, 'long R:R → 2');
  assertApprox(r.data.equityAtOpen as number, 10000, 1e-9, 'long equityAtOpen → 10000');
  assertApprox(r.data.accountRiskPct as number, 5, 1e-9, 'long accountRiskPct → 5');
  assertEqual(r.data.maxRiskPerTradePct, 2, 'long maxRiskPerTradePct → account override 2');
  assertEqual(r.data.maxRiskExceeded, true, 'long 5% > 2% → maxRiskExceeded true');
}

// 2. Valid short: entry 100 stop 105 target 90 qty 50 → risk $250 (5%),
//    account risk 2.5% — within a 2% limit? No: 2.5 > 2 → exceeded.
console.log('\n2. Valid short preview:');
{
  const r = doGetPreview(`accountId=${accLong}&direction=short&entry=100&stop=105&target1=90&quantity=50`);
  assertEqual(r.status, 200, 'short valid → 200');
  assertApprox(r.data.riskDollar as number, 250, 1e-9, 'short riskDollar → 250');
  assertApprox(r.data.riskPct as number, 5, 1e-9, 'short riskPct → 5');
  assertApprox(r.data.rewardPct as number, 10, 1e-9, 'short rewardPct → 10');
  assertApprox(r.data.riskRewardRatio as number, 2, 1e-9, 'short R:R → 2');
  assertApprox(r.data.accountRiskPct as number, 2.5, 1e-9, 'short accountRiskPct → 2.5');
}

// 3. Invalid stop (wrong side): long stop 105 > entry 100 → null risk values.
console.log('\n3. Invalid (wrong-side) stop → null risk values (D1):');
{
  const r = doGetPreview(`accountId=${accLong}&direction=long&entry=100&stop=105&quantity=100`);
  assertEqual(r.status, 200, 'wrong-side stop → 200 (preview still returns)');
  assertNull(r.data.riskDollar, 'wrong-side stop → riskDollar null');
  assertNull(r.data.riskPct, 'wrong-side stop → riskPct null');
  assertNull(r.data.accountRiskPct, 'wrong-side stop → accountRiskPct null');
  assertEqual(r.data.maxRiskExceeded, false, 'wrong-side stop → maxRiskExceeded false');
}

// 4. Missing quantity → dollar risk null (D1), price risk still known.
console.log('\n4. Missing quantity → riskDollar null, riskPct known:');
{
  const r = doGetPreview(`accountId=${accLong}&direction=long&entry=100&stop=95`);
  assertEqual(r.status, 200, 'no qty → 200');
  assertNull(r.data.riskDollar, 'no qty → riskDollar null');
  assertNull(r.data.accountRiskPct, 'no qty → accountRiskPct null');
  assertApprox(r.data.riskPct as number, 5, 1e-9, 'no qty → riskPct still 5 (price-based)');
  assertEqual(r.data.maxRiskExceeded, false, 'no qty → maxRiskExceeded false');
}

// 5. Missing accountId → 400.
console.log('\n5. Missing accountId → 400:');
{
  const r = doGetPreview(`entry=100&stop=95&quantity=100`);
  assertEqual(r.status, 400, 'missing accountId → 400');
  assertEqual((r.data as { error: string }).error, 'Validation failed', 'error message');
}

// 6. Unknown account → 404.
console.log('\n6. Unknown account → 404:');
{
  const r = doGetPreview(`accountId=does-not-exist&entry=100&stop=95&quantity=100`);
  assertEqual(r.status, 404, 'unknown account → 404');
  assertEqual((r.data as { error: string }).error, 'Account not found', 'error message');
}

// 7. Within limit → maxRiskExceeded false (account override 10%).
console.log('\n7. Within max-risk limit → not exceeded:');
{
  const accWide = seedAccount({ maxRiskPerTradePct: 10, startingBalance: 10000 });
  const r = doGetPreview(`accountId=${accWide}&direction=long&entry=100&stop=95&quantity=100`);
  assertEqual(r.data.maxRiskPerTradePct, 10, 'threshold → account override 10');
  assertApprox(r.data.accountRiskPct as number, 5, 1e-9, 'accountRiskPct → 5');
  assertEqual(r.data.maxRiskExceeded, false, '5% within 10% → not exceeded');
}

// 8. No threshold anywhere → null threshold, never exceeded. (Seeds settings
//    with no max-risk so a stale singleton can never leak into this case.)
console.log('\n8. No max-risk threshold configured:');
{
  const accNoLimit = seedAccount({ maxRiskPerTradePct: null, startingBalance: 10000 });
  seedSettings({ maxRiskPerTradePct: null, startingAccountValue: null });
  const r = doGetPreview(`accountId=${accNoLimit}&direction=long&entry=100&stop=95&quantity=100`);
  assertNull(r.data.maxRiskPerTradePct, 'no threshold → null');
  assertEqual(r.data.maxRiskExceeded, false, 'no threshold → never exceeded');
}

// 9. Settings fallback: account maxRisk null → settings 2 used.
console.log('\n9. Settings fallback for maxRiskPerTradePct:');
{
  const accFallback = seedAccount({ maxRiskPerTradePct: null, startingBalance: 10000 });
  seedSettings({ maxRiskPerTradePct: 2 });
  const r = doGetPreview(`accountId=${accFallback}&direction=long&entry=100&stop=95&quantity=100`);
  assertEqual(r.data.maxRiskPerTradePct, 2, 'settings fallback → 2');
  assertEqual(r.data.maxRiskExceeded, true, '5% > settings 2% → exceeded');
}

// 10. Equity includes deposits (canonical execution context).
console.log('\n10. Equity-at-open includes deposits:');
{
  const accDeposits = seedAccount({ startingBalance: 20000 });
  seedTransaction(accDeposits, 'deposit', 5000, '2026-01-10');
  const r = doGetPreview(`accountId=${accDeposits}&direction=long&entry=100&stop=95&quantity=100`);
  assertApprox(r.data.equityAtOpen as number, 25000, 1e-9, 'equityAtOpen → 20000 + 5000 = 25000');
  assertApprox(r.data.accountRiskPct as number, 2, 1e-9, 'accountRiskPct → 500/25000 = 2');
}

// 11. Global settings fallback for equity when no account data (hasNoAccountData).
console.log('\n11. Equity fallback to settings.startingAccountValue:');
{
  const accNoData = seedAccount({ startingBalance: null });
  seedSettings({ startingAccountValue: 40000, maxRiskPerTradePct: 1 });
  const r = doGetPreview(`accountId=${accNoData}&direction=long&entry=100&stop=95&quantity=100`);
  assertApprox(r.data.equityAtOpen as number, 40000, 1e-9, 'equity fallback → 40000');
  assertApprox(r.data.accountRiskPct as number, 1.25, 1e-9, 'accountRiskPct → 500/40000 = 1.25');
  assertEqual(r.data.maxRiskExceeded, true, '1.25% > 1% → exceeded');
}

// 12. Default direction is long when omitted.
console.log('\n12. Direction defaults to long:');
{
  const r = doGetPreview(`accountId=${accLong}&entry=100&stop=95&quantity=100`);
  assertApprox(r.data.riskDollar as number, 500, 1e-9, 'default long riskDollar → 500');
}

// ── Summary ──────────────────────────────────────────────────────────

const total = passed + failed;
console.log(`\n${'─'.repeat(40)}`);
console.log(`Results: ${passed}/${total} passed`);

// Dual-mode finish (same convention as the other trade route harnesses):
// standalone tsx run exits with status, vitest run surfaces via a test.
if (typeof test !== 'undefined') {
  test('planned-risk-preview route harness (assertions run at import)', () => {
    if (failed > 0) {
      throw new Error(`         ${failed}/${total} FAILED`);
    }
    console.log('         All tests passed!');
  });
} else {
  if (failed > 0) {
    console.error(`         ${failed}/${total} FAILED`);
    process.exit(1);
  }
  console.log('         All tests passed!');
}
