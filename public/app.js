(function () {
  "use strict";

  // --- Tabs -----------------------------------------------------------------
  const tabs = document.querySelectorAll(".stage");
  // --- Stages (C1, C2) ---
  //
  // Six stages over the panels that already existed. Every field keeps its id
  // and its place in the saved session; only where a control APPEARS changes.
  //
  // A stage owns whole panels, plus any [data-stage] block inside a panel it
  // shares - the tire pressures split pre/post, and the symptom chips belong
  // to POST while the clicks stay in PRE. Splitting by marker rather than by
  // cutting the markup apart is what keeps every handler and id intact.
  //
  // Selecting a stage is NAVIGATION ONLY, in PR 4 exactly as in PR 3. The one
  // stage that can refuse is POST before the rider has come back in, and it
  // refuses by declining to navigate - it never performs the transition. All
  // session progression goes through the docked action instead.
  const STAGE_PANELS = {
    day: ["panel-setup"],
    pre: ["panel-tires", "panel-suspension", "panel-calculators"],
    post: ["panel-tires", "panel-suspension"],
    laps: ["panel-laps"],
    notes: ["panel-notes"],
    review: ["panel-review", "panel-history"],
    about: ["panel-about"],
  };
  const ALL_PANEL_IDS = Array.from(new Set(Object.values(STAGE_PANELS).flat()));
  const panels = {};
  ALL_PANEL_IDS.forEach((id) => { panels[id] = document.getElementById(id); });

  // --- Session progress (C5, C13) ------------------------------------------
  //
  // MEMORY ONLY, DELIBERATELY. None of this is written to storage and neither
  // is anything the rider has typed: mototrack.sessions.v1 still holds only
  // FINISHED sessions, and the live form is still the draft. A refresh, a
  // crash, or the browser evicting the tab loses unfinished entries. That is
  // today's behaviour and it is kept unchanged here so that draft persistence
  // arrives once, behind the rider's own auto-save switch, instead of half of
  // it landing by accident. Draft recovery is real follow-on work: a phone in
  // a hot pit lane is exactly where a tab gets reclaimed.
  //
  // POST AVAILABILITY AND PRE EDITABILITY ARE TWO SEPARATE QUESTIONS and are
  // two separate variables on purpose. Coming back in unlocks POST for good.
  // Correcting PRE afterwards reopens the PRE fields and must NEVER re-lock
  // POST, because the rider fixing a typo has already been back in - the fact
  // does not become untrue.
  // The rules themselves live in session-progress.js so they can be exercised
  // directly; this file holds only the DOM that renders them.
  const SP = window.SessionProgress;
  const stageState = SP.createStageState();
  const saveState = SP.createSaveState();
  const nextLabelFrom = SP.nextLabelFrom;
  let _copiedFrom = null;      // { id, summary } - set only by Copy to form
  // Assigned once the listeners are wired; calculators that write into the
  // saved session call it, because their own inputs are not session fields.
  let markSessionDirty = function () {};

  // The PRE values a rider commits when they go out. Tire brand and model are
  // NOT here: they describe the fitment, not the state the session ran at, and
  // they stay editable on every stage as they always have been.
  const PRE_LOCKABLE_IDS = [
    "front-pre", "rear-pre",
    "fork-preload", "fork-comp", "fork-reb",
    "shock-preload", "shock-comp", "shock-reb",
  ];

  function renderPreEditable() {
    const editable = stageState.preEditable;
    PRE_LOCKABLE_IDS.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      // readOnly, never disabled: a locked value must stay focusable,
      // selectable and readable by a screen reader. Disabling it would take it
      // out of the tab order and make the reference unreadable.
      el.readOnly = !editable;
      el.classList.toggle("is-locked", !editable);
    });
  }


  function showTab(name) {
    const stage = STAGE_PANELS[name] ? name : "day";
    tabs.forEach((t) => {
      const active = t.dataset.tab === stage;
      t.setAttribute("aria-selected", active ? "true" : "false");
    });
    const wanted = STAGE_PANELS[stage];
    ALL_PANEL_IDS.forEach((id) => {
      if (panels[id]) panels[id].hidden = wanted.indexOf(id) === -1;
    });
    // Blocks a panel shares between two stages. Unmarked content belongs to
    // every stage that shows the panel, so nothing has to be marked twice.
    document.querySelectorAll("[data-stage]").forEach((block) => {
      block.hidden = block.dataset.stage !== stage;
    });
    // Keep the selected stage in view when the bar has to scroll sideways.
    const activeCell = document.querySelector('.stage[data-tab="' + stage + '"]');
    if (activeCell && activeCell.scrollIntoView) {
      activeCell.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    _stage = stage;
    renderDock();
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  }

  // --- The docked action (C4, C5, C13) -------------------------------------
  //
  // One forward action per stage, always within thumb reach. It is the ONLY
  // thing that advances a session; the stage bar beside it only ever moves the
  // view. LAPS and NOTES are on the route but not mandatory - the rail reaches
  // REVIEW from POST in one tap for a rider with no laps to enter.
  let _stage = "day";
  const ADVANCE = { day: "pre", pre: "post", post: "laps", laps: "notes", notes: "review" };

  function dockCopy(stage) {
    if (stage === "day") {
      const label = str("session-label");
      return {
        verb: label ? "Start " + label : "Start session",
        // DAY -> PRE copies nothing and clears nothing. Carry-over between
        // sessions is what Save & next does; copying a historical session is
        // the explicit Copy to form action in History. Neither belongs on a
        // button whose job is to open the next screen.
        effect: "Opens PRE \u00b7 nothing is copied or cleared",
      };
    }
    if (stage === "pre") {
      return { verb: "Back in \u2192 POST", effect: "Unlocks POST \u00b7 PRE becomes read-only" };
    }
    if (stage === "post") {
      return { verb: "Go to LAPS", effect: "Laps and notes are optional \u00b7 REVIEW saves" };
    }
    if (stage === "laps") return { verb: "Go to NOTES", effect: "Nothing is saved yet" };
    if (stage === "notes") return { verb: "Go to REVIEW", effect: "Nothing is saved yet" };
    return null;
  }

  function renderDock() {
    const dock = document.getElementById("dock");
    if (!dock) return;
    const advance = document.getElementById("dock-advance");
    const saves = document.getElementById("dock-saves");
    const note = document.getElementById("stage-note");
    if (note) note.hidden = true;

    const copy = dockCopy(_stage);
    const onReview = _stage === "review";
    if (advance) advance.hidden = !copy;
    if (saves) saves.hidden = !onReview;
    if (copy && advance) {
      document.getElementById("dock-verb").textContent = copy.verb;
      document.getElementById("dock-effect").textContent = copy.effect;
    }
    if (onReview) renderSaveDock();
    if (_stage === "post") renderPreReference();
    renderSaveStatus();
    dock.hidden = !copy && !onReview;

    // The POST cell reads as locked only while it actually refuses.
    const postCell = document.querySelector('.stage[data-tab="post"]');
    if (postCell) {
      postCell.classList.toggle("is-locked", !stageState.postUnlocked);
      if (stageState.postUnlocked) postCell.removeAttribute("aria-disabled");
      else postCell.setAttribute("aria-disabled", "true");
    }
    applyDockLayout();
  }

  // What the rider went out on, shown on POST beside the readings they are
  // taking now. Read from the same fields PRE writes, so it cannot drift.
  function renderPreReference() {
    const f = document.getElementById("pre-ref-front");
    const r = document.getElementById("pre-ref-rear");
    const dash = "\u2014";
    if (f) f.textContent = str("front-pre") || dash;
    if (r) r.textContent = str("rear-pre") || dash;
  }

  function renderSaveDock() {
    const nextBtn = document.getElementById("save-and-next");
    const verb = document.getElementById("save-next-verb");
    const onlyBtn = document.getElementById("save-session");
    if (verb) {
      const next = nextLabelFrom(str("session-label"));
      verb.textContent = next.clean ? "Save & start " + next.label : "Save & start next session";
    }
    // A form with nothing new in it cannot be saved again. Save & next stays
    // available because advancing is still a real thing to want after a plain
    // Save - it just advances without writing a second copy.
    const nothingNew = saveState.alreadySaved;
    if (onlyBtn) {
      onlyBtn.disabled = nothingNew || saveState.inFlight;
      onlyBtn.textContent = nothingNew ? "Saved" : "Save only";
    }
    if (nextBtn) nextBtn.disabled = saveState.inFlight;
    if (verb && nothingNew) {
      const next = nextLabelFrom(str("session-label"));
      verb.textContent = next.clean ? "Start " + next.label : "Start next session";
    }
    const effect = document.getElementById("save-next-effect");
    if (effect) {
      effect.textContent = nothingNew
        ? "Already saved \u00b7 moves on without saving again"
        : "Keeps bike, track, tires and clicks";
    }
    renderCopyOrigin(nothingNew);
  }

  // --- Save status (C7) -----------------------------------------------------
  //
  // One line under the context header. It holds no state: every word comes
  // from saveState, storage availability and whether the session has content,
  // so it cannot claim something that did not happen.
  function savedAtLabel(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    try {
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch (e) {
      return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    }
  }

  let _statusKey = null;
  let _statusText = null;
  function renderSaveStatus() {
    const el = document.getElementById("save-status");
    if (!el) return;
    const status = SP.saveStatusFor({
      storageReady: storageReady(),
      failed: saveState.failed,
      alreadySaved: saveState.alreadySaved,
      savedAtLabel: savedAtLabel(saveState.lastSavedAt),
      hasContent: hasSessionContent(),
    });
    // Written only when it actually changes. This is a polite live region:
    // re-assigning it on every keystroke would make a screen reader announce
    // the save status on every keystroke.
    if (status.key === _statusKey && status.text === _statusText) return;
    _statusKey = status.key;
    _statusText = status.text;
    el.hidden = status.key === "none";
    el.textContent = status.text;
    el.className = "save-status save-status--" + status.tone;
  }

  // Says, in the place the rider is about to tap, that this will become its
  // own record and leave the session it came from alone. Stays visible until
  // the first SUCCESSFUL save - a failed one leaves the warning up, because
  // the duplicate it warns about has still not been written.
  function renderCopyOrigin(nothingNew) {
    const box = document.getElementById("copy-origin");
    if (!box) return;
    if (!_copiedFrom) { box.hidden = true; box.textContent = ""; return; }
    box.hidden = false;
    box.textContent = "Copied from " + _copiedFrom.summary
      + ". Saving creates a separate session and leaves that one unchanged.";
    const onlyBtn = document.getElementById("save-session");
    if (onlyBtn && !nothingNew) onlyBtn.textContent = "Save as a new session";
  }

  // --- Dock layout ----------------------------------------------------------
  //
  // The dock never hides or truncates its own text: the sub-line says what the
  // action changes, and guessing a "150% text" threshold to hide it would drop
  // meaning exactly when the rider most needs it. Instead the dock wraps and
  // grows, and when the growth would cost too much of the screen it stops
  // being sticky and takes its place in the document instead.
  //
  // What counts as "too much" is MEASURED, not assumed: dock plus navigation
  // against the viewport actually available. visualViewport is what shrinks
  // when the soft keyboard opens, so a tall dock yields with the keyboard up
  // as well - which is the case that matters, because that is when the rider
  // is typing a pressure into a field the dock would otherwise cover.
  const DOCK_YIELD_RATIO = 0.45;
  const DOCK_RELEASE_RATIO = 0.40;
  let _dockLayoutBusy = false;

  // A custom property write is cheap but never free: it invalidates style and
  // can cascade into a layout that fires the listener that called this.
  function setVar(root, name, value) {
    if (root.style.getPropertyValue(name) === value) return;
    root.style.setProperty(name, value);
  }

  function availableViewportHeight() {
    if (window.visualViewport && window.visualViewport.height) return window.visualViewport.height;
    return window.innerHeight || document.documentElement.clientHeight || 0;
  }

  function applyDockLayout() {
    const dock = document.getElementById("dock");
    const bar = document.querySelector(".stage-bar");
    const root = document.documentElement;
    if (!dock || !root || !root.style || _dockLayoutBusy) return;
    _dockLayoutBusy = true;
    try {
      if (isRail()) {
        if (dock.classList.contains("dock--flow")) dock.classList.remove("dock--flow");
        if (root.style.getPropertyValue("--dock-h") && root.style.removeProperty) {
          root.style.removeProperty("--dock-h");
        }
        return;
      }
      if (dock.hidden) {
        if (dock.classList.contains("dock--flow")) dock.classList.remove("dock--flow");
        setVar(root, "--dock-h", "0px");
        return;
      }
      // Measure WITHOUT touching the class. Sticky and in-flow are the same
      // height by construction (the flow rule swaps the top border for an
      // identical bottom one), so the measurement does not depend on the
      // decision. Clearing the class to "measure from a known state" instead
      // made the height change, which re-fired the ResizeObserver, which
      // toggled it back: an oscillation that froze the renderer.
      const dockH = Math.ceil(dock.getBoundingClientRect().height);
      const barH = bar ? Math.ceil(bar.getBoundingClientRect().height) : 0;
      const avail = availableViewportHeight();
      // Hysteresis: it takes more to start yielding than to stop, so a height
      // sitting exactly on the threshold cannot flip back and forth.
      const wasFlow = dock.classList.contains("dock--flow");
      const ratio = wasFlow ? DOCK_RELEASE_RATIO : DOCK_YIELD_RATIO;
      const yields = avail > 0 && (dockH + barH) > avail * ratio;
      if (yields !== wasFlow) dock.classList.toggle("dock--flow", yields);
      // In flow the dock is part of the content, so it needs no clearance.
      // Written ONLY when it actually changes: an unconditional write moves
      // the body's padding, which can fire the very events that call this
      // back, and the second freeze in this lane came from exactly that.
      setVar(root, "--dock-h", yields ? "0px" : dockH + "px");
    } finally {
      _dockLayoutBusy = false;
    }
  }

  function watchDockLayout() {
    const dock = document.getElementById("dock");
    if (!dock) return;
    applyDockLayout();
    if (typeof ResizeObserver === "function") new ResizeObserver(applyDockLayout).observe(dock);
    window.addEventListener("resize", applyDockLayout);
    if (window.visualViewport && window.visualViewport.addEventListener) {
      // resize only. A scroll listener here re-enters on the layout this very
      // function causes, and the soft keyboard is a RESIZE of the visual
      // viewport, which is the case this is here for.
      window.visualViewport.addEventListener("resize", applyDockLayout);
    }
    if (typeof window.matchMedia === "function") {
      const mq = window.matchMedia(DESKTOP_RAIL);
      if (mq.addEventListener) mq.addEventListener("change", applyDockLayout);
      else if (mq.addListener) mq.addListener(applyDockLayout);
    }
  }

  // --- Context header (C3) ---
  //
  // Says which bike and session the rider is on, from the fields they typed.
  // Nothing here derives, guesses or bumps a value: an invented "Session 2"
  // is worse than no context at all, so an empty Setup leaves the line hidden.
  // The rider's session label is shown exactly as entered - it is free text
  // they own, not a number for us to parse.
  function renderContext() {
    const line = document.getElementById("context-line");
    if (!line) return;
    const bike = str("bike");
    const track = str("track");
    const label = str("session-label");
    const where = [track, label].filter(Boolean).join(" · ");
    document.getElementById("context-bike").textContent = bike;
    document.getElementById("context-where").textContent = where;
    line.hidden = !(bike || where);
  }
  ["bike", "track", "session-label"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", renderContext);
  });
  renderContext();

  // The header's About entry. It selects the existing About panel rather than
  // opening anything new, so there is one About and the tab strip still shows
  // where you are. Focus moves to the panel heading, so a keyboard or screen
  // reader user lands in the content instead of back at the top of the page.
  // The stage bar grows with text size, so the content padding follows its
  // measured height. Only on phone: at 900px and up the same element is a
  // full-height left rail, and measuring it there would write a viewport-sized
  // value into --stage-bar-h, giving every focused control a scroll margin
  // taller than the screen. Above the breakpoint the inline value is removed
  // so the stylesheet's own 0px applies and nothing reserves bottom clearance.
  const DESKTOP_RAIL = "(min-width: 900px)";
  // Shared by the bar and the dock: above the breakpoint the bar is a rail and
  // the dock sits in the content column, so neither reserves bottom clearance.
  function isRail() {
    return typeof window.matchMedia === "function" && !!window.matchMedia(DESKTOP_RAIL).matches;
  }
  function watchStageBarHeight() {
    const bar = document.querySelector(".stage-bar");
    const root = document.documentElement;
    if (!bar || !root || !root.style || typeof root.style.setProperty !== "function") return;
    const apply = () => {
      if (isRail()) {
        if (typeof root.style.removeProperty === "function") root.style.removeProperty("--stage-bar-h");
        return;
      }
      if (typeof bar.getBoundingClientRect !== "function") return;
      const rect = bar.getBoundingClientRect();
      const h = rect ? Math.ceil(rect.height) : 0;
      if (h > 0) root.style.setProperty("--stage-bar-h", Math.max(h, 64) + "px");
    };
    apply();
    // Crossing the breakpoint swaps bar for rail, so re-apply on the query as
    // well as on the element: a resize that only changes orientation still
    // needs the measurement, and one that crosses 900px needs it dropped.
    if (typeof window.matchMedia === "function") {
      const mq = window.matchMedia(DESKTOP_RAIL);
      if (typeof mq.addEventListener === "function") mq.addEventListener("change", apply);
      else if (typeof mq.addListener === "function") mq.addListener(apply);
    }
    if (typeof ResizeObserver === "function") { new ResizeObserver(apply).observe(bar); return; }
    window.addEventListener("resize", apply);
  }
  watchStageBarHeight();
  // Start in a known state: PRE editable, POST locked, dock rendered for DAY.
  renderPreEditable();
  renderDock();
  renderSaveStatus();
  watchDockLayout();

  const aboutOpen = document.getElementById("about-open");
  if (aboutOpen) {
    aboutOpen.addEventListener("click", () => {
      showTab("about");
      const heading = document.querySelector("#panel-about h2");
      if (heading) {
        heading.setAttribute("tabindex", "-1");
        heading.focus();
      }
    });
  }

  tabs.forEach((t) => {
    t.addEventListener("click", () => {
      // The one stage that can refuse. It refuses by NOT NAVIGATING - it never
      // performs the transition, because a tap on a navigation control must
      // never progress the session. Enforced here rather than in CSS so that
      // a stylesheet that fails to load cannot open POST early.
      if (!stageState.mayOpen(t.dataset.tab)) {
        const note = document.getElementById("stage-note");
        if (note) {
          note.textContent = "POST opens when you're back in.";
          note.hidden = false;
          applyDockLayout();
        }
        return;
      }
      showTab(t.dataset.tab);
      // REVIEW now shows the saved-session list, so it is what refreshes it.
      if (t.dataset.tab === "review") renderHistory();
    });
  });

  // The docked action, and the only thing that advances a session.
  const dockAdvance = document.getElementById("dock-advance");
  if (dockAdvance) {
    dockAdvance.addEventListener("click", () => {
      const next = ADVANCE[_stage];
      if (!next) return;
      if (_stage === "pre") {
        // Coming back in is permanent. Correcting PRE afterwards reopens the
        // fields but never takes this back.
        stageState.backIn();
        renderPreEditable();
      }
      showTab(next);
      if (next === "review") renderHistory();
    });
  }

  // Correct PRE: reopens the PRE fields and takes the rider straight to them.
  // It does NOT re-lock POST and it clears nothing, so an accidental Back in
  // costs one tap to undo with no data lost. Returning to POST is the rail.
  const correctPre = document.getElementById("correct-pre");
  if (correctPre) {
    correctPre.addEventListener("click", () => {
      stageState.correctPre();
      renderPreEditable();
      showTab("pre");
      const first = PRE_LOCKABLE_IDS.map((id) => document.getElementById(id)).find(Boolean);
      if (first && first.focus) {
        first.focus();
        if (first.scrollIntoView) first.scrollIntoView({ block: "center" });
      }
    });
  }

  // Only a change to a field that actually reaches the saved session makes it
  // saveable again. Listening to all of <main> meant the comparison selectors
  // and the calculators' own working-out re-armed the save, so Save & next
  // after a plain Save wrote a duplicate of an unchanged outing.
  const mainEl = document.querySelector("main");
  if (mainEl) {
    const markDirty = () => {
      const wasDirty = saveState.dirty;
      saveState.markDirty();
      // Both docked labels are built from the rider's own session label, so
      // they have to follow it as it is typed rather than only at stage
      // changes - otherwise DAY offers "Start session" for a rider who has
      // just named the outing.
      if (_stage === "day") renderDock();
      else if (_stage === "review" || !wasDirty) renderSaveDock();
      // Only the first edit after a save can change the status; later
      // keystrokes cannot, and collectSession() on each one would be waste.
      if (!wasDirty) renderSaveStatus();
    };
    const fromSessionField = (event) => {
      const el = event && event.target;
      if (!el) return false;
      const containers = SP.SESSION_FIELD_CONTAINERS
        .filter((c) => el.closest && el.closest("#" + c));
      return SP.isSessionField(el.id, containers);
    };
    const onEdit = (event) => { if (fromSessionField(event)) markDirty(); };
    mainEl.addEventListener("input", onEdit);
    mainEl.addEventListener("change", onEdit);
    // A calculator that writes into the saved session counts as an edit even
    // though its own inputs do not: running the sag calculation is what puts
    // a sag figure into setup.geometryConstants.
    markSessionDirty = markDirty;
  }

  // --- Helpers --------------------------------------------------------------
  function num(id) {
    const raw = (document.getElementById(id).value || "").trim();
    if (raw === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  function str(id) {
    return (document.getElementById(id).value || "").trim();
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function row(label, value) {
    return `<div class="row"><span>${escapeHtml(label)}</span><span>${escapeHtml(value)}</span></div>`;
  }

  function numericRow(label, value) {
    return `<div class="row"><span>${escapeHtml(label)}</span><span class="numeric">${escapeHtml(value)}</span></div>`;
  }

  function signedMm(value, digits) {
    if (!Number.isFinite(value)) return "";
    const precision = digits == null ? 1 : digits;
    const sign = value > 0 ? "+" : value < 0 ? "-" : "";
    return `${sign}${Math.abs(value).toFixed(precision)} mm`;
  }

  function signedDeg(value) {
    if (!Number.isFinite(value)) return "";
    const sign = value > 0 ? "+" : value < 0 ? "-" : "";
    return `${sign}${Math.abs(value).toFixed(2)} deg`;
  }

  // --- Tires ----------------------------------------------------------------
  function tireSuggestions(label, pre, post, warmerOn) {
    if (pre == null || post == null) return [];
    const delta = post - pre;
    const sign = delta >= 0 ? "+" : "−";
    const tips = [`${label}: ${sign}${Math.abs(delta).toFixed(1)} PSI delta (pre ${pre} → post ${post}).`];

    if (warmerOn) {
      if (delta < -1) {
        tips.push(`${label}: pressure dropped during the session. Check for a slow leak, or take the post reading sooner next time.`);
      } else if (delta > 3) {
        tips.push(`${label}: large rise despite warmers. Warmer may have been under-temp or the tire was overworked — consider raising pre-session PSI.`);
      }
    } else {
      if (delta < 2) {
        tips.push(`${label}: small rise without warmers. Tire may not be reaching working temp — consider lowering pre-session PSI slightly or adding warm-up laps.`);
      } else if (delta > 6) {
        tips.push(`${label}: large rise. Pre-session may be too low — consider raising it.`);
      }
    }
    return tips;
  }

  document.getElementById("calc-tires").addEventListener("click", () => {
    const fpre = num("front-pre"), rpre = num("rear-pre");
    const fpost = num("front-post"), rpost = num("rear-post");
    const warmerOn = document.getElementById("warmer-on").checked;

    const out = [];
    out.push(...tireSuggestions("Front", fpre, fpost, warmerOn));
    out.push(...tireSuggestions("Rear", rpre, rpost, warmerOn));

    const el = document.getElementById("tire-result");
    if (out.length === 0) {
      el.innerHTML = `<p>Enter pre-session and post-session PSI to see deltas and suggestions.</p>`;
      return;
    }
    el.innerHTML = `<h3>Tire feedback</h3><ul>${out.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>
      <p class="hint">Guidance is conservative and educational only. Always defer to your tire manufacturer and track conditions.</p>`;
  });

  // --- Calculator foundation: tire + units core ----------------------------
  const tireCore = window.MotoTrackTireCore;
  const tireMethodEl = document.getElementById("tire-core-method");
  const tireMeasuredFields = document.getElementById("tire-core-measured-fields");
  const tireLookupFields = document.getElementById("tire-core-lookup-fields");
  const tireLookupEl = document.getElementById("tire-core-lookup");

  function formatMm(value, digits) {
    if (!Number.isFinite(value)) return "";
    return `${tireCore.round(value, digits == null ? 1 : digits).toFixed(digits == null ? 1 : digits)} mm`;
  }

  function formatPct(value) {
    if (!Number.isFinite(value)) return "";
    const sign = value > 0 ? "+" : "";
    return `${sign}${value.toFixed(1)}%`;
  }

  function syncTireCoreFields() {
    const method = tireMethodEl.value;
    tireMeasuredFields.hidden = method !== "measured";
    tireLookupFields.hidden = method !== "lookup";
  }

  function renderLookupOptions() {
    tireLookupEl.innerHTML = tireCore.LOOKUP_TIRES.map((tire) => {
      const label = `${tire.manufacturer} ${tire.model} - ${tire.size}`;
      return `<option value="${escapeHtml(tire.id)}">${escapeHtml(label)}</option>`;
    }).join("");
  }

  if (tireCore && tireMethodEl && tireLookupEl) {
    renderLookupOptions();
    syncTireCoreFields();
    tireMethodEl.addEventListener("change", syncTireCoreFields);

    document.getElementById("calc-tire-core").addEventListener("click", () => {
      const method = tireMethodEl.value;
      const resultEl = document.getElementById("tire-core-result");
      const tire = tireCore.resolveTire({
        measuredValue: method === "measured" ? str("tire-core-measured") : "",
        measuredUnit: document.getElementById("tire-core-measured-unit").value,
        lookupId: method === "lookup" ? tireLookupEl.value : "",
        size: str("tire-core-size"),
      });

      if (!tire) {
        resultEl.innerHTML = `<p>Enter a measured rollout, choose a lookup tire, or use a size like <code>180/55-17</code>.</p>`;
        return;
      }

      const sourceLabel = {
        measured: "measured",
        lookup: "lookup",
        estimated: "estimated from size",
      }[tire.source] || tire.source;

      const rows = [
        numericRow("Rolling circumference", formatMm(tire.rollingCircMm, 1)),
        numericRow("Derived rolling diameter", formatMm(tire.diameterMm, 1)),
        row("Source", sourceLabel),
      ];

      if (tire.source === "estimated") {
        rows.push(numericRow("Sidewall", formatMm(tire.sidewallMm, 1)));
        rows.push(numericRow("Geometric diameter", formatMm(tire.geometricDiameterMm, 1)));
        rows.push(numericRow("Geometric circumference", formatMm(tire.geomCircMm, 1)));
        rows.push(row("Rolling factor", String(tire.rollingFactor)));
      }

      if (tire.source === "lookup") {
        rows.push(row("Tire", `${tire.manufacturer} ${tire.model} ${tire.size}`));
      }

      if (tire.deltaFromTheoreticalPct != null) {
        const smaller = tire.deltaFromTheoreticalPct < 0 ? "smaller" : "larger";
        rows.push(numericRow("Delta from nominal", `${formatMm(tire.deltaFromTheoreticalMm, 1)} (${formatPct(tire.deltaFromTheoreticalPct)})`));
        rows.push(row("Readout", `Running ${Math.abs(tire.deltaFromTheoreticalPct).toFixed(1)}% ${smaller} than nominal.`));
      } else if (tire.theoretical && tire.source === "lookup") {
        rows.push(numericRow("Nominal calculated reference", formatMm(tire.theoretical.rollingCircMm, 1)));
      }

      resultEl.innerHTML = `<h3>Tire value</h3>${rows.join("")}`;
    });
  }

  // --- Sag calculator -------------------------------------------------------
  let _sagCache = {};

  const sagMethodEl = document.getElementById("sag-method");
  const sagFrontL2Field = document.getElementById("sag-front-l2-field");
  const sagRearL2Field = document.getElementById("sag-rear-l2-field");

  function syncSagMethodFields() {
    const showL2 = sagMethodEl.value === "racetech";
    sagFrontL2Field.hidden = !showL2;
    sagRearL2Field.hidden = !showL2;
  }

  sagMethodEl.addEventListener("change", syncSagMethodFields);

  function computeSag(l1, l2, l3, method) {
    if (l1 == null || l3 == null) return null;
    if (method === "racetech") {
      if (l2 == null) return null;
      return l1 - (l2 + l3) / 2;
    }
    return l1 - l3;
  }

  document.getElementById("calc-sag").addEventListener("click", () => {
    const method = sagMethodEl.value;
    const fl1 = num("sag-front-l1"), fl2 = num("sag-front-l2"), fl3 = num("sag-front-l3");
    const rl1 = num("sag-rear-l1"), rl2 = num("sag-rear-l2"), rl3 = num("sag-rear-l3");
    const resultEl = document.getElementById("sag-result");

    const frontSag = computeSag(fl1, fl2, fl3, method);
    const rearSag = computeSag(rl1, rl2, rl3, method);
    const frontStatic = (fl1 != null && fl2 != null) ? fl1 - fl2 : null;
    const rearStatic = (rl1 != null && rl2 != null) ? rl1 - rl2 : null;

    if (frontSag == null && rearSag == null) {
      const l2note = method === "racetech" ? ", L2," : "";
      resultEl.innerHTML = `<p>Enter L1${l2note} and L3 for front or rear to calculate sag.</p>`;
      return;
    }

    // This is the moment a sag figure enters setup.geometryConstants, so it
    // is an edit to the saved session even though sag-front-l2 and friends
    // are only working-out.
    markSessionDirty();
    _sagCache = {
      frontL1Mm: fl1,
      rearL1Mm: rl1,
      frontSagMm: frontSag,
      rearSagMm: rearSag,
    };

    const SAG_MIN = 25, SAG_MAX = 40;
    function sagTag(sag) {
      if (sag == null || sag < 0) return "";
      if (sag < SAG_MIN) return " — below typical range";
      if (sag > SAG_MAX) return " — above typical range";
      return " — within typical range";
    }

    const rows = [];
    if (frontSag != null) {
      rows.push(numericRow("Front rider sag", `${frontSag.toFixed(1)} mm${sagTag(frontSag)}`));
      if (frontStatic != null) rows.push(numericRow("Front static sag", `${frontStatic.toFixed(1)} mm`));
    }
    if (rearSag != null) {
      rows.push(numericRow("Rear rider sag", `${rearSag.toFixed(1)} mm${sagTag(rearSag)}`));
      if (rearStatic != null) rows.push(numericRow("Rear static sag", `${rearStatic.toFixed(1)} mm`));
    }
    if (frontSag != null && rearSag != null) {
      const balance = rearSag - frontSag;
      const balLabel = Math.abs(balance) <= 5 ? "balanced" : (balance > 0 ? "rear higher" : "front higher");
      rows.push(numericRow("Front / rear balance", `${signedMm(balance, 1)} (${balLabel})`));
    }

    const methodLabel = method === "racetech" ? "Race Tech method — stiction corrected" : "Simple method — L1 − L3";
    resultEl.innerHTML = `<h3>Sag result</h3>${rows.join("")}
      <p class="hint">${methodLabel}. Typical sport/track range: 25–40 mm rider sag. L1 and sag values are stored with this session when saved.</p>`;
  });

  // --- Geometry deltas ------------------------------------------------------
  function optionalPositive(id) {
    const value = num(id);
    return value == null || value < 0 ? 0 : value;
  }

  function geometryDirection(steepeningMm) {
    if (steepeningMm > 0) {
      return {
        rake: "less rake",
        trail: "less trail",
        steering: "quicker / twitchier",
      };
    }
    if (steepeningMm < 0) {
      return {
        rake: "more rake",
        trail: "more trail",
        steering: "slower / stabler",
      };
    }
    return {
      rake: "no net rake change",
      trail: "no net trail change",
      steering: "neutral",
    };
  }

  function trailFromConstants(radiusMm, rakeDeg, offsetMm) {
    const rakeRad = rakeDeg * Math.PI / 180;
    const cos = Math.cos(rakeRad);
    if (Math.abs(cos) < 0.0001) return null;
    return (radiusMm * Math.sin(rakeRad) - offsetMm) / cos;
  }

  function preciseTrailDelta(steepeningMm, constants) {
    const wheelbase = constants.wheelbaseMm;
    const radius = constants.frontRadiusMm;
    const rake = constants.designRakeDeg;
    const offset = constants.forkOffsetMm;
    if (![wheelbase, radius, rake, offset].every((v) => Number.isFinite(v) && v > 0)) return null;

    const rakeDeltaDeg = -(steepeningMm / wheelbase) * 57.2957795;
    const baseline = trailFromConstants(radius, rake, offset);
    const changed = trailFromConstants(radius, rake + rakeDeltaDeg, offset);
    if (baseline == null || changed == null) return null;
    return { trailDeltaMm: changed - baseline, rakeDeltaDeg };
  }

  function geometryConstantsFromForm() {
    const constants = {
      wheelbaseMm: num("geo-wheelbase"),
      designRakeDeg: num("geo-design-rake"),
      frontRadiusMm: num("geo-front-radius"),
      forkOffsetMm: num("geo-fork-offset"),
      frontL1Mm: num("sag-front-l1"),
      rearL1Mm: num("sag-rear-l1"),
      frontSagMm: typeof _sagCache.frontSagMm === "number" ? _sagCache.frontSagMm : null,
      rearSagMm: typeof _sagCache.rearSagMm === "number" ? _sagCache.rearSagMm : null,
    };
    return Object.values(constants).some((value) => value != null) ? constants : null;
  }

  document.getElementById("calc-geometry").addEventListener("click", () => {
    const forkUpMm = optionalPositive("geo-fork-up");
    const forkDownMm = optionalPositive("geo-fork-down");
    const rearRaiseMm = optionalPositive("geo-rear-raise");
    const rearLowerMm = optionalPositive("geo-rear-lower");
    const tireDiameterDeltaMm = num("geo-rear-tire-diameter") || 0;

    const frontEndRiseMm = forkDownMm - forkUpMm;
    const rearRideHeightDeltaMm = rearRaiseMm - rearLowerMm + (tireDiameterDeltaMm / 2);
    const steepeningMm = rearRideHeightDeltaMm - frontEndRiseMm;
    const direction = geometryDirection(steepeningMm);
    const tier2TrailDeltaMm = -(steepeningMm / 4);
    const precise = preciseTrailDelta(steepeningMm, geometryConstantsFromForm() || {});

    const resultEl = document.getElementById("geometry-result");
    if (frontEndRiseMm === 0 && rearRideHeightDeltaMm === 0) {
      resultEl.innerHTML = `<p>Enter a fork, rear ride-height, or rear-tire diameter change to see the geometry direction.</p>`;
      return;
    }

    const rows = [
      numericRow("Front ride-height result", signedMm(frontEndRiseMm, 1)),
      numericRow("Rear ride-height result", signedMm(rearRideHeightDeltaMm, 1)),
      row("Tier 1 direction", `${direction.rake}, ${direction.trail}`),
      row("Steering effect", direction.steering),
      numericRow("Tier 2 trail estimate", `${signedMm(tier2TrailDeltaMm, 1)} (estimated)`),
    ];

    if (precise) {
      rows.push(numericRow("Rake estimate", `${signedDeg(precise.rakeDeltaDeg)} (from wheelbase)`));
      rows.push(numericRow("Tier 3 trail delta", `${signedMm(precise.trailDeltaMm, 1)} (formula estimate)`));
    } else {
      rows.push(row("Tier 3 trail delta", "Add wheelbase, front radius, design rake, and offset to estimate with the trail formula."));
    }

    resultEl.innerHTML = `<h3>Geometry consequence</h3>${rows.join("")}
      <p class="hint">Static baseline only - rake changes dynamically under braking and acceleration.</p>
      <p class="hint">Short-wheelbase bikes amplify every change.</p>`;
  });

  // --- Suspension -----------------------------------------------------------
  const SYMPTOM_ADVICE = {
    "midcorner-push":
      "Mid-corner push: try softer front compression, slightly less front preload, or raise rear ride height a touch.",
    "harsh-bumps":
      "Harsh on bumps: reduce compression damping on the end where it's felt most; check preload isn't excessive.",
    "rear-spin":
      "Rear spin on exit: try slightly more rear rebound or lower rear hot PSI; confirm tire temp is in range.",
    "chatter":
      "Chatter: small damping changes on the affected end (1–2 clicks at a time); re-check tire pressure and tire age.",
    "brake-dive":
      "Brake dive: add a little front compression damping or fork preload; keep changes small.",
    "wallow":
      "Wallow: increase rebound damping on the affected end; verify static sag before making big changes.",
  };

  document.getElementById("calc-suspension").addEventListener("click", () => {
    const checked = Array.from(document.querySelectorAll("#symptoms input:checked")).map((i) => i.value);
    const el = document.getElementById("suspension-result");
    if (checked.length === 0) {
      el.innerHTML = `<p>Select one or more symptoms to see conservative starting points.</p>`;
      return;
    }
    const items = checked.map((v) => `<li>${escapeHtml(SYMPTOM_ADVICE[v] || v)}</li>`).join("");
    el.innerHTML = `<h3>Suggested adjustments</h3><ul>${items}</ul>
      <p class="hint">Change one thing at a time. Educational only — track conditions and your own feel take priority.</p>`;
  });

  // --- Laps -----------------------------------------------------------------
  function parseLap(line) {
    const s = line.trim();
    if (!s) return null;
    // mm:ss.sss or m:ss(.s*)
    const m = s.match(/^(\d+):(\d{1,2}(?:\.\d+)?)$/);
    if (m) {
      const mins = parseInt(m[1], 10);
      const secs = parseFloat(m[2]);
      if (!Number.isFinite(mins) || !Number.isFinite(secs)) return null;
      return mins * 60 + secs;
    }
    // plain seconds (with optional decimal)
    const n = Number(s);
    if (Number.isFinite(n) && n > 0) return n;
    return null;
  }

  function fmtLap(totalSeconds) {
    if (!Number.isFinite(totalSeconds)) return "—";
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds - m * 60;
    return `${m}:${s.toFixed(3).padStart(6, "0")}`;
  }

  function fmtDelta(d) {
    if (d === 0) return "—";
    const sign = d > 0 ? "+" : "−";
    return `${sign}${Math.abs(d).toFixed(3)}`;
  }

  function analyzeLaps() {
    const raw = document.getElementById("laps-input").value.split(/\r?\n/);
    const laps = [];
    const bad = [];
    raw.forEach((line, i) => {
      if (!line.trim()) return;
      const v = parseLap(line);
      if (v == null) bad.push({ i: i + 1, line });
      else laps.push(v);
    });
    return { laps, bad };
  }

  document.getElementById("calc-laps").addEventListener("click", () => {
    const { laps, bad } = analyzeLaps();
    const el = document.getElementById("laps-result");
    if (laps.length === 0) {
      el.innerHTML = `<p>Paste one lap per line — for example <code>1:42.318</code> or <code>102.4</code>.</p>` +
        (bad.length ? `<p class="warn">Skipped ${bad.length} unparseable line(s).</p>` : "");
      return;
    }
    const best = Math.min(...laps);
    const avg = laps.reduce((a, b) => a + b, 0) / laps.length;
    const bestIdx = laps.indexOf(best);

    const rowsHtml = laps.map((l, i) => {
      const delta = l - best;
      return `<tr${i === bestIdx ? ' class="best"' : ""}><td>${i + 1}</td><td>${escapeHtml(fmtLap(l))}</td><td>${escapeHtml(fmtDelta(delta))}</td></tr>`;
    }).join("");

    el.innerHTML = `
      <h3>Summary</h3>
      ${row("Laps counted", String(laps.length))}
      ${row("Best", fmtLap(best))}
      ${row("Average", fmtLap(avg))}
      ${bad.length ? `<p class="warn">Skipped ${bad.length} unparseable line(s).</p>` : ""}
      <table class="lap-table" aria-label="Lap times">
        <thead><tr><th>Lap</th><th>Time</th><th>Δ best</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    `;
  });

  // --- Review / Summary -----------------------------------------------------
  function collectSummary() {
    const parts = [];

    const setup = {
      Bike: str("bike"),
      Track: str("track"),
      Session: str("session-label"),
      "Ambient temp": str("amb-temp"),
      "Track temp": str("track-temp"),
      Humidity: str("humidity"),
      Notes: str("general-notes"),
    };
    const setupRows = Object.entries(setup).filter(([, v]) => v).map(([k, v]) => row(k, v)).join("");
    if (setupRows) parts.push(`<h3>Setup</h3>${setupRows}`);

    const tires = {
      "Tire brand": str("tire-brand"),
      "Model / compound": str("tire-model"),
      "Front pre-session": str("front-pre"),
      "Rear pre-session": str("rear-pre"),
      "Front post-session": str("front-post"),
      "Rear post-session": str("rear-post"),
      "Warmers": document.getElementById("warmer-on").checked ? "yes" : "",
      "Warmer time (min)": str("warmer-time"),
    };
    const tireRows = Object.entries(tires).filter(([, v]) => v).map(([k, v]) => row(k, v)).join("");
    if (tireRows) parts.push(`<h3>Tires</h3>${tireRows}`);

    const susp = {
      "Fork preload": str("fork-preload"),
      "Fork compression": str("fork-comp"),
      "Fork rebound": str("fork-reb"),
      "Shock preload": str("shock-preload"),
      "Shock compression": str("shock-comp"),
      "Shock rebound": str("shock-reb"),
    };
    const suspRows = Object.entries(susp).filter(([, v]) => v).map(([k, v]) => row(k, v)).join("");
    const symptoms = Array.from(document.querySelectorAll("#symptoms input:checked"))
      .map((i) => i.parentElement.querySelector("span").textContent);
    let suspBlock = suspRows;
    if (symptoms.length) suspBlock += row("Symptoms", symptoms.join(", "));

    // Rider Feedback gets its own section in the summary, named as the
    // contract names it - the chip says NOTES, the concept stays Rider
    // Feedback.
    const fbText = str("rider-feedback");
    const fbTags = Array.from(document.querySelectorAll("#feedback-tags input:checked"))
      .map((i) => FEEDBACK_TAG_LABELS[i.value] || i.value);
    let fbBlock = "";
    if (fbText) fbBlock += row("Feedback", fbText);
    if (fbTags.length) fbBlock += row("Tags", fbTags.join(", "));
    if (fbBlock) parts.push(`<h3>Rider Feedback</h3>${fbBlock}`);
    if (suspBlock) parts.push(`<h3>Suspension</h3>${suspBlock}`);

    const { laps } = analyzeLaps();
    if (laps.length) {
      const best = Math.min(...laps);
      const avg = laps.reduce((a, b) => a + b, 0) / laps.length;
      parts.push(`<h3>Laps</h3>${row("Laps", String(laps.length))}${row("Best", fmtLap(best))}${row("Average", fmtLap(avg))}`);
    }

    return parts.join("");
  }

  document.getElementById("build-summary").addEventListener("click", () => {
    const el = document.getElementById("summary-result");
    const body = collectSummary();
    if (!body) {
      el.innerHTML = `<p>Nothing filled in yet. Add some details and try again.</p>`;
      return;
    }
    el.innerHTML = body + `<p class="hint">This summary is only in your browser tab. Refresh or reset to clear it.</p>`;
    // after_review: the review summary meaningfully completed (non-empty).
    pulseClient.maybePrompt(el, "after_review");
  });

  // --- Reset ----------------------------------------------------------------
  document.getElementById("reset-all").addEventListener("click", () => {
    const ok = window.confirm("Clear every field on every tab? This only blanks the current form — saved history in the History tab is untouched.");
    if (!ok) return;
    clearForm();
    showTab("day");
  });

  function clearForm() {
    document.querySelectorAll('input[type="text"], textarea').forEach((el) => { el.value = ""; });
    document.querySelectorAll('input[type="checkbox"]').forEach((el) => { el.checked = false; });
    _sagCache = {};
    ["tire-result", "suspension-result", "laps-result", "summary-result", "save-result", "geometry-result", "sag-result"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = "";
    });
    // clearForm assigns .value directly and fires no input event, so the
    // context header has to be told - otherwise Reset blanks the fields and
    // leaves the header still naming the bike that is no longer there.
    renderContext();
    // An empty form is a new session: nothing is committed, nothing is saved,
    // and POST is locked again.
    stageState.reset();
    renderPreEditable();
    _copiedFrom = null;
    saveState.reset();
    renderSaveStatus();
  }

  // --- Session shape & form <-> object helpers ------------------------------
  const FEEDBACK_TAG_LABELS = {
    corner_entry: "Corner entry", corner_exit: "Corner exit", braking: "Braking",
    acceleration: "Acceleration", front_feel: "Front feel", rear_feel: "Rear feel",
    stability: "Stability", traction: "Traction", setup_change: "Setup change",
  };
  const SYMPTOM_LABELS = {
    "midcorner-push": "Mid-corner push",
    "harsh-bumps": "Harsh on bumps",
    "rear-spin": "Rear spin on exit",
    "chatter": "Chatter",
    "brake-dive": "Brake dive",
    "wallow": "Wallow",
  };

  function collectSession() {
    return {
      id: window.Store ? Store.newId() : String(Date.now()),
      savedAt: new Date().toISOString(),
      setup: {
        bike: str("bike"),
        track: str("track"),
        sessionLabel: str("session-label"),
        ambTemp: str("amb-temp"),
        trackTemp: str("track-temp"),
        humidity: str("humidity"),
        notes: str("general-notes"),
        geometryConstants: geometryConstantsFromForm(),
      },
      tires: {
        brand: str("tire-brand"),
        model: str("tire-model"),
        frontPre: str("front-pre"),
        rearPre: str("rear-pre"),
        frontPost: str("front-post"),
        rearPost: str("rear-post"),
        warmerOn: document.getElementById("warmer-on").checked,
        warmerTime: str("warmer-time"),
      },
      // Rider Feedback (contract sections 1 and 5). A NEW object, never folded
      // into setup.notes: general notes are day-level scratch text, this is
      // post-outing reflection with tags. Merging them would silently rewrite
      // what older sessions meant.
      riderFeedback: {
        text: str("rider-feedback"),
        tags: Array.from(document.querySelectorAll("#feedback-tags input:checked")).map((i) => i.value),
      },
      suspension: {
        forkPreload: str("fork-preload"),
        forkComp: str("fork-comp"),
        forkReb: str("fork-reb"),
        shockPreload: str("shock-preload"),
        shockComp: str("shock-comp"),
        shockReb: str("shock-reb"),
        symptoms: Array.from(document.querySelectorAll("#symptoms input:checked")).map((i) => i.value),
      },
      laps: {
        raw: document.getElementById("laps-input").value,
        times: analyzeLaps().laps,
      },
    };
  }

  function restoreSession(s) {
    if (!s) return;
    const setId = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ""; };
    const setCheck = (id, v) => { const el = document.getElementById(id); if (el) el.checked = !!v; };

    setId("bike", s.setup && s.setup.bike);
    setId("track", s.setup && s.setup.track);
    setId("session-label", s.setup && s.setup.sessionLabel);
    setId("amb-temp", s.setup && s.setup.ambTemp);
    setId("track-temp", s.setup && s.setup.trackTemp);
    setId("humidity", s.setup && s.setup.humidity);
    setId("general-notes", s.setup && s.setup.notes);
    // setId assigns .value directly and fires no input event, so the context
    // header has to be told. Without this, loading a session leaves the
    // header naming the previous one - the exact confusion it exists to end.
    renderContext();
    const geometryConstants = s.setup && s.setup.geometryConstants || {};
    setId("geo-wheelbase", geometryConstants.wheelbaseMm);
    setId("geo-design-rake", geometryConstants.designRakeDeg);
    setId("geo-front-radius", geometryConstants.frontRadiusMm);
    setId("geo-fork-offset", geometryConstants.forkOffsetMm);
    setId("sag-front-l1", geometryConstants.frontL1Mm);
    setId("sag-rear-l1", geometryConstants.rearL1Mm);
    _sagCache = {
      frontL1Mm: geometryConstants.frontL1Mm != null ? geometryConstants.frontL1Mm : null,
      rearL1Mm: geometryConstants.rearL1Mm != null ? geometryConstants.rearL1Mm : null,
      frontSagMm: geometryConstants.frontSagMm != null ? geometryConstants.frontSagMm : null,
      rearSagMm: geometryConstants.rearSagMm != null ? geometryConstants.rearSagMm : null,
    };

    const t = s.tires || {};
    setId("tire-brand", t.brand);
    setId("tire-model", t.model);
    setId("front-pre", t.frontPre != null && t.frontPre !== "" ? t.frontPre : t.frontCold);
    setId("rear-pre", t.rearPre != null && t.rearPre !== "" ? t.rearPre : t.rearCold);
    setId("front-post", t.frontPost != null && t.frontPost !== "" ? t.frontPost : t.frontHot);
    setId("rear-post", t.rearPost != null && t.rearPost !== "" ? t.rearPost : t.rearHot);
    setCheck("warmer-on", t.warmerOn);
    setId("warmer-time", t.warmerTime);

    setId("fork-preload", s.suspension && s.suspension.forkPreload);
    setId("fork-comp", s.suspension && s.suspension.forkComp);
    setId("fork-reb", s.suspension && s.suspension.forkReb);
    setId("shock-preload", s.suspension && s.suspension.shockPreload);
    setId("shock-comp", s.suspension && s.suspension.shockComp);
    setId("shock-reb", s.suspension && s.suspension.shockReb);

    const symptoms = (s.suspension && s.suspension.symptoms) || [];
    document.querySelectorAll("#symptoms input[type=checkbox]").forEach((cb) => {
      cb.checked = symptoms.indexOf(cb.value) !== -1;
    });

    // Rider Feedback. Absence is loaded EXPLICITLY, not skipped: a session
    // saved before this field existed has no riderFeedback key, and one that
    // simply had none has an empty one. Both must clear whatever the previous
    // session left on screen, so the text is always assigned and every tag is
    // unchecked before saved selections are restored. Skipping either would
    // leave one session's words attached to another's record.
    const fb = s.riderFeedback || {};
    setId("rider-feedback", fb.text || "");
    const fbTags = fb.tags || [];
    document.querySelectorAll("#feedback-tags input[type=checkbox]").forEach((cb) => {
      cb.checked = fbTags.indexOf(cb.value) !== -1;
    });

    setId("laps-input", s.laps && s.laps.raw);

    ["tire-result", "suspension-result", "laps-result", "summary-result", "save-result", "geometry-result", "sag-result"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = "";
    });
  }

  function sessionTitle(s) {
    const track = (s.setup && s.setup.track) || "Untracked";
    const bike = (s.setup && s.setup.bike) || "";
    const label = (s.setup && s.setup.sessionLabel) || "";
    const tail = [bike, label].filter(Boolean).join(" · ");
    return tail ? `${track} — ${tail}` : track;
  }

  function sessionBest(s) {
    const times = (s.laps && Array.isArray(s.laps.times)) ? s.laps.times : [];
    return times.length ? Math.min(...times) : null;
  }

  function sessionDateLabel(iso) {
    try {
      const d = new Date(iso);
      return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    } catch (e) {
      return iso || "";
    }
  }

  // --- Save / History UI ----------------------------------------------------
  function storageReady() {
    return !!(window.Store && Store.available());
  }

  function showStorageWarning() {
    const el = document.getElementById("storage-warning");
    if (!el) return;
    el.hidden = storageReady();
  }

  // Does this session describe an outing yet?
  //
  // Reads the SAVED session rather than the form, so the two can never
  // disagree. setup.geometryConstants is excluded deliberately: those are the
  // calculators' bike constants, and a wheelbase typed into the geometry tool
  // must not make an otherwise empty session look like unsaved work. Rider
  // Feedback text and tags ARE content - they are the rider's own words.
  function sessionHasContent(s) {
    if (!s) return false;
    const setup = Object.assign({}, s.setup);
    delete setup.geometryConstants;
    const fb = s.riderFeedback || {};
    return Object.values(setup).some(Boolean)
      || Object.values(s.tires).some((v) => v !== "" && v !== false)
      || Object.values(s.suspension).some((v) => (Array.isArray(v) ? v.length : Boolean(v)))
      || Boolean(fb.text)
      || (Array.isArray(fb.tags) && fb.tags.length > 0)
      || Boolean(s.laps && s.laps.times && s.laps.times.length);
  }

  function hasSessionContent() {
    try { return sessionHasContent(collectSession()); } catch (e) { return false; }
  }

  function doSave() {
    const out = document.getElementById("save-result");
    if (!storageReady()) {
      out.innerHTML = `<p class="warn">Browser storage is unavailable, so nothing was saved.</p>`;
      return { ok: false };
    }
    const s = collectSession();
    // The id comes from the save state, so a retry after an unverified write
    // reuses it and RECONCILES that record rather than writing a second copy.
    s.id = saveState.claimSaveId(() => (window.Store ? Store.newId() : String(Date.now())));
    if (!sessionHasContent(s)) {
      out.innerHTML = `<p>Nothing to save yet — fill in some details first.</p>`;
      return { ok: false };
    }
    try {
      Store.put(s);
    } catch (e) {
      out.innerHTML = `<p class="warn">Not saved — try Save again.</p>`;
      return { ok: false };
    }
    // Read it back and compare the CONTENT, not just the id. A throwing write
    // is handled above; this catches one that reported success and did not
    // land, or landed as something else.
    let stored = null;
    try { stored = Store.findById(s.id); } catch (e) { stored = null; }
    if (!stored || JSON.stringify(stored) !== JSON.stringify(s)) {
      out.innerHTML = `<p class="warn">Not saved — try Save again.</p>`;
      return { ok: false, unverified: true };
    }
    return { ok: true, out, id: s.id, savedAt: s.savedAt };
  }

  // Every save goes through here so that the double-tap guard, the dirty flag
  // and the "nothing new to save" rule cannot be bypassed by one of the two
  // buttons. A failed save changes NOTHING: not the flags, not the label, not
  // a single field.
  function guardedSave() {
    const gate = saveState.beginSave();
    if (!gate.start) {
      return gate.reason === "in-flight"
        ? { ok: false, blocked: true }
        : { ok: false, alreadySaved: true };
    }
    renderSaveDock();
    let r = { ok: false };
    try {
      r = doSave();
    } finally {
      // A failed or throwing save leaves the form dirty and every value in
      // place, so the rider can simply try again.
      if (r && r.ok) {
        saveState.saveSucceeded(r.id, r.savedAt || new Date().toISOString());
        // The copy now has its own record, so the warning has done its job.
        // It stays put until this point - a failed save leaves it showing.
        _copiedFrom = null;
      } else {
        saveState.saveFailed();
      }
      renderSaveDock();
      renderSaveStatus();
    }
    return r;
  }

  document.getElementById("save-session").addEventListener("click", () => {
    const r = guardedSave();
    if (r.alreadySaved || r.blocked) return;
    if (r.ok) {
      r.out.innerHTML = `<p class="good">Saved locally. It is in the saved-session list below.</p>`;
      // after_save: a session was saved and the result stays visible here.
      // (Save & next intentionally does not prompt - it navigates onward to the
      // next session, so the prompt would be unseen and the flow is mid-task.)
      pulseClient.maybePrompt(r.out, "after_save");
      renderHistory();
    }
  });

  function clearTransientFields() {
    ["amb-temp", "track-temp", "humidity", "general-notes",
     "front-pre", "rear-pre", "front-post", "rear-post",
     "laps-input"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
    document.querySelectorAll("#symptoms input[type=checkbox]").forEach((cb) => { cb.checked = false; });
    // Feedback and tags describe the outing just saved, so they clear with the
    // rest of it. Bike, track, tire brand and suspension carry over as always.
    const fbText = document.getElementById("rider-feedback");
    if (fbText) fbText.value = "";
    document.querySelectorAll("#feedback-tags input[type=checkbox]").forEach((cb) => { cb.checked = false; });
    ["tire-result", "suspension-result", "laps-result", "summary-result"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = "";
    });
  }

  document.getElementById("save-and-next").addEventListener("click", () => {
    const out = document.getElementById("save-result");
    const r = guardedSave();
    if (r.blocked) return;
    // After a plain Save only, the form holds nothing new. The rider still
    // wants to move on, so this advances WITHOUT writing a second copy of the
    // session they just saved.
    const advancingOnly = !!r.alreadySaved;
    if (!advancingOnly && !r.ok) return;   // a failed save preserves everything
    advanceToNextSession(out, advancingOnly);
  });

  // The carry-over step, shared by both paths. Bike, track, tire brand and
  // suspension stay; the readings that describe one outing clear.
  function advanceToNextSession(out, advancingOnly) {
    const labelEl = document.getElementById("session-label");
    if (labelEl) {
      // The SAME rule that decided what the button said decides what is
      // written. A bump we would not show is a bump we do not make, so the
      // rider's own label is left exactly as they typed it.
      const next = nextLabelFrom(labelEl.value);
      if (next.clean) labelEl.value = next.label;
    }
    clearTransientFields();
    renderContext();
    // Cleared fields mean this is a new session: nothing saved, nothing new.
    saveState.advanced();
    // The next outing has not been ridden yet, so POST locks again.
    stageState.reset();
    renderPreEditable();
    // The new session is NOT saved. Nothing about the record just written
    // carries forward into how this one is described.
    renderSaveStatus();
    if (out) {
      out.innerHTML = advancingOnly
        ? `<p class="good">Ready for the next session — bike, track, tire brand, and suspension settings carried over. The saved session was not duplicated.</p>`
        : `<p class="good">Saved. Form is ready for the next session — bike, track, tire brand, and suspension settings carried over.</p>`;
    }
    showTab("day");
  }

  function renderHistory() {
    showStorageWarning();
    const listEl = document.getElementById("history-list");
    const emptyEl = document.getElementById("history-empty");
    const trendsEl = document.getElementById("history-trends");
    const selA = document.getElementById("compare-a");
    const selB = document.getElementById("compare-b");

    const sessions = storageReady() ? Store.readAll() : [];
    sessions.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));

    if (!sessions.length) {
      listEl.innerHTML = "";
      trendsEl.innerHTML = "";
      selA.innerHTML = "";
      selB.innerHTML = "";
      emptyEl.hidden = false;
      return;
    }
    emptyEl.hidden = true;

    // Session list
    listEl.innerHTML = sessions.map((s) => {
      const best = sessionBest(s);
      const meta = [
        sessionDateLabel(s.savedAt),
        best != null ? `best ${fmtLap(best)}` : null,
        s.laps && s.laps.times ? `${s.laps.times.length} laps` : null,
      ].filter(Boolean).join(" · ");
      return `
        <div class="session-card" data-id="${escapeHtml(s.id)}">
          <h4>${escapeHtml(sessionTitle(s))}</h4>
          <div class="meta">${escapeHtml(meta)}</div>
          <div class="actions">
            <button type="button" class="btn-secondary" data-action="load" data-id="${escapeHtml(s.id)}">Copy to form</button>
            <button type="button" class="btn-secondary" data-action="view" data-id="${escapeHtml(s.id)}">View</button>
            <button type="button" class="btn-danger" data-action="delete" data-id="${escapeHtml(s.id)}">Delete</button>
          </div>
          <div class="result" id="view-${escapeHtml(s.id)}" hidden></div>
        </div>
      `;
    }).join("");

    // Compare selects
    const options = sessions.map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(sessionDateLabel(s.savedAt))} — ${escapeHtml(sessionTitle(s))}</option>`).join("");
    selA.innerHTML = options;
    selB.innerHTML = options;
    if (sessions.length > 1) selB.selectedIndex = 1;

    // Trends per track
    const groups = {};
    sessions.forEach((s) => {
      const key = (s.setup && s.setup.track || "Untracked").trim();
      const k = key.toLowerCase();
      if (!groups[k]) groups[k] = { label: key, items: [] };
      const best = sessionBest(s);
      if (best != null) groups[k].items.push({ s, best });
    });
    const trendHtml = Object.values(groups)
      .filter((g) => g.items.length >= 2)
      .map((g) => {
        g.items.sort((a, b) => String(a.s.savedAt).localeCompare(String(b.s.savedAt)));
        const pr = Math.min(...g.items.map((x) => x.best));
        const rows = g.items.map(({ s, best }) => {
          const isPr = best === pr;
          return `<div class="trend-row${isPr ? " pr" : ""}"><span>${escapeHtml(sessionDateLabel(s.savedAt))}</span><span>${escapeHtml(fmtLap(best))}</span><span>${isPr ? "PR" : "+" + (best - pr).toFixed(3)}</span></div>`;
        }).join("");
        return `<div class="trend-block"><h4>${escapeHtml(g.label)}</h4>${rows}</div>`;
      }).join("");
    trendsEl.innerHTML = trendHtml ? `<h3>Per-track trend</h3>${trendHtml}` : "";
  }

  // Delegated actions on session cards
  document.getElementById("history-list").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const id = btn.dataset.id;
    const action = btn.dataset.action;
    const all = Store.readAll();
    const s = all.find((x) => x.id === id);
    if (!s) return;

    if (action === "load") {
      // Named for what it does. It opens the values as a NEW draft - it does
      // not reopen the stored record, and saving writes a separate session.
      const ok = window.confirm("Copy this session's values into the form? It will be saved as a separate session, not as changes to this one. Anything you've typed will be overwritten.");
      if (!ok) return;
      restoreSession(s);
      // A finished session says nothing about whether THIS rider is back in.
      // Copying it must never imply the transition: PRE opens editable and
      // POST stays locked until the rider takes Back in themselves.
      _copiedFrom = {
        id: s.id,
        summary: sessionDateLabel(s.savedAt) + " \u2014 " + sessionTitle(s),
      };
      stageState.copyFromSaved();
      renderPreEditable();
      // Copied values are new relative to storage: this draft has never been
      // saved, and saving it will create its own record.
      // A copy is not saved, however saved the session it came from was.
      saveState.reset();
      saveState.markDirty();
      renderSaveStatus();
      showTab("day");
    } else if (action === "delete") {
      const ok = window.confirm("Delete this saved session? This cannot be undone.");
      if (!ok) return;
      Store.remove(id);
      renderHistory();
    } else if (action === "view") {
      const el = document.getElementById("view-" + id);
      if (!el) return;
      if (!el.hidden) { el.hidden = true; el.innerHTML = ""; return; }
      el.innerHTML = sessionDetailHtml(s);
      el.hidden = false;
    }
  });

  function sessionDetailHtml(s) {
    const rows = [];
    const pushIf = (label, value) => { if (value !== "" && value != null && value !== false) rows.push(row(label, String(value))); };
    pushIf("Bike", s.setup && s.setup.bike);
    pushIf("Track", s.setup && s.setup.track);
    pushIf("Session", s.setup && s.setup.sessionLabel);
    pushIf("Ambient temp", s.setup && s.setup.ambTemp);
    pushIf("Track temp", s.setup && s.setup.trackTemp);
    pushIf("Humidity", s.setup && s.setup.humidity);
    pushIf("Notes", s.setup && s.setup.notes);
    const geometryConstants = s.setup && s.setup.geometryConstants || {};
    pushIf("Wheelbase", geometryConstants.wheelbaseMm);
    pushIf("Design rake", geometryConstants.designRakeDeg);
    pushIf("Front tire radius", geometryConstants.frontRadiusMm);
    pushIf("Fork offset", geometryConstants.forkOffsetMm);
    pushIf("Front L1 (extended)", geometryConstants.frontL1Mm);
    pushIf("Rear L1 (extended)", geometryConstants.rearL1Mm);
    if (geometryConstants.frontSagMm != null) pushIf("Front rider sag", `${Number(geometryConstants.frontSagMm).toFixed(1)} mm`);
    if (geometryConstants.rearSagMm != null) pushIf("Rear rider sag", `${Number(geometryConstants.rearSagMm).toFixed(1)} mm`);
    const t = s.tires || {};
    pushIf("Tire brand", t.brand);
    pushIf("Model / compound", t.model);
    pushIf("Front pre-session", t.frontPre || t.frontCold);
    pushIf("Rear pre-session", t.rearPre || t.rearCold);
    pushIf("Front post-session", t.frontPost || t.frontHot);
    pushIf("Rear post-session", t.rearPost || t.rearHot);
    pushIf("Warmers", t.warmerOn ? "yes" : "");
    pushIf("Warmer time (min)", t.warmerTime);
    pushIf("Fork preload", s.suspension && s.suspension.forkPreload);
    pushIf("Fork comp", s.suspension && s.suspension.forkComp);
    pushIf("Fork rebound", s.suspension && s.suspension.forkReb);
    pushIf("Shock preload", s.suspension && s.suspension.shockPreload);
    pushIf("Shock comp", s.suspension && s.suspension.shockComp);
    pushIf("Shock rebound", s.suspension && s.suspension.shockReb);
    const symNames = (s.suspension && s.suspension.symptoms || []).map((k) => SYMPTOM_LABELS[k] || k);
    if (symNames.length) pushIf("Symptoms", symNames.join(", "));
    pushIf("Rider feedback", s.riderFeedback && s.riderFeedback.text);
    const fbNames = ((s.riderFeedback && s.riderFeedback.tags) || []).map((k) => FEEDBACK_TAG_LABELS[k] || k);
    if (fbNames.length) pushIf("Tags", fbNames.join(", "));
    const times = s.laps && s.laps.times || [];
    if (times.length) {
      pushIf("Laps", String(times.length));
      pushIf("Best", fmtLap(Math.min(...times)));
      pushIf("Average", fmtLap(times.reduce((a, b) => a + b, 0) / times.length));
    }
    return rows.join("") || "<p>Nothing recorded for this session.</p>";
  }

  // --- Compare --------------------------------------------------------------
  document.getElementById("run-compare").addEventListener("click", () => {
    const out = document.getElementById("compare-result");
    if (!storageReady()) { out.innerHTML = `<p class="warn">Storage unavailable.</p>`; return; }
    const all = Store.readAll();
    const aId = document.getElementById("compare-a").value;
    const bId = document.getElementById("compare-b").value;
    const a = all.find((x) => x.id === aId);
    const b = all.find((x) => x.id === bId);
    if (!a || !b) { out.innerHTML = `<p>Pick two saved sessions.</p>`; return; }
    if (a.id === b.id) { out.innerHTML = `<p>Those are the same session — pick two different ones.</p>`; return; }

    const fields = [
      ["Bike", (s) => s.setup && s.setup.bike],
      ["Track", (s) => s.setup && s.setup.track],
      ["Session", (s) => s.setup && s.setup.sessionLabel],
      ["Ambient temp", (s) => s.setup && s.setup.ambTemp],
      ["Track temp", (s) => s.setup && s.setup.trackTemp],
      ["Humidity", (s) => s.setup && s.setup.humidity],
      ["Wheelbase", (s) => s.setup && s.setup.geometryConstants && s.setup.geometryConstants.wheelbaseMm],
      ["Design rake", (s) => s.setup && s.setup.geometryConstants && s.setup.geometryConstants.designRakeDeg],
      ["Front tire radius", (s) => s.setup && s.setup.geometryConstants && s.setup.geometryConstants.frontRadiusMm],
      ["Fork offset", (s) => s.setup && s.setup.geometryConstants && s.setup.geometryConstants.forkOffsetMm],
      ["Front L1 (extended)", (s) => s.setup && s.setup.geometryConstants && s.setup.geometryConstants.frontL1Mm],
      ["Rear L1 (extended)", (s) => s.setup && s.setup.geometryConstants && s.setup.geometryConstants.rearL1Mm],
      ["Front rider sag", (s) => { const v = s.setup && s.setup.geometryConstants && s.setup.geometryConstants.frontSagMm; return v != null ? `${Number(v).toFixed(1)} mm` : ""; }],
      ["Rear rider sag", (s) => { const v = s.setup && s.setup.geometryConstants && s.setup.geometryConstants.rearSagMm; return v != null ? `${Number(v).toFixed(1)} mm` : ""; }],
      ["Tire brand", (s) => (s.tires && s.tires.brand) || ""],
      ["Model / compound", (s) => (s.tires && s.tires.model) || ""],
      ["Front pre-session", (s) => (s.tires && (s.tires.frontPre || s.tires.frontCold)) || ""],
      ["Rear pre-session", (s) => (s.tires && (s.tires.rearPre || s.tires.rearCold)) || ""],
      ["Front post-session", (s) => (s.tires && (s.tires.frontPost || s.tires.frontHot)) || ""],
      ["Rear post-session", (s) => (s.tires && (s.tires.rearPost || s.tires.rearHot)) || ""],
      ["Warmers", (s) => s.tires && s.tires.warmerOn ? "yes" : ""],
      ["Fork preload", (s) => s.suspension && s.suspension.forkPreload],
      ["Fork comp", (s) => s.suspension && s.suspension.forkComp],
      ["Fork rebound", (s) => s.suspension && s.suspension.forkReb],
      ["Shock preload", (s) => s.suspension && s.suspension.shockPreload],
      ["Shock comp", (s) => s.suspension && s.suspension.shockComp],
      ["Shock rebound", (s) => s.suspension && s.suspension.shockReb],
      ["Symptoms", (s) => ((s.suspension && s.suspension.symptoms) || []).map((k) => SYMPTOM_LABELS[k] || k).join(", ")],
      ["Rider feedback", (s) => (s.riderFeedback && s.riderFeedback.text) || ""],
      ["Tags", (s) => ((s.riderFeedback && s.riderFeedback.tags) || []).map((k) => FEEDBACK_TAG_LABELS[k] || k).join(", ")],
      ["Best lap", (s) => { const b = sessionBest(s); return b == null ? "" : fmtLap(b); }],
      ["Avg lap", (s) => { const t = s.laps && s.laps.times || []; return t.length ? fmtLap(t.reduce((x, y) => x + y, 0) / t.length) : ""; }],
      ["Laps", (s) => { const t = s.laps && s.laps.times || []; return t.length ? String(t.length) : ""; }],
    ];

    const rowsHtml = fields.map(([label, get]) => {
      const va = get(a) || "";
      const vb = get(b) || "";
      if (!va && !vb) return "";
      const diff = String(va) !== String(vb);
      return `<tr${diff ? ' class="diff"' : ""}><td>${escapeHtml(label)}</td><td class="val">${escapeHtml(va)}</td><td class="val">${escapeHtml(vb)}</td></tr>`;
    }).join("");

    out.innerHTML = `
      <h3>${escapeHtml(sessionTitle(a))} vs ${escapeHtml(sessionTitle(b))}</h3>
      <p class="hint">Highlighted rows differ between the two sessions.</p>
      <table class="compare-table">
        <thead><tr><th>Field</th><th>A — ${escapeHtml(sessionDateLabel(a.savedAt))}</th><th>B — ${escapeHtml(sessionDateLabel(b.savedAt))}</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    `;
  });

  // --- Export / Import / Clear ---------------------------------------------
  document.getElementById("export-history").addEventListener("click", () => {
    if (!storageReady()) { window.alert("Storage unavailable in this browser."); return; }
    const payload = Store.exportPayload();
    if (!payload.sessions.length) { window.alert("No saved sessions to export yet."); return; }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `mototrack-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  document.getElementById("import-history").addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!storageReady()) { window.alert("Storage unavailable in this browser."); e.target.value = ""; return; }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        const res = Store.importPayload(data);
        if (!res.ok) { window.alert("Import failed: " + res.reason); return; }
        window.alert(`Imported ${res.added} session(s). Skipped ${res.skipped} (duplicates or invalid).`);
        renderHistory();
      } catch (err) {
        window.alert("Could not read that file: " + (err.message || String(err)));
      } finally {
        e.target.value = "";
      }
    };
    reader.onerror = () => { window.alert("Could not read that file."); e.target.value = ""; };
    reader.readAsText(file);
  });

  document.getElementById("clear-history").addEventListener("click", () => {
    if (!storageReady()) return;
    const count = Store.readAll().length;
    if (!count) { window.alert("There is nothing saved to clear."); return; }
    const ok = window.confirm(`Delete all ${count} saved session(s) from this device? This cannot be undone. Consider exporting a backup first.`);
    if (!ok) return;
    Store.clear();
    renderHistory();
  });

  // --- Rider feedback (#55/#56 PR 2) ---------------------------------------
  // One entry that opens a dedicated surface. The originating section is
  // captured from the canonical tab state BEFORE the dialog opens, so it is
  // never overwritten with a "feedback" pseudo-section. No second section list.
  (function feedback() {
    const openBtn = document.getElementById("feedback-open");
    const overlay = document.getElementById("feedback-overlay");
    if (!openBtn || !overlay) return;
    const form = document.getElementById("feedback-form");
    const bodyField = document.getElementById("feedback-body");
    const emailField = document.getElementById("feedback-email");
    const statusEl = document.getElementById("feedback-status");
    const submitBtn = document.getElementById("feedback-submit");
    const closeBtn = document.getElementById("feedback-close");

    const GENERIC_FAIL = "We couldn't send your feedback right now. Please try again.";
    let captured = { sourceSection: null, sourceRoute: null };
    let lastFocus = null;
    let csrfToken = null;

    function activeSection() {
      const tab = document.querySelector('.stage[aria-selected="true"]');
      return tab ? tab.dataset.tab : null;
    }
    function setStatus(msg, kind) {
      statusEl.textContent = msg || "";
      statusEl.className = "feedback-status" + (kind ? " " + kind : "");
    }

    // Fail-closed reveal: the entry stays hidden until this bootstrap proves
    // the feature is enabled (GET succeeds and returns a CSRF token). The same
    // call mints the double-submit token, so opening the modal and submitting
    // need no further fetches.
    async function bootstrap() {
      try {
        const res = await fetch("/api/feedback", { method: "GET", headers: { accept: "application/json" } });
        if (!res.ok) return; // disabled/unavailable -> entry stays hidden
        const data = await res.json();
        if (!data || !data.csrf) return;
        csrfToken = data.csrf;
        openBtn.hidden = false; // reveal ONLY after availability is proven
      } catch (_) { /* stays hidden */ }
    }

    function open() {
      // Capture the originating context BEFORE showing the dialog. Opening is
      // local only - no fetch, no UI churn.
      captured = { sourceSection: activeSection(), sourceRoute: location.pathname + location.hash };
      setStatus("");
      form.hidden = false;
      overlay.hidden = false;
      lastFocus = document.activeElement;
      bodyField.focus();
    }
    function close() {
      overlay.hidden = true;
      form.reset();
      setStatus("");
      submitBtn.disabled = false;
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }

    openBtn.addEventListener("click", open);
    closeBtn.addEventListener("click", close);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !overlay.hidden) close(); });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = (bodyField.value || "").trim();
      if (body === "") { setStatus("Please enter some feedback first.", "warn"); bodyField.focus(); return; }
      if (!csrfToken) { setStatus(GENERIC_FAIL, "warn"); return; }
      submitBtn.disabled = true;
      setStatus("Sending…");
      try {
        const res = await fetch("/api/feedback", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            body,
            contactEmail: (emailField.value || "").trim() || undefined,
            sourceSection: captured.sourceSection,
            sourceRoute: captured.sourceRoute,
            csrf: csrfToken,
          }),
        });
        if (res.status === 201) {
          form.hidden = true;
          setStatus("Thanks for the feedback.", "ok");
          // Suppress any automatic Experience Pulse for the rest of this session
          // - a rider who just explained in full sentences is not asked to pulse.
          pulseClient.recordFeedbackSubmitted();
          return;
        }
        if (res.status === 400) {
          let code = "";
          try { code = (await res.json()).code; } catch (_) { /* ignore */ }
          setStatus(code === "invalid_email"
            ? "That email address doesn't look right. Fix it or leave it blank."
            : GENERIC_FAIL, "warn");
          submitBtn.disabled = false;
          return;
        }
        setStatus(GENERIC_FAIL, "warn");
        submitBtn.disabled = false;
      } catch (err) {
        setStatus(GENERIC_FAIL, "warn");
        submitBtn.disabled = false;
      }
    });

    bootstrap();
  })();

  // --- Experience Pulse (#55): a one-tap, optional, INLINE experience-instance
  // read shown after a successful save (after_save) or a built review summary
  // (after_review), inside the existing result region - never a modal, never a
  // persistent card, never blocking. Fail-closed: nothing renders unless the
  // gated endpoint confirms availability AND the cadence engine allows it. The
  // cadence ceiling (<=1/session, <=1/app_version/7d, none right after written
  // Feedback) lives in the shared, separately-tested engine
  // window.MotoTrackPulseCadence (public/experience-pulse-cadence.js) - this
  // controller owns only the DOM + network, so there is no hand-mirrored cadence
  // copy to drift. It NEVER opens the Feedback form (including for "1 - Not
  // good") and never treats "1" differently. `manual` stays reserved with no v1
  // UI. Defined after the Feedback controller and referenced from the save/
  // review handlers above, which run on user interaction (after this inits).
  const pulseClient = (function experiencePulse() {
    const ENDPOINT = "/api/experience-pulse";
    const cadence = window.MotoTrackPulseCadence || null;
    const stores = () => ({ sessionStorage: window.sessionStorage, localStorage: window.localStorage });
    let available = false;
    let csrfToken = null;
    let appVersion = null;

    function activeSection() {
      const tab = document.querySelector('.stage[aria-selected="true"]');
      return tab ? tab.dataset.tab : null;
    }

    // Fail-closed availability + double-submit token. Returns false (and leaves
    // the pulse hidden) unless the gated GET succeeds and returns a token +
    // canonical appVersion. Re-callable to re-mint an expired token.
    async function fetchToken() {
      const res = await fetch(ENDPOINT, { method: "GET", headers: { accept: "application/json" } });
      if (!res.ok) return false;
      const data = await res.json();
      if (!data || !data.csrf || !data.appVersion) return false;
      csrfToken = data.csrf;
      appVersion = data.appVersion;
      available = true;
      return true;
    }

    function postPulse(value, ctx) {
      return fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          value,
          sourceSection: ctx.sourceSection,
          sourceRoute: ctx.sourceRoute,
          actionContext: ctx.actionContext,
          csrf: csrfToken,
        }),
      });
    }

    function acknowledge(block) {
      block.textContent = "";
      const p = document.createElement("p");
      p.className = "pulse-ack";
      p.textContent = "Thanks.";
      block.appendChild(p);
    }

    async function submit(block, value, ctx) {
      block.querySelectorAll(".pulse-opt").forEach((b) => { b.disabled = true; });
      try {
        let res = await postPulse(value, ctx);
        if (res.status !== 201) {
          // The double-submit cookie/token can expire on a long-open tab; re-mint
          // once and retry so a genuine tap is not silently lost.
          await fetchToken();
          res = await postPulse(value, ctx);
        }
        if (res.status === 201) { acknowledge(block); return; }
      } catch (_) { /* fire-and-forget: a pulse never blocks continuation */ }
      // Any non-success after the retry: quietly remove the control. No nagging,
      // no error text, no workflow change - cadence already recorded the prompt.
      block.remove();
    }

    // Show an inline pulse in `target` (an existing .result region) if available
    // and the cadence engine allows. Appends below the region's existing
    // message; one tap.
    function maybePrompt(target, actionContext) {
      if (!available || !cadence || !target) return;
      if (!cadence.shouldAutoPrompt({ now: Date.now(), appVersion, ...stores() }).allowed) return;
      const ctx = { actionContext, sourceSection: activeSection(), sourceRoute: location.pathname + location.hash };
      const block = document.createElement("div");
      block.className = "pulse";
      block.setAttribute("role", "group");
      block.setAttribute("aria-label", "Experience pulse");
      const q = document.createElement("p");
      q.className = "pulse-q";
      q.textContent = "How was this experience?";
      const opts = document.createElement("div");
      opts.className = "pulse-options";
      [[1, "1 — Not good"], [2, "2 — Okay"], [3, "3 — Good"]].forEach(([value, label]) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "pulse-opt";
        b.dataset.value = String(value);
        b.textContent = label;
        b.addEventListener("click", () => submit(block, value, ctx));
        opts.appendChild(b);
      });
      block.appendChild(q);
      block.appendChild(opts);
      target.appendChild(block);
      // Record the SHOWN prompt (session cap + version window) so a prompt the
      // rider dismisses without answering still counts against the ceiling.
      cadence.recordPulsePrompted({ now: Date.now(), appVersion, ...stores() });
    }

    // Called from the written-Feedback success path so no automatic pulse
    // follows in this session.
    function recordFeedbackSubmitted() {
      if (cadence) cadence.recordFeedbackSubmitted({ sessionStorage: window.sessionStorage });
    }

    fetchToken().catch(() => { /* stays unavailable */ });

    return { maybePrompt, recordFeedbackSubmitted };
  })();

  // Initial state
  showStorageWarning();
})();
