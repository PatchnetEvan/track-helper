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
  return { ...app, el, type, check, summary: () => el("tire-summary").textContent };
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
  const btn = a.el("edit-tires");
  assert.equal(btn.getAttribute("aria-expanded"), "false");
  btn.click();
  assert.equal(a.el("tire-fields").hidden, false, "opened");
  assert.equal(btn.getAttribute("aria-expanded"), "true");
  assert.equal(btn.textContent, "Done");
  btn.click();
  assert.equal(a.el("tire-fields").hidden, true, "closed again");
  assert.equal(btn.getAttribute("aria-expanded"), "false");
  assert.equal(btn.textContent, "Edit tires");
});

test("values entered while open survive closing", () => {
  const a = setup();
  a.el("edit-tires").click();
  a.type("tire-brand", "Michelin");
  a.el("edit-tires").click();
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

test("ticks are positioned from the centre, not from the left edge", () => {
  const appJs = readFileSync(join(import.meta.dirname, "..", "public", "app.js"), "utf8");
  const start = appJs.indexOf("function drawRuler");
  const body = appJs.slice(start, appJs.indexOf("function renderPressure", start));
  assert.match(body, /calc\(50% \+ /, "each tick is offset from the middle of the box");
  assert.match(body, /i = -8; i <= 8/, "the full +/-8 tick window is drawn");
  assert.ok(!body.includes("getBoundingClientRect"),
    "layout no longer depends on measuring the box, which is what clipped it");
});

test("every tick carries a label, whole numbers in full", () => {
  const appJs = readFileSync(join(import.meta.dirname, "..", "public", "app.js"), "utf8");
  const start = appJs.indexOf("function drawRuler");
  const body = appJs.slice(start, appJs.indexOf("function renderPressure", start));
  assert.match(body, /tick-label/);
  assert.match(body, /whole \? String\(Math\.round\(psi\)\)/, "30, not .0");
});
