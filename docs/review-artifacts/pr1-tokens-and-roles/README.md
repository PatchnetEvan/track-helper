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
| `calc-suspension` | 51 | 51 | 165 | 165 |
| `calc-laps` | 51 | 51 | 72 | 72 |

Re-measured after the overflow fix below; **no control clips at any of these
twenty-four combinations**. Hyphenation also packs `calc-geometry` into one
fewer line at 320px/200% (165 to 119).

Every button stays `.btn-secondary` (`rgb(32,32,32)`) at every combination,
and every height clears the 48px `--tap` floor. Labels wrap rather than
shrink — the longest, "Calculate deltas & suggestions", grows to 165px at
320px/200% without clipping.

### A pre-existing overflow, found here and fixed under a separate authorization

`calc-suspension` ("Show recommendations") overflowed horizontally at 320px
with 200% text: `scrollWidth` **300** against `clientWidth` **245**. The end
of the label was unreachable.

Authorship was tested rather than assumed. Restoring `.btn-primary` on that
same element at that same width and text size reproduced it **identically** —
same 300/245. The two classes share one box rule, so the demotion changes only
`background`, `color` and `border-color` and cannot affect wrapping. The cause
is a single unbreakable word at 32px in a 245px content box.

**Fixed** (`05-overflow-fixed-390-and-320.jpg`): `scrollWidth` now equals
`clientWidth` at 245, and no control clips at any of the twenty-four
combinations measured.

The fix is two properties on the shared button rule:

```css
hyphens: auto;
overflow-wrap: break-word;
```

`hyphens` comes first so the break lands at a real syllable —
"recommenda-tions" at 390px, "recommen-dations" at 320px — rather than
orphaning a letter, which is what `break-word` alone produced. `break-word`
stays behind it as the guarantee: hyphenation only breaks where the dictionary
allows, and a long word with no valid break point would still spill. The
document is `lang="en"`, which is what makes auto hyphenation work at all.

What was preserved: the wording is untouched, the text stays at the rider's
own size (32px at 200%), the role stays `.btn-secondary`, and every height
clears the 48px `--tap` floor.

The alternatives were worse. Shrinking the text fights the rider's own
accessibility setting, and rewording the label is a product decision, not a
CSS fix.

### The shared rule, checked for side effects

`overflow-wrap` and `hyphens` were added to `.btn-primary, .btn-secondary,
.btn-danger` — so every button role inherits them. Measured at 320px, 100%
and 200%:

| control | role | 100% | 200% | clips |
|---|---|---|---|---|
| `save-session` | primary, `rgb(255,102,0)` | 100 | 119 | no |
| `build-summary` | secondary | 51 | 119 | no |
| `run-compare` | secondary | 51 | 72 | no |
| `reset-all` | danger, transparent | 51 | 119 | no |
| `clear-history` | danger, transparent | 51 | 119 | no |

Colours, roles and tap targets are unchanged; the only difference is that a
label now wraps instead of spilling. Both properties are inert until a word
genuinely cannot fit, so ordinary labels at ordinary sizes render exactly as
before.

`.btn-transition` gets the same two properties. It is not used until PR 4, but
it carries a verb line and an effect line and would meet the same defect;
fixing it now avoids shipping a rule with a known flaw.

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
