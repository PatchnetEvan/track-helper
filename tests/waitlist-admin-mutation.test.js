import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import worker from "../src/waitlist-worker.js";

// Waitlist Admin PR 3 (#49): the decision mutation. What this suite pins:
// the mutation is reachable ONLY as an authenticated POST to
// /admin/waitlist/:id/decision carrying BOTH halves of the double-submit
// CSRF pair from a same-origin request; the audit actor is exclusively the
// Access-verified operator email; Not approved takes a second explicit
// confirmation; and every refusal - CSRF, validation, conflict, no-op -
// leaves the database untouched.

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
const events = () => count("SELECT COUNT(*) AS n FROM waitlist_beta_approval_events");
const lastEvent = () => db.sqlite.prepare(
  "SELECT * FROM waitlist_beta_approval_events ORDER BY event_seq DESC LIMIT 1").get();
const seed = (id, email, status, track = "us_beta_waitlist", country = "US") =>
  db.sqlite.prepare(`INSERT INTO waitlist_signups (id, email_normalized, country_code, program_track, status,
    consent_at, consent_copy_version, privacy_notice_version)
    VALUES (?, ?, ?, ?, ?, datetime('now'), '2026-08-05.2', '2026-08-05.2')`).run(id, email, country, track, status);

seed("m_us", "decide-us@example.com", "confirmed");
seed("m_intl", "decide-intl@example.com", "confirmed", "international_interest", "DE");

// --- Synthetic Access identity ---------------------------------------------
const OPERATOR = "synthetic-operator@example.test";
const TEAM = "https://synthetic-team.cloudflareaccess.com";
const AUD = "synthetic-aud-tag";
const { privateKey, publicKey } = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true, ["sign", "verify"]);
const jwk = { ...(await crypto.subtle.exportKey("jwk", publicKey)), kid: "test-key", use: "sig", alg: "RS256" };
const b64url = (bytes) => Buffer.from(bytes).toString("base64url");
const signToken = async () => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const h = b64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", kid: "test-key", typ: "JWT" })));
  const p = b64url(new TextEncoder().encode(JSON.stringify({
    iss: TEAM, aud: [AUD], email: OPERATOR, exp: nowSeconds + 600, nbf: nowSeconds - 60,
  })));
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(new Uint8Array(signature))}`;
};
const TOKEN = await signToken();

const ASSET_404_BODY = "asset-404";
const ENV = {
  WAITLIST_DB: db, ASSETS: { fetch: async () => new Response(ASSET_404_BODY, { status: 404 }) },
  WAITLIST_ADMIN_ENABLED: "true",
  ADMIN_ACCESS_TEAM_DOMAIN: TEAM, ADMIN_ACCESS_AUD: AUD, ADMIN_OPERATOR_EMAILS: OPERATOR,
  ADMIN_AUTH_TEST: { fetchJwks: async () => ({ keys: [jwk] }) },
};
const ORIGIN = "https://mototrack.app";

// GET the detail page as the operator; capture the CSRF cookie + form token.
const openDetail = async (id) => {
  const response = await worker.fetch(new Request(`${ORIGIN}/admin/waitlist/${id}`, {
    headers: { "cf-access-jwt-assertion": TOKEN },
  }), ENV);
  assert.equal(response.status, 200);
  const setCookie = response.headers.get("set-cookie") ?? "";
  const cookie = /__Secure-mototrack_admin_csrf=([^;]+)/.exec(setCookie)?.[1];
  const html = await response.text();
  const formToken = /name="csrf" value="([^"]+)"/.exec(html)?.[1];
  return { cookie, formToken, html };
};

// POST a decision with full control over each protection layer.
const postDecision = (id, body, { cookie, headers = {} } = {}) =>
  worker.fetch(new Request(`${ORIGIN}/admin/waitlist/${id}/decision`, {
    method: "POST",
    headers: {
      "cf-access-jwt-assertion": TOKEN,
      "sec-fetch-site": "same-origin",
      ...(cookie ? { cookie: `__Secure-mototrack_admin_csrf=${cookie}` } : {}),
      ...headers,
    },
    body: new URLSearchParams(body),
  }), ENV);

// ---------------------------------------------------------------------------
// The detail page arms the double-submit pair: cookie and embedded form
// token exist and match, and the form carries the observed state.
// ---------------------------------------------------------------------------
const armed = await openDetail("m_us");
{
  assert.ok(armed.cookie && armed.cookie.length >= 32, "CSRF cookie minted on first authorized view");
  assert.equal(armed.formToken, armed.cookie, "form embeds the same token (double-submit pair)");
  assert.ok(armed.html.includes('name="expected_state" value="awaiting_review"'));
  assert.ok(armed.html.includes("Confirm decision"));
  assert.ok(armed.html.includes("Do not record medical, financial"));

  // The cookie's exact attribute contract: HttpOnly, Secure,
  // SameSite=Strict, scoped to /admin, bounded lifetime, NO Domain
  // attribute (host-only).
  const detailResponse = await worker.fetch(new Request(`${ORIGIN}/admin/waitlist/m_us`, {
    headers: { "cf-access-jwt-assertion": TOKEN },
  }), ENV);
  const setCookie = detailResponse.headers.get("set-cookie") ?? "";
  assert.match(setCookie, /^__Secure-mototrack_admin_csrf=[^;]+; Path=\/admin; Max-Age=86400; HttpOnly; Secure; SameSite=Strict$/,
    "CSRF cookie attributes are exactly the contract");
  assert.ok(!/domain=/i.test(setCookie), "no Domain attribute - host-only cookie");
}

// ---------------------------------------------------------------------------
// The happy path: awaiting_review -> approved. PRG redirect, one event,
// actor = the VERIFIED operator - a smuggled actor field is ignored.
// ---------------------------------------------------------------------------
{
  const response = await postDecision("m_us", {
    csrf: armed.formToken, expected_state: "awaiting_review", new_state: "approved",
    reason: "", actor: "smuggled-attacker@example.test",
  }, { cookie: armed.cookie });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/admin/waitlist/m_us?result=applied");
  assert.equal(events(), 1);
  const event = lastEvent();
  assert.equal(event.actor, OPERATOR, "actor comes from the verified JWT, never the form");
  assert.equal(event.previous_state, "awaiting_review");
  assert.equal(event.new_state, "approved");

  // The redirect target renders the outcome banner and the fresh state.
  const after = await worker.fetch(new Request(`${ORIGIN}/admin/waitlist/m_us?result=applied`, {
    headers: { "cf-access-jwt-assertion": TOKEN, cookie: `__Secure-mototrack_admin_csrf=${armed.cookie}` },
  }), ENV);
  const afterHtml = await after.text();
  assert.ok(afterHtml.includes("Decision recorded."));
  assert.ok(afterHtml.includes("Approved"));
  assert.ok(afterHtml.includes(OPERATOR), "history shows the verified actor");
}

// ---------------------------------------------------------------------------
// CSRF matrix: every degraded shape is refused with 403 and zero writes.
// Authentication alone is NEVER enough to mutate.
// ---------------------------------------------------------------------------
{
  const before = events();
  const attempts = [
    // No cookie at all.
    postDecision("m_us", { csrf: armed.formToken, expected_state: "approved", new_state: "hold", reason: "x" }),
    // Cookie present, form token wrong.
    postDecision("m_us", { csrf: "not-the-token-not-the-token-not!", expected_state: "approved", new_state: "hold", reason: "x" }, { cookie: armed.cookie }),
    // Matching pair but cross-site per Sec-Fetch-Site.
    postDecision("m_us", { csrf: armed.formToken, expected_state: "approved", new_state: "hold", reason: "x" }, { cookie: armed.cookie, headers: { "sec-fetch-site": "cross-site" } }),
    // No Sec-Fetch-Site, Origin literal "null" (the #45 shape) - never trusted.
    worker.fetch(new Request(`${ORIGIN}/admin/waitlist/m_us/decision`, {
      method: "POST",
      headers: { "cf-access-jwt-assertion": TOKEN, origin: "null", cookie: `__Secure-mototrack_admin_csrf=${armed.cookie}` },
      body: new URLSearchParams({ csrf: armed.formToken, expected_state: "approved", new_state: "hold", reason: "x" }),
    }), ENV),
  ];
  for (const attempt of attempts) assert.equal((await attempt).status, 403);
  assert.equal(events(), before, "refused mutations leave no trace");
}

// ---------------------------------------------------------------------------
// Not approved requires the second explicit confirmation. The first submit
// renders the interstitial and records NOTHING; the confirmed submit records
// exactly one event.
// ---------------------------------------------------------------------------
{
  const before = events();
  const first = await postDecision("m_us", {
    csrf: armed.formToken, expected_state: "approved", new_state: "not_approved",
    reason: "Duplicate of another signup",
  }, { cookie: armed.cookie });
  assert.equal(first.status, 200);
  const interstitial = await first.text();
  assert.ok(interstitial.includes("Confirm: mark this rider Not approved"));
  assert.ok(interstitial.includes("Nothing has been recorded yet"));
  assert.ok(interstitial.includes('name="confirm_not_approved" value="yes"'));
  assert.equal(events(), before, "the interstitial records nothing");

  const confirmed = await postDecision("m_us", {
    csrf: armed.formToken, expected_state: "approved", new_state: "not_approved",
    reason: "Duplicate of another signup", confirm_not_approved: "yes",
  }, { cookie: armed.cookie });
  assert.equal(confirmed.status, 303);
  assert.equal(confirmed.headers.get("location"), "/admin/waitlist/m_us?result=applied");
  assert.equal(events(), before + 1);
  assert.equal(lastEvent().new_state, "not_approved");
}

// ---------------------------------------------------------------------------
// Service refusals surface as honest results with zero writes.
// ---------------------------------------------------------------------------
{
  const before = events();

  // Stale view -> conflict PRG, nothing recorded.
  const stale = await postDecision("m_us", {
    csrf: armed.formToken, expected_state: "approved", new_state: "hold", reason: "stale operator view",
  }, { cookie: armed.cookie });
  assert.equal(stale.status, 303);
  assert.equal(stale.headers.get("location"), "/admin/waitlist/m_us?result=conflict");

  // Re-selecting the current state -> no_change PRG.
  const noop = await postDecision("m_us", {
    csrf: armed.formToken, expected_state: "not_approved", new_state: "not_approved",
    reason: "no-op", confirm_not_approved: "yes",
  }, { cookie: armed.cookie });
  assert.equal(noop.status, 303);
  assert.equal(noop.headers.get("location"), "/admin/waitlist/m_us?result=no_change");

  // Reason required -> 400 re-render with the decision form and the error.
  const missingReason = await postDecision("m_us", {
    csrf: armed.formToken, expected_state: "not_approved", new_state: "approved", reason: "   ",
  }, { cookie: armed.cookie });
  assert.equal(missingReason.status, 400);
  const missingHtml = await missingReason.text();
  assert.ok(missingHtml.includes("requires an operational reason"));
  assert.ok(missingHtml.includes("Record a decision"), "the operator can correct and resubmit in place");

  // Over-long reason -> 400.
  assert.equal((await postDecision("m_us", {
    csrf: armed.formToken, expected_state: "not_approved", new_state: "approved", reason: "x".repeat(281),
  }, { cookie: armed.cookie })).status, 400);

  assert.equal(events(), before, "conflict, no-op, and validation refusals write nothing");

  // Banner copy for the two refusal results is explicit about non-action.
  for (const [result, marker] of [["conflict", "Nothing was recorded"], ["no_change", "No decision was recorded"]]) {
    const banner = await worker.fetch(new Request(`${ORIGIN}/admin/waitlist/m_us?result=${result}`, {
      headers: { "cf-access-jwt-assertion": TOKEN, cookie: `__Secure-mototrack_admin_csrf=${armed.cookie}` },
    }), ENV);
    assert.ok((await banner.text()).includes(marker), `${result} banner states nothing happened`);
  }
}

// ---------------------------------------------------------------------------
// The international prohibition holds end-to-end with the exact wording,
// and the form disables the option at the source.
// ---------------------------------------------------------------------------
{
  const intl = await openDetail("m_intl");
  assert.ok(/<option value="approved"[^>]*disabled/.test(intl.html), "Approved is disabled in the intl form");

  const before = events();
  const refused = await postDecision("m_intl", {
    csrf: intl.formToken ?? armed.formToken, expected_state: "awaiting_review", new_state: "approved",
  }, { cookie: intl.cookie ?? armed.cookie });
  assert.equal(refused.status, 400);
  assert.ok((await refused.text()).includes(
    "International-interest registration does not currently represent eligibility for MotoTrack beta access."));
  assert.equal(events(), before, "the refused international approval leaves no trace");
}

// ---------------------------------------------------------------------------
// The result-banner vocabulary is closed on OWN keys only: inherited object
// keys and arbitrary query text render no banner at all.
// ---------------------------------------------------------------------------
{
  for (const probe of ["constructor", "__proto__", "hasOwnProperty", "zzz-not-a-result", "%3Cscript%3E"]) {
    const response = await worker.fetch(new Request(`${ORIGIN}/admin/waitlist/m_us?result=${probe}`, {
      headers: { "cf-access-jwt-assertion": TOKEN, cookie: `__Secure-mototrack_admin_csrf=${armed.cookie}` },
    }), ENV);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.ok(!html.includes('class="banner'), `?result=${probe} renders no banner element`);
    assert.ok(!html.includes(">undefined<"), `?result=${probe} leaks nothing`);
  }
}

// ---------------------------------------------------------------------------
// Two-stage conflict: another operator decides between the Not-approved
// interstitial and its confirmation. The stale confirmation must return
// conflict, change nothing, append nothing, and direct a reload. The
// interstitial also carries the NORMALIZED reason - what is shown is
// byte-for-byte what would be stored.
// ---------------------------------------------------------------------------
{
  // Bring m_us to approved (currently not_approved; leaving it needs a reason).
  const reinstate = await postDecision("m_us", {
    csrf: armed.formToken, expected_state: "not_approved", new_state: "approved",
    reason: "Reinstated for the two-stage conflict fixture",
  }, { cookie: armed.cookie });
  assert.equal(reinstate.headers.get("location"), "/admin/waitlist/m_us?result=applied");

  // Stage 1: operator A submits Not approved with a messy reason - the
  // interstitial renders it NORMALIZED (CRLF folded, edges trimmed) and
  // records nothing.
  const before = events();
  const stageOne = await postDecision("m_us", {
    csrf: armed.formToken, expected_state: "approved", new_state: "not_approved",
    reason: "  needs closing\r\nafter capacity review  ",
  }, { cookie: armed.cookie });
  assert.equal(stageOne.status, 200);
  const interstitial = await stageOne.text();
  assert.ok(interstitial.includes('name="reason" value="needs closing\nafter capacity review"')
    || interstitial.includes("needs closing\nafter capacity review"),
    "the interstitial carries the normalized reason");
  assert.ok(!interstitial.includes("  needs closing\r"), "the raw un-normalized text is not what gets confirmed");
  assert.ok(interstitial.includes('name="expected_state" value="approved"'),
    "the originally observed state rides the confirmation");
  assert.equal(events(), before, "stage one records nothing");

  // Between the two stages, operator B puts the record on hold.
  const interloper = await postDecision("m_us", {
    csrf: armed.formToken, expected_state: "approved", new_state: "hold", reason: "B got there first",
  }, { cookie: armed.cookie });
  assert.equal(interloper.headers.get("location"), "/admin/waitlist/m_us?result=applied");
  const afterB = events();

  // Stage 2: A's confirmation carries the ORIGINAL expected state and must
  // lose cleanly: conflict, no state change, no stale audit event.
  const staleConfirm = await postDecision("m_us", {
    csrf: armed.formToken, expected_state: "approved", new_state: "not_approved",
    reason: "needs closing\nafter capacity review", confirm_not_approved: "yes",
  }, { cookie: armed.cookie });
  assert.equal(staleConfirm.status, 303);
  assert.equal(staleConfirm.headers.get("location"), "/admin/waitlist/m_us?result=conflict");
  assert.equal(events(), afterB, "the stale confirmation appends no audit event");
  assert.equal(lastEvent().new_state, "hold", "operator B's decision stands");
  const conflictPage = await worker.fetch(new Request(`${ORIGIN}/admin/waitlist/m_us?result=conflict`, {
    headers: { "cf-access-jwt-assertion": TOKEN, cookie: `__Secure-mototrack_admin_csrf=${armed.cookie}` },
  }), ENV);
  assert.ok((await conflictPage.text()).includes("review the current state below and decide again"),
    "the losing operator is told to reload and review");
}

// ---------------------------------------------------------------------------
// Axis independence and email invariant across the whole mutation pass.
// ---------------------------------------------------------------------------
{
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_signups WHERE status != 'confirmed'"), 0,
    "no mutation touched confirmation status");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_email_deliveries"), 0, "decisions send nothing");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profile_consent_events"), 0);
}

console.log("waitlist-admin-mutation.test.js passed");
