# Integrated rider workflow — PRs 1–7

Run in headless Chromium 152 via chromedriver at 390×844, against a server bound
to 127.0.0.1 only, at **PR #80 head `c8dca0df78c2a301a8561130161bdbe9c2bee580`**.
The only commit after this run adds documentation; no application code changed.

`measurements.json` holds every raw value.

## DAY → PRE → Back in → POST → LAPS → NOTES → REVIEW → Save & next

| step | observed |
|---|---|
| DAY | dock reads **"Start Session 2"**, derived from the rider's own label |
| PRE | stepper takes `30.0` → **`30.5`**; POST cell locked; dock reads "Back in → POST" |
| Back in → POST | PRE **read-only**, its stepper **disabled**, POST **unlocked**, reference line shows **"30.5"** |
| POST → LAPS | dock "Go to LAPS" |
| LAPS → NOTES | dock "Go to NOTES" |
| NOTES → REVIEW | dock "Go to REVIEW" |
| REVIEW | **"Save & start Session 3"** and **"Save only"** |

## Save & next

| field | before | after | expected |
|---|---|---|---|
| `front-pre` / `rear-pre` | 30.5 / 28.0 | **cleared** | ✅ pressures clear |
| `front-post` / `rear-post` | 33.5 / 31.0 | **cleared** | ✅ |
| `fork-comp` / `fork-reb` | 8 / 10 | **8 / 10** | ✅ clicks carry over |
| `rider-feedback` | "Front pushed on entry." | **cleared** | ✅ feedback clears |
| `laps-input`, `amb-temp` | set | cleared | ✅ |
| `bike`, `track` | set | **kept** | ✅ |
| `session-label` | Session 2 | **Session 3** | ✅ |

Stage returned to DAY, **POST re-locked**, PSI steppers **disabled** (blank
again), click steppers **enabled** (carried over).

## No duplicate record

One save produced **one** record, holding `frontPre 30.5`, `forkComp 8`, the
feedback text and label `Session 2`.

A second Save & next on the carried-over session produced a **second, genuinely
different** record — distinct ids, labels `Session 2` and `Session 3`, pressures
`30.5` and `31.0`, and the two payloads compared **not identical** with `id` and
`savedAt` removed. That is a new outing, not a duplicate.

## Refresh mid-outing, with auto-save on

Copied a saved session to the form, worked through to POST, then refreshed.

| check | after refresh |
|---|---|
| stage | **POST** — exactly where the rider was |
| values | bike, `Session 2`, `front-pre 30.0`, `front-post 33.5`, `fork-comp 8` |
| PRE editability | **read-only**, as recorded — its stepper disabled |
| POST availability | **available**, and its stepper usable |
| copy provenance | **restored** — *"Copied from … Session 1. Saving creates a separate session and leaves that one unchanged."* |
| status | "Draft restored · not saved yet" |
| footer | "A refresh brings your draft back." |
| saved history | still **1** record — the refresh created nothing |

**Correct PRE after the refresh** moved to PRE, made it editable again, re-enabled
its stepper, and left POST available.

**Saving the copy** then produced a **separate** record: two records, distinct
ids, `Session 1` and `Session 2` — the original untouched.

## Failures

**None.** Every assertion above passed on the first run.
