import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(import.meta.dirname, "..", "public", "session-progress.js"), "utf8");
new Function("window", src)({});
const S = globalThis.SessionProgress;

// ---------------------------------------------------------------------------
// Tenths
// ---------------------------------------------------------------------------

test("one tick is a tenth and 32px of drag", () => {
  assert.equal(S.PSI_STEP, 0.1);
  assert.equal(S.TICK_PX, 32);
});

test("dragging left increases the value, as the design file does it", () => {
  assert.equal(S.psiFromDrag(30.5, -32), 30.6);
  assert.equal(S.psiFromDrag(30.5, 32), 30.4);
  assert.equal(S.psiFromDrag(30.5, -64), 30.7);
});

test("a drag that has not reached the next tick changes nothing", () => {
  assert.equal(S.psiFromDrag(30.5, -8), 30.5, "a quarter of a tick");
  assert.equal(S.psiFromDrag(30.5, -15), 30.5, "just under half");
  assert.equal(S.psiFromDrag(30.5, -17), 30.6, "just over half");
});

test("tenths stay exact rather than drifting into binary noise", () => {
  let v = 30.0;
  for (let i = 0; i < 10; i += 1) v = S.psiFromDrag(v, -32);
  assert.equal(v, 31, "ten tenths make exactly one PSI");
  assert.equal(S.snapPsi(30.1 + 0.2), 30.3);
});

// ---------------------------------------------------------------------------
// The range is how far the ruler drags - not validation
// ---------------------------------------------------------------------------

test("the ruler holds its ends", () => {
  assert.equal(S.psiFromDrag(44.95, -1000), 45);
  assert.equal(S.psiFromDrag(10.05, 1000), 10);
  assert.equal(S.rulerStep("45.0", 1, null), null);
  assert.equal(S.rulerStep("10.0", -1, null), null);
});

test("a value typed outside the range is kept exactly as typed", () => {
  assert.equal(S.pressureState("48.0"), "typed-outside");
  assert.equal(S.pressureState("8.0"), "typed-outside");
  // -/+ are the way back, and they step from where the rider put it.
  assert.equal(S.rulerStep("48.0", -1, null), "47.9");
  assert.equal(S.rulerStep("48.0", 1, null), "48.1", "stepping further out is still the rider's call");
  assert.equal(S.rulerStep("8.0", 1, null), "8.1");
  // ...but dragging has no position to work from.
  assert.equal(S.rulerDraggable("48.0", "31.0"), false);
  assert.equal(S.rulerDraggable("8.0", "31.0"), false);
});

test("the note explains a typed value without judging it", () => {
  const note = S.pressureNote("48.0", true);
  assert.match(note, /^48\.0 is outside the ruler \(10–45\)\. Kept as typed\./);
  for (const word of ["high", "low", "unsafe", "too", "warning", "danger"]) {
    assert.ok(!note.toLowerCase().includes(word), `the note must not say "${word}"`);
  }
});

test("-/+ never go below zero", () => {
  assert.equal(S.rulerStep("0.0", -1, null), null);
  assert.equal(S.rulerStep("0.1", -1, null), "0.0");
});

test("text that is not a number is kept and never stepped", () => {
  for (const v of ["abc", "1e-2", "0x1A", "3,5", "--"]) {
    assert.equal(S.pressureState(v), "not-a-number");
    assert.equal(S.rulerStep(v, 1, "31.0"), null);
    assert.equal(S.rulerDraggable(v, "31.0"), false);
    assert.equal(S.pressureNote(v, true), "Type a number, for example 30.5.");
  }
});

// ---------------------------------------------------------------------------
// Blank, and blank with nothing to start from
// ---------------------------------------------------------------------------

test("blank with a reference starts from the reference, one tenth at a time", () => {
  assert.equal(S.rulerStep("", 1, "31.0"), "31.1");
  assert.equal(S.rulerStep("", -1, "31.0"), "30.9");
  assert.equal(S.rulerDraggable("", "31.0"), true);
  assert.equal(S.todayLabel(""), "Today · not measured");
});

test("blank with NO reference leaves the ruler and -/+ inactive", () => {
  // There is nothing to start from, so nothing may be invented.
  assert.equal(S.rulerStep("", 1, null), null);
  assert.equal(S.rulerStep("", -1, null), null);
  assert.equal(S.rulerStep("", 1, ""), null);
  assert.equal(S.rulerDraggable("", null), false);
  assert.equal(S.rulerDraggable("", ""), false);
  assert.equal(S.pressureNote("", false),
    "Type the whole number, then drag or use − / + to set the tenths.");
  assert.ok(!S.pressureNote("", false).includes("Not measured yet"),
    "with no reference there is nothing to contrast today against");
});

test("once a number is typed the ruler becomes usable again", () => {
  assert.equal(S.rulerDraggable("30.0", null), true, "no reference needed once there is a value");
  assert.equal(S.rulerStep("30.0", 1, null), "30.1");
});

// ---------------------------------------------------------------------------
// Vertical scrolling is not captured
// ---------------------------------------------------------------------------

test("an ordinary vertical scroll that starts on the ruler is left to the page", () => {
  assert.equal(S.shouldCaptureDrag(0, 40), false);
  assert.equal(S.shouldCaptureDrag(6, 40), false);
  assert.equal(S.shouldCaptureDrag(30, 40), false);
  assert.equal(S.shouldCaptureDrag(8, 2), false, "under the 10px intent threshold");
});

test("a clearly horizontal drag is taken over", () => {
  assert.equal(S.shouldCaptureDrag(11, 2), true);
  assert.equal(S.shouldCaptureDrag(-40, 10), true);
});

// ---------------------------------------------------------------------------
// References: history, never a measurement
// ---------------------------------------------------------------------------

const SESSIONS = [
  { savedAt: "2026-09-20T10:00:00Z", sessionLabel: "Session 1", setup: { bike: "Panigale V4 #21" },
    tires: { brand: "Pirelli", model: "SC1", frontPre: "30.0", frontPost: "33.0" } },
  { savedAt: "2026-09-27T10:00:00Z", sessionLabel: "Session 2", setup: { bike: "Panigale V4 #21" },
    tires: { brand: "Pirelli", model: "SC1", frontPre: "31.0", frontPost: "33.5" } },
  { savedAt: "2026-09-28T10:00:00Z", sessionLabel: "Session 3", setup: { bike: "RSV4 #7" },
    tires: { brand: "Pirelli", model: "SC1", frontPre: "29.0" } },
  { savedAt: "2026-09-29T10:00:00Z", sessionLabel: "Session 4", setup: { bike: "Panigale V4 #21" },
    tires: { brand: "Michelin", model: "SC1", frontPre: "28.0" } },
];
const CTX = { bike: "Panigale V4 #21", brand: "Pirelli", model: "SC1" };

test("PRE references the most recent session on the SAME bike and tires", () => {
  const r = S.pressureReferences(SESSIONS, CTX, "front-pre", "");
  assert.equal(r.primary.value, "31.0", "the 27th, not the 20th");
  assert.equal(r.primary.text, "Last session (S2)");
  assert.equal(r.primary.button, "Same as S2");
  assert.equal(r.sources.length, 1);
});

test("POST shows last session's hot value and this session's PRE", () => {
  const r = S.pressureReferences(SESSIONS, CTX, "front-post", "30.5");
  assert.deepEqual(r.sources.map((x) => x.text + " " + x.value),
    ["S2 hot 33.5", "PRE this session 30.5"]);
  assert.equal(r.primary.value, "33.5", "the hot reading leads");
});

test("POST falls back to this session's PRE when there is no history", () => {
  const r = S.pressureReferences([], CTX, "front-post", "30.5");
  assert.equal(r.primary.value, "30.5");
  assert.equal(r.primary.button, "Same as PRE");
});

test("a different bike or a different tire is never used as a reference", () => {
  const r = S.pressureReferences(SESSIONS, { bike: "RSV4 #7", brand: "Michelin", model: "SC1" }, "front-pre", "");
  assert.equal(r.primary, null, "no session matches that combination");
  assert.equal(r.sources.length, 0);
  // Both the RSV4 session and the Michelin session exist and both carry a
  // front pressure. Neither may stand in for this bike on these tires.
  const others = SESSIONS.filter((x) => x.setup.bike !== CTX.bike || x.tires.brand !== CTX.brand);
  assert.equal(S.pressureReferences(others, CTX, "front-pre", "").primary, null);
});

test("an incomplete context yields no reference rather than a loose match", () => {
  for (const ctx of [{ bike: "Panigale V4 #21", brand: "", model: "SC1" },
                     { bike: "", brand: "Pirelli", model: "SC1" },
                     { bike: "Panigale V4 #21", brand: "Pirelli", model: "" }]) {
    assert.equal(S.pressureReferences(SESSIONS, ctx, "front-pre", "").primary, null);
  }
});

test("blank and unreadable recorded values are skipped, not shown", () => {
  const messy = [
    { savedAt: "2026-09-30T10:00:00Z", sessionLabel: "Session 9", setup: { bike: "B" }, tires: { brand: "P", model: "M", frontPre: "" } },
    { savedAt: "2026-09-29T10:00:00Z", sessionLabel: "Session 8", setup: { bike: "B" }, tires: { brand: "P", model: "M", frontPre: "abc" } },
    { savedAt: "2026-09-28T10:00:00Z", sessionLabel: "Session 7", setup: { bike: "B" }, tires: { brand: "P", model: "M", frontPre: "30.5" } },
  ];
  const r = S.pressureReferences(messy, { bike: "B", brand: "P", model: "M" }, "front-pre", "");
  assert.equal(r.primary, null,
    "the most recent MATCHING session has no usable value, and an older one is not a substitute");
});

test("a session number is never invented when the label has none", () => {
  const unlabelled = [{ savedAt: "2026-09-27T10:00:00Z", setup: { bike: "B" },
                        tires: { brand: "P", model: "M", frontPre: "31.0" } }];
  const r = S.pressureReferences(unlabelled, { bike: "B", brand: "P", model: "M" }, "front-pre", "");
  assert.equal(r.primary.tag, null);
  assert.equal(r.primary.text, "Last session");
  assert.equal(r.primary.button, "Same as last session");
  assert.ok(!/S\d/.test(r.primary.text + r.primary.button), "no fabricated session number");
});

test("sessionTag reads the number off the label and nothing else", () => {
  assert.equal(S.sessionTag({ sessionLabel: "Session 2" }), "S2");
  assert.equal(S.sessionTag({ sessionLabel: "Session 12" }), "S12");
  assert.equal(S.sessionTag({ sessionLabel: "Warm-up" }), null);
  assert.equal(S.sessionTag({ sessionLabel: "" }), null);
  assert.equal(S.sessionTag({}), null);
});

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

test("the Today label distinguishes blank, measured and typed", () => {
  assert.equal(S.todayLabel(""), "Today · not measured");
  assert.equal(S.todayLabel("30.5"), "Today");
  assert.equal(S.todayLabel("48.0"), "Today · typed");
  assert.equal(S.todayLabel("abc"), "Today · typed");
});

test("the POST delta appears only once there is a value to compare", () => {
  assert.equal(S.postDelta("33.5", "30.5"), "+3.0 vs PRE");
  assert.equal(S.postDelta("29.5", "30.5"), "−1.0 vs PRE");
  assert.equal(S.postDelta("", "30.5"), "", "no POST value yet");
  assert.equal(S.postDelta("33.5", ""), "", "no PRE to compare against");
  assert.equal(S.postDelta("abc", "30.5"), "");
});
