import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { APP_VERSION } from "../src/app-version.js";
import {
  createFeedback, readFeedback, readFeedbackHistory, listFeedback,
  normalizeText, FeedbackValidationError,
  FEEDBACK_STATES, FEEDBACK_CLOSURE_REASONS, FEEDBACK_BODY_MAX,
  FEEDBACK_PROMPT, FEEDBACK_EMAIL_PROMPT, FEEDBACK_SUCCESS,
} from "../src/feedback-service.js";

// MotoTrack Feedback #55 PR 1: schema + intake service + triage-read contract.
// No routes, no UI, no GitHub, no admin, no email. Every owner ruling that is
// expressible at the data/service layer is asserted here. Migration is NOT
// applied to any remote database.

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

const MIGRATIONS = [
  "0001_waitlist.sql", "0002_program_track.sql", "0003_resubscription_evidence.sql",
  "0004_rider_profiles.sql", "0005_profile_edit_authorizations.sql",
  "0006_profile_consent_events.sql", "0007_profile_invitation_batches.sql",
  "0008_beta_approvals.sql", "0009_feedback.sql",
];
const db = new LocalD1();
for (const m of MIGRATIONS) db.sqlite.exec(readFileSync(join(import.meta.dirname, "..", "migrations", m), "utf8"));
const row = (sql, ...a) => db.sqlite.prepare(sql).get(...a);
const count = (sql, ...a) => row(sql, ...a).n;

// ---------------------------------------------------------------------------
// Canonical version + copy constants.
// ---------------------------------------------------------------------------
{
  assert.match(APP_VERSION, /^\d+\.\d+\.\d+$/, "canonical app version is a single semver-shaped constant");
  assert.deepEqual([...FEEDBACK_STATES], ["new", "reviewing", "actionable", "closed"]);
  assert.deepEqual([...FEEDBACK_CLOSURE_REASONS], ["resolved", "duplicate", "not_actionable", "spam"]);
  assert.equal(FEEDBACK_PROMPT, "How can we make MotoTrack better?");
  assert.ok(FEEDBACK_EMAIL_PROMPT.startsWith("Want us to follow up?"));
  assert.equal(FEEDBACK_SUCCESS, "Thanks for the feedback.");
  // The canonical version is the ONLY version registry: the service module
  // imports it and never hard-codes a literal version string of its own.
  const svc = readFileSync(join(import.meta.dirname, "..", "src", "feedback-service.js"), "utf8");
  assert.ok(svc.includes('from "./app-version.js"'), "service reads the canonical version, not a private copy");
  assert.ok(!/["'`]\d+\.\d+\.\d+["'`]/.test(svc), "no second version literal in the service");
}

// ---------------------------------------------------------------------------
// Intake: body-only is enough; app_version stamped server-side; timestamp
// server-authoritative; NO event on intake.
// ---------------------------------------------------------------------------
{
  const res = await createFeedback(db, { body: "  Tire pressures screen could show a delta  " });
  assert.match(res.id, /^fb_[0-9a-f]{32}$/);
  assert.equal(res.triageState, "new");
  assert.equal(res.appVersion, APP_VERSION);
  assert.equal(res.hasContactEmail, false);
  const stored = await readFeedback(db, res.id);
  assert.equal(stored.body, "Tire pressures screen could show a delta", "body trimmed, stored verbatim otherwise");
  assert.equal(stored.contact_email, null);
  assert.equal(stored.app_version, APP_VERSION, "server-stamped canonical version");
  assert.equal(stored.triage_state, "new");
  assert.ok(stored.created_at, "server-authoritative timestamp");
  assert.equal(count("SELECT COUNT(*) AS n FROM feedback_events WHERE feedback_id=?", res.id), 0, "intake writes NO event");
}

// ---------------------------------------------------------------------------
// app_version is NEVER rider-supplied: a client value is ignored.
// ---------------------------------------------------------------------------
{
  const res = await createFeedback(db, { body: "spoof attempt", appVersion: "9.9.9-evil", app_version: "8.8.8" });
  assert.equal((await readFeedback(db, res.id)).app_version, APP_VERSION, "client-supplied version ignored");
}

// ---------------------------------------------------------------------------
// Context capture: section is bounded free text (future tabs pass), route is
// bounded, both nulled-not-fatal when junk; a NEW future section is accepted.
// ---------------------------------------------------------------------------
{
  const ok = await createFeedback(db, { body: "b", sourceSection: "Tires", sourceRoute: "/log/#tires" });
  const s = await readFeedback(db, ok.id);
  assert.equal(s.source_section, "tires", "section lowercased");
  assert.equal(s.source_route, "/log/#tires");

  // A future canonical tab with no migration and no code change is valid.
  const future = await createFeedback(db, { body: "b", sourceSection: "hydration" });
  assert.equal((await readFeedback(db, future.id)).source_section, "hydration");

  // Junk section -> null, feedback still accepted (forgiving intake).
  const junk = await createFeedback(db, { body: "b", sourceSection: "<script>alert(1)</script>" });
  assert.equal((await readFeedback(db, junk.id)).source_section, null);

  // Oversized route -> bounded, not rejected.
  const longRoute = await createFeedback(db, { body: "b", sourceRoute: "/x".repeat(300) });
  assert.ok((await readFeedback(db, longRoute.id)).source_route.length <= 200);
}

// ---------------------------------------------------------------------------
// Body validation + normalization.
// ---------------------------------------------------------------------------
{
  await assert.rejects(createFeedback(db, { body: "   " }),
    (e) => e instanceof FeedbackValidationError && e.code === "body_required");
  await assert.rejects(createFeedback(db, {}),
    (e) => e instanceof FeedbackValidationError && e.code === "body_required");
  await assert.rejects(createFeedback(db, { body: "x".repeat(FEEDBACK_BODY_MAX + 1) }),
    (e) => e instanceof FeedbackValidationError && e.code === "body_too_long");
  // CRLF folded, control chars stripped, newline/tab kept.
  assert.equal(normalizeText("  a\r\nb\x00\x07\tc  "), "a\nb\tc");
  const at = await createFeedback(db, { body: "exactly-max-" + "y".repeat(FEEDBACK_BODY_MAX - 12) });
  assert.equal((await readFeedback(db, at.id)).body.length, FEEDBACK_BODY_MAX, "exactly at the cap is allowed");
}

// ---------------------------------------------------------------------------
// Optional email: absent -> null accepted; valid -> normalized; malformed ->
// rejected (rider who wants follow-up is told, not silently dropped).
// ---------------------------------------------------------------------------
{
  const none = await createFeedback(db, { body: "b", contactEmail: "   " });
  assert.equal((await readFeedback(db, none.id)).contact_email, null);
  const good = await createFeedback(db, { body: "b", contactEmail: "  Rider@Example.COM " });
  assert.equal((await readFeedback(db, good.id)).contact_email, "rider@example.com");
  for (const bad of ["nope", "a@b", "@x.io", "a b@x.io"]) {
    await assert.rejects(createFeedback(db, { body: "b", contactEmail: bad }),
      (e) => e instanceof FeedbackValidationError && e.code === "invalid_email", `rejects ${bad}`);
  }
}

// ---------------------------------------------------------------------------
// Schema rails (direct SQL): triage-state enum, closure coherence, duplicate
// rules, promotion coherence, event immutability + FK cascade.
// ---------------------------------------------------------------------------
{
  const mk = (sql) => () => db.sqlite.exec(sql);
  // invalid state
  assert.throws(mk("INSERT INTO feedback_submissions (id,body,app_version,triage_state) VALUES ('x1','b','1.0.0','archived')"), /CHECK/i);
  // closed requires closure_reason AND closed_at
  assert.throws(mk("INSERT INTO feedback_submissions (id,body,app_version,triage_state) VALUES ('x2','b','1.0.0','closed')"), /CHECK/i);
  // closure_reason without closed state
  assert.throws(mk("INSERT INTO feedback_submissions (id,body,app_version,triage_state,closure_reason,closed_at) VALUES ('x3','b','1.0.0','new','spam',datetime('now'))"), /CHECK/i);
  // duplicate_of requires duplicate reason
  db.sqlite.exec("INSERT INTO feedback_submissions (id,body,app_version,triage_state,closure_reason,closed_at) VALUES ('orig','b','1.0.0','closed','resolved',datetime('now'))");
  assert.throws(mk("INSERT INTO feedback_submissions (id,body,app_version,triage_state,closure_reason,closed_at,duplicate_of_feedback_id) VALUES ('d1','b','1.0.0','closed','resolved',datetime('now'),'orig')"), /CHECK/i);
  // valid duplicate closure
  db.sqlite.exec("INSERT INTO feedback_submissions (id,body,app_version,triage_state,closure_reason,closed_at,duplicate_of_feedback_id) VALUES ('d2','b','1.0.0','closed','duplicate',datetime('now'),'orig')");
  // self-duplicate forbidden
  assert.throws(mk("UPDATE feedback_submissions SET duplicate_of_feedback_id='d2' WHERE id='d2'"), /CHECK/i);
  // partial promotion forbidden
  assert.throws(mk("UPDATE feedback_submissions SET github_issue_number=5 WHERE id='orig'"), /CHECK/i);
  // coherent promotion allowed
  db.sqlite.exec("UPDATE feedback_submissions SET github_repo='PatchnetEvan/track-helper', github_issue_number=5, promoted_at=datetime('now'), promoted_by='op@example.test' WHERE id='orig'");

  // events append-only + FK
  db.sqlite.exec("INSERT INTO feedback_events (feedback_id,event_type,actor) VALUES ('orig','state_changed','op@example.test')");
  assert.throws(mk("UPDATE feedback_events SET actor='forged@example.test' WHERE feedback_id='orig'"), /append-only/);
  assert.throws(mk("INSERT INTO feedback_events (feedback_id,event_type,actor) VALUES ('orig','frowned','op@example.test')"), /CHECK/i);
  assert.throws(mk("INSERT INTO feedback_events (feedback_id,event_type,actor) VALUES ('ghost','state_changed','op@example.test')"), /FOREIGN KEY/i);
}

// ---------------------------------------------------------------------------
// listFeedback: bounded, escaped search, closed-vocab filter, snippet + email
// indicator only (no raw email in the queue), no N+1.
// ---------------------------------------------------------------------------
{
  const fresh = new LocalD1();
  for (const m of MIGRATIONS) fresh.sqlite.exec(readFileSync(join(import.meta.dirname, "..", "migrations", m), "utf8"));
  for (let i = 0; i < 3; i += 1) await createFeedback(fresh, { body: `queue item ${i}`, contactEmail: i === 0 ? "a@b.co" : undefined });
  const all = await listFeedback(fresh, {});
  assert.equal(all.feedback.length, 3);
  assert.ok(all.feedback.every((f) => f.triageState === "new"));
  assert.ok(!("contact_email" in all.feedback[0]) && "hasContactEmail" in all.feedback[0], "queue exposes only an email indicator");
  assert.equal(all.feedback.filter((f) => f.hasContactEmail).length, 1);
  assert.ok(all.feedback[0].bodySnippet.startsWith("queue item"));
  // filter + bounded pagination
  assert.equal((await listFeedback(fresh, { state: "closed" })).feedback.length, 0);
  await assert.rejects(listFeedback(fresh, { state: "bogus" }), (e) => e.code === "invalid_filter");
  const page = await listFeedback(fresh, { limit: 2 });
  assert.equal(page.feedback.length, 2);
  assert.equal(page.hasMore, true);
  assert.equal((await listFeedback(fresh, { limit: 100000 })).limit, 100, "page size clamped");
  // escaped LIKE: % is a literal, injection can't reach SQL
  assert.equal((await listFeedback(fresh, { search: "%" })).feedback.length, 0);
  assert.equal((await listFeedback(fresh, { search: "queue item 1" })).feedback.length, 1);
  assert.equal((await listFeedback(fresh, { search: "'; DROP TABLE feedback_submissions;--" })).feedback.length, 0);
  assert.equal(fresh.sqlite.prepare("SELECT COUNT(*) AS n FROM feedback_submissions").get().n, 3, "injection never reached SQL");
}

// ---------------------------------------------------------------------------
// Retention: closed >12mo purged via the real sweep, events cascade, active
// feedback and recently-closed feedback survive.
// ---------------------------------------------------------------------------
{
  const r = new LocalD1();
  for (const m of MIGRATIONS) r.sqlite.exec(readFileSync(join(import.meta.dirname, "..", "migrations", m), "utf8"));
  const active = await createFeedback(r, { body: "active - keep" });
  const recentClosed = await createFeedback(r, { body: "recently closed - keep" });
  const oldClosed = await createFeedback(r, { body: "old closed - purge" });
  r.sqlite.exec(`UPDATE feedback_submissions SET triage_state='closed', closure_reason='resolved', closed_at=datetime('now','-2 months') WHERE id='${recentClosed.id}'`);
  r.sqlite.exec(`UPDATE feedback_submissions SET triage_state='closed', closure_reason='resolved', closed_at=datetime('now','-13 months') WHERE id='${oldClosed.id}'`);
  r.sqlite.exec(`INSERT INTO feedback_events (feedback_id,event_type,actor) VALUES ('${oldClosed.id}','state_changed','op@example.test')`);

  const { runRetentionSweep } = await import("../src/waitlist-worker.js");
  const swept = await runRetentionSweep(r);
  assert.equal(swept.feedback_purged, 1, "exactly the >12mo closed record purged");
  assert.ok(await readFeedback(r, active.id), "active feedback retained");
  assert.ok(await readFeedback(r, recentClosed.id), "recently-closed feedback retained");
  assert.equal(await readFeedback(r, oldClosed.id), null, "old closed feedback purged");
  assert.equal(r.sqlite.prepare(`SELECT COUNT(*) AS n FROM feedback_events WHERE feedback_id='${oldClosed.id}'`).get().n, 0, "event history cascaded with the parent");
  const orphans = r.sqlite.prepare("SELECT COUNT(*) AS n FROM feedback_events e LEFT JOIN feedback_submissions s ON s.id=e.feedback_id WHERE s.id IS NULL").get().n;
  assert.equal(orphans, 0, "no orphaned events");
}

// ---------------------------------------------------------------------------
// Separation + no email/GitHub surface in the service.
// ---------------------------------------------------------------------------
{
  const svc = readFileSync(join(import.meta.dirname, "..", "src", "feedback-service.js"), "utf8");
  for (const marker of ["WAITLIST_EMAIL", "EmailMessage", "waitlist_email_deliveries", "api.github.com", "GITHUB_TOKEN", "Authorization"]) {
    assert.ok(!svc.includes(marker), `feedback service must not reference ${marker}`);
  }
  // Feedback tables are independent of waitlist_signups (no FK into it).
  const mig = readFileSync(join(import.meta.dirname, "..", "migrations", "0009_feedback.sql"), "utf8");
  assert.ok(!mig.includes("waitlist_signups"), "feedback schema does not couple to waitlist_signups");
}

console.log("feedback.test.js passed");
