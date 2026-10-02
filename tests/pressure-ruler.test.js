import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(import.meta.dirname, "..", "public", "session-progress.js"), "utf8");
new Function("window", src)({});
const S = globalThis.SessionProgress;

// ---------------------------------------------------------------------------
// The interaction range is not a validation rule
// ---------------------------------------------------------------------------

test("the ruler holds its ends without rewriting anything", () => {
  assert.equal(S.snapPsi(9), 10, "below the range the ruler itself sits at 10");
  assert.equal(S.snapPsi(50), 45);
  assert.equal(S.rulerStep("45", 1), null, "and will not step past the top");
  assert.equal(S.rulerStep("10", -1), null, "nor below the bottom");
  assert.equal(S.rulerStep("44.5", 1), "45.0");
});

test("a typed value outside the range is preserved and may only move inward", () => {
  // 50 psi, deliberately typed.
  assert.equal(S.rulerStep("50", 1), null, "refuses to go further out");
  assert.equal(S.rulerStep("50", -1), "49.5", "but may walk back toward the range");
  assert.equal(S.rulerStep("5", -1), null);
  assert.equal(S.rulerStep("5", 1), "5.5");
  assert.equal(S.psiInRulerRange(50), false);
  assert.equal(S.psiInRulerRange(5), false);
});

test("blank and unreadable text are never stepped by the buttons", () => {
  for (const v of ["", "   ", "abc", "1e-2", "0x1A"]) {
    assert.equal(S.rulerStep(v, 1), null);
    assert.equal(S.rulerStep(v, -1), null);
  }
});

// ---------------------------------------------------------------------------
// Drag maths: one notch is 0.5 psi is 32px, and it snaps
// ---------------------------------------------------------------------------

test("32px of drag is exactly one notch", () => {
  assert.equal(S.NOTCH_PX, 32);
  assert.equal(S.PSI_NOTCH, 0.5);
  assert.equal(S.psiFromDrag(31.0, 32), 31.5);
  assert.equal(S.psiFromDrag(31.0, -32), 30.5);
  assert.equal(S.psiFromDrag(31.0, 64), 32);
  assert.equal(S.psiFromDrag(31.0, 8), 31, "a fraction of a notch snaps back");
  assert.equal(S.psiFromDrag(31.0, 20), 31.5, "and past the halfway point snaps on");
});

test("dragging cannot leave the interaction range", () => {
  assert.equal(S.psiFromDrag(44.5, 1000), 45);
  assert.equal(S.psiFromDrag(10.5, -1000), 10);
});

// ---------------------------------------------------------------------------
// Vertical scrolling is not captured
// ---------------------------------------------------------------------------

test("an ordinary vertical scroll that starts on the ruler is left to the page", () => {
  assert.equal(S.shouldCaptureDrag(0, 40), false, "straight down");
  assert.equal(S.shouldCaptureDrag(6, 40), false, "mostly down with a wobble");
  assert.equal(S.shouldCaptureDrag(30, 40), false, "diagonal but more vertical");
  assert.equal(S.shouldCaptureDrag(8, 2), false, "under the 10px intent threshold");
});

test("a clearly horizontal drag is taken over", () => {
  assert.equal(S.shouldCaptureDrag(11, 2), true);
  assert.equal(S.shouldCaptureDrag(-40, 10), true);
  assert.equal(S.shouldCaptureDrag(40, 39), true, "horizontal by a margin");
});

// ---------------------------------------------------------------------------
// A reference is a reference, never a measurement
// ---------------------------------------------------------------------------

const SESSIONS = [
  { savedAt: "2026-09-20T10:00:00Z", setup: { bike: "Panigale V4 #21" },
    tires: { brand: "Pirelli", model: "SC1", frontPre: "30.0", frontPost: "33.0" } },
  { savedAt: "2026-09-27T10:00:00Z", setup: { bike: "Panigale V4 #21" },
    tires: { brand: "Pirelli", model: "SC1", frontPre: "31.0", frontPost: "34.0" } },
  { savedAt: "2026-09-28T10:00:00Z", setup: { bike: "RSV4 #7" },
    tires: { brand: "Pirelli", model: "SC1", frontPre: "29.0" } },
  { savedAt: "2026-09-29T10:00:00Z", setup: { bike: "Panigale V4 #21" },
    tires: { brand: "Michelin", model: "SC1", frontPre: "28.0" } },
];
const ctx = { bike: "Panigale V4 #21", brand: "Pirelli", model: "SC1" };

test("the reference is the most recent session on the SAME bike and tires", () => {
  assert.equal(S.pressureReference(SESSIONS, ctx, "front-pre"), "31.0",
    "the 27th, not the 20th");
  assert.equal(S.pressureReference(SESSIONS, ctx, "front-post"), "34.0");
});

test("a different bike or a different tire is never used as a reference", () => {
  assert.equal(S.pressureReference(SESSIONS, { bike: "RSV4 #7", brand: "Michelin", model: "SC1" }, "front-pre"),
    null, "no session matches that combination");
  // The RSV4 session and the Michelin session both exist and both have a
  // front pressure - neither may stand in for this bike on these tires.
  const onlyOther = SESSIONS.filter((s) => s.setup.bike !== ctx.bike || s.tires.brand !== ctx.brand);
  assert.equal(S.pressureReference(onlyOther, ctx, "front-pre"), null);
});

test("an incomplete context yields no reference rather than a loose match", () => {
  assert.equal(S.pressureReference(SESSIONS, { bike: "Panigale V4 #21", brand: "", model: "SC1" }, "front-pre"), null);
  assert.equal(S.pressureReference(SESSIONS, { bike: "", brand: "Pirelli", model: "SC1" }, "front-pre"), null);
  assert.equal(S.pressureReference(SESSIONS, { bike: "Panigale V4 #21", brand: "Pirelli", model: "" }, "front-pre"), null);
});

test("blank and unreadable recorded values are skipped, not shown", () => {
  const messy = [
    { savedAt: "2026-09-30T10:00:00Z", setup: { bike: "B" }, tires: { brand: "P", model: "M", frontPre: "" } },
    { savedAt: "2026-09-29T10:00:00Z", setup: { bike: "B" }, tires: { brand: "P", model: "M", frontPre: "abc" } },
    { savedAt: "2026-09-28T10:00:00Z", setup: { bike: "B" }, tires: { brand: "P", model: "M", frontPre: "30.5" } },
  ];
  assert.equal(S.pressureReference(messy, { bike: "B", brand: "P", model: "M" }, "front-pre"), "30.5");
});

test("no sessions, no match, no reference", () => {
  assert.equal(S.pressureReference([], ctx, "front-pre"), null);
  assert.equal(S.pressureReference(null, ctx, "front-pre"), null);
  assert.equal(S.pressureReference(SESSIONS, null, "front-pre"), null);
});
