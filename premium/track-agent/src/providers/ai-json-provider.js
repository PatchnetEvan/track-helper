import {
  TRACK_AGENT_PROVIDER_ERROR_CODES,
  TrackAgentProviderError,
} from "./provider-errors.js";

export const aiJsonProvider = {
  name: "ai_json",

  parseRawTrackNote(rawNote, context = {}) {
    void rawNote;
    void context;
    throw new TrackAgentProviderError(
      TRACK_AGENT_PROVIDER_ERROR_CODES.PROVIDER_NOT_CONFIGURED,
      "Track Agent ai_json provider is scaffolded but not configured. No AI call was made.",
      { provider: "ai_json", status: 503 },
    );
  },
};
