#!/usr/bin/env tsx
/**
 * run-all-tests.ts
 *
 * Orchestrates all project test suites and reports a summary.
 * Intended as the single entry point for the quality gate (`make test:all`).
 *
 * Run: npx tsx scripts/run-all-tests.ts
 *
 * Suites run:
 *   1. Vitest — unit tests and API route tests
 *   2. Standalone tsx tests — consolidation library tests in src/lib/*.test.ts
 */

import { execSync } from 'child_process';
import path from 'path';

/* ─── Configuration ─────────────────────────────────────────────────────── */

const PROJECT_ROOT = path.resolve(__dirname, '..');

/** Standalone tsx test files (not covered by vitest config). */
const TSX_TESTS: string[] = [
  'src/lib/account-summary.test.ts',
  'src/lib/attention-insights.test.ts',
  'src/lib/dashboard.test.ts',
  'src/lib/mark-to-market.test.ts',
  'src/lib/metrics.test.ts',
  'src/lib/perf-metrics.test.ts',
  'src/lib/planned-risk.test.ts',
  'src/lib/position-sizing.test.ts',
  'src/lib/review-dashboard.test.ts',
  'src/lib/risk-snapshot.test.ts',
  'src/lib/trade-levels.test.ts',
  'src/lib/weekly-review.test.ts',
  'src/lib/__fixtures__/golden-scenarios.test.tsx',
  'src/lib/__fixtures__/response-contracts.test.ts',
  'src/app/api/trades/__tests__/cross-surface-integration.test.ts',
  'src/app/api/trades/[id]/stop-adjustments/__tests__/route.test.ts',
  'src/app/api/trades/[id]/stop-adjustments/[adjustmentId]/__tests__/route.test.ts',
  'src/app/api/trades/[id]/target-adjustments/__tests__/route.test.ts',
  'src/app/api/trades/[id]/level-history/__tests__/route.test.ts',
];

/* ─── Helpers ───────────────────────────────────────────────────────────── */

interface SuiteResult {
  name: string;
  passed: boolean;
  durationMs: number;
  output: string;
}

function run(cmd: string, cwd: string, label: string): SuiteResult {
  const start = Date.now();
  try {
    const stdout = execSync(cmd, { cwd, timeout: 120_000, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
    return { name: label, passed: true, durationMs: Date.now() - start, output: stdout.trim() };
  } catch (e: unknown) {
    const execErr = e as { stderr?: Buffer | string; stdout?: Buffer | string };
    const stderr = execErr.stderr?.toString()?.trim() || '';
    const stdout = execErr.stdout?.toString()?.trim() || '';
    return {
      name: label,
      passed: false,
      durationMs: Date.now() - start,
      output: stdout + (stdout && stderr ? '\n' : '') + stderr,
    };
  }
}

function pad(s: string, n: number): string {
  return s + ' '.repeat(Math.max(0, n - s.length));
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/* ─── Main ──────────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  const results: SuiteResult[] = [];
  let exitCode = 0;

  console.log('━'.repeat(60));
  console.log('  Trading Journal — All Tests');
  console.log('━'.repeat(60));
  console.log();

  /* 1. Vitest suite */
  console.log('◆  Running vitest …');
  const vitestResult = run(`npx vitest run --reporter verbose`, PROJECT_ROOT, 'vitest');
  results.push(vitestResult);
  if (!vitestResult.passed) {
    console.log(`   ✗ vitest FAILED (${fmtDuration(vitestResult.durationMs)})`);
    console.log(vitestResult.output.slice(0, 2000));
    exitCode = 1;
  } else {
    console.log(`   ✓ vitest PASSED (${fmtDuration(vitestResult.durationMs)})`);
  }
  console.log();

  /* 2. Standalone tsx tests */
  console.log('◆  Running standalone tsx tests …');
  for (const testFile of TSX_TESTS) {
    const label = testFile.replace('src/lib/', '').replace('.test.ts', '');
    const fullPath = path.resolve(PROJECT_ROOT, testFile);
    const tsxResult = run(`npx tsx "${fullPath}"`, PROJECT_ROOT, label);
    results.push(tsxResult);
    if (!tsxResult.passed) {
      console.log(`   ✗ ${label} FAILED (${fmtDuration(tsxResult.durationMs)})`);
      const lines = tsxResult.output.split('\n').filter(l => l.includes('FAIL') || l.includes('Error') || l.includes('✗') || l.includes('×'));
      for (const l of lines.slice(0, 10)) {
        console.log(`     ${l}`);
      }
      exitCode = 1;
    } else {
      console.log(`   ✓ ${label} PASSED (${fmtDuration(tsxResult.durationMs)})`);
    }
  }
  console.log();

  /* ─── Summary table ──────────────────────────────────── */
  console.log('━'.repeat(60));
  console.log('  Summary');
  console.log('━'.repeat(60));
  const nameWidth = Math.max(...results.map(r => r.name.length), 10) + 2;
  console.log(`  ${pad('Suite', nameWidth)} ${pad('Result', 8)} ${pad('Duration', 8)}`);
  console.log(`  ${'─'.repeat(nameWidth)} ${'─'.repeat(8)} ${'─'.repeat(8)}`);
  for (const r of results) {
    const status = r.passed ? '✓ PASS' : '✗ FAIL';
    console.log(`  ${pad(r.name, nameWidth)} ${pad(status, 8)} ${pad(fmtDuration(r.durationMs), 8)}`);
  }
  console.log();
  console.log(`  Overall: ${exitCode === 0 ? '✓ ALL PASSED' : `✗ ${results.filter(r => !r.passed).length} FAILED`}`);
  console.log('━'.repeat(60));
  process.exit(exitCode);
}

main().catch((e) => {
  console.error('run-all-tests.ts: unexpected error', e);
  process.exit(1);
});
