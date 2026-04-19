# Security audit — MotoTrack

**Scope:** everything on branch `claude/build-mototrack-mvp-GRitz` as of the
last commit (`index.html`, `privacy.html`, `terms.html`, `styles.css`,
`app.js`, `storage.js`).
**Review date:** 2026-04-19
**Auditor:** self-review, line-by-line.

## Summary

No critical or high findings. The app is a pure static site with no server,
no third-party dependencies, no network traffic, no authentication, and no
persisted data beyond opt-in, same-device `localStorage`. This drastically
shrinks the attack surface. The main residual risks are standard frontend
concerns: DOM XSS via `innerHTML`, unsafe rendering of imported backup files,
and the absence of a Content Security Policy.

## Threat model

- **Hostile input via form fields** — a rider types hostile strings into
  bike/track/notes. Must not execute as HTML/JS when rendered back on Review,
  History, Compare, or Trends.
- **Hostile imported backup file** — a rider imports a JSON file from
  somewhere untrusted. Its fields must be treated as data, not code, and must
  not be able to pollute prototypes or execute scripts.
- **Quota / denial of local service** — an oversized import or runaway save
  exhausts `localStorage`.
- **Stored-data leakage** — saved sessions must stay on-device and never
  leave over the network.
- **Out of scope:** compromise of the host machine, the browser itself, the
  hosting provider, or the user's network. The app offers no protection
  against those and does not claim to.

## Findings

### XSS — not exploitable, defended consistently

Every `innerHTML` site that renders user-controlled data runs the value
through `escapeHtml()` first. Verified call sites:

- `calc-tires` → `tire-result` — only emits numeric strings and fixed
  labels; still escapes each tip string.
- `calc-suspension` → `suspension-result` — `escapeHtml(SYMPTOM_ADVICE[v] || v)`.
- `calc-laps` → `laps-result` — lap values flow through `fmtLap`/`fmtDelta`
  (numeric) and are additionally escaped.
- `build-summary` → `summary-result` — all values flow through `row()` which
  escapes both label and value.
- `save-session` → `save-result` — only literal strings, plus
  `escapeHtml(e.message)` on the error branch.
- `renderHistory` — session titles, metadata, `<option>` values, trend rows,
  and `data-id` attributes are each escaped.
- `sessionDetailHtml` — values routed through `row()` which escapes both
  sides.
- `run-compare` → `compare-result` — `escapeHtml` on field labels, both
  values, session titles, and timestamps.

**Residual risk:** if a future contributor adds a new `innerHTML` site that
interpolates user data without `escapeHtml`, XSS becomes possible. Mitigated
by (a) adopting a strict CSP (see recommendations), (b) preferring
`textContent` where HTML structure isn't needed.

### Imported backup safety — low risk

`Store.importPayload` in `storage.js`:

- Accepts either a bare array or `{ sessions: [...] }`.
- Validates `Array.isArray` and rejects anything else with a friendly reason.
- For each incoming entry, requires a truthy `id` and deduplicates by id.
- Only appends to an in-memory array and writes back with `JSON.stringify`.
  There is no `Object.assign(target, source)` with attacker-controlled source,
  so prototype pollution via `__proto__` keys is not reachable here.
- Because `id` values are user-controlled on import, they are treated as
  opaque strings and every downstream rendering escapes them.

**Residual risk (low):** imported sessions are added without strict shape
validation — an import could contain unexpected extra fields. These are
stored as-is and ignored by the renderer. Not exploitable given all rendering
goes through `escapeHtml`.

### `localStorage` quota — handled

- `save-session` handler wraps `Store.add` in `try/catch` and surfaces the
  error message (escaped).
- `import-history` handler wraps `Store.importPayload` inside `reader.onload`'s
  `try/catch`; a `QuotaExceededError` bubbles to the catch and is shown via
  `window.alert` rather than silently failing.

**Recommendation (low priority):** cap imported file size before parsing (for
example reject > 5 MB) to avoid surprising UI hangs on huge files.

### Data exfiltration — not possible from app code

- No `fetch`, `XMLHttpRequest`, `WebSocket`, `navigator.sendBeacon`,
  `new Image().src = …`, or dynamic `<script>` insertion anywhere in the
  codebase.
- The only network traffic is the hosting provider delivering static files.
- Export uses `Blob` + `URL.createObjectURL` + a synthetic `<a download>`
  click, then revokes the URL. The file is written to the user's own device;
  nothing is transmitted.
- `privacy.html` accurately reflects this behavior.

### Click-jacking / framing — no auth, minimal impact

There are no privileged actions, so framing cannot be leveraged to trick a
logged-in user into performing an action. Still, because reset/clear actions
are one-click, `frame-ancestors 'none'` (via CSP, see below) is recommended.

### Open redirects — not applicable

All links are relative (`index.html`, `privacy.html`, `terms.html`). No
user-controlled URL is rendered as a link or navigation target.

### CSRF — not applicable

No server. No state-changing HTTP endpoints.

### Dependencies / supply chain — none

No `package.json`. No CDN scripts or fonts. Zero third-party code.

## Recommendations (defense in depth)

### Implemented

1. **Strict Content-Security-Policy — done.** Applied at two layers:
   - A `<meta http-equiv="Content-Security-Policy">` tag in `index.html`,
     `privacy.html`, and `terms.html` so the policy is active even when the
     file is opened directly from disk or served by any host.
     ```
     default-src 'none'; script-src 'self'; style-src 'self';
     img-src 'self'; connect-src 'none'; base-uri 'none';
     form-action 'none';
     ```
   - Host headers in `_headers` (Cloudflare Pages / Netlify) and
     `vercel.json` (Vercel) add `frame-ancestors 'none'` and ship the other
     hardening headers (see below). `default-src 'none'` is chosen over
     `'self'` so every resource type must be explicitly whitelisted,
     eliminating accidental allow-by-default of manifests, fonts, workers,
     frames, or media.
2. **`Referrer-Policy: no-referrer` — done** via both a meta tag in every
   HTML file and an HTTP header in `_headers` / `vercel.json`.
3. **`X-Content-Type-Options: nosniff` — done** via `_headers` / `vercel.json`.
4. **`X-Frame-Options: DENY` — done** as a legacy belt-and-suspenders
   alongside the CSP's `frame-ancestors 'none'`.
5. **`Permissions-Policy` — done.** Accelerometer, camera, geolocation,
   gyroscope, magnetometer, microphone, payment, and USB are all denied
   origin-wide.
6. **`Strict-Transport-Security` — done** (`max-age=31536000; includeSubDomains`)
   for HTTPS-only hosts.

### Still recommended

1. **Prefer `textContent` over `innerHTML`** where no HTML structure is
   needed. Each such conversion removes one escaping footgun.
2. **Validate imported sessions more strictly.** Check that required fields
   exist and are of expected types before adding. Reject entries that fail,
   and reject files > 5 MB before parsing.
3. **Namespace storage version.** The key is already `mototrack.sessions.v1`.
   Keep the `.vN` suffix so future schema changes can migrate or ignore old
   entries instead of silently corrupting them.
4. **Document the opt-in storage in `privacy.html`** — already done, but
   keep it in sync if new persistent fields are added.

### CSP self-compatibility check

Verified no inline `style="…"` attributes, no inline event handlers
(`onclick=`, `onload=`, `onchange=`, etc.), and no inline `<script>` blocks
in any HTML file. All scripts and styles are same-origin externals
(`storage.js`, `app.js`, `styles.css`). Blob-URL download via
`URL.createObjectURL` + a synthetic `<a download>` click is not a CSP
fetch directive target and works under `default-src 'none'`.

## Non-issues / explicitly considered

- **No secrets or credentials** are stored anywhere — not even in
  `localStorage` — so `localStorage`'s lack of `httpOnly` / same-site
  protections is not security-relevant here.
- **No analytics, no cookies, no notifications, no push** — consistent with
  the stated product philosophy and verified in code.
- **The escape function** handles `&`, `<`, `>`, `"`, `'` — sufficient for
  both element content and double-quoted attribute contexts used by the app.

## Re-audit triggers

Re-run this review if any of the following change:
- A backend, API call, or third-party script is added.
- `innerHTML` is used in a new code path (search the tree for it).
- The import/export format gains new fields.
- Any form of authentication, sharing, or multi-user support is added.
