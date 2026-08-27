#!/usr/bin/env node
/**
 * run-playwright-matrix.mjs
 *
 * Deterministic full-matrix E2E runner (M007 closure-blocker correction).
 *
 * Defect addressed: one long-lived Playwright invocation shared a single
 * mutable SQLite DB across the entire stateful E2E suite. State-destructive
 * specs (backup/restore that REPLACES the DB, Danger-Zone resets that WIPE
 * tables, first-run readiness that depends on a fresh DB, default-account
 * global mutations) contaminated later specs, so the milestone matrix did not
 * provide deterministic independent acceptance evidence.
 *
 * Contract:
 *   - For one browser project, the shared-safe E2E specs run in ONE normal
 *     Playwright invocation.
 *   - Each isolated group (state-destructive/global-state) runs in its OWN
 *     invocation with its own DB_FILE_NAME, PLAYWRIGHT_PORT, and
 *     PLAYWRIGHT_ARTIFACT_DIR — therefore its own app server, SQLite DB,
 *     backup directory, and generated artifacts.
 *   - No invocation reuses another invocation's database.
 *   - Groups run sequentially (never several Next dev servers concurrently);
 *     Playwright workers stay at the config default (1).
 *   - Coverage parity: every e2e/*.spec.ts file belongs to exactly one
 *     partition (shared or one isolated group) — no test runs twice, none
 *     is lost.
 *   - The reporter contract lives in playwright.config.ts (list + HTML).
 *     The runner does NOT pass a CLI reporter, so each invocation writes its
 *     HTML report under `<artifactDir>/playwright-report/` and its test
 *     results under `<artifactDir>/test-results/` while the console stays
 *     readable through the configured `list` reporter.
 *   - A durable `matrix-summary.json` is written under the run artifact root
 *     after all invocations (regardless of failures) so CI always has
 *     retained evidence of the attempt even if a browser invocation fails
 *     before Playwright produces report/test-results content.
 *   - The matrix artifact root is `PLAYWRIGHT_MATRIX_ROOT` when set (CI sets
 *     it to `${{ runner.temp }}/trading-journal-playwright`), otherwise
 *     `/tmp/trading-journal-playwright`.
 *
 * Usage:
 *   node scripts/run-playwright-matrix.mjs --project=chromium
 *   node scripts/run-playwright-matrix.mjs --project=firefox
 *   node scripts/run-playwright-matrix.mjs --project=webkit
 *
 * The runner owns orchestration only; it implements no product behavior.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cwd, env as processEnv } from 'node:process';

const ROOT = cwd();
const E2E_DIR = join(ROOT, 'e2e');
const PLAYWRIGHT_BIN = join(ROOT, 'node_modules', '.bin', 'playwright');

/**
 * Isolated groups: state-destructive / global-state specs that must run in
 * their own disposable DB + server so they cannot contaminate (or be
 * contaminated by) the shared suite.
 *
 * Rationale per file:
 *  - m011-first-run-readiness.spec.ts  — wipes core tables to simulate a
 *    fresh first-run DB; depends on no prior accounts/settings existing.
 *  - settings.spec.ts                  — Danger-Zone reset wipes tables;
 *    Restore flow REPLACES the DB via POST /api/restore; Backup download
 *    reads/writes the backup store.
 *  - accounting-correction-backup.spec.ts — executes a FULL restore; the
 *    shared-DB open-trade guard previously forced a harness-only skip.
 *  - backup-restore-browse.spec.ts     — backup/restore browse workflows.
 *  - backup-upload-confirm.spec.ts     — backup upload → restore confirm.
 *  - backup-settings.spec.ts           — backup settings global mutation.
 *  - account-defaults.spec.ts          — default-account global mutation
 *    (activate/inherit/reset defaults that later specs assume baseline).
 */
const ISOLATED_GROUPS = [
  {
    name: 'first-run-settings',
    files: ['e2e/m011-first-run-readiness.spec.ts', 'e2e/settings.spec.ts'],
  },
  {
    name: 'backup-restore',
    files: [
      'e2e/accounting-correction-backup.spec.ts',
      'e2e/backup-restore-browse.spec.ts',
      'e2e/backup-upload-confirm.spec.ts',
      'e2e/backup-settings.spec.ts',
    ],
  },
  {
    name: 'account-defaults',
    files: ['e2e/account-defaults.spec.ts'],
  },
];

// ── CLI ─────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const project = argv.find((a) => a.startsWith('--project='))?.split('=')[1];
  if (!project) {
    console.error('usage: node scripts/run-playwright-matrix.mjs --project=<chromium|firefox|webkit>');
    process.exit(2);
  }
  return { project };
}

// ── Discovery / partitioning ────────────────────────────────────────────

function discoverSpecFiles() {
  return readdirSync(E2E_DIR)
    .filter((f) => f.endsWith('.spec.ts'))
    .sort();
}

/**
 * Assign every spec file to exactly one partition.
 * Returns { shared: string[], groups: [{name, files: string[]}], errors: [] }
 */
function partition(allFiles) {
  // Normalize manifest entries to bare filenames (discovery returns names
  // without the e2e/ prefix).
  const isolatedFileToGroup = new Map();
  for (const g of ISOLATED_GROUPS) {
    for (const raw of g.files) {
      const f = raw.replace(/^e2e\//, '');
      if (!allFiles.includes(f)) {
        throw new Error(`isolated group "${g.name}" references missing spec "${f}"`);
      }
      if (isolatedFileToGroup.has(f)) {
        throw new Error(`spec "${f}" assigned to multiple isolated groups`);
      }
      isolatedFileToGroup.set(f, g.name);
    }
  }
  const shared = allFiles.filter((f) => !isolatedFileToGroup.has(f));
  const groups = ISOLATED_GROUPS.map((g) => ({
    name: g.name,
    files: g.files.map((raw) => raw.replace(/^e2e\//, '')).filter((f) => isolatedFileToGroup.get(f) === g.name),
  }));
  return { shared, groups };
}

// ── Invocation helpers ──────────────────────────────────────────────────

const RUN_ID = `matrix-${Date.now()}`;
// Run-unique base port: Next dev uses a per-repository lock, so even if a
// leftover server from a prior matrix run lingers, this run's ports will not
// collide with it (and the orphan cleanup below removes it anyway).
const BASE_PORT = 31_800 + (Date.now() % 800) * 2;

/**
 * Matrix artifact root. CI sets PLAYWRIGHT_MATRIX_ROOT to
 * `${{ runner.temp }}/trading-journal-playwright` so the workflow upload step
 * and the runner agree on one tree; local runs keep the historical
 * /tmp/trading-journal-playwright location.
 */
const ARTIFACT_ROOT = processEnv.PLAYWRIGHT_MATRIX_ROOT || join('/tmp', 'trading-journal-playwright');

/**
 * Kill orphaned repo dev-server/test processes from prior interrupted runs.
 *
 * Next dev can only run ONE instance per working directory (its lock under
 * .next/dev). A leftover `next dev` from a killed matrix run would make every
 * subsequent invocation fail with "Another next dev server is already
 * running" regardless of port. The matrix runner therefore claims the host
 * for the run and removes those orphans up front.
 */
function cleanOrphans() {
  for (const pattern of ['next dev --webpack', 'playwright test']) {
    try {
      execFileSync('pkill', ['-f', pattern], { stdio: 'ignore' });
    } catch {
      // no match — fine
    }
  }
  // Give killed processes a moment to release ports / the Next lock.
  const wait = new Date().getTime() + 3_000;
  while (new Date().getTime() < wait) {
    /* spin briefly */
  }
}

function makeEnv(project, groupName, index) {
  const dir = join(ARTIFACT_ROOT, RUN_ID, project, groupName);
  mkdirSync(dir, { recursive: true });
  return {
    ...processEnv,
    DB_FILE_NAME: join(dir, 'journal.db'),
    PLAYWRIGHT_PORT: String(BASE_PORT + index * 2),
    PLAYWRIGHT_ARTIFACT_DIR: dir,
  };
}

/**
 * Run one Playwright invocation. `specFiles` restricts the run to the given
 * files (absolute or e2e-relative paths). Returns { exitCode, label }.
 */
function runInvocation(project, label, specFiles, env, extraArgs = []) {
  const rel = specFiles.map((f) => join(ROOT, 'e2e', f));
  // No CLI reporter: playwright.config.ts owns the reporter contract (list +
  // HTML), so each invocation writes its HTML report and test-results under
  // the PLAYWRIGHT_ARTIFACT_DIR while the console stays readable via `list`.
  const args = ['test', `--project=${project}`, ...extraArgs, ...rel];
  console.log(`\n═══ [${label}] ${project} — ${rel.length} spec file(s) ═══`);
  console.log(`    DB: ${env.DB_FILE_NAME}`);
  console.log(`    PORT: ${env.PLAYWRIGHT_PORT}`);
  console.log(`    ARTIFACTS: ${env.PLAYWRIGHT_ARTIFACT_DIR}`);
  const res = spawnSync(PLAYWRIGHT_BIN, args, {
    cwd: ROOT,
    env,
    stdio: 'inherit',
    timeout: 3_600_000,
  });
  return { exitCode: res.status, label };
}

/**
 * Write a durable machine-readable matrix summary under the run artifact root.
 * Written after ALL invocations, regardless of pass/fail, so a failed browser
 * invocation still leaves retained evidence in the uploaded artifact tree.
 */
function writeSummary(invocations, overallExitCode) {
  const summary = {
    runId: RUN_ID,
    project,
    artifactRoot: ARTIFACT_ROOT,
    timestamp: new Date().toISOString(),
    overallExitCode,
    invocations: invocations.map((i) => ({
      label: i.label,
      specCount: i.specCount,
      exitCode: i.exitCode,
      artifactDir: i.artifactDir,
      db: i.db,
      port: i.port,
    })),
  };
  const summaryPath = join(ARTIFACT_ROOT, RUN_ID, 'matrix-summary.json');
  try {
    mkdirSync(join(ARTIFACT_ROOT, RUN_ID), { recursive: true });
    writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
    console.log(`[matrix] summary written to ${summaryPath}`);
  } catch (e) {
    console.error(`[matrix] could not write matrix summary: ${e.message}`);
  }
}

// ── Coverage parity ─────────────────────────────────────────────────────

function verifyParity(allFiles, shared, groups) {
  const assigned = new Set([...shared, ...groups.flatMap((g) => g.files)]);
  const missing = allFiles.filter((f) => !assigned.has(f));
  const duplicates = allFiles.length - assigned.size;
  return { missing, duplicates };
}

// ── Main ────────────────────────────────────────────────────────────────

const { project } = parseArgs(process.argv.slice(2));

// Remove orphaned Next dev / playwright processes from prior interrupted runs
// BEFORE any invocation (Next dev holds a per-directory lock).
cleanOrphans();

const allFiles = discoverSpecFiles();
const { shared, groups } = partition(allFiles);
const { missing, duplicates } = verifyParity(allFiles, shared, groups);

console.log(`[matrix] project=${project} runId=${RUN_ID}`);
console.log(`[matrix] total spec files: ${allFiles.length}`);
console.log(`[matrix] shared-safe: ${shared.length} file(s)`);
for (const g of groups) {
  console.log(`[matrix] isolated group "${g.name}": ${g.files.length} file(s)`);
}

if (missing.length > 0) {
  console.error(`[matrix] COVERAGE GAP — specs assigned to no partition: ${missing.join(', ')}`);
  process.exit(1);
}
if (duplicates !== 0) {
  console.error(`[matrix] COVERAGE GAP — ${duplicates} spec(s) assigned to multiple partitions`);
  process.exit(1);
}

let failures = 0;
let index = 0;
const invocations = [];

// A. shared-safe suite in one invocation (own DB/port/artifacts).
{
  const env = makeEnv(project, 'shared', index++);
  const r = runInvocation(project, 'shared', shared, env);
  invocations.push({
    label: 'shared',
    specCount: shared.length,
    exitCode: r.exitCode,
    artifactDir: env.PLAYWRIGHT_ARTIFACT_DIR,
    db: env.DB_FILE_NAME,
    port: env.PLAYWRIGHT_PORT,
  });
  if (r.exitCode !== 0) failures++;
}

// B. each isolated group in its own invocation.
for (const g of groups) {
  const env = makeEnv(project, g.name, index++);
  const r = runInvocation(project, g.name, g.files, env);
  invocations.push({
    label: g.name,
    specCount: g.files.length,
    exitCode: r.exitCode,
    artifactDir: env.PLAYWRIGHT_ARTIFACT_DIR,
    db: env.DB_FILE_NAME,
    port: env.PLAYWRIGHT_PORT,
  });
  if (r.exitCode !== 0) failures++;
}

const overallExitCode = failures === 0 ? 0 : 1;

// Durable evidence: written after every invocation, including failures, so
// the CI upload always has something to retain even if a browser invocation
// failed before Playwright produced report/test-results content.
writeSummary(invocations, overallExitCode);

console.log(`\n════════════════════════════════════════════════════════════`);
console.log(`[matrix] ${project}: ${failures === 0 ? 'ALL INVOCATIONS PASSED' : `${failures} INVOCATION(S) FAILED`}`);
console.log(`[matrix] runId=${RUN_ID} (artifacts under ${ARTIFACT_ROOT}/${RUN_ID})`);
console.log(`════════════════════════════════════════════════════════════`);
process.exit(overallExitCode);
