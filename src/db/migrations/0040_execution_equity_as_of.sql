-- Migration: Execution equity provenance on trade risk snapshots (part 2)
--
-- M002-A2 — as-of marker for the resolved equity (projection computed_as_of,
-- rollforward date, or fill timestamp). Nullable text; historical snapshots
-- have NULL because provenance was not recorded (A2 does not fabricate it).
ALTER TABLE `trade_risk_snapshots` ADD `account_equity_as_of` text;
