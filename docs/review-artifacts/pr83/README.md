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

---

# Round 2 (`0.2.0-beta.2`)

## 1. `--mt-primary-fill`, and the contrast table re-run

A solid blue behind white text now comes from its own token. `--blue` is
untouched and still draws the focus ring, the active-stage line and blue text,
where it never sits behind white.

| theme | `--mt-primary-fill` |
|---|---|
| bright | `var(--blue)` → `#0B5FFF` |
| dark | `#1F5FD0` |

Eleven solid fills moved to it: the transition button, the theme and unit
switches, the auto-save knob, the stage-chip and waitlist surfaces, the
feedback submit. Every remaining `--mt-primary` is a border, an outline or
text.

| theme | pair | before | after |
|---|---|---|---|
| bright | body text | 16.14 | 16.14 |
| bright | muted text | 5.68 | 5.68 |
| bright | primary button text | 5.13 | 5.13 |
| bright | warning text | 5.68 | 5.68 |
| dark | body text | 20.16 | 20.16 |
| dark | muted text | 8.34 | 8.34 |
| dark | **primary button text** | **3.89 — failed** | **5.82 — passes** |
| dark | warning text | 8.34 | 8.34 |

**Every pair is at or above 4.5:1.** The worst is bright's primary button at
5.13.

## 2. Opt-in browser fit test

`tests/browser/fit.test.js`, run with `BROWSER_TESTS=1`. It drives headless
Chromium over CDP at **390×701** — the usable height of a tab on a 390×844
phone, not the screen height — opens PRE with FRONT still to be measured, and
asserts the REAR row and the open controls both end above the dock, in bright
and in dark.

It has teeth: adding 80px to the section row fails both themes with the exact
overflow in the message. Restored after the check.

This is the first automated guard on a number that three rounds of design work
have each come within a few pixels of breaking.

| case | usable | needs | dock top | spare |
|---|---|---|---|---|
| PRE bright / dark | 701 | 556 | 556 | **0** |
| POST bright / dark | 701 | 552 | 556 | 4 |
| PRE bright / dark | 844 | 556 | 699 | 143 |
| POST bright / dark | 844 | 552 | 699 | 147 |

PRE still has **zero pixels** at 701. The new test is what keeps it there.

## 3. `--mt-brand` and `--mt-scrim` documented

The sheet's header comment now names all three additions, what each is for and
why, so Pro inherits the reasoning with the file:

- `--mt-primary-fill` — the solid primary surface, and why dark differs
- `--mt-brand` — the orange, header mark only, never a control
- `--mt-scrim` — the dialog backdrop, deeper in dark

## Tests

**289 pass / 0 fail** in the default suite (293 defined; the 4 browser tests
are opt-in), plus **2 browser fit tests** and **2 touch-drag tests** under
`BROWSER_TESTS=1`.
