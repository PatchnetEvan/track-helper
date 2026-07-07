# Track Agent Tire Pressure Advisor Scenario Review

This review uses fictional but realistic track-day inputs to check whether the deterministic Tire Pressure Advisor rules are conservative enough before any UI, D1 persistence, or AI provider is added.

The current behavior is rule-bound only. It does not call AI and does not produce model-generated recommendations.

## Review Summary

Overall result: acceptable for the current foundation.

The rules remain conservative:

- Missing targets or incomplete pressure data returns `needs_more_info`.
- Adjustments are capped to 1 PSI by default.
- Inside-range hot pressures return `hold`.
- Advice-style prompts return `not_supported`.
- Missing tire identity, warmer use, or track temperature lowers confidence with warnings.
- Large pressure gaps and conflicting rider symptoms add warnings.

## Scenarios

### 1. Normal Hot Pressures Inside Target Range

Input pattern:

- Front hot PSI inside supplied front target range.
- Rear hot PSI inside supplied rear target range.
- Tire identity, warmer use, and track temperature present.

Expected output:

- `recommendation_status: "ready"`
- Front: `hold`
- Rear: `hold`
- Confidence: `medium`
- Safety copy present.

Review notes:

Acceptable. The rule does not invent a change when the supplied pressure data is already in range.

### 2. Rear Hot Pressure Above Target Range

Input pattern:

- Rear hot PSI: 31
- Rear target range: 28-29

Expected output:

- Rear suggested adjustment direction: `decrease`
- `amount_psi` capped at 1
- No certainty language.

Review notes:

Acceptable. The adjustment is bounded and tied only to supplied target data.

### 3. Rear Hot Pressure Below Target Range

Input pattern:

- Rear hot PSI: 26.5
- Rear target range: 28-29

Expected output:

- Rear suggested adjustment direction: `increase`
- `amount_psi` capped at 1

Review notes:

Acceptable. The rule remains conservative even when the pressure is clearly below target.

### 4. Missing Target Pressure

Input pattern:

- Hot/cold pressure data present.
- Front and rear target hot PSI/range missing.

Expected output:

- `recommendation_status: "needs_more_info"`
- No suggested pressure change.
- `missing_fields` includes front and rear target fields.

Review notes:

Acceptable. The advisor does not invent vendor or manufacturer targets.

### 5. Missing Tire Identity

Input pattern:

- Tire brand, model, and compound missing.
- Pressure and target data present.

Expected output:

- Warning that tire-specific guidance is limited.
- Lower confidence.
- No invented tire target.

Review notes:

Acceptable. The advisor still evaluates supplied pressure-vs-target data, but clearly marks limited tire context.

### 6. Hot Pressures Plus Vague Handling Symptom

Input pattern:

- Rear feels greasy on exit.
- Rear hot PSI below supplied target range.

Expected output:

- Pressure analysis remains tied to pressure-vs-target data.
- Rear suggested adjustment direction: `increase`
- Adjustment capped at 1 PSI.
- No claim that pressure will fix the symptom.

Review notes:

Acceptable. The output does not present the pressure change as a handling cure.

### 7. Conflicting Symptom And Pressure Data

Input pattern:

- Rear hot pressure is already high.
- Rider says rear feels cold/no grip.

Expected output:

- Confidence lowered.
- Warning added.
- Any adjustment remains justified only by supplied pressure-vs-target data.

Review notes:

The initial rule was too clean here, so a warning was added for cold/no-grip symptoms that conflict with pressure data above the supplied target range.

### 8. Large Gap From Target

Input pattern:

- Rear hot PSI: 33
- Rear target range: 28-29

Expected output:

- Rear suggested adjustment direction: `decrease`
- `amount_psi` capped at 1
- Warning to verify gauge accuracy, tire temperature, tire condition, and session context.

Review notes:

Acceptable after adding the far-outside-target warning.

### 9. Warmer Use Unknown

Input pattern:

- Pressure and target data present.
- `warmer_use: "unknown"`

Expected output:

- Warning that pressure interpretation is limited.
- Confidence not high.

Review notes:

Acceptable. Warmers materially affect cold/hot interpretation, so a warning is useful without blocking evaluation.

### 10. Track Temperature Missing

Input pattern:

- Pressure and target data present.
- `track_temp_f` missing.

Expected output:

- Warning that pressure interpretation is limited.
- Confidence not high.

Review notes:

Acceptable. The rule stays bound to supplied target pressure but flags missing context.

### 11. Advice-Style Prompt

Input pattern:

- Rider note asks: "What tire pressure should I run?"

Expected output:

- `recommendation_status: "not_supported"`
- No suggested adjustment.

Review notes:

Acceptable. The advisor requires structured pressure data and is not an open-ended chatbot.

### 12. Incomplete Cold/Hot Pressure Pair

Input pattern:

- One cold/hot pressure value is missing.

Expected output:

- `recommendation_status: "needs_more_info"`
- No suggested adjustment.

Review notes:

Acceptable. The rule does not make a bounded pressure suggestion from incomplete pressure data.

## Recommended Next Rule Review

Before UI or AI, review these decisions with a real track rider or tire vendor:

- Whether the default 1 PSI cap is conservative enough for all tire classes.
- Whether missing warmer use should block recommendations or simply warn.
- Whether missing track temperature should block recommendations for race tires.
- Whether front and rear should have different default caps.
- Whether tire-specific target ranges should eventually come from a vetted source instead of rider-entered values.
