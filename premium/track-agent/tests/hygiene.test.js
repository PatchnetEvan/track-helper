import assert from "node:assert/strict";
import {
  normalizeReviewedTrackAgentPayload,
  saveReviewedTrackAgentSession,
  TrackAgentValidationError,
} from "../src/track-agent-service.js";
import { validateTrackAgentReviewPayload } from "../src/schemas/track-agent-review.schema.js";

const rawNote = "Road Atlanta session 2 on Ninja 400. Best lap 97.4. Front hot 31. Bike felt loose on exit of Turn 7. Changed rear rebound softer one click.";

function canonicalPayload(overrides = {}) {
  return {
    confirmed: false,
    source: "ai_json",
    entry: {
      raw_note: rawNote,
      track_name: "Road Atlanta",
      bike_name: "Ninja 400",
      event_ref: null,
      motorcycle_ref: null,
      track_ref: null,
      app_session_ref: null,
    },
    session: {
      session_number: 2,
      session_label: "Session 2",
      session_type: null,
      occurred_at: null,
      conditions: {},
    },
    lap_times: [{ lap_number: null, lap_time: "97.4", is_best: true, source: "rider_note" }],
    tire_pressures: [{ position: "front", timing: "hot", pressure_psi: 31, source: "rider_note" }],
    setup_changes: [],
    notes: [],
    warnings: [],
    confidence: { overall: 0.8, fields: {} },
    ...overrides,
  };
}

function assertWarningAbsent(warnings, fragment) {
  assert.equal(
    warnings.some((warning) => warning.toLowerCase().includes(fragment.toLowerCase())),
    false,
    `Expected no warning containing: ${fragment}`,
  );
}

const quietPayload = normalizeReviewedTrackAgentPayload(canonicalPayload({
  warnings: [
    "Missing event_ref.",
    "Missing track_ref.",
    "Missing motorcycle_ref.",
    "Missing app_session_ref.",
    "Missing weather data.",
    "No setup changes were reviewed.",
    "No rider notes were reviewed.",
    "Ambiguous pressure value 31 could not be confidently classified.",
    "Ambiguous pressure value 31 could not be confidently classified.",
  ],
}));
assertWarningAbsent(quietPayload.warnings, "event_ref");
assertWarningAbsent(quietPayload.warnings, "track_ref");
assertWarningAbsent(quietPayload.warnings, "motorcycle_ref");
assertWarningAbsent(quietPayload.warnings, "app_session_ref");
assertWarningAbsent(quietPayload.warnings, "weather");
assertWarningAbsent(quietPayload.warnings, "No setup");
assertWarningAbsent(quietPayload.warnings, "No rider notes");
assert.deepEqual(quietPayload.warnings, ["Ambiguous pressure value 31 could not be confidently classified."]);

const emptyOptionalPayload = normalizeReviewedTrackAgentPayload(canonicalPayload({
  lap_times: [],
  tire_pressures: [],
  setup_changes: [],
  notes: [],
}));
const emptyValidation = validateTrackAgentReviewPayload(emptyOptionalPayload);
assert.equal(emptyValidation.ok, true);
assert.deepEqual(emptyValidation.warnings, []);

const dedupedNotes = normalizeReviewedTrackAgentPayload(canonicalPayload({
  notes: [
    { note_type: "handling", area: "Turn 7 exit", note: "Loose on exit", source: "rider_note" },
    { note_type: "handling", area: "Turn 7 exit", note: "Bike felt loose on exit of Turn 7", source: "rider_note" },
    { note_type: "handling", area: "Turn 7 exit", note: "bike felt loose on exit of turn 7", source: "rider_note" },
    { note_type: "rider", area: "braking", note: "Front felt vague on entry", source: "rider_note" },
  ],
}));
assert.equal(dedupedNotes.notes.length, 2);
assert.equal(dedupedNotes.notes[0].note, "Bike felt loose on exit of Turn 7");
assert.equal(dedupedNotes.notes[1].note, "Front felt vague on entry");

const distinctNotes = normalizeReviewedTrackAgentPayload(canonicalPayload({
  notes: [
    { note_type: "handling", area: "Turn 7 exit", note: "Loose on exit", source: "rider_note" },
    { note_type: "handling", area: "Turn 10 entry", note: "Pushing on entry", source: "rider_note" },
  ],
}));
assert.equal(distinctNotes.notes.length, 2);

const dedupedSetup = normalizeReviewedTrackAgentPayload(canonicalPayload({
  setup_changes: [
    { timing: "after", component: "rear suspension", adjustment: "rebound", change: "softer one click", source: "rider_note" },
    { timing: "after", component: "rear suspension", adjustment: "rebound", change: "softened rear rebound one click", source: "rider_note" },
    { timing: "after", component: "rear suspension", adjustment: "compression", change: "+2", source: "rider_note" },
  ],
}));
assert.equal(dedupedSetup.setup_changes.length, 2);
assert.equal(dedupedSetup.setup_changes[0].adjustment, "rebound");
assert.equal(dedupedSetup.setup_changes[1].adjustment, "compression");

const saveCandidate = normalizeReviewedTrackAgentPayload(canonicalPayload({
  confirmed: true,
  notes: [{ note_type: "handling", area: "Turn 7 exit", note: "Bike felt loose on exit of Turn 7", source: "rider_note" }],
}));
const saveValidation = validateTrackAgentReviewPayload(saveCandidate, { requireConfirmed: true });
assert.equal(saveValidation.ok, true, saveValidation.errors.join(", "));

await assert.rejects(
  () => saveReviewedTrackAgentSession({}, { ...saveCandidate, confirmed: false }),
  (error) => {
    assert.equal(error instanceof TrackAgentValidationError, true);
    assert.equal(error.details.includes("confirmed must be true."), true);
    return true;
  },
);

console.log("hygiene.test.js passed");
