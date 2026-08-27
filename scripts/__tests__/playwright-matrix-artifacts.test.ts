// @vitest-environment node
/**
 * playwright-matrix-artifacts.test.ts
 *
 * Regression tests for the CI Playwright evidence-retention and routing
 * contracts:
 *
 *   - scripts/run-playwright-matrix.mjs — deterministic matrix runner
 *   - .github/workflows/quality-gate.yml — ordinary push/PR gate
 *   - .github/workflows/full-browser-qualification.yml — manual full-browser
 *     qualification (workflow_dispatch, exact-SHA resolution)
 *
 * Proves (statically, via source contract):
 *  Runner:
 *   - the runner does NOT pass a CLI reporter, so playwright.config.ts owns
 *     the reporter contract and HTML reports are actually produced;
 *   - each matrix partition receives a distinct artifact directory under a
 *     configurable matrix artifact root;
 *   - the runner writes a durable matrix-summary.json so failed invocations
 *     still leave retained evidence.
 *  Ordinary push/PR quality gate:
 *   - keeps the application gate and adds ONE blocking Chromium smoke;
 *   - smoke targets e2e/smoke.spec.ts with --project=chromium and disposable
 *     DB/artifact state;
 *   - the ordinary gate does NOT invoke run-playwright-matrix.mjs and creates
 *     no Firefox/WebKit full jobs;
 *   - smoke artifacts are retained unconditionally (if: always()) with
 *     if-no-files-found: error.
 *  Manual full-browser qualification:
 *   - is workflow_dispatch with a `ref` input;
 *   - resolves the ref to a full SHA exactly once and every downstream job
 *     checks out that resolved SHA;
 *   - runs the application gate plus full Chromium and Firefox matrices;
 *   - WebKit is not a mandatory qualification browser;
 *   - preserves the matrix artifact-retention contract (same root, uploads
 *     with if: always() and if-no-files-found: error, browser-specific names).
 *
 * Run: npx vitest run scripts/__tests__/playwright-matrix-artifacts.test.ts
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const runnerSource = readFileSync(join(ROOT, 'scripts/run-playwright-matrix.mjs'), 'utf-8');
const qualityGateSource = readFileSync(join(ROOT, '.github/workflows/quality-gate.yml'), 'utf-8');
const qualificationSource = readFileSync(
  join(ROOT, '.github/workflows/full-browser-qualification.yml'),
  'utf-8',
);

describe('playwright matrix runner contract', () => {
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
});

describe('ordinary push/PR quality gate routing', () => {
  it('keeps the application gate', () => {
    for (const step of ['make lint', 'make typecheck', 'make build', 'make test-all']) {
      expect(qualityGateSource).toContain(step);
    }
  });

  it('runs a blocking Chromium smoke targeting e2e/smoke.spec.ts only', () => {
    expect(qualityGateSource).toContain('npx playwright test e2e/smoke.spec.ts --project=chromium');
    expect(qualityGateSource).toContain('playwright install --with-deps chromium');
    // The smoke is blocking: no continue-on-error.
    expect(qualityGateSource).not.toContain('continue-on-error');
  });

  it('does not invoke the full matrix runner or create Firefox/WebKit full jobs', () => {
    expect(qualityGateSource).not.toContain('run-playwright-matrix.mjs');
    expect(qualityGateSource).not.toContain('--project=firefox');
    expect(qualityGateSource).not.toContain('--project=webkit');
    expect(qualityGateSource).not.toContain('browser: [chromium, firefox, webkit]');
  });

  it('uses disposable smoke state and retains smoke artifacts', () => {
    expect(qualityGateSource).toContain('trading-journal-playwright-smoke');
    expect(qualityGateSource).toContain('DB_FILE_NAME');
    expect(qualityGateSource).toContain('PLAYWRIGHT_ARTIFACT_DIR');
    expect(qualityGateSource).toContain('if: always()');
    expect(qualityGateSource).toContain('if-no-files-found: error');
    expect(qualityGateSource).not.toContain('if-no-files-found: ignore');
    expect(qualityGateSource).toContain('playwright-smoke-chromium');
  });
});

describe('manual full-browser qualification routing', () => {
  it('is workflow_dispatch with a ref input', () => {
    expect(qualificationSource).toContain('workflow_dispatch');
    expect(qualificationSource).toContain('ref:');
    expect(qualificationSource).toContain('default: main');
  });

  it('resolves the ref to a full SHA exactly once', () => {
    expect(qualificationSource).toContain('git rev-parse HEAD');
    expect(qualificationSource).toContain('outputs.sha');
  });

  it('has every qualification job checkout the resolved immutable SHA', () => {
    // Application and both browser jobs must all reference the single resolved
    // SHA from the resolve job — never re-resolve `main` independently.
    const occurrences = qualificationSource.split('ref: ${{ needs.resolve.outputs.sha }}').length - 1;
    expect(occurrences).toBe(3); // application + chromium + firefox
  });

  it('runs the application gate on the resolved SHA', () => {
    for (const step of ['make lint', 'make typecheck', 'make build', 'make test-all']) {
      expect(qualificationSource).toContain(step);
    }
  });

  it('waits for the application gate before launching browser matrices', () => {
    // Both browser jobs depend on resolve (for the SHA) AND application.
    const occurrences = qualificationSource.split('needs: [resolve, application]').length - 1;
    expect(occurrences).toBe(2); // chromium + firefox
  });

  it('runs full Chromium and Firefox matrices, and no mandatory WebKit', () => {
    expect(qualificationSource).toContain('run-playwright-matrix.mjs --project=chromium');
    expect(qualificationSource).toContain('run-playwright-matrix.mjs --project=firefox');
    expect(qualificationSource).not.toContain('--project=webkit');
    expect(qualificationSource).not.toContain('browser: [chromium, firefox, webkit]');
  });

  it('preserves the full-matrix artifact-retention contract', () => {
    expect(qualificationSource).toContain('PLAYWRIGHT_MATRIX_ROOT: ${{ runner.temp }}/trading-journal-playwright');
    expect(qualificationSource).toContain('path: ${{ runner.temp }}/trading-journal-playwright/');
    expect(qualificationSource).toContain('if-no-files-found: error');
    expect(qualificationSource).not.toContain('if-no-files-found: ignore');
    expect(qualificationSource).toContain('if: always()');
    expect(qualificationSource).toContain('playwright-matrix-chromium');
    expect(qualificationSource).toContain('playwright-matrix-firefox');
  });
});
