import assert from "node:assert/strict";
import {
  TIRE_PRESSURE_ADVISOR_SAFETY_COPY,
  validateTirePressureAdvisorOutput,
} from "../src/tire-pressure-advisor.schema.js";
import { evaluateTirePressureAdvisor } from "../src/tire-pressure-advisor-rules.js";
import { getTrackAgentParserProvider } from "../src/providers/index.js";

const completeInput = {
  bike: "Ninja 400",
  track: "Road Atlanta",
  session_number: 2,
  tire_brand: "Pirelli",
  tire_model: "Diablo Supercorsa",
  tire_compound: "SC1",
  front_cold_psi: 30,
  rear_cold_psi: 27,
  front_hot_psi: 31,
  rear_hot_psi: 27.5,
  front_target_hot_range: { min: 31, max: 33 },
  rear_target_hot_range: { min: 28.5, max: 30 },
  ambient_temp_f: 78,
  track_temp_f: 96,
  warmer_use: "used",
  rider_pace: "intermediate",
  handling_symptom: "rear felt loose on exit",
  rider_note: "Rear felt loose on exit of Turn 7.",
};

function adjustment(output, tire) {
  return output.suggested_adjustments.find((item) => item.tire === tire);
}

function assertValid(output) {
  const validation = validateTirePressureAdvisorOutput(output);
  assert.equal(validation.ok, true, validation.errors.join("; "));
  assert.equal(output.safety_copy, TIRE_PRESSURE_ADVISOR_SAFETY_COPY);
}

const ready = evaluateTirePressureAdvisor(completeInput);
assert.equal(ready.recommendation_status, "ready");
assert.equal(ready.missing_fields.length, 0);
assert.equal(adjustment(ready, "front").direction, "hold");
assert.equal(adjustment(ready, "rear").direction, "increase");
assert.equal(adjustment(ready, "rear").amount_psi, 1);
assertValid(ready);

const missingTargets = evaluateTirePressureAdvisor({
  ...completeInput,
  front_target_hot_range: null,
  rear_target_hot_range: null,
});
assert.equal(missingTargets.recommendation_status, "needs_more_info");
assert.equal(missingTargets.missing_fields.includes("front_target_hot_psi or front_target_hot_range"), true);
assert.equal(missingTargets.suggested_adjustments.length, 0);
assertValid(missingTargets);

const missingTireInfo = evaluateTirePressureAdvisor({
  ...completeInput,
  tire_brand: null,
  tire_model: null,
  tire_compound: null,
});
assert.equal(missingTireInfo.recommendation_status, "ready");
assert.equal(missingTireInfo.confidence, "low");
assert.equal(missingTireInfo.warnings.some((warning) => warning.includes("Tire-specific guidance is limited")), true);
assertValid(missingTireInfo);

const insideRange = evaluateTirePressureAdvisor({
  ...completeInput,
  front_hot_psi: 32,
  rear_hot_psi: 29,
});
assert.equal(adjustment(insideRange, "front").direction, "hold");
assert.equal(adjustment(insideRange, "rear").direction, "hold");
assert.equal(adjustment(insideRange, "front").amount_psi, null);
assertValid(insideRange);

const overRange = evaluateTirePressureAdvisor({
  ...completeInput,
  front_hot_psi: 35,
});
assert.equal(adjustment(overRange, "front").direction, "decrease");
assert.equal(adjustment(overRange, "front").amount_psi, 1);
assertValid(overRange);

const underRange = evaluateTirePressureAdvisor({
  ...completeInput,
  rear_hot_psi: 27.9,
});
assert.equal(adjustment(underRange, "rear").direction, "increase");
assert.equal(adjustment(underRange, "rear").amount_psi, 0.6);
assertValid(underRange);

const capped = evaluateTirePressureAdvisor({
  ...completeInput,
  rear_hot_psi: 20,
  max_adjustment_psi: 5,
});
assert.equal(adjustment(capped, "rear").direction, "increase");
assert.equal(adjustment(capped, "rear").amount_psi, 1);
assertValid(capped);

const incompletePressure = evaluateTirePressureAdvisor({
  ...completeInput,
  front_hot_psi: null,
});
assert.equal(incompletePressure.recommendation_status, "needs_more_info");
assert.equal(incompletePressure.missing_fields.includes("front_hot_psi"), true);
assert.equal(incompletePressure.suggested_adjustments.length, 0);
assertValid(incompletePressure);

const unsupported = evaluateTirePressureAdvisor({
  ...completeInput,
  rider_note: "What tire pressure should I run?",
});
assert.equal(unsupported.recommendation_status, "not_supported");
assert.equal(unsupported.suggested_adjustments.length, 0);
assertValid(unsupported);

const invalidOutput = validateTirePressureAdvisorOutput({
  ...ready,
  chatbot_reply: "extra unsupported field",
});
assert.equal(invalidOutput.ok, false);
assert.equal(invalidOutput.errors.some((error) => error.includes("unsupported output field")), true);

const unboundedOutput = validateTirePressureAdvisorOutput({
  ...ready,
  suggested_adjustments: [{
    tire: "rear",
    direction: "increase",
    amount_psi: 3,
    reason: "Rear hot pressure is below the supplied target range.",
    confidence: "medium",
  }],
});
assert.equal(unboundedOutput.ok, false);
assert.equal(unboundedOutput.errors.some((error) => error.includes("exceeds")), true);

const coachingOutput = validateTirePressureAdvisorOutput({
  ...ready,
  suggested_adjustments: [{
    tire: "rear",
    direction: "increase",
    amount_psi: 0.5,
    reason: "You should run more pressure because this will fix it.",
    confidence: "medium",
  }],
});
assert.equal(coachingOutput.ok, false);
assert.equal(coachingOutput.errors.some((error) => error.includes("unsupported advice language")), true);

assert.equal(getTrackAgentParserProvider({}).name, "mock");
assert.equal(getTrackAgentParserProvider({ TRACK_AGENT_AI_PROVIDER: "does_not_exist" }).name, "mock");

console.log("tire-pressure-advisor.test.js passed");
