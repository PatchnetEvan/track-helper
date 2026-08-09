// MotoTrack Feedback service (track-helper #55, PR 1): the data + service
// contract for rider feedback intake and triage reads. No routes, no HTML, no
// GitHub calls, no admin UI, no email - those arrive in later PRs. D1 is the
// source of truth; this module never references any GitHub credential or email
// surface, and a structural regression asserts that stays true.
//
// Binding product rules encoded here (owner rulings on #55):
//   * a rider gives feedback in ~10-15s: only the free-text body is required;
//     contact email is optional; riders never classify their feedback;
//   * safe product context is captured automatically - source_section and
//     source_route come from the request (the app's canonical nav model),
//     app_version is STAMPED SERVER-SIDE from the canonical source (never
//     rider-supplied), and the timestamp is server-authoritative;
//   * intake is forgiving: a bad/absent context value is nulled, never a
//     reason to lose the rider's feedback - only body and a malformed email
//     are rejected;
//   * intake writes NO event: the append-only feedback_events log records only
//     operator lifecycle actions (PR 3/PR 4), so every event carries a
//     verified operator actor;
//   * triage states are exactly new/reviewing/actionable/closed; a duplicate
//     is closed with closure_reason='duplicate', not a separate state.

import { APP_VERSION } from "./app-version.js";

export const FEEDBACK_STATES = Object.freeze(["new", "reviewing", "actionable", "closed"]);
export const FEEDBACK_CLOSURE_REASONS = Object.freeze(["resolved", "duplicate", "not_actionable", "spam"]);

export const FEEDBACK_BODY_MAX = 4000;
export const FEEDBACK_EMAIL_MAX = 254;
export const FEEDBACK_SECTION_MAX = 64;
export const FEEDBACK_ROUTE_MAX = 200;

// Rider-facing copy pinned here so PR 2's UI and the tests share one source.
export const FEEDBACK_PROMPT = "How can we make MotoTrack better?";
export const FEEDBACK_EMAIL_PROMPT = "Want us to follow up? Leave your email if you'd like us to contact you about your feedback.";
export const FEEDBACK_SUCCESS = "Thanks for the feedback.";

export class FeedbackValidationError extends Error {
  constructor(message, code) { super(message); this.name = "FeedbackValidationError"; this.code = code; }
}

// Control characters to strip. Keep newline (\x0A) and tab (\x09) in body
// text; strip everything else non-printable including DEL.
const BODY_CONTROL = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
// A route/section is single-line: strip ALL control chars including newlines.
const LINE_CONTROL = /[\x00-\x1F\x7F]/g;

const newId = () => `fb_${crypto.randomUUID().replace(/-/g, "")}`;

// Plain-text normalization: normalize line endings to LF, strip control
// characters (keeping newline/tab), trim the edges. The rider's literal
// wording is otherwise preserved; rendering (PR 3) escapes it.
export function normalizeText(raw) {
  if (raw === undefined || raw === null) return "";
  return String(raw).replace(/\r\n?/g, "\n").replace(BODY_CONTROL, "").trim();
}

// Section must look like a canonical data-tab id ([a-z0-9_-], bounded). This
// is not an allow-list of known tabs - a future tab passes automatically -
// only a shape guard so junk never lands in the field. Anything else -> null.
function cleanSection(raw) {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  return /^[a-z0-9_-]{1,64}$/.test(s) ? s : null;
}

// Route is opaque product context (path/hash/screen id). Strip control chars,
// trim, bound to 200. Absent/blank -> null. Never rejected.
function cleanRoute(raw) {
  if (typeof raw !== "string") return null;
  const r = raw.replace(LINE_CONTROL, "").trim().slice(0, FEEDBACK_ROUTE_MAX);
  return r === "" ? null : r;
}

// Optional contact email. Absent/blank -> null (accepted). Present but
// malformed -> rejected, because a rider who asked for follow-up deserves to
// know the address won't work rather than have it silently dropped.
function cleanEmail(raw) {
  if (raw === undefined || raw === null) return null;
  const e = String(raw).trim().toLowerCase();
  if (e === "") return null;
  if (e.length < 6 || e.length > FEEDBACK_EMAIL_MAX || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) {
    throw new FeedbackValidationError("that email address doesn't look right", "invalid_email");
  }
  return e;
}

// Create one feedback submission. Returns the stored record's identity +
// context. Throws FeedbackValidationError only for an empty/oversized body or
// a malformed email; context fields are cleaned, never fatal. app_version is
// stamped from the canonical source - any client-supplied value is ignored.
export async function createFeedback(db, input = {}) {
  const body = normalizeText(input.body);
  if (body === "") throw new FeedbackValidationError("feedback text is required", "body_required");
  if (body.length > FEEDBACK_BODY_MAX) {
    throw new FeedbackValidationError(`feedback is limited to ${FEEDBACK_BODY_MAX} characters`, "body_too_long");
  }
  const contactEmail = cleanEmail(input.contactEmail);
  const sourceSection = cleanSection(input.sourceSection);
  const sourceRoute = cleanRoute(input.sourceRoute);
  const id = newId();

  await db.prepare(
    `INSERT INTO feedback_submissions
       (id, body, contact_email, source_section, source_route, app_version, triage_state)
     VALUES (?, ?, ?, ?, ?, ?, 'new')`,
  ).bind(id, body, contactEmail, sourceSection, sourceRoute, APP_VERSION).run();

  return {
    id,
    triageState: "new",
    sourceSection,
    sourceRoute,
    appVersion: APP_VERSION,
    hasContactEmail: contactEmail !== null,
  };
}

// ---- Triage reads (the write/triage service + events are PR 3/PR 4) --------

export async function readFeedback(db, feedbackId) {
  return db.prepare(
    `SELECT id, body, contact_email, source_section, source_route, app_version,
            triage_state, closure_reason, duplicate_of_feedback_id,
            github_repo, github_issue_number, github_issue_url, promoted_at, promoted_by,
            created_at, closed_at, updated_at
       FROM feedback_submissions WHERE id = ?`,
  ).bind(feedbackId).first();
}

export async function readFeedbackHistory(db, feedbackId) {
  const { results } = await db.prepare(
    `SELECT event_seq, feedback_id, event_type, detail, actor, occurred_at
       FROM feedback_events WHERE feedback_id = ? ORDER BY event_seq DESC`,
  ).bind(feedbackId).all();
  return results;
}

// Bounded, parameterized triage queue read. Closed-vocabulary state filter,
// LIKE search escaped, page size clamped - no unbounded full-table listing.
export const FEEDBACK_PAGE_SIZE = 50;
const FEEDBACK_PAGE_MAX = 100;

export async function listFeedback(db, { state, search, sort, limit, offset } = {}) {
  const conditions = [];
  const bindings = [];
  if (state !== undefined && state !== null && state !== "") {
    if (!FEEDBACK_STATES.includes(state)) throw new FeedbackValidationError("unknown triage state", "invalid_filter");
    conditions.push("triage_state = ?");
    bindings.push(state);
  }
  if (search !== undefined && search !== null && String(search).trim() !== "") {
    const needle = String(search).trim().toLowerCase();
    if (needle.length > 200) throw new FeedbackValidationError("search term too long", "invalid_filter");
    conditions.push(String.raw`lower(body) LIKE ? ESCAPE '\'`);
    bindings.push(`%${needle.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const direction = sort === "oldest" ? "ASC" : "DESC";
  const pageSize = Math.min(Math.max(Number.isInteger(limit) ? limit : FEEDBACK_PAGE_SIZE, 1), FEEDBACK_PAGE_MAX);
  const pageOffset = Math.min(Math.max(Number.isInteger(offset) ? offset : 0, 0), 10000);

  const { results } = await db.prepare(
    `SELECT id, source_section, app_version, triage_state, closure_reason,
            github_issue_number, created_at,
            substr(body, 1, 140) AS body_snippet,
            CASE WHEN contact_email IS NULL THEN 0 ELSE 1 END AS has_contact_email
       FROM feedback_submissions ${where}
       ORDER BY created_at ${direction}, id ${direction}
       LIMIT ? OFFSET ?`,
  ).bind(...bindings, pageSize + 1, pageOffset).all();

  return {
    feedback: results.slice(0, pageSize).map((r) => ({
      id: r.id,
      sourceSection: r.source_section,
      appVersion: r.app_version,
      triageState: r.triage_state,
      closureReason: r.closure_reason,
      githubIssueNumber: r.github_issue_number,
      createdAt: r.created_at,
      bodySnippet: r.body_snippet,
      hasContactEmail: r.has_contact_email === 1,
    })),
    hasMore: results.length > pageSize,
    limit: pageSize,
    offset: pageOffset,
  };
}
