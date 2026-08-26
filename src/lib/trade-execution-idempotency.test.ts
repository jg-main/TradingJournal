#!/usr/bin/env tsx
/**
 * trade-execution-idempotency.test.ts
 *
 * Pure unit tests for the deterministic accounting idempotency key builder.
 *
 * Run: npx tsx src/lib/trade-execution-idempotency.test.ts
 *
 * Pattern: src/lib/dashboard.test.ts — standalone tsx harness, no DB.
 */

import { tradeExecutionIdempotencyKey } from './trade-execution-idempotency';

let passed = 0;
let failed = 0;

function assertEqual(actual: string, expected: string, label: string): void {
  if (actual === expected) {
    passed++;
    console.log(`  ✅ PASS: ${label}`);
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

console.log('\ntrade-execution-idempotency.test.ts\n');

// ── Format (D6 §23): exact preserved key ───────────────────────────────

console.log('Key format:');
assertEqual(
  tradeExecutionIdempotencyKey('abc'),
  'trade-execution-abc',
  "tradeExecutionIdempotencyKey('abc') === 'trade-execution-abc'",
);
assertEqual(
  tradeExecutionIdempotencyKey('63c6a51b-92b7-4e3f-9f1a-1c2d3e4f5a6b'),
  'trade-execution-63c6a51b-92b7-4e3f-9f1a-1c2d3e4f5a6b',
  'UUID-style execution IDs keep the exact historical format',
);

// ── Deterministic (D6 §23): same ID → same key, no randomness ──────────

console.log('\nDeterminism:');
const id = 'exec-987';
assertEqual(
  tradeExecutionIdempotencyKey(id),
  tradeExecutionIdempotencyKey(id),
  'same ID produces the same key on every call',
);
const keyA = tradeExecutionIdempotencyKey(id);
assertEqual(
  tradeExecutionIdempotencyKey(id),
  keyA,
  'repeated call is a pure function of the ID (repeatable)',
);

// ── Distinct IDs never collide ──────────────────────────────────────────

assertEqual(
  tradeExecutionIdempotencyKey('exec-1') === tradeExecutionIdempotencyKey('exec-2') ? 'same' : 'different',
  'different',
  'distinct IDs produce distinct keys',
);

console.log(`\n${failed === 0 ? 'trade-execution-idempotency.test.ts — ALL PASSED' : 'trade-execution-idempotency.test.ts — FAILED'}`);
console.log(`  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
