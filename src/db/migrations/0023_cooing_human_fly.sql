CREATE TABLE `financial_events` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`event_type` text NOT NULL,
	`idempotency_key` text,
	`description` text,
	`posted_at` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_financial_events_account_id` ON `financial_events` (`account_id`);--> statement-breakpoint
CREATE INDEX `idx_financial_events_posted_at` ON `financial_events` (`posted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_financial_events_idempotency_key` ON `financial_events` (`idempotency_key`);--> statement-breakpoint
CREATE TABLE `ledger_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`financial_event_id` text NOT NULL,
	`account_id` text NOT NULL,
	`description` text,
	`posted_at` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp),
	FOREIGN KEY (`financial_event_id`) REFERENCES `financial_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_ledger_entries_financial_event_id` ON `ledger_entries` (`financial_event_id`);--> statement-breakpoint
CREATE INDEX `idx_ledger_entries_account_id` ON `ledger_entries` (`account_id`);--> statement-breakpoint
CREATE INDEX `idx_ledger_entries_posted_at` ON `ledger_entries` (`posted_at`);--> statement-breakpoint
CREATE TABLE `ledger_postings` (
	`id` text PRIMARY KEY NOT NULL,
	`ledger_entry_id` text NOT NULL,
	`account_id` text NOT NULL,
	`side` text NOT NULL,
	`amount` text NOT NULL,
	`amount_micros` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`sequence` integer NOT NULL,
	`created_at` text DEFAULT (current_timestamp),
	FOREIGN KEY (`ledger_entry_id`) REFERENCES `ledger_entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_ledger_postings_ledger_entry_id` ON `ledger_postings` (`ledger_entry_id`);--> statement-breakpoint
CREATE INDEX `idx_ledger_postings_account_id_side` ON `ledger_postings` (`account_id`,`side`);--> statement-breakpoint
CREATE INDEX `idx_ledger_postings_sequence` ON `ledger_postings` (`sequence`);