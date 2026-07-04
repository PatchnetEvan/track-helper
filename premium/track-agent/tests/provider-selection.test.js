import assert from "node:assert/strict";
import worker from "../src/index.js";
import { getTrackAgentParserProvider } from "../src/providers/index.js";
import {
  TRACK_AGENT_PROVIDER_ERROR_CODES,
  TrackAgentProviderError,
} from "../src/providers/provider-errors.js";

assert.equal(getTrackAgentParserProvider({}).name, "mock");
assert.equal(getTrackAgentParserProvider({ TRACK_AGENT_AI_PROVIDER: "mock" }).name, "mock");
assert.equal(getTrackAgentParserProvider({ TRACK_AGENT_AI_PROVIDER: "stub_ai" }).name, "stub_ai");
assert.equal(getTrackAgentParserProvider({ TRACK_AGENT_AI_PROVIDER: "ai_json" }).name, "ai_json");
assert.equal(getTrackAgentParserProvider({ TRACK_AGENT_AI_PROVIDER: "does_not_exist" }).name, "mock");

const aiProvider = getTrackAgentParserProvider({ TRACK_AGENT_AI_PROVIDER: "ai_json" });
assert.throws(
  () => aiProvider.parseRawTrackNote("At Road Atlanta session 2", {}),
  (error) => {
    assert.equal(error instanceof TrackAgentProviderError, true);
    assert.equal(error.code, TRACK_AGENT_PROVIDER_ERROR_CODES.PROVIDER_NOT_CONFIGURED);
    assert.equal(error.provider, "ai_json");
    assert.equal(error.message.includes("No AI call was made"), true);
    return true;
  },
);

const unauthorizedAiParse = await worker.fetch(
  new Request("https://agent.mototrack.app/track-agent/parse", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ raw_note: "At Road Atlanta session 2" }),
  }),
  { TRACK_AGENT_AI_PROVIDER: "ai_json" },
);
assert.equal(unauthorizedAiParse.status, 403);

const authorizedAiParse = await worker.fetch(
  new Request("https://agent.mototrack.app/track-agent/parse", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-user-id": "dev-rider",
    },
    body: JSON.stringify({ raw_note: "At Road Atlanta session 2" }),
  }),
  {
    INVITE_ONLY: "true",
    DEV_USER_ID: "dev-rider",
    TRACK_AGENT_AI_PROVIDER: "ai_json",
  },
);
assert.equal(authorizedAiParse.status, 503);
const errorBody = await authorizedAiParse.json();
assert.equal(errorBody.error, TRACK_AGENT_PROVIDER_ERROR_CODES.PROVIDER_NOT_CONFIGURED);
assert.equal(errorBody.provider, "ai_json");

console.log("provider-selection.test.js passed");
