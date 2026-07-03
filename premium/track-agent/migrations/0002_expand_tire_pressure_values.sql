-- Expand Track Agent tire pressure enum values without touching free app data.
-- Keeps the original table as track_agent_tire_pressures_v1 for backup.

ALTER TABLE track_agent_tire_pressures RENAME TO track_agent_tire_pressures_v1;

CREATE TABLE IF NOT EXISTS track_agent_tire_pressures (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  position TEXT NOT NULL CHECK (position IN ('front', 'rear', 'unknown')),
  timing TEXT NOT NULL CHECK (timing IN ('cold', 'hot', 'before', 'after', 'unknown', 'pre', 'post')),
  pressure_psi REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES track_agent_sessions(id)
);

INSERT INTO track_agent_tire_pressures (
  id, session_id, user_id, position, timing, pressure_psi, created_at
)
SELECT
  id,
  session_id,
  user_id,
  position,
  timing,
  pressure_psi,
  created_at
FROM track_agent_tire_pressures_v1;

CREATE INDEX IF NOT EXISTS idx_track_agent_tire_pressures_session
  ON track_agent_tire_pressures(session_id);
