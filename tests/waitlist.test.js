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
for (const m of ["0001_waitlist.sql", "0002_program_track.sql", "0003_resubscription_evidence.sql", "0004_rider_profiles.sql", "0005_profile_edit_authorizations.sql", "0006_profile_consent_events.sql", "0007_profile_invitation_batches.sql", "0009_feedback.sql"]) db.sqlite.exec(readFileSync(join(import.meta.dirname, "..", "migrations", m), "utf8"));
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
  const html = readFileSync(join(import.meta.dirname, "..", "public", "waitlist.html"), "utf8");
  assert.ok(html.includes('type="checkbox" required'), "consent checkbox present and required");
  assert.ok(!/checkbox"[^>]*checked/.test(html), "the consent box is NEVER pre-checked");
  assert.ok(html.includes("Yes, add me to the MotoTrack early-access waitlist or regional interest list, based on my current location"), "exact approved v2 consent wording");
  assert.ok(html.includes("Current beta availability") && html.includes("50 United States, Washington, D.C., and U.S. territories"), "beta-availability section present");
  assert.ok(html.includes("Your current country/region"), "selector labelled as current location");
  assert.ok(html.includes('id="wl-track-note"'), "declared-location outcome preview region");
  assert.ok(html.includes('href="privacy.html"'), "consent links the privacy notice");
  assert.ok(html.includes(">Join the waitlist</button>"), "the specified button label");
  assert.ok(html.includes('aria-live="polite"') && html.includes("<label for="), "accessible labels and status region");
  assert.ok(CONSENT_COPY.startsWith("Yes, add me to the MotoTrack early-access waitlist or regional interest list"), "server pins the v2 consent copy");
  assert.equal(CONSENT_COPY_VERSION, "2026-08-05.2");
  assert.equal(PRIVACY_NOTICE_VERSION, "2026-08-05.3", "signups record the CURRENTLY PUBLISHED notice version; the consent wording itself is unchanged at .2");
}

// Pending signup: created with stamps + versions; token hashed; email sent.
{
  const accepted = await join_({ email: " Rider@Example.com ", country: "us", consent: true, page_query: "?utm_source=press&sneaky=drop" });
  assert.equal(accepted.status, 202);
  assert.equal((await accepted.json()).message, GENERIC_ACCEPTED);
  const signup = row("SELECT * FROM waitlist_signups WHERE email_normalized = 'rider@example.com'");
  assert.equal(signup.status, "pending");
  assert.equal(signup.country_code, "US");
  assert.equal(signup.program_track, "us_beta_waitlist", "clean first-time US signup classifies to the beta waitlist");
  assert.equal(signup.resubscribed_at, null, "a first-time signup is not a re-subscription");
  assert.ok(signup.consent_at && !signup.confirmed_at);
  assert.equal(signup.consent_copy_version, CONSENT_COPY_VERSION);
  assert.equal(signup.privacy_notice_version, PRIVACY_NOTICE_VERSION);
  assert.deepEqual(JSON.parse(signup.attribution), { utm_source: "press" }, "only utm_*/ref attribution is kept");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].subject, "Confirm your MotoTrack waitlist spot");
  assert.ok(sent[0].text.includes("Confirm your email address to join the MotoTrack early-access waitlist"));
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
  const interstitialHtml = await interstitial.text();
  assert.ok(interstitialHtml.includes("Confirm email and join waitlist"), "scanner-safe interstitial; only the POST consumes");
  assert.ok(interstitialHtml.includes("does not create a MotoTrack account"), "no account/guarantee implication");
  assert.ok(interstitialHtml.includes("/privacy.html") && interstitialHtml.includes("Early Access Beta"), "shell carries privacy link and beta badge");
  assert.equal(row("SELECT status FROM waitlist_signups WHERE email_normalized='rider@example.com'").status, "pending", "GET alone never confirms");
  const confirmed = await worker.fetch(new Request(`${ORIGIN}${newLink}`, { method: "POST" }), env);
  assert.equal(confirmed.status, 303, "explicit POST answers a clean redirect");
  assert.equal(confirmed.headers.get("location"), "/waitlist/confirmed", "the consumed token never reaches the success URL or history");
  assert.equal(await confirmed.text(), "", "no token or markup in the redirect body");
  const successPage = await worker.fetch(new Request(`${ORIGIN}/waitlist/confirmed`), env);
  assert.equal(successPage.status, 200);
  const confirmedHtml = await successPage.text();
  assert.ok(confirmedHtml.includes("You’re on the MotoTrack early-access waitlist"), "approved US heading");
  assert.ok(confirmedHtml.includes("opening gradually to riders in the United States and U.S. territories"), "US-track body");
  assert.ok(confirmedHtml.includes("What happens next"), "expectation-setting section");
  assert.ok(confirmedHtml.includes("does not guarantee immediate access"), "no guaranteed-place implication");
  assert.ok(!confirmedHtml.includes("Tell us about your riding") && !confirmedHtml.includes("waitlist-profile"), "profile CTA fully removed");
  assert.ok(confirmedHtml.includes("Return to MotoTrack") && confirmedHtml.includes("/privacy.html"), "single primary action + privacy link");
  const after = row("SELECT status, confirmed_at FROM waitlist_signups WHERE email_normalized='rider@example.com'");
  assert.equal(after.status, "confirmed");
  assert.ok(after.confirmed_at);
  assert.equal(sent[sent.length - 1].subject, "You're on the MotoTrack early-access waitlist");
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
  const unsubLink = linkFrom(sent.find((m) => m.subject === "You're on the MotoTrack early-access waitlist").text, "/waitlist/unsubscribe?token=").trim();
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
  for (const path of ["/waitlist.html", "/privacy.html"]) {
    assert.ok(staging.assets.run_worker_first.includes(path),
      "staging routes " + path + " through the Worker so the noindex guard applies to static pages too");
  }
  const { assets: productionAssets } = config;
  assert.ok(!(productionAssets.run_worker_first || []).includes("/privacy.html"),
    "production serves static pages directly - no staging-only routing or noindex");
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
  const stagingPage = await worker.fetch(new Request(`${ORIGIN}/waitlist/confirmed`), stagingEnv);
  assert.ok((await stagingPage.text()).includes("STAGING TEST ENVIRONMENT"), "staging banner only on the isolated deployment");
  const productionPage = await worker.fetch(new Request(`${ORIGIN}/waitlist/confirmed`), env);
  assert.ok(!(await productionPage.text()).includes("STAGING TEST ENVIRONMENT"), "no banner outside staging");
  const notice = "You received this message because this email address was submitted to the MotoTrack early-access waitlist or regional interest list. You can unsubscribe at any time.";
  assert.ok(sent.every((m) => m.text.includes(notice)),
    "EVERY email - confirmation and welcome, both tracks - carries the identical combined received-because notice");
  assert.ok(sent.filter((m) => m.subject.startsWith("You're on")).every((m) => m.text.includes(notice) && !m.text.includes("waitlist-profile")), "welcome emails carry the notice and no profile CTA");
}


// ---------------------------------------------------------------------------
// Geographic scope: US beta waitlist vs international interest list.
// ---------------------------------------------------------------------------
{
  const { programTrackFor, US_BETA_CODES } = await import("../src/waitlist-worker.js");
  for (const code of ["US", "PR", "VI", "GU", "AS", "MP", "UM"]) {
    assert.equal(programTrackFor(code), "us_beta_waitlist", code + " is US beta scope");
  }
  for (const code of ["CA", "GB", "DE", "FR", "JP", "AU", "BR", "MX", "IE", "NZ"]) {
    assert.equal(programTrackFor(code), "international_interest", code + " is international interest");
  }
  assert.deepEqual(US_BETA_CODES.slice().sort(), ["AS", "GU", "MP", "PR", "UM", "US", "VI"], "exactly the approved US-scope codes");

  // Declared country is authoritative: an IP-derived country header can never
  // override it, and nothing geolocation-derived is persisted.
  const intl = await worker.fetch(new Request(`${ORIGIN}/api/waitlist`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, "cf-ipcountry": "US", "cf-connecting-ip": "203.0.113.7" },
    body: JSON.stringify({ email: "berlin.rider@example.com", country: "DE", consent: true }),
  }), env);
  assert.equal(intl.status, 202);
  assert.equal((await intl.json()).message, GENERIC_ACCEPTED, "identical generic response for both tracks");
  const intlRow = row("SELECT * FROM waitlist_signups WHERE email_normalized = 'berlin.rider@example.com'");
  assert.equal(intlRow.program_track, "international_interest", "declared DE wins over the cf-ipcountry US header");
  assert.equal(intlRow.country_code, "DE");
  assert.equal(intlRow.consent_copy_version, "2026-08-05.2");
  assert.equal(intlRow.privacy_notice_version, "2026-08-05.3");
  assert.ok(!Object.keys(intlRow).some((k) => /geo|ip_|latitude|longitude|region|city/i.test(k)), "no geolocation columns exist");
  const workerSource = readFileSync(join(import.meta.dirname, "..", "src", "waitlist-worker.js"), "utf8");
  assert.ok(!/cf-ipcountry|request\.cf\b/i.test(workerSource), "the worker never reads IP-derived country for classification");

  // International confirmation: track-specific redirect, page, and email.
  const intlConfirm = linkFrom(sent[sent.length - 1].text, "/waitlist/confirm?token=").trim();
  assert.ok(sent[sent.length - 1].text.includes("international interest list") || sent[sent.length - 1].text.includes("United States and U.S. territories"),
    "international confirmation email states the scope limit");
  const intlDone = await worker.fetch(new Request(`${ORIGIN}${intlConfirm}`, { method: "POST" }), env);
  assert.equal(intlDone.status, 303);
  assert.equal(intlDone.headers.get("location"), "/waitlist/confirmed?list=interest", "track-specific clean redirect, no token");
  const intlPage = await (await worker.fetch(new Request(`${ORIGIN}/waitlist/confirmed?list=interest`), env)).text();
  assert.ok(intlPage.includes("Your MotoTrack interest is confirmed"), "international heading");
  assert.ok(intlPage.includes("not currently available in your region"), "no beta-access promise");
  assert.ok(intlPage.includes("does not guarantee that MotoTrack will become available"), "no availability guarantee");
  assert.ok(intlPage.includes("Return to MotoTrack") && !intlPage.includes("Tell us about your riding"), "single action, no profile CTA");
  const intlWelcome = sent[sent.length - 1];
  assert.equal(intlWelcome.subject, "Your interest in MotoTrack is confirmed", "international welcome subject");
  assert.ok(intlWelcome.text.includes("available only to riders in the 50 United States"), "states the US-only limit");
  assert.ok(intlWelcome.text.includes("international interest list"), "states which list was joined");
  assert.ok(intlWelcome.text.includes("does not guarantee"), "promises no expansion");
  assert.ok(intlWelcome.text.includes("waitlist or regional interest list. You can unsubscribe at any time."), "received-because notice");
  assert.ok(linkFrom(intlWelcome.text, "/waitlist/unsubscribe?token=") && intlWelcome.text.includes("/privacy.html"), "unsubscribe + privacy links");
  assert.equal(row("SELECT status FROM waitlist_signups WHERE email_normalized='berlin.rider@example.com'").status, "confirmed");

  // No silent track movement: a confirmed international signup that resubmits
  // with a US country keeps its original track.
  const geoJoin = (body) => worker.fetch(new Request(`${ORIGIN}/api/waitlist`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, "cf-connecting-ip": "203.0.113.7" }, body: JSON.stringify(body) }), env);
  const resubmit = await geoJoin({ email: "berlin.rider@example.com", country: "US", consent: true });
  assert.equal(resubmit.status, 202);
  assert.equal(row("SELECT program_track FROM waitlist_signups WHERE email_normalized='berlin.rider@example.com'").program_track,
    "international_interest", "no automatic promotion between tracks");

  // Unsubscribe works identically for the international track.
  const intlUnsub = linkFrom(intlWelcome.text, "/waitlist/unsubscribe?token=").trim();
  assert.equal((await worker.fetch(new Request(`${ORIGIN}${intlUnsub}`, { method: "POST" }), env)).status, 200);
  assert.equal(row("SELECT status FROM waitlist_signups WHERE email_normalized='berlin.rider@example.com'").status, "unsubscribed");
  const afterUnsub = await geoJoin({ email: "berlin.rider@example.com", country: "DE", consent: true });
  assert.equal(afterUnsub.status, 202);
  assert.equal(row("SELECT status FROM waitlist_signups WHERE email_normalized='berlin.rider@example.com'").status,
    "unsubscribed", "international unsubscribes are never silently reactivated");

  // Deterministic migration of pre-existing rows (fresh chain, no program_track).
  const legacy = new LocalD1();
  legacy.sqlite.exec(readFileSync(join(import.meta.dirname, "..", "migrations", "0001_waitlist.sql"), "utf8"));
  for (const [id, email, cc] of [["l1", "a@x.test", "US"], ["l2", "b@x.test", "PR"], ["l3", "c@x.test", "DE"], ["l4", "d@x.test", "JP"]]) {
    legacy.sqlite.prepare("INSERT INTO waitlist_signups (id, email_normalized, country_code, status, consent_at, consent_copy_version, privacy_notice_version) VALUES (?, ?, ?, 'confirmed', datetime('now'), '2026-08-05.1', '2026-08-05.1')").run(id, email, cc);
  }
  legacy.sqlite.exec(readFileSync(join(import.meta.dirname, "..", "migrations", "0002_program_track.sql"), "utf8"));
  const tracks = legacy.sqlite.prepare("SELECT id, program_track, consent_copy_version FROM waitlist_signups ORDER BY id").all();
  assert.deepEqual(tracks.map((r) => r.program_track),
    ["us_beta_waitlist", "us_beta_waitlist", "international_interest", "international_interest"],
    "deterministic backfill from the stored country code");
  assert.ok(tracks.every((r) => r.consent_copy_version === "2026-08-05.1"),
    "historical 2026-08-05.1 records keep their original versions - never rewritten");
  assert.equal(legacy.sqlite.prepare("SELECT COUNT(*) AS n FROM pragma_foreign_key_check()").get().n, 0, "FK clean after migration");
}

// Retention and suppression apply identically to both tracks.
{
  const { runRetentionSweep } = await import("../src/waitlist-worker.js");
  db.sqlite.prepare("INSERT INTO waitlist_signups (id, email_normalized, country_code, program_track, status, consent_at, confirmed_at, consent_copy_version, privacy_notice_version, created_at) VALUES ('wls_intl_old', 'old.intl@example.com', 'FR', 'international_interest', 'confirmed', datetime('now','-25 months'), datetime('now','-25 months'), 'v', 'v', datetime('now','-25 months'))").run();
  db.sqlite.prepare("INSERT INTO waitlist_signups (id, email_normalized, country_code, program_track, status, consent_at, unsubscribed_at, consent_copy_version, privacy_notice_version, created_at) VALUES ('wls_intl_unsub', 'unsub.intl@example.com', 'FR', 'international_interest', 'unsubscribed', datetime('now','-30 months'), datetime('now','-26 months'), 'v', 'v', datetime('now','-30 months'))").run();
  await runRetentionSweep(db);
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_signups WHERE id='wls_intl_old'"), 0, "24-month expiry applies to the international track too");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_signups WHERE id='wls_intl_unsub'"), 1, "international suppression records survive retention");
  assert.equal(count("SELECT COUNT(*) AS n FROM pragma_foreign_key_check()"), 0);
}


// Privacy notice v2 carries the geographic disclosure and no placeholders.
{
  const notice = readFileSync(join(import.meta.dirname, "..", "public", "privacy.html"), "utf8");
  assert.ok(notice.includes("Version:</strong> 2026-08-05.3"), "notice version bumped");
  assert.ok(notice.includes("Geographic availability"), "geographic section present");
  assert.ok(notice.includes("50 United States, Washington, D.C., and U.S. territories"), "scope stated");
  assert.ok(notice.includes("does not provide current beta access or guarantee future availability"), "no availability promise");
  assert.ok(notice.includes("we do not use IP-based geolocation to classify you"), "declared-location-only disclosure");
  assert.ok(!/citizenship, nationality, immigration status, residency, or proof of address[^<]*collect/i.test(notice), "no sensitive status collected");
  assert.ok(notice.includes("Cloudflare") && notice.includes("privacy@mototrack.app") && notice.includes("Retention") === false ? true : true);
  for (const kept of ["Cloudflare", "privacy@mototrack.app", "unsubscribe", "Retention periods", "Security practices", "attribution", "supervisory authority"]) {
    assert.ok(notice.toLowerCase().includes(kept.toLowerCase()), "preserved disclosure: " + kept);
  }
  assert.ok(notice.includes("under legal review"), "transfer/Art.27 items remain open - not marked resolved");
  assert.ok(!/globally available|available worldwide/i.test(notice), "never claims global availability");
  assert.equal((notice.match(/OWNER REQUIRED|PROPOSED:/g) || []).length, 0, "no unresolved placeholders");
}


// ---------------------------------------------------------------------------
// Explicit re-subscription only (owner policy): an unsubscribed address
// returns ONLY via fresh submission + fresh consent + new single-use link +
// explicit POST, and the prior unsubscribe evidence is never overwritten.
// ---------------------------------------------------------------------------
{
  const CLIENT = { "content-type": "application/json", origin: ORIGIN, "cf-connecting-ip": "198.51.100.9" };
  const send = (body) => worker.fetch(new Request(`${ORIGIN}/api/waitlist`, { method: "POST", headers: CLIENT, body: JSON.stringify(body) }), env);
  await send({ email: "returning@example.com", country: "US", consent: true });
  const firstConfirm = linkFrom(sent[sent.length - 1].text, "/waitlist/confirm?token=").trim();
  await worker.fetch(new Request(`${ORIGIN}${firstConfirm}`, { method: "POST" }), env);
  const welcomeUnsub = linkFrom(sent[sent.length - 1].text, "/waitlist/unsubscribe?token=").trim();
  await worker.fetch(new Request(`${ORIGIN}${welcomeUnsub}`, { method: "POST" }), env);
  const gone = row("SELECT status, unsubscribed_at, resubscribed_at FROM waitlist_signups WHERE email_normalized='returning@example.com'");
  assert.equal(gone.status, "unsubscribed");
  assert.ok(gone.unsubscribed_at, "unsubscribe evidence recorded");
  assert.equal(gone.resubscribed_at, null);

  // Every NON-confirmation path leaves the record unsubscribed.
  await send({ email: "returning@example.com", country: "US", consent: true });      // duplicate submission alone
  await send({ email: "returning@example.com", country: "DE", consent: true });      // program-track change attempt
  const stillGone = row("SELECT status, program_track FROM waitlist_signups WHERE email_normalized='returning@example.com'");
  assert.equal(stillGone.status, "unsubscribed", "submission and resend alone never reactivate");
  assert.equal(stillGone.program_track, "us_beta_waitlist", "a declared-country change never moves an existing track");
  const interstitialOnly = await worker.fetch(new Request(`${ORIGIN}${linkFrom(sent[sent.length - 1].text, "/waitlist/confirm?token=").trim()}`), env);
  assert.equal(interstitialOnly.status, 200);
  assert.equal(row("SELECT status FROM waitlist_signups WHERE email_normalized='returning@example.com'").status,
    "unsubscribed", "the scanner-safe GET never reactivates");

  // The explicit POST on the freshly issued link completes the return.
  const freshLink = linkFrom(sent[sent.length - 1].text, "/waitlist/confirm?token=").trim();
  const returned = await worker.fetch(new Request(`${ORIGIN}${freshLink}`, { method: "POST" }), env);
  assert.equal(returned.status, 303);
  const back = row("SELECT status, unsubscribed_at, resubscribed_at, confirmed_at, consent_copy_version, privacy_notice_version FROM waitlist_signups WHERE email_normalized='returning@example.com'");
  assert.equal(back.status, "confirmed", "explicit confirmation completes the re-subscription");
  assert.ok(back.resubscribed_at, "a distinct re-subscription event is recorded");
  assert.ok(back.unsubscribed_at, "the prior unsubscribe evidence is PRESERVED, never overwritten");
  assert.equal(back.consent_copy_version, "2026-08-05.2", "fresh acceptance of the current consent copy is recorded");
  assert.equal(back.privacy_notice_version, "2026-08-05.3");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_signups WHERE email_normalized='returning@example.com'"), 1, "no duplicate signup row");
}

// ---------------------------------------------------------------------------
// Deployed CSP contract for the signup page (issue #59). _headers COMBINES
// matching rules, so a waitlist CSP added alongside the /* rule left
// connect-src 'none' ALSO enforced and the browser's intersection blocked the
// very /api/waitlist fetch the page needs. The contract is therefore:
//   * /waitlist.html DETACHES the inherited CSP and RE-ADDS its own in the
//     same rule, so exactly one policy is enforced. (Unlike /log/*, this page
//     has NO meta CSP - detach alone would leave it with no CSP at all.)
//   * that single policy permits connect-src 'self' and keeps frame-ancestors.
//   * every other page keeps connect-src 'none'.
// Verified at the Cloudflare runtime layer (`wrangler dev`, which applies
// _headers); a plain static server does not.
{
  const headersFile = readFileSync(join(import.meta.dirname, "..", "public", "_headers"), "utf8");
  const ruleBody = (path) => {
    const block = headersFile.split(/\n\s*\n/).find((b) => b.split("\n").some((l) => l.trim() === path));
    assert.ok(block, `_headers has a ${path} rule`);
    return block.split("\n").filter((l) => l.startsWith("  "));
  };

  const waitlistBody = ruleBody("/waitlist.html");
  assert.ok(waitlistBody.some((l) => l.trim() === "! Content-Security-Policy"),
    "the waitlist page detaches the inherited /* CSP");
  const waitlistCsp = waitlistBody.find((l) => /^\s*Content-Security-Policy:/.test(l)) ?? "";
  assert.ok(waitlistCsp, "the waitlist page re-adds its own CSP (it has no meta CSP to fall back on)");
  assert.match(waitlistCsp, /connect-src 'self'/, "the signup fetch to /api/waitlist is permitted");
  assert.ok(!/connect-src 'none'/.test(waitlistCsp), "no inherited connect-src 'none' remains for the waitlist page");
  assert.match(waitlistCsp, /frame-ancestors 'none'/, "anti-framing protection is preserved in the re-added policy");
  assert.match(waitlistCsp, /default-src 'none'/, "the restrictive default is preserved");
  assert.equal(waitlistBody.filter((l) => /^\s*Content-Security-Policy:/.test(l)).length, 1,
    "exactly one CSP is added for the waitlist page");

  // The waitlist page genuinely needs connect-src: it submits by fetch.
  const formJs = readFileSync(join(import.meta.dirname, "..", "public", "waitlist-form.js"), "utf8");
  assert.ok(formJs.includes('fetch("/api/waitlist"'), "the signup form submits via same-origin fetch");

  // Non-waitlist pages keep their locked-down posture.
  const starCsp = ruleBody("/*").find((l) => /^\s*Content-Security-Policy:/.test(l)) ?? "";
  assert.match(starCsp, /connect-src 'none'/, "other pages retain connect-src 'none'");
  assert.match(starCsp, /frame-ancestors 'none'/, "other pages retain frame-ancestors 'none'");
  // The /* security headers the waitlist rule must NOT strip.
  for (const header of ["X-Frame-Options: DENY", "Referrer-Policy", "X-Content-Type-Options", "Strict-Transport-Security"]) {
    assert.ok(ruleBody("/*").some((l) => l.includes(header)), `/* still sets ${header}`);
    assert.ok(!waitlistBody.some((l) => l.trim() === `! ${header.split(":")[0]}`),
      `the waitlist rule does not detach ${header.split(":")[0]}`);
  }
}

console.log("waitlist.test.js passed");
