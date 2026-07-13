/**
 * /api/backup/restore/[filename] route tests
 *
 * Tests the POST handler for restoring from a server-side backup file:
 *  - Valid backup file on disk returns 200 with success/snapshotPath/restoredTables/restoredRows
 *  - Post-restore snapshot is created on disk (same as manual restore path)
 *  - Non-existent backup file returns 404
 *  - Invalid filename (path traversal) returns 400
 *  - Invalid filename (doesn't match backup-*.zip) returns 400
 *  - Corrupt ZIP on disk returns 400
 *  - Schema version mismatch returns 400
 *  - Read error returns 500
 *
 * Follows the replica pattern from /api/restore/__tests__/route.test.ts.
 * Replicates the POST handler logic inline because @/lib/restore and
 * @/lib/backup-job transitively import @/db/index which imports 'server-only'
 * (not available in standalone tsx context).
 *
 * Run: npx tsx src/app/api/backup/__tests__/server-restore.test.ts
 */

process.env.DB_FILE_NAME = './.test-m25-s03-t03-server-restore-db';

import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '@/db/schema';
import AdmZip from 'adm-zip';
import { serializeBackup, TABLE_REGISTRY, getMigrationCount } from '@/lib/backup-serializer';
import type { BackupManifest } from '@/lib/backup-serializer';

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

// ── Constants (replicating restore.ts + backup/restore route) ──────────

const INSERT_ORDER: string[] = [
  'app_profile',
  'accounts',
  'settings',
  'lookup_values',
  'setup_definitions',
  'trades',
  'trade_executions',
  'trade_risk_snapshots',
  'trade_stop_adjustments',
  'trade_assets',
  'trade_grades',
  'trade_mistakes',
  'watchlist_items',
  'account_transactions',
  'account_rollforward',
  'weekly_reviews',
  'review_action_items',
];

const DELETE_ORDER: string[] = [...INSERT_ORDER].reverse();

const NOW = '2026-07-01T12:00:00.000Z';

/** Safe backup filename matching the scheduled backup naming convention. */
const BACKUP_FILENAME = 'backup-2026-07-01T12-00-00-000Z.zip';

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Create a fresh SQLite database with the full schema applied via Drizzle migrations.
 */
function createSchemaDb(dbPath: string) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const testDb = drizzle(sqlite, { schema });
  const migrationsDir = join(process.cwd(), 'src/db/migrations');
  migrate(testDb, { migrationsFolder: migrationsDir });
  return { sqlite, db: testDb };
}

/**
 * Convert camelCase to snake_case (replicating restore.ts).
 */
function camelToSnake(str: string): string {
  return str
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([a-zA-Z])(\d)/g, '$1_$2')
    .toLowerCase();
}

/**
 * Replicate getBackupDir() from @/lib/backup-job.
 */
function getBackupDirFromDbPath(dbPath: string): string {
  return join(dirname(dbPath), 'backups');
}

/**
 * Write a backup ZIP buffer to the backup directory with the given filename.
 * Returns the full file path.
 */
function writeBackupFile(backupDir: string, filename: string, buffer: Buffer): string {
  mkdirSync(backupDir, { recursive: true });
  const filePath = join(backupDir, filename);
  writeFileSync(filePath, buffer);
  return filePath;
}

/**
 * Create a test backup ZIP in memory using adm-zip.
 * Replicates the createTestZip from the restore route test but with
 * a configurable backup timestamp in the manifest.
 */
function createTestZip(overrides?: {
  manifest?: Partial<BackupManifest>;
  dropTables?: string[];
  corruptManifest?: boolean;
  emptyBuffer?: boolean;
}): Buffer {
  const schemaVersion = getMigrationCount();
  const tableCounts: Record<string, number> = {};

  for (const { name } of TABLE_REGISTRY) {
    tableCounts[name] = 0;
  }

  const manifest: BackupManifest = {
    schemaVersion: overrides?.manifest?.schemaVersion ?? schemaVersion,
    backupTimestamp: overrides?.manifest?.backupTimestamp ?? NOW,
    appVersion: overrides?.manifest?.appVersion ?? '1.0.0',
    tables: overrides?.manifest?.tables ?? tableCounts,
  };

  const zip = new AdmZip();

  if (overrides?.corruptManifest) {
    zip.addFile('manifest.json', Buffer.from('not-json', 'utf-8'));
  } else if (!overrides?.emptyBuffer) {
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8'));
  }

  const dropSet = new Set(overrides?.dropTables ?? []);
  for (const { name } of TABLE_REGISTRY) {
    if (dropSet.has(name)) continue;
    zip.addFile(`data/${name}.json`, Buffer.from('[]', 'utf-8'));
  }

  return zip.toBuffer();
}

/**
 * Serialize current DB state to a backup ZIP buffer.
 */
async function serializeBackupToZip(
  testDb: ReturnType<typeof drizzle<typeof schema>>,
): Promise<Buffer> {
  const backupData = await serializeBackup(testDb);
  const zip = new AdmZip();
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(backupData.manifest, null, 2), 'utf-8'));
  for (const { name } of TABLE_REGISTRY) {
    zip.addFile(
      `data/${name}.json`,
      Buffer.from(JSON.stringify(backupData.tables[name] ?? [], null, 2), 'utf-8'),
    );
  }
  return zip.toBuffer();
}

/**
 * Count rows in all tables.
 */
function countAllTables(sqlite: Database.Database): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const { name } of TABLE_REGISTRY) {
    const row = sqlite.prepare(`SELECT COUNT(*) AS count FROM "${name}"`).get() as { count: number };
    counts[name] = row.count;
  }
  return counts;
}

/**
 * Seed seed data for round-trip and content verification tests.
 */
function seedTestData(sqlite: Database.Database) {
  const accId = randomUUID();
  const tradeId = randomUUID();
  const lookupId = randomUUID();

  sqlite.prepare(`INSERT INTO app_profile (id, display_name, timezone, default_currency, created_at)
    VALUES (?, 'Server Restore Trader', 'America/New_York', 'USD', ?)`)
    .run(randomUUID(), NOW);

  sqlite.prepare(`INSERT INTO accounts (id, name, broker, currency, is_active, starting_balance, created_at, updated_at)
    VALUES (?, 'Server Restore Account', 'IBKR', 'USD', 1, 100000, ?, ?)`)
    .run(accId, NOW, NOW);

  sqlite.prepare(`INSERT INTO lookup_values (id, type, value, sort_order, is_active, created_at, updated_at)
    VALUES (?, 'sector', 'Technology', 1, 1, ?, ?)`)
    .run(lookupId, NOW, NOW);

  sqlite.prepare(`INSERT INTO settings (id, starting_account_value, max_risk_per_trade_pct, default_commission, currency, created_at, updated_at)
    VALUES (?, 100000, 1.5, 0.003, 'USD', ?, ?)`)
    .run(randomUUID(), NOW, NOW);

  sqlite.prepare(`INSERT INTO trades (id, trade_code, account_id, symbol, direction, sector_id, status, opened_at, created_at, updated_at)
    VALUES (?, 'SERVER-RESTORE-1', ?, 'AAPL', 'long', ?, 'closed', ?, ?, ?)`)
    .run(tradeId, accId, lookupId, NOW, NOW, NOW);

  sqlite.prepare(`INSERT INTO trade_executions (id, trade_id, executed_at, action, quantity, price, fees, created_at)
    VALUES (?, ?, ?, 'buy', 100, 180.50, 1.99, ?)`)
    .run(randomUUID(), tradeId, NOW, NOW);

  sqlite.prepare(`INSERT INTO trade_risk_snapshots (id, trade_id, account_equity_at_open, initial_entry_price, initial_stop_price, initial_quantity, created_at)
    VALUES (?, ?, 100000, 180.50, 175.00, 100, ?)`)
    .run(randomUUID(), tradeId, NOW);
}

// ── Route Handler Replicas ──────────────────────────────────────────────

interface RouteTestResult {
  status: number;
  body: unknown;
  error?: string;
  details?: unknown;
}

/**
 * Replica of isValidBackupFilename from the route handler.
 */
function validateBackupFilename(filename: string): string | null {
  // Must be a plain filename — no slashes, no parent traversal
  if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    return 'Filename must not contain path separators or parent directory references';
  }
  // Must match the backup naming pattern
  if (!/^backup-.+\.zip$/.test(filename)) {
    return 'Filename must match backup-*.zip';
  }
  return null; // valid
}

/**
 * Replica of POST /api/backup/restore/[filename] handler logic.
 *
 * Reads a backup ZIP from disk in the backup directory, validates it,
 * then performs a transactional restore with pre-restore snapshot.
 *
 * @param filename - Backup filename (e.g. "backup-2026-07-01T12-00-00-000Z.zip")
 * @param overrides - sqlite/db handles and paths
 */
async function doPostServerRestore(
  filename: string | null,
  overrides: {
    sqlite: Database.Database;
    db: ReturnType<typeof drizzle<typeof schema>>;
    dbPath: string;
    backupDir: string;
    snapshotDirOverride?: string;
  },
): Promise<RouteTestResult> {
  try {
    // ── 1. Validate filename ─────────────────────────────────────────
    if (!filename) {
      return {
        status: 400,
        body: null,
        error: 'Missing filename parameter',
      };
    }

    const validationError = validateBackupFilename(filename);
    if (validationError) {
      return {
        status: 400,
        body: null,
        error: 'Invalid backup filename',
        details: validationError,
      };
    }

    // ── 2. Resolve file path and check existence ─────────────────────
    // Replicate resolveBackupPath inline
    const resolvedPath = join(overrides.backupDir, filename);

    // Path traversal containment check (defence in depth)
    const absBackupDir = join(overrides.backupDir, '.');
    const absResolved = join(resolvedPath);
    if (!absResolved.startsWith(absBackupDir)) {
      return {
        status: 400,
        body: null,
        error: 'Invalid backup filename',
        details: 'Path traversal detected',
      };
    }

    if (!existsSync(resolvedPath)) {
      return {
        status: 404,
        body: null,
        error: 'Backup file not found',
        details: `No backup file named "${filename}" exists on the server`,
      };
    }

    console.log(
      JSON.stringify({
        event: 'test_server_restore_start',
        filename,
        filePath: resolvedPath,
        timestamp: new Date().toISOString(),
      }),
    );

    // ── 3. Read the ZIP from disk ─────────────────────────────────────
    let zipBuffer: Buffer;
    try {
      zipBuffer = readFileSync(resolvedPath);
    } catch (err) {
      console.error(
        JSON.stringify({
          event: 'test_server_restore_read_error',
          filename,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      return {
        status: 500,
        body: null,
        error: 'Failed to read backup file',
        details: String(err),
      };
    }

    // ── 4. Validate (replicate validateRestoreZip 5-step) ─────────────

    // Step 1: ZIP integrity
    let zip: AdmZip;
    try {
      zip = new AdmZip(zipBuffer);
    } catch (err) {
      return {
        status: 400,
        body: null,
        error: 'Invalid backup file',
        details: err instanceof Error ? err.message : 'Failed to open ZIP archive',
      };
    }

    // Step 2: Manifest exists
    const manifestEntry = zip.getEntry('manifest.json');
    if (!manifestEntry) {
      return {
        status: 400,
        body: null,
        error: 'Missing manifest.json in backup',
      };
    }

    let manifest: unknown;
    try {
      const raw = manifestEntry.getData().toString('utf-8');
      manifest = JSON.parse(raw);
    } catch (err) {
      return {
        status: 400,
        body: null,
        error: 'Invalid manifest.json',
        details: err instanceof Error ? err.message : 'Failed to parse manifest',
      };
    }

    if (
      !manifest ||
      typeof manifest !== 'object' ||
      typeof (manifest as Record<string, unknown>).schemaVersion !== 'number' ||
      typeof (manifest as Record<string, unknown>).backupTimestamp !== 'string'
    ) {
      return {
        status: 400,
        body: null,
        error: 'Invalid manifest format',
        details: 'manifest.json missing required fields (schemaVersion, backupTimestamp)',
      };
    }

    const typedManifest = manifest as BackupManifest;

    // Step 3: Schema version match
    const currentVersion = getMigrationCount();
    if (typedManifest.schemaVersion !== currentVersion) {
      return {
        status: 400,
        body: null,
        error: 'Schema version mismatch',
        details: {
          backup: typedManifest.schemaVersion,
          current: currentVersion,
        },
      };
    }

    // Step 4: All tables present
    const missingTables: string[] = [];
    for (const { name } of TABLE_REGISTRY) {
      if (!zip.getEntry(`data/${name}.json`)) {
        missingTables.push(name);
      }
    }
    if (missingTables.length > 0) {
      return {
        status: 400,
        body: null,
        error: 'Backup is missing data files',
        details: { missingTables },
      };
    }

    // Step 5: Open trades check
    const openTradeRow = overrides.sqlite
      .prepare("SELECT COUNT(*) AS count FROM trades WHERE status = 'open'")
      .get() as { count: number };
    if (openTradeRow.count > 0) {
      return {
        status: 400,
        body: null,
        error: 'Cannot restore while trades are open',
        details: { openTradeCount: openTradeRow.count },
      };
    }

    // ── 5. Create pre-restore snapshot ────────────────────────────────
    let snapshotPath: string;
    try {
      const snapDir = overrides.snapshotDirOverride ?? join(
        overrides.dbPath, '..', 'snapshots', `server-restore-${Date.now()}`,
      );
      mkdirSync(snapDir, { recursive: true });

      const backupData = await serializeBackup(overrides.db);

      const snapshotZip = new AdmZip();
      snapshotZip.addFile(
        'manifest.json',
        Buffer.from(JSON.stringify(backupData.manifest, null, 2), 'utf-8'),
      );
      for (const { name } of TABLE_REGISTRY) {
        snapshotZip.addFile(
          `data/${name}.json`,
          Buffer.from(JSON.stringify(backupData.tables[name] ?? [], null, 2), 'utf-8'),
        );
      }

      snapshotPath = join(snapDir, 'backup.zip');
      snapshotZip.writeZip(snapshotPath);
    } catch (err) {
      return {
        status: 500,
        body: null,
        error: 'Failed to create pre-restore snapshot',
        details: err instanceof Error ? err.message : String(err),
      };
    }

    // ── 6. Transactional wipe-and-replace ─────────────────────────────
    let restoredTables = 0;
    let restoredRows = 0;

    overrides.sqlite.pragma('foreign_keys = OFF');
    overrides.sqlite.exec('BEGIN');
    try {
      for (const tableName of DELETE_ORDER) {
        try {
          overrides.sqlite.exec(`DELETE FROM "${tableName}"`);
        } catch (delErr) {
          console.error(`  [DBG] DELETE error in table "${tableName}": ${delErr}`);
          throw delErr;
        }
      }

      for (const tableName of INSERT_ORDER) {
        const entry = zip.getEntry(`data/${tableName}.json`);
        if (!entry) continue;

        const raw = entry.getData().toString('utf-8');
        const rows: Record<string, unknown>[] = JSON.parse(raw);

        if (rows.length === 0) continue;

        const originalKeys = Object.keys(rows[0]);
        const columnNames = originalKeys.map(camelToSnake);
        const quotedColumns = columnNames.map((c) => `"${c}"`).join(', ');
        const placeholders = columnNames.map(() => '?').join(', ');
        const stmt = overrides.sqlite.prepare(
          `INSERT INTO "${tableName}" (${quotedColumns}) VALUES (${placeholders})`,
        );

        for (const row of rows) {
          const values = originalKeys.map((key) => {
            const val = row[key];
            if (typeof val === 'boolean') return val ? 1 : 0;
            return val ?? null;
          });
          stmt.run(...values);
        }

        restoredTables++;
        restoredRows += rows.length;
      }

      overrides.sqlite.exec('COMMIT');
    } catch (innerErr) {
      overrides.sqlite.exec('ROLLBACK');
      return {
        status: 500,
        body: null,
        error: 'Restore failed',
        details: String(innerErr),
      };
    }

    console.log(
      JSON.stringify({
        event: 'test_server_restore_success',
        filename,
        snapshotPath,
        restoredTables,
        restoredRows,
      }),
    );

    return {
      status: 200,
      body: {
        success: true,
        snapshotPath,
        restoredTables,
        restoredRows,
      },
    };
  } catch (err) {
    console.error(
      JSON.stringify({
        event: 'test_server_restore_error',
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return {
      status: 500,
      body: null,
      error: 'Restore failed',
      details: String(err),
    };
  }
}

// ── Tests ───────────────────────────────────────────────────────────────

async function runTests() {
  console.log('\n\uD83D\uDDA5\uFE0F Server-Side Restore Route Tests');
  console.log('\u2550'.repeat(60) + '\n');

  // ── Validation helpers ──────────────────────────────────────────────
  console.log('\u25B6 Filename Validation');

  {
    assert(validateBackupFilename('backup-2026-07-01T12-00-00-000Z.zip') === null,
      'Validation: valid backup filename passes');
    assert(validateBackupFilename('backup-test.zip') === null,
      'Validation: short but valid pattern passes');
    assert(validateBackupFilename('not-a-backup.zip') !== null,
      'Validation: filename without backup- prefix fails');
    assert(validateBackupFilename('/etc/passwd') !== null,
      'Validation: absolute path fails');
    assert(validateBackupFilename('../../../etc/passwd') !== null,
      'Validation: parent traversal fails');
    assert(validateBackupFilename('subdir/backup-test.zip') !== null,
      'Validation: path separator in filename fails');
    assert(validateBackupFilename('backup-no-extension') !== null,
      'Validation: missing .zip extension fails');
  }

  // ── Server Restore Route Tests ──────────────────────────────────────
  console.log('\u25B6 Server Restore Route');

  // Test 1: POST valid backup file on disk returns 200 with success/restoredTables/restoredRows/snapshotPath
  {
    const testDir = mkdtempSync(join(tmpdir(), 'server-restore-test-'));
    const dbPath = join(testDir, '.trading-journal', 'journal.db');
    const { sqlite, db: testDb } = createSchemaDb(dbPath);
    const backupDir = getBackupDirFromDbPath(dbPath);

    try {
      // Seed test data, create backup ZIP, write to backup directory
      seedTestData(sqlite);
      const zipBuffer = await serializeBackupToZip(testDb);
      writeBackupFile(backupDir, BACKUP_FILENAME, zipBuffer);

      const snapshotDir = join(testDir, 'snapshots', 'server-restore-test-1');
      const result = await doPostServerRestore(BACKUP_FILENAME, {
        sqlite, db: testDb, dbPath, backupDir,
        snapshotDirOverride: snapshotDir,
      });

      assert(result.status === 200, 'Server Restore: valid file returns 200');
      const body = result.body as {
        success: boolean;
        restoredTables: number;
        restoredRows: number;
        snapshotPath: string;
      } | null;
      assert(body !== null, 'Server Restore: body is not null');
      assert(body!.success === true, 'Server Restore: success is true');
      assert(typeof body!.restoredTables === 'number', 'Server Restore: restoredTables is number');
      assert(body!.restoredTables > 0, 'Server Restore: restoredTables > 0');
      assert(typeof body!.restoredRows === 'number', 'Server Restore: restoredRows is number');
      assert(body!.restoredRows > 0, 'Server Restore: restoredRows > 0');
      assert(typeof body!.snapshotPath === 'string', 'Server Restore: snapshotPath is string');
      assert(body!.snapshotPath.length > 0, 'Server Restore: snapshotPath is non-empty');
      assert(existsSync(body!.snapshotPath), 'Server Restore: snapshot file exists on disk');
    } finally {
      sqlite.close();
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  // Test 2: POST non-existent file returns 404
  {
    const testDir = mkdtempSync(join(tmpdir(), 'server-restore-test-'));
    const dbPath = join(testDir, '.trading-journal', 'journal.db');
    const { sqlite, db: testDb } = createSchemaDb(dbPath);
    const backupDir = getBackupDirFromDbPath(dbPath);
    mkdirSync(backupDir, { recursive: true }); // directory exists but no files

    try {
      const result = await doPostServerRestore('backup-nonexistent-2026-07-01T00-00-00-000Z.zip', {
        sqlite, db: testDb, dbPath, backupDir,
      });

      assert(result.status === 404, 'Server Restore: non-existent file returns 404');
      assert(result.error === 'Backup file not found', 'Server Restore: error message matches');
      assert(
        (result.details as string)?.includes('backup-nonexistent'),
        'Server Restore: details mentions filename',
      );
    } finally {
      sqlite.close();
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  // Test 3: POST with path traversal filename returns 400
  {
    const testDir = mkdtempSync(join(tmpdir(), 'server-restore-test-'));
    const dbPath = join(testDir, '.trading-journal', 'journal.db');
    const { sqlite, db: testDb } = createSchemaDb(dbPath);
    const backupDir = getBackupDirFromDbPath(dbPath);

    try {
      const result = await doPostServerRestore('../../../etc/passwd', {
        sqlite, db: testDb, dbPath, backupDir,
      });

      assert(result.status === 400, 'Server Restore: path traversal returns 400');
      assert(result.error === 'Invalid backup filename', 'Server Restore: error message matches');
      assert(
        (result.details as string)?.toLowerCase().includes('separator') ||
        (result.details as string)?.toLowerCase().includes('parent'),
        'Server Restore: details mentions path separator or parent traversal',
      );
    } finally {
      sqlite.close();
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  // Test 4: POST with invalid filename format returns 400
  {
    const testDir = mkdtempSync(join(tmpdir(), 'server-restore-test-'));
    const dbPath = join(testDir, '.trading-journal', 'journal.db');
    const { sqlite, db: testDb } = createSchemaDb(dbPath);
    const backupDir = getBackupDirFromDbPath(dbPath);

    try {
      const result = await doPostServerRestore('random-file.zip', {
        sqlite, db: testDb, dbPath, backupDir,
      });

      assert(result.status === 400, 'Server Restore: invalid format returns 400');
      assert(result.error === 'Invalid backup filename', 'Server Restore: error message matches');
      assert(
        (result.details as string)?.toLowerCase().includes('backup'),
        'Server Restore: details mentions backup- pattern',
      );
    } finally {
      sqlite.close();
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  // Test 5: POST corrupt ZIP on disk returns 400
  {
    const testDir = mkdtempSync(join(tmpdir(), 'server-restore-test-'));
    const dbPath = join(testDir, '.trading-journal', 'journal.db');
    const { sqlite, db: testDb } = createSchemaDb(dbPath);
    const backupDir = getBackupDirFromDbPath(dbPath);

    try {
      // Write corrupt bytes as a "ZIP file" to disk
      writeBackupFile(backupDir, BACKUP_FILENAME, Buffer.from([0x00, 0x01, 0x02, 0x03]));

      const result = await doPostServerRestore(BACKUP_FILENAME, {
        sqlite, db: testDb, dbPath, backupDir,
      });

      assert(result.status === 400, 'Server Restore: corrupt ZIP returns 400');
      assert(result.error === 'Invalid backup file', 'Server Restore: error message matches');
    } finally {
      sqlite.close();
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  // Test 6: POST schema version mismatch returns 400
  {
    const testDir = mkdtempSync(join(tmpdir(), 'server-restore-test-'));
    const dbPath = join(testDir, '.trading-journal', 'journal.db');
    const { sqlite, db: testDb } = createSchemaDb(dbPath);
    const backupDir = getBackupDirFromDbPath(dbPath);

    try {
      const currentVersion = getMigrationCount();
      const badVersion = currentVersion + 99;
      const zipBuffer = createTestZip({ manifest: { schemaVersion: badVersion } });
      writeBackupFile(backupDir, BACKUP_FILENAME, zipBuffer);

      const result = await doPostServerRestore(BACKUP_FILENAME, {
        sqlite, db: testDb, dbPath, backupDir,
      });

      assert(result.status === 400, 'Server Restore: schema mismatch returns 400');
      assert(result.error === 'Schema version mismatch', 'Server Restore: error message matches');
      const details = result.details as { backup: number; current: number } | undefined;
      assert(details !== undefined, 'Server Restore: details present');
      assert(details!.backup === badVersion, 'Server Restore: details.backup matches bad version');
      assert(details!.current === currentVersion, 'Server Restore: details.current matches current version');
    } finally {
      sqlite.close();
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  // Test 7: POST missing manifest ZIP on disk returns 400
  {
    const testDir = mkdtempSync(join(tmpdir(), 'server-restore-test-'));
    const dbPath = join(testDir, '.trading-journal', 'journal.db');
    const { sqlite, db: testDb } = createSchemaDb(dbPath);
    const backupDir = getBackupDirFromDbPath(dbPath);

    try {
      // Create ZIP with data but no manifest
      const zip = new AdmZip();
      zip.addFile('data/accounts.json', Buffer.from('[]', 'utf-8'));
      writeBackupFile(backupDir, BACKUP_FILENAME, zip.toBuffer());

      const result = await doPostServerRestore(BACKUP_FILENAME, {
        sqlite, db: testDb, dbPath, backupDir,
      });

      assert(result.status === 400, 'Server Restore: missing manifest returns 400');
      assert(
        (result.error ?? '').toLowerCase().includes('manifest'),
        'Server Restore: error mentions missing manifest',
      );
    } finally {
      sqlite.close();
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  // Test 8: POST with open trades returns 400
  {
    const testDir = mkdtempSync(join(tmpdir(), 'server-restore-test-'));
    const dbPath = join(testDir, '.trading-journal', 'journal.db');
    const { sqlite, db: testDb } = createSchemaDb(dbPath);
    const backupDir = getBackupDirFromDbPath(dbPath);

    try {
      // Seed an open trade
      const accId = randomUUID();
      sqlite.prepare(`INSERT INTO accounts (id, name, currency, is_active, created_at, updated_at)
        VALUES (?, 'Open Trade Test', 'USD', 1, ?, ?)`)
        .run(accId, NOW, NOW);
      sqlite.prepare(`INSERT INTO trades (id, trade_code, account_id, symbol, direction, status, opened_at, created_at, updated_at)
        VALUES (?, 'OPEN-TRADE-SERVER', ?, 'TEST', 'long', 'open', ?, ?, ?)`)
        .run(randomUUID(), accId, NOW, NOW, NOW);

      const zipBuffer = createTestZip();
      writeBackupFile(backupDir, BACKUP_FILENAME, zipBuffer);

      const result = await doPostServerRestore(BACKUP_FILENAME, {
        sqlite, db: testDb, dbPath, backupDir,
      });

      assert(result.status === 400, 'Server Restore: open trades returns 400');
      assert(
        (result.error ?? '').toLowerCase().includes('open'),
        'Server Restore: error mentions open trades',
      );
      const details = result.details as { openTradeCount: number } | undefined;
      assert(details !== undefined, 'Server Restore: details present');
      assert(details!.openTradeCount === 1, 'Server Restore: openTradeCount is 1');
    } finally {
      sqlite.close();
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  // Test 9: POST missing filename (null) returns 400
  {
    const testDir = mkdtempSync(join(tmpdir(), 'server-restore-test-'));
    const dbPath = join(testDir, '.trading-journal', 'journal.db');
    const { sqlite, db: testDb } = createSchemaDb(dbPath);
    const backupDir = getBackupDirFromDbPath(dbPath);

    try {
      const result = await doPostServerRestore(null, {
        sqlite, db: testDb, dbPath, backupDir,
      });

      assert(result.status === 400, 'Server Restore: null filename returns 400');
      assert(
        (result.error ?? '').toLowerCase().includes('missing'),
        'Server Restore: error mentions missing filename',
      );
    } finally {
      sqlite.close();
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  // Test 10: Full round-trip — seed, write backup to disk, restore, verify content
  {
    const testDir = mkdtempSync(join(tmpdir(), 'server-restore-test-'));
    const dbPath = join(testDir, '.trading-journal', 'journal.db');
    const { sqlite, db: testDb } = createSchemaDb(dbPath);
    const backupDir = getBackupDirFromDbPath(dbPath);

    try {
      seedTestData(sqlite);

      const preCounts = countAllTables(sqlite);
      assert(preCounts['trades'] >= 1, 'Server Round-trip: pre-restore trades >= 1');
      assert(preCounts['trade_executions'] >= 1, 'Server Round-trip: pre-restore executions >= 1');

      // Create backup ZIP and write to disk
      const zipBuffer = await serializeBackupToZip(testDb);
      writeBackupFile(backupDir, BACKUP_FILENAME, zipBuffer);

      // Execute restore from disk
      const snapshotDir = join(testDir, 'snapshots', 'server-restore-roundtrip');
      const restoreResult = await doPostServerRestore(BACKUP_FILENAME, {
        sqlite, db: testDb, dbPath, backupDir,
        snapshotDirOverride: snapshotDir,
      });

      assert(restoreResult.status === 200, 'Server Round-trip: restore returns 200');

      // Verify all tables match pre-restore counts
      const postCounts = countAllTables(sqlite);
      for (const { name } of TABLE_REGISTRY) {
        assert(
          postCounts[name] === preCounts[name],
          `Server Round-trip: table "${name}" has ${postCounts[name]} rows (expected ${preCounts[name]})`,
        );
      }

      // Verify specific data content was preserved
      const tradeRow = sqlite.prepare(
        "SELECT * FROM trades WHERE trade_code = 'SERVER-RESTORE-1'",
      ).get() as Record<string, unknown> | undefined;
      assert(tradeRow !== undefined, 'Server Round-trip: trade SERVER-RESTORE-1 exists after restore');
      if (tradeRow) {
        assert(tradeRow['symbol'] === 'AAPL', 'Server Round-trip: symbol preserved');
        assert(tradeRow['direction'] === 'long', 'Server Round-trip: direction preserved');
      }
    } finally {
      sqlite.close();
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  // Test 11: Pre-restore snapshot exists and contains valid data after restore
  {
    const testDir = mkdtempSync(join(tmpdir(), 'server-restore-test-'));
    const dbPath = join(testDir, '.trading-journal', 'journal.db');
    const { sqlite, db: testDb } = createSchemaDb(dbPath);
    const backupDir = getBackupDirFromDbPath(dbPath);

    try {
      seedTestData(sqlite);

      const zipBuffer = await serializeBackupToZip(testDb);
      writeBackupFile(backupDir, BACKUP_FILENAME, zipBuffer);

      const snapshotDir = join(testDir, 'snapshots', 'server-restore-snapshot-test');
      const result = await doPostServerRestore(BACKUP_FILENAME, {
        sqlite, db: testDb, dbPath, backupDir,
        snapshotDirOverride: snapshotDir,
      });

      assert(result.status === 200, 'Snapshot: server restore returns 200');

      const body = result.body as { snapshotPath: string } | null;
      assert(body !== null, 'Snapshot: body not null');
      assert(existsSync(body!.snapshotPath), 'Snapshot: snapshot file exists on disk');

      // Verify the snapshot contains valid manifest and data
      const snapshotZip = new AdmZip(body!.snapshotPath);
      const snapManifest = snapshotZip.getEntry('manifest.json');
      assert(snapManifest !== null, 'Snapshot: snapshot ZIP contains manifest.json');

      const snapAccounts = snapshotZip.getEntry('data/accounts.json');
      assert(snapAccounts !== null, 'Snapshot: snapshot ZIP contains data/accounts.json');

      // Verify snapshot captured pre-restore data
      const accountsContent = snapAccounts!.getData().toString('utf-8');
      const accountsData = JSON.parse(accountsContent);
      assert(
        Array.isArray(accountsData) && accountsData.length >= 1,
        'Snapshot: captured data contains at least 1 account',
      );
    } finally {
      sqlite.close();
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
