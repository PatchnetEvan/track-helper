import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The regression this exists for: moving panel-suspension to DAY in beta.16
// took the POST symptoms with it, and they were unreachable from beta.16 to
// beta.19 without a single test noticing. A field the rider cannot reach on
// any stage is a field that cannot be filled in.
//
// This reads the shipped markup rather than booting the stub DOM, because the
// stub has no panels and no data-stage wrappers - the very things that hide a
// field. The rules below mirror showTab(): a panel shows on the stages listed
// for it, and inside a panel a [data-stage] block shows only on its own stage.

const HTML = readFileSync(join(import.meta.dirname, "..", "public", "log", "index.html"), "utf8");
const APP = readFileSync(join(import.meta.dirname, "..", "public", "app.js"), "utf8");

// Fields that are deliberately not on a session stage. Each needs a reason.
const EXCLUDED = {
  "feedback-email": "About > Feedback, so the rider can be replied to - not a session field",
  "feedback-body": "About > Feedback message text - not a session field",
  "autosave-switch": "the auto-save setting in About, not a reading about the outing",
};

function stagePanels() {
  const block = APP.slice(APP.indexOf("const STAGE_PANELS"), APP.indexOf("};", APP.indexOf("const STAGE_PANELS")));
  const map = {};
  for (const m of block.matchAll(/(\w+):\s*\[([^\]]*)\]/g)) {
    map[m[1]] = [...m[2].matchAll(/"([^"]+)"/g)].map((p) => p[1]);
  }
  return map;
}

// Every <section class="panel" id="..."> and the slice of markup it owns.
function panels() {
  const out = {};
  const re = /<section class="panel" id="([^"]+)"/g;
  let m;
  const starts = [];
  while ((m = re.exec(HTML)) !== null) starts.push([m.index, m[1]]);
  starts.forEach(([start, id], i) => {
    // A panel runs to the start of the next panel, or to </main>.
    const end = i + 1 < starts.length ? starts[i + 1][0] : HTML.indexOf("</main>", start);
    out[id] = HTML.slice(start, end);
  });
  return out;
}

// Which stages a given offset inside a panel is visible on: the panel's own
// stages, narrowed by any [data-stage] wrapper the field sits inside.
function stagesForOffset(markup, offset, panelStages) {
  let stages = panelStages.slice();
  const re = /<div[^>]*\sdata-stage="([a-z]+)"/g;
  let m;
  while ((m = re.exec(markup)) !== null) {
    if (m.index > offset) break;
    // Walk forward from this wrapper counting divs to find where it closes.
    let depth = 0, i = m.index;
    const tag = /<\/?div\b/g;
    tag.lastIndex = i;
    let t;
    let close = markup.length;
    while ((t = tag.exec(markup)) !== null) {
      depth += t[0] === "<div" ? 1 : -1;
      if (depth === 0) { close = t.index; break; }
    }
    if (offset > m.index && offset < close) stages = stages.filter((s) => s === m[1]);
  }
  return stages;
}

test("every rider-facing field is reachable on at least one stage", () => {
  const STAGE_PANELS = stagePanels();
  const PANELS = panels();
  const reachable = new Map();

  for (const [panelId, markup] of Object.entries(PANELS)) {
    const panelStages = Object.keys(STAGE_PANELS).filter((s) => STAGE_PANELS[s].includes(panelId));
    for (const m of markup.matchAll(/<(input|select|textarea)\b[^>]*>/g)) {
      if (/type="hidden"/.test(m[0])) continue;    // stored state, never shown
      const idMatch = m[0].match(/\bid="([^"]+)"/);
      const valueMatch = m[0].match(/\bvalue="([^"]+)"/);
      // A control with no id still has to be reachable. The symptom and tag
      // checkboxes are exactly that shape, and keying them by value is what
      // makes this guard see the regression it exists for.
      const key = idMatch ? idMatch[1] : valueMatch ? "value:" + valueMatch[1] : null;
      if (!key) continue;
      const stages = stagesForOffset(markup, m.index, panelStages);
      const prev = reachable.get(key) || [];
      reachable.set(key, prev.concat(stages));
    }
  }

  assert.ok(reachable.size > 20, `found ${reachable.size} fields - the parser should see far more`);

  const unreachable = [];
  for (const [id, stages] of reachable) {
    if (EXCLUDED[id]) continue;
    if (stages.length === 0) unreachable.push(id);
  }
  assert.deepEqual(unreachable, [],
    "these fields are on no stage, so the rider can never fill them in: " + unreachable.join(", "));

  // The exact field that went missing, named so this cannot regress quietly.
  for (const id of ["front-pre", "front-post", "fork-comp", "shock-reb", "tire-brand",
                    "warmer-on", "value:chatter", "value:midcorner-push"]) {
    assert.ok((reachable.get(id) || []).length > 0, `${id} must be reachable`);
  }
});

test("the POST symptoms are reachable on POST", () => {
  const PANELS = panels();
  const STAGE_PANELS = stagePanels();
  const owner = Object.entries(PANELS).find(([, markup]) => markup.includes('id="symptoms"'));
  assert.ok(owner, "the symptoms block is in a panel");
  const [panelId, markup] = owner;
  const panelStages = Object.keys(STAGE_PANELS).filter((s) => STAGE_PANELS[s].includes(panelId));
  assert.ok(panelStages.includes("post"),
    `#symptoms lives in ${panelId}, which POST does not show - the beta.16 regression`);
  const stages = stagesForOffset(markup, markup.indexOf('id="symptoms"'), panelStages);
  assert.ok(stages.includes("post"), "and it is not hidden by a wrapper for another stage");
});

test("every excluded field still exists, so the list cannot rot", () => {
  for (const [id, reason] of Object.entries(EXCLUDED)) {
    assert.ok(HTML.includes(`id="${id}"`), `${id} is excluded (${reason}) but no longer exists`);
    assert.ok(reason.length > 10, `${id} needs a real reason`);
  }
});
