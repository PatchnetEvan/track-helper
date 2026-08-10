(function () {
  "use strict";

  // --- Tabs -----------------------------------------------------------------
  const tabs = document.querySelectorAll(".tab");
  const panels = {
    setup: document.getElementById("panel-setup"),
    tires: document.getElementById("panel-tires"),
    calculators: document.getElementById("panel-calculators"),
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

  function numericRow(label, value) {
    return `<div class="row"><span>${escapeHtml(label)}</span><span class="numeric">${escapeHtml(value)}</span></div>`;
  }

  function signedMm(value, digits) {
    if (!Number.isFinite(value)) return "";
    const precision = digits == null ? 1 : digits;
    const sign = value > 0 ? "+" : value < 0 ? "-" : "";
    return `${sign}${Math.abs(value).toFixed(precision)} mm`;
  }

  function signedDeg(value) {
    if (!Number.isFinite(value)) return "";
    const sign = value > 0 ? "+" : value < 0 ? "-" : "";
    return `${sign}${Math.abs(value).toFixed(2)} deg`;
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

  // --- Calculator foundation: tire + units core ----------------------------
  const tireCore = window.MotoTrackTireCore;
  const tireMethodEl = document.getElementById("tire-core-method");
  const tireMeasuredFields = document.getElementById("tire-core-measured-fields");
  const tireLookupFields = document.getElementById("tire-core-lookup-fields");
  const tireLookupEl = document.getElementById("tire-core-lookup");

  function formatMm(value, digits) {
    if (!Number.isFinite(value)) return "";
    return `${tireCore.round(value, digits == null ? 1 : digits).toFixed(digits == null ? 1 : digits)} mm`;
  }

  function formatPct(value) {
    if (!Number.isFinite(value)) return "";
    const sign = value > 0 ? "+" : "";
    return `${sign}${value.toFixed(1)}%`;
  }

  function syncTireCoreFields() {
    const method = tireMethodEl.value;
    tireMeasuredFields.hidden = method !== "measured";
    tireLookupFields.hidden = method !== "lookup";
  }

  function renderLookupOptions() {
    tireLookupEl.innerHTML = tireCore.LOOKUP_TIRES.map((tire) => {
      const label = `${tire.manufacturer} ${tire.model} - ${tire.size}`;
      return `<option value="${escapeHtml(tire.id)}">${escapeHtml(label)}</option>`;
    }).join("");
  }

  if (tireCore && tireMethodEl && tireLookupEl) {
    renderLookupOptions();
    syncTireCoreFields();
    tireMethodEl.addEventListener("change", syncTireCoreFields);

    document.getElementById("calc-tire-core").addEventListener("click", () => {
      const method = tireMethodEl.value;
      const resultEl = document.getElementById("tire-core-result");
      const tire = tireCore.resolveTire({
        measuredValue: method === "measured" ? str("tire-core-measured") : "",
        measuredUnit: document.getElementById("tire-core-measured-unit").value,
        lookupId: method === "lookup" ? tireLookupEl.value : "",
        size: str("tire-core-size"),
      });

      if (!tire) {
        resultEl.innerHTML = `<p>Enter a measured rollout, choose a lookup tire, or use a size like <code>180/55-17</code>.</p>`;
        return;
      }

      const sourceLabel = {
        measured: "measured",
        lookup: "lookup",
        estimated: "estimated from size",
      }[tire.source] || tire.source;

      const rows = [
        numericRow("Rolling circumference", formatMm(tire.rollingCircMm, 1)),
        numericRow("Derived rolling diameter", formatMm(tire.diameterMm, 1)),
        row("Source", sourceLabel),
      ];

      if (tire.source === "estimated") {
        rows.push(numericRow("Sidewall", formatMm(tire.sidewallMm, 1)));
        rows.push(numericRow("Geometric diameter", formatMm(tire.geometricDiameterMm, 1)));
        rows.push(numericRow("Geometric circumference", formatMm(tire.geomCircMm, 1)));
        rows.push(row("Rolling factor", String(tire.rollingFactor)));
      }

      if (tire.source === "lookup") {
        rows.push(row("Tire", `${tire.manufacturer} ${tire.model} ${tire.size}`));
      }

      if (tire.deltaFromTheoreticalPct != null) {
        const smaller = tire.deltaFromTheoreticalPct < 0 ? "smaller" : "larger";
        rows.push(numericRow("Delta from nominal", `${formatMm(tire.deltaFromTheoreticalMm, 1)} (${formatPct(tire.deltaFromTheoreticalPct)})`));
        rows.push(row("Readout", `Running ${Math.abs(tire.deltaFromTheoreticalPct).toFixed(1)}% ${smaller} than nominal.`));
      } else if (tire.theoretical && tire.source === "lookup") {
        rows.push(numericRow("Nominal calculated reference", formatMm(tire.theoretical.rollingCircMm, 1)));
      }

      resultEl.innerHTML = `<h3>Tire value</h3>${rows.join("")}`;
    });
  }

  // --- Sag calculator -------------------------------------------------------
  let _sagCache = {};

  const sagMethodEl = document.getElementById("sag-method");
  const sagFrontL2Field = document.getElementById("sag-front-l2-field");
  const sagRearL2Field = document.getElementById("sag-rear-l2-field");

  function syncSagMethodFields() {
    const showL2 = sagMethodEl.value === "racetech";
    sagFrontL2Field.hidden = !showL2;
    sagRearL2Field.hidden = !showL2;
  }

  sagMethodEl.addEventListener("change", syncSagMethodFields);

  function computeSag(l1, l2, l3, method) {
    if (l1 == null || l3 == null) return null;
    if (method === "racetech") {
      if (l2 == null) return null;
      return l1 - (l2 + l3) / 2;
    }
    return l1 - l3;
  }

  document.getElementById("calc-sag").addEventListener("click", () => {
    const method = sagMethodEl.value;
    const fl1 = num("sag-front-l1"), fl2 = num("sag-front-l2"), fl3 = num("sag-front-l3");
    const rl1 = num("sag-rear-l1"), rl2 = num("sag-rear-l2"), rl3 = num("sag-rear-l3");
    const resultEl = document.getElementById("sag-result");

    const frontSag = computeSag(fl1, fl2, fl3, method);
    const rearSag = computeSag(rl1, rl2, rl3, method);
    const frontStatic = (fl1 != null && fl2 != null) ? fl1 - fl2 : null;
    const rearStatic = (rl1 != null && rl2 != null) ? rl1 - rl2 : null;

    if (frontSag == null && rearSag == null) {
      const l2note = method === "racetech" ? ", L2," : "";
      resultEl.innerHTML = `<p>Enter L1${l2note} and L3 for front or rear to calculate sag.</p>`;
      return;
    }

    _sagCache = {
      frontL1Mm: fl1,
      rearL1Mm: rl1,
      frontSagMm: frontSag,
      rearSagMm: rearSag,
    };

    const SAG_MIN = 25, SAG_MAX = 40;
    function sagTag(sag) {
      if (sag == null || sag < 0) return "";
      if (sag < SAG_MIN) return " — below typical range";
      if (sag > SAG_MAX) return " — above typical range";
      return " — within typical range";
    }

    const rows = [];
    if (frontSag != null) {
      rows.push(numericRow("Front rider sag", `${frontSag.toFixed(1)} mm${sagTag(frontSag)}`));
      if (frontStatic != null) rows.push(numericRow("Front static sag", `${frontStatic.toFixed(1)} mm`));
    }
    if (rearSag != null) {
      rows.push(numericRow("Rear rider sag", `${rearSag.toFixed(1)} mm${sagTag(rearSag)}`));
      if (rearStatic != null) rows.push(numericRow("Rear static sag", `${rearStatic.toFixed(1)} mm`));
    }
    if (frontSag != null && rearSag != null) {
      const balance = rearSag - frontSag;
      const balLabel = Math.abs(balance) <= 5 ? "balanced" : (balance > 0 ? "rear higher" : "front higher");
      rows.push(numericRow("Front / rear balance", `${signedMm(balance, 1)} (${balLabel})`));
    }

    const methodLabel = method === "racetech" ? "Race Tech method — stiction corrected" : "Simple method — L1 − L3";
    resultEl.innerHTML = `<h3>Sag result</h3>${rows.join("")}
      <p class="hint">${methodLabel}. Typical sport/track range: 25–40 mm rider sag. L1 and sag values are stored with this session when saved.</p>`;
  });

  // --- Geometry deltas ------------------------------------------------------
  function optionalPositive(id) {
    const value = num(id);
    return value == null || value < 0 ? 0 : value;
  }

  function geometryDirection(steepeningMm) {
    if (steepeningMm > 0) {
      return {
        rake: "less rake",
        trail: "less trail",
        steering: "quicker / twitchier",
      };
    }
    if (steepeningMm < 0) {
      return {
        rake: "more rake",
        trail: "more trail",
        steering: "slower / stabler",
      };
    }
    return {
      rake: "no net rake change",
      trail: "no net trail change",
      steering: "neutral",
    };
  }

  function trailFromConstants(radiusMm, rakeDeg, offsetMm) {
    const rakeRad = rakeDeg * Math.PI / 180;
    const cos = Math.cos(rakeRad);
    if (Math.abs(cos) < 0.0001) return null;
    return (radiusMm * Math.sin(rakeRad) - offsetMm) / cos;
  }

  function preciseTrailDelta(steepeningMm, constants) {
    const wheelbase = constants.wheelbaseMm;
    const radius = constants.frontRadiusMm;
    const rake = constants.designRakeDeg;
    const offset = constants.forkOffsetMm;
    if (![wheelbase, radius, rake, offset].every((v) => Number.isFinite(v) && v > 0)) return null;

    const rakeDeltaDeg = -(steepeningMm / wheelbase) * 57.2957795;
    const baseline = trailFromConstants(radius, rake, offset);
    const changed = trailFromConstants(radius, rake + rakeDeltaDeg, offset);
    if (baseline == null || changed == null) return null;
    return { trailDeltaMm: changed - baseline, rakeDeltaDeg };
  }

  function geometryConstantsFromForm() {
    const constants = {
      wheelbaseMm: num("geo-wheelbase"),
      designRakeDeg: num("geo-design-rake"),
      frontRadiusMm: num("geo-front-radius"),
      forkOffsetMm: num("geo-fork-offset"),
      frontL1Mm: num("sag-front-l1"),
      rearL1Mm: num("sag-rear-l1"),
      frontSagMm: typeof _sagCache.frontSagMm === "number" ? _sagCache.frontSagMm : null,
      rearSagMm: typeof _sagCache.rearSagMm === "number" ? _sagCache.rearSagMm : null,
    };
    return Object.values(constants).some((value) => value != null) ? constants : null;
  }

  document.getElementById("calc-geometry").addEventListener("click", () => {
    const forkUpMm = optionalPositive("geo-fork-up");
    const forkDownMm = optionalPositive("geo-fork-down");
    const rearRaiseMm = optionalPositive("geo-rear-raise");
    const rearLowerMm = optionalPositive("geo-rear-lower");
    const tireDiameterDeltaMm = num("geo-rear-tire-diameter") || 0;

    const frontEndRiseMm = forkDownMm - forkUpMm;
    const rearRideHeightDeltaMm = rearRaiseMm - rearLowerMm + (tireDiameterDeltaMm / 2);
    const steepeningMm = rearRideHeightDeltaMm - frontEndRiseMm;
    const direction = geometryDirection(steepeningMm);
    const tier2TrailDeltaMm = -(steepeningMm / 4);
    const precise = preciseTrailDelta(steepeningMm, geometryConstantsFromForm() || {});

    const resultEl = document.getElementById("geometry-result");
    if (frontEndRiseMm === 0 && rearRideHeightDeltaMm === 0) {
      resultEl.innerHTML = `<p>Enter a fork, rear ride-height, or rear-tire diameter change to see the geometry direction.</p>`;
      return;
    }

    const rows = [
      numericRow("Front ride-height result", signedMm(frontEndRiseMm, 1)),
      numericRow("Rear ride-height result", signedMm(rearRideHeightDeltaMm, 1)),
      row("Tier 1 direction", `${direction.rake}, ${direction.trail}`),
      row("Steering effect", direction.steering),
      numericRow("Tier 2 trail estimate", `${signedMm(tier2TrailDeltaMm, 1)} (estimated)`),
    ];

    if (precise) {
      rows.push(numericRow("Rake estimate", `${signedDeg(precise.rakeDeltaDeg)} (from wheelbase)`));
      rows.push(numericRow("Tier 3 trail delta", `${signedMm(precise.trailDeltaMm, 1)} (formula estimate)`));
    } else {
      rows.push(row("Tier 3 trail delta", "Add wheelbase, front radius, design rake, and offset to estimate with the trail formula."));
    }

    resultEl.innerHTML = `<h3>Geometry consequence</h3>${rows.join("")}
      <p class="hint">Static baseline only - rake changes dynamically under braking and acceleration.</p>
      <p class="hint">Short-wheelbase bikes amplify every change.</p>`;
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
    // after_review: the review summary meaningfully completed (non-empty).
    pulseClient.maybePrompt(el, "after_review");
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
    _sagCache = {};
    ["tire-result", "suspension-result", "laps-result", "summary-result", "save-result", "geometry-result", "sag-result"].forEach((id) => {
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
        geometryConstants: geometryConstantsFromForm(),
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
    const geometryConstants = s.setup && s.setup.geometryConstants || {};
    setId("geo-wheelbase", geometryConstants.wheelbaseMm);
    setId("geo-design-rake", geometryConstants.designRakeDeg);
    setId("geo-front-radius", geometryConstants.frontRadiusMm);
    setId("geo-fork-offset", geometryConstants.forkOffsetMm);
    setId("sag-front-l1", geometryConstants.frontL1Mm);
    setId("sag-rear-l1", geometryConstants.rearL1Mm);
    _sagCache = {
      frontL1Mm: geometryConstants.frontL1Mm != null ? geometryConstants.frontL1Mm : null,
      rearL1Mm: geometryConstants.rearL1Mm != null ? geometryConstants.rearL1Mm : null,
      frontSagMm: geometryConstants.frontSagMm != null ? geometryConstants.frontSagMm : null,
      rearSagMm: geometryConstants.rearSagMm != null ? geometryConstants.rearSagMm : null,
    };

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

    ["tire-result", "suspension-result", "laps-result", "summary-result", "save-result", "geometry-result", "sag-result"].forEach((id) => {
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

  function doSave() {
    const out = document.getElementById("save-result");
    if (!storageReady()) {
      out.innerHTML = `<p class="warn">Browser storage is unavailable, so nothing was saved.</p>`;
      return { ok: false };
    }
    const s = collectSession();
    const hasAny = Object.values(s.setup).some(Boolean)
      || Object.values(s.tires).some((v) => v !== "" && v !== false)
      || Object.values(s.suspension).some((v) => (Array.isArray(v) ? v.length : Boolean(v)))
      || (s.laps.times && s.laps.times.length);
    if (!hasAny) {
      out.innerHTML = `<p>Nothing to save yet — fill in some details first.</p>`;
      return { ok: false };
    }
    try {
      Store.add(s);
      return { ok: true, out };
    } catch (e) {
      out.innerHTML = `<p class="warn">Could not save: ${escapeHtml(e.message || String(e))}</p>`;
      return { ok: false };
    }
  }

  document.getElementById("save-session").addEventListener("click", () => {
    const r = doSave();
    if (r.ok) {
      r.out.innerHTML = `<p class="good">Saved locally. Open the History tab any time.</p>`;
      // after_save: a session was saved and the result stays visible here.
      // (Save & next intentionally does not prompt - it navigates onward to the
      // next session, so the prompt would be unseen and the flow is mid-task.)
      pulseClient.maybePrompt(r.out, "after_save");
    }
  });

  function bumpSessionLabel(label) {
    if (!label) return label;
    const m = label.match(/^(.*?)(\d+)(\D*)$/);
    if (!m) return label;
    const next = String(parseInt(m[2], 10) + 1);
    return m[1] + next + m[3];
  }

  function clearTransientFields() {
    ["amb-temp", "track-temp", "humidity", "general-notes",
     "front-pre", "rear-pre", "front-post", "rear-post",
     "laps-input"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
    document.querySelectorAll("#symptoms input[type=checkbox]").forEach((cb) => { cb.checked = false; });
    ["tire-result", "suspension-result", "laps-result", "summary-result"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = "";
    });
  }

  document.getElementById("save-and-next").addEventListener("click", () => {
    const r = doSave();
    if (!r.ok) return;
    const labelEl = document.getElementById("session-label");
    if (labelEl) labelEl.value = bumpSessionLabel(labelEl.value.trim());
    clearTransientFields();
    r.out.innerHTML = `<p class="good">Saved. Form is ready for the next session — bike, track, tire brand, and suspension settings carried over.</p>`;
    showTab("setup");
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
    const geometryConstants = s.setup && s.setup.geometryConstants || {};
    pushIf("Wheelbase", geometryConstants.wheelbaseMm);
    pushIf("Design rake", geometryConstants.designRakeDeg);
    pushIf("Front tire radius", geometryConstants.frontRadiusMm);
    pushIf("Fork offset", geometryConstants.forkOffsetMm);
    pushIf("Front L1 (extended)", geometryConstants.frontL1Mm);
    pushIf("Rear L1 (extended)", geometryConstants.rearL1Mm);
    if (geometryConstants.frontSagMm != null) pushIf("Front rider sag", `${Number(geometryConstants.frontSagMm).toFixed(1)} mm`);
    if (geometryConstants.rearSagMm != null) pushIf("Rear rider sag", `${Number(geometryConstants.rearSagMm).toFixed(1)} mm`);
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
      ["Wheelbase", (s) => s.setup && s.setup.geometryConstants && s.setup.geometryConstants.wheelbaseMm],
      ["Design rake", (s) => s.setup && s.setup.geometryConstants && s.setup.geometryConstants.designRakeDeg],
      ["Front tire radius", (s) => s.setup && s.setup.geometryConstants && s.setup.geometryConstants.frontRadiusMm],
      ["Fork offset", (s) => s.setup && s.setup.geometryConstants && s.setup.geometryConstants.forkOffsetMm],
      ["Front L1 (extended)", (s) => s.setup && s.setup.geometryConstants && s.setup.geometryConstants.frontL1Mm],
      ["Rear L1 (extended)", (s) => s.setup && s.setup.geometryConstants && s.setup.geometryConstants.rearL1Mm],
      ["Front rider sag", (s) => { const v = s.setup && s.setup.geometryConstants && s.setup.geometryConstants.frontSagMm; return v != null ? `${Number(v).toFixed(1)} mm` : ""; }],
      ["Rear rider sag", (s) => { const v = s.setup && s.setup.geometryConstants && s.setup.geometryConstants.rearSagMm; return v != null ? `${Number(v).toFixed(1)} mm` : ""; }],
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

  // --- Rider feedback (#55/#56 PR 2) ---------------------------------------
  // One entry that opens a dedicated surface. The originating section is
  // captured from the canonical tab state BEFORE the dialog opens, so it is
  // never overwritten with a "feedback" pseudo-section. No second section list.
  (function feedback() {
    const openBtn = document.getElementById("feedback-open");
    const overlay = document.getElementById("feedback-overlay");
    if (!openBtn || !overlay) return;
    const form = document.getElementById("feedback-form");
    const bodyField = document.getElementById("feedback-body");
    const emailField = document.getElementById("feedback-email");
    const statusEl = document.getElementById("feedback-status");
    const submitBtn = document.getElementById("feedback-submit");
    const closeBtn = document.getElementById("feedback-close");

    const GENERIC_FAIL = "We couldn't send your feedback right now. Please try again.";
    let captured = { sourceSection: null, sourceRoute: null };
    let lastFocus = null;
    let csrfToken = null;

    function activeSection() {
      const tab = document.querySelector('.tab[aria-selected="true"]');
      return tab ? tab.dataset.tab : null;
    }
    function setStatus(msg, kind) {
      statusEl.textContent = msg || "";
      statusEl.className = "feedback-status" + (kind ? " " + kind : "");
    }

    // Fail-closed reveal: the entry stays hidden until this bootstrap proves
    // the feature is enabled (GET succeeds and returns a CSRF token). The same
    // call mints the double-submit token, so opening the modal and submitting
    // need no further fetches.
    async function bootstrap() {
      try {
        const res = await fetch("/api/feedback", { method: "GET", headers: { accept: "application/json" } });
        if (!res.ok) return; // disabled/unavailable -> entry stays hidden
        const data = await res.json();
        if (!data || !data.csrf) return;
        csrfToken = data.csrf;
        openBtn.hidden = false; // reveal ONLY after availability is proven
      } catch (_) { /* stays hidden */ }
    }

    function open() {
      // Capture the originating context BEFORE showing the dialog. Opening is
      // local only - no fetch, no UI churn.
      captured = { sourceSection: activeSection(), sourceRoute: location.pathname + location.hash };
      setStatus("");
      form.hidden = false;
      overlay.hidden = false;
      lastFocus = document.activeElement;
      bodyField.focus();
    }
    function close() {
      overlay.hidden = true;
      form.reset();
      setStatus("");
      submitBtn.disabled = false;
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }

    openBtn.addEventListener("click", open);
    closeBtn.addEventListener("click", close);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !overlay.hidden) close(); });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = (bodyField.value || "").trim();
      if (body === "") { setStatus("Please enter some feedback first.", "warn"); bodyField.focus(); return; }
      if (!csrfToken) { setStatus(GENERIC_FAIL, "warn"); return; }
      submitBtn.disabled = true;
      setStatus("Sending…");
      try {
        const res = await fetch("/api/feedback", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            body,
            contactEmail: (emailField.value || "").trim() || undefined,
            sourceSection: captured.sourceSection,
            sourceRoute: captured.sourceRoute,
            csrf: csrfToken,
          }),
        });
        if (res.status === 201) {
          form.hidden = true;
          setStatus("Thanks for the feedback.", "ok");
          // Suppress any automatic Experience Pulse for the rest of this session
          // - a rider who just explained in full sentences is not asked to pulse.
          pulseClient.recordFeedbackSubmitted();
          return;
        }
        if (res.status === 400) {
          let code = "";
          try { code = (await res.json()).code; } catch (_) { /* ignore */ }
          setStatus(code === "invalid_email"
            ? "That email address doesn't look right. Fix it or leave it blank."
            : GENERIC_FAIL, "warn");
          submitBtn.disabled = false;
          return;
        }
        setStatus(GENERIC_FAIL, "warn");
        submitBtn.disabled = false;
      } catch (err) {
        setStatus(GENERIC_FAIL, "warn");
        submitBtn.disabled = false;
      }
    });

    bootstrap();
  })();

  // --- Experience Pulse (#55): a one-tap, optional, INLINE experience-instance
  // read shown after a successful save (after_save) or a built review summary
  // (after_review), inside the existing result region - never a modal, never a
  // persistent card, never blocking. Fail-closed: nothing renders unless the
  // gated endpoint confirms availability AND the cadence engine allows it. The
  // cadence ceiling (<=1/session, <=1/app_version/7d, none right after written
  // Feedback) lives in the shared, separately-tested engine
  // window.MotoTrackPulseCadence (public/experience-pulse-cadence.js) - this
  // controller owns only the DOM + network, so there is no hand-mirrored cadence
  // copy to drift. It NEVER opens the Feedback form (including for "1 - Not
  // good") and never treats "1" differently. `manual` stays reserved with no v1
  // UI. Defined after the Feedback controller and referenced from the save/
  // review handlers above, which run on user interaction (after this inits).
  const pulseClient = (function experiencePulse() {
    const ENDPOINT = "/api/experience-pulse";
    const cadence = window.MotoTrackPulseCadence || null;
    const stores = () => ({ sessionStorage: window.sessionStorage, localStorage: window.localStorage });
    let available = false;
    let csrfToken = null;
    let appVersion = null;

    function activeSection() {
      const tab = document.querySelector('.tab[aria-selected="true"]');
      return tab ? tab.dataset.tab : null;
    }

    // Fail-closed availability + double-submit token. Returns false (and leaves
    // the pulse hidden) unless the gated GET succeeds and returns a token +
    // canonical appVersion. Re-callable to re-mint an expired token.
    async function fetchToken() {
      const res = await fetch(ENDPOINT, { method: "GET", headers: { accept: "application/json" } });
      if (!res.ok) return false;
      const data = await res.json();
      if (!data || !data.csrf || !data.appVersion) return false;
      csrfToken = data.csrf;
      appVersion = data.appVersion;
      available = true;
      return true;
    }

    function postPulse(value, ctx) {
      return fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          value,
          sourceSection: ctx.sourceSection,
          sourceRoute: ctx.sourceRoute,
          actionContext: ctx.actionContext,
          csrf: csrfToken,
        }),
      });
    }

    function acknowledge(block) {
      block.textContent = "";
      const p = document.createElement("p");
      p.className = "pulse-ack";
      p.textContent = "Thanks.";
      block.appendChild(p);
    }

    async function submit(block, value, ctx) {
      block.querySelectorAll(".pulse-opt").forEach((b) => { b.disabled = true; });
      try {
        let res = await postPulse(value, ctx);
        if (res.status !== 201) {
          // The double-submit cookie/token can expire on a long-open tab; re-mint
          // once and retry so a genuine tap is not silently lost.
          await fetchToken();
          res = await postPulse(value, ctx);
        }
        if (res.status === 201) { acknowledge(block); return; }
      } catch (_) { /* fire-and-forget: a pulse never blocks continuation */ }
      // Any non-success after the retry: quietly remove the control. No nagging,
      // no error text, no workflow change - cadence already recorded the prompt.
      block.remove();
    }

    // Show an inline pulse in `target` (an existing .result region) if available
    // and the cadence engine allows. Appends below the region's existing
    // message; one tap.
    function maybePrompt(target, actionContext) {
      if (!available || !cadence || !target) return;
      if (!cadence.shouldAutoPrompt({ now: Date.now(), appVersion, ...stores() }).allowed) return;
      const ctx = { actionContext, sourceSection: activeSection(), sourceRoute: location.pathname + location.hash };
      const block = document.createElement("div");
      block.className = "pulse";
      block.setAttribute("role", "group");
      block.setAttribute("aria-label", "Experience pulse");
      const q = document.createElement("p");
      q.className = "pulse-q";
      q.textContent = "How was this experience?";
      const opts = document.createElement("div");
      opts.className = "pulse-options";
      [[1, "1 — Not good"], [2, "2 — Okay"], [3, "3 — Good"]].forEach(([value, label]) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "pulse-opt";
        b.dataset.value = String(value);
        b.textContent = label;
        b.addEventListener("click", () => submit(block, value, ctx));
        opts.appendChild(b);
      });
      block.appendChild(q);
      block.appendChild(opts);
      target.appendChild(block);
      // Record the SHOWN prompt (session cap + version window) so a prompt the
      // rider dismisses without answering still counts against the ceiling.
      cadence.recordPulsePrompted({ now: Date.now(), appVersion, ...stores() });
    }

    // Called from the written-Feedback success path so no automatic pulse
    // follows in this session.
    function recordFeedbackSubmitted() {
      if (cadence) cadence.recordFeedbackSubmitted({ sessionStorage: window.sessionStorage });
    }

    fetchToken().catch(() => { /* stays unavailable */ });

    return { maybePrompt, recordFeedbackSubmitted };
  })();

  // Initial state
  showStorageWarning();
})();
