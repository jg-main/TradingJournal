CREATE TABLE `position_price_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`trade_id` text NOT NULL,
	`price` real NOT NULL,
	`source` text DEFAULT 'yahoo' NOT NULL,
	`market_state` text,
	`fetched_at` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp),
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_position_price_snapshots_trade_id_fetched_at` ON `position_price_snapshots` (`trade_id`,`fetched_at`);--> statement-breakpoint
ALTER TABLE `trades` ADD `current_price` real;--> statement-breakpoint
ALTER TABLE `trades` ADD `current_price_fetched_at` text;