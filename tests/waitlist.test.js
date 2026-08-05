import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import worker, { GENERIC_ACCEPTED, CONSENT_COPY, CONSENT_COPY_VERSION, PRIVACY_NOTICE_VERSION } from "../src/waitlist-worker.js";

// The MotoTrack wait list: consent-first, double-confirmation, generic
// anti-enumeration responses, hashed single-use tokens, duplicate- and
// resend-safe, unsubscribe-honoring. Runs the REAL worker fetch handler
// over the real migration with a local D1 stand-in and a captured email
// provider (no network, no cookies anywhere).

class LocalD1 {
  constructor() { this.sqlite = new DatabaseSync(":memory:"); this.sqlite.exec("PRAGMA foreign_keys = ON"); }
  prepare(sql) {
    const sqlite = this.sqlite;
    return { bind(...values) { return {
      all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
      first: async () => sqlite.prepare(sql).get(...values) || null,
      run: async () => ({ success: true, meta: sqlite.prepare(sql).run(...values) }),
    }; } };
  }
}

const db = new LocalD1();
db.sqlite.exec(readFileSync(join(import.meta.dirname, "..", "migrations", "0001_waitlist.sql"), "utf8"));
const sent = [];
const env = {
  WAITLIST_DB: db,
  WAITLIST_EMAIL_TEST: { async send(message) { sent.push(message); return { status: "test_capture" }; } },
  ASSETS: { fetch: async () => new Response("static", { status: 200 }) },
};
const ORIGIN = "https://mototrack.app";
const row = (sql, ...args) => db.sqlite.prepare(sql).get(...args);
const count = (sql, ...args) => row(sql, ...args).n;
function join_(body, origin = ORIGIN) {
  return worker.fetch(new Request(`${ORIGIN}/api/waitlist`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
    body: JSON.stringify(body),
  }), env);
}
const linkFrom = (text, path) => {
  const line = text.split("\n").find((candidate) => candidate.includes(path));
  return line ? line.slice(line.indexOf(path)).trim() : null;
};

// Fail-closed without database or provider; nothing written.
{
  const noDb = await worker.fetch(new Request(`${ORIGIN}/api/waitlist`, { method: "POST", headers: { origin: ORIGIN }, body: "{}" }), { WAITLIST_EMAIL_TEST: env.WAITLIST_EMAIL_TEST, ASSETS: env.ASSETS });
  assert.equal(noDb.status, 503);
  const noMail = await join_({ email: "a@b.co", country: "US", consent: true }, ORIGIN) && await worker.fetch(new Request(`${ORIGIN}/api/waitlist`, { method: "POST", headers: { origin: ORIGIN }, body: "{}" }), { WAITLIST_DB: db, ASSETS: env.ASSETS });
  assert.equal(noMail.status, 503);
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_signups"), 1, "only the provider-backed submission persisted");
  db.sqlite.exec("DELETE FROM waitlist_email_deliveries; DELETE FROM waitlist_tokens; DELETE FROM waitlist_signups; DELETE FROM waitlist_rate_buckets");
  sent.length = 0;
}

// Required fields, country-code validation, required affirmative consent.
{
  assert.equal((await join_({ country: "US", consent: true })).status, 400, "email required");
  assert.equal((await join_({ email: "not-an-email", country: "US", consent: true })).status, 400, "email format");
  assert.equal((await join_({ email: "rider@example.com", consent: true })).status, 400, "country required");
  assert.equal((await join_({ email: "rider@example.com", country: "XX", consent: true })).status, 400, "ISO country codes only");
  assert.equal((await join_({ email: "rider@example.com", country: "US" })).status, 400, "consent checkbox required");
  assert.equal((await join_({ email: "rider@example.com", country: "US", consent: "yes" })).status, 400, "consent must be the literal affirmative true");
  assert.equal((await join_({ email: "rider@example.com", country: "US", consent: true }, null)).status, 403, "origin required");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_signups"), 0);
}

// The form never pre-checks consent and carries the exact consent copy.
{
  const html = readFileSync(join(import.meta.dirname, "..", "waitlist.html"), "utf8");
  assert.ok(html.includes('type="checkbox" required'), "consent checkbox present and required");
  assert.ok(!/checkbox"[^>]*checked/.test(html), "the consent box is NEVER pre-checked");
  assert.ok(html.includes("Yes, add me to the MotoTrack waitlist and email me about early access"), "exact consent wording");
  assert.ok(html.includes('href="privacy.html"'), "consent links the privacy notice");
  assert.ok(html.includes(">Join the waitlist</button>"), "the specified button label");
  assert.ok(html.includes('aria-live="polite"') && html.includes("<label for="), "accessible labels and status region");
  assert.ok(CONSENT_COPY.startsWith("Yes, add me to the MotoTrack waitlist"), "server pins the consent copy version");
}

// Pending signup: created with stamps + versions; token hashed; email sent.
{
  const accepted = await join_({ email: " Rider@Example.com ", country: "us", consent: true, page_query: "?utm_source=press&sneaky=drop" });
  assert.equal(accepted.status, 202);
  assert.equal((await accepted.json()).message, GENERIC_ACCEPTED);
  const signup = row("SELECT * FROM waitlist_signups WHERE email_normalized = 'rider@example.com'");
  assert.equal(signup.status, "pending");
  assert.equal(signup.country_code, "US");
  assert.ok(signup.consent_at && !signup.confirmed_at);
  assert.equal(signup.consent_copy_version, CONSENT_COPY_VERSION);
  assert.equal(signup.privacy_notice_version, PRIVACY_NOTICE_VERSION);
  assert.deepEqual(JSON.parse(signup.attribution), { utm_source: "press" }, "only utm_*/ref attribution is kept");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].subject, "Confirm your MotoTrack waitlist spot");
  assert.ok(sent[0].text.includes("Confirm my place"));
  const confirmLink = linkFrom(sent[0].text, "/waitlist/confirm?token=");
  const rawToken = confirmLink.split("token=")[1];
  assert.ok(!row("SELECT id FROM waitlist_tokens WHERE token_digest = ?", rawToken), "the raw token is NOT stored (hashed at rest)");
  assert.ok(linkFrom(sent[0].text, "/waitlist/unsubscribe?token="), "every email carries a working unsubscribe link");

  // Duplicate submission: safe resend, superseding the old token; no dupes.
  const again = await join_({ email: "rider@example.com", country: "US", consent: true });
  assert.equal(again.status, 202);
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_signups"), 1, "no duplicate signup rows");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_tokens WHERE purpose='confirm' AND superseded_at IS NOT NULL"), 1, "resend supersedes the earlier token");
  const oldTokenPage = await worker.fetch(new Request(`${ORIGIN}${confirmLink.trim()}`), env);
  assert.equal(oldTokenPage.status, 410, "a superseded token no longer confirms");

  // Confirm via the newest link: interstitial GET, explicit POST, one-time.
  const newLink = linkFrom(sent[sent.length - 1].text, "/waitlist/confirm?token=").trim();
  const interstitial = await worker.fetch(new Request(`${ORIGIN}${newLink}`), env);
  assert.equal(interstitial.status, 200);
  assert.ok((await interstitial.text()).includes("Confirm my place"), "scanner-safe interstitial; only the POST consumes");
  assert.equal(row("SELECT status FROM waitlist_signups WHERE email_normalized='rider@example.com'").status, "pending", "GET alone never confirms");
  const confirmed = await worker.fetch(new Request(`${ORIGIN}${newLink}`, { method: "POST" }), env);
  assert.equal(confirmed.status, 200);
  const confirmedHtml = await confirmed.text();
  assert.ok(confirmedHtml.includes("You’re on the list.") && confirmedHtml.includes("early access becomes available in your region"));
  assert.ok(confirmedHtml.includes("Tell us about your riding"), "optional profile action offered");
  const after = row("SELECT status, confirmed_at FROM waitlist_signups WHERE email_normalized='rider@example.com'");
  assert.equal(after.status, "confirmed");
  assert.ok(after.confirmed_at);
  assert.equal(sent[sent.length - 1].subject, "You're on the MotoTrack waitlist");
  const reused = await worker.fetch(new Request(`${ORIGIN}${newLink}`, { method: "POST" }), env);
  assert.equal(reused.status, 410, "confirmation tokens are one-time");
  // Confirmed + duplicate submission: generic reply, no email, no state change.
  const before = sent.length;
  assert.equal((await join_({ email: "rider@example.com", country: "US", consent: true })).status, 202);
  assert.equal(sent.length, before, "already-confirmed submissions trigger no email");
}

// Token expiration.
{
  await join_({ email: "expiry@example.com", country: "DE", consent: true });
  db.sqlite.exec("UPDATE waitlist_tokens SET expires_at = datetime('now', '-1 minute') WHERE purpose = 'confirm' AND used_at IS NULL AND superseded_at IS NULL");
  const link = linkFrom(sent[sent.length - 1].text, "/waitlist/confirm?token=").trim();
  assert.equal((await worker.fetch(new Request(`${ORIGIN}${link}`), env)).status, 410, "expired GET");
  assert.equal((await worker.fetch(new Request(`${ORIGIN}${link}`, { method: "POST" }), env)).status, 410, "expired POST never confirms");
  assert.equal(row("SELECT status FROM waitlist_signups WHERE email_normalized='expiry@example.com'").status, "pending");
}

// Unsubscribe: one click, idempotent, suppressing - and never silently
// resubscribed by a later duplicate form submission.
{
  const unsubLink = linkFrom(sent.find((m) => m.subject === "You're on the MotoTrack waitlist").text, "/waitlist/unsubscribe?token=").trim();
  const pageResponse = await worker.fetch(new Request(`${ORIGIN}${unsubLink}`), env);
  assert.equal(pageResponse.status, 200);
  const done = await worker.fetch(new Request(`${ORIGIN}${unsubLink}`, { method: "POST" }), env);
  assert.equal(done.status, 200);
  const suppressed = row("SELECT status, unsubscribed_at FROM waitlist_signups WHERE email_normalized='rider@example.com'");
  assert.equal(suppressed.status, "unsubscribed");
  assert.ok(suppressed.unsubscribed_at, "minimal suppression record retained");
  assert.equal((await worker.fetch(new Request(`${ORIGIN}${unsubLink}`, { method: "POST" }), env)).status, 200, "idempotent");
  // A later duplicate submission does NOT silently resubscribe: status stays
  // unsubscribed; only a fresh emailed confirmation could change it.
  const generic = await join_({ email: "rider@example.com", country: "US", consent: true });
  assert.equal(generic.status, 202);
  assert.equal((await generic.json()).message, GENERIC_ACCEPTED, "no enumeration of unsubscribed state");
  assert.equal(row("SELECT status FROM waitlist_signups WHERE email_normalized='rider@example.com'").status, "unsubscribed");
}

// Anti-enumeration: new, pending, confirmed, unsubscribed, and rate-limited
// submissions are byte-identical 202s.
{
  const bodies = [];
  for (const email of ["fresh@example.com", "expiry@example.com", "rider@example.com"]) {
    const response = await join_({ email, country: "FR", consent: true });
    assert.equal(response.status, 202);
    bodies.push(await response.text());
  }
  assert.ok(bodies.every((b) => b === bodies[0]), "identical public responses across states");
}

// Rate limiting: per-email sends are bounded; the limited reply is the same
// generic 202 (no oracle), and no further email goes out.
{
  const before = sent.length;
  for (let i = 0; i < 6; i += 1) {
    assert.equal((await join_({ email: "limited@example.com", country: "IT", consent: true })).status, 202);
  }
  assert.ok(sent.length - before <= 3, `email sends capped by the daily limit (sent ${sent.length - before})`);
}

// FK integrity + static-page fall-through untouched.
{
  assert.equal(count("SELECT COUNT(*) AS n FROM pragma_foreign_key_check()"), 0);
  const passthrough = await worker.fetch(new Request(`${ORIGIN}/index.html`), env);
  assert.equal(await passthrough.text(), "static", "non-waitlist paths still serve static assets");
}


// Automated retention sweep matches the published schedule.
{
  const { runRetentionSweep } = await import("../src/waitlist-worker.js");
  const seed = (id, email, status, created, confirmed) => db.sqlite.prepare(
    "INSERT INTO waitlist_signups (id, email_normalized, country_code, status, consent_at, confirmed_at, consent_copy_version, privacy_notice_version, created_at, attribution) VALUES (?, ?, 'US', ?, ?, ?, 'v', 'v', ?, '{\"utm_source\":\"old\"}')"
  ).run(id, email, status, created, confirmed, created);
  seed("wls_old_pending", "oldpending@example.com", "pending", "2026-06-01 00:00:00", null);
  db.sqlite.prepare("INSERT INTO waitlist_tokens (id, signup_id, token_digest, purpose, expires_at) VALUES ('wlt_old', 'wls_old_pending', ?, 'confirm', '2026-06-02 00:00:00')").run("e".repeat(64));
  seed("wls_old_confirmed", "oldconfirmed@example.com", "confirmed", "2024-05-01 00:00:00", "2024-05-01 00:00:00");
  seed("wls_unsub_kept", "oldunsub@example.com", "unsubscribed", "2024-05-01 00:00:00", "2024-05-01 00:00:00");
  db.sqlite.prepare("INSERT INTO waitlist_email_deliveries (id, signup_id, purpose, provider_status, requested_at) VALUES ('wld_old', 'wls_unsub_kept', 'confirm', 'sent', '2026-01-01 00:00:00')").run();
  const swept = await runRetentionSweep(db);
  assert.equal(swept.pending_purged >= 1, true, "30-day pending purge");
  assert.equal(swept.confirmed_expired >= 1, true, "24-month confirmed expiry");
  assert.ok(swept.delivery_logs_purged >= 1, "90-day delivery-log purge");
  assert.ok(swept.attribution_cleared >= 1, "12-month attribution clearing");
  assert.equal(row("SELECT COUNT(*) AS n FROM waitlist_signups WHERE id IN ('wls_old_pending','wls_old_confirmed')").n, 0);
  assert.equal(row("SELECT status FROM waitlist_signups WHERE id = 'wls_unsub_kept'").status, "unsubscribed",
    "suppression records are NEVER auto-swept - honoring unsubscribe outlives every retention timer");
  assert.equal(count("SELECT COUNT(*) AS n FROM pragma_foreign_key_check()"), 0);
}


// Staging activation configuration contract (config PR): staging carries the
// bindings; the production (top-level) slice stays binding-free and fail-closed.
{
  const raw = readFileSync(join(import.meta.dirname, "..", "wrangler.jsonc"), "utf8");
  const config = JSON.parse(raw.split(/\r?\n/).map((line) => line.replace(/^\s*\/\/.*$/, "")).join("\n"));
  const staging = config.env.staging;
  assert.equal(staging.name, "mototrack-waitlist-staging", "isolated staging worker name");
  assert.equal(staging.d1_databases[0].binding, "WAITLIST_DB");
  assert.equal(staging.d1_databases[0].database_name, "mototrack_waitlist");
  assert.deepEqual(staging.send_email[0].allowed_destination_addresses.slice().sort(),
    ["emartinez@patchnet.net", "evan.martinez+demo@gmail.com"],
    "staging delivery restricted to exactly the two authorized test addresses");
  assert.ok(Array.isArray(staging.triggers?.crons) && staging.triggers.crons.length === 1, "retention cron enabled on staging");
  const { env: environments, ...production } = config;
  const productionText = JSON.stringify(production);
  assert.ok(!productionText.includes(staging.d1_databases[0].database_id), "production config carries no staging database id");
  assert.ok(!productionText.includes("allowed_destination_addresses"), "production config carries no staging recipient restrictions");
  assert.ok(!productionText.includes("WAITLIST_DB") && !productionText.includes("WAITLIST_EMAIL"), "production has no wait-list bindings - endpoints stay 503 fail-closed");
  assert.ok(!raw.includes("WAITLIST_RATE_PEPPER"), "the rate pepper is referenced only as a Worker secret, never in configuration");
  const workerSource = readFileSync(join(import.meta.dirname, "..", "src", "waitlist-worker.js"), "utf8");
  assert.ok(workerSource.includes("env.WAITLIST_RATE_PEPPER"), "the pepper is consumed from the secret binding in code");
}

// Staging responses are non-indexable; production responses are untouched.
{
  const stagingEnv = { ...env, WAITLIST_ENVIRONMENT: "staging" };
  const marked = await worker.fetch(new Request(`${ORIGIN}/index.html`), stagingEnv);
  assert.equal(marked.headers.get("x-robots-tag"), "noindex, nofollow", "staging pages carry noindex");
  const unmarked = await worker.fetch(new Request(`${ORIGIN}/index.html`), env);
  assert.equal(unmarked.headers.get("x-robots-tag"), null, "production responses are untouched");
}

console.log("waitlist.test.js passed");
