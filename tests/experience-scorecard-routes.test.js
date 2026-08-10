import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import worker from "../src/waitlist-worker.js";

// Beta Experience Scorecard v1 #55 PR3B: the Admin route, through the REAL
// Worker. It reuses the verified #49 Access-JWT auth and non-disclosure: every
// unentitled request is byte-for-byte the ordinary asset 404. It is READ-ONLY
// (no mutation route, no CSRF form) and it ESCAPES untrusted rider-influenced
// values (source_section, feedback bodies); source_route is never rendered.
// All operator identities are SYNTHETIC.

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
const db = new LocalD1();
for (const m of MIGRATIONS) db.sqlite.exec(readFileSync(join(import.meta.dirname, "..", "migrations", m), "utf8"));

// Fixtures, including deliberately hostile rider-influenced context.
const XSS_SECTION = "<script>alert(1)</script>";
const XSS_ROUTE = "/log/#<img src=x onerror=alert(2)>";
const XSS_FEEDBACK = "<script>steal()</script> vague brakes";
db.sqlite.prepare(
  `INSERT INTO feedback_submissions (id, body, source_section, app_version, triage_state)
   VALUES ('fb_scorecard_xss', ?, 'review', '0.1.0-beta.1', 'new')`,
).run(XSS_FEEDBACK);
let n = 0;
const seedPulse = (value, section, route, feedbackId = null) => db.sqlite.prepare(
  `INSERT INTO feedback_experience_pulses (id, value, source_section, source_route, app_version, feedback_id, created_at)
   VALUES (?, ?, ?, ?, '0.1.0-beta.1', ?, datetime('now'))`,
).run(`xp_r${n += 1}`, value, section, route, feedbackId);
seedPulse(1, XSS_SECTION, XSS_ROUTE, "fb_scorecard_xss");
seedPulse(3, "tires", "/log/#tires");
seedPulse(2, "tires", "/log/#tires");

// --- Access-JWT bench (same shape as the #49 admin suite) ------------------
const OPERATOR = "synthetic-operator@example.test";
const TEAM = "https://synthetic-team.cloudflareaccess.com";
const AUD = "synthetic-aud-tag";
const { privateKey, publicKey } = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true, ["sign", "verify"]);
const jwk = { ...(await crypto.subtle.exportKey("jwk", publicKey)), kid: "test-key", use: "sig", alg: "RS256" };
const jwks = { keys: [jwk] };
const b64url = (bytes) => Buffer.from(bytes).toString("base64url");
const signToken = async ({ payload = {} } = {}) => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const h = b64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", kid: "test-key", typ: "JWT" })));
  const p = b64url(new TextEncoder().encode(JSON.stringify({
    iss: TEAM, aud: [AUD], email: OPERATOR, exp: nowSeconds + 300, nbf: nowSeconds - 60, ...payload,
  })));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(new Uint8Array(sig))}`;
};

const ASSET_404 = "asset-404-body";
const ASSETS = { fetch: async () => new Response(ASSET_404, { status: 404 }) };
const AUTH_ENV = { ADMIN_ACCESS_TEAM_DOMAIN: TEAM, ADMIN_ACCESS_AUD: AUD, ADMIN_OPERATOR_EMAILS: OPERATOR };
const ADMIN_ENV = { WAITLIST_DB: db, ASSETS, WAITLIST_ADMIN_ENABLED: "true", ...AUTH_ENV, ADMIN_AUTH_TEST: { fetchJwks: async () => jwks } };

const get = (path, env, token, method = "GET") => worker.fetch(new Request(`https://mototrack.app${path}`, {
  method, headers: { ...(token ? { "cf-access-jwt-assertion": token } : {}), origin: "https://mototrack.app" },
}), env);
const isAsset404 = async (res) => res.status === 404 && (await res.text()) === ASSET_404;

// ---------------------------------------------------------------------------
// Non-disclosure: every unentitled request is the ordinary asset 404.
// ---------------------------------------------------------------------------
{
  const valid = await signToken();
  const { WAITLIST_ADMIN_ENABLED, ...flagAbsent } = ADMIN_ENV;
  assert.ok(await isAsset404(await get("/admin/experience", flagAbsent, valid)), "flag absent");
  assert.ok(await isAsset404(await get("/admin/experience", { ...ADMIN_ENV, WAITLIST_ADMIN_ENABLED: "false" }, valid)), "flag false");
  assert.ok(await isAsset404(await get("/admin/experience", ADMIN_ENV, null)), "unauthenticated");
  assert.ok(await isAsset404(await get("/admin/experience", ADMIN_ENV, await signToken({ payload: { email: "outsider@example.test" } }))), "not allowlisted");
}

// ---------------------------------------------------------------------------
// Read-only: POST is not a route -> falls through to the asset 404. There is no
// mutation surface on the scorecard.
// ---------------------------------------------------------------------------
{
  assert.ok(await isAsset404(await get("/admin/experience", ADMIN_ENV, await signToken(), "POST")), "no mutation route");
}

// ---------------------------------------------------------------------------
// Authorized render: the scorecard, its windows, and honest empties.
// ---------------------------------------------------------------------------
{
  const res = await get("/admin/experience", ADMIN_ENV, await signToken());
  assert.equal(res.status, 200);
  assert.match(res.headers.get("x-robots-tag") ?? "", /noindex/, "admin page is noindex");
  const html = await res.text();
  assert.ok(html.includes("Beta Experience Scorecard"), "title present");
  for (const label of ["Last 24 hours", "Last 7 days", "Last 30 days"]) {
    assert.ok(html.includes(label), `window ${label} shown`);
  }
  assert.ok(html.includes("Experience distribution"), "signal 1");
  assert.ok(html.includes("By workflow"), "signal 2");
  assert.ok(html.includes("By app version"), "signal 3");
  assert.ok(html.includes("Friction clusters"), "signal 4");
  assert.ok(html.includes("Recurring rider requests"), "signal 5");
  assert.ok(html.includes("improvement loop"), "signal 6");
  assert.ok(html.includes("evidence summaries, not priorities") || html.includes("not priorities"), "labels framed as evidence, not priorities");
  // Percentages accompany counts (the "%" appears in distribution).
  assert.ok(html.includes("%"), "percentages rendered");
  // The seeded data is tiny, so the evidence summaries must carry the small-
  // sample indicator and exact response counts (no hidden floor suppresses them).
  assert.ok(html.includes("Small sample"), "tiny-sample summaries carry the Small sample indicator");
  // The NUMERIC response count actually renders in a summary line (not just the
  // word "responses"): "<n> responses".
  assert.match(html, /\b\d+ responses\b/, "evidence summaries show the exact numeric response count");
  // Counts are ALWAYS paired with percentages in the distribution cells: a
  // number immediately followed by its (NN%). A bare % would not match.
  assert.match(html, /\d+ <span class="pctnote">\(\d+%\)/, "counts are shown paired with percentages");

  // Anti-causation (the spec's hardest prohibition): the version section states
  // the difference is evidence, not proof of cause, and the page never claims a
  // change CAUSED an outcome.
  assert.ok(html.includes("not proof that any change caused it"), "version section carries the not-causation disclaimer");
  // After removing the single allowed disclaimer phrase, NO causation language
  // may remain anywhere on the page.
  assert.ok(!/caused|because of|due to/i.test(html.replace("not proof that any change caused it", "")),
    "the scorecard never asserts causation");
}

// ---------------------------------------------------------------------------
// Escaping: untrusted source_section and feedback body are escaped; source_route
// is never rendered at all. No raw script/handler reaches the page.
// ---------------------------------------------------------------------------
{
  const html = await (await get("/admin/experience", ADMIN_ENV, await signToken())).text();
  assert.ok(!html.includes("<script>alert(1)"), "hostile source_section is NOT rendered raw");
  assert.ok(html.includes("&lt;script&gt;alert(1)"), "hostile source_section IS shown escaped");
  assert.ok(!html.includes("onerror=alert(2)"), "source_route (never rendered) does not leak a handler");
  assert.ok(!html.includes("<img src=x onerror"), "source_route markup absent entirely");
  assert.ok(!html.includes("<script>steal()"), "linked feedback body is NOT rendered raw");
  assert.ok(html.includes("&lt;script&gt;steal()") || html.includes("steal()"), "feedback snippet shown (escaped)");
}

// ---------------------------------------------------------------------------
// Window switch: the selected window is honored and marked current.
// ---------------------------------------------------------------------------
{
  const html = await (await get("/admin/experience?window=24h", ADMIN_ENV, await signToken())).text();
  assert.match(html, /class="current"[^>]*window=24h|window=24h"[^>]*class="current"|class="current" href="\/admin\/experience\?window=24h"/,
    "24h link marked current");
  assert.ok(html.includes('href="/admin/experience?window=7d"'), "other windows are switch links");
}

// ---------------------------------------------------------------------------
// Pre-migration: with 0010 not applied (the legitimate state before Pulse
// activation), the page renders an honest not-active state (200), never a 500.
// ---------------------------------------------------------------------------
{
  const pmDb = new LocalD1();
  for (const m of MIGRATIONS.slice(0, 9)) pmDb.sqlite.exec(readFileSync(join(import.meta.dirname, "..", "migrations", m), "utf8"));
  const res = await get("/admin/experience", { ...ADMIN_ENV, WAITLIST_DB: pmDb }, await signToken());
  assert.equal(res.status, 200, "renders (does not 500) before the pulse migration is applied");
  const html = await res.text();
  assert.ok(html.includes("Experience Pulse is not active in this environment yet"), "honest not-active note shown");
  assert.ok(html.includes("Beta Experience Scorecard"), "still the scorecard page");
}

console.log("experience-scorecard-routes.test.js passed");
