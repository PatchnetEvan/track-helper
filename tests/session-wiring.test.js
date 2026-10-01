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
    // Declare it a real field: clearForm() finds what it clears by selector
    // ('input[type="text"], textarea'), so an element that never claims to be
    // an input is never cleared, and Reset would look broken when it is not.
    el.tagName = "INPUT";
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

// ---------------------------------------------------------------------------
// 3. Save status through the real wiring (PR 5)
// ---------------------------------------------------------------------------

const status = (a) => a.el("save-status").textContent;
const statusHidden = (a) => a.el("save-status").hidden;

test("a fresh empty form says nothing", () => {
  const a = setup();
  assert.equal(statusHidden(a), true, "the line takes no space");
  assert.equal(status(a), "");
});

test("entering something says it is not saved", () => {
  const a = setup();
  a.type("bike", "Panigale V4 #21");
  assert.equal(statusHidden(a), false);
  assert.match(status(a), /Not saved yet/);
});

test("a successful write says Saved on this device, with a time", () => {
  const a = setup();
  a.fillSession();
  a.go("review");
  a.el("save-session").click();
  assert.equal(a.saved().length, 1);
  assert.match(status(a), /^Saved on this device · \d/, status(a));
});

test("an edit after saving returns the status to unsaved", () => {
  const a = setup();
  a.fillSession();
  a.go("review");
  a.el("save-session").click();
  assert.match(status(a), /Saved on this device/);
  a.type("rear-pre", "28.0");
  assert.match(status(a), /Not saved yet/, "a real session-field edit flips it back");
});

test("comparison selections and calculator inputs never change the status", () => {
  const a = setup();
  a.fillSession();
  a.go("review");
  a.el("save-session").click();
  const saidSaved = status(a);
  for (const id of ["compare-a", "compare-b", "tire-core-measured", "tire-core-size",
                    "sag-front-l2", "sag-front-l3", "sag-rear-l2", "sag-rear-l3"]) {
    a.type(id, "123");
    assert.equal(status(a), saidSaved, `${id} must not change the save status`);
  }
});

test("calculator working inputs alone do not make an empty session look unsaved", () => {
  const a = setup();
  for (const id of ["geo-wheelbase", "geo-design-rake", "sag-front-l1", "sag-rear-l1",
                    "tire-core-measured", "tire-core-size"]) {
    a.type(id, "100");
  }
  assert.equal(statusHidden(a), true, "still nothing to report");
  assert.equal(status(a), "");
});

test("Rider Feedback text alone counts as content", () => {
  const a = setup();
  a.type("rider-feedback", "Front pushed on entry all session.");
  assert.equal(statusHidden(a), false);
  assert.match(status(a), /Not saved yet/);
});

test("a Rider Feedback tag alone counts as content", () => {
  const a = setup();
  const tag = a.dom.makeEl("", "INPUT");
  tag.checked = true;
  tag.value = "corner_entry";
  a.el("feedback-tags").appendChild(tag);
  tag.dispatchEvent(new a.win.Event("change"));
  assert.equal(statusHidden(a), false, "a tag on its own is the rider saying something");
  assert.match(status(a), /Not saved yet/);
});

// --- write failures -------------------------------------------------------

test("a write that throws keeps every entry and asks for a retry", () => {
  const a = setup();
  a.fillSession();
  a.go("review");
  a.storage.failNextWrite = true;
  a.el("save-session").click();
  assert.equal(a.saved().length, 0, "nothing was written");
  assert.equal(status(a), "Not saved · try Save again");
  assert.equal(a.el("bike").value, "Panigale V4 #21", "entries retained");
  assert.equal(a.el("front-pre").value, "30.5", "entries retained");
  // and the retry works
  a.el("save-session").click();
  assert.equal(a.saved().length, 1);
  assert.match(status(a), /Saved on this device/);
});

test("a SILENT write failure is caught by read-back and never claims Saved", () => {
  const a = setup();
  a.fillSession();
  a.go("review");
  // setItem reports success and stores nothing: the case a try/catch misses.
  const real = a.storage.setItem.bind(a.storage);
  a.storage.setItem = () => {};
  a.el("save-session").click();
  assert.equal(a.saved().length, 0, "nothing landed");
  assert.equal(status(a), "Not saved · try Save again", "and Saved was never claimed");
  a.storage.setItem = real;
});

test("write succeeds but read-back fails: the retry reconciles, it does not duplicate", () => {
  const a = setup();
  a.fillSession();
  a.go("review");

  // The write lands; the verification read cannot see it.
  const realFind = a.win.Store.findById;
  a.win.Store.findById = () => null;
  a.el("save-session").click();
  const afterUnverified = a.saved();
  assert.equal(afterUnverified.length, 1, "the record DID land");
  assert.equal(status(a), "Not saved · try Save again", "but Saved was not claimed");
  const pendingId = afterUnverified[0].id;

  // Verification recovers; the retry must reuse the id and reconcile.
  a.win.Store.findById = realFind;
  a.el("save-session").click();
  const after = a.saved();
  assert.equal(after.length, 1, "ONE record, not two copies of the same outing");
  assert.equal(after[0].id, pendingId, "the retry reused the pending id");
  assert.match(status(a), /Saved on this device/);
});

test("content is verified, not just the id", () => {
  const a = setup();
  a.fillSession();
  a.go("review");
  // A record with the right id but the wrong content must not pass.
  const realFind = a.win.Store.findById;
  a.win.Store.findById = (id) => ({ id, setup: { bike: "someone else's bike" } });
  a.el("save-session").click();
  assert.equal(status(a), "Not saved · try Save again", "matching id is not enough");
  a.win.Store.findById = realFind;
});

test("Save & next failing keeps entries, the label and the stage", () => {
  const a = setup();
  a.fillSession();
  a.go("review");
  a.storage.failNextWrite = true;
  a.el("save-and-next").click();
  assert.equal(a.saved().length, 0, "nothing written");
  assert.equal(a.el("session-label").value, "Session 2", "label not advanced");
  assert.equal(a.el("bike").value, "Panigale V4 #21", "entries retained");
  assert.equal(a.el("front-pre").value, "30.5", "entries retained");
  assert.equal(a.el("rear-pre").value, "", "nothing cleared");
  assert.equal(status(a), "Not saved · try Save again");
});

// --- the four actions -----------------------------------------------------

test("Save & next shows the NEW session as unsaved, never the predecessor's Saved", () => {
  const a = setup();
  a.fillSession();
  a.go("review");
  a.el("save-and-next").click();
  assert.equal(a.saved().length, 1);
  assert.match(status(a), /Not saved yet/,
    "the carried-over bike and track are a new, unsaved session");
  assert.ok(!/Saved on this device/.test(status(a)), "no inherited Saved");
});

test("advancing after a plain Save also reports the new session as unsaved", () => {
  const a = setup();
  a.fillSession();
  a.go("review");
  a.el("save-session").click();
  assert.match(status(a), /Saved on this device/);
  a.el("save-and-next").click();           // advances without a second write
  assert.equal(a.saved().length, 1, "no duplicate");
  assert.match(status(a), /Not saved yet/, "and the status moved on with the rider");
});

test("Reset clears the status completely", () => {
  const a = setup();
  a.fillSession();
  a.go("review");
  a.el("save-session").click();
  a.el("reset-all").click();
  assert.equal(statusHidden(a), true, "an empty form reports nothing");
  assert.equal(status(a), "");
});

test("Copy to form reports the copy as unsaved", () => {
  const a = setup();
  copyASavedSessionInto(a);
  assert.match(status(a), /Not saved yet/,
    "a copy of a saved session is not itself saved");
});
