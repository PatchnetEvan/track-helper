# PR 7 — steppers

App version `0.1.0-beta.8`. Stacked on PR #79. Nothing deployed, nothing merged.

## Scope

Eight fields get a minus/plus pair. Preload is deliberately left typed — its
unit is `turns / lines`, and a wrong increment on a suspension setting is worse
than no stepper.

| field | unit | step | precision |
|---|---|---|---|
| `front-pre`, `rear-pre`, `front-post`, `rear-post` | PSI | 0.5 | the rider's own |
| `fork-comp`, `fork-reb`, `shock-comp`, `shock-reb` | clicks | 1 | the rider's own |

Every `id`, label, unit and `inputmode` is unchanged; typing still works; the
saved-session schema, CSP, framework-free build are untouched.

## A correction to the plan

The plan said pressure steppers would "normally start populated". **That was
wrong.** `clearTransientFields()` clears all four pressures on Save & next and
keeps only the clicks, so after Save & next the **PSI steppers are disabled**
(blank) and the **click steppers stay enabled** (carried over). Verified rather
than assumed, and asserted by a test.

## Precision

Integer-scaled arithmetic at the greater of the value's and the step's decimal
places, so the rider's precision survives and nothing is snapped to a grid:

| from | step | to |
|---|---|---|
| `30` | +0.5 | `30.5` |
| `30.25` | +0.5 | **`30.75`**, not `30.8` |
| `30.1` | +0.5 | `30.6` (plain float gives 30.599999999999998) |
| `30.125` | +0.5 | `30.625` |
| `8.5` | +1 | **`9.5`** — a fractional click is never rounded to an integer |

Reversibility is asserted for every case: `+step` then `−step` returns the
original number.

**Honest note on the arithmetic.** A mutant replacing the integer scaling with
plain float arithmetic **survives**, because the `toFixed(places)` formatting
already rounds the error away — I searched 1.8M random value/step/direction
combinations and found no input where the two differ. The integer path is kept
because it does not depend on the formatting to be correct, but it is **not**
doing load-bearing work today and is not claimed as tested.

## Blank, unreadable, and the zero guard

- **Blank stays blank.** Both buttons are disabled; a press writes nothing; the
  field never becomes `0`; unknown stays distinct from zero.
- **Unreadable text is left exactly as typed.** `about 30` disables the buttons
  and survives a press untouched.
- **A decrement may not cross below zero.** This is an *entry guard*, not an
  opinion about operating range: it refuses rather than clamps, it never
  rewrites a manually typed value, and increments are always allowed. A typed
  `-2` stays `-2`, refuses to go to `-2.5`, and steps up to `-1.5`.
- A refused step **marks nothing dirty and schedules no draft write.**

## Buttons

64×64 minimum (grows to 74×106 at 400% text), radius 10, 8px apart, visible
`−` and `+`. Sixteen distinct field-specific accessible names, each naming the
direction, the step and the unit — *"Increase front pre-session PSI by 0.5
PSI"*, *"Decrease fork compression by 1 click"*.

The buttons sit **outside** the `<label>`, deliberately: inside it, activating
one counts as activating the label and focuses the input, raising the on-screen
keyboard the stepper exists to avoid. Focus stays on the pressed button, so
repeated taps keep stepping.

## One activation, one increment

Click only — no `pointerdown`, `mousedown`, `touchstart`, `setInterval` or
repeat anywhere in the wiring, asserted by a test. Enter and Space each produce
exactly one step, since the browser reports them as a click.

## Enabled state and the edit signal

`syncSteppers()` runs from `renderPreEditable()` — which is already the single
place the PRE lock is applied, and is called on restore, Correct PRE, Copy to
form, Reset, Save & next and at init — plus on every edit. Handler and button
read the **same** `stepperUsable()`, so a disabled-looking button can never
still work.

A real change dispatches the existing bubbling `input` event, so dirty
tracking, the save status, the footer and the 800ms draft write all follow.
**No second persistence path.**

## Two pre-existing overflow defects found and fixed

Neither is caused by the steppers; both were exposed by measuring PRE at large
text, which earlier rounds never did (PR 5's check covered DAY).

- **`.grid-2` kept two columns at any text size**, so a pair of fields was
  ~120px wide at 400% and pushed the page sideways. Now
  `repeat(auto-fit, minmax(min(100%, 8rem), 1fr))` — two columns while they
  fit, one when the rider's text makes them too narrow, decided intrinsically
  rather than by a viewport guess.
- **The Tools summary's heading and sub-line** are flex items with no
  `min-width`, so they could not shrink. Same cause as the status text, the
  context spans and the grid tracks — fourth instance of that bug class.

## Tests

**195 pass / 0 fail** (171 → 195). 24 new in `tests/steppers.test.js`, driving
the real `public/app.js`.

Mutants killed: snapping to the step grid (4 fail), the zero guard removed
(3), the zero guard clamping instead of refusing (3), blank treated as zero,
the handler ignoring `readOnly`, a refused step firing the edit signal, and
focus moving to the input.

**Three equivalent mutants, recorded rather than counted:**

- plain float arithmetic — see the honest note above;
- rounding clicks to integers when `places === 0` — unreachable, because
  `places` is only 0 when the value is already an integer;
- removing the explicit `syncSteppers()` after Save & next — `renderPreEditable()`
  already resyncs there. The explicit call is kept for intent.

## Browser acceptance

Headless Chromium 152 via chromedriver, server on 127.0.0.1 only. Text sizes
are multiples of the browser's **actual 17px default**.

| width | text | minus | plus | label clipped | value clipped | page scrolls sideways | focused input reachable |
|---|---|---|---|---|---|---|---|
| 320 | 100% | 64×64 | 64×64 | no | no | **no** | yes |
| 320 | 200% | 64×64 | 64×64 | no | no | **no** | yes |
| 320 | 400% | 74×106 | 74×106 | no | no | **no** | yes |
| 390 | 100% | 64×64 | 64×64 | no | no | **no** | yes |
| 390 | 200% | 64×64 | 64×64 | no | no | **no** | yes |
| 390 | 400% | 74×106 | 74×106 | no | no | **no** | yes |

Behaviour, in the browser:

| check | result |
|---|---|
| `30.25` +0.5 | `30.75` |
| `30.1` +0.5 then −0.5 | `30.6` → `30.1` |
| `8.5` +1 | `9.5` |
| blank | buttons disabled, field still blank |
| `about 31` | buttons disabled, text untouched |
| `0` −1 | stays `0` |
| typed `-2` −0.5 | stays `-2` |
| keyboard | focusable, tabbable, one press = one step, **focus stays on the button**, input never focused |
| read-only PRE | buttons disabled, value unchanged, POST still usable |
| after Correct PRE | re-enabled |
| autosave | a step → "Keeping draft…" → draft holds `30.5` |
| restored draft | value `30.5`, stepper usable with no edit |
| calculations | `calc-tires` runs on stepped values |

## Outstanding

**Real-phone glove and keyboard verification remains outstanding.** Everything
here is a headless desktop viewport: it cannot tell whether a 64px button is
comfortable in gloves, nor whether the on-screen keyboard stays down across
repeated taps on a real device. That is the check this PR most needs, because
avoiding the keyboard is its entire purpose.

---

## Correction round — the numeric-input contract

`Number()` is far more generous than this stepper can be, and availability was
asking `Number.isFinite()` while the arithmetic asked `decimalsOf()`. Those two
disagree, and the gap was not theoretical. At `57a5978`:

| typed | `Number()` | stepped by +0.5 | what went wrong |
|---|---|---|---|
| `1e-2` | 0.01 | **`0.5`** | the rider's 0.01 silently discarded — no decimals to count |
| `0x1A` | 26 | **`26.5`** | a hex entry rewritten as decimal |
| `0b101` | 5 | **`5.5`** | same |
| `30.123456789012345678` | 30.123456789012344 | **`30.623456789012344359`** | invented digits from unsafe scaling |
| `999999999999999999999` | 1e21 | **`"1e+21"`** | wrote a value the parser would then refuse |

### One rule, shared

`stepPlan(text, step)` is now the single decision, used by `stepValue` **and**
by the buttons through `canStep()`. A button can no longer look available while
the arithmetic would mangle the value.

It accepts **ordinary decimal notation only** —
`/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/` — and then refuses anything it cannot hold
exactly:

- more than 12 decimal places (`toFixed` throws above 100, and scaled
  arithmetic stops being exact long before);
- a scaled value, step, sum or difference outside `Number.MAX_SAFE_INTEGER`;
- a result that is not finite, or whose text would not itself be ordinary
  decimal notation.

Unsupported text is **left exactly as typed**, both buttons are disabled, and
nothing is marked dirty or written. Direct typing and existing saved values are
untouched — the parser governs the stepper, never the field.

### Tests

**214 pass / 0 fail** (195 → 214). Nineteen new, covering all four required
regressions plus a consistency test asserting button availability and the step
rule can never disagree across a mixed set of inputs.

Mutants killed: the notation check removed — the reported bug — (9 fail), the
regex widened to accept exponents (5), the decimal-places ceiling removed (1),
and both safe-integer guards removed together (4).

**Two notes on method.** Removing *one* of the two safe-integer guards survives,
because the other still catches it; the honest mutant removes both, and that
one fails. And the output re-check is an **equivalent mutant** — `toFixed` only
returns exponential notation at magnitudes the safe-integer guards have already
refused, so it is unreachable defence in depth. It is kept and not counted as
covered.

A case was chosen specifically to isolate the safe-integer guard:
`999999999999.9999` has four decimals (inside the ceiling) and an
ordinary-notation result, but scaled by 10⁴ it lands beyond
`Number.MAX_SAFE_INTEGER`.

### Browser verification

| typed | buttons | value after pressing both | exception |
|---|---|---|---|
| `1e-2`, `1E3`, `0x1A`, `0b101` | disabled | unchanged | none |
| `30.123456789012345678` | disabled | unchanged | none |
| `999999999999999999999` | disabled | unchanged | none |
| `999999999999.9999` | disabled | unchanged | none |
| `1,500`, `Infinity` | disabled | unchanged | none |

`30.25` → `30.75` → `30.25` still round-trips, and pressing a disabled stepper
on an unsteppable value left the kept draft byte-identical with the status
still reading "draft kept on this device".
