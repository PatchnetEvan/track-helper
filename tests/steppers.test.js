import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bootApp } from "./helpers/boot-app.js";

const src = readFileSync(join(import.meta.dirname, "..", "public", "session-progress.js"), "utf8");
new Function("window", src)({});
const { stepValue } = globalThis.SessionProgress;

const PSI = ["front-pre", "rear-pre", "front-post", "rear-post"];
const CLICKS = ["fork-comp", "fork-reb", "shock-comp", "shock-reb"];

function setup() {
  const app = bootApp();
  const { document, win } = app;
  const el = (id) => document.getElementById(id);
  const type = (id, v) => { const e = el(id); e.tagName = "INPUT"; e.value = v; e.dispatchEvent(new win.Event("input")); };
  // The buttons app.js wired are found by their data attributes.
  const btn = (id, dir) => document.querySelectorAll(".stepper-btn")
    .find((b) => b.dataset.stepFor === id && Number(b.dataset.stepDir) === dir);
  return { ...app, el, type, btn, draft: () => {
    const raw = app.storage.getItem("mototrack.draft.v1");
    return raw === null ? null : JSON.parse(raw);
  } };
}

// ---------------------------------------------------------------------------
// 1. Precision: no snapping, no rounding away the rider's own entry
// ---------------------------------------------------------------------------

test("a half-PSI step keeps the rider's precision", () => {
  assert.equal(stepValue("30", "0.5", 1), "30.5");
  assert.equal(stepValue("30.5", "0.5", 1), "31.0");
  assert.equal(stepValue("30.25", "0.5", 1), "30.75", "30.25 + 0.5 is 30.75, not 30.8");
  assert.equal(stepValue("30.75", "0.5", -1), "30.25");
  assert.equal(stepValue("30.125", "0.5", 1), "30.625", "three decimals survive too");
});

test("binary floating point never leaks into the value", () => {
  // 30.1 + 0.5 in plain float is 30.599999999999998.
  assert.equal(stepValue("30.1", "0.5", 1), "30.6");
  assert.equal(stepValue("0.1", "0.5", 1), "0.6");
  assert.equal(stepValue("1.005", "0.5", 1), "1.505");
  for (const out of [stepValue("30.1", "0.5", 1), stepValue("8.7", "1", 1)]) {
    assert.ok(!/\d{6,}/.test(out), `no float dust in ${out}`);
  }
});

test("stepping is reversible", () => {
  for (const [value, step] of [["30", "0.5"], ["30.25", "0.5"], ["30.1", "0.5"],
                               ["8", "1"], ["8.5", "1"], ["12.75", "0.5"]]) {
    const up = stepValue(value, step, 1);
    const back = stepValue(up, step, -1);
    assert.equal(Number(back), Number(value), `${value} +${step} -${step} returns to ${value}`);
    const down = stepValue(value, step, -1);
    if (down !== null) {
      assert.equal(Number(stepValue(down, step, 1)), Number(value), `${value} -${step} +${step} returns`);
    }
  }
});

test("a fractional click is never rounded into an integer", () => {
  assert.equal(stepValue("8.5", "1", 1), "9.5");
  assert.equal(stepValue("8.5", "1", -1), "7.5");
  assert.equal(stepValue("8.25", "1", 1), "9.25");
});

// ---------------------------------------------------------------------------
// 2. Blank and unreadable values are left exactly alone
// ---------------------------------------------------------------------------

test("blank and unreadable text produce no step at all", () => {
  for (const value of ["", "   ", "abc", "30psi", "--", "1/2", "NaN"]) {
    assert.equal(stepValue(value, "0.5", 1), null, `${JSON.stringify(value)} cannot be stepped`);
    assert.equal(stepValue(value, "0.5", -1), null);
  }
});

test("the buttons are disabled for blank and unreadable fields, and the text survives", () => {
  const a = setup();
  for (const id of PSI.concat(CLICKS)) {
    assert.equal(a.btn(id, 1).disabled, true, `${id} starts blank, so + is disabled`);
    assert.equal(a.btn(id, -1).disabled, true, `and - is disabled`);
  }
  a.type("front-pre", "about 30");
  assert.equal(a.btn("front-pre", 1).disabled, true, "unreadable text disables the stepper");
  a.btn("front-pre", 1).click();
  assert.equal(a.el("front-pre").value, "about 30", "and the text is untouched");

  a.type("front-pre", "30");
  assert.equal(a.btn("front-pre", 1).disabled, false, "a number enables it");
  a.type("front-pre", "");
  assert.equal(a.btn("front-pre", 1).disabled, true, "clearing it disables it again");
});

test("a blank field never becomes zero", () => {
  const a = setup();
  a.btn("front-pre", 1).click();
  a.btn("front-pre", -1).click();
  assert.equal(a.el("front-pre").value, "", "still blank, not 0");
  assert.equal(a.draft(), null, "and nothing was stored");
});

// ---------------------------------------------------------------------------
// 3. The zero guard is an entry guard, not an opinion about pressure
// ---------------------------------------------------------------------------

test("a decrement may not cross below zero", () => {
  assert.equal(stepValue("0.25", "0.5", -1), null);
  assert.equal(stepValue("0", "0.5", -1), null);
  assert.equal(stepValue("0.5", "0.5", -1), "0.0", "reaching zero exactly is allowed");
  assert.equal(stepValue("0", "1", -1), null);
});

test("a manually typed negative value is never clamped or rewritten", () => {
  const a = setup();
  a.type("front-pre", "-2");
  assert.equal(a.el("front-pre").value, "-2", "typing is not clamped");
  a.btn("front-pre", -1).click();
  assert.equal(a.el("front-pre").value, "-2", "and a decrement below zero is simply refused");
  a.btn("front-pre", 1).click();
  assert.equal(a.el("front-pre").value, "-1.5", "while an increment still works");
});

test("a refused step marks nothing dirty and schedules no draft write", () => {
  const a = setup();
  a.storage.setItem("mototrack.autosave", "true");
  const b = setup();
  b.storage.setItem("mototrack.autosave", "true");
  const c = bootApp({ storage: b.storage });
  const cEl = (id) => c.document.getElementById(id);
  const cBtn = (id, dir) => c.document.querySelectorAll(".stepper-btn")
    .find((x) => x.dataset.stepFor === id && Number(x.dataset.stepDir) === dir);
  cEl("front-pre").tagName = "INPUT";
  cEl("front-pre").value = "0";
  cEl("front-pre").dispatchEvent(new c.win.Event("input"));
  c.clock.flush();
  const before = c.storage.getItem("mototrack.draft.v1");
  const pendingBefore = c.clock.pending();
  cBtn("front-pre", -1).click();               // refused: would cross below zero
  assert.equal(cEl("front-pre").value, "0", "no change");
  assert.equal(c.clock.pending(), pendingBefore, "no draft write was scheduled");
  c.clock.flush();
  assert.equal(c.storage.getItem("mototrack.draft.v1"), before, "and nothing was written");
});

// ---------------------------------------------------------------------------
// 4. Read-only PRE, and every moment the enabled state must resync
// ---------------------------------------------------------------------------

test("PRE steppers are disabled once the rider is back in, and Correct PRE restores them", () => {
  const a = setup();
  a.type("front-pre", "30.5"); a.type("fork-comp", "8");
  assert.equal(a.btn("front-pre", 1).disabled, false);

  a.stageCells.pre.click();
  a.el("dock-advance").click();                 // Back in -> POST
  assert.equal(a.el("front-pre").readOnly, true, "PRE is read-only");
  assert.equal(a.btn("front-pre", 1).disabled, true, "so its stepper is disabled");
  assert.equal(a.btn("fork-comp", 1).disabled, true, "clicks lock with it");

  // The handler must refuse too, not just the button's look.
  a.btn("front-pre", 1).click();
  assert.equal(a.el("front-pre").value, "30.5", "and the value is untouched");

  a.el("correct-pre").click();
  assert.equal(a.btn("front-pre", 1).disabled, false, "Correct PRE re-enables them");
  a.btn("front-pre", 1).click();
  assert.equal(a.el("front-pre").value, "31.0");
});

test("POST steppers stay usable while PRE is locked", () => {
  const a = setup();
  a.type("front-pre", "30.5"); a.type("front-post", "33.0");
  a.stageCells.pre.click();
  a.el("dock-advance").click();
  assert.equal(a.btn("front-post", 1).disabled, false, "POST is never locked");
  a.btn("front-post", 1).click();
  assert.equal(a.el("front-post").value, "33.5");
});

test("Save & next clears the pressures and keeps the clicks, and the steppers follow", () => {
  const a = setup();
  a.type("bike", "Panigale V4 #21"); a.type("track", "Barber");
  a.type("session-label", "Session 2");
  a.type("front-pre", "30.5"); a.type("fork-comp", "8");
  a.stageCells.review.click();
  a.el("save-and-next").click();

  assert.equal(a.el("front-pre").value, "", "pressures ARE cleared by Save & next");
  assert.equal(a.el("fork-comp").value, "8", "clicks carry over");
  assert.equal(a.btn("front-pre", 1).disabled, true, "so the PSI stepper is disabled again");
  assert.equal(a.btn("fork-comp", 1).disabled, false, "and the click stepper is still usable");
});

test("Reset disables every stepper", () => {
  const a = setup();
  a.type("front-pre", "30.5"); a.type("fork-comp", "8");
  a.win.confirm = () => true;
  a.el("reset-all").click();
  for (const id of PSI.concat(CLICKS)) {
    assert.equal(a.btn(id, 1).disabled, true, `${id} is blank again`);
  }
});

test("Copy to form and a restored draft both leave the steppers usable", () => {
  const a = setup();
  a.storage.setItem("mototrack.autosave", "true");
  const b = bootApp({ storage: a.storage });
  const bEl = (id) => b.document.getElementById(id);
  const bBtn = (id, dir) => b.document.querySelectorAll(".stepper-btn")
    .find((x) => x.dataset.stepFor === id && Number(x.dataset.stepDir) === dir);
  for (const [id, v] of [["bike", "Panigale"], ["front-pre", "30.5"], ["fork-comp", "8"]]) {
    bEl(id).tagName = "INPUT"; bEl(id).value = v;
    bEl(id).dispatchEvent(new b.win.Event("input"));
  }
  b.clock.flush();

  const restored = bootApp({ storage: a.storage });
  const rEl = (id) => restored.document.getElementById(id);
  const rBtn = (id, dir) => restored.document.querySelectorAll(".stepper-btn")
    .find((x) => x.dataset.stepFor === id && Number(x.dataset.stepDir) === dir);
  assert.equal(rEl("front-pre").value, "30.5", "the draft restored the pressure");
  assert.equal(rBtn("front-pre", 1).disabled, false, "and its stepper is usable with no edit");
  rBtn("front-pre", 1).click();
  assert.equal(rEl("front-pre").value, "31.0");
  void bBtn;
});

// ---------------------------------------------------------------------------
// 5. One activation, one increment - and the existing edit signal
// ---------------------------------------------------------------------------

test("one activation produces exactly one increment", () => {
  const a = setup();
  a.type("fork-comp", "8");
  a.btn("fork-comp", 1).click();
  assert.equal(a.el("fork-comp").value, "9");
  a.btn("fork-comp", 1).click();
  assert.equal(a.el("fork-comp").value, "10", "each press is one step, never more");
  a.btn("fork-comp", -1).click();
  assert.equal(a.el("fork-comp").value, "9");
});

test("there is no hold-to-repeat anywhere in the stepper wiring", () => {
  const appJs = readFileSync(join(import.meta.dirname, "..", "public", "app.js"), "utf8");
  // End the slice at the ruler section, not at auto-save: the ruler sits
  // between them and uses pointer events by design. This guard is about the
  // -/+ buttons never repeating while held.
  const start = appJs.indexOf("function wireSteppers()");
  const body = appJs.slice(start, appJs.indexOf("// --- Pressure ruler (C8 revised)", start));
  assert.ok(body.length > 200, "the stepper wiring was found");
  for (const forbidden of ["setInterval", "pointerdown", "mousedown", "touchstart", "repeat"]) {
    assert.ok(!body.includes(forbidden), `the stepper must not use ${forbidden}`);
  }
});

test("the ruler has no hold-to-repeat either", () => {
  const appJs = readFileSync(join(import.meta.dirname, "..", "public", "app.js"), "utf8");
  const start = appJs.indexOf("// --- Pressure ruler (C8 revised)");
  const body = appJs.slice(start, appJs.indexOf("// --- Auto-save draft (C6)", start));
  assert.ok(body.length > 200, "the ruler wiring was found");
  for (const forbidden of ["setInterval", "requestAnimationFrame", "setTimeout"]) {
    assert.ok(!body.includes(forbidden), `the ruler must not use ${forbidden} - no inertia, no repeat`);
  }
  // It must use pointer events, and release capture on cancellation.
  for (const required of ["pointerdown", "pointermove", "pointerup", "pointercancel",
                          "setPointerCapture", "releasePointerCapture"]) {
    assert.ok(body.includes(required), `the ruler must handle ${required}`);
  }
});

test("a step uses the existing input signal, so autosave and dirty tracking follow", () => {
  const a = setup();
  a.storage.setItem("mototrack.autosave", "true");
  const b = bootApp({ storage: a.storage });
  const bEl = (id) => b.document.getElementById(id);
  const bBtn = (id, dir) => b.document.querySelectorAll(".stepper-btn")
    .find((x) => x.dataset.stepFor === id && Number(x.dataset.stepDir) === dir);
  bEl("front-pre").tagName = "INPUT";
  bEl("front-pre").value = "30.0";
  bEl("front-pre").dispatchEvent(new b.win.Event("input"));
  b.clock.flush();

  bBtn("front-pre", 1).click();
  assert.equal(b.clock.pending(), 1, "the step scheduled a draft write");
  assert.match(b.document.getElementById("save-status-text").textContent, /Keeping draft/);
  b.clock.flush();
  assert.equal(JSON.parse(b.storage.getItem("mototrack.draft.v1")).session.tires.frontPre, "30.5",
    "and the stepped value is what was kept");
});

test("a stepped value is saved exactly as a typed one would be", () => {
  const a = setup();
  a.type("bike", "Panigale V4 #21");
  a.type("front-pre", "30");
  a.btn("front-pre", 1).click();
  a.stageCells.review.click();
  a.el("save-session").click();
  const saved = JSON.parse(a.storage.getItem("mototrack.sessions.v1"));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].tires.frontPre, "30.5", "stored as a plain string, schema unchanged");
});

// ---------------------------------------------------------------------------
// 6. The markup contract
// ---------------------------------------------------------------------------

test("every stepper button has a field-specific accessible name", () => {
  const html = readFileSync(join(import.meta.dirname, "..", "public", "log", "index.html"), "utf8");
  const names = [...html.matchAll(/class="stepper-btn"[^>]*aria-label="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(names.length, 16, "two buttons for each of the eight fields");
  assert.equal(new Set(names).size, 16, "and every name is distinct");
  for (const n of names) {
    assert.match(n, /^(Increase|Decrease) /, `${n} says which direction`);
    assert.match(n, /by (0\.5 PSI|1 click)$/, `${n} says the step and the unit`);
  }
});

test("the buttons are outside the label, so pressing one cannot focus the input", () => {
  const html = readFileSync(join(import.meta.dirname, "..", "public", "log", "index.html"), "utf8");
  // No stepper button may appear between <label ...> and its </label>.
  for (const block of html.match(/<label[^>]*>[\s\S]*?<\/label>/g) || []) {
    assert.ok(!block.includes("stepper-btn"),
      "a button inside a label would activate the label and open the keyboard");
  }
});

test("the inputs keep their ids, inputmode and manual typing", () => {
  const html = readFileSync(join(import.meta.dirname, "..", "public", "log", "index.html"), "utf8");
  for (const id of PSI) {
    assert.match(html, new RegExp(`<input type="text" id="${id}" inputmode="decimal"`),
      `${id} is still a typed decimal input`);
  }
  for (const id of CLICKS) {
    assert.match(html, new RegExp(`<input type="text" id="${id}"`), `${id} is still a text input`);
  }
});

test("focus stays on the pressed button, so a second tap does not open the keyboard", () => {
  const a = setup();
  a.type("front-pre", "30.0");
  const plus = a.btn("front-pre", 1);
  plus.click();
  assert.equal(a.document.activeElement, plus,
    "the button keeps focus - moving it to the input would raise the on-screen keyboard");
  assert.notEqual(a.document.activeElement, a.el("front-pre"));
  plus.click();
  assert.equal(a.el("front-pre").value, "31.0", "and a second tap still steps");
  assert.equal(a.document.activeElement, plus, "focus is still on the button");
});

test("a refused step does not steal focus either", () => {
  const a = setup();
  a.type("front-pre", "0");
  const minus = a.btn("front-pre", -1);
  const before = a.document.activeElement;
  minus.click();                                // refused at the zero boundary
  assert.equal(a.el("front-pre").value, "0");
  assert.equal(a.document.activeElement, before, "nothing was focused by a no-op");
});

// ---------------------------------------------------------------------------
// The numeric-input contract: one rule for availability and for stepping
// ---------------------------------------------------------------------------

// Number() reads all of these; this stepper must not.
const UNSUPPORTED = [
  ["scientific, negative exponent", "1e-2"],
  ["scientific, capital E", "1E3"],
  ["scientific with a sign", "2.5e+3"],
  ["hexadecimal", "0x1A"],
  ["binary", "0b101"],
  ["octal", "0o17"],
  ["Infinity", "Infinity"],
  ["a thousands separator", "1,500"],
  ["trailing unit", "30psi"],
  ["excessive decimal precision", "30.123456789012345678"],
  ["an unsafe magnitude", "999999999999999999999"],
];

for (const [label, text] of UNSUPPORTED) {
  test(`unsupported format is left untouched and cannot be stepped: ${label}`, () => {
    assert.equal(stepValue(text, "0.5", 1), null, `${text} must not step up`);
    assert.equal(stepValue(text, "0.5", -1), null, `${text} must not step down`);

    const a = setup();
    a.type("front-pre", text);
    assert.equal(a.btn("front-pre", 1).disabled, true, "the + button is disabled");
    assert.equal(a.btn("front-pre", -1).disabled, true, "the - button is disabled");
    a.btn("front-pre", 1).click();
    a.btn("front-pre", -1).click();
    assert.equal(a.el("front-pre").value, text, "and the text is exactly as it was typed");
  });
}

test("scientific notation is never silently rounded away", () => {
  // The defect: Number("1e-2") is 0.01 but it carries no decimal places, so
  // stepping produced "0.5" - the rider's 0.01 discarded without a word.
  assert.equal(stepValue("1e-2", "0.5", 1), null);
  const a = setup();
  a.type("rear-pre", "1e-2");
  a.btn("rear-pre", 1).click();
  assert.equal(a.el("rear-pre").value, "1e-2", "not 0.5");
});

test("hexadecimal is never rewritten as decimal", () => {
  // The defect: "0x1A" stepped to "26.5".
  assert.equal(stepValue("0x1A", "1", 1), null);
  const a = setup();
  a.type("fork-comp", "0x1A");
  a.btn("fork-comp", 1).click();
  assert.equal(a.el("fork-comp").value, "0x1A", "not 26.5");
});

test("excessive precision and unsafe magnitudes throw nothing and change nothing", () => {
  for (const text of ["30.123456789012345678", "999999999999999999999",
                      "0.0000000000000001", "12345678901234567890.5"]) {
    for (const dir of [1, -1]) {
      assert.doesNotThrow(() => stepValue(text, "0.5", dir), `${text} must not throw`);
      assert.equal(stepValue(text, "0.5", dir), null, `${text} must not step`);
    }
  }
});

test("an unsteppable value marks nothing dirty and schedules no autosave", () => {
  const a = setup();
  a.storage.setItem("mototrack.autosave", "true");
  const b = bootApp({ storage: a.storage });
  const bEl = (id) => b.document.getElementById(id);
  const bBtn = (id, dir) => b.document.querySelectorAll(".stepper-btn")
    .find((x) => x.dataset.stepFor === id && Number(x.dataset.stepDir) === dir);
  // Something saveable exists, so a draft is being kept.
  bEl("bike").tagName = "INPUT"; bEl("bike").value = "Panigale";
  bEl("bike").dispatchEvent(new b.win.Event("input"));
  bEl("front-pre").tagName = "INPUT"; bEl("front-pre").value = "1e-2";
  bEl("front-pre").dispatchEvent(new b.win.Event("input"));
  b.clock.flush();
  const before = b.storage.getItem("mototrack.draft.v1");
  const pendingBefore = b.clock.pending();

  bBtn("front-pre", 1).click();
  bBtn("front-pre", -1).click();

  assert.equal(bEl("front-pre").value, "1e-2", "untouched");
  assert.equal(b.clock.pending(), pendingBefore, "no draft write was scheduled");
  b.clock.flush();
  assert.equal(b.storage.getItem("mototrack.draft.v1"), before, "and nothing was written");
});

test("ordinary decimal notation still works, and stays reversible", () => {
  for (const text of ["30", "30.25", "30.5", "0", "0.5", "-2", ".5", "8", "8.5", "120.75"]) {
    assert.equal(typeof stepValue(text, "0.5", 1), "string", `${text} is steppable`);
  }
  assert.equal(stepValue("30.25", "0.5", 1), "30.75");
  assert.equal(stepValue("30.75", "0.5", -1), "30.25");
  assert.equal(stepValue(stepValue("30.25", "0.5", 1), "0.5", -1), "30.25",
    "30.25 to 30.75 and back again");

  const a = setup();
  a.type("front-pre", "30.25");
  a.btn("front-pre", 1).click();
  assert.equal(a.el("front-pre").value, "30.75");
  a.btn("front-pre", -1).click();
  assert.equal(a.el("front-pre").value, "30.25", "and the same round trip in the app");
});

test("the stepper never writes a value it would then refuse to read", () => {
  // Whatever a step produces must itself be steppable, or the rider could be
  // left with a field the buttons will not touch.
  for (const text of ["30", "30.25", "0.5", "-2", "999999999", "0.000001"]) {
    for (const step of ["0.5", "1"]) {
      const next = stepValue(text, step, 1);
      if (next === null) continue;
      assert.ok(typeof stepValue(next, step, 1) === "string" || Number(next) >= 0,
        `${text} -> ${next} must remain readable`);
      assert.match(next, /^[+-]?(\d+(\.\d*)?|\.\d+)$/, `${next} is ordinary decimal notation`);
    }
  }
});

test("button availability and the step rule can never disagree", () => {
  const a = setup();
  for (const text of ["30", "1e-2", "0x1A", "", "abc", "30.25", "-2",
                      "30.123456789012345678", "999999999999999999999", ".5"]) {
    a.type("front-pre", text);
    const enabled = !a.btn("front-pre", 1).disabled;
    const steppable = stepValue(text, "0.5", 1) !== null || stepValue(text, "0.5", -1) !== null;
    assert.equal(enabled, steppable,
      `${JSON.stringify(text)}: button ${enabled ? "enabled" : "disabled"} but rule says ${steppable}`);
  }
});

test("a magnitude that is unsafe only once scaled is refused", () => {
  // Chosen to isolate the safe-integer guard: four decimals (inside the
  // ceiling) and an ordinary-notation result, but 999999999999.9999 x 10^4
  // lands beyond Number.MAX_SAFE_INTEGER, where the arithmetic starts
  // inventing digits.
  for (const text of ["999999999999.9999", "9007199254740.993"]) {
    assert.doesNotThrow(() => stepValue(text, "0.5", 1));
    assert.equal(stepValue(text, "0.5", 1), null, `${text} cannot be stepped exactly`);
    assert.equal(stepValue(text, "0.5", -1), null);
    const a = setup();
    a.type("front-pre", text);
    assert.equal(a.btn("front-pre", 1).disabled, true, "and its buttons are disabled");
    a.btn("front-pre", 1).click();
    assert.equal(a.el("front-pre").value, text, "and the value is untouched");
  }
});
