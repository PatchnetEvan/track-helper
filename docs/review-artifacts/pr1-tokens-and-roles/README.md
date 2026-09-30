# Review artifacts — PR 1, tokens and control roles

Rendered from this branch, served locally from `public/`. `docs/` is already
in `asset-boundary`'s `FORBIDDEN_ARTIFACTS`, so nothing here is published.

| file | shows |
|---|---|
| `01-calculators-secondary.jpg` | Calculators panel at desktop width. "Calculate tire value" now reads as secondary while the active **Calculators** tab keeps the orange pill — the C4 separation between navigation and calculation |
| `02-review-three-roles.jpg` | Review panel, all three roles at once: **Build summary** secondary, **Save this session** the one solid `--accent`, **Reset session** danger outline |

## Phone widths — verified, not reasoned about

The earlier version of this file claimed phone and desktop could not differ
for this diff, on the strength of reading the stylesheet. That claim is
withdrawn: it was an argument, not a measurement, and it was made because a
true phone viewport had not been obtained.

It has now. A same-origin harness outside the repository serves `public/`
alongside a wrapper page holding two iframes, which gives each app instance a
**real nested viewport** — `innerWidth` reports 390 and 320, and
`@media (max-width: 480px)` fires inside both (`.grid-3` resolves to
`1fr 1fr`). These are genuine phone renders, not crops of a desktop layout.

| file | shows |
|---|---|
| `03-phone-390-and-320.jpg` | Calculators at both widths, tab scroller and all |
| `04-phone-buttons-390-and-320.jpg` | "Calculate tire value" reading as secondary at both widths |

### Measured at both widths, 100% and 200% text

Heights in px; `CLIPX` marks horizontal overflow.

| button | 390 | 320 | 390 @200% | 320 @200% |
|---|---|---|---|---|
| `calc-tires` | 51 | 75 | 119 | 165 |
| `calc-tire-core` | 51 | 51 | 119 | 119 |
| `calc-sag` | 51 | 51 | 72 | 119 |
| `calc-geometry` | 51 | 51 | 119 | 165 |
| `calc-suspension` | 51 | 51 | 119 | **119 CLIPX** |
| `calc-laps` | 51 | 51 | 72 | 72 |

Every button stays `.btn-secondary` (`rgb(32,32,32)`) at every combination,
and every height clears the 48px `--tap` floor. Labels wrap rather than
shrink — the longest, "Calculate deltas & suggestions", grows to 165px at
320px/200% without clipping.

### One pre-existing defect, not caused by this PR

`calc-suspension` ("Show recommendations") overflows horizontally at 320px
with 200% text: `scrollWidth` 300 against `clientWidth` 245.

This was tested rather than assumed. Restoring `.btn-primary` on that same
element, at that same width and text size, reproduces it **identically** —
same 300/245. `.btn-primary` and `.btn-secondary` share one box rule, so the
demotion changes only `background`, `color` and `border-color`; it cannot
affect wrapping. The cause is a single unbreakable word at 32px in a 245px
content box.

It is reported, not fixed: the handoff says not to restyle anything PR 1 does
not list, and a wrapping fix belongs with whichever PR revisits that panel.

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
