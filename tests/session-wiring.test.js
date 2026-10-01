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

// The text lives in its own element now, so it can shrink and wrap inside the
// flex row; the <p> keeps role="status" and the hidden state.
const status = (a) => a.el("save-status-text").textContent;
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

// ---------------------------------------------------------------------------
// 4. An unreadable history must never be replaced (PR 5 correction)
// ---------------------------------------------------------------------------

const KEY = "mototrack.sessions.v1";

// Three real sessions already on the device.
function seedHistory(a, n = 3) {
  const list = [];
  for (let i = 1; i <= n; i += 1) {
    list.push({ id: "s_old_" + i, savedAt: "2026-09-2" + i + "T10:00:00.000Z",
      setup: { bike: "Bike " + i, track: "Track " + i, sessionLabel: "Session " + i } });
  }
  a.storage.setItem(KEY, JSON.stringify(list));
  return a.storage.getItem(KEY);
}

const CORRUPT = [
  ["truncated JSON", '[{"id":"s_old_1","setup":{'],
  ["not JSON at all", "corrupted-by-something-else"],
  ["an object, not a list", '{"id":"s_old_1"}'],
  ["a list of non-records", '["s_old_1","s_old_2"]'],
  ["a list containing null", '[{"id":"s_old_1"},null]'],
];

for (const [label, raw] of CORRUPT) {
  test(`a save aborts and preserves the original bytes: ${label}`, () => {
    const a = setup();
    a.storage.setItem(KEY, raw);
    const before = a.storage.getItem(KEY);
    a.fillSession();
    a.go("review");
    a.el("save-session").click();
    assert.equal(a.storage.getItem(KEY), before,
      "the stored bytes are byte-for-byte what they were");
    assert.match(status(a), /Not saved/, "and the rider is told it did not save");
    assert.ok(!/Saved on this device/.test(status(a)), "Saved was never claimed");
  });
}

test("a save onto an unreadable history leaves three existing sessions intact", () => {
  const a = setup();
  seedHistory(a, 3);
  // Something else corrupts the tail of the value.
  const good = a.storage.getItem(KEY);
  a.storage.setItem(KEY, good.slice(0, good.length - 12));
  const before = a.storage.getItem(KEY);

  a.fillSession();
  a.go("review");
  a.el("save-session").click();

  assert.equal(a.storage.getItem(KEY), before, "nothing was written");
  // And the three sessions are still recoverable from those bytes.
  assert.ok(before.indexOf("s_old_1") !== -1, "session 1 still present");
  assert.ok(before.indexOf("s_old_2") !== -1, "session 2 still present");
  assert.ok(before.indexOf("s_old_3") !== -1, "session 3 still present");
});

test("a readable history with existing sessions still saves, and keeps them", () => {
  const a = setup();
  seedHistory(a, 3);
  a.fillSession();
  a.go("review");
  a.el("save-session").click();
  const all = a.saved();
  assert.equal(all.length, 4, "the new session joined the three that were there");
  for (const id of ["s_old_1", "s_old_2", "s_old_3"]) {
    assert.equal(all.filter((s) => s.id === id).length, 1, `${id} survived`);
  }
  assert.match(status(a), /Saved on this device/);
});

test("an absent key is genuinely empty history and saves normally", () => {
  const a = setup();
  a.storage.removeItem(KEY);
  a.fillSession();
  a.go("review");
  a.el("save-session").click();
  assert.equal(a.saved().length, 1);
  assert.match(status(a), /Saved on this device/);
});

test("deleting against an unreadable history changes nothing", () => {
  const a = setup();
  seedHistory(a, 3);
  const record = a.saved()[0];
  // The corruption has to be one the DISPLAY read survives, or the handler
  // never finds the record and never reaches Store.remove - which is how an
  // earlier version of this test passed without exercising anything. A null
  // entry is skipped by readAll() and rejected by readAllForWrite().
  const list = JSON.parse(a.storage.getItem(KEY));
  list.push(null);
  a.storage.setItem(KEY, JSON.stringify(list));
  const before = a.storage.getItem(KEY);
  assert.equal(a.win.Store.readAll().length, 3, "the display read still sees the three records");
  a.win.alert = () => {};
  const btn = a.dom.makeEl("", "BUTTON");
  btn.dataset.action = "delete";
  btn.dataset.id = record.id;
  a.el("history-list").appendChild(btn);
  btn.click();
  assert.equal(a.storage.getItem(KEY), before, "the bytes are untouched");
});

test("importing onto an unreadable history is refused, not merged", () => {
  const a = setup();
  a.storage.setItem(KEY, "not-json-at-all");
  const before = a.storage.getItem(KEY);
  const res = a.win.Store.importPayload({ sessions: [{ id: "s_new_1" }] });
  assert.equal(res.ok, false, "refused");
  assert.equal(a.storage.getItem(KEY), before, "and nothing was written");
});

test("the strict read tells an absent history from an unreadable one", () => {
  const a = setup();
  a.storage.removeItem(KEY);
  assert.deepEqual(a.win.Store.readAllForWrite(), [], "absent means empty");
  a.storage.setItem(KEY, "[]");
  assert.deepEqual(a.win.Store.readAllForWrite(), [], "an empty list means empty");
  a.storage.setItem(KEY, "{broken");
  assert.throws(() => a.win.Store.readAllForWrite(), /history-unreadable/,
    "unreadable throws rather than answering empty");
});

// ---------------------------------------------------------------------------
// 5. The status must follow content back to empty (PR 5 correction)
// ---------------------------------------------------------------------------

test("NOTES: typing feedback and then clearing it returns the status to nothing", () => {
  const a = setup();
  a.go("notes");
  a.type("rider-feedback", "Front pushed on entry.");
  assert.equal(statusHidden(a), false, "there is something to report");
  assert.match(status(a), /Not saved yet/);

  a.type("rider-feedback", "");
  assert.equal(statusHidden(a), true, "cleared back to nothing, so the line goes away");
  assert.equal(status(a), "", "and leaves no stale text");
});

test("NOTES: checking a tag and then unchecking it returns the status to nothing", () => {
  const a = setup();
  a.go("notes");
  const tag = a.dom.makeEl("", "INPUT");
  tag.value = "corner_entry";
  a.el("feedback-tags").appendChild(tag);

  tag.checked = true;
  tag.dispatchEvent(new a.win.Event("change"));
  assert.equal(statusHidden(a), false, "a tag on its own is content");
  assert.match(status(a), /Not saved yet/);

  tag.checked = false;
  tag.dispatchEvent(new a.win.Event("change"));
  assert.equal(statusHidden(a), true, "unchecking the last tag empties the session");
  assert.equal(status(a), "");
});

test("the status follows content back to empty on every stage, not only DAY", () => {
  for (const stage of ["day", "pre", "post", "laps", "notes", "review"]) {
    const a = setup();
    a.go(stage);
    a.type("bike", "Panigale V4 #21");
    assert.equal(statusHidden(a), false, `${stage}: reports unsaved content`);
    a.type("bike", "");
    assert.equal(statusHidden(a), true, `${stage}: follows it back to empty`);
  }
});

test("unchanged status text is not rewritten, so a live region is not re-announced", () => {
  const a = setup();
  a.type("bike", "Panigale V4 #21");
  const el = a.el("save-status-text");
  let writes = 0;
  let text = el.textContent;
  Object.defineProperty(el, "textContent", {
    get: () => text,
    set: (v) => { writes += 1; text = v; },
    configurable: true,
  });
  for (const v of ["Panigale V4 #21 a", "Panigale V4 #21 ab", "Panigale V4 #21 abc"]) {
    a.type("bike", v);
  }
  assert.equal(writes, 0, "the status said the same thing, so it was not rewritten");
});

// ---------------------------------------------------------------------------
// 6. The backup path itself (PR 5 correction)
//
// The save path tells riders to export when their history cannot be read, so
// export has to be honest about what it can and cannot do.
// ---------------------------------------------------------------------------

const exportBtn = (a) => a.el("export-history");

test("a healthy history exports a complete backup", () => {
  const a = setup();
  seedHistory(a, 3);
  const before = a.storage.getItem(KEY);
  exportBtn(a).click();
  assert.equal(a.downloads.length, 1, "one file");
  const file = a.downloads[0];
  assert.match(file.name, /^mototrack-\d{4}-\d{2}-\d{2}\.json$/, "a normal backup name");
  const payload = JSON.parse(file.text);
  assert.equal(payload.sessions.length, 3, "every session is in it");
  assert.equal(a.storage.getItem(KEY), before, "storage untouched");
});

test("malformed history NEVER exports as an empty backup", () => {
  const a = setup();
  a.storage.setItem(KEY, '[{"id":"s_old_1","setup":{');
  const before = a.storage.getItem(KEY);
  exportBtn(a).click();
  const normal = a.downloads.filter((d) => /^mototrack-\d{4}-\d{2}-\d{2}\.json$/.test(d.name || ""));
  assert.equal(normal.length, 0, "no file pretending to be a backup");
  assert.ok(!a.dialogs.alerts.some((m) => /no saved sessions to export/i.test(m)),
    "and it does not claim the device is empty when it is not");
  assert.equal(a.storage.getItem(KEY), before, "storage untouched");
});

test("malformed but readable text offers a labelled recovery copy, byte for byte", () => {
  const a = setup();
  const RAW = '[{"id":"s_old_1","setup":{"bike":"Panigale"}},{"id":"s_old_2",BROKEN';
  a.storage.setItem(KEY, RAW);
  exportBtn(a).click();
  assert.equal(a.downloads.length, 1, "a file was offered");
  const file = a.downloads[0];
  assert.equal(file.text, RAW, "the ORIGINAL text, exactly, not re-serialised");
  assert.match(file.name, /RECOVERY/, "named so it cannot be mistaken for a backup");
  assert.ok(!/\.json$/.test(file.name), "and not named like an importable backup");
  assert.equal(a.storage.getItem(KEY), RAW, "storage untouched");
});

test("MIXED valid and invalid entries do not export a silent partial backup", () => {
  const a = setup();
  const good = { id: "s_old_1", savedAt: "2026-09-21T10:00:00.000Z", setup: { bike: "Panigale" } };
  const RAW = JSON.stringify([good, null, "junk", { id: "s_old_2", setup: { bike: "RSV4" } }]);
  a.storage.setItem(KEY, RAW);
  exportBtn(a).click();
  const file = a.downloads[0];
  assert.ok(file, "something was offered");
  assert.match(file.name, /RECOVERY/, "as a recovery copy, not a backup");
  assert.equal(file.text, RAW, "preserving ALL of it, including the entries it cannot read");
  // The partial-backup failure this guards against:
  assert.ok(!/^mototrack-\d{4}-\d{2}-\d{2}\.json$/.test(file.name),
    "a partial list must never be handed over as a normal backup");
  assert.equal(a.storage.getItem(KEY), RAW, "storage untouched");
});

test("the recovery copy explains it preserves a copy and repairs nothing", () => {
  const a = setup();
  a.storage.setItem(KEY, "{broken");
  exportBtn(a).click();
  const said = a.dialogs.alerts.concat(a.dialogs.confirms).join("\n");
  assert.match(said, /NOT a usable backup|not a usable backup/, "says it is not a backup");
  assert.match(said, /does not repair/i, "says it does not repair the history");
  assert.match(said, /does not let saving work again|make saving work again/i,
    "and says it does not unblock saving");
});

test("declining the recovery download writes no file", () => {
  const a = setup();
  a.storage.setItem(KEY, "{broken");
  a.dialogs.confirmAnswer = false;
  exportBtn(a).click();
  assert.equal(a.downloads.length, 0, "nothing downloaded");
});

test("a read exception reports recovery FAILED and creates no file", () => {
  const a = setup();
  seedHistory(a, 2);
  const before = a.storage.getItem(KEY);
  // Storage refuses to hand the text over at all.
  const realGet = a.storage.getItem.bind(a.storage);
  a.storage.getItem = (k) => { if (k === KEY) throw new Error("SecurityError"); return realGet(k); };
  exportBtn(a).click();
  assert.equal(a.downloads.length, 0, "no file was created");
  const said = a.dialogs.alerts.join("\n");
  assert.match(said, /Recovery failed/i, "it says recovery failed");
  assert.match(said, /no backup exists/i, "and does not claim a backup exists");
  a.storage.getItem = realGet;
  assert.equal(a.storage.getItem(KEY), before, "storage untouched");
});

test("an empty device still says there is nothing to export", () => {
  const a = setup();
  a.storage.removeItem(KEY);
  exportBtn(a).click();
  assert.equal(a.downloads.length, 0);
  assert.ok(a.dialogs.alerts.some((m) => /no saved sessions to export/i.test(m)),
    "which is true here, unlike the malformed case");
});

test("the save-failure message points at what export actually offers", () => {
  const a = setup();
  a.storage.setItem(KEY, "{broken");
  a.fillSession();
  a.go("review");
  a.el("save-session").click();
  const msg = a.el("save-result").innerHTML;
  assert.match(msg, /recovery copy/i, "it offers a recovery copy, not a backup");
  assert.match(msg, /does not repair/i, "and is clear that it repairs nothing");
});
