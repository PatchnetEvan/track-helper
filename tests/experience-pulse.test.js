import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { APP_VERSION } from "../src/app-version.js";
import { createFeedback } from "../src/feedback-service.js";
import {
  createExperiencePulse, readExperiencePulse, PulseValidationError,
  PULSE_VALUES, PULSE_VALUE_LABELS, PULSE_QUESTION, PULSE_ACTION_CONTEXTS,
  PULSE_RATE_BUCKET_PREFIX, PULSE_RETENTION_MONTHS, PULSE_ROUTE_MAX,
} from "../src/experience-pulse-service.js";

// MotoTrack Experience Pulse #55 PR3A: schema + intake service contract. No
// routes, no UI, no admin, no GitHub, no email - those are the route suite /
// PR3B. Migration is NOT applied to any remote database. Every owner ruling
// expressible at the data/service layer is asserted here.

class LocalD1 {
  constructor() { this.sqlite = new DatabaseSync(":memory:"); this.sqlite.exec("PRAGMA foreign_keys = ON"); }
  prepare(sql) {
    const sqlite = this.sqlite;
    return { bind(...values) { return {
      all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
      first: async () => sqlite.prepare(sql).get(...values) || null,
      run: async () => (/^\s*SELECT\b/i.test(sql)
        ? { success: true, results: sqlite.prepare(sql).all(...values), meta: { changes: 0 } }
        : { success: true, results: [], meta: { changes: sqlite.prepare(sql).run(...values).changes } }),
    }; } };
  }
  async batch(statements) {
    this.sqlite.exec("BEGIN");
    try { const r = []; for (const s of statements) r.push(await s.run()); this.sqlite.exec("COMMIT"); return r; }
    catch (e) { this.sqlite.exec("ROLLBACK"); throw e; }
  }
}

const ALL_MIGRATIONS = [
  "0001_waitlist.sql", "0002_program_track.sql", "0003_resubscription_evidence.sql",
  "0004_rider_profiles.sql", "0005_profile_edit_authorizations.sql",
  "0006_profile_consent_events.sql", "0007_profile_invitation_batches.sql",
  "0008_beta_approvals.sql", "0009_feedback.sql", "0010_experience_pulse.sql",
];
const THROUGH_0009 = ALL_MIGRATIONS.slice(0, 9);

function makeDb(migrations = ALL_MIGRATIONS) {
  const db = new LocalD1();
  for (const m of migrations) db.sqlite.exec(readFileSync(join(import.meta.dirname, "..", "migrations", m), "utf8"));
  return db;
}
const pulseCount = (db) => db.sqlite.prepare("SELECT COUNT(*) AS n FROM feedback_experience_pulses").get().n;

// ---------------------------------------------------------------------------
// Canonical constants + copy.
// ---------------------------------------------------------------------------
{
  assert.equal(PULSE_QUESTION, "How was this experience?", "exact rider question");
  assert.deepEqual([...PULSE_VALUES], [1, 2, 3]);
  assert.deepEqual({ ...PULSE_VALUE_LABELS }, { 1: "Not good", 2: "Okay", 3: "Good" });
  assert.deepEqual([...PULSE_ACTION_CONTEXTS], ["manual", "after_save", "after_review"], "closed action_context vocab");
  assert.equal(PULSE_RATE_BUCKET_PREFIX, "experience_pulse_client:", "distinct rate namespace");
  assert.equal(PULSE_RETENTION_MONTHS, 13, "13-month raw retention");
}

// ---------------------------------------------------------------------------
// value is the one required field: exactly 1|2|3. Everything else is rejected
// and persists nothing.
// ---------------------------------------------------------------------------
{
  const db = makeDb();
  for (const v of [1, 2, 3]) {
    const p = await createExperiencePulse(db, { value: v });
    assert.equal(p.value, v);
    const row = await readExperiencePulse(db, p.id);
    assert.equal(row.value, v, `value ${v} stored`);
    assert.match(p.id, /^xp_[0-9a-f]{32}$/, "xp_ prefixed id");
  }
  assert.equal(pulseCount(db), 3);

  const before = pulseCount(db);
  for (const bad of [0, 4, 5, -1, 2.5, "good", "", " ", null, undefined, NaN, {}, [], true]) {
    await assert.rejects(() => createExperiencePulse(db, { value: bad }), (e) => {
      assert.ok(e instanceof PulseValidationError, `PulseValidationError for ${JSON.stringify(bad)}`);
      assert.equal(e.code, "invalid_value");
      return true;
    });
  }
  assert.equal(pulseCount(db), before, "no invalid value ever persisted");

  // A clean numeric string is accepted and coerced; anything else is not.
  assert.equal((await createExperiencePulse(db, { value: "2" })).value, 2, "clean numeric string accepted");
  assert.equal((await createExperiencePulse(db, { value: " 3 " })).value, 3, "surrounding whitespace tolerated");
}

// ---------------------------------------------------------------------------
// app_version is server-stamped; timestamp is server-authoritative. A client
// cannot define either.
// ---------------------------------------------------------------------------
{
  const db = makeDb();
  const p = await createExperiencePulse(db, {
    value: 3, appVersion: "9.9.9-evil", app_version: "also-evil", created_at: "1999-01-01 00:00:00",
  });
  const row = await readExperiencePulse(db, p.id);
  assert.equal(row.app_version, APP_VERSION, "canonical version stamped - client override ignored");
  assert.equal(p.appVersion, APP_VERSION);
  assert.ok(row.created_at && !row.created_at.startsWith("1999"), "server-authoritative timestamp - client value ignored");
}

// ---------------------------------------------------------------------------
// Context is forgiving: bad/absent section, route, and action_context are
// nulled, never a reason to lose the signal. A future tab is accepted with no
// allowlist. Oversized route is bounded.
// ---------------------------------------------------------------------------
{
  const db = makeDb();
  // section shape-guard + lowercase; a FUTURE canonical tab passes.
  assert.equal((await createExperiencePulse(db, { value: 2, sourceSection: "Tires" })).sourceSection, "tires");
  assert.equal((await createExperiencePulse(db, { value: 2, sourceSection: "hydration" })).sourceSection, "hydration", "future tab, no allowlist");
  assert.equal((await createExperiencePulse(db, { value: 2, sourceSection: "not a section!!" })).sourceSection, null, "junk section nulled");
  assert.equal((await createExperiencePulse(db, { value: 2, sourceSection: 123 })).sourceSection, null);

  // route: control chars stripped, blank -> null, oversize truncated.
  assert.equal((await createExperiencePulse(db, { value: 2, sourceRoute: "  /log/#review\n  " })).sourceRoute, "/log/#review");
  assert.equal((await createExperiencePulse(db, { value: 2, sourceRoute: "   " })).sourceRoute, null);
  const long = await createExperiencePulse(db, { value: 2, sourceRoute: "/x".repeat(300) });
  assert.ok(long.sourceRoute.length <= PULSE_ROUTE_MAX, "route bounded to max");

  // action_context: closed vocab; lowercased; unknown -> null; absent -> null.
  assert.equal((await createExperiencePulse(db, { value: 3, actionContext: "after_save" })).actionContext, "after_save");
  assert.equal((await createExperiencePulse(db, { value: 3, actionContext: "after_review" })).actionContext, "after_review");
  assert.equal((await createExperiencePulse(db, { value: 3, actionContext: "MANUAL" })).actionContext, "manual", "lowercased");
  assert.equal((await createExperiencePulse(db, { value: 3, actionContext: "on_login" })).actionContext, null, "out-of-vocab nulled, not fatal");
  assert.equal((await createExperiencePulse(db, { value: 3 })).actionContext, null, "absent -> null");
}

// ---------------------------------------------------------------------------
// No rider identity is required or possible: a pulse needs only a value, and
// the table has NO identity/email/ip/fingerprint columns.
// ---------------------------------------------------------------------------
{
  const db = makeDb();
  const p = await createExperiencePulse(db, { value: 1 });
  assert.ok(p.id, "a value alone yields a stored pulse");
  const cols = db.sqlite.prepare("PRAGMA table_info(feedback_experience_pulses)").all().map((c) => c.name).sort();
  assert.deepEqual(cols,
    ["action_context", "app_version", "created_at", "feedback_id", "id", "source_route", "source_section", "value"],
    "exactly the safe column set - no rider identity, email, ip, or fingerprint column exists");
}

// ---------------------------------------------------------------------------
// Optional feedback_id link: a valid existing id links; a malformed OR unknown
// id is nulled (never fatal, never a signup/profile link).
// ---------------------------------------------------------------------------
{
  const db = makeDb();
  const fb = await createFeedback(db, { body: "written explanation" });
  assert.equal((await createExperiencePulse(db, { value: 2, feedbackId: fb.id })).feedbackId, fb.id, "valid feedback id links");
  assert.equal((await createExperiencePulse(db, { value: 2, feedbackId: "nope" })).feedbackId, null, "malformed id -> null");
  assert.equal((await createExperiencePulse(db, { value: 2, feedbackId: `fb_${"a".repeat(32)}` })).feedbackId, null, "well-shaped but unknown id -> null (no FK insert failure)");
  assert.equal((await createExperiencePulse(db, { value: 2, feedbackId: 12345 })).feedbackId, null);
}

// ---------------------------------------------------------------------------
// Feedback deletion SET NULLs the pulse link; the anonymous pulse survives.
// ---------------------------------------------------------------------------
{
  const db = makeDb();
  const fb = await createFeedback(db, { body: "will be purged" });
  const p = await createExperiencePulse(db, { value: 3, feedbackId: fb.id });
  assert.equal((await readExperiencePulse(db, p.id)).feedback_id, fb.id);
  db.sqlite.prepare("DELETE FROM feedback_submissions WHERE id = ?").run(fb.id);
  const row = await readExperiencePulse(db, p.id);
  assert.ok(row, "pulse survives its linked feedback's deletion");
  assert.equal(row.feedback_id, null, "link SET NULL on feedback deletion");
}

// ---------------------------------------------------------------------------
// 13-month retention, integrated into the worker sweep. Old pulses purge;
// recent pulses survive.
// ---------------------------------------------------------------------------
{
  const db = makeDb();
  const recent = await createExperiencePulse(db, { value: 3 });
  db.sqlite.prepare("INSERT INTO feedback_experience_pulses (id, value, app_version, created_at) VALUES (?, ?, ?, datetime('now','-14 months'))")
    .run("xp_old0000000000000000000000000000", 1, APP_VERSION);
  const { runRetentionSweep } = await import("../src/waitlist-worker.js");
  const swept = await runRetentionSweep(db);
  assert.equal(swept.experience_pulses_purged, 1, "exactly the >13mo pulse purged");
  assert.ok(await readExperiencePulse(db, recent.id), "recent pulse retained");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM feedback_experience_pulses WHERE id='xp_old0000000000000000000000000000'").get().n, 0, "old pulse purged");
}

// ---------------------------------------------------------------------------
// Retention guard: on a database where migration 0010 has NOT been applied
// (staged rollout: code can precede the migration), the sweep must not throw -
// there are simply no pulses to purge yet.
// ---------------------------------------------------------------------------
{
  const db = makeDb(THROUGH_0009);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='feedback_experience_pulses'").get().n, 0, "pulse table absent");
  const { runRetentionSweep } = await import("../src/waitlist-worker.js");
  let summary;
  await assert.doesNotReject(async () => { summary = await runRetentionSweep(db); }, "sweep tolerates a missing pulse table");
  assert.equal(summary.experience_pulses_purged, 0, "no pulses purged when the table is absent");
}

// ---------------------------------------------------------------------------
// Structural separation: the service holds no email/GitHub/identity surface,
// and the schema couples to nothing but feedback_submissions (SET NULL), never
// a signup or profile.
// ---------------------------------------------------------------------------
{
  const svc = readFileSync(join(import.meta.dirname, "..", "src", "experience-pulse-service.js"), "utf8");
  for (const marker of ["WAITLIST_EMAIL", "EmailMessage", "waitlist_email_deliveries", "api.github.com", "GITHUB_TOKEN", "Authorization", "cf-connecting-ip"]) {
    assert.ok(!svc.includes(marker), `pulse service must not reference ${marker}`);
  }
  const mig = readFileSync(join(import.meta.dirname, "..", "migrations", "0010_experience_pulse.sql"), "utf8");
  assert.ok(!mig.includes("waitlist_signups"), "pulse schema does not couple to waitlist_signups");
  assert.ok(!/REFERENCES\s+(rider_profiles|waitlist_signups)/i.test(mig), "no FK into signup/profile");
  assert.match(mig, /feedback_id\s+TEXT\s+REFERENCES\s+feedback_submissions\(id\)\s+ON\s+DELETE\s+SET\s+NULL/i, "only optional feedback link, SET NULL");
}

console.log("experience-pulse.test.js passed");
