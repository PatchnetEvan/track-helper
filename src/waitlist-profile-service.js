// Optional post-confirmation rider profile — service layer (track-helper #31,
// PR 1). No routes, no UI, and no welcome-email CTA yet; those arrive in later
// flag-gated PRs once this contract is proven.
//
// Binding product rules encoded here:
//   * a profile link is issued ONLY for a confirmed signup (US beta waitlist
//     or international interest);
//   * unsubscribed and suppressed records receive nothing, and unsubscribing
//     revokes every outstanding link;
//   * tokens are hashed at rest, bounded (30 days), single-purpose, and
//     consumed ONLY after a successful save;
//   * a later edit requires a newly requested link - there is no reusable
//     public URL;
//   * profiles are optional, partial, and position-neutral: nothing in this
//     module reads or writes eligibility, ordering, or invitation timing.

export const PROFILE_COPY_VERSION = "2026-08-05.3";
export const PROFILE_NOTICE_VERSION = "2026-08-05.3";

// Profile consent is its OWN Art. 6(1)(a) basis, separate from the wait-list
// and product-update consent. It is collected through an unchecked control,
// the save refuses without the affirmative action, and withdrawing it leaves
// the email consent untouched.
export const PROFILE_CONSENT_VERSION = "2026-08-05.3";
export const PROFILE_CONSENT_COPY =
  "I consent to MotoTrack using the optional rider-profile information I choose to provide to understand "
  + "rider needs, plan regional availability, and improve the product. I understand that completing the "
  + "profile is optional and does not affect my place on the waitlist or international interest list, "
  + "eligibility, or access timing, and does not guarantee MotoTrack access or availability in my region. "
  + "I can withdraw this profile consent at any time without affecting my separate wait-list or "
  + "product-update consent. See the Privacy Policy.";
export const PROFILE_TOKEN_TTL_DAYS = 30;
export const GOALS_MAX_LENGTH = 1000;
export const TRACK_INVOLVEMENT_OTHER_MAX_LENGTH = 100;

// Controlled vocabulary. Multi-select: one person may be both a racer and a
// coach, or both a rider and a mechanic. Deliberately NOT named rider_type -
// several options describe coaches and technicians rather than riders.
export const TRACK_INVOLVEMENT_VALUES = Object.freeze([
  "preparing_for_first_track_day",
  "track_day_rider",
  "club_racer",
  "national_or_professional_racer",
  "coach_or_instructor",
  "mechanic_or_technician",
  "other",
]);
export const TRACK_INVOLVEMENT_LABELS = Object.freeze({
  preparing_for_first_track_day: "Preparing for my first track day",
  track_day_rider: "Track-day rider",
  club_racer: "Club racer",
  national_or_professional_racer: "National or professional racer",
  coach_or_instructor: "Coach or instructor",
  mechanic_or_technician: "Mechanic or technician",
  other: "Other",
});

// Separate optional single-select. Never used to derive eligibility, ranking,
// invitation priority, or assumed skill.
export const EXPERIENCE_LEVEL_VALUES = Object.freeze([
  "first_event_or_season",
  "one_to_three_years",
  "four_to_ten_years",
  "more_than_ten_years",
  "prefer_not_to_say",
]);
export const EXPERIENCE_LEVEL_LABELS = Object.freeze({
  first_event_or_season: "First event or first season",
  one_to_three_years: "1–3 years",
  four_to_ten_years: "4–10 years",
  more_than_ten_years: "More than 10 years",
  prefer_not_to_say: "Prefer not to say",
});

export const GOALS_PROMPT = "What would you like MotoTrack to help you improve or make easier?";
export const GOALS_SUPPORTING_COPY =
  "Please avoid including medical, financial, or other highly sensitive personal information.";

function id(prefix) { return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`; }

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function mintToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Rider free text is stored LITERALLY. We never rewrite what the rider
// wrote: internal wording, punctuation, spacing, and line breaks survive
// exactly. The ONLY normalization is line endings (CRLF/CR -> LF) and
// trimming leading/trailing whitespace; length is validated server-side.
// Markup is NOT stripped - text that merely looks like HTML is ordinary
// rider text and must be preserved. Safety comes from escaping at render
// time (escapeHtml below), never from mutating stored content.
function literalText(value, maxLength) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) throw new ProfileValidationError(`That field is limited to ${maxLength} characters.`);
  return normalized;
}

/**
 * The render-time boundary: every profile value must pass through this
 * before reaching HTML, so stored text stays literal while markup can never
 * execute. PR 2's form and any operator view must use it on every field.
 */
export function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export class ProfileValidationError extends Error {
  constructor(message) { super(message); this.name = "ProfileValidationError"; }
}

// Only a CONFIRMED signup may hold a profile link. Pending, unsubscribed,
// suppressed, and unknown all resolve to null - callers answer uniformly.
async function confirmedSignup(db, signupId) {
  return db.prepare(`SELECT id, email_normalized, program_track FROM waitlist_signups
    WHERE id = ? AND status = 'confirmed'`).bind(signupId).first();
}

/**
 * Issues one protected profile link. Supersedes any outstanding unused link
 * so exactly one is live at a time. Returns the raw token ONCE (callers email
 * it and must never store or log it), or null when the signup is not eligible.
 */
export async function issueProfileInvitation(db, signupId, channel) {
  if (!["welcome_email", "later_invitation", "requested_edit_link"].includes(channel)) {
    throw new ProfileValidationError("Unsupported invitation channel.");
  }
  const signup = await confirmedSignup(db, signupId);
  if (!signup) return null;
  const raw = mintToken();
  const invitationId = id("wlpi");
  // ATOMIC replacement: issuing the new link and superseding the old one are
  // ONE transaction. Either the rider ends up with exactly one usable link
  // (the new one), or - if any statement fails - the batch rolls back and
  // their EXISTING link remains usable. An interrupted replacement can never
  // leave zero usable links or two, and a refused issuance (the partial
  // unique index: at most one operator-triggered later invitation per signup)
  // supersedes nothing at all.
  try {
    await db.batch([
      db.prepare(`INSERT INTO waitlist_profile_invitations (id, signup_id, token_digest, channel, expires_at)
        VALUES (?, ?, ?, ?, datetime('now', '+${PROFILE_TOKEN_TTL_DAYS} days'))`)
        .bind(invitationId, signupId, await sha256Hex(raw), channel),
      db.prepare(`UPDATE waitlist_profile_invitations SET superseded_at = datetime('now')
        WHERE signup_id = ? AND id != ? AND used_at IS NULL AND revoked_at IS NULL AND superseded_at IS NULL`)
        .bind(signupId, invitationId),
    ]);
  } catch (error) {
    // Answered as "not issued", never a raw engine error, with the prior link
    // untouched because nothing committed.
    if (/UNIQUE/i.test(String(error?.message))) return null;
    throw error;
  }
  return raw;
}

/**
 * Validates a raw profile token. Unknown, expired, used, revoked, superseded,
 * and non-confirmed all return null so every caller can render the SAME
 * generic invalid-link page with no disclosure of which condition applied.
 */
export async function resolveProfileInvitation(db, rawToken) {
  if (typeof rawToken !== "string" || rawToken.length < 20 || rawToken.length > 128) return null;
  const row = await db.prepare(`SELECT id, signup_id FROM waitlist_profile_invitations
    WHERE token_digest = ? AND used_at IS NULL AND revoked_at IS NULL AND superseded_at IS NULL
      AND expires_at > datetime('now')`).bind(await sha256Hex(rawToken)).first();
  if (!row) return null;
  const signup = await confirmedSignup(db, row.signup_id);
  return signup ? { invitationId: row.id, signup } : null;
}

/**
 * Saves (or updates) a profile through a valid link. Partial profiles are
 * valid - every field is optional. The token is consumed ONLY after the save
 * succeeds, so an abandoned or failed attempt leaves the link usable until
 * it expires. A later edit requires a newly requested link.
 */
export async function saveProfileThroughInvitation(db, rawToken, payload = {}) {
  const resolved = await resolveProfileInvitation(db, rawToken);
  if (!resolved) return null;
  const involvement = Array.isArray(payload.track_involvement) ? payload.track_involvement : [];
  for (const value of involvement) {
    if (!TRACK_INVOLVEMENT_VALUES.includes(value)) throw new ProfileValidationError("Unsupported track-involvement value.");
  }
  const experience = payload.experience_level ?? null;
  if (experience !== null && !EXPERIENCE_LEVEL_VALUES.includes(experience)) {
    throw new ProfileValidationError("Unsupported experience level.");
  }
  const fields = {
    display_name: literalText(payload.display_name, 100),
    track_involvement: involvement.length ? JSON.stringify([...new Set(involvement)]) : null,
    track_involvement_other: involvement.includes("other")
      ? literalText(payload.track_involvement_other, TRACK_INVOLVEMENT_OTHER_MAX_LENGTH) : null,
    experience_level: experience,
    primary_motorcycle: literalText(payload.primary_motorcycle, 200),
    other_motorcycles: literalText(payload.other_motorcycles, 500),
    tracks_and_events: literalText(payload.tracks_and_events, 500),
    timing_tools: literalText(payload.timing_tools, 500),
    goals: literalText(payload.goals, GOALS_MAX_LENGTH),
  };
  const flags = {
    interest_early_testing: payload.interest_early_testing === true ? 1 : 0,
    interest_remote_coaching: payload.interest_remote_coaching === true ? 1 : 0,
    interest_ai_coaching: payload.interest_ai_coaching === true ? 1 : 0,
  };
  const existing = await db.prepare("SELECT id FROM waitlist_profiles WHERE signup_id = ?")
    .bind(resolved.signup.id).first();
  if (existing) {
    await db.prepare(`UPDATE waitlist_profiles SET display_name = ?, track_involvement = ?,
        track_involvement_other = ?, experience_level = ?, primary_motorcycle = ?, other_motorcycles = ?,
        tracks_and_events = ?, timing_tools = ?, goals = ?, interest_early_testing = ?,
        interest_remote_coaching = ?, interest_ai_coaching = ?, profile_copy_version = ?,
        privacy_notice_version = ?, updated_at = datetime('now')
      WHERE signup_id = ?`)
      .bind(fields.display_name, fields.track_involvement, fields.track_involvement_other, fields.experience_level,
        fields.primary_motorcycle, fields.other_motorcycles, fields.tracks_and_events, fields.timing_tools,
        fields.goals, flags.interest_early_testing, flags.interest_remote_coaching, flags.interest_ai_coaching,
        PROFILE_COPY_VERSION, PROFILE_NOTICE_VERSION, resolved.signup.id).run();
  } else {
    await db.prepare(`INSERT INTO waitlist_profiles (id, signup_id, display_name, track_involvement,
        track_involvement_other, experience_level, primary_motorcycle, other_motorcycles, tracks_and_events,
        timing_tools, goals, interest_early_testing, interest_remote_coaching, interest_ai_coaching,
        profile_copy_version, privacy_notice_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id("wlp"), resolved.signup.id, fields.display_name, fields.track_involvement,
        fields.track_involvement_other, fields.experience_level, fields.primary_motorcycle,
        fields.other_motorcycles, fields.tracks_and_events, fields.timing_tools, fields.goals,
        flags.interest_early_testing, flags.interest_remote_coaching, flags.interest_ai_coaching,
        PROFILE_COPY_VERSION, PROFILE_NOTICE_VERSION).run();
  }
  // Consume the link only now that the save has succeeded.
  await db.prepare("UPDATE waitlist_profile_invitations SET used_at = datetime('now') WHERE id = ?")
    .bind(resolved.invitationId).run();
  return { saved: true, program_track: resolved.signup.program_track };
}

/**
 * The safe "request a new edit link" resolution. Returns the raw token ONLY
 * for a confirmed signup; unknown, pending, unsubscribed, and suppressed all
 * return null so the caller answers the SAME generic response for every case.
 * This path can never create a signup, change status or program_track, clear
 * unsubscribed_at, or stamp resubscribed_at - it never reactivates anyone.
 */
export async function requestProfileEditLink(db, emailNormalized) {
  const email = typeof emailNormalized === "string" ? emailNormalized.trim().toLowerCase() : "";
  if (!email) return null;
  const signup = await db.prepare(`SELECT id FROM waitlist_signups
    WHERE email_normalized = ? AND status = 'confirmed'`).bind(email).first();
  if (!signup) return null;
  return issueProfileInvitation(db, signup.id, "requested_edit_link");
}

/** Unsubscribing revokes every outstanding profile link for that signup. */
export async function revokeProfileInvitations(db, signupId) {
  const result = await db.prepare(`UPDATE waitlist_profile_invitations SET revoked_at = datetime('now')
    WHERE signup_id = ? AND used_at IS NULL AND revoked_at IS NULL`).bind(signupId).run();
  return Number(result?.meta?.changes ?? 0);
}

/**
 * Retention integration (owner rule): profile data lives while its record is
 * active, is deleted within 30 days after unsubscribe, and NEVER survives
 * beyond the wait-list retention ceiling. Signup purges cascade separately in
 * the main sweep; this pass handles the post-unsubscribe window.
 */
export async function sweepProfileRetention(db) {
  const doomed = await db.prepare(`SELECT p.id FROM waitlist_profiles p
    JOIN waitlist_signups s ON s.id = p.signup_id
    WHERE s.status = 'unsubscribed' AND s.unsubscribed_at <= datetime('now', '-30 days')`).bind().all();
  for (const { id: profileId } of doomed.results ?? []) {
    await db.prepare("DELETE FROM waitlist_profiles WHERE id = ?").bind(profileId).run();
  }
  const invitations = await db.prepare(`DELETE FROM waitlist_profile_invitations
    WHERE signup_id IN (SELECT id FROM waitlist_signups WHERE status = 'unsubscribed'
      AND unsubscribed_at <= datetime('now', '-30 days'))`).bind().run();
  // Spent edit authorizations are deleted outright, for every signup: an
  // expired, consumed, or revoked row can never authorize anything again, so
  // keeping its signup linkage is retaining personal data for no purpose. Only
  // a LIVE authorization survives, and only for its own short TTL. Rows whose
  // parent signup or invitation is deleted elsewhere cascade away with it.
  const authorizations = await db.prepare(`DELETE FROM waitlist_profile_edit_authorizations
    WHERE expires_at <= datetime('now') OR consumed_at IS NOT NULL OR revoked_at IS NOT NULL`).bind().run();
  return {
    profiles_purged: (doomed.results ?? []).length,
    invitations_purged: Number(invitations?.meta?.changes ?? 0),
    edit_authorizations_purged: Number(authorizations?.meta?.changes ?? 0),
  };
}
