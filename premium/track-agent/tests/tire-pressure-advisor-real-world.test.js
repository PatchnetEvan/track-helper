import assert from "node:assert/strict";
import { evaluateTirePressureAdvisor } from "../src/tire-pressure-advisor-rules.js";
import { validateTirePressureAdvisorOutput } from "../src/tire-pressure-advisor.schema.js";

const baseInput = {
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

function assertBounded(output) {
  output.suggested_adjustments.forEach((item) => {
    if (item.amount_psi != null) assert.ok(item.amount_psi <= 1, `${item.tire} adjustment exceeded 1 PSI`);
  });
}

function assertNoCertaintyLanguage(output) {
  const text = JSON.stringify(output).toLowerCase();
  ["this will fix it", "correct pressure", "you should", "i recommend"].forEach((phrase) => {
    assert.equal(text.includes(phrase), false, `output included ${phrase}`);
  });
}

const scenarios = [
  {
    name: "normal day pressures inside target",
    input: baseInput,
    assert(output) {
      assert.equal(output.recommendation_status, "ready");
      assert.equal(adjustment(output, "front").direction, "hold");
      assert.equal(adjustment(output, "rear").direction, "hold");
      assert.equal(output.confidence, "medium");
      assert.equal(output.warnings.length, 0);
    },
  },
  {
    name: "hot day rear pressure climbing above target",
    input: {
      ...baseInput,
      ambient_temp_f: 96,
      track_temp_f: 138,
      rear_hot_psi: 31,
      handling_symptom: "rear gets greasy late in the session",
      rider_note: "Rear pressure climbed after a hot afternoon session.",
    },
    assert(output) {
      assert.equal(output.recommendation_status, "ready");
      assert.equal(adjustment(output, "rear").direction, "decrease");
      assert.equal(adjustment(output, "rear").amount_psi, 1);
    },
  },
  {
    name: "cool morning pressures below target",
    input: {
      ...baseInput,
      ambient_temp_f: 58,
      track_temp_f: 64,
      front_hot_psi: 30.5,
      rear_hot_psi: 27.2,
      handling_symptom: "bike feels a little lazy",
      rider_note: "Cool first session, tires did not come up much.",
    },
    assert(output) {
      assert.equal(output.recommendation_status, "ready");
      assert.equal(adjustment(output, "front").direction, "increase");
      assert.equal(adjustment(output, "rear").direction, "increase");
      assertBounded(output);
    },
  },
  {
    name: "rear greasy on exit but pressure inside target",
    input: {
      ...baseInput,
      rear_hot_psi: 28.7,
      handling_symptom: "rear greasy on exit",
      rider_note: "Rear felt greasy driving out even though pressures were on target.",
    },
    assert(output) {
      assert.equal(output.recommendation_status, "ready");
      assert.equal(adjustment(output, "rear").direction, "hold");
      assert.equal(output.confidence, "low");
      assert.equal(output.warnings.some((warning) => warning.includes("conflicts with pressure data inside")), true);
    },
  },
  {
    name: "front vague mid-corner and front below target",
    input: {
      ...baseInput,
      front_hot_psi: 30,
      handling_symptom: "front vague mid-corner",
      rider_note: "Front felt vague mid-corner and would not settle.",
    },
    assert(output) {
      assert.equal(output.recommendation_status, "ready");
      assert.equal(adjustment(output, "front").direction, "increase");
      assert.equal(adjustment(output, "front").amount_psi, 1);
    },
  },
  {
    name: "chatter and instability with incomplete data",
    input: {
      ...baseInput,
      front_hot_psi: null,
      rear_hot_psi: null,
      handling_symptom: "front chatter and instability",
      rider_note: "Chatter started mid-corner but I did not get hot pressures.",
    },
    assert(output) {
      assert.equal(output.recommendation_status, "needs_more_info");
      assert.equal(output.suggested_adjustments.length, 0);
      assert.equal(output.warnings.some((warning) => warning.includes("Handling symptom is present")), true);
    },
  },
  {
    name: "track temp missing",
    input: {
      ...baseInput,
      track_temp_f: null,
    },
    assert(output) {
      assert.equal(output.recommendation_status, "ready");
      assert.equal(output.confidence, "low");
      assert.equal(output.warnings.some((warning) => warning.includes("Track temperature")), true);
    },
  },
  {
    name: "tire model and compound missing",
    input: {
      ...baseInput,
      tire_model: null,
      tire_compound: null,
    },
    assert(output) {
      assert.equal(output.recommendation_status, "ready");
      assert.equal(output.confidence, "low");
      assert.equal(output.warnings.some((warning) => warning.includes("Tire-specific guidance is limited")), true);
    },
  },
  {
    name: "big pressure miss",
    input: {
      ...baseInput,
      rear_hot_psi: 34,
      handling_symptom: "rear felt unstable",
      rider_note: "Rear hot pressure was way higher than expected.",
    },
    assert(output) {
      assert.equal(output.recommendation_status, "ready");
      assert.equal(adjustment(output, "rear").direction, "decrease");
      assert.equal(adjustment(output, "rear").amount_psi, 1);
      assert.equal(output.warnings.some((warning) => warning.includes("far outside")), true);
    },
  },
  {
    name: "conflicting notes",
    input: {
      ...baseInput,
      rear_hot_psi: 31,
      handling_symptom: "rear feels cold with no grip",
      rider_note: "Rear felt cold/no grip even though the gauge showed high pressure.",
    },
    assert(output) {
      assert.equal(output.recommendation_status, "ready");
      assert.equal(adjustment(output, "rear").direction, "decrease");
      assert.equal(output.confidence, "low");
      assert.equal(output.warnings.some((warning) => warning.includes("conflicts with pressure data above")), true);
    },
  },
  {
    name: "advice-seeking phrasing",
    input: {
      ...baseInput,
      rider_note: "What tire pressure should I run?",
    },
    assert(output) {
      assert.equal(output.recommendation_status, "not_supported");
      assert.equal(output.suggested_adjustments.length, 0);
    },
  },
  {
    name: "race-day fast session complete data",
    input: {
      ...baseInput,
      bike: "Kawasaki Ninja 400",
      session_label: "Race 1",
      rider_pace: "advanced race pace",
      tire_brand: "Pirelli",
      tire_model: "Diablo Superbike",
      tire_compound: "SC2",
      front_hot_psi: 32.5,
      rear_hot_psi: 28.2,
      handling_symptom: "stable",
      rider_note: "Fastest session of the day, bike stayed stable.",
    },
    assert(output) {
      assert.equal(output.recommendation_status, "ready");
      assert.equal(adjustment(output, "front").direction, "hold");
      assert.equal(adjustment(output, "rear").direction, "hold");
      assert.equal(output.confidence, "medium");
      assert.equal(output.warnings.length, 0);
    },
  },
];

for (const scenario of scenarios) {
  const output = evaluateTirePressureAdvisor(scenario.input);
  assertValid(output);
  assertBounded(output);
  assertNoCertaintyLanguage(output);
  scenario.assert(output);
}

console.log("tire-pressure-advisor-real-world.test.js passed");
