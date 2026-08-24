-- Migration: Checklist required/optional flag, item-text snapshot, risk override
--
-- S01 audit matrix contracts:
--   D3 — checklist items need a required/optional flag. All existing items
--        become required (default true) for backward compatibility.
--   F7 — checklist evidence needs an immutable item-text snapshot so
--        historical results are not re-interpreted when a checklist
--        template description is later edited.
--   D2 — max-risk override needs a storage location on the trade record
--        for audit trail when an execution exceeds the configured
--        max-risk threshold.
ALTER TABLE `checklist_definitions` ADD `is_required` integer NOT NULL DEFAULT 1;

--> statement-breakpoint

ALTER TABLE `trade_check_results` ADD `item_text` text;

--> statement-breakpoint

ALTER TABLE `trades` ADD `risk_override_reason` text;
