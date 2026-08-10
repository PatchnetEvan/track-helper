import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import worker from "../src/waitlist-worker.js";
import { APP_VERSION } from "../src/app-version.js";

// MotoTrack Experience Pulse #55 PR3A: public intake through the REAL worker
// fetch handler. Dedicated fail-closed feature gate (EXPERIENCE_PULSE_ENABLED),
// #45 request-source gate, pulse-scoped double-submit CSRF, a pulse-namespaced
// rate limit isolated from waitlist AND feedback, and success only after a
// durable insert. No admin, GitHub, or email here.

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
  "0008_beta_approvals.sql", "0009_feedback.sql", "0010_experience_pulse.sql",
];
const freshDb = () => {
  const db = new LocalD1();
  for (const m of MIGRATIONS) db.sqlite.exec(readFileSync(join(import.meta.dirname, "..", "migrations", m), "utf8"));
  return db;
};

const ORIGIN = "https://mototrack.app";
const PULSE_COOKIE = "__Secure-mototrack_pulse_csrf";
const makeEnv = (db, over = {}) => ({
  WAITLIST_DB: db,
  WAITLIST_RATE_PEPPER: "test-pepper",
  EXPERIENCE_PULSE_ENABLED: "true",
  FEEDBACK_ENABLED: "true",
  // A capturing email provider so the waitlist join used by the cross-namespace
  // isolation check actually persists signups (it fails closed without one).
  WAITLIST_EMAIL_TEST: { async send() { return { status: "test_capture" }; } },
  ASSETS: { fetch: async () => new Response("static", { status: 404 }) },
  ...over,
});
const pulseCount = (db) => db.sqlite.prepare("SELECT COUNT(*) AS n FROM feedback_experience_pulses").get().n;

async function mintPulseCsrf(env, ip = "10.0.0.9") {
  const res = await worker.fetch(new Request(`${ORIGIN}/api/experience-pulse`, {
    method: "GET", headers: { accept: "application/json", "cf-connecting-ip": ip },
  }), env);
  const setCookie = res.headers.get("set-cookie") ?? "";
  const cookie = new RegExp(`${PULSE_COOKIE}=([^;]+)`).exec(setCookie)?.[1] ?? null;
  const csrf = res.status === 200 ? (await res.json()).csrf : null;
  return { res, cookie, csrf };
}

function postPulse(env, { cookie, csrf, value = 3, sourceSection, sourceRoute, actionContext, feedbackId,
  appVersion, headers = {}, ip = "10.0.0.9" } = {}) {
  const payload = { csrf };
  if (value !== undefined) payload.value = value;
  if (sourceSection !== undefined) payload.sourceSection = sourceSection;
  if (sourceRoute !== undefined) payload.sourceRoute = sourceRoute;
  if (actionContext !== undefined) payload.actionContext = actionContext;
  if (feedbackId !== undefined) payload.feedbackId = feedbackId;
  if (appVersion !== undefined) { payload.appVersion = appVersion; payload.app_version = appVersion; }
  return worker.fetch(new Request(`${ORIGIN}/api/experience-pulse`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      "cf-connecting-ip": ip,
      ...(cookie ? { cookie: `${PULSE_COOKIE}=${cookie}` } : {}),
      ...headers,
    },
    body: JSON.stringify(payload),
  }), env);
}

// Waitlist join (no CSRF) + feedback POST, for cross-namespace isolation.
const joinWaitlist = (env, ip, email) => worker.fetch(new Request(`${ORIGIN}/api/waitlist`, {
  method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, "cf-connecting-ip": ip },
  body: JSON.stringify({ email, country: "US", consent: true }),
}), env);
async function mintFeedbackCsrf(env, ip) {
  const res = await worker.fetch(new Request(`${ORIGIN}/api/feedback`, {
    method: "GET", headers: { accept: "application/json", "cf-connecting-ip": ip },
  }), env);
  const cookie = /__Secure-mototrack_feedback_csrf=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1] ?? null;
  return { cookie, csrf: res.status === 200 ? (await res.json()).csrf : null };
}
const postFeedback = (env, { cookie, csrf, ip }) => worker.fetch(new Request(`${ORIGIN}/api/feedback`, {
  method: "POST",
  headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", "cf-connecting-ip": ip, cookie: `__Secure-mototrack_feedback_csrf=${cookie}` },
  body: JSON.stringify({ body: "fb", csrf }),
}), env);

// ---------------------------------------------------------------------------
// Feature gate: a flag that is anything but exactly "true" is a non-disclosing
// 404 for BOTH the GET bootstrap and the POST; no CSRF is minted, nothing
// persists. This keeps the pulse surface hidden in a build without the flag,
// and proves the gate never rides on FEEDBACK_ENABLED / the DB alone.
// ---------------------------------------------------------------------------
for (const flag of [undefined, "false", "TRUE", "1", "yes"]) {
  const db = freshDb();
  const env = makeEnv(db, { EXPERIENCE_PULSE_ENABLED: flag });
  const token = await mintPulseCsrf(env);
  assert.equal(token.res.status, 404, `GET is a non-disclosing 404 when flag=${flag}`);
  assert.equal(token.cookie, null, `no CSRF cookie minted when flag=${flag}`);
  assert.equal(token.csrf, null, `no CSRF token returned when flag=${flag}`);
  const post = await postPulse(env, { cookie: "x".repeat(43), csrf: "x".repeat(43) });
  assert.equal(post.status, 404, `POST is a non-disclosing 404 when flag=${flag}`);
  assert.equal(pulseCount(db), 0, `nothing persisted when flag=${flag}`);
}

// Enabled build: GET succeeds and mints the pulse CSRF; a valid POST persists.
{
  const db = freshDb();
  const env = makeEnv(db);
  const { res, cookie, csrf } = await mintPulseCsrf(env);
  assert.equal(res.status, 200, "enabled -> GET succeeds");
  assert.ok(cookie && csrf === cookie, "enabled -> pulse CSRF minted");
  const post = await postPulse(env, { cookie, csrf, value: 2 });
  assert.equal(post.status, 201, "enabled -> POST persists");
  assert.deepEqual(await post.json(), { ok: true });
  assert.equal(pulseCount(db), 1);
}

// No DB binding -> fail closed even with the flag on.
{
  const post = await worker.fetch(new Request(`${ORIGIN}/api/experience-pulse`, {
    method: "POST", headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ value: 3, csrf: "x" }),
  }), { EXPERIENCE_PULSE_ENABLED: "true", ASSETS: makeEnv(freshDb()).ASSETS });
  assert.equal(post.status, 503, "no DB -> fail closed");
}

// ---------------------------------------------------------------------------
// GET mints a scoped token + cookie and creates NO pulse.
// ---------------------------------------------------------------------------
{
  const db = freshDb();
  const env = makeEnv(db);
  const { res, cookie, csrf } = await mintPulseCsrf(env);
  assert.equal(res.status, 200);
  assert.ok(cookie && cookie.length >= 20 && csrf === cookie, "GET returns the token and sets the matching cookie");
  const sc = res.headers.get("set-cookie");
  assert.match(sc, /Path=\/api\/experience-pulse/);
  assert.match(sc, /HttpOnly/); assert.match(sc, /Secure/); assert.match(sc, /SameSite=Strict/);
  assert.ok(!/domain=/i.test(sc), "no Domain attribute");
  assert.equal(pulseCount(db), 0, "GET created no pulse");
}

// ---------------------------------------------------------------------------
// Happy path: durable insert, success only after it, server-stamped version,
// server-authoritative timestamp, closed action_context stored.
// ---------------------------------------------------------------------------
{
  const db = freshDb();
  const env = makeEnv(db);
  const { cookie, csrf } = await mintPulseCsrf(env);
  const res = await postPulse(env, {
    cookie, csrf, value: 1, sourceSection: "review", sourceRoute: "/log/#review",
    actionContext: "after_review", appVersion: "9.9.9-evil",
  });
  assert.equal(res.status, 201);
  assert.equal(pulseCount(db), 1);
  const row = db.sqlite.prepare("SELECT * FROM feedback_experience_pulses").get();
  assert.equal(row.value, 1);
  assert.equal(row.source_section, "review");
  assert.equal(row.source_route, "/log/#review");
  assert.equal(row.action_context, "after_review");
  assert.equal(row.app_version, APP_VERSION, "server-stamped canonical version - client override ignored");
  assert.ok(row.created_at, "server-authoritative timestamp");
}

// ---------------------------------------------------------------------------
// Value validation at the boundary: only 1|2|3 persists; anything else is a
// 400 with the invalid_value code and writes nothing.
// ---------------------------------------------------------------------------
{
  const db = freshDb();
  const env = makeEnv(db);
  for (const bad of [0, 4, 2.5, "good"]) {
    const { cookie, csrf } = await mintPulseCsrf(env);
    const res = await postPulse(env, { cookie, csrf, value: bad });
    assert.equal(res.status, 400, `value ${JSON.stringify(bad)} -> 400`);
    assert.equal((await res.json()).code, "invalid_value");
  }
  // A wholly ABSENT value is likewise rejected (raw request so no default is
  // substituted by the test helper).
  {
    const { cookie, csrf } = await mintPulseCsrf(env);
    const res = await worker.fetch(new Request(`${ORIGIN}/api/experience-pulse`, {
      method: "POST",
      headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", cookie: `${PULSE_COOKIE}=${cookie}` },
      body: JSON.stringify({ csrf }),
    }), env);
    assert.equal(res.status, 400, "missing value -> 400");
    assert.equal((await res.json()).code, "invalid_value");
  }
  assert.equal(pulseCount(db), 0, "no invalid value persisted");
  for (const good of [1, 2, 3]) {
    const { cookie, csrf } = await mintPulseCsrf(env);
    assert.equal((await postPulse(env, { cookie, csrf, value: good })).status, 201);
  }
  assert.equal(pulseCount(db), 3);
}

// ---------------------------------------------------------------------------
// Request-source (#45): real Chrome shape works; cross-site/foreign rejected.
// ---------------------------------------------------------------------------
{
  const db = freshDb();
  const env = makeEnv(db);
  const first = await mintPulseCsrf(env);
  const chrome = await postPulse(env, { cookie: first.cookie, csrf: first.csrf, headers: { origin: "null", "sec-fetch-site": "same-origin" } });
  assert.equal(chrome.status, 201, "Origin: null + Sec-Fetch-Site: same-origin works");

  const fresh = () => mintPulseCsrf(env);
  assert.equal((await postPulse(env, { ...(await fresh()), headers: { "sec-fetch-site": "cross-site" } })).status, 403, "cross-site refused");
  assert.equal((await postPulse(env, { ...(await fresh()), headers: { "sec-fetch-site": "same-site" } })).status, 403, "same-site refused");
  assert.equal((await postPulse(env, { ...(await fresh()), headers: { "sec-fetch-site": "none" } })).status, 403, "none refused");

  const c1 = await fresh();
  const foreign = await worker.fetch(new Request(`${ORIGIN}/api/experience-pulse`, {
    method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example", cookie: `${PULSE_COOKIE}=${c1.cookie}` },
    body: JSON.stringify({ value: 3, csrf: c1.csrf }),
  }), env);
  assert.equal(foreign.status, 403, "foreign Origin without Sec-Fetch-Site refused");

  const c2 = await fresh();
  const bare = await worker.fetch(new Request(`${ORIGIN}/api/experience-pulse`, {
    method: "POST", headers: { "content-type": "application/json", cookie: `${PULSE_COOKIE}=${c2.cookie}` },
    body: JSON.stringify({ value: 3, csrf: c2.csrf }),
  }), env);
  assert.equal(bare.status, 201, "absent Origin + absent Sec-Fetch-Site tolerated");
}

// ---------------------------------------------------------------------------
// CSRF double-submit: missing/mismatched refused; matched pair accepted.
// ---------------------------------------------------------------------------
{
  const db = freshDb();
  const env = makeEnv(db);
  const { cookie, csrf } = await mintPulseCsrf(env);
  assert.equal((await postPulse(env, { csrf })).status, 403, "no cookie -> refused");
  assert.equal((await postPulse(env, { cookie })).status, 403, "no body token -> refused");
  assert.equal((await postPulse(env, { cookie, csrf: "wrong-wrong-wrong-wrong-wrong-wrong-1234" })).status, 403, "mismatch -> refused");
  const before = pulseCount(db);
  assert.equal((await postPulse(env, { cookie, csrf })).status, 201, "matched pair -> accepted");
  assert.equal(pulseCount(db), before + 1);
}

// ---------------------------------------------------------------------------
// GET may not mutate; unsupported methods rejected.
// ---------------------------------------------------------------------------
{
  const db = freshDb();
  const env = makeEnv(db);
  await mintPulseCsrf(env);
  assert.equal(pulseCount(db), 0, "GET never writes");
  const put = await worker.fetch(new Request(`${ORIGIN}/api/experience-pulse`, { method: "PUT" }), env);
  assert.equal(put.status, 405);
}

// ---------------------------------------------------------------------------
// A failed D1 insert never returns success and never leaks detail.
// ---------------------------------------------------------------------------
{
  const db = freshDb();
  const env = makeEnv(db);
  const { cookie, csrf } = await mintPulseCsrf(env);
  const realPrepare = db.prepare.bind(db);
  db.prepare = (sql) => {
    if (/INSERT INTO feedback_experience_pulses/i.test(sql)) {
      return { bind: () => ({ run: async () => { throw new Error("d1 down"); } }) };
    }
    return realPrepare(sql);
  };
  const res = await postPulse(env, { cookie, csrf, value: 2 });
  db.prepare = realPrepare;
  assert.equal(res.status, 503, "storage failure is not a success");
  assert.notEqual(res.status, 201);
  assert.equal(pulseCount(db), 0, "no row on failed insert");
  assert.ok(!JSON.stringify(await res.json()).includes("d1 down"), "no internal error detail leaked");
}

// ---------------------------------------------------------------------------
// Rate-limit isolation: the pulse budget (10/hour) is independent from BOTH the
// waitlist budget (10/hour) and the feedback budget (5/hour), in both
// directions. Under a shared namespace these counts would interfere.
// ---------------------------------------------------------------------------
{
  const db = freshDb();
  const env = makeEnv(db);

  // Direction 1: exhaust the pulse budget on ip1, then waitlist (10) and
  // feedback (5) must both still be fully available - pulse spent none of them.
  for (let i = 0; i < 10; i += 1) {
    const c = await mintPulseCsrf(env, "10.0.0.1");
    assert.equal((await postPulse(env, { cookie: c.cookie, csrf: c.csrf, value: 3, ip: "10.0.0.1" })).status, 201, `pulse ${i} ok`);
  }
  const c11 = await mintPulseCsrf(env, "10.0.0.1");
  assert.equal((await postPulse(env, { cookie: c11.cookie, csrf: c11.csrf, value: 3, ip: "10.0.0.1" })).status, 429, "11th pulse rate-limited");

  for (let i = 0; i < 10; i += 1) await joinWaitlist(env, "10.0.0.1", `rider1_${i}@example.com`);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM waitlist_signups WHERE email_normalized LIKE 'rider1_%'").get().n, 10,
    "full waitlist budget available despite an exhausted pulse budget");
  for (let i = 0; i < 5; i += 1) {
    const f = await mintFeedbackCsrf(env, "10.0.0.1");
    assert.equal((await postFeedback(env, { ...f, ip: "10.0.0.1" })).status, 201, `feedback ${i} intact after exhausted pulse budget`);
  }
  const fOver = await mintFeedbackCsrf(env, "10.0.0.1");
  assert.equal((await postFeedback(env, { ...fOver, ip: "10.0.0.1" })).status, 429, "feedback budget was exactly 5, untouched by pulse");

  // Direction 2: spend the whole waitlist + feedback budgets on ip2; the pulse
  // budget must still be intact (10 succeed, 11th 429).
  for (let i = 0; i < 10; i += 1) await joinWaitlist(env, "10.0.0.2", `rider2_${i}@example.com`);
  for (let i = 0; i < 5; i += 1) {
    const f = await mintFeedbackCsrf(env, "10.0.0.2");
    await postFeedback(env, { ...f, ip: "10.0.0.2" });
  }
  for (let i = 0; i < 10; i += 1) {
    const c = await mintPulseCsrf(env, "10.0.0.2");
    assert.equal((await postPulse(env, { cookie: c.cookie, csrf: c.csrf, value: 2, ip: "10.0.0.2" })).status, 201, `pulse ${i} intact after other activity`);
  }
  const c2over = await mintPulseCsrf(env, "10.0.0.2");
  assert.equal((await postPulse(env, { cookie: c2over.cookie, csrf: c2over.csrf, value: 2, ip: "10.0.0.2" })).status, 429, "pulse budget was exactly 10, untouched by waitlist/feedback");
}

// ---------------------------------------------------------------------------
// Structural: the worker wires the reserved pulse rate namespace and the
// dedicated flag; the pulse endpoint is distinct from feedback.
// ---------------------------------------------------------------------------
{
  const src = readFileSync(join(import.meta.dirname, "..", "src", "waitlist-worker.js"), "utf8");
  assert.ok(src.includes("PULSE_RATE_BUCKET_PREFIX"), "worker uses the reserved pulse namespace");
  assert.ok(src.includes('EXPERIENCE_PULSE_ENABLED === "true"'), "dedicated exact-true gate, not FEEDBACK_ENABLED");
  assert.ok(src.includes("/api/experience-pulse"), "dedicated pulse endpoint");
}

console.log("experience-pulse-route.test.js passed");
