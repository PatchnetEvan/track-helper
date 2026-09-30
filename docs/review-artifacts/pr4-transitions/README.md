# PR 4 — PRE→POST gating and docked transitions

App version `0.1.0-beta.5`. Measured in a same-origin nested-iframe harness
serving `public/` **at the root**, the way Workers Static Assets serves it.

Stacked on PR #76 (`feat/pr3-stage-regroup`). Nothing deployed, nothing merged.

---

## What this PR does

One docked action per stage is the **only** thing that progresses a session.
The stage rail beside it stays navigation, exactly as in PR 3 — including the
one stage that can refuse.

| stage | docked action | effect line |
|---|---|---|
| DAY | Start `<label>` | Opens PRE · nothing is copied or cleared |
| PRE | Back in → POST | Unlocks POST · PRE becomes read-only |
| POST | Go to LAPS | Laps and notes are optional · REVIEW saves |
| LAPS | Go to NOTES | Nothing is saved yet |
| NOTES | Go to REVIEW | Nothing is saved yet |
| REVIEW | Save & start `<next>` + Save only | Keeps bike, track, tires and clicks |

## Persistence — nothing new is stored

`mototrack.sessions.v1` is **byte-compatible**. No migration, no new key in the
saved session, no new storage key. A beta.4 export imports into beta.5 and back.

**Unfinished entries are memory-only**, as they have always been: the live form
is the draft, and a refresh, a crash or the browser reclaiming the tab loses
it. That is kept deliberately unchanged so draft persistence arrives once, in
PR 6, behind the rider's own auto-save switch. It remains real follow-on work —
a phone in a hot pit lane is exactly where a tab gets evicted.

## POST availability and PRE editability are separate

Two variables, not one, so that correcting a typo cannot undo the fact that the
rider came back in.

| step | POST unlocked | PRE editable | POST values |
|---|---|---|---|
| fresh | no | yes | — |
| Back in → POST | **yes** | no | kept |
| Correct PRE | **yes** (unchanged) | **yes** | **kept** |
| back to POST (rail) | yes | yes | kept |

Measured: after Correct PRE, `preReadOnly: false`, `postStillUnlocked: true`,
`postValueKept: "33.5"`, and focus lands on `front-pre` — the rider is taken
straight to the editable field. Returning to POST is navigation and changes
nothing.

Tapping a locked POST cell does **not** navigate (`stage` stays `day`) and
shows *"POST opens when you're back in."*

## Save behaviour

| scenario | saved records | result |
|---|---|---|
| Save only | 0 → 1 | button becomes "Saved", disabled |
| Save only tapped again | 1 → 1 | refused |
| Save & next after a plain save | 1 → 1 | **advances without duplicating** |
| two simultaneous taps | 1 | one record |
| save throws (quota) | unchanged | label, fields and stage all preserved; retry works |

The failure case was exercised by making `Store.add` throw: stored count, the
session label, every field value and the current stage were identical before
and after, the error was shown, the save button stayed enabled, and the
following retry saved normally.

After advancing, the next outing has not been ridden, so POST locks again.

## The next-session label

One rule for the display and for the field. A label is only advanced when the
trailing number can be incremented cleanly.

| label | dock says | field becomes |
|---|---|---|
| `Session 2` | Save & start **Session 3** | `Session 3` |
| `Q1 - damp` | Save & start **Q2 - damp** | `Q2 - damp` |
| `morning warmup` | Save & start **next session** | `morning warmup` (untouched) |
| `2nd outing` | Save & start **next session** | `2nd outing` (untouched) |

`2nd outing` is why the guard exists: the existing bump would have produced
`3nd outing`. No invented session number is ever displayed or written.

## Copy to form

The saved-session action is renamed from **Load** to **Copy to form**, and its
confirm says what it does: *"It will be saved as a separate session, not as
changes to this one."*

Copying **never implies the rider is back in**. Measured after a copy: stage
`day`, POST locked, PRE editable, values present, and tapping POST refused.

## Dock layout at enlarged text and with the keyboard open

Nothing is hidden or truncated — the handoff's "hide the sub-line above 150%
text" is dropped, because text zoom is not observable and the dropped line is
the one saying what the action changes. Instead the dock wraps, grows, and
**yields its sticky position** when its measured height plus the navigation
would cost too much of the viewport. The comparison is against
`visualViewport.height`, which is what shrinks when the soft keyboard opens.

Yield at 45% of the available viewport, release at 40% — hysteresis, so a
height sitting on the threshold cannot flip back and forth.

| viewport | text | stage | dock + nav | of viewport | sticky? | sub-line |
|---|---|---|---|---|---|---|
| 390×844 | 100% | DAY | 85 + 60 | 17% | sticky | visible |
| 390×844 | 200% | DAY | 153 + 95 | 29% | sticky | visible |
| 390×844 | 400% | DAY | 564 + 169 | 87% | **in flow** | visible |
| 390×844 | 100% | REVIEW | 148 + 60 | 25% | sticky | visible |
| 390×844 | 200% | REVIEW | 281 + 95 | 45% | sticky | visible |
| 390×**400** | 100% | REVIEW | 148 + 60 | 52% | **in flow** | visible |
| 390×**400** | 200% | REVIEW | 281 + 95 | 94% | **in flow** | visible |
| 320×640 | 200% | REVIEW | 281 + 95 | 59% | **in flow** | visible |

The 390×**400** rows are the keyboard case: the viewport height was reduced to
400px to reproduce what a soft keyboard does to the visual viewport. **This is
a simulated viewport reduction, not a real on-screen keyboard** — the mechanism
under test (`visualViewport` resize) is the same one a keyboard triggers, but
a device check is still worth doing.

Returning to 390×844 at 100% restores the sticky dock, so the yield is not
one-way.

On desktop (≥900px) the rail replaces the bar and the dock sits in the content
column; `--dock-h` and `--stage-bar-h` are both removed, so nothing reserves
bottom clearance.

## Two defects found by rendering, not by reading

1. **The dock froze the renderer, twice.** `applyDockLayout()` cleared
   `dock--flow` before measuring "from a known state". That changed the height,
   which re-fired the `ResizeObserver`, which set the class again — an
   oscillation that hung the page at 400% text. Fixed by measuring without
   mutating (sticky and in-flow are the same height by construction), adding
   hysteresis, writing `--dock-h` only when it actually changes, and dropping a
   `visualViewport` **scroll** listener that re-entered on the layout the
   function itself caused. Only the `resize` listener remains, which is what a
   keyboard fires.

2. **The dock text did not scale at all.** `.btn-transition` set `18px` and
   `13px` from the handoff, so the biggest action on the page was the one
   control that ignored the rider's text-size setting. Converted to `1.125rem`
   and `0.8125rem` — the same sizes at the default root.

## One pre-existing defect fixed, reported rather than folded in silently

At 400% text the **whole page scrolled sideways**. The cause was `.brand-name`
in the header, not anything in PR 4: `.brand` is itself a flex container, so
the name needed its own `min-width: 0` before `overflow-wrap` could take
effect. One line, in a PR 1/2 surface. Fixed here because this PR is the one
being verified at enlarged text, and flagged here because it is outside PR 4's
stated scope.

## Tests

`47 pass / 0 fail` locally. 16 of them are new, in
`tests/session-progress.test.js`, and they call the rules rather than grepping
the source: `public/session-progress.js` holds the decisions so they can be
exercised directly.

Mutation-tested — every mutant was killed and the control stayed green:

| mutation | result |
|---|---|
| `correctPre()` also re-locks POST | 2 fail |
| double-tap guard removed | 1 fail |
| already-saved guard removed | 2 fail |
| failed save clears the dirty flag | 2 fail |
| ordinal guard removed | 2 fail |
| `copyFromSaved()` keeps POST unlocked | 1 fail |
| `advanced()` does not reset `lastSavedId` | 1 fail |
| *(control — unmutated)* | **0 fail** |

`tests/experience-pulse-client.test.js` needed one anchor tightened: it sliced
from the first mention of `save-and-next`, and the dock now renders that
button's label earlier in the file, so the slice silently widened over an
unrelated handler. Anchored on `.addEventListener` instead. Verified it still
bites by injecting a `maybePrompt` into the Save & next handler — the frozen
decision that Save & next never prompts still fails the suite if broken.

## Screenshots

- `01-post-reference-correct-pre-390.png` — POST showing *"Went out on 30.5
  front · 28.0 rear"* with **Correct PRE** beneath it.
- `02-review-both-saves-docked-390.png` — both save controls in the dock:
  **Save & start Session 3** in accent, **Save only** secondary.
