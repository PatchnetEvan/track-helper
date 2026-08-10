import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import worker from "../src/waitlist-worker.js";
import { APP_VERSION } from "../src/app-version.js";
import { PULSE_SESSION_STORAGE_KEY, PULSE_VERSION_STORAGE_KEY, PULSE_VERSION_WINDOW_DAYS } from "../src/experience-pulse-cooldown.js";

// MotoTrack Experience Pulse #55 PR3A (placement wiring): the inline client in
// public/app.js, asserted structurally (there is no DOM in `node --test`, so
// this mirrors how the Feedback client is checked). Placement is Option 1 -
// contextual, inside the existing result regions, never a modal or a persistent
// element. The cadence keys/window are asserted to MATCH the tested contract in
// src/experience-pulse-cooldown.js so the client and the reference cannot drift
// apart silently.

const appJs = readFileSync(join(import.meta.dirname, "..", "public", "app.js"), "utf8");
const styles = readFileSync(join(import.meta.dirname, "..", "public", "styles.css"), "utf8");
const html = readFileSync(join(import.meta.dirname, "..", "public", "log", "index.html"), "utf8");

// Isolate the pulse controller so assertions about "what the pulse does" cannot
// accidentally pass on Feedback code elsewhere in the file.
const pulseStart = appJs.indexOf("function experiencePulse()");
const pulseEnd = appJs.indexOf("// Initial state");
assert.ok(pulseStart >= 0 && pulseEnd > pulseStart, "pulse controller present");
const pulse = appJs.slice(pulseStart, pulseEnd);

// ---------------------------------------------------------------------------
// Exact rider-facing copy.
// ---------------------------------------------------------------------------
assert.ok(pulse.includes("How was this experience?"), "exact pulse question");
assert.ok(pulse.includes("1 — Not good"), "exact value 1 label");
assert.ok(pulse.includes("2 — Okay"), "exact value 2 label");
assert.ok(pulse.includes("3 — Good"), "exact value 3 label");
assert.ok(pulse.includes('"Thanks."') || pulse.includes("\"Thanks.\""), "exact one-tap acknowledgement");

// ---------------------------------------------------------------------------
// Cadence keys + window MATCH the tested contract (no silent drift).
// ---------------------------------------------------------------------------
assert.equal(PULSE_SESSION_STORAGE_KEY, "mototrack_pulse_session_v1");
assert.equal(PULSE_VERSION_STORAGE_KEY, "mototrack_pulse_versions_v1");
assert.equal(PULSE_VERSION_WINDOW_DAYS, 7);
assert.ok(pulse.includes(PULSE_SESSION_STORAGE_KEY), "client uses the contract session key");
assert.ok(pulse.includes(PULSE_VERSION_STORAGE_KEY), "client uses the contract version key");
assert.ok(pulse.includes("7 * 24 * 60 * 60 * 1000"), "client uses the 7-day rolling window");
// The three cadence gates are all present in the client.
assert.ok(pulse.includes("s.shown === true"), "session cap gate");
assert.ok(pulse.includes("s.feedbackSubmitted === true"), "post-feedback suppression gate");
assert.ok(/Date\.now\(\)\s*-\s*at\)\s*<\s*WINDOW_MS/.test(pulse), "per-version 7-day window gate");

// ---------------------------------------------------------------------------
// Fail-closed reveal: the pulse renders only when the gated endpoint confirms
// availability, and only under the cadence gate.
// ---------------------------------------------------------------------------
assert.ok(pulse.includes("/api/experience-pulse"), "dedicated pulse endpoint");
assert.ok(pulse.includes("if (!res.ok) return"), "availability bootstrap bails on a non-OK GET");
assert.ok(/available\s*=\s*true/.test(pulse), "availability is set only after a successful bootstrap");
assert.ok(/if\s*\(!available\s*\|\|\s*!target\s*\|\|\s*!allowed\(\)\)\s*return/.test(pulse), "no render unless available AND cadence allows");

// ---------------------------------------------------------------------------
// Trigger placement (Option 1): after_save on the save result region,
// after_review on the summary result region. Reuses the EXISTING regions.
// ---------------------------------------------------------------------------
assert.ok(/maybePrompt\(r\.out,\s*"after_save"\)/.test(appJs), "after_save prompts in the save-result region");
assert.ok(/maybePrompt\(el,\s*"after_review"\)/.test(appJs), "after_review prompts in the summary-result region");

// ---------------------------------------------------------------------------
// It never touches the Feedback UI (no auto-open, including for "1 - Not good"),
// never special-cases value 1, and defines no manual-pulse UI in v1.
// ---------------------------------------------------------------------------
for (const forbidden of ["overlay", "feedback-open", "feedback-overlay", "form.hidden"]) {
  assert.ok(!pulse.includes(forbidden), `pulse controller must not manipulate the Feedback UI (${forbidden})`);
}
assert.ok(!/value\s*===\s*1/.test(pulse), "no special-casing of the '1 - Not good' response");
assert.ok(!pulse.includes('"manual"'), "no automatic 'manual' trigger wired (manual stays reserved, no v1 UI)");

// ---------------------------------------------------------------------------
// The written-Feedback success path suppresses an immediate pulse. Assert the
// hook is called inside the 201 branch of the feedback submit.
// ---------------------------------------------------------------------------
assert.ok(appJs.includes("recordFeedbackSubmitted"), "suppression hook exists");
const okBranch = appJs.slice(appJs.indexOf("res.status === 201"), appJs.indexOf("res.status === 400"));
assert.ok(okBranch.includes("recordFeedbackSubmitted()"), "feedback success records pulse suppression");

// ---------------------------------------------------------------------------
// Inline, not a modal or a new permanent element: the control is built in JS
// and appended to an existing region; the Log markup adds NO static pulse
// element, and the styling is class-based (meta CSP style-src 'self').
// ---------------------------------------------------------------------------
assert.ok(!/class="pulse"/.test(html) && !/id="pulse/.test(html), "no static pulse element added to the Log markup");
assert.ok(styles.includes(".pulse-opt"), "pulse option styling exists (class-based, no inline styles)");
assert.ok(styles.includes(".pulse-ack"), "pulse acknowledgement styling exists");

// ---------------------------------------------------------------------------
// The GET token endpoint returns appVersion as the client's per-version
// cooldown bucket key (the stored record's version is still server-stamped).
// ---------------------------------------------------------------------------
{
  class LocalD1 {
    constructor() { this.sqlite = new DatabaseSync(":memory:"); this.sqlite.exec("PRAGMA foreign_keys = ON"); }
    prepare(sql) {
      const sqlite = this.sqlite;
      return { bind(...v) { return {
        all: async () => ({ results: sqlite.prepare(sql).all(...v) }),
        first: async () => sqlite.prepare(sql).get(...v) || null,
        run: async () => ({ success: true, meta: sqlite.prepare(sql).run(...v) }),
      }; } };
    }
  }
  const db = new LocalD1();
  // The token endpoint only needs the DB binding to exist (it mints CSRF and
  // does not query the pulse table), so the base schema is sufficient.
  db.sqlite.exec(readFileSync(join(import.meta.dirname, "..", "migrations", "0001_waitlist.sql"), "utf8"));
  const res = await worker.fetch(new Request("https://mototrack.app/api/experience-pulse", {
    method: "GET", headers: { accept: "application/json" },
  }), { WAITLIST_DB: db, EXPERIENCE_PULSE_ENABLED: "true", ASSETS: { fetch: async () => new Response("", { status: 404 }) } });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.appVersion, APP_VERSION, "GET returns the canonical app version as the cooldown bucket key");
  assert.ok(data.csrf, "GET still mints the CSRF token");
}

console.log("experience-pulse-client.test.js passed");
