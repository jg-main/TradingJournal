#!/usr/bin/env node
/**
 * Root test-artifact hygiene guard (H1).
 *
 * Scans ONLY the repository root for known classes of forbidden ephemeral
 * test artifacts. Fails with a clear list when any are found.
 *
 * Forbidden patterns (confirmed by the H1 inventory of test producers):
 *   .test-*.db
 *   .test-*.db-wal
 *   .test-*.db-shm
 *
 * The scan is intentionally NON-recursive (root only) and pattern-scoped so
 * it can never match the real application database
 * (./.trading-journal/journal.db), backups, migrations, or fixtures.
 *
 * Wired into `make test-all` (via scripts/run-all-tests.ts) so every full
 * suite run enforces the invariant: tests must not create disposable DBs in
 * the repository root.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

const FORBIDDEN_PATTERNS = [/^\.test-.+\.db$/, /^\.test-.+\.db-wal$/, /^\.test-.+\.db-shm$/];

function findForbidden() {
  let entries = [];
  try {
    entries = readdirSync(ROOT);
  } catch {
    // Root unreadable — fail closed.
    return ['<root unreadable>'];
  }
  return entries.filter((name) => FORBIDDEN_PATTERNS.some((re) => re.test(name)));
}

const found = findForbidden();
if (found.length > 0) {
  console.error('[hygiene] Forbidden root-level test artifacts detected:');
  for (const name of found) {
    console.error(`  - ${join(ROOT, name)}`);
  }
  console.error(
    '[hygiene] Tests must not create disposable databases in the repository root. ' +
      'Use the shared temp-DB helper (src/lib/testing/test-db.ts) or the OS temp directory, ' +
      'and remove the stale artifacts above.',
  );
  process.exit(1);
}

console.log('[hygiene] root test-artifact scan: clean');
