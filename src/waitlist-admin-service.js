// Beta-approval service (track-helper #49, PR 1). No routes, no HTML, no
// authentication plumbing, and no email - those arrive in later flag-gated
// PRs once this contract is proven. HTTP handlers added later must contain
// no approval business rules: everything authoritative lives here.
//
// Binding product rules encoded here (owner rulings on #49):
//   * approval is an independent axis - this module never reads eligibility
//     into or writes through to confirmation status, program_track,
//     unsubscribe/suppression state, profile consent, or profiles;
//   * no current-state row means effective state 'awaiting_review' with
//     ever_reviewed=false; an explicit stored 'awaiting_review' (a deliberate
//     return to the queue) reads as ever_reviewed=true;
//   * any state may transition to any DIFFERENT state, except that an
//     international-interest signup can never become 'approved';
//   * re-selecting the current effective state is a no-op: no mutation, no
//     audit event, an explicit no_change result;
//   * every applied transition appends exactly one immutable audit event,
//     atomically with the state change - both happen or neither does;
//   * two operators acting on the same observed state never silently
//     last-write-win: the loser gets a conflict result and leaves no trace;
//   * the actor is supplied by the caller from a VERIFIED identity only -
//     never from a query string, form field, hidden input, request body, or
//     unverified header. This module cannot tell the difference, so callers
//     carry that obligation; PR 2's route layer enforces it.
//
// This module sends nothing. It has no reference to any email binding,
// delivery table, or message-building code, and a structural regression
// asserts that stays true.

export const APPROVAL_STATE_VALUES = Object.freeze([
  "awaiting_review",
  "approved",
  "hold",
  "not_approved",
]);

// Operator-facing labels, exact per the #49 ruling.
export const APPROVAL_STATE_LABELS = Object.freeze({
  awaiting_review: "Awaiting review",
  approved: "Approved",
  hold: "Hold",
  not_approved: "Not approved",
});

export const APPROVAL_REASON_MAX_LENGTH = 280;

// Exact semantic reason ruled on #49: approval of an international-interest
// record is refused at the service layer until a separately reviewed
// regional/legal decision changes it. Not a feature flag, not UI-only.
export const INTERNATIONAL_APPROVAL_REFUSAL =
  "International-interest registration does not currently represent eligibility for MotoTrack beta access.";

export class ApprovalValidationError extends Error {
  constructor(message, code) { super(message); this.name = "ApprovalValidationError"; this.code = code; }
}

// Operational reason, not a rider-notes field. Line endings are normalized
// and the edges trimmed; the operator's literal text is otherwise preserved
// (rendering escapes it - nothing here executes as markup). Returns null for
// absent or whitespace-only input so "required" checks cannot be satisfied
// by spaces.
export function normalizeReason(raw) {
  if (raw === undefined || raw === null) return null;
  const text = String(raw).replace(/\r\n?/g, "\n").trim();
  return text === "" ? null : text;
}

// A non-empty reason is required exactly when (owner ruling #49):
//   * the new state is 'hold';
//   * the new state is 'not_approved';
//   * the previous effective state was 'not_approved' and the new one is not.
export function reasonRequiredFor(previousState, newState) {
  return newState === "hold"
    || newState === "not_approved"
    || (previousState === "not_approved" && newState !== "not_approved");
}

const assertKnownState = (value, which) => {
  if (!APPROVAL_STATE_VALUES.includes(value)) {
    throw new ApprovalValidationError(`${which} must be one of ${APPROVAL_STATE_VALUES.join(", ")}`, "invalid_state");
  }
};

// The actor arrives from the caller's VERIFIED operator identity. This layer
// still refuses obviously unusable values so an audit event can never carry
// an empty or bloated actor.
const normalizeActor = (raw) => {
  const actor = typeof raw === "string" ? raw.trim() : "";
  if (actor.length < 3 || actor.length > 254) {
    throw new ApprovalValidationError("a verified operator identity is required", "invalid_actor");
  }
  return actor;
};

// Current approval state for one signup. Distinguishes, per the #49 ruling:
//   { effectiveState: 'awaiting_review', everReviewed: false }   - no row
//   { effectiveState: 'awaiting_review', everReviewed: true }    - explicit return-to-queue
export async function readApprovalState(db, signupId) {
  const signup = await db.prepare(
    "SELECT id, program_track FROM waitlist_signups WHERE id = ?",
  ).bind(signupId).first();
  if (!signup) throw new ApprovalValidationError("unknown signup", "unknown_signup");
  const stored = await db.prepare(
    "SELECT state, updated_at, updated_by FROM waitlist_beta_approvals WHERE signup_id = ?",
  ).bind(signupId).first();
  return {
    signupId,
    programTrack: signup.program_track,
    effectiveState: stored ? stored.state : "awaiting_review",
    everReviewed: stored !== null,
    updatedAt: stored ? stored.updated_at : null,
    updatedBy: stored ? stored.updated_by : null,
  };
}

// Full decision history, deterministically ordered by event_seq (never by
// occurred_at - events can share a whole-second timestamp), newest first.
export async function readApprovalHistory(db, signupId) {
  const { results } = await db.prepare(
    `SELECT event_seq, signup_id, previous_state, new_state, actor, reason, occurred_at
       FROM waitlist_beta_approval_events WHERE signup_id = ? ORDER BY event_seq DESC`,
  ).bind(signupId).all();
  return results;
}

export const CANDIDATE_PAGE_SIZE = 50;
const CANDIDATE_PAGE_MAX = 100;
const OFFSET_MAX = 10000;
const PROGRAM_TRACK_VALUES = Object.freeze(["us_beta_waitlist", "international_interest"]);
const SIGNUP_STATUS_VALUES = Object.freeze(["pending", "confirmed", "unsubscribed"]);

// Read-only queue query (#49 PR 2). One statement, no N+1: approval state and
// profile presence ride LEFT JOINs. Every filter value is validated against a
// closed vocabulary or bound as a parameter - nothing user-supplied is ever
// interpolated into the SQL text. Pagination is bounded; there is no
// unbounded full-table listing.
export async function listCandidates(db, {
  search, approvalState, programTrack, status, country, hasProfile, sort, limit, offset,
} = {}) {
  const conditions = [];
  const bindings = [];

  if (search !== undefined && search !== null && String(search).trim() !== "") {
    const needle = String(search).trim().toLowerCase();
    if (needle.length > 254) throw new ApprovalValidationError("search term too long", "invalid_filter");
    conditions.push(String.raw`s.email_normalized LIKE ? ESCAPE '\'`);
    bindings.push(`%${needle.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  }
  if (approvalState !== undefined && approvalState !== null && approvalState !== "") {
    assertKnownState(approvalState, "approvalState");
    if (approvalState === "awaiting_review") {
      // Effective state: explicit return-to-queue rows AND never-reviewed rows.
      conditions.push("COALESCE(a.state, 'awaiting_review') = 'awaiting_review'");
    } else {
      conditions.push("a.state = ?");
      bindings.push(approvalState);
    }
  }
  if (programTrack !== undefined && programTrack !== null && programTrack !== "") {
    if (!PROGRAM_TRACK_VALUES.includes(programTrack)) {
      throw new ApprovalValidationError("unknown program track", "invalid_filter");
    }
    conditions.push("s.program_track = ?");
    bindings.push(programTrack);
  }
  if (status !== undefined && status !== null && status !== "") {
    if (!SIGNUP_STATUS_VALUES.includes(status)) {
      throw new ApprovalValidationError("unknown confirmation state", "invalid_filter");
    }
    conditions.push("s.status = ?");
    bindings.push(status);
  }
  if (country !== undefined && country !== null && country !== "") {
    const code = String(country).trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) throw new ApprovalValidationError("country must be a 2-letter code", "invalid_filter");
    conditions.push("s.country_code = ?");
    bindings.push(code);
  }
  if (hasProfile === true) conditions.push("p.signup_id IS NOT NULL");
  if (hasProfile === false) conditions.push("p.signup_id IS NULL");

  const direction = sort === "oldest" ? "ASC" : "DESC";
  const pageSize = Math.min(Math.max(Number.isInteger(limit) ? limit : CANDIDATE_PAGE_SIZE, 1), CANDIDATE_PAGE_MAX);
  const pageOffset = Math.min(Math.max(Number.isInteger(offset) ? offset : 0, 0), OFFSET_MAX);

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { results } = await db.prepare(
    `SELECT s.id, s.email_normalized, s.country_code, s.program_track, s.status, s.created_at,
            a.state AS stored_state,
            CASE WHEN p.signup_id IS NULL THEN 0 ELSE 1 END AS has_profile
       FROM waitlist_signups s
       LEFT JOIN waitlist_beta_approvals a ON a.signup_id = s.id
       LEFT JOIN waitlist_profiles p ON p.signup_id = s.id
       ${where}
       ORDER BY s.created_at ${direction}, s.id ${direction}
       LIMIT ? OFFSET ?`,
  ).bind(...bindings, pageSize + 1, pageOffset).all();

  const page = results.slice(0, pageSize).map((r) => ({
    id: r.id,
    email: r.email_normalized,
    country: r.country_code,
    programTrack: r.program_track,
    status: r.status,
    createdAt: r.created_at,
    effectiveState: r.stored_state ?? "awaiting_review",
    everReviewed: r.stored_state !== null,
    hasProfile: r.has_profile === 1,
  }));
  return { candidates: page, hasMore: results.length > pageSize, limit: pageSize, offset: pageOffset };
}

// The one mutation. Applies expectedState -> newState for the signup and
// appends the audit event as a single atomic operation, or does nothing at
// all.
//
// Returns { ok: true, ... } when applied. Refusals the operator can act on
// come back as { ok: false, code } rather than throws:
//   no_change - newState equals the current effective state (no-op ruling);
//   conflict  - another operator changed the state after this one loaded it
//               (expectedState no longer matches; no mutation, no event).
// Caller mistakes (bad states, bad actor, missing reason, unknown signup,
// international approval) throw ApprovalValidationError with a code.
export async function changeApprovalState(db, { signupId, expectedState, newState, reason, actor } = {}) {
  const verifiedActor = normalizeActor(actor);
  assertKnownState(expectedState, "expectedState");
  assertKnownState(newState, "newState");

  const signup = await db.prepare(
    "SELECT id, program_track FROM waitlist_signups WHERE id = ?",
  ).bind(signupId).first();
  if (!signup) throw new ApprovalValidationError("unknown signup", "unknown_signup");

  // Re-selecting the effective state is not a decision. Validated against the
  // operator's observed state; if their view was stale, the guarded batch
  // below reports the conflict instead.
  if (expectedState === newState) return { ok: false, code: "no_change" };

  if (signup.program_track === "international_interest" && newState === "approved") {
    throw new ApprovalValidationError(INTERNATIONAL_APPROVAL_REFUSAL, "international_not_eligible");
  }

  const normalizedReason = normalizeReason(reason);
  if (normalizedReason !== null && normalizedReason.length > APPROVAL_REASON_MAX_LENGTH) {
    throw new ApprovalValidationError(
      `reason must be at most ${APPROVAL_REASON_MAX_LENGTH} characters`, "reason_too_long");
  }
  if (reasonRequiredFor(expectedState, newState) && normalizedReason === null) {
    throw new ApprovalValidationError("this transition requires an operational reason", "reason_required");
  }

  // One D1 batch = one transaction. Both statements are guarded by the SAME
  // precondition on the same pre-image (statement 1 evaluates before
  // statement 2 mutates), so the event and the state change apply together
  // or no-op together. A concurrent winner makes both guards fail: changes
  // 0/0, no phantom event, explicit conflict. Worker memory serializes
  // nothing here - the database is the only referee.
  const guard = `COALESCE((SELECT state FROM waitlist_beta_approvals WHERE signup_id = ?1), 'awaiting_review') = ?2
      AND EXISTS (SELECT 1 FROM waitlist_signups WHERE id = ?1)`;
  const [eventResult, stateResult] = await db.batch([
    db.prepare(
      `INSERT INTO waitlist_beta_approval_events (signup_id, previous_state, new_state, actor, reason)
       SELECT ?1, ?2, ?3, ?4, ?5 WHERE ${guard}`,
    ).bind(signupId, expectedState, newState, verifiedActor, normalizedReason),
    db.prepare(
      `INSERT INTO waitlist_beta_approvals (signup_id, state, updated_at, updated_by)
       SELECT ?1, ?3, datetime('now'), ?4 WHERE ${guard}
       ON CONFLICT (signup_id) DO UPDATE SET
         state = excluded.state, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    ).bind(signupId, expectedState, newState, verifiedActor),
  ]);

  const eventWritten = (eventResult?.meta?.changes ?? 0) === 1;
  const stateWritten = (stateResult?.meta?.changes ?? 0) === 1;
  if (eventWritten !== stateWritten) {
    // The shared guard makes this unreachable; if it ever fires, the batch
    // transaction has already rolled the partial write back out.
    throw new Error("approval state and audit event diverged inside one batch");
  }
  if (!eventWritten) return { ok: false, code: "conflict" };
  return { ok: true, signupId, previousState: expectedState, newState, actor: verifiedActor, reason: normalizedReason };
}
