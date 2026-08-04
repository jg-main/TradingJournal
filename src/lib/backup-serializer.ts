/**
 * backup-serializer.ts
 *
 * Per-table JSON serialization with a versioned manifest for backup.
 *
 * Queries all 22 database tables defined in the Drizzle schema, serializes
 * each table's rows to clean JSON with proper type handling (Drizzle ORM
 * automatically maps integer booleans <-> boolean, text dates <-> strings,
 * and real decimals <-> number), and produces a structured result with a
 * manifest containing:
 *   - schemaVersion: count of applied SQL migration files
 *   - backupTimestamp: ISO-8601 timestamp of backup creation
 *   - appVersion: version string from package.json
 *   - tables: per-table row counts
 *
 * Pattern: src/lib/export-csv.ts, src/lib/dashboard.ts
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type * as schemaTypes from '@/db/schema';
import * as tables from '@/db/schema';
import { BACKUP_TABLES } from './backup-tables';

// ── Types ───────────────────────────────────────────────────────────────

/**
 * Backup manifest describing the scope and origin of the backup.
 */
export interface BackupManifest {
  /** Number of SQL migration files applied (the schema version) */
  schemaVersion: number;
  /** ISO-8601 timestamp of when the backup was created */
  backupTimestamp: string;
  /** Application version from package.json */
  appVersion: string;
  /** Per-table row counts, keyed by snake_case table name */
  tables: Record<string, number>;
}

/**
 * Complete JSON backup payload.
 *
 * `manifest` describes the backup scope and version.
 * `tables` maps snake_case table names to arrays of serialized row objects.
 */
export interface BackupData {
  manifest: BackupManifest;
  tables: Record<string, unknown[]>;
}

// ── Version helpers ─────────────────────────────────────────────────────

/**
 * Read the app version from package.json.
 * Uses process.cwd() which points to the project root at runtime.
 */
function getAppVersion(): string {
  try {
    const pkgPath = join(process.cwd(), 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Count applied SQL migration files to derive the schema version.
 * Matches the set of .sql files under src/db/migrations/, which Drizzle
 * uses as its migration source of truth.
 */
export function getMigrationCount(): number {
  try {
    const migrationsDir = join(process.cwd(), 'src/db/migrations');
    const entries = readdirSync(migrationsDir);
    return entries.filter((f) => f.endsWith('.sql')).length;
  } catch {
    return 0;
  }
}

// ── Table registry ──────────────────────────────────────────────────────

/**
 * Ordered list of all user-data tables in the schema.
 *
 * Each entry maps a snake_case database name to its Drizzle table object,
 * used for both querying (db.select().from(ref)) and output naming.
 */
export interface BackupTableRegistration {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ref: any;
  /** Older backups from the same schema version may omit tables added here late. */
  optionalInExistingBackups?: boolean;
}

const TABLE_REFS: Record<string, unknown> = {
  app_profile: tables.appProfile,
  ai_settings: tables.aiSettings,
  market_data_settings: tables.marketDataSettings,
  schwab_tokens: tables.schwabTokens,
  settings: tables.settings,
  accounts: tables.accounts,
  instruments: tables.instruments,
  accounting_executions: tables.accountingExecutions,
  correction_lineage: tables.correctionLineage,
  accounting_migration_runs: tables.accountingMigrationRuns,
  accounting_migration_records: tables.accountingMigrationRecords,
  account_positions: tables.accountPositions,
  account_performance: tables.accountPerformance,
  valuation_marks: tables.valuationMarks,
  fifo_lots: tables.fifoLots,
  financial_events: tables.financialEvents,
  ledger_entries: tables.ledgerEntries,
  ledger_postings: tables.ledgerPostings,
  lot_matches: tables.lotMatches,
  lookup_values: tables.lookupValues,
  setup_definitions: tables.setupDefinitions,
  checklist_definitions: tables.checklistDefinitions,
  play_evaluation_fields: tables.playEvaluationFields,
  trades: tables.trades,
  trade_executions: tables.tradeExecutions,
  trade_risk_snapshots: tables.tradeRiskSnapshots,
  trade_stop_adjustments: tables.tradeStopAdjustments,
  trade_assets: tables.tradeAssets,
  trade_grades: tables.tradeGrades,
  trade_mistakes: tables.tradeMistakes,
  trade_check_results: tables.tradeCheckResults,
  position_price_snapshots: tables.positionPriceSnapshots,
  trade_assessment_snapshots: tables.tradeAssessmentSnapshots,
  watchlist_items: tables.watchlistItems,
  alert_log: tables.alertLog,
  account_transactions: tables.accountTransactions,
  account_rollforward: tables.accountRollforward,
  weekly_reviews: tables.weeklyReviews,
  review_action_items: tables.reviewActionItems,
  dashboard_views: tables.dashboardViews,
};

export const TABLE_REGISTRY: BackupTableRegistration[] = BACKUP_TABLES.map((table) => ({
  name: table.name,
  ref: TABLE_REFS[table.name],
  ...(('optionalInExistingBackups' in table && table.optionalInExistingBackups)
    ? { optionalInExistingBackups: true }
    : {}),
}));

/**
 * Number of tables registered in the schema.
 */
export const TABLE_COUNT = TABLE_REGISTRY.length;

// ── Serialization ───────────────────────────────────────────────────────

/**
 * Serialize all tables in the database to per-table JSON arrays with a
 * manifest.
 *
 * Every registered table must be readable for a backup to be considered
 * valid. A partial archive is more dangerous than a failed backup because it
 * can pass through restore validation and delete rows that were never saved.
 *
 * @param dbParam - A Drizzle ORM instance backed by better-sqlite3.
 * @returns BackupData containing the manifest and per-table row arrays.
 */
export async function serializeBackup(
  dbParam: ReturnType<typeof drizzle<typeof schemaTypes>>,
): Promise<BackupData> {
  const tablesData: Record<string, unknown[]> = {};
  const tableCounts: Record<string, number> = {};

  for (const { name, ref } of TABLE_REGISTRY) {
    try {
      const rows: unknown[] = await dbParam.select().from(ref);
      tablesData[name] = rows;
      tableCounts[name] = rows.length;
    } catch (error) {
      throw new Error(
        `Backup failed while reading table "${name}": ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    }
  }

  const manifest: BackupManifest = {
    schemaVersion: getMigrationCount(),
    backupTimestamp: new Date().toISOString(),
    appVersion: getAppVersion(),
    tables: tableCounts,
  };

  return { manifest, tables: tablesData };
}
