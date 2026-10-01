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

---

## Correction round (owner review of #79 at `098bc9c`)

Three gaps, all real, plus stronger validation. Each is now covered by a test
through the real app, and each fix is mutation-killed.

### 1. An immediate refresh after a failed save duplicated the session

The first round's regression made an extra edit and flushed autosave before
refreshing — **and that extra step is what wrote `pendingId` to disk.** The
failed-save path itself never did, so a refresh within the debounce restored a
draft with no pending identity, and the retry minted a second id over a record
that had already landed.

The failed-save path now **persists the draft synchronously**, not on the
debounce. Tested with no intervening edit and no flush: write lands →
verification fails → immediate refresh → restore → retry ⇒ **one record**.

### 2. Other tabs' drafts could still be deleted or overwritten

Three holes, all closed:

- **`writeDraft` skipped its conflict check when `expectedRev` was null.** That
  is the most dangerous case, not the safest: a tab that has never read the key
  would flatten whatever another tab was keeping. A null expectation now only
  authorises a write when the key is genuinely empty or the stored draft is
  this tab's own.
- **`clearDraft()` had no guard at all.** Deleting is a mutation, and the most
  destructive one. It now takes an owner and a revision.
- **`markDraftSaved()` rewrites the key** and so could destroy another tab's
  work exactly as a write can. Same guard.

Plus: **a tab with auto-save off no longer touches the draft key**, which is
how one tab's Reset used to delete another tab's work.

### 3. A failed disposal could silently resurrect discarded work

`discardDraft()` swallowed deletion errors and reset its state as though
disposal had succeeded. It now **returns whether the draft is really gone** and
reports failure through a new status row — *"A discarded draft is still on this
device"*.

Identity is preserved two ways, because the first can itself fail:

1. A successful save **stamps the record's id into the draft before** disposal
   is attempted, so a draft left behind names what it became.
2. If even that write cannot land, restore **recovers identity from content**:
   a saved record that *is* this session names the id a re-save must use, so
   the store upserts onto it instead of minting a duplicate. The draft is never
   discarded on this path — the rider keeps their entries either way.

### Validation strengthened

Now rejected, each tested, each leaving the stored bytes untouched: an unknown
**stage name** (it was being handed straight to `showTab`), a session section
that is an **array** (passes `typeof "object"` and would spread into the form as
numeric keys), **feedback text** that is not a string, **tags** that are not a
list, a **tag** that is not a string, and **symptoms** that are not a list.

### Tests

**148 pass / 0 fail** (135 → 148). Mutation results for this round:

| mutation | result |
|---|---|
| failed save no longer persists identity | 1 fail |
| `writeDraft` permits a null `expectedRev` | 1 fail |
| `clearDraft` has no ownership guard | 2 fail |
| a total disposal failure is reported as success | 1 fail |
| no identity recovery from content | 1 fail |
| stage name unchecked | 1 fail |
| array sections accepted | 1 fail |
| feedback tags unchecked | 1 fail |
| *(control — unmutated)* | **0 fail** |

**Two equivalent mutants, recorded rather than counted as coverage.** Removing
the auto-save-off early return in `discardDraft` changes nothing observable,
because `clearDraft`'s ownership guard refuses the delete anyway — defence in
depth working as intended. Removing the pre-disposal id stamp likewise survives,
because content recovery covers it. Both layers are kept; neither is claimed as
tested on its own.

I also constructed four malformed mutants during this round (ambiguous anchors
matching two call sites, and a `false ||` edit that left the original condition
reachable). Each produced a passing run that looked like a survivor and was
not. Re-run with unique anchors before drawing any conclusion from a survivor.

### Still outstanding

- **Browser verification** of the new switch, the recovery messages and refresh
  behaviour. Not done: this round is Node-only.
- **Real-phone keyboard check**, separate as always.

---

## Correction round 2 — identity (owner review of #79 at `629e203`)

### The serious one: matching values are not identity

`idOfMatchingSavedRecord()` stripped `id` and `savedAt` and then adopted any
record whose remaining values matched. That is wrong in exactly the case the
product promises otherwise:

- **Copy to form** produces a draft whose values are, by construction,
  identical to the original. Copy → autosave → refresh → save would have
  **overwritten the original** instead of creating the separate session the
  rider was told it would create.
- **Two genuinely separate outings with the same entries** — same bike, track,
  label and pressures — would have **collapsed into one record**.

Content inference is **removed**. Identity now comes only from what was
recorded, and it is recorded **before history is written**:

1. `guardedSave()` claims the id and persists it into the draft **first**;
2. only then is the session written to history.

Anything in between — a crash, a refresh — leaves a record that the draft
already names. If that first write cannot land, the save still proceeds and the
limitation is **reported**: *"Saving, but this device could not record the
attempt"*, with the footer dropping its refresh promise. Nothing is inferred
from values.

### Remaining ownerless deletions, closed

`clearDraft()` no longer has an unguarded form at all — it throws if the caller
does not say which draft it means. Two call sites were still ownerless:

- **restore reconciliation** now names `{ writer, rev }` of the draft it
  actually inspected;
- **recovery discard** now names `{ raw }` — the exact bytes the rider
  downloaded — so a draft written between the download and the discard is not
  thrown away with them.

`markDraftSaved()` takes the same expectation, since it rewrites the key.

### A truthful footer

"A refresh brings your draft back" rested on the switch alone. It is now
derived from what is actually kept:

| condition | footer |
|---|---|
| auto-save off, or storage blocked | Refresh wipes the current session. |
| write outstanding (debounce) | Your most recent changes have not been kept yet. |
| write failed, unreadable, conflict, or attempt unrecorded | Your latest changes are not being kept right now. |
| on, nothing entered | Anything you enter is kept on this device. |
| on, kept and current | A refresh brings your draft back. |

### Tests

**157 pass / 0 fail** (148 → 157). The two regressions this round required:

- **Copy to form → refresh → save** ⇒ two records; the original is present and
  unchanged; the copy has its own id.
- **Two distinct outings with identical values** ⇒ two records with distinct
  ids; the first intact.

All seven mutants killed, control green — including the reported bug reinstated
as a mutant (killed by *both* new regressions), identity recorded after instead
of before history, `clearDraft` accepting a missing expectation, reconciliation
and recovery deleting whatever is stored now, and the two footer rules.

**A survivor that was my test's fault, not the code's.** The reconciliation-race
test stubbed `removeItem` to a no-op earlier in the same test, so **no deletion
could happen at all** and the mutant could not be distinguished. Restoring
`removeItem` before the race made it real. Same lesson as the earlier rounds:
confirm the mutation could have had an effect before reading a survivor as
coverage.

## Browser acceptance

Headless Chromium 152 via chromedriver, server on 127.0.0.1 only.
`measurements.json` holds the raw results; screenshots alongside.

| check | result |
|---|---|
| switch off by default | `aria-checked=false`, "Off · refresh clears the draft" |
| footer with it off | "Refresh wipes the current session." |
| switch on | `aria-checked=true`, "On · drafts kept in this browser" |
| during the debounce | status "Keeping draft…", footer "…have not been kept yet." |
| after the debounce | "draft kept on this device", footer promises the refresh, draft at rev 1 |
| **refresh recovery** | fields restored, status "Draft restored · not saved yet" |
| draft write fails | "draft could not be kept", footer "…not being kept right now." |
| unreadable draft | "a kept draft could not be read", **bytes untouched**, recovery offered, About explains it |
| turning it off | draft gone, switch off, footer back to "Refresh wipes the current session." |

## Still outstanding

**Real-phone keyboard check**, separate as always — none of this exercises an
on-screen keyboard.

---

## Correction round 3 — the footer's promise

### It must be about a draft that exists

"A refresh brings your draft back" was derived from *auto-save is on and
nothing has failed*. That is true in fewer moments than it looks: a draft has
just been discarded after every save, after every Reset, and before the first
write of a carried-over session. In all of those the promise was false.

The footer now requires a **verified, currently existing draft** —
`Store.readDraftState().kind === "ok"`, read at render time rather than
inferred.

### After Save only

A finished session is not a draft, and the honest thing to describe is what a
refresh would do with the form still on screen:

> **Session saved. Refresh clears the form; saved history remains.**

### The full rule

| condition | footer |
|---|---|
| auto-save off, or storage blocked | Refresh wipes the current session. |
| write failed, unreadable, conflict, attempt unrecorded | Your latest changes are not being kept right now. |
| **session just saved** | **Session saved. Refresh clears the form; saved history remains.** |
| nothing entered | Anything you enter is kept on this device. |
| changes outstanding (debounce) | Your most recent changes have not been kept yet. |
| **no draft actually stored** | Your most recent changes have not been kept yet. |
| verified draft present and current | A refresh brings your draft back. |

### A stale-footer defect the new test caught

The footer was being refreshed **after** `renderSaveStatus()`'s live-region
guard, which returns early when the status wording has not changed. So whenever
a draft disappeared without the status text moving — exactly the case above —
the footer kept its old promise. It is now refreshed before the guard.

That only surfaced because the first version of the new test was **masked by
`draftBehind`**: typing after deleting the draft made the "changes outstanding"
rule fire first, so the `draftExists` branch was never reached and two mutants
survived. Re-staging it as a re-render with no edit exposed both the mutants
and the real defect.

### Tests

**161 pass / 0 fail** (157 → 161), including the two required:

- **Save only → footer → immediate refresh**: footer reads "Session saved…",
  the draft is gone, and the refresh really does clear the form while the saved
  record remains.
- **Save & next → carried-over fields → draft write → refresh**: no promise
  while nothing is kept, the promise returns only once the carried-over draft
  is written, and the refresh brings back the carried-over session with the
  first record still the only saved one.

Mutants killed: the promise made without a verified draft, `draftExists`
inferred rather than read, the saved-session wording removed, `sessionSaved`
ignoring the recorded time, and the footer not refreshed when the status text
is unchanged (7 fail). Control green.

### Browser acceptance for this round

| step | footer | state |
|---|---|---|
| draft kept | A refresh brings your draft back. | status "draft kept on this device" |
| **after Save only** | **Session saved. Refresh clears the form; saved history remains.** | draft `null`, 1 saved |
| refresh after Save only | Anything you enter is kept on this device. | form cleared, 1 saved |
| **after Save & next** | Your most recent changes have not been kept yet. | bike carried, PSI cleared, draft `null`, label `Session 3` |
| carried draft written | A refresh brings your draft back. | draft rev 1 |
| refresh after that | A refresh brings your draft back. | bike + `31.0` + `Session 3` restored, still 1 saved |

---

## Correction round 4 — whose draft is it

### The stored draft has to be THIS form's

`draftIsStored()` asked only whether *a* readable draft existed. Another tab
replacing the key leaves a perfectly readable draft — just not this form's — so
the promise survived a takeover and would have offered to restore someone
else's session instead of the entries on screen.

It now matches **this tab's writer and the revision it last verified**:

```js
st.kind === "ok" && st.draft.writer === TAB_ID && st.draft.rev === _lastSeenRev
```

Neither half is sufficient on its own, and both are tested: a draft with our
revision but a different writer, and one with our writer but a revision we
never wrote, are both rejected.

### The claim is re-checked when another tab moves the key

A `storage` listener on the draft key re-renders the status and the footer.
Without it the claim was only re-checked when something happened *in this tab*,
so a tab left sitting idle went on promising a recovery that no longer existed.

The status is gated on the same verified fact as the footer, so neither can
claim protection the other has withdrawn:

> **Not saved yet · this draft is no longer kept on this device**

### Tests

**165 pass / 0 fail** (161 → 165). The required scenario:

> A keeps a draft → B replaces it → **A makes no edit** → A's recovery promise
> disappears, A's status stops claiming the draft is kept, and **B's bytes are
> exactly as B left them**.

Plus: another tab deleting the key, a same-revision/different-writer draft, a
same-writer/unknown-revision draft, and A regaining the promise once it writes
its own draft again.

All five mutants killed, control green: any stored draft counting as ours (the
reported bug), writer ignored, revision ignored, no storage listener (4 fail),
and the status not gated on presence.

The harness now propagates **real storage events between windows** — a write
notifies every other window and never the one that made it, as a browser does —
so these are genuine cross-tab tests rather than simulated ones.

### Browser acceptance, two real tabs

| step | tab A | tab B |
|---|---|---|
| A keeps a draft (rev 1) | "A refresh brings your draft back." / "draft kept on this device" | — |
| B loads and writes (rev 2) | — | writes "Tab B bike" |
| **back to A, no edit, no navigation** | **"Your most recent changes have not been kept yet." / "this draft is no longer kept on this device"**, form still shows "Tab A bike" | — |
| B's bytes | **untouched** | still "A refresh brings your draft back." |

Screenshot: `11-A-after-B-took-over.png`.
