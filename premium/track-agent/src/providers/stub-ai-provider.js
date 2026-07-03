import { mockParserProvider } from "./mock-parser-provider.js";

export const stubAiProvider = {
  name: "stub_ai",

  parseRawTrackNote(rawNote, context = {}) {
    const payload = mockParserProvider.parseRawTrackNote(rawNote, context);
    return {
      ...payload,
      source: "stub_ai",
      warnings: [
        ...payload.warnings,
        "stub_ai provider selected; no external AI call was made.",
      ],
      confidence: {
        ...payload.confidence,
        fields: {
          ...payload.confidence.fields,
          provider: "stub_ai_no_external_call",
        },
      },
    };
  },
};
