# Agreed changes to the stage-navigation handoff

The handoff (`design_handoff_stage_navigation/README.md`) is the design
contract for the free MotoTrack Log. Where the built app departs from it, the
departure is recorded here with the decision that authorised it, so a later
reader does not treat the older text as the more authoritative of the two.

Nothing here was decided by the implementer. Each row cites the owner decision
that changed it.

## PR 4 — PRE→POST gating and docked transitions

### 1. Finish moves from POST to REVIEW

**Handoff line 64:** POST's dock button is `Finish SN · start SN+1`, which
saves the session and clears the PSIs, symptoms, laps and notes.

**Changed to:** POST advances to LAPS. The save lives at the end of the chain,
on REVIEW.

**Why:** the handoff's own stage order puts LAPS and NOTES *after* POST, so a
Finish button on POST would save and clear a session while the rider still had
laps and notes to enter — destroying the entries they were about to make. The
route is now POST → LAPS → NOTES → REVIEW, each step a docked action, and
because the stage rail is always present none of it is mandatory: a rider with
no laps to enter reaches REVIEW from POST in one tap.

**Owner decision, this lane:** *"Finish must not immediately save and clear
while the rider still needs to enter LAPS or NOTES. Provide a clear route
through those optional stages to REVIEW, then an explicit save-and-next
action. Avoid adding mandatory steps."*

### 2. Both save controls stay, and they live in the dock

**Handoff line 70:** *"The existing Save this session and Save & next buttons
are removed from Review."*

**Changed to:** both are kept, with their existing ids (`save-session`,
`save-and-next`), and both move into the dock so they are in thumb reach.

**Why:** removing Save-only would have taken away a real capability — the last
outing of a day wants saving without priming a session that will not happen.

**Owner decision, this lane:** *"Keep both save choices on REVIEW: Save only
and Save & next."* and *"Preserve existing field IDs, including save controls
where practical."*

### 3. The dock sub-line is never hidden

**Handoff line 94:** *"Above 150% text size, hide the dock sub-line."*

**Changed to:** nothing in the dock is ever hidden or truncated. The dock wraps
and grows, and when its measured height plus the navigation would cost too much
of the usable viewport it stops being sticky and takes its place in the
document instead.

**Why:** text zoom is not a media feature, so any "150%" test would be a guess
about something unobservable, and the line it would drop is the one that says
what the action changes. The real constraint is screen space, which *is*
measurable — dock plus navigation against `visualViewport.height`, so it also
responds to the soft keyboard.

**Owner decision, this lane:** *"Don't hide dock text using an assumed '150%
text' detector. Specify a responsive layout that preserves the action and
essential meaning at enlarged text sizes."* and *"Compare the dock plus
navigation height with the available viewport and switch the dock into
document flow when necessary."*

### 4. DAY → PRE copies nothing

**Handoff line 62:** DAY's dock button *"Copies clicks and tires from S(N-1) ·
opens PRE"*.

**Changed to:** it opens PRE and does nothing else. Carry-over between sessions
already happens in Save & next; copying a historical session is the explicit
**Copy to form** action in the saved-session list.

**Why:** an automatic copy on a navigation-shaped button would overwrite what
the rider had already entered.

**Owner decision, this lane:** *"DAY → PRE must preserve entered values. Don't
copy a previous session automatically or overwrite current inputs. Carry-over
already happens through Save & next; copying historical values remains the
explicit Copy to form action."*

### 5. The session label is only advanced when it can be advanced cleanly

**Handoff line 64:** *"bumps the label"*, unconditionally.

**Changed to:** one rule decides both what the dock displays and what is
written into the field. A label only advances when the trailing number can be
incremented without mangling it; an ordinal such as `2nd outing` and free text
such as `morning warmup` are left exactly as the rider typed them, and the dock
says "next session" rather than inventing one.

**Owner decision, this lane:** *"Derive the next-session label using the
existing label logic. Don't display an invented session number when the rider's
label is free text."* and *"Use the same validated next-label rule for both the
displayed label and the actual field update."*

### 6. Session stage state is not part of a draft object

**Handoff line 69:** *"Session stage state (`day | pre | post`) is part of the
draft object."*

**Changed to:** stage state is held in memory for the life of the page.

**Why:** there is no draft object. The live form is the draft and a refresh
clears it, which is handoff non-negotiable #3 — *"With it off, the app behaves
exactly as it does today (a refresh clears the draft)"* — and the draft object
arrives with the auto-save switch in PR 6. Writing stage state to storage here
would have created half of that persistence outside the rider's control.

**Recorded consequence:** unfinished entries are memory-only. A refresh, a
crash, or the browser reclaiming the tab loses them. Draft recovery is
follow-on work that matters for trackside use, where tabs get evicted.

## PR 5 — save status line

### 7. "Not saved yet" points at REVIEW, not at Finish

**Handoff line 76:** the unsaved text is *"Not saved yet · finish the session
to keep it"*.

**Changed to:** *"Not saved yet · REVIEW saves it"*.

**Why:** PR 4 moved the save off POST's Finish button, so the handoff's
sentence now points at a control that no longer exists. The new wording matches
the dock's own "Nothing is saved yet" sub-lines on LAPS and NOTES.

### 8. A failed save names no cause

**Handoff:** no text was specified for a failed write.

**Decided:** *"Not saved · try Save again"*.

**Why:** an earlier draft said "storage refused it". The app cannot distinguish
a quota error from private-mode eviction from a write that silently did not
land, so naming a cause states something unestablished. The rider is told the
fact and the action.

**Owner decision, this lane:** *"Use 'Not saved · try Save again' for an
unsuccessful save. 'Storage refused it' is too specific unless that cause is
established."*

### 9. "Saved" requires read-back of the content, not just a write that returned

**Handoff line 74:** Saved is shown when *"storage.js write succeeded and
read-back matched"*.

**Implemented as:** the write goes through `Store.put` under an id claimed from
the save state, then the record is read straight back and compared by content,
not only by id. An unverified write leaves the id **pending**, so the retry
reconciles that record instead of writing a second copy of the same outing.

**Owner decision, this lane:** *"If writing succeeds but verification fails,
retry must reuse the pending record ID and reconcile that record—not create
another copy. Verify the saved content as well as its ID before claiming
success."*

## C8 revised: centred value + tenths ruler (`0.1.0-beta.11`)

The earlier 0.5-notch ruler is replaced by the control in
`MotoTrack Pressure Entry.dc.html`: a centred 32px value that starts blank, a
dashed Reference pill, a tenths ruler with every tick labelled, and ±0.1 steps.

### The conflict recorded in §2 and §7 is resolved

The handoff now **withdraws** the POST "Finish" dock and the removal of
REVIEW's save buttons, and non-negotiable 4 restates keeping both controls.
Nothing had to be restored: **Save only** and **Save & next** were never
removed, because §2 recorded the owner over-ruling that part of the original
handoff. Save only now carries a check icon and Review's status copy names both
controls.

### Owner rulings applied this round

1. POST's dock becomes "Go to REVIEW" (`.btn-dock-nav`, outlined, navigation
   only). LAPS and NOTES keep no dock change.
2. Only `#ff8a3d` → `--accent`, `#7a828d` → `--text-dim`, and the stepper
   border `#4a4a4a` → `--text-dim` (required by C8). **Follow-ups, deliberately
   not changed this round:** `#4a4a4a` still borders the small button
   (`styles.css:615`), the textarea (`:635`) and the text inputs (`:642`), and
   `#1a0a00` is still the text colour on orange buttons (`:115`, `:277`,
   `:312`). All four are derived colours the Tokens section would retire.
3. A session number is used only when a saved session actually carries one.
   With no label the pill reads "Last session 31.0", the ruler tag reads
   "Last", and the button reads "Same as last session · 31.0". Never invented.
4. **No reference establishable** - different bike, different tire, or an
   incomplete context: the pill and the "Same as" button are hidden, no marker
   is drawn, the value stays blank, and the ruler and −/+ stay
   `aria-disabled` until a number is typed, so no starting value is invented.
   The note drops to "Type the whole number, then drag or use − / + to set the
   tenths."
5. The stage bar already scrolls sideways (`overflow-x: auto`, PR 3), with
   `showTab` keeping the selected stage in view. No follow-up needed.

### Two regressions caught by the existing suite

- Rounding every step to a tenth turned a typed `30.25` into `30.4`. ± now goes
  through the same decimal-safe `stepValue` the click steppers use, so it
  becomes `30.35` and the rider's second decimal survives. Only the **drag**
  snaps to tenths, because that is what a ruler does.
- The numeric contract from the previous round (excessive decimal precision and
  unsafe magnitudes are kept as typed and cannot be stepped) was briefly lost
  when the new parser accepted anything `Number()` would. Restored as a
  distinct `unsupported` state with its own copy.

A third: "never below 0" was briefly applied to increments too, which stranded
a typed `-2` with buttons that refused to touch it. It now governs the
decrement only.

## Pressure fix notes 1-5 (`0.1.0-beta.12`)

Items 1, 3, 4, 5 and 6 are done. Item 2 is improved but one acceptance line is
not met; the measured breakdown is in
`docs/review-artifacts/pr7-steppers/c8-fix-390/README.md`.

Two defects behind the reported symptoms:

- **The 4px gap** came from `--stage-bar-h` being floored at 64px against a
  60px bar, and from the dock adding `env(safe-area-inset-bottom)` on top of a
  measurement that already included it. Both fixed; measured gap is now 0.
- **The bunched ruler labels** came from deriving the tick count from the box
  width. Ticks are now placed from the centre at a fixed 32px pitch.

A third, found while building: `.btn-secondary` is full width, so **Edit tires**
beside the summary squeezed it to one character per line and made that row
453px tall. The button now sizes to its own text.

The wordmark is hidden below 900px, as item 4 allows, and the `Tires` panel
heading with it: the section label beneath says which pressure it is.
