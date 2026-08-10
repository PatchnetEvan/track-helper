// MotoTrack Experience Pulse service (track-helper #55, PR3A): the data +
// service contract for the one-tap experience-instance signal. No routes, no
// HTML, no admin UI, no GitHub, no email - the intake route wires this into the
// Worker; the Admin Scorecard read/aggregation layer is PR3B. D1 is the source
// of truth.
//
// Binding product rules encoded here (owner rulings on #55):
//   * a pulse measures ONE experience instance, never a rider - there is no
//     rider identity, no link to any signup/profile, no happy/unhappy/churn/
//     satisfaction/engagement classification, and it is never NPS;
//   * the rider gives exactly one datum, a 1|2|3 value; explanation is never
//     required (a rider who wants to explain uses written Feedback);
//   * value is the ONLY required field - a pulse with no valid 1|2|3 is
//     meaningless and rejected; everything else is forgiving context: a bad
//     section/route/action_context/feedback_id is nulled, never a reason to
//     lose the signal;
//   * safe product context is captured automatically - source_section and
//     source_route come from the request, action_context comes from a CLOSED
//     vocabulary (never rider free text), app_version is STAMPED SERVER-SIDE
//     from the canonical source (never rider-supplied), and the timestamp is
//     server-authoritative;
//   * a pulse stores NO behavioral/engagement telemetry - it is an explicit,
//     voluntary response, not an inference.

import { APP_VERSION } from "./app-version.js";

// The closed experience-instance domain. 1 = Not good, 2 = Okay, 3 = Good.
export const PULSE_VALUES = Object.freeze([1, 2, 3]);
export const PULSE_VALUE_LABELS = Object.freeze({ 1: "Not good", 2: "Okay", 3: "Good" });

// Exact rider question (pinned so the UI and tests share one source).
export const PULSE_QUESTION = "How was this experience?";

// Closed action_context vocabulary (owner-approved for v1). 'after_save' and
// 'after_review' are the initial automatic triggers; 'manual' is reserved for
// an explicitly opened Pulse surface. Adding a trigger requires product
// approval AND an entry here (and the DB CHECK).
export const PULSE_ACTION_CONTEXTS = Object.freeze(["manual", "after_save", "after_review"]);

export const PULSE_SECTION_MAX = 64;
export const PULSE_ROUTE_MAX = 200;

// Rate-limit isolation contract. The public pulse POST REUSES the shared
// waitlist_rate_buckets storage/mechanism, but only under this distinct purpose
// namespace, so a pulse never consumes or modifies the rate-limit budget of
// waitlist signup, confirmation, profile-link request, or Feedback - and none
// of those ever consume the pulse budget. The behavioral-independence
// regression lives in the route test.
export const PULSE_RATE_BUCKET_PREFIX = "experience_pulse_client:";

// Raw retention: 13 months, then purge. No analytics warehouse in v1.
export const PULSE_RETENTION_MONTHS = 13;

export class PulseValidationError extends Error {
  constructor(message, code) { super(message); this.name = "PulseValidationError"; this.code = code; }
}

// A route/section is single-line: strip ALL control chars including newlines.
const LINE_CONTROL = /[\x00-\x1F\x7F]/g;

const newId = () => `xp_${crypto.randomUUID().replace(/-/g, "")}`;

// The single required field. Accept a JSON number or a clean integer string;
// anything that is not exactly 1, 2, or 3 is rejected - a pulse cannot exist
// without a valid experience value. No coercion of 2.5, "good", 0, 4, etc.
function cleanValue(raw) {
  const n = typeof raw === "number" ? raw
    : (typeof raw === "string" && /^\s*[0-9]+\s*$/.test(raw) ? Number(raw.trim()) : NaN);
  if (n === 1 || n === 2 || n === 3) return n;
  throw new PulseValidationError("an experience value of 1, 2, or 3 is required", "invalid_value");
}

// Section must look like a canonical data-tab id ([a-z0-9_-], bounded). Not an
// allow-list of known tabs - a future tab passes automatically - only a shape
// guard so junk never lands in the field. Anything else -> null.
function cleanSection(raw) {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  return /^[a-z0-9_-]{1,64}$/.test(s) ? s : null;
}

// Route is opaque product context (path/hash/screen id). Strip control chars,
// trim, bound to 200. Absent/blank -> null. Never rejected.
function cleanRoute(raw) {
  if (typeof raw !== "string") return null;
  const r = raw.replace(LINE_CONTROL, "").trim().slice(0, PULSE_ROUTE_MAX);
  return r === "" ? null : r;
}

// action_context is drawn from the CLOSED vocabulary. Absent/unknown -> null
// (accepted, never fatal): a client that sends an out-of-vocabulary string does
// not lose the pulse, the context is simply dropped. Never stored as free text.
function cleanActionContext(raw) {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  return PULSE_ACTION_CONTEXTS.includes(v) ? v : null;
}

// Optional link to the written feedback this pulse accompanied. Shape-guard to
// the feedback id form (fb_<32 hex>), then confirm the row exists so the FK
// insert normally succeeds. A malformed OR unknown id -> null (the pulse
// records, unlinked). Never fatal, never a signup/profile link. NOTE: existence
// is checked before the insert but a concurrent retention purge could still
// delete the row in between; createExperiencePulse handles that by dropping the
// link rather than losing the pulse.
async function resolveFeedbackId(db, raw) {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (!/^fb_[0-9a-f]{32}$/.test(v)) return null;
  const found = await db.prepare("SELECT 1 AS ok FROM feedback_submissions WHERE id = ?").bind(v).first();
  return found ? v : null;
}

async function insertPulse(db, id, value, sourceSection, sourceRoute, actionContext, feedbackId) {
  await db.prepare(
    `INSERT INTO feedback_experience_pulses
       (id, value, source_section, source_route, action_context, app_version, feedback_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, value, sourceSection, sourceRoute, actionContext, APP_VERSION, feedbackId).run();
}

// Create one experience pulse. Returns the stored record's identity + context.
// Throws PulseValidationError ONLY for a missing/invalid value; every other
// field is cleaned, never fatal. app_version is stamped from the canonical
// source - any client-supplied value is ignored.
export async function createExperiencePulse(db, input = {}) {
  const value = cleanValue(input.value);
  const sourceSection = cleanSection(input.sourceSection);
  const sourceRoute = cleanRoute(input.sourceRoute);
  const actionContext = cleanActionContext(input.actionContext);
  const feedbackId = await resolveFeedbackId(db, input.feedbackId);
  const id = newId();

  try {
    await insertPulse(db, id, value, sourceSection, sourceRoute, actionContext, feedbackId);
  } catch (error) {
    // A pulse must never be lost. The ONLY failure the optional feedback link
    // can introduce is a foreign-key violation if the referenced feedback was
    // purged between the existence check above and this insert (e.g. a
    // concurrent retention sweep). Drop the link and retry once so the still-
    // anonymous pulse is recorded. If there was no link, or the retry also
    // fails, it is a genuine DB failure - rethrow so the route returns 503.
    if (feedbackId === null) throw error;
    await insertPulse(db, id, value, sourceSection, sourceRoute, actionContext, null);
    return { id, value, sourceSection, sourceRoute, actionContext, appVersion: APP_VERSION, feedbackId: null };
  }

  return { id, value, sourceSection, sourceRoute, actionContext, appVersion: APP_VERSION, feedbackId };
}

// Single-record read (used by tests and later diagnostics). The Scorecard
// aggregation reads are PR3B.
export async function readExperiencePulse(db, id) {
  return db.prepare(
    `SELECT id, value, source_section, source_route, action_context, app_version, feedback_id, created_at
       FROM feedback_experience_pulses WHERE id = ?`,
  ).bind(id).first();
}
