import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import worker, { runRetentionSweep, EMAIL_SEND_LIMIT_PER_DAY } from "../src/waitlist-worker.js";
import { issueProfileInvitation } from "../src/waitlist-profile-service.js";
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
  "0004_rider_profiles.sql", "0005_profile_edit_authorizations.sql"]) {
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
  const bad = await post(PROFILE_PATH, { csrf: jar[PROFILE_CSRF_COOKIE], goals: "x".repeat(1001) }, jar);
  assert.equal(bad.status, 200, "a validation failure re-renders the form");
  assert.match(await bad.text(), /limited to 1000 characters/);
  assert.equal(row("SELECT used_at FROM waitlist_profile_invitations WHERE token_digest IS NOT NULL AND signup_id='s1' ORDER BY issued_at DESC LIMIT 1").used_at, null,
    "a failed save consumes NOTHING");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profiles WHERE signup_id='s1'"), 0, "and writes nothing");

  const saved = await post(PROFILE_PATH, {
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
  const replay = await post(PROFILE_PATH, { csrf: jar[PROFILE_CSRF_COOKIE], display_name: "Replayed" }, jar);
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
    const attempt = await post(PROFILE_PATH, { csrf: jar[PROFILE_CSRF_COOKIE], display_name: "Should Not Save" }, jar);
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
  await post(PROFILE_PATH, { csrf: a.jar[PROFILE_CSRF_COOKIE], display_name: "A only" }, a.jar);
  assert.equal(row("SELECT display_name FROM waitlist_profiles WHERE signup_id='s_a'").display_name, "A only");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profiles WHERE signup_id='s_b'"), 0, "B untouched by A's session");
  // Mixing A's CSRF with B's cookie fails.
  const mixed = await post(PROFILE_PATH, { csrf: a.jar[PROFILE_CSRF_COOKIE], display_name: "Cross" }, b.jar);
  assert.equal(mixed.status, 410, "a mismatched CSRF value is refused");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profiles WHERE signup_id='s_b'"), 0);

  // Missing CSRF, foreign origin.
  seed("s_c", "c@example.com", "confirmed");
  const c = await openSession("s_c");
  assert.equal((await post(PROFILE_PATH, { display_name: "No CSRF" }, c.jar)).status, 410, "missing CSRF refused");
  const d = await openSession("s_c");
  assert.equal((await post(PROFILE_PATH, { csrf: d.jar[PROFILE_CSRF_COOKIE], display_name: "Foreign" }, d.jar,
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
  await post(PROFILE_PATH, { csrf: first.jar[PROFILE_CSRF_COOKIE], goals: payload }, first.jar);
  assert.equal(row("SELECT goals FROM waitlist_profiles WHERE signup_id='s_esc'").goals, payload, "stored literally");
  const second = await openSession("s_esc");
  const html = await (await get(PROFILE_PATH, second.jar)).text();
  assert.ok(!html.includes("<script>alert"), "the stored script is NOT rendered as markup");
  assert.ok(html.includes("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;"), "it renders escaped");

  // Partial profile: an empty submission is valid.
  seed("s_partial", "partial@example.com", "confirmed");
  const partial = await openSession("s_partial");
  const response = await post(PROFILE_PATH, { csrf: partial.jar[PROFILE_CSRF_COOKIE] }, partial.jar);
  assert.equal(response.status, 200);
  const saved = row("SELECT * FROM waitlist_profiles WHERE signup_id='s_partial'");
  assert.ok(saved, "a fully empty (partial) profile saves");
  assert.equal(saved.display_name, null);
  assert.equal(saved.goals, null);
  assert.equal(saved.profile_copy_version, "2026-08-05.3");
}

// ---------------------------------------------------------------------------
// Atomicity: concurrency and failure injection at the save boundary.
// ---------------------------------------------------------------------------
{
  // Two concurrent saves on the same authorization: exactly one writes.
  seed("s_race", "race@example.com", "confirmed");
  const race = await openSession("s_race");
  const [first, second] = await Promise.all([
    post(PROFILE_PATH, { csrf: race.jar[PROFILE_CSRF_COOKIE], display_name: "First" }, race.jar),
    post(PROFILE_PATH, { csrf: race.jar[PROFILE_CSRF_COOKIE], display_name: "Second" }, race.jar),
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
  try { injected = await post(PROFILE_PATH, { csrf: inject.jar[PROFILE_CSRF_COOKIE], display_name: "Should roll back" }, inject.jar); }
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
  const recovered = await post(PROFILE_PATH, { csrf: inject.jar[PROFILE_CSRF_COOKIE], display_name: "Recovered" }, inject.jar);
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
  const saved = await post(PROFILE_PATH, { csrf: rendered, display_name: "Not Poisoned" }, jar);
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
// PR-scope containment and application-surface token absence.
// ---------------------------------------------------------------------------
{
  const workerSource = readFileSync(join(import.meta.dirname, "..", "src", "waitlist-worker.js"), "utf8");
  const authSource = readFileSync(join(import.meta.dirname, "..", "src", "waitlist-profile-auth.js"), "utf8");
  assert.ok(!/console\.(log|info|warn|error|debug)/.test(authSource), "the authorization module logs nothing");
  // The welcome email and the confirmation-success page must carry NO profile
  // link or CTA in PR 2 (that is PR 3, gated behind the notice bump).
  const welcomeEmailSource = workerSource.slice(workerSource.indexOf("async function sendWelcomeEmail"),
    workerSource.indexOf("async function tokenRow"));
  assert.ok(!new RegExp("waitlist\/profile|Tell us about your riding").test(welcomeEmailSource),
    "the welcome email contains no profile link or CTA");
  const confirmedPageSource = workerSource.slice(workerSource.indexOf("function confirmedPage"),
    workerSource.indexOf("async function handleUnsubscribe"));
  assert.ok(!new RegExp("waitlist\/profile|Tell us about your riding").test(confirmedPageSource),
    "the confirmation-success page still has no profile CTA");
  assert.ok(!workerSource.includes("issueProfileInvitation("), "no invitation is issued from the welcome email in PR 2");
  const wrangler = readFileSync(join(import.meta.dirname, "..", "wrangler.jsonc"), "utf8");
  const config = JSON.parse(wrangler.split(/\r?\n/).map((line) => line.replace(/^\s*\/\/.*$/, "")).join("\n"));
  const { env: environments, ...production } = config;
  assert.equal("d1_databases" in production, false, "no production binding entered PR 2");
  assert.ok(!wrangler.includes("mototrack_waitlist_production"), "no production resource name");
  // The feature flag ships in NO configuration here - not production, and not
  // staging either: staging may only be enabled after privacy notice
  // 2026-08-05.3 is actually deployed, and production is a separately
  // authorized runbook step.
  assert.ok(!wrangler.includes("WAITLIST_PROFILE_ENABLED"),
    "the profile feature flag is absent from every environment in wrangler.jsonc");
  assert.equal("vars" in production && "WAITLIST_PROFILE_ENABLED" in (production.vars ?? {}), false,
    "the profile feature flag is absent from production configuration");
  assert.equal(count("SELECT COUNT(*) AS n FROM pragma_foreign_key_check()"), 0, "FK clean");
}

console.log("waitlist-profile-routes.test.js passed");
