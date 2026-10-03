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

---

# Round 2 (`0.1.0-beta.20`)

## 1. The stage chip, and PRE now fits

The chip reads the stage name only — `PRE`, `POST`, `DAY`, `REVIEW` — with the
fuller wording kept as `aria-label` ("PRE · before rollout"), where it costs no
width. The bike name takes its own row, so the track, session and chip share
the next one; at default and 150% they are measured on the same row, and the
chip drops to its own line only at 200%.

**Header height: 147px → 120px (−27).**

| case | usable | needs | dock top | result |
|---|---|---|---|---|
| **PRE, FRONT open** | **701** | 535 | 556 | **fits, 21px spare** |
| PRE, FRONT open | 844 | 535 | 699 | fits, 164px spare |
| POST, FRONT open | 701 | 520 | 556 | fits, 36px spare |
| POST, FRONT open | 844 | 520 | 699 | fits, 179px spare |

No protected size was touched: 72px rows, 72px pad and ±, 64px dock, and the
13px floor all stand. No horizontal page scroll and nothing clipped at any size.

Header line by line, since the brief asked for it either way:

| | default | 150% | 200% |
|---|---|---|---|
| header | 120 | 225 | 366 |
| context line | 58 | 82 | 156 |
| chip on the track/session row | yes | yes | no, its own line |

## 2. Reachability guard

`tests/field-reachability.test.js`. The app has no `#session-form`, so it reads
the shipped markup and applies `showTab`'s own rules: a panel shows on the
stages listed for it, and a `[data-stage]` block inside it narrows that further.
Every `input`, `select` and `textarea` must be visible on at least one stage.

Three fields are excluded, each with its reason: `feedback-email` and
`feedback-body` (About ▸ Feedback, not session fields) and `autosave-switch`
(a setting, not a reading). A fourth test asserts every excluded id still
exists, so the list cannot rot.

**It catches the original regression.** Moving the symptoms back into
`panel-suspension` fails both the general test and the named one:

> `#symptoms lives in panel-suspension, which POST does not show — the beta.16 regression`

First attempt did **not** catch it: the symptom checkboxes carry no `id`, and
the parser skipped them. Controls without an id are now keyed by their `value`,
which is what makes the general guard see it.

## 3. Review items not built and not ruled out

Checked `REVIEW_beta18_spec_glove_sun_text.md` line by line against the branch.

**Nothing is outstanding.** Every coder item is built. For the record:

| item | state |
|---|---|
| A1 nav + `aria-current` | built |
| A2 POST dock 2px accent | built. Height is **64px**, not the review's 60/72 — the round-1 brief ruled 64 |
| A3 DAY copy (D3) | built, per the round-1 brief |
| A4 tokens | built: `#1a0a00`→`var(--bg)` ×4, `rgba(255,102,0,…)`→`var(--bg-elev)` ×5 |
| A5 dock sub-line above 150% | **no action by design** — the review accepts the shipped behaviour |
| A6 media wrapper + tripled comment | built |
| A7 About copy | built, all four lines |
| A8 README | **not a coder task**, the review says so explicitly |
| B1 Undo / B5 overscroll / B6 beforeunload | built |
| B2 72px dock (D2) | ruled 64px by the round-1 brief |
| B3 symptom chips | built |
| B4 16px gap + divider | correctly **not** built: conditional on D2 = 72px, which was ruled out, so flush stands |
| B7 no-keyboard PRE/POST | no change required |
| C1–C4 sun | built |
| D1 13px floor | built |
| D2 tire rows at 150% | screenshots supplied |

One wording note on D2: the review says the suspension grid "already switches
with a container query". It does not — it uses wrapping flex rows with a rem
basis, because a container query keys off width, which does not change when
only the text size does.
