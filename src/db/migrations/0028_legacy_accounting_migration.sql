-- Migration: Add accounting_migration_runs and accounting_migration_records tables
--
-- These tables track the execution lifecycle of legacy-to-accounting migrations:
-- one row per run (per account), and one row per source record processed within that run.
--
-- accounting_migration_runs — Tracks each migration execution, its status,
--   source/target record counts, and a deterministic rebuild fingerprint.
-- accounting_migration_records — Per-record outcome for audit.  Each legacy
--   source row (account_transactions, trade_executions, position_price_snapshots)
--   produces exactly one record in this table per run, recording whether it was
--   mapped, anomalous, unsupported, or a duplicate.
--
-- Both tables are append-mostly: records are inserted during a run and never
-- modified.  A run can be rejected (rolled back) or completed.

-- ── Migration Runs ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS accounting_migration_runs (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK(status IN ('in_progress', 'completed', 'failed', 'rolled_back')),
  total_records INTEGER NOT NULL DEFAULT 0,
  mapped_count INTEGER NOT NULL DEFAULT 0,
  anomaly_count INTEGER NOT NULL DEFAULT 0,
  unsupported_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  rebuild_fingerprint TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (current_timestamp)
);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_migration_runs_account_id
  ON accounting_migration_runs(account_id);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_migration_runs_status
  ON accounting_migration_runs(status);

--> statement-breakpoint

-- ── Migration Records (per-source-row outcomes) ─────────────────────────

CREATE TABLE IF NOT EXISTS accounting_migration_records (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES accounting_migration_runs(id),
  source_table TEXT NOT NULL,
  source_id TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK(status IN ('mapped', 'anomaly', 'unsupported', 'duplicate')),
  record_type TEXT NOT NULL
    CHECK(record_type IN ('cash_event', 'execution', 'price_mark', 'unsupported')),
  anomaly_code TEXT,
  anomaly_field TEXT,
  anomaly_detail TEXT,
  idempotency_key TEXT,
  accounting_event_id TEXT,
  accounting_execution_id TEXT,
  accounting_mark_id TEXT,
  created_at TEXT NOT NULL DEFAULT (current_timestamp)
);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_migration_records_run_id
  ON accounting_migration_records(run_id);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_migration_records_source
  ON accounting_migration_records(source_table, source_id);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_migration_records_idempotency_key
  ON accounting_migration_records(idempotency_key) WHERE idempotency_key IS NOT NULL;

--> statement-breakpoint

-- ── Immutability Triggers for Migration Tables ──────────────────────────

-- NOTE: No BEFORE UPDATE trigger on accounting_migration_runs because the
-- runner transitions status from 'in_progress' to 'completed'/'failed' at the
-- end of a run. The records table remains fully immutable.

CREATE TRIGGER IF NOT EXISTS trg_migration_runs_prevent_delete
BEFORE DELETE ON accounting_migration_runs
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Cannot delete a migration run (table: accounting_migration_runs)');
END;

--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS trg_migration_records_prevent_update
BEFORE UPDATE ON accounting_migration_records
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Cannot update a migration record (table: accounting_migration_records)');
END;

--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS trg_migration_records_prevent_delete
BEFORE DELETE ON accounting_migration_records
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Cannot delete a migration record (table: accounting_migration_records)');
END;
