import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// PR 4: session progression. These exercise the RULES directly - the module is
// loaded and called, not grepped - so a rule that stops holding fails here even
// if the source still looks right.
//
// Assertions are on primitives only. Never assert on a stub DOM node: a failing
// deep-equal against one makes node:assert walk the whole graph.
const src = readFileSync(join(import.meta.dirname, "..", "public", "session-progress.js"), "utf8");
new Function("window", src)({});
const { nextLabelFrom, createStageState, createSaveState } = globalThis.SessionProgress;

// ---------------------------------------------------------------------------
// 1. Correcting an accidental transition
// ---------------------------------------------------------------------------

test("back in unlocks POST and locks PRE editing", () => {
  const st = createStageState();
  assert.equal(st.postUnlocked, false, "POST starts locked");
  assert.equal(st.preEditable, true, "PRE starts editable");
  st.backIn();
  assert.equal(st.postUnlocked, true);
  assert.equal(st.preEditable, false);
});

test("Correct PRE reopens PRE editing WITHOUT re-locking POST", () => {
  const st = createStageState().backIn();
  st.correctPre();
  assert.equal(st.preEditable, true, "PRE is editable again");
  assert.equal(st.postUnlocked, true, "POST stays unlocked - the rider IS back in");
  assert.equal(st.mayOpen("post"), true, "and POST stays reachable");
});

test("the two questions are independent in both directions", () => {
  const st = createStageState();
  // Correcting PRE before ever going out must not unlock POST.
  st.correctPre();
  assert.equal(st.postUnlocked, false, "correcting PRE never unlocks POST");
  assert.equal(st.mayOpen("post"), false);
  // And repeated corrections after going out never re-lock it.
  st.backIn().correctPre().correctPre();
  assert.equal(st.postUnlocked, true);
  assert.equal(st.preEditable, true);
});

test("only POST is ever gated; every other stage is navigation", () => {
  const st = createStageState();
  for (const stage of ["day", "pre", "laps", "notes", "review", "about"]) {
    assert.equal(st.mayOpen(stage), true, `${stage} is navigation only`);
  }
  assert.equal(st.mayOpen("post"), false, "POST is the one stage that can refuse");
});

test("copying a saved session never implies the rider is back in", () => {
  const st = createStageState().backIn();
  st.copyFromSaved();
  assert.equal(st.postUnlocked, false, "POST locks again for the new draft");
  assert.equal(st.preEditable, true, "PRE opens editable");
});

// ---------------------------------------------------------------------------
// 2. Save failures preserve everything
// ---------------------------------------------------------------------------

test("a failed save leaves the form dirty and saveable", () => {
  const sv = createSaveState().markDirty();
  assert.equal(sv.beginSave().start, true);
  sv.saveFailed();
  assert.equal(sv.dirty, true, "still dirty - nothing was written");
  assert.equal(sv.lastSavedId, null, "no id recorded");
  assert.equal(sv.inFlight, false, "and the guard released");
  assert.equal(sv.beginSave().start, true, "so the rider can try again");
});

test("a failed save after a successful one does not discard the earlier id", () => {
  const sv = createSaveState().markDirty();
  sv.beginSave(); sv.saveSucceeded("s_1");
  sv.markDirty();
  sv.beginSave(); sv.saveFailed();
  assert.equal(sv.lastSavedId, "s_1", "the record that did save is still known");
  assert.equal(sv.dirty, true);
});

// ---------------------------------------------------------------------------
// 3. Duplicate prevention
// ---------------------------------------------------------------------------

test("an unchanged saved form cannot be saved twice", () => {
  const sv = createSaveState().markDirty();
  sv.beginSave(); sv.saveSucceeded("s_1");
  const second = sv.beginSave();
  assert.equal(second.start, false, "refused");
  assert.equal(second.reason, "already-saved");
  assert.equal(sv.alreadySaved, true);
});

test("editing after a save makes it saveable again", () => {
  const sv = createSaveState().markDirty();
  sv.beginSave(); sv.saveSucceeded("s_1");
  sv.markDirty();
  assert.equal(sv.alreadySaved, false);
  assert.equal(sv.beginSave().start, true);
});

test("two simultaneous taps produce exactly one save", () => {
  const sv = createSaveState().markDirty();
  const a = sv.beginSave();
  const b = sv.beginSave();
  assert.equal(a.start, true, "the first tap starts a save");
  assert.equal(b.start, false, "the second does not");
  assert.equal(b.reason, "in-flight");
  sv.saveSucceeded("s_1");
  assert.equal(sv.lastSavedId, "s_1", "one record, not two");
});

test("advancing after a plain save does not write a second copy", () => {
  const sv = createSaveState().markDirty();
  sv.beginSave(); sv.saveSucceeded("s_1");
  // Save & next is tapped afterwards: the rules refuse the write...
  assert.equal(sv.beginSave().start, false, "no second write");
  // ...and the rider still advances, which resets for the next session.
  sv.advanced();
  assert.equal(sv.dirty, false, "a cleared form has nothing new yet");
  assert.equal(sv.lastSavedId, null, "and nothing saved yet either");
  assert.equal(sv.alreadySaved, false, "so the next session can be saved");
});

test("an empty new form is not treated as already saved", () => {
  const sv = createSaveState();
  assert.equal(sv.alreadySaved, false, "nothing has been saved, so nothing is blocked");
  assert.equal(sv.beginSave().start, true);
});

// ---------------------------------------------------------------------------
// 4. The next-session label: one rule for display AND for the field
// ---------------------------------------------------------------------------

test("a clean numeric bump is used", () => {
  for (const [input, expected] of [
    ["Session 2", "Session 3"],
    ["S3", "S4"],
    ["Q1 - damp", "Q2 - damp"],
    ["Session 9 (wet)", "Session 10 (wet)"],
    ["lap sim 10", "lap sim 11"],
  ]) {
    const r = nextLabelFrom(input);
    assert.equal(r.clean, true, `${input} bumps cleanly`);
    assert.equal(r.label, expected);
  }
});

test("an ordinal is never mangled", () => {
  for (const input of ["2nd outing", "1st session", "3rd run", "4th outing"]) {
    const r = nextLabelFrom(input);
    assert.equal(r.clean, false, `${input} is not a clean bump`);
    assert.equal(r.label, input, "the rider's label is returned untouched");
  }
});

test("free text and empty labels are left alone", () => {
  for (const input of ["morning warmup", "", "   ", null, undefined]) {
    const r = nextLabelFrom(input);
    assert.equal(r.clean, false);
  }
  assert.equal(nextLabelFrom("morning warmup").label, "morning warmup");
});

test("the same result drives the display and the field", () => {
  // The contract the caller relies on: when clean is false the label returned
  // is the CURRENT one, so writing it back is a no-op rather than a mangling.
  for (const input of ["morning warmup", "2nd outing", ""]) {
    const r = nextLabelFrom(input);
    assert.equal(r.label, input.trim(), "unchanged, so writing it changes nothing");
  }
});

// ---------------------------------------------------------------------------
// 5. Save status (PR 5). The line holds no state of its own, so these are the
//    rules in full: given the facts, what does it say?
// ---------------------------------------------------------------------------

const { saveStatusFor } = globalThis.SessionProgress;
const facts = (over) => Object.assign(
  { storageReady: true, failed: false, alreadySaved: false, savedAtLabel: "", hasContent: false },
  over,
);

test("an empty form with nothing saved says nothing at all", () => {
  const s = saveStatusFor(facts());
  assert.equal(s.key, "none");
  assert.equal(s.text, "");
});

test("entries that have not been saved say so", () => {
  const s = saveStatusFor(facts({ hasContent: true }));
  assert.equal(s.key, "unsaved");
  assert.match(s.text, /Not saved yet/);
});

test("Saved is claimed only with a recorded save time", () => {
  assert.equal(saveStatusFor(facts({ alreadySaved: true, savedAtLabel: "", hasContent: true })).key,
    "unsaved", "alreadySaved without a time is not enough to claim Saved");
  assert.equal(saveStatusFor(facts({ alreadySaved: true, savedAtLabel: "" })).key, "none",
    "and with nothing entered either, it says nothing");
  const s = saveStatusFor(facts({ alreadySaved: true, savedAtLabel: "17:38", hasContent: true }));
  assert.equal(s.key, "saved");
  assert.equal(s.text, "Saved on this device · 17:38");
});

test("a failed save says to try again and names no cause", () => {
  const s = saveStatusFor(facts({ failed: true, hasContent: true }));
  assert.equal(s.key, "failed");
  assert.equal(s.text, "Not saved · try Save again");
  assert.ok(!/refused|quota|full|denied|private/i.test(s.text),
    "no cause is asserted - the app cannot tell which one it was");
});

test("blocked storage outranks everything and is not a toast", () => {
  const s = saveStatusFor(facts({ storageReady: false, failed: true, alreadySaved: true, savedAtLabel: "17:38", hasContent: true }));
  assert.equal(s.key, "blocked");
  assert.match(s.text, /blocks storage/);
});

test("a failed save outranks a previous success", () => {
  const s = saveStatusFor(facts({ failed: true, alreadySaved: true, savedAtLabel: "17:38" }));
  assert.equal(s.key, "failed", "the last thing that happened is what is reported");
});

test("the status never claims a capability this app does not have", () => {
  const FORBIDDEN = /synced|syncing|cloud|backed up|back-up|uploading|uploaded|queued|queue|offline|draft saved|recovered|autosaved|auto-saved/i;
  const every = [
    facts(), facts({ hasContent: true }),
    facts({ alreadySaved: true, savedAtLabel: "17:38" }),
    facts({ failed: true }), facts({ storageReady: false }),
  ].map((f) => saveStatusFor(f).text);
  for (const text of every) {
    assert.ok(!FORBIDDEN.test(text), `status must not promise a missing capability: "${text}"`);
  }
});

test("advancing clears the saved-at time, so the next session cannot inherit Saved", () => {
  const sv = createSaveState().markDirty();
  sv.beginSave(); sv.saveSucceeded("s_1", "2026-09-30T17:38:00.000Z");
  assert.equal(sv.alreadySaved, true);
  assert.ok(sv.lastSavedAt, "a time was recorded");
  sv.advanced();
  assert.equal(sv.lastSavedAt, null, "the time went with it");
  assert.equal(sv.alreadySaved, false);
  assert.equal(saveStatusFor(facts({ alreadySaved: sv.alreadySaved, savedAtLabel: "", hasContent: true })).key,
    "unsaved", "the carried-over session reads as unsaved");
});

test("a pending id survives a failure and is reused, then cleared on success", () => {
  const sv = createSaveState().markDirty();
  let minted = 0;
  const mint = () => "s_" + (++minted);
  const first = sv.claimSaveId(mint);
  sv.beginSave(); sv.saveFailed();
  assert.equal(sv.failed, true);
  const second = sv.claimSaveId(mint);
  assert.equal(second, first, "the retry writes under the SAME id");
  assert.equal(minted, 1, "no second id was minted");
  sv.beginSave(); sv.saveSucceeded(second, "2026-09-30T17:40:00.000Z");
  assert.equal(sv.pendingId, null, "nothing pending once it is verified");
  assert.equal(sv.failed, false);
});
