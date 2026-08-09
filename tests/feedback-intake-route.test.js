import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import worker from "../src/waitlist-worker.js";
import { APP_VERSION } from "../src/app-version.js";

// MotoTrack Feedback #56 PR 2: public intake through the REAL worker fetch
// handler. Fail-closed feature gate, #45 request-source gate, feedback-scoped
// double-submit CSRF, feedback-namespaced rate limit, success only after a
// durable insert. No Experience Pulse, admin, GitHub, or email here.

class LocalD1 {
  constructor() { this.sqlite = new DatabaseSync(":memory:"); this.sqlite.exec("PRAGMA foreign_keys = ON"); }
  prepare(sql) {
    const sqlite = this.sqlite;
    return { bind(...values) { return {
      all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
      first: async () => sqlite.prepare(sql).get(...values) || null,
      run: async () => (/^\s*SELECT\b/i.test(sql)
        ? { success: true, results: sqlite.prepare(sql).all(...values), meta: { changes: 0 } }
        : { success: true, meta: sqlite.prepare(sql).run(...values) }),
    }; } };
  }
}

const MIGRATIONS = [
  "0001_waitlist.sql", "0002_program_track.sql", "0003_resubscription_evidence.sql",
  "0004_rider_profiles.sql", "0005_profile_edit_authorizations.sql",
  "0006_profile_consent_events.sql", "0007_profile_invitation_batches.sql",
  "0008_beta_approvals.sql", "0009_feedback.sql",
];
const freshDb = () => {
  const db = new LocalD1();
  for (const m of MIGRATIONS) db.sqlite.exec(readFileSync(join(import.meta.dirname, "..", "migrations", m), "utf8"));
  return db;
};

const ORIGIN = "https://mototrack.app";
const sent = [];
const makeEnv = (db, over = {}) => ({
  WAITLIST_DB: db,
  WAITLIST_RATE_PEPPER: "test-pepper",
  FEEDBACK_ENABLED: "true",
  WAITLIST_EMAIL_TEST: { async send(m) { sent.push(m); return { status: "test_capture" }; } },
  ASSETS: { fetch: async () => new Response("static", { status: 404 }) },
  ...over,
});
const feedbackCount = (db) => db.sqlite.prepare("SELECT COUNT(*) AS n FROM feedback_submissions").get().n;

// Fetch a CSRF token + cookie from the GET endpoint.
async function mintCsrf(env, ip = "10.0.0.9") {
  const res = await worker.fetch(new Request(`${ORIGIN}/api/feedback`, {
    method: "GET", headers: { accept: "application/json", "cf-connecting-ip": ip },
  }), env);
  const setCookie = res.headers.get("set-cookie") ?? "";
  const cookie = /__Secure-mototrack_feedback_csrf=([^;]+)/.exec(setCookie)?.[1] ?? null;
  const csrf = res.status === 200 ? (await res.json()).csrf : null;
  return { res, cookie, csrf };
}

// POST feedback with full control over headers/body.
function postFeedback(env, { cookie, csrf, body = "some feedback", contactEmail, sourceSection, sourceRoute,
  appVersion, headers = {}, ip = "10.0.0.9" } = {}) {
  const payload = { body, csrf };
  if (contactEmail !== undefined) payload.contactEmail = contactEmail;
  if (sourceSection !== undefined) payload.sourceSection = sourceSection;
  if (sourceRoute !== undefined) payload.sourceRoute = sourceRoute;
  if (appVersion !== undefined) { payload.appVersion = appVersion; payload.app_version = appVersion; }
  return worker.fetch(new Request(`${ORIGIN}/api/feedback`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      "cf-connecting-ip": ip,
      ...(cookie ? { cookie: `__Secure-mototrack_feedback_csrf=${cookie}` } : {}),
      ...headers,
    },
    body: JSON.stringify(payload),
  }), env);
}

// ---------------------------------------------------------------------------
// Feature gate: fail-closed, persist nothing when absent/false/wrong-case.
// ---------------------------------------------------------------------------
for (const flag of [undefined, "false", "TRUE", "1", "yes"]) {
  const db = freshDb();
  const env = makeEnv(db, { FEEDBACK_ENABLED: flag });
  const token = await mintCsrf(env);
  assert.notEqual(token.res.status, 200, `GET token refused when flag=${flag}`);
  const post = await postFeedback(env, { cookie: "x".repeat(43), csrf: "x".repeat(43) });
  assert.equal(post.status, 503, `POST refused when flag=${flag}`);
  assert.equal(feedbackCount(db), 0, `nothing persisted when flag=${flag}`);
}

// No DB binding -> fail closed even with the flag on.
{
  const post = await worker.fetch(new Request(`${ORIGIN}/api/feedback`, {
    method: "POST", headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ body: "hi", csrf: "x" }),
  }), { FEEDBACK_ENABLED: "true", ASSETS: makeEnv(freshDb()).ASSETS });
  assert.equal(post.status, 503, "no DB -> fail closed");
}

// ---------------------------------------------------------------------------
// GET mints a token + cookie and creates NO feedback. GET cannot mutate.
// ---------------------------------------------------------------------------
{
  const db = freshDb();
  const env = makeEnv(db);
  const { res, cookie, csrf } = await mintCsrf(env);
  assert.equal(res.status, 200);
  assert.ok(cookie && cookie.length >= 20 && csrf === cookie, "GET returns the token and sets the matching cookie");
  const sc = res.headers.get("set-cookie");
  assert.match(sc, /Path=\/api\/feedback/);
  assert.match(sc, /HttpOnly/); assert.match(sc, /Secure/); assert.match(sc, /SameSite=Strict/);
  assert.ok(!/domain=/i.test(sc), "no Domain attribute");
  assert.equal(feedbackCount(db), 0, "GET created no feedback");
}

// ---------------------------------------------------------------------------
// Happy path: durable insert, success only after it, server-stamped version.
// ---------------------------------------------------------------------------
{
  const db = freshDb();
  const env = makeEnv(db);
  const { cookie, csrf } = await mintCsrf(env);
  const res = await postFeedback(env, {
    cookie, csrf, body: "  Tires tab needs a delta view  ", sourceSection: "tires",
    sourceRoute: "/log/#tires", appVersion: "9.9.9-evil",
  });
  assert.equal(res.status, 201);
  assert.equal((await res.json()).message, "Thanks for the feedback.");
  assert.equal(feedbackCount(db), 1);
  const row = db.sqlite.prepare("SELECT * FROM feedback_submissions").get();
  assert.equal(row.body, "Tires tab needs a delta view", "trimmed, stored literally");
  assert.equal(row.source_section, "tires");
  assert.equal(row.source_route, "/log/#tires");
  assert.equal(row.app_version, APP_VERSION, "server-stamped canonical version - client override ignored");
  assert.equal(row.triage_state, "new");
  assert.ok(row.created_at, "server-authoritative timestamp");
}

// ---------------------------------------------------------------------------
// Request-source (#45): real Chrome shape works; cross-site/foreign rejected.
// ---------------------------------------------------------------------------
{
  const db = freshDb();
  const env = makeEnv(db);
  const { cookie, csrf } = await mintCsrf(env);
  // The real-browser same-origin form shape under Referrer-Policy: no-referrer.
  const chrome = await postFeedback(env, { cookie, csrf, headers: { origin: "null", "sec-fetch-site": "same-origin" } });
  assert.equal(chrome.status, 201, "Origin: null + Sec-Fetch-Site: same-origin works");

  const fresh = () => mintCsrf(env);
  const xsite = await postFeedback(env, { ...(await fresh()), headers: { "sec-fetch-site": "cross-site" } });
  assert.equal(xsite.status, 403, "cross-site refused");
  const ssite = await postFeedback(env, { ...(await fresh()), headers: { "sec-fetch-site": "same-site" } });
  assert.equal(ssite.status, 403, "same-site refused");
  const none = await postFeedback(env, { ...(await fresh()), headers: { "sec-fetch-site": "none" } });
  assert.equal(none.status, 403, "none refused");
  // No Sec-Fetch-Site: fall back to Origin. Foreign origin refused; a real
  // literal "null" Origin without the header is not generally trusted.
  const c1 = await fresh();
  const foreign = await worker.fetch(new Request(`${ORIGIN}/api/feedback`, {
    method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example", cookie: `__Secure-mototrack_feedback_csrf=${c1.cookie}` },
    body: JSON.stringify({ body: "x", csrf: c1.csrf }),
  }), env);
  assert.equal(foreign.status, 403, "foreign Origin without Sec-Fetch-Site refused");
  // No Origin and no Sec-Fetch-Site: tolerated (same-origin non-browser).
  const c2 = await fresh();
  const bare = await worker.fetch(new Request(`${ORIGIN}/api/feedback`, {
    method: "POST", headers: { "content-type": "application/json", cookie: `__Secure-mototrack_feedback_csrf=${c2.cookie}` },
    body: JSON.stringify({ body: "x", csrf: c2.csrf }),
  }), env);
  assert.equal(bare.status, 201, "absent Origin + absent Sec-Fetch-Site tolerated");
}

// ---------------------------------------------------------------------------
// CSRF double-submit: missing/mismatched refused; matched pair accepted.
// ---------------------------------------------------------------------------
{
  const db = freshDb();
  const env = makeEnv(db);
  const { cookie, csrf } = await mintCsrf(env);
  assert.equal((await postFeedback(env, { csrf })).status, 403, "no cookie -> refused");
  assert.equal((await postFeedback(env, { cookie })).status, 403, "no body token -> refused");
  assert.equal((await postFeedback(env, { cookie, csrf: "wrong-wrong-wrong-wrong-wrong-wrong-1234" })).status, 403, "mismatch -> refused");
  const before = feedbackCount(db);
  assert.equal((await postFeedback(env, { cookie, csrf })).status, 201, "matched pair -> accepted");
  assert.equal(feedbackCount(db), before + 1);
}

// ---------------------------------------------------------------------------
// GET may not mutate; other methods rejected.
// ---------------------------------------------------------------------------
{
  const db = freshDb();
  const env = makeEnv(db);
  await mintCsrf(env);
  assert.equal(feedbackCount(db), 0, "GET never writes");
  const put = await worker.fetch(new Request(`${ORIGIN}/api/feedback`, { method: "PUT" }), env);
  assert.equal(put.status, 405);
}

// ---------------------------------------------------------------------------
// Context capture: each originating tab is stored verbatim; a FUTURE canonical
// tab is accepted with no feedback-specific allowlist.
// ---------------------------------------------------------------------------
{
  const db = freshDb();
  const env = makeEnv(db);
  for (const section of ["tires", "review", "hydration"]) {
    const { cookie, csrf } = await mintCsrf(env);
    const res = await postFeedback(env, { cookie, csrf, body: `from ${section}`, sourceSection: section });
    assert.equal(res.status, 201);
  }
  const stored = db.sqlite.prepare("SELECT source_section FROM feedback_submissions ORDER BY created_at").all().map((r) => r.source_section);
  assert.deepEqual(new Set(stored), new Set(["tires", "review", "hydration"]), "future tab 'hydration' accepted, no allowlist");
}

// ---------------------------------------------------------------------------
// Optional email: valid without email succeeds; malformed email rejected 400.
// Body-like markup is stored literally (escaped only at render, later PRs).
// ---------------------------------------------------------------------------
{
  const db = freshDb();
  const env = makeEnv(db);
  let c = await mintCsrf(env);
  assert.equal((await postFeedback(env, { cookie: c.cookie, csrf: c.csrf, body: "no email here" })).status, 201);
  c = await mintCsrf(env);
  const bad = await postFeedback(env, { cookie: c.cookie, csrf: c.csrf, body: "b", contactEmail: "not-an-email" });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).code, "invalid_email");
  c = await mintCsrf(env);
  const good = await postFeedback(env, { cookie: c.cookie, csrf: c.csrf, body: "b", contactEmail: " Rider@Example.COM " });
  assert.equal(good.status, 201);
  assert.equal(db.sqlite.prepare("SELECT contact_email FROM feedback_submissions WHERE contact_email IS NOT NULL").get().contact_email, "rider@example.com");
  c = await mintCsrf(env);
  await postFeedback(env, { cookie: c.cookie, csrf: c.csrf, body: "literal <b>markup</b> & text kept" });
  assert.ok(db.sqlite.prepare("SELECT 1 AS n FROM feedback_submissions WHERE body = 'literal <b>markup</b> & text kept'").get(), "markup-like text stored literally, not stripped");
}

// ---------------------------------------------------------------------------
// Rate-limit isolation: feedback budget is independent from waitlist budget,
// both directions.
// ---------------------------------------------------------------------------
{
  const db = freshDb();
  const env = makeEnv(db);
  const join = (ip, email) => worker.fetch(new Request(`${ORIGIN}/api/waitlist`, {
    method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, "cf-connecting-ip": ip },
    body: JSON.stringify({ email, country: "US", consent: true }),
  }), env);

  // Direction 1: exhaust the feedback budget on ip1 (limit 5/hour), then the
  // FULL waitlist budget (limit 10/hour) must still be available - proving
  // feedback spent none of it. Under a shared namespace only 5 joins would
  // create rows; isolation yields all 10. (This is the discriminating check:
  // it fails if feedback reuses the waitlist client namespace.)
  for (let i = 0; i < 5; i += 1) {
    const c = await mintCsrf(env, "10.0.0.1");
    assert.equal((await postFeedback(env, { cookie: c.cookie, csrf: c.csrf, body: `fb ${i}`, ip: "10.0.0.1" })).status, 201, `feedback ${i} ok`);
  }
  const c6 = await mintCsrf(env, "10.0.0.1");
  assert.equal((await postFeedback(env, { cookie: c6.cookie, csrf: c6.csrf, body: "over", ip: "10.0.0.1" })).status, 429, "6th feedback rate-limited");
  for (let i = 0; i < 10; i += 1) await join("10.0.0.1", `rider1_${i}@example.com`);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM waitlist_signups WHERE email_normalized LIKE 'rider1_%'").get().n, 10,
    "the full waitlist budget (10) was available despite the exhausted feedback budget");

  // Direction 2: spend the whole feedback-equivalent count of waitlist joins on
  // ip2, then the feedback budget must still be fully intact (5 succeed, 6th
  // rate-limited). Under a shared namespace the first feedback would already be
  // blocked.
  for (let i = 0; i < 5; i += 1) await join("10.0.0.2", `rider2_${i}@example.com`);
  for (let i = 0; i < 5; i += 1) {
    const c = await mintCsrf(env, "10.0.0.2");
    assert.equal((await postFeedback(env, { cookie: c.cookie, csrf: c.csrf, body: `fb2 ${i}`, ip: "10.0.0.2" })).status, 201, `feedback ${i} intact after waitlist activity`);
  }
  const c2over = await mintCsrf(env, "10.0.0.2");
  assert.equal((await postFeedback(env, { cookie: c2over.cookie, csrf: c2over.csrf, body: "over2", ip: "10.0.0.2" })).status, 429, "feedback budget was exactly 5, untouched by waitlist");
}

// ---------------------------------------------------------------------------
// A failed D1 insert never returns success.
// ---------------------------------------------------------------------------
{
  const db = freshDb();
  const env = makeEnv(db);
  const { cookie, csrf } = await mintCsrf(env);
  const realPrepare = db.prepare.bind(db);
  db.prepare = (sql) => {
    if (/INSERT INTO feedback_submissions/i.test(sql)) {
      return { bind: () => ({ run: async () => { throw new Error("d1 down"); } }) };
    }
    return realPrepare(sql);
  };
  const res = await postFeedback(env, { cookie, csrf, body: "will fail to store" });
  db.prepare = realPrepare;
  assert.equal(res.status, 503, "storage failure is not a success");
  assert.notEqual(res.status, 201);
  assert.equal(feedbackCount(db), 0, "no row on failed insert");
  const bodyJson = await res.json();
  assert.ok(!JSON.stringify(bodyJson).includes("d1 down"), "no internal error detail leaked");
}

// ---------------------------------------------------------------------------
// No email is sent as a side effect of feedback submission.
// ---------------------------------------------------------------------------
{
  sent.length = 0;
  const db = freshDb();
  const env = makeEnv(db);
  const { cookie, csrf } = await mintCsrf(env);
  await postFeedback(env, { cookie, csrf, body: "feedback with contact", contactEmail: "rider@example.com" });
  assert.equal(sent.length, 0, "feedback never invokes the email provider");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM waitlist_email_deliveries").get().n, 0);
}

// ---------------------------------------------------------------------------
// Structural: the feedback rate namespace is wired and distinct; the client
// captures section BEFORE opening and never stamps "feedback".
// ---------------------------------------------------------------------------
{
  const worker = readFileSync(join(import.meta.dirname, "..", "src", "waitlist-worker.js"), "utf8");
  assert.ok(worker.includes("FEEDBACK_RATE_BUCKET_PREFIX"), "worker uses the reserved feedback namespace");
  const appJs = readFileSync(join(import.meta.dirname, "..", "public", "app.js"), "utf8");
  assert.ok(appJs.includes('.tab[aria-selected="true"]'), "client reads the canonical active tab");
  assert.ok(!/sourceSection\s*[:=]\s*["']feedback["']/.test(appJs), "client never stamps source_section='feedback'");
  const html = readFileSync(join(import.meta.dirname, "..", "public", "log", "index.html"), "utf8");
  assert.ok(html.includes("How can we make MotoTrack better?"), "exact rider prompt");
  assert.ok(html.includes("Send feedback"), "exact submit label");
  assert.ok(html.includes("connect-src 'self'"), "CSP allows the same-origin feedback fetch");
}

console.log("feedback-intake-route.test.js passed");
