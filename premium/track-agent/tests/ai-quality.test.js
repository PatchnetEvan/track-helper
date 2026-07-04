import assert from "node:assert/strict";
import { aiJsonProvider } from "../src/providers/ai-json-provider.js";
import {
  TRACK_AGENT_PROVIDER_ERROR_CODES,
  TrackAgentProviderError,
} from "../src/providers/provider-errors.js";

const qualityNote = "Road Atlanta session 2 on Ninja 400. Best lap 97.4. Front hot 31, rear hot 27.5. Bike felt loose on exit of Turn 7. Changed rear rebound softer one click.";

function qualityPayload(overrides = {}) {
  return {
    confirmed: false,
    source: "ai_json",
    entry: {
      raw_note: qualityNote,
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
    tire_pressures: [
      { position: "front", timing: "hot", pressure_psi: 31, source: "rider_note" },
      { position: "rear", timing: "hot", pressure_psi: 27.5, source: "rider_note" },
    ],
    setup_changes: [
      { timing: null, component: "rear suspension", adjustment: "rebound", change: "softer one click", source: "rider_note" },
    ],
    notes: [
      { note_type: "handling", area: "Turn 7 exit", note: "Bike felt loose on exit of Turn 7.", source: "rider_note" },
    ],
    warnings: [],
    confidence: { overall: 0.82, fields: {} },
    ...overrides,
  };
}

function envWithAi(run) {
  return {
    AI: { run },
    TRACK_AGENT_AI_MODEL: "@cf/meta/llama-3.1-8b-instruct-fast",
    TRACK_AGENT_AI_TIMEOUT_MS: "8000",
    TRACK_AGENT_AI_MAX_INPUT_CHARS: "4000",
    TRACK_AGENT_AI_MAX_OUTPUT_TOKENS: "1200",
  };
}

async function assertProviderRejects(response, expectedCode) {
  await assert.rejects(
    () => aiJsonProvider.parseRawTrackNote(qualityNote, {}, envWithAi(async () => ({ response }))),
    (error) => {
      assert.equal(error instanceof TrackAgentProviderError, true);
      assert.equal(error.code, expectedCode);
      return true;
    },
  );
}

let capturedPrompt = null;
let capturedSchema = null;
const parsed = await aiJsonProvider.parseRawTrackNote(
  qualityNote,
  {},
  envWithAi(async (_model, payload) => {
    capturedPrompt = payload.messages.map((message) => message.content).join("\n");
    capturedSchema = payload.response_format.json_schema;
    return { response: qualityPayload() };
  }),
);

assert.equal(parsed.lap_times[0].lap_time, "97.4");
assert.equal(parsed.lap_times[0].is_best, true);
assert.equal(parsed.tire_pressures[1].pressure_psi, 27.5);
assert.equal(parsed.setup_changes[0].adjustment, "rebound");
assert.equal(parsed.notes[0].area, "Turn 7 exit");
assert.equal(capturedPrompt.includes("best lap 97.4"), true);
assert.equal(capturedPrompt.includes("rear rebound softer one click"), true);
assert.equal(capturedPrompt.includes("sprocket 45 -> 47"), true);
assert.equal(capturedSchema.properties.lap_times.items.properties.lap_time.description.includes("best lap"), true);
assert.equal(capturedSchema.properties.notes.items.properties.note.description.includes("pushing on entry"), true);

await assertProviderRejects(qualityPayload({ confirmed: true }), TRACK_AGENT_PROVIDER_ERROR_CODES.PROVIDER_SCHEMA_VALIDATION_FAILED);
await assertProviderRejects({
  ...qualityPayload(),
  entry: { ...qualityPayload().entry, raw_note: "Different raw note" },
}, TRACK_AGENT_PROVIDER_ERROR_CODES.PROVIDER_SCHEMA_VALIDATION_FAILED);
await assertProviderRejects({
  ...qualityPayload(),
  entry: { ...qualityPayload().entry, raw_note: null },
}, TRACK_AGENT_PROVIDER_ERROR_CODES.PROVIDER_SCHEMA_VALIDATION_FAILED);
await assertProviderRejects("{not json", TRACK_AGENT_PROVIDER_ERROR_CODES.PROVIDER_INVALID_JSON);
await assertProviderRejects({
  ...qualityPayload(),
  setup_changes: [{ timing: null, component: "rear suspension", adjustment: 99, change: "softer one click", source: "rider_note" }],
}, TRACK_AGENT_PROVIDER_ERROR_CODES.PROVIDER_SCHEMA_VALIDATION_FAILED);

console.log("ai-quality.test.js passed");
