-- Migration: Add valuation marks and account performance projection tables
--
-- valuation_marks — Immutable exact-decimal price marks per (account, instrument,
--                   timestamp), append-only via UPDATE/DELETE triggers.
-- account_performance — Rebuildable per-account performance projection
--                       containing NAV, P&L, fees, exposure, TWR, high-water
--                       mark, and drawdown with explicit data-quality state.
--
-- Follows the same exact-decimal pattern as ledger_postings:
-- TEXT canonical decimal (e.g. "150.50") + INTEGER micros for exact arithmetic.

-- ── Valuation Marks (immutable price observations) ──────────────────────

CREATE TABLE IF NOT EXISTS valuation_marks (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  instrument_id TEXT NOT NULL REFERENCES instruments(id),
  price TEXT NOT NULL,
  price_micros INTEGER NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('user', 'market_data', 'import', 'system')),
  mark_timestamp TEXT NOT NULL,
  idempotency_key TEXT,
  created_at TEXT NOT NULL DEFAULT (current_timestamp)
);

--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS uq_valuation_marks_idempotency_key
  ON valuation_marks(idempotency_key) WHERE idempotency_key IS NOT NULL;

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_valuation_marks_account_instrument
  ON valuation_marks(account_id, instrument_id);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_valuation_marks_account_instrument_timestamp
  ON valuation_marks(account_id, instrument_id, mark_timestamp);

--> statement-breakpoint

-- ── Account Performance Projection (single-row per account, rebuildable) ─

CREATE TABLE IF NOT EXISTS account_performance (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) UNIQUE,
  computed_as_of TEXT NOT NULL,
  net_cash TEXT NOT NULL,
  nav TEXT NOT NULL,
  marked_positions TEXT NOT NULL,
  realized_pnl TEXT NOT NULL,
  unrealized_pnl TEXT NOT NULL,
  total_pnl TEXT NOT NULL,
  realized_fees TEXT NOT NULL,
  gross_exposure TEXT NOT NULL,
  net_exposure TEXT NOT NULL,
  modified_dietz_return TEXT,
  twr TEXT,
  high_water_mark TEXT,
  drawdown TEXT,
  drawdown_pct TEXT,
  warnings TEXT NOT NULL DEFAULT '[]',
  positions_json TEXT NOT NULL DEFAULT '[]',
  rebuild_count INTEGER NOT NULL DEFAULT 0,
  last_rebuilt_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (current_timestamp),
  updated_at TEXT NOT NULL DEFAULT (current_timestamp)
);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_account_performance_account_id
  ON account_performance(account_id);

--> statement-breakpoint

-- ── Immutability Triggers for Valuation Marks ──────────────────────────

CREATE TRIGGER IF NOT EXISTS trg_valuation_marks_prevent_update
BEFORE UPDATE ON valuation_marks
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Cannot update a valuation mark (table: valuation_marks)');
END;

--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS trg_valuation_marks_prevent_delete
BEFORE DELETE ON valuation_marks
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Cannot delete a valuation mark (table: valuation_marks)');
END;
