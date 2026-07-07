import assert from "node:assert/strict";
import { evaluateTirePressureAdvisor } from "../src/tire-pressure-advisor-rules.js";
import { validateTirePressureAdvisorOutput } from "../src/tire-pressure-advisor.schema.js";

const baseScenario = {
  bike: "Yamaha R3",
  track: "Road Atlanta",
  session_label: "Session 3",
  tire_brand: "Dunlop",
  tire_model: "Q5S",
  tire_compound: "track-day",
  front_cold_psi: 30,
  rear_cold_psi: 27,
  front_hot_psi: 32,
  rear_hot_psi: 29,
  front_target_hot_range: { min: 31, max: 33 },
  rear_target_hot_range: { min: 28, max: 29 },
  ambient_temp_f: 82,
  track_temp_f: 104,
  warmer_use: "used",
  rider_pace: "intermediate",
  handling_symptom: "planted",
  rider_note: "Bike felt predictable.",
};

function assertValid(output) {
  const validation = validateTirePressureAdvisorOutput(output);
  assert.equal(validation.ok, true, validation.errors.join("; "));
}

function adjustment(output, tire) {
  return output.suggested_adjustments.find((item) => item.tire === tire);
}

function assertNoCertaintyLanguage(output) {
  const text = JSON.stringify(output).toLowerCase();
  assert.equal(text.includes("this will fix it"), false);
  assert.equal(text.includes("correct pressure"), false);
  assert.equal(text.includes("you should"), false);
}

const insideRange = evaluateTirePressureAdvisor(baseScenario);
assert.equal(insideRange.recommendation_status, "ready");
assert.equal(adjustment(insideRange, "front").direction, "hold");
assert.equal(adjustment(insideRange, "rear").direction, "hold");
assert.equal(insideRange.confidence, "medium");
assert.equal(Boolean(insideRange.safety_copy), true);
assertNoCertaintyLanguage(insideRange);
assertValid(insideRange);

const rearHigh = evaluateTirePressureAdvisor({
  ...baseScenario,
  rear_hot_psi: 31,
  handling_symptom: "rear feels planted",
});
assert.equal(rearHigh.recommendation_status, "ready");
assert.equal(adjustment(rearHigh, "rear").direction, "decrease");
assert.equal(adjustment(rearHigh, "rear").amount_psi, 1);
assertNoCertaintyLanguage(rearHigh);
assertValid(rearHigh);

const rearLow = evaluateTirePressureAdvisor({
  ...baseScenario,
  rear_hot_psi: 26.5,
});
assert.equal(rearLow.recommendation_status, "ready");
assert.equal(adjustment(rearLow, "rear").direction, "increase");
assert.equal(adjustment(rearLow, "rear").amount_psi, 1);
assertValid(rearLow);

const missingTarget = evaluateTirePressureAdvisor({
  ...baseScenario,
  front_target_hot_range: null,
  rear_target_hot_range: null,
});
assert.equal(missingTarget.recommendation_status, "needs_more_info");
assert.equal(missingTarget.suggested_adjustments.length, 0);
assert.equal(missingTarget.missing_fields.includes("front_target_hot_psi or front_target_hot_range"), true);
assert.equal(missingTarget.missing_fields.includes("rear_target_hot_psi or rear_target_hot_range"), true);
assertValid(missingTarget);

const missingTireIdentity = evaluateTirePressureAdvisor({
  ...baseScenario,
  tire_brand: null,
  tire_model: null,
  tire_compound: null,
});
assert.equal(missingTireIdentity.confidence, "low");
assert.equal(missingTireIdentity.warnings.some((warning) => warning.includes("Tire-specific guidance is limited")), true);
assert.equal(JSON.stringify(missingTireIdentity).includes("invented"), false);
assertValid(missingTireIdentity);

const vagueGreasySymptom = evaluateTirePressureAdvisor({
  ...baseScenario,
  rear_hot_psi: 27,
  handling_symptom: "rear feels greasy on exit",
  rider_note: "Rear was vague driving out.",
});
assert.equal(vagueGreasySymptom.recommendation_status, "ready");
assert.equal(adjustment(vagueGreasySymptom, "rear").direction, "increase");
assert.equal(adjustment(vagueGreasySymptom, "rear").amount_psi, 1);
assertNoCertaintyLanguage(vagueGreasySymptom);
assertValid(vagueGreasySymptom);

const conflictingSymptom = evaluateTirePressureAdvisor({
  ...baseScenario,
  rear_hot_psi: 31,
  handling_symptom: "rear feels cold with no grip",
  rider_note: "Rear felt cold/no grip even though pressure was high.",
});
assert.equal(conflictingSymptom.recommendation_status, "ready");
assert.equal(adjustment(conflictingSymptom, "rear").direction, "decrease");
assert.equal(conflictingSymptom.confidence, "low");
assert.equal(conflictingSymptom.warnings.some((warning) => warning.includes("conflicts with pressure data above")), true);
assertNoCertaintyLanguage(conflictingSymptom);
assertValid(conflictingSymptom);

const largeGap = evaluateTirePressureAdvisor({
  ...baseScenario,
  rear_hot_psi: 33,
});
assert.equal(adjustment(largeGap, "rear").direction, "decrease");
assert.equal(adjustment(largeGap, "rear").amount_psi, 1);
assert.equal(largeGap.warnings.some((warning) => warning.includes("far outside")), true);
assertValid(largeGap);

const warmerUnknown = evaluateTirePressureAdvisor({
  ...baseScenario,
  warmer_use: "unknown",
});
assert.equal(warmerUnknown.confidence, "low");
assert.equal(warmerUnknown.warnings.some((warning) => warning.includes("Warmer use")), true);
assertValid(warmerUnknown);

const trackTempMissing = evaluateTirePressureAdvisor({
  ...baseScenario,
  track_temp_f: null,
});
assert.equal(trackTempMissing.confidence, "low");
assert.equal(trackTempMissing.warnings.some((warning) => warning.includes("Track temperature")), true);
assertValid(trackTempMissing);

const advicePrompt = evaluateTirePressureAdvisor({
  ...baseScenario,
  rider_note: "What tire pressure should I run?",
});
assert.equal(advicePrompt.recommendation_status, "not_supported");
assert.equal(advicePrompt.suggested_adjustments.length, 0);
assertValid(advicePrompt);

const incompletePair = evaluateTirePressureAdvisor({
  ...baseScenario,
  rear_cold_psi: null,
});
assert.equal(incompletePair.recommendation_status, "needs_more_info");
assert.equal(incompletePair.missing_fields.includes("rear_cold_psi"), true);
assert.equal(incompletePair.suggested_adjustments.length, 0);
assertValid(incompletePair);

console.log("tire-pressure-advisor-scenarios.test.js passed");
