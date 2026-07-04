# Track Agent AI quality checklist

Use this checklist before running another intentional live Cloudflare AI test.
Live AI calls may incur usage, so run only one approved smoke test after prompt
or schema guidance changes.

## Test phrases

The AI parser should extract these common paddock phrases:

- `best lap 97.4` -> `lap_times[0].lap_time = "97.4"`, `is_best = true`
- `best 97.4` -> best lap row
- `lap 1:37.4` -> lap row with `lap_time = "1:37.4"`
- `front hot 31` -> front/hot tire pressure, `pressure_psi = 31`
- `rear hot 27.5` -> rear/hot tire pressure, `pressure_psi = 27.5`
- `front cold 30` -> front/cold tire pressure
- `rear cold 27` -> rear/cold tire pressure
- `felt loose on exit of Turn 7` -> handling note, area `Turn 7 exit`
- `pushing on entry` -> handling note, area `entry`
- `running wide` -> handling note
- `rear rebound softer one click` -> setup change, rear suspension rebound
- `rear comp +2` -> setup change, rear suspension compression
- `sprocket 45 -> 47` -> gearing setup change

## Expected warnings

Warnings are appropriate for:

- missing track
- missing bike
- missing session number
- ambiguous lap time
- pressure value without front/rear position
- setup phrase where the component or adjustment is unclear

Warnings must not become coaching, safety advice, or setup recommendations.

## Must not output

AI must not produce:

- coaching advice
- setup recommendations
- safety-critical advice
- invented lap times, pressures, bike names, tracks, or setup changes
- example values that are not present in the rider's raw note
- `confirmed: true`
- fields outside the canonical Track Agent reviewed payload

## Example bleed issue

The Phase 6C live test extracted the required fields, but it also copied example
setup changes that were not in the raw note:

- `rear compression +2`
- `rear sprocket 45 -> 47`

Examples must be treated as format demonstrations only. They are not facts to
extract. If an example value is not present in `raw_note`, it must not appear in
the AI output.

## One-shot live retest phrase

Use this exact note for the next approved live smoke:

```text
Road Atlanta session 2 on Ninja 400. Best lap 97.4. Front hot 31, rear hot 27.5. Bike felt loose on exit of Turn 7. Changed rear rebound softer one click.
```

Expected extraction:

- `entry.track_name = "Road Atlanta"`
- `entry.bike_name = "Ninja 400"`
- `session.session_number = 2`
- one best lap row with `lap_time = "97.4"`
- two tire pressure rows: front/hot/31 and rear/hot/27.5
- one handling note for loose feeling at Turn 7 exit
- one setup change for rear rebound softer one click
- no setup changes for rear compression, rear comp, sprocket, or `45 -> 47`

Do not repeat live tests in a loop. If the one-shot live test still misses
obvious fields, adjust prompt/schema guidance or consider a larger approved
JSON Mode model in a later phase.
