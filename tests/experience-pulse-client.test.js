import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import worker from "../src/waitlist-worker.js";
import { APP_VERSION } from "../src/app-version.js";

// MotoTrack Experience Pulse #55 (placement wiring): the inline client in
// public/app.js, asserted structurally (no DOM in `node --test`). The cadence
// ENGINE is a single shared file (public/experience-pulse-cadence.js) that the
// client calls and the cooldown suite behaviorally tests via node:vm - so this
// file's job is to prove the client (a) uses that shared engine rather than a
// drift-prone inline copy, (b) places the control exactly per the frozen
// decision, and (c) preserves the one-tap / no-Feedback-coupling behaviors.

const appJs = readFileSync(join(import.meta.dirname, "..", "public", "app.js"), "utf8");
const cadenceJs = readFileSync(join(import.meta.dirname, "..", "public", "experience-pulse-cadence.js"), "utf8");
const styles = readFileSync(join(import.meta.dirname, "..", "public", "styles.css"), "utf8");
const html = readFileSync(join(import.meta.dirname, "..", "public", "log", "index.html"), "utf8");

const pulseStart = appJs.indexOf("function experiencePulse()");
const pulseEnd = appJs.indexOf("// Initial state");
assert.ok(pulseStart >= 0 && pulseEnd > pulseStart, "pulse controller present");
const pulse = appJs.slice(pulseStart, pulseEnd);

// ---------------------------------------------------------------------------
// Exact rider-facing copy.
// ---------------------------------------------------------------------------
assert.ok(pulse.includes("How was this experience?"), "exact pulse question");
assert.ok(pulse.includes("1 — Not good"), "exact value 1 label (em dash)");
assert.ok(pulse.includes("2 — Okay"), "exact value 2 label");
assert.ok(pulse.includes("3 — Good"), "exact value 3 label");
assert.ok(pulse.includes('"Thanks."'), "exact one-tap acknowledgement");
assert.ok(pulse.includes("/api/experience-pulse"), "dedicated pulse endpoint");

// ---------------------------------------------------------------------------
// SINGLE SOURCE OF TRUTH for cadence: the client delegates to the shared engine
// and does NOT carry its own copy of the cadence logic (which could drift). The
// engine is loaded by the Log page before app.js.
// ---------------------------------------------------------------------------
assert.ok(pulse.includes("MotoTrackPulseCadence"), "client uses the shared cadence engine");
assert.ok(pulse.includes("shouldAutoPrompt("), "client asks the engine whether to prompt");
assert.ok(pulse.includes("recordPulsePrompted("), "client records the shown prompt via the engine (session cap + version window)");
assert.ok(pulse.includes("recordFeedbackSubmitted("), "client records feedback suppression via the engine");
// No inline cadence copy in the client: the window constant and storage keys
// live ONLY in the engine file, so there is nothing to drift.
assert.ok(!pulse.includes("7 * 24 * 60 * 60 * 1000"), "no inline cadence window in the client");
assert.ok(!pulse.includes("mototrack_pulse_session_v1"), "no inline session key in the client");
assert.ok(!pulse.includes("mototrack_pulse_versions_v1"), "no inline version key in the client");
// The Log page loads the engine before app.js.
assert.ok(/experience-pulse-cadence\.js[^\n]*defer[\s\S]*app\.js/.test(html), "engine script loaded before app.js");
// The engine file is pure (no DOM/network) so the vm-based cooldown test can run it.
for (const forbidden of ["document.", "fetch(", "addEventListener", "innerHTML"]) {
  assert.ok(!cadenceJs.includes(forbidden), `cadence engine must stay pure (${forbidden})`);
}
assert.ok(cadenceJs.includes("mototrack_pulse_session_v1"), "cadence session key lives in the engine");
assert.ok(cadenceJs.includes("VERSION_WINDOW_DAYS = 7") && cadenceJs.includes("24 * 60 * 60 * 1000"), "cadence 7-day window lives in the engine");

// ---------------------------------------------------------------------------
// Fail-closed reveal + expiry-safe submit (adversarial-review finding).
// ---------------------------------------------------------------------------
assert.ok(pulse.includes("if (!res.ok) return false"), "availability bootstrap bails on a non-OK GET");
assert.ok(/available\s*=\s*true/.test(pulse), "availability set only after a successful token fetch");
assert.ok(/if\s*\(!available\s*\|\|\s*!cadence\s*\|\|\s*!target\)\s*return/.test(pulse), "no render unless available and engine present");
assert.ok(pulse.includes(".allowed) return"), "render gated on the engine's cadence decision");
// A genuine tap must survive an expired token: submit re-mints and retries once.
assert.ok(/res\.status\s*!==\s*201[\s\S]*fetchToken\(\)[\s\S]*postPulse/.test(pulse), "submit re-mints the token and retries on a non-201");
// Double-submit prevention: option buttons are disabled at the top of submit.
assert.ok(/b\.disabled\s*=\s*true/.test(pulse), "option buttons disabled on tap (no double submit)");

// ---------------------------------------------------------------------------
// Placement (Option 1, FINAL): after_save on save-this-session, after_review on
// build-summary, and NO automatic pulse on Save & next.
// ---------------------------------------------------------------------------
assert.ok(/maybePrompt\(r\.out,\s*"after_save"\)/.test(appJs), "after_save prompts in the save-result region");
assert.ok(/maybePrompt\(el,\s*"after_review"\)/.test(appJs), "after_review prompts in the summary-result region");
// Save & next must NOT prompt (frozen decision). Slice its handler and assert
// there is no maybePrompt in it.
const sanStart = appJs.indexOf('getElementById("save-and-next")');
assert.ok(sanStart >= 0, "save-and-next handler present");
const sanHandler = appJs.slice(sanStart, appJs.indexOf("function renderHistory"));
assert.ok(!sanHandler.includes("maybePrompt"), "Save & next never triggers an automatic pulse (frozen decision)");

// ---------------------------------------------------------------------------
// Never touches the Feedback UI (no auto-open, incl. for "1"), never
// special-cases value 1, no manual-pulse UI in v1.
// ---------------------------------------------------------------------------
for (const forbidden of ["overlay", "feedback-open", "feedback-overlay", "form.hidden"]) {
  assert.ok(!pulse.includes(forbidden), `pulse controller must not manipulate the Feedback UI (${forbidden})`);
}
assert.ok(!/value\s*===\s*1/.test(pulse), "no special-casing of the '1 - Not good' response");
assert.ok(!pulse.includes('"manual"'), "no automatic 'manual' trigger wired (manual stays reserved, no v1 UI)");

// ---------------------------------------------------------------------------
// Written-Feedback success suppresses an immediate pulse (hook in the 201
// branch).
// ---------------------------------------------------------------------------
const okBranch = appJs.slice(appJs.indexOf("res.status === 201"), appJs.indexOf("res.status === 400"));
assert.ok(okBranch.includes("recordFeedbackSubmitted()"), "feedback success records pulse suppression");

// ---------------------------------------------------------------------------
// Inline, not a modal / new permanent element; class-based styling only.
// ---------------------------------------------------------------------------
assert.ok(!/class="pulse"/.test(html) && !/id="pulse/.test(html), "no static pulse element added to the Log markup");
assert.ok(styles.includes(".pulse-opt") && styles.includes(".pulse-ack"), "class-based pulse styling exists (no inline styles)");

// ---------------------------------------------------------------------------
// GET token endpoint returns appVersion (client cooldown bucket key); the
// stored record's version is still server-stamped on POST.
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
