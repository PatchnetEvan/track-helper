const DEFAULT_MAX_RAW_NOTE_CHARS = 4000;

const TRACK_CONTENT_PATTERNS = [
  /\b(session|practice|qualifying|race|lap|best|track|turn|corner)\b/i,
  /\b(front|rear)\s+(hot|cold)\b/i,
  /\bpsi\b/i,
  /\b(tire|tyre|pressure|warmer)\b/i,
  /\b(rebound|compression|preload|sprocket|gearing|fork|shock)\b/i,
  /\b(loose|greasy|pushing|running wide|chatter|braking|entry|exit|mid[-\s]?corner)\b/i,
];

const ADVICE_QUESTION_PATTERNS = [
  /\bwhat\s+(?:tire|tyre)\s+pressure\s+should\s+i\s+run\b/i,
  /\bwhat\s+pressure\s+should\s+i\s+run\b/i,
  /\bshould\s+i\s+(?:add|remove|change|soften|stiffen|raise|lower|drop)\b/i,
  /\bwhat\s+should\s+i\s+(?:change|do|adjust)\b/i,
  /\bhow\s+should\s+i\s+(?:set|adjust|fix)\b/i,
  /\brecommend(?:ation)?\b/i,
  /\bgive\s+me\s+(?:setup|riding|safety)\s+advice\b/i,
];

const SENSITIVE_PATTERNS = [
  /\b(?:medical|diagnosis|prescription|medication|doctor|hospital|injury|concussion|blood pressure)\b/i,
  /\b(?:credit card|debit card|bank account|routing number|account number|billing|invoice|payment)\b/i,
  /\b(?:social security|ssn|passport|driver'?s license|license number|date of birth|dob)\b/i,
  /\b(?:emergency contact|next of kin)\b/i,
];

const CHATBOT_PATTERNS = [
  /\b(write|draft|compose)\s+(?:an|a|the)?\s*(email|poem|story|post|caption)\b/i,
  /\bwhat\s+is\s+the\s+(?:capital|weather|news|stock)\b/i,
  /\btell\s+me\s+(?:a joke|about|why)\b/i,
  /\bplan\s+(?:my|a)\s+(?:trip|vacation|meal)\b/i,
  /\bsolve\s+this\b/i,
];

const OUTPUT_ADVICE_PATTERNS = [
  /\byou\s+should\b/i,
  /\bi\s+recommend\b/i,
  /\brecommend(?:ed|ation)?\b/i,
  /\btry\s+(?:adding|removing|softening|stiffening|raising|lowering|running)\b/i,
  /\brun\s+\d+(?:\.\d+)?\s*psi\b/i,
  /\b(?:safe|unsafe|dangerous)\s+to\s+(?:ride|run|continue)\b/i,
];

export class TrackAgentScopeError extends Error {
  constructor(code, message, details = []) {
    super(message);
    this.name = "TrackAgentScopeError";
    this.code = code;
    this.details = details;
    this.status = code === "raw_note_too_long" ? 413 : 400;
  }
}

function maxRawNoteChars(env = {}) {
  const configured = Number(env.TRACK_AGENT_MAX_RAW_NOTE_CHARS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_RAW_NOTE_CHARS;
}

function textFrom(value) {
  return String(value || "").trim();
}

function hasAny(patterns, text) {
  return patterns.some((pattern) => pattern.test(text));
}

function containsTrackContent(text) {
  return hasAny(TRACK_CONTENT_PATTERNS, text);
}

function noteWarnings(text) {
  const warnings = [];
  if (/\b(?:buy|groceries|dinner|hotel|flight|meeting|birthday)\b/i.test(text) && containsTrackContent(text)) {
    warnings.push("Note contains possible unrelated personal text; review parsed fields before saving.");
  }
  return warnings;
}

export function evaluateTrackAgentInputScope(rawNote, env = {}) {
  const note = textFrom(rawNote);
  const maxChars = maxRawNoteChars(env);

  if (!note) {
    throw new TrackAgentScopeError("raw_note_required", "Track Agent needs a track-session note to parse.", [
      "raw_note is required.",
    ]);
  }

  if (note.length > maxChars) {
    throw new TrackAgentScopeError("raw_note_too_long", "Track Agent note is too long to parse safely.", [
      `raw_note exceeds ${maxChars} characters.`,
    ]);
  }

  if (hasAny(SENSITIVE_PATTERNS, note)) {
    throw new TrackAgentScopeError("scope_sensitive_content", "Track Agent cannot process sensitive personal, medical, payment, account, or emergency-contact content.", [
      "Remove sensitive content and keep the note focused on the track session.",
    ]);
  }

  if (hasAny(ADVICE_QUESTION_PATTERNS, note)) {
    throw new TrackAgentScopeError("scope_advice_request", "Track Agent is extraction-only and cannot answer coaching, setup, or safety-advice questions.", [
      "Enter what happened and what changes were already made, not what Track Agent should recommend.",
    ]);
  }

  if (!containsTrackContent(note) || hasAny(CHATBOT_PATTERNS, note)) {
    throw new TrackAgentScopeError("scope_unrelated_prompt", "Track Agent only extracts motorcycle track-session logging data.", [
      "Use Track Agent for session details, lap times, tire pressures, setup changes already performed, and rider notes.",
    ]);
  }

  return {
    ok: true,
    warnings: noteWarnings(note),
    maxRawNoteChars: maxChars,
  };
}

function collectPayloadText(payload = {}) {
  const pieces = [];
  for (const change of Array.isArray(payload.setup_changes) ? payload.setup_changes : []) {
    pieces.push(change.component, change.adjustment, change.change);
  }
  for (const note of Array.isArray(payload.notes) ? payload.notes : []) {
    pieces.push(note.note_type, note.area, note.note);
  }
  for (const warning of Array.isArray(payload.warnings) ? payload.warnings : []) {
    pieces.push(warning);
  }
  return pieces.map(textFrom).filter(Boolean).join(" ");
}

export function validateTrackAgentOutputScope(payload = {}) {
  const text = collectPayloadText(payload);
  if (hasAny(OUTPUT_ADVICE_PATTERNS, text)) {
    throw new TrackAgentScopeError("scope_advice_output", "Track Agent provider output included advice-like text.", [
      "Provider output must remain extraction-only.",
    ]);
  }
  return { ok: true };
}

export const TRACK_AGENT_SCOPE_POLICY = {
  acceptedPurpose: "Extract motorcycle track-session logging data from rider notes.",
  acceptedCategories: [
    "session details",
    "lap times",
    "tire pressures",
    "setup changes already performed",
    "rider handling notes",
    "warnings",
    "confidence",
  ],
  forbidden: [
    "coaching advice",
    "setup recommendations",
    "safety-critical decisions",
    "medical information",
    "payment, banking, billing, or account-number details",
    "personal identification details",
    "emergency contact details",
    "unrelated personal notes",
    "general chatbot questions",
  ],
  defaultMaxRawNoteChars: DEFAULT_MAX_RAW_NOTE_CHARS,
};
