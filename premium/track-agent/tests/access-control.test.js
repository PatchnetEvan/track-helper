import assert from "node:assert/strict";
import worker from "../src/index.js";
import {
  requireTrackAgentAccess,
  userHasPremiumAccess,
} from "../src/premium-access.js";

const denyEnv = {};
const allowEnv = { INVITE_ONLY: "true", DEV_USER_ID: "dev-rider", TRACK_AGENT_INVITE_TOKEN: "local-token" };

assert.equal(await userHasPremiumAccess("anonymous", denyEnv), false);
assert.equal(await userHasPremiumAccess("dev-rider", allowEnv), true);
assert.equal(await userHasPremiumAccess("someone", allowEnv, { inviteToken: "local-token" }), true);
assert.equal(await userHasPremiumAccess("someone", allowEnv, { inviteToken: "wrong-token" }), false);

const denied = await requireTrackAgentAccess(new Request("https://agent.mototrack.app/track-agent"), denyEnv);
assert.equal(denied.allowed, false);
assert.equal(denied.response.status, 403);

const allowed = await requireTrackAgentAccess(
  new Request("https://agent.mototrack.app/track-agent?user_id=dev-rider"),
  allowEnv,
);
assert.equal(allowed.allowed, true);
assert.equal(allowed.userId, "dev-rider");
assert.equal(allowed.cookieHeaders.length > 0, true);

const unauthorizedUi = await worker.fetch(new Request("https://agent.mototrack.app/track-agent"), denyEnv);
assert.equal(unauthorizedUi.status, 403);
assert.equal((await unauthorizedUi.text()).includes("Track Agent access pending"), true);

const unauthorizedScript = await worker.fetch(new Request("https://agent.mototrack.app/track-agent/ui.js"), denyEnv);
assert.equal(unauthorizedScript.status, 403);

const authorizedUi = await worker.fetch(
  new Request("https://agent.mototrack.app/track-agent?user_id=dev-rider"),
  allowEnv,
);
assert.equal(authorizedUi.status, 200);
assert.equal((await authorizedUi.text()).includes("Raw Session Note"), true);
assert.equal(authorizedUi.headers.has("set-cookie"), true);

const authorizedParse = await worker.fetch(
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
  allowEnv,
);
assert.equal(authorizedParse.status, 200);
const parsed = await authorizedParse.json();
assert.equal(parsed.parsed.entry.track_name, "Road Atlanta");

const unauthorizedParse = await worker.fetch(
  new Request("https://agent.mototrack.app/track-agent/parse", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ raw_note: "At Road Atlanta session 2" }),
  }),
  denyEnv,
);
assert.equal(unauthorizedParse.status, 403);

const unauthorizedSave = await worker.fetch(
  new Request("https://agent.mototrack.app/track-agent/save", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ confirmed: true, entry: { raw_note: "blocked" } }),
  }),
  denyEnv,
);
assert.equal(unauthorizedSave.status, 403);

console.log("access-control.test.js passed");
