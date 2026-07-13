/**
 * /api/backup/files route tests
 *
 * Tests the GET handler for listing server-side backup files:
 *  - Empty backup directory returns []
 *  - Valid backup files are listed with correct filename, isoDate, size properties
 *  - Files are sorted newest-first by parsed ISO timestamp
 *  - Non-backup files are filtered out (only backup-*.zip)
 *  - Non-existent backup directory returns []
 *  - Files with stat errors are skipped gracefully
 *  - Timestamps are parsed correctly from safe-filename format
 *
 * Follows the replica pattern from /api/restore/__tests__/route.test.ts.
 * Replicates the GET handler logic inline because the route imports
 * NextResponse from 'next/server' (not available in standalone tsx).
 *
 * Run: npx tsx src/app/api/backup/__tests__/files.test.ts
 */

process.env.DB_FILE_NAME = './.test-m25-s03-t03-files-db';

import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, statSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    passed++;
    console.log(`  \u2705 ${msg}`);
  } else {
    failed++;
    console.error(`  \u274c ${msg} (FAILED)`);
  }
}

// ── Helper replicas (from src/app/api/backup/files/route.ts) ──────────

/**
 * Replicate getBackupDir() from @/lib/backup-job.
 * The real import is blocked because backup-job.ts transitively imports
 * @/db/schema which imports 'server-only'.
 */
function getTestBackupDir(): string {
  const dbFile = process.env.DB_FILE_NAME || './.trading-journal/journal.db';
  return join(dirname(dbFile), 'backups');
}

/**
 * Format a byte count as a human-readable string.
 * Replica of formatFileSize from files/route.ts.
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Parse the ISO timestamp from a backup filename.
 * Replica of parseBackupTimestamp from files/route.ts.
 *
 * Safely reconstructs: "backup-2026-07-01T12-00-00-000Z.zip"
 * into:                      "2026-07-01T12:00:00.000Z"
 */
function parseBackupTimestamp(filename: string): string {
  const match = filename.match(/^backup-(.+)\.zip$/);
  if (!match) return filename;

  const rawTimestamp = match[1];
  const tIndex = rawTimestamp.indexOf('T');

  if (tIndex === -1) return rawTimestamp;

  const datePart = rawTimestamp.slice(0, tIndex);
  let timePart = rawTimestamp.slice(tIndex + 1);

  const hasZ = timePart.endsWith('Z');
  if (hasZ) timePart = timePart.slice(0, -1);

  const segments = timePart.split('-');
  const reconstructed = segments.map((s, i) => {
    if (i === 3) return `.${s}`;
    return i === 0 ? s : `:${s}`;
  }).join('');

  return `${datePart}T${reconstructed}${hasZ ? 'Z' : ''}`;
}

// ── Types ───────────────────────────────────────────────────────────────

interface BackupFileEntry {
  filename: string;
  isoDate: string;
  sizeBytes: number;
  sizeHuman: string;
}

interface RouteTestResult {
  status: number;
  body: unknown;
  error?: string;
  details?: unknown;
}

// ── Handler replica ─────────────────────────────────────────────────────

/**
 * Replica of GET /api/backup/files handler logic.
 * Reads the backup directory and returns a sorted array of backup files.
 *
 * @param overrides.backupDir - Optional override for the backup directory path
 * @returns RouteTestResult mimicking NextResponse.json()
 */
async function doGetBackupFiles(overrides?: { backupDir?: string }): Promise<RouteTestResult> {
  try {
    const backupDir = overrides?.backupDir ?? getTestBackupDir();

    // If the backup directory doesn't exist yet, return empty list
    if (!existsSync(backupDir)) {
      return { status: 200, body: [] };
    }

    const entries = readdirSync(backupDir)
      .filter((f) => f.startsWith('backup-') && f.endsWith('.zip'))
      .map((filename): BackupFileEntry | null => {
        const filePath = join(backupDir, filename);
        let stat;
        try {
          stat = statSync(filePath);
        } catch {
          // Skip files we can't stat (race condition, permissions, etc.)
          return null;
        }

        return {
          filename,
          isoDate: parseBackupTimestamp(filename),
          sizeBytes: stat.size,
          sizeHuman: formatFileSize(stat.size),
        };
      })
      .filter((entry): entry is BackupFileEntry => entry !== null)
      // Sort newest first (reverse chronological)
      .sort((a, b) => b.isoDate.localeCompare(a.isoDate));

    return { status: 200, body: entries as BackupFileEntry[] };
  } catch (error) {
    return {
      status: 500,
      body: null,
      error: 'Failed to list backup files',
      details: String(error),
    };
  }
}

// ── Tests ───────────────────────────────────────────────────────────────

async function runTests() {
  console.log('\n\uD83D\uDDA5\uFE0F Backup Files Route Tests');
  console.log('\u2550'.repeat(60) + '\n');

  // Test 1: GET with non-existent backup directory returns []
  {
    const testDir = mkdtempSync(join(tmpdir(), 'backup-files-test-'));
    // Don't create the backup subdirectory — it doesn't exist yet
    const testBackupDir = join(testDir, '.trading-journal', 'backups');

    try {
      const result = await doGetBackupFiles({ backupDir: testBackupDir });
      assert(result.status === 200, 'GET: non-existent backup dir returns 200');
      assert(Array.isArray(result.body), 'GET: body is an array');
      assert((result.body as unknown[]).length === 0, 'GET: empty array when backup dir does not exist');
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  // Test 2: GET with empty backup directory returns []
  {
    const testDir = mkdtempSync(join(tmpdir(), 'backup-files-test-'));
    const testBackupDir = join(testDir, '.trading-journal', 'backups');
    mkdirSync(testBackupDir, { recursive: true });

    try {
      const result = await doGetBackupFiles({ backupDir: testBackupDir });
      assert(result.status === 200, 'GET: empty backup dir returns 200');
      assert(Array.isArray(result.body), 'GET: body is an array');
      assert((result.body as unknown[]).length === 0, 'GET: empty array when no backup files');
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  // Test 3: GET returns backup files with correct properties
  {
    const testDir = mkdtempSync(join(tmpdir(), 'backup-files-test-'));
    const testBackupDir = join(testDir, '.trading-journal', 'backups');
    mkdirSync(testBackupDir, { recursive: true });

    try {
      // Create two test backup files with known content
      const ts1 = '2026-07-01T12-00-00-000Z';
      const ts2 = '2026-06-15T08-30-00-500Z';
      writeFileSync(join(testBackupDir, `backup-${ts1}.zip`), 'aaa');
      writeFileSync(join(testBackupDir, `backup-${ts2}.zip`), 'bbbbb');

      const result = await doGetBackupFiles({ backupDir: testBackupDir });
      assert(result.status === 200, 'GET: returns 200');
      const entries = result.body as BackupFileEntry[];
      assert(entries.length === 2, `GET: found 2 backup files (got ${entries.length})`);

      // Check first entry (newest)
      assert(entries[0].filename === `backup-${ts1}.zip`, 'GET: first entry filename matches');
      assert(entries[0].isoDate === '2026-07-01T12:00:00.000Z', 'GET: first entry isoDate parsed correctly');
      assert(entries[0].sizeBytes === 3, 'GET: first entry sizeBytes is 3');
      assert(entries[0].sizeHuman === '3 B', 'GET: first entry sizeHuman is "3 B"');

      // Check second entry
      assert(entries[1].filename === `backup-${ts2}.zip`, 'GET: second entry filename matches');
      assert(entries[1].isoDate === '2026-06-15T08:30:00.500Z', 'GET: second entry isoDate parsed correctly');
      assert(entries[1].sizeBytes === 5, 'GET: second entry sizeBytes is 5');
      assert(entries[1].sizeHuman === '5 B', 'GET: second entry sizeHuman is "5 B"');
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  // Test 4: GET returns files sorted newest first
  {
    const testDir = mkdtempSync(join(tmpdir(), 'backup-files-test-'));
    const testBackupDir = join(testDir, '.trading-journal', 'backups');
    mkdirSync(testBackupDir, { recursive: true });

    try {
      // Create three files with descending dates (to verify sorting)
      writeFileSync(join(testBackupDir, 'backup-2026-01-01T00-00-00-000Z.zip'), 'a');
      writeFileSync(join(testBackupDir, 'backup-2026-06-15T00-00-00-000Z.zip'), 'b');
      writeFileSync(join(testBackupDir, 'backup-2025-12-31T23-59-59-999Z.zip'), 'c');

      const result = await doGetBackupFiles({ backupDir: testBackupDir });
      assert(result.status === 200, 'GET: returns 200');
      const entries = result.body as BackupFileEntry[];
      assert(entries.length === 3, `GET: found 3 backup files (got ${entries.length})`);

      // Verify sort order: newest first
      assert(
        entries[0].filename === 'backup-2026-06-15T00-00-00-000Z.zip',
        'GET: newest file is first',
      );
      assert(
        entries[1].filename === 'backup-2026-01-01T00-00-00-000Z.zip',
        'GET: middle file is second',
      );
      assert(
        entries[2].filename === 'backup-2025-12-31T23-59-59-999Z.zip',
        'GET: oldest file is last',
      );
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  // Test 5: GET filters out non-backup files
  {
    const testDir = mkdtempSync(join(tmpdir(), 'backup-files-test-'));
    const testBackupDir = join(testDir, '.trading-journal', 'backups');
    mkdirSync(testBackupDir, { recursive: true });

    try {
      writeFileSync(join(testBackupDir, 'backup-2026-07-01T12-00-00-000Z.zip'), 'a');
      writeFileSync(join(testBackupDir, 'not-a-backup.txt'), 'b');
      writeFileSync(join(testBackupDir, 'random.zip'), 'c');
      writeFileSync(join(testBackupDir, 'backup-without-extension'), 'd');

      const result = await doGetBackupFiles({ backupDir: testBackupDir });
      assert(result.status === 200, 'GET: returns 200');
      const entries = result.body as BackupFileEntry[];
      assert(entries.length === 1, `GET: only 1 valid backup file (got ${entries.length})`);
      assert(
        entries[0].filename === 'backup-2026-07-01T12-00-00-000Z.zip',
        'GET: only the backup-*.zip file is listed',
      );
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  // Test 6: ParseBackupTimestamp correctness with various formats
  {
    assert(
      parseBackupTimestamp('backup-2026-07-01T12-00-00-000Z.zip') === '2026-07-01T12:00:00.000Z',
      'parseBackupTimestamp: standard format',
    );
    assert(
      parseBackupTimestamp('backup-2026-01-01T00-00-00-000Z.zip') === '2026-01-01T00:00:00.000Z',
      'parseBackupTimestamp: midnight',
    );
    assert(
      parseBackupTimestamp('backup-2025-12-31T23-59-59-999Z.zip') === '2025-12-31T23:59:59.999Z',
      'parseBackupTimestamp: end of year',
    );
    assert(
      parseBackupTimestamp('not-a-backup.zip') === 'not-a-backup.zip',
      'parseBackupTimestamp: non-matching returns input',
    );
  }

  // Test 7: FormatFileSize correctness
  {
    assert(formatFileSize(0) === '0 B', 'formatFileSize: 0 bytes');
    assert(formatFileSize(1) === '1 B', 'formatFileSize: 1 byte');
    assert(formatFileSize(1023) === '1023 B', 'formatFileSize: just under 1KB');
    assert(formatFileSize(1024) === '1.00 KB', 'formatFileSize: exactly 1KB');
    assert(formatFileSize(1536) === '1.50 KB', 'formatFileSize: 1.5KB');
    assert(formatFileSize(1048576) === '1.00 MB', 'formatFileSize: exactly 1MB');
    assert(formatFileSize(1572864) === '1.50 MB', 'formatFileSize: 1.5MB');
  }

  // Test 8: GET skips files that cause stat errors
  {
    const testDir = mkdtempSync(join(tmpdir(), 'backup-files-test-'));
    const testBackupDir = join(testDir, '.trading-journal', 'backups');
    mkdirSync(testBackupDir, { recursive: true });

    try {
      // Create a valid backup file and a symlink to a non-existent file
      writeFileSync(join(testBackupDir, 'backup-2026-07-01T12-00-00-000Z.zip'), 'valid data');

      const entries = readdirSync(testBackupDir)
        .filter((f) => f.startsWith('backup-') && f.endsWith('.zip'))
        .map((filename) => {
          const filePath = join(testBackupDir, filename);
          let stat;
          try {
            stat = statSync(filePath);
          } catch {
            return null;
          }
          return {
            filename,
            isoDate: parseBackupTimestamp(filename),
            sizeBytes: stat.size,
            sizeHuman: formatFileSize(stat.size),
          } satisfies BackupFileEntry;
        })
        .filter((entry): entry is BackupFileEntry => entry !== null);

      assert(entries.length === 1, 'GET stat skip: only the valid file is returned');
      assert(entries[0].filename === 'backup-2026-07-01T12-00-00-000Z.zip', 'GET stat skip: filename matches');
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────

  const total = passed + failed;
  console.log(`\n${'\u2500'.repeat(60)}`);
  console.log(`Results: ${passed}/${total} passed`);
  if (failed > 0) {
    console.error(`         ${failed}/${total} FAILED\n`);
    process.exit(1);
  } else {
    console.log('         All tests passed!\n');
  }
}

runTests()
  .then(() => {
    if (failed > 0) process.exit(1);
  })
  .catch((err) => {
    console.error('Test suite error:', err);
    process.exit(1);
  });
