import assert from "node:assert/strict";
import worker from "../src/index.js";

const inviteEnv = {
  INVITE_ONLY: "true",
  TRACK_AGENT_INVITE_TOKEN: "advisor-local-token",
};

const devEnv = {
  INVITE_ONLY: "true",
  TRACK_AGENT_ENABLE_DEV_USER_ID: "true",
  DEV_USER_ID: "dev-rider",
};

const completePayload = {
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

function advisorRequest(body, headers = {}) {
  return new Request("https://agent.mototrack.app/track-agent/tire-pressure-advisor", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function cookieValue(response, name) {
  const setCookie = response.headers.get("set-cookie") || "";
  const match = setCookie.match(new RegExp(`${name}=([^;]+)`));
  return match ? match[0] : null;
}

const unauthorizedInvalidPayload = await worker.fetch(
  advisorRequest({ ...completePayload, front_hot_psi: "not numeric" }),
  inviteEnv,
);
assert.equal(unauthorizedInvalidPayload.status, 403);

const completeByHeaderToken = await worker.fetch(
  advisorRequest(completePayload, { "x-track-agent-invite-token": "advisor-local-token" }),
  inviteEnv,
);
assert.equal(completeByHeaderToken.status, 200);
const completeOutput = await completeByHeaderToken.json();
assert.equal(completeOutput.recommendation_status, "ready");
assert.equal(completeOutput.suggested_adjustments.some((adjustment) => adjustment.tire === "front"), true);
assert.equal(completeOutput.suggested_adjustments.some((adjustment) => adjustment.tire === "rear"), true);

const inviteUi = await worker.fetch(
  new Request("https://agent.mototrack.app/track-agent?invite_token=advisor-local-token"),
  inviteEnv,
);
assert.equal(inviteUi.status, 302);
const inviteCookie = cookieValue(inviteUi, "track_agent_invite_token");
assert.equal(inviteCookie != null, true);

const completeByCookie = await worker.fetch(
  advisorRequest(completePayload, { cookie: inviteCookie }),
  inviteEnv,
);
assert.equal(completeByCookie.status, 200);
assert.equal((await completeByCookie.json()).recommendation_status, "ready");

const missingTarget = await worker.fetch(
  advisorRequest({
    ...completePayload,
    front_target_hot_range: null,
    rear_target_hot_range: null,
  }, { "x-user-id": "dev-rider" }),
  devEnv,
);
assert.equal(missingTarget.status, 200);
const missingTargetOutput = await missingTarget.json();
assert.equal(missingTargetOutput.recommendation_status, "needs_more_info");
assert.equal(missingTargetOutput.suggested_adjustments.length, 0);

const advicePrompt = await worker.fetch(
  advisorRequest({
    ...completePayload,
    rider_note: "What tire pressure should I run?",
  }, { "x-user-id": "dev-rider" }),
  devEnv,
);
assert.equal(advicePrompt.status, 200);
const adviceOutput = await advicePrompt.json();
assert.equal(adviceOutput.recommendation_status, "not_supported");
assert.equal(adviceOutput.suggested_adjustments.length, 0);

const invalidPayload = await worker.fetch(
  advisorRequest({
    ...completePayload,
    rear_hot_psi: "warm",
  }, { "x-user-id": "dev-rider" }),
  devEnv,
);
assert.equal(invalidPayload.status, 400);
const invalidPayloadBody = await invalidPayload.json();
assert.equal(invalidPayloadBody.error, "validation_failed");

let aiCalled = false;
const noAiEnv = {
  ...devEnv,
  TRACK_AGENT_AI_PROVIDER: "ai_json",
  AI: {
    run: async () => {
      aiCalled = true;
      throw new Error("AI must not be called by Tire Pressure Advisor API.");
    },
  },
};
const noAiResponse = await worker.fetch(
  advisorRequest(completePayload, { "x-user-id": "dev-rider" }),
  noAiEnv,
);
assert.equal(noAiResponse.status, 200);
assert.equal(aiCalled, false);

let d1Touched = false;
const noD1Env = {
  ...devEnv,
  TRACK_AGENT_DB: {
    prepare: () => {
      d1Touched = true;
      throw new Error("D1 must not be called by Tire Pressure Advisor API.");
    },
    batch: () => {
      d1Touched = true;
      throw new Error("D1 must not be called by Tire Pressure Advisor API.");
    },
  },
};
const noD1Response = await worker.fetch(
  advisorRequest(completePayload, { "x-user-id": "dev-rider" }),
  noD1Env,
);
assert.equal(noD1Response.status, 200);
assert.equal(d1Touched, false);

const existingParseStillWorks = await worker.fetch(
  new Request("https://agent.mototrack.app/track-agent/parse", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-user-id": "dev-rider",
    },
    body: JSON.stringify({
      raw_note: "At Road Atlanta session 2 on Ninja 400 best 97.4 front hot 31 rear hot 27",
    }),
  }),
  devEnv,
);
assert.equal(existingParseStillWorks.status, 200);
const parsed = await existingParseStillWorks.json();
assert.equal(parsed.parsed.source, "mock_parser");

console.log("tire-pressure-advisor-api.test.js passed");
