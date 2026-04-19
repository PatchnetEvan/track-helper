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
    t.addEventListener("click", () => showTab(t.dataset.tab));
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
  function tireSuggestions(label, cold, hot, target) {
    const tips = [];
    if (cold != null && hot != null) {
      const delta = hot - cold;
      tips.push(`${label} delta: ${delta.toFixed(1)} PSI (cold ${cold} → hot ${hot}).`);
      if (delta < 2) {
        tips.push(`${label}: very small rise. Tire may not be reaching working temp — consider lowering cold PSI slightly or more warm-up.`);
      } else if (delta > 6) {
        tips.push(`${label}: large rise. Tire may be overworked or cold PSI too low — consider raising cold PSI.`);
      }
    }
    if (hot != null && target != null) {
      const gap = hot - target;
      if (Math.abs(gap) >= 0.5) {
        if (gap > 0) {
          tips.push(`${label} hot is ${gap.toFixed(1)} PSI above target — consider lowering cold PSI by ~${gap.toFixed(1)}.`);
        } else {
          tips.push(`${label} hot is ${Math.abs(gap).toFixed(1)} PSI below target — consider raising cold PSI by ~${Math.abs(gap).toFixed(1)}.`);
        }
      } else {
        tips.push(`${label}: hot PSI is on target.`);
      }
    }
    return tips;
  }

  document.getElementById("calc-tires").addEventListener("click", () => {
    const fc = num("front-cold"), rc = num("rear-cold");
    const fh = num("front-hot"), rh = num("rear-hot");
    const ft = num("front-target"), rt = num("rear-target");

    const out = [];
    out.push(...tireSuggestions("Front", fc, fh, ft));
    out.push(...tireSuggestions("Rear", rc, rh, rt));

    const el = document.getElementById("tire-result");
    if (out.length === 0) {
      el.innerHTML = `<p>Enter cold and hot PSI to see deltas and suggestions.</p>`;
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
      "Front cold": str("front-cold"),
      "Rear cold": str("rear-cold"),
      "Front hot": str("front-hot"),
      "Rear hot": str("rear-hot"),
      "Front target hot": str("front-target"),
      "Rear target hot": str("rear-target"),
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
    const ok = window.confirm("Clear every field on every tab? Nothing was saved anywhere — this just blanks the form.");
    if (!ok) return;
    document.querySelectorAll('input[type="text"], textarea').forEach((el) => { el.value = ""; });
    document.querySelectorAll('input[type="checkbox"]').forEach((el) => { el.checked = false; });
    ["tire-result", "suspension-result", "laps-result", "summary-result"].forEach((id) => {
      document.getElementById(id).innerHTML = "";
    });
    showTab("setup");
  });
})();
