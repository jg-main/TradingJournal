/**
 * account-transactions-writer-guard.test.ts
 *
 * Static guard: prevents a future agent from re-introducing a direct insert
 * into `account_transactions` outside the canonical paths.
 *
 * Context: POST /api/accounts/:id/transactions was the obsolete cash-mutation
 * writer that bypassed the accounting kernel (postFinancialEvent). It is
 * retired (410 Gone) as of S05; all cash activity must flow through
 * POST /api/accounts/:id/financial-events. This test scans every non-test
 * source file under src/ and fails if any file performs a direct Drizzle
 * `insert(accountTransactions)` or raw `INSERT INTO account_transactions`.
 *
 * When this test fails after adding a writer:
 *   1. Re-route the write through the canonical accounting kernel
 *      (src/lib/accounting/event-posting.ts / POST financial-events).
 *   2. If the write is a legitimate generic path (e.g. bulk DB restore with
 *      dynamic table names), add the file to ALLOW_LIST below with a comment
 *      explaining why it is exempt.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { resolve, join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
);
const SRC_DIR = join(REPO_ROOT, 'src');

/**
 * Files legitimately allowed to touch account_transactions writes.
 * Keyed by src-relative path (the same form the scanner compares).
 */
const ALLOW_LIST = new Set([
  // Generic DB restore: builds `INSERT INTO "<tableName>"` with a dynamic
  // table name for every table in the registry, so its raw-SQL insert is
  // not a targeted writer of account_transactions.
  'lib/restore.ts',
  // Table definition (sqliteTable('account_transactions', ...)).
  'db/schema.ts',
]);

/** Forbidden write patterns (all matched case-insensitively). */
const FORBIDDEN_PATTERNS: RegExp[] = [
  // Drizzle: db.insert(accountTransactions).values(...)
  /insert\(\s*accountTransactions\s*\)/i,
  // Drizzle: db.insert(schema.accountTransactions).values(...)
  /insert\(\s*schema\.accountTransactions\s*\)/i,
  // Raw SQL (matches INSERT INTO account_transactions ...).
  /\bINSERT INTO account_transactions\b/i,
];

/** True for test/spec files and anything under __tests__/ or __fixtures__/. */
function isTestOrFixturePath(relPath: string): boolean {
  return (
    /\.(test|spec)\.(ts|tsx)$/.test(relPath) ||
    relPath.includes('/__tests__/') ||
    relPath.includes('/__fixtures__/')
  );
}

/** Recursively collect all .ts/.tsx files under dir (relative to SRC_DIR). */
function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(full, out);
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe('account_transactions writer guard', () => {
  const scannedFiles = collectSourceFiles(SRC_DIR)
    .filter((file) => !isTestOrFixturePath(relative(SRC_DIR, file)))
    .filter((file) => !ALLOW_LIST.has(relative(SRC_DIR, file)));

  it('scans a meaningful set of non-test source files (self-test)', () => {
    // A guard that scans nothing is worthless — this pins the walker to a
    // healthy corpus so a broken root/exclusion silently fails the test.
    expect(scannedFiles.length).toBeGreaterThan(300);
  });

  it('finds no unauthorized account_transactions writers', () => {
    const offenders: string[] = [];
    for (const file of scannedFiles) {
      const src = readFileSync(file, 'utf-8');
      if (FORBIDDEN_PATTERNS.some((pattern) => pattern.test(src))) {
        offenders.push(relative(SRC_DIR, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('excludes known test-only writers (guard does not mask real code)', () => {
    // These test files intentionally seed account_transactions rows. They
    // must be classified as test paths so the guard skips them instead of
    // flagging fixture seeding as a production writer.
    const knownTestWriters = [
      'src/app/api/reset/__tests__/route.test.ts',
      'src/app/api/accounts/[id]/migration/__tests__/route.test.ts',
      'src/app/api/accounts/[id]/transactions/__tests__/route.test.ts',
      'src/lib/accounting/legacy-migration-runner.test.ts',
    ];
    for (const rel of knownTestWriters) {
      expect(isTestOrFixturePath(rel), `${rel} should be treated as test`).toBe(
        true,
      );
    }
  });

  it('allow-listed files exist and are excluded from the scan', () => {
    for (const rel of ALLOW_LIST) {
      const abs = join(SRC_DIR, rel);
      expect(
        readFileSync(abs, 'utf-8').length,
        `${rel} should exist`,
      ).toBeGreaterThan(0);
      expect(scannedFiles, `${rel} should be allow-listed`).not.toContain(abs);
    }
  });

  it('pattern matcher catches violations and ignores benign lookalikes', () => {
    const catches = (sample: string) =>
      FORBIDDEN_PATTERNS.some((pattern) => pattern.test(sample));

    // Every forbidden write form must be detected.
    expect(catches('db.insert(accountTransactions).values(x)')).toBe(true);
    expect(catches('db.insert(schema.accountTransactions).values(x)')).toBe(
      true,
    );
    expect(catches('INSERT INTO account_transactions (id) VALUES (1)')).toBe(
      true,
    );
    expect(catches('insert into account_transactions (id) values (1)')).toBe(
      true,
    );

    // Benign lookalikes must NOT trip the guard.
    expect(catches('db.insert(accountTransactionsRow).values(x)')).toBe(false);
    expect(catches('INSERT INTO account_transactions_backup (id)')).toBe(
      false,
    );
    expect(catches('select * from account_transactions')).toBe(false);
    expect(catches('db.select().from(accountTransactions)')).toBe(false);
  });
});
