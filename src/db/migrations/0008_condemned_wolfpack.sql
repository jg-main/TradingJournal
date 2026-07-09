ALTER TABLE `ai_settings` ADD `clickhouse_host` text DEFAULT 'localhost';--> statement-breakpoint
ALTER TABLE `ai_settings` ADD `clickhouse_port` integer DEFAULT 8123;--> statement-breakpoint
ALTER TABLE `ai_settings` ADD `clickhouse_user` text DEFAULT 'default';--> statement-breakpoint
ALTER TABLE `ai_settings` ADD `clickhouse_password` text;--> statement-breakpoint
ALTER TABLE `ai_settings` ADD `clickhouse_database` text DEFAULT 'market';