// Beta Experience Scorecard v1 (#55, PR3B): the READ/AGGREGATION layer over the
// Experience Pulse (and, where honest, written Feedback). No schema, no
// mutation, no rider-facing surface, no telemetry - it only READS the live
// retention window. It exists to help an operator UNDERSTAND the evidence; it
// never makes a product decision.
//
// Binding product rules encoded here (owner rulings, frozen v1):
//   * ALWAYS report counts WITH percentages and the total sample. A percentage
//     is never shown without the count behind it. Small samples are allowed but
//     must remain visibly small - so nothing here hides a count.
//   * The labels "Strongest experience" / "Needs attention" / "Improving" are
//     EVIDENCE SUMMARIES, never automated priorities. There is NO sample floor:
//     a summary is shown at ANY sample size (a 1-2 response workflow CAN be the
//     strongest by rate), never suppressed - but it carries its exact response
//     count and the view marks a small sample "Small sample" so it is never
//     portrayed as strong evidence. The only frozen numeric publication
//     threshold, n>=25, is PUBLIC-only and is never applied here.
//   * NO AI clustering, NO churn scoring, NO happiness labels, NO behavioral
//     profiling, NO new telemetry, NO additional Pulse metrics. "By version"
//     may report that experience differs after a version, but NEVER claims
//     causation ("PR X caused +Y%").
//   * "Recurring requests" and the "feedback -> improvement loop" are built
//     ONLY from what the data honestly supports today (GitHub promotion is a
//     later PR); until then they surface real triage/promotion state and read
//     as incomplete rather than inventing a categorization.
//   * source_section / source_route are UNTRUSTED rider-influenced values; this
//     module returns them raw and the VIEW is responsible for escaping. Nothing
//     here renders. app_version is server-stamped and still treated carefully.

import { PULSE_VALUE_LABELS } from "./experience-pulse-service.js";

export { PULSE_VALUE_LABELS };

// Primary windows. `since` is a SQLite datetime modifier applied to created_at.
export const SCORECARD_WINDOWS = Object.freeze([
  { key: "24h", label: "Last 24 hours", since: "-24 hours" },
  { key: "7d", label: "Last 7 days", since: "-7 days" },
  { key: "30d", label: "Last 30 days", since: "-30 days" },
]);
export const DEFAULT_WINDOW_KEY = "7d";

// Display-only caution (owner ruling): an evidence summary is shown at ANY
// sample size - nothing is suppressed and no data is hidden - but a summary
// computed on a sample at or below this size is rendered WITH a visible "Small
// sample" indicator and its exact response count, so a tiny sample is never
// portrayed as strong evidence. This is NOT a gate and NOT a confidence/
// product/publication threshold. The ONLY frozen numeric publication threshold
// is n>=25, and it applies solely to future PUBLIC Beta Update percentages,
// never to this internal Admin Scorecard (which is deliberately a DIFFERENT
// number to keep the two from being conflated).
export const SUMMARY_SMALL_SAMPLE_MAX = 10;
export const isSmallSample = (total) => (Number(total) || 0) <= SUMMARY_SMALL_SAMPLE_MAX;

// source_section is rider-chosen free-shape text (bounded but not an enum), so
// the number of distinct workflows is technically unbounded. The by-workflow
// and friction lists render at most this many rows to keep an operator page
// from being inflated by a flood of one-off section values. This is a VISIBLE
// cap - the view shows "top N of M workflows" with the true M - never a silent
// truncation, and it does NOT limit the aggregation the evidence summaries see.
export const WORKFLOW_DISPLAY_MAX = 50;

export function windowByKey(key) {
  return SCORECARD_WINDOWS.find((w) => w.key === key) ?? SCORECARD_WINDOWS.find((w) => w.key === DEFAULT_WINDOW_KEY);
}

// Integer percentage of a count within a total. 0 when the total is 0 (never
// NaN). Percentages are a presentation aid ON TOP OF the always-present count.
export function pct(n, total) {
  return total > 0 ? Math.round((Number(n) || 0) / total * 100) : 0;
}

const emptyDist = () => ({ good: 0, okay: 0, notGood: 0, total: 0 });

// The Scorecard reads two feature tables that are created by migrations applied
// on their own schedule: feedback_experience_pulses (0010) and
// feedback_submissions (0009). It is legitimately loaded BEFORE those
// migrations exist in an environment (Pulse is fail-closed until separately
// activated), so a missing table must render an HONEST empty / not-active state,
// never a 500. This checks presence once so the queries are skipped entirely
// rather than thrown from.
async function tableExists(db, name) {
  const row = await db.prepare(
    "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).bind(name).first();
  return !!row;
}

const emptyLoop = () => ({ triage: { new: 0, reviewing: 0, actionable: 0, closed: 0 }, promoted: 0 });

function addToDist(dist, value, n) {
  const count = Number(n) || 0;
  if (value === 3) dist.good += count;
  else if (value === 2) dist.okay += count;
  else if (value === 1) dist.notGood += count;
  dist.total += count;
}

// Overall Pulse distribution in one window.
async function overallDistribution(db, since) {
  const { results } = await db.prepare(
    `SELECT value, COUNT(*) AS n FROM feedback_experience_pulses
       WHERE created_at >= datetime('now', ?) GROUP BY value`,
  ).bind(since).all();
  const dist = emptyDist();
  for (const r of results) addToDist(dist, r.value, r.n);
  return dist;
}

// Pulse distribution grouped by a fixed dimension column. `dim` is a trusted
// literal chosen by this module ("source_section" | "app_version"), never
// caller input, so it is safe to interpolate.
async function distributionByDimension(db, since, dim) {
  const { results } = await db.prepare(
    `SELECT ${dim} AS k, value, COUNT(*) AS n FROM feedback_experience_pulses
       WHERE created_at >= datetime('now', ?) GROUP BY ${dim}, value`,
  ).bind(since).all();
  const map = new Map();
  for (const r of results) {
    const key = r.k === null || r.k === undefined ? null : String(r.k);
    if (!map.has(key)) map.set(key, emptyDist());
    addToDist(map.get(key), r.value, r.n);
  }
  return map;
}

// Chronological version order (earliest pulse first) so "improving" can compare
// consecutive versions without inventing a release calendar.
async function versionOrder(db, since) {
  // Secondary key app_version ASC makes the order deterministic when two
  // versions share a first-seen second (otherwise the "improving" pair - the
  // two most-recent versions - would be engine-dependent).
  const { results } = await db.prepare(
    `SELECT app_version AS k, MIN(created_at) AS first_seen FROM feedback_experience_pulses
       WHERE created_at >= datetime('now', ?) GROUP BY app_version ORDER BY first_seen ASC, app_version ASC`,
  ).bind(since).all();
  return results.map((r) => ({ version: String(r.k), firstSeen: r.first_seen }));
}

// Max snippets shown per workflow in the friction panel. The COUNT is always
// accurate (a separate aggregate); this only bounds how many example snippets
// are rendered, and the view shows "and N more" when the count exceeds it.
const FRICTION_SNIPPETS_PER_SECTION = 5;

// Written feedback LINKED to a pulse (the "why" behind the "where"). Empty until
// pulses carry a feedback_id. Returns, per section, the ACCURATE linked count
// plus a bounded list of example snippets (bodies are UNTRUSTED - returned raw,
// escaped by the view). The count is never derived from the (capped) snippet
// list, so a section's linked total is never silently under-reported.
async function linkedFeedbackBySection(db, since) {
  const counts = await db.prepare(
    `SELECT p.source_section AS section, COUNT(*) AS n
       FROM feedback_experience_pulses p JOIN feedback_submissions f ON f.id = p.feedback_id
       WHERE p.created_at >= datetime('now', ?) GROUP BY p.source_section`,
  ).bind(since).all();
  const { results: snippetRows } = await db.prepare(
    `SELECT p.source_section AS section, f.id AS id, substr(f.body, 1, 140) AS snippet, f.created_at AS created_at
       FROM feedback_experience_pulses p JOIN feedback_submissions f ON f.id = p.feedback_id
       WHERE p.created_at >= datetime('now', ?)
       ORDER BY f.created_at DESC LIMIT 500`,
  ).bind(since).all();

  const map = new Map();
  const keyOf = (s) => (s === null || s === undefined ? null : String(s));
  for (const r of counts.results) map.set(keyOf(r.section), { count: Number(r.n) || 0, snippets: [] });
  for (const r of snippetRows) {
    const key = keyOf(r.section);
    const entry = map.get(key) ?? { count: 0, snippets: [] };
    if (entry.snippets.length < FRICTION_SNIPPETS_PER_SECTION) {
      entry.snippets.push({ id: String(r.id), snippet: r.snippet ?? "", createdAt: r.created_at });
    }
    if (!map.has(key)) map.set(key, entry);
  }
  return map;
}

// Recurring requests: ONLY real repeated evidence - multiple feedback records
// promoted to the SAME GitHub issue. No AI similarity inference. Empty until the
// promotion PR exists, and that emptiness is honest, not a failure.
async function recurringRequests(db, since) {
  // An issue's IDENTITY is (repo, issue_number). github_issue_url is NOT part of
  // the promotion-coherence CHECK in 0009, so it can be NULL or differ for the
  // same issue; grouping by it would split one recurrence into singletons that
  // HAVING COUNT>1 then drops. Group by identity only; take any URL for display.
  const { results } = await db.prepare(
    `SELECT github_repo AS repo, github_issue_number AS issue_number, MAX(github_issue_url) AS issue_url, COUNT(*) AS n
       FROM feedback_submissions
       WHERE github_issue_number IS NOT NULL AND created_at >= datetime('now', ?)
       GROUP BY github_repo, github_issue_number
       HAVING COUNT(*) > 1 ORDER BY n DESC LIMIT 50`,
  ).bind(since).all();
  return results.map((r) => ({
    repo: r.repo ?? null, issueNumber: r.issue_number, issueUrl: r.issue_url ?? null, count: Number(r.n) || 0,
  }));
}

// Feedback -> improvement loop: only the portion the data supports today - the
// triage funnel and how many records reached a GitHub issue. "Shipped" and
// "experience afterward" are later inputs; the view marks them pending rather
// than inventing them.
async function feedbackLoop(db, since) {
  const { results } = await db.prepare(
    `SELECT triage_state AS state, COUNT(*) AS n FROM feedback_submissions
       WHERE created_at >= datetime('now', ?) GROUP BY triage_state`,
  ).bind(since).all();
  const triage = { new: 0, reviewing: 0, actionable: 0, closed: 0 };
  for (const r of results) if (Object.hasOwn(triage, r.state)) triage[r.state] = Number(r.n) || 0;
  const promoted = await db.prepare(
    `SELECT COUNT(*) AS n FROM feedback_submissions
       WHERE github_issue_number IS NOT NULL AND created_at >= datetime('now', ?)`,
  ).bind(since).first();
  return { triage, promoted: Number(promoted?.n) || 0 };
}

// Turn a section/version map into a sorted array of rows. Sections sort by
// total desc (busiest workflow first); a null key becomes the sentinel the view
// labels "(unspecified)".
function distMapToRows(map, keyName, order) {
  const rows = [];
  for (const [key, dist] of map) rows.push({ [keyName]: key, ...dist });
  if (order === "total") rows.sort((a, b) => b.total - a.total);
  return rows;
}

// Evidence SUMMARIES (never priorities). Computed at ANY sample size - a tiny
// sample is NOT suppressed; the view shows the exact response count and a
// "Small sample" indicator so it is never portrayed as strong evidence.
// Strongest = highest Good% among workflows; needs-attention = highest
// Not-good%; improving = the latest version whose Good% exceeds the previous
// version's. Ties prefer the busier workflow because sectionRows arrive sorted
// by total desc. Each summary carries raw COUNTS + total so the view can show
// "X of N responses". Any may be null only when there is genuinely NO data.
function evidenceSummaries(sectionRows, versionRows) {
  const named = sectionRows.filter((r) => r.section !== null && r.total > 0);
  let strongest = null;
  let needsAttention = null;
  for (const r of named) {
    const goodPct = pct(r.good, r.total);
    const notGoodPct = pct(r.notGood, r.total);
    if (!strongest || goodPct > strongest.goodPct) {
      strongest = { section: r.section, goodPct, goodCount: r.good, total: r.total };
    }
    if (!needsAttention || notGoodPct > needsAttention.notGoodPct) {
      needsAttention = { section: r.section, notGoodPct, notGoodCount: r.notGood, total: r.total };
    }
  }

  // Improving: compare the two most recent versions (by first-seen) that each
  // have at least one response. Report the fact of improvement, never a cause.
  let improving = null;
  const withData = versionRows.filter((r) => r.total > 0);
  if (withData.length >= 2) {
    const prev = withData[withData.length - 2];
    const curr = withData[withData.length - 1];
    const prevGood = pct(prev.good, prev.total);
    const currGood = pct(curr.good, curr.total);
    if (currGood > prevGood) {
      improving = {
        fromVersion: prev.version, toVersion: curr.version,
        fromGoodPct: prevGood, fromGoodCount: prev.good, fromTotal: prev.total,
        toGoodPct: currGood, toGoodCount: curr.good, toTotal: curr.total,
      };
    }
  }
  return { strongest, needsAttention, improving };
}

// Build the whole scorecard: the distribution for ALL THREE windows (the
// headline comparison), plus the detailed signals for the SELECTED window.
export async function buildScorecard(db, selectedWindowKey = DEFAULT_WINDOW_KEY) {
  const selected = windowByKey(selectedWindowKey);

  // Pre-migration compatibility: the Pulse table (0010) and Feedback table
  // (0009) may not exist yet in this environment. Skip the queries that depend
  // on an absent table and render an honest empty state instead of crashing.
  const pulseAvailable = await tableExists(db, "feedback_experience_pulses");
  const feedbackAvailable = await tableExists(db, "feedback_submissions");

  const distributionByWindow = [];
  for (const w of SCORECARD_WINDOWS) {
    distributionByWindow.push({ key: w.key, label: w.label, ...(pulseAvailable ? await overallDistribution(db, w.since) : emptyDist()) });
  }

  const sectionMap = pulseAvailable ? await distributionByDimension(db, selected.since, "source_section") : new Map();
  const versionMap = pulseAvailable ? await distributionByDimension(db, selected.since, "app_version") : new Map();
  const order = pulseAvailable ? await versionOrder(db, selected.since) : [];
  // Friction JOINs pulse -> feedback, so it needs BOTH tables.
  const linked = (pulseAvailable && feedbackAvailable) ? await linkedFeedbackBySection(db, selected.since) : new Map();

  // ALL workflows (for the evidence summaries, which must consider every
  // workflow at any sample size) vs the DISPLAY slice (bounded, visibly capped).
  const bySectionAll = distMapToRows(sectionMap, "section", "total");
  const bySection = bySectionAll.slice(0, WORKFLOW_DISPLAY_MAX);
  const workflowCount = bySectionAll.length;
  // Versions in chronological order, distribution attached.
  const byVersion = order.map((o) => ({ version: o.version, firstSeen: o.firstSeen, ...(versionMap.get(o.version) ?? emptyDist()) }));

  const friction = bySection.map((s) => {
    const l = linked.get(s.section) ?? { count: 0, snippets: [] };
    return {
      section: s.section,
      good: s.good, okay: s.okay, notGood: s.notGood, total: s.total,
      linkedCount: l.count, linked: l.snippets,
    };
  });

  return {
    selectedWindow: { key: selected.key, label: selected.label },
    distributionByWindow,
    bySection,
    workflowCount,
    workflowDisplayMax: WORKFLOW_DISPLAY_MAX,
    byVersion,
    friction,
    recurring: feedbackAvailable ? await recurringRequests(db, selected.since) : [],
    loop: feedbackAvailable ? await feedbackLoop(db, selected.since) : emptyLoop(),
    // Summaries consider EVERY workflow, not just the displayed slice.
    summaries: evidenceSummaries(bySectionAll, byVersion),
    summarySmallSampleMax: SUMMARY_SMALL_SAMPLE_MAX,
    pulseAvailable,
    feedbackAvailable,
  };
}
