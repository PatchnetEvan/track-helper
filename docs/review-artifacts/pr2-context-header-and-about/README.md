# Review artifacts — PR 2, context header and About

Stacked on PR #74 at `a4b77d4e59ab649c33542614d18c55aa28c840fa`. `docs/` is in
`asset-boundary`'s `FORBIDDEN_ARTIFACTS`, so nothing here is published.

| file | shows |
|---|---|
| `01-before-after-320px-200pct.jpg` | The same app at 320px/200%, before and after. Left: tagline and Pro link fill the screen, first field off the bottom. Right: bike and session named, About reachable, form starts immediately |
| `02-long-labels-320px-200pct.jpg` | Deliberately long bike, track and session values at 320px/200% - every line wraps inside the column, nothing clipped, no sideways scroll |

## The `[hidden]` bug, and why it mattered

`.context-line` is `display: flex`, and a stylesheet `display` beats the
`[hidden]` attribute's UA `display: none`. The "hidden" empty context line
therefore stayed in the layout as an empty gap - invisible, but occupying
space at the top of every screen before the rider types anything.

Fixed with `.context-line[hidden] { display: none; }`. Measured empty: height
**0px**, computed display `none`.

### Five state transitions, all measured

| # | scenario | hidden | display | height | text |
|---|---|---|---|---|---|
| 1 | empty fields | `true` | `none` | 0px | - |
| 2 | populated | `false` | `flex` | 28px | `Yamaha R6 / Barber - Session 3` |
| 3 | cleared again | `true` | `none` | 0px | - |
| 4 | load a saved session | `false` | `flex` | - | overwrote `DIFFERENT BIKE...` with the loaded values |
| 5 | Save & next | `false` | `flex` | - | auto-bumped `Session 3` to `Session 4` |

4 and 5 are the cases that would silently rot: both write with `setId` /
`.value` and fire no `input` event, so the header only follows because
`renderContext()` is called at each site.

### Long values at 320px, 200% text

`Kawasaki Ninja ZX-10RR Winter Test Mule` / `Circuit de Barcelona-Catalunya ·
Qualifying Practice Session Number Twelve`:

- no horizontal clipping on either span
- the line stays within the header's bounds
- the document does not scroll sideways
- header reaches 622px - and scrolls away, because it is in the document
  flow. The sticky region stays **67px (10%)** and the first field stays
  reachable. A 622px sticky header would have left nothing to work in, which
  is the whole reason the header came out of `sticky`.

## The sticky fix, measured

`.tabs` was `position: sticky; top: 64px` — a hard-coded guess at the header
height that was wrong at every text size above 100%.

The fix is not a better guess. The tall header is no longer sticky at all, so
there is no height left to track and the correct offset is simply `0`. This is
what the handoff asks for: the context header sits "in the document flow".

At 320px, 200% text:

| | before | after |
|---|---|---|
| header height | 419px | 248px |
| header position | `sticky` | `static` |
| `.tabs` top | `64px` | `0` |
| **sticky region** | **486px** | **67px** |
| share of a 660px viewport | **74%** | **10%** |
| first field top | 669px | 439px |

Measuring the offset alone would have prevented the overlap and still left
486px of pinned chrome on a phone. The region had to get smaller, not better
aligned.

## Verified

Real nested viewports at 390px, 320px and 1024px, each at 100% and 200% text:

- `.app-header` is `static`, `.tabs` is `sticky` at `top: 0`, sticky region
  67px (10% of viewport) in all six combinations
- the first field always sits below the tab strip and on screen
- the context line renders the typed values and never clips

Context header:

- shows `Yamaha R6` / `Barber · Session 3` from `#bike`, `#track` and
  `#session-label` — the rider's own text, shown exactly as entered
- hidden entirely when those fields are empty; nothing is derived or invented
- re-rendered after `loadSession` and after Save & next, because both write
  with `setId`/`.value` and fire no `input` event
- no stage chip and no save-status line: PRE/POST state arrives in PR 4 and
  the status rules in PR 5, and neither can be shown truthfully yet
- type converted to `rem` (1.125 / 0.9375 / 0.75) so it scales with the
  rider's text size. The handoff's type table gives 18/15/12px, but its
  "Glove, sun, text size" rule says keep rem; at the 16px default these are
  the same numbers. Measured growing 19px to 36px at 200%.

About consolidation:

- tagline, Pro link, Feedback entry and the backup controls all moved in
- Feedback's gating preserved: it still ships `hidden` and is revealed only
  after `GET /api/feedback` confirms the backend. Verified still hidden with
  no backend present
- backup controls moved with their ids, so handlers and confirmations are the
  same code — `git diff` shows no change to any of them in `app.js`
- `Clear all history` still asks before deleting and still names the count
- the About button takes keyboard focus, activates by keyboard, and moves
  focus to the panel heading so a keyboard or screen-reader user lands in the
  content
- selecting another tab returns normally; About is the existing panel, not a
  new surface

## One thing found and fixed during verification

At 320px/200% the brand alone is 213px, which pushed the About button off the
right edge (`right` 329 against a header edge of 305). Since that button is
the only way into About, Feedback and the backups, the header row now wraps
and About drops onto its own line rather than being clipped.

## Not verified

The destructive `Clear all history` path was not exercised end to end. An
attempt to stub `window.confirm` inside the harness did not take on the
iframe's window, a real modal blocked the renderer, and the tab had to be
closed. It is covered statically instead: `git diff` against the PR #74 head
shows no change to the handler or its confirmation text, and the ids moved
intact.
