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
