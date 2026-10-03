# PR #81 — spec fixes, glove, sun and text size (`0.1.0-beta.19`)

Base: PR #80 head `8b9ab6a` (beta.18).

## Fit

| case | usable | needs | dock top | result |
|---|---|---|---|---|
| **PRE, FRONT open** | **701** | 562 | 556 | **6px SHORT** |
| PRE, FRONT open | 844 | 562 | 699 | fits, 137px spare |
| POST, FRONT open | 701 | 547 | 556 | fits, 9px spare |
| POST, FRONT open | 844 | 547 | 699 | fits, 152px spare |

**PRE misses by 6px at 701**, where the brief expected about 6px spare — a
12px difference. Nothing was shrunk to close it: the 72px rows, the 72px pad
and buttons and the 64px dock are all as specified.

The gap is the cost of item 8. Raising the "Today" caption and the delta chip
from 12px to 13px widens the right column of each tire row, and the row grows
with it. Reverting just that caption to 12px would return roughly 6px and make
PRE fit — which is the trade the owner should make, not me.

For the record, two layout bugs were found and fixed on the way, each worth
more than the shortfall:

- A flex row **wraps before it shrinks**. `.tire-col-left` had an `auto` basis,
  so the wider caption pushed the whole row onto two lines and cost **62px a
  tire**. The basis is now `0`, and the pill wraps inside the column instead.
- The stage chip had `flex: none`, so at 200% "PRE · BEFORE ROLLOUT" was 385px
  against 358px of usable width and **scrolled the page sideways**. It now
  shrinks and wraps at a space.

No horizontal page scroll at any size, and nothing clipped at 150% or 200%
(`.drag-pad` reports overflow because its tick pattern is clipped by
`overflow: hidden`, which is how the pad is drawn).

## Items

1. **Undo (C14)** — measured live: `Undo · back to PRE · 9s`, **64px tall**,
   `.btn-dock-nav`, with "Go to REVIEW" hidden while it is open. The live region
   read `Undo available for 10 seconds` once, not once a second. Undo resets
   exactly the stage state Back in changed and touches no values; with auto-save
   on it is kept like any other change.
2. **Leave-page guard (C16)** — `overscroll-behavior-y: contain` on `html, body`,
   and `beforeunload` only when auto-save is off **and** there is unsaved
   content, which is the same condition that makes the status read "Not saved
   yet". iOS Safari mostly ignores `beforeunload`; the overscroll rule is the
   protection there.
3. **DAY dock copies setup** — `Fills blank tires and clicks from S2 · opens
   PRE` with history, `Opens PRE` without. Blank fields only, never a value the
   rider entered, never a pressure. Units travel with their values.
4. **Dock 64px** — `.btn-transition` and `.btn-dock-nav`, flush with the bar
   (gap 0 measured).
5. **Symptom chips** — `repeat(2, minmax(0,1fr))`, 12px gaps, 71px cells,
   2px accent border when selected with a check icon, no `rgba` tint.
6. **Spec fixes** — stage bar is `<nav aria-label="Session stages">` with
   `aria-current="page"`; no `role="tablist"`, `role="tab"`, `aria-selected` or
   `role="tabpanel"` anywhere. POST dock has a 2px `--accent` border. Tokens:
   `#1a0a00` → `var(--bg)` (4), `rgba(255,102,0,…)` → `var(--bg-elev)` (5). The
   `@media (min-resolution: 0.001dppx)` wrapper is gone with its rules kept, and
   the tripled comment is down to one. About copy updated on all four lines.
7. **Sun** — pad ticks `--text-dim`, long 2px and short 1px at half the length;
   pad sub-line 13px; locked PRE values at full opacity with a dashed border and
   a lock icon; `prefers-contrast: more` switches `--border` to `--text-dim` and
   doubles the reference pill border.
8. **Text size** — stage chip, "Today" caption, delta chip and pad label all at
   13px. The 12px About label stays.

## A defect this work uncovered in PR #80

Moving `panel-suspension` to DAY took the **POST symptoms with it** — they sat
inside that panel, so after PR #80 they were unreachable on POST. The symptoms
block, its recommendations button and its result are re-homed in `panel-tires`
under `data-stage="post"`, where POST actually shows them. Found only because
this brief asked for a screenshot of them.

## Not supplied

`REVIEW_beta18_spec_glove_sun_text.md`, cited as the full review, is not in the
handoff folder. This was built from the brief alone.
