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

## Provider selection

The Worker chooses a provider with `getTrackAgentParserProvider(env)`.

- `TRACK_AGENT_AI_PROVIDER` unset: `mock`
- `TRACK_AGENT_AI_PROVIDER=mock`: `mock`
- `TRACK_AGENT_AI_PROVIDER=stub_ai`: `stub_ai`
- Any other value: safely falls back to `mock`

## Why real AI is not wired yet

Phase 4 only proves the adapter boundary. It intentionally avoids Cloudflare AI,
OpenAI, secrets, credentials, and external network calls. That keeps the
known-good Phase 3.5 vertical slice deterministic while the future provider
surface is introduced.

## Future path

A future provider can call Cloudflare AI or another approved AI service from
inside the same contract. That provider should return strict canonical JSON,
include warnings and confidence, and preserve the same review-before-save rule.
The D1 persistence functions should not need to know which parser provider made
the draft.
