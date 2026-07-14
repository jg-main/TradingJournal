CREATE TABLE `schwab_tokens` (
  `id` text PRIMARY KEY NOT NULL,
  `encrypted_access_token` text NOT NULL,
  `encrypted_refresh_token` text,
  `scope` text,
  `token_type` text DEFAULT 'Bearer',
  `expires_at` text,
  `refresh_token_expires_at` text,
  `status` text DEFAULT 'active',
  `created_at` text DEFAULT (current_timestamp),
  `updated_at` text DEFAULT (current_timestamp)
);
