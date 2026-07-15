-- Add name, industry, and sector columns to watchlist_items

ALTER TABLE watchlist_items ADD COLUMN name TEXT;
ALTER TABLE watchlist_items ADD COLUMN sector TEXT;
ALTER TABLE watchlist_items ADD COLUMN industry TEXT;
