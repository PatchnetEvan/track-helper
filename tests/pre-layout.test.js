import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bootApp } from "./helpers/boot-app.js";

const src = readFileSync(join(import.meta.dirname, "..", "public", "session-progress.js"), "utf8");
new Function("window", src)({});
const S = globalThis.SessionProgress;

const AUTOSAVE = "mototrack.autosave";

function setup(opts) {
  const app = bootApp(opts);
  if (opts && opts.autosave) app.storage.setItem(AUTOSAVE, "true");
  const { document, win } = app;
  const el = (id) => document.getElementById(id);
  const type = (id, v) => { const e = el(id); e.tagName = "INPUT"; e.value = v; e.dispatchEvent(new win.Event("input")); };
  const check = (id, on) => { const e = el(id); e.checked = on; e.dispatchEvent(new win.Event("input", { bubbles: true })); };
  const stateRow = (label) => {
    const rows = app.document.getElementById("bike-state-rows");
    const found = (rows.children || []).find((r) =>
      (r.children || []).some((c) => c.textContent === label));
    return found ? (found.children || []).map((c) => c.textContent).join("|") : null;
  };
  // The Edit buttons are created by renderBikeState, so they are found in the
  // rendered card rather than by a bare getElementById - which in the stub DOM
  // would auto-create an inert placeholder and quietly pass.
  const cardButton = (id) => {
    const rows = app.document.getElementById("bike-state-rows");
    const walk = (node) => {
      for (const child of (node.children || [])) {
        if (child.id === id) return child;
        const found = walk(child);
        if (found) return found;
      }
      return null;
    };
    return walk(rows);
  };
  return { ...app, el, type, check, stateRow, cardButton, summary: () => {
    const t = stateRow("Tires");
    return t === null ? null : t.split("|")[1];
  } };
}

// ---------------------------------------------------------------------------
// The summary must never imply a setup that was not entered
// ---------------------------------------------------------------------------

test("with nothing entered the summary says so", () => {
  assert.equal(S.tiresSummary("", "", false, ""), "No tires set");
  assert.equal(S.tiresSummary("   ", "  ", false, "  "), "No tires set");
});

test("a partial setup names only what is actually there", () => {
  assert.equal(S.tiresSummary("Pirelli", "", false, ""), "Pirelli");
  assert.equal(S.tiresSummary("", "Supercorsa SC1", false, ""), "Supercorsa SC1");
  // Warmers ticked with no time is still a fact; a time is not invented.
  assert.equal(S.tiresSummary("Pirelli", "SC1", true, ""), "Pirelli · SC1 · warmers");
  // A time entered but warmers not ticked is not a claim that warmers were used.
  assert.equal(S.tiresSummary("Pirelli", "SC1", false, "45"), "Pirelli · SC1");
});

test("a complete setup reads as the design specifies", () => {
  assert.equal(S.tiresSummary("Pirelli", "Supercorsa SC1", true, "45"),
    "Pirelli · Supercorsa SC1 · warmers 45 min");
});

test("the summary updates as the rider types", () => {
  const a = setup();
  assert.equal(a.summary(), "No tires set");
  a.type("tire-brand", "Pirelli");
  assert.equal(a.summary(), "Pirelli");
  a.type("tire-model", "Supercorsa SC1");
  assert.equal(a.summary(), "Pirelli · Supercorsa SC1");
  a.check("warmer-on", true);
  a.type("warmer-time", "45");
  assert.equal(a.summary(), "Pirelli · Supercorsa SC1 · warmers 45 min");
});

test("the summary follows a restored draft, with no typing at all", () => {
  const boot = bootApp();
  boot.storage.setItem(AUTOSAVE, "true");
  const first = setup({ storage: boot.storage, autosave: true });
  first.type("bike", "Yamaha R3");
  first.type("tire-brand", "Pirelli");
  first.type("tire-model", "Supercorsa SC1");
  first.clock.flush();
  const back = setup({ autosave: true, storage: first.storage });
  assert.equal(back.el("tire-brand").value, "Pirelli", "the draft restored the fields");
  assert.equal(back.summary(), "Pirelli · Supercorsa SC1",
    "and the summary reflects them without an edit");
});

// ---------------------------------------------------------------------------
// Edit tires: a disclosure, not a move
// ---------------------------------------------------------------------------

test("the fields keep their ids and stay in the document while collapsed", () => {
  const a = setup();
  assert.equal(a.el("tire-fields").hidden, true, "collapsed by default");
  for (const id of ["tire-brand", "tire-model", "warmer-on", "warmer-time"]) {
    assert.ok(a.el(id), `${id} is still in the document`);
  }
  // Typing into a collapsed field still registers, so a restored draft or a
  // loaded session is never lost behind the disclosure.
  a.type("tire-brand", "Pirelli");
  assert.equal(a.summary(), "Pirelli");
});

test("Edit tires opens and closes in place", () => {
  const a = setup();
  const btn = a.cardButton("edit-tires");
  assert.equal(btn.getAttribute("aria-expanded"), "false");
  btn.click();
  assert.equal(a.el("tire-fields").hidden, false, "opened");
  assert.equal(btn.getAttribute("aria-expanded"), "true");
  assert.equal(btn.textContent, "Done");
  btn.click();
  assert.equal(a.el("tire-fields").hidden, true, "closed again");
  assert.equal(btn.getAttribute("aria-expanded"), "false");
  assert.equal(btn.textContent, "Edit");
});

test("values entered while open survive closing", () => {
  const a = setup();
  a.cardButton("edit-tires").click();
  a.type("tire-brand", "Michelin");
  a.cardButton("edit-tires").click();
  assert.equal(a.el("tire-brand").value, "Michelin");
  assert.equal(a.summary(), "Michelin");
});

// ---------------------------------------------------------------------------
// Header: an unset field says it is unset
// ---------------------------------------------------------------------------

test("an unset bike or track names itself rather than leaving a blank line", () => {
  assert.equal(S.headerBikeLine("", "DAY"), "No bike set · DAY");
  assert.equal(S.headerBikeLine("", ""), "No bike set");
  assert.equal(S.headerTrackLine("", ""), "No track set");
  assert.equal(S.headerTrackLine("", "Session 3"), "No track set · Session 3");
});

test("the bike text is used exactly as entered", () => {
  for (const typed of ["#405 · Yamaha R3", "Panigale V4 #21", "r3", "  spaced  "]) {
    assert.equal(S.headerBikeLine(typed, "PRE"), typed.trim(),
      "no number is invented and nothing is split out");
  }
});

test("the header renders the empty states in the real app", () => {
  const a = setup();
  assert.match(a.el("context-bike").textContent, /^No bike set/);
  assert.match(a.el("context-where").textContent, /^No track set/);
  a.type("bike", "#405 · Yamaha R3");
  a.type("track", "Homestead");
  a.type("session-label", "Session 3");
  assert.equal(a.el("context-bike").textContent, "#405 · Yamaha R3");
  assert.equal(a.el("context-where").textContent, "Homestead · Session 3");
});

// ---------------------------------------------------------------------------
// The ruler is laid out from the centre
// ---------------------------------------------------------------------------

test("pad lines are positioned from the centre and move with the value", () => {
  const appJs = readFileSync(join(import.meta.dirname, "..", "public", "app.js"), "utf8");
  const start = appJs.indexOf("function drawPad");
  const body = appJs.slice(start, appJs.indexOf("function renderTire", start));
  assert.match(body, /calc\(50% \+ /, "each line is offset from the middle of the pad");
  assert.match(body, /pad-line--long/, "every fifth tenth is a long line");
  assert.match(body, /shift/, "the pattern moves with the value, so a drag is visible");
  assert.ok(!body.includes("getBoundingClientRect"),
    "layout does not depend on measuring the box");
});

test("the pad dims and refuses drag for a value typed outside the range", () => {
  const appJs = readFileSync(join(import.meta.dirname, "..", "public", "app.js"), "utf8");
  assert.match(appJs, /drag-pad--off/, "there is an off state");
  assert.match(appJs, /TYPE OR &minus; \/ \+/, "and it says what still works");
});

// ---------------------------------------------------------------------------
// v2 round 2: the closed row stays compact, and opening one reveals it
// ---------------------------------------------------------------------------

test("the delta chip replaces the Today caption once there is a value", () => {
  const appJs = readFileSync(join(import.meta.dirname, "..", "public", "app.js"), "utf8");
  const start = appJs.indexOf("function renderTire");
  const body = appJs.slice(start, appJs.indexOf("function renderAllPressures", start));
  assert.match(body, /today\.hidden = chipText !== ""/,
    "the caption gives way to the chip, so the closed row keeps its 72px minimum");
  assert.match(body, /delta\.hidden = chipText === ""/,
    "and the chip only appears when there is something to compare");
});

test("a blank tire carries no note, so the open card has no footer text", () => {
  const SPx = globalThis.SessionProgress;
  assert.equal(SPx.pressureNote("", true), "");
  assert.equal(SPx.pressureNote("", false), "");
  // The notes that remain are the ones that only apply sometimes.
  assert.match(SPx.pressureNote("48.0", true), /outside the drag range/);
  assert.equal(SPx.pressureNote("abc", true), "Type a number, for example 30.5.");
});

test("opening a tire brings its controls above the dock, and respects reduced motion", () => {
  const appJs = readFileSync(join(import.meta.dirname, "..", "public", "app.js"), "utf8");
  const start = appJs.indexOf("function revealTire");
  const body = appJs.slice(start, appJs.indexOf("function openTire", start));
  assert.match(body, /prefers-reduced-motion: reduce/, "reduced motion is honoured");
  assert.match(body, /behavior: "auto"/, "and it jumps rather than animates when asked to");
  assert.match(body, /panelRect\.bottom - dockRect\.top/,
    "it scrolls by the actual overlap with the dock, not a guess");
  assert.ok(body.includes("if (overlap <= 0) return;"),
    "nothing scrolls when the controls already clear the dock");
});

test("the POST pill and chip each read as one line", () => {
  const SPx = globalThis.SessionProgress;
  const sess = [{ savedAt: "2026-09-27", sessionLabel: "Session 2", setup: { bike: "B" },
                  tires: { brand: "P", model: "M", frontPost: "33.5" } }];
  const refs = SPx.pressureReferences(sess, { bike: "B", brand: "P", model: "M" }, "front-post", "30.5");
  assert.deepEqual(refs.sources.map((x) => x.text + " " + x.value), ["S2 hot 33.5", "PRE 30.5"]);
  assert.equal(SPx.deltaChip("35.7", refs), "+2.2 vs S2 · +5.2 vs PRE");
});

// ---------------------------------------------------------------------------
// Negative suspension adjusters
// ---------------------------------------------------------------------------

test("a click adjuster steps down through zero and back", () => {
  const S = globalThis.SessionProgress;
  assert.equal(S.adjusterStep("0", -1, "clicks"), "-1");
  assert.equal(S.adjusterStep("-1", -1, "clicks"), "-2");
  assert.equal(S.adjusterStep("-2", 1, "clicks"), "-1");
  assert.equal(S.adjusterStep("-1", 1, "clicks"), "0");
  // Blank still starts from the reference, and may go either way.
  assert.equal(S.adjusterStep("", -1, "clicks"), "-1");
});

test("turns step down through zero in halves", () => {
  const S = globalThis.SessionProgress;
  assert.equal(S.adjusterStep("0", -1, "turns"), "-0.5");
  assert.equal(S.adjusterStep("-0.5", -1, "turns"), "-1.0");
  assert.equal(S.adjusterStep("-1.5", 1, "turns"), "-1.0");
  // Tenths stay exact through zero rather than drifting.
  let v = "0";
  for (let i = 0; i < 4; i += 1) v = S.adjusterStep(v, -1, "turns");
  assert.equal(v, "-2.0");
});

test("all three minus characters are read, and a plain hyphen is stored", () => {
  const S = globalThis.SessionProgress;
  for (const text of ["-2", "−2", "–2"]) {
    assert.equal(S.readAdjuster(text), -2, `${JSON.stringify(text)} reads as -2`);
    assert.equal(S.normalizeMinus(text), "-2", "and normalizes to a plain hyphen");
  }
  assert.equal(S.normalizeMinus("−1.5"), "-1.5");
  // Only a LEADING sign is rewritten; nothing else in the text is touched.
  assert.equal(S.normalizeMinus("2"), "2");
});

test("the range ends disable the button rather than clamping", () => {
  const S = globalThis.SessionProgress;
  assert.deepEqual(S.ADJUSTER_LIMIT, { clicks: 40, turns: 10 });
  assert.equal(S.adjusterStep("40", 1, "clicks"), null, "+ is dead at the top");
  assert.equal(S.adjusterStep("-40", -1, "clicks"), null, "- is dead at the bottom");
  assert.equal(S.adjusterStep("39", 1, "clicks"), "40", "and live just inside it");
  assert.equal(S.adjusterStep("-39", -1, "clicks"), "-40");
  assert.equal(S.adjusterStep("10", 1, "turns"), null);
  assert.equal(S.adjusterStep("-10", -1, "turns"), null);
  assert.equal(S.adjusterStep("9.5", 1, "turns"), "10.0");
});

test("a pressure still refuses to go below zero", () => {
  const S = globalThis.SessionProgress;
  assert.equal(S.rulerStep("0.0", -1, null), null, "the pressure guard is untouched");
  assert.equal(S.stepValue("0", "1", -1), null, "and stepValue still refuses by default");
  assert.equal(S.stepValue("0", "1", -1, { allowNegative: true }), "-1",
    "only an explicit opt-in allows it");
});

test("a true minus is shown, and zero is a real value", () => {
  const S = globalThis.SessionProgress;
  assert.equal(S.adjusterDisplay("-2", "clicks"), "−2 clicks");
  assert.equal(S.adjusterDisplay("-1.5", "turns"), "−1.5 turns");
  assert.equal(S.adjusterDisplay("0", "clicks"), "0 clicks", "zero is a setting, not an absence");
  assert.equal(S.adjusterDisplay("", "clicks"), "—", "blank means not set");
  // Positive values carry no sign.
  assert.equal(S.adjusterDisplay("2", "clicks"), "2 clicks");
});

test("the PRE summary shows a true minus and no plus", () => {
  const S = globalThis.SessionProgress;
  const summary = S.suspensionSummary(
    { "shock-comp": "-2", "shock-reb": "-1.5", "fork-comp": "0", "fork-reb": "2" },
    { "shock-reb": "turns" });
  assert.match(summary, /C−2/, "clicks carry a true minus");
  assert.match(summary, /R−1\.5t/, "turns carry the minus and the t");
  assert.match(summary, /C0/, "zero is shown as zero");
  assert.ok(!summary.includes("+"), "a positive value gets no plus");
  assert.ok(!summary.includes("-"), "no ASCII hyphen is ever displayed");
});

// ---------------------------------------------------------------------------
// PR 81: Undo after Back in -> POST (C14)
// ---------------------------------------------------------------------------

test("the undo window counts down and closes on its own", () => {
  const S = globalThis.SessionProgress;
  const u = S.createUndoWindow();
  assert.equal(u.open, false, "closed until the transition happens");
  u.start();
  assert.equal(u.remaining, 10);
  assert.equal(u.label(), "Undo · back to PRE · 10s");
  for (let i = 0; i < 9; i += 1) u.tick();
  assert.equal(u.open, true, "still open at one second left");
  assert.equal(u.label(), "Undo · back to PRE · 1s");
  u.tick();
  assert.equal(u.open, false, "gone after ten");
  assert.equal(u.label(), "", "and says nothing once closed");
});

test("a POST reading ends the undo window", () => {
  const S = globalThis.SessionProgress;
  const u = S.createUndoWindow();
  u.start();
  u.endedByEntry();
  assert.equal(u.open, false, "entering a value closes it");
  assert.equal(u.remaining, 0);
});

test("undo restores the stage exactly, and Correct PRE still never re-locks POST", () => {
  const S = globalThis.SessionProgress;
  const st = S.createStageState();
  assert.equal(st.postUnlocked, false);
  st.backIn();
  assert.equal(st.postUnlocked, true, "back in unlocks POST");
  assert.equal(st.preEditable, false, "and locks PRE");
  // Undo is exactly a reset of what the transition changed.
  st.reset();
  assert.equal(st.postUnlocked, false, "POST is locked again");
  assert.equal(st.preEditable, true, "PRE is editable again");
  // The separate guarantee, unchanged by any of this.
  st.backIn();
  st.correctPre();
  assert.equal(st.preEditable, true);
  assert.equal(st.postUnlocked, true, "Correct PRE never re-locks POST");
});

test("the undo control is announced once, not every second", () => {
  const appJs = readFileSync(join(import.meta.dirname, "..", "public", "app.js"), "utf8");
  const start = appJs.indexOf("function renderUndoButton");
  const body = appJs.slice(start, appJs.indexOf("function postEntryEndsUndo", start));
  assert.match(body, /_undoAnnounced/, "the announcement is guarded by a flag");
  assert.match(body, /if \(!_undoAnnounced\)/, "so it fires once");
});

// ---------------------------------------------------------------------------
// PR 81: Start session fills blank setup (C5)
// ---------------------------------------------------------------------------

const CARRY_SESSION = {
  savedAt: "2026-09-27T10:00:00Z", sessionLabel: "Session 2",
  setup: { bike: "Yamaha R3" },
  tires: { brand: "Pirelli", model: "SC1", warmerTime: "45", warmerOn: true,
           frontPre: "31.0", rearPre: "28.0", frontPost: "33.5" },
  suspension: { forkPreload: "3", forkComp: "12", forkReb: "10",
                shockPreload: "1.5", shockComp: "-2", shockReb: "8" },
};

test("blank setup fields are filled from the last session on this bike", () => {
  const S = globalThis.SessionProgress;
  const last = S.lastSessionForBike([CARRY_SESSION], "Yamaha R3");
  assert.ok(last, "the session is found by bike");
  const plan = S.carryPlan(last, {});
  const ids = plan.map(([id]) => id);
  assert.deepEqual(ids, ["tire-brand", "tire-model", "warmer-time", "fork-preload",
    "fork-comp", "fork-reb", "shock-preload", "shock-comp", "shock-reb"]);
  assert.deepEqual(plan.find(([id]) => id === "shock-comp"), ["shock-comp", "-2"],
    "a negative click value carries like any other");
});

test("a value the rider entered is never overwritten", () => {
  const S = globalThis.SessionProgress;
  const last = S.lastSessionForBike([CARRY_SESSION], "Yamaha R3");
  const plan = S.carryPlan(last, { "tire-brand": "Michelin", "fork-comp": "9" });
  const ids = plan.map(([id]) => id);
  assert.ok(!ids.includes("tire-brand"), "the entered brand stands");
  assert.ok(!ids.includes("fork-comp"), "and so does the entered click count");
  assert.ok(ids.includes("tire-model"), "while the blank ones are still filled");
});

test("pressures are never copied", () => {
  const S = globalThis.SessionProgress;
  const last = S.lastSessionForBike([CARRY_SESSION], "Yamaha R3");
  const ids = S.carryPlan(last, {}).map(([id]) => id);
  for (const p of ["front-pre", "rear-pre", "front-post", "rear-post"]) {
    assert.ok(!ids.includes(p), `${p} is history, not today's reading`);
  }
  assert.ok(!S.CARRY_FIELDS.some(([id]) => /-(pre|post)$/.test(id)),
    "and no pressure is even a candidate");
});

test("with no history, Start session does nothing and says so", () => {
  const S = globalThis.SessionProgress;
  assert.equal(S.lastSessionForBike([], "Yamaha R3"), null);
  assert.equal(S.lastSessionForBike([CARRY_SESSION], "RSV4"), null, "another bike does not count");
  assert.equal(S.lastSessionForBike([CARRY_SESSION], ""), null, "nor does an unnamed bike");
  assert.deepEqual(S.carryPlan(null, {}), []);
  assert.equal(S.startSessionEffect([], ""), "Opens PRE");
});

test("the sub-line names the session it would copy from", () => {
  const S = globalThis.SessionProgress;
  const last = S.lastSessionForBike([CARRY_SESSION], "Yamaha R3");
  const plan = S.carryPlan(last, {});
  assert.equal(S.startSessionEffect(plan, "Session 2"),
    "Fills blank tires and clicks from S2 · opens PRE");
  // No number in the label, no invented one.
  assert.equal(S.startSessionEffect(plan, "Warm-up"),
    "Fills blank tires and clicks from the last session · opens PRE");
});
