import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  APPROVAL_STATE_VALUES, APPROVAL_STATE_LABELS, APPROVAL_REASON_MAX_LENGTH,
  INTERNATIONAL_APPROVAL_REFUSAL, ApprovalValidationError,
  normalizeReason, reasonRequiredFor,
  readApprovalState, readApprovalHistory, changeApprovalState,
} from "../src/waitlist-admin-service.js";

// Beta approvals - #49 PR 1: schema, approval service, atomic audit history.
// No routes, no Admin HTML, no auth plumbing, no email. Every owner ruling
// from the approved #49 design is asserted here.
//
// NOTE on scope of proof: this harness is in-memory SQLite with sequential
// JS. It proves the guarded-batch STRUCTURE (shared precondition, both-or-
// neither, conflict without trace), not real deployed-D1 concurrency; the
// real-D1 operator concurrency proof is a PR 4 staging item.

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
  // Mirrors D1: a batch is one transaction - all statements commit, or none.
  async batch(statements) {
    this.sqlite.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }
}

const MIGRATIONS = [
  "0001_waitlist.sql", "0002_program_track.sql", "0003_resubscription_evidence.sql",
  "0004_rider_profiles.sql", "0005_profile_edit_authorizations.sql",
  "0006_profile_consent_events.sql", "0007_profile_invitation_batches.sql",
  "0008_beta_approvals.sql",
];
const db = new LocalD1();
for (const m of MIGRATIONS) db.sqlite.exec(readFileSync(join(import.meta.dirname, "..", "migrations", m), "utf8"));

const row = (sql, ...args) => db.sqlite.prepare(sql).get(...args);
const count = (sql, ...args) => row(sql, ...args).n;
const eventCount = (id) => count("SELECT COUNT(*) AS n FROM waitlist_beta_approval_events WHERE signup_id = ?", id);
const seed = (id, email, status, track = "us_beta_waitlist") =>
  db.sqlite.prepare(`INSERT INTO waitlist_signups (id, email_normalized, country_code, program_track, status,
    consent_at, consent_copy_version, privacy_notice_version)
    VALUES (?, ?, 'US', ?, ?, datetime('now'), '2026-08-05.2', '2026-08-05.2')`).run(id, email, track, status);

seed("s_us", "us-rider@example.com", "confirmed");
seed("s_intl", "intl-rider@example.com", "confirmed", "international_interest");
seed("s_pending", "pending@example.com", "pending");
seed("s_purge", "purge-me@example.com", "confirmed");

const OP_A = "operator-a@example.test";
const OP_B = "operator-b@example.test";
const change = (overrides) => changeApprovalState(db, {
  signupId: "s_us", expectedState: "awaiting_review", newState: "approved", actor: OP_A, ...overrides,
});
const rejects = async (overrides, code) => {
  await assert.rejects(change(overrides), (e) => e instanceof ApprovalValidationError && e.code === code,
    `expected ApprovalValidationError ${code}`);
};

// ---------------------------------------------------------------------------
// Constants and labels are exactly the ruled values.
// ---------------------------------------------------------------------------
{
  assert.deepEqual([...APPROVAL_STATE_VALUES], ["awaiting_review", "approved", "hold", "not_approved"]);
  assert.deepEqual({ ...APPROVAL_STATE_LABELS }, {
    awaiting_review: "Awaiting review", approved: "Approved", hold: "Hold", not_approved: "Not approved",
  });
  assert.equal(APPROVAL_REASON_MAX_LENGTH, 280);
  assert.equal(INTERNATIONAL_APPROVAL_REFUSAL,
    "International-interest registration does not currently represent eligibility for MotoTrack beta access.");
}

// ---------------------------------------------------------------------------
// Default-by-absence: never-reviewed reads as effective awaiting_review with
// everReviewed=false, and nothing was backfilled by the migration.
// ---------------------------------------------------------------------------
{
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_beta_approvals"), 0, "no backfill on migration");
  const state = await readApprovalState(db, "s_us");
  assert.deepEqual(state, {
    signupId: "s_us", programTrack: "us_beta_waitlist",
    effectiveState: "awaiting_review", everReviewed: false, updatedAt: null, updatedBy: null,
  });
  assert.deepEqual(await readApprovalHistory(db, "s_us"), []);
  await assert.rejects(readApprovalState(db, "nope"),
    (e) => e instanceof ApprovalValidationError && e.code === "unknown_signup");
}

// ---------------------------------------------------------------------------
// First decision: awaiting_review -> approved. Event carries the EFFECTIVE
// previous state even though no row existed; row appears; everReviewed flips.
// ---------------------------------------------------------------------------
{
  const applied = await change({});
  assert.deepEqual(applied, {
    ok: true, signupId: "s_us", previousState: "awaiting_review", newState: "approved",
    actor: OP_A, reason: null,
  });
  const state = await readApprovalState(db, "s_us");
  assert.equal(state.effectiveState, "approved");
  assert.equal(state.everReviewed, true);
  assert.equal(state.updatedBy, OP_A);
  const [event] = await readApprovalHistory(db, "s_us");
  assert.equal(event.previous_state, "awaiting_review");
  assert.equal(event.new_state, "approved");
  assert.equal(event.actor, OP_A);
  assert.equal(event.reason, null);
  assert.ok(event.occurred_at);
  assert.equal(eventCount("s_us"), 1);
}

// ---------------------------------------------------------------------------
// The ruled transition walk, including both reversals and the deliberate
// return to the queue. Every applied transition appends exactly one event.
// ---------------------------------------------------------------------------
{
  const walk = [
    { expectedState: "approved", newState: "hold", reason: "Capacity review under way" },
    { expectedState: "hold", newState: "approved" },
    { expectedState: "approved", newState: "not_approved", reason: "Duplicate of another signup" },
    { expectedState: "not_approved", newState: "approved", reason: "Duplicate claim was wrong - reinstated" },
    { expectedState: "approved", newState: "awaiting_review" },
  ];
  for (const step of walk) assert.equal((await change(step)).ok, true, `${step.expectedState} -> ${step.newState}`);
  assert.equal(eventCount("s_us"), 1 + walk.length);

  // Explicit stored awaiting_review is distinguishable from never-reviewed.
  const state = await readApprovalState(db, "s_us");
  assert.equal(state.effectiveState, "awaiting_review");
  assert.equal(state.everReviewed, true, "returned-to-queue is NOT the same as never reviewed");

  // History is ordered by event_seq DESC, deterministically.
  const history = await readApprovalHistory(db, "s_us");
  assert.deepEqual(history.map((e) => e.new_state),
    ["awaiting_review", "approved", "not_approved", "approved", "hold", "approved"]);
  const seqs = history.map((e) => e.event_seq);
  assert.deepEqual([...seqs].sort((a, b) => b - a), seqs, "newest first by event_seq");
}

// ---------------------------------------------------------------------------
// No-op ruling: re-selecting the current effective state mutates nothing,
// appends nothing, and says so - including on a never-reviewed record.
// ---------------------------------------------------------------------------
{
  const before = eventCount("s_us");
  const noop = await change({ expectedState: "awaiting_review", newState: "awaiting_review" });
  assert.deepEqual(noop, { ok: false, code: "no_change" });
  assert.equal(eventCount("s_us"), before, "no audit event for a no-op");

  const neverReviewed = await changeApprovalState(db, {
    signupId: "s_pending", expectedState: "awaiting_review", newState: "awaiting_review", actor: OP_A,
  });
  assert.deepEqual(neverReviewed, { ok: false, code: "no_change" });
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_beta_approvals WHERE signup_id = 's_pending'"), 0);
}

// ---------------------------------------------------------------------------
// International restriction: approved is refused at the service layer with
// the exact ruled wording; the other three states remain available.
// ---------------------------------------------------------------------------
{
  await assert.rejects(
    changeApprovalState(db, { signupId: "s_intl", expectedState: "awaiting_review", newState: "approved", actor: OP_A }),
    (e) => e instanceof ApprovalValidationError && e.code === "international_not_eligible"
      && e.message === INTERNATIONAL_APPROVAL_REFUSAL);
  assert.equal(eventCount("s_intl"), 0, "a refused approval leaves no trace");

  assert.equal((await changeApprovalState(db, {
    signupId: "s_intl", expectedState: "awaiting_review", newState: "hold", actor: OP_A,
    reason: "Regional availability not yet decided",
  })).ok, true);
  assert.equal((await changeApprovalState(db, {
    signupId: "s_intl", expectedState: "hold", newState: "not_approved", actor: OP_A,
    reason: "Region remains outside the beta",
  })).ok, true);
  assert.equal((await changeApprovalState(db, {
    signupId: "s_intl", expectedState: "not_approved", newState: "awaiting_review", actor: OP_A,
    reason: "Re-queueing for the next regional review",
  })).ok, true);
  // Still refused later in the lifecycle, not just from the default state.
  await assert.rejects(
    changeApprovalState(db, { signupId: "s_intl", expectedState: "awaiting_review", newState: "approved", actor: OP_A }),
    (e) => e.code === "international_not_eligible");
}

// ---------------------------------------------------------------------------
// Reason policy, exactly as ruled.
// ---------------------------------------------------------------------------
{
  // Matrix: required into hold, into not_approved, and OUT of not_approved.
  assert.equal(reasonRequiredFor("awaiting_review", "hold"), true);
  assert.equal(reasonRequiredFor("approved", "not_approved"), true);
  assert.equal(reasonRequiredFor("not_approved", "approved"), true);
  assert.equal(reasonRequiredFor("not_approved", "awaiting_review"), true);
  assert.equal(reasonRequiredFor("awaiting_review", "approved"), false);
  assert.equal(reasonRequiredFor("approved", "awaiting_review"), false);
  assert.equal(reasonRequiredFor("hold", "approved"), false);

  // Required means required - absent and whitespace-only both refuse.
  await rejects({ expectedState: "awaiting_review", newState: "hold" }, "reason_required");
  await rejects({ expectedState: "awaiting_review", newState: "hold", reason: "   \n\t " }, "reason_required");
  await rejects({ expectedState: "awaiting_review", newState: "not_approved" }, "reason_required");

  // Length cap at exactly 280 after normalization.
  await rejects({ expectedState: "awaiting_review", newState: "hold", reason: "x".repeat(281) }, "reason_too_long");

  // Normalization: CRLF/CR become LF, edges trimmed, interior preserved.
  assert.equal(normalizeReason("  line one\r\nline two\r三  "), "line one\nline two\n三");
  assert.equal(normalizeReason(null), null);
  assert.equal(normalizeReason("   "), null);
  const applied = await change({
    expectedState: "awaiting_review", newState: "hold", reason: "  needs a second look\r\nbefore the next batch  ",
  });
  assert.equal(applied.reason, "needs a second look\nbefore the next batch");
  assert.equal(row("SELECT reason FROM waitlist_beta_approval_events WHERE event_seq = (SELECT MAX(event_seq) FROM waitlist_beta_approval_events)").reason,
    "needs a second look\nbefore the next batch");
  // Reset for later blocks.
  assert.equal((await change({ expectedState: "hold", newState: "awaiting_review" })).ok, true);
}

// ---------------------------------------------------------------------------
// Input validation: states, actor, signup.
// ---------------------------------------------------------------------------
{
  await rejects({ expectedState: "reviewing", newState: "approved" }, "invalid_state");
  await rejects({ expectedState: "awaiting_review", newState: "rejected" }, "invalid_state");
  await rejects({ signupId: "ghost" }, "unknown_signup");
  await rejects({ actor: "" }, "invalid_actor");
  await rejects({ actor: "ab" }, "invalid_actor");
  await rejects({ actor: "a".repeat(255) }, "invalid_actor");
  await rejects({ actor: undefined }, "invalid_actor");
  // Actor is trimmed before storage.
  const applied = await change({ actor: `  ${OP_B}  ` });
  assert.equal(applied.actor, OP_B);
  assert.equal((await readApprovalState(db, "s_us")).updatedBy, OP_B);
  assert.equal((await change({ expectedState: "approved", newState: "awaiting_review", actor: OP_B })).ok, true);
}

// ---------------------------------------------------------------------------
// Optimistic concurrency: the loser makes no state change, appends no event,
// and is told to reload. Nothing silently last-write-wins.
// ---------------------------------------------------------------------------
{
  // Both operators observed awaiting_review. A decides first.
  assert.equal((await change({ actor: OP_A })).ok, true); // awaiting_review -> approved
  const before = eventCount("s_us");
  const stateBefore = (await readApprovalState(db, "s_us")).effectiveState;

  // B still believes awaiting_review and tries to put the record on hold.
  const lost = await change({ expectedState: "awaiting_review", newState: "hold", actor: OP_B, reason: "stale view" });
  assert.deepEqual(lost, { ok: false, code: "conflict" });
  assert.equal(eventCount("s_us"), before, "the losing operation appends no audit event");
  assert.equal((await readApprovalState(db, "s_us")).effectiveState, stateBefore, "state unchanged by the loser");
  assert.equal((await readApprovalState(db, "s_us")).updatedBy, OP_A, "winner's attribution survives");

  // B reloads, sees approved, and their decision now applies cleanly.
  const retried = await change({ expectedState: "approved", newState: "hold", actor: OP_B, reason: "capacity pause" });
  assert.equal(retried.ok, true);
  assert.equal((await readApprovalState(db, "s_us")).effectiveState, "hold");
}

// ---------------------------------------------------------------------------
// Atomicity: the audit insert and the state write ride one batch - a failure
// in the second statement rolls the first back out. Forced by violating the
// current-state CHECK via a hostile in-flight schema trick is not possible
// through the public surface, so this asserts the invariant the cheap way:
// every row in waitlist_beta_approvals is explained by its event trail, and
// event counts match applied transitions exactly (asserted throughout above).
// Belt-and-braces: a batch whose second statement throws leaves no event.
// ---------------------------------------------------------------------------
{
  const before = eventCount("s_us");
  await assert.rejects(db.batch([
    db.prepare("INSERT INTO waitlist_beta_approval_events (signup_id, previous_state, new_state, actor) VALUES ('s_us', 'hold', 'approved', 'atomicity-probe@example.test')").bind(),
    db.prepare("INSERT INTO waitlist_beta_approvals (signup_id, state, updated_by) VALUES ('s_us', 'INVALID', 'x')").bind(),
  ]));
  assert.equal(eventCount("s_us"), before, "a failed batch leaves no orphan audit event");
}

// ---------------------------------------------------------------------------
// Append-only enforcement in the schema itself.
// ---------------------------------------------------------------------------
{
  assert.throws(() => db.sqlite.exec("UPDATE waitlist_beta_approval_events SET reason = 'rewritten' WHERE event_seq = 1"),
    /append-only/);
  assert.throws(() => db.sqlite.exec("UPDATE waitlist_beta_approval_events SET actor = 'forged@example.test'"),
    /append-only/);
  // The schema's own integrity rails.
  assert.throws(() => db.sqlite.exec(
    "INSERT INTO waitlist_beta_approval_events (signup_id, previous_state, new_state, actor) VALUES ('s_us', 'approved', 'approved', 'x@example.test')"),
    /CHECK/i, "previous_state <> new_state is a schema constraint");
  assert.throws(() => db.sqlite.exec(
    "INSERT INTO waitlist_beta_approval_events (signup_id, previous_state, new_state, actor) VALUES ('missing', 'approved', 'hold', 'x@example.test')"),
    /FOREIGN KEY/i);
}

// ---------------------------------------------------------------------------
// Retention: the parent purge cascades through BOTH approval tables (the
// 0005 regression class), via the real sweep, with live approval rows.
// ---------------------------------------------------------------------------
{
  // Give the doomed signup a decision history and age it past the ceiling.
  assert.equal((await changeApprovalState(db, {
    signupId: "s_purge", expectedState: "awaiting_review", newState: "not_approved", actor: OP_A,
    reason: "Synthetic retention fixture",
  })).ok, true);
  db.sqlite.exec("UPDATE waitlist_signups SET confirmed_at = datetime('now', '-25 months'), consent_at = datetime('now', '-25 months') WHERE id = 's_purge'");

  const { runRetentionSweep } = await import("../src/waitlist-worker.js");
  await runRetentionSweep(db);

  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_signups WHERE id = 's_purge'"), 0, "aged signup purged");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_beta_approvals WHERE signup_id = 's_purge'"), 0,
    "approval state cascades with the signup purge");
  assert.equal(eventCount("s_purge"), 0, "approval history cascades with the signup purge");
  // And the sweep did not touch anyone else's approval data.
  assert.ok((await readApprovalHistory(db, "s_us")).length > 0);
  assert.equal(count(`SELECT COUNT(*) AS n FROM waitlist_beta_approval_events e
    LEFT JOIN waitlist_signups s ON s.id = e.signup_id WHERE s.id IS NULL`), 0, "no orphaned events (FK clean)");
}

// ---------------------------------------------------------------------------
// Axis independence: the whole suite above never moved any other rider axis.
// ---------------------------------------------------------------------------
{
  const us = { ...row("SELECT status, program_track, unsubscribed_at FROM waitlist_signups WHERE id = 's_us'") };
  assert.deepEqual(us, { status: "confirmed", program_track: "us_beta_waitlist", unsubscribed_at: null });
  const intl = { ...row("SELECT status, program_track, unsubscribed_at FROM waitlist_signups WHERE id = 's_intl'") };
  assert.deepEqual(intl, { status: "confirmed", program_track: "international_interest", unsubscribed_at: null });
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profile_consent_events"), 0);
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profiles"), 0);
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_email_deliveries"), 0, "zero email side effects");
}

// ---------------------------------------------------------------------------
// Structural invariants: the service can neither send email nor be reached -
// it references no email surface, and the Worker does not reference it (there
// are no admin routes in PR 1).
// ---------------------------------------------------------------------------
{
  const serviceSource = readFileSync(join(import.meta.dirname, "..", "src", "waitlist-admin-service.js"), "utf8");
  for (const marker of ["WAITLIST_EMAIL", "EmailMessage", "sendEmail", "waitlist_email_deliveries", "waitlist-tokens"]) {
    assert.ok(!serviceSource.includes(marker), `approval service must not reference ${marker}`);
  }
  // The Worker reaches admin functionality through the routes module only,
  // and the routes module mutates approval state ONLY through the service:
  // it contains no SQL against the approval tables, so no route can write
  // a decision without the service's transition/reason/atomicity rules.
  const workerSource = readFileSync(join(import.meta.dirname, "..", "src", "waitlist-worker.js"), "utf8");
  assert.ok(!workerSource.includes("waitlist-admin-service"),
    "the Worker must not import the approval service directly - only the admin routes module may");
  const routesSource = readFileSync(join(import.meta.dirname, "..", "src", "waitlist-admin-routes.js"), "utf8");
  assert.ok(!routesSource.includes("waitlist_beta_approval"),
    "admin routes must never touch the approval tables directly - mutation goes through the service only");
}

console.log("waitlist-beta-approval.test.js passed");
