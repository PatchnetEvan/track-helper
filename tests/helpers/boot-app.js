import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createDom, createStorage } from "./dom-harness.js";

const ROOT = join(import.meta.dirname, "..", "..");
const read = (...p) => readFileSync(join(ROOT, ...p), "utf8");

// Boots the REAL public/app.js against the stub DOM, with the real storage.js
// and session-progress.js beside it. Returns handles for driving it.
export function bootApp(opts) {
  const dom = createDom();
  const { document } = dom;
  // A shared storage lets a test boot a SECOND app over the same data, which
  // is what a refresh - or a second tab - actually is.
  const storage = (opts && opts.storage) || createStorage();

  // The elements app.js finds by selector rather than by id have to exist
  // before it runs; everything else is created on first lookup.
  const main = dom.makeEl("", "MAIN");
  const STAGES = ["day", "pre", "post", "laps", "notes", "review"];
  const stageCells = {};
  for (const name of STAGES) {
    const cell = dom.makeEl("", "BUTTON");
    cell.classList.add("stage");
    cell.dataset.tab = name;
    cell.setAttribute("aria-selected", name === "day" ? "true" : "false");
    cell.appendChild(dom.makeEl("", "SPAN")).classList.add("stage-icon");
    stageCells[name] = cell;
  }
  const bar = dom.makeEl("", "NAV");
  bar.classList.add("stage-bar");

  dom.defaultParent = main;

  // Panels, and the two checkbox groups that are read by container.
  for (const id of ["panel-setup", "panel-tires", "panel-suspension",
                    "panel-calculators", "panel-laps", "panel-notes",
                    "panel-review", "panel-history", "panel-about"]) {
    const p = document.getElementById(id);
    p.classList.add("panel");
    main.appendChild(p);
  }
  for (const id of ["feedback-tags", "symptoms"]) {
    main.appendChild(document.getElementById(id));
  }

  // Every field app.js reads or writes lives under <main>, so delegated
  // listeners on <main> reach them.
  const field = (id, tag = "INPUT") => {
    const el = document.getElementById(id);
    el.tagName = tag;
    if (!el.parent) main.appendChild(el);
    return el;
  };

  // Downloads are captured rather than performed, so a test can assert what
  // would have reached the rider's phone.
  // Timers are captured rather than run, so a test can prove what happens at
  // the debounce boundary and that a cancelled timer never fires.
  const timers = new Map();
  let timerSeq = 0;
  const downloads = [];
  const dialogs = { alerts: [], confirms: [], confirmAnswer: true };

  const win = {
    document,
    localStorage: storage,
    innerHeight: 844,
    scrollTo() {},
    addEventListener() {},
    matchMedia: (q) => ({ matches: false, media: q, addEventListener() {}, addListener() {} }),
    confirm: (msg) => { dialogs.confirms.push(String(msg)); return dialogs.confirmAnswer; },
    alert: (msg) => { dialogs.alerts.push(String(msg)); },
    Blob: class { constructor(parts, opts) { this.parts = parts; this.type = opts && opts.type; } },
    URL: {
      createObjectURL(blob) {
        downloads.push({ text: blob.parts.join(""), type: blob.type, name: null });
        return "blob:captured-" + downloads.length;
      },
      revokeObjectURL() {},
    },
    Event: class { constructor(type) { this.type = type; } },
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
  };
  win.window = win;

  const g = {
    window: win, document, localStorage: storage,
    // Referenced bare by app.js's download path, so they have to be in scope
    // and not only on `window`.
    Blob: win.Blob, URL: win.URL,
    ResizeObserver: undefined,
    Event: win.Event,
    console,
    setTimeout: (fn, ms) => { const id = ++timerSeq; timers.set(id, { fn, ms }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    setInterval, clearInterval,
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    navigator: { onLine: true },
    Date, Math, JSON, String, Number, Array, Object, Boolean, Set, Map, RegExp, Error,
    parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent,
  };

  const runIn = (code, label) => {
    const names = Object.keys(g);
    try {
      // eslint-disable-next-line no-new-func
      new Function(...names, code)(...names.map((n) => g[n]));
    } catch (e) {
      e.message = `${label}: ${e.message}`;
      throw e;
    }
  };

  // These attach themselves to `window`, which in a browser IS the global
  // scope. In here it is just an object, so they are promoted by hand before
  // app.js - which references them bare - is run.
  runIn(read("public", "storage.js"), "storage.js");
  runIn(read("public", "session-progress.js"), "session-progress.js");
  g.Store = win.Store;
  g.SessionProgress = win.SessionProgress;
  runIn(read("public", "app.js"), "app.js");

  // The anchor's download name is set after createObjectURL, so it is linked
  // back to the most recent capture when the link is clicked.
  const realCreate = document.createElement;
  document.createElement = (tag) => {
    const el = realCreate(tag);
    if (String(tag).toUpperCase() === "A") {
      el.click = () => { if (downloads.length) downloads[downloads.length - 1].name = el.download; };
    }
    return el;
  };

  const clock = {
    pending: () => timers.size,
    // Fire every timer that is due, the way a real clock would.
    flush() {
      const due = [...timers.entries()];
      timers.clear();
      due.forEach(([, t]) => t.fn());
      return due.length;
    },
  };
  return { dom, document, win, storage, main, stageCells, field, bar, downloads, dialogs, clock,
           STORAGE_KEY: "mototrack.sessions.v1",
           saved: () => JSON.parse(storage.getItem("mototrack.sessions.v1") || "[]") };
}
