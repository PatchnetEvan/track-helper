// Short-lived, revocable edit authorization for the rider profile (PR 2).
//
// The emailed invitation NEVER survives past the exchange redirect: it is
// validated, exchanged for a server-side authorization keyed by an opaque
// cookie, and left UNCONSUMED. Opening or abandoning the form leaves the email
// link usable until its 30-day expiry; reopening revokes and replaces the
// previous authorization (one live edit session) without touching the
// invitation. The invitation is consumed only by a successful save.
//
// The save is ATOMIC, not "recheck then write": one transaction validates the
// authorization, its signup/invitation binding, confirmed status, suppression
// state, and invitation validity, then writes the profile, consumes the
// invitation, consumes the authorization, and revokes sibling authorizations.
// Any failure rolls the whole thing back - the profile can never change
// without the authorization being consumed, and vice versa.

import {
  PROFILE_COPY_VERSION, PROFILE_NOTICE_VERSION, GOALS_MAX_LENGTH,
  TRACK_INVOLVEMENT_OTHER_MAX_LENGTH, TRACK_INVOLVEMENT_VALUES, EXPERIENCE_LEVEL_VALUES,
  PROFILE_CONSENT_VERSION, profileConsentState,
  ProfileValidationError,
} from "./waitlist-profile-service.js";

// One hour. Twenty minutes was not enough to read the consent copy and fill a
// free-text field, and a rider whose session lapsed mid-form lost their work.
// The emailed INVITATION expiry is unchanged at 30 days.
export const EDIT_AUTH_TTL_SECONDS = 60 * 60;
export const PROFILE_COOKIE = "__Secure-mototrack_profile";
export const PROFILE_CSRF_COOKIE = "__Secure-mototrack_profile_csrf";
export const PROFILE_PATH = "/waitlist/profile";
// The public edit-link request form is UNAUTHENTICATED and must never share
// cookie state with a live edit session. It gets its own name AND its own
// deeper path, so visiting it cannot overwrite, clear, or poison the
// authenticated CSRF cookie - which would otherwise make the next form render
// carry a value the stored digest cannot match, revoking a valid session.
export const PROFILE_REQUEST_CSRF_COOKIE = "__Secure-mototrack_profile_request_csrf";
export const PROFILE_REQUEST_PATH = "/waitlist/profile/request";

function id(prefix) { return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`; }

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function opaqueValue() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Constant-time-ish comparison for CSRF values.
function sameValue(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function parseCookies(request) {
  const header = request.headers.get("cookie") || "";
  const jar = {};
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name) jar[name] = decodeURIComponent(rest.join("="));
  }
  return jar;
}

// Scoped to the profile path, opaque, HttpOnly, Secure, SameSite=Strict, no
// Domain attribute, explicit bounded Max-Age. __Secure- (not __Host-, which
// browsers only accept with Path=/).
export function sessionCookie(name, value, maxAgeSeconds, path = PROFILE_PATH) {
  return `${name}=${value}; Path=${path}; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Strict`;
}
export function clearedCookie(name, path = PROFILE_PATH) {
  return `${name}=; Path=${path}; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

/**
 * Exchange: validates the invitation WITHOUT consuming it and mints a fresh
 * edit authorization, revoking any previous one for that invitation so exactly
 * one edit session is live. Returns the raw cookie + CSRF values once, or null
 * for every invalid condition (unknown, expired, used, revoked, superseded,
 * non-confirmed) so the caller renders one generic unavailable page.
 */
export async function exchangeInvitationForEditAuthorization(db, rawToken, existingCookie = null) {
  if (typeof rawToken !== "string" || rawToken.length < 20 || rawToken.length > 128) return null;
  const invitation = await db.prepare(`SELECT i.id, i.signup_id FROM waitlist_profile_invitations i
    JOIN waitlist_signups s ON s.id = i.signup_id
    WHERE i.token_digest = ? AND i.used_at IS NULL AND i.revoked_at IS NULL AND i.superseded_at IS NULL
      AND i.expires_at > datetime('now') AND s.status = 'confirmed'`).bind(await sha256Hex(rawToken)).first();
  if (!invitation) return null;

  // IDEMPOTENT REOPEN. Clicking the same emailed link again in the SAME browser
  // must not destroy work in progress. If the request already carries a valid
  // authorization bound to this same invitation and signup, keep it exactly as
  // it is: no new row, no revocation, no cookie rotation, no CSRF change. The
  // caller then redirects without touching Set-Cookie, so a half-completed form
  // in another tab still saves.
  //
  // This does NOT relax the invariant: still at most one live authorization per
  // invitation, because nothing new was created.
  if (existingCookie) {
    const current = await resolveEditAuthorization(db, existingCookie);
    if (current
      && current.authorization.invitation_id === invitation.id
      && current.authorization.signup_id === invitation.signup_id) {
      return { reused: true };
    }
  }

  const rawCookie = opaqueValue();
  const rawCsrf = opaqueValue();
  const authorizationId = id("wlea");
  // Rotate: the new authorization is created and every sibling revoked in one
  // transaction. The INVITATION IS NOT TOUCHED - it stays usable until it is
  // consumed by a successful save or expires on its own schedule.
  await db.batch([
    db.prepare(`INSERT INTO waitlist_profile_edit_authorizations
        (id, invitation_id, signup_id, cookie_digest, csrf_digest, expires_at)
      VALUES (?, ?, ?, ?, ?, datetime('now', '+${EDIT_AUTH_TTL_SECONDS} seconds'))`)
      .bind(authorizationId, invitation.id, invitation.signup_id, await sha256Hex(rawCookie), await sha256Hex(rawCsrf)),
    db.prepare(`UPDATE waitlist_profile_edit_authorizations SET revoked_at = datetime('now')
      WHERE invitation_id = ? AND id != ? AND consumed_at IS NULL AND revoked_at IS NULL`)
      .bind(invitation.id, authorizationId),
  ]);
  return { cookie: rawCookie, csrf: rawCsrf };
}

/**
 * Read-side validation for rendering the form. Returns the signup, the CSRF
 * digest to compare against, and the existing profile (for pre-fill), or null
 * for every invalid or lapsed condition.
 */
export async function resolveEditAuthorization(db, rawCookie) {
  if (typeof rawCookie !== "string" || rawCookie.length < 20 || rawCookie.length > 128) return null;
  const authorization = await db.prepare(`SELECT a.id, a.signup_id, a.invitation_id, a.csrf_digest,
      s.program_track
    FROM waitlist_profile_edit_authorizations a
    JOIN waitlist_signups s ON s.id = a.signup_id
    JOIN waitlist_profile_invitations i ON i.id = a.invitation_id
    WHERE a.cookie_digest = ? AND a.consumed_at IS NULL AND a.revoked_at IS NULL
      AND a.expires_at > datetime('now')
      AND s.status = 'confirmed'
      AND i.used_at IS NULL AND i.revoked_at IS NULL AND i.superseded_at IS NULL
        AND i.expires_at > datetime('now')`).bind(await sha256Hex(rawCookie)).first();
  if (!authorization) return null;
  const profile = await db.prepare("SELECT * FROM waitlist_profiles WHERE signup_id = ?")
    .bind(authorization.signup_id).first();
  const consent = await profileConsentState(db, authorization.signup_id);
  return { authorization, profile: profile ?? null, consent };
}

// Literal rider text: line endings normalized, outer whitespace trimmed,
// nothing else rewritten; escaping happens at render time.
function literalText(value, maxLength) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) throw new ProfileValidationError(`That field is limited to ${maxLength} characters.`);
  return normalized;
}

function validatedPayload(payload, { consentRequired }) {
  // Separate profile consent, collected through an unchecked control. Without
  // the affirmative action there is no lawful basis for the answers, so the
  // save refuses BEFORE any write. The session and the invitation both stay
  // usable, so the rider simply sees the form again with the message.
  //
  // An ordinary edit under consent already active at the CURRENT versions asks
  // for nothing again - editing a motorcycle or a goal is not a new consent
  // decision, and re-prompting would only train riders to click past it.
  if (consentRequired && payload.profile_consent !== true) {
    throw new ProfileValidationError(
      "Please confirm the rider-profile consent before saving. Your waitlist place and email preferences are unaffected.");
  }
  const involvement = Array.isArray(payload.track_involvement) ? [...new Set(payload.track_involvement)] : [];
  for (const value of involvement) {
    if (!TRACK_INVOLVEMENT_VALUES.includes(value)) throw new ProfileValidationError("Unsupported track-involvement value.");
  }
  const experience = payload.experience_level ?? null;
  if (experience !== null && experience !== "" && !EXPERIENCE_LEVEL_VALUES.includes(experience)) {
    throw new ProfileValidationError("Unsupported experience level.");
  }
  return {
    display_name: literalText(payload.display_name, 100),
    track_involvement: involvement.length ? JSON.stringify(involvement) : null,
    track_involvement_other: involvement.includes("other")
      ? literalText(payload.track_involvement_other, TRACK_INVOLVEMENT_OTHER_MAX_LENGTH) : null,
    experience_level: experience === "" ? null : experience,
    primary_motorcycle: literalText(payload.primary_motorcycle, 200),
    other_motorcycles: literalText(payload.other_motorcycles, 500),
    tracks_and_events: literalText(payload.tracks_and_events, 500),
    timing_tools: literalText(payload.timing_tools, 500),
    goals: literalText(payload.goals, GOALS_MAX_LENGTH),
    interest_early_testing: payload.interest_early_testing === true ? 1 : 0,
    interest_remote_coaching: payload.interest_remote_coaching === true ? 1 : 0,
    interest_ai_coaching: payload.interest_ai_coaching === true ? 1 : 0,
  };
}

/**
 * ATOMIC save. One transaction: claim the authorization (which is only
 * claimable while its signup is confirmed, not unsubscribed/suppressed, and
 * its invitation is unused, unexpired, unsuperseded, unrevoked), write the
 * profile, consume the invitation, and revoke sibling authorizations. Every
 * statement after the claim is conditional on THIS request's claim marker, so
 * a stale or replayed authorization can never write. Returns null for any
 * denial - the caller renders the same generic unavailable page.
 */
export async function saveProfileWithAuthorization(db, rawCookie, submittedCsrf, payload = {}) {
  const resolved = await resolveEditAuthorization(db, rawCookie);
  if (!resolved) return null;
  if (!sameValue(await sha256Hex(String(submittedCsrf ?? "")), resolved.authorization.csrf_digest)) return { csrfRejected: true };
  const consentRequired = !resolved.consent.current;
  const fields = validatedPayload(payload, { consentRequired });  // throws before any write
  const cookieDigest = await sha256Hex(rawCookie);
  const marker = id("claim");
  const profileId = id("wlp");

  const statements = [
    // 1. Claim: consumes the authorization only if EVERY condition still holds
    //    at this instant, inside the transaction.
    db.prepare(`UPDATE waitlist_profile_edit_authorizations SET consumed_at = datetime('now'), claim_marker = ?
      WHERE cookie_digest = ? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > datetime('now')
        AND EXISTS (SELECT 1 FROM waitlist_signups s WHERE s.id = signup_id AND s.status = 'confirmed')
        AND EXISTS (SELECT 1 FROM waitlist_profile_invitations i WHERE i.id = invitation_id
          AND i.used_at IS NULL AND i.revoked_at IS NULL AND i.superseded_at IS NULL
          AND i.expires_at > datetime('now'))`).bind(marker, cookieDigest),
    // 2. Write the profile - conditional on THIS claim.
    db.prepare(`INSERT INTO waitlist_profiles (id, signup_id, display_name, track_involvement,
        track_involvement_other, experience_level, primary_motorcycle, other_motorcycles, tracks_and_events,
        timing_tools, goals, interest_early_testing, interest_remote_coaching, interest_ai_coaching,
        profile_copy_version, privacy_notice_version)
      SELECT ?, a.signup_id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        FROM waitlist_profile_edit_authorizations a WHERE a.claim_marker = ?
      ON CONFLICT (signup_id) DO UPDATE SET display_name = excluded.display_name,
        track_involvement = excluded.track_involvement, track_involvement_other = excluded.track_involvement_other,
        experience_level = excluded.experience_level, primary_motorcycle = excluded.primary_motorcycle,
        other_motorcycles = excluded.other_motorcycles, tracks_and_events = excluded.tracks_and_events,
        timing_tools = excluded.timing_tools, goals = excluded.goals,
        interest_early_testing = excluded.interest_early_testing,
        interest_remote_coaching = excluded.interest_remote_coaching,
        interest_ai_coaching = excluded.interest_ai_coaching,
        profile_copy_version = excluded.profile_copy_version,
        privacy_notice_version = excluded.privacy_notice_version, updated_at = datetime('now')`)
      .bind(profileId, fields.display_name, fields.track_involvement, fields.track_involvement_other,
        fields.experience_level, fields.primary_motorcycle, fields.other_motorcycles, fields.tracks_and_events,
        fields.timing_tools, fields.goals, fields.interest_early_testing, fields.interest_remote_coaching,
        fields.interest_ai_coaching, PROFILE_COPY_VERSION, PROFILE_NOTICE_VERSION, marker),
    // 3. Consume the invitation - only now, and only for this claim.
    db.prepare(`UPDATE waitlist_profile_invitations SET used_at = datetime('now')
      WHERE id = (SELECT invitation_id FROM waitlist_profile_edit_authorizations WHERE claim_marker = ?)
        AND used_at IS NULL`).bind(marker),
    // 4. Revoke any other live authorization for that invitation.
    db.prepare(`UPDATE waitlist_profile_edit_authorizations SET revoked_at = datetime('now')
      WHERE invitation_id = (SELECT invitation_id FROM waitlist_profile_edit_authorizations WHERE claim_marker = ?)
        AND claim_marker IS NOT ? AND consumed_at IS NULL AND revoked_at IS NULL`).bind(marker, marker),
  ];
  // 5. Consent evidence, in the SAME transaction as the answers it covers -
  //    appended ONLY when consent was actually given, never for an edit made
  //    under consent that is already active at the current versions.
  if (consentRequired) {
    statements.push(db.prepare(`INSERT INTO waitlist_profile_consent_events
        (signup_id, event_type, profile_consent_version, privacy_notice_version, consent_method)
      SELECT a.signup_id, 'granted', ?, ?, 'profile_form_checkbox'
        FROM waitlist_profile_edit_authorizations a WHERE a.claim_marker = ?`)
      .bind(PROFILE_CONSENT_VERSION, PROFILE_NOTICE_VERSION, marker));
  }
  const results = await db.batch(statements);
  const claimed = Number(results?.[0]?.meta?.changes ?? 0);
  if (claimed !== 1) return null;  // nothing else could have written: all conditional on the marker
  return { saved: true, program_track: resolved.authorization.program_track };
}

/**
 * ATOMIC withdrawal of profile consent. Same claim guard as the save: one
 * transaction claims the authorization, deletes the rider's answers, records
 * the minimum withdrawal evidence, revokes every outstanding invitation, and
 * revokes sibling authorizations. It touches NOTHING on the signup - status,
 * program_track, confirmation, unsubscribed_at, resubscribed_at and the email
 * consent are all outside this statement set - and it issues no replacement
 * invitation. Returns null for any denial.
 */
export async function withdrawProfileWithAuthorization(db, rawCookie, submittedCsrf) {
  const resolved = await resolveEditAuthorization(db, rawCookie);
  if (!resolved) return null;
  if (!sameValue(await sha256Hex(String(submittedCsrf ?? "")), resolved.authorization.csrf_digest)) return { csrfRejected: true };
  const cookieDigest = await sha256Hex(rawCookie);
  const marker = id("claim");

  const results = await db.batch([
    // 1. Claim, re-validating ownership and confirmed status at this instant.
    db.prepare(`UPDATE waitlist_profile_edit_authorizations SET consumed_at = datetime('now'), claim_marker = ?
      WHERE cookie_digest = ? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > datetime('now')
        AND EXISTS (SELECT 1 FROM waitlist_signups s WHERE s.id = signup_id AND s.status = 'confirmed')`)
      .bind(marker, cookieDigest),
    // 2. Delete the answers - conditional on THIS claim.
    db.prepare(`DELETE FROM waitlist_profiles WHERE signup_id =
      (SELECT signup_id FROM waitlist_profile_edit_authorizations WHERE claim_marker = ?)`).bind(marker),
    // 3. Minimum withdrawal evidence: which signup, which direction, which
    //    version, when. No answers, no free text, no email address.
    db.prepare(`INSERT INTO waitlist_profile_consent_events
        (signup_id, event_type, profile_consent_version, privacy_notice_version, consent_method)
      SELECT a.signup_id, 'withdrawn', ?, ?, 'profile_delete_action'
        FROM waitlist_profile_edit_authorizations a WHERE a.claim_marker = ?`)
      .bind(PROFILE_CONSENT_VERSION, PROFILE_NOTICE_VERSION, marker),
    // 4. Revoke every outstanding invitation for that signup.
    db.prepare(`UPDATE waitlist_profile_invitations SET revoked_at = datetime('now')
      WHERE signup_id = (SELECT signup_id FROM waitlist_profile_edit_authorizations WHERE claim_marker = ?)
        AND used_at IS NULL AND revoked_at IS NULL`).bind(marker),
    // 5. Revoke every other live authorization for that signup.
    db.prepare(`UPDATE waitlist_profile_edit_authorizations SET revoked_at = datetime('now')
      WHERE signup_id = (SELECT signup_id FROM waitlist_profile_edit_authorizations WHERE claim_marker = ?)
        AND claim_marker IS NOT ? AND consumed_at IS NULL AND revoked_at IS NULL`).bind(marker, marker),
  ]);
  if (Number(results?.[0]?.meta?.changes ?? 0) !== 1) return null;
  return { withdrawn: true };
}

/**
 * Positively identify a submission that came from a SUPERSEDED editing session.
 *
 * Cookies are per-browser, not per-tab, so a stale tab submits the browser's
 * CURRENT cookie together with the CSRF value its own page was rendered with.
 * That mismatch used to be treated as an attack and revoked the live
 * authorization - destroying the good tab as well as the stale one.
 *
 * The submitted CSRF value is the discriminator: if it hashes to the csrf_digest
 * of a REVOKED authorization for the same invitation, and a newer authorization
 * for that invitation exists, then this is a replaced session and not an attack.
 * Returns false for everything else, so genuine CSRF failures keep their old
 * treatment.
 */
export async function isSupersededSubmission(db, rawCookie, submittedCsrf) {
  if (typeof submittedCsrf !== "string" || !submittedCsrf) return false;
  const submittedDigest = await sha256Hex(submittedCsrf);
  const stale = await db.prepare(`SELECT id, invitation_id, issued_at FROM waitlist_profile_edit_authorizations
    WHERE csrf_digest = ? AND revoked_at IS NOT NULL`).bind(submittedDigest).first();
  if (!stale) return false;
  const newer = await db.prepare(`SELECT 1 AS n FROM waitlist_profile_edit_authorizations
    WHERE invitation_id = ? AND id != ? AND issued_at >= ?
      AND (revoked_at IS NULL OR consumed_at IS NOT NULL)`)
    .bind(stale.invitation_id, stale.id, stale.issued_at).first();
  return Boolean(newer);
}

/** Terminal invalidation of an edit session (used on success and on failure). */
export async function revokeEditAuthorization(db, rawCookie) {
  if (typeof rawCookie !== "string" || !rawCookie) return 0;
  const result = await db.prepare(`UPDATE waitlist_profile_edit_authorizations SET revoked_at = datetime('now')
    WHERE cookie_digest = ? AND consumed_at IS NULL AND revoked_at IS NULL`).bind(await sha256Hex(rawCookie)).run();
  return Number(result?.meta?.changes ?? 0);
}

export { sha256Hex as profileAuthDigest, opaqueValue as profileAuthOpaqueValue, sameValue as profileAuthSameValue };
