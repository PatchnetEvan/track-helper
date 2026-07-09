import assert from "node:assert/strict";
import worker from "../src/index.js";

const denyEnv = {};
const devEnv = {
  INVITE_ONLY: "true",
  TRACK_AGENT_ENABLE_DEV_USER_ID: "true",
  DEV_USER_ID: "dev-rider",
};

const advisorUiUrl = "https://agent.mototrack.app/track-agent/tire-pressure-advisor";

const unauthorizedAdvisorUi = await worker.fetch(new Request(advisorUiUrl), denyEnv);
assert.equal(unauthorizedAdvisorUi.status, 403);

const unauthorizedScript = await worker.fetch(new Request("https://agent.mototrack.app/track-agent/ui.js"), denyEnv);
assert.equal(unauthorizedScript.status, 403);

const unauthorizedAdvisorScript = await worker.fetch(new Request("https://agent.mototrack.app/track-agent/tire-pressure-advisor/ui.js"), denyEnv);
assert.equal(unauthorizedAdvisorScript.status, 403);

const authorizedAdvisorUi = await worker.fetch(
  new Request(`${advisorUiUrl}?user_id=dev-rider`),
  devEnv,
);
assert.equal(authorizedAdvisorUi.status, 302);
assert.equal(authorizedAdvisorUi.headers.get("location"), "/track-agent/tire-pressure-advisor");

const authorizedAdvisorUiClean = await worker.fetch(
  new Request(advisorUiUrl, { headers: { "x-user-id": "dev-rider" } }),
  devEnv,
);
assert.equal(authorizedAdvisorUiClean.status, 200);
const advisorHtml = await authorizedAdvisorUiClean.text();
assert.equal(advisorHtml.includes("Tire Pressure Advisor &mdash; Internal Rule-Only Preview"), true);
assert.equal(advisorHtml.includes("decision-support only"), true);
assert.equal(advisorHtml.includes("Bike / Track"), true);
assert.equal(advisorHtml.includes("Tire Identity"), true);
assert.equal(advisorHtml.includes("Pressures"), true);
assert.equal(advisorHtml.includes("Targets"), true);
assert.equal(advisorHtml.includes("Conditions"), true);
assert.equal(advisorHtml.includes("Rider Notes"), true);
assert.equal(advisorHtml.includes("advisor-error-panel"), true);
assert.equal(advisorHtml.includes('/track-agent/tire-pressure-advisor/ui.js'), true);

const publicLanding = await worker.fetch(new Request("https://agent.mototrack.app/"), denyEnv);
assert.equal(publicLanding.status, 200);
const publicLandingHtml = await publicLanding.text();
assert.equal(publicLandingHtml.includes("Tire Pressure Advisor — Internal Rule-Only Preview"), false);
assert.equal(publicLandingHtml.includes("/track-agent/tire-pressure-advisor"), false);

const authorizedTrackAgentUi = await worker.fetch(
  new Request("https://agent.mototrack.app/track-agent", { headers: { "x-user-id": "dev-rider" } }),
  devEnv,
);
assert.equal(authorizedTrackAgentUi.status, 200);
const trackAgentHtml = await authorizedTrackAgentUi.text();
assert.equal(trackAgentHtml.includes("/track-agent/tire-pressure-advisor"), true);

const authorizedScript = await worker.fetch(
  new Request("https://agent.mototrack.app/track-agent/tire-pressure-advisor/ui.js", { headers: { "x-user-id": "dev-rider" } }),
  devEnv,
);
assert.equal(authorizedScript.status, 200);
const scriptText = await authorizedScript.text();
assert.equal(scriptText.includes('fetch("/track-agent/tire-pressure-advisor"'), true);
assert.equal(scriptText.includes("/track-agent/parse"), false);
assert.equal(scriptText.includes("/track-agent/save"), false);
assert.equal(scriptText.includes("TRACK_AGENT_AI_PROVIDER"), false);
assert.equal(scriptText.includes("ai_json"), false);

let aiCalled = false;
let d1Touched = false;
const guardedEnv = {
  ...devEnv,
  TRACK_AGENT_AI_PROVIDER: "ai_json",
  AI: {
    run: async () => {
      aiCalled = true;
      throw new Error("Advisor UI must not call AI.");
    },
  },
  TRACK_AGENT_DB: {
    prepare: () => {
      d1Touched = true;
      throw new Error("Advisor UI must not call D1.");
    },
    batch: () => {
      d1Touched = true;
      throw new Error("Advisor UI must not call D1.");
    },
  },
};

const guardedAdvisorUi = await worker.fetch(
  new Request(advisorUiUrl, { headers: { "x-user-id": "dev-rider" } }),
  guardedEnv,
);
assert.equal(guardedAdvisorUi.status, 200);
assert.equal(aiCalled, false);
assert.equal(d1Touched, false);

const existingTrackAgentUi = await worker.fetch(
  new Request("https://agent.mototrack.app/track-agent", { headers: { "x-user-id": "dev-rider" } }),
  devEnv,
);
assert.equal(existingTrackAgentUi.status, 200);

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

console.log("tire-pressure-advisor-ui.test.js passed");
