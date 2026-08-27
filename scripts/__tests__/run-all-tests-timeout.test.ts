/**
 * Timeout-policy regression for the test orchestrator
 * (scripts/run-all-tests.ts).
 *
 * Locks the contract that:
 *  - the aggregate Vitest process is granted a larger bounded timeout
 *    (VITEST_SUITE_TIMEOUT_MS >= 300_000) than individual commands;
 *  - standalone/guard commands retain the normal bounded default
 *    (DEFAULT_COMMAND_TIMEOUT_MS === 120_000);
 *  - a command exiting non-zero is still reported as failed;
 *  - a command exceeding its process timeout is reported as a timeout
 *    failure, never as success;
 *  - a successful command still passes.
 *
 * Run: npx tsx scripts/__tests__/run-all-tests-timeout.test.ts
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_COMMAND_TIMEOUT_MS, VITEST_SUITE_TIMEOUT_MS, run } from '../run-all-tests';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../..');

const failures: string[] = [];

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✅ ${message}`);
  } else {
    failures.push(message);
    console.error(`  ❌ ${message}`);
  }
}

console.log('\n## run-all-tests timeout policy');

// A. Aggregate Vitest timeout: at least the recommended 5 minutes.
assert(
  VITEST_SUITE_TIMEOUT_MS >= 300_000,
  `vitest suite timeout is at least 300_000ms (got ${VITEST_SUITE_TIMEOUT_MS})`,
);

// B. Default command timeout: the normal bounded per-command timeout.
assert(
  DEFAULT_COMMAND_TIMEOUT_MS === 120_000,
  `default command timeout is 120_000ms (got ${DEFAULT_COMMAND_TIMEOUT_MS})`,
);

// Wiring: the aggregate Vitest invocation passes the larger timeout, while
// every other command falls back to the default bounded timeout.
const source = readFileSync(path.join(PROJECT_ROOT, 'scripts/run-all-tests.ts'), 'utf-8');
assert(
  source.includes("PROJECT_ROOT, 'vitest', VITEST_SUITE_TIMEOUT_MS"),
  'aggregate vitest invocation passes VITEST_SUITE_TIMEOUT_MS',
);
assert(
  source.includes('= DEFAULT_COMMAND_TIMEOUT_MS'),
  'other commands default to the normal bounded timeout',
);

// C. Non-zero exit remains a failure.
const failed = run(`node -e "process.exit(3)"`, PROJECT_ROOT, 'probe-nonzero', 10_000);
assert(failed.passed === false, 'non-zero exit reports failed');
assert(failed.timedOut !== true, 'non-zero exit is not mislabeled as a timeout');

// D. A command exceeding its process timeout is a failure, not a success.
const timedOut = run(`node -e "setTimeout(() => {}, 60_000)"`, PROJECT_ROOT, 'probe-timeout', 300);
assert(timedOut.passed === false, 'command exceeding its process timeout reports failed');
assert(timedOut.timedOut === true, 'command exceeding its process timeout is labeled as a timeout');

// Sanity: a successful command still passes.
const ok = run(`node -e "process.exit(0)"`, PROJECT_ROOT, 'probe-ok', 10_000);
assert(ok.passed === true, 'exit 0 reports passed');
assert(ok.timedOut !== true, 'successful command is not a timeout');

if (failures.length > 0) {
  console.error(`\n${failures.length} run-all-tests timeout-policy assertions failed.`);
  process.exit(1);
}

console.log('\nAll run-all-tests timeout-policy assertions passed.');
