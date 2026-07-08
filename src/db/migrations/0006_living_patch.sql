CREATE TABLE `ai_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`api_key` text,
	`temperature` real DEFAULT 0.7,
	`max_tokens` integer DEFAULT 4096,
	`system_prompt` text,
	`is_active` integer DEFAULT true,
	`created_at` text DEFAULT (current_timestamp),
	`updated_at` text DEFAULT (current_timestamp)
);
--> statement-breakpoint
CREATE TABLE `play_evaluation_fields` (
	`id` text PRIMARY KEY NOT NULL,
	`setup_definition_id` text NOT NULL,
	`field_key` text NOT NULL,
	`label` text NOT NULL,
	`description` text,
	`field_type` text NOT NULL,
	`weight` real DEFAULT 1,
	`sort_order` integer DEFAULT 0,
	`is_active` integer DEFAULT true,
	`created_at` text DEFAULT (current_timestamp),
	`updated_at` text DEFAULT (current_timestamp),
	FOREIGN KEY (`setup_definition_id`) REFERENCES `setup_definitions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `play_evaluation_fields_setup_definition_id_field_key_unique` ON `play_evaluation_fields` (`setup_definition_id`,`field_key`);--> statement-breakpoint
CREATE TABLE `trade_assessment_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`trade_id` text NOT NULL,
	`assessed_at` text DEFAULT (current_timestamp),
	`assessment_type` text NOT NULL,
	`overall_score` real,
	`scorecard_json` text,
	`model_used` text,
	`prompt_tokens` integer,
	`completion_tokens` integer,
	`notes` text,
	`created_at` text DEFAULT (current_timestamp),
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE cascade
);
