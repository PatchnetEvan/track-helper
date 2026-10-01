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

  // Upsert by id. A save that wrote but could not be verified leaves a record
  // behind, and the retry has to RECONCILE that record rather than add a
  // second copy of the same outing - so the retry reuses the pending id and
  // lands here, replacing in place when the id is already present.
  function put(session) {
    if (!session || !session.id) throw new Error("A session needs an id");
    const list = readAll();
    const at = list.findIndex((s) => s && s.id === session.id);
    if (at === -1) list.push(session);
    else list[at] = session;
    writeAll(list);
  }

  // Reads one record straight back out of storage, for verifying a write.
  function findById(id) {
    return readAll().find((s) => s && s.id === id) || null;
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
    available, readAll, add, put, findById, remove, clear, newId,
    importPayload, exportPayload,
  };
})();
