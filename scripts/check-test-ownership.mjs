#!/usr/bin/env node
/**
 * Test ownership guard (T01 / S08).
 *
 * Enforces the invariant that every test file under src/ and scripts/ is
 * registered with at least one runner:
 *   - vitest.config.ts            -> test.include[]
 *   - scripts/run-all-tests.ts    -> TSX_TESTS[]
 *
 * Reports two categories of drift:
 *   UNOWNED — a test file exists on disk but is registered in no runner,
 *             so no suite executes it (silent false confidence).
 *   MISSING — a path is registered but the file no longer exists on disk
 *             (stale registration after a move, rename, or deletion).
 *
 * Prints one line per drift entry prefixed with the category, then a summary
 * line `Unowned: N, Missing: M`. Exits 0 when both counts are 0 and 1
 * otherwise, so test ownership drift becomes a CI failure instead of silent
 * accumulation.
 *
 * Wired into `make test-all` via scripts/run-all-tests.ts.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const SCAN_DIRS = ['src', 'scripts'];

/** Test file extensions the scan owns. */
const TEST_EXT_RE = /\.test\.(ts|tsx|mjs)$/;
/** Registered-path shape filter (matches the plan's "path-shaped" rule). */
const PATH_SHAPED_RE = /^(src|scripts)\//;
const TEST_MARKER_RE = /\.test\./;

/**
 * Recursively collect all test files under a directory as repo-relative
 * forward-slash paths. Version-agnostic manual walk (readdirSync's
 * `recursive` option is only available on newer Node releases).
 */
function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return; // unreadable directory — skip
  }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(full, out);
    } else if (st.isFile() && TEST_EXT_RE.test(name)) {
      out.push(relative(ROOT, full).split(sep).join('/'));
    }
  }
}

/**
 * Extract path-shaped string literals from the first `[...]` array block
 * associated with `marker` in `source`.
 *
 * The scan is quote-aware and bracket-depth-aware so that `[id]` segments
 * inside string literals (e.g. `src/app/api/trades/[id]/__tests__/route.test.ts`)
 * do not truncate the block early, and the `string[]` type annotation before
 * `TSX_TESTS` is not mistaken for the array opening.
 */
function extractFromArray(source, marker) {
  const mIdx = source.indexOf(marker);
  if (mIdx === -1) return [];
  const lineEnd = source.indexOf('\n', mIdx);
  const line = source.slice(mIdx, lineEnd === -1 ? source.length : lineEnd);
  // Prefer the '[' after '=' (assignment) when the marker line has one
  // (e.g. `const TSX_TESTS: string[] = [`); otherwise use the marker itself
  // (e.g. `include: [`).
  const eqIdx = line.indexOf('=');
  const searchFrom = eqIdx === -1 ? mIdx : mIdx + eqIdx;
  const openIdx = source.indexOf('[', searchFrom);
  if (openIdx === -1) return [];

  let depth = 0;
  let quote = null;
  let closeIdx = -1;
  for (let i = openIdx; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') {
        i += 1; // skip escaped character inside string literal
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '[') {
      depth += 1;
    } else if (ch === ']') {
      depth -= 1;
      if (depth === 0) {
        closeIdx = i;
        break;
      }
    }
  }
  if (closeIdx === -1) return [];

  const block = source.slice(openIdx, closeIdx + 1);
  const paths = [];
  for (const m of block.matchAll(/['"]([^'"]+)['"]/g)) {
    const p = m[1];
    if (PATH_SHAPED_RE.test(p) && TEST_MARKER_RE.test(p)) {
      paths.push(p);
    }
  }
  return paths;
}

function main() {
  const diskFiles = [];
  for (const dir of SCAN_DIRS) {
    const abs = join(ROOT, dir);
    if (existsSync(abs)) walk(abs, diskFiles);
  }

  let registered = [];
  const vitestPath = join(ROOT, 'vitest.config.ts');
  const orchestratorPath = join(ROOT, 'scripts/run-all-tests.ts');
  try {
    registered = registered.concat(
      extractFromArray(readFileSync(vitestPath, 'utf-8'), 'include:'),
      extractFromArray(readFileSync(orchestratorPath, 'utf-8'), 'TSX_TESTS'),
    );
  } catch (e) {
    console.error(`[ownership] failed to read runner config: ${e.message}`);
    process.exit(1);
  }
  const registeredSet = new Set(registered);

  const unowned = diskFiles.filter((f) => !registeredSet.has(f)).sort();
  const missing = [...registeredSet].filter((f) => !diskFiles.includes(f)).sort();

  for (const f of unowned) {
    console.log(`UNOWNED ${f}`);
  }
  for (const f of missing) {
    console.log(`MISSING ${f}`);
  }
  console.log(`Unowned: ${unowned.length}, Missing: ${missing.length}`);

  process.exit(unowned.length === 0 && missing.length === 0 ? 0 : 1);
}

main();
