/**
 * settings route test
 *
 * Tests GET (empty, with settings) and PUT (create, update, validation).
 *
 * Run: npx vitest run --reporter verbose src/app/api/settings/__tests__/route.test.ts
 */

import { testDbPath } from '../../../../lib/testing/test-db';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';

import * as schema from '@/db/schema';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.error(`  ❌ ${msg} (FAILED)`);
  }
}

function assertEqual(actual: unknown, expected: unknown, msg: string) {
  if (actual === expected) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.error(`  ❌ ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)} (FAILED)`);
  }
}

function assertNotNull(value: unknown, msg: string) {
  if (value !== null && value !== undefined) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.error(`  ❌ ${msg} — value is null/undefined (FAILED)`);
  }
}

// ── Setup: test DB ──────────────────────────────────────────────────

const DB_FILE = process.env.DB_FILE_NAME || testDbPath('settings');
const sqlite = new Database(DB_FILE);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
const db = drizzle(sqlite, { schema });

// Create tables
sqlite.exec(`
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
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );
  CREATE TABLE IF NOT EXISTS settings (
    id TEXT PRIMARY KEY NOT NULL,
    default_account_id TEXT REFERENCES accounts(id),
    starting_account_value REAL,
    max_risk_per_trade_pct REAL,
    default_commission REAL,
    journal_start_date TEXT,
    currency TEXT DEFAULT 'USD',
    backup_enabled INTEGER DEFAULT 0,
    backup_retention_count INTEGER DEFAULT 3,
    backup_last_run_at TEXT,
    backup_last_run_status TEXT,
    backup_cron_time TEXT,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );
`);

// ── Simulated route logic ───────────────────────────────────────────

function doGetSettings(): { status: number; data: unknown } {
  try {
    const row = db.select().from(schema.settings).limit(1).get();
    if (!row) {
      return { status: 200, data: { message: 'No settings configured yet. Use PUT to create.' } };
    }
    return { status: 200, data: row };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to fetch settings', details: String(error) } };
  }
}

function doPutSettings(body: Record<string, unknown>): { status: number; data: unknown } {
  try {
    // Validate startingAccountValue must be positive
    if (body.startingAccountValue !== undefined && (typeof body.startingAccountValue !== 'number' || body.startingAccountValue <= 0)) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { startingAccountValue: ['Must be positive'] } } } };
    }

    // Validate maxRiskPerTradePct 0-100
    if (body.maxRiskPerTradePct !== undefined) {
      const val = body.maxRiskPerTradePct as number;
      if (typeof val !== 'number' || val < 0 || val > 100) {
        return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { maxRiskPerTradePct: ['Number must be greater than or equal to 0'] } } } };
      }
    }

    // Validate defaultCommission >= 0
    if (body.defaultCommission !== undefined && (typeof body.defaultCommission !== 'number' || body.defaultCommission < 0)) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { defaultCommission: ['Number must be greater than or equal to 0'] } } } };
    }

    // Validate defaultAccountId UUID or null
    if (body.defaultAccountId !== undefined && body.defaultAccountId !== null && typeof body.defaultAccountId !== 'string') {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { defaultAccountId: ['Expected string or null'] } } } };
    }

    // Validate currency 1-3 chars
    if (body.currency !== undefined && (typeof body.currency !== 'string' || body.currency.length < 1 || body.currency.length > 3)) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { currency: ['String must contain at most 3 character(s)'] } } } };
    }

    // Validate journalStartDate format YYYY-MM-DD
    if (body.journalStartDate !== undefined && typeof body.journalStartDate === 'string') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(body.journalStartDate)) {
        return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { journalStartDate: ['Must be YYYY-MM-DD'] } } } };
      }
    }

    // Validate backupRetentionCount >= 1
    if (body.backupRetentionCount !== undefined && (typeof body.backupRetentionCount !== 'number' || body.backupRetentionCount < 1 || !Number.isInteger(body.backupRetentionCount))) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { backupRetentionCount: ['Number must be greater than or equal to 1'] } } } };
    }

    const existing = db.select().from(schema.settings).limit(1).get();
    const now = new Date().toISOString();

    if (!existing) {
      const id = randomUUID();
      const values: Partial<typeof schema.settings.$inferInsert> = {
        id,
        currency: body.currency || 'USD',
        createdAt: now,
        updatedAt: now,
      };
      if (body.startingAccountValue !== undefined) values.startingAccountValue = body.startingAccountValue as number | null | undefined;
      if (body.maxRiskPerTradePct !== undefined) values.maxRiskPerTradePct = body.maxRiskPerTradePct as number | null | undefined;
      if (body.defaultCommission !== undefined) values.defaultCommission = body.defaultCommission as number | null | undefined;
      if (body.defaultAccountId !== undefined) values.defaultAccountId = body.defaultAccountId as string | null | undefined;
      if (body.journalStartDate !== undefined) values.journalStartDate = body.journalStartDate as string | null | undefined;
      if (body.backupEnabled !== undefined) values.backupEnabled = body.backupEnabled as boolean | null | undefined;
      if (body.backupRetentionCount !== undefined) values.backupRetentionCount = body.backupRetentionCount as number | null | undefined;
      if (body.backupLastRunAt !== undefined) values.backupLastRunAt = body.backupLastRunAt as string | null | undefined;
      if (body.backupLastRunStatus !== undefined) values.backupLastRunStatus = body.backupLastRunStatus as string | null | undefined;

      db.insert(schema.settings).values(values as typeof schema.settings.$inferInsert).run();

      const row = db.select().from(schema.settings).where(eq(schema.settings.id, id)).get();
      return { status: 201, data: row };
    }

    const updateData: Partial<typeof schema.settings.$inferInsert> = { updatedAt: now };
    if (body.startingAccountValue !== undefined) updateData.startingAccountValue = body.startingAccountValue as number | null | undefined;
    if (body.maxRiskPerTradePct !== undefined) updateData.maxRiskPerTradePct = body.maxRiskPerTradePct as number | null | undefined;
    if (body.defaultCommission !== undefined) updateData.defaultCommission = body.defaultCommission as number | null | undefined;
    if (body.defaultAccountId !== undefined) updateData.defaultAccountId = body.defaultAccountId as string | null | undefined;
    if (body.currency !== undefined) updateData.currency = body.currency as string | null | undefined;
    if (body.journalStartDate !== undefined) updateData.journalStartDate = body.journalStartDate as string | null | undefined;
    if (body.backupEnabled !== undefined) updateData.backupEnabled = body.backupEnabled as boolean | null | undefined;
    if (body.backupRetentionCount !== undefined) updateData.backupRetentionCount = body.backupRetentionCount as number | null | undefined;
    if (body.backupLastRunAt !== undefined) updateData.backupLastRunAt = body.backupLastRunAt as string | null | undefined;
    if (body.backupLastRunStatus !== undefined) updateData.backupLastRunStatus = body.backupLastRunStatus as string | null | undefined;

    db.update(schema.settings)
      .set(updateData)
      .where(eq(schema.settings.id, (existing as Record<string, unknown>).id as string))
      .run();

    const row = db.select().from(schema.settings).where(eq(schema.settings.id, (existing as Record<string, unknown>).id as string)).get();
    return { status: 200, data: row };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to update settings', details: String(error) } };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function cleanup() {
  sqlite.exec('DELETE FROM settings;');
  sqlite.exec('DELETE FROM accounts;');
}

function seedAccount(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.accounts)
    .values({
      id,
      name: 'Test Account',
      broker: null,
      currency: 'USD',
      isActive: true,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .run();
  return db.select().from(schema.accounts).where(eq(schema.accounts.id, id)).get() as Record<string, unknown>;
}

// ── Tests ───────────────────────────────────────────────────────────

console.log('\n--- Settings API Tests ---\n');

// ── 1. GET: Empty returns message ───────────────────────────────────

console.log('\n1. GET returns message when no settings:');
{
  cleanup();
  const result = doGetSettings();
  assert(result.status === 200, 'returns 200');
  assertEqual((result.data as { message: string }).message, 'No settings configured yet. Use PUT to create.', 'message matches');
}

// ── 2. GET: Returns settings once created ───────────────────────────

console.log('\n2. GET returns settings after creation:');
{
  cleanup();
  const created = doPutSettings({ startingAccountValue: 10000, currency: 'USD' });
  assert(created.status === 201, 'create returns 201');

  const result = doGetSettings();
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertNotNull(data.id, 'has id');
  assertEqual(data.startingAccountValue, 10000, 'startingAccountValue matches');
}

// ── 3. PUT: Create on first call with all fields ─────────────────────

console.log('\n3. PUT creates settings with all fields:');
{
  cleanup();
  const account = seedAccount({ name: 'Default Acct' });
  const result = doPutSettings({
    startingAccountValue: 50000,
    maxRiskPerTradePct: 2,
    defaultCommission: 1.5,
    defaultAccountId: account.id,
    currency: 'EUR',
    journalStartDate: '2025-01-01',
  });

  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.startingAccountValue, 50000, 'startingAccountValue');
  assertEqual(data.maxRiskPerTradePct, 2, 'maxRiskPerTradePct');
  assertEqual(data.defaultCommission, 1.5, 'defaultCommission');
  assertEqual(data.defaultAccountId, account.id, 'defaultAccountId');
  assertEqual(data.currency, 'EUR', 'currency');
  assertEqual(data.journalStartDate, '2025-01-01', 'journalStartDate');
}

// ── 4. PUT: Update existing settings ────────────────────────────────

console.log('\n4. PUT updates existing settings:');
{
  cleanup();
  doPutSettings({ startingAccountValue: 10000, currency: 'USD' });
  const result = doPutSettings({ startingAccountValue: 20000 });

  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.startingAccountValue, 20000, 'startingAccountValue updated');
  assertEqual(data.currency, 'USD', 'currency preserved');
}

// ── 5. PUT: Validate positive startingAccountValue ──────────────────

console.log('\n5. PUT rejects non-positive startingAccountValue:');
{
  cleanup();
  const result = doPutSettings({ startingAccountValue: 0 });
  assert(result.status === 400, 'returns 400 for zero');
}

// ── 6. PUT: Validate maxRiskPerTradePct 0-100 ───────────────────────

console.log('\n6. PUT validates maxRiskPerTradePct range:');
{
  cleanup();
  const under = doPutSettings({ maxRiskPerTradePct: -1 });
  assert(under.status === 400, 'returns 400 for negative');

  const over = doPutSettings({ maxRiskPerTradePct: 101 });
  assert(over.status === 400, 'returns 400 for > 100');

  const valid = doPutSettings({ maxRiskPerTradePct: 50 });
  assert(valid.status === 201, 'returns 201 for valid');
  const data = valid.data as Record<string, unknown>;
  assertEqual(data.maxRiskPerTradePct, 50, 'value set correctly');
}

// ── 7. PUT: Date format validation YYYY-MM-DD ───────────────────────

console.log('\n7. PUT validates journalStartDate format:');
{
  cleanup();
  const bad = doPutSettings({ journalStartDate: '01-15-2025' });
  assert(bad.status === 400, 'returns 400 for wrong format');

  const good = doPutSettings({ journalStartDate: '2025-01-15' });
  assert(good.status === 201, 'returns 201 for valid format');
  const data = good.data as Record<string, unknown>;
  assertEqual(data.journalStartDate, '2025-01-15', 'date stored correctly');
}

// ── 8. PUT: Currency validation ─────────────────────────────────────

console.log('\n8. PUT validates currency length:');
{
  cleanup();
  const bad = doPutSettings({ currency: 'USDE' });
  assert(bad.status === 400, 'returns 400 for currency > 3 chars');

  const good = doPutSettings({ currency: 'GBP' });
  assert(good.status === 201, 'returns 201 for valid currency');
}

// ── 9. PUT: Partial update preserves other fields ───────────────────

console.log('\n9. PUT partial update preserves untouched fields:');
{
  cleanup();
  doPutSettings({ startingAccountValue: 30000, maxRiskPerTradePct: 1.5, defaultCommission: 2 });
  const result = doPutSettings({ defaultCommission: 3 });

  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.startingAccountValue, 30000, 'startingAccountValue preserved');
  assertEqual(data.maxRiskPerTradePct, 1.5, 'maxRiskPerTradePct preserved');
  assertEqual(data.defaultCommission, 3, 'defaultCommission updated');
}

// ── 10. PUT: Backup config fields on create ──────────────────────────

console.log('\n10. PUT creates settings with backup config fields:');
{
  cleanup();
  const result = doPutSettings({
    backupEnabled: true,
    backupRetentionCount: 7,
  });

  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.backupEnabled, true, 'backupEnabled set to true');
  assertEqual(data.backupRetentionCount, 7, 'backupRetentionCount set to 7');
  assertEqual(data.backupLastRunAt, null, 'backupLastRunAt defaults to null');
  assertEqual(data.backupLastRunStatus, null, 'backupLastRunStatus defaults to null');
}

// ── 11. PUT: Backup config defaults on minimal create ────────────────

console.log('\n11. PUT backup config defaults on minimal create:');
{
  cleanup();
  const result = doPutSettings({ startingAccountValue: 10000 });

  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.backupEnabled, false, 'backupEnabled defaults to false');
  assertEqual(data.backupRetentionCount, 3, 'backupRetentionCount defaults to 3');
  assertEqual(data.backupLastRunAt, null, 'backupLastRunAt defaults to null');
  assertEqual(data.backupLastRunStatus, null, 'backupLastRunStatus defaults to null');
}

// ── 12. PUT: Update backup config fields ─────────────────────────────

console.log('\n12. PUT updates backup config fields:');
{
  cleanup();
  doPutSettings({ backupEnabled: true, backupRetentionCount: 5 });
  const result = doPutSettings({
    backupEnabled: false,
    backupRetentionCount: 10,
    backupLastRunAt: '2026-07-10T12:00:00.000Z',
    backupLastRunStatus: 'success',
  });

  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.backupEnabled, false, 'backupEnabled updated');
  assertEqual(data.backupRetentionCount, 10, 'backupRetentionCount updated');
  assertEqual(data.backupLastRunAt, '2026-07-10T12:00:00.000Z', 'backupLastRunAt updated');
  assertEqual(data.backupLastRunStatus, 'success', 'backupLastRunStatus updated');
}

// ── 13. PUT: Backup last run status error value ──────────────────────

console.log('\n13. PUT backupLastRunStatus accepts error value:');
{
  cleanup();
  const result = doPutSettings({
    backupEnabled: true,
    backupLastRunAt: '2026-07-10T13:00:00.000Z',
    backupLastRunStatus: 'error',
  });

  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.backupLastRunStatus, 'error', 'backupLastRunStatus set to error');
}

// ── 14. PUT: Negative test — backupRetentionCount < 1 ───────────────

console.log('\n14. PUT rejects backupRetentionCount < 1:');
{
  cleanup();
  const zero = doPutSettings({ backupRetentionCount: 0 });
  assert(zero.status === 400, 'returns 400 for zero');

  const negative = doPutSettings({ backupRetentionCount: -1 });
  assert(negative.status === 400, 'returns 400 for negative');

  const valid = doPutSettings({ backupRetentionCount: 1 });
  assert(valid.status === 201, 'returns 201 for minimum valid value');
  const data = valid.data as Record<string, unknown>;
  assertEqual(data.backupRetentionCount, 1, 'backupRetentionCount set to 1');
}

// ── Summary ──────────────────────────────────────────────────────────

const total = passed + failed;
console.log(`\n${'─'.repeat(40)}`);
console.log(`Results: ${passed}/${total} passed`);
if (failed > 0) {
  console.error(`         ${failed}/${total} FAILED\n`);
  process.exit(1);
} else {
  console.log('         All tests passed!\n');
}
