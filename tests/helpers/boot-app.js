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
    if (name === "day") cell.setAttribute("aria-current", "page");
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

  // A per-window VIEW over the shared storage. Writes go to the backing store
  // and then notify the OTHER windows, exactly as a browser's storage event
  // does - it fires in every tab except the one that made the change.
  const views = storage._views || (storage._views = []);
  const notifyOthers = (key, oldValue, newValue, source) => {
    for (const v of views) {
      if (v.win === source) continue;
      v.win._fireStorage({ key, oldValue, newValue });
    }
  };
  const storageView = {
    getItem: (k) => storage.getItem(k),
    setItem(k, v) {
      const old = storage.getItem(k);
      storage.setItem(k, v);
      notifyOthers(k, old, String(v), win);
    },
    removeItem(k) {
      const old = storage.getItem(k);
      storage.removeItem(k);
      notifyOthers(k, old, null, win);
    },
    get length() { return storage.length; },
    key: (i) => storage.key(i),
  };

  const winListeners = new Map();
  const win = {
    document,
    localStorage: storageView,
    innerHeight: 844,
    scrollTo() {},
    addEventListener(type, fn) {
      if (!winListeners.has(type)) winListeners.set(type, []);
      winListeners.get(type).push(fn);
    },
    removeEventListener() {},
    _fireStorage(ev) {
      (winListeners.get("storage") || []).slice().forEach((fn) => fn(ev));
    },
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

  views.push({ win });

  const g = {
    window: win, document, localStorage: storageView,
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
  // Every saved-session field is a real input from the start. clearForm() finds
  // what it clears by selector ('input[type="text"], textarea'), so a field
  // that only becomes an INPUT when a test types into it is invisible to it -
  // and a restored draft populates fields WITHOUT typing, which made Reset
  // look broken when it was not.
  for (const id of win.SessionProgress.SESSION_FIELD_IDS) {
    field(id, "INPUT");
  }

  // The stepper buttons the page ships, built the same way app.js finds them:
  // by class and data attributes, with the input they act on alongside.
  const STEPPER_FIELDS = ["front-pre", "rear-pre", "front-post", "rear-post",
                          "fork-comp", "fork-reb", "shock-comp", "shock-reb"];
  for (const id of STEPPER_FIELDS) {
    field(id, "INPUT");
    for (const dir of ["-1", "1"]) {
      const b = dom.makeEl("", "BUTTON");
      b.classList.add("stepper-btn");
      b.dataset.stepFor = id;
      b.dataset.stepDir = dir;
      main.appendChild(b);
    }
  }

  // The tire disclosure ships collapsed, with its fields present in the DOM.
  // The stub DOM has no markup to read that from, so it is set up here - a
  // stub that starts open would let a broken disclosure pass.
  const tireFields = field("tire-fields", "DIV");
  tireFields.hidden = true;
  const editTires = field("edit-tires", "BUTTON");
  editTires.setAttribute("aria-expanded", "false");
  editTires.textContent = "Edit tires";
  for (const id of ["tire-brand", "tire-model", "warmer-time"]) field(id, "INPUT");
  field("warmer-on", "INPUT").type = "checkbox";
  field("tire-summary", "P");

  // Lets a test interleave something between the store being ready and the
  // app booting - which is where load-time races actually live.
  if (opts && typeof opts.beforeBoot === "function") opts.beforeBoot(win);
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
  // A test writing straight to `storage` is acting as something outside every
  // tab, so every window hears about it.
  if (!storage._notifyAll) {
    const realSet = storage.setItem.bind(storage);
    const realRemove = storage.removeItem.bind(storage);
    storage._notifyAll = true;
    storage.setItem = function (k, v) {
      const old = storage.getItem(k);
      const r = realSet(k, v);
      notifyOthers(k, old, String(v), null);
      return r;
    };
    storage.removeItem = function (k) {
      const old = storage.getItem(k);
      const r = realRemove(k);
      notifyOthers(k, old, null, null);
      return r;
    };
  }

  return { dom, document, win, storage, main, stageCells, field, bar, downloads, dialogs, clock,
           STORAGE_KEY: "mototrack.sessions.v1",
           saved: () => JSON.parse(storage.getItem("mototrack.sessions.v1") || "[]") };
}
