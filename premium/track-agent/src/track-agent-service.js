const PRESSURE_POSITIONS = new Set(["front", "rear", "unknown"]);
const PRESSURE_TIMINGS = new Set(["cold", "hot", "before", "after", "unknown", "pre", "post"]);

export class TrackAgentValidationError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = "TrackAgentValidationError";
    this.details = details;
  }
}

function firstMatch(text, pattern) {
  const match = text.match(pattern);
  return match ? match[1].trim() : null;
}

function numberValue(value) {
  if (value == null || value === "") return null;
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

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function nullableString(value) {
  if (value == null || value === "") return null;
  return String(value);
}

function normalizeTiming(value) {
  const timing = String(value || "unknown").toLowerCase();
  if (timing === "pre") return "before";
  if (timing === "post") return "after";
  return PRESSURE_TIMINGS.has(timing) ? timing : "unknown";
}

function normalizePosition(value) {
  const position = String(value || "unknown").toLowerCase();
  return PRESSURE_POSITIONS.has(position) ? position : "unknown";
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

export function normalizeReviewedTrackAgentPayload(payload = {}) {
  const source = payload.source || "manual_review";
  const raw = payload.parsed || payload.reviewed || payload.data || payload;
  const canonical = raw.entry || raw.session || raw.lap_times || raw.tire_pressures || raw.notes
    ? {
        confirmed: payload.confirmed === true,
        source,
        entry: raw.entry || {},
        session: raw.session || {},
        lap_times: asArray(raw.lap_times),
        tire_pressures: asArray(raw.tire_pressures),
        setup_changes: asArray(raw.setup_changes),
        notes: asArray(raw.notes),
        warnings: asArray(raw.warnings),
        confidence: raw.confidence || {},
      }
    : normalizeLegacyPayload(payload, raw, source);

  canonical.entry = {
    raw_note: nullableString(canonical.entry.raw_note),
    track_name: nullableString(canonical.entry.track_name),
    bike_name: nullableString(canonical.entry.bike_name),
    event_ref: nullableString(canonical.entry.event_ref || payload.event_ref),
    motorcycle_ref: nullableString(canonical.entry.motorcycle_ref || payload.motorcycle_ref),
    track_ref: nullableString(canonical.entry.track_ref || payload.track_ref),
    app_session_ref: nullableString(canonical.entry.app_session_ref || payload.app_session_ref),
  };
  canonical.session = {
    session_number: canonical.session.session_number == null || canonical.session.session_number === ""
      ? null
      : Number(canonical.session.session_number),
    session_label: nullableString(canonical.session.session_label),
    session_type: nullableString(canonical.session.session_type),
    occurred_at: nullableString(canonical.session.occurred_at),
    conditions: canonical.session.conditions || {},
  };
  canonical.lap_times = canonical.lap_times.map((lap) => ({
    lap_number: lap.lap_number == null || lap.lap_number === "" ? null : Number(lap.lap_number),
    lap_time: lap.lap_time == null || lap.lap_time === "" ? null : String(lap.lap_time),
    is_best: lap.is_best === true,
    source: nullableString(lap.source) || "rider_note",
  }));
  canonical.tire_pressures = canonical.tire_pressures.map((pressure) => ({
    position: normalizePosition(pressure.position),
    timing: normalizeTiming(pressure.timing),
    pressure_psi: pressure.pressure_psi == null || pressure.pressure_psi === "" ? null : Number(pressure.pressure_psi),
    source: nullableString(pressure.source) || "rider_note",
  }));
  canonical.setup_changes = canonical.setup_changes.map((change) => ({
    timing: nullableString(change.timing),
    component: nullableString(change.component || change.category),
    adjustment: nullableString(change.adjustment || change.field),
    change: nullableString(change.change || change.to_value || change.delta || change.raw_text),
    source: nullableString(change.source) || "rider_note",
  }));
  canonical.notes = canonical.notes.map((note) => ({
    note_type: nullableString(note.note_type) || "rider",
    area: nullableString(note.area),
    note: nullableString(note.note || note.body),
    source: nullableString(note.source) || "rider_note",
  })).filter((note) => note.note);
  canonical.warnings = asArray(canonical.warnings).map(String);
  canonical.confidence = normalizeConfidence(canonical.confidence);
  return canonical;
}

function normalizeLegacyPayload(payload, raw, source) {
  const tirePressures = [];
  [
    ["front_cold_pressure", "front", "cold"],
    ["front_hot_pressure", "front", "hot"],
    ["rear_cold_pressure", "rear", "cold"],
    ["rear_hot_pressure", "rear", "hot"],
  ].forEach(([field, position, timing]) => {
    if (raw[field] != null && raw[field] !== "") {
      tirePressures.push({ position, timing, pressure_psi: raw[field], source: "rider_note" });
    }
  });

  return {
    confirmed: payload.confirmed === true,
    source,
    entry: {
      raw_note: raw.raw_note || payload.raw_note || null,
      track_name: raw.track_name || null,
      bike_name: raw.bike_name || null,
      event_ref: payload.event_ref || null,
      motorcycle_ref: payload.motorcycle_ref || null,
      track_ref: payload.track_ref || null,
      app_session_ref: payload.app_session_ref || null,
    },
    session: {
      session_number: raw.session_number == null ? null : raw.session_number,
      session_label: raw.session_number == null ? null : `Session ${raw.session_number}`,
      session_type: null,
      occurred_at: null,
      conditions: {},
    },
    lap_times: raw.best_lap_time ? [{
      lap_number: null,
      lap_time: raw.best_lap_time,
      is_best: true,
      source: "rider_note",
    }] : [],
    tire_pressures: tirePressures,
    setup_changes: asArray(raw.setup_changes).map((change) => ({
      timing: null,
      component: change.category || null,
      adjustment: change.field || null,
      change: change.to_value || change.delta || change.raw_text || null,
      source: "rider_note",
    })),
    notes: raw.handling_notes ? [{
      note_type: "handling",
      area: null,
      note: raw.handling_notes,
      source: "rider_note",
    }] : [],
    warnings: asArray(raw.warnings),
    confidence: { overall: numberValue(raw.confidence), fields: {} },
  };
}

function normalizeConfidence(confidence) {
  if (typeof confidence === "number") return { overall: confidence, fields: {} };
  if (!confidence || typeof confidence !== "object") return { overall: null, fields: {} };
  return {
    overall: confidence.overall == null ? null : numberValue(confidence.overall),
    fields: confidence.fields && typeof confidence.fields === "object" ? confidence.fields : {},
  };
}

export function validateReviewedTrackAgentPayload(payload) {
  const errors = [];
  const warnings = [];
  if (payload.confirmed !== true) errors.push("confirmed must be true.");
  if (!payload.entry.raw_note) errors.push("entry.raw_note is required.");
  if (payload.session.session_number != null && !Number.isFinite(payload.session.session_number)) {
    errors.push("session.session_number must be numeric when present.");
  }
  payload.lap_times.forEach((lap, index) => {
    if (lap.lap_time != null && typeof lap.lap_time !== "string") {
      errors.push(`lap_times[${index}].lap_time must be a string when present.`);
    }
  });
  payload.tire_pressures.forEach((pressure, index) => {
    if (!PRESSURE_POSITIONS.has(pressure.position)) {
      errors.push(`tire_pressures[${index}].position is not supported.`);
    }
    if (!PRESSURE_TIMINGS.has(pressure.timing)) {
      errors.push(`tire_pressures[${index}].timing is not supported.`);
    }
    if (pressure.pressure_psi != null && !Number.isFinite(pressure.pressure_psi)) {
      errors.push(`tire_pressures[${index}].pressure_psi must be numeric when present.`);
    }
  });

  if (!payload.entry.track_name) warnings.push("Track name is missing.");
  if (!payload.entry.bike_name) warnings.push("Bike name is missing.");
  if (payload.session.session_number == null) warnings.push("Session number is missing.");
  if (!payload.lap_times.length) warnings.push("No lap times were reviewed.");
  if (!payload.tire_pressures.length) warnings.push("No tire pressures were reviewed.");
  if (!payload.setup_changes.length) warnings.push("No setup changes were reviewed.");
  if (!payload.notes.length) warnings.push("No rider notes were reviewed.");

  return { ok: errors.length === 0, errors, warnings };
}

export async function saveReviewedTrackAgentSession(env, reviewedPayload) {
  const database = db(env);
  const normalized = normalizeReviewedTrackAgentPayload(reviewedPayload);
  const validation = validateReviewedTrackAgentPayload(normalized);
  if (!validation.ok) {
    throw new TrackAgentValidationError("Reviewed Track Agent payload is invalid.", validation.errors);
  }

  const entryId = newId("tae");
  const sessionId = newId("tas");
  const userId = reviewedPayload.user_id || normalized.entry.user_id || "anonymous";
  const allWarnings = [...normalized.warnings, ...validation.warnings];
  const statements = [
    database.prepare(`
      INSERT INTO track_agent_entries (
        id, user_id, motorcycle_ref, track_ref, event_ref, app_session_ref,
        raw_note, parser_version, confidence, warnings_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      entryId,
      userId,
      normalized.entry.motorcycle_ref,
      normalized.entry.track_ref,
      normalized.entry.event_ref,
      normalized.entry.app_session_ref,
      normalized.entry.raw_note,
      "review-v1",
      normalized.confidence.overall,
      jsonText(allWarnings, [])
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
      normalized.entry.track_name,
      normalized.entry.bike_name,
      normalized.session.session_number,
      null,
      normalized.notes.map((note) => note.note).filter(Boolean).join(" | ") || null
    ),
  ];

  const reviewedLapTimes = normalized.lap_times.filter((lap) => lap.lap_time);
  for (const lap of reviewedLapTimes) {
    statements.push(database.prepare(`
      INSERT INTO track_agent_lap_times (
        id, session_id, user_id, lap_label, lap_time_raw, lap_time_ms
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      newId("tal"),
      sessionId,
      userId,
      lap.is_best ? "best" : lap.lap_number == null ? null : `lap ${lap.lap_number}`,
      lap.lap_time,
      lapTimeToMs(lap.lap_time)
    ));
  }

  const reviewedPressures = normalized.tire_pressures.filter((pressure) => pressure.pressure_psi != null);
  for (const tire of reviewedPressures) {
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
      tire.pressure_psi
    ));
  }

  for (const change of normalized.setup_changes) {
    statements.push(database.prepare(`
      INSERT INTO track_agent_setup_changes (
        id, session_id, user_id, category, field, from_value, to_value,
        delta, reason, result, raw_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      newId("tac"),
      sessionId,
      userId,
      change.component,
      change.adjustment,
      null,
      change.change,
      null,
      change.timing,
      null,
      [change.component, change.adjustment, change.change].filter(Boolean).join(" ") || null
    ));
  }

  for (const note of normalized.notes) {
    statements.push(database.prepare(`
      INSERT INTO track_agent_notes (
        id, session_id, user_id, note_type, body
      ) VALUES (?, ?, ?, ?, ?)
    `).bind(
      newId("tan"),
      sessionId,
      userId,
      note.note_type,
      note.area ? `${note.area}: ${note.note}` : note.note
    ));
  }

  await database.batch(statements);

  return {
    id: sessionId,
    entry_id: entryId,
    session_id: sessionId,
    status: "saved",
    persisted: true,
    warnings: allWarnings,
    counts: {
      entries: 1,
      sessions: 1,
      lap_times: reviewedLapTimes.length,
      tire_pressures: reviewedPressures.length,
      setup_changes: normalized.setup_changes.length,
      notes: normalized.notes.length,
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
