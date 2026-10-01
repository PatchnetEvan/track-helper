# PR 5 — save status line

App version `0.1.0-beta.6`. Stacked on PR #77. Nothing deployed, nothing merged.

## What it says, and when

One line under the context header, hidden entirely when there is nothing true
to say. It holds **no state of its own** — every word is derived from the save
state PR 4 already keeps, so it cannot drift from what actually happened.

| precedence | condition | text | tone |
|---|---|---|---|
| 1 | storage unavailable | **Not saving · this browser blocks storage** | warn |
| 2 | last attempt failed | **Not saved · try Save again** | warn |
| 3 | saved, with a recorded time | **Saved on this device · 17:38** | good |
| 4 | the session has content | **Not saved yet · REVIEW saves it** | dim |
| 5 | nothing entered, nothing saved | *(hidden — costs no height)* | — |

A failed save **names no cause**. The app cannot tell a quota error from
private-mode eviction from a write that silently did not land, so it reports
the fact and the action and nothing more.

## "Saved" is never optimistic

`doSave()` now:

1. claims an id from the save state — **reusing a pending one** if a previous
   attempt wrote but could not be verified;
2. writes through the new `Store.put`, an upsert, so a retry **reconciles that
   record in place** rather than appending a second copy of the same outing;
3. reads the record straight back and compares it **by content**, not only by
   id;
4. claims "Saved on this device" only if that comparison matches.

A write that throws, a write that silently does not land, and a write that
lands as something else are all reported the same way to the rider: not saved,
try again. In every case the entries are retained.

## The four actions

| action | status afterwards |
|---|---|
| **Save only** — verified | Saved on this device · HH:MM |
| **Save only** — any failure | Not saved · try Save again; every field retained |
| **Save & next** | the **new** session: Not saved yet. `advanced()` clears `lastSavedAt`, so the predecessor's Saved can never be inherited |
| **Save & next** after a plain Save | advances without a second write, and still reports the new session as Not saved yet |
| **Save & next** — failure | nothing written, label **not** advanced, nothing cleared, stays on REVIEW |
| **Reset** | hidden — an empty form reports nothing |
| **Copy to form** | Not saved yet. A copy of a saved session is not itself saved |

## What cannot change the status

The comparison selectors and the calculators' working inputs do not mark the
form dirty (PR 4's correction), and the status reads save state rather than the
DOM — so this holds by construction. It is covered by tests through the wiring
anyway, because that is the gap that let the last two bugs through.

Content detection reads the **saved session**, not the form, and deliberately
excludes `setup.geometryConstants`: a wheelbase typed into the geometry tool
must not make an otherwise empty session look like unsaved work. **Rider
Feedback text and tags do count** — they are the rider's own words.

## Claims it never makes

A test asserts the status vocabulary never contains `synced`, `cloud`,
`backed up`, `uploading`, `queued`, `offline`, `draft saved`, `recovered` or
`autosaved`. None of those capabilities exist in Log, and this is a standing
guard against a later edit promising one casually.

## Size and accessibility

- One `<p>` under `#context-line`; **hidden outright** when state 5 applies, so
  a fresh load costs zero height.
- It **wraps** at enlarged text rather than being clamped to one line or
  shrunk — `overflow-wrap: break-word`, `line-height: 1.35`, no truncation and
  no reduced font size.
- `role="status"` with `aria-live="polite"`: advisory, not an alert.
- **Text is written only when the status actually changes.** A polite live
  region re-assigned on every keystroke would announce on every keystroke.
- Status is recomputed on the dirty *transition* only, not per keystroke, so
  `collectSession()` is not run on every character.
- It is a text line, never a button, per the handoff's control roles.

## Tests

**84 pass / 0 fail** locally (58 before, plus 26 new).

- `tests/session-progress.test.js` — the five states, their precedence, the
  pending-id lifecycle, and the forbidden-vocabulary guard, as pure cases.
- `tests/session-wiring.test.js` — driven through the real `public/app.js` with
  real events, including the four write scenarios this lane required:

| scenario | asserted |
|---|---|
| successful write | one record, status says Saved with a time |
| write throws | nothing written, entries retained, retry succeeds |
| **silent** write failure (`setItem` returns, stores nothing) | read-back catches it; Saved never claimed |
| **write succeeds, read-back fails, then retry** | the record landed once; retry **reuses the pending id** and reconciles — **one record, not two** |
| right id, wrong content | rejected; matching id alone is not enough |
| Save & next fails | nothing written, label not advanced, nothing cleared |

Mutation-tested — all eight killed, control green:

| mutation | result |
|---|---|
| read-back verification removed | 3 fail |
| content not compared, only the id | 1 fail |
| retry mints a fresh id (duplicates) | 1 fail |
| `put()` appends instead of reconciling | 1 fail |
| `advanced()` keeps the saved-at time | 4 fail |
| failed status names a cause | 6 fail |
| geometry constants count as content | 1 fail |
| Rider Feedback not counted as content | 2 fail |
| *(control — unmutated)* | **0 fail** |

## Verification not completed: no browser render

**This lane has no screenshots and no measured heights.** Chrome lost the
ability to reach a local server part-way through this session: four ports
(8835, 8837, 8841, 8843) and both `127.0.0.1` and `localhost` returned
`chrome-error://chromewebdata/` while `curl` fetched the same URLs with
HTTP 200 throughout, and earlier ports in the same session had worked. The
cause was not established and no product change is implicated.

So the following are **asserted by automated tests but not seen rendered**:
the line's height at 100/200/400% text, its wrapping at large sizes, the icon
masks, and the tone colours. They are worth one browser or device check before
this PR is accepted.

Everything in the behaviour tables above is covered by the wiring tests, which
drive the real `app.js`.

## One behaviour change beyond the status line

`doSave()`'s "nothing to save yet" guard now uses the same content rule as the
status line. Previously `Object.values(s.setup).some(Boolean)` counted
`setup.geometryConstants` as content, so a wheelbase typed into the geometry
calculator made an otherwise empty session saveable. One definition of "empty"
is the point — two would be the competing-flags problem again — but it does
change when a save is refused, and is recorded here rather than folded in
silently.

---

## Correction round (owner review of PR #78)

### 1. An unreadable history is never replaced

`Store.put()` read through `readAll()`, which answers `[]` for a history it
could not read. The mutation then wrote that empty list plus the new record,
**replacing every saved session** — and the read-back of the new record still
succeeded, so the rider was told "Saved on this device" at the moment their
history was destroyed.

Mutations now read through `readAllForWrite()`, which separates *absent* from
*unreadable*:

| stored value | strict read | effect on a save |
|---|---|---|
| key absent | `[]` | saves normally — genuinely empty history |
| `[]` | `[]` | saves normally |
| valid list of records | the records | saves, keeping them |
| read throws | **abort** | nothing written |
| JSON will not parse | **abort** | nothing written |
| parses to a non-array | **abort** | nothing written |
| list containing a non-record | **abort** | nothing written |

On abort the **original bytes are left exactly as they are**, so the sessions
stay recoverable and exportable by hand. Every mutation is covered, not just
the reported one: `put`, `add`, `remove` and `importPayload`. Only `clear()`
still writes unconditionally, because erasing is what it is for.

**This is reported as a scope expansion.** The finding named `put()`; `remove()`
and `importPayload()` had the identical defect, and fixing one of three would
have left the same data-loss path open by another route.

The rider is told something different from an ordinary failure, because
retrying will not help:

> Not saved. The sessions already on this device could not be read, and
> MotoTrack will not replace them. Export a backup from About before saving
> again.

Deleting a session against an unreadable history is refused the same way.

**A second defect, found by the new tests:** the lenient `readAll()` returned
junk entries unchanged, and a `null` in the list crashed the saved-session list
while sorting it (`Cannot read properties of null (reading 'savedAt')`). The
display read now skips non-record entries. That is safe only because no
mutation reads through it any more.

### 2. The status follows content back to empty

Outside DAY the status was recomputed only on the first dirty transition, so
typing into the last remaining field and then clearing it left the line still
claiming "Not saved yet" about an empty session. It is now recomputed on every
relevant edit.

The guard against rewriting unchanged live-region text is kept, and is itself
tested: three successive keystrokes that do not change the status produce
**zero** writes to `textContent`, so a polite live region is not re-announced
per keystroke.

Covered in NOTES for both content types — feedback text alone, and a tag
alone — each typed/checked and then cleared, plus a sweep asserting the
behaviour on all six stages rather than only the two named.

### Tests

**99 pass / 0 fail** locally (84 → 99). All six mutants killed, control green:

| mutation | result |
|---|---|
| `put()` reverts to the lenient read *(the reported bug)* | 6 fail |
| strict read answers `[]` on a parse failure | 5 fail |
| strict read accepts a non-array | 1 fail |
| strict read accepts junk entries | 2 fail |
| `remove()` reverts to the lenient read | 1 fail |
| status recomputes only on the dirty transition *(the reported bug)* | 3 fail |
| *(control — unmutated)* | **0 fail** |

`remove()` initially **survived**. The test corrupted the history in a way the
display read could not parse either, so the delete handler never found the
record and never reached `Store.remove` — it passed without exercising
anything. Corrupting it with a trailing `null` instead, which `readAll()`
skips and `readAllForWrite()` rejects, made the test real.

---

## OUTSTANDING ACCEPTANCE ITEM — browser verification not done

**This remains open and this PR should not be accepted until it is measured.**

Chrome still cannot reach a local server from this session. Retried after the
corrections on a fresh port (8851): `curl` returned HTTP 200 and Chrome
returned `chrome-error://chromewebdata/`. That is now six ports across two
sessions of attempts, on both `127.0.0.1` and `localhost`.

Still to be measured when access is restored:

- [ ] **320px and 390px** — the status line at both phone widths
- [ ] **Enlarged text** — 200% and 400%
- [ ] **Status wrapping** — that it wraps rather than clipping or shrinking
- [ ] **Save and failure states rendered** — Saved / Not saved yet / Not saved ·
      try Save again / blocked storage, including the icon masks and tone
      colours
- [ ] Added height of the line at each text size

Every behaviour above is covered by tests driving the real `app.js`; what is
unverified is how it *looks and measures* on a phone.
