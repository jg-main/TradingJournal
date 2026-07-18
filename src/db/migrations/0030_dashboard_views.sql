-- Migration: Add dashboard_views table
--
-- Persisted dashboard view configurations replacing localStorage-only
-- persistence (key dashboard:views:v2). Each row stores the widget layout
-- (JSON) and hidden-widget state so switching views instantly restores a
-- different arrangement. Views written here survive localStorage.clear().
--
-- System views have is_system = 1 and use a system-* id prefix; they are
-- read-only in the Manage Views dialog. User views have is_system = 0 and
-- use a crypto.randomUUID() id.

-- ── Dashboard Views ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dashboard_views (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  layout TEXT NOT NULL DEFAULT '[]',
  hidden_widget_ids TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  is_system INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0
);
