#!/usr/bin/env tsx
/**
 * accounting-migrate.ts
 *
 * Safe CLI for operating the legacy accounting migration pipeline.
 *
 * Commands:
 *   migrate <accountId>         Run a full legacy migration (read legacy,
 *                                write accounting, rebuild projections).
 *     --dry-run                 Count records but do not write anything.
 *   reconcile <accountId>       Compute a reconciliation report comparing
 *                                legacy source data against rebuilt projections.
 *   cutover-check <accountId>   Gate: refuse cutover (exit 1) when unexplained
 *                                differences exist or no migration run completed.
 *   rebuild <accountId>         Re-run the migration (idempotent — skips already-
 *                                imported records, rebuilds projections).
 *
 * All commands output structured JSON to stdout.
 * Exit codes:
 *   0 — success / cutover eligible
 *   1 — anomalies detected / cutover refused / reconciliation has unexplained diffs
 *   2 — runtime error (account not found, database error, etc.)
 *
 * The database is opened at the path in DB_FILE_NAME env var, or the default
 * ./.trading-journal/journal.db.  Pending migrations are auto-applied on open.
 *
 * Run: npx tsx scripts/accounting-migrate.ts migrate <accountId>
 *      npx tsx scripts/accounting-migrate.ts reconcile <accountId>
 *      npx tsx scripts/accounting-migrate.ts cutover-check <accountId>
 *      npx tsx scripts/accounting-migrate.ts rebuild <accountId>
 *
 * @module accounting-migrate
 */

import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// Module Imports — Library Functions
// ═══════════════════════════════════════════════════════════════════════════

// We cannot import from '@/db' because it has 'server-only' and uses Next.js
// drizzle integration.  Instead we open a raw SQLite handle and apply migrations
// ourselves, following the same pattern as the test suite.
import { runLegacyMigration } from '../src/lib/accounting/legacy-migration-runner';
import { computeReconciliation } from '../src/lib/accounting/reconciliation';
import { accountExists } from '../src/db/accounting-repository';

// ═══════════════════════════════════════════════════════════════════════════
// Database Initialisation
// ═══════════════════════════════════════════════════════════════════════════

const DB_FILE = process.env.DB_FILE_NAME || './.trading-journal/journal.db';

/**
 * Open the database and apply pending migrations.
 *
 * Mirrors the auto-apply logic in src/db/index.ts but without the
 * 'server-only' constraint or Drizzle ORM integration.
 */
function openDatabase(): Database.Database {
  mkdirSync(dirname(DB_FILE), { recursive: true });

  const sqlite = new Database(DB_FILE);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  // Auto-apply pending migrations (same logic as src/db/index.ts)
  const migrationsDir = join(process.cwd(), 'src/db/migrations');
  const metaPath = join(migrationsDir, 'meta', '_journal.json');

  try {
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as {
      entries: { tag: string }[];
    };
    sqlite.exec(
      'CREATE TABLE IF NOT EXISTS __drizzle_migrations (' +
        'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
        'hash TEXT NOT NULL, ' +
        'created_at TEXT)',
    );
    const insert = sqlite.prepare(
      "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, datetime('now'))",
    );
    for (const entry of meta.entries) {
      const tag = entry.tag;
      const existing = sqlite
        .prepare('SELECT id FROM __drizzle_migrations WHERE hash = ?')
        .get(tag);
      if (existing) continue;
      const sql = readFileSync(join(migrationsDir, tag + '.sql'), 'utf8');
      sqlite.exec('BEGIN');
      try {
        sqlite.exec(sql);
        insert.run(tag);
        sqlite.exec('COMMIT');
      } catch (e) {
        sqlite.exec('ROLLBACK');
        throw e;
      }
    }
  } catch (e) {
    console.error(
      '[accounting-migrate] Migration error:',
      e instanceof Error ? e.message : e,
    );
    // Non-fatal — the database may already be at the latest schema
  }

  return sqlite;
}

// ═══════════════════════════════════════════════════════════════════════════
// Argument Parsing
// ═══════════════════════════════════════════════════════════════════════════

interface ParsedArgs {
  command: string;
  accountId: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2); // skip "tsx" and script path

  if (args.length < 2) {
    console.error(
      'Usage: npx tsx scripts/accounting-migrate.ts <command> <accountId> [--dry-run]',
    );
    console.error('Commands: migrate, rebuild, reconcile, cutover-check');
    process.exit(2);
  }

  const command = args[0];
  const accountId = args[1];
  const dryRun = args.includes('--dry-run');

  if (!['migrate', 'rebuild', 'reconcile', 'cutover-check'].includes(command)) {
    console.error(`Unknown command: "${command}"`);
    console.error('Valid commands: migrate, rebuild, reconcile, cutover-check');
    process.exit(2);
  }

  // Validate UUID format for accountId
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(accountId)) {
    console.error(
      `Warning: "${accountId}" does not look like a valid UUID. Proceeding anyway.`,
    );
  }

  return { command, accountId, dryRun };
}

// ═══════════════════════════════════════════════════════════════════════════
// Command Handlers
// ═══════════════════════════════════════════════════════════════════════════

interface CommandResult {
  success: boolean;
  exitCode: number;
  output: Record<string, unknown>;
}

/**
 * Run migration for an account.
 * Supports dry-run mode that counts records without writing.
 */
function handleMigrate(
  sqlite: Database.Database,
  accountId: string,
  dryRun: boolean,
): CommandResult {
  if (!accountExists(sqlite, accountId)) {
    return {
      success: false,
      exitCode: 2,
      output: { error: 'Account not found', accountId },
    };
  }

  const result = runLegacyMigration({ sqlite, accountId }, { dryRun });

  if (result.status === 'failed') {
    return {
      success: false,
      exitCode: 2,
      output: {
        command: dryRun ? 'migrate --dry-run' : 'migrate',
        accountId,
        status: result.status,
        errorMessage: result.errorMessage,
      },
    };
  }

  const hasAnomalies = result.anomalyCount > 0;
  const hasUnsupported = result.unsupportedCount > 0;

  return {
    success: !hasAnomalies && !hasUnsupported,
    exitCode: hasAnomalies || hasUnsupported ? 1 : 0,
    output: {
      command: dryRun ? 'migrate --dry-run' : 'migrate',
      accountId,
      status: result.status,
      runId: result.runId,
      dryRun,
      totalRecords: result.totalRecords,
      mappedCount: result.mappedCount,
      anomalyCount: result.anomalyCount,
      unsupportedCount: result.unsupportedCount,
      duplicateCount: result.duplicateCount,
      rebuildFingerprint: result.rebuildFingerprint,
      hasAnomalies,
      hasUnsupported,
    },
  };
}

/**
 * Rebuild projections by re-running migration (idempotent).
 * The migration skips already-imported records so this is safe.
 */
function handleRebuild(
  sqlite: Database.Database,
  accountId: string,
): CommandResult {
  if (!accountExists(sqlite, accountId)) {
    return {
      success: false,
      exitCode: 2,
      output: { error: 'Account not found', accountId },
    };
  }

  const result = runLegacyMigration({ sqlite, accountId });

  if (result.status === 'failed') {
    return {
      success: false,
      exitCode: 2,
      output: {
        command: 'rebuild',
        accountId,
        status: result.status,
        errorMessage: result.errorMessage,
      },
    };
  }

  return {
    success: true,
    exitCode: 0,
    output: {
      command: 'rebuild',
      accountId,
      status: result.status,
      runId: result.runId,
      rebuildFingerprint: result.rebuildFingerprint,
      totalRecords: result.totalRecords,
      newRecords: result.mappedCount,
      anomalyCount: result.anomalyCount,
      unsupportedCount: result.unsupportedCount,
      duplicateCount: result.duplicateCount,
    },
  };
}

/**
 * Compute and display a reconciliation report.
 */
function handleReconcile(
  sqlite: Database.Database,
  accountId: string,
): CommandResult {
  if (!accountExists(sqlite, accountId)) {
    return {
      success: false,
      exitCode: 2,
      output: { error: 'Account not found', accountId },
    };
  }

  const report = computeReconciliation(sqlite, accountId);

  if (!report) {
    return {
      success: false,
      exitCode: 2,
      output: {
        command: 'reconcile',
        accountId,
        error:
          'No completed migration runs exist for this account. ' +
          'Run migration first.',
      },
    };
  }

  const hasUnexplained = report.totals.unexplained > 0;

  return {
    success: !hasUnexplained,
    exitCode: hasUnexplained ? 1 : 0,
    output: {
      command: 'reconcile',
      accountId,
      runId: report.runId,
      runStatus: report.runStatus,
      rebuildFingerprint: report.rebuildFingerprint,
      computedAt: report.computedAt,
      totals: report.totals,
      cutoverEligible: report.cutoverEligible,
      cutoverRefusalReasons: report.cutoverRefusalReasons,
      comparisons: report.comparisons,
      anomalies: report.anomalies,
      recordStatusCounts: report.recordStatusCounts,
    },
  };
}

/**
 * Cutover eligibility gate.
 * Refuses (exit 1) when unexplained differences exist or no migration run completed.
 */
function handleCutoverCheck(
  sqlite: Database.Database,
  accountId: string,
): CommandResult {
  if (!accountExists(sqlite, accountId)) {
    return {
      success: false,
      exitCode: 2,
      output: { error: 'Account not found', accountId },
    };
  }

  const report = computeReconciliation(sqlite, accountId);

  if (!report) {
    return {
      success: false,
      exitCode: 1,
      output: {
        command: 'cutover-check',
        accountId,
        cutoverEligible: false,
        refusalReasons: [
          'No completed migration runs exist for this account. Run migration first.',
        ],
      },
    };
  }

  return {
    success: report.cutoverEligible,
    exitCode: report.cutoverEligible ? 0 : 1,
    output: {
      command: 'cutover-check',
      accountId,
      runId: report.runId,
      runStatus: report.runStatus,
      rebuildFingerprint: report.rebuildFingerprint,
      cutoverEligible: report.cutoverEligible,
      refusalReasons: report.cutoverRefusalReasons,
      totals: report.totals,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════

function main(): void {
  const { command, accountId, dryRun } = parseArgs(process.argv);

  let sqlite: Database.Database;
  try {
    sqlite = openDatabase();
  } catch (e) {
    console.error(
      'Failed to open database:',
      e instanceof Error ? e.message : String(e),
    );
    process.exit(2);
  }

  let result: CommandResult;

  try {
    switch (command) {
      case 'migrate':
        result = handleMigrate(sqlite, accountId, dryRun);
        break;
      case 'rebuild':
        result = handleRebuild(sqlite, accountId);
        break;
      case 'reconcile':
        result = handleReconcile(sqlite, accountId);
        break;
      case 'cutover-check':
        result = handleCutoverCheck(sqlite, accountId);
        break;
      default:
        // Already validated in parseArgs, but satisfy the exhaustiveness check
        console.error(`Unknown command: ${command}`);
        process.exit(2);
    }
  } catch (e) {
    console.error(
      JSON.stringify({
        command,
        accountId,
        error: e instanceof Error ? e.message : String(e),
      }),
    );
    process.exit(2);
  } finally {
    sqlite.close();
  }

  // Output structured JSON to stdout
  console.log(JSON.stringify(result.output, null, 2));
  process.exit(result.exitCode);
}

main();
