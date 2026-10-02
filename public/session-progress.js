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
      // Restored from a draft: an attempt that wrote but could not be
      // verified survives a refresh, so the retry still reconciles that record
      // instead of writing a second copy of the same outing.
      adoptPendingId(id) { if (id) pendingId = String(id); return this; },
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
  // --- Draft state (PR 6) ---------------------------------------------------
  //
  // "Kept" is a claim about a SPECIFIC revision. Every edit bumps editSeq; a
  // write that is read back and matched sets keptSeq. They are only equal when
  // what is on disk is what the rider last typed, so an earlier success can
  // never speak for later edits - which is the difference between a safety net
  // and the appearance of one.
  function createDraftState() {
    let editSeq = 0;
    let keptSeq = -1;
    let scheduled = false;     // a debounce timer is running
    let writing = false;
    let failed = false;
    let unreadable = false;
    let conflict = false;
    let restored = false;
    let suspended = false;     // never write while the stored draft is unreadable
    let disposalFailed = false;  // a draft we meant to discard is still there
    let identityUnrecorded = false;  // a save attempt the draft could not name
    return {
      get editSeq() { return editSeq; },
      get keptSeq() { return keptSeq; },
      get scheduled() { return scheduled; },
      get writing() { return writing; },
      get failed() { return failed; },
      get unreadable() { return unreadable; },
      get conflict() { return conflict; },
      get restored() { return restored; },
      get suspended() { return suspended; },
      get disposalFailed() { return disposalFailed; },
      get identityUnrecorded() { return identityUnrecorded; },
      markIdentityUnrecorded() { identityUnrecorded = true; return this; },
      markDisposalFailed() { disposalFailed = true; return this; },
      disposalOk() { disposalFailed = false; identityUnrecorded = false; return this; },
      // There are edits that are not on disk yet. This is the only question
      // the status asks, so it is the only one kept.
      get behind() { return editSeq > keptSeq; },
      edited() { editSeq += 1; restored = false; return this; },
      scheduleStarted() { scheduled = true; return this; },
      // Cancelling must leave editSeq alone: the edits still are not kept.
      cancelled() { scheduled = false; return this; },
      writeStarted() { scheduled = false; writing = true; return this; },
      writeSucceeded(seq) {
        writing = false; failed = false; conflict = false;
        keptSeq = seq === undefined ? editSeq : seq;
        return this;
      },
      writeFailed() { writing = false; failed = true; return this; },
      writeConflicted() { writing = false; conflict = true; return this; },
      markUnreadable() { unreadable = true; suspended = true; return this; },
      markRestored() { restored = true; return this; },
      // A new session, or a discarded draft: nothing is kept and nothing is
      // outstanding. Deliberately does NOT clear `unreadable`, because the
      // thing that could not be read is still sitting there.
      // Deliberately leaves `unreadable` and `disposalFailed` alone: both
      // describe something still sitting in storage, which resetting this
      // tab's bookkeeping does not change.
      reset() {
        editSeq = 0; keptSeq = -1; scheduled = false; writing = false;
        failed = false; conflict = false; restored = false;
        return this;
      },
      resume() { unreadable = false; suspended = false; return this; },
    };
  }

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
    // Draft trouble outranks a past success, because it is about the entries
    // in front of the rider right now.
    if (f.autosave && f.draftUnreadable && f.hasContent) {
      return { key: "draft-unreadable", tone: "warn",
        text: "Not saved yet \u00b7 a kept draft could not be read" };
    }
    if (f.autosave && f.draftConflict && f.hasContent) {
      return { key: "draft-conflict", tone: "warn",
        text: "Not saved yet \u00b7 another tab is keeping a draft" };
    }
    if (f.autosave && f.draftIdentityUnrecorded) {
      return { key: "draft-identity-unrecorded", tone: "warn",
        text: "Saving, but this device could not record the attempt" };
    }
    if (f.autosave && f.draftDisposalFailed) {
      return { key: "draft-not-discarded", tone: "warn",
        text: "A discarded draft is still on this device" };
    }
    if (f.autosave && f.draftFailed && f.hasContent) {
      return { key: "draft-failed", tone: "warn",
        text: "Not saved yet \u00b7 draft could not be kept" };
    }
    if (f.alreadySaved && f.savedAtLabel) {
      return { key: "saved", tone: "good",
        text: "Saved on this device \u00b7 " + f.savedAtLabel };
    }
    // "Draft restored" implies the draft is still there protecting the form, so
    // it must not outlive the draft: another tab replacing or deleting the key
    // withdraws this exactly as it withdraws "draft kept".
    if (f.autosave && f.draftRestored && f.hasContent && f.draftPresent) {
      return { key: "draft-restored", tone: "dim", text: "Draft restored \u00b7 not saved yet" };
    }
    if (f.autosave && f.hasContent) {
      // A write is scheduled or running: the LATEST edits are not on disk, and
      // saying "kept" here would be a claim about an older revision.
      if (f.draftBehind) {
        return { key: "draft-keeping", tone: "dim", text: "Keeping draft\u2026" };
      }
      // Gated on the same verified fact as the footer. Another tab can replace
      // or delete the key at any moment, and this tab would otherwise go on
      // claiming protection for entries that are no longer kept anywhere.
      if (!f.draftPresent) {
        return { key: "draft-not-kept", tone: "warn",
          text: "Not saved yet \u00b7 this draft is no longer kept on this device" };
      }
      return { key: "draft-kept", tone: "dim",
        text: "Not saved yet \u00b7 draft kept on this device" };
    }
    if (f.hasContent) {
      // Names the two controls that actually save, and where they are.
      return { key: "unsaved", tone: "dim",
        text: "Not saved yet \u00b7 on REVIEW, tap Save only or Save & next" };
    }
    return { key: "none", tone: "dim", text: "" };
  }

  // What the footer may truthfully promise about a refresh. "Your draft comes
  // back" is a claim about the entries on screen RIGHT NOW, so it cannot rest
  // on the switch alone: during the debounce, or after a failed write, the
  // latest changes are not on disk and a refresh would not bring them back.
  function footerDraftNote(f) {
    const facts = f || {};
    if (!facts.storageReady || !facts.autosave) return "Refresh wipes the current session.";
    if (facts.draftUnreadable || facts.draftConflict || facts.draftFailed
        || facts.draftIdentityUnrecorded) {
      return "Your latest changes are not being kept right now.";
    }
    // A finished session is not a draft. After a save there is nothing kept to
    // come back, and the honest thing to describe is what a refresh would
    // actually do with the form still on screen.
    if (facts.sessionSaved) {
      return "Session saved. Refresh clears the form; saved history remains.";
    }
    if (!facts.hasContent) return "Anything you enter is kept on this device.";
    if (facts.draftBehind) return "Your most recent changes have not been kept yet.";
    // The promise is only made about a draft that was VERIFIED to exist when
    // this was rendered. Inferring it from "auto-save is on and nothing has
    // failed" claimed a draft in every window where one had just been
    // discarded - after a save, after a reset, before the first write.
    if (!facts.draftExists) return "Your most recent changes have not been kept yet.";
    return "A refresh brings your draft back.";
  }

  // --- Steppers (C8) --------------------------------------------------------
  //
  // Decimal-safe, because the obvious version is wrong: 30.1 + 0.5 in binary
  // floating point is 30.599999999999998, and a rider watching a pressure
  // gain digits would be right not to trust it.
  //
  // Everything is done in integers scaled to the most decimal places either
  // side carries, so the rider's own precision survives: 30.25 + 0.5 is 30.75,
  // never 30.8. A fractional click is respected the same way - 8.5 + 1 is 9.5,
  // not 9 - because rounding someone's entry into a shape the app prefers is
  // not the app's decision to make.
  // ORDINARY DECIMAL NOTATION ONLY.
  //
  // Number() is far more generous than this stepper can be: it reads "1e-2",
  // "0x1A" and "0b101" happily, and the decimal count cannot describe any of
  // them. Stepping "1e-2" by 0.5 used to produce "0.5" - the rider's 0.01
  // silently discarded - and "0x1A" came back as "26.5", a hex entry rewritten
  // as decimal. So the parser is deliberately narrow, and ONE rule decides both
  // whether a button is available and what a step produces.
  const ORDINARY_DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

  // toFixed throws above 100 places, and scaled arithmetic stops being exact
  // long before that. Anything beyond this is refused rather than approximated.
  const MAX_STEP_DECIMALS = 12;

  function decimalsOf(text) {
    const m = String(text).match(/\.(\d+)\s*$/);
    return m ? m[1].length : 0;
  }

  // The shared eligibility rule. Returns the arithmetic plan, or null when this
  // text is not something the stepper may touch - in which case the caller
  // leaves it exactly as the rider typed it and offers no buttons.
  function stepPlan(currentText, step) {
    const raw = String(currentText == null ? "" : currentText).trim();
    if (raw === "") return null;                       // blank stays blank
    if (!ORDINARY_DECIMAL.test(raw)) return null;      // scientific, hex, words
    const value = Number(raw);
    if (!Number.isFinite(value)) return null;
    const stepNum = Number(step);
    if (!Number.isFinite(stepNum)) return null;

    const places = Math.max(decimalsOf(raw), decimalsOf(step));
    if (places > MAX_STEP_DECIMALS) return null;       // cannot be held exactly
    const scale = Math.pow(10, places);
    if (!Number.isFinite(scale)) return null;

    const scaledValue = Math.round(value * scale);
    const scaledStep = Math.round(stepNum * scale);
    // Beyond the safe-integer range the scaled arithmetic silently invents
    // digits, so a magnitude that cannot be represented is refused outright
    // rather than stepped approximately.
    if (!Number.isSafeInteger(scaledValue) || !Number.isSafeInteger(scaledStep)) return null;
    if (!Number.isSafeInteger(scaledValue + scaledStep)
        || !Number.isSafeInteger(scaledValue - scaledStep)) return null;
    return { places: places, scale: scale, scaledValue: scaledValue, scaledStep: scaledStep };
  }

  // Is this field steppable at all? The buttons and the handler both ask this,
  // so a button can never look available while the handler refuses - or worse,
  // look available and then mangle the value.
  function canStep(currentText, step) {
    return stepPlan(currentText, step) !== null;
  }

  // The rule, as a pure function. Returns the new text, or null when there is
  // no legitimate step to take - blank, not a number, or a decrement that
  // would cross below zero.
  function stepValue(currentText, step, direction) {
    const plan = stepPlan(currentText, step);
    if (plan === null) return null;              // same rule the buttons use
    const scaled = plan.scaledValue + (direction < 0 ? -1 : 1) * plan.scaledStep;
    // An ENTRY guard, not an opinion about tyre pressure: a decrement may not
    // take a field below zero. It does not clamp and it never rewrites what
    // the rider typed - a value already below zero simply refuses to go lower,
    // and increments are always allowed.
    if (direction < 0 && scaled < 0) return null;
    const next = scaled / plan.scale;
    if (!Number.isFinite(next)) return null;
    const text = next.toFixed(plan.places);
    // A last check that what we are about to write is something this same
    // parser would accept. toFixed can return exponential notation for very
    // large magnitudes, and writing a value the stepper then refuses to read
    // would be a trap of our own making.
    return ORDINARY_DECIMAL.test(text) ? text : null;
  }

  // --- Pressure ruler (C8 revised: centred value + tenths ruler) ------------
  //
  // 10-45 PSI is how far the ruler can be DRAGGED. It is not a recommendation
  // and not validation: a value typed outside it is kept exactly as typed, and
  // nothing in here ever labels a pressure high, low or unsafe.
  const PSI_MIN = 10;
  const PSI_MAX = 45;
  const PSI_STEP = 0.1;       // one tick is a tenth
  const TICK_PX = 24;         // ...and 24px of drag (v2)
  const DRAG_INTENT_PX = 10;  // before which the page keeps the gesture

  function tenths(value) { return Math.round(value * 10) / 10; }

  function psiInRulerRange(value) {
    return Number.isFinite(value) && value >= PSI_MIN && value <= PSI_MAX;
  }

  // Ordinary decimal text only. Scientific and hex notation are not numbers a
  // rider types into a pressure field, and treating them as numbers is how
  // digits get invented.
  const ORDINARY_PSI = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

  function readPsi(text) {
    const raw = String(text == null ? "" : text).trim();
    if (raw === "" || !ORDINARY_PSI.test(raw)) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  // A value the ruler can actually represent and step.
  function usablePsi(text) {
    const state = pressureState(text);
    if (state !== "in-range" && state !== "typed-outside") return null;
    return readPsi(text);
  }

  // What kind of thing is in the field right now. Every bit of copy and every
  // enabled/disabled decision is derived from this, so they cannot disagree.
  function pressureState(text) {
    const raw = String(text == null ? "" : text).trim();
    if (raw === "") return "blank";
    if (!ORDINARY_PSI.test(raw)) return "not-a-number";
    // The numeric contract from the stepper work still holds: text with more
    // decimals than can be stepped accurately, or a magnitude that is not safe
    // once scaled, is kept exactly as typed and cannot be stepped. Rounding it
    // to a tenth would invent digits the rider never entered.
    if (stepPlan(raw, String(PSI_STEP)) === null) return "unsupported";
    const n = Number(raw);
    if (!Number.isFinite(n)) return "unsupported";
    return psiInRulerRange(n) ? "in-range" : "typed-outside";
  }

  function snapPsi(value) {
    if (!Number.isFinite(value)) return null;
    const held = Math.min(PSI_MAX, Math.max(PSI_MIN, tenths(value)));
    return tenths(held);
  }

  // Dragging LEFT increases the value, as the design file does it.
  function psiFromDrag(startPsi, dx) {
    if (!Number.isFinite(startPsi)) return null;
    const notches = Math.round(-dx / TICK_PX);
    return snapPsi(startPsi + notches * PSI_STEP);
  }

  // Take the gesture over only once it is clearly horizontal, so an ordinary
  // vertical scroll that happens to start on the ruler still scrolls.
  function shouldCaptureDrag(dx, dy) {
    return Math.abs(dx) > DRAG_INTENT_PX && Math.abs(dx) > Math.abs(dy);
  }

  // -/+ are a tenth. Outside the ruler's range they still step from the typed
  // value - they are the way back - but they never go below zero and they
  // never rewrite text that is not a number. From blank they start at the
  // reference; with no reference there is nothing to start from, so they stay
  // inactive rather than invent one.
  function rulerStep(currentText, direction, referenceValue) {
    const dir = direction < 0 ? -1 : 1;
    const state = pressureState(currentText);
    if (state === "not-a-number" || state === "unsupported") return null;
    if (state === "blank") {
      const ref = padStart(referenceValue);
      const next = tenths(ref + dir * PSI_STEP);
      if (dir < 0 && next < 0) return null;
      return next.toFixed(1);
    }
    // Stepping goes through the same decimal-safe arithmetic the click
    // steppers use, so a typed 30.25 becomes 30.35 rather than being rounded
    // to a tenth the rider never asked for.
    const next = stepValue(String(currentText).trim(), String(PSI_STEP), dir);
    if (next === null) return null;
    const n = Number(next);
    if (dir < 0 && n < 0) return null;
    // Inside the range the ruler holds its ends.
    if (state === "in-range" && !psiInRulerRange(n)) return null;
    return next;
  }

  // The ruler may be dragged only when there is a position to drag from: a
  // value inside the range, or a reference to start from while blank.
  // v2: the pad is usable whenever the value is blank or inside the range.
  // From blank it starts at the reference, or at PAD_DEFAULT when no reference
  // matched - a starting POSITION for a deliberate drag, never a value: the
  // field stays empty until the rider actually moves it.
  const PAD_DEFAULT = 30;

  function padStart(referenceValue) {
    const ref = usablePsi(referenceValue);
    return ref === null ? PAD_DEFAULT : ref;
  }

  function rulerDraggable(currentText, referenceValue) {
    const state = pressureState(currentText);
    return state === "in-range" || state === "blank";
  }

  // --- References ------------------------------------------------------------
  //
  // A reference is history, never a measurement. It is only shown when it is
  // genuinely the same thing: the same bike on the same tire brand and model.
  // Anything less exact is omitted, because a pressure from a different bike
  // sitting next to today's is worse than no pressure at all.
  const PRESSURE_KEYS = {
    "front-pre": "frontPre", "rear-pre": "rearPre",
    "front-post": "frontPost", "rear-post": "rearPost",
  };

  function lastMatchingSession(sessions, context) {
    if (!Array.isArray(sessions) || !context) return null;
    const bike = String(context.bike || "").trim().toLowerCase();
    const brand = String(context.brand || "").trim().toLowerCase();
    const model = String(context.model || "").trim().toLowerCase();
    if (!bike || !brand || !model) return null;
    let best = null;
    for (const s of sessions) {
      if (!s || !s.setup || !s.tires) continue;
      if (String(s.setup.bike || "").trim().toLowerCase() !== bike) continue;
      if (String(s.tires.brand || "").trim().toLowerCase() !== brand) continue;
      if (String(s.tires.model || "").trim().toLowerCase() !== model) continue;
      if (best === null || String(s.savedAt || "") > String(best.savedAt || "")) best = s;
    }
    return best;
  }

  // A session number is used only when the saved session actually carries a
  // label. It is never derived, guessed at or counted up to.
  function sessionTag(session) {
    const label = String(session && session.sessionLabel || "").trim();
    const m = label.match(/(\d+)\s*$/);
    return m ? "S" + m[1] : null;
  }

  function pressureReferences(sessions, context, field, thisSessionPre) {
    const key = PRESSURE_KEYS[field];
    const out = { primary: null, sources: [] };
    if (!key) return out;
    const last = lastMatchingSession(sessions, context);
    const tag = last ? sessionTag(last) : null;
    const historic = last ? readPsi(last.tires[key]) : null;
    const isPost = field.indexOf("-post") !== -1;
    if (historic !== null) {
      const value = historic.toFixed(1);
      const source = isPost
        ? { tag: tag, text: (tag ? tag + " hot" : "Last session hot"), value: value }
        : { tag: tag, text: (tag ? "Last session (" + tag + ")" : "Last session"), value: value };
      out.sources.push(source);
      out.primary = { value: value, tag: tag, text: source.text,
                      button: tag ? "Same as " + tag : "Same as last session" };
    }
    if (isPost) {
      const pre = readPsi(thisSessionPre);
      if (pre !== null) {
        out.sources.push({ tag: "PRE", text: "PRE", value: pre.toFixed(1) });
        if (out.primary === null) {
          out.primary = { value: pre.toFixed(1), tag: "PRE", text: "PRE",
                          button: "Same as PRE" };
        }
      }
    }
    return out;
  }

  // --- Tires summary and header copy ----------------------------------------
  //
  // The summary must never imply a setup that was not entered. With nothing
  // set it says so plainly; with a partial setup it names only what is there.
  function tiresSummary(brand, model, warmersOn, warmerTime) {
    const parts = [];
    const b = String(brand == null ? "" : brand).trim();
    const m = String(model == null ? "" : model).trim();
    const t = String(warmerTime == null ? "" : warmerTime).trim();
    if (b) parts.push(b);
    if (m) parts.push(m);
    if (warmersOn) parts.push(t ? "warmers " + t + " min" : "warmers");
    if (parts.length === 0) return "No tires set";
    return parts.join(" \u00b7 ");
  }

  // An unset field says it is unset rather than leaving the line blank, so the
  // header never reads as though a bike or track were already chosen.
  function headerBikeLine(bike, stageLabel) {
    const b = String(bike == null ? "" : bike).trim();
    if (b) return b;
    const stage = String(stageLabel == null ? "" : stageLabel).trim();
    return stage ? "No bike set \u00b7 " + stage : "No bike set";
  }

  function headerTrackLine(track, sessionLabel) {
    const t = String(track == null ? "" : track).trim();
    const sLabel = String(sessionLabel == null ? "" : sessionLabel).trim();
    const left = t || "No track set";
    return sLabel ? left + " \u00b7 " + sLabel : left;
  }

  // --- Copy -----------------------------------------------------------------

  function todayLabel(text) {
    const state = pressureState(text);
    if (state === "blank") return "Today \u00b7 not measured";
    if (state === "in-range") return "Today";
    return "Today \u00b7 typed";
  }

  function pressureNote(text, hasReference) {
    const state = pressureState(text);
    if (state === "not-a-number") return "Type a number, for example 30.5.";
    if (state === "unsupported") {
      return String(text).trim()
        + " is kept as typed. \u2212 / + and the ruler work to one decimal place.";
    }
    if (state === "typed-outside") {
      const shown = String(text).trim();
      return shown + " is outside the drag range (" + PSI_MIN + "\u2013" + PSI_MAX
        + "). Kept as typed. Use \u2212 / + or type to change it.";
    }
    // The blank state needs no sentence: the placeholder says what to type and
    // the pad says what a notch is worth. Notes are for things that only apply
    // sometimes.
    if (state === "blank") return "";
    return "";
  }

  // The delta chip: neutral, factual, and only once there is a value. It never
  // colours a reading or calls it good or bad.
  function deltaChip(text, refs) {
    const value = usablePsi(text);
    if (value === null || !refs) return "";
    const parts = [];
    for (const srcItem of (refs.sources || [])) {
      const ref = usablePsi(srcItem.value);
      if (ref === null) continue;
      const d = tenths(value - ref);
      const label = srcItem.tag || "last";
      parts.push((d >= 0 ? "+" : "\u2212") + Math.abs(d).toFixed(1) + " vs " + label);
    }
    return parts.join(" \u00b7 ");
  }

  // POST only, and only once there is a value to compare.
  function postDelta(postText, preText) {
    const post = readPsi(postText);
    const pre = readPsi(preText);
    if (post === null || pre === null) return "";
    const d = tenths(post - pre);
    return (d >= 0 ? "+" : "\u2212") + Math.abs(d).toFixed(1) + " vs PRE";
  }

  const api = {
    nextLabelFrom, createStageState, createSaveState, createDraftState, saveStatusFor,
    footerDraftNote, stepValue, decimalsOf, canStep, stepPlan,
    PSI_MIN, PSI_MAX, PSI_STEP, TICK_PX, DRAG_INTENT_PX, PAD_DEFAULT, padStart, deltaChip,
    psiInRulerRange, snapPsi, psiFromDrag, shouldCaptureDrag, rulerStep, rulerDraggable,
    readPsi, usablePsi, pressureState, pressureReferences, lastMatchingSession, sessionTag,
    todayLabel, pressureNote, postDelta, tiresSummary, headerBikeLine, headerTrackLine,
    isSessionField, SESSION_FIELD_IDS, SESSION_FIELD_CONTAINERS,
  };
  if (typeof window !== "undefined") window.SessionProgress = api;
  if (typeof globalThis !== "undefined") globalThis.SessionProgress = api;
})();
