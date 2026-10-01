# PR 6 — opt-in auto-save and refresh recovery

App version `0.1.0-beta.7`. Stacked on PR #78. Nothing deployed, nothing merged.

## Separate keys, which is the safety property

Drafts live under **`mototrack.draft.v1`**. Nothing on the draft path reads or
writes `mototrack.sessions.v1`, so a failing or unreadable draft can never
damage saved history, and an unreadable history can never cost the rider the
outing in front of them. A test asserts saved history is byte-for-byte
untouched across a full draft lifecycle.

A draft is separate in every visible sense too: it never appears in the
saved-session list, never has a `savedAt`, and the backup export still contains
saved sessions only.

## Opt in, off by default

`mototrack.autosave`, default `false`. With it off the app behaves exactly as
before and a refresh clears the form — handoff non-negotiable #3. The About
switch uses `role="switch"` / `aria-checked`, with the handoff's sub-lines, and
the footer stops promising "Refresh wipes the current session" once drafts are
being kept.

Turning it off discards the kept draft so that sub-line stays true, confirming
first **only when there is actually something to discard**.

## The six safeguards

### 1. "Kept" is a claim about the current revision

Every edit bumps `editSeq`; a write that is read back and matched sets
`keptSeq` **to the sequence that was written**, not to "now".

| moment | status |
|---|---|
| during the 800ms debounce | **Keeping draft…** |
| after a verified write | **Not saved yet · draft kept on this device** |
| after a further edit | back to **Keeping draft…** |

A previous success never speaks for later edits. An edit made *during* the
write is covered by its own test: the interleaved keystroke leaves the status
at "Keeping draft…" rather than claiming the stale revision is kept.

### 2. Pending writes are cancelled before the actions that discard or move on

`cancelDraftWrite()` runs before **Save**, **Reset**, **turning auto-save off**,
**Copy to form** and **Save & next**. Tested: after each, `clock.pending()` is
0 and flushing the clock afterwards does not resurrect the draft or land the
previous session on the next one.

### 3. A draft that cannot be deleted never returns as unsaved work

A successful save stays successful — clearing the draft is best effort and
cannot turn it into a failure. If the clear fails, the draft is stamped with
`savedAs: <session id>`, and a draft carrying `savedAs` whose record is in
history is **reconciled and removed on load, never restored**.

**Only `savedAs` counts.** A `pendingId` must not, because that is precisely
the unverified write the rider is owed their entries back for — and restoring
it cannot duplicate anything, since the retry writes under the same id and
`Store.put` upserts.

### 4. Pending save identity survives a refresh

The draft carries `pendingId`, and `saveState.adoptPendingId()` takes it back
on restore. The required scenario is tested end to end:

> write succeeded → verification failed → refresh → restore → retry
> ⇒ **exactly one saved record**, under the original id, with matching content.

### 5. The whole draft shape is validated before anything is restored

`validateDraft()` checks the version, revision, writer, timestamp, the stage
flags as real booleans, `pendingId` / `savedAs` types, and every part of the
session object. Anything invalid or of an unsupported version is **left exactly
where it is** — not restored, not parsed past, and **not overwritten**: writing
is suspended over it, so the first keystroke after a failed restore cannot
destroy recoverable text. Six shapes are tested, each asserting the stored
bytes are unchanged afterwards.

Resolution is the recovery-copy path from PR 5:
`mototrack-DRAFT-RECOVERY-UNREADABLE-….txt`, the original bytes, never
re-serialised.

### 6. Two tabs do not overwrite each other

Every draft carries `rev` and a per-tab `writer`. A write passes the revision
this tab last saw; if the stored draft has moved on and was written by another
tab, the write is **refused**. The other tab's work is preserved and this tab
says so — **"Not saved yet · another tab is keeping a draft"** — rather than
claiming its own edits are kept.

## Stage state is restored exactly as recorded

`postUnlocked` and `preEditable` are stored and reapplied. Coming back in is
not undone by a refresh, and a PRE the rider had reopened with **Correct PRE**
stays reopened with POST still open. Both are tested.

## Status wording

| condition | text |
|---|---|
| storage unavailable | Not saving · this browser blocks storage |
| session save failed | Not saved · try Save again |
| kept draft unreadable | Not saved yet · a kept draft could not be read |
| another tab holds the draft | Not saved yet · another tab is keeping a draft |
| draft write failed | Not saved yet · draft could not be kept |
| session saved | Saved on this device · HH:MM |
| draft just restored | Draft restored · not saved yet |
| write pending | Keeping draft… |
| draft kept | Not saved yet · draft kept on this device |
| auto-save off, content | Not saved yet · REVIEW saves it |
| nothing entered | *(hidden)* |

A kept draft is **never** described as saved, and the forbidden-vocabulary
guard still applies — no cloud, sync, queue or backup language.

## Tests

**135 pass / 0 fail** (108 → 135). 27 of them are in
`tests/draft-autosave.test.js`, driving the real `public/app.js` with a
**captured clock**, so the debounce and cancellation boundaries are exercised
rather than assumed, and with a **shared storage** so a second `bootApp()` is a
real refresh — and a real second tab.

Mutation results, after closing the gaps the first round exposed:

| mutation | result |
|---|---|
| `behind` ignores outstanding edits | 2 fail |
| write records "now" instead of the sequence written | 1 fail |
| Reset no longer cancels the timer | 1 fail |
| a failed clear is not stamped with `savedAs` | 2 fail |
| `pendingId` not carried into the draft | 1 fail |
| `pendingId` not adopted on restore | 1 fail |
| validation accepts any version | 1 fail |
| unreadable draft does not suspend scheduling | 1 fail |
| no revision guard between tabs | 1 fail |
| stage flags not restored as recorded | 2 fail |
| *(control — unmutated)* | **0 fail** |

**One equivalent mutant, recorded rather than papered over.** Removing the
`cancelDraftWrite()` at the top of `advanceToNextSession` changes nothing
observable, because `discardDraft()` later in the same function also cancels
and `clearTransientFields()` dispatches no events. The explicit early cancel is
kept because it states the intent and would matter if that ever changed, but it
is not covered by a test and should not be counted as if it were.

A first mutation round also found a **dead `current` getter** on the draft
state — nothing read it, so no test could bite on it. Removed rather than left
as untested surface.

## Outstanding — real-phone keyboard check

Unchanged and still open. Everything here is Node and headless; none of it
exercises an on-screen keyboard. On a device: focus a PSI field so the keyboard
opens, confirm the focused field stays reachable and the dock's state matches
its measured size.
