CREATE TABLE `alert_log` (
	`id` text PRIMARY KEY NOT NULL,
	`watchlist_item_id` text NOT NULL,
	`symbol` text NOT NULL,
	`condition` text NOT NULL,
	`threshold` real,
	`actual_value` real,
	`fired_at` text NOT NULL,
	`read_at` text,
	`created_at` text DEFAULT (current_timestamp),
	FOREIGN KEY (`watchlist_item_id`) REFERENCES `watchlist_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_alert_log_fired_at` ON `alert_log` (`fired_at`);--> statement-breakpoint
CREATE INDEX `idx_alert_log_watchlist_item_id` ON `alert_log` (`watchlist_item_id`);--> statement-breakpoint
CREATE TABLE `market_data_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`active_provider` text DEFAULT 'clickhouse' NOT NULL,
	`providers` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT (current_timestamp),
	`updated_at` text DEFAULT (current_timestamp)
);
--> statement-breakpoint
CREATE TABLE `schwab_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`encrypted_access_token` text NOT NULL,
	`encrypted_refresh_token` text,
	`scope` text,
	`token_type` text DEFAULT 'Bearer',
	`expires_at` text,
	`refresh_token_expires_at` text,
	`status` text DEFAULT 'active',
	`created_at` text DEFAULT (current_timestamp),
	`updated_at` text DEFAULT (current_timestamp)
);
--> statement-breakpoint
ALTER TABLE `position_price_snapshots` ADD `previous_close` real;--> statement-breakpoint
ALTER TABLE `position_price_snapshots` ADD `day_high` real;--> statement-breakpoint
ALTER TABLE `position_price_snapshots` ADD `day_low` real;--> statement-breakpoint
ALTER TABLE `position_price_snapshots` ADD `price_change` real;--> statement-breakpoint
ALTER TABLE `position_price_snapshots` ADD `change_percent` real;--> statement-breakpoint
ALTER TABLE `watchlist_items` ADD `name` text;--> statement-breakpoint
ALTER TABLE `watchlist_items` ADD `sector` text;--> statement-breakpoint
ALTER TABLE `watchlist_items` ADD `industry` text;--> statement-breakpoint
ALTER TABLE `watchlist_items` ADD `alert_config` text;