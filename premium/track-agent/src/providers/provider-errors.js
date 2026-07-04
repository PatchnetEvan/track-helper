export class TrackAgentProviderError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "TrackAgentProviderError";
    this.code = code;
    this.provider = options.provider || null;
    this.status = options.status || 503;
  }
}

export const TRACK_AGENT_PROVIDER_ERROR_CODES = {
  PROVIDER_NOT_CONFIGURED: "provider_not_configured",
  PROVIDER_TIMEOUT: "provider_timeout",
  PROVIDER_INVALID_JSON: "provider_invalid_json",
  PROVIDER_SCHEMA_VALIDATION_FAILED: "provider_schema_validation_failed",
};
