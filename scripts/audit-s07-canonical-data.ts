#!/usr/bin/env tsx
/**
 * audit-s07-canonical-data.ts
 *
 * M007-S07 — canonical data audit and deterministic repair for
 * accounting_executions rows that still carry journal workflow aliases
 * (`add` / `reduce`).
 *
 * This is the operator-facing tool for the S07 audit. It:
 *
 *   1. Opens the journal database directly (better-sqlite3, WAL mode) —
 *      no Next.js, no server, no network, no migrations.
 *   2. Captures a BEFORE snapshot of un-repaired alias rows via
 *      `findAliasExecutions`, resolving each row's trade direction from
 *      `trades.direction` through `journal_trade_id`.
 *   3. Runs `repairAliasExecutions` (non-dry-run) when alias rows exist.
 *      The repair is the immutable correction pattern (reversal +
 *      replacement + correction_lineage + in-transaction projection
 *      rebuilds) and is internally idempotent — re-runs repair zero rows.
 *   4. Captures an AFTER snapshot (expects 0 un-repaired alias rows) plus
 *      the correction_lineage records this run created.
 *   5. Prints a structured JSON report between the AUDIT_JSON_BEGIN /
 *      AUDIT_JSON_END markers on stdout, and a human-readable summary to
 *      stderr.
 *
 * Constraints:
 *   - The only writes are the repair records created through
 *     `repairAliasExecutions` — schema is never dropped or mutated.
 *   - When no alias rows exist the script performs ZERO writes
 *     (behaviorally read-only) and reports verdict "clean".
 *   - Unresolvable alias rows (no linked trade / no direction) are
 *     reported as anomalies and never guessed — the audit exits 1 so the
 *     operator must resolve them by hand.
 *
 * Exit codes:
 *   0 — clean (no alias rows) or successfully repaired
 *   1 — anomalies remaining, or a runtime error (missing DB, repair failure)
 *
 * Usage:
 *   npx tsx scripts/audit-s07-canonical-data.ts
 *   npx tsx scripts/audit-s07-canonical-data.ts --db /path/to/journal.db
 *   DB_FILE_NAME=/path/to/journal.db npx tsx scripts/audit-s07-canonical-data.ts
 *
 * Note: `__dirname` is used instead of `import.meta.dirname` because the
 * repository is a CommonJS package and tsx (CJS output) leaves
 * import.meta.dirname undefined at runtime (verified empirically) —
 * `__dirname` resolves identically for this script's location.
 */

import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import path from 'node:path';

import {
  findAliasExecutions,
  repairAliasExecutions,
  type AliasExecutionRow,
  type AliasRepairDetail,
} from '../src/lib/accounting/repair-alias-executions';

// ── Path resolution ──────────────────────────────────────────────────────

/**
 * Resolve the journal database path. Precedence:
 *   1. `--db PATH` (or `--db=PATH`) CLI argument
 *   2. DB_FILE_NAME environment variable (consistent with the other scripts)
 *   3. Default: <repo>/.trading-journal/journal.db
 */
function resolveDbPath(): string {
  const argv = process.argv.slice(2);
  let fromArg: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--db' && argv[i + 1]) {
      fromArg = argv[i + 1];
      break;
    }
    if (a.startsWith('--db=')) {
      fromArg = a.slice('--db='.length);
      break;
    }
  }
  if (fromArg) return path.resolve(fromArg);
  if (process.env.DB_FILE_NAME) return path.resolve(process.env.DB_FILE_NAME);
  return path.resolve(__dirname, '..', '.trading-journal', 'journal.db');
}

// ── Snapshot helpers ─────────────────────────────────────────────────────

/** Resolve a trade's position direction for a journal_trade_id (null when
 *  no linkage or the linked trade is missing — the caller reports this). */
function resolveTradeDirection(
  sqlite: Database.Database,
  journalTradeId: string | null,
): 'long' | 'short' | null {
  if (!journalTradeId) return null;
  const trade = sqlite
    .prepare('SELECT direction FROM trades WHERE id = ?')
    .get(journalTradeId) as { direction: 'long' | 'short' } | undefined;
  return trade?.direction ?? null;
}

/** Before/after evidence row for one (un-repaired) alias execution. */
interface AliasEvidenceRow {
  id: string;
  accountId: string;
  instrumentId: string;
  action: string;
  quantity: string;
  price: string;
  journalTradeId: string | null;
  postedAt: string;
  /** Trade direction resolved via trades.direction; null when unresolvable. */
  resolvedDirection: 'long' | 'short' | null;
}

function toEvidenceRow(
  sqlite: Database.Database,
  row: AliasExecutionRow,
): AliasEvidenceRow {
  return {
    id: row.id,
    accountId: row.account_id,
    instrumentId: row.instrument_id,
    action: row.action,
    quantity: row.quantity,
    price: row.price,
    journalTradeId: row.journal_trade_id,
    postedAt: row.posted_at,
    resolvedDirection: resolveTradeDirection(sqlite, row.journal_trade_id),
  };
}

interface LineageEvidence {
  originalId: string;
  reversalId: string;
  replacementId: string;
  reason: string | null;
}

/** Fetch the correction_lineage rows this run created (ground truth from the
 *  DB, keyed on the lineage ids returned by the repair result). */
function collectRepairLineage(
  sqlite: Database.Database,
  details: AliasRepairDetail[],
): LineageEvidence[] {
  const lineageIds = details
    .map((d) => d.lineageId)
    .filter((id): id is string => id !== null);
  const stmt = sqlite.prepare(
    `SELECT original_execution_id, reversal_execution_id, replacement_execution_id, reason
     FROM correction_lineage WHERE id = ?`,
  );
  const lineage: LineageEvidence[] = [];
  for (const id of lineageIds) {
    const row = stmt.get(id) as
      | {
          original_execution_id: string;
          reversal_execution_id: string;
          replacement_execution_id: string;
          reason: string | null;
        }
      | undefined;
    if (!row) continue; // defensive: id came from the repair result
    lineage.push({
      originalId: row.original_execution_id,
      reversalId: row.reversal_execution_id,
      replacementId: row.replacement_execution_id,
      reason: row.reason ?? null,
    });
  }
  return lineage;
}

// ── Main ─────────────────────────────────────────────────────────────────

function main(): number {
  const dbPath = resolveDbPath();
  if (!existsSync(dbPath)) {
    console.error(`[audit-s07] database not found at ${dbPath} — nothing to audit`);
    return 1;
  }

  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  try {
    // ── Before snapshot ────────────────────────────────────────────────
    const beforeRows = findAliasExecutions(sqlite).map((r) => toEvidenceRow(sqlite, r));
    const before = { aliasCount: beforeRows.length, rows: beforeRows };

    // ── Repair (skipped entirely when nothing to repair → zero writes) ─
    let repair: {
      scanned: number;
      repaired: number;
      skipped: number;
      anomalies: Array<{ executionId: string; action: string; reason: string }>;
      details: AliasRepairDetail[];
    };
    let error: string | null = null;
    if (beforeRows.length === 0) {
      repair = { scanned: 0, repaired: 0, skipped: 0, anomalies: [], details: [] };
    } else {
      try {
        const result = repairAliasExecutions(sqlite);
        repair = {
          scanned: result.scanned,
          repaired: result.repaired,
          skipped: result.skipped,
          anomalies: result.anomalies,
          details: result.details,
        };
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        // The repair may have committed some rows before failing (per-row
        // transactions); the after snapshot below reveals what remains.
        repair = {
          scanned: beforeRows.length,
          repaired: 0,
          skipped: 0,
          anomalies: [],
          details: [],
        };
      }
    }

    // ── After snapshot ─────────────────────────────────────────────────
    const afterRows = findAliasExecutions(sqlite).map((r) => toEvidenceRow(sqlite, r));
    const after = { aliasCount: afterRows.length, rows: afterRows };

    // ── Lineage evidence for this run's repairs ────────────────────────
    const lineage = collectRepairLineage(sqlite, repair.details);

    // ── Verdict ────────────────────────────────────────────────────────
    let verdict: 'clean' | 'repaired' | 'anomalies-remaining' | 'error';
    let exitCode: number;
    if (error) {
      verdict = 'error';
      exitCode = 1;
    } else if (after.aliasCount > 0 || repair.anomalies.length > 0) {
      // Any remaining un-repaired alias row (the effective invariant) means
      // the audit cannot certify the canonical-data gate.
      verdict = 'anomalies-remaining';
      exitCode = 1;
    } else if (before.aliasCount === 0) {
      verdict = 'clean';
      exitCode = 0;
    } else {
      verdict = 'repaired';
      exitCode = 0;
    }

    // ── Structured JSON report (stdout, marker-delimited) ──────────────
    const report = {
      tool: 'audit-s07-canonical-data',
      task: 'T02',
      slice: 'S07',
      milestone: 'M007-lylc7d',
      runAt: new Date().toISOString(),
      database: dbPath,
      before,
      repair: {
        scanned: repair.scanned,
        repaired: repair.repaired,
        skipped: repair.skipped,
        anomalies: repair.anomalies,
        details: repair.details,
      },
      after,
      lineage,
      verdict,
      ...(error ? { error } : {}),
    };

    console.log('AUDIT_JSON_BEGIN');
    console.log(JSON.stringify(report, null, 2));
    console.log('AUDIT_JSON_END');

    // ── Human-readable summary (stderr) ────────────────────────────────
    console.error(`[audit-s07] database: ${dbPath}`);
    console.error(`[audit-s07] alias rows before: ${before.aliasCount}`);
    if (beforeRows.length === 0) {
      console.error('[audit-s07] no alias rows — nothing to repair (read-only pass)');
    } else {
      console.error(
        `[audit-s07] repair: scanned=${repair.scanned} repaired=${repair.repaired} ` +
          `skipped=${repair.skipped} anomalies=${repair.anomalies.length}`,
      );
      for (const a of repair.anomalies) {
        console.error(`[audit-s07]   anomaly ${a.executionId} (${a.action}): ${a.reason}`);
      }
    }
    console.error(`[audit-s07] alias rows after: ${after.aliasCount}`);
    console.error(`[audit-s07] lineage records written: ${lineage.length}`);
    if (error) console.error(`[audit-s07] error: ${error}`);
    console.error(`[audit-s07] verdict: ${verdict}`);

    return exitCode;
  } finally {
    sqlite.close();
  }
}

const exitCode = main();
process.exit(exitCode);
