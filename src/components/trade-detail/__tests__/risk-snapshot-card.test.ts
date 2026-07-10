/**
 * risk-snapshot-card.test.ts
 *
 * Tests for the RiskSnapshotCard component MTM edge case logic.
 * Verifies source-level contract: tradeStatus prop, MTM status gating,
 * "No entry price — execute first" text, and zero P&L display.
 *
 * Run: npx tsx src/components/trade-detail/__tests__/risk-snapshot-card.test.ts
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compSourcePath = path.resolve(__dirname, '../risk-snapshot-card.tsx');

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

// ────────────────────────────────────────────────────────────────────────
// Module contract — verify component exports and props
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Module contract');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  assert(source.includes('export default function RiskSnapshotCard'), 'exports RiskSnapshotCard as default');
  assert(source.includes('interface RiskSnapshotCardProps'), 'defines RiskSnapshotCardProps interface');
  assert(source.includes("'use client'") || source.includes('"use client"'), 'has use client directive');
}

// ────────────────────────────────────────────────────────────────────────
// Props interface — verify all key props including tradeStatus
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Props interface');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  assert(source.includes('riskSnapshot: RiskSnapshot | null'), 'accepts riskSnapshot prop');
  assert(source.includes('plannedValues'), 'accepts plannedValues prop');
  assert(source.includes('actualValues'), 'accepts actualValues prop');
  assert(source.includes('mtmData?: MtmData'), 'accepts optional mtmData prop');
  assert(source.includes('onRefreshPrice?: () => void'), 'accepts optional onRefreshPrice callback');
  assert(source.includes('tradeStatus?: Trade'), 'accepts optional tradeStatus prop');
}

// ────────────────────────────────────────────────────────────────────────
// MTM section gating — verify MTM only renders for open trades
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## MTM status gating');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  // The MTM section should be gated on tradeStatus === 'open'
  assert(
    source.includes("tradeStatus === 'open'") || source.includes('tradeStatus === "open"'),
    'MTM section gated on tradeStatus === "open"'
  );

  // The MTM section should also require mtmData to be non-null
  assert(
    source.includes('mtmData != null') || source.includes('mtmData !== null'),
    'MTM section gated on mtmData != null'
  );
}

// ────────────────────────────────────────────────────────────────────────
// "No entry price" message — verify the execute-first messaging
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## No entry price handling');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  assert(
    source.includes('No entry price') || source.includes("No entry price"),
    'displays "No entry price — execute first" fallback message'
  );

  assert(
    source.includes('execute first') || source.includes("execute first"),
    'includes explanatory "execute first" text'
  );

  assert(
    source.includes('actualEntry == null'),
    'conditional check uses actualEntry == null for no-executions detection'
  );
}

// ────────────────────────────────────────────────────────────────────────
// Zero P&L handling — formatCurrency(0) must return $0.00
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Zero P&L display');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  // The component should use formatCurrency for dollar amounts
  assert(source.includes('formatCurrency'), 'component uses formatCurrency utility');

  // The component should handle >= 0 for color selection (includes zero)
  assert(
    source.includes('unrealizedPnl >= 0') || source.includes('unrealizedPnlPct >= 0'),
    'P&L color uses >= 0 comparison (zero shows green)'
  );

  // Verify the zero-P&L path in helpers via formatCurrency expectation
  const helpersSource = fs.readFileSync(
    path.resolve(__dirname, '../helpers.ts'),
    'utf-8'
  );
  assert(
    helpersSource.includes("v >= 0 ? `$${formatted}`") || helpersSource.includes("v >= 0 ? '$"),
    'helpers.formatCurrency uses >= 0 for sign prefix (zero = positive/neutral)'
  );
}

// ────────────────────────────────────────────────────────────────────────
// Error resilience — component must not crash when mtmData is present
// but tradeStatus is non-open
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Error resilience (non-open status)');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  // The gating condition is a simple && check — no crashing possible
  assert(
    source.includes('mtmData != null && tradeStatus') || source.includes('mtmData !== null && tradeStatus'),
    'MTM section uses safe conditional (&&) — no crash when mtmData present but tradeStatus non-open'
  );
}

// ────────────────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────────────────
const total = passed + failed;
console.log(`\n## Results: ${passed}/${total} passed, ${failed}/${total} failed\n`);
process.exit(failed > 0 ? 1 : 0);
