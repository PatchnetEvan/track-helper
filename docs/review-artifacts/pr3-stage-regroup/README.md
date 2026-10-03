# Review artifacts — PR 3, stage regroup

Stacked on PR #75 at `d3ab8f0e5e03557278189271c19721d0267c4399`. `docs/` is in
`asset-boundary`'s `FORBIDDEN_ARTIFACTS`, so nothing here is published.

`01-six-stages-390-320-1024.jpg` — left to right: NOTES at 390px (Rider
Feedback and tags), PRE at 320px (pre-session pressures only), REVIEW at
1024px on the desktop rail. All six labelled stages visible at both phone
widths; icons rendering.

## Navigation is not progression

Selecting POST shows POST and claims nothing about PRE. No stage is disabled,
none is marked done, and no lifecycle state is read or written — PRE→POST
gating is PR 4. The active stage is styled as *where you are looking*: a 3px
`--accent` top bar, a 10% tint and `#ff8a3d` text, never the solid fill PR 1
reserved for one thing.

## Placement, verified by visibility

| stage | shown | hidden |
|---|---|---|
| DAY | `bike`, `general-notes` | `front-pre` |
| PRE | `front-pre`, `fork-comp`, `calc-tires` | `front-post`, `symptoms` |
| POST | `front-post`, `symptoms`, `calc-suspension` | `front-pre`, `fork-comp` |
| NOTES | `rider-feedback`, `feedback-tags` | `general-notes` |
| REVIEW | `build-summary`, `save-session`, compare, list | — |

Panels shared between stages are split by `[data-stage]` markers rather than
by cutting the markup apart, which is what keeps every id and handler intact.

## Rider Feedback — absence is loaded explicitly

Four transitions, each measured after a real Load:

| from → to | result |
|---|---|
| populated (Bike A) → **legacy with no `riderFeedback` key** | text `""`, tags `[]` |
| populated → empty-but-present | text `""`, tags `[]` |
| empty → populated | text and 2 tags restored |
| populated (A) → populated (D) → back to A | `corner_entry, front_feel` ↔ `braking, rear_feel, traction`, **no bleed** |

The legacy case is the one that matters: a session saved before this field
existed has no key at all, and it must still clear the previous session's
words. The load path always assigns the text and always unchecks every tag
before restoring saved selections.

**Save & next**: feedback `""`, tags `[]`, bike kept (`Bike A`), label bumped
(`S1` → `S2`). Carry-over behaviour unchanged.

**Navigation preserves unfinished entries**: `front-pre` 30, `fork-comp` 8,
`front-post` 33 all survived DAY → LAPS → PRE.

## Stage bar sizing

| | need | have | fits | truncated |
|---|---|---|---|---|
| 320 @100% | 305 | 305 | yes | no |
| 390 @100% | 375 | 375 | yes | no |
| 1024 @100% | 219 | 219 | yes | no |
| 320 @200% | 458 | 305 | scrolls | **no** |
| 390 @200% | 630 | 375 | scrolls | **no** |

All six fit at normal text on both phone widths. At 200% the bar scrolls
sideways and `showTab` keeps the selected stage in view; labels are never
truncated. Labels are `0.8125rem`, not a fixed 13px, so they scale. Below
360px the cells size to content — the `3.25rem` floor was what stopped six
fitting, not the words. Every cell clears the 44px tap height.

## Calculations across stages

- **Pressure delta**: pre 30/28 entered in PRE, post 33/31 in POST →
  "Front: +3.0 PSI delta (pre 30 → post 33)", rear likewise. Reads PRE values
  from the POST stage correctly.
- **Suspension recommendations**: symptom checked in POST →
  "Mid-corner push: try softer front compression…"

## Three bugs found by testing, not by reading

1. **The click binding still selected `.tab`.** Renaming the markup class left
   every stage inert — selecting a stage did nothing. Exactly the failure the
   audit requirement exists to catch. Two more `.tab[aria-selected]` lookups
   had the same problem, one of them feeding `source_section` on feedback.
2. **`[hidden]` was being overridden again.** `.grid-2 { display: grid }` beat
   the UA's `[hidden] { display: none }`, so post-session pressures showed
   inside PRE. Same bug class as the context line in PR 2, so it is now fixed
   once globally: `[hidden] { display: none !important; }`.
3. **Icon paths tidied — not a production defect. Correction.** An earlier
   version of this note claimed `url("../icons/…")` resolved above the served
   root and so was broken in production. **That claim was wrong, and it is
   withdrawn.** Measured from `/styles.css` on a root-served origin:

   | form | resolves to | fetch |
   |---|---|---|
   | `../icons/info.svg` | `/icons/info.svg` | 200 |
   | `icons/info.svg` | `/icons/info.svg` | 200 |

   The two are identical, because `..` at the root is clamped by the URL
   specification, not by a browser quirk. The missing About icon was an
   artifact of the earlier harness, which served the app under a `/public/`
   prefix production does not have; under that prefix `..` escaped to a real
   parent directory and 404'd. Production was never affected.

   The change to `url("icons/…")` is **retained as a cleanup** — the relative
   form says what it means and cannot be re-broken by a future harness — but
   it fixes nothing that was failing, and no behaviour changed for any rider.

---

## Correction round (owner review of PR #76)

Four corrections plus one evidence-wording correction. Measured in a
same-origin nested-iframe harness serving `public/` **at the root**, the way
Workers Static Assets serves it — no `/public/` prefix.

### 1. Reset left stale context

`clearForm()` assigns `.value` directly and fires no `input` event, so the
context header kept naming a bike the form no longer held. `renderContext()`
is now called at the end of `clearForm()`.

| step | header `hidden` | bike | where |
|---|---|---|---|
| fresh load | `true` | — | — |
| after typing | `false` | Panigale V4 #21 | Barber · Session 2 |
| after Reset | `true` | — | — |

Fields blanked, stage returned to DAY. The `window.confirm` override was
probed (`confirm('probe') === true`) before the click was trusted.

### 2. Calculators now sit behind a labelled Tools disclosure

`panel-calculators` is a `<details class="tools-disclosure">` whose summary
reads **Tools** with the sub-line *Rolling circumference, sag, geometry
deltas*. Collapsed is the default.

| state | panel height | calculators visible |
|---|---|---|
| collapsed | 123px | 0 of 3 |
| expanded | 2162px | 3 of 3 |

Visibility measured with `Element.checkVisibility()`; `offsetParent` is not a
reliable signal inside a closed `<details>`.

**Scope note — reported, not silent.** The panel was also *moved* in the
markup, from between Tires and Suspension to after Suspension, so that DOM
order matches `STAGE_PANELS.pre` and routine entry (pressures → clicks) is
uninterrupted. The block was relocated intact: the SHA-256 of the moved 175
lines is unchanged, and the sorted list of every `id` attribute in the file
still hashes identically to `HEAD`.

### 3. Footer measurement no longer includes the desktop rail

`watchStageBarHeight()` measured the same element at every width. At ≥900px
that element is a full-height left rail, so its height was written into
`--stage-bar-h`. Measured directly at 1024px:

| | `--stage-bar-h` | focused control's `scroll-margin-bottom` |
|---|---|---|
| previous behaviour | 800px | **812px** — taller than the viewport |
| after this fix | 0px | 12px |

The measurement is now gated on `matchMedia("(min-width: 900px)")`; above the
breakpoint the inline value is removed so the stylesheet's own
`:root { --stage-bar-h: 0px }` inside the desktop block applies, with or
without JavaScript. A `change` listener on the media query re-applies on
either crossing.

| width | bar height | `--stage-bar-h` | inline override | body padding |
|---|---|---|---|---|
| 390 (initial) | 60px | 64px | 64px | bottom 76px |
| 1024 | 800px | 0px | none | bottom 0, left 220px |
| 390 (back) | 60px | 64px | 64px | bottom 76px |
| 320 | 60px | 64px | 64px | bottom 76px |
| 900 (exact) | 800px | 0px | none | left 220px |

Resizing across the breakpoint in both directions restores the correct value.

### 4. Fresh load shows DAY only

No POST block is in any painted frame before the first navigation. Every
panel except `panel-setup` carries `hidden` **in the markup**, and both
`[data-stage="post"]` blocks live inside `panel-tires` and `panel-suspension`,
which are hidden at first paint. So the blocks are never painted, and
`showTab()` sets their `hidden` attribute on the first navigation.

| | visible panels | POST blocks painted |
|---|---|---|
| fresh load | `panel-setup` only | no |
| after PRE | tires, suspension, calculators | no |
| after POST | tires, suspension | yes (PRE blocks: no) |

### Re-checks

| check | result |
|---|---|
| every stage selects, 390 / 320 | pass |
| stage labels clipped | never, at any tested width or text size |
| page scrolls sideways | never |
| bar scrolls sideways at 200% text | yes — as the handoff specifies |
| `--stage-bar-h` at 200% text, 390px | 95px, still measured correctly |
| smallest stage cell height | 59px normal, 94px at 200% — both above the 44px floor |
| Tools summary keyboard-focusable | yes, `tabIndex` 0, toggles open and closed |
| last DAY control occluded by the bar | no (bottom 723 vs bar top 784) |
| suite | 31 tests, 31 pass, 0 fail |

`:focus-visible` styling is declared in the stylesheet, matching the existing
`.review-section > summary` rule; Chrome will not report it through
`getComputedStyle`, so it is recorded as declared, not as measured.

### Screenshots

- `02-pre-tires-first-390.jpg` — PRE at 390px: context header populated,
  Tires first.
- `03-tools-disclosure-collapsed-390.png` — the Tools row collapsed below
  Suspension.
