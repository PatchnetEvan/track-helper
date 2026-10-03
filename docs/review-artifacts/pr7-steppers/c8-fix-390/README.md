# Pressure fix notes 1–5, 390px (`0.1.0-beta.12`)

| item | state |
|---|---|
| 1 ruler renders wrong | **fixed** — ticks positioned `calc(50% + i*32px)` for i = −8…8, every tick labelled, 26/18/10px heights from the bottom, all `--text-dim` |
| 2 pressures below the fold | **improved, not fully met** — see below |
| 3 reference pill | present (landed in beta.11); matched to the design |
| 4 context header | 3 lines + chip + status; empty states added |
| 5 content between dock and bar | **fixed** — measured gap 4px → **0px** |
| 6 value box | 70px → **54px** |

## Item 1

Layout no longer measures the box. The old code derived a tick count from
`getBoundingClientRect().width`, which is what bunched the labels at the left
edge and clipped them. Ticks are now offset from the centre, and `overflow:
hidden` clips the ends. 17 ticks drawn, 5 labels fully visible at 390px and 3
at 320px — about ±0.25 PSI either side of centre.

## Item 5

`--stage-bar-h` was floored at 64px (`Math.max(h, 64)`) while the bar measures
60px, so the dock sat 4px above it and page content showed through. The floor
is gone and the measurement is rounded **down**, so the dock overlaps rather
than leaving a hairline. The dock's `bottom` no longer adds
`env(safe-area-inset-bottom)` on top of `--stage-bar-h`, which already includes
the bar's safe-area padding — adding it twice was the second source of the gap.

Measured gap after the fix: **0px** at 390px and 320px, −1px (overlap) at 200%.

## Item 2 — what was done, and what is still short

Done: tire brand, model and warmers moved behind an **Edit tires** disclosure
with a one-line summary; the four-line paragraph became
"PRE-SESSION PRESSURE / Right before you roll out."; the full explanation moved
to About ▸ Help; the wordmark is hidden on phone (allowed by item 4) and the
panel heading with it; spacing tightened throughout.

**FRONT moved from 766px down the page to 319px.** The whole FRONT card is now
visible without scrolling at 390px and 320px.

The acceptance line "the FRONT card, the REAR value box and the dock must all be
visible without scrolling" is **not met**. Measured at 390×844, where the
browser leaves **701px** of usable viewport:

| block | height |
|---|---|
| header (About row, bike line, track · session + chip, status) | 175 |
| tires summary + Edit tires | 51 |
| PRE-SESSION PRESSURE + sub-line | 42 |
| FRONT card (label 23, Today 20, value 54, pill 32, ruler row 68, note, "Same as S2" 51) | 323 |
| REAR label + Today + value box | 107 |
| **total** | **759** |
| dock top | **556** |

The REAR value box ends 203px below the dock. Closing that gap means removing
something the spec asks for. The three candidates, for the designer to pick:

1. **The "Same as" button and the note (≈100px)** appear only while a tire is
   blank — exactly the state the acceptance shot uses. The design file's own
   PRE phone shows FRONT *with a value*, where neither is drawn.
2. **The reference pill (32px)** is only present when a reference matched.
3. **The header (175px)** is the largest single block and is fully specified by
   item 4.

Nothing was removed on my own initiative, so the shortfall is reported rather
than hidden.

## Verified

390px and 320px, normal and 200% text; empty fields; long bike and tire names;
Edit tires open and closed; a restored draft. No horizontal page scroll in any
case. 252 tests pass, 0 fail.
