CREATE TABLE `account_rollforward` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`date` text NOT NULL,
	`beginning_equity` real,
	`deposits_withdrawals` real DEFAULT 0,
	`realized_gross_pnl` real DEFAULT 0,
	`fees` real DEFAULT 0,
	`ending_equity` real,
	`cumulative_pnl` real,
	`high_water_mark` real,
	`drawdown_amount` real DEFAULT 0,
	`drawdown_pct` real DEFAULT 0,
	`notes` text,
	`created_at` text DEFAULT (current_timestamp),
	`updated_at` text DEFAULT (current_timestamp),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`broker` text,
	`currency` text DEFAULT 'USD',
	`is_active` integer DEFAULT true,
	`created_at` text DEFAULT (current_timestamp),
	`updated_at` text DEFAULT (current_timestamp)
);
--> statement-breakpoint
CREATE TABLE `app_profile` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text,
	`timezone` text DEFAULT 'America/Bogota',
	`default_currency` text DEFAULT 'USD',
	`created_at` text DEFAULT (current_timestamp),
	`updated_at` text DEFAULT (current_timestamp)
);
--> statement-breakpoint
CREATE TABLE `lookup_values` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`value` text NOT NULL,
	`description` text,
	`sort_order` integer,
	`is_active` integer DEFAULT true,
	`created_at` text DEFAULT (current_timestamp),
	`updated_at` text DEFAULT (current_timestamp)
);
--> statement-breakpoint
CREATE TABLE `review_action_items` (
	`id` text PRIMARY KEY NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text,
	`action_text` text NOT NULL,
	`status` text NOT NULL,
	`due_date` text,
	`created_at` text DEFAULT (current_timestamp),
	`updated_at` text DEFAULT (current_timestamp)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` text PRIMARY KEY NOT NULL,
	`default_account_id` text,
	`starting_account_value` real,
	`max_risk_per_trade_pct` real,
	`default_commission` real,
	`journal_start_date` text,
	`currency` text DEFAULT 'USD',
	`created_at` text DEFAULT (current_timestamp),
	`updated_at` text DEFAULT (current_timestamp),
	FOREIGN KEY (`default_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `trade_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`trade_id` text NOT NULL,
	`asset_type` text NOT NULL,
	`phase` text NOT NULL,
	`label` text,
	`file_path` text,
	`external_url` text,
	`notes` text,
	`created_at` text DEFAULT (current_timestamp),
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `trade_executions` (
	`id` text PRIMARY KEY NOT NULL,
	`trade_id` text NOT NULL,
	`executed_at` text,
	`action` text NOT NULL,
	`quantity` real NOT NULL,
	`price` real NOT NULL,
	`fees` real DEFAULT 0,
	`reason_id` text,
	`notes` text,
	`created_at` text DEFAULT (current_timestamp),
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reason_id`) REFERENCES `lookup_values`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `trade_grades` (
	`id` text PRIMARY KEY NOT NULL,
	`trade_id` text NOT NULL,
	`setup_quality_score` integer,
	`risk_quality_score` integer,
	`entry_quality_score` integer,
	`management_quality_score` integer,
	`exit_quality_score` integer,
	`review_quality_score` integer,
	`total_score` real,
	`grade_label` text,
	`followed_plan` integer,
	`rule_violation` integer,
	`notes` text,
	`created_at` text DEFAULT (current_timestamp),
	`updated_at` text DEFAULT (current_timestamp),
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_grades_trade_id_unique` ON `trade_grades` (`trade_id`);--> statement-breakpoint
CREATE TABLE `trade_mistakes` (
	`id` text PRIMARY KEY NOT NULL,
	`trade_id` text NOT NULL,
	`mistake_type_id` text,
	`phase` text NOT NULL,
	`severity` text NOT NULL,
	`root_cause` text,
	`corrective_action` text,
	`status` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp),
	`updated_at` text DEFAULT (current_timestamp),
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mistake_type_id`) REFERENCES `lookup_values`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `trade_risk_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`trade_id` text NOT NULL,
	`account_equity_at_open` real,
	`initial_entry_price` real,
	`initial_stop_price` real,
	`initial_quantity` real,
	`risk_per_share` real,
	`initial_risk_amount` real,
	`account_risk_pct` real,
	`planned_reward_risk` real,
	`created_at` text DEFAULT (current_timestamp),
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_risk_snapshots_trade_id_unique` ON `trade_risk_snapshots` (`trade_id`);--> statement-breakpoint
CREATE TABLE `trade_stop_adjustments` (
	`id` text PRIMARY KEY NOT NULL,
	`trade_id` text NOT NULL,
	`adjusted_at` text,
	`previous_stop` real,
	`new_stop` real,
	`reason` text,
	`rule_based` integer,
	`notes` text,
	`created_at` text DEFAULT (current_timestamp),
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `trades` (
	`id` text PRIMARY KEY NOT NULL,
	`trade_code` text NOT NULL,
	`account_id` text NOT NULL,
	`symbol` text NOT NULL,
	`direction` text NOT NULL,
	`sector_id` text,
	`setup_id` text,
	`market_condition_id` text,
	`status` text NOT NULL,
	`planned_entry` real,
	`planned_stop` real,
	`planned_target_1` real,
	`planned_target_2` real,
	`thesis` text,
	`invalidation_condition` text,
	`pre_trade_plan` text,
	`opened_at` text,
	`closed_at` text,
	`exit_notes` text,
	`lesson` text,
	`created_at` text DEFAULT (current_timestamp),
	`updated_at` text DEFAULT (current_timestamp),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sector_id`) REFERENCES `lookup_values`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`setup_id`) REFERENCES `lookup_values`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`market_condition_id`) REFERENCES `lookup_values`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trades_trade_code_unique` ON `trades` (`trade_code`);--> statement-breakpoint
CREATE TABLE `watchlist_items` (
	`id` text PRIMARY KEY NOT NULL,
	`date_added` text,
	`symbol` text NOT NULL,
	`sector_id` text,
	`setup_id` text,
	`direction` text NOT NULL,
	`thesis` text,
	`market_context` text,
	`key_level` real,
	`trigger_price` real,
	`planned_stop` real,
	`target_price` real,
	`status` text NOT NULL,
	`notes` text,
	`promoted_trade_id` text,
	`created_at` text DEFAULT (current_timestamp),
	`updated_at` text DEFAULT (current_timestamp),
	FOREIGN KEY (`sector_id`) REFERENCES `lookup_values`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`setup_id`) REFERENCES `lookup_values`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`promoted_trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `weekly_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`week_start` text NOT NULL,
	`week_end` text NOT NULL,
	`account_id` text NOT NULL,
	`closed_trades` integer DEFAULT 0,
	`net_pnl` real DEFAULT 0,
	`avg_r` real DEFAULT 0,
	`win_rate` real DEFAULT 0,
	`avg_process_score` real DEFAULT 0,
	`notes` text,
	`focus_next_week` text,
	`created_at` text DEFAULT (current_timestamp),
	`updated_at` text DEFAULT (current_timestamp),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `weekly_reviews_account_id_week_start_week_end_unique` ON `weekly_reviews` (`account_id`,`week_start`,`week_end`);