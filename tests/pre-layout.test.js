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
