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
