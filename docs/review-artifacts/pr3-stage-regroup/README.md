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
3. **Icon paths were wrong.** `url("../icons/…")` from a stylesheet that sits
   at the served root resolves above the root; it only appeared to work
   because browsers clamp `..`. Now `url("icons/…")`. This also fixes PR 1's
   About icon, which had never rendered. Found only after rebuilding the
   harness to mirror production's layout — the earlier harness added a
   `/public/` prefix that production does not have.
