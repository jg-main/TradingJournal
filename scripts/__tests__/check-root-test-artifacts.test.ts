/**
 * Direct regression tests for the root test-artifact hygiene guard (H1).
 *
 * Proves `scripts/check-root-test-artifacts.mjs` recognizes BOTH legitimate
 * test-artifact naming families:
 *
 *   .test-<name>.db        (+ -wal / -shm / -journal)
 *   .test-<name>-db        (+ -wal / -shm / -journal)
 *
 * and never matches the real application database, backups, or ordinary
 * source files. The exact two filenames observed in the wild
 * (`.test-m05-s03-db`, `.test-m06-s01-t02-db`) are asserted as detected.
 *
 * The execution check runs in an isolated OS-temp directory so testing the
 * matcher never pollutes the real repository root.
 *
 * Run: npx vitest run "scripts/__tests__/check-root-test-artifacts.test.ts"
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isForbiddenRootTestArtifact,
  findForbiddenRootTestArtifacts,
} from '../check-root-test-artifacts.mjs';

const POSITIVE = [
  // Dot form
  '.test-example.db',
  '.test-example.db-wal',
  '.test-example.db-shm',
  '.test-example.db-journal',
  // Hyphen form
  '.test-m05-s03-db',
  '.test-m05-s03-db-wal',
  '.test-m05-s03-db-shm',
  '.test-m05-s03-db-journal',
  // Exact observed artifacts
  '.test-m06-s01-t02-db',
];

const NEGATIVE = [
  'journal.db',
  '.trading-journal',
  '.trading-journal/journal.db',
  'package.json',
  'vitest.config.ts',
  'src/app/page.tsx',
  '.test',
  'test.db',
  'test-m05-s03-db',
  'foo.test.db',
  '.test-backup',
  '.test-example.db.bak',
  '.next',
];

describe('isForbiddenRootTestArtifact', () => {
  it('detects every dot-form and hyphen-form test artifact name', () => {
    for (const name of POSITIVE) {
      expect(isForbiddenRootTestArtifact(name), `should detect ${name}`).toBe(true);
    }
  });

  it('detects the exact two observed filenames', () => {
    expect(isForbiddenRootTestArtifact('.test-m05-s03-db')).toBe(true);
    expect(isForbiddenRootTestArtifact('.test-m06-s01-t02-db')).toBe(true);
  });

  it('never matches the real application DB, source files, or non-test names', () => {
    for (const name of NEGATIVE) {
      expect(isForbiddenRootTestArtifact(name), `should NOT detect ${name}`).toBe(false);
    }
  });
});

describe('findForbiddenRootTestArtifacts (isolated temp dir)', () => {
  it('lists both naming families from a directory and ignores safe files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tradingjournal-hygiene-test-'));
    try {
      for (const name of [
        '.test-example.db',
        '.test-example.db-wal',
        '.test-m05-s03-db',
        '.test-m06-s01-t02-db',
        'journal.db',
        'package.json',
        'src',
      ]) {
        writeFileSync(join(dir, name), 'x');
      }
      const found = findForbiddenRootTestArtifacts(dir).sort();
      expect(found).toEqual(['.test-example.db', '.test-example.db-wal', '.test-m05-s03-db', '.test-m06-s01-t02-db'].sort());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
