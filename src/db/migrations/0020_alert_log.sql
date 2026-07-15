CREATE TABLE `alert_log` (
  `id` text PRIMARY KEY NOT NULL,
  `watchlist_item_id` text NOT NULL REFERENCES `watchlist_items`(`id`) ON DELETE cascade,
  `symbol` text NOT NULL,
  `condition` text NOT NULL,
  `threshold` real,
  `actual_value` real,
  `fired_at` text NOT NULL,
  `read_at` text,
  `created_at` text DEFAULT (current_timestamp)
);
CREATE INDEX `idx_alert_log_fired_at` ON `alert_log` (`fired_at`);
CREATE INDEX `idx_alert_log_watchlist_item_id` ON `alert_log` (`watchlist_item_id`);
