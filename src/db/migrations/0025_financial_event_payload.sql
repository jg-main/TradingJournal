-- Migration: Add durable payload/effect columns to financial_events

--> statement-breakpoint

ALTER TABLE financial_events ADD COLUMN payload TEXT;

--> statement-breakpoint

ALTER TABLE financial_events ADD COLUMN effect TEXT;
