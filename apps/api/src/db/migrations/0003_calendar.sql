PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS calendar_items (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('TASK_BLOCK', 'EVENT')),
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  title TEXT,
  description TEXT,
  all_day INTEGER NOT NULL DEFAULT 0 CHECK (all_day IN (0, 1)),
  start_value TEXT NOT NULL,
  end_value TEXT NOT NULL,
  color TEXT,
  recurrence_frequency TEXT NOT NULL DEFAULT 'NONE' CHECK (recurrence_frequency IN ('NONE', 'DAILY', 'WEEKLY', 'MONTHLY')),
  recurrence_interval INTEGER NOT NULL DEFAULT 1 CHECK (recurrence_interval > 0),
  recurrence_weekdays TEXT NOT NULL DEFAULT '',
  recurrence_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  CHECK ((kind = 'TASK_BLOCK' AND task_id IS NOT NULL) OR (kind = 'EVENT' AND task_id IS NULL)),
  CHECK ((kind = 'EVENT' AND title IS NOT NULL AND length(trim(title)) > 0) OR kind = 'TASK_BLOCK')
);

CREATE INDEX IF NOT EXISTS calendar_items_user_range_idx ON calendar_items(user_id, start_value, end_value);
CREATE INDEX IF NOT EXISTS calendar_items_task_idx ON calendar_items(task_id);

CREATE TABLE IF NOT EXISTS calendar_item_overrides (
  id TEXT PRIMARY KEY NOT NULL,
  calendar_item_id TEXT NOT NULL REFERENCES calendar_items(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  occurrence_start TEXT NOT NULL,
  cancelled INTEGER NOT NULL DEFAULT 0 CHECK (cancelled IN (0, 1)),
  title TEXT,
  description TEXT,
  all_day INTEGER,
  start_value TEXT,
  end_value TEXT,
  color TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(calendar_item_id, occurrence_start)
);

CREATE INDEX IF NOT EXISTS calendar_overrides_item_idx ON calendar_item_overrides(calendar_item_id, occurrence_start);
