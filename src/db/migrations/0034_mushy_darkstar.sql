CREATE TABLE `trade_target_adjustments` (
	`id` text PRIMARY KEY NOT NULL,
	`trade_id` text NOT NULL,
	`target_index` integer NOT NULL,
	`adjusted_at` text,
	`previous_target` real,
	`new_target` real,
	`reason` text,
	`rule_based` integer,
	`notes` text,
	`created_at` text DEFAULT (current_timestamp),
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE cascade
);
