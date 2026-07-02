CREATE TABLE `account_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`type` text NOT NULL,
	`amount` real NOT NULL,
	`balance_after` real NOT NULL,
	`date` text NOT NULL,
	`notes` text,
	`created_at` text DEFAULT (current_timestamp),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
