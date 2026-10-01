(function () {
  "use strict";

  const KEY = "mototrack.sessions.v1";
  // Thrown by the strict read so callers can tell "nothing saved" from
  // "something is saved and I cannot read it".
  const UNREADABLE = "mototrack:history-unreadable";
  const DRAFT_UNREADABLE = "mototrack:draft-unreadable";
  const DRAFT_UNVERIFIED = "mototrack:draft-unverified";
  const DRAFT_CONFLICT = "mototrack:draft-conflict";
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

  // What can honestly be exported right now.
  //
  // exportPayload() reads leniently, which is right for a healthy history and
  // wrong for a damaged one: malformed text would export as zero sessions and
  // a list with some junk in it would export the good entries SILENTLY, so a
  // rider would keep a partial backup believing it was complete. Worse, the
  // caller would then say "no saved sessions to export" about a device that
  // still held them.
  //
  // So the export path asks this instead, and gets one of three answers:
  //
  //   ok         - a normal backup; `payload` is complete
  //   raw        - the stored TEXT is readable but is not a valid history.
  //                Nothing can be parsed out of it safely, but the text itself
  //                can be preserved verbatim as a recovery copy.
  //   unreadable - storage itself refused to hand the text over. There is
  //                nothing to write to a file, and no backup exists.
  //
  // Read-only in every case: the stored bytes are never touched.
  function exportState() {
    let raw;
    try {
      raw = localStorage.getItem(KEY);
    } catch (e) {
      return { kind: "unreadable" };
    }
    if (raw === null || raw === undefined) {
      return { kind: "ok", payload: { app: APP, version: VERSION, exportedAt: new Date().toISOString(), sessions: [] } };
    }
    let sessions;
    try {
      sessions = readAllForWrite();
    } catch (e) {
      return { kind: "raw", raw: raw };
    }
    return { kind: "ok", payload: { app: APP, version: VERSION, exportedAt: new Date().toISOString(), sessions: sessions } };
  }

  // --- Drafts (PR 6) --------------------------------------------------------
  //
  // A SEPARATE KEY, and that separation is the safety property rather than
  // tidiness: nothing on the draft path reads or writes the saved-session key,
  // so a failing or unreadable draft can never damage saved history, and an
  // unreadable history can never cost the rider the outing in front of them.
  const DRAFT_KEY = "mototrack.draft.v1";
  const DRAFT_VERSION = 1;
  const DRAFT_STAGES = ["day", "pre", "post", "laps", "notes", "review"];
  function isPlainObject(x) {
    return !!x && typeof x === "object" && !Array.isArray(x);
  }

  // A draft is only restored when it is a COMPLETE, known-version record.
  // Anything else is left exactly where it is for the recovery-copy path -
  // never parsed past, never half-applied, never overwritten.
  function validateDraft(d) {
    if (!d || typeof d !== "object" || Array.isArray(d)) return "not a record";
    if (d.v !== DRAFT_VERSION) return "unsupported version";
    if (typeof d.rev !== "number" || !isFinite(d.rev) || d.rev < 0) return "bad revision";
    if (typeof d.writer !== "string" || !d.writer) return "no writer";
    if (typeof d.updatedAt !== "string" || !d.updatedAt) return "no timestamp";
    var st = d.stage;
    if (!st || typeof st !== "object") return "no stage";
    if (typeof st.name !== "string") return "bad stage name";
    if (typeof st.postUnlocked !== "boolean") return "bad postUnlocked";
    if (typeof st.preEditable !== "boolean") return "bad preEditable";
    if (d.pendingId !== null && typeof d.pendingId !== "string") return "bad pendingId";
    if (d.savedAs !== null && typeof d.savedAs !== "string") return "bad savedAs";
    // A stage name is navigation state, and an unknown one would be handed
    // straight to showTab. Only the stages that exist are accepted.
    if (DRAFT_STAGES.indexOf(st.name) === -1) return "unknown stage name";
    var ses = d.session;
    if (!isPlainObject(ses)) return "no session";
    for (const part of ["setup", "tires", "suspension", "laps", "riderFeedback"]) {
      // isPlainObject, not typeof: an array passes typeof "object" and would
      // be spread into the form as a record with numeric keys.
      if (!isPlainObject(ses[part])) return "session missing " + part;
    }
    // Rider Feedback is restored into a textarea and a set of checkboxes, so
    // its shape is checked rather than assumed.
    var fb = ses.riderFeedback;
    if (fb.text !== undefined && typeof fb.text !== "string") return "feedback text is not text";
    if (fb.tags !== undefined) {
      if (!Array.isArray(fb.tags)) return "feedback tags are not a list";
      for (const tag of fb.tags) {
        if (typeof tag !== "string") return "a feedback tag is not text";
      }
    }
    if (ses.suspension.symptoms !== undefined) {
      if (!Array.isArray(ses.suspension.symptoms)) return "symptoms are not a list";
      for (const sym of ses.suspension.symptoms) {
        if (typeof sym !== "string") return "a symptom is not text";
      }
    }
    if (ses.laps.times !== undefined && !Array.isArray(ses.laps.times)) return "lap times are not a list";
    return null;   // valid
  }

  // Strict, for anything that decides whether to restore or to replace.
  //   none        - nothing stored
  //   ok          - a complete draft of a version this build understands
  //   unreadable  - something IS stored and must not be touched
  function readDraftState() {
    let raw;
    try {
      raw = localStorage.getItem(DRAFT_KEY);
    } catch (e) {
      return { kind: "unreadable", raw: null, reason: "storage refused the read" };
    }
    if (raw === null || raw === undefined) return { kind: "none" };
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return { kind: "unreadable", raw: raw, reason: "not valid JSON" };
    }
    const bad = validateDraft(parsed);
    if (bad) return { kind: "unreadable", raw: raw, reason: bad };
    return { kind: "ok", draft: parsed, raw: raw };
  }

  // Writes and VERIFIES. "Kept" is only ever claimed about a revision that was
  // read back and matched, so a previous success never speaks for later edits.
  //
  // expectedRev guards against another tab: pass the revision this tab last
  // saw, and the write is refused if the stored draft has moved on. The other
  // tab's work is left intact - this one reports that it is not being kept.
  function writeDraft(draft, expectedRev) {
    const bad = validateDraft(draft);
    if (bad) throw new Error("refusing to write an invalid draft: " + bad);
    const current = readDraftState();
    if (current.kind === "unreadable") {
      const e = new Error(DRAFT_UNREADABLE); e.code = DRAFT_UNREADABLE; throw e;
    }
    // Ownership/revision guard, applied to EVERY write including the first.
    //
    // A null expectedRev means "I am not aware of a stored draft". That is the
    // most dangerous case, not the safest: a tab that has never read the key
    // would otherwise flatten whatever another tab has been keeping. So a null
    // expectation only authorises a write when the key really is empty, or
    // when what is there is this tab's own.
    if (current.kind === "ok" && current.draft.writer !== draft.writer) {
      if (expectedRev === undefined || expectedRev === null
          || current.draft.rev !== expectedRev) {
        const e = new Error(DRAFT_CONFLICT); e.code = DRAFT_CONFLICT;
        e.theirRev = current.draft.rev; e.theirWriter = current.draft.writer;
        throw e;
      }
    }
    const text = JSON.stringify(draft);
    localStorage.setItem(DRAFT_KEY, text);
    const back = localStorage.getItem(DRAFT_KEY);
    if (back !== text) {
      const e = new Error(DRAFT_UNVERIFIED); e.code = DRAFT_UNVERIFIED; throw e;
    }
    return draft.rev;
  }

  // Deleting is a mutation too, and the most destructive one. Saving or
  // resetting in one tab must not wipe a draft another tab is keeping - so a
  // caller must say whose draft it believes it is removing.
  // Deleting is a mutation too, and the most destructive one. The caller must
  // say WHICH draft it believes it is removing, and the removal only happens
  // if that is still what is stored - never a newer one another tab wrote in
  // the meantime.
  //
  //   expect = { writer, rev }  - remove exactly that draft
  //   expect = { raw }          - remove exactly those bytes (the recovery
  //                               path, where there is no parsed draft to
  //                               name a revision)
  //
  // There is deliberately no unguarded form: every ownerless delete this had
  // was a way for one tab to destroy another tab's work.
  function clearDraft(expect) {
    if (!expect || typeof expect !== "object") {
      throw new Error("clearDraft needs to say which draft it is removing");
    }
    let raw;
    try { raw = localStorage.getItem(DRAFT_KEY); } catch (e) {
      const err = new Error(DRAFT_UNREADABLE); err.code = DRAFT_UNREADABLE; throw err;
    }
    if (raw === null || raw === undefined) return true;      // nothing to remove

    if (typeof expect.raw === "string") {
      if (raw !== expect.raw) {
        const e = new Error(DRAFT_CONFLICT); e.code = DRAFT_CONFLICT; throw e;
      }
    } else {
      const current = readDraftState();
      if (current.kind !== "ok") {
        // Something is stored that this caller did not inspect.
        const e = new Error(DRAFT_UNREADABLE); e.code = DRAFT_UNREADABLE; throw e;
      }
      if (current.draft.writer !== expect.writer || current.draft.rev !== expect.rev) {
        const e = new Error(DRAFT_CONFLICT); e.code = DRAFT_CONFLICT;
        e.theirRev = current.draft.rev; e.theirWriter = current.draft.writer;
        throw e;
      }
    }
    localStorage.removeItem(DRAFT_KEY);
    if (localStorage.getItem(DRAFT_KEY) !== null) throw new Error(DRAFT_UNVERIFIED);
    return true;
  }

  // Marks a draft as already written to history, for the case where clearing
  // it failed. A draft carrying savedAs is reconciled, never restored.
  // Guarded the same way: this rewrites the key, so it can destroy another
  // tab's work exactly as a plain write can.
  function markDraftSaved(sessionId, owner, expectedRev) {
    const state = readDraftState();
    if (state.kind !== "ok") return false;
    // Same rule as a delete: only stamp the draft this caller inspected.
    if (state.draft.writer !== owner || state.draft.rev !== expectedRev) return false;
    const next = Object.assign({}, state.draft, { savedAs: sessionId });
    const text = JSON.stringify(next);
    localStorage.setItem(DRAFT_KEY, text);
    return localStorage.getItem(DRAFT_KEY) === text;
  }

  // For the recovery copy of a draft that cannot be read: the original text,
  // byte for byte, never re-serialised.
  function draftRecoveryText() {
    try { return localStorage.getItem(DRAFT_KEY); } catch (e) { return null; }
  }

  window.Store = {
    available, readAll, readAllForWrite, add, put, findById, remove, clear, newId,
    importPayload, exportPayload, exportState, UNREADABLE,
    DRAFT_KEY, DRAFT_VERSION, validateDraft, readDraftState, writeDraft,
    clearDraft, markDraftSaved, draftRecoveryText,
    DRAFT_UNREADABLE, DRAFT_UNVERIFIED, DRAFT_CONFLICT,
  };
})();
