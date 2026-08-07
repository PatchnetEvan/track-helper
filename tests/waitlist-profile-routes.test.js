import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import worker, { runRetentionSweep, EMAIL_SEND_LIMIT_PER_DAY } from "../src/waitlist-worker.js";
import { issueProfileInvitation } from "../src/waitlist-profile-service.js";
import { profileInvitationEmail } from "../src/waitlist-profile-batch.js";
import {
  PROFILE_COOKIE, PROFILE_CSRF_COOKIE, PROFILE_PATH,
  PROFILE_REQUEST_CSRF_COOKIE, PROFILE_REQUEST_PATH,
} from "../src/waitlist-profile-auth.js";

// Rider profile PR 2: protected exchange, short-lived revocable edit
// authorization, form, atomic save, generic unavailable state, and the
// edit-link request. Drives the REAL worker fetch handler.

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
for (const m of ["0001_waitlist.sql", "0002_program_track.sql", "0003_resubscription_evidence.sql",
  "0004_rider_profiles.sql", "0005_profile_edit_authorizations.sql", "0006_profile_consent_events.sql", "0007_profile_invitation_batches.sql"]) {
  db.sqlite.exec(readFileSync(join(import.meta.dirname, "..", "migrations", m), "utf8"));
}
const sent = [];
const env = {
  WAITLIST_DB: db,
  WAITLIST_PROFILE_ENABLED: "true",
  WAITLIST_EMAIL_TEST: { async send(message) { sent.push(message); return { status: "test_capture" }; } },
  ASSETS: { fetch: async () => new Response("static", { status: 200 }) },
};
const ORIGIN = "https://mototrack.app";
const row = (sql, ...args) => db.sqlite.prepare(sql).get(...args);
const count = (sql, ...args) => row(sql, ...args).n;
const seed = (id, email, status, track = "us_beta_waitlist") =>
  db.sqlite.prepare(`INSERT INTO waitlist_signups (id, email_normalized, country_code, program_track, status,
    consent_at, confirmed_at, consent_copy_version, privacy_notice_version)
    VALUES (?, ?, 'US', ?, ?, datetime('now'), datetime('now'), '2026-08-05.2', '2026-08-05.2')`)
    .run(id, email, track, status);

seed("s1", "rider@example.com", "confirmed");
seed("s2", "other@example.com", "confirmed", "international_interest");
seed("s3", "pending@example.com", "pending");
seed("s4", "gone@example.com", "unsubscribed");
db.sqlite.prepare("UPDATE waitlist_signups SET unsubscribed_at = datetime('now') WHERE id = 's4'").run();

const get = (path, cookies = {}) => worker.fetch(new Request(`${ORIGIN}${path}`, {
  headers: Object.keys(cookies).length
    ? { cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ") } : {},
}), env);
const post = (path, fields, cookies = {}, origin = ORIGIN, extraHeaders = {}, useEnv = env) => {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) value.forEach((v) => body.append(key, v));
    else if (value !== undefined && value !== null) body.append(key, String(value));
  }
  return worker.fetch(new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(origin ? { origin } : {}),
      ...extraHeaders,
      ...(Object.keys(cookies).length ? { cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
    },
    body,
  }), useEnv);
};
const cookiesFrom = (response) => {
  const jar = {};
  for (const header of response.headers.getSetCookie?.() ?? [response.headers.get("set-cookie")].filter(Boolean)) {
    const [pair] = header.split(";");
    const [name, ...rest] = pair.split("=");
    jar[name.trim()] = rest.join("=");
  }
  return jar;
};
const openSession = async (signupId) => {
  const token = await issueProfileInvitation(db, signupId, "requested_edit_link");
  const exchange = await get(`${PROFILE_PATH}/open?token=${token}`);
  return { token, exchange, jar: cookiesFrom(exchange) };
};

// ---------------------------------------------------------------------------
// Exchange: valid invitation exchanges, token disappears, nothing consumed.
// ---------------------------------------------------------------------------
{
  const { token, exchange, jar } = await openSession("s1");
  assert.equal(exchange.status, 303, "the exchange redirects");
  assert.equal(exchange.headers.get("location"), PROFILE_PATH, "clean URL - NO token in the redirect target");
  assert.ok(!exchange.headers.get("location").includes(token));
  assert.equal(exchange.headers.get("cache-control"), "no-store");
  assert.equal(exchange.headers.get("referrer-policy"), "no-referrer");
  assert.equal(await exchange.text(), "", "no markup, so no token can appear in it");
  const setCookies = (exchange.headers.getSetCookie?.() ?? []).join(" | ");
  assert.ok(!setCookies.includes(token), "the invitation token is never placed in a cookie");
  for (const attribute of ["HttpOnly", "Secure", "SameSite=Strict", `Path=${PROFILE_PATH}`, "Max-Age="]) {
    assert.ok(setCookies.includes(attribute), `cookie carries ${attribute}`);
  }
  assert.ok(!/Domain=/i.test(setCookies), "no Domain attribute");
  assert.ok(setCookies.includes("__Secure-"), "__Secure- prefix (not __Host-, which needs Path=/)");
  assert.equal(row("SELECT used_at FROM waitlist_profile_invitations WHERE signup_id='s1'").used_at, null,
    "opening the link does NOT consume the invitation");

  // The form renders from authorization alone, with no token anywhere.
  const form = await get(PROFILE_PATH, jar);
  assert.equal(form.status, 200);
  const html = await form.text();
  assert.ok(!html.includes(token), "no invitation token in rendered markup");
  assert.ok(html.includes(`action="${PROFILE_PATH}"`) && !html.includes("token="), "no token in the form action");
  assert.ok(html.includes("This is optional"), "position-neutral statement present");
  assert.ok(html.includes("Save my profile"));
  assert.equal(form.headers.get("cache-control"), "no-store");
  assert.equal(form.headers.get("x-frame-options"), "DENY");
  assert.match(form.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.ok(!/<script|analytics|googletagmanager|http:\/\//i.test(html), "no scripts or third-party resources");

  // Abandoning the form leaves the emailed link usable.
  const reopened = await get(`${PROFILE_PATH}/open?token=${token}`);
  assert.equal(reopened.status, 303, "the invitation is still usable after an abandoned session");
  assert.equal(count(`SELECT COUNT(*) AS n FROM waitlist_profile_edit_authorizations
    WHERE signup_id='s1' AND revoked_at IS NOT NULL`), 1, "reopening revoked the previous authorization only");
  assert.equal(row("SELECT used_at, superseded_at FROM waitlist_profile_invitations WHERE signup_id='s1'").superseded_at, null,
    "reopening never supersedes the invitation itself");
  // The first session's cookie is now dead.
  assert.equal((await get(PROFILE_PATH, jar)).status, 410, "the replaced authorization no longer works");
}

// ---------------------------------------------------------------------------
// Validation failure keeps everything usable; successful save consumes once;
// replay cannot change the profile.
// ---------------------------------------------------------------------------
{
  const { token, jar } = await openSession("s1");
  const bad = await post(PROFILE_PATH, { profile_consent: 1, csrf: jar[PROFILE_CSRF_COOKIE], goals: "x".repeat(1001) }, jar);
  assert.equal(bad.status, 200, "a validation failure re-renders the form");
  assert.match(await bad.text(), /limited to 1000 characters/);
  assert.equal(row("SELECT used_at FROM waitlist_profile_invitations WHERE token_digest IS NOT NULL AND signup_id='s1' ORDER BY issued_at DESC LIMIT 1").used_at, null,
    "a failed save consumes NOTHING");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profiles WHERE signup_id='s1'"), 0, "and writes nothing");

  const saved = await post(PROFILE_PATH, {
    profile_consent: 1,
    csrf: jar[PROFILE_CSRF_COOKIE],
    display_name: "Evan",
    track_involvement: ["track_day_rider", "coach_or_instructor"],
    goals: "Front feels vague <b>in fast corners</b> & I want to know why.",
  }, jar);
  assert.equal(saved.status, 200);
  const savedHtml = await saved.text();
  assert.match(savedHtml, /your profile is saved/i);
  assert.match(savedHtml, /does not change your place on the waitlist/i);
  const profile = row("SELECT * FROM waitlist_profiles WHERE signup_id='s1'");
  assert.equal(profile.display_name, "Evan");
  assert.deepEqual(JSON.parse(profile.track_involvement), ["track_day_rider", "coach_or_instructor"]);
  assert.equal(profile.goals, "Front feels vague <b>in fast corners</b> & I want to know why.", "stored literally");
  assert.ok(row("SELECT used_at FROM waitlist_profile_invitations WHERE signup_id='s1' AND used_at IS NOT NULL"),
    "a successful save consumes the invitation");
  assert.ok(row("SELECT consumed_at FROM waitlist_profile_edit_authorizations WHERE signup_id='s1' AND consumed_at IS NOT NULL"),
    "and consumes the authorization");
  const clearing = (saved.headers.getSetCookie?.() ?? []).join(" | ");
  assert.ok(clearing.includes("Max-Age=0"), "cookies are deleted on success");

  // Replay with the same cookie cannot change anything.
  const replay = await post(PROFILE_PATH, { profile_consent: 1, csrf: jar[PROFILE_CSRF_COOKIE], display_name: "Replayed" }, jar);
  assert.equal(replay.status, 410, "replay hits the generic unavailable state");
  assert.equal(row("SELECT display_name FROM waitlist_profiles WHERE signup_id='s1'").display_name, "Evan",
    "the replay changed nothing");
  // And the emailed link is now spent.
  assert.equal((await get(`${PROFILE_PATH}/open?token=${token}`)).status, 410, "the consumed invitation cannot reopen");
}

// ---------------------------------------------------------------------------
// Authority is lost when state changes AFTER page load - no write, same page.
// ---------------------------------------------------------------------------
{
  const scenarios = [
    ["unsubscribe after load", (signupId) => db.sqlite.prepare(
      "UPDATE waitlist_signups SET status='unsubscribed', unsubscribed_at=datetime('now') WHERE id=?").run(signupId)],
    ["suppression/status change after load", (signupId) => db.sqlite.prepare(
      "UPDATE waitlist_signups SET status='pending' WHERE id=?").run(signupId)],
    ["invitation superseded after load", (signupId) => db.sqlite.prepare(
      "UPDATE waitlist_profile_invitations SET superseded_at=datetime('now') WHERE signup_id=? AND used_at IS NULL").run(signupId)],
    ["invitation revoked after load", (signupId) => db.sqlite.prepare(
      "UPDATE waitlist_profile_invitations SET revoked_at=datetime('now') WHERE signup_id=? AND used_at IS NULL").run(signupId)],
    ["edit authorization expired", (signupId) => db.sqlite.prepare(
      "UPDATE waitlist_profile_edit_authorizations SET expires_at=datetime('now','-1 minute') WHERE signup_id=? AND consumed_at IS NULL").run(signupId)],
    ["edit authorization revoked", (signupId) => db.sqlite.prepare(
      "UPDATE waitlist_profile_edit_authorizations SET revoked_at=datetime('now') WHERE signup_id=? AND consumed_at IS NULL").run(signupId)],
  ];
  let index = 0;
  for (const [label, mutate] of scenarios) {
    index += 1;
    const signupId = `s_case_${index}`;
    seed(signupId, `case${index}@example.com`, "confirmed");
    const { jar } = await openSession(signupId);
    assert.equal((await get(PROFILE_PATH, jar)).status, 200, `${label}: form loads first`);
    mutate(signupId);
    const attempt = await post(PROFILE_PATH, { profile_consent: 1, csrf: jar[PROFILE_CSRF_COOKIE], display_name: "Should Not Save" }, jar);
    assert.equal(attempt.status, 410, `${label}: the same generic unavailable state`);
    assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profiles WHERE signup_id=?", signupId), 0,
      `${label}: NO profile was written`);
  }
}

// ---------------------------------------------------------------------------
// Cross-signup access, CSRF, method, and uniform failure rendering.
// ---------------------------------------------------------------------------
{
  seed("s_a", "a@example.com", "confirmed");
  seed("s_b", "b@example.com", "confirmed");
  const a = await openSession("s_a");
  const b = await openSession("s_b");
  // A's cookie can only ever write A's profile - there is no signup selector.
  await post(PROFILE_PATH, { profile_consent: 1, csrf: a.jar[PROFILE_CSRF_COOKIE], display_name: "A only" }, a.jar);
  assert.equal(row("SELECT display_name FROM waitlist_profiles WHERE signup_id='s_a'").display_name, "A only");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profiles WHERE signup_id='s_b'"), 0, "B untouched by A's session");
  // Mixing A's CSRF with B's cookie fails.
  const mixed = await post(PROFILE_PATH, { profile_consent: 1, csrf: a.jar[PROFILE_CSRF_COOKIE], display_name: "Cross" }, b.jar);
  assert.equal(mixed.status, 410, "a mismatched CSRF value is refused");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profiles WHERE signup_id='s_b'"), 0);

  // Missing CSRF, foreign origin.
  seed("s_c", "c@example.com", "confirmed");
  const c = await openSession("s_c");
  assert.equal((await post(PROFILE_PATH, { display_name: "No CSRF" }, c.jar)).status, 410, "missing CSRF refused");
  const d = await openSession("s_c");
  assert.equal((await post(PROFILE_PATH, { profile_consent: 1, csrf: d.jar[PROFILE_CSRF_COOKIE], display_name: "Foreign" }, d.jar,
    "https://evil.example")).status, 410, "foreign origin refused");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profiles WHERE signup_id='s_c'"), 0, "neither wrote anything");

  // Every malformed/unknown/used/revoked/expired input renders identically.
  const bodies = [];
  for (const path of [`${PROFILE_PATH}/open?token=`, `${PROFILE_PATH}/open?token=not-a-real-token-value-here`,
    `${PROFILE_PATH}/open?token=${"z".repeat(43)}`]) {
    const response = await get(path);
    assert.equal(response.status, 410);
    bodies.push(await response.text());
  }
  const noCookie = await get(PROFILE_PATH);
  bodies.push(await noCookie.text());
  assert.equal(noCookie.status, 410);
  assert.ok(bodies.every((body) => body === bodies[0]), "one identical external failure response for every condition");
  assert.match(bodies[0], /no longer available/i);
  assert.ok(!/expired|revoked|unknown|unsubscribed|not confirmed/i.test(bodies[0]), "no disclosure of which condition applied");

  // GET never mutates; profile writes are POST-only.
  const beforeGet = count("SELECT COUNT(*) AS n FROM waitlist_profiles");
  await get(`${PROFILE_PATH}?display_name=ShouldNotSave`, a.jar);
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profiles"), beforeGet, "GET performs no mutation");
}

// ---------------------------------------------------------------------------
// Request-a-new-edit-link: one generic response, nothing sent or changed for
// ineligible addresses.
// ---------------------------------------------------------------------------
{
  const invitationsBeforeGet = count("SELECT COUNT(*) AS n FROM waitlist_profile_invitations");
  const formPage = await get(PROFILE_REQUEST_PATH);
  assert.equal(formPage.status, 200);
  const requestJar = cookiesFrom(formPage);
  const csrf = requestJar[PROFILE_REQUEST_CSRF_COOKIE];
  assert.ok(csrf, "the unauthenticated form sets its OWN double-submit CSRF cookie");
  assert.equal(requestJar[PROFILE_CSRF_COOKIE], undefined, "it never writes the authenticated edit CSRF cookie");
  const requestCookieHeader = formPage.headers.getSetCookie().find((h) => h.startsWith(PROFILE_REQUEST_CSRF_COOKIE));
  assert.match(requestCookieHeader, new RegExp(`Path=${PROFILE_REQUEST_PATH}(;|$)`), "scoped to the request path only");
  for (const attribute of ["HttpOnly", "Secure", "SameSite=Strict"]) {
    assert.ok(requestCookieHeader.includes(attribute), `request cookie keeps ${attribute}`);
  }
  assert.match(requestCookieHeader, /Max-Age=\d+/, "bounded Max-Age");
  assert.ok(!/Domain=/i.test(requestCookieHeader), "no Domain attribute");
  assert.equal(sent.length, 0, "GET sends nothing and issues nothing");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profile_invitations"), invitationsBeforeGet,
    "GET performs no issuance");

  const outcomes = [];
  for (const email of ["pending@example.com", "gone@example.com", "nobody@example.com", "other@example.com"]) {
    const before = { signups: count("SELECT COUNT(*) AS n FROM waitlist_signups"),
      s3: row("SELECT status FROM waitlist_signups WHERE id='s3'").status,
      s4: row("SELECT status, unsubscribed_at, resubscribed_at FROM waitlist_signups WHERE id='s4'") };
    const response = await post(PROFILE_REQUEST_PATH, { csrf, email }, requestJar);
    assert.equal(response.status, 202, "one generic 202 acknowledgement for every address");
    outcomes.push(await response.text());
    assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_signups"), before.signups, "no signup row is ever created");
    assert.equal(row("SELECT status FROM waitlist_signups WHERE id='s3'").status, before.s3, "pending unchanged");
    assert.deepEqual({ ...row("SELECT status, unsubscribed_at, resubscribed_at FROM waitlist_signups WHERE id='s4'") },
      { ...before.s4 }, "the unsubscribed record is byte-identical - never reactivated");
  }
  assert.ok(outcomes.every((body) => body === outcomes[0]), "identical generic response for every address");
  assert.match(outcomes[0], /If this email address is on the MotoTrack waitlist/i);
  assert.equal(sent.length, 1, "exactly one email sent - only for the confirmed address");
  assert.equal(sent[0].subject, "Your MotoTrack profile link");
  assert.equal(sent[0].to, "other@example.com");
  assert.match(sent[0].text, /does not affect your place on the waitlist/);
  assert.match(sent[0].text, /waitlist or regional interest list/);
  // The footer says "You can unsubscribe at any time", so it must carry a link
  // that actually does. A promise with no mechanism is the defect this pins.
  const unsubscribeLine = sent[0].text.split("\n").find((line) => line.startsWith("Unsubscribe: "));
  assert.ok(unsubscribeLine, "the requested-link email carries an unsubscribe line");
  const unsubToken = unsubscribeLine.split("token=")[1];
  assert.ok(unsubToken && unsubToken.length >= 40, "with a real token, not a placeholder");
  const storedUnsub = row(`SELECT purpose, used_at, superseded_at FROM waitlist_tokens
    WHERE signup_id = 's2' AND purpose = 'unsubscribe'`);
  assert.equal(storedUnsub.purpose, "unsubscribe", "the token is genuinely stored and usable");
  assert.equal(storedUnsub.used_at, null);
  assert.equal(storedUnsub.superseded_at, null);
  assert.match(sent[0].text, /^Privacy Policy: https:\/\/mototrack\.app\/privacy\.html$/m,
    "and the Privacy Policy link is unchanged");

  // Exactly one unsubscribe URL, and exactly one profile link: the message
  // must not sprout a second call to action or a duplicate opt-out.
  const requestedLines = sent[0].text.split("\n");
  assert.equal(requestedLines.filter((line) => line.startsWith("Unsubscribe: ")).length, 1,
    "exactly one unsubscribe URL");
  const profileLinkLines = requestedLines.filter((line) => line.includes(`${PROFILE_PATH}/open?token=`));
  assert.equal(profileLinkLines.length, 1, "the profile link is still present, exactly once");
  const profileToken = profileLinkLines[0].split("token=")[1];

  // The two tokens are distinct and purpose-specific: an unsubscribe link must
  // never double as profile access, and a profile link must never opt anyone
  // out. They live in different tables for exactly that reason.
  assert.notEqual(profileToken, unsubToken, "the profile and unsubscribe tokens are distinct values");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_tokens WHERE signup_id='s2' AND purpose != 'unsubscribe'"), 0,
    "the only waitlist_token minted here is the unsubscribe token");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profile_invitations WHERE signup_id='s2'"), 1,
    "and the profile token is an invitation, not a wait-list token");

  // The batch invitation copy is a DIFFERENT purpose and must be untouched by
  // this fix.
  const usInvitation = profileInvitationEmail("https://mototrack.app", "T", "us_beta_waitlist", "U");
  const intlInvitation = profileInvitationEmail("https://mototrack.app", "T", "international_interest", "U");
  assert.equal(usInvitation.subject, "Set up your MotoTrack rider profile");
  assert.equal(intlInvitation.subject, "Set up your MotoTrack rider profile");
  assert.notEqual(usInvitation.subject, sent[0].subject, "the two email purposes keep distinct subjects");
  assert.equal(usInvitation.text.split("\n")[0], "Tell us about your riding");
  assert.match(usInvitation.text, /does not affect your waitlist position, eligibility, or access timing\./);
  assert.match(intlInvitation.text, /does not affect your place on the international interest list or guarantee MotoTrack access or availability in your region\./);
  assert.ok(!usInvitation.text.includes("Here is your link to update your optional MotoTrack rider profile:"),
    "the batch invitation never borrows the rider-requested body");


  // CSRF mismatch answers the same generic page and sends nothing.
  const before = sent.length;
  const mismatched = await post(PROFILE_REQUEST_PATH, { csrf: "wrong", email: "other@example.com" }, requestJar);
  assert.equal(mismatched.status, 202);
  assert.equal(await mismatched.text(), outcomes[0], "identical response");
  assert.equal(sent.length, before, "nothing sent on CSRF failure");
}

// ---------------------------------------------------------------------------
// Stored script-like text renders escaped; partial profiles save.
// ---------------------------------------------------------------------------
{
  seed("s_esc", "escape@example.com", "confirmed");
  const first = await openSession("s_esc");
  const payload = '<script>alert("xss")</script> & "quoted"';
  await post(PROFILE_PATH, { profile_consent: 1, csrf: first.jar[PROFILE_CSRF_COOKIE], goals: payload }, first.jar);
  assert.equal(row("SELECT goals FROM waitlist_profiles WHERE signup_id='s_esc'").goals, payload, "stored literally");
  const second = await openSession("s_esc");
  const html = await (await get(PROFILE_PATH, second.jar)).text();
  assert.ok(!html.includes("<script>alert"), "the stored script is NOT rendered as markup");
  assert.ok(html.includes("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;"), "it renders escaped");

  // Partial profile: an empty submission is valid.
  seed("s_partial", "partial@example.com", "confirmed");
  const partial = await openSession("s_partial");
  const response = await post(PROFILE_PATH, { profile_consent: 1, csrf: partial.jar[PROFILE_CSRF_COOKIE] }, partial.jar);
  assert.equal(response.status, 200);
  const saved = row("SELECT * FROM waitlist_profiles WHERE signup_id='s_partial'");
  assert.ok(saved, "a fully empty (partial) profile saves");
  assert.equal(saved.display_name, null);
  assert.equal(saved.goals, null);
  assert.equal(saved.profile_copy_version, "2026-08-05.3");
}

// ---------------------------------------------------------------------------
// Atomicity: competing saves and failure injection at the save boundary.
//
// The transactional SQLite harness proves the claim-marker and rollback logic
// under competing save attempts. Real Cloudflare D1 concurrency behavior
// remains a staging-proof item and is not claimed from the local harness
// alone.
// ---------------------------------------------------------------------------
{
  // Two concurrent saves on the same authorization: exactly one writes.
  seed("s_race", "race@example.com", "confirmed");
  const race = await openSession("s_race");
  const [first, second] = await Promise.all([
    post(PROFILE_PATH, { profile_consent: 1, csrf: race.jar[PROFILE_CSRF_COOKIE], display_name: "First" }, race.jar),
    post(PROFILE_PATH, { profile_consent: 1, csrf: race.jar[PROFILE_CSRF_COOKIE], display_name: "Second" }, race.jar),
  ]);
  const statuses = [first.status, second.status].sort();
  assert.deepEqual(statuses, [200, 410], "exactly one concurrent save succeeds; the other hits the generic state");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profiles WHERE signup_id='s_race'"), 1, "one profile row");
  assert.equal(count(`SELECT COUNT(*) AS n FROM waitlist_profile_invitations WHERE signup_id='s_race' AND used_at IS NOT NULL`), 1,
    "the invitation is consumed exactly once");

  // Failure injection: the invitation-consuming statement aborts mid-batch.
  seed("s_inject", "inject@example.com", "confirmed");
  const inject = await openSession("s_inject");
  db.sqlite.exec(`CREATE TRIGGER tmp_break_profile_save BEFORE UPDATE ON waitlist_profile_invitations
    BEGIN SELECT RAISE(ABORT, 'injected_save_failure'); END`);
  let injected;
  try { injected = await post(PROFILE_PATH, { profile_consent: 1, csrf: inject.jar[PROFILE_CSRF_COOKIE], display_name: "Should roll back" }, inject.jar); }
  catch { injected = null; }
  db.sqlite.exec("DROP TRIGGER tmp_break_profile_save");
  assert.ok(!injected || injected.status >= 400, "an interrupted save never reports success");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profiles WHERE signup_id='s_inject'"), 0,
    "NO profile was written when the transaction failed");
  assert.equal(row("SELECT consumed_at FROM waitlist_profile_edit_authorizations WHERE signup_id='s_inject' ORDER BY issued_at DESC LIMIT 1").consumed_at, null,
    "the authorization was NOT consumed - never consumed without a saved profile");
  assert.equal(row("SELECT used_at FROM waitlist_profile_invitations WHERE signup_id='s_inject' ORDER BY issued_at DESC LIMIT 1").used_at, null,
    "the invitation was NOT consumed");
  // The rider can still complete the save afterwards.
  const recovered = await post(PROFILE_PATH, { profile_consent: 1, csrf: inject.jar[PROFILE_CSRF_COOKIE], display_name: "Recovered" }, inject.jar);
  assert.equal(recovered.status, 200, "the session still works after the rolled-back attempt");
  assert.equal(row("SELECT display_name FROM waitlist_profiles WHERE signup_id='s_inject'").display_name, "Recovered");
}

// ---------------------------------------------------------------------------
// The public request flow must NEVER disturb a live authenticated edit
// session. Regression for the cookie-name/path collision: visiting the
// request form used to overwrite the edit CSRF cookie, so the next form
// render carried a value the stored digest could not match - which revoked a
// perfectly valid session.
// ---------------------------------------------------------------------------
{
  seed("s_collide", "collide@example.com", "confirmed");
  const session = await openSession("s_collide");
  let jar = { ...session.jar };

  // 1. The rider opens a valid authenticated profile form.
  assert.equal((await get(PROFILE_PATH, jar)).status, 200, "form opens");

  // 2. The rider visits the public request page in the same browser.
  const requestVisit = await get(PROFILE_REQUEST_PATH, jar);
  assert.equal(requestVisit.status, 200);
  const visitCookies = cookiesFrom(requestVisit);
  assert.equal(visitCookies[PROFILE_CSRF_COOKIE], undefined, "the visit does not touch the edit CSRF cookie");
  assert.equal(visitCookies[PROFILE_COOKIE], undefined, "the visit does not touch the edit session cookie");
  // The request cookie is scoped deeper, so a real browser would not even send
  // it back to /waitlist/profile; merging it here is the worst case.
  jar = { ...jar, ...visitCookies };
  assert.equal(jar[PROFILE_CSRF_COOKIE], session.jar[PROFILE_CSRF_COOKIE], "edit CSRF value is unchanged");

  // 3. The rider returns to and reloads the authenticated form.
  const reloaded = await get(PROFILE_PATH, jar);
  assert.equal(reloaded.status, 200, "the authenticated form still renders");
  const reloadedHtml = await reloaded.text();
  const rendered = /name="csrf" value="([^"]*)"/.exec(reloadedHtml)?.[1];
  // 4. It renders with valid edit CSRF state.
  assert.equal(rendered, session.jar[PROFILE_CSRF_COOKIE], "the form carries the ORIGINAL edit CSRF value");

  // 5. The rider saves successfully.
  const saved = await post(PROFILE_PATH, { profile_consent: 1, csrf: rendered, display_name: "Not Poisoned" }, jar);
  assert.equal(saved.status, 200, "the save succeeds after visiting the public request flow");
  assert.equal(row("SELECT display_name FROM waitlist_profiles WHERE signup_id='s_collide'").display_name, "Not Poisoned");
  assert.ok(row("SELECT consumed_at FROM waitlist_profile_edit_authorizations WHERE signup_id='s_collide'").consumed_at,
    "the session was consumed by the SAVE, never revoked by the visit");
}

// ---------------------------------------------------------------------------
// Rate limiting on the edit-link request: same generic answer, no email, and
// the rider's currently usable invitation is left alone.
// ---------------------------------------------------------------------------
{
  seed("s_limit", "limit@example.com", "confirmed");
  const held = await issueProfileInvitation(db, "s_limit", "requested_edit_link");
  const heldDigestRow = () => row(`SELECT used_at, revoked_at, superseded_at FROM waitlist_profile_invitations
    WHERE signup_id='s_limit' ORDER BY issued_at DESC LIMIT 1`);
  // An isolated client bucket so this block cannot disturb the others.
  const ip = { "cf-connecting-ip": "203.0.113.9" };
  const jarOf = async () => cookiesFrom(await get(PROFILE_REQUEST_PATH));
  const bodies = [];
  for (let attempt = 0; attempt < EMAIL_SEND_LIMIT_PER_DAY; attempt += 1) {
    const jar = await jarOf();
    const response = await post(PROFILE_REQUEST_PATH,
      { csrf: jar[PROFILE_REQUEST_CSRF_COOKIE], email: "limit@example.com" }, jar, ORIGIN, ip);
    assert.equal(response.status, 202, "allowed requests answer the generic 202");
    bodies.push(await response.text());
  }
  assert.equal(sent.filter((m) => m.to === "limit@example.com").length, EMAIL_SEND_LIMIT_PER_DAY,
    "every allowed request sends exactly one email");
  const beforeSent = sent.length;
  const beforeSignups = count("SELECT COUNT(*) AS n FROM waitlist_signups");
  const beforeSignup = { ...row(`SELECT status, program_track, unsubscribed_at, resubscribed_at
    FROM waitlist_signups WHERE id='s_limit'`) };
  const beforeInvitation = { ...heldDigestRow() };
  const beforeInvitationCount = count("SELECT COUNT(*) AS n FROM waitlist_profile_invitations WHERE signup_id='s_limit'");

  // Over the limit, twice: identical answer, nothing sent, nothing changed.
  for (const _ of [1, 2]) {
    const jar = await jarOf();
    const limited = await post(PROFILE_REQUEST_PATH,
      { csrf: jar[PROFILE_REQUEST_CSRF_COOKIE], email: "limit@example.com" }, jar, ORIGIN, ip);
    assert.equal(limited.status, 202, "a rate-limited request is indistinguishable from an accepted one");
    bodies.push(await limited.text());
  }
  assert.ok(bodies.every((body) => body === bodies[0]), "identical body whether allowed or limited");
  assert.equal(sent.length, beforeSent, "a rate-limited request sends no email");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profile_invitations WHERE signup_id='s_limit'"),
    beforeInvitationCount, "no invitation is issued while limited");
  assert.deepEqual({ ...heldDigestRow() }, beforeInvitation,
    "the invitation the rider currently holds is neither superseded nor revoked");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_signups"), beforeSignups, "no signup is created");
  assert.deepEqual({ ...row(`SELECT status, program_track, unsubscribed_at, resubscribed_at
    FROM waitlist_signups WHERE id='s_limit'`) }, beforeSignup,
    "status, program_track, unsubscribed_at and resubscribed_at are untouched");
  assert.ok(held, "the pre-existing invitation was issued for this fixture");
}

// ---------------------------------------------------------------------------
// Feature gate: only the exact string "true" enables the profile. Anything
// else leaves every route non-existent, with no read, write, issuance or send.
// ---------------------------------------------------------------------------
{
  seed("s_gate", "gate@example.com", "confirmed");
  const gateToken = await issueProfileInvitation(db, "s_gate", "requested_edit_link");
  const ROUTES = [
    ["GET", `${PROFILE_PATH}/open?token=${gateToken}`],
    ["GET", PROFILE_PATH],
    ["POST", PROFILE_PATH],
    ["GET", PROFILE_REQUEST_PATH],
    ["POST", PROFILE_REQUEST_PATH],
  ];
  for (const flag of [undefined, "false", "TRUE", "1", "", "yes"]) {
    const gatedEnv = { ...env };
    if (flag === undefined) delete gatedEnv.WAITLIST_PROFILE_ENABLED;
    else gatedEnv.WAITLIST_PROFILE_ENABLED = flag;
    const before = {
      sent: sent.length,
      invitations: count("SELECT COUNT(*) AS n FROM waitlist_profile_invitations"),
      authorizations: count("SELECT COUNT(*) AS n FROM waitlist_profile_edit_authorizations"),
      profiles: count("SELECT COUNT(*) AS n FROM waitlist_profiles"),
      signups: count("SELECT COUNT(*) AS n FROM waitlist_signups"),
      buckets: count("SELECT COUNT(*) AS n FROM waitlist_rate_buckets"),
    };
    for (const [method, path] of ROUTES) {
      const response = method === "GET"
        ? await worker.fetch(new Request(`${ORIGIN}${path}`), gatedEnv)
        : await post(path, { csrf: "anything", email: "gate@example.com", display_name: "nope" }, {}, ORIGIN, {}, gatedEnv);
      assert.equal(response.status, 404,
        `${method} ${path} is unavailable when WAITLIST_PROFILE_ENABLED is ${JSON.stringify(flag)}`);
      const body = await response.text();
      assert.ok(!/Tell us about your riding|Request a profile link|Check your email/.test(body),
        "no profile surface is rendered");
    }
    assert.equal(sent.length, before.sent, "a disabled build sends nothing");
    assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profile_invitations"), before.invitations, "issues nothing");
    assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profile_edit_authorizations"), before.authorizations, "authorizes nothing");
    assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profiles"), before.profiles, "writes no profile");
    assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_signups"), before.signups, "writes no signup");
    assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_rate_buckets"), before.buckets, "touches no rate bucket");
  }
  // The same token still works once the flag is exactly "true".
  assert.equal((await get(`${PROFILE_PATH}/open?token=${gateToken}`)).status, 303,
    "the gate is the only thing that was blocking it");
}

// ---------------------------------------------------------------------------
// Retention regression. Edit authorizations FK-reference their signup and
// their invitation; without ON DELETE CASCADE the sweep threw FOREIGN KEY
// constraint failed for any rider who had ever opened a profile link, which
// aborted the whole daily job and left personal data in place past the
// published retention commitment.
// ---------------------------------------------------------------------------
{
  // (a) Unsubscribed longer than 30 days, having opened a profile link.
  seed("s_ret_unsub", "retunsub@example.com", "confirmed");
  const unsubSession = await openSession("s_ret_unsub");
  assert.equal(unsubSession.exchange.status, 303, "the rider really did open a session");
  db.sqlite.prepare(`UPDATE waitlist_signups SET status='unsubscribed',
    unsubscribed_at=datetime('now','-31 days') WHERE id='s_ret_unsub'`).run();
  db.sqlite.prepare(`INSERT INTO waitlist_profiles (id, signup_id, display_name, profile_copy_version, privacy_notice_version)
    VALUES ('p_ret_unsub','s_ret_unsub','Leaving','2026-08-05.3','2026-08-05.3')`).run();

  // (b) Confirmed past the 24-month ceiling, having opened a profile link.
  seed("s_ret_old", "retold@example.com", "confirmed");
  const oldSession = await openSession("s_ret_old");
  assert.equal(oldSession.exchange.status, 303);
  db.sqlite.prepare(`UPDATE waitlist_signups SET confirmed_at=datetime('now','-25 months') WHERE id='s_ret_old'`).run();

  // Evidence the other sweep passes still have work to do.
  db.sqlite.prepare(`INSERT INTO waitlist_email_deliveries (id, signup_id, purpose, provider_status, requested_at)
    VALUES ('d_old','s1','confirm','test_capture',datetime('now','-100 days'))`).run();
  db.sqlite.prepare(`UPDATE waitlist_signups SET attribution='{"ref":"old"}', created_at=datetime('now','-13 months')
    WHERE id='s2'`).run();
  db.sqlite.prepare(`INSERT INTO waitlist_rate_buckets (bucket_key, window_start, send_count)
    VALUES ('stale', date('now','-3 days'), 1)`).run();

  let summary;
  await assert.doesNotReject(async () => { summary = await runRetentionSweep(db); },
    "the sweep completes instead of throwing FOREIGN KEY constraint failed");

  // The unsubscribed record's profile data is gone; the suppression record stays.
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profiles WHERE signup_id='s_ret_unsub'"), 0, "profile purged");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profile_invitations WHERE signup_id='s_ret_unsub'"), 0, "invitations purged");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profile_edit_authorizations WHERE signup_id='s_ret_unsub'"), 0,
    "edit authorizations purged");
  const suppression = row(`SELECT status, email_normalized, unsubscribed_at FROM waitlist_signups WHERE id='s_ret_unsub'`);
  assert.equal(suppression.status, "unsubscribed", "the minimal suppression record SURVIVES");
  assert.ok(suppression.unsubscribed_at, "with its unsubscribe evidence intact");

  // The ceiling-aged confirmed record is purged outright, children and all.
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_signups WHERE id='s_ret_old'"), 0, "signup purged at the ceiling");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profile_invitations WHERE signup_id='s_ret_old'"), 0, "invitations purged");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profile_edit_authorizations WHERE signup_id='s_ret_old'"), 0,
    "edit authorizations purged");

  // The rest of the sweep still ran.
  assert.equal(summary.confirmed_expired >= 1, true, "ceiling purge counted");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_email_deliveries WHERE id='d_old'"), 0, "delivery-log cleanup ran");
  assert.equal(summary.delivery_logs_purged >= 1, true, "and is reported");
  assert.equal(row("SELECT attribution FROM waitlist_signups WHERE id='s2'").attribution, null, "attribution cleanup ran");
  assert.equal(summary.attribution_cleared >= 1, true, "and is reported");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_rate_buckets WHERE bucket_key='stale'"), 0, "rate-bucket cleanup ran");
  assert.equal(summary.rate_buckets_purged >= 1, true, "and is reported");

  // Spent authorizations are deleted for everyone, live ones survive their TTL.
  seed("s_ret_live", "retlive@example.com", "confirmed");
  const live = await openSession("s_ret_live");
  assert.equal(live.exchange.status, 303);
  await runRetentionSweep(db);
  assert.equal(count(`SELECT COUNT(*) AS n FROM waitlist_profile_edit_authorizations
    WHERE signup_id='s_ret_live' AND consumed_at IS NULL AND revoked_at IS NULL`), 1,
    "a LIVE authorization survives for its own short TTL");
  assert.equal(count(`SELECT COUNT(*) AS n FROM waitlist_profile_edit_authorizations
    WHERE consumed_at IS NOT NULL OR revoked_at IS NOT NULL OR expires_at <= datetime('now')`), 0,
    "every consumed, revoked or expired authorization is swept");

  assert.equal(count("SELECT COUNT(*) AS n FROM pragma_foreign_key_check()"), 0, "FK clean after the sweep");
}

// ---------------------------------------------------------------------------
// PR 3: separate profile consent. The control is unchecked by default and the
// save refuses without the affirmative action - profile answers have no lawful
// basis without it.
// ---------------------------------------------------------------------------
{
  seed("s_consent", "consent@example.com", "confirmed");
  const session = await openSession("s_consent");
  const form = await get(PROFILE_PATH, session.jar);
  const html = await form.text();
  assert.match(html, /name="profile_consent"/, "the form carries a separate profile-consent control");
  assert.ok(!/name="profile_consent"[^>]*\bchecked\b/.test(html), "it is UNCHECKED by default");
  assert.match(html, /I consent to MotoTrack using the optional rider-profile information/,
    "the exact profile-consent wording is shown");
  assert.ok(!/add me to the MotoTrack early-access waitlist/.test(html),
    "profile consent is separate from the wait-list/email-marketing consent wording");

  const refused = await post(PROFILE_PATH, { csrf: session.jar[PROFILE_CSRF_COOKIE], display_name: "No Consent" }, session.jar);
  assert.equal(refused.status, 200, "the form is re-rendered rather than the session destroyed");
  assert.match(await refused.text(), /confirm the rider-profile consent/i);
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profiles WHERE signup_id='s_consent'"), 0, "nothing written");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profile_consent_events WHERE signup_id='s_consent'"), 0,
    "no consent evidence is fabricated");
  assert.equal(row("SELECT used_at FROM waitlist_profile_invitations WHERE signup_id='s_consent'").used_at, null,
    "and nothing consumed");

  const accepted = await post(PROFILE_PATH,
    { profile_consent: 1, csrf: session.jar[PROFILE_CSRF_COOKIE], display_name: "Consented" }, session.jar);
  assert.equal(accepted.status, 200);
  const stored = row("SELECT profile_copy_version, privacy_notice_version FROM waitlist_profiles WHERE signup_id='s_consent'");
  assert.equal(stored.profile_copy_version, "2026-08-05.3");
  assert.equal(stored.privacy_notice_version, "2026-08-05.3");
  const granted = row(`SELECT event_type, profile_consent_version, privacy_notice_version, consent_method
    FROM waitlist_profile_consent_events WHERE signup_id='s_consent'`);
  assert.deepEqual({ ...granted }, { event_type: "granted", profile_consent_version: "2026-08-05.3",
    privacy_notice_version: "2026-08-05.3", consent_method: "profile_form_checkbox" });
}

// ---------------------------------------------------------------------------
// PR 3: welcome-email profile section, exact copy, four-condition CTA gate,
// and isolation of the welcome email from profile-subsystem failure.
// ---------------------------------------------------------------------------
const US_PROFILE_BODY = "Your rider profile is optional and does not affect your waitlist position, eligibility, or access timing. Share your motorcycles, track experience, and what you want MotoTrack to help you improve.";
const INTL_PROFILE_BODY = "Your rider profile is optional and does not affect your place on the international interest list or guarantee MotoTrack access or availability in your region. Share your motorcycles, track experience, and what you want MotoTrack to help you improve.";
const CTA = "Set up your rider profile";
const linkFrom = (text, marker) => text.split("\n").find((line) => line.includes(marker)) ?? "";

const joinAndConfirm = async (email, country, useEnv = env) => {
  await worker.fetch(new Request(`${ORIGIN}/api/waitlist`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ email, country, consent: true }),
  }), useEnv);
  const link = linkFrom(sent[sent.length - 1].text, "/waitlist/confirm?token=").trim();
  // GET renders the interstitial; the POST performs the confirmation.
  await worker.fetch(new Request(link, { method: "POST", headers: { origin: ORIGIN } }), useEnv);
  return sent[sent.length - 1];
};

{
  const welcome = await joinAndConfirm("us-cta@example.com", "US");
  const section = welcome.text.split("\n");
  assert.ok(section.includes("Tell us about your riding"), "exact heading");
  assert.ok(section.includes(US_PROFILE_BODY), "exact U.S. profile body");
  assert.ok(section.includes(CTA), "exact CTA text");
  assert.match(welcome.text, new RegExp(`${CTA}\\n${ORIGIN}${PROFILE_PATH}/open\\?token=`),
    "the CTA is followed by a usable protected link");
  assert.ok(!welcome.text.includes(INTL_PROFILE_BODY), "no international wording on the U.S. track");

  const intl = await joinAndConfirm("intl-cta@example.com", "DE");
  const intlLines = intl.text.split("\n");
  assert.ok(intlLines.includes("Tell us about your riding"));
  assert.ok(intlLines.includes(INTL_PROFILE_BODY), "exact international-interest profile body");
  assert.ok(intlLines.includes(CTA));
  assert.ok(!intl.text.includes(US_PROFILE_BODY), "no U.S. wording on the interest track");

  // The emailed link actually works - no broken or placeholder CTA.
  const ctaLink = linkFrom(intl.text, `${PROFILE_PATH}/open?token=`).trim();
  assert.equal((await get(ctaLink.replace(ORIGIN, ""))).status, 303, "the CTA link exchanges successfully");

  // Flag off: welcome email still sends, with NO profile section and no CTA.
  const disabledEnv = { ...env };
  delete disabledEnv.WAITLIST_PROFILE_ENABLED;
  const before = count("SELECT COUNT(*) AS n FROM waitlist_profile_invitations");
  const gated = await joinAndConfirm("gated-cta@example.com", "US", disabledEnv);
  assert.match(gated.subject, /waitlist/i, "the ordinary welcome email is still delivered");
  assert.ok(!gated.text.includes("Tell us about your riding") && !gated.text.includes(CTA),
    "no profile section and no CTA while the feature is disabled");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profile_invitations"), before,
    "and no invitation is issued");

  // Issuance failure must NOT cost the rider the welcome email.
  db.sqlite.exec("CREATE TRIGGER tmp_break_issuance BEFORE INSERT ON waitlist_profile_invitations BEGIN SELECT RAISE(ABORT, 'injected_issuance_failure'); END");
  const resilient = await joinAndConfirm("broken-cta@example.com", "US");
  db.sqlite.exec("DROP TRIGGER tmp_break_issuance");
  assert.match(resilient.subject, /waitlist/i, "the welcome email is delivered despite profile-subsystem failure");
  assert.ok(resilient.text.includes("You're on the MotoTrack early-access waitlist"), "with its ordinary content intact");
  assert.ok(!resilient.text.includes("Tell us about your riding") && !resilient.text.includes(CTA),
    "and no profile section");
  assert.ok(!resilient.text.includes("/open?token="), "no broken or placeholder CTA link");
}

// ---------------------------------------------------------------------------
// PR 3: self-service profile-consent withdrawal. Deletes the answers, records
// the minimum evidence, revokes access - and touches NOTHING on the wait-list
// record or the email consent.
// ---------------------------------------------------------------------------
{
  seed("s_del", "delete@example.com", "confirmed");
  const first = await openSession("s_del");
  await post(PROFILE_PATH, { profile_consent: 1, csrf: first.jar[PROFILE_CSRF_COOKIE], display_name: "To Be Deleted" }, first.jar);
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profiles WHERE signup_id='s_del'"), 1, "a profile exists");

  const session = await openSession("s_del");
  const formHtml = await (await get(PROFILE_PATH, session.jar)).text();
  assert.match(formHtml, /Delete my rider profile/, "the form offers the withdrawal action");

  // Unauthenticated and wrong-method attempts get nowhere.
  assert.equal((await get(`${PROFILE_PATH}/delete`)).status, 410, "no authorization, no confirmation page");
  assert.equal((await post(`${PROFILE_PATH}/delete`, { csrf: "x" })).status, 410, "no authorization, no deletion");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profiles WHERE signup_id='s_del'"), 1, "still there");

  const confirmPage = await get(`${PROFILE_PATH}/delete`, session.jar);
  assert.equal(confirmPage.status, 200);
  const confirmHtml = await confirmPage.text();
  assert.match(confirmHtml, /Delete your rider profile\?/);
  assert.match(confirmHtml, /This will withdraw your rider-profile consent and delete the profile information you provided\. It will not remove you from the MotoTrack waitlist or international interest list and will not unsubscribe you from MotoTrack email\./);
  assert.match(confirmHtml, /<button type="submit">Delete my rider profile<\/button>/);
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profiles WHERE signup_id='s_del'"), 1, "GET deletes nothing");

  const badCsrf = await post(`${PROFILE_PATH}/delete`, { csrf: "wrong" }, session.jar);
  assert.equal(badCsrf.status, 410, "CSRF is validated");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profiles WHERE signup_id='s_del'"), 1, "and nothing deleted");

  const live = await openSession("s_del");
  const before = { ...row("SELECT status, program_track, confirmed_at, unsubscribed_at, resubscribed_at, consent_copy_version, privacy_notice_version, consent_at FROM waitlist_signups WHERE id='s_del'") };
  const invitationsBefore = count("SELECT COUNT(*) AS n FROM waitlist_profile_invitations WHERE signup_id='s_del'");
  const sentBefore = sent.length;

  const deleted = await post(`${PROFILE_PATH}/delete`, { csrf: live.jar[PROFILE_CSRF_COOKIE] }, live.jar);
  assert.equal(deleted.status, 200);
  const deletedHtml = await deleted.text();
  assert.match(deletedHtml, /Your rider profile has been deleted\./);
  assert.match(deletedHtml, /Your waitlist or international-interest status and your email preferences have not changed\./);

  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profiles WHERE signup_id='s_del'"), 0, "the answers are deleted");
  const withdrawal = row(`SELECT event_type, profile_consent_version, privacy_notice_version, consent_method
    FROM waitlist_profile_consent_events WHERE signup_id='s_del' AND event_type='withdrawn'`);
  assert.deepEqual({ ...withdrawal }, { event_type: "withdrawn", profile_consent_version: "2026-08-05.3",
    privacy_notice_version: "2026-08-05.3", consent_method: "profile_delete_action" });
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profile_consent_events WHERE signup_id='s_del' AND event_type='granted'"), 1,
    "the earlier granted event SURVIVES the withdrawal");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profile_invitations WHERE signup_id='s_del' AND used_at IS NULL AND revoked_at IS NULL"), 0,
    "outstanding invitations revoked");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profile_edit_authorizations WHERE signup_id='s_del' AND consumed_at IS NULL AND revoked_at IS NULL"), 0,
    "live authorizations revoked");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profile_invitations WHERE signup_id='s_del'"),
    invitationsBefore, "NO replacement invitation is silently issued");
  assert.equal(sent.length, sentBefore, "and nothing is emailed");

  assert.deepEqual({ ...row("SELECT status, program_track, confirmed_at, unsubscribed_at, resubscribed_at, consent_copy_version, privacy_notice_version, consent_at FROM waitlist_signups WHERE id='s_del'") }, before,
    "status, track, confirmation, unsubscribe/re-subscription evidence and email consent are ALL unchanged");
  assert.equal(count("SELECT COUNT(*) AS n FROM pragma_foreign_key_check()"), 0, "FK clean");
}

// ---------------------------------------------------------------------------
// PR 3: consent lifecycle over the append-only event history. State is DERIVED
// from the latest event by event_seq - never a stored mutable flag - so
// grant -> withdraw -> grant is an ordered history, not a rewritten row.
// ---------------------------------------------------------------------------
{
  const events = (signupId) => db.sqlite.prepare(
    `SELECT event_type, profile_consent_version, privacy_notice_version, consent_method
     FROM waitlist_profile_consent_events WHERE signup_id = ? ORDER BY event_seq`).all(signupId).map((e) => ({ ...e }));

  seed("s_life", "life@example.com", "confirmed");

  // (1) First save without consent fails and records nothing.
  const first = await openSession("s_life");
  const firstHtml = await (await get(PROFILE_PATH, first.jar)).text();
  assert.match(firstHtml, /name="profile_consent"/, "no active consent -> the unchecked control is shown");
  const refused = await post(PROFILE_PATH, { csrf: first.jar[PROFILE_CSRF_COOKIE], display_name: "Nope" }, first.jar);
  assert.match(await refused.text(), /confirm the rider-profile consent/i);
  assert.equal(events("s_life").length, 0, "a refused save appends no event");

  // (2) First save WITH consent appends exactly one granted event.
  const created = await post(PROFILE_PATH,
    { profile_consent: 1, csrf: first.jar[PROFILE_CSRF_COOKIE], display_name: "Rider One" }, first.jar);
  assert.equal(created.status, 200);
  assert.deepEqual(events("s_life"), [{ event_type: "granted", profile_consent_version: "2026-08-05.3",
    privacy_notice_version: "2026-08-05.3", consent_method: "profile_form_checkbox" }],
  "exactly one granted event, with the method and both versions recorded");

  // (3) Ordinary edits append NO further granted event and ask nothing again.
  const editSession = await openSession("s_life");
  const editHtml = await (await get(PROFILE_PATH, editSession.jar)).text();
  assert.ok(!/name="profile_consent"/.test(editHtml), "active current consent -> no second checkbox");
  assert.match(editHtml, /Your rider-profile consent is active\. You can edit your profile or delete it at any time\./);
  const edited = await post(PROFILE_PATH,
    { csrf: editSession.jar[PROFILE_CSRF_COOKIE], display_name: "Rider One", primary_motorcycle: "Yamaha R3" },
    editSession.jar);
  assert.equal(edited.status, 200, "the edit saves without a consent checkbox");
  assert.equal(row("SELECT primary_motorcycle FROM waitlist_profiles WHERE signup_id='s_life'").primary_motorcycle, "Yamaha R3");
  assert.equal(events("s_life").length, 1, "editing a profile field is NOT a new consent decision");

  // (4)(5)(6)(7) Withdrawal appends withdrawn, preserves granted, deletes answers.
  const before = { ...row(`SELECT status, program_track, confirmed_at, unsubscribed_at, resubscribed_at,
    consent_copy_version, privacy_notice_version, consent_at FROM waitlist_signups WHERE id='s_life'`) };
  const withdrawSession = await openSession("s_life");
  const withdrawn = await post(`${PROFILE_PATH}/delete`, { csrf: withdrawSession.jar[PROFILE_CSRF_COOKIE] }, withdrawSession.jar);
  assert.equal(withdrawn.status, 200);
  assert.deepEqual(events("s_life").map((e) => e.event_type), ["granted", "withdrawn"], "history is appended, never rewritten");
  assert.equal(events("s_life")[1].consent_method, "profile_delete_action");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profiles WHERE signup_id='s_life'"), 0, "answers deleted");
  assert.deepEqual({ ...row(`SELECT status, program_track, confirmed_at, unsubscribed_at, resubscribed_at,
    consent_copy_version, privacy_notice_version, consent_at FROM waitlist_signups WHERE id='s_life'`) }, before,
  "signup and email state untouched by withdrawal");

  // (8)(9) Re-creation needs fresh protected access AND fresh affirmative consent.
  const again = await openSession("s_life");
  const againHtml = await (await get(PROFILE_PATH, again.jar)).text();
  assert.match(againHtml, /name="profile_consent"/, "withdrawn -> the unchecked control returns");
  assert.ok(!/Your rider-profile consent is active/.test(againHtml), "prior consent is NOT silently reactivated");
  const refusedAgain = await post(PROFILE_PATH, { csrf: again.jar[PROFILE_CSRF_COOKIE], display_name: "Back" }, again.jar);
  assert.match(await refusedAgain.text(), /confirm the rider-profile consent/i, "re-creation without consent still fails");
  assert.equal(events("s_life").length, 2, "and appends nothing");
  const recreated = await post(PROFILE_PATH,
    { profile_consent: 1, csrf: again.jar[PROFILE_CSRF_COOKIE], display_name: "Back Again" }, again.jar);
  assert.equal(recreated.status, 200);
  assert.deepEqual(events("s_life").map((e) => e.event_type), ["granted", "withdrawn", "granted"],
    "a new granted event, with every earlier event preserved");

  // (10) Ordering drives the derived state even when timestamps collide.
  const stamps = db.sqlite.prepare(
    "SELECT DISTINCT occurred_at FROM waitlist_profile_consent_events WHERE signup_id='s_life'").all();
  assert.ok(stamps.length <= 3, "these events can and do share whole-second timestamps");
  const finalWithdraw = await openSession("s_life");
  await post(`${PROFILE_PATH}/delete`, { csrf: finalWithdraw.jar[PROFILE_CSRF_COOKIE] }, finalWithdraw.jar);
  assert.deepEqual(events("s_life").map((e) => e.event_type), ["granted", "withdrawn", "granted", "withdrawn"],
    "a legitimate grant/withdraw/grant/withdraw history");
  const afterAll = await openSession("s_life");
  assert.match(await (await get(PROFILE_PATH, afterAll.jar)).text(), /name="profile_consent"/,
    "latest event is withdrawn -> no active consent, derived by event_seq not by timestamp");

  // (11) An existing event cannot be updated - the database refuses.
  assert.throws(() => db.sqlite.prepare(
    "UPDATE waitlist_profile_consent_events SET event_type='granted' WHERE signup_id='s_life'").run(),
  /append-only/, "consent events are immutable");
  assert.throws(() => db.sqlite.prepare(
    "UPDATE waitlist_profile_consent_events SET occurred_at='1999-01-01 00:00:00' WHERE signup_id='s_life'").run(),
  /append-only/, "timestamps cannot be rewritten either");
  assert.deepEqual(events("s_life").map((e) => e.event_type), ["granted", "withdrawn", "granted", "withdrawn"],
    "history survives the attempts intact");

  // No application path deletes an individual consent event.
  const serviceSource = readFileSync(join(import.meta.dirname, "..", "src", "waitlist-profile-service.js"), "utf8");
  const authSource = readFileSync(join(import.meta.dirname, "..", "src", "waitlist-profile-auth.js"), "utf8");
  const workerSource = readFileSync(join(import.meta.dirname, "..", "src", "waitlist-worker.js"), "utf8");
  for (const [name, source] of [["service", serviceSource], ["auth", authSource], ["worker", workerSource]]) {
    assert.ok(!/DELETE\s+FROM\s+waitlist_profile_consent_events/i.test(source),
      `the ${name} layer has no individual consent-event deletion path`);
    assert.ok(!/UPDATE\s+waitlist_profile_consent_events/i.test(source),
      `the ${name} layer never updates a consent event`);
  }

  // (12)(13) History is removed ONLY when the parent signup is purged, and the
  // purge stays foreign-key clean.
  assert.ok(events("s_life").length > 0, "history exists before the purge");
  db.sqlite.prepare("UPDATE waitlist_signups SET confirmed_at = datetime('now','-25 months') WHERE id='s_life'").run();
  await runRetentionSweep(db);
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_signups WHERE id='s_life'"), 0, "the signup reached its ceiling");
  assert.equal(events("s_life").length, 0, "consent history cascaded away with its parent");
  assert.equal(count("SELECT COUNT(*) AS n FROM pragma_foreign_key_check()"), 0, "FK clean after the purge");
}

// ---------------------------------------------------------------------------
// PR-scope containment and application-surface token absence.
// ---------------------------------------------------------------------------
{
  const workerSource = readFileSync(join(import.meta.dirname, "..", "src", "waitlist-worker.js"), "utf8");
  const authSource = readFileSync(join(import.meta.dirname, "..", "src", "waitlist-profile-auth.js"), "utf8");
  assert.ok(!/console\.(log|info|warn|error|debug)/.test(authSource), "the authorization module logs nothing");
  // The welcome email and the confirmation-success page must carry NO profile
  // link or CTA in PR 2 (that is PR 3, gated behind the notice bump).
  // PR 3 adds the welcome-email CTA. The confirmation-success page must STILL
  // carry none: the owner rule is welcome-email invitation ONLY.
  const confirmedPageSource = workerSource.slice(workerSource.indexOf("function confirmedPage"),
    workerSource.indexOf("async function handleUnsubscribe"));
  assert.ok(!new RegExp("waitlist\/profile|Tell us about your riding|Set up your rider profile").test(confirmedPageSource),
    "the confirmation-success page still has no profile CTA");
  const wrangler = readFileSync(join(import.meta.dirname, "..", "wrangler.jsonc"), "utf8");
  const config = JSON.parse(wrangler.split(/\r?\n/).map((line) => line.replace(/^\s*\/\/.*$/, "")).join("\n"));
  const { env: environments, ...production } = config;
  assert.equal("d1_databases" in production, false, "no production binding entered PR 2");
  assert.ok(!wrangler.includes("mototrack_waitlist_production"), "no production resource name");
  // The binding invariant: PRODUCTION must never define or enable the profile
  // flag. Staging carries it deliberately for the isolated proof, so the old
  // "absent from every environment" assertion is obsolete - but the production
  // half of it is the part that actually protects anything, and it stays.
  assert.equal("WAITLIST_PROFILE_ENABLED" in (production.vars ?? {}), false,
    "production configuration must not define WAITLIST_PROFILE_ENABLED");
  assert.equal(JSON.stringify(production).includes("WAITLIST_PROFILE_ENABLED"), false,
    "and it appears nowhere else in the production block");
  assert.equal(environments?.staging?.vars?.WAITLIST_PROFILE_ENABLED, "true",
    "staging enables the profile with exactly the string \"true\"");
  assert.equal(count("SELECT COUNT(*) AS n FROM pragma_foreign_key_check()"), 0, "FK clean");
}

console.log("waitlist-profile-routes.test.js passed");
