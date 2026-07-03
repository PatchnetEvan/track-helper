function firstMatch(text, pattern) {
  const match = text.match(pattern);
  return match ? match[1].trim() : null;
}

function numberValue(value) {
  if (value == null) return null;
  const n = Number(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function lapTimeValue(text) {
  return firstMatch(text, /\b(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?|\d{2,3}\.\d{1,3})\b/);
}

function pressureValue(text, label) {
  const pattern = new RegExp(`(?:${label})[^\\d]*(\\d{2}(?:\\.\\d+)?)`, "i");
  return numberValue(firstMatch(text, pattern));
}

function newId(prefix) {
  const random = globalThis.crypto && typeof globalThis.crypto.randomUUID === "function"
    ? globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 18)
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${random}`;
}

function db(env) {
  if (!env || !env.TRACK_AGENT_DB) {
    throw new Error("TRACK_AGENT_DB binding is not available.");
  }
  return env.TRACK_AGENT_DB;
}

function reviewedData(payload) {
  return payload.parsed || payload.reviewed || payload.data || payload;
}

function jsonText(value, fallback) {
  try {
    return JSON.stringify(value == null ? fallback : value);
  } catch (e) {
    return JSON.stringify(fallback);
  }
}

function lapTimeToMs(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (/^\d+(?:\.\d+)?$/.test(text)) return Math.round(Number(text) * 1000);
  const parts = text.split(":");
  if (parts.length === 2) {
    const mins = Number(parts[0]);
    const secs = Number(parts[1]);
    if (Number.isFinite(mins) && Number.isFinite(secs)) return Math.round((mins * 60 + secs) * 1000);
  }
  if (parts.length === 3) {
    const hours = Number(parts[0]);
    const mins = Number(parts[1]);
    const secs = Number(parts[2]);
    if ([hours, mins, secs].every(Number.isFinite)) return Math.round((hours * 3600 + mins * 60 + secs) * 1000);
  }
  return null;
}

function tirePressureRows(data) {
  const rows = [];
  [
    ["front_cold_pressure", "front", "cold"],
    ["front_hot_pressure", "front", "hot"],
    ["rear_cold_pressure", "rear", "cold"],
    ["rear_hot_pressure", "rear", "hot"],
  ].forEach(([field, position, timing]) => {
    const pressure = numberValue(data[field]);
    if (pressure != null) rows.push({ position, timing, pressure });
  });
  return rows;
}

export function parseTrackSessionNote(rawNote, context = {}) {
  const note = String(rawNote || "").trim();
  const warnings = [];

  if (!note) {
    warnings.push("raw_note is required before saving.");
  }

  const trackName = firstMatch(note, /\b(?:at|track)\s+([A-Z][A-Za-z0-9 .'-]+?)(?:[,.;]|\s+session|\s+s\d|\s+on\b|\s+best\b|\s+front\b|\s+rear\b|$)/i);
  const bikeName = firstMatch(note, /\b(?:bike|on)\s+([A-Z][A-Za-z0-9 .'-]+?)(?:[,.;]|\s+session|\s+s\d|\s+at\b|\s+best\b|\s+front\b|\s+rear\b|$)/i);
  const sessionRaw = firstMatch(note, /\b(?:session|s)\s*#?\s*(\d+)\b/i);
  const sessionNumber = sessionRaw == null ? null : Number(sessionRaw);

  const parsed = {
    track_name: trackName || context.track_ref || null,
    bike_name: bikeName || context.motorcycle_ref || null,
    session_number: Number.isFinite(sessionNumber) ? sessionNumber : null,
    best_lap_time: lapTimeValue(note),
    front_cold_pressure: pressureValue(note, "front cold|fc|front pre"),
    front_hot_pressure: pressureValue(note, "front hot|fh|front post"),
    rear_cold_pressure: pressureValue(note, "rear cold|rc|rear pre"),
    rear_hot_pressure: pressureValue(note, "rear hot|rh|rear post"),
    handling_notes: firstMatch(note, /\b(?:felt|handling|bike felt)\s*[:=-]?\s*([^.;]+)/i),
    setup_changes: [],
    coaching_focus: firstMatch(note, /\b(?:focus|working on|chasing)\s*[:=-]?\s*([^.;]+)/i),
    raw_note: note,
    warnings,
    confidence: 0.55,
  };

  const changePatterns = [
    /\b(rear\s+comp(?:ression)?|front\s+comp(?:ression)?|rear\s+reb(?:ound)?|front\s+reb(?:ound)?)\s*([+-]\s*\d+)\b/ig,
    /\b(?:sprocket|rear\s+sprocket)\s*(\d{2})\s*(?:->|to)\s*(\d{2})\b/ig,
    /\b(?:fork|forks)\s*(?:tube\s*)?(?:raised|up|showing)\s*(\d+(?:\.\d+)?)\s*mm\b/ig,
  ];

  for (const pattern of changePatterns) {
    for (const match of note.matchAll(pattern)) {
      if (match.length === 3 && /^\d{2}$/.test(match[1])) {
        parsed.setup_changes.push({
          category: "gearing",
          field: "rear_sprocket",
          from_value: match[1],
          to_value: match[2],
          raw_text: match[0],
        });
      } else if (match.length === 3) {
        parsed.setup_changes.push({
          category: "suspension",
          field: match[1].toLowerCase().replace(/\s+/g, "_"),
          delta: match[2].replace(/\s+/g, ""),
          raw_text: match[0],
        });
      } else {
        parsed.setup_changes.push({
          category: "geometry",
          field: "visible_fork_tube_mm",
          to_value: match[1],
          raw_text: match[0],
        });
      }
    }
  }

  if (!parsed.track_name) warnings.push("Track name was not detected.");
  if (!parsed.bike_name) warnings.push("Bike name was not detected.");
  if (parsed.session_number == null) warnings.push("Session number was not detected.");

  return parsed;
}

export async function saveReviewedTrackAgentSession(env, reviewedPayload) {
  const database = db(env);
  const data = reviewedData(reviewedPayload);
  const rawNote = String(data.raw_note || reviewedPayload.raw_note || "").trim();
  if (!rawNote) {
    throw new Error("raw_note is required.");
  }

  const entryId = newId("tae");
  const sessionId = newId("tas");
  const userId = reviewedPayload.user_id || data.user_id || "anonymous";
  const setupChanges = Array.isArray(data.setup_changes) ? data.setup_changes : [];
  const warnings = Array.isArray(data.warnings) ? data.warnings : [];
  const tireRows = tirePressureRows(data);
  const statements = [
    database.prepare(`
      INSERT INTO track_agent_entries (
        id, user_id, motorcycle_ref, track_ref, event_ref, app_session_ref,
        raw_note, parser_version, confidence, warnings_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      entryId,
      userId,
      reviewedPayload.motorcycle_ref || null,
      reviewedPayload.track_ref || null,
      reviewedPayload.event_ref || null,
      reviewedPayload.app_session_ref || null,
      rawNote,
      data.parser_version || "mock-v1",
      numberValue(data.confidence),
      jsonText(warnings, [])
    ),
    database.prepare(`
      INSERT INTO track_agent_sessions (
        id, entry_id, user_id, track_name, bike_name, session_number,
        coaching_focus, handling_notes, confirmed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(
      sessionId,
      entryId,
      userId,
      data.track_name || null,
      data.bike_name || null,
      Number.isFinite(Number(data.session_number)) ? Number(data.session_number) : null,
      data.coaching_focus || null,
      data.handling_notes || null
    ),
  ];

  if (data.best_lap_time) {
    statements.push(database.prepare(`
      INSERT INTO track_agent_lap_times (
        id, session_id, user_id, lap_label, lap_time_raw, lap_time_ms
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      newId("tal"),
      sessionId,
      userId,
      "best",
      String(data.best_lap_time),
      lapTimeToMs(data.best_lap_time)
    ));
  }

  for (const tire of tireRows) {
    statements.push(database.prepare(`
      INSERT INTO track_agent_tire_pressures (
        id, session_id, user_id, position, timing, pressure_psi
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      newId("tap"),
      sessionId,
      userId,
      tire.position,
      tire.timing,
      tire.pressure
    ));
  }

  for (const change of setupChanges) {
    statements.push(database.prepare(`
      INSERT INTO track_agent_setup_changes (
        id, session_id, user_id, category, field, from_value, to_value,
        delta, reason, result, raw_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      newId("tac"),
      sessionId,
      userId,
      change.category || null,
      change.field || null,
      change.from_value != null ? String(change.from_value) : null,
      change.to_value != null ? String(change.to_value) : null,
      change.delta != null ? String(change.delta) : null,
      change.reason || data.coaching_focus || null,
      change.result || null,
      change.raw_text || null
    ));
  }

  statements.push(database.prepare(`
    INSERT INTO track_agent_notes (
      id, session_id, user_id, note_type, body
    ) VALUES (?, ?, ?, ?, ?)
  `).bind(
    newId("tan"),
    sessionId,
    userId,
    "rider",
    rawNote
  ));

  await database.batch(statements);

  return {
    id: sessionId,
    entry_id: entryId,
    session_id: sessionId,
    status: "saved",
    persisted: true,
    counts: {
      entries: 1,
      sessions: 1,
      lap_times: data.best_lap_time ? 1 : 0,
      tire_pressures: tireRows.length,
      setup_changes: setupChanges.length,
      notes: 1,
    },
  };
}

export async function getTrackAgentSessions(env, userId) {
  const database = db(env);
  const result = await database.prepare(`
    SELECT
      s.id,
      s.entry_id,
      s.user_id,
      s.track_name,
      s.bike_name,
      s.session_number,
      s.coaching_focus,
      s.handling_notes,
      s.confirmed_at,
      s.created_at,
      e.raw_note,
      e.confidence,
      e.warnings_json
    FROM track_agent_sessions s
    JOIN track_agent_entries e ON e.id = s.entry_id
    WHERE s.user_id = ?
    ORDER BY s.created_at DESC
    LIMIT 50
  `).bind(userId).all();
  return (result.results || []).map((row) => ({
    ...row,
    warnings: parseJsonArray(row.warnings_json),
  }));
}

export async function getTrackAgentSession(env, userId, sessionId) {
  const database = db(env);
  const session = await database.prepare(`
    SELECT
      s.id,
      s.entry_id,
      s.user_id,
      s.track_name,
      s.bike_name,
      s.session_number,
      s.coaching_focus,
      s.handling_notes,
      s.confirmed_at,
      s.created_at,
      s.updated_at,
      e.motorcycle_ref,
      e.track_ref,
      e.event_ref,
      e.app_session_ref,
      e.raw_note,
      e.parser_version,
      e.confidence,
      e.warnings_json,
      e.created_at AS entry_created_at
    FROM track_agent_sessions s
    JOIN track_agent_entries e ON e.id = s.entry_id
    WHERE s.id = ? AND s.user_id = ?
  `).bind(sessionId, userId).first();

  if (!session) return null;

  const [lapTimes, tirePressures, setupChanges, notes] = await Promise.all([
    database.prepare(`
      SELECT id, lap_label, lap_time_raw, lap_time_ms, created_at
      FROM track_agent_lap_times
      WHERE session_id = ? AND user_id = ?
      ORDER BY created_at ASC
    `).bind(sessionId, userId).all(),
    database.prepare(`
      SELECT id, position, timing, pressure_psi, created_at
      FROM track_agent_tire_pressures
      WHERE session_id = ? AND user_id = ?
      ORDER BY position ASC, timing ASC
    `).bind(sessionId, userId).all(),
    database.prepare(`
      SELECT id, category, field, from_value, to_value, delta, reason, result, raw_text, created_at
      FROM track_agent_setup_changes
      WHERE session_id = ? AND user_id = ?
      ORDER BY created_at ASC
    `).bind(sessionId, userId).all(),
    database.prepare(`
      SELECT id, note_type, body, created_at
      FROM track_agent_notes
      WHERE session_id = ? AND user_id = ?
      ORDER BY created_at ASC
    `).bind(sessionId, userId).all(),
  ]);

  return {
    id: session.id,
    entry: {
      id: session.entry_id,
      user_id: session.user_id,
      motorcycle_ref: session.motorcycle_ref,
      track_ref: session.track_ref,
      event_ref: session.event_ref,
      app_session_ref: session.app_session_ref,
      raw_note: session.raw_note,
      parser_version: session.parser_version,
      confidence: session.confidence,
      warnings: parseJsonArray(session.warnings_json),
      created_at: session.entry_created_at,
    },
    session: {
      id: session.id,
      user_id: session.user_id,
      track_name: session.track_name,
      bike_name: session.bike_name,
      session_number: session.session_number,
      coaching_focus: session.coaching_focus,
      handling_notes: session.handling_notes,
      confirmed_at: session.confirmed_at,
      created_at: session.created_at,
      updated_at: session.updated_at,
    },
    lap_times: lapTimes.results || [],
    tire_pressures: tirePressures.results || [],
    setup_changes: setupChanges.results || [],
    notes: notes.results || [],
  };
}

export async function summarizeTrackAgentDay(env, userId, dayId) {
  const sessions = await getTrackAgentSessions(env, userId);
  return {
    id: dayId,
    user_id: userId,
    status: "summary",
    session_count: sessions.length,
    sessions,
  };
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}
