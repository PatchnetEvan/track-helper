# Pressure entry v2 — review rulings applied (`0.1.0-beta.14`)

## Fit, measured at both heights

Both tire rows **and** the open tire's controls must clear the dock.

| case | usable height | content needs | dock top | result |
|---|---|---|---|---|
| PRE, default text | **701** | 670 | 556 | **114px short** |
| POST, default text | **701** | 799 | 546 | **253px short** |
| PRE, default text | 844 | 670 | 699 | **fits, 29px spare** |
| POST, default text | 844 | 799 | 689 | 110px short |
| PRE, 200% text | 701 | 1500 | 442 | scrolls; nothing clipped |

Dock 85px, stage bar 60px, dock-to-bar gap **0px** in every case. No horizontal
page scroll anywhere.

## The ~36px estimate was low, and the two changes recovered more than that

The 36px came from the 844 measurement, where PRE was already 3px inside. The
two ordered changes recovered **54px** at any height:

- the header dropped **175 → 145px**, and
- the section row dropped **44 → 20px**.

The sub-line itself contributed almost nothing, because `.section-row` is a
wrapping flex row and "Right before you roll out." was already sitting *beside*
the label rather than under it. Removing it narrowed the row; it did not
shorten it. The height came from removing the row's second line and the header
gap.

At 701 that leaves **114px**. Nothing was shrunk to close it: the 72px rows,
the 72px pad and buttons and the 64px dock floor were all left alone, as
instructed. What the remaining space is spent on, at 390px default text:

| block | height |
|---|---|
| header (bike + About on one row, track · session + chip, status) | 145 |
| section label | 20 |
| FRONT row (72px floor, 85 actual: the dashed pill wraps under the label) | 85 |
| open panel: control row 77, typed field 62, note + "Same as" 99, gaps 16 | 265 |
| REAR row (72px floor, 104 actual: pill **and** delta chip under the label) | 104 |
| **content to the bottom of the REAR row** | **670** |
| available above the dock | 556 |

The two rows exceed their 72px floor only because the reference pill and the
delta chip stack under the label. The open panel's 265px is the control row,
the typed field and the note/button foot at their specified sizes.

## POST

The "Went out on 30.5 front · 28.0 rear" block is gone — each tire's dashed
pill already carries its PRE reference. Correct PRE moved below CURRENT BIKE
STATE as an outlined secondary button at the 48px tap target.

POST is **253px short at 701** and 110px at 844. Its rows are taller than PRE's
(146 and 173 against 85 and 104) because each POST pill carries two reference
sources — "S2 hot 33.5" and "PRE this session 30.5" — and the delta chip
carries two comparisons. Nothing was shrunk.

## 200% text

Scrolls, with nothing clipped and no horizontal page scroll. One real defect
found and fixed: `.tire-note` had a fixed `10rem` flex basis, which at 200% is
wider than the card and pushed the foot past its own box. The basis is now
`min(10rem, 100%)` and the "Same as" button may wrap.

(The checker also flags `.drag-pad` as overflowing. That is the tick pattern
being clipped by `overflow: hidden`, which is how the pad is drawn.)

## Real-phone check — NOT DONE

Still outstanding, and no measurement here substitutes for it:

- iPhone Safari, toolbar shown
- iPhone Safari, toolbar collapsed
- one Android phone, Chrome

For each: do both tire rows, the open tire's controls and the dock fit without
scrolling? The 701/844 split above is exactly what this resolves — Safari with
the toolbar shown sits near the low figure, collapsed near the high one.
