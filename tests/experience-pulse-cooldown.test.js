import assert from "node:assert/strict";
import {
  pulseAutoPromptDecision, shouldAutoPrompt, recordPulsePrompted, recordFeedbackSubmitted,
  readCadenceState, PULSE_VERSION_WINDOW_MS, PULSE_VERSION_WINDOW_DAYS,
  PULSE_SESSION_STORAGE_KEY, PULSE_VERSION_STORAGE_KEY,
} from "../src/experience-pulse-cooldown.js";

// MotoTrack Experience Pulse #55 PR3A: the CLIENT cadence/cooldown contract,
// proven as pure logic. The frozen ceiling: <=1 automatic prompt per app
// session AND <=1 per app_version in a rolling 7-day window, and never
// immediately after a written Feedback submission. Cleared/disabled storage is
// an accepted limitation and must never throw.

const VERSION = "0.1.0-beta.1";
const T0 = Date.parse("2026-08-10T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

// A Storage-like backed by a Map (matches getItem/setItem semantics).
class FakeStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
}
// A hostile Storage that throws on every access (private mode / disabled).
const throwingStorage = {
  getItem() { throw new Error("storage disabled"); },
  setItem() { throw new Error("storage disabled"); },
};
const stores = () => ({ sessionStorage: new FakeStorage(), localStorage: new FakeStorage() });

// ---------------------------------------------------------------------------
// Window constant is exactly 7 days.
// ---------------------------------------------------------------------------
{
  assert.equal(PULSE_VERSION_WINDOW_DAYS, 7);
  assert.equal(PULSE_VERSION_WINDOW_MS, 7 * DAY);
}

// ---------------------------------------------------------------------------
// Pure decision: each constraint, in isolation and by precedence.
// ---------------------------------------------------------------------------
{
  assert.deepEqual(pulseAutoPromptDecision({ now: T0, appVersion: VERSION }), { allowed: true, reason: "ok" });

  assert.equal(pulseAutoPromptDecision({ now: T0, appVersion: VERSION, sessionShown: true }).reason, "session_cap");
  assert.equal(pulseAutoPromptDecision({ now: T0, appVersion: VERSION, feedbackSubmittedThisSession: true }).reason, "feedback_suppression");
  assert.equal(pulseAutoPromptDecision({ now: T0, appVersion: "" }).reason, "no_version");

  // version window: within 7 days blocks; at/after 7 days allows; a different
  // version is independent.
  const shownIso = new Date(T0).toISOString();
  assert.equal(pulseAutoPromptDecision({ now: T0 + 6 * DAY, appVersion: VERSION, lastShownByVersion: { [VERSION]: shownIso } }).reason, "version_window");
  assert.equal(pulseAutoPromptDecision({ now: T0 + 7 * DAY, appVersion: VERSION, lastShownByVersion: { [VERSION]: shownIso } }).allowed, true, "at exactly 7 days the window has elapsed");
  assert.equal(pulseAutoPromptDecision({ now: T0 + 6 * DAY, appVersion: "0.2.0", lastShownByVersion: { [VERSION]: shownIso } }).allowed, true, "cooldown is per-version");

  // session cap takes precedence over an otherwise-open window.
  assert.equal(pulseAutoPromptDecision({ now: T0 + 30 * DAY, appVersion: VERSION, sessionShown: true, lastShownByVersion: {} }).reason, "session_cap");
}

// ---------------------------------------------------------------------------
// Storage round-trip: <=1 automatic prompt per session.
// ---------------------------------------------------------------------------
{
  const s = stores();
  assert.equal(shouldAutoPrompt({ now: T0, appVersion: VERSION, ...s }).allowed, true, "first prompt allowed");
  recordPulsePrompted({ now: T0, appVersion: VERSION, ...s });
  assert.equal(shouldAutoPrompt({ now: T0 + 60000, appVersion: VERSION, ...s }).reason, "session_cap", "no second automatic prompt this session");
}

// ---------------------------------------------------------------------------
// <=1 per app_version in a rolling 7-day window, ACROSS sessions (shared
// localStorage, fresh sessionStorage each session).
// ---------------------------------------------------------------------------
{
  const local = new FakeStorage();
  // Session A shows a prompt at T0.
  const a = { sessionStorage: new FakeStorage(), localStorage: local };
  recordPulsePrompted({ now: T0, appVersion: VERSION, ...a });

  // Session B, 6 days later: the version window still blocks despite a fresh
  // session.
  const b = { sessionStorage: new FakeStorage(), localStorage: local };
  assert.equal(shouldAutoPrompt({ now: T0 + 6 * DAY, appVersion: VERSION, ...b }).reason, "version_window");

  // Session C, 7 days later: the window has elapsed - allowed again.
  const c = { sessionStorage: new FakeStorage(), localStorage: local };
  assert.equal(shouldAutoPrompt({ now: T0 + 7 * DAY, appVersion: VERSION, ...c }).allowed, true);

  // A different app_version is never blocked by another version's window.
  const d = { sessionStorage: new FakeStorage(), localStorage: local };
  assert.equal(shouldAutoPrompt({ now: T0 + 1 * DAY, appVersion: "0.2.0-beta.1", ...d }).allowed, true);
}

// ---------------------------------------------------------------------------
// Written Feedback suppresses an immediate automatic pulse this session.
// ---------------------------------------------------------------------------
{
  const s = stores();
  assert.equal(shouldAutoPrompt({ now: T0, appVersion: VERSION, ...s }).allowed, true);
  recordFeedbackSubmitted(s);
  assert.equal(shouldAutoPrompt({ now: T0, appVersion: VERSION, ...s }).reason, "feedback_suppression", "no pulse right after written feedback");
}

// ---------------------------------------------------------------------------
// recordPulsePrompted persists both the session cap and the version stamp, and
// readCadenceState reflects them.
// ---------------------------------------------------------------------------
{
  const s = stores();
  const { shownAt } = recordPulsePrompted({ now: T0, appVersion: VERSION, ...s });
  const state = readCadenceState(s);
  assert.equal(state.sessionShown, true);
  assert.equal(state.lastShownByVersion[VERSION], shownAt);
  assert.equal(shownAt, new Date(T0).toISOString());
  // The persisted JSON is bounded to the safe keys - no identity is stored.
  const session = JSON.parse(s.sessionStorage.getItem(PULSE_SESSION_STORAGE_KEY));
  assert.deepEqual(Object.keys(session).sort(), ["shown"]);
  const versions = JSON.parse(s.localStorage.getItem(PULSE_VERSION_STORAGE_KEY));
  assert.deepEqual(Object.keys(versions), [VERSION]);
}

// ---------------------------------------------------------------------------
// Resilience: disabled/throwing storage is an accepted limitation, never a
// crash. Decisions degrade to "no history" (allowed) and writes are no-ops.
// ---------------------------------------------------------------------------
{
  const s = { sessionStorage: throwingStorage, localStorage: throwingStorage };
  assert.equal(shouldAutoPrompt({ now: T0, appVersion: VERSION, ...s }).allowed, true, "unreadable storage -> treated as no history");
  let shownAt;
  assert.doesNotThrow(() => { ({ shownAt } = recordPulsePrompted({ now: T0, appVersion: VERSION, ...s })); }, "recording never throws");
  assert.equal(shownAt, new Date(T0).toISOString(), "still reports the intended stamp");
  assert.equal(recordFeedbackSubmitted(s), false, "unwritable storage reports it could not persist, without throwing");

  // Missing storages entirely (undefined) also never throw.
  assert.equal(shouldAutoPrompt({ now: T0, appVersion: VERSION }).allowed, true);
  assert.doesNotThrow(() => recordPulsePrompted({ now: T0, appVersion: VERSION }));
}

console.log("experience-pulse-cooldown.test.js passed");
