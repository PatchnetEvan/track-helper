// Beta Experience Scorecard v1 (#55, PR3B): the Admin rendering layer. It turns
// the read-only aggregation from experience-scorecard-service.js into an
// operator page. It renders NOTHING it did not escape: source_section and
// feedback snippets are UNTRUSTED rider-influenced text and pass through
// escapeHtml at every sink; source_route is not rendered at all (aggregation is
// by workflow, not route). No mutation, no form, no CSRF - this surface only
// reads. Every count is shown with its percentage and sample; the evidence
// summaries are presented explicitly as summaries, never as priorities.

import { escapeHtml } from "./waitlist-profile-service.js";
import {
  buildScorecard, SCORECARD_WINDOWS, windowByKey, pct, PULSE_VALUE_LABELS, isSmallSample,
} from "./experience-scorecard-service.js";

const STYLE = `
  body { font: 15px/1.5 system-ui, sans-serif; margin: 1.5rem; color: #14181d; }
  h1 { font-size: 1.3rem; } h2 { font-size: 1.05rem; margin-top: 2rem; }
  table { border-collapse: collapse; width: 100%; margin-top: .6rem; }
  th, td { text-align: left; padding: .4rem .6rem; border-bottom: 1px solid #d8dde3; vertical-align: top; }
  td.num, th.num { text-align: right; white-space: nowrap; }
  .muted { color: #5a6572; }
  .pctnote { color: #5a6572; font-size: .85em; }
  .panel { border: 1px solid #d8dde3; border-radius: .4rem; padding: .9rem 1.1rem; margin-top: 1rem; }
  .note { background: #f4f6f9; border: 1px solid #dfe4ea; padding: .55rem .8rem; border-radius: .3rem; margin: .5rem 0; }
  .summaries { background: #fdf6e4; border: 1px solid #e3d5a8; padding: .7rem 1rem; border-radius: .4rem; }
  .summaries strong { display: inline-block; min-width: 11rem; }
  .windows a { margin-right: .8rem; text-decoration: none; }
  .windows a.current { font-weight: 700; text-decoration: underline; }
  .small { font-size: .85em; }
  .empty { color: #5a6572; font-style: italic; }
  .v { padding: .05rem .4rem; border-radius: .3rem; background: #eef1f5; font-size: .85em; }
  .smalltag { margin-left: .4rem; padding: .05rem .4rem; border-radius: .3rem; background: #fdeec9; border: 1px solid #d9b95e; font-size: .78em; white-space: nowrap; }
`;

const shell = (title, body) => new Response(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>${escapeHtml(title)} — MotoTrack Admin</title>
  <style>${STYLE}</style>
</head>
<body>
<header><strong>MotoTrack Admin</strong> · Experience Scorecard · <a href="/admin/waitlist">Waitlist queue →</a></header>
${body}
</body>
</html>`, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex, nofollow", "cache-control": "no-store" } });

// A count is ALWAYS shown with its percentage. Never a bare percentage.
const cell = (n, total) => `<td class="num">${n} <span class="pctnote">(${pct(n, total)}%)</span></td>`;

// The value/total header cells for a Good/Okay/Not good/Total distribution
// table; DIST_HEAD prepends a blank first column for tables whose row label is
// the window, DIST_VALUE_HEAD is used after a named first column.
const DIST_VALUE_HEAD = `<th class="num">${escapeHtml(PULSE_VALUE_LABELS[3])}</th>`
  + `<th class="num">${escapeHtml(PULSE_VALUE_LABELS[2])}</th>`
  + `<th class="num">${escapeHtml(PULSE_VALUE_LABELS[1])}</th>`
  + `<th class="num">Total</th>`;
const DIST_HEAD = `<th></th>${DIST_VALUE_HEAD}`;

const distCells = (d) => `${cell(d.good, d.total)}${cell(d.okay, d.total)}${cell(d.notGood, d.total)}<td class="num">${d.total}</td>`;

// Signal 1 — Experience distribution across ALL THREE windows (the headline).
function distributionSection(distributionByWindow) {
  const rows = distributionByWindow.map((w) => `<tr>
    <th>${escapeHtml(w.label)}</th>${distCells(w)}
  </tr>`).join("\n");
  return `
<h2>1 · Experience distribution</h2>
<p class="note">"How was this experience?" — one-tap responses. Counts are shown with percentages; a low total is real and stays visible.</p>
<table>
  <thead><tr>${DIST_HEAD}</tr></thead>
  <tbody>${rows}</tbody>
</table>`;
}

function windowSwitcher(selectedKey) {
  const links = SCORECARD_WINDOWS.map((w) =>
    `<a class="${w.key === selectedKey ? "current" : ""}" href="/admin/experience?window=${escapeHtml(w.key)}">${escapeHtml(w.label)}</a>`,
  ).join("");
  return `<p class="windows">Detailed signals for: ${links}</p>`;
}

const sectionLabel = (section) => (section === null ? '<span class="muted">(unspecified)</span>' : escapeHtml(section));

// Only render a link for an https URL; anything else (javascript:, data:, a bare
// scheme, etc.) is shown as inert text. github_issue_url is operator-set, but a
// value is never trusted into an href without a scheme check.
const safeHttpUrl = (u) => (typeof u === "string" && /^https:\/\//i.test(u) ? u : null);

// A VISIBLE cap notice (never a silent truncation) when more workflows exist
// than are displayed.
const capNote = (shown, total) => (total > shown
  ? `<p class="note">Showing the ${shown} busiest workflows of ${total} in this window (raw counts for all are aggregated; the list is capped only for readability).</p>`
  : "");

// Signal 2 — By workflow (source_section). source_section is UNTRUSTED -> escaped.
function byWorkflowSection(bySection, workflowCount) {
  if (!bySection.length) return `<h2>2 · By workflow</h2><p class="empty">No responses in this window yet.</p>`;
  const rows = bySection.map((s) => `<tr>
    <td>${sectionLabel(s.section)}</td>${distCells(s)}
  </tr>`).join("\n");
  return `
<h2>2 · By workflow</h2>
<p class="note">Aggregated by the workflow the response came from.</p>
${capNote(bySection.length, workflowCount)}
<table>
  <thead><tr><th>Workflow</th>${DIST_VALUE_HEAD}</tr></thead>
  <tbody>${rows}</tbody>
</table>`;
}

// Signal 3 — By app version (chronological). NEVER claims causation.
function byVersionSection(byVersion) {
  if (!byVersion.length) return `<h2>3 · By app version</h2><p class="empty">No responses in this window yet.</p>`;
  const rows = byVersion.map((v) => `<tr>
    <td><span class="v">${escapeHtml(v.version)}</span></td>${distCells(v)}
  </tr>`).join("\n");
  return `
<h2>3 · By app version</h2>
<p class="note">Versions in the order they first appeared in this window. A difference after a version is <strong>evidence</strong>, not proof that any change caused it.</p>
<table>
  <thead><tr><th>Version</th>${DIST_VALUE_HEAD}</tr></thead>
  <tbody>${rows}</tbody>
</table>`;
}

// Signal 4 — Friction clusters. Pulse = where; Feedback = why. No AI clustering.
// linkedCount is the ACCURATE per-workflow linked total; only a bounded set of
// example snippets is rendered, with "and N more" when the count exceeds them.
function frictionSection(friction, workflowCount) {
  if (!friction.length) return `<h2>4 · Friction clusters</h2><p class="empty">No responses in this window yet.</p>`;
  const blocks = friction.map((f) => {
    const shown = f.linked.length;
    const more = f.linkedCount > shown ? `<li class="muted">…and ${f.linkedCount - shown} more</li>` : "";
    const linked = shown
      ? `<ul class="small">${f.linked.map((l) =>
          `<li>${escapeHtml(l.snippet)}${l.snippet.length >= 140 ? "…" : ""} <span class="muted">(${escapeHtml(l.createdAt ?? "")})</span></li>`).join("")}${more}</ul>`
      : `<p class="empty small">No linked written feedback in this window.</p>`;
    return `<div class="panel">
      <strong>${sectionLabel(f.section)}</strong>
      <table><thead><tr>${DIST_HEAD}</tr></thead><tbody><tr><th class="muted">Pulse</th>${distCells(f)}</tr></tbody></table>
      <p class="small muted">Linked written feedback (${f.linkedCount}):</p>
      ${linked}
    </div>`;
  }).join("\n");
  return `
<h2>4 · Friction clusters</h2>
<p class="note">The Pulse tells us <strong>where</strong>; written Feedback tells us <strong>why</strong>. Only feedback a rider explicitly linked to a pulse is shown here — no automated clustering.</p>
${capNote(friction.length, workflowCount)}
${blocks}`;
}

// Signal 5 — Recurring rider requests. Real repeated evidence only.
function recurringSection(recurring) {
  if (!recurring.length) {
    return `
<h2>5 · Recurring rider requests</h2>
<p class="empty">No recurring requests are evidenced yet. This signal requires multiple feedback records linked to the same GitHub issue — a later step — and will stay empty until then rather than guess at similarity.</p>`;
  }
  const rows = recurring.map((r) => {
    const label = `${escapeHtml(r.repo ?? "")}#${escapeHtml(String(r.issueNumber))}`;
    const href = safeHttpUrl(r.issueUrl);
    return `<tr>
    <td>${href ? `<a href="${escapeHtml(href)}" rel="noreferrer noopener">${label}</a>` : label}</td>
    <td class="num">${r.count}</td>
  </tr>`;
  }).join("\n");
  return `
<h2>5 · Recurring rider requests</h2>
<p class="note">Feedback records grouped by the GitHub issue an operator linked them to. Not inferred — explicitly linked.</p>
<table><thead><tr><th>Linked issue</th><th class="num">Feedback records</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// Signal 6 — Feedback -> improvement loop. Only the supported portion.
function loopSection(loop) {
  const t = loop.triage;
  return `
<h2>6 · Feedback → improvement loop</h2>
<p class="note">The portion the data supports today, for feedback <strong>received in this window</strong>: where it sits in triage, and how much reached a linked issue. "Shipped" and "experience afterward" are later inputs and are shown as pending.</p>
<table>
  <thead><tr><th>Received (new)</th><th>Reviewing</th><th>Actionable</th><th>Closed</th><th>Reached a GitHub issue</th><th>Shipped → experience after</th></tr></thead>
  <tbody><tr>
    <td class="num">${t.new}</td><td class="num">${t.reviewing}</td><td class="num">${t.actionable}</td><td class="num">${t.closed}</td>
    <td class="num">${loop.promoted}</td><td class="empty">pending later work</td>
  </tr></tbody>
</table>`;
}

// The evidence summaries — clearly labeled NOT priorities. Each shows its exact
// response count; a small sample carries a visible "Small sample" tag so it is
// never portrayed as strong evidence. Nothing is suppressed by sample size.
const smallTag = (total) => (isSmallSample(total) ? `<span class="smalltag">Small sample</span>` : "");

function summariesSection(summaries) {
  const line = (label, body) => `<div><strong>${escapeHtml(label)}</strong> ${body}</div>`;
  const good = escapeHtml(PULSE_VALUE_LABELS[3]);
  const notGood = escapeHtml(PULSE_VALUE_LABELS[1]);
  const strongest = summaries.strongest
    ? line("Strongest experience:", `${sectionLabel(summaries.strongest.section)} — ${summaries.strongest.total} responses, ${summaries.strongest.goodCount} ${good} <span class="muted">(${summaries.strongest.goodPct}%)</span> ${smallTag(summaries.strongest.total)}`)
    : line("Strongest experience:", `<span class="empty">no responses yet</span>`);
  const attention = summaries.needsAttention
    ? line("Needs attention:", `${sectionLabel(summaries.needsAttention.section)} — ${summaries.needsAttention.total} responses, ${summaries.needsAttention.notGoodCount} ${notGood} <span class="muted">(${summaries.needsAttention.notGoodPct}%)</span> ${smallTag(summaries.needsAttention.total)}`)
    : line("Needs attention:", `<span class="empty">no responses yet</span>`);
  const improving = summaries.improving
    ? line("Improving:", `experience improved after <span class="v">${escapeHtml(summaries.improving.toVersion)}</span> — ${good} ${summaries.improving.fromGoodCount} of ${summaries.improving.fromTotal} → ${summaries.improving.toGoodCount} of ${summaries.improving.toTotal} ${smallTag(Math.min(summaries.improving.fromTotal, summaries.improving.toTotal))} <span class="muted">(vs ${escapeHtml(summaries.improving.fromVersion)})</span>`)
    : line("Improving:", `<span class="empty">no version-over-version improvement evidenced</span>`);
  return `
<h2>Evidence summaries</h2>
<div class="summaries">
  <p class="small"><strong>These are evidence summaries, not priorities.</strong> Product priority remains an operator decision. Every summary shows its exact response count and is visible at any sample size; a small sample is labeled as such and never portrayed as strong evidence. The only frozen publication threshold, n≥25, applies to future public figures — not to this internal view.</p>
  ${strongest}
  ${attention}
  ${improving}
</div>`;
}

// Render the whole Experience Scorecard for the selected window. Read-only.
export async function renderExperienceScorecard(db, url) {
  const requested = url.searchParams.get("window");
  const selectedKey = windowByKey(requested).key;
  const s = await buildScorecard(db, selectedKey);

  const body = `
<h1>Beta Experience Scorecard</h1>
<p class="muted">Read-only evidence from the Experience Pulse and linked written Feedback. It summarizes; it does not decide.</p>
${distributionSection(s.distributionByWindow)}
${windowSwitcher(s.selectedWindow.key)}
${summariesSection(s.summaries)}
${byWorkflowSection(s.bySection, s.workflowCount)}
${byVersionSection(s.byVersion)}
${frictionSection(s.friction, s.workflowCount)}
${recurringSection(s.recurring)}
${loopSection(s.loop)}
`;
  return shell("Experience Scorecard", body);
}
