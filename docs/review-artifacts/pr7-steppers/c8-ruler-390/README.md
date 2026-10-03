# C8 revised — pressure ruler, 390px (`0.1.0-beta.10`)

Front above Rear, one tire per row, in PRE and POST. Click fields keep their
plain −/+ steppers.

## Decisions as implemented

**Out-of-range handling**, defined before coding: a typed value outside 10–45 is
shown verbatim and never rewritten. The strip pins at the nearest end and is
marked out of range, dragging is inert (there is no position to snap from), and
−/+ move it **only toward** the range. Once inside, normal behaviour resumes.

**10–45 is the interaction range only.** It holds the ruler's ends; it is not
validation and it never touches typed input.

**A reference is not a measurement.** Both PRE and POST start **blank**. The
reference prints beside the value ("last 31.0") and gets its own dim tick on the
strip, but no field is ever populated from history or from PRE. Verified live:
with a matching prior session present, PRE showed `—psi` / `last 31.0` with an
empty field, and POST showed `—psi` / `last 34.0` with an empty field.

**References match the same bike and the same tire fitment** — bike, brand and
model all equal, most recent saved session wins. If any of those is blank, or
nothing matches, the reference is omitted rather than approximated. A different
bike or a different tire is never used.

**Dim reference tick** uses `--text-dim`, an existing token.

**Enlarged text is intrinsic** — the value and reference wrap to their own lines
via `flex-wrap`, not a 150% threshold. At 200% the ruler stays 64px tall, the
head wraps, and there is no page-level horizontal scroll.

## Verified behaviours

| check | result |
|---|---|
| one notch = 0.5 psi = 32px | `psiFromDrag(31.0, 32)` → `31.5`; 8px → `31` (snaps back); 20px → `31.5` |
| no inertia | no `setInterval`, `setTimeout` or `requestAnimationFrame` in the ruler wiring, asserted |
| vertical scroll not captured | `(0,40)`, `(6,40)`, `(30,40)` and `(8,2)` all leave the gesture to the page |
| horizontal taken over | `(11,2)`, `(-40,10)`, `(40,39)` captured |
| pointer cancellation | `pointercancel` and `lostpointercapture` release capture and end the drag, leaving the control usable with whatever was committed |
| ends hold | `rulerStep("45", +1)` → null; `("10", −1)` → null |
| typed 50 | `+` → null, `−` → `49.5` — preserved, may only walk back in |
| keyboard | Arrow ±0.5, PageUp/PageDown ±1.0, `role="slider"` with `aria-valuemin/max/now/valuetext` |

## A CSP bug caught in review

The first version drew the ticks with `innerHTML` carrying inline `style`
attributes. `log/index.html` sets **`style-src 'self'`**, so those attributes
were dropped: the ticks rendered 0×0 with no background and the whole-PSI
labels collapsed into one unreadable run of digits (`2728293031323334`). The
handoff warns about exactly this. Rebuilt with `createElement` and the CSSOM —
setting `el.style.left` from script is not what that directive blocks — with
colour and size coming from classes.

## Tests

**227 pass / 0 fail** (215 → 227). Twelve new in `tests/pressure-ruler.test.js`
covering the range, drag maths, scroll-intent lock and reference matching.

## Not changed, by instruction

Items 2, 3, 5 and 6 were already implemented in `a16feed` and are untouched.
Both REVIEW save choices remain, and the status copy stays
*"Not saved yet · REVIEW saves it"*.
