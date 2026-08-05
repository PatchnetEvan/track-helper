// MotoTrack public wait list — confirmation-based, consent-first, minimal.
//
// The public site stays a static-assets site; this Worker fronts ONLY the
// wait-list routes (run_worker_first) and passes everything else to assets.
// Fail-closed: without the WAITLIST_DB and an email provider the endpoints
// answer a structured 503 and write nothing. No cookies are set anywhere.
// Anti-enumeration: every well-formed submission receives the identical
// generic 202 whether the address is new, pending, confirmed, unsubscribed,
// or rate limited.

export const CONSENT_COPY_VERSION = "2026-08-05.1";
export const PRIVACY_NOTICE_VERSION = "2026-08-05.1";
export const CONSENT_COPY =
  "Yes, add me to the MotoTrack waitlist and email me about early access and MotoTrack product updates. "
  + "I can unsubscribe at any time. See the Privacy Policy.";
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

function page(title, bodyHtml, status = 200) {
  return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" /><meta name="referrer" content="no-referrer" /><title>${title} — MotoTrack</title>
<link rel="stylesheet" href="/styles.css" /></head>
<body><main class="doc">${bodyHtml}</main></body></html>`, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    },
  });
}

const EXPIRED_PAGE = () => page("Link expired", `
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

async function sendConfirmationEmail(env, db, provider, origin, signup) {
  const confirmToken = await mintAndStoreToken(db, signup.id, "confirm", CONFIRM_TOKEN_TTL_MINUTES);
  const unsubToken = await activeUnsubscribeToken(db, signup.id);
  const result = await provider.send({
    to: signup.email_normalized,
    subject: "Confirm your MotoTrack waitlist spot",
    text: [
      "Confirm my place",
      "",
      `Open this link to confirm your spot on the MotoTrack waitlist:`,
      `${origin}/waitlist/confirm?token=${confirmToken}`,
      "",
      "The link is single-use and expires in 24 hours. If you didn't request this, you can ignore this email and nothing will be added.",
      "",
      `Unsubscribe at any time: ${origin}/waitlist/unsubscribe?token=${unsubToken}`,
      `Privacy: ${origin}/privacy.html`,
    ].join("\n"),
  });
  await db.prepare(`INSERT INTO waitlist_email_deliveries (id, signup_id, purpose, provider_status) VALUES (?, ?, 'confirm', ?)`)
    .bind(id("wld"), signup.id, String(result?.status ?? "unknown")).run();
}

async function sendWelcomeEmail(env, db, provider, origin, signup) {
  const unsubToken = await activeUnsubscribeToken(db, signup.id);
  const result = await provider.send({
    to: signup.email_normalized,
    subject: "You're on the MotoTrack waitlist",
    text: [
      "You're on the list.",
      "We'll let you know when MotoTrack early access becomes available in your region.",
      "",
      `Tell us about your riding (optional, doesn't affect your spot): ${origin}/waitlist-profile.html`,
      "",
      `Unsubscribe at any time: ${origin}/waitlist/unsubscribe?token=${unsubToken}`,
      `Privacy: ${origin}/privacy.html`,
    ].join("\n"),
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

  const existing = await db.prepare(`SELECT id, email_normalized, status FROM waitlist_signups WHERE email_normalized = ?`).bind(email).first();
  if (!existing) {
    const signupId = id("wls");
    await db.prepare(`INSERT INTO waitlist_signups
      (id, email_normalized, country_code, status, consent_at, consent_copy_version, privacy_notice_version, signup_source, attribution)
      VALUES (?, ?, ?, 'pending', datetime('now'), ?, ?, ?, ?)`)
      .bind(signupId, email, country, CONSENT_COPY_VERSION, PRIVACY_NOTICE_VERSION,
        typeof body?.source === "string" ? body.source.slice(0, 120) : "waitlist.html",
        attributionFrom(body?.page_query)).run();
    await sendConfirmationEmail(env, db, provider, origin, { id: signupId, email_normalized: email });
  } else if (existing.status === "pending" || existing.status === "unsubscribed") {
    // Refresh consent stamps on an AFFIRMATIVE re-submission; status only ever
    // becomes confirmed through the emailed confirmation link, so a previous
    // unsubscribe is never silently reversed by a form post.
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
    if (!usable) return EXPIRED_PAGE();
    return page("Confirm your spot", `
      <h1>Confirm your MotoTrack waitlist spot</h1>
      <form method="post" action="/waitlist/confirm?token=${encodeURIComponent(raw)}">
        <button type="submit">Confirm my place</button>
      </form>`);
  }
  const row = await tokenRow(db, raw, "confirm");
  if (!row) return EXPIRED_PAGE();
  const claimed = await db.prepare(`UPDATE waitlist_tokens SET used_at = datetime('now')
    WHERE id = ? AND used_at IS NULL AND superseded_at IS NULL AND expires_at > datetime('now')`).bind(row.id).run();
  if (Number(claimed?.meta?.changes ?? 0) !== 1) return EXPIRED_PAGE();
  await db.prepare(`UPDATE waitlist_signups SET status = 'confirmed', confirmed_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ? AND status != 'confirmed'`).bind(row.signup_id).run();
  const signup = await db.prepare(`SELECT id, email_normalized FROM waitlist_signups WHERE id = ?`).bind(row.signup_id).first();
  const provider = emailProviderOrNull(env);
  if (provider && signup) await sendWelcomeEmail(env, db, provider, url.origin, signup);
  return page("You're on the list", `
    <h1>You’re on the list.</h1>
    <p>We’ll let you know when MotoTrack early access becomes available in your region.</p>
    <p><a class="back" href="/waitlist-profile.html">Tell us about your riding</a></p>`);
}

async function handleUnsubscribe(request, env, url) {
  const db = database(env);
  if (!db) return json({ error: "waitlist_unavailable" }, 503);
  const raw = url.searchParams.get("token") ?? "";
  const row = await tokenRow(db, raw, "unsubscribe");
  if (!row) return EXPIRED_PAGE();
  if (request.method === "GET") {
    return page("Unsubscribe", `
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
  return page("Unsubscribed", `
    <h1>You’re unsubscribed</h1>
    <p>You won’t receive further wait-list or product-update email at this address. Rejoining later always requires the signup form and a fresh email confirmation.</p>
    <p><a class="back" href="/">Back to MotoTrack</a></p>`);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/waitlist" && request.method === "POST") return handleJoin(request, env);
    if (url.pathname === "/waitlist/confirm" && ["GET", "POST"].includes(request.method)) return handleConfirm(request, env, url);
    if (url.pathname === "/waitlist/unsubscribe" && ["GET", "POST"].includes(request.method)) return handleUnsubscribe(request, env, url);
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/waitlist/")) return json({ error: "not_found" }, 404);
    return env.ASSETS.fetch(request);
  },
};
