import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  issueProfileInvitation, resolveProfileInvitation, saveProfileThroughInvitation,
  requestProfileEditLink, revokeProfileInvitations, sweepProfileRetention,
  ProfileValidationError, TRACK_INVOLVEMENT_VALUES, TRACK_INVOLVEMENT_LABELS,
  EXPERIENCE_LEVEL_VALUES, EXPERIENCE_LEVEL_LABELS, GOALS_MAX_LENGTH,
  PROFILE_COPY_VERSION, PROFILE_NOTICE_VERSION, PROFILE_TOKEN_TTL_DAYS, escapeHtml,
} from "../src/waitlist-profile-service.js";

// Optional post-confirmation rider profile — PR 1: schema, token lifecycle,
// service layer, retention integration. No routes, no UI, no welcome-email
// CTA yet. Every binding product rule from track-helper #31 is asserted here.

class LocalD1 {
  constructor() { this.sqlite = new DatabaseSync(":memory:"); this.sqlite.exec("PRAGMA foreign_keys = ON"); }
  prepare(sql) {
    const sqlite = this.sqlite;
    return { bind(...values) { return {
      all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
      first: async () => sqlite.prepare(sql).get(...values) || null,
      run: async () => (/^\s*SELECT\b/i.test(sql)
        ? { success: true, results: sqlite.prepare(sql).all(...values), meta: { changes: 0 } }
        : { success: true, results: [], meta: { changes: sqlite.prepare(sql).run(...values).changes } }),
    }; } };
  }
  // Mirrors D1: a batch is one transaction - all statements commit, or none.
  async batch(statements) {
    this.sqlite.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }
}

const db = new LocalD1();
for (const m of ["0001_waitlist.sql", "0002_program_track.sql", "0003_resubscription_evidence.sql", "0004_rider_profiles.sql"]) {
  db.sqlite.exec(readFileSync(join(import.meta.dirname, "..", "migrations", m), "utf8"));
}
const row = (sql, ...args) => db.sqlite.prepare(sql).get(...args);
const count = (sql, ...args) => row(sql, ...args).n;
const seed = (id, email, status, track = "us_beta_waitlist", extra = "") =>
  db.sqlite.prepare(`INSERT INTO waitlist_signups (id, email_normalized, country_code, program_track, status,
    consent_at, consent_copy_version, privacy_notice_version${extra ? ", " + extra.split("=")[0] : ""})
    VALUES (?, ?, 'US', ?, ?, datetime('now'), '2026-08-05.2', '2026-08-05.2'${extra ? ", " + extra.split("=")[1] : ""})`)
    .run(id, email, track, status);

seed("s_conf", "confirmed@example.com", "confirmed");
seed("s_pend", "pending@example.com", "pending");
seed("s_unsub", "unsubscribed@example.com", "unsubscribed", "international_interest", "unsubscribed_at=datetime('now')");

// ---------------------------------------------------------------------------
// Issuance gating: confirmed only.
// ---------------------------------------------------------------------------
{
  assert.equal(await issueProfileInvitation(db, "s_pend", "welcome_email"), null, "pending is never invited");
  assert.equal(await issueProfileInvitation(db, "s_unsub", "welcome_email"), null, "unsubscribed is never invited");
  assert.equal(await issueProfileInvitation(db, "s_missing", "welcome_email"), null, "unknown signup is never invited");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profile_invitations"), 0, "no ledger rows for ineligible signups");
  await assert.rejects(() => issueProfileInvitation(db, "s_conf", "sneaky_channel"), /Unsupported invitation channel/);

  const token = await issueProfileInvitation(db, "s_conf", "welcome_email");
  assert.ok(typeof token === "string" && token.length >= 40, "a raw token is returned once");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profile_invitations WHERE token_digest = ?", token), 0,
    "the RAW token is never stored - only its digest");
  const stored = row("SELECT token_digest, expires_at, channel FROM waitlist_profile_invitations WHERE signup_id = 's_conf'");
  assert.equal(stored.token_digest.length, 64, "hashed at rest");
  assert.equal(stored.channel, "welcome_email");
  const days = (new Date(stored.expires_at + "Z") - new Date()) / 86400000;
  assert.ok(days > PROFILE_TOKEN_TTL_DAYS - 1 && days <= PROFILE_TOKEN_TTL_DAYS, `bounded ~${PROFILE_TOKEN_TTL_DAYS}-day expiry`);
}

// ---------------------------------------------------------------------------
// One live link at a time; at most ONE operator-triggered later invitation.
// ---------------------------------------------------------------------------
{
  const first = await issueProfileInvitation(db, "s_conf", "later_invitation");
  assert.ok(first, "the single later invitation issues");
  assert.equal(await issueProfileInvitation(db, "s_conf", "later_invitation"), null,
    "a SECOND later invitation is refused by the partial unique index");
  assert.equal(await resolveProfileInvitation(db, first) !== null, true, "the newest link resolves");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profile_invitations WHERE signup_id='s_conf' AND superseded_at IS NOT NULL"), 1,
    "issuing supersedes the outstanding unused link - exactly one is live");
}

// ---------------------------------------------------------------------------
// Save: partial profiles valid; token consumed ONLY on success; edits need a
// newly requested link.
// ---------------------------------------------------------------------------
{
  const token = await issueProfileInvitation(db, "s_conf", "requested_edit_link");

  // A failed save (invalid controlled value) must NOT consume the link.
  await assert.rejects(() => saveProfileThroughInvitation(db, token, { track_involvement: ["astronaut"] }),
    /Unsupported track-involvement value/);
  await assert.rejects(() => saveProfileThroughInvitation(db, token, { experience_level: "expert" }),
    /Unsupported experience level/);
  await assert.rejects(() => saveProfileThroughInvitation(db, token, { goals: "x".repeat(GOALS_MAX_LENGTH + 1) }),
    /limited to 1000 characters/);
  assert.ok(await resolveProfileInvitation(db, token), "a failed attempt leaves the link usable");

  // Partial profile: only two fields supplied.
  const saved = await saveProfileThroughInvitation(db, token, {
    track_involvement: ["track_day_rider", "coach_or_instructor", "track_day_rider"],
    goals: "  Understand   why my <b>front</b> feels vague\n\n  in fast corners.  ",
  });
  assert.deepEqual(saved, { saved: true, program_track: "us_beta_waitlist" });
  const profile = row("SELECT * FROM waitlist_profiles WHERE signup_id = 's_conf'");
  assert.deepEqual(JSON.parse(profile.track_involvement), ["track_day_rider", "coach_or_instructor"], "multi-select, de-duplicated");
  assert.equal(profile.experience_level, null, "partial profile is valid");
  assert.equal(profile.display_name, null);
  assert.equal(profile.goals, "Understand   why my <b>front</b> feels vague\n\n  in fast corners.",
    "rider text is stored LITERALLY: internal spacing, wording, and line breaks preserved; only outer whitespace trimmed");
  assert.equal(profile.profile_copy_version, PROFILE_COPY_VERSION);
  assert.equal(profile.privacy_notice_version, PROFILE_NOTICE_VERSION);
  assert.equal(profile.interest_early_testing, 0, "interest flags default off");

  // The link is now consumed; a later edit requires a NEW link.
  assert.equal(await resolveProfileInvitation(db, token), null, "single-use: consumed after the successful save");
  assert.equal(await saveProfileThroughInvitation(db, token, { display_name: "Sneaky" }), null, "a consumed link cannot save again");
  assert.equal(row("SELECT display_name FROM waitlist_profiles WHERE signup_id='s_conf'").display_name, null,
    "the rejected replay changed nothing");

  const fresh = await requestProfileEditLink(db, "confirmed@example.com");
  assert.ok(fresh, "a newly requested link is issued for a confirmed signup");
  await saveProfileThroughInvitation(db, fresh, {
    display_name: "Evan", experience_level: "four_to_ten_years",
    track_involvement: ["other"], track_involvement_other: "Suspension technician",
    interest_early_testing: true,
  });
  const updated = row("SELECT * FROM waitlist_profiles WHERE signup_id = 's_conf'");
  assert.equal(updated.display_name, "Evan");
  assert.equal(updated.experience_level, "four_to_ten_years");
  assert.equal(updated.track_involvement_other, "Suspension technician", "the free-text 'other' is stored SEPARATELY");
  assert.equal(JSON.parse(updated.track_involvement).includes("other"), true, "controlled value kept alongside it");
  assert.equal(updated.interest_early_testing, 1);
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profiles WHERE signup_id='s_conf'"), 1, "one profile row per signup");
  const otherCapLink = await requestProfileEditLink(db, "confirmed@example.com");
  await assert.rejects(() => saveProfileThroughInvitation(db, otherCapLink,
    { track_involvement: ["other"], track_involvement_other: "x".repeat(101) }), /limited to 100 characters/);
}

// ---------------------------------------------------------------------------
// Request-a-new-edit-link: never issues for ineligible states, never
// reactivates, and never mutates the signup.
// ---------------------------------------------------------------------------
{
  const before = row("SELECT status, program_track, unsubscribed_at, resubscribed_at FROM waitlist_signups WHERE id='s_unsub'");
  assert.equal(await requestProfileEditLink(db, "pending@example.com"), null, "pending gets no link");
  assert.equal(await requestProfileEditLink(db, "unsubscribed@example.com"), null, "unsubscribed gets no link");
  assert.equal(await requestProfileEditLink(db, "never-heard-of@example.com"), null, "unknown gets no link");
  assert.equal(await requestProfileEditLink(db, "  CONFIRMED@Example.com  ") !== null, true, "normalizes the address");
  const after = row("SELECT status, program_track, unsubscribed_at, resubscribed_at FROM waitlist_signups WHERE id='s_unsub'");
  assert.deepEqual({ ...after }, { ...before }, "the unsubscribed record is byte-identical - never reactivated or altered");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_signups"), 3, "the request flow never creates a signup row");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profile_invitations WHERE signup_id IN ('s_pend','s_unsub')"), 0,
    "no ledger rows for ineligible addresses");
}

// ---------------------------------------------------------------------------
// Revocation on unsubscribe; expiry; cross-purpose isolation.
// ---------------------------------------------------------------------------
{
  seed("s_leaver", "leaver@example.com", "confirmed");
  const live = await issueProfileInvitation(db, "s_leaver", "welcome_email");
  assert.ok(await resolveProfileInvitation(db, live));
  assert.equal(await revokeProfileInvitations(db, "s_leaver"), 1, "unsubscribing revokes outstanding links");
  assert.equal(await resolveProfileInvitation(db, live), null, "a revoked link stops working immediately");

  seed("s_expired", "expired@example.com", "confirmed");
  const stale = await issueProfileInvitation(db, "s_expired", "welcome_email");
  db.sqlite.prepare("UPDATE waitlist_profile_invitations SET expires_at = datetime('now','-1 day') WHERE signup_id='s_expired'").run();
  assert.equal(await resolveProfileInvitation(db, stale), null, "expiry is honored");

  // A profile token is single-purpose: it is not a wait-list confirm token,
  // and a wait-list token is not a profile token.
  db.sqlite.prepare(`INSERT INTO waitlist_tokens (id, signup_id, token_digest, purpose, expires_at)
    VALUES ('wlt_x', 's_conf', ?, 'confirm', datetime('now','+1 day'))`).run("f".repeat(64));
  assert.equal(await resolveProfileInvitation(db, "f".repeat(64)), null, "a wait-list token can never open a profile");

  // Status change alone: a confirmed signup that becomes unsubscribed can no
  // longer resolve a link even before explicit revocation.
  seed("s_flip", "flip@example.com", "confirmed");
  const flipToken = await issueProfileInvitation(db, "s_flip", "welcome_email");
  db.sqlite.prepare("UPDATE waitlist_signups SET status='unsubscribed', unsubscribed_at=datetime('now') WHERE id='s_flip'").run();
  assert.equal(await resolveProfileInvitation(db, flipToken), null, "status gate is re-checked at resolution time");
}

// ---------------------------------------------------------------------------
// Retention: deleted within 30 days after unsubscribe; never beyond the
// wait-list ceiling; active records untouched.
// ---------------------------------------------------------------------------
{
  seed("s_ret", "retention@example.com", "confirmed");
  const t = await issueProfileInvitation(db, "s_ret", "welcome_email");
  await saveProfileThroughInvitation(db, t, { display_name: "Retention Rider" });
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profiles WHERE signup_id='s_ret'"), 1);

  let swept = await sweepProfileRetention(db);
  assert.equal(swept.profiles_purged, 0, "an active record's profile is retained");

  db.sqlite.prepare("UPDATE waitlist_signups SET status='unsubscribed', unsubscribed_at=datetime('now','-10 days') WHERE id='s_ret'").run();
  swept = await sweepProfileRetention(db);
  assert.equal(swept.profiles_purged, 0, "inside the 30-day window the profile survives");

  db.sqlite.prepare("UPDATE waitlist_signups SET unsubscribed_at=datetime('now','-31 days') WHERE id='s_ret'").run();
  swept = await sweepProfileRetention(db);
  assert.equal(swept.profiles_purged, 1, "deleted within 30 days after unsubscribe");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profiles WHERE signup_id='s_ret'"), 0);
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profile_invitations WHERE signup_id='s_ret'"), 0,
    "its invitations go with it");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_signups WHERE id='s_ret'"), 1,
    "the suppression record itself SURVIVES - profile deletion never removes it");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profiles WHERE signup_id='s_conf'"), 1,
    "other riders' profiles are untouched");
}

// ---------------------------------------------------------------------------
// Structural: separation, vocabulary, and the absence of any ranking concept.
// ---------------------------------------------------------------------------
{
  const columns = db.sqlite.prepare("SELECT name FROM pragma_table_info('waitlist_profiles')").all().map((c) => c.name);
  for (const forbidden of ["rank", "score", "priority", "position", "eligibility", "completion", "invite_order"]) {
    assert.ok(!columns.some((c) => c.includes(forbidden)), `no ${forbidden} column exists - profiles are position-neutral`);
  }
  assert.ok(!columns.includes("rider_type"), "the field is track_involvement, not rider_type");
  assert.ok(columns.includes("track_involvement") && columns.includes("track_involvement_other"), "approved field names");
  assert.deepEqual([...TRACK_INVOLVEMENT_VALUES], ["preparing_for_first_track_day", "track_day_rider", "club_racer",
    "national_or_professional_racer", "coach_or_instructor", "mechanic_or_technician", "other"], "approved values, in order");
  assert.equal(TRACK_INVOLVEMENT_LABELS.preparing_for_first_track_day, "Preparing for my first track day");
  assert.deepEqual([...EXPERIENCE_LEVEL_VALUES], ["first_event_or_season", "one_to_three_years", "four_to_ten_years",
    "more_than_ten_years", "prefer_not_to_say"], "approved experience values");
  assert.equal(EXPERIENCE_LEVEL_LABELS.more_than_ten_years, "More than 10 years");
  assert.equal(GOALS_MAX_LENGTH, 1000);
  assert.equal(PROFILE_COPY_VERSION, "2026-08-05.3");
  assert.equal(PROFILE_NOTICE_VERSION, "2026-08-05.3");

  // Consent, status, and suppression columns live on the SIGNUP table only.
  for (const consentColumn of ["consent_at", "consent_copy_version", "status", "unsubscribed_at", "resubscribed_at"]) {
    assert.ok(!columns.includes(consentColumn), `${consentColumn} stays on the signup record, never duplicated onto profiles`);
  }
  assert.equal(count("SELECT COUNT(*) AS n FROM pragma_foreign_key_check()"), 0, "FK clean");
}


// ---------------------------------------------------------------------------
// Free text is preserved literally and escaped at render - never rewritten.
// ---------------------------------------------------------------------------
{
  const link = await requestProfileEditLink(db, "confirmed@example.com");
  const written = "Front pushes < 60 mph & \"chatters\" on entry.\r\n\r\nLine two -> keep me.\r\n";
  await saveProfileThroughInvitation(db, link, { goals: written });
  const stored = row("SELECT goals FROM waitlist_profiles WHERE signup_id='s_conf'").goals;
  assert.equal(stored, "Front pushes < 60 mph & \"chatters\" on entry.\n\nLine two -> keep me.",
    "line endings normalized to LF and outer whitespace trimmed - nothing else changed");
  assert.ok(stored.includes("<") && stored.includes("&") && stored.includes("\""),
    "characters that merely look like markup survive verbatim");
  assert.equal(stored.split("\n").length, 3, "internal line breaks preserved");
  assert.equal(escapeHtml(stored),
    "Front pushes &lt; 60 mph &amp; &quot;chatters&quot; on entry.\n\nLine two -&gt; keep me.",
    "the render boundary escapes it so HTML can never execute");
  assert.equal(escapeHtml("<script>alert(1)</script>"), "&lt;script&gt;alert(1)&lt;/script&gt;");

  // A script-looking payload is STORED as written and only neutralized on render.
  const link2 = await requestProfileEditLink(db, "confirmed@example.com");
  await saveProfileThroughInvitation(db, link2, { goals: "<script>alert(1)</script>" });
  assert.equal(row("SELECT goals FROM waitlist_profiles WHERE signup_id='s_conf'").goals, "<script>alert(1)</script>",
    "storage is literal; safety lives at the render boundary");

  // The 1,000-character limit is validated server-side on the literal text.
  const link3 = await requestProfileEditLink(db, "confirmed@example.com");
  await assert.rejects(() => saveProfileThroughInvitation(db, link3, { goals: "x".repeat(1001) }), /limited to 1000 characters/);
  const link4 = await requestProfileEditLink(db, "confirmed@example.com");
  await saveProfileThroughInvitation(db, link4, { goals: "y".repeat(1000) });
  assert.equal(row("SELECT length(goals) AS n FROM waitlist_profiles WHERE signup_id='s_conf'").n, 1000, "exactly at the limit saves");
}

// ---------------------------------------------------------------------------
// ATOMIC replacement: an interrupted issuance leaves exactly one usable link.
// ---------------------------------------------------------------------------
{
  seed("s_atomic", "atomic@example.com", "confirmed");
  const original = await issueProfileInvitation(db, "s_atomic", "welcome_email");
  assert.ok(await resolveProfileInvitation(db, original), "the original link is usable");
  const usable = () => count(`SELECT COUNT(*) AS n FROM waitlist_profile_invitations
    WHERE signup_id='s_atomic' AND used_at IS NULL AND revoked_at IS NULL AND superseded_at IS NULL
      AND expires_at > datetime('now')`);
  assert.equal(usable(), 1, "exactly one usable link before replacement");

  // FAILURE INJECTION: the supersede half of the replacement aborts.
  db.sqlite.exec(`CREATE TRIGGER tmp_break_supersede BEFORE UPDATE ON waitlist_profile_invitations
    BEGIN SELECT RAISE(ABORT, 'injected_supersede_failure'); END`);
  let interrupted = null;
  try { interrupted = await issueProfileInvitation(db, "s_atomic", "requested_edit_link"); }
  catch (error) { interrupted = { error: String(error?.message) }; }
  db.sqlite.exec("DROP TRIGGER tmp_break_supersede");
  assert.ok(!interrupted || interrupted.error, "an interrupted replacement never returns a usable token");
  assert.equal(usable(), 1, "still exactly one usable link - never zero, never two");
  assert.ok(await resolveProfileInvitation(db, original), "the EXISTING link is intact and still works");

  // FAILURE INJECTION: the insert half aborts.
  db.sqlite.exec(`CREATE TRIGGER tmp_break_insert BEFORE INSERT ON waitlist_profile_invitations
    BEGIN SELECT RAISE(ABORT, 'injected_insert_failure'); END`);
  let insertFailed = null;
  try { insertFailed = await issueProfileInvitation(db, "s_atomic", "requested_edit_link"); }
  catch (error) { insertFailed = { error: String(error?.message) }; }
  db.sqlite.exec("DROP TRIGGER tmp_break_insert");
  assert.ok(!insertFailed || insertFailed.error);
  assert.equal(usable(), 1, "a failed insert supersedes nothing");
  assert.ok(await resolveProfileInvitation(db, original), "the existing link survives an insert failure");

  // A REFUSED issuance (second later invitation) also supersedes nothing.
  await issueProfileInvitation(db, "s_atomic", "later_invitation");
  const afterLater = usable();
  assert.equal(afterLater, 1, "a successful replacement leaves exactly one usable link");
  assert.equal(await issueProfileInvitation(db, "s_atomic", "later_invitation"), null, "the second later invitation is refused");
  assert.equal(usable(), 1, "the refusal left the live link untouched");

  // Success path: replacement supersedes the old and leaves exactly one.
  const replacement = await issueProfileInvitation(db, "s_atomic", "requested_edit_link");
  assert.ok(replacement && await resolveProfileInvitation(db, replacement), "the replacement works");
  assert.equal(usable(), 1, "exactly one usable link after a successful replacement");
}

// ---------------------------------------------------------------------------
// Pre-merge confirmations: migration chain, failed-migration safety, no
// logging of secrets or free text, and PR-scope containment.
// ---------------------------------------------------------------------------
{
  // 0004 applies cleanly on top of 0001-0003, and only after them.
  const fresh = new LocalD1();
  for (const m of ["0001_waitlist.sql", "0002_program_track.sql", "0003_resubscription_evidence.sql", "0004_rider_profiles.sql"]) {
    fresh.sqlite.exec(readFileSync(join(import.meta.dirname, "..", "migrations", m), "utf8"));
  }
  assert.equal(fresh.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name LIKE 'waitlist%'").get().n, 6);
  assert.equal(fresh.sqlite.prepare("SELECT COUNT(*) AS n FROM pragma_foreign_key_check()").get().n, 0);

  // A FAILED 0004 leaves the prior schema fully usable (statement-level, no
  // partial table state that breaks 0001-0003 behavior).
  const broken = new LocalD1();
  for (const m of ["0001_waitlist.sql", "0002_program_track.sql", "0003_resubscription_evidence.sql"]) {
    broken.sqlite.exec(readFileSync(join(import.meta.dirname, "..", "migrations", m), "utf8"));
  }
  const migrationSql = readFileSync(join(import.meta.dirname, "..", "migrations", "0004_rider_profiles.sql"), "utf8");
  const statements = migrationSql.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n")
    .split(";").map((statement) => statement.trim()).filter(Boolean);
  try {
    broken.sqlite.exec(statements[0]);                 // first CREATE succeeds
    broken.sqlite.exec("CREATE TABLE waitlist_profiles (x TEXT)"); // injected failure: already exists
    assert.fail("expected the injected migration failure");
  } catch (error) { assert.match(String(error.message), /already exists/); }
  broken.sqlite.prepare("INSERT INTO waitlist_signups (id, email_normalized, country_code, program_track, status, consent_at, consent_copy_version, privacy_notice_version) VALUES ('s_after_fail', 'after@example.com', 'US', 'us_beta_waitlist', 'pending', datetime('now'), 'v', 'v')").run();
  assert.equal(broken.sqlite.prepare("SELECT status FROM waitlist_signups WHERE id='s_after_fail'").get().status, "pending",
    "the prior schema still accepts wait-list writes after a failed 0004");
  assert.equal(broken.sqlite.prepare("SELECT COUNT(*) AS n FROM pragma_foreign_key_check()").get().n, 0);

  // Token digests and rider free text never enter logs.
  const serviceSource = readFileSync(join(import.meta.dirname, "..", "src", "waitlist-profile-service.js"), "utf8");
  assert.ok(!/console\.(log|info|warn|error|debug)/.test(serviceSource),
    "the profile service logs NOTHING - no token, digest, or rider text can reach a log line");
  assert.ok(!/raw|token/i.test((serviceSource.match(/console[^\n]*/g) || []).join(" ")), "no token logging anywhere");

  // PR scope containment: no route, UI, email CTA, or production config.
  const workerSource = readFileSync(join(import.meta.dirname, "..", "src", "waitlist-worker.js"), "utf8");
  assert.ok(!/\/waitlist\/profile/.test(workerSource), "no profile ROUTE has entered this PR");
  assert.ok(!/profile.*\?token=|Tell us about your riding/i.test(workerSource), "no profile CTA or link in any email or page");
  assert.ok(!workerSource.includes("issueProfileInvitation"), "no invitation is issued anywhere yet - PR 3 wires the welcome email");
  const wrangler = readFileSync(join(import.meta.dirname, "..", "wrangler.jsonc"), "utf8");
  const config = JSON.parse(wrangler.split(/\r?\n/).map((line) => line.replace(/^\s*\/\/.*$/, "")).join("\n"));
  const { env: environments, ...production } = config;
  assert.equal("d1_databases" in production, false, "no production database binding entered this PR");
  assert.equal("send_email" in production, false, "no production email binding entered this PR");
  assert.ok(!wrangler.includes("mototrack_waitlist_production"), "no production resource name appears anywhere");
}

console.log("waitlist-profile.test.js passed");
