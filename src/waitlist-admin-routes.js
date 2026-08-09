// Waitlist Admin (#49): candidate queue, rider detail (PR 2), and the
// decision mutation (PR 3). Approval state changes ONLY through the service
// layer's changeApprovalState - this module contains no SQL against the
// approval tables - and nothing here references any email surface, so no
// admin route can send. The single mutation route sits behind the SAME
// authenticated entry point as the reads, plus its own CSRF flow: the #45
// request-source gate AND a double-submit token scoped to /admin. The audit
// actor is exclusively the Access-verified operator email; any actor-shaped
// value in the request body is ignored.
//
// Non-disclosure contract: when the admin feature is unavailable to a
// request - flag absent/false, missing/invalid auth configuration, no or
// bad Access JWT, or an authenticated identity outside the allowlist - the
// handler returns null and the Worker falls through to static assets, where
// /admin/* has never existed. The response is byte-for-byte the ordinary
// asset 404: an unauthorized visitor cannot learn that an Admin application
// exists.
//
// Never rendered here: invitation tokens, token digests, edit-authorization
// ids, CSRF material, peppers or secrets, rate-limit internals, IP data.
// The queries below simply never select from those tables or columns.

import { authenticateOperator } from "./waitlist-admin-auth.js";
import {
  APPROVAL_STATE_LABELS, APPROVAL_STATE_VALUES, CANDIDATE_PAGE_SIZE, APPROVAL_REASON_MAX_LENGTH,
  listCandidates, readApprovalState, readApprovalHistory, changeApprovalState, ApprovalValidationError,
  normalizeReason,
} from "./waitlist-admin-service.js";
import { escapeHtml, EXPERIENCE_LEVEL_LABELS, TRACK_INVOLVEMENT_LABELS } from "./waitlist-profile-service.js";
import { parseCookies } from "./waitlist-profile-auth.js";

// --- Mutation protection -----------------------------------------------
// Same request-source rule the profile flow hardened in #45: Sec-Fetch-Site
// is authoritative when present (only the exact "same-origin" passes); the
// Origin fallback tolerates absence but refuses any foreign value including
// the literal "null", which is never generally trusted.
const requestSourceAllowed = (request) => {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null) return fetchSite === "same-origin";
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
};

// Double-submit CSRF, scoped to /admin. The cookie is minted on the first
// authorized page view; every decision form embeds the same value and the
// POST must present both. Authentication alone is deliberately NOT enough
// to mutate.
const ADMIN_CSRF_COOKIE = "__Secure-mototrack_admin_csrf";
const ADMIN_CSRF_MAX_AGE = 60 * 60 * 24;
const adminCsrfCookie = (value) =>
  `${ADMIN_CSRF_COOKIE}=${value}; Path=/admin; Max-Age=${ADMIN_CSRF_MAX_AGE}; HttpOnly; Secure; SameSite=Strict`;
const opaqueValue = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const sameValue = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

const adminEnabled = (env) => env?.WAITLIST_ADMIN_ENABLED === "true";

const TRACK_PRESENTATION = Object.freeze({
  us_beta_waitlist: { label: "US beta waitlist", className: "track-us" },
  international_interest: { label: "International interest", className: "track-intl" },
});

// The two program tracks are deliberately NOT presented as equivalent
// eligibility groups: international-interest rows carry their own styling
// and the detail view states the non-eligibility explicitly.
const trackBadge = (programTrack) => {
  const t = TRACK_PRESENTATION[programTrack] ?? { label: programTrack, className: "track-unknown" };
  return `<span class="track ${t.className}">${escapeHtml(t.label)}</span>`;
};

const approvalBadge = (effectiveState, everReviewed) => {
  const label = APPROVAL_STATE_LABELS[effectiveState] ?? effectiveState;
  const review = effectiveState === "awaiting_review"
    ? `<small>${everReviewed ? "Previously reviewed" : "Never reviewed"}</small>` : "";
  return `<span class="approval approval-${escapeHtml(effectiveState)}">${escapeHtml(label)}</span>${review}`;
};

const page = (title, body) => new Response(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>${escapeHtml(title)} — MotoTrack Admin</title>
  <style>
    body { font: 15px/1.5 system-ui, sans-serif; margin: 1.5rem; color: #14181d; }
    h1 { font-size: 1.3rem; } h2 { font-size: 1.05rem; margin-top: 2rem; }
    table { border-collapse: collapse; width: 100%; margin-top: 1rem; }
    th, td { text-align: left; padding: .45rem .6rem; border-bottom: 1px solid #d8dde3; vertical-align: top; }
    .track { padding: .1rem .45rem; border-radius: .6rem; font-size: .82rem; white-space: nowrap; }
    .track-us { background: #10391c; color: #d9f4e0; }
    .track-intl { background: #eadfc4; color: #4a3a10; border: 1px dashed #a08b52; }
    .approval { padding: .1rem .45rem; border-radius: .3rem; font-size: .82rem; white-space: nowrap; }
    .approval-awaiting_review { background: #e8ecf1; }
    .approval-approved { background: #d9f4e0; }
    .approval-hold { background: #fdeec9; }
    .approval-not_approved { background: #f6d9d9; }
    small { display: block; color: #5a6572; }
    form.filters { display: flex; flex-wrap: wrap; gap: .6rem; align-items: end; }
    form.filters label { display: block; font-size: .8rem; color: #5a6572; }
    .intl-note { background: #fdf6e4; border: 1px solid #e3d5a8; padding: .6rem .8rem; margin: .8rem 0; }
    .panel { border: 1px solid #d8dde3; border-radius: .4rem; padding: .9rem 1.1rem; margin-top: 1rem; }
    .muted { color: #5a6572; }
    a.row-link { text-decoration: none; }
    .banner { padding: .55rem .8rem; border-radius: .3rem; }
    .banner-ok { background: #d9f4e0; border: 1px solid #7fc494; }
    .banner-warn { background: #fdeec9; border: 1px solid #d9b95e; }
    .error { background: #f6d9d9; border: 1px solid #cd8a8a; padding: .55rem .8rem; border-radius: .3rem; }
    form.decision label { display: block; margin: .6rem 0 .2rem; }
    form.decision textarea { width: 100%; max-width: 42rem; }
    form.decision button { margin-top: .5rem; }
  </style>
</head>
<body>
<header><strong>MotoTrack Waitlist Admin</strong> · beta approvals</header>
${body}
</body>
</html>`, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex, nofollow", "cache-control": "no-store" } });

const FILTER_STATUSES = ["pending", "confirmed", "unsubscribed"];
const select = (name, current, options, anyLabel) => {
  const opts = [`<option value="">${escapeHtml(anyLabel)}</option>`];
  for (const [value, label] of options) {
    opts.push(`<option value="${escapeHtml(value)}"${value === current ? " selected" : ""}>${escapeHtml(label)}</option>`);
  }
  return `<label>${escapeHtml(name)}<select name="${escapeHtml(name)}">${opts.join("")}</select></label>`;
};

const queueQuery = (url) => {
  const q = url.searchParams;
  const pick = (name, valid) => (valid.includes(q.get(name)) ? q.get(name) : "");
  const offsetRaw = Number.parseInt(q.get("offset") ?? "0", 10);
  return {
    search: (q.get("search") ?? "").trim(),
    approvalState: pick("approval", APPROVAL_STATE_VALUES),
    programTrack: pick("track", Object.keys(TRACK_PRESENTATION)),
    status: pick("status", FILTER_STATUSES),
    country: /^[A-Za-z]{2}$/.test(q.get("country") ?? "") ? q.get("country").toUpperCase() : "",
    hasProfile: q.get("profile") === "yes" ? true : q.get("profile") === "no" ? false : undefined,
    sort: q.get("sort") === "oldest" ? "oldest" : "newest",
    offset: Number.isInteger(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0,
  };
};

async function renderQueue(db, url) {
  const f = queueQuery(url);
  const { candidates, hasMore, limit, offset } = await listCandidates(db, {
    search: f.search || undefined, approvalState: f.approvalState || undefined,
    programTrack: f.programTrack || undefined, status: f.status || undefined,
    country: f.country || undefined, hasProfile: f.hasProfile, sort: f.sort, offset: f.offset,
  });

  const rows = candidates.map((c) => `<tr>
    <td><a class="row-link" href="/admin/waitlist/${escapeHtml(c.id)}">${escapeHtml(c.email)}</a></td>
    <td>${escapeHtml(c.country)}</td>
    <td>${trackBadge(c.programTrack)}</td>
    <td>${escapeHtml(c.status)}</td>
    <td>${approvalBadge(c.effectiveState, c.everReviewed)}</td>
    <td>${escapeHtml(c.createdAt ?? "")}</td>
    <td>${c.hasProfile ? "Profile" : "<span class=muted>—</span>"}</td>
  </tr>`).join("\n");

  const pageLink = (newOffset, label) => {
    const params = new URLSearchParams(url.searchParams);
    if (newOffset > 0) params.set("offset", String(newOffset)); else params.delete("offset");
    return `<a href="/admin/waitlist${params.size ? `?${params}` : ""}">${escapeHtml(label)}</a>`;
  };
  const pager = [
    offset > 0 ? pageLink(Math.max(0, offset - limit), "← Newer") : "",
    hasMore ? pageLink(offset + limit, "Older →") : "",
  ].filter(Boolean).join(" · ");

  return page("Waitlist queue", `
<h1>Candidate queue</h1>
<form class="filters" method="get" action="/admin/waitlist">
  <label>search<input type="search" name="search" value="${escapeHtml(f.search)}" placeholder="email contains…" maxlength="254" /></label>
  ${select("approval", f.approvalState, APPROVAL_STATE_VALUES.map((v) => [v, APPROVAL_STATE_LABELS[v]]), "any approval state")}
  ${select("track", f.programTrack, Object.entries(TRACK_PRESENTATION).map(([v, t]) => [v, t.label]), "any track")}
  ${select("status", f.status, FILTER_STATUSES.map((v) => [v, v]), "any confirmation state")}
  <label>country<input name="country" value="${escapeHtml(f.country)}" size="3" maxlength="2" placeholder="US" /></label>
  ${select("profile", f.hasProfile === true ? "yes" : f.hasProfile === false ? "no" : "", [["yes", "profile present"], ["no", "profile absent"]], "any profile state")}
  ${select("sort", f.sort, [["newest", "newest first"], ["oldest", "oldest first"]], "newest first")}
  <button type="submit">Apply</button>
</form>
<table>
  <thead><tr><th>Email</th><th>Country</th><th>Program track</th><th>Confirmation</th><th>Approval</th><th>Signed up</th><th>Profile</th></tr></thead>
  <tbody>${rows || `<tr><td colspan="7" class="muted">No candidates match these filters.</td></tr>`}</tbody>
</table>
<p>${pager}</p>
<p class="muted">Open a candidate to review and record an approval decision. International-interest records register interest only — they do not represent U.S. beta eligibility.</p>`);
}

const PROFILE_FIELD_ROWS = [
  ["Display name", (p) => p.display_name],
  ["Track involvement", (p) => {
    try {
      const values = JSON.parse(p.track_involvement ?? "[]");
      return values.map((v) => TRACK_INVOLVEMENT_LABELS[v] ?? v).join(", ") || null;
    } catch { return null; }
  }],
  ["Track involvement (other)", (p) => p.track_involvement_other],
  ["Experience level", (p) => (p.experience_level ? EXPERIENCE_LEVEL_LABELS[p.experience_level] ?? p.experience_level : null)],
  ["Primary motorcycle", (p) => p.primary_motorcycle],
  ["Other motorcycles", (p) => p.other_motorcycles],
  ["Tracks and events", (p) => p.tracks_and_events],
  ["Timing tools", (p) => p.timing_tools],
  ["Goals", (p) => p.goals],
  ["Interested in early testing", (p) => (p.interest_early_testing ? "Yes" : "No")],
  ["Interested in remote coaching", (p) => (p.interest_remote_coaching ? "Yes" : "No")],
  ["Interested in AI coaching", (p) => (p.interest_ai_coaching ? "Yes" : "No")],
];

// Operator-facing outcome banners. `applied` confirms; the two refusal
// results are honest about what did NOT happen, per the no-op/conflict
// rulings on #49.
const RESULT_BANNERS = Object.freeze({
  applied: ["ok", "Decision recorded."],
  no_change: ["warn", "No change: that is already the current approval state. No decision was recorded."],
  conflict: ["warn", "The approval state changed after you loaded this record - review the current state below and decide again. Nothing was recorded."],
});

const decisionForm = (signup, approval, csrfToken, priorError) => {
  const options = APPROVAL_STATE_VALUES.map((value) => {
    const isCurrent = value === approval.effectiveState;
    const intlBlocked = signup.program_track === "international_interest" && value === "approved";
    return `<option value="${escapeHtml(value)}"${isCurrent ? " selected" : ""}${intlBlocked ? " disabled" : ""}>` +
      `${escapeHtml(APPROVAL_STATE_LABELS[value])}${isCurrent ? " (current)" : ""}${intlBlocked ? " - unavailable for international interest" : ""}</option>`;
  }).join("");
  return `
  <h2>Record a decision</h2>
  ${priorError ? `<p class="error">${escapeHtml(priorError)}</p>` : ""}
  <form method="post" action="/admin/waitlist/${escapeHtml(signup.id)}/decision" class="decision">
    <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />
    <input type="hidden" name="expected_state" value="${escapeHtml(approval.effectiveState)}" />
    <label>New approval state
      <select name="new_state">${options}</select>
    </label>
    <label>Operational reason
      <textarea name="reason" maxlength="${APPROVAL_REASON_MAX_LENGTH}" rows="3"
        placeholder="Required for Hold, Not approved, and when reversing Not approved."></textarea>
    </label>
    <p class="muted">State the operational reason only. Do not record medical, financial, or other sensitive
      information about the rider, or speculation. Maximum ${APPROVAL_REASON_MAX_LENGTH} characters.</p>
    <button type="submit">Confirm decision</button>
  </form>`;
};

async function renderDetail(db, signupId, { csrfToken = "", result = "", priorError = "" } = {}) {
  const signup = await db.prepare(
    `SELECT id, email_normalized, country_code, program_track, status, consent_at,
            confirmed_at, unsubscribed_at, created_at FROM waitlist_signups WHERE id = ?`,
  ).bind(signupId).first();
  if (!signup) return null;

  const approval = await readApprovalState(db, signupId);
  const history = await readApprovalHistory(db, signupId);
  const profile = await db.prepare("SELECT * FROM waitlist_profiles WHERE signup_id = ?").bind(signupId).first();

  const historyRows = history.map((e) => `<tr>
    <td>${escapeHtml(e.occurred_at)}</td>
    <td>${escapeHtml(APPROVAL_STATE_LABELS[e.previous_state] ?? e.previous_state)} → ${escapeHtml(APPROVAL_STATE_LABELS[e.new_state] ?? e.new_state)}</td>
    <td>${escapeHtml(e.actor)}</td>
    <td>${e.reason === null ? "<span class=muted>—</span>" : escapeHtml(e.reason)}</td>
  </tr>`).join("\n");

  const profileRows = profile
    ? PROFILE_FIELD_ROWS.map(([label, read]) => {
        const value = read(profile);
        return `<tr><th>${escapeHtml(label)}</th><td>${value === null || value === undefined || value === "" ? "<span class=muted>—</span>" : escapeHtml(String(value))}</td></tr>`;
      }).join("\n")
    : "";

  return page(`Candidate ${signup.email_normalized}`, `
<p><a href="/admin/waitlist">← Back to queue</a></p>
<h1>${escapeHtml(signup.email_normalized)}</h1>
<div class="panel">
  <h2>Signup</h2>
  <table>
    <tr><th>Country</th><td>${escapeHtml(signup.country_code)}</td></tr>
    <tr><th>Program track</th><td>${trackBadge(signup.program_track)}</td></tr>
    <tr><th>Confirmation state</th><td>${escapeHtml(signup.status)}</td></tr>
    <tr><th>Signed up</th><td>${escapeHtml(signup.created_at ?? "")}</td></tr>
    <tr><th>Confirmed</th><td>${escapeHtml(signup.confirmed_at ?? "—")}</td></tr>
    <tr><th>Unsubscribed</th><td>${escapeHtml(signup.unsubscribed_at ?? "—")}</td></tr>
  </table>
  ${signup.program_track === "international_interest"
    ? `<p class="intl-note">International interest only: this registration does not currently represent eligibility for MotoTrack beta access.</p>` : ""}
</div>
<div class="panel">
  <h2>Beta approval</h2>
  ${Object.hasOwn(RESULT_BANNERS, result) ? `<p class="banner banner-${RESULT_BANNERS[result][0]}">${escapeHtml(RESULT_BANNERS[result][1])}</p>` : ""}
  <p>${approvalBadge(approval.effectiveState, approval.everReviewed)}</p>
  ${approval.everReviewed
    ? `<p class="muted">Last decision by ${escapeHtml(approval.updatedBy ?? "")} at ${escapeHtml(approval.updatedAt ?? "")}.</p>`
    : `<p class="muted">No operator has reviewed this candidate yet.</p>`}
  ${csrfToken ? decisionForm(signup, approval, csrfToken, priorError) : ""}
  <h2>Decision history</h2>
  ${history.length
    ? `<table><thead><tr><th>When</th><th>Decision</th><th>Operator</th><th>Reason</th></tr></thead><tbody>${historyRows}</tbody></table>`
    : `<p class="muted">No decisions recorded.</p>`}
  <p class="muted">History is append-only; decisions are recorded, never edited.</p>
</div>
${profile ? `
<div class="panel">
  <h2>Rider profile <span class="muted">(rider-submitted, separate from approval)</span></h2>
  <table>${profileRows}</table>
</div>` : `<p class="muted">No rider profile submitted.</p>`}`);
}

// A CSRF failure for an ALREADY AUTHENTICATED operator is an actionable
// error, not a secret - the uniform 404 is only for requests that are not
// entitled to know Admin exists.
const csrfRefused = () => new Response(`<!doctype html><meta charset="utf-8"><title>Refused</title>
<p>The request could not be verified as coming from the Admin page. Go back, reload the record, and decide again.</p>`,
  { status: 403, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });

// The Not approved confirmation interstitial: a second explicit submit
// carrying the SAME decision plus the confirmation flag. Nothing has been
// recorded when this page renders.
const confirmNotApprovedPage = (signupId, email, expectedState, reason, csrfToken) => page("Confirm decision", `
<p><a href="/admin/waitlist/${escapeHtml(signupId)}">← Back without deciding</a></p>
<h1>Confirm: mark this rider Not approved</h1>
<div class="panel">
  <p>You are about to record <strong>Not approved</strong> for <strong>${escapeHtml(email)}</strong>.</p>
  <p>Reason: ${escapeHtml(reason)}</p>
  <p class="muted">Nothing has been recorded yet. This is the only state a rider would experience as a closed
    door, so it asks once more.</p>
  <form method="post" action="/admin/waitlist/${escapeHtml(signupId)}/decision">
    <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />
    <input type="hidden" name="expected_state" value="${escapeHtml(expectedState)}" />
    <input type="hidden" name="new_state" value="not_approved" />
    <input type="hidden" name="reason" value="${escapeHtml(reason)}" />
    <input type="hidden" name="confirm_not_approved" value="yes" />
    <button type="submit">Confirm: Not approved</button>
  </form>
</div>`);

// The one mutation route. Auth happened at the shared entry point; this
// layer adds the request-source gate and the double-submit check, runs the
// deliberate-decision workflow, and delegates every business rule to
// changeApprovalState. The audit actor is the verified operator email and
// nothing else - the form cannot supply or override it.
async function handleDecision(db, request, url, signupId, operator, cookieToken) {
  if (!requestSourceAllowed(request)) return csrfRefused();
  const form = await request.formData().catch(() => null);
  if (!form) return csrfRefused();
  if (!sameValue(cookieToken, String(form.get("csrf") ?? ""))) return csrfRefused();

  const expectedState = String(form.get("expected_state") ?? "");
  const newState = String(form.get("new_state") ?? "");
  const reason = form.get("reason") === null ? null : String(form.get("reason"));

  const signup = await db.prepare(
    "SELECT id, email_normalized FROM waitlist_signups WHERE id = ?").bind(signupId).first();
  if (!signup) return null;

  if (newState === "not_approved" && form.get("confirm_not_approved") !== "yes") {
    // The interstitial shows and carries the NORMALIZED reason - what the
    // operator confirms is byte-for-byte what the audit event will store.
    return confirmNotApprovedPage(signupId, signup.email_normalized, expectedState,
      normalizeReason(reason) ?? "", cookieToken);
  }

  try {
    const outcome = await changeApprovalState(db, {
      signupId, expectedState, newState, reason, actor: operator.email,
    });
    const result = outcome.ok ? "applied" : outcome.code; // no_change | conflict
    return new Response(null, {
      status: 303,
      headers: { location: `/admin/waitlist/${signupId}?result=${result}` },
    });
  } catch (error) {
    if (error instanceof ApprovalValidationError) {
      const detail = await renderDetail(db, signupId, { csrfToken: cookieToken, priorError: error.message });
      if (!detail) return null;
      return new Response(detail.body, { status: 400, headers: detail.headers });
    }
    throw error;
  }
}

// Entry point. Returns a Response for an authorized operator, or null so
// the Worker falls through to static assets (an indistinguishable 404) for
// everything else - disabled flag, bad config, bad auth, unknown paths, and
// methods/paths with no route. The only mutation surface is the decision
// POST below; it cannot be reached without passing the same authentication
// as every read.
export async function handleAdminRoutes(request, env, url, deps = {}) {
  if (!(url.pathname === "/admin" || url.pathname.startsWith("/admin/"))) return null;
  if (!adminEnabled(env)) return null;

  const db = env?.WAITLIST_DB ?? null;
  if (!db) return null;
  // Test seam, mirroring the worker's existing test-binding pattern: suites
  // inject a JWKS source so signature verification runs against synthetic
  // keys. Production simply never defines it.
  const operator = await authenticateOperator(request, env, deps.auth ?? env?.ADMIN_AUTH_TEST);
  if (!operator) return null;

  // Double-submit CSRF material: reuse the client's token, or mint one for
  // this response. Set-Cookie rides every authorized HTML response so the
  // decision form always has a matching pair.
  const cookies = parseCookies(request);
  const existingToken = typeof cookies[ADMIN_CSRF_COOKIE] === "string" && cookies[ADMIN_CSRF_COOKIE].length >= 32
    ? cookies[ADMIN_CSRF_COOKIE] : null;
  const csrfToken = existingToken ?? opaqueValue();
  const withCsrfCookie = (response) => {
    if (response && !existingToken) response.headers.append("set-cookie", adminCsrfCookie(csrfToken));
    return response;
  };

  try {
    const detailMatch = /^\/admin\/waitlist\/([A-Za-z0-9_-]{1,64})$/.exec(url.pathname);
    const decisionMatch = /^\/admin\/waitlist\/([A-Za-z0-9_-]{1,64})\/decision$/.exec(url.pathname);

    if (request.method === "GET") {
      if (url.pathname === "/admin/waitlist" || url.pathname === "/admin" || url.pathname === "/admin/") {
        if (url.pathname !== "/admin/waitlist") {
          return new Response(null, { status: 303, headers: { location: "/admin/waitlist" } });
        }
        return withCsrfCookie(await renderQueue(db, url));
      }
      if (detailMatch) {
        return withCsrfCookie(await renderDetail(db, detailMatch[1], {
          csrfToken, result: url.searchParams.get("result") ?? "",
        }));
      }
    }
    if (request.method === "POST" && decisionMatch) {
      // A POST without the cookie can never match the double-submit pair.
      return await handleDecision(db, request, url, decisionMatch[1], operator, existingToken ?? "");
    }
  } catch (error) {
    if (error instanceof ApprovalValidationError) return null;
    throw error;
  }
  return null;
}
