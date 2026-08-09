import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import worker from "../src/waitlist-worker.js";
import { authenticateOperator, parseOperatorAllowlist } from "../src/waitlist-admin-auth.js";
import { listCandidates, changeApprovalState, ApprovalValidationError } from "../src/waitlist-admin-service.js";

// Waitlist Admin PR 2 (#49): authenticated, flag-gated, READ-ONLY queue and
// rider detail. The security matrix here is the point: every degraded
// request - flag off, config missing or malformed, no token, forged token,
// wrong audience/issuer, expired, not allowlisted, forged identity header -
// must be indistinguishable from "no such page".
//
// All operator identities below are SYNTHETIC. Real identities are
// deployment configuration supplied before staging activation, never source.

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

const MIGRATIONS = [
  "0001_waitlist.sql", "0002_program_track.sql", "0003_resubscription_evidence.sql",
  "0004_rider_profiles.sql", "0005_profile_edit_authorizations.sql",
  "0006_profile_consent_events.sql", "0007_profile_invitation_batches.sql",
  "0008_beta_approvals.sql",
];
const db = new LocalD1();
for (const m of MIGRATIONS) db.sqlite.exec(readFileSync(join(import.meta.dirname, "..", "migrations", m), "utf8"));

const count = (sql, ...args) => db.sqlite.prepare(sql).get(...args).n;
let seedSeq = 0;
const seed = (id, email, status, track = "us_beta_waitlist", country = "US") => {
  seedSeq += 1;
  db.sqlite.prepare(`INSERT INTO waitlist_signups (id, email_normalized, country_code, program_track, status,
    consent_at, consent_copy_version, privacy_notice_version, created_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'), '2026-08-05.2', '2026-08-05.2', datetime('now', ?))`)
    .run(id, email, country, track, status, `-${seedSeq} minutes`);
};

// Fixtures: distinct axes so every filter has something to bite on.
seed("q_us_new", "us-new@example.com", "confirmed");                                  // newest
seed("q_us_hold", "us-hold@example.com", "confirmed");
seed("q_intl", "intl-de@example.com", "confirmed", "international_interest", "DE");
seed("q_pending", "pending%like_trap@example.com", "pending");
seed("q_unsub", "gone@example.com", "unsubscribed");
seed("q_profiled", "profiled@example.com", "confirmed");                              // oldest

db.sqlite.prepare(`INSERT INTO waitlist_profiles (id, signup_id, display_name, goals, profile_copy_version, privacy_notice_version)
  VALUES ('prof_1', 'q_profiled', 'Evan Tester', 'Faster laps <script>alert(1)</script>', '2026-08-05.3', '2026-08-05.3')`).run();
db.sqlite.prepare(`INSERT INTO waitlist_tokens (id, signup_id, token_digest, purpose, expires_at)
  VALUES ('tok_1', 'q_profiled', ?, 'unsubscribe', NULL)`).run("d".repeat(64));

const OPERATOR = "synthetic-operator@example.test";
const OUTSIDER = "not-allowlisted@example.test";

assert.equal((await changeApprovalState(db, {
  signupId: "q_us_hold", expectedState: "awaiting_review", newState: "hold",
  actor: OPERATOR, reason: "Fixture: capacity <b>pause</b> & review",
})).ok, true);
assert.equal((await changeApprovalState(db, {
  signupId: "q_profiled", expectedState: "awaiting_review", newState: "approved", actor: OPERATOR,
})).ok, true);
assert.equal((await changeApprovalState(db, {
  signupId: "q_profiled", expectedState: "approved", newState: "awaiting_review", actor: OPERATOR,
})).ok, true); // explicit return-to-queue: everReviewed=true

// ---------------------------------------------------------------------------
// listCandidates: filters, search escaping, effective-state semantics,
// pagination bounds, deterministic sort. One query - the assertions on shape
// double as the no-N+1 contract (approval + profile arrive on the row).
// ---------------------------------------------------------------------------
{
  const all = await listCandidates(db, {});
  assert.equal(all.candidates.length, 6);
  assert.equal(all.hasMore, false);
  assert.deepEqual(all.candidates.map((c) => c.id),
    ["q_us_new", "q_us_hold", "q_intl", "q_pending", "q_unsub", "q_profiled"], "newest first by default");

  const oldest = await listCandidates(db, { sort: "oldest" });
  assert.equal(oldest.candidates[0].id, "q_profiled");

  const profiled = oldest.candidates[0];
  assert.deepEqual(profiled, {
    id: "q_profiled", email: "profiled@example.com", country: "US", programTrack: "us_beta_waitlist",
    status: "confirmed", createdAt: profiled.createdAt,
    effectiveState: "awaiting_review", everReviewed: true, hasProfile: true,
  }, "returned-to-queue row: effective awaiting_review WITH everReviewed=true");

  const neverReviewed = all.candidates.find((c) => c.id === "q_us_new");
  assert.equal(neverReviewed.effectiveState, "awaiting_review");
  assert.equal(neverReviewed.everReviewed, false);

  // Effective-state filter folds no-row and stored-awaiting together...
  const awaiting = await listCandidates(db, { approvalState: "awaiting_review" });
  assert.deepEqual(new Set(awaiting.candidates.map((c) => c.id)),
    new Set(["q_us_new", "q_intl", "q_pending", "q_unsub", "q_profiled"]));
  // ...and stored states filter exactly.
  const held = await listCandidates(db, { approvalState: "hold" });
  assert.deepEqual(held.candidates.map((c) => c.id), ["q_us_hold"]);

  // An international candidate is NEVER presented as approved by a default
  // calculation: no row means awaiting_review, and nothing else.
  const intl = (await listCandidates(db, { programTrack: "international_interest" })).candidates;
  assert.deepEqual(intl.map((c) => [c.id, c.effectiveState]), [["q_intl", "awaiting_review"]]);

  assert.deepEqual((await listCandidates(db, { status: "pending" })).candidates.map((c) => c.id), ["q_pending"]);
  assert.deepEqual((await listCandidates(db, { country: "de" })).candidates.map((c) => c.id), ["q_intl"]);
  assert.deepEqual((await listCandidates(db, { hasProfile: true })).candidates.map((c) => c.id), ["q_profiled"]);
  assert.equal((await listCandidates(db, { hasProfile: false })).candidates.length, 5);

  // Substring search is parameterized; LIKE metacharacters in the needle are
  // literals, not wildcards.
  assert.deepEqual((await listCandidates(db, { search: "US-NEW" })).candidates.map((c) => c.id), ["q_us_new"]);
  assert.deepEqual((await listCandidates(db, { search: "%like_trap" })).candidates.map((c) => c.id), ["q_pending"]);
  assert.equal((await listCandidates(db, { search: "%" })).candidates.length, 1, "a bare % matches only the literal");
  assert.equal((await listCandidates(db, { search: "'; DROP TABLE waitlist_signups;--" })).candidates.length, 0);
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_signups"), 6, "search input cannot reach the SQL text");

  // Bounded pagination: page size clamps, offset pages deterministically.
  const page1 = await listCandidates(db, { limit: 2 });
  assert.equal(page1.candidates.length, 2);
  assert.equal(page1.hasMore, true);
  const page3 = await listCandidates(db, { limit: 2, offset: 4 });
  assert.equal(page3.hasMore, false);
  assert.deepEqual(page3.candidates.map((c) => c.id), ["q_unsub", "q_profiled"]);
  assert.equal((await listCandidates(db, { limit: 100000 })).limit, 100, "page size is clamped");
  assert.equal((await listCandidates(db, { offset: -5 })).offset, 0);

  await assert.rejects(listCandidates(db, { approvalState: "reviewing" }),
    (e) => e instanceof ApprovalValidationError && e.code === "invalid_state");
  await assert.rejects(listCandidates(db, { programTrack: "eu_beta" }), (e) => e.code === "invalid_filter");
  await assert.rejects(listCandidates(db, { status: "maybe" }), (e) => e.code === "invalid_filter");
  await assert.rejects(listCandidates(db, { country: "USA" }), (e) => e.code === "invalid_filter");
}

// ---------------------------------------------------------------------------
// Access-JWT forgery bench: a real RSA keypair signs synthetic tokens; the
// JWKS endpoint is injected. Every deviation must yield null.
// ---------------------------------------------------------------------------
const TEAM = "https://synthetic-team.cloudflareaccess.com";
const AUD = "synthetic-aud-tag";
const { privateKey, publicKey } = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true, ["sign", "verify"]);
const jwk = { ...(await crypto.subtle.exportKey("jwk", publicKey)), kid: "test-key", use: "sig", alg: "RS256" };
const jwks = { keys: [jwk] };
const rogue = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true, ["sign", "verify"]);

const b64url = (bytes) => Buffer.from(bytes).toString("base64url");
const signToken = async ({ header = {}, payload = {}, key = privateKey } = {}) => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const h = b64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", kid: "test-key", typ: "JWT", ...header })));
  const p = b64url(new TextEncoder().encode(JSON.stringify({
    iss: TEAM, aud: [AUD], email: OPERATOR, exp: nowSeconds + 300, nbf: nowSeconds - 60, ...payload,
  })));
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(new Uint8Array(signature))}`;
};

const AUTH_ENV = {
  ADMIN_ACCESS_TEAM_DOMAIN: TEAM, ADMIN_ACCESS_AUD: AUD,
  ADMIN_OPERATOR_EMAILS: `${OPERATOR}, second-synthetic@example.test`,
};
const deps = { fetchJwks: async () => jwks };
const authRequest = (token, extraHeaders = {}) => new Request("https://mototrack.app/admin/waitlist", {
  headers: { ...(token ? { "cf-access-jwt-assertion": token } : {}), ...extraHeaders },
});

{
  // The one valid shape.
  const ok = await authenticateOperator(authRequest(await signToken()), AUTH_ENV, deps);
  assert.deepEqual(ok, { email: OPERATOR });

  // Config fail-closed: each missing or malformed piece kills authentication.
  for (const brokenEnv of [
    {},
    { ...AUTH_ENV, ADMIN_ACCESS_TEAM_DOMAIN: undefined },
    { ...AUTH_ENV, ADMIN_ACCESS_TEAM_DOMAIN: "https://evil.example.com" },
    { ...AUTH_ENV, ADMIN_ACCESS_AUD: "" },
    { ...AUTH_ENV, ADMIN_OPERATOR_EMAILS: "" },
    { ...AUTH_ENV, ADMIN_OPERATOR_EMAILS: "*@patchnet.net" },       // wildcard poisons the WHOLE list
    { ...AUTH_ENV, ADMIN_OPERATOR_EMAILS: "@example.test" },
    { ...AUTH_ENV, ADMIN_OPERATOR_EMAILS: `${OPERATOR}, *@x.y` },
  ]) {
    assert.equal(await authenticateOperator(authRequest(await signToken()), brokenEnv, deps), null);
  }
  assert.deepEqual(parseOperatorAllowlist("a@b.co, C@D.io"), ["a@b.co", "c@d.io"], "finite exact list, case-normalized");

  // Token defects: each must be null.
  assert.equal(await authenticateOperator(authRequest(null), AUTH_ENV, deps), null, "no token");
  assert.equal(await authenticateOperator(authRequest("not.a.jwt"), AUTH_ENV, deps), null);
  assert.equal(await authenticateOperator(authRequest(await signToken({ key: rogue.privateKey })), AUTH_ENV, deps), null, "wrong key");
  assert.equal(await authenticateOperator(authRequest(await signToken({ header: { alg: "none" } })), AUTH_ENV, deps), null);
  assert.equal(await authenticateOperator(authRequest(await signToken({ header: { alg: "HS256" } })), AUTH_ENV, deps), null);
  assert.equal(await authenticateOperator(authRequest(await signToken({ header: { kid: "unknown" } })), AUTH_ENV, deps), null);
  assert.equal(await authenticateOperator(authRequest(await signToken({ payload: { iss: "https://other.cloudflareaccess.com" } })), AUTH_ENV, deps), null);
  assert.equal(await authenticateOperator(authRequest(await signToken({ payload: { aud: ["other-app"] } })), AUTH_ENV, deps), null);
  assert.equal(await authenticateOperator(authRequest(await signToken({ payload: { exp: Math.floor(Date.now() / 1000) - 10 } })), AUTH_ENV, deps), null, "expired");
  assert.equal(await authenticateOperator(authRequest(await signToken({ payload: { nbf: Math.floor(Date.now() / 1000) + 600 } })), AUTH_ENV, deps), null, "not yet valid");
  assert.equal(await authenticateOperator(authRequest(await signToken({ payload: { email: undefined } })), AUTH_ENV, deps), null, "no email claim");
  assert.equal(await authenticateOperator(authRequest(await signToken({ payload: { email: OUTSIDER } })), AUTH_ENV, deps), null, "valid identity, not allowlisted");

  // A tampered payload (allowlisted email spliced into someone else's signed
  // token) breaks the signature.
  const [h, , s] = (await signToken({ payload: { email: OUTSIDER } })).split(".");
  const spliced = `${h}.${b64url(new TextEncoder().encode(JSON.stringify({
    iss: TEAM, aud: [AUD], email: OPERATOR, exp: Math.floor(Date.now() / 1000) + 300,
  })))}.${s}`;
  assert.equal(await authenticateOperator(authRequest(spliced), AUTH_ENV, deps), null);

  // An email-looking header is never identity.
  assert.equal(await authenticateOperator(
    authRequest(null, { "cf-access-authenticated-user-email": OPERATOR }), AUTH_ENV, deps), null);
}

// ---------------------------------------------------------------------------
// HTTP layer through the real Worker. ASSETS stands in for the static-asset
// 404 the public origin serves; equality with it IS the non-disclosure proof.
// ---------------------------------------------------------------------------
const ASSET_404_BODY = "asset-404";
const ASSETS = { fetch: async () => new Response(ASSET_404_BODY, { status: 404 }) };
const ADMIN_ENV = { WAITLIST_DB: db, ASSETS, WAITLIST_ADMIN_ENABLED: "true", ...AUTH_ENV, ADMIN_AUTH_TEST: deps };
const get = (path, env, token, extraHeaders = {}) => worker.fetch(new Request(`https://mototrack.app${path}`, {
  headers: { ...(token ? { "cf-access-jwt-assertion": token } : {}), ...extraHeaders },
}), env);
const isAssetNotFound = async (response) => response.status === 404 && (await response.text()) === ASSET_404_BODY;

{
  const valid = await signToken();

  // Flag governance: absent, wrong value -> the ordinary asset 404 even with
  // perfect credentials.
  const { WAITLIST_ADMIN_ENABLED, ...flagAbsent } = ADMIN_ENV;
  assert.ok(await isAssetNotFound(await get("/admin/waitlist", flagAbsent, valid)), "flag absent");
  assert.ok(await isAssetNotFound(await get("/admin/waitlist", { ...ADMIN_ENV, WAITLIST_ADMIN_ENABLED: "false" }, valid)), "flag false");
  assert.ok(await isAssetNotFound(await get("/admin/waitlist", { ...ADMIN_ENV, WAITLIST_ADMIN_ENABLED: "TRUE" }, valid)), "flag is exact-match");

  // Auth matrix through HTTP: all degraded shapes are the same 404.
  assert.ok(await isAssetNotFound(await get("/admin/waitlist", ADMIN_ENV, null)), "unauthenticated");
  assert.ok(await isAssetNotFound(await get("/admin/waitlist", ADMIN_ENV, await signToken({ key: rogue.privateKey }))), "invalid identity");
  assert.ok(await isAssetNotFound(await get("/admin/waitlist", ADMIN_ENV, await signToken({ payload: { email: OUTSIDER } }))), "not allowlisted");
  assert.ok(await isAssetNotFound(await get("/admin/waitlist", ADMIN_ENV, null,
    { "cf-access-authenticated-user-email": OPERATOR })), "forged email header grants nothing");
  const { ADMIN_OPERATOR_EMAILS, ...noAllowlist } = ADMIN_ENV;
  assert.ok(await isAssetNotFound(await get("/admin/waitlist", noAllowlist, valid)), "missing allowlist config fails closed");

  // Authorized read-only access.
  const queue = await get("/admin/waitlist", ADMIN_ENV, valid);
  assert.equal(queue.status, 200);
  const queueHtml = await queue.text();
  assert.ok(queueHtml.includes("Candidate queue"));
  assert.ok(queueHtml.includes("us-new@example.com"));
  assert.ok(queueHtml.includes("US beta waitlist") && queueHtml.includes("International interest"),
    "the two tracks are visually distinct labels, not one eligibility group");
  assert.ok(queueHtml.includes("Never reviewed") && queueHtml.includes("Previously reviewed"),
    "unreviewed vs returned-to-queue is visible in the queue itself");
  assert.equal(queue.headers.get("x-robots-tag"), "noindex, nofollow");
  assert.equal(queue.headers.get("cache-control"), "no-store");

  // /admin and /admin/ funnel to the queue for operators.
  assert.equal((await get("/admin", ADMIN_ENV, valid)).status, 303);
  assert.equal((await get("/admin/", ADMIN_ENV, valid)).status, 303);

  // Filters flow through HTTP; the intl candidate renders with its own badge
  // and its default effective state - never as Approved.
  const intlQueue = await (await get("/admin/waitlist?track=international_interest", ADMIN_ENV, valid)).text();
  assert.ok(intlQueue.includes("intl-de@example.com"));
  assert.ok(intlQueue.includes("International interest"));
  assert.ok(intlQueue.includes("Awaiting review"));
  assert.ok(!/Approved/.test(intlQueue.replace(/Not approved/g, "").replace(/any approval state/g, "")
    .replace(/<option[^>]*>[^<]*<\/option>/g, "")), "intl row never shows Approved");

  // Detail: signup axes, separated approval panel, history, profile.
  const detail = await get("/admin/waitlist/q_profiled", ADMIN_ENV, valid);
  assert.equal(detail.status, 200);
  const detailHtml = await detail.text();
  assert.ok(detailHtml.includes("profiled@example.com"));
  assert.ok(detailHtml.includes("Beta approval") && detailHtml.includes("Decision history"));
  assert.ok(detailHtml.includes("Previously reviewed"), "returned-to-queue is explicit in detail");
  assert.ok(detailHtml.includes("Approved") && detailHtml.includes(OPERATOR), "history shows actor and transitions");
  assert.ok(detailHtml.includes("rider-submitted, separate from approval"));
  assert.ok(detailHtml.includes("Evan Tester"));
  assert.ok(!detailHtml.includes("<script>alert(1)</script>") && detailHtml.includes("&lt;script&gt;alert(1)&lt;/script&gt;"),
    "rider free text renders escaped");
  assert.ok(!detailHtml.includes("d".repeat(64)), "token digests never render");

  const held = await (await get("/admin/waitlist/q_us_hold", ADMIN_ENV, valid)).text();
  assert.ok(held.includes("Fixture: capacity &lt;b&gt;pause&lt;/b&gt; &amp; review"), "operator reason renders escaped");
  assert.ok(!held.includes("capacity <b>pause</b>"));

  const intlDetail = await (await get("/admin/waitlist/q_intl", ADMIN_ENV, valid)).text();
  assert.ok(intlDetail.includes("does not currently represent eligibility for MotoTrack beta access"),
    "international detail states non-eligibility explicitly");

  // Unknown candidate, unknown admin path, and any non-GET: the asset 404.
  assert.ok(await isAssetNotFound(await get("/admin/waitlist/ghost", ADMIN_ENV, valid)));
  assert.ok(await isAssetNotFound(await get("/admin/anything-else", ADMIN_ENV, valid)));
  const post = await worker.fetch(new Request("https://mototrack.app/admin/waitlist/q_us_new", {
    method: "POST", headers: { "cf-access-jwt-assertion": valid, origin: "https://mototrack.app" },
    body: new URLSearchParams({ state: "approved" }),
  }), ADMIN_ENV);
  assert.ok(await isAssetNotFound(post), "no mutation endpoint exists - POST is not even acknowledged");

  // Read-only proof at the data layer: the whole HTTP pass changed nothing
  // and sent nothing.
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_beta_approval_events"), 3, "no admin route mutates approval state");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_email_deliveries"), 0, "no admin route sends email");

  // Public surface untouched by the admin wiring: fail-closed API and asset
  // fall-through behave exactly as before.
  const publicJoin = await worker.fetch(new Request("https://mototrack.app/api/waitlist", {
    method: "POST", headers: { origin: "https://mototrack.app", "content-type": "application/json" },
    body: JSON.stringify({ email: "x@example.com", country: "US", consent: true }),
  }), { ASSETS });
  assert.equal(publicJoin.status, 503, "public waitlist API remains fail-closed without bindings");
  assert.ok(await isAssetNotFound(await worker.fetch(new Request("https://mototrack.app/some-page"), { ...ADMIN_ENV })));
}

// ---------------------------------------------------------------------------
// Structural invariants for PR 2.
// ---------------------------------------------------------------------------
{
  const src = (name) => readFileSync(join(import.meta.dirname, "..", "src", name), "utf8");
  const routes = src("waitlist-admin-routes.js");
  assert.ok(!routes.includes("changeApprovalState"), "read-only: routes never import the mutation");
  for (const marker of ["WAITLIST_EMAIL", "EmailMessage", "waitlist_email_deliveries", "waitlist-tokens"]) {
    assert.ok(!routes.includes(marker), `admin routes must not reference ${marker}`);
  }
  const auth = src("waitlist-admin-auth.js");
  assert.ok(!auth.includes("cf-access-authenticated-user-email"),
    "identity comes from the verified JWT only, never the convenience header");
  for (const file of ["waitlist-admin-routes.js", "waitlist-admin-auth.js"]) {
    assert.ok(!/patchnet\.net|emartinez/i.test(src(file)), "no real operator identities in source");
  }
  const config = readFileSync(join(import.meta.dirname, "..", "wrangler.jsonc"), "utf8");
  assert.ok(!config.includes("WAITLIST_ADMIN_ENABLED"), "the admin flag ships in NO environment configuration");
  assert.ok(!config.includes("ADMIN_OPERATOR_EMAILS"), "operator identities are deployment config, not source");
  assert.ok(config.includes('"/admin/*"'), "run_worker_first must route /admin/* through the Worker");
}

console.log("waitlist-admin-routes.test.js passed");
