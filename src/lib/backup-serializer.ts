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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const TABLE_REGISTRY: { name: string; ref: any }[] = [
  { name: 'app_profile', ref: tables.appProfile },
  { name: 'ai_settings', ref: tables.aiSettings },
  { name: 'market_data_settings', ref: tables.marketDataSettings },
  { name: 'schwab_tokens', ref: tables.schwabTokens },
  { name: 'settings', ref: tables.settings },
  { name: 'accounts', ref: tables.accounts },
  { name: 'instruments', ref: tables.instruments },
  { name: 'accounting_executions', ref: tables.accountingExecutions },
  { name: 'account_positions', ref: tables.accountPositions },
  { name: 'account_performance', ref: tables.accountPerformance },
  { name: 'valuation_marks', ref: tables.valuationMarks },
  { name: 'fifo_lots', ref: tables.fifoLots },
  { name: 'financial_events', ref: tables.financialEvents },
  { name: 'ledger_entries', ref: tables.ledgerEntries },
  { name: 'ledger_postings', ref: tables.ledgerPostings },
  { name: 'lot_matches', ref: tables.lotMatches },
  { name: 'lookup_values', ref: tables.lookupValues },
  { name: 'setup_definitions', ref: tables.setupDefinitions },
  { name: 'checklist_definitions', ref: tables.checklistDefinitions },
  { name: 'play_evaluation_fields', ref: tables.playEvaluationFields },
  { name: 'trades', ref: tables.trades },
  { name: 'trade_executions', ref: tables.tradeExecutions },
  { name: 'trade_risk_snapshots', ref: tables.tradeRiskSnapshots },
  { name: 'trade_stop_adjustments', ref: tables.tradeStopAdjustments },
  { name: 'trade_assets', ref: tables.tradeAssets },
  { name: 'trade_grades', ref: tables.tradeGrades },
  { name: 'trade_mistakes', ref: tables.tradeMistakes },
  { name: 'trade_check_results', ref: tables.tradeCheckResults },
  { name: 'position_price_snapshots', ref: tables.positionPriceSnapshots },
  { name: 'trade_assessment_snapshots', ref: tables.tradeAssessmentSnapshots },
  { name: 'watchlist_items', ref: tables.watchlistItems },
  { name: 'account_transactions', ref: tables.accountTransactions },
  { name: 'account_rollforward', ref: tables.accountRollforward },
  { name: 'weekly_reviews', ref: tables.weeklyReviews },
  { name: 'review_action_items', ref: tables.reviewActionItems },
];

/**
 * Number of tables registered in the schema.
 */
export const TABLE_COUNT = TABLE_REGISTRY.length;

// ── Serialization ───────────────────────────────────────────────────────

/**
 * Serialize all tables in the database to per-table JSON arrays with a
 * manifest.
 *
 * Each table is queried independently so a failure in one table does not
 * prevent the others from being backed up. Failed tables record -1 in the
 * manifest and return an empty rows array.
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
    } catch {
      // Record failure rather than crashing the whole backup
      tablesData[name] = [];
      tableCounts[name] = -1;
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
