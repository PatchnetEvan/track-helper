import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runRetentionSweep } from "../src/waitlist-worker.js";
import { issueProfileInvitation } from "../src/waitlist-profile-service.js";
import {
  previewProfileInvitationBatch, executeProfileInvitationBatch,
  sweepProfileInvitationBatches, BATCH_MAX_RECIPIENTS,
} from "../src/waitlist-profile-batch.js";

// Rider profile PR 4: the operator-triggered existing-user invitation batch.
// Implementation only - nothing in the deployed Worker calls this module, so
// PR 4 cannot send a real staging or production invitation.

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
    catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }
}

const MIGRATIONS = ["0001_waitlist.sql", "0002_program_track.sql", "0003_resubscription_evidence.sql",
  "0004_rider_profiles.sql", "0005_profile_edit_authorizations.sql", "0006_profile_consent_events.sql",
  "0007_profile_invitation_batches.sql"];
const freshDb = () => {
  const db = new LocalD1();
  for (const m of MIGRATIONS) db.sqlite.exec(readFileSync(join(import.meta.dirname, "..", "migrations", m), "utf8"));
  return db;
};

const ORIGIN = "https://mototrack.app";
const ENABLED = { WAITLIST_PROFILE_ENABLED: "true" };
const capturingProvider = () => {
  const sent = [];
  return { sent, async send(message) { sent.push(message); return { status: "test_capture" }; } };
};

let db = freshDb();
const row = (sql, ...args) => db.sqlite.prepare(sql).get(...args);
const count = (sql, ...args) => row(sql, ...args).n;
const rows = (sql, ...args) => db.sqlite.prepare(sql).all(...args).map((r) => ({ ...r }));

// confirmed_at is staged so deterministic ordering is observable.
const seed = (id, email, status, confirmedOffsetDays, extra = {}) => {
  db.sqlite.prepare(`INSERT INTO waitlist_signups (id, email_normalized, country_code, program_track, status,
    consent_at, confirmed_at, unsubscribed_at, resubscribed_at, consent_copy_version, privacy_notice_version)
    VALUES (?, ?, 'US', 'us_beta_waitlist', ?, datetime('now'), datetime('now', ?), ?, ?, '2026-08-05.2', '2026-08-05.3')`)
    .run(id, email, status, `-${confirmedOffsetDays} days`, extra.unsubscribed_at ?? null, extra.resubscribed_at ?? null);
};

const seedPopulation = () => {
  seed("c1", "one@example.com", "confirmed", 50);
  seed("c2", "two@example.com", "confirmed", 40);
  seed("c3", "three@example.com", "confirmed", 30);
  seed("p1", "pending@example.com", "pending", 20);
  seed("u1", "gone@example.com", "unsubscribed", 45, { unsubscribed_at: "2026-07-01 00:00:00" });
  // Suppression evidence with no re-subscription: excluded despite 'confirmed'.
  seed("x1", "suppressed@example.com", "confirmed", 44, { unsubscribed_at: "2026-07-01 00:00:00" });
  // Unsubscribed then genuinely re-subscribed: eligible again.
  seed("r1", "back@example.com", "confirmed", 10,
    { unsubscribed_at: "2026-06-01 00:00:00", resubscribed_at: "2026-07-15 00:00:00" });
};

// ---------------------------------------------------------------------------
// Preview is completely read-only, and reports aggregates only.
// ---------------------------------------------------------------------------
{
  seedPopulation();
  const before = {
    runs: count("SELECT COUNT(*) AS n FROM waitlist_profile_invitation_batch_runs"),
    outcomes: count("SELECT COUNT(*) AS n FROM waitlist_profile_invitation_batch_outcomes"),
    invitations: count("SELECT COUNT(*) AS n FROM waitlist_profile_invitations"),
    buckets: count("SELECT COUNT(*) AS n FROM waitlist_rate_buckets"),
    signups: JSON.stringify(rows("SELECT * FROM waitlist_signups ORDER BY id")),
  };
  const preview = await previewProfileInvitationBatch(db);
  assert.deepEqual(preview, {
    eligible: 4,                    // c1, c2, c3, r1
    already_invited: 0,
    excluded_not_confirmed: 1,      // p1
    excluded_unsubscribed: 1,       // u1
    excluded_suppressed: 1,         // x1
    next_batch_size: 4,
  });
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profile_invitation_batch_runs"), before.runs, "no run row");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profile_invitation_batch_outcomes"), before.outcomes, "no outcome row");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profile_invitations"), before.invitations, "no invitation");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_rate_buckets"), before.buckets, "no rate bucket consumed");
  assert.equal(JSON.stringify(rows("SELECT * FROM waitlist_signups ORDER BY id")), before.signups, "no signup mutated");
  const serialized = JSON.stringify(preview);
  for (const address of ["one@example.com", "two@example.com", "three@example.com", "back@example.com"]) {
    assert.ok(!serialized.includes(address), "the preview result carries no recipient address");
  }
}

// ---------------------------------------------------------------------------
// Execution fails closed without the feature flag, creating nothing at all.
// ---------------------------------------------------------------------------
{
  for (const env of [{}, { WAITLIST_PROFILE_ENABLED: "false" }, { WAITLIST_PROFILE_ENABLED: "TRUE" },
    { WAITLIST_PROFILE_ENABLED: "1" }]) {
    const provider = capturingProvider();
    const result = await executeProfileInvitationBatch(db, env, provider, { origin: ORIGIN });
    assert.equal(result, null, `execution refused for flag ${JSON.stringify(env.WAITLIST_PROFILE_ENABLED)}`);
    assert.equal(provider.sent.length, 0, "nothing sent");
  }
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profile_invitation_batch_runs"), 0, "no run row created");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profile_invitations"), 0, "no invitation created");
  // Preview stays available while the flag is false: it issues and sends nothing.
  assert.equal((await previewProfileInvitationBatch(db)).eligible, 4, "preview still works with the flag off");
}

// ---------------------------------------------------------------------------
// Eligibility, deterministic ordering, and the bounded batch.
// ---------------------------------------------------------------------------
{
  const provider = capturingProvider();
  const result = await executeProfileInvitationBatch(db, ENABLED, provider, { origin: ORIGIN, limit: 2 });
  assert.equal(result.status, "completed");
  assert.equal(result.requested_limit, 2, "the caller's bound is honored");
  assert.equal(result.issued, 2);
  // Oldest confirmations first: c1 (50 days) then c2 (40 days).
  assert.deepEqual(rows(`SELECT signup_id, outcome FROM waitlist_profile_invitation_batch_outcomes
    WHERE run_id = ? ORDER BY signup_id`, result.run_id),
  [{ signup_id: "c1", outcome: "issued" }, { signup_id: "c2", outcome: "issued" }],
  "deterministic confirmed_at ASC, id ASC selection");
  assert.deepEqual(provider.sent.map((m) => m.to), ["one@example.com", "two@example.com"]);
  assert.equal(provider.sent[0].subject, "Your MotoTrack profile link");
  assert.match(provider.sent[0].text, /\/waitlist\/profile\/open\?token=/, "a usable protected link is sent");
  for (const signupId of ["c1", "c2"]) {
    assert.equal(count(`SELECT COUNT(*) AS n FROM waitlist_profile_invitations
      WHERE signup_id = ? AND channel = 'later_invitation'`, signupId), 1, "exactly one invitation per signup");
  }
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profile_invitations WHERE signup_id IN ('p1','u1','x1')"), 0,
    "pending, unsubscribed and suppressed records are never invited");
}

// ---------------------------------------------------------------------------
// The hard maximum cannot be raised by the caller.
// ---------------------------------------------------------------------------
{
  const wide = freshDb();
  for (let n = 0; n < 40; n += 1) {
    wide.sqlite.prepare(`INSERT INTO waitlist_signups (id, email_normalized, country_code, program_track, status,
      consent_at, confirmed_at, consent_copy_version, privacy_notice_version)
      VALUES (?, ?, 'US', 'us_beta_waitlist', 'confirmed', datetime('now'), datetime('now', ?), '2026-08-05.2', '2026-08-05.3')`)
      .run(`w${String(n).padStart(3, "0")}`, `w${n}@example.com`, `-${100 - n} days`);
  }
  const provider = capturingProvider();
  const result = await executeProfileInvitationBatch(wide, ENABLED, provider, { origin: ORIGIN, limit: 500 });
  assert.equal(result.requested_limit, BATCH_MAX_RECIPIENTS, "an oversized request is clamped, never honored");
  assert.equal(result.issued, 25, "at most 25 recipients per execution");
  assert.equal(provider.sent.length, 25);
  assert.equal((await previewProfileInvitationBatch(wide)).next_batch_size, 15, "next_batch_size never exceeds 25");
  assert.equal(wide.sqlite.prepare(`SELECT COUNT(*) AS n FROM waitlist_profile_invitation_batch_outcomes
    WHERE run_id = ?`).get(result.run_id).n, 25, "counts reconcile with outcome rows");
}

// ---------------------------------------------------------------------------
// Rerun cannot duplicate: the database, not this module, forbids it.
// ---------------------------------------------------------------------------
{
  const provider = capturingProvider();
  const rerun = await executeProfileInvitationBatch(db, ENABLED, provider, { origin: ORIGIN, limit: 25 });
  assert.equal(rerun.issued, 2, "only the two remaining eligible riders are invited");
  assert.deepEqual(provider.sent.map((m) => m.to).sort(), ["back@example.com", "three@example.com"]);
  for (const signupId of ["c1", "c2"]) {
    assert.equal(count(`SELECT COUNT(*) AS n FROM waitlist_profile_invitations
      WHERE signup_id = ? AND channel = 'later_invitation'`, signupId), 1,
    "an already-invited rider is never invited twice");
  }
  const third = await executeProfileInvitationBatch(db, ENABLED, capturingProvider(), { origin: ORIGIN, limit: 25 });
  assert.equal(third.eligible_count, 0, "the queue is drained");
  assert.equal(third.issued, 0);
  assert.equal(third.status, "completed");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profile_invitations WHERE channel = 'later_invitation'"), 4,
    "still exactly one later_invitation per invited signup");
}

// ---------------------------------------------------------------------------
// issue_failed: recorded, nothing sent, and retryable by a later deliberate run.
// ---------------------------------------------------------------------------
{
  const isolated = freshDb();
  const original = db;
  db = isolated;
  seed("i1", "issuefail@example.com", "confirmed", 5);
  seed("i2", "healthy@example.com", "confirmed", 4);
  isolated.sqlite.exec(`CREATE TRIGGER tmp_break_issue BEFORE INSERT ON waitlist_profile_invitations
    WHEN NEW.signup_id = 'i1' BEGIN SELECT RAISE(ABORT, 'injected'); END`);
  const provider = capturingProvider();
  const result = await executeProfileInvitationBatch(isolated, ENABLED, provider, { origin: ORIGIN, limit: 25 });
  isolated.sqlite.exec("DROP TRIGGER tmp_break_issue");

  assert.equal(result.status, "completed_with_failures");
  assert.equal(result.issue_failed, 1);
  assert.equal(result.issued, 1, "one rider's failure does not stop the batch");
  assert.deepEqual(rows(`SELECT signup_id, outcome FROM waitlist_profile_invitation_batch_outcomes
    WHERE run_id = ? ORDER BY signup_id`, result.run_id),
  [{ signup_id: "i1", outcome: "issue_failed" }, { signup_id: "i2", outcome: "issued" }]);
  assert.deepEqual(provider.sent.map((m) => m.to), ["healthy@example.com"], "no email for the failed issuance");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profile_invitations WHERE signup_id = 'i1'"), 0,
    "no invitation row survives a failed issuance");

  // No invitation existed, so a later deliberate execution may try again.
  const retry = await executeProfileInvitationBatch(isolated, ENABLED, capturingProvider(), { origin: ORIGIN, limit: 25 });
  assert.equal(retry.issued, 1, "issue_failed is retryable by a later deliberate run");
  assert.equal(count(`SELECT COUNT(*) AS n FROM waitlist_profile_invitations
    WHERE signup_id = 'i1' AND channel = 'later_invitation'`), 1);
  db = original;
}

// ---------------------------------------------------------------------------
// send_failed: recorded, token left unusable, evidence kept, NOT auto-retried.
// ---------------------------------------------------------------------------
{
  const isolated = freshDb();
  const original = db;
  db = isolated;
  seed("s1", "sendfail@example.com", "confirmed", 5);
  seed("s2", "delivered@example.com", "confirmed", 4);
  const flaky = {
    sent: [],
    async send(message) {
      if (message.to === "sendfail@example.com") throw new Error("injected delivery failure");
      this.sent.push(message);
      return { status: "test_capture" };
    },
  };
  const result = await executeProfileInvitationBatch(isolated, ENABLED, flaky, { origin: ORIGIN, limit: 25 });
  assert.equal(result.status, "completed_with_failures");
  assert.equal(result.send_failed, 1);
  assert.equal(result.issued, 1, "a delivery failure does not roll back an unrelated success");
  assert.deepEqual(flaky.sent.map((m) => m.to), ["delivered@example.com"]);

  const invitation = row("SELECT used_at, revoked_at FROM waitlist_profile_invitations WHERE signup_id = 's1'");
  assert.ok(invitation, "the invitation ROW is preserved as idempotency evidence");
  assert.ok(invitation.revoked_at, "but the token is revoked - no usable link is left active");

  // A rerun must not retry it: the slot is spent, so it reconciles as already_invited.
  const rerun = await executeProfileInvitationBatch(isolated, ENABLED, capturingProvider(), { origin: ORIGIN, limit: 25 });
  assert.equal(rerun.issued, 0, "send_failed is never automatically retried");
  assert.equal(rerun.eligible_count, 0, "and the rider is no longer selected as eligible");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profile_invitations WHERE signup_id = 's1'"), 1,
    "still exactly one later_invitation slot consumed");

  // Reconciliation vocabulary: an already-invited rider encountered in an
  // execution records already_invited.
  await issueProfileInvitation(isolated, "s2", "requested_edit_link");
  const forced = await executeProfileInvitationBatch(isolated, ENABLED, capturingProvider(), { origin: ORIGIN, limit: 25 });
  assert.equal(forced.already_invited + forced.issued, forced.eligible_count === 0 ? forced.already_invited : forced.issued + forced.already_invited);
  db = original;
}

// ---------------------------------------------------------------------------
// Counts reconcile exactly, and no signup/track/consent state ever changes.
// ---------------------------------------------------------------------------
{
  const runsWithOutcomes = rows(`SELECT r.id, r.issued_count, r.already_invited_count, r.issue_failed_count,
      r.send_failed_count, r.status,
      (SELECT COUNT(*) FROM waitlist_profile_invitation_batch_outcomes o WHERE o.run_id = r.id) AS outcome_rows
    FROM waitlist_profile_invitation_batch_runs r`);
  for (const run of runsWithOutcomes) {
    const total = run.issued_count + run.already_invited_count + run.issue_failed_count + run.send_failed_count;
    assert.equal(total, run.outcome_rows, `run ${run.id} counts reconcile exactly with its outcome rows`);
    assert.notEqual(run.status, "running", "no run is left dangling in 'running'");
  }
  assert.deepEqual(rows(`SELECT id, status, program_track, confirmed_at, unsubscribed_at, resubscribed_at,
      consent_copy_version, privacy_notice_version FROM waitlist_signups ORDER BY id`).map((s) => s.status).sort(),
  ["confirmed", "confirmed", "confirmed", "confirmed", "confirmed", "pending", "unsubscribed"],
  "batch processing mutates no wait-list status");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profile_consent_events"), 0,
    "and touches no profile-consent state");
  assert.equal(count("SELECT COUNT(*) AS n FROM pragma_foreign_key_check()"), 0, "FK clean");
}

// ---------------------------------------------------------------------------
// Retention: 90-day operational records, cascades, and the rest of the sweep.
// ---------------------------------------------------------------------------
{
  const retention = freshDb();
  const original = db;
  db = retention;
  seed("keep", "keep@example.com", "confirmed", 5);
  seed("old", "old@example.com", "confirmed", 5);
  seed("purged", "purged@example.com", "confirmed", 800);

  const mkRun = (runId, ageDays, signupId) => {
    retention.sqlite.prepare(`INSERT INTO waitlist_profile_invitation_batch_runs
      (id, requested_limit, eligible_count, issued_count, status, started_at)
      VALUES (?, 25, 1, 1, 'completed', datetime('now', ?))`).run(runId, `-${ageDays} days`);
    retention.sqlite.prepare(`INSERT INTO waitlist_profile_invitation_batch_outcomes (run_id, signup_id, outcome)
      VALUES (?, ?, 'issued')`).run(runId, signupId);
  };
  mkRun("run_recent", 89, "keep");
  mkRun("run_stale", 91, "old");
  mkRun("run_signup_purge", 1, "purged");

  // Evidence the later sweep stages still have work.
  retention.sqlite.prepare(`INSERT INTO waitlist_email_deliveries (id, signup_id, purpose, provider_status, requested_at)
    VALUES ('d_old', 'keep', 'confirm', 'test_capture', datetime('now','-100 days'))`).run();
  retention.sqlite.prepare(`UPDATE waitlist_signups SET attribution='{"ref":"x"}', created_at=datetime('now','-13 months')
    WHERE id='keep'`).run();
  retention.sqlite.prepare(`INSERT INTO waitlist_rate_buckets (bucket_key, window_start, send_count)
    VALUES ('stale', date('now','-3 days'), 1)`).run();

  const purged = await sweepProfileInvitationBatches(retention);
  assert.equal(purged, 1, "exactly the >90-day run is deleted");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profile_invitation_batch_runs WHERE id='run_recent'"), 1,
    "an 89-day batch record survives");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profile_invitation_batch_runs WHERE id='run_stale'"), 0,
    "a 91-day batch record is purged");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profile_invitation_batch_outcomes WHERE run_id='run_stale'"), 0,
    "its outcome rows cascade with the run");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profile_invitation_batch_outcomes WHERE run_id='run_recent'"), 1,
    "the surviving run keeps its outcomes");

  // An earlier parent-signup purge cascades that signup's outcome sooner.
  retention.sqlite.prepare("UPDATE waitlist_signups SET confirmed_at = datetime('now','-25 months') WHERE id='purged'").run();
  const summary = await runRetentionSweep(retention);
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_signups WHERE id='purged'"), 0, "the signup reached its ceiling");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profile_invitation_batch_outcomes WHERE signup_id='purged'"), 0,
    "its outcome row cascaded away with it");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_profile_invitation_batch_runs WHERE id='run_signup_purge'"), 1,
    "while the run itself, still inside 90 days, survives");

  // The rest of the sweep still ran.
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_email_deliveries WHERE id='d_old'"), 0, "delivery-log cleanup ran");
  assert.equal(row("SELECT attribution FROM waitlist_signups WHERE id='keep'").attribution, null, "attribution cleanup ran");
  assert.equal(count("SELECT COUNT(*) AS n FROM waitlist_rate_buckets WHERE bucket_key='stale'"), 0, "rate-bucket cleanup ran");
  assert.equal(typeof summary.profile_invitation_batches_purged, "number", "the sweep reports batch purges");
  assert.equal(count("SELECT COUNT(*) AS n FROM pragma_foreign_key_check()"), 0, "FK clean after retention");
  db = original;
}

// ---------------------------------------------------------------------------
// PR-scope containment: no trigger of any kind exists.
// ---------------------------------------------------------------------------
{
  const workerSource = readFileSync(join(import.meta.dirname, "..", "src", "waitlist-worker.js"), "utf8");
  assert.ok(!/executeProfileInvitationBatch|previewProfileInvitationBatch/.test(workerSource),
    "the Worker never invokes the batch: no route, no scheduled handler, no startup call");
  assert.ok(!workerSource.includes("queue("), "no queue consumer");
  const batchSource = readFileSync(join(import.meta.dirname, "..", "src", "waitlist-profile-batch.js"), "utf8");
  assert.ok(!/addEventListener|export default/.test(batchSource), "the module exposes no handler surface");
  const wrangler = readFileSync(join(import.meta.dirname, "..", "wrangler.jsonc"), "utf8");
  assert.ok(!wrangler.includes("WAITLIST_PROFILE_ENABLED"), "the feature flag is in no environment");
  assert.ok(!/"queues"|"consumers"/.test(wrangler), "no queue binding entered this PR");
}

console.log("waitlist-profile-batch.test.js passed");
