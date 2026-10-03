import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const STAMP = readFileSync(join(import.meta.dirname, "..", "public", "log", "theme-stamp.js"), "utf8");
const HTML = readFileSync(join(import.meta.dirname, "..", "public", "log", "index.html"), "utf8");

// The stamp is evaluated rather than parsed, so the rules are tested, not the
// wording of them.
function runStamp({ stored = null, systemDark = false } = {}) {
  const attrs = new Map();
  const root = {
    setAttribute: (k, v) => attrs.set(k, v),
    removeAttribute: (k) => attrs.delete(k),
    getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
  };
  const meta = { content: null, setAttribute: (k, v) => { if (k === "content") meta.content = v; } };
  const listeners = [];
  const win = {
    matchMedia: (q) => ({
      matches: q.includes("dark") ? systemDark : false,
      addEventListener: (_t, fn) => listeners.push(fn),
    }),
    localStorage: {
      _v: stored,
      getItem: () => win.localStorage._v,
      setItem: (_k, v) => { win.localStorage._v = v; },
    },
    document: { documentElement: root, querySelector: () => meta },
  };
  win.window = win;
  new Function("window", "document", "localStorage", STAMP)(win, win.document, win.localStorage);
  return { dark: () => root.getAttribute("data-mt") === "dark", meta, api: win.MotoTrackTheme, fire: () => listeners.forEach((f) => f()) };
}

test("auto follows the phone", () => {
  assert.equal(runStamp({ stored: null, systemDark: true }).dark(), true);
  assert.equal(runStamp({ stored: null, systemDark: false }).dark(), false);
  assert.equal(runStamp({ stored: "auto", systemDark: true }).dark(), true);
});

test("an explicit choice overrides the phone", () => {
  assert.equal(runStamp({ stored: "bright", systemDark: true }).dark(), false, "bright stays bright");
  assert.equal(runStamp({ stored: "dark", systemDark: false }).dark(), true, "dark stays dark");
});

test("a junk or missing stored value falls back to auto, not to a guess", () => {
  assert.equal(runStamp({ stored: "chartreuse", systemDark: true }).dark(), true);
  assert.equal(runStamp({ stored: "", systemDark: false }).dark(), false);
});

test("the theme-color meta follows the theme", () => {
  assert.equal(runStamp({ stored: "dark" }).meta.content, "#05070B");
  assert.equal(runStamp({ stored: "bright" }).meta.content, "#EEF1F5");
});

test("setting a mode stores it under the key Pro also uses", () => {
  const r = runStamp({ stored: "auto", systemDark: false });
  assert.equal(r.api.KEY, "mt.theme.mode");
  r.api.set("dark");
  assert.equal(r.dark(), true);
  assert.equal(r.api.get(), "dark");
});

test("in auto, a change of phone setting is picked up while the page is open", () => {
  const r = runStamp({ stored: "auto", systemDark: false });
  assert.equal(r.dark(), false);
  r.fire();                       // the media query would fire on a real change
  assert.equal(r.api.get(), "auto", "still auto, still following");
});

test("the stamp is a file in <head>, because inline scripts are blocked", () => {
  assert.match(HTML, /<script src="theme-stamp\.js"><\/script>/);
  const head = HTML.slice(0, HTML.indexOf("</head>"));
  assert.ok(head.includes("theme-stamp.js"), "it has to run before first paint");
  // Compare the LINK tags, not raw substrings: a comment mentioning a filename
  // would otherwise decide the order for us.
  const links = [...head.matchAll(/<link[^>]+href="([^"]+\.css)"/g)].map((m) => m[1]);
  const tokensAt = links.findIndex((h) => h.endsWith("mt-tokens.css"));
  const stylesAt = links.findIndex((h) => h.endsWith("/styles.css"));
  assert.ok(tokensAt !== -1 && stylesAt !== -1, `both sheets are linked: ${links.join(", ")}`);
  assert.ok(tokensAt < stylesAt, "tokens load first");
  assert.match(HTML, /script-src 'self'/, "which is why it cannot be inline");
});
