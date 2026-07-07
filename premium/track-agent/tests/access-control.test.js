import assert from "node:assert/strict";
import worker from "../src/index.js";
import {
  requireTrackAgentAccess,
  userHasPremiumAccess,
} from "../src/premium-access.js";

const denyEnv = {};
const inviteEnv = { INVITE_ONLY: "true", TRACK_AGENT_INVITE_TOKEN: "local-token" };
const encodedInviteToken = "local/token+with=symbols";
const encodedInviteEnv = { INVITE_ONLY: "true", TRACK_AGENT_INVITE_TOKEN: encodedInviteToken };
const devEnv = { INVITE_ONLY: "true", TRACK_AGENT_ENABLE_DEV_USER_ID: "true", DEV_USER_ID: "dev-rider" };
const allowedUserEnv = { INVITE_ONLY: "true", TRACK_AGENT_ALLOWED_USER_IDS: "rider-1,rider-2" };

function cookieValue(response, name) {
  const setCookie = response.headers.get("set-cookie") || "";
  const match = setCookie.match(new RegExp(`${name}=([^;]+)`));
  return match ? match[0] : null;
}

function assertSetCookieHasSecurity(response, cookieName) {
  const setCookie = response.headers.get("set-cookie") || "";
  assert.equal(setCookie.includes(`${cookieName}=`), true);
  assert.equal(setCookie.includes("HttpOnly"), true);
  assert.equal(setCookie.includes("SameSite=Lax"), true);
  assert.equal(setCookie.includes("Max-Age=86400"), true);
  assert.equal(setCookie.includes("Secure"), true);
}

assert.equal(await userHasPremiumAccess("anonymous", denyEnv), false);
assert.equal(await userHasPremiumAccess("dev-rider", { INVITE_ONLY: "true", DEV_USER_ID: "dev-rider" }), false);
assert.equal(await userHasPremiumAccess("dev-rider", devEnv), true);
assert.equal(await userHasPremiumAccess("rider-1", allowedUserEnv), true);
assert.equal(await userHasPremiumAccess("rider-3", allowedUserEnv), false);
assert.equal(await userHasPremiumAccess("someone", inviteEnv, { inviteToken: "local-token" }), true);
assert.equal(await userHasPremiumAccess("someone", { INVITE_ONLY: "true", TRACK_AGENT_INVITE_TOKEN: " local-token " }, { inviteToken: " local-token " }), true);
assert.equal(await userHasPremiumAccess("someone", inviteEnv, { inviteToken: "wrong-token" }), false);
assert.equal(await userHasPremiumAccess("anonymous", { INVITE_ONLY: "false" }), false);
assert.equal(await userHasPremiumAccess("anonymous", { INVITE_ONLY: "false", TRACK_AGENT_ALLOW_OPEN_ACCESS: "true" }), true);

const denied = await requireTrackAgentAccess(new Request("https://agent.mototrack.app/track-agent"), denyEnv);
assert.equal(denied.allowed, false);
assert.equal(denied.response.status, 403);

const publicLanding = await worker.fetch(new Request("https://agent.mototrack.app/"), denyEnv);
assert.equal(publicLanding.status, 200);
assert.equal((await publicLanding.text()).includes("Track Agent Pro"), true);

const publicInvite = await worker.fetch(new Request("https://agent.mototrack.app/request-invite"), denyEnv);
assert.equal(publicInvite.status, 200);
assert.equal((await publicInvite.text()).includes("Request Invite"), true);

const invalidInvite = await requireTrackAgentAccess(
  new Request("https://agent.mototrack.app/track-agent?invite_token=wrong-token"),
  inviteEnv,
);
assert.equal(invalidInvite.allowed, false);
assert.equal(invalidInvite.response.status, 403);

const validInvite = await requireTrackAgentAccess(
  new Request("https://agent.mototrack.app/track-agent?invite_token=local-token"),
  inviteEnv,
);
assert.equal(validInvite.allowed, true);
assert.equal(validInvite.userId, "anonymous");
assert.equal(validInvite.cookieHeaders.length, 1);
assert.equal(validInvite.cookieHeaders[0].includes("track_agent_invite_token="), true);
assert.equal(validInvite.cookieHeaders[0].includes("HttpOnly"), true);
assert.equal(validInvite.cookieHeaders[0].includes("Secure"), true);

const allowedUser = await requireTrackAgentAccess(
  new Request("https://agent.mototrack.app/track-agent", { headers: { "x-user-id": "rider-2" } }),
  allowedUserEnv,
);
assert.equal(allowedUser.allowed, true);
assert.equal(allowedUser.userId, "rider-2");

const unauthorizedUi = await worker.fetch(new Request("https://agent.mototrack.app/track-agent"), denyEnv);
assert.equal(unauthorizedUi.status, 403);
assert.equal((await unauthorizedUi.text()).includes("Track Agent access pending"), true);

const unauthorizedScript = await worker.fetch(new Request("https://agent.mototrack.app/track-agent/ui.js"), denyEnv);
assert.equal(unauthorizedScript.status, 403);
assert.equal(unauthorizedScript.headers.get("content-type").includes("application/json"), true);

const authorizedInviteUi = await worker.fetch(
  new Request("https://agent.mototrack.app/track-agent?invite_token=local-token"),
  inviteEnv,
);
assert.equal(authorizedInviteUi.status, 302);
assert.equal(authorizedInviteUi.headers.get("location"), "/track-agent");
assertSetCookieHasSecurity(authorizedInviteUi, "track_agent_invite_token");
const inviteCookie = cookieValue(authorizedInviteUi, "track_agent_invite_token");
assert.equal(inviteCookie != null, true);

const authorizedScriptByCookie = await worker.fetch(
  new Request("https://agent.mototrack.app/track-agent/ui.js", {
    headers: { cookie: inviteCookie },
  }),
  inviteEnv,
);
assert.equal(authorizedScriptByCookie.status, 200);
assert.equal(authorizedScriptByCookie.headers.get("content-type").includes("text/javascript"), true);

const authorizedParse = await worker.fetch(
  new Request("https://agent.mototrack.app/track-agent/parse", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: inviteCookie,
    },
    body: JSON.stringify({
      raw_note: "At Road Atlanta session 2 on Ninja 400 best 97.4 front hot 31 rear hot 27",
    }),
  }),
  inviteEnv,
);
assert.equal(authorizedParse.status, 200);
const parsed = await authorizedParse.json();
assert.equal(parsed.parsed.source, "mock_parser");
assert.equal(parsed.parsed.entry.track_name, "Road Atlanta");

const encodedInviteUi = await worker.fetch(
  new Request(`https://agent.mototrack.app/track-agent?invite_token=${encodeURIComponent(encodedInviteToken)}`),
  encodedInviteEnv,
);
assert.equal(encodedInviteUi.status, 302);
assert.equal(encodedInviteUi.headers.get("location"), "/track-agent");
assert.equal(encodedInviteUi.headers.get("location").includes("invite_token"), false);
assertSetCookieHasSecurity(encodedInviteUi, "track_agent_invite_token");
assert.equal((await encodedInviteUi.text()).includes(encodedInviteToken), false);
const encodedInviteCookie = cookieValue(encodedInviteUi, "track_agent_invite_token");
assert.equal(encodedInviteCookie != null, true);

const encodedUiByCookie = await worker.fetch(
  new Request("https://agent.mototrack.app/track-agent", {
    headers: { cookie: encodedInviteCookie },
  }),
  encodedInviteEnv,
);
assert.equal(encodedUiByCookie.status, 200);

const encodedScriptByCookie = await worker.fetch(
  new Request("https://agent.mototrack.app/track-agent/ui.js", {
    headers: { cookie: encodedInviteCookie },
  }),
  encodedInviteEnv,
);
assert.equal(encodedScriptByCookie.status, 200);

const encodedParseByCookie = await worker.fetch(
  new Request("https://agent.mototrack.app/track-agent/parse", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: encodedInviteCookie,
    },
    body: JSON.stringify({
      raw_note: "Road Atlanta session 2 best 97.4 front hot 31 rear hot 27",
    }),
  }),
  encodedInviteEnv,
);
assert.equal(encodedParseByCookie.status, 200);

const unauthorizedParse = await worker.fetch(
  new Request("https://agent.mototrack.app/track-agent/parse", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ raw_note: "At Road Atlanta session 2" }),
  }),
  { ...denyEnv, TRACK_AGENT_AI_PROVIDER: "ai_json" },
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

const unauthorizedSessions = await worker.fetch(new Request("https://agent.mototrack.app/track-agent/sessions"), denyEnv);
assert.equal(unauthorizedSessions.status, 403);

const unauthorizedSessionRead = await worker.fetch(new Request("https://agent.mototrack.app/track-agent/session/tas_test"), denyEnv);
assert.equal(unauthorizedSessionRead.status, 403);

const unauthorizedSummary = await worker.fetch(new Request("https://agent.mototrack.app/track-agent/summary/tas_test"), denyEnv);
assert.equal(unauthorizedSummary.status, 403);

const authorizedDevUi = await worker.fetch(
  new Request("https://agent.mototrack.app/track-agent?user_id=dev-rider"),
  devEnv,
);
assert.equal(authorizedDevUi.status, 302);
assert.equal(authorizedDevUi.headers.get("location"), "/track-agent");
assertSetCookieHasSecurity(authorizedDevUi, "track_agent_user_id");

console.log("access-control.test.js passed");
