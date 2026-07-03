export function renderTrackAgentHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>MotoTrack Track Agent</title>
  <style>
    :root { color-scheme: dark; --bg: #121212; --panel: #1d1d1d; --text: #f4f4f4; --muted: #a8a8a8; --accent: #ff6600; --good: #00ff88; --bad: #ff5b5b; --border: #343434; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.45 system-ui, -apple-system, Segoe UI, sans-serif; }
    main { max-width: 980px; margin: 0 auto; padding: 20px 14px 60px; }
    h1 { margin: 0 0 4px; font-size: 1.45rem; }
    h2 { margin: 0 0 12px; font-size: 1.05rem; color: var(--text); }
    p { color: var(--muted); }
    section { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 14px; margin: 14px 0; }
    label { display: flex; flex-direction: column; gap: 5px; margin-bottom: 10px; color: var(--muted); font-size: 0.92rem; }
    input, textarea, select { width: 100%; min-height: 42px; border: 1px solid var(--border); border-radius: 6px; background: #252525; color: var(--text); padding: 9px 10px; font: inherit; }
    textarea { min-height: 130px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
    button { min-height: 44px; border: 0; border-radius: 6px; padding: 10px 14px; background: var(--accent); color: #160700; font-weight: 750; cursor: pointer; }
    button:disabled { opacity: 0.45; cursor: not-allowed; }
    pre { overflow: auto; background: #0b0b0b; border: 1px solid var(--border); border-radius: 6px; padding: 10px; color: var(--good); }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    .notice { border-left: 4px solid var(--accent); padding-left: 10px; }
    .warn { color: #ffd166; }
    .error { color: var(--bad); }
    .good { color: var(--good); }
    .hidden { display: none; }
    @media (max-width: 700px) { .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <h1>Track Agent</h1>
    <p>Premium prototype for <strong>agent.mototrack.app</strong>. Parser output must be reviewed before saving.</p>

    <section>
      <h2>Raw Session Note</h2>
      <p class="notice">Parse creates an editable draft only. Nothing is saved until you click Save / Confirm.</p>
      <label>
        Rider note
        <textarea id="raw-note">At Road Atlanta session 2 on Ninja 400 best 97.4 front cold 30 rear hot 27 sprocket 45 -> 47 rear comp +2 chasing exit drive felt better</textarea>
      </label>
      <div class="actions">
        <button id="parse-button" type="button">Parse</button>
        <span id="parse-status"></span>
      </div>
    </section>

    <section id="review-section" class="hidden">
      <h2>Review Parsed Payload</h2>
      <p>Edit anything that looks wrong. The save call sends the canonical reviewed payload with <code>confirmed: true</code>.</p>
      <div class="grid">
        <label>Track name <input id="track-name" /></label>
        <label>Bike name <input id="bike-name" /></label>
        <label>Session number <input id="session-number" inputmode="numeric" /></label>
        <label>Session label <input id="session-label" /></label>
        <label>Best lap time <input id="best-lap" /></label>
        <label>Confidence overall <input id="confidence-overall" inputmode="decimal" /></label>
        <label>Front hot pressure <input id="front-hot" inputmode="decimal" /></label>
        <label>Rear hot pressure <input id="rear-hot" inputmode="decimal" /></label>
      </div>
      <label>Setup change text <input id="setup-change" /></label>
      <label>Handling / rider note <input id="rider-note" /></label>
      <label>Warnings <textarea id="warnings" rows="3"></textarea></label>
      <div class="actions">
        <button id="save-button" type="button" disabled>Save / Confirm</button>
        <span id="save-status"></span>
      </div>
      <h2>Canonical Payload Preview</h2>
      <pre id="payload-preview">{}</pre>
    </section>

    <section id="saved-section" class="hidden">
      <h2>Saved Summary</h2>
      <div id="saved-summary"></div>
      <pre id="saved-json">{}</pre>
    </section>
  </main>
  <script src="/track-agent/ui.js" defer></script>
</body>
</html>`;
}

export function renderTrackAgentClientScript() {
  return `"use strict";

const state = {
  parsed: null,
  rawNote: "",
  savedSessionId: null,
};

const $ = (id) => document.getElementById(id);

function setText(id, value, className) {
  const el = $(id);
  el.textContent = value || "";
  el.className = className || "";
}

function optionalNumber(value) {
  if (value == null || String(value).trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeParsedToCanonical(parsed, rawNote) {
  if (parsed.entry || parsed.session || parsed.lap_times || parsed.tire_pressures || parsed.notes) {
    const entry = parsed.entry || {};
    const session = parsed.session || {};
    const sessionNumber = session.session_number == null || session.session_number === ""
      ? null
      : Number(session.session_number);
    return {
      confirmed: true,
      source: "manual_review",
      entry: {
        raw_note: entry.raw_note || rawNote,
        track_name: entry.track_name || null,
        bike_name: entry.bike_name || null,
        event_ref: entry.event_ref || null,
        motorcycle_ref: entry.motorcycle_ref || null,
        track_ref: entry.track_ref || null,
        app_session_ref: entry.app_session_ref || null,
      },
      session: {
        session_number: Number.isFinite(sessionNumber) ? sessionNumber : null,
        session_label: session.session_label || null,
        session_type: session.session_type || null,
        occurred_at: session.occurred_at || null,
        conditions: session.conditions || { weather: null, track_temp: null, air_temp: null },
      },
      lap_times: Array.isArray(parsed.lap_times) ? parsed.lap_times : [],
      tire_pressures: Array.isArray(parsed.tire_pressures) ? parsed.tire_pressures : [],
      setup_changes: Array.isArray(parsed.setup_changes) ? parsed.setup_changes : [],
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
      confidence: parsed.confidence && typeof parsed.confidence === "object" ? parsed.confidence : { overall: null, fields: {} },
    };
  }

  const warnings = Array.isArray(parsed.warnings) ? parsed.warnings : [];
  const setupChange = Array.isArray(parsed.setup_changes) && parsed.setup_changes[0]
    ? parsed.setup_changes[0]
    : null;
  const notes = parsed.handling_notes
    ? [{ note_type: "handling", area: null, note: parsed.handling_notes, source: "rider_note" }]
    : [];

  return {
    confirmed: true,
    source: "manual_review",
    entry: {
      raw_note: parsed.raw_note || rawNote,
      track_name: parsed.track_name || null,
      bike_name: parsed.bike_name || null,
      event_ref: null,
      motorcycle_ref: null,
      track_ref: null,
      app_session_ref: null,
    },
    session: {
      session_number: parsed.session_number == null ? null : Number(parsed.session_number),
      session_label: parsed.session_number == null ? null : "Session " + parsed.session_number,
      session_type: null,
      occurred_at: null,
      conditions: { weather: null, track_temp: null, air_temp: null },
    },
    lap_times: parsed.best_lap_time ? [{ lap_number: null, lap_time: String(parsed.best_lap_time), is_best: true, source: "rider_note" }] : [],
    tire_pressures: [
      { position: "front", timing: "hot", pressure_psi: parsed.front_hot_pressure, source: "rider_note" },
      { position: "rear", timing: "hot", pressure_psi: parsed.rear_hot_pressure, source: "rider_note" },
    ].filter((pressure) => pressure.pressure_psi != null),
    setup_changes: setupChange ? [{
      timing: null,
      component: setupChange.category || null,
      adjustment: setupChange.field || null,
      change: setupChange.to_value || setupChange.delta || setupChange.raw_text || null,
      source: "rider_note",
    }] : [],
    notes,
    warnings,
    confidence: { overall: typeof parsed.confidence === "number" ? parsed.confidence : null, fields: {} },
  };
}

function fillReviewForm(payload) {
  $("track-name").value = payload.entry.track_name || "";
  $("bike-name").value = payload.entry.bike_name || "";
  $("session-number").value = payload.session.session_number == null ? "" : String(payload.session.session_number);
  $("session-label").value = payload.session.session_label || "";
  $("best-lap").value = payload.lap_times[0] && payload.lap_times[0].lap_time || "";
  $("confidence-overall").value = payload.confidence.overall == null ? "" : String(payload.confidence.overall);
  const frontHot = payload.tire_pressures.find((p) => p.position === "front" && p.timing === "hot");
  const rearHot = payload.tire_pressures.find((p) => p.position === "rear" && p.timing === "hot");
  $("front-hot").value = frontHot && frontHot.pressure_psi != null ? String(frontHot.pressure_psi) : "";
  $("rear-hot").value = rearHot && rearHot.pressure_psi != null ? String(rearHot.pressure_psi) : "";
  $("setup-change").value = payload.setup_changes[0] && payload.setup_changes[0].change || "";
  $("rider-note").value = payload.notes[0] && payload.notes[0].note || "";
  $("warnings").value = payload.warnings.join("\\n");
  $("review-section").classList.remove("hidden");
  $("save-button").disabled = false;
  updatePreview();
}

function buildPayloadFromForm() {
  const rawNote = state.rawNote || $("raw-note").value.trim();
  const bestLap = $("best-lap").value.trim();
  const frontHot = optionalNumber($("front-hot").value);
  const rearHot = optionalNumber($("rear-hot").value);
  const setupChange = $("setup-change").value.trim();
  const riderNote = $("rider-note").value.trim();
  return {
    confirmed: true,
    source: "manual_review",
    entry: {
      raw_note: rawNote,
      track_name: $("track-name").value.trim() || null,
      bike_name: $("bike-name").value.trim() || null,
      event_ref: null,
      motorcycle_ref: null,
      track_ref: null,
      app_session_ref: null,
    },
    session: {
      session_number: optionalNumber($("session-number").value),
      session_label: $("session-label").value.trim() || null,
      session_type: null,
      occurred_at: null,
      conditions: { weather: null, track_temp: null, air_temp: null },
    },
    lap_times: bestLap ? [{ lap_number: null, lap_time: bestLap, is_best: true, source: "rider_note" }] : [],
    tire_pressures: [
      frontHot == null ? null : { position: "front", timing: "hot", pressure_psi: frontHot, source: "rider_note" },
      rearHot == null ? null : { position: "rear", timing: "hot", pressure_psi: rearHot, source: "rider_note" },
    ].filter(Boolean),
    setup_changes: setupChange ? [{ timing: null, component: null, adjustment: null, change: setupChange, source: "rider_note" }] : [],
    notes: riderNote ? [{ note_type: "handling", area: null, note: riderNote, source: "rider_note" }] : [],
    warnings: $("warnings").value.split(/\\r?\\n/).map((line) => line.trim()).filter(Boolean),
    confidence: { overall: optionalNumber($("confidence-overall").value), fields: {} },
  };
}

function updatePreview() {
  $("payload-preview").textContent = JSON.stringify(buildPayloadFromForm(), null, 2);
}

async function parseNote() {
  setText("parse-status", "Parsing...");
  $("save-button").disabled = true;
  state.rawNote = $("raw-note").value.trim();
  const response = await fetch("/track-agent/parse", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ raw_note: state.rawNote }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || data.error || "Parse failed");
  state.parsed = normalizeParsedToCanonical(data.parsed || {}, state.rawNote);
  fillReviewForm(state.parsed);
  setText("parse-status", "Parsed. Review before saving.", "good");
}

async function saveReviewed() {
  setText("save-status", "Saving...");
  const payload = buildPayloadFromForm();
  const response = await fetch("/track-agent/save", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || data.error || "Save failed");
  state.savedSessionId = data.saved.session_id;
  const readResponse = await fetch("/track-agent/session/" + encodeURIComponent(state.savedSessionId));
  const readData = await readResponse.json();
  if (!readResponse.ok) throw new Error(readData.message || readData.error || "Read-back failed");
  renderSaved(data.saved, readData.session);
  setText("save-status", "Saved and read back from D1.", "good");
}

function renderSaved(saved, sessionData) {
  $("saved-section").classList.remove("hidden");
  const summary = $("saved-summary");
  summary.textContent = "";
  const lines = [
    "Persisted: " + saved.persisted,
    "Session id: " + saved.session_id,
    "Track: " + (sessionData.session.track_name || ""),
    "Bike: " + (sessionData.session.bike_name || ""),
    "Lap rows: " + sessionData.lap_times.length,
    "Pressure rows: " + sessionData.tire_pressures.length,
    "Setup changes: " + sessionData.setup_changes.length,
    "Notes: " + sessionData.notes.length,
  ];
  for (const line of lines) {
    const p = document.createElement("p");
    p.textContent = line;
    summary.appendChild(p);
  }
  $("saved-json").textContent = JSON.stringify(sessionData, null, 2);
}

document.addEventListener("DOMContentLoaded", () => {
  $("parse-button").addEventListener("click", () => parseNote().catch((err) => setText("parse-status", err.message, "error")));
  $("save-button").addEventListener("click", () => saveReviewed().catch((err) => setText("save-status", err.message, "error")));
  ["track-name", "bike-name", "session-number", "session-label", "best-lap", "confidence-overall", "front-hot", "rear-hot", "setup-change", "rider-note", "warnings"].forEach((id) => {
    $(id).addEventListener("input", updatePreview);
  });
});
`;
}
