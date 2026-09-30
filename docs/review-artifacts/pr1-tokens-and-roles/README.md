# Review artifacts — PR 1, tokens and control roles

Rendered from this branch, served locally from `public/`. `docs/` is already
in `asset-boundary`'s `FORBIDDEN_ARTIFACTS`, so nothing here is published.

| file | shows |
|---|---|
| `01-calculators-secondary.jpg` | Calculators panel. "Calculate tire value" now reads as secondary while the active **Calculators** tab keeps the orange pill — the C4 separation between navigation and calculation |
| `02-review-three-roles.jpg` | Review panel, all three roles at once: **Build summary** secondary, **Save this session** the one solid `--accent`, **Reset session** danger outline |

## What could not be captured, and why it does not matter here

A true 390px viewport was not achievable: the window manager ignores resize
requests, and the same-origin iframe harness used for the Pro app fails
against this app.

It does not affect this verification. `styles.css` has exactly one media
query — `@media (max-width: 480px)`, which changes `.grid-3` to two columns
and touches no button. Every control PR 1 changed is `width: 100%` at every
width, so phone and desktop cannot differ for this diff. Later PRs that add
the stage bar and dock will need real phone-width verification.

## Measured, not eyeballed

Computed styles at desktop width:

- all six `calc-*` buttons: `.btn-secondary`, `rgb(32,32,32)`
- `build-summary`, `run-compare`: `.btn-secondary`
- `save-session`: `.btn-primary`, `rgb(255,102,0)`
- `reset-all`, `clear-history`: `.btn-danger`
- solid `--accent` elements fell from **9 to 3**: the active tab,
  `save-session`, and `feedback-submit`

Enlarged text, via root font-size (the app uses `rem`):

| | 100% | 150% | 200% |
|---|---|---|---|
| calc button height | 51px | 61px | 72px |
| clipped | no | no | no |
| save vs build summary distinct | yes | — | yes (51/72px, colours unchanged) |

Nothing drops below the 48px `--tap` floor and no label clips.

Behaviour after the demotion:

- **Sag** — 600/585/565 front, 520/505/485 rear → rider sag 35.0mm, static
  15.0mm, balance 0.0mm. Correct.
- **Laps** — five times → 5 counted, best 1:35.200, average 1:36.120, deltas
  correct.

## One finding for PR 2

`feedback-submit` is solid `--accent` with **no class** — a third orange
element the handoff does not name. PR 2 moves Feedback into About and should
give it a role then.
