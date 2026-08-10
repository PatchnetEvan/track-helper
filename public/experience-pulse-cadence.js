// MotoTrack Experience Pulse - client cadence/cooldown engine (#55). This is the
// SINGLE source of truth for the frozen prompt-cadence CEILING, shipped to the
// browser AND executed directly by the test suite (tests/experience-pulse-cooldown
// .test.js loads THIS file in a node:vm sandbox), so the tested code and the
// shipped code are literally the same bytes - no hand-mirrored copy that can
// drift. It attaches a small pure API to the global object; public/app.js (the
// DOM controller) calls it, and the vm test reads it off the sandbox global.
//
// The ceiling:
//   at most 1 AUTOMATIC pulse prompt per app session
//   AND at most 1 per app_version in a rolling 7-day window
//   AND never immediately after a written Feedback submission (this session).
//
// It is deliberately CLIENT-side: a pulse is anonymous, so there is no
// server-side rider identity to key a cooldown on, and we refuse to invent one.
// Cleared storage or storage-disabled browsers are an ACCEPTED limitation (the
// ceiling may not hold across such a reset) - never a reason to add tracking.
// Every helper is defensive: unreadable/unwritable storage degrades to "no
// history", never throws. This engine governs AUTOMATIC prompts only; a 'manual'
// pulse is rider-initiated and is not gated here.
//
// PURE: no DOM, no fetch, no window/document access, no ambient clock - `now` is
// passed in. Standard ECMAScript built-ins only (Date/JSON/Object), so it runs
// unchanged in a browser and in a bare vm context.
(function (root) {
  "use strict";

  var VERSION_WINDOW_DAYS = 7;
  var VERSION_WINDOW_MS = VERSION_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  var SESSION_STORAGE_KEY = "mototrack_pulse_session_v1";
  var VERSION_STORAGE_KEY = "mototrack_pulse_versions_v1";

  function safeGet(storage, key) {
    try { return storage && typeof storage.getItem === "function" ? storage.getItem(key) : null; }
    catch (_) { return null; }
  }
  function safeSet(storage, key, value) {
    try { if (storage && typeof storage.setItem === "function") { storage.setItem(key, value); return true; } }
    catch (_) { /* disabled/full - accepted limitation */ }
    return false;
  }
  function parseObject(raw) {
    if (typeof raw !== "string" || raw === "") return {};
    try { var v = JSON.parse(raw); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; }
    catch (_) { return {}; }
  }
  // Drop version entries outside the rolling window, keeping the record bounded.
  // Removing an out-of-window entry never changes a decision.
  function pruneVersions(versions, now) {
    var kept = {};
    for (var version in versions) {
      if (!Object.prototype.hasOwnProperty.call(versions, version)) continue;
      var shownAt = Date.parse(versions[version]);
      if (isFinite(shownAt) && (now - shownAt) < VERSION_WINDOW_MS) kept[version] = versions[version];
    }
    return kept;
  }

  // Pure decision: the whole cadence rule as a function of explicit state.
  // `now` is epoch ms. Returns { allowed, reason }.
  function pulseAutoPromptDecision(opts) {
    opts = opts || {};
    var now = opts.now;
    var appVersion = opts.appVersion;
    if (typeof appVersion !== "string" || appVersion === "") return { allowed: false, reason: "no_version" };
    if (opts.sessionShown === true) return { allowed: false, reason: "session_cap" };
    if (opts.feedbackSubmittedThisSession === true) return { allowed: false, reason: "feedback_suppression" };
    var last = (opts.lastShownByVersion || {})[appVersion];
    if (typeof last === "string") {
      var shownAt = Date.parse(last);
      if (isFinite(shownAt) && (now - shownAt) < VERSION_WINDOW_MS) return { allowed: false, reason: "version_window" };
    }
    return { allowed: true, reason: "ok" };
  }

  function readCadenceState(stores) {
    stores = stores || {};
    var session = parseObject(safeGet(stores.sessionStorage, SESSION_STORAGE_KEY));
    var versions = parseObject(safeGet(stores.localStorage, VERSION_STORAGE_KEY));
    return {
      sessionShown: session.shown === true,
      feedbackSubmittedThisSession: session.feedbackSubmitted === true,
      lastShownByVersion: versions,
    };
  }

  // Read storage and decide in one call. stores = { sessionStorage, localStorage }.
  function shouldAutoPrompt(opts) {
    opts = opts || {};
    var state = readCadenceState(opts);
    return pulseAutoPromptDecision({
      now: opts.now,
      appVersion: opts.appVersion,
      sessionShown: state.sessionShown,
      feedbackSubmittedThisSession: state.feedbackSubmittedThisSession,
      lastShownByVersion: state.lastShownByVersion,
    });
  }

  // Record that an automatic prompt was SHOWN: mark the session cap AND stamp the
  // version window (so a dismissed-without-answer prompt still counts). Prunes
  // stale version entries so localStorage stays bounded.
  function recordPulsePrompted(opts) {
    opts = opts || {};
    var session = parseObject(safeGet(opts.sessionStorage, SESSION_STORAGE_KEY));
    session.shown = true;
    safeSet(opts.sessionStorage, SESSION_STORAGE_KEY, JSON.stringify(session));

    var iso = new Date(opts.now).toISOString();
    if (typeof opts.appVersion === "string" && opts.appVersion !== "") {
      var versions = parseObject(safeGet(opts.localStorage, VERSION_STORAGE_KEY));
      versions[opts.appVersion] = iso;
      safeSet(opts.localStorage, VERSION_STORAGE_KEY, JSON.stringify(pruneVersions(versions, opts.now)));
    }
    return { shownAt: iso };
  }

  // Suppression hook: a written Feedback submission just succeeded, so no
  // automatic pulse should follow in this session.
  function recordFeedbackSubmitted(opts) {
    opts = opts || {};
    var session = parseObject(safeGet(opts.sessionStorage, SESSION_STORAGE_KEY));
    session.feedbackSubmitted = true;
    return safeSet(opts.sessionStorage, SESSION_STORAGE_KEY, JSON.stringify(session));
  }

  root.MotoTrackPulseCadence = {
    VERSION_WINDOW_DAYS: VERSION_WINDOW_DAYS,
    VERSION_WINDOW_MS: VERSION_WINDOW_MS,
    SESSION_STORAGE_KEY: SESSION_STORAGE_KEY,
    VERSION_STORAGE_KEY: VERSION_STORAGE_KEY,
    pulseAutoPromptDecision: pulseAutoPromptDecision,
    readCadenceState: readCadenceState,
    shouldAutoPrompt: shouldAutoPrompt,
    recordPulsePrompted: recordPulsePrompted,
    recordFeedbackSubmitted: recordFeedbackSubmitted,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
