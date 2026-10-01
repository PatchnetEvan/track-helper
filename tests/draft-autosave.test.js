import assert from "node:assert/strict";
import test from "node:test";
import { bootApp } from "./helpers/boot-app.js";

// PR 6: opt-in autosave and refresh recovery, driven through the real
// public/app.js with a captured clock so the debounce and cancellation
// boundaries are exercised rather than assumed.
//
// Assertions are on primitives only - never on a stub DOM node.

const SESSIONS = "mototrack.sessions.v1";
const DRAFT = "mototrack.draft.v1";
const AUTOSAVE = "mototrack.autosave";

function setup({ autosave = true, storage = null } = {}) {
  const app = bootApp({ storage });
  const { document, win } = app;
  if (autosave) app.storage.setItem(AUTOSAVE, "true");
  const type = (id, value) => {
    const el = document.getElementById(id);
    el.tagName = "INPUT";
    el.value = value;
    el.dispatchEvent(new win.Event("input"));
  };
  const el = (id) => document.getElementById(id);
  const status = () => document.getElementById("save-status-text").textContent;
  const draft = () => {
    const raw = app.storage.getItem(DRAFT);
    return raw === null ? null : JSON.parse(raw);
  };
  const saved = () => JSON.parse(app.storage.getItem(SESSIONS) || "[]");
  const fill = () => { type("bike", "Panigale V4 #21"); type("track", "Barber"); type("session-label", "Session 2"); };
  return { ...app, type, el, status, draft, saved, fill, go: (s) => app.stageCells[s].click() };
}

// A fresh app on the SAME storage, as a refresh would be.
function reload(a) {
  const next = bootApp({ storage: a.storage });
  next.type = (id, value) => {
    const el = next.document.getElementById(id);
    el.tagName = "INPUT"; el.value = value;
    el.dispatchEvent(new next.win.Event("input"));
  };
  next.el = (id) => next.document.getElementById(id);
  next.status = () => next.document.getElementById("save-status-text").textContent;
  next.draft = () => { const r = next.storage.getItem(DRAFT); return r === null ? null : JSON.parse(r); };
  next.saved = () => JSON.parse(next.storage.getItem(SESSIONS) || "[]");
  next.go = (s) => next.stageCells[s].click();
  return next;
}

// ---------------------------------------------------------------------------
// 1. "Kept" is a claim about the CURRENT revision
// ---------------------------------------------------------------------------

test("during the debounce the status does not claim the draft is kept", () => {
  const a = setup();
  a.el("autosave-switch").click();
  a.fill();
  assert.equal(a.clock.pending(), 1, "a write is scheduled, not immediate");
  assert.match(a.status(), /Keeping draft/, a.status());
  assert.ok(!/draft kept/.test(a.status()), "nothing is claimed kept yet");
  assert.equal(a.draft(), null, "and nothing is on disk yet");
  a.clock.flush();
  assert.match(a.status(), /draft kept on this device/);
  assert.ok(a.draft(), "now it is on disk");
});

test("a previous success never speaks for later edits", () => {
  const a = setup();
  a.el("autosave-switch").click();
  a.fill();
  a.clock.flush();
  assert.match(a.status(), /draft kept/, "revision 1 is kept");
  const keptBike = a.draft().session.setup.bike;

  a.type("bike", "RSV4 #7");                // a newer edit, not yet written
  assert.match(a.status(), /Keeping draft/, "the status steps back to keeping");
  assert.equal(a.draft().session.setup.bike, keptBike, "disk still holds the old revision");
  a.clock.flush();
  assert.match(a.status(), /draft kept/);
  assert.equal(a.draft().session.setup.bike, "RSV4 #7");
});

test("each keystroke restarts the debounce, so one write covers them all", () => {
  const a = setup();
  a.el("autosave-switch").click();
  a.type("bike", "P");
  a.type("bike", "Pa");
  a.type("bike", "Pan");
  assert.equal(a.clock.pending(), 1, "one timer, not three");
  a.clock.flush();
  assert.equal(a.draft().session.setup.bike, "Pan", "the latest text is what landed");
});

// ---------------------------------------------------------------------------
// 2. Pending writes are cancelled before the actions that discard or move on
// ---------------------------------------------------------------------------

test("Reset cancels a pending write; no timer recreates the discarded draft", () => {
  const a = setup();
  a.el("autosave-switch").click();
  a.fill();
  a.clock.flush();
  assert.ok(a.draft(), "a draft exists");
  a.type("bike", "changed again");          // schedules another write
  assert.equal(a.clock.pending(), 1);
  a.win.confirm = () => true;
  a.el("reset-all").click();
  assert.equal(a.clock.pending(), 0, "the timer was cancelled");
  assert.equal(a.draft(), null, "the draft is gone");
  a.clock.flush();
  assert.equal(a.draft(), null, "and nothing brought it back");
});

test("Save cancels a pending write and the draft does not outlive the save", () => {
  const a = setup();
  a.el("autosave-switch").click();
  a.fill();
  a.clock.flush();
  a.type("front-pre", "30.5");
  assert.equal(a.clock.pending(), 1);
  a.go("review");
  a.el("save-session").click();
  assert.equal(a.saved().length, 1, "the session saved");
  assert.equal(a.clock.pending(), 0, "the pending draft write was cancelled");
  assert.equal(a.draft(), null, "and the draft was retired");
  a.clock.flush();
  assert.equal(a.draft(), null, "no timer resurrected it");
});

test("Save & next cancels first, so the old session never lands on the next one", () => {
  const a = setup();
  a.el("autosave-switch").click();
  a.fill();
  a.type("front-pre", "30.5");
  a.clock.flush();
  a.go("review");
  a.type("rear-pre", "28.0");              // schedules a write of the OLD session
  assert.equal(a.clock.pending(), 1);
  a.el("save-and-next").click();
  a.clock.flush();                          // any stale timer would fire here
  const d = a.draft();
  if (d) {
    assert.equal(d.session.tires.frontPre, "", "the next session's draft is not the old one");
    assert.equal(d.session.tires.rearPre, "");
  }
  assert.equal(a.saved().length, 1, "exactly one record");
});

test("Copy to form cancels first and starts a draft for the copy", () => {
  const a = setup();
  a.el("autosave-switch").click();
  a.fill();
  a.go("review");
  a.el("save-session").click();
  const record = a.saved()[0];
  a.win.confirm = () => true;
  const btn = a.dom.makeEl("", "BUTTON");
  btn.dataset.action = "load"; btn.dataset.id = record.id;
  a.el("history-list").appendChild(btn);
  btn.click();
  a.clock.flush();
  const d = a.draft();
  assert.ok(d, "the copy is kept as a draft");
  assert.equal(d.savedAs, null, "and it is not marked as already saved");
  assert.match(a.status(), /draft kept|Keeping draft/);
});

test("turning auto-save off cancels pending writes and discards the draft", () => {
  const a = setup();
  a.el("autosave-switch").click();
  a.fill();
  a.clock.flush();
  assert.ok(a.draft());
  a.type("bike", "one more edit");
  a.win.confirm = () => true;
  a.el("autosave-switch").click();          // off
  assert.equal(a.draft(), null, "discarded");
  assert.equal(a.clock.pending(), 0, "and nothing pending");
  a.clock.flush();
  assert.equal(a.draft(), null, "nothing recreated it");
  assert.equal(a.storage.getItem(AUTOSAVE), "false");
});

// ---------------------------------------------------------------------------
// 3. A draft that could not be deleted must not come back as unsaved work
// ---------------------------------------------------------------------------

test("a successful save stays successful when the draft cannot be cleared", () => {
  const a = setup();
  a.el("autosave-switch").click();
  a.fill(); a.type("front-pre", "30.5");
  a.clock.flush();
  // removeItem silently does nothing: the draft survives the save.
  a.storage.removeItem = () => {};
  a.go("review");
  a.el("save-session").click();
  assert.equal(a.saved().length, 1, "the save still succeeded");
  assert.match(a.status(), /Saved on this device/, "and is reported as successful");
  const d = a.draft();
  assert.ok(d, "the draft is still there");
  assert.equal(d.savedAs, a.saved()[0].id, "but stamped with the record it became");
});

test("a left-behind draft is reconciled on reload, not restored as new work", () => {
  const a = setup();
  a.el("autosave-switch").click();
  a.fill(); a.type("front-pre", "30.5");
  a.clock.flush();
  a.storage.removeItem = () => {};
  a.go("review");
  a.el("save-session").click();
  const savedId = a.saved()[0].id;
  assert.ok(a.draft(), "the draft outlived the save");

  const b = reload(a);
  assert.equal(b.el("bike").value, "", "nothing was restored into the form");
  assert.equal(b.saved().length, 1, "and no second session appeared");
  assert.equal(b.saved()[0].id, savedId);
});

// ---------------------------------------------------------------------------
// 4. Pending save identity survives a refresh, so a retry reconciles
// ---------------------------------------------------------------------------

test("write succeeded, verification failed, refresh, restore, retry: ONE record", () => {
  const a = setup();
  a.el("autosave-switch").click();
  a.fill(); a.type("front-pre", "30.5");
  a.clock.flush();

  // The session write lands but cannot be verified.
  const realFind = a.win.Store.findById;
  a.win.Store.findById = () => null;
  a.go("review");
  a.el("save-session").click();
  assert.equal(a.saved().length, 1, "the record DID land");
  assert.match(a.status(), /Not saved/, "but Saved was not claimed");
  const pendingId = a.saved()[0].id;
  a.win.Store.findById = realFind;
  // The draft must have kept that identity.
  a.type("front-pre", "30.5");
  a.clock.flush();
  assert.equal(a.draft().pendingId, pendingId, "the draft carries the pending id");

  const b = reload(a);
  assert.equal(b.el("front-pre").value, "30.5", "the draft was restored");
  b.go("review");
  b.el("save-session").click();
  const all = b.saved();
  assert.equal(all.length, 1, "exactly one saved record, not two");
  assert.equal(all[0].id, pendingId, "the retry reused the pending id");
  assert.equal(all[0].setup.bike, "Panigale V4 #21", "with matching content");
  assert.match(b.status(), /Saved on this device/);
});

// ---------------------------------------------------------------------------
// 5. The whole draft shape is validated before anything is restored
// ---------------------------------------------------------------------------

const INVALID = [
  ["not JSON", "{broken"],
  ["not a record", '"a string"'],
  ["unsupported version", JSON.stringify({ v: 99, rev: 1, writer: "t", updatedAt: "x", stage: { name: "day", postUnlocked: false, preEditable: true }, pendingId: null, savedAs: null, session: { setup: {}, tires: {}, suspension: {}, laps: {}, riderFeedback: {} } })],
  ["missing stage", JSON.stringify({ v: 1, rev: 1, writer: "t", updatedAt: "x", pendingId: null, savedAs: null, session: { setup: {}, tires: {}, suspension: {}, laps: {}, riderFeedback: {} } })],
  ["stage flags not boolean", JSON.stringify({ v: 1, rev: 1, writer: "t", updatedAt: "x", stage: { name: "day", postUnlocked: "yes", preEditable: true }, pendingId: null, savedAs: null, session: { setup: {}, tires: {}, suspension: {}, laps: {}, riderFeedback: {} } })],
  ["session missing a part", JSON.stringify({ v: 1, rev: 1, writer: "t", updatedAt: "x", stage: { name: "day", postUnlocked: false, preEditable: true }, pendingId: null, savedAs: null, session: { setup: {}, tires: {}, laps: {}, riderFeedback: {} } })],
];

for (const [label, raw] of INVALID) {
  test(`an invalid draft is left untouched and never restored: ${label}`, () => {
    const a = setup({ autosave: false });
    a.storage.setItem(AUTOSAVE, "true");
    a.storage.setItem(DRAFT, raw);
    const before = a.storage.getItem(DRAFT);
    const b = reload(a);
    assert.equal(b.el("bike").value, "", "nothing was restored");
    assert.equal(b.storage.getItem(DRAFT), before, "the bytes are exactly as they were");
    // And typing must not overwrite it.
    b.type("bike", "Panigale");
    b.clock.flush();
    assert.equal(b.storage.getItem(DRAFT), before, "writing stays suspended over it");
    assert.match(b.status(), /could not be read/, b.status());
  });
}

test("the recovery copy of an unreadable draft is the original bytes", () => {
  const a = setup({ autosave: false });
  a.storage.setItem(AUTOSAVE, "true");
  const RAW = '{"v":1,"rev":3,BROKEN';
  a.storage.setItem(DRAFT, RAW);
  const b = reload(a);
  b.win.confirm = () => false;              // download, but do not discard
  b.document.getElementById("draft-recovery").click();
  const file = b.downloads[b.downloads.length - 1];
  assert.ok(file, "a file was offered");
  assert.equal(file.text, RAW, "byte for byte");
  assert.match(file.name, /DRAFT-RECOVERY-UNREADABLE/);
  assert.equal(b.storage.getItem(DRAFT), RAW, "and the draft is still untouched");
});

// ---------------------------------------------------------------------------
// 6. Two tabs must not overwrite each other
// ---------------------------------------------------------------------------

test("a second tab does not overwrite the first tab's newer draft", () => {
  const a = setup();
  a.el("autosave-switch").click();
  a.fill();
  a.clock.flush();
  const firstRev = a.draft().rev;

  // A second tab on the same storage, which loads the draft and then writes.
  const b = reload(a);
  b.type("bike", "Second tab bike");
  b.clock.flush();
  assert.ok(b.draft().rev > firstRev, "the second tab moved the revision on");

  // The first tab, still holding the old revision, now tries to write.
  a.type("track", "First tab track");
  a.clock.flush();
  const onDisk = a.draft();
  assert.equal(onDisk.session.setup.bike, "Second tab bike",
    "the other tab's work is preserved");
  assert.ok(!/draft kept on this device/.test(a.status()),
    "and this tab does not claim its edits are kept");
  assert.match(a.status(), /another tab/, a.status());
});

// ---------------------------------------------------------------------------
// Restoring stage state, and key separation
// ---------------------------------------------------------------------------

test("POST eligibility and PRE editability are restored exactly as recorded", () => {
  const a = setup();
  a.el("autosave-switch").click();
  a.fill();
  a.go("pre");
  a.el("dock-advance").click();             // Back in -> POST
  assert.equal(a.el("front-pre").readOnly, true, "PRE locked after going back in");
  a.clock.flush();
  const d = a.draft();
  assert.equal(d.stage.postUnlocked, true);
  assert.equal(d.stage.preEditable, false);

  const b = reload(a);
  assert.equal(b.el("front-pre").readOnly, true, "PRE is read-only again");
  const post = b.document.querySelector('.stage[data-tab="post"]');
  assert.equal(post.classList.contains("is-locked"), false, "POST is open again");
  post.click();
  assert.equal(b.document.querySelector('.stage[aria-selected="true"]').dataset.tab, "post",
    "and navigating to it works");
});

test("a reopened PRE is restored as reopened, with POST still open", () => {
  const a = setup();
  a.el("autosave-switch").click();
  a.fill();
  a.go("pre");
  a.el("dock-advance").click();             // POST unlocked, PRE locked
  a.el("correct-pre").click();              // PRE reopened, POST stays open
  a.clock.flush();
  const d = a.draft();
  assert.equal(d.stage.postUnlocked, true);
  assert.equal(d.stage.preEditable, true);

  const b = reload(a);
  assert.equal(b.el("front-pre").readOnly, false, "PRE is editable again");
  assert.equal(b.document.querySelector('.stage[data-tab="post"]').classList.contains("is-locked"), false,
    "and POST did not re-lock");
});

test("the draft path never touches the saved-session key", () => {
  const a = setup();
  a.storage.setItem(SESSIONS, JSON.stringify([{ id: "s_keep", savedAt: "2026-09-21T10:00:00.000Z", setup: { bike: "A" } }]));
  const before = a.storage.getItem(SESSIONS);
  a.el("autosave-switch").click();
  a.fill();
  a.clock.flush();
  a.type("bike", "again"); a.clock.flush();
  a.win.confirm = () => true;
  a.el("autosave-switch").click();          // off: discards the draft
  assert.equal(a.storage.getItem(SESSIONS), before,
    "saved history is byte-for-byte untouched by every draft operation");
});

test("with auto-save off nothing is written and a refresh clears the form", () => {
  const a = setup({ autosave: false });
  a.fill();
  a.clock.flush();
  assert.equal(a.draft(), null, "no draft is kept");
  assert.match(a.status(), /REVIEW saves it/, "and the status says so");
  const b = reload(a);
  assert.equal(b.el("bike").value, "", "a refresh clears the form, as before");
});

test("a draft write failure is reported and never claimed as kept", () => {
  const a = setup();
  a.el("autosave-switch").click();
  a.fill();
  a.storage.setItem = () => {};             // silently stores nothing
  a.type("bike", "will not land");
  a.clock.flush();
  assert.match(a.status(), /draft could not be kept/, a.status());
  assert.ok(!/draft kept on this device/.test(a.status()));
});

// ---------------------------------------------------------------------------
// Boundary cases the first round of mutants survived
// ---------------------------------------------------------------------------

test("an edit made DURING the write is not covered by that write", () => {
  const a = setup();
  a.el("autosave-switch").click();
  a.fill();
  // Type again at the moment the write happens: the revision going to disk is
  // already stale, so the status must not report it as kept.
  const realWrite = a.win.Store.writeDraft;
  let typedDuring = false;
  a.win.Store.writeDraft = function (draft, expectedRev) {
    const r = realWrite.call(this, draft, expectedRev);
    if (!typedDuring) { typedDuring = true; a.type("bike", "typed mid-write"); }
    return r;
  };
  a.clock.flush();
  a.win.Store.writeDraft = realWrite;
  assert.equal(typedDuring, true, "the interleaving actually happened");
  assert.match(a.status(), /Keeping draft/,
    "the later edit is outstanding, so nothing is claimed kept");
  assert.ok(!/draft kept on this device/.test(a.status()));
});

test("while the stored draft is unreadable, no write is even scheduled", () => {
  const a = setup({ autosave: false });
  a.storage.setItem(AUTOSAVE, "true");
  a.storage.setItem(DRAFT, "{broken");
  const b = reload(a);
  const before = b.storage.getItem(DRAFT);
  b.type("bike", "Panigale");
  assert.equal(b.clock.pending(), 0,
    "writing is suspended, so not even a timer is started over it");
  b.clock.flush();
  assert.equal(b.storage.getItem(DRAFT), before, "and the bytes are untouched");
});

test("no timer is left pending after Save & next", () => {
  const a = setup();
  a.el("autosave-switch").click();
  a.fill();
  a.type("front-pre", "30.5");
  a.go("review");
  a.type("rear-pre", "28.0");
  assert.equal(a.clock.pending(), 1, "a write is outstanding");
  a.el("save-and-next").click();
  assert.equal(a.clock.pending(), 0, "and it is gone before the next session begins");
});
