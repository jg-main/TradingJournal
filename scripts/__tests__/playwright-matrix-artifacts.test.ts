// @vitest-environment node
/**
 * playwright-matrix-artifacts.test.ts
 *
 * Regression tests for the CI Playwright evidence-retention contract
 * (scripts/run-playwright-matrix.mjs + .github/workflows/quality-gate.yml).
 *
 * Proves (statically, via source contract):
 *  - the runner does NOT pass a CLI reporter, so playwright.config.ts owns the
 *    reporter contract and HTML reports are actually produced;
 *  - each matrix partition receives a distinct artifact directory under a
 *    configurable matrix artifact root;
 *  - the runner writes a durable matrix-summary.json so failed invocations
 *    still leave retained evidence;
 *  - the GitHub Actions upload path points at the same matrix root and uses
 *    `if-no-files-found: error` instead of silently ignoring missing evidence;
 *  - the upload step remains unconditional (`if: always()`) so failed browser
 *    jobs retain diagnostic artifacts.
 *
 * Run: npx vitest run scripts/__tests__/playwright-matrix-artifacts.test.ts
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const runnerSource = readFileSync(join(ROOT, 'scripts/run-playwright-matrix.mjs'), 'utf-8');
const workflowSource = readFileSync(join(ROOT, '.github/workflows/quality-gate.yml'), 'utf-8');

describe('playwright matrix artifact contract', () => {
  it('does not override the configured reporter (HTML report is produced)', () => {
    // The invocation must not pass a CLI reporter that suppresses the
    // playwright.config.ts reporter array (list + html).
    expect(runnerSource).not.toContain('--reporter=');
    // The invocation still targets a single project with the spec list.
    expect(runnerSource).toContain("['test', `--project=${project}`, ...extraArgs, ...rel]");
  });

  it('derives per-invocation artifact dirs under a configurable matrix root', () => {
    expect(runnerSource).toContain('PLAYWRIGHT_MATRIX_ROOT');
    expect(runnerSource).toContain("join('/tmp', 'trading-journal-playwright')");
    expect(runnerSource).toContain('join(ARTIFACT_ROOT, RUN_ID, project, groupName)');
  });

  it('keeps distinct artifact dirs for every partition', () => {
    expect(runnerSource).toContain("'shared'");
    for (const group of ['first-run-settings', 'backup-restore', 'account-defaults']) {
      expect(runnerSource).toContain(`name: '${group}'`);
    }
  });

  it('writes a durable matrix summary under the run artifact root', () => {
    expect(runnerSource).toContain('matrix-summary.json');
    expect(runnerSource).toContain('writeSummary(invocations, overallExitCode)');
    expect(runnerSource).toContain('process.exit(overallExitCode)');
  });

  it('points the CI upload at the same matrix root with no silent ignore', () => {
    expect(workflowSource).toContain('PLAYWRIGHT_MATRIX_ROOT: ${{ runner.temp }}/trading-journal-playwright');
    expect(workflowSource).toContain('path: ${{ runner.temp }}/trading-journal-playwright/');
    expect(workflowSource).toContain('if-no-files-found: error');
    expect(workflowSource).not.toContain('if-no-files-found: ignore');
  });

  it('keeps the upload step unconditional so failed runs retain evidence', () => {
    expect(workflowSource).toContain('if: always()');
    expect(workflowSource).toContain('name: playwright-matrix-${{ matrix.browser }}');
  });
});
