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
 *
 * Timeout policy: the aggregate Vitest process gets a larger bounded timeout
 * (VITEST_SUITE_TIMEOUT_MS) because the full suite legitimately runs longer
 * than any single guard on slower CI runners; every individual suite/guard
 * command keeps the normal bounded DEFAULT_COMMAND_TIMEOUT_MS. All timeouts
 * remain bounded — a genuinely hung process still fails the gate.
 */

import { execSync } from 'child_process';
import path from 'path';
import { pathToFileURL } from 'node:url';

/* ─── Configuration ─────────────────────────────────────────────────────── */

const PROJECT_ROOT = path.resolve(__dirname, '..');

/** Bounded process timeout for individual suites and guards. */
export const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;

/**
 * Bounded process timeout for the aggregate Vitest suite. The full suite
 * needs more wall time than any individual command, so it must not inherit
 * the per-command timeout; the value is still bounded so a hung Vitest
 * process fails the quality gate rather than running forever.
 */
export const VITEST_SUITE_TIMEOUT_MS = 300_000;

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
  'src/app/api/trades/__tests__/cross-system-lifecycle.test.ts',
  'src/app/api/trades/[id]/stop-adjustments/__tests__/route.test.ts',
  'src/app/api/trades/[id]/stop-adjustments/[adjustmentId]/__tests__/route.test.ts',
  'src/app/api/trades/[id]/target-adjustments/__tests__/route.test.ts',
  'src/app/api/trades/[id]/level-history/__tests__/route.test.ts',
  'src/app/api/trades/[id]/executions/[execId]/__tests__/route.test.ts',
  'src/app/api/trades/[id]/executions/[execId]/correct/__tests__/route.test.ts',
  'src/components/trade-detail/__tests__/trade-history-feed.test.ts',
  'src/components/trade-detail/__tests__/trade-context-band.test.ts',
  'src/components/trade-detail/__tests__/trade-detail-grid.test.ts',
  'src/components/trade-detail/__tests__/lifecycle-first-grid.test.ts',
  'src/components/trade-detail/__tests__/planned-phase-grid.test.ts',
  'src/components/trade-detail/__tests__/closed-phase-grid.test.ts',
  'src/components/trade-detail/__tests__/add-fill-dialog.test.ts',
  'src/components/trade-detail/__tests__/correction-dialog.test.ts',
  'src/app/api/accounts/__tests__/route.test.ts',
  'src/app/api/accounts/__tests__/checks.test.ts',
  'src/app/api/accounts/[id]/__tests__/route.accounting-regression.test.ts',
  'src/app/api/accounts/[id]/transactions/__tests__/route.test.ts',
  'src/app/api/backup/__tests__/files.test.ts',
  'src/app/api/backup/__tests__/route.test.ts',
  'src/app/api/backup/__tests__/server-restore.test.ts',
  'src/app/api/backup/__tests__/status.test.ts',
  'src/app/api/checks/__tests__/merged.test.ts',
  'src/app/api/checks/__tests__/reorder.test.ts',
  'src/app/api/dashboard/__tests__/route.test.ts',
  'src/app/api/lookups/[id]/__tests__/route.test.ts',
  'src/app/api/lookups/__tests__/route.test.ts',
  'src/app/api/reset/__tests__/route.test.ts',
  'src/app/api/restore/__tests__/route.test.ts',
  'src/app/api/reviews/action-items/__tests__/route.test.ts',
  'src/app/api/reviews/dashboard/__tests__/route.test.ts',
  'src/app/api/reviews/weekly/__tests__/route.test.ts',
  'src/app/api/roundtrip/__tests__/route.test.ts',
  'src/app/api/settings/__tests__/route.test.ts',
  'src/app/api/setup-definitions/[id]/evaluation-fields/__tests__/route.test.ts',
  'src/app/api/setup-definitions/__tests__/route.test.ts',
  'src/app/api/setups/__tests__/checks.test.ts',
  'src/app/api/trades/[id]/assets/__tests__/route.test.ts',
  'src/app/api/trades/[id]/grade/__tests__/route.test.ts',
  'src/app/api/trades/[id]/mistakes/__tests__/route.test.ts',
  'src/app/api/trades/[id]/mtm/__tests__/route.test.ts',
  'src/app/api/trades/__tests__/server-computed-columns.test.ts',
  'src/app/api/trades/export/__tests__/route.test.ts',
  'src/app/api/trades/mtm/refresh/__tests__/route.test.ts',
  'src/app/api/watchlist/[id]/promote/__tests__/route.test.ts',
  'src/components/dashboard-chart.test.ts',
  'src/components/lifecycle-stepper.test.ts',
  'src/components/trade-detail/__tests__/assessment-card.test.ts',
  'src/components/trade-detail/__tests__/assessment-history.test.ts',
  'src/components/trade-detail/__tests__/price-widget.test.ts',
  'src/components/trade-detail/__tests__/risk-snapshot-card.test.ts',
  'src/components/trade-detail/helpers.test.ts',
  'src/lib/__tests__/secret-leak.test.ts',
  'src/lib/__tests__/backup-job-runtime.test.ts',
  'src/lib/__tests__/backup.test.ts',
  'src/lib/__tests__/restore.test.ts',
  'src/lib/backup-serializer.test.ts',
  'src/lib/calendar-heatmap.test.ts',
  'src/lib/create-backup.test.ts',
  'src/lib/equity.test.ts',
  'src/lib/export-csv.test.ts',
  'src/lib/grading.test.ts',
  'src/lib/period-matrix.test.ts',
  'src/lib/timezone.test.ts',
  'src/lib/trade-execution-idempotency.test.ts',
  'src/lib/trade-metrics.test.ts',
  'scripts/__tests__/m020-evidence-isolation.test.ts',
  'scripts/__tests__/run-all-tests-timeout.test.ts',
  'scripts/recovery-drill.ts',
];

/* ─── Helpers ───────────────────────────────────────────────────────────── */

export interface SuiteResult {
  name: string;
  passed: boolean;
  durationMs: number;
  output: string;
  /** True when the command was terminated for exceeding its process timeout. */
  timedOut?: boolean;
}

export function run(
  cmd: string,
  cwd: string,
  label: string,
  timeoutMs: number = DEFAULT_COMMAND_TIMEOUT_MS,
): SuiteResult {
  const start = Date.now();
  try {
    const stdout = execSync(cmd, { cwd, timeout: timeoutMs, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
    return { name: label, passed: true, durationMs: Date.now() - start, output: stdout.trim() };
  } catch (e: unknown) {
    const execErr = e as {
      stderr?: Buffer | string;
      stdout?: Buffer | string;
      signal?: NodeJS.Signals | null;
      status?: number | null;
    };
    const stderr = execErr.stderr?.toString()?.trim() || '';
    const stdout = execErr.stdout?.toString()?.trim() || '';
    // execSync marks a timeout termination with SIGTERM and a null exit status;
    // distinguish it from an ordinary non-zero exit so timeouts are reported
    // as timeouts rather than looking like assertion failures.
    const timedOut = execErr.signal === 'SIGTERM' && execErr.status === null;
    return {
      name: label,
      passed: false,
      timedOut,
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
  const vitestResult = run(`npx vitest run --reporter verbose`, PROJECT_ROOT, 'vitest', VITEST_SUITE_TIMEOUT_MS);
  results.push(vitestResult);
  if (!vitestResult.passed) {
    console.log(
      `   ✗ vitest ${vitestResult.timedOut ? `TIMED OUT after ${fmtDuration(vitestResult.durationMs)}` : `FAILED (${fmtDuration(vitestResult.durationMs)})`}`,
    );
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

  /* ─── Root test-artifact hygiene guard (H1) ───────────── */
  console.log('◆  Root test-artifact hygiene check …');
  const hygiene = run(`npx tsx scripts/check-root-test-artifacts.mjs`, PROJECT_ROOT, 'root-test-artifacts');
  results.push(hygiene);
  if (!hygiene.passed) {
    console.log(`   ✗ root test-artifact hygiene FAILED`);
    console.log(hygiene.output.split('\n').slice(0, 20).map(l => `     ${l}`).join('\n'));
    exitCode = 1;
  } else {
    console.log(`   ✓ root test-artifact hygiene PASSED`);
  }
  console.log();

  /* ─── Obsolete execution-sync guard (D6) ─────────────── */
  console.log('◆  Obsolete execution-sync check …');
  const obsoleteSync = run(`node scripts/check-obsolete-execution-sync.mjs`, PROJECT_ROOT, 'obsolete-execution-sync');
  results.push(obsoleteSync);
  if (!obsoleteSync.passed) {
    console.log(`   ✗ obsolete execution-sync FAILED (forbidden references found)`);
    console.log(obsoleteSync.output.split('\n').slice(0, 20).map((l) => `     ${l}`).join('\n'));
    exitCode = 1;
  } else {
    console.log(`   ✓ obsolete execution-sync PASSED`);
  }
  console.log();

  /* ─── Test ownership guard (T01) ─────────────────────── */
  console.log('◆  Test ownership check …');
  const ownership = run(`npx tsx scripts/check-test-ownership.mjs`, PROJECT_ROOT, 'test-ownership');
  results.push(ownership);
  if (!ownership.passed) {
    console.log(`   ✗ test ownership FAILED (unowned or missing test files)`);
    console.log(ownership.output.split('\n').slice(0, 30).map(l => `     ${l}`).join('\n'));
    exitCode = 1;
  } else {
    console.log(`   ✓ test ownership PASSED`);
  }
  console.log();

  /* ─── Summary table ──────────────────────────────────── */
  console.log('━'.repeat(60));
  console.log('  Summary');
  console.log('━'.repeat(60));
  const nameWidth = Math.max(...results.map(r => r.name.length), 10) + 2;
  console.log(`  ${pad('Suite', nameWidth)} ${pad('Result', 12)} ${pad('Duration', 8)}`);
  console.log(`  ${'─'.repeat(nameWidth)} ${'─'.repeat(12)} ${'─'.repeat(8)}`);
  for (const r of results) {
    const status = r.timedOut ? '✗ TIMED OUT' : (r.passed ? '✓ PASS' : '✗ FAIL');
    console.log(`  ${pad(r.name, nameWidth)} ${pad(status, 12)} ${pad(fmtDuration(r.durationMs), 8)}`);
  }
  console.log();
  console.log(`  Overall: ${exitCode === 0 ? '✓ ALL PASSED' : `✗ ${results.filter(r => !r.passed).length} FAILED`}`);
  console.log('━'.repeat(60));
  process.exit(exitCode);
}

// Run as a CLI only when executed directly; the module is importable by the
// timeout-policy regression test without triggering the orchestrator.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error('run-all-tests.ts: unexpected error', e);
    process.exit(1);
  });
}
