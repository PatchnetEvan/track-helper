import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// MotoTrack Experience Pulse #55: the CLIENT cadence/cooldown engine, tested by
// executing THE ACTUAL SHIPPED FILE (public/experience-pulse-cadence.js) in a
// node:vm sandbox. There is no separate "reference" module that could drift from
// the browser code - the bytes the browser runs are the bytes asserted here.
// The frozen ceiling: <=1 automatic prompt per app session AND <=1 per
// app_version in a rolling 7-day window, and never right after a written
// Feedback submission. Cleared/disabled storage is an accepted limitation and
// must never throw.

const code = readFileSync(join(import.meta.dirname, "..", "public", "experience-pulse-cadence.js"), "utf8");
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const cadence = sandbox.MotoTrackPulseCadence;
assert.ok(cadence, "the shipped cadence file attaches its API to the global");

const VERSION = "0.1.0-beta.1";
const T0 = Date.parse("2026-08-10T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

class FakeStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
}
const throwingStorage = {
  getItem() { throw new Error("storage disabled"); },
  setItem() { throw new Error("storage disabled"); },
};
const stores = () => ({ sessionStorage: new FakeStorage(), localStorage: new FakeStorage() });

// ---------------------------------------------------------------------------
// Constants exactly as the spec requires.
// ---------------------------------------------------------------------------
{
  assert.equal(cadence.VERSION_WINDOW_DAYS, 7);
  assert.equal(cadence.VERSION_WINDOW_MS, 7 * DAY);
  assert.equal(cadence.SESSION_STORAGE_KEY, "mototrack_pulse_session_v1");
  assert.equal(cadence.VERSION_STORAGE_KEY, "mototrack_pulse_versions_v1");
}

// ---------------------------------------------------------------------------
// Pure decision: each constraint, in isolation and by precedence.
// ---------------------------------------------------------------------------
{
  // Note: objects returned from the vm sandbox have the sandbox realm's
  // prototype, so compare fields rather than deepEqual across realms.
  const fresh = cadence.pulseAutoPromptDecision({ now: T0, appVersion: VERSION });
  assert.equal(fresh.allowed, true);
  assert.equal(fresh.reason, "ok");
  assert.equal(cadence.pulseAutoPromptDecision({ now: T0, appVersion: VERSION, sessionShown: true }).reason, "session_cap");
  assert.equal(cadence.pulseAutoPromptDecision({ now: T0, appVersion: VERSION, feedbackSubmittedThisSession: true }).reason, "feedback_suppression");
  assert.equal(cadence.pulseAutoPromptDecision({ now: T0, appVersion: "" }).reason, "no_version");

  const shownIso = new Date(T0).toISOString();
  assert.equal(cadence.pulseAutoPromptDecision({ now: T0 + 6 * DAY, appVersion: VERSION, lastShownByVersion: { [VERSION]: shownIso } }).reason, "version_window");
  assert.equal(cadence.pulseAutoPromptDecision({ now: T0 + 7 * DAY, appVersion: VERSION, lastShownByVersion: { [VERSION]: shownIso } }).allowed, true, "at exactly 7 days the window has elapsed");
  assert.equal(cadence.pulseAutoPromptDecision({ now: T0 + 6 * DAY, appVersion: "0.2.0", lastShownByVersion: { [VERSION]: shownIso } }).allowed, true, "cooldown is per-version");
  assert.equal(cadence.pulseAutoPromptDecision({ now: T0 + 30 * DAY, appVersion: VERSION, sessionShown: true, lastShownByVersion: {} }).reason, "session_cap", "session cap takes precedence");
}

// ---------------------------------------------------------------------------
// Storage round-trip: <=1 automatic prompt per session.
// ---------------------------------------------------------------------------
{
  const s = stores();
  assert.equal(cadence.shouldAutoPrompt({ now: T0, appVersion: VERSION, ...s }).allowed, true, "first prompt allowed");
  cadence.recordPulsePrompted({ now: T0, appVersion: VERSION, ...s });
  assert.equal(cadence.shouldAutoPrompt({ now: T0 + 60000, appVersion: VERSION, ...s }).reason, "session_cap", "no second automatic prompt this session");
}

// ---------------------------------------------------------------------------
// <=1 per app_version / rolling 7 days, ACROSS sessions (shared localStorage,
// fresh sessionStorage each session).
// ---------------------------------------------------------------------------
{
  const local = new FakeStorage();
  cadence.recordPulsePrompted({ now: T0, appVersion: VERSION, sessionStorage: new FakeStorage(), localStorage: local });
  assert.equal(cadence.shouldAutoPrompt({ now: T0 + 6 * DAY, appVersion: VERSION, sessionStorage: new FakeStorage(), localStorage: local }).reason, "version_window");
  assert.equal(cadence.shouldAutoPrompt({ now: T0 + 7 * DAY, appVersion: VERSION, sessionStorage: new FakeStorage(), localStorage: local }).allowed, true);
  assert.equal(cadence.shouldAutoPrompt({ now: T0 + 1 * DAY, appVersion: "0.2.0-beta.1", sessionStorage: new FakeStorage(), localStorage: local }).allowed, true, "another version is independent");
}

// ---------------------------------------------------------------------------
// Written Feedback suppresses an immediate automatic pulse this session.
// ---------------------------------------------------------------------------
{
  const s = stores();
  assert.equal(cadence.shouldAutoPrompt({ now: T0, appVersion: VERSION, ...s }).allowed, true);
  cadence.recordFeedbackSubmitted(s);
  assert.equal(cadence.shouldAutoPrompt({ now: T0, appVersion: VERSION, ...s }).reason, "feedback_suppression");
}

// ---------------------------------------------------------------------------
// recordPulsePrompted persists the cap + version stamp AND prunes stale version
// entries so localStorage stays bounded (the behavior the old inline mirror
// lacked). readCadenceState reflects the persisted state.
// ---------------------------------------------------------------------------
{
  const s = stores();
  const { shownAt } = cadence.recordPulsePrompted({ now: T0, appVersion: VERSION, ...s });
  assert.equal(shownAt, new Date(T0).toISOString());
  const state = cadence.readCadenceState(s);
  assert.equal(state.sessionShown, true);
  assert.equal(state.lastShownByVersion[VERSION], shownAt);
  const session = JSON.parse(s.sessionStorage.getItem(cadence.SESSION_STORAGE_KEY));
  assert.deepEqual(Object.keys(session).sort(), ["shown"], "no identity persisted, just the cap flag");

  // Record a newer version 10 days later: the old (out-of-window) version entry
  // is pruned; only the current one remains.
  cadence.recordPulsePrompted({ now: T0 + 10 * DAY, appVersion: "0.2.0-beta.1", ...s });
  const versions = JSON.parse(s.localStorage.getItem(cadence.VERSION_STORAGE_KEY));
  assert.deepEqual(Object.keys(versions), ["0.2.0-beta.1"], "stale version entry pruned; storage bounded");
}

// ---------------------------------------------------------------------------
// Resilience: disabled/throwing/missing storage never crashes.
// ---------------------------------------------------------------------------
{
  const s = { sessionStorage: throwingStorage, localStorage: throwingStorage };
  assert.equal(cadence.shouldAutoPrompt({ now: T0, appVersion: VERSION, ...s }).allowed, true, "unreadable storage -> treated as no history");
  let shownAt;
  assert.doesNotThrow(() => { ({ shownAt } = cadence.recordPulsePrompted({ now: T0, appVersion: VERSION, ...s })); });
  assert.equal(shownAt, new Date(T0).toISOString());
  assert.equal(cadence.recordFeedbackSubmitted(s), false, "unwritable storage reports it could not persist, no throw");
  assert.equal(cadence.shouldAutoPrompt({ now: T0, appVersion: VERSION }).allowed, true, "missing storages -> no throw");
  assert.doesNotThrow(() => cadence.recordPulsePrompted({ now: T0, appVersion: VERSION }));
}

console.log("experience-pulse-cooldown.test.js passed");
