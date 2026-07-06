# Track Agent AI Usage Controls Proposal

Track Agent Pro should stay mock-only until access, scope, and usage controls are ready. This document separates AI behavior by feature mode so recommendations are not forbidden forever, but are only allowed in approved, bounded advisor flows.

This document does not introduce a D1 migration and does not enable live AI.

## Product Modes

### Session Extractor

Accepted purpose:

```text
Extract rider notes into structured Track Agent review fields.
```

Accepted categories:

- Session details.
- Lap times.
- Tire pressures.
- Setup changes already performed.
- Rider handling notes.
- Warnings.
- Confidence.

Forbidden in Session Extractor:

- Recommendations.
- Coaching advice.
- Setup advice.
- Tire-pressure advice.
- Safety-critical decisions.
- Medical information.
- Payment, banking, billing, or account-number details.
- Personal identification details.
- Emergency contact details.
- Unrelated personal notes.
- General chatbot questions.

Output:

- Canonical Track Agent review payload only.
- Provider output must be `confirmed:false`.
- Save still requires `confirmed:true`.
- AI output is never saved automatically.

### Tire Pressure Advisor

Tire Pressure Advisor is a future premium feature and must be a separate mode from Session Extractor.

Accepted purpose:

```text
Provide bounded tire-pressure adjustment suggestions from structured rider/session inputs.
```

The advisor may provide small, reviewable pressure-adjustment suggestions only after required inputs are provided. It must be framed as decision support, not as certainty or instruction.

Advisor guardrails:

- Ask for missing critical information instead of guessing.
- Do not invent manufacturer, tire vendor, or compound-specific target pressures.
- Do not suggest large pressure jumps.
- Do not claim "this is correct" or "this will fix it."
- Do not override tire vendor, coach, mechanic, or track safety guidance.
- Do not recommend riding harder, ignoring symptoms, or bypassing safety checks.
- Do not provide medical, legal, financial, unrelated, or chatbot-style advice.
- Use structured JSON output and server-side validation.
- AI should not be the sole decision-maker; rule constraints must bound recommendations.

## Current Safety Position

- `TRACK_AGENT_AI_PROVIDER` remains unset by default.
- Mock parsing remains the default path.
- Invite access is currently a shared prototype token.
- Session Extractor parse output remains review-before-save.
- Live AI must not be enabled until invite/account access, scope, and usage controls are approved.
- Cloudflare Workers AI remains the first live AI provider target.
- OpenAI remains deferred for later comparison.

## Lightweight Usage Limits

Immediate no-schema controls:

- Enforce max raw note length before provider calls.
- Reject direct advice/chatbot/sensitive prompts before provider calls.
- Keep provider output schema validation.
- Keep review-before-save.

Future D1-backed controls are needed for per-invite parse limits and revocation.

## Proposed Invite Table

Create a D1 table for invite records when per-tester management is needed:

```text
track_agent_invites
```

Suggested fields:

- `id`
- `invite_label`
- `token_hash`
- `status`
- `created_at`
- `expires_at`
- `revoked_at`
- `last_used_at`
- `daily_parse_limit`
- `notes`

Store only a token hash. Never store the raw invite token.

## Proposed Usage Counter Table

Create a D1 table for daily parse counters:

```text
track_agent_usage_counters
```

Suggested fields:

- `id`
- `invite_id`
- `usage_date`
- `parse_attempts`
- `parse_successes`
- `parse_rejections`
- `last_attempt_at`
- `feature_mode`

Counters should increment without storing the full raw note.

## Daily Parse Limit

Start with a conservative daily parse limit for invited testers. The exact number can change after real tester behavior is observed.

When the limit is exceeded:

- Return a clear `429` error.
- Do not call the AI provider.
- Do not save anything.
- Do not log the raw note.

## Revocation

Revocation should happen by invite record:

- Set `status=revoked`.
- Set `revoked_at`.
- Reject future parse/save/read access for that invite.

For the current shared-token prototype, rotating `TRACK_AGENT_INVITE_TOKEN` still revokes all token-based access. Per-rider revocation requires invite records or trusted identity.

## Audit Fields

If audit records are added, keep them minimal:

- `event_type`
- `feature_mode`
- `invite_id`
- `user_id` when trusted identity exists
- `status`
- `error_code`
- `created_at`
- `request_id` if available
- `provider` such as `mock_parser` or `ai_json`

Do not log:

- Raw invite tokens.
- Full raw notes.
- Medical, payment, personal identification, emergency contact, or unrelated private content.

## Planned Tests

- Session Extractor rejects direct advice questions.
- Session Extractor rejects sensitive/private/payment/account content.
- Session Extractor rejects unrelated chatbot prompts.
- Session Extractor output validates against the canonical review schema.
- Session Extractor provider output remains `confirmed:false`.
- Save still requires `confirmed:true`.
- Tire Pressure Advisor accepts a complete tire-pressure scenario.
- Tire Pressure Advisor returns `needs_more_info` when target hot PSI is missing.
- Tire Pressure Advisor refuses to invent tire vendor targets.
- Tire Pressure Advisor refuses unrelated prompts.
- Tire Pressure Advisor rejects payment, banking, billing, or account-number data.
- Tire Pressure Advisor does not output coaching language.
- Tire Pressure Advisor output validates against its proposed schema.
- AI remains disabled by default.
- Mock remains default.

## Recommended Build Order

1. Keep Session Extractor scope enforcement.
2. Add invite registry with token hashes.
3. Add daily parse counters by feature mode.
4. Add revocation by invite.
5. Add audit events without raw notes or tokens.
6. Implement Tire Pressure Advisor schema and rule bounds.
7. Add Tire Pressure Advisor mock/rule tests.
8. Enable `ai_json` for one trusted tester group only after approval.

## No Migration Yet

This proposal intentionally avoids a D1 migration in the current phase. Add the migration only when the invite registry, usage-counter schema, and advisor mode are approved.
