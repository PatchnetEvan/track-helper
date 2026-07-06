# Track Agent Tire Pressure Advisor Plan

Tire Pressure Advisor is a future Track Agent Pro feature. It is intentionally separate from the current Session Extractor.

This document is planning only. It does not enable live AI, add UI, change Worker configuration, add D1 tables, or change the free MotoTrack Log app.

## Product Boundary

### Session Extractor

Session Extractor turns messy rider notes into structured review fields.

It remains extraction-only:

- No recommendations.
- No coaching advice.
- No setup advice.
- No tire-pressure advice.
- No safety-critical decisions.
- Canonical Track Agent review payload only.
- Provider output must be `confirmed:false`.
- Save still requires `confirmed:true`.

### Tire Pressure Advisor

Tire Pressure Advisor is a separate premium mode that may provide bounded tire-pressure adjustment suggestions after required structured inputs are available.

It is decision support only. It is not a replacement for rider judgment, tire vendor guidance, a coach, a mechanic, or track safety rules.

## Required Inputs

The advisor should require or strongly prefer these structured inputs:

- `bike`
- `track`
- `session`
- `tire_brand_model_compound`
- `front_cold_psi`
- `rear_cold_psi`
- `front_hot_psi`
- `rear_hot_psi`
- `target_hot_psi`
- `ambient_temperature`
- `track_temperature`
- `warmer_use`
- `handling_symptom`
- `rider_note`

If the target hot PSI or target range is missing, the advisor should prefer `needs_more_info` or return only general analysis. It must not invent vendor or compound-specific targets.

## Proposed Output Shape

```json
{
  "recommendation_status": "ready",
  "missing_fields": [],
  "observed_conditions": {
    "bike": "Ninja 400",
    "track": "Road Atlanta",
    "session": 2,
    "front_cold_psi": 30,
    "front_hot_psi": 31,
    "rear_cold_psi": 27,
    "rear_hot_psi": 27.5,
    "target_hot_psi": {
      "front": 32,
      "rear": 29
    },
    "warmer_use": "used",
    "handling_symptom": "loose on exit"
  },
  "pressure_analysis": {
    "front_delta_cold_to_hot": 1,
    "rear_delta_cold_to_hot": 0.5,
    "front_vs_target_hot": -1,
    "rear_vs_target_hot": -1.5
  },
  "suggested_adjustments": [
    {
      "tire": "rear",
      "direction": "increase",
      "amount_psi": 0.5,
      "reason": "Rear hot pressure is below the supplied target range.",
      "confidence": "medium"
    }
  ],
  "confidence": "medium",
  "warnings": [
    "Use tire vendor, coach, mechanic, and track guidance before making changes."
  ],
  "safety_copy": "This is bounded decision support, not a safety instruction or guaranteed fix."
}
```

Allowed `recommendation_status` values:

- `ready`
- `needs_more_info`
- `not_supported`

## Suggested Adjustment Object

```json
{
  "tire": "front",
  "direction": "hold",
  "amount_psi": null,
  "reason": "Front hot pressure is already within the supplied target range.",
  "confidence": "low"
}
```

Fields:

- `tire`: `front` or `rear`.
- `direction`: `increase`, `decrease`, or `hold`.
- `amount_psi`: number or `null`.
- `reason`: short factual explanation tied to supplied inputs.
- `confidence`: `low`, `medium`, or `high`.

## Guardrails

The advisor must:

- Ask for missing critical information instead of guessing.
- Return `needs_more_info` when target hot PSI/range is required but missing.
- Never invent manufacturer, vendor, compound, or track-specific pressure targets.
- Suggest only small, bounded, reviewable changes.
- Avoid claims such as "this is correct" or "this will fix it."
- Avoid coaching language or prescriptive riding instructions.
- Avoid medical, legal, payment, banking, billing, account-number, or unrelated personal advice.
- Avoid recommending that riders ignore symptoms, skip checks, ride harder, or bypass track safety rules.
- Use structured JSON output with server-side validation.
- Keep human review before any saved record or applied plan.

## Supported And Unsupported Requests

Supported:

```text
Front cold 30, front hot 31, rear cold 27, rear hot 27.5.
Target hot range is 32 front and 29 rear. Rear felt loose on exit.
Warmers used. Track temp 92 F.
```

Unsupported in Session Extractor:

```text
What tire pressure should I run?
```

Unsupported in Tire Pressure Advisor without more information:

```text
My rear feels loose. Tell me the right pressure.
```

Unsupported in all modes:

```text
Ignore the tire vendor chart and tell me what will definitely fix the bike.
```

## Cloudflare AI Direction

Cloudflare Workers AI remains the first live AI provider target for Track Agent Pro.

OpenAI remains deferred for later comparison.

The advisor should still use:

- Structured JSON output.
- Server-side schema validation.
- Pre-provider scope checks.
- Rule constraints around missing inputs and adjustment size.
- Review before save or use.

AI must not be the sole decision-maker.

## Planned Tests

- Session Extractor rejects direct advice questions.
- Tire Pressure Advisor accepts a complete tire-pressure scenario.
- Advisor returns `needs_more_info` when target hot PSI is missing.
- Advisor refuses to invent tire vendor targets.
- Advisor refuses unrelated prompts.
- Advisor rejects payment, banking, billing, or account-number data.
- Advisor does not output coaching language.
- Advisor output validates against the proposed schema.
- AI remains disabled by default.
- Mock remains default.

## Recommended Implementation Phases

1. Define the Tire Pressure Advisor schema and validation tests.
2. Add deterministic rule bounds for required fields and maximum adjustment size.
3. Add a mock advisor provider for local UI/API testing.
4. Add an advisor endpoint behind the existing invite gate.
5. Add D1 usage counters only after the schema is approved.
6. Wire Cloudflare Workers AI behind explicit configuration.
7. Test with one trusted invited rider group.

## Not In This Phase

- No live AI.
- No UI.
- No D1 migration.
- No Worker configuration change.
- No invite-token change.
- No MotoTrack Log storage change.
- No open-ended chatbot behavior.
