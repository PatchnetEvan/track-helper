# Pressure entry v2 — fit rulings round 2 (`0.1.0-beta.15`)

## Fit table

PRE: both tire rows, the open tire's controls and the dock, without scrolling.
POST at 701: the open tire's controls and the dock (the other row may sit
below the fold). POST at 844: both rows as well.

| case | usable | content needs | dock top | both rows | open controls | result |
|---|---|---|---|---|---|---|
| PRE, default | **701** | 546 | 556 | yes | yes | **meets target** |
| PRE, default | 844 | 546 | 699 | yes | yes | **meets target** |
| POST, default | **701** | 607 | 546 | no (by design) | **yes** | **meets target** |
| POST, default | 844 | 607 | 689 | yes | yes | **meets target** |
| PRE, 200% | 701 | 1294 | 442 | no | no | scrolls, nothing clipped |

Dock-to-bar gap 0px everywhere. No horizontal page scroll in any case.

## PRE: 670 → 546 (124px)

| change | saved |
|---|---|
| blank-state note removed; the placeholder and the pad's "0.1 per notch" carry it | 43 |
| "Same as" moved onto the typed-field row | 17 |
| delta chip moved under the value, replacing the "Today" caption | 16 |
| the typed field's flex basis cut from 8rem to 6rem, so the button stops wrapping | 48 |

The last one was not in the ruling and is worth a look. At 390px an 8rem basis
plus the button came to 309px against 300px of card — **9px over**, so the
button took its own line and cost 64px of height. A 6rem basis lets it sit
beside the field. It still wraps at 320px and at large text, which is what the
ruling asks for.

Row heights are now 84 (FRONT) and 88 (REAR) against the 72px minimum. The
remainder is the dashed pill sitting under the label, which is where the ruling
puts it.

## Two things to look at (both now ruled on, and accepted as built)

**The placeholder is "e.g. 30", not "Type, e.g. 30".** Beside the button the
field is 119px, and "Type, e.g. 30" in 20px mono needs about 156px — it
rendered as "Type,". The choice was a clipped placeholder, a wrapped button
(giving back 48px and missing the 701 target), or the shorter text. I took the
shorter text. Say the word and I will restore the exact wording with the button
wrapped.

**"Today · typed" no longer shows on a closed row that has a reference**, because
the chip replaces the caption whenever there is a value. For a value typed
outside the range the row shows the chip and the value, and the "outside the
drag range" note still appears when the card is open. If the typed caption
matters on a closed row, the two can stack instead, at about 16px.

## POST

Both references read as one line in the pill — "S2 hot 33.5 · PRE 30.5" — and
the chip as "+2.2 vs S2 · +5.2 vs PRE". POST rows are 84 and 149.

Opening a tire now scrolls the list so its controls clear the dock
(`window.scrollTo` by the measured overlap, not a guess; nothing moves when it
already clears). `prefers-reduced-motion: reduce` switches it from `smooth` to
`auto`.

## 200% text

Scrolls, nothing clipped, no horizontal page scroll. (`.drag-pad` reports
overflow because the tick pattern is clipped by `overflow: hidden`; that is how
the pad is drawn.)

## Unchanged

72px minimum for rows, pad and ±; 64px dock; Flag F, Undo, the leave-page
guard and the save controls.

## Real-phone check — NOT DONE

iPhone Safari with the toolbar shown, iPhone Safari with it collapsed, and one
Android phone in Chrome. For each: do the tire rows, the open controls and the
dock fit? The 701/844 split is what this settles.


---

## Rulings applied, round 2 review

1. **Placeholder `e.g. 30`** — accepted. The field's accessible name carries the
   meaning; the placeholder is a hint. The button does not wrap at 390px.
2. **"Today · typed" absent from a closed row with a reference** — accepted. The
   chip already shows how the value compares, and the "outside the drag range"
   note on the open card carries the detail. The extra 16px was not added.
3. **The 6rem flex basis** — accepted, and recorded in the PR description with
   its reason.

## The agreed device-check fallback does not reach its estimate

The fallback for a shortfall of 30px or less was to put the track, session and
stage chip on the name row, with About wrapping when it does not fit, for about
22px. Simulated against the deployed build at 390px through the CSSOM (no
rebuild, no inline style attributes, so the page's `style-src 'self'` is not
involved):

| variant | header | PRE needs | headroom at 701 |
|---|---|---|---|
| as built | 145 | 546 | **+10** |
| name row carries track, session and chip | 141 | 542 | +14 |
| …and About wraps to its own row | 172 | 573 | **−17** |

**It returns 4px, not 22px.** The estimate assumed a header this branch has
already compacted: the bike name and About were put on one row in an earlier
round, and at 390px the name (~150px) plus "Homestead · Session 3" (~160px)
already fills the 358px of usable width, so the chip wraps regardless. Giving
About its own row frees width but adds a 48px row, which is the net loss above.

A real-phone shortfall of 5px or more therefore needs the owner's ruling, not
this fallback. The escalation path in the ruling — stop and send the numbers —
applies from the first pixel, not from 30.

---

# Drag fix and suspension rework (`0.1.0-beta.16`)

## 1. Touch drag — fixed, but NOT verified against the reported failure

All four changes are in: `pointer-events: none` on every child of `.drag-pad`,
`setPointerCapture` on `pointerdown`, `lostpointercapture` ending the drag only
when `e.target === pad`, and the pad's label rewritten only when `usable`
changes.

**The test cannot see the bug.** A real-touch test was added
(`tests/browser/touch-drag.test.js`, opt-in with `BROWSER_TESTS=1`): it drives
headless Chromium over CDP with touch emulation, dispatches real
`Input.dispatchTouchEvent` sequences, drags five notches and expects +0.5. It
passes — **and it also passes against the unfixed code.** Reverting each of the
four fixes individually, and all of them together, leaves it green.

The event trace explains why. With the children still taking pointer events,
the touch target is a child, but the capture still lands on the pad and is only
released at the end:

```
pointerdown@pad-line/touch        <- target IS the child
gotpointercapture@drag-pad/touch  <- capture goes straight to the pad
pointermove@drag-pad/touch  x6
pointerup@drag-pad/touch
lostpointercapture@drag-pad/touch <- target === pad, at the end
```

Headless Chromium never gives the child an implicit capture, so the
`lostpointercapture` that kills the gesture on Android Chrome never fires here.
The fixes follow the diagnosis and are each defensible on their own, but the
only thing that can confirm them is the device.

What the test *does* guard: that a real touch drag of five notches moves the
value by exactly 0.5, and that a vertical touch drag starting on the pad
scrolls the page instead of changing the value.

## 2. Suspension on DAY

`panel-suspension` moved out of `STAGE_PANELS.pre` and `.post` and into `day`.
FORK and SHOCK groups, each with Preload, Compression and Rebound as rows in
the tire-row pattern, one adjuster open at a time across both groups.

Measured at 390px: closed rows **72px exactly** (the minimum), − / + **77px**,
unit switch **50px**, no horizontal scroll. At 200% rows grow to 132px.

Steps are 1 for clicks and 0.5 for turns; clicks format whole, turns to one
decimal. Changing the unit re-reads the number at the new precision and never
converts — a click is not a turn, and converting would invent a reading.

## 3 and 4. PRE confirms, POST shows

CURRENT BIKE STATE carries a Suspension row reading
**`Fork P 2.5t · C12 · R10 / Shock P 3t · C8 · R12`** — clicks unsuffixed,
turns with `t`, missing values as `–`. On PRE the row has an Edit button that
goes to DAY, opens the Suspension group and shows a "Done · back to PRE"
control. On POST the row is present with no Edit. Locking is untouched.

## Data

A `units` object is added to the saved suspension shape
(`forkPreload`, `forkComp`, … as `"clicks"|"turns"`). It is additive: a session
saved without it falls back to the adjuster's default, so existing numbers read
exactly as they were saved. Preload defaults to turns, damping to clicks. The
units carry over through Save & next, because `clearTransientFields` has never
touched suspension.

## PRE fit, with suspension gone

| case | usable | needs | dock top | result |
|---|---|---|---|---|
| PRE, default | 701 | 546 | 556 | fits |
| PRE, default | 844 | 546 | 699 | fits |

Unchanged from beta.15: suspension was already on its own panel, so moving it
frees nothing on PRE. The CURRENT BIKE STATE card gained a Suspension row and
lost nothing, and the figure held at 546.

## Three defects found while building

- The `units` object made **every empty form look like it had content**, because
  `sessionHasContent` treats any truthy value in `suspension` as a reading. A
  unit is a preference, not a measurement, and is now excluded — the same
  treatment `geometryConstants` already gets.
- The panel's initial `hidden` flags in the markup were hand-matched to the old
  stage list, so Suspension stayed hidden on DAY until the rider selected
  another stage and came back. Boot now calls `showTab("day")` and applies the
  mapping rather than trusting the markup.
- `tests/browser/cdp.js` broke the CI contract that every file under `tests/`
  matching the runner's glob must be a suite. Moved to `tests/helpers/`.

---

# Bike-state readability (`0.1.0-beta.17`)

## 1. Suspension as a grid

Headers once (PRELOAD / COMP / REB, 13px muted uppercase), FORK and SHOCK at
14px bold letter-spaced, values 22px mono with a muted "t" after turns and an
en dash where there is no value. The row is 302px wide and the four columns
come to exactly 302px at normal text, so they align without wrapping.

It is built from **wrapping rows, not a CSS grid**. The first attempt used
`grid-template-columns: auto repeat(3, minmax(0,1fr))`, and a grid cannot
reflow: at 200% the headers overlapped into "PRECOMPREB" and `1.5` broke into
"1 . 5" down three lines. Values now carry `white-space: nowrap`, so a reading
is one token.

**At 200% the three values wrap under the label, as asked — but they wrap two
to a line, not one, and the header row wraps separately.** The association
between a value and its column is weaker there than at normal text. Making it
exact needs either a per-cell label (which drops "headers shown once") or a
breakpoint on text size, which CSS cannot express. Flagged rather than decided.

The card grew from 266px to 344px, about 78px rather than the estimated 30px,
because the header row and two value rows each need a line.

## 2. One Edit per row

The card-header Edit is gone. Tires and Suspension each carry a trailing Edit,
**48px measured**, right-aligned on its own row. Tires toggles the tire fields
in place (and reads "Done" while open); Suspension goes to DAY, opens the
group and offers "Done · back to PRE". On POST the Suspension row has no Edit.

The Tires button updates itself in place rather than re-rendering the card,
because rebuilding the control the rider just pressed throws away its focus.

## 3. Dock sub-line clipped by the stage bar — hardened, NOT reproduced

I could not reproduce it. Measured at four viewport states (initial, address
bar collapsed, expanded, and collapsed after scrolling): gap between dock and
bar **0px** in every case, and the sub-line never crossed the bar. In desktop
Chromium `window.innerHeight` and `visualViewport.height` stay equal, so the
divergence Android has does not occur here.

The mechanism is still clear: the dock is `position: sticky` and the bar is
`position: fixed`, so they resolve against different viewports. When Chrome
collapses the address bar the fixed bar is pinned to the visual viewport while
the sticky dock is placed against the layout viewport, and the bar lands over
the dock's lower edge.

Two changes against that, neither of which shrinks anything:

- `--stage-bar-h` now reserves the distance from the bar's **top** to the
  bottom of the viewport, never less than the bar's own height. Where the two
  viewports agree it is identical (60px, verified); where they diverge the dock
  rises by however far the bar actually sits.
- The measurement re-runs on `visualViewport` **resize and scroll**, which is
  what fires when the address bar moves. Previously only window `resize` and a
  `ResizeObserver` on the bar did, and neither fires when only the visual
  viewport changes.

No screenshot of the defect was attached to the brief, so this is worked from
the description. It needs the device to confirm.

## PRE fit at 701 — unchanged

| case | usable | needs | dock top | result |
|---|---|---|---|---|
| PRE, FRONT open | 701 | 546 | 556 | fits, 10px spare |
| PRE, FRONT open | 844 | 546 | 699 | fits |

The card grew by 78px and the fold did not move: CURRENT BIKE STATE sits
**below** both tire rows, so it pushes nothing above it. Nothing was shrunk.
Both Edits measure 48px, no cell is clipped, and there is no horizontal page
scroll at either text size.
