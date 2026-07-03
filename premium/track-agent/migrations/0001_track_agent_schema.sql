-- Track Agent isolated D1 schema.
-- This schema is intentionally separate from the free MotoTrack Log
-- localStorage session model.

CREATE TABLE IF NOT EXISTS track_agent_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  motorcycle_ref TEXT,
  track_ref TEXT,
  event_ref TEXT,
  app_session_ref TEXT,
  raw_note TEXT NOT NULL,
  parser_version TEXT NOT NULL DEFAULT 'mock-v1',
  confidence REAL,
  warnings_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS track_agent_sessions (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  track_name TEXT,
  bike_name TEXT,
  session_number INTEGER,
  coaching_focus TEXT,
  handling_notes TEXT,
  confirmed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (entry_id) REFERENCES track_agent_entries(id)
);

CREATE TABLE IF NOT EXISTS track_agent_lap_times (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  lap_label TEXT,
  lap_time_raw TEXT NOT NULL,
  lap_time_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES track_agent_sessions(id)
);

CREATE TABLE IF NOT EXISTS track_agent_tire_pressures (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  position TEXT NOT NULL CHECK (position IN ('front', 'rear')),
  timing TEXT NOT NULL CHECK (timing IN ('cold', 'hot', 'pre', 'post', 'unknown')),
  pressure_psi REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES track_agent_sessions(id)
);

CREATE TABLE IF NOT EXISTS track_agent_setup_changes (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  category TEXT,
  field TEXT,
  from_value TEXT,
  to_value TEXT,
  delta TEXT,
  reason TEXT,
  result TEXT,
  raw_text TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES track_agent_sessions(id)
);

CREATE TABLE IF NOT EXISTS track_agent_notes (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  note_type TEXT NOT NULL DEFAULT 'rider',
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES track_agent_sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_track_agent_entries_user_created
  ON track_agent_entries(user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_track_agent_sessions_user_created
  ON track_agent_sessions(user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_track_agent_lap_times_session
  ON track_agent_lap_times(session_id);

CREATE INDEX IF NOT EXISTS idx_track_agent_tire_pressures_session
  ON track_agent_tire_pressures(session_id);

CREATE INDEX IF NOT EXISTS idx_track_agent_setup_changes_session
  ON track_agent_setup_changes(session_id);

CREATE INDEX IF NOT EXISTS idx_track_agent_notes_session
  ON track_agent_notes(session_id);
