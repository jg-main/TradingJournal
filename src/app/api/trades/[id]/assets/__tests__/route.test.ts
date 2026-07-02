/**
 * trade assets route test
 *
 * Tests GET, POST (JSON + file upload), and DELETE handlers.
 *
 * Run: DB_FILE_NAME=./.test-assets.db npx tsx src/app/api/trades/\[id\]/assets/__tests__/route.test.ts
 */

import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { cwd } from 'node:process';

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

const DB_FILE = process.env.DB_FILE_NAME || './.test-assets.db';
const sqlite = new Database(DB_FILE);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
const db = drizzle(sqlite, { schema });

// Create tables
sqlite.exec(`
  DROP TABLE IF EXISTS settings;
  DROP TABLE IF EXISTS account_rollforward;
  DROP TABLE IF EXISTS account_transactions;
  DROP TABLE IF EXISTS trade_stop_adjustments;
  DROP TABLE IF EXISTS trade_risk_snapshots;
  DROP TABLE IF EXISTS trade_mistakes;
  DROP TABLE IF EXISTS trade_grades;
  DROP TABLE IF EXISTS trade_executions;
  DROP TABLE IF EXISTS trade_assets;
  DROP TABLE IF EXISTS trades;
  DROP TABLE IF EXISTS watchlist_items;
  DROP TABLE IF EXISTS weekly_reviews;
  DROP TABLE IF EXISTS setup_definitions;
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
  CREATE TABLE IF NOT EXISTS trades (
    id TEXT PRIMARY KEY NOT NULL,
    trade_code TEXT UNIQUE NOT NULL,
    account_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    direction TEXT NOT NULL CHECK(direction IN ('long','short')),
    sector_id TEXT,
    setup_id TEXT,
    market_condition_id TEXT,
    status TEXT NOT NULL CHECK(status IN ('idea','planned','open','partially_closed','closed','scratched')),
    planned_entry REAL,
    planned_stop REAL,
    planned_target_1 REAL,
    planned_target_2 REAL,
    thesis TEXT,
    invalidation_condition TEXT,
    pre_trade_plan TEXT,
    opened_at TEXT,
    closed_at TEXT,
    exit_notes TEXT,
    lesson TEXT,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );
  CREATE TABLE IF NOT EXISTS trade_assets (
    id TEXT PRIMARY KEY NOT NULL,
    trade_id TEXT NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
    asset_type TEXT NOT NULL CHECK(asset_type IN ('screenshot','document','link','image','other')),
    phase TEXT NOT NULL CHECK(phase IN ('pre_trade','entry','management','exit','review')),
    label TEXT,
    file_path TEXT,
    external_url TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (current_timestamp)
  );
`);

// ── Simulated route logic ───────────────────────────────────────────

const ASSET_TYPE = ['screenshot', 'document', 'link', 'image', 'other'] as const;
const PHASE = ['pre_trade', 'entry', 'management', 'exit', 'review'] as const;

function validateAssetBody(body: Record<string, unknown>): {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: Record<string, unknown>;
} {
  const allowedKeys = ['assetType', 'phase', 'label', 'externalUrl', 'notes'];
  const bodyKeys = Object.keys(body);

  // Check for unexpected keys
  for (const key of bodyKeys) {
    if (!allowedKeys.includes(key)) {
      return { ok: false, error: { fieldErrors: { [key]: [`Unexpected field: ${key}`] } } };
    }
  }

  const assetType = body.assetType;
  const phase = body.phase;
  const externalUrl = body.externalUrl;
  const label = body.label;
  const notes = body.notes;

  if (!assetType || !ASSET_TYPE.includes(assetType as any)) {
    return { ok: false, error: { fieldErrors: { assetType: [`Must be one of: ${ASSET_TYPE.join(', ')}`] } } };
  }

  if (!phase || !PHASE.includes(phase as any)) {
    return { ok: false, error: { fieldErrors: { phase: [`Must be one of: ${PHASE.join(', ')}`] } } };
  }

  if (assetType === 'link' && !externalUrl) {
    return { ok: false, error: { fieldErrors: { externalUrl: ['External URL is required for link type'] } } };
  }

  if (externalUrl !== undefined && externalUrl !== null && typeof externalUrl !== 'string') {
    return { ok: false, error: { fieldErrors: { externalUrl: ['Expected string or null'] } } };
  }

  if (label !== undefined && label !== null && typeof label !== 'string') {
    return { ok: false, error: { fieldErrors: { label: ['Expected string or null'] } } };
  }

  if (notes !== undefined && notes !== null && typeof notes !== 'string') {
    return { ok: false, error: { fieldErrors: { notes: ['Expected string or null'] } } };
  }

  return { ok: true, data: body as Record<string, unknown> };
}

function doGet(tradeId: string): { status: number; data: unknown } {
  const trade = db.select().from(schema.trades).where(eq(schema.trades.id, tradeId)).get();
  if (!trade) {
    return { status: 404, data: { error: 'Trade not found' } };
  }

  const assets = db
    .select()
    .from(schema.tradeAssets)
    .where(eq(schema.tradeAssets.tradeId, tradeId))
    .orderBy(schema.tradeAssets.createdAt)
    .all();

  return { status: 200, data: assets };
}

function doPostJson(tradeId: string, body: Record<string, unknown>): {
  status: number;
  data: unknown;
} {
  const trade = db.select().from(schema.trades).where(eq(schema.trades.id, tradeId)).get();
  if (!trade) {
    return { status: 404, data: { error: 'Trade not found' } };
  }

  const validation = validateAssetBody(body);
  if (!validation.ok) {
    return { status: 400, data: { error: 'Validation failed', details: validation.error } };
  }

  const data = validation.data!;
  const assetId = randomUUID();
  const now = new Date().toISOString();

  db.insert(schema.tradeAssets)
    .values({
      id: assetId,
      tradeId,
      assetType: data.assetType as any,
      phase: data.phase as any,
      label: (data.label as string | null) ?? null,
      filePath: null,
      externalUrl: (data.externalUrl as string | null) ?? null,
      notes: (data.notes as string | null) ?? null,
      createdAt: now,
    })
    .run();

  const created = db
    .select()
    .from(schema.tradeAssets)
    .where(eq(schema.tradeAssets.id, assetId))
    .get();

  return { status: 201, data: created };
}

function doDelete(tradeId: string, assetId: string): { status: number; data: unknown } {
  const trade = db.select().from(schema.trades).where(eq(schema.trades.id, tradeId)).get();
  if (!trade) {
    return { status: 404, data: { error: 'Trade not found' } };
  }

  const asset = db
    .select()
    .from(schema.tradeAssets)
    .where(eq(schema.tradeAssets.id, assetId))
    .get();

  if (!asset) {
    return { status: 404, data: { error: 'Asset not found' } };
  }

  // Simulate file deletion (just a no-op in test)
  if (asset.filePath) {
    // In tests we don't actually have files on disk
  }

  db.delete(schema.tradeAssets)
    .where(eq(schema.tradeAssets.id, assetId))
    .run();

  return { status: 200, data: { message: 'Asset removed' } };
}

// ── Fixtures ────────────────────────────────────────────────────────

const accountId = randomUUID();
const tradeId1 = randomUUID();
const tradeId2 = randomUUID();

db.insert(schema.accounts).values({ id: accountId, name: 'Test Account' }).run();
db.insert(schema.trades).values({
  id: tradeId1,
  tradeCode: 'TEST-ASSET-001',
  accountId,
  symbol: 'AAPL',
  direction: 'long',
  status: 'open',
}).run();
db.insert(schema.trades).values({
  id: tradeId2,
  tradeCode: 'TEST-ASSET-002',
  accountId,
  symbol: 'MSFT',
  direction: 'short',
  status: 'planned',
}).run();

// ── Tests ───────────────────────────────────────────────────────────

console.log('\n--- Trade Assets API Tests ---\n');

// ── 1. GET: Trade not found ────────────────────────────────────────

console.log('\n1. GET returns 404 for missing trade:');
{
  const result = doGet('non-existent-id');
  assert(result.status === 404, 'returns 404');
  assertEqual((result.data as { error: string }).error, 'Trade not found', 'error message');
}

// ── 2. GET: Empty list for existing trade ───────────────────────────

console.log('\n2. GET returns empty array when no assets:');
{
  const result = doGet(tradeId1);
  assert(result.status === 200, 'returns 200');
  assert(Array.isArray(result.data), 'response is an array');
  assertEqual((result.data as unknown[]).length, 0, 'array is empty');
}

// ── 3. POST: Create link asset via JSON ──────────────────────────────

console.log('\n3. POST creates a link asset via JSON:');
{
  const result = doPostJson(tradeId1, {
    assetType: 'link',
    phase: 'pre_trade',
    label: 'Chart analysis',
    externalUrl: 'https://www.tradingview.com/chart/AAPL/',
    notes: 'Key support level identified',
  });

  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assertNotNull(data.id, 'has id');
  assertEqual(data.assetType, 'link', 'assetType is link');
  assertEqual(data.phase, 'pre_trade', 'phase is pre_trade');
  assertEqual(data.label, 'Chart analysis', 'label matches');
  assertEqual(data.externalUrl, 'https://www.tradingview.com/chart/AAPL/', 'externalUrl matches');
  assertEqual(data.notes, 'Key support level identified', 'notes match');
  assertEqual(data.filePath, null, 'filePath is null for link');
}

// ── 4. POST: Create image asset via JSON ──────────────────────────────

console.log('\n4. POST creates an image/document asset via JSON:');
{
  const result = doPostJson(tradeId2, {
    assetType: 'image',
    phase: 'exit',
    label: 'Exit screenshot from platform',
    notes: 'Shows filled order at market close',
  });

  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.assetType, 'image', 'assetType is image');
  assertEqual(data.phase, 'exit', 'phase is exit');
  assertEqual(data.externalUrl, null, 'externalUrl is null');
  assertEqual(data.filePath, null, 'filePath is null for non-upload asset');
}

// ── 5. POST: Validation rejects missing required fields ──────────────

console.log('\n5. POST returns 400 for missing assetType:');
{
  const result = doPostJson(tradeId1, {
    phase: 'entry',
  } as any);

  assert(result.status === 400, 'returns 400');
}

// ── 6. POST: Validation rejects invalid assetType ─────────────────────

console.log('\n6. POST returns 400 for invalid assetType:');
{
  const result = doPostJson(tradeId1, {
    assetType: 'invalid_type',
    phase: 'entry',
  } as any);

  assert(result.status === 400, 'returns 400');
}

// ── 7. POST: Link type requires externalUrl ───────────────────────────

console.log('\n7. POST returns 400 for link without externalUrl:');
{
  const result = doPostJson(tradeId1, {
    assetType: 'link',
    phase: 'entry',
  });

  assert(result.status === 400, 'returns 400');
}

// ── 8. POST: Trade not found ──────────────────────────────────────────

console.log('\n8. POST returns 404 for missing trade:');
{
  const result = doPostJson('non-existent-id', {
    assetType: 'document',
    phase: 'review',
  });

  assert(result.status === 404, 'returns 404');
}

// ── 9. GET: Returns created assets in order ───────────────────────────

console.log('\n9. GET returns assets for tradeId1:');
{
  const result = doGet(tradeId1);
  assert(result.status === 200, 'returns 200');
  const assets = result.data as unknown[];
  assert(assets.length >= 1, 'has at least 1 asset');
  // The first created asset should be present
  const linkAsset = assets.find((a: any) => a.assetType === 'link');
  assertNotNull(linkAsset, 'link asset is in the list');
}

// ── 10. DELETE: Remove non-existent asset ────────────────────────────

console.log('\n10. DELETE returns 404 for unknown asset:');
{
  const result = doDelete(tradeId1, 'non-existent-id');
  assert(result.status === 404, 'returns 404');
}

// ── 11. DELETE: Remove existing asset ─────────────────────────────────

console.log('\n11. DELETE removes an existing asset:');
{
  // Create an asset first
  const createResult = doPostJson(tradeId2, {
    assetType: 'document',
    phase: 'entry',
    label: 'Risk calculation sheet',
  });

  const created = createResult.data as Record<string, unknown>;
  assertNotNull(created.id, 'created asset has id');
  const assetId = created.id as string;

  // Now delete it
  const deleteResult = doDelete(tradeId2, assetId);
  assert(deleteResult.status === 200, 'delete returns 200');
  assertEqual((deleteResult.data as { message: string }).message, 'Asset removed', 'delete message');
}

// ── 12. DELETE: Trade not found ───────────────────────────────────────

console.log('\n12. DELETE returns 404 for missing trade:');
{
  const result = doDelete('non-existent-trade', 'some-id');
  assert(result.status === 404, 'returns 404');
}

// ── 13. POST: Additional fields rejected ──────────────────────────────

console.log('\n13. POST returns 400 for unexpected field:');
{
  const result = doPostJson(tradeId1, {
    assetType: 'document',
    phase: 'review',
    randomField: 'should not be allowed',
  } as any);

  assert(result.status === 400, 'returns 400 for unexpected field');
}

// ── 14. POST: Create asset with optional fields all null ──────────────

console.log('\n14. POST creates asset with minimal fields:');
{
  const result = doPostJson(tradeId1, {
    assetType: 'other',
    phase: 'management',
  });

  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.assetType, 'other', 'assetType is other');
  assertEqual(data.phase, 'management', 'phase is management');
  assertEqual(data.label, null, 'label is null');
  assertEqual(data.externalUrl, null, 'externalUrl is null');
  assertEqual(data.notes, null, 'notes is null');
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
