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
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import Database from 'better-sqlite3';
import { db, getSqliteHandle } from '@/db/index';
import { serializeBackup, TABLE_REGISTRY, getMigrationCount } from './backup-serializer';
import type { BackupManifest } from './backup-serializer';
import { rebuildPositions } from './positions/rebuild';

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

export const INSERT_ORDER: string[] = [
  'app_profile',
  'ai_settings',
  'market_data_settings',
  'schwab_tokens',
  'accounts',
  'settings',
  'instruments',
  'accounting_executions',
  'correction_lineage',
  'accounting_migration_runs',
  'accounting_migration_records',
  'account_positions',
  'account_performance',
  'valuation_marks',
  'fifo_lots',
  'financial_events',
  'ledger_entries',
  'ledger_postings',
  'lot_matches',
  'lookup_values',
  'setup_definitions',
  'checklist_definitions',
  'play_evaluation_fields',
  'trades',
  'trade_executions',
  'trade_risk_snapshots',
  'trade_stop_adjustments',
  'trade_assets',
  'trade_grades',
  'position_price_snapshots',
  'trade_assessment_snapshots',
  'trade_mistakes',
  'trade_check_results',
  'watchlist_items',
  'alert_log',
  'account_transactions',
  'account_rollforward',
  'weekly_reviews',
  'review_action_items',
  'dashboard_views',
];

/**
 * Reverse FK order for DELETE — children first, then parents.
 * Ensures no FK violations when PRAGMA foreign_keys = ON and deferred.
 */
export const DELETE_ORDER: string[] = [...INSERT_ORDER].reverse();

const IMMUTABLE_DELETE_TRIGGERS = [
  {
    name: 'trg_financial_events_prevent_delete',
    table: 'financial_events',
    error: 'Cannot delete a posted financial event (table: financial_events)',
  },
  {
    name: 'trg_ledger_entries_prevent_delete',
    table: 'ledger_entries',
    error: 'Cannot delete a posted ledger entry (table: ledger_entries)',
  },
  {
    name: 'trg_ledger_postings_prevent_delete',
    table: 'ledger_postings',
    error: 'Cannot delete a posted ledger posting (table: ledger_postings)',
  },
  {
    name: 'trg_accounting_executions_prevent_delete',
    table: 'accounting_executions',
    error: 'Cannot delete an accounting execution (table: accounting_executions)',
  },
  {
    name: 'trg_correction_lineage_prevent_delete',
    table: 'correction_lineage',
    error: 'Cannot delete a correction lineage record (table: correction_lineage)',
  },
  {
    name: 'trg_valuation_marks_prevent_delete',
    table: 'valuation_marks',
    error: 'Cannot delete a valuation mark (table: valuation_marks)',
  },
  {
    name: 'trg_migration_runs_prevent_delete',
    table: 'accounting_migration_runs',
    error: 'Cannot delete a migration run (table: accounting_migration_runs)',
  },
  {
    name: 'trg_migration_records_prevent_delete',
    table: 'accounting_migration_records',
    error: 'Cannot delete a migration record (table: accounting_migration_records)',
  },
] as const;

/**
 * Run a destructive maintenance transaction without weakening accounting
 * immutability after the transaction completes.
 *
 * SQLite schema changes participate in transactions. Dropping and recreating
 * the DELETE triggers inside the same transaction means a failure rolls the
 * trigger changes back together with the data changes. Recreating from the
 * canonical definitions also repairs databases affected by the former
 * restore implementation, which dropped these triggers permanently.
 */
export function runMaintenanceDeleteTransaction<T>(
  sqlite: Database.Database,
  operation: () => T,
): T {
  return sqlite.transaction(() => {
    for (const trigger of IMMUTABLE_DELETE_TRIGGERS) {
      sqlite.exec(`DROP TRIGGER IF EXISTS "${trigger.name}"`);
    }

    const result = operation();

    for (const trigger of IMMUTABLE_DELETE_TRIGGERS) {
      sqlite.exec(
        `CREATE TRIGGER "${trigger.name}"
         BEFORE DELETE ON "${trigger.table}"
         FOR EACH ROW
         BEGIN
           SELECT RAISE(ABORT, '${trigger.error}');
         END`,
      );
    }

    return result;
  })();
}

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
 * 4. All required tables present — compatibility entries may be absent from
 *    backups created before those tables were registered
 * 5. Data file integrity — each data file is valid JSON and row count matches manifest
 * 6. Ledger balance validation — sum of debits equals sum of credits in ledger_postings
 * 7. Open trades check — SELECT COUNT(*) FROM trades WHERE status = 'open' returns 0
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
  for (const { name, optionalInExistingBackups } of TABLE_REGISTRY) {
    if (!zip.getEntry(`data/${name}.json`)) {
      if (!optionalInExistingBackups) missingTables.push(name);
    }
  }
  if (missingTables.length > 0) {
    return {
      valid: false,
      error: 'Backup is missing data files',
      details: { missingTables },
    };
  }

  // Step 5: Data file integrity — validate JSON and row counts match manifest
  for (const { name } of TABLE_REGISTRY) {
    const entry = zip.getEntry(`data/${name}.json`);
    if (!entry) continue; // Already checked in Step 4

    let rows: unknown;
    try {
      const raw = entry.getData().toString('utf-8');
      rows = JSON.parse(raw);
    } catch {
      return {
        valid: false,
        error: `Corrupt data file: ${name}.json is not valid JSON`,
        details: { table: name },
      };
    }

    if (!Array.isArray(rows)) {
      return {
        valid: false,
        error: `Corrupt data file: ${name}.json is not a JSON array`,
        details: { table: name },
      };
    }

    // Verify row count matches manifest when manifest has a positive count
    const manifestCount = typedManifest.tables[name];
    if (typeof manifestCount === 'number' && manifestCount >= 0 && rows.length !== manifestCount) {
      return {
        valid: false,
        error: `Row count mismatch for ${name}: manifest says ${manifestCount}, data has ${rows.length}`,
        details: { table: name, expected: manifestCount, actual: rows.length },
      };
    }
  }

  // Step 6: Ledger balance validation
  const ledgerEntry = zip.getEntry('data/ledger_postings.json');
  if (ledgerEntry) {
    try {
      const raw = ledgerEntry.getData().toString('utf-8');
      const postings: Record<string, unknown>[] = JSON.parse(raw);

      if (!Array.isArray(postings)) {
        return {
          valid: false,
          error: 'Corrupt data file: ledger_postings.json is not a JSON array',
          details: { table: 'ledger_postings' },
        };
      }

      let debitTotal = 0;
      let creditTotal = 0;

      for (const posting of postings) {
        const side = posting.side;
        const amountMicros = typeof posting.amount_micros === 'number'
          ? posting.amount_micros
          : (typeof posting.amountMicros === 'number' ? posting.amountMicros : 0);

        if (side === 'debit') {
          debitTotal += amountMicros;
        } else if (side === 'credit') {
          creditTotal += amountMicros;
        }
      }

      if (debitTotal !== creditTotal) {
        return {
          valid: false,
          error: 'Unbalanced ledger: sum of debits does not equal sum of credits',
          details: {
            debitTotal,
            creditTotal,
            difference: debitTotal - creditTotal,
          },
        };
      }
    } catch {
      return {
        valid: false,
        error: 'Failed to validate ledger balance in backup',
        details: { table: 'ledger_postings' },
      };
    }
  }

  // Step 7: Open trades check
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

  // Step 2: Extract uploaded screenshot files before DB transaction
  // Use cwd (project root) which works in both dev and Docker environments.
  // Previously derived from DB path, which breaks in Docker where DB
  // lives at /data/journal.db but public/ is at /app/public.
  const uploadsDir = join(process.cwd(), 'public', 'uploads', 'trades');
  const zipAll = new AdmZip(zipBuffer);
  const uploadEntries = zipAll.getEntries().filter((e) => e.entryName.startsWith('uploads/'));
  if (uploadEntries.length > 0) {
    mkdirSync(uploadsDir, { recursive: true });
    for (const entry of uploadEntries) {
      const filename = entry.entryName.replace('uploads/', '');
      if (!filename || filename === '.gitkeep') continue;
      const targetPath = join(uploadsDir, filename);
      const data = entry.getData();
      writeFileSync(targetPath, data);
    }
    console.log(
      JSON.stringify({
        event: 'restore_uploads',
        fileCount: uploadEntries.length,
        uploadsDir,
      }),
    );
  }

  // Step 3–6: Transactional wipe-and-replace
  const sqlite = getSqliteHandle();
  const zip = new AdmZip(zipBuffer);

  let restoredTables = 0;
  let restoredRows = 0;

  // Defer FK constraint checking until commit.
  // PRAGMA defer_foreign_keys MUST be set before the transaction starts;
  // inside a BEGIN block it is a no-op in SQLite.
  sqlite.exec('PRAGMA defer_foreign_keys = ON');

  runMaintenanceDeleteTransaction(sqlite, () => {
    // DELETE all existing rows in reverse FK order
    for (const tableName of DELETE_ORDER) {
      sqlite.exec(`DELETE FROM "${tableName}"`);
    }

    // INSERT backup data in FK-safe order
    for (const tableName of INSERT_ORDER) {
      const entry = zip.getEntry(`data/${tableName}.json`);
      // Compatibility tables can be absent from backups created before they
      // were registered. Their current rows were still cleared above.
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
  });

  // Step 7: Rebuild FIFO position projections after restore.
  // After replacing accounting_executions with backup data, the FIFO positions,
  // lots, and lot_matches are stale projections. Rebuild them for every account
  // that has accounting_executions in the restored data.
  const accountsWithExecutions = sqlite
    .prepare('SELECT DISTINCT account_id FROM accounting_executions')
    .all() as { account_id: string }[];

  let rebuiltAccountCount = 0;
  let rebuiltExecutionCount = 0;
  let rebuiltLotCount = 0;
  let rebuiltMatchCount = 0;

  for (const { account_id } of accountsWithExecutions) {
    const result = rebuildPositions(sqlite, account_id);
    rebuiltAccountCount++;
    rebuiltExecutionCount += result.executionCount || 0;
    rebuiltLotCount += result.lotCount || 0;
    rebuiltMatchCount += result.matchCount || 0;
  }

  console.log(
    JSON.stringify({
      event: 'restore_rebuild',
      accountsRebuilt: rebuiltAccountCount,
      executionCount: rebuiltExecutionCount,
      lotCount: rebuiltLotCount,
      matchCount: rebuiltMatchCount,
    }),
  );

  return {
    success: true,
    snapshotPath,
    restoredTables,
    restoredRows,
  };
}
