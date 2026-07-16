-- Migration: Add accounting execution and FIFO position tables
--
-- Adds tables for economic-side fills (separate from journal-domain
-- trade_executions), instruments (canonical symbol references), account
-- positions (rebuildable projections), FIFO lots (cost-basis slices),
-- and lot matches (realized P&L tracking).
--
-- Adds immutability triggers on accounting_executions to enforce
-- append-only semantics.

-- ── Instruments (canonical symbol identity) ─────────────────────────────

CREATE TABLE IF NOT EXISTS instruments (
  id TEXT PRIMARY KEY NOT NULL,
  symbol TEXT NOT NULL UNIQUE,
  name TEXT,
  type TEXT NOT NULL DEFAULT 'stock' CHECK(type IN ('stock', 'etf', 'option', 'future', 'forex', 'crypto', 'other')),
  currency TEXT NOT NULL DEFAULT 'USD',
  is_active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (current_timestamp),
  updated_at TEXT NOT NULL DEFAULT (current_timestamp)
);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_instruments_symbol ON instruments(symbol);

--> statement-breakpoint

-- ── Accounting Executions (immutable economic-side fills) ───────────────

CREATE TABLE IF NOT EXISTS accounting_executions (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  instrument_id TEXT NOT NULL REFERENCES instruments(id),
  action TEXT NOT NULL CHECK(action IN ('buy', 'sell', 'sell_short', 'buy_to_cover', 'add', 'reduce')),
  quantity TEXT NOT NULL,
  price TEXT NOT NULL,
  fees TEXT NOT NULL DEFAULT '0.00',
  idempotency_key TEXT,
  journal_trade_id TEXT,
  description TEXT,
  posted_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (current_timestamp)
);

--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS uq_accounting_executions_idempotency_key
  ON accounting_executions(idempotency_key) WHERE idempotency_key IS NOT NULL;

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_accounting_executions_account_id
  ON accounting_executions(account_id);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_accounting_executions_instrument_id
  ON accounting_executions(instrument_id);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_accounting_executions_posted_at
  ON accounting_executions(posted_at);

--> statement-breakpoint

-- ── Account Positions (rebuildable projections) ─────────────────────────

CREATE TABLE IF NOT EXISTS account_positions (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  instrument_id TEXT NOT NULL REFERENCES instruments(id),
  direction TEXT CHECK(direction IN ('long', 'short')),
  quantity TEXT NOT NULL DEFAULT '0.00',
  average_cost TEXT NOT NULL DEFAULT '0.00',
  total_cost_basis TEXT NOT NULL DEFAULT '0.00',
  realized_gross_pnl TEXT NOT NULL DEFAULT '0.00',
  realized_fees TEXT NOT NULL DEFAULT '0.00',
  realized_net_pnl TEXT NOT NULL DEFAULT '0.00',
  last_updated TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (current_timestamp),
  updated_at TEXT NOT NULL DEFAULT (current_timestamp)
);

--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS uq_account_positions_account_instrument
  ON account_positions(account_id, instrument_id);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_account_positions_account_id
  ON account_positions(account_id);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_account_positions_instrument_id
  ON account_positions(instrument_id);

--> statement-breakpoint

-- ── FIFO Lots (cost-basis slices of open positions) ─────────────────────

CREATE TABLE IF NOT EXISTS fifo_lots (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  instrument_id TEXT NOT NULL REFERENCES instruments(id),
  direction TEXT NOT NULL CHECK(direction IN ('long', 'short')),
  remaining_quantity TEXT NOT NULL,
  original_quantity TEXT NOT NULL,
  entry_price TEXT NOT NULL,
  cost_basis_total TEXT NOT NULL,
  allocated_fees TEXT NOT NULL DEFAULT '0.00',
  opening_execution_id TEXT NOT NULL REFERENCES accounting_executions(id),
  opened_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (current_timestamp)
);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_fifo_lots_account_instrument
  ON fifo_lots(account_id, instrument_id);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_fifo_lots_opening_execution_id
  ON fifo_lots(opening_execution_id);

--> statement-breakpoint

-- ── Lot Matches (realized P&L slices) ──────────────────────────────────

CREATE TABLE IF NOT EXISTS lot_matches (
  id TEXT PRIMARY KEY NOT NULL,
  closing_execution_id TEXT NOT NULL REFERENCES accounting_executions(id),
  lot_id TEXT NOT NULL REFERENCES fifo_lots(id),
  match_quantity TEXT NOT NULL,
  match_price TEXT NOT NULL,
  realized_gross_pnl TEXT NOT NULL,
  allocated_fees TEXT NOT NULL DEFAULT '0.00',
  realized_net_pnl TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (current_timestamp)
);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_lot_matches_closing_execution_id
  ON lot_matches(closing_execution_id);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_lot_matches_lot_id
  ON lot_matches(lot_id);

--> statement-breakpoint

-- ── Immutability Triggers for Accounting Executions ─────────────────────

CREATE TRIGGER IF NOT EXISTS trg_accounting_executions_prevent_update
BEFORE UPDATE ON accounting_executions
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Cannot update an accounting execution (table: accounting_executions)');
END;

--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS trg_accounting_executions_prevent_delete
BEFORE DELETE ON accounting_executions
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Cannot delete an accounting execution (table: accounting_executions)');
END;
