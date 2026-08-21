-- Migration: Add financial_event_correction_lineage table
--
-- Tracks corrections of posted financial events (deposit, withdrawal,
-- dividend, interest, fee, tax, manual_adjustment) that follow the
-- immutable reversal-and-replacement pattern.
--
-- Posted financial events are protected by BEFORE UPDATE / BEFORE DELETE
-- triggers — they can never be mutated. A correction therefore posts a
-- reversal financial event (same event type, opposite cash-effect
-- direction) and a replacement financial event (the corrected values),
-- then records this lineage row linking all three event IDs with the
-- required correction reason.
--
-- The ledger projection resolves these rows directly (unlike execution
-- corrections, the event IDs are stored explicitly), so correction groups
-- appear as a single understandable corrected-state row.

-- ── Financial Event Correction Lineage ──────────────────────────────────

CREATE TABLE IF NOT EXISTS financial_event_correction_lineage (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  original_event_id TEXT NOT NULL REFERENCES financial_events(id),
  reversal_event_id TEXT NOT NULL REFERENCES financial_events(id),
  replacement_event_id TEXT NOT NULL REFERENCES financial_events(id),
  idempotency_key TEXT UNIQUE,
  reason TEXT NOT NULL,
  corrected_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (current_timestamp)
);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_fe_correction_lineage_account_id
  ON financial_event_correction_lineage(account_id);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_fe_correction_lineage_original_event_id
  ON financial_event_correction_lineage(original_event_id);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_fe_correction_lineage_reversal_event_id
  ON financial_event_correction_lineage(reversal_event_id);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_fe_correction_lineage_replacement_event_id
  ON financial_event_correction_lineage(replacement_event_id);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_fe_correction_lineage_idempotency_key
  ON financial_event_correction_lineage(idempotency_key) WHERE idempotency_key IS NOT NULL;

--> statement-breakpoint

-- ── Immutability Triggers ────────────────────────────────────────────────

CREATE TRIGGER IF NOT EXISTS trg_fe_correction_lineage_prevent_update
BEFORE UPDATE ON financial_event_correction_lineage
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Cannot update a financial event correction lineage record (table: financial_event_correction_lineage)');
END;

--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS trg_fe_correction_lineage_prevent_delete
BEFORE DELETE ON financial_event_correction_lineage
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Cannot delete a financial event correction lineage record (table: financial_event_correction_lineage)');
END;
