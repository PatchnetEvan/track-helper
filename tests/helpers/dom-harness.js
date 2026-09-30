// A DOM small enough to read and big enough to run public/app.js.
//
// It exists so the save and dirty-tracking wiring can be exercised through
// real events rather than asserted structurally: the two bugs it was written
// for - comparison selectors re-arming the save, and copy provenance never
// being rendered - both lived in the wiring and were invisible to the pure
// state-module tests.
//
// Elements are created on first lookup, so app.js's many getElementById calls
// need no fixture; only what a test asserts on has to be arranged.
//
// NEVER assert on an element from here. Read a primitive off it (textContent,
// hidden, value) and assert on that - a failing deep-equal against a node
// makes node:assert walk the entire object graph.

const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

function makeClassList() {
  const set = new Set();
  return {
    add: (...c) => c.forEach((x) => set.add(x)),
    remove: (...c) => c.forEach((x) => set.delete(x)),
    contains: (c) => set.has(c),
    toggle: (c, force) => {
      const on = force === undefined ? !set.has(c) : !!force;
      if (on) set.add(c); else set.delete(c);
      return on;
    },
    toString: () => [...set].join(" "),
  };
}

export function createDom() {
  const byId = new Map();
  const all = [];
  const dom = {};

  function makeEl(id, tagName = "DIV") {
    const attrs = new Map();
    const listeners = new Map();
    const el = {
      id: id || "", tagName,
      value: "", checked: false, textContent: "", innerHTML: "",
      hidden: false, disabled: false, readOnly: false, tabIndex: 0,
      children: [], parent: null, dataset: {},
      style: {
        _v: new Map(),
        setProperty(n, v) { this._v.set(n, v); },
        getPropertyValue(n) { return this._v.get(n) || ""; },
        removeProperty(n) { this._v.delete(n); },
      },
      setAttribute(n, v) { attrs.set(n, String(v)); },
      getAttribute(n) { return attrs.has(n) ? attrs.get(n) : null; },
      removeAttribute(n) { attrs.delete(n); },
      hasAttribute(n) { return attrs.has(n); },
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      },
      removeEventListener() {},
      _fire(type, ev) { (listeners.get(type) || []).slice().forEach((fn) => fn(ev)); },
      dispatchEvent(event) {
        const ev = { type: event.type, target: this, bubbles: true };
        let node = this;
        while (node) { node._fire(ev.type, ev); node = node.parent; }
        return true;
      },
      click() { return this.dispatchEvent({ type: "click" }); },
      focus() { dom.document.activeElement = this; },
      scrollIntoView() {},
      getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 100, height: 50 }),
      checkVisibility() { return !this.hidden; },
      closest(sel) {
        // Two shapes, both of which app.js uses: "#an-id" and "tag[attr]".
        const idSel = sel.match(/^#([a-z0-9-]+)$/i);
        const tagAttr = sel.match(/^([a-z]+)\[([a-z-]+)\]$/i);
        const hit = (n) => {
          if (idSel) return n.id === idSel[1];
          if (tagAttr) {
            const key = tagAttr[2].startsWith("data-") ? tagAttr[2].slice(5) : null;
            return n.tagName === tagAttr[1].toUpperCase()
              && (key ? n.dataset[camel(key)] !== undefined : n.hasAttribute(tagAttr[2]));
          }
          return false;
        };
        let node = this;
        while (node) { if (hit(node)) return node; node = node.parent; }
        return null;
      },
      querySelector(sel) { return dom.document.querySelector(sel, this); },
      querySelectorAll(sel) { return dom.document.querySelectorAll(sel, this); },
      appendChild(child) { child.parent = this; this.children.push(child); return child; },
    };
    el.classList = makeClassList();
    all.push(el);
    return el;
  }

  // Deliberately narrow: only the selector shapes app.js actually uses. An
  // unrecognised selector returns nothing rather than guessing.
  function matchAll(sel, scope) {
    const within = (el) => {
      if (!scope) return true;
      let n = el.parent;
      while (n) { if (n === scope) return true; n = n.parent; }
      return false;
    };
    let out = [];
    let m;
    if ((m = sel.match(/^\.([a-z-]+)$/i))) {
      out = all.filter((e) => e.classList.contains(m[1]));
    } else if ((m = sel.match(/^\[data-([a-z-]+)\]$/i))) {
      out = all.filter((e) => e.dataset[camel(m[1])] !== undefined);
    } else if ((m = sel.match(/^\.([a-z-]+)\[data-([a-z-]+)="([^"]*)"\]$/i))) {
      out = all.filter((e) => e.classList.contains(m[1]) && e.dataset[camel(m[2])] === m[3]);
    } else if ((m = sel.match(/^\.([a-z-]+)\[([a-z-]+)="([^"]*)"\]$/i))) {
      out = all.filter((e) => e.classList.contains(m[1]) && e.getAttribute(m[2]) === m[3]);
    } else if ((m = sel.match(/^#([a-z0-9-]+)\s+input(\[type=[^\]]+\])?(:checked)?$/i))) {
      const host = byId.get(m[1]);
      out = host ? host.children.filter((e) => (m[3] ? e.checked : true)) : [];
    } else if ((m = sel.match(/^#([a-z0-9-]+)\s+h2$/i))) {
      const host = byId.get(m[1]);
      out = host ? host.children.filter((e) => e.tagName === "H2") : [];
    } else if (sel === "main") {
      out = all.filter((e) => e.tagName === "MAIN");
    } else if (/^input|^textarea/.test(sel)) {
      out = all.filter((e) => e.tagName === "INPUT" || e.tagName === "TEXTAREA");
    }
    return out.filter(within);
  }

  const docListeners = new Map();
  dom.document = {
    activeElement: null,
    addEventListener(type, fn) {
      if (!docListeners.has(type)) docListeners.set(type, []);
      docListeners.get(type).push(fn);
    },
    removeEventListener() {},
    _fire(type, ev) { (docListeners.get(type) || []).slice().forEach((fn) => fn(ev)); },
    getElementById(id) {
      if (!byId.has(id)) {
        const el = makeEl(id);
        // Real fields live inside <main>, and delegated listeners depend on
        // that. Without it an event never reaches the handler and a test that
        // expects NO reaction passes for entirely the wrong reason.
        if (dom.defaultParent) dom.defaultParent.appendChild(el);
        byId.set(id, el);
      }
      return byId.get(id);
    },
    querySelector(sel, scope) { return matchAll(sel, scope)[0] || null; },
    querySelectorAll(sel, scope) { return matchAll(sel, scope); },
    documentElement: makeEl("", "HTML"),
    createElement: (tag) => makeEl("", String(tag).toUpperCase()),
  };
  dom.makeEl = makeEl;
  dom.byId = byId;
  return dom;
}

// A localStorage that behaves, and can be told to fail once.
export function createStorage() {
  const map = new Map();
  return {
    failNextWrite: false,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem(k, v) {
      if (this.failNextWrite) { this.failNextWrite = false; throw new Error("Quota exceeded"); }
      map.set(k, String(v));
    },
    removeItem: (k) => map.delete(k),
    key: (i) => [...map.keys()][i],
    get length() { return map.size; },
    _map: map,
  };
}
