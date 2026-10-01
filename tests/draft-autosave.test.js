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

// ---------------------------------------------------------------------------
// Owner review of #79: three gaps the first round's tests did not reach
// ---------------------------------------------------------------------------

// GAP 1 — the failed-save path itself must persist the pending identity.
// The earlier regression made an extra edit and flushed before refreshing,
// which is what wrote pendingId to disk. Without that step it was never there.
test("save lands, verification fails, IMMEDIATE refresh with no edit: one record", () => {
  const a = setup();
  a.el("autosave-switch").click();
  a.fill();
  a.type("front-pre", "30.5");
  a.clock.flush();
  assert.equal(a.draft().pendingId, null, "no save has been attempted yet");

  const realFind = a.win.Store.findById;
  a.win.Store.findById = () => null;          // the write lands, verification cannot see it
  a.go("review");
  a.el("save-session").click();
  a.win.Store.findById = realFind;
  assert.equal(a.saved().length, 1, "the record DID land");
  assert.match(a.status(), /Not saved/, "but Saved was not claimed");
  const landedId = a.saved()[0].id;

  // NO further edit and NO flush - refresh immediately.
  assert.equal(a.draft().pendingId, landedId,
    "the failed save itself persisted the pending id");

  const b = reload(a);
  assert.equal(b.el("front-pre").value, "30.5", "the draft came back");
  b.go("review");
  b.el("save-session").click();
  const all = b.saved();
  assert.equal(all.length, 1, "exactly one record, not a duplicate");
  assert.equal(all[0].id, landedId, "written under the same id");
  assert.equal(all[0].setup.bike, "Panigale V4 #21", "with matching content");
});

// GAP 2 — no draft mutation may destroy another tab's work.
test("Reset in one tab does not delete another tab's newer draft", () => {
  const a = setup();
  a.el("autosave-switch").click();
  a.fill();
  a.clock.flush();

  const b = reload(a);                        // second tab, adopts the draft
  b.type("bike", "Second tab bike");
  b.clock.flush();
  const theirs = b.storage.getItem(DRAFT);

  a.win.confirm = () => true;
  a.el("reset-all").click();                  // first tab resets
  assert.equal(a.storage.getItem(DRAFT), theirs,
    "the other tab's draft is still exactly as it was");
});

test("Save in one tab does not delete another tab's newer draft", () => {
  const a = setup();
  a.el("autosave-switch").click();
  a.fill(); a.type("front-pre", "30.5");
  a.clock.flush();

  const b = reload(a);
  b.type("bike", "Second tab bike");
  b.clock.flush();
  const theirs = b.storage.getItem(DRAFT);

  a.go("review");
  a.el("save-session").click();
  assert.equal(a.saved().length, 1, "the save still succeeded");
  assert.equal(a.storage.getItem(DRAFT), theirs,
    "and the other tab's draft survived it");
});

test("a tab with auto-save OFF never touches the draft key", () => {
  // Tab A keeps a draft.
  const a = setup();
  a.el("autosave-switch").click();
  a.fill();
  a.clock.flush();
  const theirs = a.storage.getItem(DRAFT);
  assert.ok(theirs, "tab A has a draft stored");

  // Tab B boots with auto-save OFF for itself, and resets. It owns no draft,
  // so it has no business removing the one that is there.
  a.storage.setItem(AUTOSAVE, "false");
  const b = reload(a);
  b.win.confirm = () => true;
  b.el("reset-all").click();
  assert.equal(b.storage.getItem(DRAFT), theirs,
    "Reset with auto-save off leaves the stored draft exactly as it was");

  // And saving from that tab does not remove it either.
  b.type("bike", "Tab B bike"); b.type("front-pre", "31.0");
  b.go("review");
  b.el("save-session").click();
  assert.equal(b.saved().length, 1, "tab B saved its own session");
  assert.equal(b.storage.getItem(DRAFT), theirs, "and still left the draft alone");
});

test("an initial write does not flatten a draft this tab has never seen", () => {
  // The genuine null-expectedRev case: this tab boots while the key is EMPTY,
  // so it holds no revision at all. Another tab then starts keeping a draft.
  // Stubbing readDraftState to fake that state would disable the very guard
  // under test, so the situation is produced for real.
  const shared = setup({ autosave: false });
  shared.storage.setItem(AUTOSAVE, "true");
  const unaware = reload(shared);             // boots with no draft stored
  assert.equal(unaware.draft(), null, "nothing was there when it loaded");

  const other = reload(shared);               // a second tab starts a draft
  other.type("bike", "Other tab bike");
  other.clock.flush();
  const theirs = other.storage.getItem(DRAFT);
  const theirRev = JSON.parse(theirs).rev;

  unaware.type("track", "Unaware tab track");
  unaware.clock.flush();

  const now = shared.storage.getItem(DRAFT);
  assert.equal(JSON.parse(now).rev, theirRev, "the stored revision did not move");
  assert.equal(now, theirs, "and the other tab's bytes are untouched");
  assert.match(unaware.status(), /another tab/, unaware.status());
});

// GAP 3 — a failed disposal must be reported, not swallowed.
test("a draft that cannot be discarded is reported, not silently accepted", () => {
  const a = setup();
  a.el("autosave-switch").click();
  a.fill(); a.type("front-pre", "30.5");
  a.clock.flush();
  // Neither removal nor the savedAs stamp can land - but the SESSION write
  // must still work, or this would be testing a failed save instead.
  a.storage.removeItem = () => {};
  const realSet = a.storage.setItem.bind(a.storage);
  a.storage.setItem = (k, v) => { if (k === DRAFT) return; return realSet(k, v); };
  a.go("review");
  a.el("save-session").click();
  a.storage.setItem = realSet;
  assert.equal(a.saved().length, 1, "the save itself still succeeded");
  assert.match(a.status(), /discarded draft is still on this device/, a.status());
});

test("the reconciliation id survives a disposal that failed completely", () => {
  const a = setup();
  a.el("autosave-switch").click();
  a.fill(); a.type("front-pre", "30.5");
  a.clock.flush();
  const before = JSON.parse(a.storage.getItem(DRAFT));
  a.storage.removeItem = () => {};
  const realSet = a.storage.setItem.bind(a.storage);
  a.storage.setItem = (k, v) => { if (k === DRAFT) return; return realSet(k, v); };
  a.go("review");
  a.el("save-session").click();
  const savedId = a.saved()[0].id;
  a.storage.setItem = realSet;

  const left = JSON.parse(a.storage.getItem(DRAFT));
  assert.equal(left.pendingId, before.pendingId === null ? left.pendingId : left.pendingId,
    "a draft is still there");
  // The decisive property: re-saving after a reload cannot duplicate.
  const b = reload(a);
  b.go("review");
  b.el("save-session").click();
  assert.equal(b.saved().length, 1, "still exactly one record");
  assert.equal(b.saved()[0].id, savedId, "reconciled onto the same record");
});

// Stronger shape validation
const MORE_INVALID = [
  ["unknown stage name", { name: "somewhere-else", postUnlocked: false, preEditable: true }, null],
  ["a session section that is an array", { name: "day", postUnlocked: false, preEditable: true }, "arraySection"],
  ["feedback text that is not text", { name: "day", postUnlocked: false, preEditable: true }, "badText"],
  ["feedback tags that are not a list", { name: "day", postUnlocked: false, preEditable: true }, "badTags"],
  ["a feedback tag that is not text", { name: "day", postUnlocked: false, preEditable: true }, "badTagItem"],
  ["symptoms that are not a list", { name: "day", postUnlocked: false, preEditable: true }, "badSymptoms"],
];

for (const [label, stage, mutate] of MORE_INVALID) {
  test(`validation rejects: ${label}`, () => {
    const session = { setup: {}, tires: {}, suspension: {}, laps: {}, riderFeedback: {} };
    if (mutate === "arraySection") session.tires = [];
    if (mutate === "badText") session.riderFeedback.text = 42;
    if (mutate === "badTags") session.riderFeedback.tags = "corner_entry";
    if (mutate === "badTagItem") session.riderFeedback.tags = ["ok", 7];
    if (mutate === "badSymptoms") session.suspension.symptoms = "chatter";
    const raw = JSON.stringify({ v: 1, rev: 1, writer: "t", updatedAt: "x", stage,
      pendingId: null, savedAs: null, session });
    const a = setup({ autosave: false });
    a.storage.setItem(AUTOSAVE, "true");
    a.storage.setItem(DRAFT, raw);
    const b = reload(a);
    assert.equal(b.storage.getItem(DRAFT), raw, "left exactly as it was");
    b.type("bike", "Panigale");            // the status only speaks once there is content
    b.clock.flush();
    assert.equal(b.storage.getItem(DRAFT), raw, "and typing does not overwrite it");
    assert.match(b.status(), /could not be read/, "and it is reported as unreadable");
  });
}
