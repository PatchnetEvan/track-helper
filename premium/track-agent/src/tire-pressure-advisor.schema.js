export const TIRE_PRESSURE_ADVISOR_STATUSES = ["ready", "needs_more_info", "not_supported"];
export const TIRE_PRESSURE_ADVISOR_CONFIDENCE = ["low", "medium", "high"];
export const TIRE_PRESSURE_ADVISOR_DIRECTIONS = ["increase", "decrease", "hold"];
export const TIRE_PRESSURE_ADVISOR_TIRES = ["front", "rear"];

export const TIRE_PRESSURE_ADVISOR_SAFETY_COPY =
  "These suggestions are decision-support only. Verify tire vendor guidance, track conditions, tire condition, warmer use, rider pace, and coach/mechanic input before making changes.";

const INPUT_FIELDS = new Set([
  "bike",
  "track",
  "session_label",
  "session_number",
  "tire_brand",
  "tire_model",
  "tire_compound",
  "front_cold_psi",
  "rear_cold_psi",
  "front_hot_psi",
  "rear_hot_psi",
  "front_target_hot_psi",
  "rear_target_hot_psi",
  "front_target_hot_range",
  "rear_target_hot_range",
  "ambient_temp_f",
  "track_temp_f",
  "warmer_use",
  "rider_pace",
  "handling_symptom",
  "rider_note",
  "max_adjustment_psi",
]);

const OUTPUT_FIELDS = new Set([
  "recommendation_status",
  "missing_fields",
  "observed_conditions",
  "pressure_analysis",
  "suggested_adjustments",
  "confidence",
  "warnings",
  "safety_copy",
]);

const ADJUSTMENT_FIELDS = new Set([
  "tire",
  "direction",
  "amount_psi",
  "reason",
  "confidence",
]);

const FORBIDDEN_ADVICE_TEXT = [
  /\bthis\s+will\s+fix\s+it\b/i,
  /\bcorrect\s+pressure\b/i,
  /\byou\s+should\b/i,
  /\bi\s+recommend\b/i,
  /\bride\s+harder\b/i,
  /\bignore\s+(?:the\s+)?(?:symptom|warning|check|vendor|coach|mechanic)\b/i,
];

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function stringValue(value) {
  return value == null ? null : String(value).trim() || null;
}

export function numberValue(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeRange(value) {
  if (!isPlainObject(value)) return null;
  const min = numberValue(value.min);
  const max = numberValue(value.max);
  if (min == null || max == null || min > max) return null;
  return { min, max };
}

export function targetRangeFromInput(input, tire) {
  const point = numberValue(input[`${tire}_target_hot_psi`]);
  if (point != null) return { min: point, max: point, source: "point" };

  const range = normalizeRange(input[`${tire}_target_hot_range`]);
  if (range) return { ...range, source: "range" };

  return null;
}

export function normalizeTirePressureAdvisorInput(input = {}) {
  const normalized = {};
  for (const field of INPUT_FIELDS) {
    if (!(field in input)) continue;
    if (field.endsWith("_psi") || field.endsWith("_temp_f") || field === "session_number" || field === "max_adjustment_psi") {
      normalized[field] = numberValue(input[field]);
    } else if (field.endsWith("_range")) {
      normalized[field] = normalizeRange(input[field]);
    } else {
      normalized[field] = stringValue(input[field]);
    }
  }
  return normalized;
}

export function validateTirePressureAdvisorInput(input = {}) {
  const errors = [];
  if (!isPlainObject(input)) return { ok: false, errors: ["input must be an object."] };

  Object.keys(input).forEach((field) => {
    if (!INPUT_FIELDS.has(field)) errors.push(`unsupported input field: ${field}`);
  });

  const normalized = normalizeTirePressureAdvisorInput(input);
  ["front_cold_psi", "rear_cold_psi", "front_hot_psi", "rear_hot_psi"].forEach((field) => {
    if (input[field] != null && normalized[field] == null) errors.push(`${field} must be numeric when provided.`);
  });

  ["front_target_hot_range", "rear_target_hot_range"].forEach((field) => {
    if (input[field] != null && normalized[field] == null) errors.push(`${field} must include numeric min and max values.`);
  });

  return { ok: errors.length === 0, errors, normalized };
}

function containsForbiddenText(value) {
  const text = String(value || "");
  return FORBIDDEN_ADVICE_TEXT.some((pattern) => pattern.test(text));
}

function validateAdjustment(adjustment, index) {
  const errors = [];
  if (!isPlainObject(adjustment)) return [`suggested_adjustments[${index}] must be an object.`];

  Object.keys(adjustment).forEach((field) => {
    if (!ADJUSTMENT_FIELDS.has(field)) errors.push(`suggested_adjustments[${index}] unsupported field: ${field}`);
  });

  if (!TIRE_PRESSURE_ADVISOR_TIRES.includes(adjustment.tire)) errors.push(`suggested_adjustments[${index}].tire is invalid.`);
  if (!TIRE_PRESSURE_ADVISOR_DIRECTIONS.includes(adjustment.direction)) errors.push(`suggested_adjustments[${index}].direction is invalid.`);
  if (adjustment.amount_psi != null && numberValue(adjustment.amount_psi) == null) errors.push(`suggested_adjustments[${index}].amount_psi must be numeric or null.`);
  if (adjustment.amount_psi != null && numberValue(adjustment.amount_psi) > 1) errors.push(`suggested_adjustments[${index}].amount_psi exceeds the default bounded limit.`);
  if (!stringValue(adjustment.reason)) errors.push(`suggested_adjustments[${index}].reason is required.`);
  if (!TIRE_PRESSURE_ADVISOR_CONFIDENCE.includes(adjustment.confidence)) errors.push(`suggested_adjustments[${index}].confidence is invalid.`);
  if (containsForbiddenText(adjustment.reason)) errors.push(`suggested_adjustments[${index}].reason contains unsupported advice language.`);

  return errors;
}

export function validateTirePressureAdvisorOutput(output = {}) {
  const errors = [];
  if (!isPlainObject(output)) return { ok: false, errors: ["output must be an object."] };

  Object.keys(output).forEach((field) => {
    if (!OUTPUT_FIELDS.has(field)) errors.push(`unsupported output field: ${field}`);
  });

  if (!TIRE_PRESSURE_ADVISOR_STATUSES.includes(output.recommendation_status)) errors.push("recommendation_status is invalid.");
  if (!Array.isArray(output.missing_fields)) errors.push("missing_fields must be an array.");
  if (!isPlainObject(output.observed_conditions)) errors.push("observed_conditions must be an object.");
  if (!isPlainObject(output.pressure_analysis)) errors.push("pressure_analysis must be an object.");
  if (!Array.isArray(output.suggested_adjustments)) errors.push("suggested_adjustments must be an array.");
  if (!TIRE_PRESSURE_ADVISOR_CONFIDENCE.includes(output.confidence)) errors.push("confidence is invalid.");
  if (!Array.isArray(output.warnings)) errors.push("warnings must be an array.");
  if (output.safety_copy !== TIRE_PRESSURE_ADVISOR_SAFETY_COPY) errors.push("safety_copy must use the approved Tire Pressure Advisor safety copy.");

  if (Array.isArray(output.suggested_adjustments)) {
    output.suggested_adjustments.forEach((adjustment, index) => {
      errors.push(...validateAdjustment(adjustment, index));
    });
  }

  const textFields = [
    output.safety_copy,
    ...(Array.isArray(output.warnings) ? output.warnings : []),
  ];
  if (textFields.some(containsForbiddenText)) errors.push("output contains unsupported advice language.");

  return { ok: errors.length === 0, errors };
}
