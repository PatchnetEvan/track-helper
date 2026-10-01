# PR 5 — browser acceptance

Run in **headless Chromium 152.0.7977.82** driven by **chromedriver 152** over
the W3C WebDriver protocol, against a static server bound to **127.0.0.1 only**.
Nothing was installed and nothing was exposed.

`measurements.json` holds every raw figure; the tables below summarise it.

## The baseline is 17px, not 16px

The browser's actual default root font-size here is **17px**. The enlargement
runs are multiples of that real default, not of an assumed 16:

| label | root font-size |
|---|---|
| 100% | 17px |
| 200% | 34px |
| 400% | 68px |

An earlier round used 16/32/64 and was therefore slightly under at every step.

## Three overflow defects found and fixed

All three were the same cause — **a box that cannot shrink below its content,
so `overflow-wrap` never gets a chance** — and all three were found only by
rendering at 320px/400%.

| # | element | why it could not shrink | fix |
|---|---|---|---|
| 1 | the status text | a bare text node in a flex container is an anonymous flex item with `min-width: auto` | gave it its own `<span class="save-status-text">` with `min-width: 0` |
| 2 | `.context-bike`, `.context-where` | flex items in `.context-line`, same `min-width: auto` | `min-width: 0` on each |
| 3 | `.grid-2` / `.grid-3` columns, and `h2` / `h3` | `1fr` grid tracks have `min-width: auto`; Orbitron headings had no break opportunity ("Session" alone is wider than a 320px phone at 68px) | `repeat(n, minmax(0, 1fr))`, and `overflow-wrap: break-word` on headings |

**Nothing is hidden and no font is scaled down to make a measurement pass.**
The full wording stays, the text scales with the rider's setting, and the icons
scale with it. Long words wrap; they are never clipped.

## Results — 48 combinations, zero failures

2 widths × 3 text sizes × 2 label lengths × 4 messages.

**No text clipping anywhere. No page-level horizontal scrolling anywhere.**
Verified by actually attempting to scroll (`documentElement.scrollLeft = 500`,
then reading it back), not only by comparing `scrollWidth`.

| width · text | doc scrollW / clientW | page can scroll sideways | stage bar scrolls itself |
|---|---|---|---|
| 320 · 100% | 320 / 320 | no | no |
| 320 · 200% | 320 / 320 | no | yes |
| 320 · 400% | 320 / 320 | no | yes |
| 390 · 100% | 390 / 390 | no | no |
| 390 · 200% | 390 / 390 | no | yes |
| 390 · 400% | 390 / 390 | no | yes |

The stage bar scrolling itself is by design, and is excluded from the
page-level requirement.

### The four messages, with long bike / track / session labels

Every state wraps rather than clipping, keeps its icon mask, and uses the right
token colour.

| width · text | unsaved | saved | failed | blocked |
|---|---|---|---|---|
| 320 · 100% | 1 line | 1 | 1 | 1 |
| 320 · 200% | 2 | 2 | 2 | 3 |
| 320 · 400% | 6 | 5 | 5 | 6 |
| 390 · 100% | 1 | 1 | 1 | 1 |
| 390 · 200% | 2 | 2 | 2 | 2 |
| 390 · 400% | 4 | 4 | 3 | 5 |

Colours: unsaved `rgb(160,168,179)` (`--text-dim`), saved `rgb(0,255,136)`
(`--good`), failed and blocked `rgb(251,191,36)` (`--warn`). Icon masks
resolved in every case (`circle-dashed`, `check`, `triangle-alert`), sized with
the text (16.7 → 33.5 → 66.9px).

Messages verified verbatim:

- `Not saved yet · REVIEW saves it`
- `Saved on this device · 09:06 AM`
- `Not saved · try Save again`
- `Not saving · this browser blocks storage`

### Status-only header growth — corrected method

The earlier figure compared an **empty** header with a **populated** one, so it
included the context line's own content. This measures the same populated
fields with the status line forced off, then on:

| width · text | header without status | with status | **status only** |
|---|---|---|---|
| 320 · 100% | 107 | 133 | **+26px** |
| 320 · 200% | 314 | 400 | **+86px** |
| 320 · 400% | 863 | 1350 | **+488px** |
| 390 · 100% | 107 | 133 | **+26px** |
| 390 · 200% | 196 | 282 | **+86px** |
| 390 · 400% | 752 | 1079 | **+327px** |

The delta is **identical for short and long labels** at every size, which is
what tells us the measurement now isolates the status line.

## Dock and reachability

Judged by usable space and whether inputs can actually be reached — not against
a fixed expectation at a particular percentage.

| width · text | dock | bar | usable free (of 844) | dock in flow | all inputs reachable |
|---|---|---|---|---|---|
| 320 · 100% | 148 | 60 | 636 | no | **yes** |
| 320 · 200% | 378 | 100 | 744 | yes | **yes** |
| 320 · 400% | 1561 | 178 | 666 | yes | **yes** |
| 390 · 100% | 108 | 60 | 676 | no | **yes** |
| 390 · 200% | 298 | 100 | 744 | yes | **yes** |
| 390 · 400% | 1056 | 178 | 666 | yes | **yes** |

The dock enters document flow exactly when its measured size requires it, and
never keeps less than 636px of 844 usable. All seven DAY inputs were focused in
turn and stayed clear of both the dock and the bar at every combination.

## Screenshots

`wWIDTH-TEXTSIZE-LABELS-STATE.png`, for example `w320-400-long-unsaved.png`
(320px, 400% text, long labels, unsaved) — the case that exposed all three
overflow defects and now shows the bike name wrapping cleanly.

## Still outstanding — real-phone keyboard check

Everything here is a headless desktop viewport. **None of it exercises a real
on-screen keyboard**, and the earlier "keyboard" figures were a simulated
viewport reduction. On a device: focus a PSI field so the keyboard opens, then
confirm the focused field stays reachable and the dock's state matches its
measured size.
