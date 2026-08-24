-- Migration: Trade execution idempotency key
--
-- S03 canonical execution engine contracts:
--   D7 — retrying POST /api/trades/[id]/execute or /executions must not
--        create duplicate trade_executions rows. The accounting side
--        (accounting_executions) already carries idempotency_key (M006,
--        migration 0026); this migration adds the same replay protection
--        to the journal-side trade_executions table so replay-safe
--        execution covers both domains.
--
-- The column is nullable: legacy rows and clients that opt out keep NULL,
-- and SQLite treats NULLs as distinct under a UNIQUE index, so existing
-- data cannot collide. The partial index mirrors the accounting-side
-- pattern (uq_accounting_executions_idempotency_key).
ALTER TABLE `trade_executions` ADD `idempotency_key` text;

--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS `uq_trade_executions_idempotency_key`
  ON `trade_executions` (`idempotency_key`) WHERE `idempotency_key` IS NOT NULL;
