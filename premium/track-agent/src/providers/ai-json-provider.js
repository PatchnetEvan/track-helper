import {
  TRACK_AGENT_PROVIDER_ERROR_CODES,
  TrackAgentProviderError,
} from "./provider-errors.js";
import {
  TRACK_AGENT_REVIEW_PAYLOAD_JSON_SCHEMA,
  validateTrackAgentReviewPayload,
} from "../schemas/track-agent-review.schema.js";

function numberConfig(env, key) {
  const value = Number(env[key]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function providerError(code, message, status) {
  return new TrackAgentProviderError(code, message, {
    provider: "ai_json",
    status,
  });
}

function requireAiConfig(env = {}) {
  const model = env.TRACK_AGENT_AI_MODEL;
  const timeoutMs = numberConfig(env, "TRACK_AGENT_AI_TIMEOUT_MS");
  const maxInputChars = numberConfig(env, "TRACK_AGENT_AI_MAX_INPUT_CHARS");
  const maxOutputTokens = numberConfig(env, "TRACK_AGENT_AI_MAX_OUTPUT_TOKENS");

  if (!env.AI || typeof env.AI.run !== "function") {
    throw providerError(
      TRACK_AGENT_PROVIDER_ERROR_CODES.PROVIDER_NOT_CONFIGURED,
      "Track Agent ai_json provider requires the Cloudflare Workers AI binding env.AI.",
      503,
    );
  }

  if (!model || !timeoutMs || !maxInputChars || !maxOutputTokens) {
    throw providerError(
      TRACK_AGENT_PROVIDER_ERROR_CODES.PROVIDER_NOT_CONFIGURED,
      "Track Agent ai_json provider requires TRACK_AGENT_AI_MODEL, TRACK_AGENT_AI_TIMEOUT_MS, TRACK_AGENT_AI_MAX_INPUT_CHARS, and TRACK_AGENT_AI_MAX_OUTPUT_TOKENS.",
      503,
    );
  }

  return { model, timeoutMs, maxInputChars, maxOutputTokens };
}

function buildSystemPrompt() {
  return [
    "You extract structured motorcycle track-session logging data only.",
    "Return strict JSON matching the Track Agent canonical reviewed payload shape.",
    "Do not provide coaching, setup recommendations, safety advice, or interpretation.",
    "Do not invent missing data.",
    "If uncertain, use null and add a warning.",
    "Only structure what the rider said.",
    "Set confirmed to false and source to ai_json.",
    "Use empty arrays for missing lap_times, tire_pressures, setup_changes, and notes.",
  ].join(" ");
}

function buildUserPrompt(rawNote, context) {
  return JSON.stringify({
    raw_note: rawNote,
    context,
    canonical_schema_instruction: "Return exactly the canonical Track Agent reviewed payload. Unknown scalar fields must be null. Missing child rows must be empty arrays. Do not include any extra fields.",
  });
}

function parseAiResponse(response) {
  const candidate = response && typeof response === "object" && "response" in response
    ? response.response
    : response;

  if (candidate && typeof candidate === "object") return candidate;
  if (typeof candidate !== "string") {
    throw providerError(
      TRACK_AGENT_PROVIDER_ERROR_CODES.PROVIDER_INVALID_JSON,
      "Cloudflare AI response did not contain JSON.",
      502,
    );
  }

  try {
    return JSON.parse(candidate);
  } catch (error) {
    throw providerError(
      TRACK_AGENT_PROVIDER_ERROR_CODES.PROVIDER_INVALID_JSON,
      "Cloudflare AI response could not be parsed as JSON.",
      502,
    );
  }
}

function validateAiPayloadContract(payload, rawNote) {
  const errors = [];
  if (payload.confirmed !== false) errors.push("confirmed must be false for AI parse drafts.");
  if (payload.source !== "ai_json") errors.push("source must be ai_json.");
  if (!payload.entry || payload.entry.raw_note !== rawNote) errors.push("entry.raw_note must match the submitted raw note.");

  const validation = validateTrackAgentReviewPayload(payload);
  errors.push(...validation.errors);

  if (errors.length) {
    throw providerError(
      TRACK_AGENT_PROVIDER_ERROR_CODES.PROVIDER_SCHEMA_VALIDATION_FAILED,
      `Cloudflare AI output failed Track Agent schema validation: ${errors.join("; ")}`,
      502,
    );
  }
}

async function runWithTimeout(aiRunPromise, timeoutMs) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(providerError(
        TRACK_AGENT_PROVIDER_ERROR_CODES.PROVIDER_TIMEOUT,
        "Cloudflare AI parsing timed out.",
        504,
      ));
    }, timeoutMs);
  });

  try {
    return await Promise.race([aiRunPromise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
}

export const aiJsonProvider = {
  name: "ai_json",

  async parseRawTrackNote(rawNote, context = {}, env = {}) {
    const note = String(rawNote || "").trim();
    const { model, timeoutMs, maxInputChars, maxOutputTokens } = requireAiConfig(env);

    if (note.length > maxInputChars) {
      throw providerError(
        TRACK_AGENT_PROVIDER_ERROR_CODES.PROVIDER_SCHEMA_VALIDATION_FAILED,
        `Raw note exceeds TRACK_AGENT_AI_MAX_INPUT_CHARS (${maxInputChars}). AI was not called.`,
        400,
      );
    }

    const response = await runWithTimeout(
      env.AI.run(model, {
        messages: [
          { role: "system", content: buildSystemPrompt() },
          { role: "user", content: buildUserPrompt(note, context) },
        ],
        max_tokens: maxOutputTokens,
        temperature: 0.1,
        response_format: {
          type: "json_schema",
          json_schema: TRACK_AGENT_REVIEW_PAYLOAD_JSON_SCHEMA,
        },
      }),
      timeoutMs,
    );

    const parsed = parseAiResponse(response);
    validateAiPayloadContract(parsed, note);
    return parsed;
  },
};
