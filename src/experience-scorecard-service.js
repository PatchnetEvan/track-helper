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
//     EVIDENCE SUMMARIES, never automated priorities. They are guarded by a
//     modest internal sample floor so a 1-2 response workflow is never crowned,
//     and the view presents them as summaries, not actions.
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

// Internal DISPLAY guard for the superlative evidence summaries only: a
// workflow needs at least this many responses before it can be called the
// strongest / most in need of attention, so a 1-2 response section is never
// portrayed as strong evidence. This is NOT the public Beta Update n>=25
// threshold (which does not apply to internal Admin) - every raw count is still
// shown regardless of this floor.
export const SUMMARY_MIN_SAMPLE = 5;

export function windowByKey(key) {
  return SCORECARD_WINDOWS.find((w) => w.key === key) ?? SCORECARD_WINDOWS.find((w) => w.key === DEFAULT_WINDOW_KEY);
}

// Integer percentage of a count within a total. 0 when the total is 0 (never
// NaN). Percentages are a presentation aid ON TOP OF the always-present count.
export function pct(n, total) {
  return total > 0 ? Math.round((Number(n) || 0) / total * 100) : 0;
}

const emptyDist = () => ({ good: 0, okay: 0, notGood: 0, total: 0 });

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
  const { results } = await db.prepare(
    `SELECT app_version AS k, MIN(created_at) AS first_seen FROM feedback_experience_pulses
       WHERE created_at >= datetime('now', ?) GROUP BY app_version ORDER BY first_seen ASC`,
  ).bind(since).all();
  return results.map((r) => ({ version: String(r.k), firstSeen: r.first_seen }));
}

// Written feedback LINKED to a pulse (the "why" behind the "where"). Empty
// until pulses carry a feedback_id. Bodies are UNTRUSTED - returned raw, escaped
// by the view; only a bounded snippet is read.
async function linkedFeedbackBySection(db, since) {
  const { results } = await db.prepare(
    `SELECT p.source_section AS section, f.id AS id, substr(f.body, 1, 140) AS snippet, f.created_at AS created_at
       FROM feedback_experience_pulses p JOIN feedback_submissions f ON f.id = p.feedback_id
       WHERE p.created_at >= datetime('now', ?)
       ORDER BY f.created_at DESC LIMIT 100`,
  ).bind(since).all();
  const map = new Map();
  for (const r of results) {
    const key = r.section === null || r.section === undefined ? null : String(r.section);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({ id: String(r.id), snippet: r.snippet ?? "", createdAt: r.created_at });
  }
  return map;
}

// Recurring requests: ONLY real repeated evidence - multiple feedback records
// promoted to the SAME GitHub issue. No AI similarity inference. Empty until the
// promotion PR exists, and that emptiness is honest, not a failure.
async function recurringRequests(db, since) {
  const { results } = await db.prepare(
    `SELECT github_repo AS repo, github_issue_number AS issue_number, github_issue_url AS issue_url, COUNT(*) AS n
       FROM feedback_submissions
       WHERE github_issue_number IS NOT NULL AND created_at >= datetime('now', ?)
       GROUP BY github_repo, github_issue_number, github_issue_url
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

// Evidence SUMMARIES (never priorities). Strongest = highest Good% among
// workflows meeting the sample floor; needs-attention = highest Not-good%;
// improving = the latest version whose Good% exceeds the previous version's
// (both meeting the floor). Any of these may be null (not enough evidence),
// which the view states plainly.
function evidenceSummaries(sectionRows, versionRows) {
  const eligible = sectionRows.filter((r) => r.total >= SUMMARY_MIN_SAMPLE && r.section !== null);
  let strongest = null;
  let needsAttention = null;
  for (const r of eligible) {
    const goodPct = pct(r.good, r.total);
    const notGoodPct = pct(r.notGood, r.total);
    if (!strongest || goodPct > strongest.goodPct) strongest = { section: r.section, goodPct, total: r.total };
    if (!needsAttention || notGoodPct > needsAttention.notGoodPct) {
      needsAttention = { section: r.section, notGoodPct, total: r.total };
    }
  }

  // Improving: compare the two most recent versions (by first-seen) that each
  // meet the floor. Report the fact of improvement, never a cause.
  let improving = null;
  const eligibleVersions = versionRows.filter((r) => r.total >= SUMMARY_MIN_SAMPLE);
  if (eligibleVersions.length >= 2) {
    const prev = eligibleVersions[eligibleVersions.length - 2];
    const curr = eligibleVersions[eligibleVersions.length - 1];
    const prevGood = pct(prev.good, prev.total);
    const currGood = pct(curr.good, curr.total);
    if (currGood > prevGood) {
      improving = { fromVersion: prev.version, toVersion: curr.version, fromGoodPct: prevGood, toGoodPct: currGood };
    }
  }
  return { strongest, needsAttention, improving };
}

// Build the whole scorecard: the distribution for ALL THREE windows (the
// headline comparison), plus the detailed signals for the SELECTED window.
export async function buildScorecard(db, selectedWindowKey = DEFAULT_WINDOW_KEY) {
  const selected = windowByKey(selectedWindowKey);

  const distributionByWindow = [];
  for (const w of SCORECARD_WINDOWS) {
    distributionByWindow.push({ key: w.key, label: w.label, ...(await overallDistribution(db, w.since)) });
  }

  const sectionMap = await distributionByDimension(db, selected.since, "source_section");
  const versionMap = await distributionByDimension(db, selected.since, "app_version");
  const order = await versionOrder(db, selected.since);
  const linked = await linkedFeedbackBySection(db, selected.since);

  const bySection = distMapToRows(sectionMap, "section", "total");
  // Versions in chronological order, distribution attached.
  const byVersion = order.map((o) => ({ version: o.version, firstSeen: o.firstSeen, ...(versionMap.get(o.version) ?? emptyDist()) }));

  const friction = bySection.map((s) => ({
    section: s.section,
    good: s.good, okay: s.okay, notGood: s.notGood, total: s.total,
    linked: linked.get(s.section) ?? [],
  }));

  return {
    selectedWindow: { key: selected.key, label: selected.label },
    distributionByWindow,
    bySection,
    byVersion,
    friction,
    recurring: await recurringRequests(db, selected.since),
    loop: await feedbackLoop(db, selected.since),
    summaries: evidenceSummaries(bySection, byVersion),
    summaryMinSample: SUMMARY_MIN_SAMPLE,
  };
}
