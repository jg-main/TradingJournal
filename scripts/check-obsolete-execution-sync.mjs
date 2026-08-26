#!/usr/bin/env node
/**
 * check-obsolete-execution-sync.mjs
 *
 * D6 permanent guard: the obsolete fail-open execution-sync path
 * (syncAndRebuildPositions / syncTradeExecution / positions/trade-execution-sync)
 * must NEVER return to production source. The canonical execution boundary is
 * executeTradeFill() — journal, accounting, FIFO, and performance mutations
 * commit atomically inside one transaction, and no alternate fail-open
 * journal→accounting sync path may remain available for reuse.
 *
 * Scans production source only (src/app, src/lib). Historical audit
 * documentation under docs/ is intentionally not scanned.
 *
 * Exit codes: 0 = clean (obsolete execution-sync references: 0), 1 = found.
 *
 * Pattern: scripts/check-root-test-artifacts.mjs, scripts/check-test-ownership.mjs
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const SCAN_DIRS = ['src/app', 'src/lib'];

// Forbidden executable references. Tokens are assembled from fragments so the
// guard never contains (and thus never scans) its own forbidden strings.
const FORBIDDEN = [
  'syncAnd' + 'Rebuild' + 'Positions',
  'sync' + 'Trade' + 'Execution',
  '/positions/trade-execution' + '-sync',
];

function collectFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      out.push(...collectFiles(full));
    } else if (/\.(ts|tsx|mjs|js)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const violations = [];

for (const scanDir of SCAN_DIRS) {
  for (const file of collectFiles(join(ROOT, scanDir))) {
    let content;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const token of FORBIDDEN) {
      if (content.includes(token)) {
        violations.push({ file, token });
      }
    }
  }
}

if (violations.length === 0) {
  console.log('obsolete execution-sync references: 0');
  process.exit(0);
}

console.error(`obsolete execution-sync references: ${violations.length}`);
for (const v of violations) {
  console.error(`  ${v.file} — contains "${v.token}"`);
}
process.exit(1);
