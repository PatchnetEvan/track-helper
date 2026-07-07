import {
  normalizeTirePressureAdvisorInput,
  targetRangeFromInput,
  TIRE_PRESSURE_ADVISOR_SAFETY_COPY,
  validateTirePressureAdvisorInput,
  validateTirePressureAdvisorOutput,
} from "./tire-pressure-advisor.schema.js";

const DEFAULT_MAX_ADJUSTMENT_PSI = 1;

const UNSUPPORTED_PROMPT_PATTERNS = [
  /\bwhat\s+(?:tire\s+)?pressure\s+should\s+i\s+run\b/i,
  /\btell\s+me\s+the\s+(?:right|correct)\s+pressure\b/i,
  /\bwhat\s+should\s+i\s+do\b/i,
  /\bthis\s+will\s+fix\s+it\b/i,
  /\bcorrect\s+pressure\b/i,
];

function hasText(value, pattern) {
  return pattern.test(String(value || ""));
}

function unsupportedPrompt(input) {
  return UNSUPPORTED_PROMPT_PATTERNS.some((pattern) => (
    hasText(input.handling_symptom, pattern) || hasText(input.rider_note, pattern)
  ));
}

function roundPsi(value) {
  return Math.round(value * 10) / 10;
}

function maxAdjustment(input, options = {}) {
  const configured = Number(options.maxAdjustmentPsi ?? input.max_adjustment_psi ?? DEFAULT_MAX_ADJUSTMENT_PSI);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_MAX_ADJUSTMENT_PSI;
  return Math.min(configured, DEFAULT_MAX_ADJUSTMENT_PSI);
}

function pressureDataMissing(input) {
  return ["front_cold_psi", "rear_cold_psi", "front_hot_psi", "rear_hot_psi"]
    .filter((field) => input[field] == null);
}

function targetMissing(input) {
  const missing = [];
  if (!targetRangeFromInput(input, "front")) missing.push("front_target_hot_psi or front_target_hot_range");
  if (!targetRangeFromInput(input, "rear")) missing.push("rear_target_hot_psi or rear_target_hot_range");
  return missing;
}

function tireInfoWarnings(input) {
  const missing = ["tire_brand", "tire_model", "tire_compound"].filter((field) => !input[field]);
  if (!missing.length) return [];
  return [`Tire-specific guidance is limited because ${missing.join(", ")} is missing.`];
}

function observedConditions(input) {
  return {
    bike: input.bike || null,
    track: input.track || null,
    session_label: input.session_label || null,
    session_number: input.session_number ?? null,
    tire_brand: input.tire_brand || null,
    tire_model: input.tire_model || null,
    tire_compound: input.tire_compound || null,
    front_cold_psi: input.front_cold_psi ?? null,
    rear_cold_psi: input.rear_cold_psi ?? null,
    front_hot_psi: input.front_hot_psi ?? null,
    rear_hot_psi: input.rear_hot_psi ?? null,
    front_target_hot_range: targetRangeFromInput(input, "front"),
    rear_target_hot_range: targetRangeFromInput(input, "rear"),
    ambient_temp_f: input.ambient_temp_f ?? null,
    track_temp_f: input.track_temp_f ?? null,
    warmer_use: input.warmer_use || null,
    rider_pace: input.rider_pace || null,
    handling_symptom: input.handling_symptom || null,
    rider_note: input.rider_note || null,
  };
}

function pressureAnalysis(input) {
  const frontTarget = targetRangeFromInput(input, "front");
  const rearTarget = targetRangeFromInput(input, "rear");
  return {
    front_delta_cold_to_hot: input.front_cold_psi == null || input.front_hot_psi == null ? null : roundPsi(input.front_hot_psi - input.front_cold_psi),
    rear_delta_cold_to_hot: input.rear_cold_psi == null || input.rear_hot_psi == null ? null : roundPsi(input.rear_hot_psi - input.rear_cold_psi),
    front_vs_target_hot: targetDelta(input.front_hot_psi, frontTarget),
    rear_vs_target_hot: targetDelta(input.rear_hot_psi, rearTarget),
  };
}

function targetDelta(hotPsi, target) {
  if (hotPsi == null || !target) return null;
  if (hotPsi < target.min) return roundPsi(hotPsi - target.min);
  if (hotPsi > target.max) return roundPsi(hotPsi - target.max);
  return 0;
}

function adjustmentFor(tire, hotPsi, target, cap) {
  if (hotPsi == null || !target) return null;

  if (hotPsi < target.min) {
    return {
      tire,
      direction: "increase",
      amount_psi: roundPsi(Math.min(target.min - hotPsi, cap)),
      reason: `${label(tire)} hot pressure is below the supplied target range; suggested adjustment to review is bounded.`,
      confidence: "medium",
    };
  }

  if (hotPsi > target.max) {
    return {
      tire,
      direction: "decrease",
      amount_psi: roundPsi(Math.min(hotPsi - target.max, cap)),
      reason: `${label(tire)} hot pressure is above the supplied target range; suggested adjustment to review is bounded.`,
      confidence: "medium",
    };
  }

  return {
    tire,
    direction: "hold",
    amount_psi: null,
    reason: `${label(tire)} hot pressure is within the supplied target range.`,
    confidence: "medium",
  };
}

function label(tire) {
  return tire === "front" ? "Front" : "Rear";
}

function conflictWarnings(input, adjustments) {
  const symptom = `${input.handling_symptom || ""} ${input.rider_note || ""}`.toLowerCase();
  const warnings = [];
  if (!symptom) return warnings;

  const hasInstabilitySymptom = /\b(loose|greasy|slid|slide|sliding|spin|spinning)\b/.test(symptom);
  const allHold = adjustments.length > 0 && adjustments.every((adjustment) => adjustment.direction === "hold");
  if (hasInstabilitySymptom && allHold) {
    warnings.push("Handling symptom conflicts with pressure data inside the supplied target range; review tire condition, track conditions, and setup context.");
  }
  return warnings;
}

function baseOutput(input, status, missingFields = [], warnings = []) {
  return {
    recommendation_status: status,
    missing_fields: missingFields,
    observed_conditions: observedConditions(input),
    pressure_analysis: pressureAnalysis(input),
    suggested_adjustments: [],
    confidence: "low",
    warnings,
    safety_copy: TIRE_PRESSURE_ADVISOR_SAFETY_COPY,
  };
}

export function evaluateTirePressureAdvisor(inputPayload = {}, options = {}) {
  const inputValidation = validateTirePressureAdvisorInput(inputPayload);
  const input = normalizeTirePressureAdvisorInput(inputPayload);

  if (!inputValidation.ok) {
    const output = baseOutput(input, "not_supported", [], inputValidation.errors);
    validateOrThrow(output);
    return output;
  }

  if (unsupportedPrompt(input)) {
    const output = baseOutput(input, "not_supported", [], [
      "Tire Pressure Advisor requires structured pressure data and cannot answer open-ended advice prompts.",
    ]);
    validateOrThrow(output);
    return output;
  }

  const missingPressure = pressureDataMissing(input);
  const missingTargets = targetMissing(input);
  const warnings = tireInfoWarnings(input);

  if (missingPressure.length || missingTargets.length) {
    const output = baseOutput(input, "needs_more_info", [...missingPressure, ...missingTargets], warnings);
    validateOrThrow(output);
    return output;
  }

  const cap = maxAdjustment(input, options);
  const adjustments = [
    adjustmentFor("front", input.front_hot_psi, targetRangeFromInput(input, "front"), cap),
    adjustmentFor("rear", input.rear_hot_psi, targetRangeFromInput(input, "rear"), cap),
  ].filter(Boolean);

  const outputWarnings = [...warnings, ...conflictWarnings(input, adjustments)];
  const output = {
    recommendation_status: "ready",
    missing_fields: [],
    observed_conditions: observedConditions(input),
    pressure_analysis: pressureAnalysis(input),
    suggested_adjustments: adjustments,
    confidence: outputWarnings.length ? "low" : "medium",
    warnings: outputWarnings,
    safety_copy: TIRE_PRESSURE_ADVISOR_SAFETY_COPY,
  };

  validateOrThrow(output);
  return output;
}

function validateOrThrow(output) {
  const validation = validateTirePressureAdvisorOutput(output);
  if (!validation.ok) {
    throw new Error(`Invalid Tire Pressure Advisor output: ${validation.errors.join("; ")}`);
  }
}
