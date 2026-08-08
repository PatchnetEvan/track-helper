(function () {
  "use strict";

  const MM_PER_INCH = 25.4;
  const ROLLING_FACTOR = 0.96;

  const LOOKUP_TIRES = [
    {
      id: "pirelli-diablo-supercorsa-sc-180-55-17",
      manufacturer: "Pirelli",
      model: "Diablo Supercorsa SC",
      size: "180/55-17",
      rollingCircMm: 1899.4,
    },
    {
      id: "pirelli-diablo-supercorsa-sc-180-60-17",
      manufacturer: "Pirelli",
      model: "Diablo Supercorsa SC",
      size: "180/60-17",
      rollingCircMm: 1954.1,
    },
    {
      id: "dunlop-sportmax-q5-180-55-17",
      manufacturer: "Dunlop",
      model: "Sportmax Q5",
      size: "190/55-17",
      rollingCircMm: 1932.6,
    },
    {
      id: "bridgestone-battlax-racing-r11-180-55-17",
      manufacturer: "Bridgestone",
      model: "Battlax Racing R11",
      size: "180/55-17",
      rollingCircMm: 1899.4,
    },
    {
      id: "michelin-power-cup-2-180-55-17",
      manufacturer: "Michelin",
      model: "Power Cup 2",
      size: "120/70-17",
      rollingCircMm: 1808.9,
    },
  ];

  function round(value, digits) {
    const factor = Math.pow(10, digits == null ? 1 : digits);
    return Math.round(value * factor) / factor;
  }

  function parseTireSize(size) {
    const text = String(size || "").trim();
    const match = text.match(/^(\d{2,3})\s*\/\s*(\d{2,3})\s*(?:-|R)\s*(\d{2}(?:\.\d+)?)$/i);
    if (!match) return null;

    const widthMm = Number(match[1]);
    const aspectRatio = Number(match[2]);
    const rimIn = Number(match[3]);
    if (!Number.isFinite(widthMm) || !Number.isFinite(aspectRatio) || !Number.isFinite(rimIn)) return null;
    if (widthMm <= 0 || aspectRatio <= 0 || rimIn <= 0) return null;

    return { widthMm, aspectRatio, rimIn, text };
  }

  function calculateFromSize(size) {
    const parsed = parseTireSize(size);
    if (!parsed) return null;
    const sidewallMm = parsed.widthMm * (parsed.aspectRatio / 100);
    const geometricDiameterMm = parsed.rimIn * MM_PER_INCH + 2 * sidewallMm;
    const geomCircMm = Math.PI * geometricDiameterMm;
    const rollingCircMm = geomCircMm * ROLLING_FACTOR;

    return {
      source: "estimated",
      size: parsed.text,
      widthMm: parsed.widthMm,
      aspectRatio: parsed.aspectRatio,
      rimIn: parsed.rimIn,
      sidewallMm,
      diameterMm: diameterFromCircumference(rollingCircMm),
      geometricDiameterMm,
      geomCircMm,
      rollingCircMm,
      rollingFactor: ROLLING_FACTOR,
    };
  }

  function circumferenceToMm(value, unit) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    switch (unit) {
      case "in":
        return n * MM_PER_INCH;
      case "ft":
        return n * 12 * MM_PER_INCH;
      case "cm":
        return n * 10;
      case "m":
        return n * 1000;
      case "mm":
      default:
        return n;
    }
  }

  function diameterFromCircumference(rollingCircMm) {
    const n = Number(rollingCircMm);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n / Math.PI;
  }

  function lookupById(id) {
    return LOOKUP_TIRES.find((tire) => tire.id === id) || null;
  }

  function resolveTire(input) {
    const data = input || {};
    const theoretical = calculateFromSize(data.size);
    const measuredCircMm = circumferenceToMm(data.measuredValue, data.measuredUnit || "mm");

    if (measuredCircMm != null) {
      const result = {
        source: "measured",
        rollingCircMm: measuredCircMm,
        diameterMm: diameterFromCircumference(measuredCircMm),
        theoretical,
      };
      if (theoretical) {
        result.deltaFromTheoreticalMm = measuredCircMm - theoretical.rollingCircMm;
        result.deltaFromTheoreticalPct = (result.deltaFromTheoreticalMm / theoretical.rollingCircMm) * 100;
      }
      return result;
    }

    const lookup = data.lookupId ? lookupById(data.lookupId) : null;
    if (lookup) {
      return {
        source: "lookup",
        manufacturer: lookup.manufacturer,
        model: lookup.model,
        size: lookup.size,
        rollingCircMm: lookup.rollingCircMm,
        diameterMm: diameterFromCircumference(lookup.rollingCircMm),
        theoretical: calculateFromSize(lookup.size),
      };
    }

    if (theoretical) return theoretical;
    return null;
  }

  window.MotoTrackTireCore = {
    ROLLING_FACTOR,
    LOOKUP_TIRES,
    parseTireSize,
    calculateFromSize,
    circumferenceToMm,
    diameterFromCircumference,
    lookupById,
    resolveTire,
    round,
  };
})();
