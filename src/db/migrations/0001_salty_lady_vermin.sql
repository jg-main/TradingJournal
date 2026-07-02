CREATE TABLE `setup_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`how_to_play` text,
	`entry_rules` text,
	`exit_rules` text,
	`tags` text,
	`default_risk_pct` real,
	`position_sizing_rules` text,
	`chart_patterns` text,
	`is_active` integer DEFAULT true,
	`created_at` text DEFAULT (current_timestamp),
	`updated_at` text DEFAULT (current_timestamp)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `setup_definitions_name_unique` ON `setup_definitions` (`name`);