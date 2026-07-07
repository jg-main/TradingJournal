CREATE TABLE `checklist_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text,
	`setup_id` text,
	`description` text NOT NULL,
	`sort_order` integer,
	`is_active` integer DEFAULT true,
	`deleted_at` text,
	`created_at` text DEFAULT (current_timestamp),
	`updated_at` text DEFAULT (current_timestamp),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`setup_id`) REFERENCES `setup_definitions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `trade_check_results` (
	`id` text PRIMARY KEY NOT NULL,
	`trade_id` text NOT NULL,
	`checklist_definition_id` text NOT NULL,
	`passed` integer NOT NULL,
	`comment` text,
	`checked_at` text DEFAULT (current_timestamp),
	`created_at` text DEFAULT (current_timestamp),
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`checklist_definition_id`) REFERENCES `checklist_definitions`(`id`) ON UPDATE no action ON DELETE no action
);
