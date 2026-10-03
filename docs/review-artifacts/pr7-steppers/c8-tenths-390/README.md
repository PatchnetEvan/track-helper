# C8 revised — centred value + tenths ruler, 390px (`0.1.0-beta.11`)

| shot | what it shows |
|---|---|
| `PRE-390.png` | FRONT blank with a reference; REAR typed `48.0` |
| `POST-390.png` | FRONT blank with both reference sources; REAR typed `48.0`; the outlined "Go to REVIEW" dock |
| `PRE-390-200pct.png` | the same PRE at 200% of the real default text size |
| `PRE-390-noref.png` | PRE with **no** establishable reference |

## Verified on the preview

| check | result |
|---|---|
| PRE starts blank | value `—`, field empty, "Today · not measured", with `last 31.0` only in the pill |
| POST starts blank | field empty even though `S2 hot 33.5` and `PRE this session 30.5` are both known |
| reference pill | `REFERENCE S2 hot 33.5 · PRE this session 30.5`, dashed, dim, outside the value box |
| "Same as" | `Same as S2 · 31.0` on PRE, `Same as S2 · 33.5` on POST — shown only while blank |
| typed `48.0` | kept exactly; "Today · typed"; ruler `aria-disabled="true"`; note names the range without judging the value |
| no reference | pill hidden, button hidden, no marker, ruler and −/+ disabled, short note, value still blank |
| POST dock | "Go to REVIEW" / "Save only or Save & next is there", `.btn-dock-nav` |
| status | "Not saved yet · on REVIEW, tap Save only or Save & next" |
| 200% text | ruler 72px, no page-level horizontal scroll |

## Behaviour proved by tests (239 pass / 0 fail)

- one tick = 0.1 PSI = 32px; dragging **left** increases, as the design file does
- a drag that has not reached the next tick changes nothing (8px and 15px move nothing; 17px moves one)
- ten tenths make exactly `31`, with no binary drift
- the ruler holds 10.0 and 45.0; a typed `48.0` steps from where the rider put it
- `-/+` never cross below zero **on the way down**, while an increment from `-2` still works
- excessive decimal precision and unsafe magnitudes are kept as typed and cannot be stepped
- a typed `30.25` steps to `30.35`, not `30.4`
- vertical scrolling that starts on the ruler is left to the page
- `pointercancel` releases capture and leaves the control usable
- a session number is never invented when the saved label has none
