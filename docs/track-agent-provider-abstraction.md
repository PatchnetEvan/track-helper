# Track Agent provider abstraction

Track Agent parsing is behind a small provider boundary so premium parsing can
evolve without changing the review UI, D1 schema, or save/read persistence
logic.

## Provider contract

Providers implement:

```js
parseRawTrackNote(rawNote, context)
```

The function returns the canonical reviewed payload draft documented in
`docs/track-agent-review-payload.md`. Parser output is only a draft. It must
always be shown to the rider for review and saved only after the request sends
`confirmed: true`.

## Current providers

- `mock`: default deterministic parser. This is the current rule-based behavior
  moved behind the provider boundary.
- `stub_ai`: implements the same interface but does not call any external AI
  service. It delegates to the mock parser and adds a warning that no external
  AI call was made.
- `ai_json`: opt-in Cloudflare Workers AI JSON Mode provider. It is only used
  when `TRACK_AGENT_AI_PROVIDER=ai_json` is configured.

## Provider selection

The Worker chooses a provider with `getTrackAgentParserProvider(env)`.

- `TRACK_AGENT_AI_PROVIDER` unset: `mock`
- `TRACK_AGENT_AI_PROVIDER=mock`: `mock`
- `TRACK_AGENT_AI_PROVIDER=stub_ai`: `stub_ai`
- `TRACK_AGENT_AI_PROVIDER=ai_json`: disabled future AI provider scaffold
- Any other value: safely falls back to `mock`

## Canonical enforcement & normalization rules

The canonical reviewed payload is the single source of truth for Track Agent
after parsing. Providers must return that shape, and the service layer always
passes provider output through `normalizeReviewedTrackAgentPayload()` before it
leaves `parseTrackSessionNote()`.

Validation is the final gate:

- Provider draft: provider -> normalize -> `validateTrackAgentReviewPayload()`
- Confirmed save: request payload -> normalize -> `validateTrackAgentReviewPayload({ requireConfirmed: true })` -> D1

`normalizeReviewedTrackAgentPayload()` is the only boundary that accepts legacy,
partial, or provider-specific payloads. UI and persistence code should consume
canonical fields only. Parser output may have `confirmed: false`, but persistence
requires the reviewed request to send `confirmed: true`.

## AI wiring

Cloudflare Workers AI is wired only inside `ai_json`. The default parser remains
`mock`, and invalid provider names still fall back to `mock`. AI output must
pass the same canonical validation gates and still requires review before save.

## Future path

A future provider can call another approved AI service from inside the same
contract. It should return strict canonical JSON, include warnings and
confidence, and preserve the same review-before-save rule. The D1 persistence
functions should not need to know which parser provider made the draft.
