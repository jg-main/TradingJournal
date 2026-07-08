ALTER TABLE `ai_settings` ADD `base_url` text;--> statement-breakpoint
ALTER TABLE `ai_settings` ADD `timeout_ms` integer DEFAULT 30000;