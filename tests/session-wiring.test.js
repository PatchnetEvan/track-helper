import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bootApp } from "./helpers/boot-app.js";

// PR 4 corrections. These drive the REAL public/app.js through real events,
// because both bugs they cover lived in the wiring rather than in the rules:
// the pure state-module tests passed throughout.
//
// Assertions are on primitives only - never on an element.

function setup() {
  const app = bootApp();
  const { document, win } = app;
  const type = (id, value) => {
    const el = document.getElementById(id);
    el.value = value;
    el.dispatchEvent(new win.Event("input"));
  };
  const go = (stage) => app.stageCells[stage].click();
  const text = (id) => document.getElementById(id).textContent;
  const el = (id) => document.getElementById(id);
  // A minimal saveable session.
  const fillSession = () => {
    type("bike", "Panigale V4 #21");
    type("track", "Barber");
    type("session-label", "Session 2");
    type("front-pre", "30.5");
  };
  return { ...app, type, go, text, el, fillSession };
}

// ---------------------------------------------------------------------------
// 1. Dirty tracking must follow the SAVED SESSION, not all of <main>
// ---------------------------------------------------------------------------

test("changing a comparison selector does not re-arm saving", () => {
  const a = setup();
  a.fillSession();
  a.go("review");
  a.el("save-session").click();
  assert.equal(a.saved().length, 1, "one record after Save only");

  // The rider now picks two sessions to compare. This is not an edit.
  a.type("compare-a", "s_one");
  a.type("compare-b", "s_two");
  assert.equal(a.el("save-session").disabled, true, "Save only stays disabled");

  a.el("save-and-next").click();
  assert.equal(a.saved().length, 1, "Save & next advanced WITHOUT a duplicate");
});

test("calculator-only inputs do not re-arm saving", () => {
  const a = setup();
  a.fillSession();
  a.go("review");
  a.el("save-session").click();
  assert.equal(a.saved().length, 1);

  // Working-out for the calculators; none of it reaches the saved session.
  for (const id of ["tire-core-measured", "tire-core-size", "sag-front-l2",
                    "sag-front-l3", "sag-rear-l2", "sag-rear-l3"]) {
    a.type(id, "123");
  }
  assert.equal(a.el("save-session").disabled, true, `no calculator input re-armed the save`);
  a.el("save-and-next").click();
  assert.equal(a.saved().length, 1, "still one record");
});

test("a genuine session-field edit DOES make saving available again", () => {
  const a = setup();
  a.fillSession();
  a.go("review");
  a.el("save-session").click();
  assert.equal(a.el("save-session").disabled, true);

  a.type("rear-pre", "28.0");            // a real saved-session field
  assert.equal(a.el("save-session").disabled, false, "re-armed by a real edit");
  a.el("save-session").click();
  assert.equal(a.saved().length, 2, "and the edited session saved as its own record");
});

test("every saved-session field re-arms the save", () => {
  // One boot per field, so a field that only works because a previous one
  // already set the flag cannot hide here.
  const FIELDS = ["bike", "track", "session-label", "amb-temp", "track-temp",
    "humidity", "general-notes", "tire-brand", "tire-model", "front-pre",
    "rear-pre", "front-post", "rear-post", "warmer-time", "rider-feedback",
    "fork-preload", "fork-comp", "fork-reb", "shock-preload", "shock-comp",
    "shock-reb", "laps-input", "geo-wheelbase", "geo-design-rake",
    "geo-front-radius", "geo-fork-offset", "sag-front-l1", "sag-rear-l1"];
  for (const id of FIELDS) {
    const a = setup();
    a.fillSession();
    a.go("review");
    a.el("save-session").click();
    assert.equal(a.el("save-session").disabled, true, `${id}: armed before the edit`);
    a.type(id, "9");
    assert.equal(a.el("save-session").disabled, false, `${id} must re-arm the save`);
  }
});

test("the tracked field list matches what collectSession actually reads", () => {
  // The rule lives in session-progress.js; collectSession lives in app.js.
  // If a field joins the saved session without joining the list, it goes
  // untracked in silence - so the two are compared here.
  const appJs = readFileSync(join(import.meta.dirname, "..", "public", "app.js"), "utf8");
  const start = appJs.indexOf("function collectSession()");
  const body = appJs.slice(start, appJs.indexOf("function restoreSession"));
  const read = new Set();
  for (const m of body.matchAll(/\bstr\("([a-z0-9-]+)"\)/g)) read.add(m[1]);
  for (const m of body.matchAll(/getElementById\("([a-z0-9-]+)"\)/g)) read.add(m[1]);
  // geometryConstantsFromForm is called from collectSession; fold it in.
  const gStart = appJs.indexOf("function geometryConstantsFromForm()");
  const gBody = appJs.slice(gStart, appJs.indexOf("}", appJs.indexOf("return Object.values", gStart)));
  for (const m of gBody.matchAll(/\bnum\("([a-z0-9-]+)"\)/g)) read.add(m[1]);

  const tracked = new Set(bootApp().win.SessionProgress.SESSION_FIELD_IDS);
  const untracked = [...read].filter((id) => !tracked.has(id)).sort();
  assert.deepEqual(untracked, [], "every field collectSession reads is tracked as an edit");
});

test("running the sag calculator counts as a session edit", () => {
  // Its own inputs are working-out, but the result lands in
  // setup.geometryConstants, so the save has to re-arm.
  const a = setup();
  a.fillSession();
  a.go("review");
  a.el("save-session").click();
  assert.equal(a.el("save-session").disabled, true);

  a.el("sag-method").value = "static";
  for (const [id, v] of [["sag-front-l1", "600"], ["sag-front-l2", "570"], ["sag-front-l3", "540"],
                         ["sag-rear-l1", "500"], ["sag-rear-l2", "470"], ["sag-rear-l3", "440"]]) {
    a.el(id).value = v;   // set directly: this is NOT the edit under test
  }
  a.el("calc-sag").click();
  assert.equal(a.el("save-session").disabled, false, "the calculation re-armed the save");
});

// ---------------------------------------------------------------------------
// 2. Copy provenance must be VISIBLE, and stay until the first save succeeds
// ---------------------------------------------------------------------------

function copyASavedSessionInto(a) {
  a.fillSession();
  a.go("review");
  a.el("save-session").click();
  const record = a.saved()[0];
  // Drive the real History handler: the panel delegates by data-action.
  const btn = a.dom.makeEl("", "BUTTON");
  btn.dataset.action = "load";
  btn.dataset.id = record.id;
  a.el("history-list").appendChild(btn);   // the real delegation target
  btn.click();
  return record;
}

test("copying shows where it came from, and says it will be a new session", () => {
  const a = setup();
  copyASavedSessionInto(a);
  a.go("review");
  const note = a.text("copy-origin");
  assert.equal(a.el("copy-origin").hidden, false, "the origin note is shown");
  assert.match(note, /^Copied from /, "it names the source session");
  assert.match(note, /Session 2/, "including the session it came from");
  assert.match(note, /separate session/, "and says a separate session will be created");
  assert.match(note, /leaves that one unchanged/, "and that the original is untouched");
  assert.equal(a.el("save-session").textContent, "Save as a new session",
    "the save control says what it will do");
});

test("nothing is shown when the form was not copied", () => {
  const a = setup();
  a.fillSession();
  a.go("review");
  assert.equal(a.el("copy-origin").hidden, true, "no origin note");
  assert.equal(a.el("copy-origin").textContent, "", "and no stale text");
  assert.equal(a.el("save-session").textContent, "Save only");
});

test("the copy warning survives a FAILED save", () => {
  const a = setup();
  copyASavedSessionInto(a);
  a.go("review");
  a.storage.failNextWrite = true;
  const before = a.saved().length;
  a.el("save-session").click();
  assert.equal(a.saved().length, before, "nothing was written");
  assert.equal(a.el("copy-origin").hidden, false,
    "the warning stays up - the duplicate it warns about still has not happened");
  assert.match(a.text("copy-origin"), /Copied from /);
});

test("the copy warning clears on the first SUCCESSFUL save", () => {
  const a = setup();
  copyASavedSessionInto(a);
  a.go("review");
  const before = a.saved().length;
  a.el("save-session").click();
  assert.equal(a.saved().length, before + 1, "the copy became its own record");
  assert.equal(a.el("copy-origin").hidden, true, "and the warning is gone");
  assert.equal(a.el("copy-origin").textContent, "", "with no stale text left behind");
});

test("a copy is saved as a separate record, leaving the original alone", () => {
  const a = setup();
  const original = copyASavedSessionInto(a);
  a.go("review");
  a.el("save-session").click();
  const all = a.saved();
  assert.equal(all.length, 2, "two records");
  assert.equal(all.filter((s) => s.id === original.id).length, 1, "the original is untouched");
  assert.notEqual(all[1].id, original.id, "the copy has its own id");
});
