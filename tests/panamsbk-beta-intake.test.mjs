import assert from "node:assert/strict";
import test from "node:test";
import worker, { handleBetaRequest } from "../src/public-worker.mjs";

const validPayload = {
  first_name: "Taylor",
  last_name: "Rider",
  email: "taylor@example.test",
  race_number: "07",
  primary_motorcycle: "Yamaha R3",
  primary_classes: "Amateur Lightweight",
  mobile: "",
  next_event: "",
  current_process: "Paper notes",
  desired_help: "Session history",
  eligibility_confirmed: true,
  beta_acknowledged: true,
  privacy_acknowledged: true,
  turnstile_token: "test-turnstile-token",
};

function post(body, contentType = "application/json") {
  return new Request("https://mototrack.app/api/panamsbk-request", {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function environment(send = async () => {}) {
  return {
    TURNSTILE_SECRET_KEY: "test-secret",
    BETA_REQUEST_EMAIL: { send },
  };
}

test("malformed beta-request JSON is rejected without verification or email", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("should not be reached");
  };

  try {
    const response = await handleBetaRequest(post("{invalid"), environment());
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid_request", message: "Request could not be accepted." });
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("failed Turnstile verification does not send email", async () => {
  const originalFetch = globalThis.fetch;
  let emailSent = false;
  globalThis.fetch = async () => new Response(JSON.stringify({ success: false, hostname: "mototrack.app", action: "panamsbk-beta-request" }), { status: 200 });

  try {
    const response = await handleBetaRequest(post(validPayload), environment(async () => { emailSent = true; }));
    assert.equal(response.status, 400);
    assert.equal(emailSent, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("verified request sends a plain-text manual-review email", async () => {
  const originalFetch = globalThis.fetch;
  let sentMessage;
  globalThis.fetch = async () => new Response(JSON.stringify({ success: true, hostname: "mototrack.app", action: "panamsbk-beta-request" }), { status: 200 });

  try {
    const response = await handleBetaRequest(post(validPayload), environment(async (message) => { sentMessage = message; }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).ok, true);
    assert.equal(sentMessage.from.email, "beta@mototrack.app");
    assert.equal(sentMessage.replyTo, "taylor@example.test");
    assert.match(sentMessage.text, /Race number: 07/);
    assert.match(sentMessage.text, /Acknowledgments: eligibility/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ordinary public routes remain static-asset requests", async () => {
  const expected = new Response("static page", { status: 200 });
  const response = await worker.fetch(new Request("https://mototrack.app/panamsbk"), {
    ASSETS: { fetch: async () => expected },
  });
  assert.equal(response, expected);
});
