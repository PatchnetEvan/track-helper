import { mockParserProvider } from "./mock-parser-provider.js";
import { stubAiProvider } from "./stub-ai-provider.js";

const PROVIDERS = {
  mock: mockParserProvider,
  stub_ai: stubAiProvider,
};

export function getTrackAgentParserProvider(env = {}) {
  const requested = String(env.TRACK_AGENT_AI_PROVIDER || "mock").trim().toLowerCase();
  return PROVIDERS[requested] || mockParserProvider;
}
