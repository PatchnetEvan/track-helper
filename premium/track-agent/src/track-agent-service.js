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
  void env;
  return {
    id: `tas_${Date.now().toString(36)}`,
    status: "mock_saved",
    persisted: false,
    message: "Scaffold only: D1 persistence will be wired after the API shape is approved.",
    reviewed_payload: reviewedPayload,
  };
}

export async function getTrackAgentSessions(env, userId) {
  void env;
  void userId;
  return [];
}

export async function getTrackAgentSession(env, userId, sessionId) {
  void env;
  return {
    id: sessionId,
    user_id: userId,
    status: "mock_session",
    track_name: "Sample Track",
    bike_name: "Sample Bike",
  };
}

export async function summarizeTrackAgentDay(env, userId, dayId) {
  void env;
  return {
    id: dayId,
    user_id: userId,
    status: "mock_summary",
    session_count: 0,
    notes: "Scaffold summary endpoint. D1-backed summaries are not wired yet.",
  };
}
