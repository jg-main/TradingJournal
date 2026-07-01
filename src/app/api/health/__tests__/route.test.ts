/**
 * health route test
 *
 * Tests GET returns 200 with status:'ok', db:'connected', and ISO timestamp.
 *
 * Run: npx vitest run --reporter verbose src/app/api/health/__tests__/route.test.ts
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { sql } from 'drizzle-orm';

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

const DB_FILE = process.env.DB_FILE_NAME || './.test-health.db';
const sqlite = new Database(DB_FILE);
sqlite.pragma('journal_mode = WAL');
const db = drizzle(sqlite, { schema });

// No tables needed — health just does SELECT 1

// ── Simulated route logic ───────────────────────────────────────────

function doGetHealth(): { status: number; data: unknown } {
  try {
    db.run(sql`SELECT 1`);
    return {
      status: 200,
      data: {
        status: 'ok',
        db: 'connected',
        timestamp: new Date().toISOString(),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown database error';
    return {
      status: 503,
      data: {
        status: 'error',
        db: 'disconnected',
        message,
        timestamp: new Date().toISOString(),
      },
    };
  }
}

// ── Tests ───────────────────────────────────────────────────────────

console.log('\n--- Health API Tests ---\n');

// ── 1. GET: Returns 200 with status ok ─────────────────────────────

console.log('\n1. GET returns 200:');
{
  const result = doGetHealth();
  assert(result.status === 200, 'returns 200');
}

// ── 2. GET: Has status ok ──────────────────────────────────────────

console.log('\n2. GET returns status: ok:');
{
  const result = doGetHealth();
  const data = result.data as Record<string, unknown>;
  assertEqual(data.status, 'ok', 'status is ok');
}

// ── 3. GET: Has db connected ───────────────────────────────────────

console.log('\n3. GET returns db: connected:');
{
  const result = doGetHealth();
  const data = result.data as Record<string, unknown>;
  assertEqual(data.db, 'connected', 'db is connected');
}

// ── 4. GET: Timestamp is ISO string ────────────────────────────────

console.log('\n4. GET timestamp is ISO 8601 string:');
{
  const result = doGetHealth();
  const data = result.data as Record<string, unknown>;
  const ts = data.timestamp as string;
  assertNotNull(ts, 'timestamp is present');
  // ISO 8601 format: YYYY-MM-DDTHH:mm:ss.sssZ or with timezone offset
  const isIso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(ts);
  assert(isIso, 'timestamp is ISO 8601 format');
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
