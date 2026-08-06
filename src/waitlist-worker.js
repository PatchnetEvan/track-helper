// MotoTrack public wait list — confirmation-based, consent-first, minimal.
//
// The public site stays a static-assets site; this Worker fronts ONLY the
// wait-list routes (run_worker_first) and passes everything else to assets.
// Fail-closed: without the WAITLIST_DB and an email provider the endpoints
// answer a structured 503 and write nothing. No cookies are set anywhere.
// Anti-enumeration: every well-formed submission receives the identical
// generic 202 whether the address is new, pending, confirmed, unsubscribed,
// or rate limited.

import { revokeProfileInvitations, sweepProfileRetention } from "./waitlist-profile-service.js";

export const CONSENT_COPY_VERSION = "2026-08-05.2";
export const PRIVACY_NOTICE_VERSION = "2026-08-05.2";
export const CONSENT_COPY =
  "Yes, add me to the MotoTrack early-access waitlist or regional interest list, based on my current location, "
  + "and email me about early access and MotoTrack product updates. I can unsubscribe at any time. "
  + "See the Privacy Policy.";

// Geographic scope: the current beta is limited to the 50 U.S. states,
// Washington, D.C. (both 'US'), and U.S. territories. Everyone else may
// register interest. Classification uses ONLY the rider's DECLARED
// country/region - never Cloudflare IP geolocation, which is neither read
// nor stored for this purpose, and can never override a declaration.
export const US_BETA_CODES = Object.freeze(["US", "PR", "VI", "GU", "AS", "MP", "UM"]);
export function programTrackFor(countryCode) {
  return US_BETA_CODES.includes(countryCode) ? "us_beta_waitlist" : "international_interest";
}
export const GENERIC_ACCEPTED = "Check your email to confirm your place on the MotoTrack waitlist.";
export const CONFIRM_TOKEN_TTL_MINUTES = 24 * 60;
export const EMAIL_SEND_LIMIT_PER_DAY = 3;
export const CLIENT_SEND_LIMIT_PER_HOUR = 10;

// ISO 3166-1 alpha-2 (current assigned codes).
const COUNTRY_CODES = new Set(("AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW").split(" "));

function id(prefix) { return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`; }

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function mintToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function normalizedEmail(value) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 254 ? email : null;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" },
  });
}

function page(env, title, bodyHtml, status = 200) {
  const stagingBanner = String(env?.WAITLIST_ENVIRONMENT ?? "") === "staging"
    ? '<p class="wl-staging">STAGING TEST ENVIRONMENT — not the public MotoTrack site</p>' : "";
  return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" /><meta name="referrer" content="no-referrer" /><title>${title} — MotoTrack</title>
<link rel="stylesheet" href="/styles.css" /></head>
<body><div class="wl-shell">
<header class="wl-header"><a class="wordmark" href="https://mototrack.app/" aria-label="MotoTrack home"><span class="mark" aria-hidden="true"></span><span>MotoTrack</span></a><span class="wl-badge">Early Access Beta</span></header>
${stagingBanner}
<main class="doc">${bodyHtml}</main>
<footer class="wl-footer"><a href="/privacy.html">Privacy Policy</a><a href="https://mototrack.app/">Return to MotoTrack</a></footer>
</div></body></html>`, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    },
  });
}

const EXPIRED_PAGE = (env) => page(env, "Link expired", `
  <h1>That link is no longer valid</h1>
  <p>It may have expired or already been used. You can join the waitlist again from the signup page to get a fresh confirmation email.</p>
  <p><a class="back" href="/waitlist.html">Back to the waitlist</a></p>`, 410);

function database(env) { return env?.WAITLIST_DB ?? null; }

// Email provider: an explicitly injected test provider, or the configured
// platform binding. Never an implicit fallback; missing provider = 503.
function emailProviderOrNull(env) {
  if (env?.WAITLIST_EMAIL_TEST && typeof env.WAITLIST_EMAIL_TEST.send === "function") return env.WAITLIST_EMAIL_TEST;
  if (env?.WAITLIST_EMAIL && typeof env.WAITLIST_EMAIL.send === "function") {
    return {
      async send({ to, subject, text }) {
        const from = String(env.WAITLIST_EMAIL_FROM || "MotoTrack <waitlist@mototrack.app>");
        const raw = [`From: ${from}`, `To: ${to}`, `Subject: ${subject}`, "MIME-Version: 1.0",
          'Content-Type: text/plain; charset="utf-8"', "", text].join("\r\n");
        const { EmailMessage } = await import("cloudflare:email");
        const address = /<([^>]+)>/.exec(from)?.[1] ?? from;
        await env.WAITLIST_EMAIL.send(new EmailMessage(address, to, raw));
        return { status: "sent" };
      },
    };
  }
  return null;
}

function sameOrigin(request) {
  const origin = request.headers.get("origin");
  return typeof origin === "string" && origin === new URL(request.url).origin;
}

// Attribution: ONLY utm_*/ref parameters the signup page URL already carried,
// forwarded by the form as page_query. Nothing else; never headers, never IP.
function attributionFrom(pageQuery) {
  if (typeof pageQuery !== "string" || !pageQuery || pageQuery.length > 1024) return null;
  const kept = {};
  for (const [key, value] of new URLSearchParams(pageQuery)) {
    if ((/^utm_[a-z_]{1,24}$/.test(key) || key === "ref") && value.length <= 200) kept[key] = value;
  }
  return Object.keys(kept).length ? JSON.stringify(kept) : null;
}

async function underLimit(db, bucketKey, windowStart, limit) {
  await db.prepare(`INSERT INTO waitlist_rate_buckets (bucket_key, window_start, send_count) VALUES (?, ?, 0)
    ON CONFLICT (bucket_key, window_start) DO NOTHING`).bind(bucketKey, windowStart).run();
  const raised = await db.prepare(`UPDATE waitlist_rate_buckets SET send_count = send_count + 1
    WHERE bucket_key = ? AND window_start = ? AND send_count < ?`).bind(bucketKey, windowStart, limit).run();
  return Number(raised?.meta?.changes ?? 0) === 1;
}

async function mintAndStoreToken(db, signupId, purpose, ttlMinutes) {
  const raw = mintToken();
  await db.prepare(`UPDATE waitlist_tokens SET superseded_at = datetime('now')
    WHERE signup_id = ? AND purpose = ? AND used_at IS NULL AND superseded_at IS NULL`).bind(signupId, purpose).run();
  await db.prepare(`INSERT INTO waitlist_tokens (id, signup_id, token_digest, purpose, expires_at)
    VALUES (?, ?, ?, ?, ${ttlMinutes ? `datetime('now', '+${ttlMinutes} minutes')` : "NULL"})`)
    .bind(id("wlt"), signupId, await sha256Hex(raw), purpose).run();
  return raw;
}

async function activeUnsubscribeToken(db, signupId) {
  const existing = await db.prepare(`SELECT id FROM waitlist_tokens
    WHERE signup_id = ? AND purpose = 'unsubscribe' AND used_at IS NULL AND superseded_at IS NULL`).bind(signupId).first();
  if (existing) {
    // Raw tokens are never stored, so a fresh link means a fresh token.
    return mintAndStoreToken(db, signupId, "unsubscribe", 0);
  }
  return mintAndStoreToken(db, signupId, "unsubscribe", 0);
}

function trackOf(signup) {
  return signup?.program_track === "international_interest" ? "international_interest" : "us_beta_waitlist";
}

async function sendConfirmationEmail(env, db, provider, origin, signup) {
  const confirmToken = await mintAndStoreToken(db, signup.id, "confirm", CONFIRM_TOKEN_TTL_MINUTES);
  const unsubToken = await activeUnsubscribeToken(db, signup.id);
  const result = await provider.send({
    to: signup.email_normalized,
    subject: "Confirm your MotoTrack waitlist spot",
    text: [
      "Confirm your email address to join the MotoTrack early-access waitlist:",
      `${origin}/waitlist/confirm?token=${confirmToken}`,
      "",
      trackOf(signup) === "international_interest"
        ? "The link is single-use and expires in 24 hours. MotoTrack's current early-access beta is available only in the United States and U.S. territories; confirming adds you to the international interest list. It does not create a MotoTrack account, provide beta access, or guarantee future availability in your region."
        : "The link is single-use and expires in 24 hours. Confirming your email adds you to the waitlist. It does not create a MotoTrack account or give immediate access to the beta.",
      "If you didn't request this, you can ignore this email and nothing will be added.",
      "",
      "You received this message because this email address was submitted to the MotoTrack early-access waitlist or regional interest list. You can unsubscribe at any time.",
      `Unsubscribe: ${origin}/waitlist/unsubscribe?token=${unsubToken}`,
      `Privacy Policy: ${origin}/privacy.html`,
    ].join("\n"),
  });
  await db.prepare(`INSERT INTO waitlist_email_deliveries (id, signup_id, purpose, provider_status) VALUES (?, ?, 'confirm', ?)`)
    .bind(id("wld"), signup.id, String(result?.status ?? "unknown")).run();
}

async function sendWelcomeEmail(env, db, provider, origin, signup) {
  const unsubToken = await activeUnsubscribeToken(db, signup.id);
  const result = await provider.send({
    to: signup.email_normalized,
    subject: trackOf(signup) === "international_interest"
      ? "Your interest in MotoTrack is confirmed"
      : "You're on the MotoTrack early-access waitlist",
    text: (trackOf(signup) === "international_interest" ? [
      "Your interest in MotoTrack is confirmed.",
      "",
      "MotoTrack is being built for track-day riders and racers to preserve session data, setup notes, tire information, and rider observations.",
      "",
      "MotoTrack's current early-access beta is available only to riders in the 50 United States, Washington, D.C., and U.S. territories. You have joined the international interest list.",
      "Registering interest does not guarantee that MotoTrack will become available in your location or by a particular date. We may email you if MotoTrack expands to your region.",
    ] : [
      "You're on the MotoTrack early-access waitlist.",
      "",
      "MotoTrack is being built for track-day riders and racers to preserve session data, setup notes, tire information, and rider observations.",
      "",
      "What happens next: MotoTrack is being tested with real track-day data and limited invited users. Access will open gradually based on beta capacity and supported use cases, and you will receive an email when access becomes available.",
      "Joining the waitlist does not guarantee immediate access or a specific invitation date. Beta features may change as testing continues.",
    ]).concat([
      "",
      "",
      "You received this message because this email address was submitted to the MotoTrack early-access waitlist or regional interest list. You can unsubscribe at any time.",
      `Unsubscribe: ${origin}/waitlist/unsubscribe?token=${unsubToken}`,
      `Privacy Policy: ${origin}/privacy.html`,
    ]).join("\n"),
  });
  await db.prepare(`INSERT INTO waitlist_email_deliveries (id, signup_id, purpose, provider_status) VALUES (?, ?, 'welcome', ?)`)
    .bind(id("wld"), signup.id, String(result?.status ?? "unknown")).run();
}

async function tokenRow(db, rawToken, purpose) {
  if (typeof rawToken !== "string" || rawToken.length < 20 || rawToken.length > 128) return null;
  return db.prepare(`SELECT t.id, t.signup_id, t.expires_at, t.used_at, t.superseded_at FROM waitlist_tokens t
    WHERE t.token_digest = ? AND t.purpose = ?`).bind(await sha256Hex(rawToken), purpose).first();
}

async function handleJoin(request, env) {
  const db = database(env);
  const provider = emailProviderOrNull(env);
  if (!db || !provider) return json({ error: "waitlist_unavailable" }, 503);
  if (!sameOrigin(request)) return json({ error: "request_rejected" }, 403);
  let body;
  try { body = await request.json(); } catch { body = null; }
  const email = normalizedEmail(body?.email);
  const country = typeof body?.country === "string" ? body.country.trim().toUpperCase() : "";
  if (!email) return json({ error: "invalid_request", field: "email" }, 400);
  if (!COUNTRY_CODES.has(country)) return json({ error: "invalid_request", field: "country" }, 400);
  if (body?.consent !== true) return json({ error: "consent_required" }, 400);

  const origin = new URL(request.url).origin;
  const today = new Date().toISOString().slice(0, 10);
  const hour = new Date().toISOString().slice(0, 13);
  const clientKey = await sha256Hex(`client:${request.headers.get("cf-connecting-ip") ?? "unknown"}:${String(env.WAITLIST_RATE_PEPPER ?? "")}`);
  if (!(await underLimit(db, clientKey, hour, CLIENT_SEND_LIMIT_PER_HOUR))) return json({ ok: true, message: GENERIC_ACCEPTED }, 202);
  const emailKey = await sha256Hex(`email:${email}`);
  if (!(await underLimit(db, emailKey, today, EMAIL_SEND_LIMIT_PER_DAY))) return json({ ok: true, message: GENERIC_ACCEPTED }, 202);

  const existing = await db.prepare(`SELECT id, email_normalized, status, program_track FROM waitlist_signups WHERE email_normalized = ?`).bind(email).first();
  if (!existing) {
    const signupId = id("wls");
    await db.prepare(`INSERT INTO waitlist_signups
      (id, email_normalized, country_code, program_track, status, consent_at, consent_copy_version, privacy_notice_version, signup_source, attribution)
      VALUES (?, ?, ?, ?, 'pending', datetime('now'), ?, ?, ?, ?)`)
      .bind(signupId, email, country, programTrackFor(country), CONSENT_COPY_VERSION, PRIVACY_NOTICE_VERSION,
        typeof body?.source === "string" ? body.source.slice(0, 120) : "waitlist.html",
        attributionFrom(body?.page_query)).run();
    await sendConfirmationEmail(env, db, provider, origin, { id: signupId, email_normalized: email, program_track: programTrackFor(country) });
  } else if (existing.status === "pending" || existing.status === "unsubscribed") {
    // Refresh consent stamps on an AFFIRMATIVE re-submission; status only ever
    // becomes confirmed through the emailed confirmation link, so a previous
    // unsubscribe is never silently reversed by a form post.
    // program_track is deliberately NOT updated: an existing pending or
    // confirmed signup keeps its track. Moving between tracks requires an
    // explicit future workflow, never an inferred or automatic promotion.
    await db.prepare(`UPDATE waitlist_signups SET consent_at = datetime('now'), consent_copy_version = ?,
      privacy_notice_version = ?, updated_at = datetime('now') WHERE id = ?`)
      .bind(CONSENT_COPY_VERSION, PRIVACY_NOTICE_VERSION, existing.id).run();
    await sendConfirmationEmail(env, db, provider, origin, existing);
  }
  // Already-confirmed: no email, no state change - and the same generic reply.
  return json({ ok: true, message: GENERIC_ACCEPTED }, 202);
}

async function handleConfirm(request, env, url) {
  const db = database(env);
  if (!db) return json({ error: "waitlist_unavailable" }, 503);
  const raw = url.searchParams.get("token") ?? "";
  if (request.method === "GET") {
    // Interstitial with an explicit button: mail scanners that prefetch the
    // GET can never confirm anyone; only the POST consumes the token.
    const row = await tokenRow(db, raw, "confirm");
    const usable = row && !row.used_at && !row.superseded_at && row.expires_at > new Date().toISOString().replace("T", " ").slice(0, 19);
    if (!usable) return EXPIRED_PAGE(env);
    return page(env, "Confirm your email", `
      <h1>Confirm your email</h1>
      <p>Confirm your email address to join the MotoTrack early-access waitlist.</p>
      <p>MotoTrack is being built for track-day riders and racers to preserve session data, setup notes, tire information, and rider observations.</p>
      <form method="post" action="/waitlist/confirm?token=${encodeURIComponent(raw)}">
        <button type="submit">Confirm email and join waitlist</button>
      </form>
      <p>Confirming your email adds you to the waitlist. It does not create a MotoTrack account or give immediate access to the beta.</p>`);
  }
  const row = await tokenRow(db, raw, "confirm");
  if (!row) return EXPIRED_PAGE(env);
  const claimed = await db.prepare(`UPDATE waitlist_tokens SET used_at = datetime('now')
    WHERE id = ? AND used_at IS NULL AND superseded_at IS NULL AND expires_at > datetime('now')`).bind(row.id).run();
  if (Number(claimed?.meta?.changes ?? 0) !== 1) return EXPIRED_PAGE(env);
  // A confirmation arriving on a previously UNSUBSCRIBED record is an
  // explicit re-subscription: it required a fresh submission, fresh consent
  // acceptance at the current version, a newly issued single-use link, and
  // this POST. Record it as its own event and NEVER clear unsubscribed_at -
  // the history must read unsubscribed-then-resubscribed.
  const priorStatus = (await db.prepare("SELECT status FROM waitlist_signups WHERE id = ?").bind(row.signup_id).first())?.status ?? null;
  await db.prepare(`UPDATE waitlist_signups SET status = 'confirmed', confirmed_at = datetime('now'),
      resubscribed_at = CASE WHEN ? = 'unsubscribed' THEN datetime('now') ELSE resubscribed_at END,
      updated_at = datetime('now')
    WHERE id = ? AND status != 'confirmed'`).bind(priorStatus, row.signup_id).run();
  const signup = await db.prepare(`SELECT id, email_normalized, program_track FROM waitlist_signups WHERE id = ?`).bind(row.signup_id).first();
  const provider = emailProviderOrNull(env);
  if (provider && signup) await sendWelcomeEmail(env, db, provider, url.origin, signup);
  // Clean-path redirect: the consumed token never appears in the success
  // page's address, history entry, markup, or referrer output.
  const confirmedPath = trackOf(signup) === "international_interest"
    ? "/waitlist/confirmed?list=interest" : "/waitlist/confirmed";
  return new Response(null, { status: 303, headers: { location: confirmedPath, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}

function confirmedPage(env, track) {
  if (track === "international_interest") {
    return page(env, "Your MotoTrack interest is confirmed", `
      <h1>Your MotoTrack interest is confirmed</h1>
      <p>MotoTrack beta access is not currently available in your region. We’ve recorded your interest and may email you if MotoTrack expands to your region.</p>
      <p>Registering interest does not guarantee that MotoTrack will become available in your location or by a particular date.</p>
      <p><a class="back" href="https://mototrack.app/">Return to MotoTrack</a></p>`);
  }
  return page(env, "You’re on the MotoTrack early-access waitlist", `
    <h1>You’re on the MotoTrack early-access waitlist</h1>
    <p>Your email has been confirmed. MotoTrack’s initial beta is opening gradually to riders in the United States and U.S. territories. We’ll email you when an appropriate early-access opportunity becomes available.</p>
    <h2>What happens next</h2>
    <ol>
      <li>MotoTrack is being tested with real track-day data and limited invited users.</li>
      <li>Access will open gradually based on beta capacity and supported use cases.</li>
      <li>You will receive an email when access becomes available.</li>
    </ol>
    <p>Joining the waitlist does not guarantee immediate access or a specific invitation date. Beta features may change as testing continues.</p>
    <p><a class="back" href="https://mototrack.app/">Return to MotoTrack</a></p>`);
}

async function handleUnsubscribe(request, env, url) {
  const db = database(env);
  if (!db) return json({ error: "waitlist_unavailable" }, 503);
  const raw = url.searchParams.get("token") ?? "";
  const row = await tokenRow(db, raw, "unsubscribe");
  if (!row) return EXPIRED_PAGE(env);
  if (request.method === "GET") {
    return page(env, "Unsubscribe", `
      <h1>Unsubscribe from MotoTrack email</h1>
      <p>This stops wait-list and product-update email to your address. See the <a href="/privacy.html">Privacy Notice</a>.</p>
      <form method="post" action="/waitlist/unsubscribe?token=${encodeURIComponent(raw)}">
        <button type="submit">Unsubscribe</button>
      </form>`);
  }
  // Idempotent: unsubscribing twice is fine; the minimal suppression record
  // (the signup row's status and timestamp) is all that remains in force.
  await db.prepare(`UPDATE waitlist_signups SET status = 'unsubscribed', unsubscribed_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?`).bind(row.signup_id).run();
  await db.prepare(`UPDATE waitlist_tokens SET superseded_at = datetime('now')
    WHERE signup_id = ? AND purpose = 'confirm' AND used_at IS NULL AND superseded_at IS NULL`).bind(row.signup_id).run();
  // Unsubscribing also revokes every outstanding rider-profile link, so a
  // previously issued invitation stops working immediately (track-helper #31).
  await revokeProfileInvitations(db, row.signup_id);
  return page(env, "Unsubscribed", `
    <h1>You’re unsubscribed</h1>
    <p>You won’t receive further wait-list or product-update email at this address. Rejoining later always requires the signup form and a fresh email confirmation.</p>
    <p><a class="back" href="/">Back to MotoTrack</a></p>`);
}

// Automated retention (published schedule, privacy notice v2026-08-05.1):
// pending signups purge 30 days after their last confirmation token expired
// unused; confirmed signups purge 24 months after confirmation (continued
// marketing past that requires a renewed confirmation - i.e. a fresh signup);
// delivery/security logs keep 90 days; attribution keeps 12 months; rate
// buckets keep 2 days. Unsubscribed suppression records are deliberately NOT
// swept here: they persist while MotoTrack sends marketing email, and their
// deletion (within 12 months of the marketing program permanently ending) is
// an explicit operator decision that no timer can infer.
export async function runRetentionSweep(db) {
  const purgeSignups = async (where) => {
    const doomed = await db.prepare(`SELECT id FROM waitlist_signups WHERE ${where}`).bind().all();
    for (const { id: signupId } of doomed.results ?? []) {
      await db.prepare("DELETE FROM waitlist_profile_invitations WHERE signup_id = ?").bind(signupId).run();
      await db.prepare("DELETE FROM waitlist_profiles WHERE signup_id = ?").bind(signupId).run();
      await db.prepare("DELETE FROM waitlist_email_deliveries WHERE signup_id = ?").bind(signupId).run();
      await db.prepare("DELETE FROM waitlist_tokens WHERE signup_id = ?").bind(signupId).run();
      await db.prepare("DELETE FROM waitlist_signups WHERE id = ?").bind(signupId).run();
    }
    return (doomed.results ?? []).length;
  };
  const pending = await purgeSignups(`status = 'pending' AND NOT EXISTS (
      SELECT 1 FROM waitlist_tokens t WHERE t.signup_id = waitlist_signups.id
        AND t.purpose = 'confirm' AND t.expires_at > datetime('now', '-30 days'))
    AND created_at <= datetime('now', '-30 days')`);
  const confirmed = await purgeSignups(`status = 'confirmed' AND confirmed_at <= datetime('now', '-24 months')`);
  const logs = await db.prepare("DELETE FROM waitlist_email_deliveries WHERE requested_at <= datetime('now', '-90 days')").bind().run();
  const attribution = await db.prepare(`UPDATE waitlist_signups SET attribution = NULL, updated_at = datetime('now')
    WHERE attribution IS NOT NULL AND created_at <= datetime('now', '-12 months')`).bind().run();
  const buckets = await db.prepare("DELETE FROM waitlist_rate_buckets WHERE window_start <= datetime('now', '-2 days')").bind().run();
  // Profile retention: deleted within 30 days after unsubscribe. Profiles of
  // purged signups are removed by purgeSignups above, so nothing can outlive
  // the wait-list retention ceiling.
  const profiles = await sweepProfileRetention(db);
  return {
    profiles_purged: profiles.profiles_purged,
    profile_invitations_purged: profiles.invitations_purged,
    pending_purged: pending,
    confirmed_expired: confirmed,
    delivery_logs_purged: Number(logs?.meta?.changes ?? 0),
    attribution_cleared: Number(attribution?.meta?.changes ?? 0),
    rate_buckets_purged: Number(buckets?.meta?.changes ?? 0),
  };
}

// Staging isolation: every response from the staging hostname is marked
// non-indexable so the isolated test target never enters search engines.
function stagingGuard(env, response) {
  if (String(env?.WAITLIST_ENVIRONMENT ?? "") !== "staging") return response;
  const marked = new Response(response.body, response);
  marked.headers.set("x-robots-tag", "noindex, nofollow");
  return marked;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/waitlist" && request.method === "POST") return handleJoin(request, env);
    if (url.pathname === "/waitlist/confirm" && ["GET", "POST"].includes(request.method)) return handleConfirm(request, env, url);
    if (url.pathname === "/waitlist/unsubscribe" && ["GET", "POST"].includes(request.method)) return handleUnsubscribe(request, env, url);
    if (url.pathname === "/waitlist/confirmed" && request.method === "GET") {
      const track = url.searchParams.get("list") === "interest" ? "international_interest" : "us_beta_waitlist";
      return stagingGuard(env, confirmedPage(env, track));
    }
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/waitlist/")) return json({ error: "not_found" }, 404);
    return stagingGuard(env, await env.ASSETS.fetch(request));
  },
  // Daily retention job (wrangler triggers.crons). Skips silently when the
  // database binding is absent - nothing to retain, nothing to delete.
  async scheduled(event, env) {
    const db = database(env);
    if (db) await runRetentionSweep(db);
  },
};
