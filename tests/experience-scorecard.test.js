import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { APP_VERSION } from "../src/app-version.js";
import {
  buildScorecard, pct, SCORECARD_WINDOWS, DEFAULT_WINDOW_KEY, SUMMARY_SMALL_SAMPLE_MAX, isSmallSample,
  WORKFLOW_DISPLAY_MAX, windowByKey,
} from "../src/experience-scorecard-service.js";

// Beta Experience Scorecard v1 #55 PR3B: the read/aggregation contract. No
// routes, no HTML, no mutation. Asserts the counting, windowing, percentages,
// honest-empties, and the evidence-summary small-sample handling. Migration is NOT
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
        : { success: true, meta: sqlite.prepare(sql).run(...values) }),
    }; } };
  }
}
const MIGRATIONS = [
  "0001_waitlist.sql", "0002_program_track.sql", "0003_resubscription_evidence.sql",
  "0004_rider_profiles.sql", "0005_profile_edit_authorizations.sql",
  "0006_profile_consent_events.sql", "0007_profile_invitation_batches.sql",
  "0008_beta_approvals.sql", "0009_feedback.sql", "0010_experience_pulse.sql",
];
const freshDb = () => {
  const db = new LocalD1();
  for (const m of MIGRATIONS) db.sqlite.exec(readFileSync(join(import.meta.dirname, "..", "migrations", m), "utf8"));
  return db;
};

let seq = 0;
const nextId = (p) => { seq += 1; return `${p}_${String(seq).padStart(20, "0")}`; };
function seedPulse(db, { value, section = null, route = null, version = APP_VERSION, feedbackId = null, ageMin = 0 }) {
  db.sqlite.prepare(
    `INSERT INTO feedback_experience_pulses (id, value, source_section, source_route, app_version, feedback_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now', ?))`,
  ).run(nextId("xp"), value, section, route, version, feedbackId, `-${ageMin} minutes`);
}
function seedFeedback(db, { id = nextId("fb"), body = "written", section = null, state = "new", ageMin = 0, issue = null } = {}) {
  const promoted = issue !== null;
  db.sqlite.prepare(
    `INSERT INTO feedback_submissions
       (id, body, source_section, app_version, triage_state, closure_reason, closed_at,
        github_repo, github_issue_number, github_issue_url, promoted_at, promoted_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))`,
  ).run(
    id, body, section, APP_VERSION, state,
    state === "closed" ? "resolved" : null,
    state === "closed" ? "2026-01-01 00:00:00" : null,
    promoted ? "PatchnetEvan/track-helper" : null,
    promoted ? issue : null,
    promoted ? `https://github.com/PatchnetEvan/track-helper/issues/${issue}` : null,
    promoted ? "2026-01-01 00:00:00" : null,
    promoted ? "op@example.test" : null,
    `-${ageMin} minutes`,
  );
  return id;
}

// ---------------------------------------------------------------------------
// pct helper: integer percent, 0 (never NaN) on empty.
// ---------------------------------------------------------------------------
{
  assert.equal(pct(3, 5), 60);
  assert.equal(pct(1, 3), 33);
  assert.equal(pct(0, 0), 0, "no division by zero");
  assert.equal(pct(5, 0), 0);
}

// ---------------------------------------------------------------------------
// Empty database: everything zero/empty, no summaries, no throw.
// ---------------------------------------------------------------------------
{
  const s = await buildScorecard(freshDb());
  for (const w of s.distributionByWindow) {
    assert.deepEqual([w.good, w.okay, w.notGood, w.total], [0, 0, 0, 0], `${w.key} empty`);
  }
  assert.equal(s.distributionByWindow.length, 3, "all three primary windows present");
  assert.deepEqual(s.distributionByWindow.map((w) => w.key), ["24h", "7d", "30d"]);
  assert.deepEqual(s.bySection, []);
  assert.deepEqual(s.byVersion, []);
  assert.deepEqual(s.recurring, []);
  assert.deepEqual(s.summaries, { strongest: null, needsAttention: null, improving: null });
  assert.deepEqual(s.loop.triage, { new: 0, reviewing: 0, actionable: 0, closed: 0 });
  assert.equal(s.loop.promoted, 0);
}

// ---------------------------------------------------------------------------
// Distribution counts + percentages, and window boundaries.
// ---------------------------------------------------------------------------
{
  const db = freshDb();
  // Recent (now): 3 Good, 1 Okay, 1 Not good -> 60/20/20, total 5.
  seedPulse(db, { value: 3 }); seedPulse(db, { value: 3 }); seedPulse(db, { value: 3 });
  seedPulse(db, { value: 2 }); seedPulse(db, { value: 1 });
  // 2 days old: only visible in 7d and 30d.
  seedPulse(db, { value: 1, ageMin: 60 * 24 * 2 });
  // 14 days old: only visible in 30d.
  seedPulse(db, { value: 3, ageMin: 60 * 24 * 14 });

  const s = await buildScorecard(db);
  const w = Object.fromEntries(s.distributionByWindow.map((x) => [x.key, x]));
  assert.deepEqual([w["24h"].good, w["24h"].okay, w["24h"].notGood, w["24h"].total], [3, 1, 1, 5], "24h excludes older");
  assert.equal(pct(w["24h"].good, w["24h"].total), 60);
  assert.equal(pct(w["24h"].okay, w["24h"].total), 20);
  assert.equal(pct(w["24h"].notGood, w["24h"].total), 20);
  assert.equal(w["7d"].total, 6, "7d includes the 2-day-old pulse");
  assert.equal(w["30d"].total, 7, "30d includes the 14-day-old pulse");
}

// ---------------------------------------------------------------------------
// By workflow (source_section) within the selected window, sorted by total.
// ---------------------------------------------------------------------------
{
  const db = freshDb();
  for (let i = 0; i < 3; i += 1) seedPulse(db, { value: 3, section: "tires" });
  seedPulse(db, { value: 1, section: "review" });
  seedPulse(db, { value: 2, section: null }); // unspecified section survives as null
  const s = await buildScorecard(db, "7d");
  assert.equal(s.bySection[0].section, "tires", "busiest workflow first");
  assert.equal(s.bySection[0].good, 3);
  const review = s.bySection.find((r) => r.section === "review");
  assert.deepEqual([review.notGood, review.total], [1, 1]);
  assert.ok(s.bySection.some((r) => r.section === null), "null section retained (view labels it)");
}

// ---------------------------------------------------------------------------
// By app version, chronological (earliest first), distribution attached.
// ---------------------------------------------------------------------------
{
  const db = freshDb();
  // Older version first.
  seedPulse(db, { value: 1, version: "0.1.0-beta.1", ageMin: 100 });
  seedPulse(db, { value: 2, version: "0.1.0-beta.1", ageMin: 90 });
  seedPulse(db, { value: 3, version: "0.2.0-beta.1", ageMin: 10 });
  const s = await buildScorecard(db, "7d");
  assert.deepEqual(s.byVersion.map((v) => v.version), ["0.1.0-beta.1", "0.2.0-beta.1"], "chronological by first-seen");
  assert.equal(s.byVersion[1].good, 1);
}

// ---------------------------------------------------------------------------
// Friction clusters: pulse distribution per section + linked written feedback.
// ---------------------------------------------------------------------------
{
  const db = freshDb();
  const fid = seedFeedback(db, { body: "brakes felt vague", section: "review" });
  seedPulse(db, { value: 1, section: "review", feedbackId: fid });
  seedPulse(db, { value: 3, section: "review" }); // unlinked
  const s = await buildScorecard(db, "7d");
  const review = s.friction.find((f) => f.section === "review");
  assert.equal(review.total, 2);
  assert.equal(review.linkedCount, 1, "accurate linked count");
  assert.equal(review.linked.length, 1, "one example snippet");
  assert.equal(review.linked[0].snippet, "brakes felt vague");
}

// ---------------------------------------------------------------------------
// Recurring requests: only real repeated evidence (>1 feedback on same issue).
// Empty until promotion exists.
// ---------------------------------------------------------------------------
{
  const db = freshDb();
  assert.deepEqual((await buildScorecard(db, "30d")).recurring, [], "no promotion -> empty, honestly");
  seedFeedback(db, { issue: 42 });
  seedFeedback(db, { issue: 42 });
  seedFeedback(db, { issue: 7 }); // singleton, not recurring
  const s = await buildScorecard(db, "30d");
  assert.equal(s.recurring.length, 1, "only the issue with >1 record");
  assert.equal(s.recurring[0].issueNumber, 42);
  assert.equal(s.recurring[0].count, 2);
}

// ---------------------------------------------------------------------------
// Recurrence identity is (repo, issue_number): a differing/NULL github_issue_url
// on the same issue must NOT split it into dropped singletons.
// ---------------------------------------------------------------------------
{
  const db = freshDb();
  const ins = (id, url) => db.sqlite.prepare(
    `INSERT INTO feedback_submissions (id, body, app_version, triage_state, github_repo, github_issue_number, github_issue_url, promoted_at, promoted_by, created_at)
     VALUES (?, 'x', ?, 'actionable', 'PatchnetEvan/track-helper', 55, ?, '2026-01-01 00:00:00', 'op@example.test', datetime('now'))`,
  ).run(id, APP_VERSION, url);
  ins("fb_u1", "https://github.com/PatchnetEvan/track-helper/issues/55");
  ins("fb_u2", null);
  const s = await buildScorecard(db, "30d");
  assert.equal(s.recurring.length, 1, "same issue with differing/NULL url is one recurrence, not dropped");
  assert.equal(s.recurring[0].issueNumber, 55);
  assert.equal(s.recurring[0].count, 2);
  assert.ok(s.recurring[0].issueUrl, "a non-null url is chosen for display");
}

// ---------------------------------------------------------------------------
// Visible workflow cap: the display list is bounded but reports the true total,
// and evidence summaries still consider EVERY workflow (a strongest workflow
// beyond the display cap is still found - the cap is display-only).
// ---------------------------------------------------------------------------
{
  const db = freshDb();
  for (let i = 0; i <= WORKFLOW_DISPLAY_MAX; i += 1) {
    seedPulse(db, { value: 2, section: `flow-${i}` });
    seedPulse(db, { value: 2, section: `flow-${i}` });
  }
  // One section with the LOWEST total but 100% Good: ranks below the cap by
  // total, yet must still be the strongest.
  seedPulse(db, { value: 3, section: "goldenwf" });
  const s = await buildScorecard(db, "7d");
  assert.equal(s.bySection.length, WORKFLOW_DISPLAY_MAX, "display list capped");
  assert.equal(s.workflowCount, WORKFLOW_DISPLAY_MAX + 2, "true workflow count reported");
  assert.ok(!s.bySection.some((r) => r.section === "goldenwf"), "low-total workflow beyond the display cap");
  assert.equal(s.summaries.strongest.section, "goldenwf", "summaries consider EVERY workflow, not just the displayed slice");
}

// ---------------------------------------------------------------------------
// Feedback -> improvement loop: triage funnel + promoted count.
// ---------------------------------------------------------------------------
{
  const db = freshDb();
  seedFeedback(db, { state: "new" }); seedFeedback(db, { state: "new" });
  seedFeedback(db, { state: "reviewing" });
  seedFeedback(db, { state: "actionable" });
  seedFeedback(db, { state: "closed" });
  seedFeedback(db, { state: "actionable", issue: 99 }); // promoted
  const s = await buildScorecard(db, "30d");
  assert.deepEqual(s.loop.triage, { new: 2, reviewing: 1, actionable: 2, closed: 1 });
  assert.equal(s.loop.promoted, 1);
}

// ---------------------------------------------------------------------------
// The small-sample indicator is a DISPLAY caution, not a gate or the public
// n>=25 threshold.
// ---------------------------------------------------------------------------
{
  assert.equal(SUMMARY_SMALL_SAMPLE_MAX, 10, "internal small-sample hint is its own number, not 25");
  assert.notEqual(SUMMARY_SMALL_SAMPLE_MAX, 25, "not the public publication threshold");
  assert.equal(isSmallSample(3), true);
  assert.equal(isSmallSample(4), true);
  assert.equal(isSmallSample(10), true);
  assert.equal(isSmallSample(11), false);
}

// ---------------------------------------------------------------------------
// [EXPERIENCE] acceptance: SUMMARY_SMALL_SAMPLE_MAX is PURELY presentation. It
// must never leak into aggregation, filtering, ranking, or whether an
// evidence-summary exists. A 3-response and an 11-response workflow are BOTH
// visible and BOTH eligible to be summarized; only the TAG differs; neither is
// auto-promoted to a priority.
// ---------------------------------------------------------------------------
{
  const db = freshDb();
  // 3 responses, all Good -> strongest by rate (small).
  for (let i = 0; i < 3; i += 1) seedPulse(db, { value: 3, section: "trackside" });
  // 11 responses, mostly Not good -> needs attention (NOT small).
  seedPulse(db, { value: 3, section: "garage" });
  for (let i = 0; i < 10; i += 1) seedPulse(db, { value: 1, section: "garage" });

  const s = await buildScorecard(db, "7d");
  // Both visible at their true size (nothing filtered by sample).
  assert.ok(s.bySection.some((r) => r.section === "trackside" && r.total === 3), "3-response workflow visible");
  assert.ok(s.bySection.some((r) => r.section === "garage" && r.total === 11), "11-response workflow visible");
  // Both eligible for evidence-summary presentation (ranked by RATE, not size).
  assert.equal(s.summaries.strongest.section, "trackside", "3-response workflow can be strongest");
  assert.equal(s.summaries.needsAttention.section, "garage", "11-response workflow summarized too");
  // Only the TAG differs.
  assert.equal(isSmallSample(s.summaries.strongest.total), true, "3 responses -> Small sample tag");
  assert.equal(isSmallSample(s.summaries.needsAttention.total), false, "11 responses -> no Small sample tag");
}

// ---------------------------------------------------------------------------
// Structural leak-guard: the aggregation module must NEVER apply the small-
// sample size in a decision. It exports the constant + helper for the view, but
// never CALLS isSmallSample, and SUMMARY_SMALL_SAMPLE_MAX appears only in its
// declaration, the helper's definition, and the returned display metadata.
// ---------------------------------------------------------------------------
{
  const src = readFileSync(join(import.meta.dirname, "..", "src", "experience-scorecard-service.js"), "utf8");
  assert.ok(!src.includes("isSmallSample("), "aggregation never CALLS isSmallSample");
  assert.equal((src.match(/SUMMARY_SMALL_SAMPLE_MAX/g) || []).length, 3,
    "SUMMARY_SMALL_SAMPLE_MAX only in its declaration, the helper, and the returned metadata — never in a filter/rank");
  // The evidence-summary computation must not reference the small-sample size.
  const fnStart = src.indexOf("function evidenceSummaries");
  const fnEnd = src.indexOf("\n}", fnStart);
  const fn = src.slice(fnStart, fnEnd);
  assert.ok(!fn.includes("SUMMARY_SMALL_SAMPLE_MAX") && !fn.includes("isSmallSample"),
    "evidenceSummaries ranks/selects without any small-sample gate");
}

// ---------------------------------------------------------------------------
// Evidence summaries: NO sample floor. A tiny 100%-Good workflow IS shown as
// strongest (never suppressed), carrying its exact count so it reads as small;
// a larger workflow is not flagged small. Priority is never inferred from this.
// ---------------------------------------------------------------------------
{
  const db = freshDb();
  // "tires": 12 responses, 11 Good 1 Not good -> 92% Good, NOT small.
  for (let i = 0; i < 11; i += 1) seedPulse(db, { value: 3, section: "tires" });
  seedPulse(db, { value: 1, section: "tires" });
  // "review": 12 responses, 2 Good 10 Not good -> 83% Not good, NOT small.
  seedPulse(db, { value: 3, section: "review" }); seedPulse(db, { value: 3, section: "review" });
  for (let i = 0; i < 10; i += 1) seedPulse(db, { value: 1, section: "review" });
  // "shakedown": tiny 2 responses, both Good (100%). Under the OLD floor this
  // was suppressed; now it IS the strongest by rate, but must read as small.
  seedPulse(db, { value: 3, section: "shakedown" });
  seedPulse(db, { value: 3, section: "shakedown" });

  const s = await buildScorecard(db, "7d");
  assert.equal(s.summarySmallSampleMax, SUMMARY_SMALL_SAMPLE_MAX);
  // Tiny 100% section is shown as strongest (not suppressed) and reads small.
  assert.equal(s.summaries.strongest.section, "shakedown", "tiny section no longer suppressed");
  assert.equal(s.summaries.strongest.total, 2);
  assert.equal(s.summaries.strongest.goodCount, 2);
  assert.equal(isSmallSample(s.summaries.strongest.total), true, "strongest is flagged a small sample");
  // Needs attention is the larger review workflow, NOT flagged small.
  assert.equal(s.summaries.needsAttention.section, "review");
  assert.equal(s.summaries.needsAttention.total, 12);
  assert.equal(s.summaries.needsAttention.notGoodCount, 10);
  assert.equal(isSmallSample(s.summaries.needsAttention.total), false, "a 12-response summary is not small");
  // The tiny section remains fully visible in the raw distribution too.
  assert.ok(s.bySection.some((r) => r.section === "shakedown" && r.total === 2), "tiny sample visible in raw counts");
}

// ---------------------------------------------------------------------------
// Improving: a newer version with higher Good% than the previous (each with at
// least one response) is reported as evidence, never as causation.
// ---------------------------------------------------------------------------
{
  const db = freshDb();
  // v1 (older): 5 responses, 1 Good -> 20% Good.
  seedPulse(db, { value: 3, version: "0.1.0-beta.1", ageMin: 200 });
  for (let i = 0; i < 4; i += 1) seedPulse(db, { value: 1, version: "0.1.0-beta.1", ageMin: 190 });
  // v2 (newer): 5 responses, 4 Good -> 80% Good.
  for (let i = 0; i < 4; i += 1) seedPulse(db, { value: 3, version: "0.2.0-beta.1", ageMin: 20 });
  seedPulse(db, { value: 1, version: "0.2.0-beta.1", ageMin: 10 });
  const s = await buildScorecard(db, "7d");
  assert.ok(s.summaries.improving, "improvement detected");
  assert.equal(s.summaries.improving.toVersion, "0.2.0-beta.1");
  assert.equal(s.summaries.improving.fromVersion, "0.1.0-beta.1");
  assert.ok(s.summaries.improving.toGoodPct > s.summaries.improving.fromGoodPct);
  // Counts carried so the view can show "X of N" rather than a bare percentage.
  assert.deepEqual(
    [s.summaries.improving.fromGoodCount, s.summaries.improving.fromTotal, s.summaries.improving.toGoodCount, s.summaries.improving.toTotal],
    [1, 5, 4, 5],
  );
}

// ---------------------------------------------------------------------------
// Window selection: default and unknown fall back to 7d; explicit honored.
// ---------------------------------------------------------------------------
{
  assert.equal(windowByKey("24h").key, "24h");
  assert.equal(windowByKey("nonsense").key, DEFAULT_WINDOW_KEY);
  const db = freshDb();
  seedPulse(db, { value: 3, ageMin: 60 * 5 }); // 5h old
  assert.equal((await buildScorecard(db, "24h")).selectedWindow.key, "24h");
  assert.equal((await buildScorecard(db, "bogus")).selectedWindow.key, "7d", "unknown window -> default");
}

console.log("experience-scorecard.test.js passed");
