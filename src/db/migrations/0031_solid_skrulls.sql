CREATE TABLE `account_performance` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`computed_as_of` text NOT NULL,
	`net_cash` text NOT NULL,
	`nav` text NOT NULL,
	`marked_positions` text NOT NULL,
	`realized_pnl` text NOT NULL,
	`unrealized_pnl` text NOT NULL,
	`total_pnl` text NOT NULL,
	`realized_fees` text NOT NULL,
	`gross_exposure` text NOT NULL,
	`net_exposure` text NOT NULL,
	`modified_dietz_return` text,
	`twr` text,
	`high_water_mark` text,
	`drawdown` text,
	`drawdown_pct` text,
	`warnings` text DEFAULT '[]' NOT NULL,
	`positions_json` text DEFAULT '[]' NOT NULL,
	`rebuild_count` integer DEFAULT 0 NOT NULL,
	`last_rebuilt_at` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp),
	`updated_at` text DEFAULT (current_timestamp),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_performance_account_id_unique` ON `account_performance` (`account_id`);--> statement-breakpoint
CREATE INDEX `idx_account_performance_account_id` ON `account_performance` (`account_id`);--> statement-breakpoint
CREATE TABLE `account_positions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`instrument_id` text NOT NULL,
	`direction` text,
	`quantity` text DEFAULT '0.00' NOT NULL,
	`average_cost` text DEFAULT '0.00' NOT NULL,
	`total_cost_basis` text DEFAULT '0.00' NOT NULL,
	`realized_gross_pnl` text DEFAULT '0.00' NOT NULL,
	`realized_fees` text DEFAULT '0.00' NOT NULL,
	`realized_net_pnl` text DEFAULT '0.00' NOT NULL,
	`last_updated` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp),
	`updated_at` text DEFAULT (current_timestamp),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_account_positions_account_id` ON `account_positions` (`account_id`);--> statement-breakpoint
CREATE INDEX `idx_account_positions_instrument_id` ON `account_positions` (`instrument_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_account_positions_account_instrument` ON `account_positions` (`account_id`,`instrument_id`);--> statement-breakpoint
CREATE TABLE `accounting_executions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`instrument_id` text NOT NULL,
	`action` text NOT NULL,
	`quantity` text NOT NULL,
	`price` text NOT NULL,
	`fees` text DEFAULT '0.00' NOT NULL,
	`idempotency_key` text,
	`journal_trade_id` text,
	`description` text,
	`posted_at` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_accounting_executions_account_id` ON `accounting_executions` (`account_id`);--> statement-breakpoint
CREATE INDEX `idx_accounting_executions_instrument_id` ON `accounting_executions` (`instrument_id`);--> statement-breakpoint
CREATE INDEX `idx_accounting_executions_posted_at` ON `accounting_executions` (`posted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_accounting_executions_idempotency_key` ON `accounting_executions` (`idempotency_key`);--> statement-breakpoint
CREATE TABLE `correction_lineage` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`original_execution_id` text NOT NULL,
	`reversal_execution_id` text NOT NULL,
	`replacement_execution_id` text NOT NULL,
	`idempotency_key` text,
	`reason` text,
	`corrected_at` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`original_execution_id`) REFERENCES `accounting_executions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reversal_execution_id`) REFERENCES `accounting_executions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`replacement_execution_id`) REFERENCES `accounting_executions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_correction_lineage_account_id` ON `correction_lineage` (`account_id`);--> statement-breakpoint
CREATE INDEX `idx_correction_lineage_original_execution_id` ON `correction_lineage` (`original_execution_id`);--> statement-breakpoint
CREATE INDEX `idx_correction_lineage_reversal_execution_id` ON `correction_lineage` (`reversal_execution_id`);--> statement-breakpoint
CREATE INDEX `idx_correction_lineage_replacement_execution_id` ON `correction_lineage` (`replacement_execution_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_correction_lineage_idempotency_key` ON `correction_lineage` (`idempotency_key`);--> statement-breakpoint
CREATE TABLE `dashboard_views` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`layout` text DEFAULT '[]' NOT NULL,
	`hidden_widget_ids` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`is_system` integer DEFAULT false NOT NULL,
	`is_default` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `fifo_lots` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`instrument_id` text NOT NULL,
	`direction` text NOT NULL,
	`remaining_quantity` text NOT NULL,
	`original_quantity` text NOT NULL,
	`entry_price` text NOT NULL,
	`cost_basis_total` text NOT NULL,
	`allocated_fees` text DEFAULT '0.00' NOT NULL,
	`opening_execution_id` text NOT NULL,
	`opened_at` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`opening_execution_id`) REFERENCES `accounting_executions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_fifo_lots_account_instrument` ON `fifo_lots` (`account_id`,`instrument_id`);--> statement-breakpoint
CREATE INDEX `idx_fifo_lots_opening_execution_id` ON `fifo_lots` (`opening_execution_id`);--> statement-breakpoint
CREATE TABLE `instruments` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`name` text,
	`type` text DEFAULT 'stock' NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`is_active` integer DEFAULT true,
	`created_at` text DEFAULT (current_timestamp),
	`updated_at` text DEFAULT (current_timestamp)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `instruments_symbol_unique` ON `instruments` (`symbol`);--> statement-breakpoint
CREATE INDEX `idx_instruments_symbol` ON `instruments` (`symbol`);--> statement-breakpoint
CREATE TABLE `lot_matches` (
	`id` text PRIMARY KEY NOT NULL,
	`closing_execution_id` text NOT NULL,
	`lot_id` text NOT NULL,
	`match_quantity` text NOT NULL,
	`match_price` text NOT NULL,
	`realized_gross_pnl` text NOT NULL,
	`allocated_fees` text DEFAULT '0.00' NOT NULL,
	`realized_net_pnl` text NOT NULL,
	`sequence` integer NOT NULL,
	`created_at` text DEFAULT (current_timestamp),
	FOREIGN KEY (`closing_execution_id`) REFERENCES `accounting_executions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lot_id`) REFERENCES `fifo_lots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_lot_matches_closing_execution_id` ON `lot_matches` (`closing_execution_id`);--> statement-breakpoint
CREATE INDEX `idx_lot_matches_lot_id` ON `lot_matches` (`lot_id`);--> statement-breakpoint
CREATE TABLE `valuation_marks` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`instrument_id` text NOT NULL,
	`price` text NOT NULL,
	`price_micros` integer NOT NULL,
	`source` text NOT NULL,
	`mark_timestamp` text NOT NULL,
	`idempotency_key` text,
	`created_at` text DEFAULT (current_timestamp),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_valuation_marks_account_instrument` ON `valuation_marks` (`account_id`,`instrument_id`);--> statement-breakpoint
CREATE INDEX `idx_valuation_marks_account_instrument_timestamp` ON `valuation_marks` (`account_id`,`instrument_id`,`mark_timestamp`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_valuation_marks_idempotency_key` ON `valuation_marks` (`idempotency_key`);--> statement-breakpoint
ALTER TABLE `financial_events` ADD `payload` text;--> statement-breakpoint
ALTER TABLE `financial_events` ADD `effect` text;--> statement-breakpoint
ALTER TABLE `trades` ADD `gross_realized_pnl` real;--> statement-breakpoint
ALTER TABLE `trades` ADD `net_realized_pnl` real;--> statement-breakpoint
ALTER TABLE `trades` ADD `realized_fees` real;