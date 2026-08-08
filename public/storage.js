(function () {
  "use strict";

  const KEY = "mototrack.sessions.v1";
  const APP = "MotoTrack";
  const VERSION = 1;

  function available() {
    try {
      const k = "__mt_probe__";
      localStorage.setItem(k, "1");
      localStorage.removeItem(k);
      return true;
    } catch (e) {
      return false;
    }
  }

  function readAll() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return [];
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    } catch (e) {
      return [];
    }
  }

  function writeAll(list) {
    localStorage.setItem(KEY, JSON.stringify(list));
  }

  function add(session) {
    const list = readAll();
    list.push(session);
    writeAll(list);
  }

  function remove(id) {
    writeAll(readAll().filter((s) => s.id !== id));
  }

  function clear() {
    localStorage.removeItem(KEY);
  }

  function newId() {
    return "s_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  function importPayload(payload) {
    let incoming = [];
    if (Array.isArray(payload)) {
      incoming = payload;
    } else if (payload && Array.isArray(payload.sessions)) {
      incoming = payload.sessions;
    } else {
      return { ok: false, reason: "Unrecognized file format." };
    }

    const existing = readAll();
    const existingIds = new Set(existing.map((s) => s.id));
    let added = 0, skipped = 0;
    for (const s of incoming) {
      if (!s || typeof s !== "object" || !s.id) { skipped++; continue; }
      if (existingIds.has(s.id)) { skipped++; continue; }
      existing.push(s);
      existingIds.add(s.id);
      added++;
    }
    writeAll(existing);
    return { ok: true, added, skipped };
  }

  function exportPayload() {
    return {
      app: APP,
      version: VERSION,
      exportedAt: new Date().toISOString(),
      sessions: readAll(),
    };
  }

  window.Store = {
    available, readAll, add, remove, clear, newId,
    importPayload, exportPayload,
  };
})();
