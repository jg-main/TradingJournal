-- Migration: Add correction_lineage table
--
-- Tracks execution corrections that follow the reversal-and-replacement pattern.
-- Every correction links an original execution to its reversal and replacement
-- executions, preserving full audit lineage.
--
-- The original execution is never modified. The reversal execution mirrors the
-- original with opposite action and same quantity/price, effectively cancelling
-- the original's economic effect. The replacement execution carries the corrected
-- values. FIFO positions and performance projections are rebuilt after each
-- correction to reflect the new execution stream.

-- ── Correction Lineage ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS correction_lineage (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  original_execution_id TEXT NOT NULL REFERENCES accounting_executions(id),
  reversal_execution_id TEXT NOT NULL REFERENCES accounting_executions(id),
  replacement_execution_id TEXT NOT NULL REFERENCES accounting_executions(id),
  idempotency_key TEXT UNIQUE,
  reason TEXT,
  corrected_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (current_timestamp)
);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_correction_lineage_account_id
  ON correction_lineage(account_id);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_correction_lineage_original_execution_id
  ON correction_lineage(original_execution_id);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_correction_lineage_reversal_execution_id
  ON correction_lineage(reversal_execution_id);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_correction_lineage_replacement_execution_id
  ON correction_lineage(replacement_execution_id);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_correction_lineage_idempotency_key
  ON correction_lineage(idempotency_key) WHERE idempotency_key IS NOT NULL;

--> statement-breakpoint

-- ── Immutability Trigger ──────────────────────────────────────────────────

CREATE TRIGGER IF NOT EXISTS trg_correction_lineage_prevent_update
BEFORE UPDATE ON correction_lineage
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Cannot update a correction lineage record (table: correction_lineage)');
END;

--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS trg_correction_lineage_prevent_delete
BEFORE DELETE ON correction_lineage
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Cannot delete a correction lineage record (table: correction_lineage)');
END;
