#!/usr/bin/env node
/**
 * Root test-artifact hygiene guard (H1).
 *
 * Scans ONLY the repository root for known classes of forbidden ephemeral
 * test artifacts. Fails with a clear list when any are found.
 *
 * Two legitimate test-artifact naming families are recognized (both are
 * produced by committed legacy/standalone SQLite test harnesses):
 *
 *   dot form    .test-<name>.db         .test-<name>.db-wal / -shm / -journal
 *   hyphen form .test-<name>-db         .test-<name>-db-wal / -shm / -journal
 *
 * Examples the guard detects:
 *   .test-example.db            .test-example.db-wal       .test-example.db-shm
 *   .test-example.db-journal    .test-m05-s03-db           .test-m06-s01-t02-db
 *   .test-m05-s03-db-wal        .test-m05-s03-db-shm       .test-m05-s03-db-journal
 *
 * The scan is intentionally NON-recursive (root only) and pattern-scoped so
 * it can never match the real application database
 * (./.trading-journal/journal.db), backups, migrations, or fixtures.
 *
 * Wired into `make test-all` (via scripts/run-all-tests.ts) so every full
 * suite run enforces the invariant: tests must not create disposable DBs in
 * the repository root. The predicate is exported so the guard's matcher has
 * direct regression coverage (scripts/__tests__/check-root-test-artifacts.test.ts).
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Root-only, test-artifact-scoped filename predicate for both naming
 * families (see module doc). `.trading-journal` and ordinary source files
 * never match.
 *
 * @param {string} name - single directory-entry filename (not a path)
 * @returns {boolean} true when the name is a forbidden root test artifact
 */
export function isForbiddenRootTestArtifact(name) {
  return /^\.test-.+(\.db|-db)(-wal|-shm|-journal)?$/.test(name);
}

/** Scan a directory's top level for forbidden test artifacts. */
export function findForbiddenRootTestArtifacts(root) {
  let entries = [];
  try {
    entries = readdirSync(root);
  } catch {
    // Root unreadable — fail closed.
    return ['<root unreadable>'];
  }
  return entries.filter((name) => isForbiddenRootTestArtifact(name));
}

// ── CLI ─────────────────────────────────────────────────────────────────

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const ROOT = process.cwd();
  const found = findForbiddenRootTestArtifacts(ROOT);
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
}
