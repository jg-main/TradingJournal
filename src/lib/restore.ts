/**
 * restore.ts
 *
 * Core restore library for the Trading Journal.
 *
 * Validates backup ZIPs, previews their contents, and performs full
 * transactional wipe-and-replace restores with FK-safe insertion ordering.
 *
 * Three exported functions:
 *   - validateRestoreZip(zipBuffer)   — fail-fast validation in 5 steps
 *   - previewRestore(zipBuffer)       — validate + return manifest (no mutation)
 *   - executeRestore(zipBuffer)       — snapshot, wipe, insert in transaction
 *
 * Pattern: src/lib/backup-serializer.ts, src/lib/create-backup.ts
 */

import AdmZip from 'adm-zip';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { db, getSqliteHandle } from '@/db/index';
import { serializeBackup, TABLE_REGISTRY, getMigrationCount } from './backup-serializer';
import type { BackupManifest } from './backup-serializer';

// ── Configuration ───────────────────────────────────────────────────────

function getDbFilePath(): string {
  return process.env.DB_FILE_NAME || './.trading-journal/journal.db';
}

function getSnapshotDir(): string {
  const dbPath = getDbFilePath();
  const journalDir = dirname(dbPath); // .trading-journal/
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return join(journalDir, 'snapshots', `pre-restore-${timestamp}`);
}

// ── FK-safe Insertion Order ─────────────────────────────────────────────
//
// Derived from the Drizzle schema FK graph by topological sort.
// Parents first, children last — guarantees FK satisfaction at INSERT time
// when PRAGMA foreign_keys = ON.

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

/**
 * Reverse FK order for DELETE — children first, then parents.
 * Ensures no FK violations when PRAGMA foreign_keys = ON and deferred.
 */
export const DELETE_ORDER: string[] = [...INSERT_ORDER].reverse();

// ── Internal Helpers ────────────────────────────────────────────────────

/**
 * Convert a camelCase string to snake_case.
 *
 * Drizzle ORM serialises row objects with camelCase property names
 * when using `select()`. SQLite table columns are snake_case, so
 * the dynamic INSERT builder must map between the two.
 *
 * Example: isActive -> is_active, startingBalance -> starting_balance
 */
function camelToSnake(str: string): string {
  // Drizzle ORM converts snake_case SQLite column names like
  // planned_target_1 to camelCase plannedTarget1. To reverse this
  // we must insert underscores before:
  //   1. Uppercase letters preceded by lowercase or digit
  //   2. Digits preceded by lowercase letters
  // Then lowercase the whole result.
  return str
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([a-zA-Z])(\d)/g, '$1_$2')
    .toLowerCase();
}

/**
 * Check whether any trades are currently open.
 * The restore refuses to proceed if open trades exist, to prevent data loss.
 */
function checkOpenTrades():
  | { valid: true }
  | { valid: false; error: string; details: unknown } {
  const sqlite = getSqliteHandle();
  const row = sqlite
    .prepare("SELECT COUNT(*) AS count FROM trades WHERE status = 'open'")
    .get() as { count: number };

  if (row.count > 0) {
    return {
      valid: false,
      error: 'Cannot restore while trades are open',
      details: { openTradeCount: row.count },
    };
  }
  return { valid: true };
}

// ── Validation ──────────────────────────────────────────────────────────

/**
 * Validate a backup ZIP for restore readiness.
 *
 * Checks in fail-fast order:
 * 1. ZIP integrity — open with adm-zip, catch errors
 * 2. Manifest exists — manifest.json present and valid JSON matching BackupManifest
 * 3. Schema version match — manifest.schemaVersion === getMigrationCount()
 * 4. All tables present — every TABLE_REGISTRY entry has data/<name>.json in ZIP
 * 5. Open trades check — SELECT COUNT(*) FROM trades WHERE status = 'open' returns 0
 *
 * @returns { valid: true } on success, or { valid: false, error, details } on failure
 */
export function validateRestoreZip(
  zipBuffer: Buffer,
):
  | { valid: true }
  | { valid: false; error: string; details?: unknown } {
  // Step 1: ZIP integrity
  let zip: AdmZip;
  try {
    zip = new AdmZip(zipBuffer);
  } catch (err) {
    return {
      valid: false,
      error: 'Invalid backup file',
      details: err instanceof Error ? err.message : 'Failed to open ZIP archive',
    };
  }

  // Step 2: Manifest exists and is valid JSON
  const manifestEntry = zip.getEntry('manifest.json');
  if (!manifestEntry) {
    return {
      valid: false,
      error: 'Missing manifest.json in backup',
    };
  }

  let manifest: unknown;
  try {
    const raw = manifestEntry.getData().toString('utf-8');
    manifest = JSON.parse(raw);
  } catch (err) {
    return {
      valid: false,
      error: 'Invalid manifest.json',
      details: err instanceof Error ? err.message : 'Failed to parse manifest',
    };
  }

  // Validate required manifest fields
  if (
    !manifest ||
    typeof manifest !== 'object' ||
    typeof (manifest as Record<string, unknown>).schemaVersion !== 'number' ||
    typeof (manifest as Record<string, unknown>).backupTimestamp !== 'string'
  ) {
    return {
      valid: false,
      error: 'Invalid manifest format',
      details: 'manifest.json missing required fields (schemaVersion, backupTimestamp)',
    };
  }

  const typedManifest = manifest as BackupManifest;

  // Step 3: Schema version match
  const currentVersion = getMigrationCount();
  if (typedManifest.schemaVersion !== currentVersion) {
    return {
      valid: false,
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
      valid: false,
      error: 'Backup is missing data files',
      details: { missingTables },
    };
  }

  // Step 5: Open trades check
  const openCheck = checkOpenTrades();
  if (!openCheck.valid) {
    return openCheck;
  }

  return { valid: true };
}

// ── Preview (read-only) ─────────────────────────────────────────────────

/**
 * Preview a backup ZIP file.
 *
 * Validates the ZIP (all 5 gates from validateRestoreZip) and returns the
 * manifest with per-table row counts. Does NOT mutate the database.
 *
 * @returns { manifest: BackupManifest }
 * @throws An object with { error, details } on validation failure
 */
export function previewRestore(zipBuffer: Buffer): { manifest: BackupManifest } {
  const validation = validateRestoreZip(zipBuffer);
  if (!validation.valid) {
    // Throw error object matching the API contract so route handlers
    // can catch and return it directly
    throw { error: validation.error, details: validation.details };
  }

  const zip = new AdmZip(zipBuffer);
  const raw = zip.readAsText('manifest.json');
  const manifest = JSON.parse(raw) as BackupManifest;
  return { manifest };
}

// ── Execute Restore (transactional) ─────────────────────────────────────

/**
 * Execute a full transactional restore from a backup ZIP.
 *
 * Steps:
 * 1. Pre-validate the ZIP (all 5 gates)
 * 2. Create a pre-restore snapshot in .trading-journal/snapshots/pre-restore-<timestamp>/
 * 3. Wrap the entire wipe-and-replace in a SQLite transaction
 *    - PRAGMA defer_foreign_keys = ON for FK-safe deletes
 *    - DELETE all rows from all tables in reverse FK order
 *    - INSERT backup data in FK-safe order with PRAGMA foreign_keys = ON
 * 4. Commit on success; auto-rollback on any failure
 *
 * @returns { success: true, snapshotPath, restoredTables, restoredRows }
 * @throws An object with { error, details } on failure
 */
export async function executeRestore(
  zipBuffer: Buffer,
  dbPath?: string,
): Promise<{
  success: true;
  snapshotPath: string;
  restoredTables: number;
  restoredRows: number;
}> {
  // Step 0: Pre-validate
  const validation = validateRestoreZip(zipBuffer);
  if (!validation.valid) {
    throw { error: validation.error, details: validation.details };
  }

  // Step 1: Create pre-restore snapshot
  let snapshotPath: string;
  try {
    const snapshotDir = getSnapshotDir();
    mkdirSync(snapshotDir, { recursive: true });

    // Use serializeBackup with the existing Drizzle ORM instance
    const backupData = await serializeBackup(db);

    // Build the snapshot ZIP using adm-zip
    const snapshotZip = new AdmZip();
    snapshotZip.addFile(
      'manifest.json',
      Buffer.from(JSON.stringify(backupData.manifest, null, 2), 'utf-8'),
    );
    for (const { name } of TABLE_REGISTRY) {
      const rows = backupData.tables[name] ?? [];
      snapshotZip.addFile(
        `data/${name}.json`,
        Buffer.from(JSON.stringify(rows, null, 2), 'utf-8'),
      );
    }

    snapshotPath = join(snapshotDir, 'backup.zip');
    snapshotZip.writeZip(snapshotPath);
  } catch (err) {
    throw {
      error: 'Failed to create pre-restore snapshot',
      details: err instanceof Error ? err.message : String(err),
    };
  }

  // Step 2–6: Transactional wipe-and-replace
  const sqlite = getSqliteHandle();
  const zip = new AdmZip(zipBuffer);

  let restoredTables = 0;
  let restoredRows = 0;

  sqlite.transaction(() => {
    // Defer FK constraint checking until commit.
    // This allows DELETE in any order (children then parents) while keeping
    // PRAGMA foreign_keys = ON. FK violations are caught at commit time.
    sqlite.exec('PRAGMA defer_foreign_keys = ON');

    // DELETE all existing rows in reverse FK order
    for (const tableName of DELETE_ORDER) {
      sqlite.exec(`DELETE FROM "${tableName}"`);
    }

    // INSERT backup data in FK-safe order
    for (const tableName of INSERT_ORDER) {
      const entry = zip.getEntry(`data/${tableName}.json`);
      // Defensive: skip if entry is missing (validation guaranteed all exist)
      if (!entry) continue;

      const raw = entry.getData().toString('utf-8');
      const rows: Record<string, unknown>[] = JSON.parse(raw);

      if (rows.length === 0) continue;

      // Build a parameterised INSERT dynamically from the column names
      // of the first row. All rows in a table share the same shape.
      //
      // Drizzle ORM serialises row objects with camelCase property names
      // (e.g. "isActive"), but the SQLite columns are snake_case
      // (e.g. "is_active"). We map camelCase keys to snake_case column
      // names for the SQL statement while using the original keys to
      // extract values from the row objects.
      const originalKeys = Object.keys(rows[0]);
      const columnNames = originalKeys.map(camelToSnake);
      const quotedColumns = columnNames.map((c) => `"${c}"`).join(', ');
      const placeholders = columnNames.map(() => '?').join(', ');
      const stmt = sqlite.prepare(
        `INSERT INTO "${tableName}" (${quotedColumns}) VALUES (${placeholders})`,
      );

      for (const row of rows) {
        const values = originalKeys.map((key) => {
          const val = row[key];
          // Drizzle serialises boolean columns as JS booleans via select()
          // which end up in JSON as true/false. better-sqlite3 cannot bind
          // booleans — convert them to 0/1 integers.
          if (typeof val === 'boolean') return val ? 1 : 0;
          // Preserve null vs undefined — SQLite treats both as NULL
          return val ?? null;
        });
        stmt.run(...values);
      }

      restoredTables++;
      restoredRows += rows.length;
    }
  })();

  return {
    success: true,
    snapshotPath,
    restoredTables,
    restoredRows,
  };
}
