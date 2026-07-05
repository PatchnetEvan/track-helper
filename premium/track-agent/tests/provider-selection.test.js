import assert from "node:assert/strict";
import worker from "../src/index.js";
import { getTrackAgentParserProvider } from "../src/providers/index.js";
import {
  TRACK_AGENT_PROVIDER_ERROR_CODES,
  TrackAgentProviderError,
} from "../src/providers/provider-errors.js";

const sampleNote = "At Road Atlanta session 2 on Ninja 400 best 97.4 front hot 31 rear hot 27";
const validAiPayload = {
  confirmed: false,
  source: "ai_json",
  entry: {
    raw_note: sampleNote,
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
    { position: "rear", timing: "hot", pressure_psi: 27, source: "rider_note" },
  ],
  setup_changes: [],
  notes: [],
  warnings: [],
  confidence: { overall: 0.78, fields: {} },
};

function envWithAi(run, overrides = {}) {
  return {
    AI: { run },
    TRACK_AGENT_AI_MODEL: "@cf/meta/llama-3.1-8b-instruct-fast",
    TRACK_AGENT_AI_TIMEOUT_MS: "8000",
    TRACK_AGENT_AI_MAX_INPUT_CHARS: "4000",
    TRACK_AGENT_AI_MAX_OUTPUT_TOKENS: "1200",
    ...overrides,
  };
}

async function assertProviderRejects(provider, note, env, expectedCode) {
  await assert.rejects(
    () => provider.parseRawTrackNote(note, {}, env),
    (error) => {
      assert.equal(error instanceof TrackAgentProviderError, true);
      assert.equal(error.code, expectedCode);
      assert.equal(error.provider, "ai_json");
      return true;
    },
  );
}

assert.equal(getTrackAgentParserProvider({}).name, "mock");
assert.equal(getTrackAgentParserProvider({ TRACK_AGENT_AI_PROVIDER: "mock" }).name, "mock");
assert.equal(getTrackAgentParserProvider({ TRACK_AGENT_AI_PROVIDER: "stub_ai" }).name, "stub_ai");
assert.equal(getTrackAgentParserProvider({ TRACK_AGENT_AI_PROVIDER: "ai_json" }).name, "ai_json");
assert.equal(getTrackAgentParserProvider({ TRACK_AGENT_AI_PROVIDER: "does_not_exist" }).name, "mock");

const aiProvider = getTrackAgentParserProvider({ TRACK_AGENT_AI_PROVIDER: "ai_json" });
await assertProviderRejects(
  aiProvider,
  sampleNote,
  {},
  TRACK_AGENT_PROVIDER_ERROR_CODES.PROVIDER_NOT_CONFIGURED,
);
await assertProviderRejects(
  aiProvider,
  sampleNote,
  envWithAi(async () => ({ response: validAiPayload }), { TRACK_AGENT_AI_MODEL: "" }),
  TRACK_AGENT_PROVIDER_ERROR_CODES.PROVIDER_NOT_CONFIGURED,
);

let oversizedCalled = false;
await assertProviderRejects(
  aiProvider,
  "x".repeat(11),
  envWithAi(async () => {
    oversizedCalled = true;
    return { response: validAiPayload };
  }, { TRACK_AGENT_AI_MAX_INPUT_CHARS: "10" }),
  TRACK_AGENT_PROVIDER_ERROR_CODES.PROVIDER_SCHEMA_VALIDATION_FAILED,
);
assert.equal(oversizedCalled, false);

await assertProviderRejects(
  aiProvider,
  sampleNote,
  envWithAi(async () => ({ response: "{not json" })),
  TRACK_AGENT_PROVIDER_ERROR_CODES.PROVIDER_INVALID_JSON,
);

await assertProviderRejects(
  aiProvider,
  sampleNote,
  envWithAi(
    () => new Promise(() => {}),
    { TRACK_AGENT_AI_TIMEOUT_MS: "1" },
  ),
  TRACK_AGENT_PROVIDER_ERROR_CODES.PROVIDER_TIMEOUT,
);

await assertProviderRejects(
  aiProvider,
  sampleNote,
  envWithAi(async () => ({ response: { ...validAiPayload, confirmed: true } })),
  TRACK_AGENT_PROVIDER_ERROR_CODES.PROVIDER_SCHEMA_VALIDATION_FAILED,
);

let capturedModel = null;
let capturedPayload = null;
const parsed = await aiProvider.parseRawTrackNote(
  sampleNote,
  { user_id: "dev-rider" },
  envWithAi(async (model, payload) => {
    capturedModel = model;
    capturedPayload = payload;
    return { response: validAiPayload };
  }),
);
assert.equal(parsed.source, "ai_json");
assert.equal(parsed.confirmed, false);
assert.equal(capturedModel, "@cf/meta/llama-3.1-8b-instruct-fast");
assert.equal(capturedPayload.max_tokens, 1200);
assert.equal(capturedPayload.response_format.type, "json_schema");
assert.equal(capturedPayload.messages[0].content.includes("Do not provide coaching"), true);

let unauthorizedCalled = false;
const unauthorizedAiParse = await worker.fetch(
  new Request("https://agent.mototrack.app/track-agent/parse", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ raw_note: sampleNote }),
  }),
  {
    TRACK_AGENT_AI_PROVIDER: "ai_json",
    ...envWithAi(async () => {
      unauthorizedCalled = true;
      return { response: validAiPayload };
    }),
  },
);
assert.equal(unauthorizedAiParse.status, 403);
assert.equal(unauthorizedCalled, false);

const authorizedAiParse = await worker.fetch(
  new Request("https://agent.mototrack.app/track-agent/parse", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-user-id": "dev-rider",
    },
    body: JSON.stringify({ raw_note: sampleNote }),
  }),
  {
    INVITE_ONLY: "true",
    TRACK_AGENT_ENABLE_DEV_USER_ID: "true",
    DEV_USER_ID: "dev-rider",
    TRACK_AGENT_AI_PROVIDER: "ai_json",
    ...envWithAi(async () => ({ response: validAiPayload })),
  },
);
assert.equal(authorizedAiParse.status, 200);
const parsedBody = await authorizedAiParse.json();
assert.equal(parsedBody.parsed.source, "ai_json");
assert.equal(parsedBody.parsed.confirmed, false);

console.log("provider-selection.test.js passed");
