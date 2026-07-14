CREATE TABLE `market_data_settings` (
  `id` text PRIMARY KEY NOT NULL,
  `active_provider` text DEFAULT 'clickhouse' NOT NULL,
  `providers` text DEFAULT '{}' NOT NULL,
  `created_at` text DEFAULT (current_timestamp),
  `updated_at` text DEFAULT (current_timestamp)
);
