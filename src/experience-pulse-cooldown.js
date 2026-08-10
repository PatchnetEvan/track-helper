// MotoTrack Experience Pulse - client cadence/cooldown contract (#55, PR3A).
//
// This is PURE logic: no DOM, no fetch, no window, no ambient clock. It is the
// single, tested source of truth for the frozen prompt cadence CEILING:
//
//   at most 1 AUTOMATIC pulse prompt per app session
//   AND at most 1 per app_version in a rolling 7-day window
//   AND never immediately after a written Feedback submission (this session).
//
// It is deliberately CLIENT-side: a pulse is anonymous, so there is no
// server-side rider identity to key a cooldown on, and we refuse to invent one.
// Cleared storage or a browser with storage disabled is an ACCEPTED limitation
// (the ceiling may not hold across such a reset) - never a reason to add
// tracking. Every helper is therefore defensive: unreadable/unwritable storage
// degrades to "no history", never throws.
//
// This module governs AUTOMATIC prompts only. A 'manual' pulse (an explicitly
// opened Pulse surface) is rider-initiated and is NOT gated by this cooldown.
//
// PLACEMENT NOTE: the visible 1/2/3 control and its DOM trigger points are a
// deferred product decision (the frozen #55 spec fixes the trigger CONTEXTS -
// after_save, after_review - but not the exact control placement). When that is
// settled, the browser controller consumes this contract: shouldAutoPrompt()
// before rendering an automatic prompt, recordPulsePrompted() when one is
// shown, and recordFeedbackSubmitted() from the written-Feedback success path.
// This lives in src/ (private) as the tested reference; a served client mirror
// is added with the placement work, never before.

export const PULSE_VERSION_WINDOW_DAYS = 7;
export const PULSE_VERSION_WINDOW_MS = PULSE_VERSION_WINDOW_DAYS * 24 * 60 * 60 * 1000;

// sessionStorage: per app-session state. { shown, feedbackSubmitted }.
export const PULSE_SESSION_STORAGE_KEY = "mototrack_pulse_session_v1";
// localStorage: per-version last-shown timestamps. { [appVersion]: isoString }.
export const PULSE_VERSION_STORAGE_KEY = "mototrack_pulse_versions_v1";

// --- defensive storage access ----------------------------------------------
function safeGet(storage, key) {
  try {
    return storage && typeof storage.getItem === "function" ? storage.getItem(key) : null;
  } catch (_) { return null; }
}
function safeSet(storage, key, value) {
  try {
    if (storage && typeof storage.setItem === "function") { storage.setItem(key, value); return true; }
  } catch (_) { /* storage disabled/full - accepted limitation */ }
  return false;
}
function parseObject(raw) {
  if (typeof raw !== "string" || raw === "") return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch (_) { return {}; }
}

// Drop version entries whose last-shown is outside the rolling window, keeping
// the localStorage record bounded. Removing an out-of-window entry never
// changes a decision (it would be "allowed" either way).
function pruneVersions(versions, now) {
  const kept = {};
  for (const [version, iso] of Object.entries(versions)) {
    const shownAt = Date.parse(iso);
    if (Number.isFinite(shownAt) && (now - shownAt) < PULSE_VERSION_WINDOW_MS) kept[version] = iso;
  }
  return kept;
}

// --- pure decision ----------------------------------------------------------
// The whole cadence rule, as a pure function of explicit state. `now` is epoch
// ms. Returns { allowed, reason } - reason names the binding constraint so the
// client (and tests) can distinguish session_cap / feedback_suppression /
// version_window without re-deriving them.
export function pulseAutoPromptDecision({
  now,
  appVersion,
  sessionShown = false,
  feedbackSubmittedThisSession = false,
  lastShownByVersion = {},
} = {}) {
  if (typeof appVersion !== "string" || appVersion === "") return { allowed: false, reason: "no_version" };
  if (sessionShown) return { allowed: false, reason: "session_cap" };
  if (feedbackSubmittedThisSession) return { allowed: false, reason: "feedback_suppression" };
  const last = lastShownByVersion[appVersion];
  if (typeof last === "string") {
    const shownAt = Date.parse(last);
    if (Number.isFinite(shownAt) && (now - shownAt) < PULSE_VERSION_WINDOW_MS) {
      return { allowed: false, reason: "version_window" };
    }
  }
  return { allowed: true, reason: "ok" };
}

// --- storage-backed state ---------------------------------------------------
// Read the cadence state from a { sessionStorage, localStorage } pair (either
// may be absent/disabled). Shapes it into the fields pulseAutoPromptDecision
// expects.
export function readCadenceState({ sessionStorage, localStorage } = {}) {
  const session = parseObject(safeGet(sessionStorage, PULSE_SESSION_STORAGE_KEY));
  const versions = parseObject(safeGet(localStorage, PULSE_VERSION_STORAGE_KEY));
  return {
    sessionShown: session.shown === true,
    feedbackSubmittedThisSession: session.feedbackSubmitted === true,
    lastShownByVersion: versions,
  };
}

// Convenience: read state from storage and decide in one call.
export function shouldAutoPrompt({ now, appVersion, sessionStorage, localStorage } = {}) {
  return pulseAutoPromptDecision({ now, appVersion, ...readCadenceState({ sessionStorage, localStorage }) });
}

// Record that an automatic prompt was shown: mark the session cap AND stamp the
// version window. Call this when a prompt is DISPLAYED, so the ceiling holds
// even if the rider dismisses it without answering.
export function recordPulsePrompted({ now, appVersion, sessionStorage, localStorage } = {}) {
  const session = parseObject(safeGet(sessionStorage, PULSE_SESSION_STORAGE_KEY));
  session.shown = true;
  safeSet(sessionStorage, PULSE_SESSION_STORAGE_KEY, JSON.stringify(session));

  const iso = new Date(now).toISOString();
  if (typeof appVersion === "string" && appVersion !== "") {
    const versions = parseObject(safeGet(localStorage, PULSE_VERSION_STORAGE_KEY));
    versions[appVersion] = iso;
    safeSet(localStorage, PULSE_VERSION_STORAGE_KEY, JSON.stringify(pruneVersions(versions, now)));
  }
  return { shownAt: iso };
}

// Suppression hook: a written Feedback submission just succeeded, so no
// automatic pulse should follow in this session. Combined with the session cap
// this guarantees the rider is never asked to pulse right after explaining in
// full sentences.
export function recordFeedbackSubmitted({ sessionStorage } = {}) {
  const session = parseObject(safeGet(sessionStorage, PULSE_SESSION_STORAGE_KEY));
  session.feedbackSubmitted = true;
  return safeSet(sessionStorage, PULSE_SESSION_STORAGE_KEY, JSON.stringify(session));
}
