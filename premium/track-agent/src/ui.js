const TRACK_AGENT_INVITE_MAILTO = "mailto:evan.martinez@gmail.com?subject=Track%20Agent%20Pro%20Invite%20Request";

export function renderTrackAgentLandingHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Track Agent Pro</title>
  <style>
    :root { color-scheme: dark; --bg: #0f0f0f; --band: #181818; --panel: #202020; --text: #f5f5f5; --muted: #b9b9b9; --accent: #ff6600; --accent-2: #4fa3ff; --border: #333; --good: #00d084; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.5 system-ui, -apple-system, Segoe UI, sans-serif; }
    a { color: inherit; }
    img { display: block; max-width: 100%; }
    .hero { min-height: min(760px, 92vh); display: grid; align-items: end; position: relative; isolation: isolate; overflow: hidden; background: #111; }
    .hero::before { content: ""; position: absolute; inset: 0; z-index: -2; background: url("https://mototrack.app/assets/track-agent/hero-paddock.webp") center / cover no-repeat; }
    .hero::after { content: ""; position: absolute; inset: 0; z-index: -1; background: linear-gradient(90deg, rgba(0,0,0,0.78), rgba(0,0,0,0.42) 44%, rgba(0,0,0,0.18)), linear-gradient(0deg, rgba(15,15,15,1), rgba(15,15,15,0.05) 34%); }
    .hero-inner { width: min(100%, 1120px); margin: 0 auto; padding: 28px 16px 84px; }
    .eyebrow { margin: 0 0 10px; color: var(--accent); font-size: 0.82rem; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; }
    h1 { margin: 0; max-width: 720px; font-size: clamp(2.6rem, 8vw, 6.2rem); line-height: 0.94; letter-spacing: 0; }
    h2 { margin: 0; font-size: clamp(1.55rem, 3vw, 2.45rem); line-height: 1.05; letter-spacing: 0; }
    h3 { margin: 0; font-size: 1.05rem; letter-spacing: 0; }
    p { color: var(--muted); margin: 10px 0 0; max-width: 720px; }
    .lede { color: #e8e8e8; max-width: 620px; font-size: 1.08rem; }
    .cta-row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-top: 22px; }
    .cta { display: inline-flex; align-items: center; min-height: 48px; padding: 0 18px; border-radius: 6px; background: var(--accent); color: #180700; text-decoration: none; font-weight: 850; }
    .secondary-note { color: #d6d6d6; font-size: 0.94rem; }
    .section { padding: 54px 16px; }
    .section:nth-of-type(even) { background: var(--band); }
    .wrap { width: min(100%, 1120px); margin: 0 auto; }
    .split { display: grid; grid-template-columns: minmax(0, 0.94fr) minmax(0, 1.06fr); gap: 28px; align-items: center; }
    .split.reverse { grid-template-columns: minmax(0, 1.06fr) minmax(0, 0.94fr); }
    .media { overflow: hidden; border-radius: 8px; border: 1px solid var(--border); background: #121212; box-shadow: 0 18px 54px rgba(0,0,0,0.34); }
    .media img { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; }
    .points { display: grid; gap: 10px; margin-top: 18px; }
    .point { padding: 12px 0; border-top: 1px solid var(--border); color: var(--muted); }
    .point strong { color: var(--text); }
    .product-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-top: 18px; }
    .product { min-height: 100%; padding: 16px; border: 1px solid var(--border); border-radius: 8px; background: var(--panel); }
    .product h3 { margin-bottom: 8px; }
    .product ul, .steps { margin: 10px 0 0; padding-left: 20px; color: var(--muted); }
    .product li, .steps li { margin: 6px 0; }
    .mockup { margin-top: 18px; background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 14px; }
    .note { margin: 0 0 12px; padding: 10px; border-left: 3px solid var(--accent); background: #171717; color: var(--text); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 0.92rem; }
    .fields { display: grid; gap: 8px; }
    .field { display: flex; justify-content: space-between; gap: 12px; padding: 8px 10px; background: #181818; border: 1px solid var(--border); border-radius: 6px; color: var(--muted); }
    .field strong { color: var(--text); font-weight: 700; text-align: right; }
    .safe { color: var(--good); font-weight: 700; }
    .final { padding: 42px 16px 58px; background: #101010; border-top: 1px solid var(--border); }
    .final .wrap { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 16px; align-items: center; }
    footer { color: var(--muted); font-size: 0.92rem; }
    @media (max-width: 820px) {
      .hero { min-height: 680px; }
      .hero::before { background-position: 62% center; }
      .split, .split.reverse, .product-grid { grid-template-columns: 1fr; }
      .split.reverse .copy { order: -1; }
      .section { padding: 38px 14px; }
      .hero-inner { padding-bottom: 64px; }
    }
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <div class="hero-inner">
        <p class="eyebrow">Invite-only prototype</p>
        <h1>Track Agent Pro</h1>
        <p class="lede">Every lap's got a story. Let's stop losing them.</p>
        <p>Invite-only AI-assisted session logging for riders who want their track notes to become useful data.</p>
        <div class="cta-row">
          <a class="cta" href="${TRACK_AGENT_INVITE_MAILTO}">Request Invite</a>
          <span class="secondary-note">Fast logging first. AI-assisted structuring second.</span>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="wrap split">
        <div class="copy">
          <p class="eyebrow">The paddock problem</p>
          <h2>Your best data lives in your head.</h2>
          <p>Lap times, tire pressures, setup changes, and handling notes are created every session, but most of them disappear before they become useful.</p>
          <p>They live in memory, notebooks, tire-pressure notes, texts to crew, and forgotten setup changes. Track Agent Pro is built to help turn that rough paddock record into reviewable fields.</p>
          <div class="mockup" aria-label="Track Agent example extraction">
            <p class="note">Road Atlanta session 2. Best 97.4. Front hot 31, rear hot 27.5. Rear rebound softer one click.</p>
            <div class="fields">
              <div class="field"><span>Best lap</span><strong>97.4</strong></div>
              <div class="field"><span>Front hot</span><strong>31 psi</strong></div>
              <div class="field"><span>Rear hot</span><strong>27.5 psi</strong></div>
              <div class="field"><span>Setup change</span><strong>Rear rebound softer one click</strong></div>
              <div class="field"><span>Save behavior</span><strong class="safe">Rider confirms first</strong></div>
            </div>
          </div>
        </div>
        <figure class="media">
          <img src="https://mototrack.app/assets/track-agent/phone-session-log.webp" width="1400" height="788" alt="Phone-based session review interface in a motorcycle paddock" loading="lazy" />
        </figure>
      </div>
    </section>

    <section class="section">
      <div class="wrap split reverse">
        <figure class="media">
          <img src="https://mototrack.app/assets/track-agent/tire-pressure-log.webp" width="1400" height="788" alt="Rider checking motorcycle tire pressure while logging notes on a phone" loading="lazy" />
        </figure>
        <div class="copy">
          <p class="eyebrow">Product split</p>
          <h2>Two layers, one paddock notebook.</h2>
          <div class="product-grid">
            <div class="product">
              <h3>MotoTrack Log - Free</h3>
              <ul>
                <li>Local-first</li>
                <li>Fast session logging</li>
                <li>No account required</li>
                <li>No cloud dependency</li>
              </ul>
            </div>
            <div class="product">
              <h3>Track Agent Pro - Invite Only</h3>
              <ul>
                <li>Messy note to structured review</li>
                <li>Lap times and tire pressures</li>
                <li>Setup changes and rider notes</li>
                <li>Review-before-save</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="wrap split">
        <div class="copy">
          <p class="eyebrow">How it works</p>
          <h2>AI drafts, it never decides.</h2>
          <ol class="steps">
            <li>Capture a messy session note.</li>
            <li>Track Agent Pro drafts structured fields.</li>
            <li>The rider reviews and edits.</li>
            <li>The rider confirms save.</li>
          </ol>
          <p>Track Agent Pro drafts the structured fields. The rider reviews, edits, or rejects them before anything is saved.</p>
          <div class="points">
            <div class="point"><strong>Trust boundary</strong><br />No coaching recommendations, setup advice, or safety-critical decisions. Extraction-only for now.</div>
            <div class="point"><strong>Rollout discipline</strong><br />Invite-only on purpose. Small trusted tester group first, feedback before wider rollout, and controlled AI enablement.</div>
          </div>
        </div>
        <figure class="media">
          <img src="https://mototrack.app/assets/track-agent/data-flow.webp" width="1400" height="788" alt="Motorcycle track data flowing into secure cloud review panels" loading="lazy" />
        </figure>
      </div>
    </section>

    <section class="final">
      <div class="wrap">
        <div>
          <h3>Want to test it?</h3>
          <p>Future opportunities include rider history, coach workflows, track-day organization tools, and provider integrations, but the notebook and trust come first.</p>
        </div>
        <a class="cta" href="${TRACK_AGENT_INVITE_MAILTO}">Request Invite</a>
      </div>
    </section>
  </main>
</body>
</html>`;
}

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
      <p class="notice">Track Agent uses AI to convert your session notes into structured review fields. AI output is not saved automatically. You must review and confirm before anything is stored. Do not enter sensitive personal information, medical information, financial information, or anything unrelated to your track session.</p>
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

    <section>
      <h2>Internal Tools</h2>
      <p><a href="/track-agent/tire-pressure-advisor">Tire Pressure Advisor — Internal Rule-Only Preview</a></p>
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

export function renderTirePressureAdvisorHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Tire Pressure Advisor Internal Preview</title>
  <style>
    :root { color-scheme: dark; --bg: #121212; --panel: #1d1d1d; --subpanel: #181818; --text: #f4f4f4; --muted: #a8a8a8; --accent: #ff6600; --good: #00ff88; --warn: #ffd166; --bad: #ff5b5b; --border: #343434; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.45 system-ui, -apple-system, Segoe UI, sans-serif; }
    main { max-width: 1040px; margin: 0 auto; padding: 20px 14px 60px; }
    h1 { margin: 0 0 6px; font-size: 1.55rem; line-height: 1.15; }
    h2 { margin: 0 0 12px; font-size: 1.08rem; color: var(--text); }
    p { color: var(--muted); margin: 8px 0; }
    a { color: var(--text); }
    section { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 14px; margin: 14px 0; }
    fieldset { border: 1px solid var(--border); border-radius: 8px; padding: 12px; margin: 0 0 12px; background: var(--subpanel); }
    legend { padding: 0 6px; color: var(--text); font-weight: 800; }
    label { display: flex; flex-direction: column; gap: 5px; margin-bottom: 10px; color: var(--muted); font-size: 0.92rem; }
    input, textarea { width: 100%; min-height: 42px; border: 1px solid var(--border); border-radius: 6px; background: #252525; color: var(--text); padding: 9px 10px; font: inherit; }
    input::placeholder, textarea::placeholder { color: #767676; }
    textarea { min-height: 96px; resize: vertical; }
    button { min-height: 44px; border: 0; border-radius: 6px; padding: 10px 14px; background: var(--accent); color: #160700; font-weight: 750; cursor: pointer; }
    pre { overflow: auto; background: #0b0b0b; border: 1px solid var(--border); border-radius: 6px; padding: 10px; color: var(--good); }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    .notice { border-left: 4px solid var(--accent); padding: 10px 0 10px 10px; background: #171717; }
    .subhead { max-width: 760px; }
    .field-note { color: var(--muted); font-size: 0.82rem; }
    .required { color: var(--warn); font-size: 0.78rem; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; }
    .input-row { display: grid; gap: 4px; }
    .status-row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin: 4px 0 12px; }
    .status-pill { display: inline-flex; align-items: center; min-height: 32px; border: 1px solid var(--border); border-radius: 999px; padding: 5px 11px; color: var(--text); background: #151515; font-weight: 800; }
    .status-ready { border-color: rgba(0,255,136,0.45); color: var(--good); }
    .status-needs-more-info { border-color: rgba(255,209,102,0.55); color: var(--warn); }
    .status-not-supported { border-color: rgba(255,91,91,0.55); color: var(--bad); }
    .result-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
    .result-panel { border: 1px solid var(--border); border-radius: 8px; padding: 12px; background: var(--subpanel); }
    .result-panel h2 { margin-bottom: 8px; }
    .result-list { display: grid; gap: 8px; margin: 10px 0; padding: 0; list-style: none; }
    .result-list li { border: 1px solid var(--border); border-radius: 6px; padding: 9px 10px; background: #181818; color: var(--muted); }
    .result-list.warning-list li { border-color: rgba(255,209,102,0.45); color: #f5d88a; }
    .adjustment strong { color: var(--text); }
    .error-panel { border-color: rgba(255,91,91,0.45); background: #241717; }
    .error { color: var(--bad); }
    .good { color: var(--good); }
    .hidden { display: none; }
    @media (max-width: 780px) { .grid, .result-grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <p><a href="/track-agent">Back to Track Agent</a></p>
    <h1>Tire Pressure Advisor &mdash; Internal Rule-Only Preview</h1>
    <p class="subhead">Rule-only internal test surface for checking tire pressure data against known target hot pressures. Nothing here is saved.</p>
    <p class="notice">This is decision-support only. Verify tire vendor guidance, track conditions, tire condition, warmer use, rider pace, and coach/mechanic input before making changes.</p>

    <section>
      <h2>Advisor Inputs</h2>
      <p>Enter the numbers you want the deterministic rules to check. Target hot pressure or a target range is required before the advisor suggests a pressure change.</p>

      <fieldset>
        <legend>Bike / Track</legend>
        <div class="grid">
          <label><span>Bike <span class="required">Required</span></span><input id="advisor-bike" value="Yamaha R3" placeholder="Example: Yamaha R3" /></label>
          <label><span>Track <span class="required">Required</span></span><input id="advisor-track" value="Road Atlanta" placeholder="Example: Road Atlanta" /></label>
          <label>Session label <input id="advisor-session-label" value="Session 3" placeholder="Example: Session 3" /></label>
        </div>
      </fieldset>

      <fieldset>
        <legend>Tire Identity</legend>
        <p class="field-note">More tire detail improves confidence. The advisor will not invent tire-vendor targets.</p>
        <div class="grid">
          <label>Tire brand <input id="advisor-tire-brand" value="Dunlop" placeholder="Example: Dunlop" /></label>
          <label>Tire model <input id="advisor-tire-model" value="Q5S" placeholder="Example: Q5S" /></label>
          <label>Tire compound <input id="advisor-tire-compound" value="track-day" placeholder="Example: medium, SC1, TD" /></label>
        </div>
      </fieldset>

      <fieldset>
        <legend>Pressures</legend>
        <p class="field-note">Cold and hot PSI help the rule check understand the session. Hot PSI is required for pressure-vs-target analysis.</p>
        <div class="grid">
          <label>Front cold PSI <input id="advisor-front-cold" inputmode="decimal" value="30" placeholder="Example: 30" /></label>
          <label>Rear cold PSI <input id="advisor-rear-cold" inputmode="decimal" value="27" placeholder="Example: 27" /></label>
          <label><span>Front hot PSI <span class="required">Required</span></span><input id="advisor-front-hot" inputmode="decimal" value="32" placeholder="Example: 32" /></label>
          <label><span>Rear hot PSI <span class="required">Required</span></span><input id="advisor-rear-hot" inputmode="decimal" value="29" placeholder="Example: 29" /></label>
        </div>
      </fieldset>

      <fieldset>
        <legend>Targets</legend>
        <p class="field-note">Use a single target or a min/max range. Without target hot pressure, the advisor returns needs_more_info.</p>
        <div class="grid">
          <label>Front target hot PSI <input id="advisor-front-target" inputmode="decimal" placeholder="Optional single target" /></label>
          <label>Rear target hot PSI <input id="advisor-rear-target" inputmode="decimal" placeholder="Optional single target" /></label>
          <label>Front target min <input id="advisor-front-target-min" inputmode="decimal" value="31" placeholder="Example: 31" /></label>
          <label>Front target max <input id="advisor-front-target-max" inputmode="decimal" value="33" placeholder="Example: 33" /></label>
          <label>Rear target min <input id="advisor-rear-target-min" inputmode="decimal" value="28" placeholder="Example: 28" /></label>
          <label>Rear target max <input id="advisor-rear-target-max" inputmode="decimal" value="29" placeholder="Example: 29" /></label>
        </div>
      </fieldset>

      <fieldset>
        <legend>Conditions</legend>
        <div class="grid">
          <label>Ambient temp F <input id="advisor-ambient-temp" inputmode="decimal" value="82" placeholder="Example: 82" /></label>
          <label>Track temp F <input id="advisor-track-temp" inputmode="decimal" value="104" placeholder="Example: 104" /></label>
          <label>Warmer use <input id="advisor-warmer-use" value="used" placeholder="used, not used, unknown" /></label>
          <label>Rider pace <input id="advisor-rider-pace" value="intermediate" placeholder="novice, intermediate, advanced, race" /></label>
        </div>
      </fieldset>

      <fieldset>
        <legend>Rider Notes</legend>
        <label>Handling symptom <input id="advisor-handling-symptom" value="planted" placeholder="Example: rear greasy on exit" /></label>
        <label>Rider note <textarea id="advisor-rider-note" placeholder="Short session note. No medical, payment, account, or unrelated personal information.">Bike felt predictable.</textarea></label>
      </fieldset>

      <div class="actions">
        <button id="advisor-button" type="button">Run Rule Check</button>
        <span id="advisor-status"></span>
      </div>
    </section>

    <section id="advisor-result" class="hidden">
      <h2>Advisor Result</h2>
      <div class="status-row">
        <span>Status <span id="advisor-recommendation-status" class="status-pill"></span></span>
        <span>Confidence <span id="advisor-confidence" class="status-pill"></span></span>
      </div>
      <div id="advisor-error-panel" class="result-panel error-panel hidden">
        <h2>Request Error</h2>
        <p id="advisor-error-message" class="error"></p>
      </div>
      <div class="result-grid">
        <div class="result-panel">
          <h2>Suggested Adjustments</h2>
          <ul id="advisor-adjustments" class="result-list"></ul>
        </div>
        <div class="result-panel">
          <h2>Missing Fields</h2>
          <ul id="advisor-missing-fields" class="result-list"></ul>
        </div>
        <div class="result-panel">
          <h2>Warnings</h2>
          <ul id="advisor-warnings" class="result-list warning-list"></ul>
        </div>
        <div class="result-panel">
          <h2>Raw Rule Output</h2>
          <pre id="advisor-json">{}</pre>
        </div>
      </div>
    </section>
  </main>
  <script src="/track-agent/tire-pressure-advisor/ui.js" defer></script>
</body>
</html>`;
}

export function renderTirePressureAdvisorClientScript() {
  return `"use strict";

const $ = (id) => document.getElementById(id);

function setText(id, value, className) {
  const el = $(id);
  el.textContent = value || "";
  el.className = className || "";
}

function fieldValue(id) {
  const value = $(id).value.trim();
  return value === "" ? null : value;
}

function fieldNumber(id) {
  const value = fieldValue(id);
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : value;
}

function applyOptional(payload, field, value) {
  if (value != null) payload[field] = value;
}

function targetRange(minId, maxId) {
  const min = fieldNumber(minId);
  const max = fieldNumber(maxId);
  if (min == null && max == null) return null;
  return { min, max };
}

function formatFieldName(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\\b\\w/g, (letter) => letter.toUpperCase());
}

function statusClass(status) {
  if (status === "ready") return "status-pill status-ready";
  if (status === "needs_more_info") return "status-pill status-needs-more-info";
  if (status === "not_supported") return "status-pill status-not-supported";
  return "status-pill";
}

function buildAdvisorPayload() {
  const payload = {};
  [
    ["bike", "advisor-bike"],
    ["track", "advisor-track"],
    ["session_label", "advisor-session-label"],
    ["tire_brand", "advisor-tire-brand"],
    ["tire_model", "advisor-tire-model"],
    ["tire_compound", "advisor-tire-compound"],
    ["warmer_use", "advisor-warmer-use"],
    ["rider_pace", "advisor-rider-pace"],
    ["handling_symptom", "advisor-handling-symptom"],
    ["rider_note", "advisor-rider-note"],
  ].forEach(([field, id]) => applyOptional(payload, field, fieldValue(id)));

  [
    ["front_cold_psi", "advisor-front-cold"],
    ["rear_cold_psi", "advisor-rear-cold"],
    ["front_hot_psi", "advisor-front-hot"],
    ["rear_hot_psi", "advisor-rear-hot"],
    ["front_target_hot_psi", "advisor-front-target"],
    ["rear_target_hot_psi", "advisor-rear-target"],
    ["ambient_temp_f", "advisor-ambient-temp"],
    ["track_temp_f", "advisor-track-temp"],
  ].forEach(([field, id]) => applyOptional(payload, field, fieldNumber(id)));

  const frontRange = targetRange("advisor-front-target-min", "advisor-front-target-max");
  const rearRange = targetRange("advisor-rear-target-min", "advisor-rear-target-max");
  if (frontRange) payload.front_target_hot_range = frontRange;
  if (rearRange) payload.rear_target_hot_range = rearRange;

  return payload;
}

function renderList(id, items, emptyText, renderItem) {
  const list = $(id);
  list.textContent = "";
  const values = Array.isArray(items) && items.length ? items : [emptyText];
  values.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = renderItem ? renderItem(item) : String(item);
    list.appendChild(li);
  });
}

function renderErrorResult(status, data) {
  $("advisor-result").classList.remove("hidden");
  $("advisor-error-panel").classList.remove("hidden");
  $("advisor-error-message").textContent = "HTTP " + status + ": " + (data.message || data.error || "Advisor request failed");
  $("advisor-recommendation-status").textContent = "error";
  $("advisor-recommendation-status").className = "status-pill status-not-supported";
  $("advisor-confidence").textContent = "";
  $("advisor-confidence").className = "status-pill";
  renderList("advisor-adjustments", [], "No suggested adjustments.");
  renderList("advisor-missing-fields", data.details || [], "No parsed validation details.", (item) => {
    if (typeof item === "string") return item;
    return (item.path ? formatFieldName(item.path) + ": " : "") + (item.message || JSON.stringify(item));
  });
  renderList("advisor-warnings", [], "Fix the fields above and run the rule check again.");
  $("advisor-json").textContent = JSON.stringify(data, null, 2);
}

function renderAdvisorResult(data) {
  $("advisor-result").classList.remove("hidden");
  $("advisor-error-panel").classList.add("hidden");
  $("advisor-recommendation-status").textContent = data.recommendation_status || "";
  $("advisor-recommendation-status").className = statusClass(data.recommendation_status);
  $("advisor-confidence").textContent = data.confidence || "";
  $("advisor-confidence").className = "status-pill";
  renderList("advisor-adjustments", data.suggested_adjustments, "No suggested adjustments.", (item) => {
    if (typeof item === "string") return item;
    const amount = item.amount_psi == null ? "no PSI change" : item.amount_psi + " psi";
    return formatFieldName(item.tire) + " tire: " + item.direction + " (" + amount + ") - " + item.reason + " Confidence: " + item.confidence + ".";
  });
  renderList("advisor-missing-fields", data.missing_fields, "No missing fields.", formatFieldName);
  renderList("advisor-warnings", data.warnings, "No warnings.");
  $("advisor-json").textContent = JSON.stringify(data, null, 2);
}

async function runAdvisor() {
  setText("advisor-status", "Running deterministic rules...");
  const response = await fetch("/track-agent/tire-pressure-advisor", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildAdvisorPayload()),
  });
  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    data = { error: "unparseable_response", message: "Advisor response could not be parsed." };
  }
  if (!response.ok) {
    renderErrorResult(response.status, data);
    throw new Error(data.message || data.error || "Advisor request failed");
  }
  renderAdvisorResult(data);
  setText("advisor-status", "Rule-only advisor response received.", "good");
}

document.addEventListener("DOMContentLoaded", () => {
  $("advisor-button").addEventListener("click", () => runAdvisor().catch((err) => setText("advisor-status", err.message, "error")));
});
`;
}
