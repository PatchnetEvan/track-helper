(function () {
  "use strict";

  // --- Tabs -----------------------------------------------------------------
  const tabs = document.querySelectorAll(".tab");
  const panels = {
    setup: document.getElementById("panel-setup"),
    tires: document.getElementById("panel-tires"),
    suspension: document.getElementById("panel-suspension"),
    laps: document.getElementById("panel-laps"),
    review: document.getElementById("panel-review"),
    history: document.getElementById("panel-history"),
    about: document.getElementById("panel-about"),
  };

  function showTab(name) {
    tabs.forEach((t) => {
      const active = t.dataset.tab === name;
      t.setAttribute("aria-selected", active ? "true" : "false");
    });
    Object.keys(panels).forEach((k) => {
      panels[k].hidden = k !== name;
    });
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  }

  tabs.forEach((t) => {
    t.addEventListener("click", () => {
      showTab(t.dataset.tab);
      if (t.dataset.tab === "history") renderHistory();
    });
  });

  // --- Helpers --------------------------------------------------------------
  function num(id) {
    const raw = (document.getElementById(id).value || "").trim();
    if (raw === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  function str(id) {
    return (document.getElementById(id).value || "").trim();
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function row(label, value) {
    return `<div class="row"><span>${escapeHtml(label)}</span><span>${escapeHtml(value)}</span></div>`;
  }

  // --- Tires ----------------------------------------------------------------
  function tireSuggestions(label, pre, post, warmerOn) {
    if (pre == null || post == null) return [];
    const delta = post - pre;
    const sign = delta >= 0 ? "+" : "−";
    const tips = [`${label}: ${sign}${Math.abs(delta).toFixed(1)} PSI delta (pre ${pre} → post ${post}).`];

    if (warmerOn) {
      if (delta < -1) {
        tips.push(`${label}: pressure dropped during the session. Check for a slow leak, or take the post reading sooner next time.`);
      } else if (delta > 3) {
        tips.push(`${label}: large rise despite warmers. Warmer may have been under-temp or the tire was overworked — consider raising pre-session PSI.`);
      }
    } else {
      if (delta < 2) {
        tips.push(`${label}: small rise without warmers. Tire may not be reaching working temp — consider lowering pre-session PSI slightly or adding warm-up laps.`);
      } else if (delta > 6) {
        tips.push(`${label}: large rise. Pre-session may be too low — consider raising it.`);
      }
    }
    return tips;
  }

  document.getElementById("calc-tires").addEventListener("click", () => {
    const fpre = num("front-pre"), rpre = num("rear-pre");
    const fpost = num("front-post"), rpost = num("rear-post");
    const warmerOn = document.getElementById("warmer-on").checked;

    const out = [];
    out.push(...tireSuggestions("Front", fpre, fpost, warmerOn));
    out.push(...tireSuggestions("Rear", rpre, rpost, warmerOn));

    const el = document.getElementById("tire-result");
    if (out.length === 0) {
      el.innerHTML = `<p>Enter pre-session and post-session PSI to see deltas and suggestions.</p>`;
      return;
    }
    el.innerHTML = `<h3>Tire feedback</h3><ul>${out.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>
      <p class="hint">Guidance is conservative and educational only. Always defer to your tire manufacturer and track conditions.</p>`;
  });

  // --- Suspension -----------------------------------------------------------
  const SYMPTOM_ADVICE = {
    "midcorner-push":
      "Mid-corner push: try softer front compression, slightly less front preload, or raise rear ride height a touch.",
    "harsh-bumps":
      "Harsh on bumps: reduce compression damping on the end where it's felt most; check preload isn't excessive.",
    "rear-spin":
      "Rear spin on exit: try slightly more rear rebound or lower rear hot PSI; confirm tire temp is in range.",
    "chatter":
      "Chatter: small damping changes on the affected end (1–2 clicks at a time); re-check tire pressure and tire age.",
    "brake-dive":
      "Brake dive: add a little front compression damping or fork preload; keep changes small.",
    "wallow":
      "Wallow: increase rebound damping on the affected end; verify static sag before making big changes.",
  };

  document.getElementById("calc-suspension").addEventListener("click", () => {
    const checked = Array.from(document.querySelectorAll("#symptoms input:checked")).map((i) => i.value);
    const el = document.getElementById("suspension-result");
    if (checked.length === 0) {
      el.innerHTML = `<p>Select one or more symptoms to see conservative starting points.</p>`;
      return;
    }
    const items = checked.map((v) => `<li>${escapeHtml(SYMPTOM_ADVICE[v] || v)}</li>`).join("");
    el.innerHTML = `<h3>Suggested adjustments</h3><ul>${items}</ul>
      <p class="hint">Change one thing at a time. Educational only — track conditions and your own feel take priority.</p>`;
  });

  // --- Laps -----------------------------------------------------------------
  function parseLap(line) {
    const s = line.trim();
    if (!s) return null;
    // mm:ss.sss or m:ss(.s*)
    const m = s.match(/^(\d+):(\d{1,2}(?:\.\d+)?)$/);
    if (m) {
      const mins = parseInt(m[1], 10);
      const secs = parseFloat(m[2]);
      if (!Number.isFinite(mins) || !Number.isFinite(secs)) return null;
      return mins * 60 + secs;
    }
    // plain seconds (with optional decimal)
    const n = Number(s);
    if (Number.isFinite(n) && n > 0) return n;
    return null;
  }

  function fmtLap(totalSeconds) {
    if (!Number.isFinite(totalSeconds)) return "—";
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds - m * 60;
    return `${m}:${s.toFixed(3).padStart(6, "0")}`;
  }

  function fmtDelta(d) {
    if (d === 0) return "—";
    const sign = d > 0 ? "+" : "−";
    return `${sign}${Math.abs(d).toFixed(3)}`;
  }

  function analyzeLaps() {
    const raw = document.getElementById("laps-input").value.split(/\r?\n/);
    const laps = [];
    const bad = [];
    raw.forEach((line, i) => {
      if (!line.trim()) return;
      const v = parseLap(line);
      if (v == null) bad.push({ i: i + 1, line });
      else laps.push(v);
    });
    return { laps, bad };
  }

  document.getElementById("calc-laps").addEventListener("click", () => {
    const { laps, bad } = analyzeLaps();
    const el = document.getElementById("laps-result");
    if (laps.length === 0) {
      el.innerHTML = `<p>Paste one lap per line — for example <code>1:42.318</code> or <code>102.4</code>.</p>` +
        (bad.length ? `<p class="warn">Skipped ${bad.length} unparseable line(s).</p>` : "");
      return;
    }
    const best = Math.min(...laps);
    const avg = laps.reduce((a, b) => a + b, 0) / laps.length;
    const bestIdx = laps.indexOf(best);

    const rowsHtml = laps.map((l, i) => {
      const delta = l - best;
      return `<tr${i === bestIdx ? ' class="best"' : ""}><td>${i + 1}</td><td>${escapeHtml(fmtLap(l))}</td><td>${escapeHtml(fmtDelta(delta))}</td></tr>`;
    }).join("");

    el.innerHTML = `
      <h3>Summary</h3>
      ${row("Laps counted", String(laps.length))}
      ${row("Best", fmtLap(best))}
      ${row("Average", fmtLap(avg))}
      ${bad.length ? `<p class="warn">Skipped ${bad.length} unparseable line(s).</p>` : ""}
      <table class="lap-table" aria-label="Lap times">
        <thead><tr><th>Lap</th><th>Time</th><th>Δ best</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    `;
  });

  // --- Review / Summary -----------------------------------------------------
  function collectSummary() {
    const parts = [];

    const setup = {
      Bike: str("bike"),
      Track: str("track"),
      Session: str("session-label"),
      "Ambient temp": str("amb-temp"),
      "Track temp": str("track-temp"),
      Humidity: str("humidity"),
      Notes: str("general-notes"),
    };
    const setupRows = Object.entries(setup).filter(([, v]) => v).map(([k, v]) => row(k, v)).join("");
    if (setupRows) parts.push(`<h3>Setup</h3>${setupRows}`);

    const tires = {
      "Tire brand": str("tire-brand"),
      "Model / compound": str("tire-model"),
      "Front pre-session": str("front-pre"),
      "Rear pre-session": str("rear-pre"),
      "Front post-session": str("front-post"),
      "Rear post-session": str("rear-post"),
      "Warmers": document.getElementById("warmer-on").checked ? "yes" : "",
      "Warmer time (min)": str("warmer-time"),
    };
    const tireRows = Object.entries(tires).filter(([, v]) => v).map(([k, v]) => row(k, v)).join("");
    if (tireRows) parts.push(`<h3>Tires</h3>${tireRows}`);

    const susp = {
      "Fork preload": str("fork-preload"),
      "Fork compression": str("fork-comp"),
      "Fork rebound": str("fork-reb"),
      "Shock preload": str("shock-preload"),
      "Shock compression": str("shock-comp"),
      "Shock rebound": str("shock-reb"),
    };
    const suspRows = Object.entries(susp).filter(([, v]) => v).map(([k, v]) => row(k, v)).join("");
    const symptoms = Array.from(document.querySelectorAll("#symptoms input:checked"))
      .map((i) => i.parentElement.querySelector("span").textContent);
    let suspBlock = suspRows;
    if (symptoms.length) suspBlock += row("Symptoms", symptoms.join(", "));
    if (suspBlock) parts.push(`<h3>Suspension</h3>${suspBlock}`);

    const { laps } = analyzeLaps();
    if (laps.length) {
      const best = Math.min(...laps);
      const avg = laps.reduce((a, b) => a + b, 0) / laps.length;
      parts.push(`<h3>Laps</h3>${row("Laps", String(laps.length))}${row("Best", fmtLap(best))}${row("Average", fmtLap(avg))}`);
    }

    return parts.join("");
  }

  document.getElementById("build-summary").addEventListener("click", () => {
    const el = document.getElementById("summary-result");
    const body = collectSummary();
    if (!body) {
      el.innerHTML = `<p>Nothing filled in yet. Add some details and try again.</p>`;
      return;
    }
    el.innerHTML = body + `<p class="hint">This summary is only in your browser tab. Refresh or reset to clear it.</p>`;
  });

  // --- Reset ----------------------------------------------------------------
  document.getElementById("reset-all").addEventListener("click", () => {
    const ok = window.confirm("Clear every field on every tab? This only blanks the current form — saved history in the History tab is untouched.");
    if (!ok) return;
    clearForm();
    showTab("setup");
  });

  function clearForm() {
    document.querySelectorAll('input[type="text"], textarea').forEach((el) => { el.value = ""; });
    document.querySelectorAll('input[type="checkbox"]').forEach((el) => { el.checked = false; });
    ["tire-result", "suspension-result", "laps-result", "summary-result", "save-result"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = "";
    });
  }

  // --- Session shape & form <-> object helpers ------------------------------
  const SYMPTOM_LABELS = {
    "midcorner-push": "Mid-corner push",
    "harsh-bumps": "Harsh on bumps",
    "rear-spin": "Rear spin on exit",
    "chatter": "Chatter",
    "brake-dive": "Brake dive",
    "wallow": "Wallow",
  };

  function collectSession() {
    return {
      id: window.Store ? Store.newId() : String(Date.now()),
      savedAt: new Date().toISOString(),
      setup: {
        bike: str("bike"),
        track: str("track"),
        sessionLabel: str("session-label"),
        ambTemp: str("amb-temp"),
        trackTemp: str("track-temp"),
        humidity: str("humidity"),
        notes: str("general-notes"),
      },
      tires: {
        brand: str("tire-brand"),
        model: str("tire-model"),
        frontPre: str("front-pre"),
        rearPre: str("rear-pre"),
        frontPost: str("front-post"),
        rearPost: str("rear-post"),
        warmerOn: document.getElementById("warmer-on").checked,
        warmerTime: str("warmer-time"),
      },
      suspension: {
        forkPreload: str("fork-preload"),
        forkComp: str("fork-comp"),
        forkReb: str("fork-reb"),
        shockPreload: str("shock-preload"),
        shockComp: str("shock-comp"),
        shockReb: str("shock-reb"),
        symptoms: Array.from(document.querySelectorAll("#symptoms input:checked")).map((i) => i.value),
      },
      laps: {
        raw: document.getElementById("laps-input").value,
        times: analyzeLaps().laps,
      },
    };
  }

  function restoreSession(s) {
    if (!s) return;
    const setId = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ""; };
    const setCheck = (id, v) => { const el = document.getElementById(id); if (el) el.checked = !!v; };

    setId("bike", s.setup && s.setup.bike);
    setId("track", s.setup && s.setup.track);
    setId("session-label", s.setup && s.setup.sessionLabel);
    setId("amb-temp", s.setup && s.setup.ambTemp);
    setId("track-temp", s.setup && s.setup.trackTemp);
    setId("humidity", s.setup && s.setup.humidity);
    setId("general-notes", s.setup && s.setup.notes);

    const t = s.tires || {};
    setId("tire-brand", t.brand);
    setId("tire-model", t.model);
    setId("front-pre", t.frontPre != null && t.frontPre !== "" ? t.frontPre : t.frontCold);
    setId("rear-pre", t.rearPre != null && t.rearPre !== "" ? t.rearPre : t.rearCold);
    setId("front-post", t.frontPost != null && t.frontPost !== "" ? t.frontPost : t.frontHot);
    setId("rear-post", t.rearPost != null && t.rearPost !== "" ? t.rearPost : t.rearHot);
    setCheck("warmer-on", t.warmerOn);
    setId("warmer-time", t.warmerTime);

    setId("fork-preload", s.suspension && s.suspension.forkPreload);
    setId("fork-comp", s.suspension && s.suspension.forkComp);
    setId("fork-reb", s.suspension && s.suspension.forkReb);
    setId("shock-preload", s.suspension && s.suspension.shockPreload);
    setId("shock-comp", s.suspension && s.suspension.shockComp);
    setId("shock-reb", s.suspension && s.suspension.shockReb);

    const symptoms = (s.suspension && s.suspension.symptoms) || [];
    document.querySelectorAll("#symptoms input[type=checkbox]").forEach((cb) => {
      cb.checked = symptoms.indexOf(cb.value) !== -1;
    });

    setId("laps-input", s.laps && s.laps.raw);

    ["tire-result", "suspension-result", "laps-result", "summary-result", "save-result"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = "";
    });
  }

  function sessionTitle(s) {
    const track = (s.setup && s.setup.track) || "Untracked";
    const bike = (s.setup && s.setup.bike) || "";
    const label = (s.setup && s.setup.sessionLabel) || "";
    const tail = [bike, label].filter(Boolean).join(" · ");
    return tail ? `${track} — ${tail}` : track;
  }

  function sessionBest(s) {
    const times = (s.laps && Array.isArray(s.laps.times)) ? s.laps.times : [];
    return times.length ? Math.min(...times) : null;
  }

  function sessionDateLabel(iso) {
    try {
      const d = new Date(iso);
      return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    } catch (e) {
      return iso || "";
    }
  }

  // --- Save / History UI ----------------------------------------------------
  function storageReady() {
    return !!(window.Store && Store.available());
  }

  function showStorageWarning() {
    const el = document.getElementById("storage-warning");
    if (!el) return;
    el.hidden = storageReady();
  }

  document.getElementById("save-session").addEventListener("click", () => {
    const out = document.getElementById("save-result");
    if (!storageReady()) {
      out.innerHTML = `<p class="warn">Browser storage is unavailable, so nothing was saved.</p>`;
      return;
    }
    const s = collectSession();
    const hasAny = Object.values(s.setup).some(Boolean)
      || Object.values(s.tires).some((v) => v !== "" && v !== false)
      || Object.values(s.suspension).some((v) => (Array.isArray(v) ? v.length : Boolean(v)))
      || (s.laps.times && s.laps.times.length);
    if (!hasAny) {
      out.innerHTML = `<p>Nothing to save yet — fill in some details first.</p>`;
      return;
    }
    try {
      Store.add(s);
      out.innerHTML = `<p class="good">Saved locally. Open the History tab any time.</p>`;
    } catch (e) {
      out.innerHTML = `<p class="warn">Could not save: ${escapeHtml(e.message || String(e))}</p>`;
    }
  });

  function renderHistory() {
    showStorageWarning();
    const listEl = document.getElementById("history-list");
    const emptyEl = document.getElementById("history-empty");
    const trendsEl = document.getElementById("history-trends");
    const selA = document.getElementById("compare-a");
    const selB = document.getElementById("compare-b");

    const sessions = storageReady() ? Store.readAll() : [];
    sessions.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));

    if (!sessions.length) {
      listEl.innerHTML = "";
      trendsEl.innerHTML = "";
      selA.innerHTML = "";
      selB.innerHTML = "";
      emptyEl.hidden = false;
      return;
    }
    emptyEl.hidden = true;

    // Session list
    listEl.innerHTML = sessions.map((s) => {
      const best = sessionBest(s);
      const meta = [
        sessionDateLabel(s.savedAt),
        best != null ? `best ${fmtLap(best)}` : null,
        s.laps && s.laps.times ? `${s.laps.times.length} laps` : null,
      ].filter(Boolean).join(" · ");
      return `
        <div class="session-card" data-id="${escapeHtml(s.id)}">
          <h4>${escapeHtml(sessionTitle(s))}</h4>
          <div class="meta">${escapeHtml(meta)}</div>
          <div class="actions">
            <button type="button" class="btn-secondary" data-action="load" data-id="${escapeHtml(s.id)}">Load</button>
            <button type="button" class="btn-secondary" data-action="view" data-id="${escapeHtml(s.id)}">View</button>
            <button type="button" class="btn-danger" data-action="delete" data-id="${escapeHtml(s.id)}">Delete</button>
          </div>
          <div class="result" id="view-${escapeHtml(s.id)}" hidden></div>
        </div>
      `;
    }).join("");

    // Compare selects
    const options = sessions.map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(sessionDateLabel(s.savedAt))} — ${escapeHtml(sessionTitle(s))}</option>`).join("");
    selA.innerHTML = options;
    selB.innerHTML = options;
    if (sessions.length > 1) selB.selectedIndex = 1;

    // Trends per track
    const groups = {};
    sessions.forEach((s) => {
      const key = (s.setup && s.setup.track || "Untracked").trim();
      const k = key.toLowerCase();
      if (!groups[k]) groups[k] = { label: key, items: [] };
      const best = sessionBest(s);
      if (best != null) groups[k].items.push({ s, best });
    });
    const trendHtml = Object.values(groups)
      .filter((g) => g.items.length >= 2)
      .map((g) => {
        g.items.sort((a, b) => String(a.s.savedAt).localeCompare(String(b.s.savedAt)));
        const pr = Math.min(...g.items.map((x) => x.best));
        const rows = g.items.map(({ s, best }) => {
          const isPr = best === pr;
          return `<div class="trend-row${isPr ? " pr" : ""}"><span>${escapeHtml(sessionDateLabel(s.savedAt))}</span><span>${escapeHtml(fmtLap(best))}</span><span>${isPr ? "PR" : "+" + (best - pr).toFixed(3)}</span></div>`;
        }).join("");
        return `<div class="trend-block"><h4>${escapeHtml(g.label)}</h4>${rows}</div>`;
      }).join("");
    trendsEl.innerHTML = trendHtml ? `<h3>Per-track trend</h3>${trendHtml}` : "";
  }

  // Delegated actions on session cards
  document.getElementById("history-list").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const id = btn.dataset.id;
    const action = btn.dataset.action;
    const all = Store.readAll();
    const s = all.find((x) => x.id === id);
    if (!s) return;

    if (action === "load") {
      const ok = window.confirm("Load this session into the form? Anything you've typed will be overwritten.");
      if (!ok) return;
      restoreSession(s);
      showTab("setup");
    } else if (action === "delete") {
      const ok = window.confirm("Delete this saved session? This cannot be undone.");
      if (!ok) return;
      Store.remove(id);
      renderHistory();
    } else if (action === "view") {
      const el = document.getElementById("view-" + id);
      if (!el) return;
      if (!el.hidden) { el.hidden = true; el.innerHTML = ""; return; }
      el.innerHTML = sessionDetailHtml(s);
      el.hidden = false;
    }
  });

  function sessionDetailHtml(s) {
    const rows = [];
    const pushIf = (label, value) => { if (value !== "" && value != null && value !== false) rows.push(row(label, String(value))); };
    pushIf("Bike", s.setup && s.setup.bike);
    pushIf("Track", s.setup && s.setup.track);
    pushIf("Session", s.setup && s.setup.sessionLabel);
    pushIf("Ambient temp", s.setup && s.setup.ambTemp);
    pushIf("Track temp", s.setup && s.setup.trackTemp);
    pushIf("Humidity", s.setup && s.setup.humidity);
    pushIf("Notes", s.setup && s.setup.notes);
    const t = s.tires || {};
    pushIf("Tire brand", t.brand);
    pushIf("Model / compound", t.model);
    pushIf("Front pre-session", t.frontPre || t.frontCold);
    pushIf("Rear pre-session", t.rearPre || t.rearCold);
    pushIf("Front post-session", t.frontPost || t.frontHot);
    pushIf("Rear post-session", t.rearPost || t.rearHot);
    pushIf("Warmers", t.warmerOn ? "yes" : "");
    pushIf("Warmer time (min)", t.warmerTime);
    pushIf("Fork preload", s.suspension && s.suspension.forkPreload);
    pushIf("Fork comp", s.suspension && s.suspension.forkComp);
    pushIf("Fork rebound", s.suspension && s.suspension.forkReb);
    pushIf("Shock preload", s.suspension && s.suspension.shockPreload);
    pushIf("Shock comp", s.suspension && s.suspension.shockComp);
    pushIf("Shock rebound", s.suspension && s.suspension.shockReb);
    const symNames = (s.suspension && s.suspension.symptoms || []).map((k) => SYMPTOM_LABELS[k] || k);
    if (symNames.length) pushIf("Symptoms", symNames.join(", "));
    const times = s.laps && s.laps.times || [];
    if (times.length) {
      pushIf("Laps", String(times.length));
      pushIf("Best", fmtLap(Math.min(...times)));
      pushIf("Average", fmtLap(times.reduce((a, b) => a + b, 0) / times.length));
    }
    return rows.join("") || "<p>Nothing recorded for this session.</p>";
  }

  // --- Compare --------------------------------------------------------------
  document.getElementById("run-compare").addEventListener("click", () => {
    const out = document.getElementById("compare-result");
    if (!storageReady()) { out.innerHTML = `<p class="warn">Storage unavailable.</p>`; return; }
    const all = Store.readAll();
    const aId = document.getElementById("compare-a").value;
    const bId = document.getElementById("compare-b").value;
    const a = all.find((x) => x.id === aId);
    const b = all.find((x) => x.id === bId);
    if (!a || !b) { out.innerHTML = `<p>Pick two saved sessions.</p>`; return; }
    if (a.id === b.id) { out.innerHTML = `<p>Those are the same session — pick two different ones.</p>`; return; }

    const fields = [
      ["Bike", (s) => s.setup && s.setup.bike],
      ["Track", (s) => s.setup && s.setup.track],
      ["Session", (s) => s.setup && s.setup.sessionLabel],
      ["Ambient temp", (s) => s.setup && s.setup.ambTemp],
      ["Track temp", (s) => s.setup && s.setup.trackTemp],
      ["Humidity", (s) => s.setup && s.setup.humidity],
      ["Tire brand", (s) => (s.tires && s.tires.brand) || ""],
      ["Model / compound", (s) => (s.tires && s.tires.model) || ""],
      ["Front pre-session", (s) => (s.tires && (s.tires.frontPre || s.tires.frontCold)) || ""],
      ["Rear pre-session", (s) => (s.tires && (s.tires.rearPre || s.tires.rearCold)) || ""],
      ["Front post-session", (s) => (s.tires && (s.tires.frontPost || s.tires.frontHot)) || ""],
      ["Rear post-session", (s) => (s.tires && (s.tires.rearPost || s.tires.rearHot)) || ""],
      ["Warmers", (s) => s.tires && s.tires.warmerOn ? "yes" : ""],
      ["Fork preload", (s) => s.suspension && s.suspension.forkPreload],
      ["Fork comp", (s) => s.suspension && s.suspension.forkComp],
      ["Fork rebound", (s) => s.suspension && s.suspension.forkReb],
      ["Shock preload", (s) => s.suspension && s.suspension.shockPreload],
      ["Shock comp", (s) => s.suspension && s.suspension.shockComp],
      ["Shock rebound", (s) => s.suspension && s.suspension.shockReb],
      ["Symptoms", (s) => ((s.suspension && s.suspension.symptoms) || []).map((k) => SYMPTOM_LABELS[k] || k).join(", ")],
      ["Best lap", (s) => { const b = sessionBest(s); return b == null ? "" : fmtLap(b); }],
      ["Avg lap", (s) => { const t = s.laps && s.laps.times || []; return t.length ? fmtLap(t.reduce((x, y) => x + y, 0) / t.length) : ""; }],
      ["Laps", (s) => { const t = s.laps && s.laps.times || []; return t.length ? String(t.length) : ""; }],
    ];

    const rowsHtml = fields.map(([label, get]) => {
      const va = get(a) || "";
      const vb = get(b) || "";
      if (!va && !vb) return "";
      const diff = String(va) !== String(vb);
      return `<tr${diff ? ' class="diff"' : ""}><td>${escapeHtml(label)}</td><td class="val">${escapeHtml(va)}</td><td class="val">${escapeHtml(vb)}</td></tr>`;
    }).join("");

    out.innerHTML = `
      <h3>${escapeHtml(sessionTitle(a))} vs ${escapeHtml(sessionTitle(b))}</h3>
      <p class="hint">Highlighted rows differ between the two sessions.</p>
      <table class="compare-table">
        <thead><tr><th>Field</th><th>A — ${escapeHtml(sessionDateLabel(a.savedAt))}</th><th>B — ${escapeHtml(sessionDateLabel(b.savedAt))}</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    `;
  });

  // --- Export / Import / Clear ---------------------------------------------
  document.getElementById("export-history").addEventListener("click", () => {
    if (!storageReady()) { window.alert("Storage unavailable in this browser."); return; }
    const payload = Store.exportPayload();
    if (!payload.sessions.length) { window.alert("No saved sessions to export yet."); return; }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `mototrack-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  document.getElementById("import-history").addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!storageReady()) { window.alert("Storage unavailable in this browser."); e.target.value = ""; return; }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        const res = Store.importPayload(data);
        if (!res.ok) { window.alert("Import failed: " + res.reason); return; }
        window.alert(`Imported ${res.added} session(s). Skipped ${res.skipped} (duplicates or invalid).`);
        renderHistory();
      } catch (err) {
        window.alert("Could not read that file: " + (err.message || String(err)));
      } finally {
        e.target.value = "";
      }
    };
    reader.onerror = () => { window.alert("Could not read that file."); e.target.value = ""; };
    reader.readAsText(file);
  });

  document.getElementById("clear-history").addEventListener("click", () => {
    if (!storageReady()) return;
    const count = Store.readAll().length;
    if (!count) { window.alert("There is nothing saved to clear."); return; }
    const ok = window.confirm(`Delete all ${count} saved session(s) from this device? This cannot be undone. Consider exporting a backup first.`);
    if (!ok) return;
    Store.clear();
    renderHistory();
  });

  // Initial state
  showStorageWarning();
})();
