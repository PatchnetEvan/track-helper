# Track Agent AI integration plan

Phase 6A adds the AI adapter scaffold only. Live AI parsing is intentionally not
enabled yet.

## Current behavior

`TRACK_AGENT_AI_PROVIDER=ai_json` selects the future JSON AI provider, but the
provider throws `provider_not_configured` and makes no external call. This is
deliberate: accidental enabling should fail loudly before any rider note leaves
the Worker.

The default remains:

```text
TRACK_AGENT_AI_PROVIDER unset -> mock
```

## Future configuration contract

Before Phase 6B can enable live AI, the Worker needs explicit configuration for
the chosen provider:

- `TRACK_AGENT_AI_PROVIDER=ai_json`
- `TRACK_AGENT_AI_MODEL`
- `TRACK_AGENT_AI_TIMEOUT_MS`
- `TRACK_AGENT_AI_MAX_INPUT_CHARS`
- `TRACK_AGENT_AI_MAX_OUTPUT_TOKENS`
- Cloudflare AI binding or an external provider key/binding

No secrets or provider bindings are required or used in Phase 6A.

## Error behavior

AI provider failures should use structured error codes:

- `provider_not_configured`
- `provider_timeout`
- `provider_invalid_json`
- `provider_schema_validation_failed`

The parse endpoint should return a clear JSON error and must not save anything
when a provider fails.

## JSON-only output

Live AI responses must be strict JSON only. The response must map to the
canonical Track Agent reviewed payload shape before it can leave the provider
boundary.

The validation path remains:

```text
provider output
-> raw validation
-> normalization
-> canonical validation
-> review UI
-> confirmed save
-> final validation
-> D1
```

## Privacy and product requirements

Before live AI is wired, MotoTrack needs approved privacy copy explaining what
data is sent to the AI provider, when it is sent, and how review-before-save
works. The UI should make it clear that parsed output is a draft.

Invitation-only gating must remain enabled before AI is exposed. The free
MotoTrack Log app stays local-first and account-free.

## No auto-save rule

AI output must never be persisted directly. The rider must review and confirm
the canonical payload before `POST /track-agent/save` writes to D1.
