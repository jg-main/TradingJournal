-- Migration: Add immutability triggers to posted accounting rows
--
-- Adds BEFORE UPDATE and BEFORE DELETE triggers on financial_events,
-- ledger_entries, and ledger_postings to enforce ledger immutability
-- at the database level. Any attempt to modify or delete posted rows
-- raises an ABORT error with a descriptive message.

-- ── Financial Events Immuatability ──────────────────────────────────────

CREATE TRIGGER trg_financial_events_prevent_update
BEFORE UPDATE ON financial_events
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Cannot update a posted financial event (table: financial_events)');
END;

--> statement-breakpoint

CREATE TRIGGER trg_financial_events_prevent_delete
BEFORE DELETE ON financial_events
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Cannot delete a posted financial event (table: financial_events)');
END;

--> statement-breakpoint

-- ── Ledger Entries Immutability ─────────────────────────────────────────

CREATE TRIGGER trg_ledger_entries_prevent_update
BEFORE UPDATE ON ledger_entries
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Cannot update a posted ledger entry (table: ledger_entries)');
END;

--> statement-breakpoint

CREATE TRIGGER trg_ledger_entries_prevent_delete
BEFORE DELETE ON ledger_entries
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Cannot delete a posted ledger entry (table: ledger_entries)');
END;

--> statement-breakpoint

-- ── Ledger Postings Immuatability ───────────────────────────────────────

CREATE TRIGGER trg_ledger_postings_prevent_update
BEFORE UPDATE ON ledger_postings
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Cannot update a posted ledger posting (table: ledger_postings)');
END;

--> statement-breakpoint

CREATE TRIGGER trg_ledger_postings_prevent_delete
BEFORE DELETE ON ledger_postings
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Cannot delete a posted ledger posting (table: ledger_postings)');
END;
