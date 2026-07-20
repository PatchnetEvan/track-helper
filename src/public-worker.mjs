const BETA_REQUEST_PATH = "/api/panamsbk-request";
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const REQUEST_FIELDS = [
  "first_name",
  "last_name",
  "email",
  "race_number",
  "primary_motorcycle",
  "primary_classes",
  "mobile",
  "next_event",
  "current_process",
  "desired_help",
];
const REQUIRED_FIELDS = new Set([
  "first_name",
  "last_name",
  "email",
  "race_number",
  "primary_motorcycle",
  "primary_classes",
]);
const MAX_LENGTHS = {
  first_name: 100,
  last_name: 100,
  email: 254,
  race_number: 20,
  primary_motorcycle: 100,
  primary_classes: 150,
  mobile: 50,
  next_event: 150,
  current_process: 1000,
  desired_help: 1000,
};

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
    },
  });
}

function invalidRequest() {
  return jsonResponse({ error: "invalid_request", message: "Request could not be accepted." }, 400);
}

function cleanText(value, maxLength) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length <= maxLength ? text : null;
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;

  const request = {};
  for (const field of REQUEST_FIELDS) {
    const value = cleanText(payload[field] ?? "", MAX_LENGTHS[field]);
    if (value === null || (REQUIRED_FIELDS.has(field) && !value)) return null;
    request[field] = value;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(request.email)) return null;
  if (payload.eligibility_confirmed !== true || payload.beta_acknowledged !== true || payload.privacy_acknowledged !== true) return null;

  const turnstileToken = cleanText(payload.turnstile_token, 4096);
  if (!turnstileToken) return null;
  return { request, turnstileToken };
}

function formatEmail(request) {
  const lines = [
    "PanAmSBK private beta request",
    "",
    `Name: ${request.first_name} ${request.last_name}`,
    `Email: ${request.email}`,
    `Race number: ${request.race_number}`,
    `Primary motorcycle: ${request.primary_motorcycle}`,
    `Primary class or classes: ${request.primary_classes}`,
  ];

  if (request.mobile) lines.push(`Mobile number: ${request.mobile}`);
  if (request.next_event) lines.push(`Next PanAmSBK event: ${request.next_event}`);
  if (request.current_process) lines.push(`Current session-recording process: ${request.current_process}`);
  if (request.desired_help) lines.push(`MotoTrack organization interest: ${request.desired_help}`);
  lines.push("", "Acknowledgments: eligibility, beta boundaries, and request-review privacy confirmed.");
  return lines.join("\n");
}

async function verifyTurnstile(token, request, secret) {
  const body = new FormData();
  body.set("secret", secret);
  body.set("response", token);
  const remoteIp = request.headers.get("CF-Connecting-IP");
  if (remoteIp) body.set("remoteip", remoteIp);

  const response = await fetch(TURNSTILE_VERIFY_URL, { method: "POST", body });
  if (!response.ok) return false;
  const result = await response.json().catch(() => null);
  return result?.success === true
    && result.hostname === "mototrack.app"
    && result.action === "panamsbk-beta-request";
}

async function handleBetaRequest(request, env) {
  if (request.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) return invalidRequest();

  const payload = await request.json().catch(() => null);
  const validated = validatePayload(payload);
  if (!validated || !env.TURNSTILE_SECRET_KEY || !env.BETA_REQUEST_EMAIL) return invalidRequest();

  let verified = false;
  try {
    verified = await verifyTurnstile(validated.turnstileToken, request, env.TURNSTILE_SECRET_KEY);
  } catch {
    return jsonResponse({ error: "verification_unavailable", message: "Verification is temporarily unavailable. Please try again shortly." }, 503);
  }
  if (!verified) return jsonResponse({ error: "verification_failed", message: "Verification could not be completed. Please try again." }, 400);

  try {
    await env.BETA_REQUEST_EMAIL.send({
      from: { email: "beta@mototrack.app", name: "MotoTrack Beta" },
      subject: "PanAmSBK private beta request",
      text: formatEmail(validated.request),
      replyTo: validated.request.email,
    });
  } catch {
    return jsonResponse({ error: "delivery_unavailable", message: "Request delivery is temporarily unavailable. Please try again shortly." }, 503);
  }

  return jsonResponse({ ok: true, message: "Your request has been received. We will review it and contact you if space is available." }, 200);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === BETA_REQUEST_PATH) return handleBetaRequest(request, env);
    return env.ASSETS.fetch(request);
  },
};

export { BETA_REQUEST_PATH, formatEmail, handleBetaRequest, validatePayload };
