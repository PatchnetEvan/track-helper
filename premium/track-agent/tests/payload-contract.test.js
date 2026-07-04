import assert from "node:assert/strict";
import { mockParserProvider } from "../src/providers/mock-parser-provider.js";
import { stubAiProvider } from "../src/providers/stub-ai-provider.js";
import {
  normalizeReviewedTrackAgentPayload,
  saveReviewedTrackAgentSession,
  TrackAgentValidationError,
} from "../src/track-agent-service.js";
import { validateTrackAgentReviewPayload } from "../src/schemas/track-agent-review.schema.js";

const sampleNote = "At Road Atlanta session 2 on Ninja 400 best 97.4 front cold 30 rear hot 27 sprocket 45 -> 47 rear comp +2 felt better";
const allowedTopLevelKeys = [
  "confirmed",
  "source",
  "entry",
  "session",
  "lap_times",
  "tire_pressures",
  "setup_changes",
  "notes",
  "warnings",
  "confidence",
];

function assertValidCanonicalProviderPayload(providerName, payload) {
  const topLevelKeys = Object.keys(payload).sort();
  assert.deepEqual(topLevelKeys, [...allowedTopLevelKeys].sort(), `${providerName} returned unexpected top-level fields`);
  const normalized = normalizeReviewedTrackAgentPayload(payload);
  const validation = validateTrackAgentReviewPayload(normalized);
  assert.equal(validation.ok, true, `${providerName} payload should validate: ${validation.errors.join(", ")}`);
  assert.equal(typeof normalized.confirmed, "boolean", `${providerName} confirmed must be boolean`);
  assert.equal(normalized.entry.raw_note, sampleNote);
  assert.equal(normalized.session.session_number, 2);
  assert.equal(normalized.lap_times[0].lap_time, "97.4");
}

async function assertSaveRejects(payload, expectedDetail) {
  await assert.rejects(
    () => saveReviewedTrackAgentSession({}, payload),
    (error) => {
      assert.equal(error instanceof TrackAgentValidationError, true);
      assert.equal(error.details.includes(expectedDetail), true, `Expected validation detail: ${expectedDetail}`);
      return true;
    },
  );
}

const mockPayload = mockParserProvider.parseRawTrackNote(sampleNote);
assert.equal(mockPayload.source, "mock_parser");
assertValidCanonicalProviderPayload("mock", mockPayload);

const stubPayload = stubAiProvider.parseRawTrackNote(sampleNote);
assert.equal(stubPayload.source, "stub_ai");
assert.equal(stubPayload.warnings.includes("stub_ai provider selected; no external AI call was made."), true);
assertValidCanonicalProviderPayload("stub_ai", stubPayload);

const invalidPayload = {
  confirmed: "yes",
  entry: { raw_note: "" },
  session: { session_number: "two", conditions: {} },
  lap_times: "not array",
  tire_pressures: [{ position: "middle", timing: "hot", pressure_psi: "thirty", source: "test" }],
  setup_changes: [{}],
  notes: [{}],
  warnings: [12],
  confidence: { overall: "high", fields: [] },
};
const invalidValidation = validateTrackAgentReviewPayload(invalidPayload);
assert.equal(invalidValidation.ok, false);
assert.equal(invalidValidation.errors.includes("confirmed must be boolean."), true);
assert.equal(invalidValidation.errors.includes("entry.raw_note is required."), true);
assert.equal(invalidValidation.errors.includes("lap_times must be an array."), true);

const legacyPayload = normalizeReviewedTrackAgentPayload({
  confirmed: true,
  raw_note: sampleNote,
  track_name: "Road Atlanta",
  bike_name: "Ninja 400",
  session_number: 2,
  best_lap_time: "97.4",
  front_hot_pressure: 31,
  handling_notes: "felt better",
  setup_changes: [{ category: "gearing", field: "rear_sprocket", to_value: "47" }],
  confidence: 0.55,
});
assert.equal(legacyPayload.entry.track_name, "Road Atlanta");
assert.equal(legacyPayload.lap_times[0].lap_time, "97.4");
assert.equal(legacyPayload.tire_pressures[0].position, "front");
assert.equal(validateTrackAgentReviewPayload(legacyPayload, { requireConfirmed: true }).ok, true);

await assertSaveRejects({ ...legacyPayload, confirmed: false }, "confirmed must be true.");
const missingConfirmed = { ...legacyPayload };
delete missingConfirmed.confirmed;
await assertSaveRejects(missingConfirmed, "confirmed must be true.");

console.log("payload-contract.test.js passed");
