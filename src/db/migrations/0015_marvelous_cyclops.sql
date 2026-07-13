ALTER TABLE `settings` ADD `backup_enabled` integer DEFAULT false;--> statement-breakpoint
ALTER TABLE `settings` ADD `backup_retention_count` integer DEFAULT 3;--> statement-breakpoint
ALTER TABLE `settings` ADD `backup_last_run_at` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `backup_last_run_status` text;