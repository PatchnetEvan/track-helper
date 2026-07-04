export const TRACK_AGENT_TIRE_POSITIONS = ["front", "rear", "unknown"];
export const TRACK_AGENT_TIRE_TIMINGS = ["cold", "hot", "before", "after", "unknown", "pre", "post"];
export const TRACK_AGENT_SESSION_TYPES = ["practice", "qualifying", "race", "track_day", "test", "unknown"];

export const TRACK_AGENT_REVIEW_PAYLOAD_SCHEMA = {
  confirmed: "boolean",
  source: "string|null",
  entry: {
    raw_note: "string|required",
    track_name: "string|null",
    bike_name: "string|null",
    event_ref: "string|null",
    motorcycle_ref: "string|null",
    track_ref: "string|null",
    app_session_ref: "string|null",
  },
  session: {
    session_number: "number|null",
    session_label: "string|null",
    session_type: "string|null",
    occurred_at: "string|null",
    conditions: "object",
  },
  lap_times: [{
    lap_number: "number|null",
    lap_time: "string|null",
    is_best: "boolean",
    source: "string",
  }],
  tire_pressures: [{
    position: TRACK_AGENT_TIRE_POSITIONS,
    timing: TRACK_AGENT_TIRE_TIMINGS,
    pressure_psi: "number|null",
    source: "string",
  }],
  setup_changes: [{
    timing: "string|null",
    component: "string|null",
    adjustment: "string|null",
    change: "string|null",
    source: "string",
  }],
  notes: [{
    note_type: "string",
    area: "string|null",
    note: "string|null",
    source: "string",
  }],
  warnings: ["string"],
  confidence: {
    overall: "number|null",
    fields: "object",
  },
};

const nullableString = { type: ["string", "null"] };
const nullableNumber = { type: ["number", "null"] };

export const TRACK_AGENT_REVIEW_PAYLOAD_JSON_SCHEMA = {
  type: "object",
  description: "Canonical Track Agent reviewed payload draft for motorcycle track-session logging extraction.",
  additionalProperties: false,
  required: [
    "confirmed",
    "source",
    "entry",
    "session",
    "lap_times",
    "tire_pressures",
    "setup_changes",
    "notes",
    "warnings",
    "confidence",
  ],
  properties: {
    confirmed: { type: "boolean", const: false },
    source: { type: "string", const: "ai_json" },
    entry: {
      type: "object",
      additionalProperties: false,
      required: ["raw_note", "track_name", "bike_name", "event_ref", "motorcycle_ref", "track_ref", "app_session_ref"],
      properties: {
        raw_note: { type: "string" },
        track_name: nullableString,
        bike_name: nullableString,
        event_ref: nullableString,
        motorcycle_ref: nullableString,
        track_ref: nullableString,
        app_session_ref: nullableString,
      },
    },
    session: {
      type: "object",
      additionalProperties: false,
      required: ["session_number", "session_label", "session_type", "occurred_at", "conditions"],
      properties: {
        session_number: nullableNumber,
        session_label: nullableString,
        session_type: nullableString,
        occurred_at: nullableString,
        conditions: {
          type: "object",
          additionalProperties: true,
        },
      },
    },
    lap_times: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["lap_number", "lap_time", "is_best", "source"],
        properties: {
          lap_number: { ...nullableNumber, description: "Lap number when the rider gave a specific lap number; otherwise null." },
          lap_time: { ...nullableString, description: "Lap time exactly as stated, such as '97.4', '1:37.4', or '00:01:37.400'. Capture phrases like 'best lap 97.4', 'best 97.4', and 'lap 1:37.4'." },
          is_best: { type: "boolean", description: "True when the rider says this is the best lap or uses phrasing like 'best lap' or 'best 97.4'." },
          source: { type: "string" },
        },
      },
    },
    tire_pressures: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["position", "timing", "pressure_psi", "source"],
        properties: {
          position: { type: "string", enum: TRACK_AGENT_TIRE_POSITIONS, description: "Use front for front tire pressure, rear for rear tire pressure, otherwise unknown." },
          timing: { type: "string", enum: TRACK_AGENT_TIRE_TIMINGS, description: "Use hot for phrases like 'front hot 31', cold for 'rear cold 27', before/after only when stated." },
          pressure_psi: { ...nullableNumber, description: "Numeric PSI value from pressure phrases, preserving decimals such as 27.5." },
          source: { type: "string" },
        },
      },
    },
    setup_changes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["timing", "component", "adjustment", "change", "source"],
        properties: {
          timing: nullableString,
          component: { ...nullableString, description: "Bike area changed, such as rear suspension, front suspension, gearing, fork height, or sprocket." },
          adjustment: { ...nullableString, description: "Specific adjustment such as rebound, compression, rear sprocket, front sprocket, fork height, or visible fork tube." },
          change: { ...nullableString, description: "Change text exactly as stated, such as 'softer one click', '+2', or '45 -> 47'." },
          source: { type: "string" },
        },
      },
    },
    notes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["note_type", "area", "note", "source"],
        properties: {
          note_type: { type: "string", description: "Use handling for rider feel phrases like loose, pushing, running wide, chatter, vague, grip, spin, or stability." },
          area: { ...nullableString, description: "Corner, phase, or track section if stated, such as 'Turn 7 exit', 'entry', 'mid-corner', or 'corner exit'." },
          note: { ...nullableString, description: "Rider's observed symptom only, not advice. Capture phrases like 'felt loose on exit of Turn 7', 'pushing on entry', or 'running wide'." },
          source: { type: "string" },
        },
      },
    },
    warnings: {
      type: "array",
      description: "Use warnings for missing or ambiguous log fields, not for coaching or safety advice.",
      items: { type: "string" },
    },
    confidence: {
      type: "object",
      additionalProperties: false,
      required: ["overall", "fields"],
      properties: {
        overall: nullableNumber,
        fields: {
          type: "object",
          additionalProperties: true,
        },
      },
    },
  },
};

const TIRE_POSITION_SET = new Set(TRACK_AGENT_TIRE_POSITIONS);
const TIRE_TIMING_SET = new Set(TRACK_AGENT_TIRE_TIMINGS);
const SESSION_TYPE_SET = new Set(TRACK_AGENT_SESSION_TYPES);
const TOP_LEVEL_KEYS = new Set(["confirmed", "source", "entry", "session", "lap_times", "tire_pressures", "setup_changes", "notes", "warnings", "confidence"]);
const ENTRY_KEYS = new Set(["raw_note", "track_name", "bike_name", "event_ref", "motorcycle_ref", "track_ref", "app_session_ref"]);
const SESSION_KEYS = new Set(["session_number", "session_label", "session_type", "occurred_at", "conditions"]);
const LAP_TIME_KEYS = new Set(["lap_number", "lap_time", "is_best", "source"]);
const TIRE_PRESSURE_KEYS = new Set(["position", "timing", "pressure_psi", "source"]);
const SETUP_CHANGE_KEYS = new Set(["timing", "component", "adjustment", "change", "source"]);
const NOTE_KEYS = new Set(["note_type", "area", "note", "source"]);
const CONFIDENCE_KEYS = new Set(["overall", "fields"]);

function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isNumberOrNull(value) {
  return value == null || Number.isFinite(value);
}

function isStringOrNull(value) {
  return value == null || typeof value === "string";
}

function validateArray(value, name, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${name} must be an array.`);
    return [];
  }
  return value;
}

function validateKnownKeys(value, allowedKeys, path, errors) {
  Object.keys(value).forEach((key) => {
    if (!allowedKeys.has(key)) errors.push(`${path}.${key} is not part of the canonical Track Agent payload.`);
  });
}

export function validateTrackAgentReviewPayload(payload, options = {}) {
  const errors = [];
  const warnings = [];
  const requireConfirmed = options.requireConfirmed === true;

  if (!isObject(payload)) {
    return {
      ok: false,
      errors: ["payload must be an object."],
      warnings,
    };
  }

  if (typeof payload.confirmed !== "boolean") {
    errors.push("confirmed must be boolean.");
  } else if (requireConfirmed && payload.confirmed !== true) {
    errors.push("confirmed must be true.");
  }
  validateKnownKeys(payload, TOP_LEVEL_KEYS, "payload", errors);

  if (!isStringOrNull(payload.source)) errors.push("source must be a string when present.");

  if (!isObject(payload.entry)) {
    errors.push("entry must be an object.");
  } else {
    validateKnownKeys(payload.entry, ENTRY_KEYS, "entry", errors);
    if (!payload.entry.raw_note) errors.push("entry.raw_note is required.");
    ["raw_note", "track_name", "bike_name", "event_ref", "motorcycle_ref", "track_ref", "app_session_ref"].forEach((field) => {
      if (!isStringOrNull(payload.entry[field])) errors.push(`entry.${field} must be a string when present.`);
    });
    if (!payload.entry.track_name) warnings.push("Track name is missing.");
    if (!payload.entry.bike_name) warnings.push("Bike name is missing.");
  }

  if (!isObject(payload.session)) {
    errors.push("session must be an object.");
  } else {
    validateKnownKeys(payload.session, SESSION_KEYS, "session", errors);
    if (!isNumberOrNull(payload.session.session_number)) {
      errors.push("session.session_number must be numeric when present.");
    }
    if (!isStringOrNull(payload.session.session_label)) errors.push("session.session_label must be a string when present.");
    if (!isStringOrNull(payload.session.session_type)) {
      errors.push("session.session_type must be a string when present.");
    } else if (payload.session.session_type && !SESSION_TYPE_SET.has(payload.session.session_type)) {
      warnings.push(`Session type '${payload.session.session_type}' is not a known Track Agent type.`);
    }
    if (!isStringOrNull(payload.session.occurred_at)) errors.push("session.occurred_at must be a string when present.");
    if (!isObject(payload.session.conditions)) errors.push("session.conditions must be an object.");
    if (payload.session.session_number == null) warnings.push("Session number is missing.");
  }

  validateArray(payload.lap_times, "lap_times", errors).forEach((lap, index) => {
    if (!isObject(lap)) {
      errors.push(`lap_times[${index}] must be an object.`);
      return;
    }
    validateKnownKeys(lap, LAP_TIME_KEYS, `lap_times[${index}]`, errors);
    if (!isNumberOrNull(lap.lap_number)) errors.push(`lap_times[${index}].lap_number must be numeric when present.`);
    if (!isStringOrNull(lap.lap_time)) errors.push(`lap_times[${index}].lap_time must be a string when present.`);
    if (typeof lap.is_best !== "boolean") errors.push(`lap_times[${index}].is_best must be boolean.`);
    if (typeof lap.source !== "string") errors.push(`lap_times[${index}].source must be a string.`);
  });

  validateArray(payload.tire_pressures, "tire_pressures", errors).forEach((pressure, index) => {
    if (!isObject(pressure)) {
      errors.push(`tire_pressures[${index}] must be an object.`);
      return;
    }
    validateKnownKeys(pressure, TIRE_PRESSURE_KEYS, `tire_pressures[${index}]`, errors);
    if (!TIRE_POSITION_SET.has(pressure.position)) {
      errors.push(`tire_pressures[${index}].position is not supported.`);
    }
    if (!TIRE_TIMING_SET.has(pressure.timing)) {
      errors.push(`tire_pressures[${index}].timing is not supported.`);
    }
    if (!isNumberOrNull(pressure.pressure_psi)) {
      errors.push(`tire_pressures[${index}].pressure_psi must be numeric when present.`);
    }
    if (typeof pressure.source !== "string") errors.push(`tire_pressures[${index}].source must be a string.`);
  });

  validateArray(payload.setup_changes, "setup_changes", errors).forEach((change, index) => {
    if (!isObject(change)) {
      errors.push(`setup_changes[${index}] must be an object.`);
      return;
    }
    validateKnownKeys(change, SETUP_CHANGE_KEYS, `setup_changes[${index}]`, errors);
    ["timing", "component", "adjustment", "change"].forEach((field) => {
      if (!isStringOrNull(change[field])) errors.push(`setup_changes[${index}].${field} must be a string when present.`);
    });
    if (typeof change.source !== "string") errors.push(`setup_changes[${index}].source must be a string.`);
  });

  validateArray(payload.notes, "notes", errors).forEach((note, index) => {
    if (!isObject(note)) {
      errors.push(`notes[${index}] must be an object.`);
      return;
    }
    validateKnownKeys(note, NOTE_KEYS, `notes[${index}]`, errors);
    if (typeof note.note_type !== "string") errors.push(`notes[${index}].note_type must be a string.`);
    if (!isStringOrNull(note.area)) errors.push(`notes[${index}].area must be a string when present.`);
    if (!isStringOrNull(note.note)) errors.push(`notes[${index}].note must be a string when present.`);
    if (typeof note.source !== "string") errors.push(`notes[${index}].source must be a string.`);
  });

  validateArray(payload.warnings, "warnings", errors).forEach((warning, index) => {
    if (typeof warning !== "string") errors.push(`warnings[${index}] must be a string.`);
  });

  if (payload.confidence != null) {
    if (!isObject(payload.confidence)) {
      errors.push("confidence must be an object when present.");
    } else {
      validateKnownKeys(payload.confidence, CONFIDENCE_KEYS, "confidence", errors);
      if (!isNumberOrNull(payload.confidence.overall)) {
        errors.push("confidence.overall must be numeric when present.");
      }
      if (!isObject(payload.confidence.fields)) {
        errors.push("confidence.fields must be an object.");
      }
    }
  }

  if (Array.isArray(payload.lap_times) && !payload.lap_times.length) warnings.push("No lap times were reviewed.");
  if (Array.isArray(payload.tire_pressures) && !payload.tire_pressures.length) warnings.push("No tire pressures were reviewed.");
  if (Array.isArray(payload.setup_changes) && !payload.setup_changes.length) warnings.push("No setup changes were reviewed.");
  if (Array.isArray(payload.notes) && !payload.notes.length) warnings.push("No rider notes were reviewed.");

  return { ok: errors.length === 0, errors, warnings };
}
