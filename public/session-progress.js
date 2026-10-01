(function () {
  "use strict";

  // --- Session progress decisions (C5, C13) ---------------------------------
  //
  // The rules that decide what a session may do next, kept apart from the DOM
  // that renders them so they can be exercised directly. Everything here is
  // pure: no element is read, nothing is stored, and no function has an effect
  // beyond the object it is called on.
  //
  // None of this is persisted. The caller holds it in memory for the life of
  // the page, which is the whole of a draft's life today.

  // --- The next session label -----------------------------------------------
  //
  // ONE rule, used for what the button displays AND for what gets written into
  // the field. If a bump is not safe to show, it is not safe to write.
  //
  // The label is free text. Incrementing the last run of digits is right for
  // "Session 2" and "Q1 - damp", and wrong for an ordinal: "2nd outing" would
  // become "3nd outing". So a bump counts as clean only when what follows the
  // digits is not an ordinal suffix. Anything else leaves the rider's label
  // exactly as they typed it and the caller says "next session" rather than
  // inventing a number.
  function nextLabelFrom(label) {
    const current = (label == null ? "" : String(label)).trim();
    const m = current.match(/^(.*?)(\d+)(\D*)$/);
    if (!m) return { label: current, clean: false };
    if (/^(st|nd|rd|th)/i.test(m[3])) return { label: current, clean: false };
    const bumped = m[1] + String(parseInt(m[2], 10) + 1) + m[3];
    return { label: bumped, clean: bumped !== current };
  }

  // --- Stage state ----------------------------------------------------------
  //
  // POST AVAILABILITY AND PRE EDITABILITY ARE TWO SEPARATE QUESTIONS, held as
  // two separate values on purpose. Coming back in unlocks POST for good.
  // Correcting PRE afterwards reopens the PRE fields and must NEVER re-lock
  // POST: the rider fixing a typo has already been back in, and that does not
  // become untrue.
  function createStageState() {
    let postUnlocked = false;
    let preEditable = true;
    return {
      get postUnlocked() { return postUnlocked; },
      get preEditable() { return preEditable; },
      // The explicit forward action. Navigation never calls this.
      backIn() { postUnlocked = true; preEditable = false; return this; },
      // Reopens PRE for editing. Deliberately does not touch postUnlocked.
      correctPre() { preEditable = true; return this; },
      // A finished session says nothing about whether this rider is back in,
      // so copying one must never imply the transition.
      copyFromSaved() { postUnlocked = false; preEditable = true; return this; },
      reset() { postUnlocked = false; preEditable = true; return this; },
      // Navigation may show POST only once it is unlocked. This answers the
      // question; it never changes the answer.
      mayOpen(stage) { return stage === "post" ? postUnlocked : true; },
    };
  }

  // --- Save state -----------------------------------------------------------
  //
  // Stops the same unchanged session being written twice, and stops two taps
  // landing two records. A FAILED SAVE CHANGES NOTHING - the form stays dirty,
  // stays saveable, and keeps every value.
  function createSaveState() {
    let dirty = false;
    let lastSavedId = null;
    let lastSavedAt = null;
    let inFlight = false;
    let failed = false;
    let pendingId = null;
    return {
      get dirty() { return dirty; },
      get lastSavedId() { return lastSavedId; },
      get lastSavedAt() { return lastSavedAt; },
      get inFlight() { return inFlight; },
      get failed() { return failed; },
      // The id of a save that has been attempted but not yet verified. The
      // retry REUSES it, so a write that landed without being readable back
      // is reconciled in place instead of being written a second time.
      get pendingId() { return pendingId; },
      // Nothing new to write, and something already written.
      get alreadySaved() { return !dirty && lastSavedId !== null; },
      markDirty() { dirty = true; failed = false; return this; },
      // Called at the start of an attempt: hands back the id to write under.
      claimSaveId(makeId) {
        if (!pendingId) pendingId = makeId();
        return pendingId;
      },
      // Returns the decision rather than acting on it, so the caller cannot
      // start a save the rules would refuse.
      beginSave() {
        if (inFlight) return { start: false, reason: "in-flight" };
        if (this.alreadySaved) return { start: false, reason: "already-saved" };
        inFlight = true;
        failed = false;
        return { start: true };
      },
      saveSucceeded(id, at) {
        inFlight = false;
        dirty = false;
        failed = false;
        pendingId = null;              // verified, so nothing is pending
        lastSavedId = id == null ? lastSavedId : id;
        lastSavedAt = at == null ? lastSavedAt : at;
        return this;
      },
      // dirty, values and pendingId all untouched: the entries survive and the
      // retry reuses the same record.
      saveFailed() { inFlight = false; failed = true; return this; },
      // After the carried-over fields are cleared the form is a new session:
      // nothing saved, nothing new, and NOTHING carried over from the record
      // just written - including its pending id and its saved-at time.
      advanced() {
        dirty = false; lastSavedId = null; lastSavedAt = null;
        failed = false; pendingId = null; return this;
      },
      reset() {
        dirty = false; lastSavedId = null; lastSavedAt = null;
        inFlight = false; failed = false; pendingId = null; return this;
      },
    };
  }

  // --- Which fields actually reach a saved session --------------------------
  //
  // Only a change to one of these can make the form worth saving again. The
  // first version of this listened to every input inside <main>, which meant
  // picking two sessions to COMPARE, or typing into a calculator that feeds
  // nothing, re-armed the save button - and Save & next then wrote a second
  // copy of an outing that had not changed.
  //
  // This list is the read-side of collectSession(). A test asserts the two
  // agree, so adding a field to the saved session without adding it here
  // fails rather than silently going untracked.
  const SESSION_FIELD_IDS = [
    // setup
    "bike", "track", "session-label", "amb-temp", "track-temp", "humidity",
    "general-notes",
    // setup.geometryConstants - saved, even though the inputs sit among the
    // calculators. The other sag and tire-core inputs are working-out and are
    // deliberately absent.
    "geo-wheelbase", "geo-design-rake", "geo-front-radius", "geo-fork-offset",
    "sag-front-l1", "sag-rear-l1",
    // tires
    "tire-brand", "tire-model", "front-pre", "rear-pre", "front-post",
    "rear-post", "warmer-on", "warmer-time",
    // riderFeedback
    "rider-feedback",
    // suspension
    "fork-preload", "fork-comp", "fork-reb",
    "shock-preload", "shock-comp", "shock-reb",
    // laps
    "laps-input",
  ];
  // Checkbox groups are read by container, not by id.
  const SESSION_FIELD_CONTAINERS = ["feedback-tags", "symptoms"];
  const SESSION_FIELD_SET = new Set(SESSION_FIELD_IDS);

  // Takes the plain facts about an element rather than the element, so the
  // rule can be exercised without a DOM.
  function isSessionField(id, containerIds) {
    if (id && SESSION_FIELD_SET.has(id)) return true;
    if (!containerIds) return false;
    const list = Array.isArray(containerIds) ? containerIds : [containerIds];
    return list.some((c) => SESSION_FIELD_CONTAINERS.indexOf(c) !== -1);
  }

  // --- Save status (C7) -----------------------------------------------------
  //
  // One line, derived entirely from save state. It holds no state of its own,
  // so it cannot drift from what actually happened.
  //
  // "Saved on this device" is the one string here that must never be
  // optimistic: it is shown only after a write that was read back and whose
  // CONTENT matched. Everything this app cannot do - cloud, sync, queued
  // uploads, draft recovery - is absent on purpose, not by omission. A test
  // asserts this vocabulary never acquires those words.
  function saveStatusFor(facts) {
    const f = facts || {};
    if (!f.storageReady) {
      return { key: "blocked", tone: "warn",
        text: "Not saving \u00b7 this browser blocks storage" };
    }
    if (f.failed) {
      // Deliberately does NOT name a cause. A write can fail for reasons this
      // app cannot distinguish, and guessing "storage refused it" would state
      // something unestablished.
      return { key: "failed", tone: "warn", text: "Not saved \u00b7 try Save again" };
    }
    if (f.alreadySaved && f.savedAtLabel) {
      return { key: "saved", tone: "good",
        text: "Saved on this device \u00b7 " + f.savedAtLabel };
    }
    if (f.hasContent) {
      return { key: "unsaved", tone: "dim", text: "Not saved yet \u00b7 REVIEW saves it" };
    }
    return { key: "none", tone: "dim", text: "" };
  }

  const api = {
    nextLabelFrom, createStageState, createSaveState, saveStatusFor,
    isSessionField, SESSION_FIELD_IDS, SESSION_FIELD_CONTAINERS,
  };
  if (typeof window !== "undefined") window.SessionProgress = api;
  if (typeof globalThis !== "undefined") globalThis.SessionProgress = api;
})();
