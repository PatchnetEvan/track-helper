# Design review fixes at 390px — `0.1.0-beta.9`

| # | item | state |
|---|---|---|
| 1 | **C8** steppers one per row, `[−64][value flex][+64]`, 28px mono, ± on `--text` with a `#4a4a4a` border | **done**, minus the sub-line — see below |
| 2 | **C5** dock solid `--bg`, 1px top border, flush on the bar, content padded by dock + bar | **already in place**, verified not changed |
| 3 | **C3** context header on every stage, with a stage chip | **done** — chip added |
| 4 | **C7** status copy, Review save buttons | **not applied — conflicts with recorded owner decisions** |
| 5 | checkbox `accent-color`, 48px row target | **done** |
| 6 | deltas button moved PRE → POST | **done** |

## The 401px defect this also fixes

The previous layout wrapped the value onto its own line via `@media (max-width: 400px)`. Above that width it was crushed between two fixed 64px buttons:

| viewport | before | after |
|---|---|---|
| 320 | 262px | 118px |
| 390 | 161px | 188px |
| **401** | **26px** | **199px** |
| **412** | **28px** | **210px** |
| **430** | **37px** | **228px** |

No breakpoint now — the row wraps on what fits. Buttons stay 64×65 at every width, value font 29.75px, border `rgb(74,74,74)`, no clipping, no page-level horizontal scroll.

## Item 1 — the sub-line is not implemented

`"S(N-1) was X"` needs the previous session's pressure read out of saved history. The owner's approved PR 7 scope says: *"Defer previous-session value actions, **historical sub-lines** and custom ArrowUp/ArrowDown handling."* The CSS hook (`.stepper-sub`) is in place so it can be added in one step once that deferral is lifted.

`#4a4a4a` is also a new colour — the handoff's token list says not to add colours, and allows only `#ff8a3d` and `#7a828d` as derived values. Applied as asked; flagged because it widens the palette.

## Item 4 — not applied, and why

Both halves reverse decisions the owner made explicitly, recorded in `docs/design-handoff-changes.md`:

- **Status copy.** §7 records the change from *"Not saved yet · finish the session to keep it"* to *"Not saved yet · REVIEW saves it"*, because PR 4 moved saving off POST's Finish button. Restoring the handoff wording would point riders at a control that no longer exists.
- **Review's save buttons.** §2 records the owner over-ruling handoff line 70: *"Keep both save choices on REVIEW: Save only and Save & next."* They are present, in the dock. They have not been removed, by instruction.

Both are one-line changes if the owner confirms the reversal.
