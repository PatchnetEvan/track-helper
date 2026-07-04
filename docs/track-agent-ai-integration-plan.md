# Track Agent AI integration

Phase 6B wires live Cloudflare Workers AI through the existing `ai_json`
provider only. The mock provider remains the default unless
`TRACK_AGENT_AI_PROVIDER=ai_json` is explicitly configured.

## Approved provider and model

- Provider: Cloudflare Workers AI
- Binding: `AI`
- Starting model: `@cf/meta/llama-3.1-8b-instruct-fast`

Worker config includes:

```jsonc
"ai": {
  "binding": "AI"
}
```

Required runtime config:

- `TRACK_AGENT_AI_PROVIDER=ai_json`
- `TRACK_AGENT_AI_MODEL=@cf/meta/llama-3.1-8b-instruct-fast`
- `TRACK_AGENT_AI_TIMEOUT_MS=8000`
- `TRACK_AGENT_AI_MAX_INPUT_CHARS=4000`
- `TRACK_AGENT_AI_MAX_OUTPUT_TOKENS=1200`

## Scope

AI is extraction-only. It may structure what the rider wrote, but it must not
provide coaching, setup recommendations, safety advice, or interpretation. It
must not invent missing data.

The provider prompt instructs the model to return:

- `confirmed: false`
- `source: "ai_json"`
- canonical Track Agent reviewed payload fields only
- `null` for unknown scalar fields
- empty arrays for missing child rows
- warnings for ambiguity or missing important fields

## JSON Mode and validation

The provider uses Cloudflare Workers AI JSON Mode via `response_format` with the
canonical Track Agent JSON Schema. The provider parses the model response as
JSON and rejects:

- non-JSON responses
- extra fields
- `confirmed: true`
- wrong source
- changed raw note text
- payloads that fail Track Agent schema validation

The validation path remains:

```text
access guard
-> ai_json provider
-> Cloudflare AI JSON Mode
-> JSON parse
-> raw provider payload validation
-> normalization
-> canonical validation
-> review UI
-> user edits
-> confirmed save
-> final validation
-> D1 persistence
```

## Error behavior

The parse endpoint returns structured JSON and never saves failed AI output:

- `provider_not_configured`: missing `env.AI`, model, timeout, input limit, or
  output limit
- `provider_timeout`: AI parsing exceeds `TRACK_AGENT_AI_TIMEOUT_MS`
- `provider_invalid_json`: response cannot be parsed as JSON
- `provider_schema_validation_failed`: response fails canonical schema checks or
  input exceeds `TRACK_AGENT_AI_MAX_INPUT_CHARS`

## Privacy notice

The Track Agent UI displays:

> Track Agent uses AI to convert your session notes into structured review fields. AI output is not saved automatically. You must review and confirm before anything is stored. Do not enter sensitive personal information, medical information, financial information, or anything unrelated to your track session.

## No auto-save rule

AI output is never persisted directly. The rider must review and confirm the
canonical payload before `POST /track-agent/save` writes to D1.

## Separation guarantee

This integration is isolated to `premium/track-agent/`. The free MotoTrack Log
app remains local-first and account-free.
