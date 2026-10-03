# PR #83 — shared tokens, themes, re-skin (`0.2.0-beta.1`)

Built from main `bdbfe1e`. Rules: `DECISION_free_pro_one_language.md`.

## Fit — the 54px numeral fits; the fallback was not needed

| case | usable | needs | dock top | result |
|---|---|---|---|---|
| PRE bright | 701 | 556 | 556 | fits, **0px spare** |
| PRE dark | 701 | 556 | 556 | fits, **0px spare** |
| POST bright | 701 | 552 | 556 | fits, 4px spare |
| POST dark | 701 | 552 | 556 | fits, 4px spare |
| PRE bright / dark | 844 | 556 | 699 | fits, 143px spare |
| POST bright / dark | 844 | 552 | 699 | fits, 147px spare |

`--mt-text-numeral` is **54px**, confirmed in the DOM. The 44px fallback was
authorised but is not used. PRE has **zero pixels** of margin at 701 in both
themes, so any future line of copy in that header will push REAR under the dock.
No horizontal page scroll at any size, including 200% bright.

## Contrast — one failure, in the agreed palette

Measured from computed styles on the rendered page, against the surface each
piece of text actually sits on.

| theme | pair | ratio | |
|---|---|---|---|
| bright | body text | 16.14 | pass |
| bright | muted text | 5.68 | pass |
| bright | primary button text | 5.13 | pass |
| bright | warning text | 5.68 | pass |
| dark | body text | 20.16 | pass |
| dark | muted text | 8.34 | pass |
| dark | **primary button text** | **3.89** | **FAILS 4.5:1** |
| dark | warning text | 8.34 | pass |

**`--onblue #FFFFFF` on dark `--blue #2F7BFF` is 3.89:1.** This is a property of
the palette the decision adopted, not of anything built here, and it lands on
the most important control in the app — the solid transition button. Left as
specified and reported, because the token values are the agreed source of truth.

Two ways out, both one line in `mt-tokens.css`, for the designer to pick:
darken the dark-theme blue to about `#1F5FD0` (white then clears 4.5:1), or set
`--onblue` to `--ink` on that button. The bright theme needs neither.

## What was built

- `public/shared/mt-tokens.css` — raw tokens per theme, scale, aliases. Copied
  from Pro's `TRACKSIDE_DAY_FLOW_*_CSS` with the four agreed changes:
  `[data-mt="dark"]`, `--mt-tap: 48px`, `--mt-text-label: 13px`, `--mt-glove: 72px`.
  Two tokens the free app needed and Pro's trackside flow does not define:
  `--mt-brand` (the orange, header mark only) and `--mt-scrim` (dialog backdrop).
- `public/log/theme-stamp.js` — applies the theme before first paint, from a
  file because `script-src 'self'` blocks inline scripts. Auto follows the phone
  and keeps following it; a junk stored value falls back to auto rather than
  guessing; it also keeps `<meta name="theme-color">` in step.
- **`styles.css` now contains 0 hex, 0 `rgba(`, 0 font-family literals**, down
  from 38 / 3 / 5, and reads no old token name. `tests/token-hygiene.test.js`
  greps for all of it.
- Theme control in About: Auto / Bright / Dark, `role="radiogroup"`, 48px.
- Roles: the transition button and active stage are `--mt-primary`; warnings and
  the unsaved line are `--mt-warn`; orange appears only on the header badge.
- Shell at `--mt-shell-max` with `--mt-outside` around it.
- "Log · free" badge, "Save a backup" / "Restore a backup" (ids unchanged).

## Tests

**289 pass / 0 fail**, up from 276. New: `tests/token-hygiene.test.js` (7) and
`tests/theme.test.js` (7, evaluating the stamp rather than parsing it).

Two guards caught my own mistakes while building:
- `tests/asset-boundary.test.js` refused both new public files until they were
  declared — which is what it is for.
- My first contrast probe read body text against the **frame** colour and
  reported 1.08:1. The frame belonged on `body`; it is now on `html`, with body
  transparent and carrying the text colour. Without that, any node outside the
  shell would have rendered dark-on-dark.

## Kept

All PR #74–#81 behaviour, the protected sizes (now named: `--mt-glove`,
`--mt-cta`, `--mt-tap-primary`, `--mt-tap`), and PR #81's sun work, which
applies in both themes.
