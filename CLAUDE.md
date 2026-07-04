# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running and deploying

- **Run locally:** open `index.html` directly in a browser. There is no build step, no bundler, no `package.json`, and no dependencies to install.
- **Deploy:** static-only. `wrangler.jsonc` configures a Cloudflare Workers Static Assets deploy (`assets.directory: "./"`, no Worker code). `vercel.json` configures the Vercel alternative. Both honor `_headers` for security headers.
- **No test suite, no lint config, no CI scripts exist.** Verification is manual: open `index.html`, exercise the tab affected by the change, then reload to confirm `localStorage` round-trips.

## Architecture

Vanilla HTML/CSS/JS single-page app. No framework, no modules — each script is an IIFE that hangs one object on `window` (`Store`, `MotoTrackTireCore`). Script load order in `index.html` matters: `storage.js` → `tire-core.js` → `app.js` (all `defer`).

### Layers

- **`index.html`** — app shell. Tabs (`Setup`, `Tires`, `Calculators`, `Suspension`, `Laps`, `Review`, `History`, `About`) map 1:1 to `<section class="panel" id="panel-{name}">` blocks. Tab switching is driven by `data-tab` attributes and the `panels` map in `app.js`.
- **`app.js`** — all interactions, calculations, and DOM rendering. Single IIFE, no exports. Section comments (`// --- Tires ---`, `// --- Geometry deltas ---`, etc.) mark the boundaries of each feature.
- **`storage.js`** — thin `localStorage` wrapper exposing `window.Store` (`readAll`, `add`, `remove`, `clear`, `newId`, `importPayload`, `exportPayload`). The storage key is versioned (`mototrack.sessions.v1`); preserve the `.vN` suffix so schema changes can migrate rather than corrupt. **This is the only file to replace if a backend is ever added** — keep it as the single seam.
- **`tire-core.js`** — pure computation module for tire size parsing, unit conversion, and the hardcoded `LOOKUP_TIRES` reference table. Exposed as `window.MotoTrackTireCore`. No DOM access; safe to call from any calculator.

### Session data flow

A "session" is a plain JS object built in `app.js` by `build-summary` / `save-session` handlers from form fields, then persisted via `Store.add`. Reading goes the other way: `Store.readAll()` → `renderHistory` / `loadSession`, which writes values back into form inputs via `setId`. When adding a new persisted field, update **all four** sites: the form input, the build path, the load path (`loadSession`), and the CSV/summary projections (`pushIf`, the compare-table column list).

### Rendering and security model

- Every `innerHTML` site that interpolates user-controlled data must go through `escapeHtml()` (or `row()` / `numericRow()`, which escape internally). This is enforced by convention, not by a templating engine — new `innerHTML` writes are the most likely way to introduce XSS. Prefer `textContent` when no HTML structure is needed.
- The CSP is `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'` — set both in HTML `<meta>` tags and in `_headers` / `vercel.json`. **Do not** add inline `<script>`, inline `style="..."`, inline event handlers (`onclick=` etc.), CDN scripts, web fonts from third parties, or anything that would require relaxing this policy. `connect-src 'none'` means no `fetch` / `XMLHttpRequest` / `WebSocket` / `sendBeacon` — the privacy promise is "nothing leaves the device" and is enforced by CSP, not just policy.
- `.assetsignore` excludes repo metadata (`README.md`, `SECURITY.md`, `ROADMAP.md`, `LICENSE`, `wrangler.jsonc`, `vercel.json`, etc.) from the deployed bundle. Add any new repo-only file here so it does not ship to production URLs.
- Re-audit triggers in `SECURITY.md` apply: any backend call, new `innerHTML` path, new import/export field, or any auth/sharing feature warrants a fresh security pass.

## Product direction

`ROADMAP.md` splits future work into two lanes: **MotoTrack Log** (this free app — local-first, no account, no AI, no prescriptive advice) and **MotoTrack Pro** (a future paid layer for advanced calculators, AI review, optional sync). When adding features, check which lane they belong to — prescriptive setup advice, AI, accounts, or cloud sync belong in Pro and should not land in this codebase as part of the free logger.
