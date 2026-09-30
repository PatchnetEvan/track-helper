# Review artifacts — PR 2, context header and About

Stacked on PR #74 at `a4b77d4e59ab649c33542614d18c55aa28c840fa`. `docs/` is in
`asset-boundary`'s `FORBIDDEN_ARTIFACTS`, so nothing here is published.

`01-before-after-320px-200pct.jpg` — the same app at 320px with 200% text,
before and after. Left: the tagline and Pro link fill the screen and the
rider's first field is off the bottom. Right: bike and session named, About
reachable, and the form starts immediately.

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
