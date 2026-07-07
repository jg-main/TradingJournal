/**
 * /api/restore route tests
 *
 * Tests the two POST handlers for restore preview and restore execution:
 *  - Preview: valid ZIP returns 200 with manifest, invalid returns 400,
 *    open trades block, no DB mutation on preview
 *  - Restore: valid ZIP returns 200 with success/rows/snapshotPath,
 *    invalid/missing/manifest/version errors return 400,
 *    full round-trip restores correctly, snapshot is created
 *
 * Follows the replica pattern from src/app/api/backup/__tests__/route.test.ts.
 * Replicates route handler logic inline because @/lib/restore imports @/db/index
 * which imports 'server-only' (not available in tsx standalone context).
 *
 * Run: npx tsx src/app/api/restore/__tests__/route.test.ts
 */

process.env.DB_FILE_NAME = './.test-m15-s02-t05-db';

import { mkdirSync, rmSync, existsSync, mkdtempSync } from 'node:fs';
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

// ── Constants (replicating restore.ts) ──────────────────────────────────

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
 * Create a valid backup ZIP in memory using adm-zip.
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
 * Create a seed ZIP with some populated data for round-trip testing.
 */
async function createSeedZip(sqlite: Database.Database): Promise<Buffer> {
  // Seed a few rows
  const accId = randomUUID();
  const lookupId = randomUUID();
  const tradeId = randomUUID();

  sqlite.prepare(`INSERT INTO app_profile (id, display_name, timezone, default_currency, created_at)
    VALUES (?, 'Restore Test Trader', 'America/New_York', 'USD', ?)`)
    .run(randomUUID(), NOW);

  sqlite.prepare(`INSERT INTO accounts (id, name, broker, currency, is_active, starting_balance, created_at, updated_at)
    VALUES (?, 'Route Test Account', 'IBKR', 'USD', 1, 50000, ?, ?)`)
    .run(accId, NOW, NOW);

  sqlite.prepare(`INSERT INTO lookup_values (id, type, value, sort_order, is_active, created_at, updated_at)
    VALUES (?, 'sector', 'Technology', 1, 1, ?, ?)`)
    .run(lookupId, NOW, NOW);

  sqlite.prepare(`INSERT INTO settings (id, starting_account_value, max_risk_per_trade_pct, default_commission, currency, created_at, updated_at)
    VALUES (?, 50000, 1.0, 0.005, 'USD', ?, ?)`)
    .run(randomUUID(), NOW, NOW);

  sqlite.prepare(`INSERT INTO trades (id, trade_code, account_id, symbol, direction, sector_id, status, opened_at, created_at, updated_at)
    VALUES (?, 'RT-ROUTE', ?, 'AAPL', 'long', ?, 'closed', ?, ?, ?)`)
    .run(tradeId, accId, lookupId, NOW, NOW, NOW);

  sqlite.prepare(`INSERT INTO trade_executions (id, trade_id, executed_at, action, quantity, price, fees, created_at)
    VALUES (?, ?, ?, 'buy', 100, 180.50, 1.99, ?)`)
    .run(randomUUID(), tradeId, NOW, NOW);

  sqlite.prepare(`INSERT INTO trade_risk_snapshots (id, trade_id, account_equity_at_open, initial_entry_price, initial_stop_price, initial_quantity, created_at)
    VALUES (?, ?, 50000, 180.50, 175.00, 100, ?)`)
    .run(randomUUID(), tradeId, NOW);

  // Serialize and return as ZIP
  const drizzleDb = drizzle(sqlite, { schema });
  return await serializeBackupToZip(drizzleDb);
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
 * Seed an open trade for the open-trades guard test.
 */
function seedOpenTrade(sqlite: Database.Database) {
  const accId = randomUUID();
  sqlite.prepare(`INSERT INTO accounts (id, name, currency, is_active, created_at, updated_at)
    VALUES (?, 'Open Trade Test Acc', 'USD', 1, ?, ?)`)
    .run(accId, NOW, NOW);
  sqlite.prepare(`INSERT INTO trades (id, trade_code, account_id, symbol, direction, status, opened_at, created_at, updated_at)
    VALUES (?, 'OPEN-TRADE', ?, 'TEST', 'long', 'open', ?, ?, ?)`)
    .run(randomUUID(), accId, NOW, NOW, NOW);
}

// ── Route Handler Replicas ──────────────────────────────────────────────

interface RouteTestResult {
  status: number;
  body: unknown;
  error?: string;
  details?: unknown;
}

/**
 * Replica of POST /api/restore/preview handler logic.
 *
 * Validates a backup ZIP and returns its manifest without mutating the DB.
 * Operates on explicit sqlite handle for the open-trades check.
 */
async function doPostRestorePreview(
  zipBuffer: Buffer | null,
  overrides: {
    sqlite: Database.Database;
    dbPath: string;
  },
): Promise<RouteTestResult> {
  try {
    // ── Parse multipart form data replica ───────────────────────────
    if (!zipBuffer) {
      return {
        status: 400,
        body: null,
        error: 'Missing backup file',
        details: 'Form field "backup" is required',
      };
    }

    // ── Replicate validateRestoreZip 5-step validation ──────────────

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

    // Parse manifest
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

    // Validate manifest fields
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

    // ── Preview (read-only manifest extraction) ─────────────────────
    const raw = zip.readAsText('manifest.json');
    const resultManifest = JSON.parse(raw) as BackupManifest;

    return { status: 200, body: { manifest: resultManifest } };
  } catch (err) {
    return {
      status: 500,
      body: null,
      error: 'Unexpected error during restore preview',
      details: String(err),
    };
  }
}

/**
 * Replica of POST /api/restore handler logic.
 *
 * Validates the ZIP, creates a pre-restore snapshot, then performs
 * transactional wipe-and-replace with FK-safe insertion ordering.
 */
async function doPostRestore(
  zipBuffer: Buffer | null,
  overrides: {
    sqlite: Database.Database;
    db: ReturnType<typeof drizzle<typeof schema>>;
    dbPath: string;
    snapshotDir?: string;
  },
): Promise<RouteTestResult> {
  try {
    // ── Parse multipart form data replica ───────────────────────────
    if (!zipBuffer) {
      return {
        status: 400,
        body: null,
        error: 'Missing backup file',
        details: 'Form field "backup" is required',
      };
    }

    // ── Replicate validateRestoreZip (same 5 steps as preview) ──────

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

    // ── Create pre-restore snapshot ──────────────────────────────────
    let snapshotPath: string;
    try {
      const snapshotDir = overrides.snapshotDir ?? join(overrides.dbPath, '..', 'snapshots', `pre-restore-${Date.now()}`);
      mkdirSync(snapshotDir, { recursive: true });

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

      snapshotPath = join(snapshotDir, 'backup.zip');
      snapshotZip.writeZip(snapshotPath);
    } catch (err) {
      return {
        status: 500,
        body: null,
        error: 'Failed to create pre-restore snapshot',
        details: err instanceof Error ? err.message : String(err),
      };
    }

    // ── Transactional wipe-and-replace ───────────────────────────────
    let restoredTables = 0;
    let restoredRows = 0;

    // Disable FK enforcement OUTSIDE the transaction, then manage the
    // transaction manually with BEGIN/COMMIT/ROLLBACK for full control.
    // This avoids any better-sqlite3 transaction wrapper edge cases.
    // Use pragma() to ensure FK is properly disabled, then verify
    const fkBefore = overrides.sqlite.pragma('foreign_keys');
    overrides.sqlite.pragma('foreign_keys = OFF');
    const fkAfter = overrides.sqlite.pragma('foreign_keys');
    console.log(`  [DBG] FK pragma: ${fkBefore} -> ${fkAfter}`);

    overrides.sqlite.exec('BEGIN');
    try {
      // DELETE all existing rows (FK OFF means no constraint checking)
      for (const tableName of DELETE_ORDER) {
        try {
          overrides.sqlite.exec(`DELETE FROM "${tableName}"`);
        } catch (delErr) {
          console.error(`  [DBG] DELETE error in table "${tableName}": ${delErr}`);
          throw delErr;
        }
      }

      // INSERT backup data in FK-safe order
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
    // Outer catch for validation / snapshot errors
    console.log(`  [DBG] Outer handler error: ${err}`);
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
  console.log('\n\uD83D\uDDA5\uFE0F Restore API Route Tests');
  console.log('\u2550'.repeat(60) + '\n');

  // ── Preview Route Tests ───────────────────────────────────────────
  console.log('\u25B6 Preview Route');

  // Test 1: POST valid ZIP returns 200 with manifest
  {
    const testDir = mkdtempSync(join(tmpdir(), 'restore-route-test-'));
    const dbPath = join(testDir, '.trading-journal', 'journal.db');
    const { sqlite, db: testDb } = createSchemaDb(dbPath);

    try {
      // Create a valid seed backup ZIP by serializing the fresh DB
      const zipBuffer = await serializeBackupToZip(testDb);

      const result = await doPostRestorePreview(zipBuffer, { sqlite, dbPath });
      assert(result.status === 200, 'Preview: valid ZIP returns 200');

      const body = result.body as { manifest: BackupManifest } | null;
      assert(body !== null, 'Preview: body is not null');
      assert(body!.manifest !== undefined, 'Preview: body has manifest field');
      assert(typeof body!.manifest.schemaVersion === 'number', 'Preview: manifest.schemaVersion is number');
      assert(body!.manifest.schemaVersion === getMigrationCount(), 'Preview: manifest.schemaVersion matches current');
      assert(typeof body!.manifest.backupTimestamp === 'string', 'Preview: manifest.backupTimestamp is string');
      assert(typeof body!.manifest.tables === 'object', 'Preview: manifest.tables is object');
      assert(body!.manifest.tables['accounts'] === 0, 'Preview: manifest shows 0 accounts (fresh DB)');
      assert(body!.manifest.tables['app_profile'] === 0, 'Preview: manifest shows 0 profile rows (fresh DB)');
    } finally {
      sqlite.close();
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  // Test 2: POST corrupt buffer returns 400
  {
    const testDir = mkdtempSync(join(tmpdir(), 'restore-route-test-'));
    const dbPath = join(testDir, '.trading-journal', 'journal.db');
    const { sqlite } = createSchemaDb(dbPath);

    try {
      const result = await doPostRestorePreview(Buffer.from([0x00, 0x01, 0x02, 0x03]), { sqlite, dbPath });
      assert(result.status === 400, 'Preview: corrupt ZIP returns 400');
      assert(result.error === 'Invalid backup file', 'Preview: error message matches');
    } finally {
      sqlite.close();
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  // Test 3: POST schema version mismatch returns 400 with version details
  {
    const testDir = mkdtempSync(join(tmpdir(), 'restore-route-test-'));
    const dbPath = join(testDir, '.trading-journal', 'journal.db');
    const { sqlite } = createSchemaDb(dbPath);

    try {
      const currentVersion = getMigrationCount();
      const badVersion = currentVersion + 99;
      const zipBuffer = createTestZip({ manifest: { schemaVersion: badVersion } });

      const result = await doPostRestorePreview(zipBuffer, { sqlite, dbPath });
      assert(result.status === 400, 'Preview: schema mismatch returns 400');
      assert(result.error === 'Schema version mismatch', 'Preview: error message matches');
      const details = result.details as { backup: number; current: number } | undefined;
      assert(details !== undefined, 'Preview: details present');
      assert(details!.backup === badVersion, 'Preview: details.backup matches bad version');
      assert(details!.current === currentVersion, 'Preview: details.current matches current version');
    } finally {
      sqlite.close();
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  // Test 4: POST with open trades returns 400 with openTradeCount
  {
    const testDir = mkdtempSync(join(tmpdir(), 'restore-route-test-'));
    const dbPath = join(testDir, '.trading-journal', 'journal.db');
    const { sqlite } = createSchemaDb(dbPath);

    try {
      seedOpenTrade(sqlite);

      const zipBuffer = createTestZip();
      const result = await doPostRestorePreview(zipBuffer, { sqlite, dbPath });
      assert(result.status === 400, 'Preview: open trades returns 400');
      assert((result.error ?? '').toLowerCase().includes('open'), 'Preview: error mentions open trades');
      const details = result.details as { openTradeCount: number } | undefined;
      assert(details !== undefined, 'Preview: details present');
      assert(details!.openTradeCount === 1, 'Preview: openTradeCount is 1');
    } finally {
      sqlite.close();
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  // Test 5: Preview does NOT mutate DB — verify row counts unchanged after preview
  {
    const testDir = mkdtempSync(join(tmpdir(), 'restore-route-test-'));
    const dbPath = join(testDir, '.trading-journal', 'journal.db');
    const { sqlite } = createSchemaDb(dbPath);

    try {
      // Pre-count
      const preCounts = countAllTables(sqlite);

      const zipBuffer = createTestZip();
      await doPostRestorePreview(zipBuffer, { sqlite, dbPath });

      // Post-count (should not have changed)
      const postCounts = countAllTables(sqlite);
      assert(
        JSON.stringify(preCounts) === JSON.stringify(postCounts),
        'Preview: DB row counts unchanged after preview call',
      );
    } finally {
      sqlite.close();
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  // ── Restore Route Tests ────────────────────────────────────────────
  console.log('\u25B6 Restore Route');

  // Test 1: POST valid ZIP returns 200 with success, restoredTables, restoredRows, snapshotPath
  {
    const testDir = mkdtempSync(join(tmpdir(), 'restore-route-test-'));
    const dbPath = join(testDir, '.trading-journal', 'journal.db');
    const { sqlite, db: testDb } = createSchemaDb(dbPath);

    try {
      // Seed some data, then create a backup ZIP
      const accId = randomUUID();
      sqlite.prepare(`INSERT INTO accounts (id, name, currency, is_active, starting_balance, created_at, updated_at)
        VALUES (?, 'Test Acc', 'USD', 1, 10000, ?, ?)`)
        .run(accId, NOW, NOW);
      sqlite.prepare(`INSERT INTO trades (id, trade_code, account_id, symbol, direction, status, opened_at, created_at, updated_at)
        VALUES (?, 'RESTORE-TEST-1', ?, 'MSFT', 'long', 'closed', ?, ?, ?)`)
        .run(randomUUID(), accId, NOW, NOW, NOW);

      const zipBuffer = await serializeBackupToZip(testDb);

      const snapshotDir = join(testDir, 'snapshots', 'pre-restore-test');
      const result = await doPostRestore(zipBuffer, { sqlite, db: testDb, dbPath, snapshotDir });

      assert(result.status === 200, 'Restore: valid ZIP returns 200');
      const body = result.body as {
        success: boolean;
        restoredTables: number;
        restoredRows: number;
        snapshotPath: string;
      } | null;
      assert(body !== null, 'Restore: body is not null');
      assert(body!.success === true, 'Restore: success is true');
      assert(typeof body!.restoredTables === 'number', 'Restore: restoredTables is number');
      assert(body!.restoredTables > 0, 'Restore: restoredTables > 0');
      assert(typeof body!.restoredRows === 'number', 'Restore: restoredRows is number');
      assert(body!.restoredRows > 0, 'Restore: restoredRows > 0');
      assert(typeof body!.snapshotPath === 'string', 'Restore: snapshotPath is string');
      assert(body!.snapshotPath.length > 0, 'Restore: snapshotPath is non-empty');
      assert(existsSync(body!.snapshotPath), 'Restore: snapshot file exists on disk');
    } finally {
      sqlite.close();
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  // Test 2: POST corrupt ZIP returns 400
  {
    const testDir = mkdtempSync(join(tmpdir(), 'restore-route-test-'));
    const dbPath = join(testDir, '.trading-journal', 'journal.db');
    const { sqlite, db: testDb } = createSchemaDb(dbPath);

    try {
      const result = await doPostRestore(Buffer.from([0x00, 0x01, 0x02, 0x03]), { sqlite, db: testDb, dbPath });
      assert(result.status === 400, 'Restore: corrupt ZIP returns 400');
      assert(result.error === 'Invalid backup file', 'Restore: error message matches');
    } finally {
      sqlite.close();
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  // Test 3: POST missing manifest ZIP returns 400
  {
    const testDir = mkdtempSync(join(tmpdir(), 'restore-route-test-'));
    const dbPath = join(testDir, '.trading-journal', 'journal.db');
    const { sqlite, db: testDb } = createSchemaDb(dbPath);

    try {
      const zip = new AdmZip();
      zip.addFile('data/accounts.json', Buffer.from('[]', 'utf-8'));
      const result = await doPostRestore(zip.toBuffer(), { sqlite, db: testDb, dbPath });
      assert(result.status === 400, 'Restore: missing manifest returns 400');
      assert((result.error ?? '').toLowerCase().includes('manifest'), 'Restore: error mentions missing manifest');
    } finally {
      sqlite.close();
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  // Test 4: POST schema version mismatch returns 400
  {
    const testDir = mkdtempSync(join(tmpdir(), 'restore-route-test-'));
    const dbPath = join(testDir, '.trading-journal', 'journal.db');
    const { sqlite, db: testDb } = createSchemaDb(dbPath);

    try {
      const currentVersion = getMigrationCount();
      const badVersion = currentVersion + 99;
      const zipBuffer = createTestZip({ manifest: { schemaVersion: badVersion } });

      const result = await doPostRestore(zipBuffer, { sqlite, db: testDb, dbPath });
      assert(result.status === 400, 'Restore: schema mismatch returns 400');
      assert(result.error === 'Schema version mismatch', 'Restore: schema mismatch error message');
      const details = result.details as { backup: number; current: number } | undefined;
      assert(details?.backup === badVersion, 'Restore: details.backup matches');
      assert(details?.current === currentVersion, 'Restore: details.current matches');
    } finally {
      sqlite.close();
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  // Test 5: POST with no file (null buffer) returns 400
  {
    const testDir = mkdtempSync(join(tmpdir(), 'restore-route-test-'));
    const dbPath = join(testDir, '.trading-journal', 'journal.db');
    const { sqlite, db: testDb } = createSchemaDb(dbPath);

    try {
      const result = await doPostRestore(null, { sqlite, db: testDb, dbPath });
      assert(result.status === 400, 'Restore: no file returns 400');
      assert(result.error === 'Missing backup file', 'Restore: error mentions missing backup file');
      assert(
        (result.details as string)?.includes('backup') ?? false,
        'Restore: details mentions backup field',
      );
    } finally {
      sqlite.close();
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  // Test 6: Full round-trip — seed, backup, restore, verify all tables match
  {
    const testDir = mkdtempSync(join(tmpdir(), 'restore-route-test-'));
    const dbPath = join(testDir, '.trading-journal', 'journal.db');
    const { sqlite, db: testDb } = createSchemaDb(dbPath);

    try {
      // Phase 1: Seed data
      const accId = randomUUID();
      const tradeId = randomUUID();
      const lookupId = randomUUID();

      sqlite.prepare(`INSERT INTO app_profile (id, display_name, timezone, default_currency, created_at)
        VALUES (?, 'Round Trip Trader', 'America/New_York', 'USD', ?)`)
        .run(randomUUID(), NOW);

      sqlite.prepare(`INSERT INTO accounts (id, name, broker, currency, is_active, starting_balance, created_at, updated_at)
        VALUES (?, 'Round Trip Account', 'IBKR', 'USD', 1, 100000, ?, ?)`)
        .run(accId, NOW, NOW);

      sqlite.prepare(`INSERT INTO lookup_values (id, type, value, sort_order, is_active, created_at, updated_at)
        VALUES (?, 'sector', 'Technology', 1, 1, ?, ?)`)
        .run(lookupId, NOW, NOW);

      sqlite.prepare(`INSERT INTO settings (id, starting_account_value, max_risk_per_trade_pct, default_commission, currency, created_at, updated_at)
        VALUES (?, 100000, 1.5, 0.003, 'USD', ?, ?)`)
        .run(randomUUID(), NOW, NOW);

      sqlite.prepare(`INSERT INTO trades (id, trade_code, account_id, symbol, direction, sector_id, status, opened_at, created_at, updated_at)
        VALUES (?, 'ROUND-TRIP-1', ?, 'AAPL', 'long', ?, 'closed', ?, ?, ?)`)
        .run(tradeId, accId, lookupId, NOW, NOW, NOW);

      sqlite.prepare(`INSERT INTO trade_executions (id, trade_id, executed_at, action, quantity, price, fees, created_at)
        VALUES (?, ?, ?, 'buy', 100, 180.50, 1.99, ?)`)
        .run(randomUUID(), tradeId, NOW, NOW);

      sqlite.prepare(`INSERT INTO trade_risk_snapshots (id, trade_id, account_equity_at_open, initial_entry_price, initial_stop_price, initial_quantity, created_at)
        VALUES (?, ?, 100000, 180.50, 175.00, 100, ?)`)
        .run(randomUUID(), tradeId, NOW);

      const preCounts = countAllTables(sqlite);
      assert(preCounts['trades'] >= 1, 'Round-trip: pre-restore trades >= 1');
      assert(preCounts['trade_executions'] >= 1, 'Round-trip: pre-restore executions >= 1');

      // Phase 2: Create backup ZIP
      const zipBuffer = await serializeBackupToZip(testDb);

      // Phase 3: Execute restore
      const snapshotDir = join(testDir, 'snapshots', 'pre-restore-roundtrip');
      const restoreResult = await doPostRestore(zipBuffer, { sqlite, db: testDb, dbPath, snapshotDir });
      assert(restoreResult.status === 200, 'Round-trip: restore returns 200');

      // Phase 4: Verify all tables match pre-restore counts
      const postCounts = countAllTables(sqlite);
      for (const { name } of TABLE_REGISTRY) {
        assert(
          postCounts[name] === preCounts[name],
          `Round-trip: table "${name}" has ${postCounts[name]} rows (expected ${preCounts[name]})`,
        );
      }

      // Phase 5: Verify specific data content was preserved
      const tradeRow = sqlite.prepare("SELECT * FROM trades WHERE trade_code = 'ROUND-TRIP-1'").get() as Record<string, unknown> | undefined;
      assert(tradeRow !== undefined, 'Round-trip: trade ROUND-TRIP-1 exists after restore');
      if (tradeRow) {
        assert(tradeRow['symbol'] === 'AAPL', 'Round-trip: symbol preserved');
        assert(tradeRow['direction'] === 'long', 'Round-trip: direction preserved');
      }
    } finally {
      sqlite.close();
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  // Test 7: Pre-restore snapshot exists after successful restore
  {
    const testDir = mkdtempSync(join(tmpdir(), 'restore-route-test-'));
    const dbPath = join(testDir, '.trading-journal', 'journal.db');
    const { sqlite, db: testDb } = createSchemaDb(dbPath);

    try {
      // Seed some data
      const accId = randomUUID();
      sqlite.prepare(`INSERT INTO accounts (id, name, currency, is_active, created_at, updated_at)
        VALUES (?, 'Snapshot Test', 'USD', 1, ?, ?)`)
        .run(accId, NOW, NOW);
      sqlite.prepare(`INSERT INTO trades (id, trade_code, account_id, symbol, direction, status, opened_at, created_at, updated_at)
        VALUES (?, 'SNAP-TEST', ?, 'GOOG', 'long', 'closed', ?, ?, ?)`)
        .run(randomUUID(), accId, NOW, NOW, NOW);

      const zipBuffer = await serializeBackupToZip(testDb);

      const snapshotDir = join(testDir, 'snapshots', 'pre-restore-snap-test');
      const result = await doPostRestore(zipBuffer, { sqlite, db: testDb, dbPath, snapshotDir });

      assert(result.status === 200, 'Snapshot: restore returns 200');

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
