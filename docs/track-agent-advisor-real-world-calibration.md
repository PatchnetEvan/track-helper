# Track Agent Advisor Real-World Calibration

This calibration pass pressure-tests the deterministic Tire Pressure Advisor
rules with fictional but realistic track-day examples.

Scope:

- No AI.
- No D1.
- No public access changes.
- No schema or Worker config changes.
- No MotoTrack Log storage changes.
- No model-generated recommendations.

## Calibration Summary

The rule set remained conservative across the real-world scenario pass.

- The 1 PSI max adjustment cap held across all increase/decrease scenarios.
- Missing target or pressure data returned `needs_more_info`.
- Advice-seeking phrasing returned `not_supported`.
- Conflicting or incomplete context produced warnings and low confidence.
- No output used certainty language such as "this will fix it" or "correct pressure."

One deterministic rule refinement was made:

- When a rider reports instability/chatter/vague/greasy/loose/spin symptoms but
  pressure or target data is incomplete, the advisor now adds a warning instead
  of silently returning only missing fields.

## Scenario Results

| # | Scenario | Input Summary | Expected Output | Actual Output | Review Note | Classification |
|---|---|---|---|---|---|---|
| 1 | Normal day, pressures inside target | Front hot 32 in 31-33, rear hot 29 in 28-29, complete context | `ready`, front hold, rear hold | `ready`, front hold, rear hold, medium confidence, no warnings | Clean baseline behavior. | acceptable |
| 2 | Hot day, rear pressure climbing above target | Hot track, rear hot 31 against 28-29 target, greasy late-session note | `ready`, bounded rear decrease | `ready`, rear decrease capped at 1 PSI | Adjustment is bounded and does not claim it will solve greasiness. | acceptable |
| 3 | Cool morning, pressures below target | Cool morning, front and rear below target ranges | `ready`, bounded increases | `ready`, front increase, rear increase, cap held | Output stays pressure-vs-target driven. | acceptable |
| 4 | Rear greasy on exit but pressure inside target | Rear hot inside target with greasy-on-exit symptom | hold with warning and lower confidence | `ready`, rear hold, warning, low confidence | Correctly avoids a pressure change when pressure data does not support one. | acceptable |
| 5 | Front vague mid-corner and front pressure below target | Front hot below target with vague front note | bounded front increase | `ready`, front increase capped at 1 PSI | Pressure data and symptom plausibly align, but output remains bounded. | acceptable |
| 6 | Chatter/instability with incomplete data | Chatter reported, hot pressures missing | `needs_more_info`, no adjustment, warning | `needs_more_info`, no adjustment, symptom-context warning | Rule refinement added the missing caution warning. | missing warning fixed |
| 7 | Track temp missing | Complete pressure/target data but no track temp | `ready`, warning/lower confidence | `ready`, low confidence, track-temp warning | Appropriate caution without blocking rule-bound result. | acceptable |
| 8 | Tire model/compound missing | Tire model and compound missing | warning/lower confidence, no invented target | `ready`, low confidence, tire-specific warning | Correctly avoids inventing vendor data. | acceptable |
| 9 | Big pressure miss | Rear hot 34 against 28-29 target | decrease capped at 1 PSI plus warning | `ready`, rear decrease capped at 1 PSI, far-outside warning | Conservative enough for a large miss. | acceptable |
| 10 | Conflicting notes | Rear hot high but rider says rear feels cold/no grip | low confidence warning, conservative output | `ready`, rear decrease, low confidence, conflict warning | Warning makes the conflict explicit. | acceptable |
| 11 | Advice-seeking phrasing | "What tire pressure should I run?" | `not_supported`, no adjustment | `not_supported`, no adjustment | Keeps advisor out of chatbot/advice mode. | acceptable |
| 12 | Race-day fast session with complete data | Fast session, complete tire identity, hot pressures in range | `ready`, holds, no warnings | `ready`, front hold, rear hold, medium confidence, no warnings | Clean complete-data behavior. | acceptable |

## Too Cautious

No scenario was classified as too cautious in this pass.

The rule set does require complete hot/cold pressure data and supplied target
pressure or target ranges before producing pressure adjustments. That is
intentional for the current internal preview.

## Too Vague

No scenario was classified as too vague after the symptom-context warning was
added for incomplete chatter/instability cases.

## Too Aggressive

No scenario was classified as too aggressive.

The 1 PSI cap held across normal high/low pressure cases and the large-gap case.

## Missing Warnings

The initial review found one missing warning:

- Chatter/instability with missing hot pressures returned `needs_more_info` but
  did not explicitly warn that the symptom needed broader review.

That is now addressed with a deterministic warning:

```text
Handling symptom is present but pressure or target data is incomplete; review tire condition, track conditions, and setup context before making changes.
```

## Recommendation

The deterministic Tire Pressure Advisor rules are acceptable for continued
internal testing after this calibration pass.

Next step:

```text
track-agent-advisor-ui-polish
```

Keep the UI polish pass internal and invite-gated, and avoid AI, D1 schema
changes, public links, or model-generated recommendations.
