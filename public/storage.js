(function () {
  "use strict";

  const KEY = "mototrack.sessions.v1";
  // Thrown by the strict read so callers can tell "nothing saved" from
  // "something is saved and I cannot read it".
  const UNREADABLE = "mototrack:history-unreadable";
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

  // Lenient: for READING and DISPLAY. A history that cannot be read shows as
  // empty rather than breaking the page, and junk entries inside a readable
  // list are skipped rather than handed to code that expects records - a null
  // in the array used to crash the saved-session list while sorting it.
  //
  // Skipping is safe here ONLY because every mutation reads through
  // readAllForWrite() instead, so nothing is ever written back from this.
  function readAll() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return [];
      const data = JSON.parse(raw);
      if (!Array.isArray(data)) return [];
      return data.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry));
    } catch (e) {
      return [];
    }
  }

  // Strict: for WRITING. Never guess at the history before replacing it.
  //
  // readAll() answers "[]" for a history it could not read, and a mutation
  // built on that answer writes [] plus the new record - destroying every
  // saved session, while the read-back of the new record still succeeds. So a
  // mutation reads through here instead: an ABSENT key is genuinely empty
  // history, but a read that throws, JSON that will not parse, or a stored
  // value that is not a list of records aborts the write. The original bytes
  // are left exactly as they are, to be recovered or exported by hand.
  function readAllForWrite() {
    let raw;
    try {
      raw = localStorage.getItem(KEY);
    } catch (e) {
      throw new Error(UNREADABLE);
    }
    if (raw === null || raw === undefined) return [];   // nothing saved yet
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      throw new Error(UNREADABLE);
    }
    if (!Array.isArray(data)) throw new Error(UNREADABLE);
    for (const entry of data) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(UNREADABLE);
    }
    return data;
  }

  function writeAll(list) {
    localStorage.setItem(KEY, JSON.stringify(list));
  }

  function add(session) {
    const list = readAllForWrite();
    list.push(session);
    writeAll(list);
  }

  // Upsert by id. A save that wrote but could not be verified leaves a record
  // behind, and the retry has to RECONCILE that record rather than add a
  // second copy of the same outing - so the retry reuses the pending id and
  // lands here, replacing in place when the id is already present.
  function put(session) {
    if (!session || !session.id) throw new Error("A session needs an id");
    // Strict read: a history this cannot parse must not be overwritten.
    const list = readAllForWrite();
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
    writeAll(readAllForWrite().filter((s) => s.id !== id));
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

    let existing;
    try {
      existing = readAllForWrite();
    } catch (e) {
      // Importing on top of a history that cannot be read would replace it.
      return { ok: false, reason: "Saved sessions on this device could not be read, so nothing was imported." };
    }
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
    available, readAll, readAllForWrite, add, put, findById, remove, clear, newId,
    importPayload, exportPayload, UNREADABLE,
  };
})();
