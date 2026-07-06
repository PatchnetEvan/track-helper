import assert from "node:assert/strict";
import worker from "../src/index.js";
import {
  evaluateTrackAgentInputScope,
  TrackAgentScopeError,
} from "../src/track-agent-scope-policy.js";
import {
  parseTrackSessionNote,
  saveReviewedTrackAgentSession,
  TrackAgentValidationError,
} from "../src/track-agent-service.js";
import { getTrackAgentParserProvider } from "../src/providers/index.js";

const validNote = "Road Atlanta session 2 on Ninja 400. Best lap 97.4. Front hot 31, rear hot 27.5. Bike felt loose on exit of Turn 7. Changed rear rebound softer one click.";

const validAiPayload = {
  confirmed: false,
  source: "ai_json",
  entry: {
    raw_note: validNote,
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
  setup_changes: [{ timing: "after", component: "rear suspension", adjustment: "rebound", change: "softer one click", source: "rider_note" }],
  notes: [{ note_type: "handling", area: "Turn 7 exit", note: "Bike felt loose on exit of Turn 7.", source: "rider_note" }],
  warnings: [],
  confidence: { overall: 0.82, fields: {} },
};

function envWithAi(run, overrides = {}) {
  return {
    AI: { run },
    TRACK_AGENT_AI_PROVIDER: "ai_json",
    TRACK_AGENT_AI_MODEL: "@cf/meta/llama-3.1-8b-instruct-fast",
    TRACK_AGENT_AI_TIMEOUT_MS: "8000",
    TRACK_AGENT_AI_MAX_INPUT_CHARS: "4000",
    TRACK_AGENT_AI_MAX_OUTPUT_TOKENS: "1200",
    ...overrides,
  };
}

async function assertScopeRejects(note, expectedCode, env = {}) {
  await assert.rejects(
    () => parseTrackSessionNote(note, {}, env),
    (error) => {
      assert.equal(error instanceof TrackAgentScopeError, true);
      assert.equal(error.code, expectedCode);
      return true;
    },
  );
}

const inputScope = evaluateTrackAgentInputScope(validNote);
assert.equal(inputScope.ok, true);

const parsedMock = await parseTrackSessionNote(validNote, {}, {});
assert.equal(parsedMock.source, "mock_parser");
assert.equal(parsedMock.confirmed, false);

await assertScopeRejects("What tire pressure should I run at Road Atlanta?", "scope_advice_request");
await assertScopeRejects("Should I add rebound after Road Atlanta session 2?", "scope_advice_request");
await assertScopeRejects("Road Atlanta session 2. Credit card 4111 1111 1111 1111. Front hot 31.", "scope_sensitive_content");
await assertScopeRejects("Road Atlanta session 2. My emergency contact is Pat at 555-0100.", "scope_sensitive_content");
await assertScopeRejects("Write an email to my boss about tomorrow.", "scope_unrelated_prompt");
await assertScopeRejects("Road Atlanta session 2 best 97.4", "raw_note_too_long", { TRACK_AGENT_MAX_RAW_NOTE_CHARS: "10" });

const mixedNote = "Road Atlanta session 2. Best lap 97.4. Front hot 31. Also remind me to buy dinner.";
const mixedParsed = await parseTrackSessionNote(mixedNote, {}, {});
assert.equal(mixedParsed.warnings.some((warning) => warning.includes("possible unrelated personal text")), true);

let aiCalledForAdvice = false;
await assert.rejects(
  () => parseTrackSessionNote(
    "What tire pressure should I run?",
    {},
    envWithAi(async () => {
      aiCalledForAdvice = true;
      return { response: validAiPayload };
    }),
  ),
  (error) => {
    assert.equal(error instanceof TrackAgentScopeError, true);
    assert.equal(error.code, "scope_advice_request");
    return true;
  },
);
assert.equal(aiCalledForAdvice, false);

let aiCalledForAdviceOutput = false;
await assert.rejects(
  () => parseTrackSessionNote(
    validNote,
    {},
    envWithAi(async () => {
      aiCalledForAdviceOutput = true;
      return {
        response: {
          ...validAiPayload,
          notes: [{ note_type: "handling", area: "Turn 7", note: "You should add rebound next session.", source: "rider_note" }],
        },
      };
    }),
  ),
  (error) => {
    assert.equal(error instanceof TrackAgentScopeError, true);
    assert.equal(error.code, "scope_advice_output");
    return true;
  },
);
assert.equal(aiCalledForAdviceOutput, true);

let unauthorizedProviderCalled = false;
const unauthorizedParse = await worker.fetch(
  new Request("https://agent.mototrack.app/track-agent/parse", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ raw_note: "What tire pressure should I run?" }),
  }),
  envWithAi(async () => {
    unauthorizedProviderCalled = true;
    return { response: validAiPayload };
  }),
);
assert.equal(unauthorizedParse.status, 403);
assert.equal(unauthorizedProviderCalled, false);

assert.equal(getTrackAgentParserProvider({}).name, "mock");
assert.equal(getTrackAgentParserProvider({ TRACK_AGENT_AI_PROVIDER: "ai_json" }).name, "ai_json");

await assert.rejects(
  () => saveReviewedTrackAgentSession({}, { ...parsedMock, confirmed: false }),
  (error) => {
    assert.equal(error instanceof TrackAgentValidationError, true);
    assert.equal(error.details.includes("confirmed must be true."), true);
    return true;
  },
);

console.log("scope-policy.test.js passed");
