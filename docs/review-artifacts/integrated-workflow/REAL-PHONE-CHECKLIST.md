# Real-phone acceptance — OUTSTANDING

**Nobody has performed these. Headless measurements do not substitute for any
of them**, and nothing in this repository should be read as evidence that they
passed. Record the device, OS, browser and date beside each result.

Build: PR #80, branch `feat/pr7-steppers`. Serve `public/` **at the root** and
open `/log/` — a `/public/` prefix breaks the icon paths. Use a disposable
profile or private window; the fixtures write to `mototrack.sessions.v1` and
`mototrack.draft.v1` on that origin.

---

### 1. Repeated stepper taps with gloves
- [ ] Wearing the gloves you actually ride in, tap **+** on *Front pre-session
      PSI* ten times. Every tap registers once — the value moves by exactly
      0.5 each time, never 0 and never 1.0.
- [ ] Repeat on **−**, and on a click field (step 1).
- [ ] No tap lands on the neighbouring button or on the value field.
- [ ] Record: glove type, how many of the 10 taps misfired.

### 2. The keyboard stays closed while stepping
- [ ] With the on-screen keyboard **closed**, tap **+** repeatedly. The
      keyboard must not appear at any point.
- [ ] After a step, the pressed button still looks focused and the next tap
      steps again.
- [ ] Repeat in both portrait and landscape.

### 3. Typing a PSI with the keyboard open
- [ ] Tap into *Front pre-session PSI* and type `30.5` on the on-screen
      keyboard. The decimal key is reachable and the value is accepted.
- [ ] While the keyboard is open, confirm the field you are typing into is
      **visible** — not hidden behind the keyboard, the dock or the stage bar.
- [ ] Dismiss the keyboard; the value is retained and the steppers are enabled.

### 4. Focused fields stay reachable above navigation and dock
- [ ] With the keyboard **open**, move through the fields on PRE with the
      keyboard's next-field control. Each focused field stays visible.
- [ ] Check the **last** field on DAY and on REVIEW the same way.
- [ ] Repeat at your phone's **largest** accessibility text size. Note whether
      the dock moves into the page instead of floating, and whether anything
      becomes unreachable.

### 5. Saving and recovering unfinished work
- [ ] About → turn **Auto-save draft** on.
- [ ] Enter a bike, a track and a pressure; wait a second; confirm the status
      reads *"draft kept on this device"*.
- [ ] **Kill the browser app entirely** (not just background it) and reopen
      `/log/`. The entries come back and the status reads *"Draft restored"*.
- [ ] Go PRE → **Back in → POST**, then kill and reopen again: POST is still
      open and PRE is still read-only.
- [ ] On REVIEW tap **Save only**. Confirm the footer reads *"Session saved.
      Refresh clears the form; saved history remains."*, then reload and
      confirm the form is empty and the session is in the saved list.
- [ ] Turn auto-save **off** and confirm the warning about discarding the kept
      draft appears before anything is removed.

---

### Why these cannot be inferred from the automated runs

Everything verified so far ran in a **headless desktop viewport**. It can
measure that a button is 64×64 CSS pixels and that focus stays on it after a
synthetic click. It cannot tell whether that button is comfortable under a
glove, whether a real on-screen keyboard stays down across repeated taps, or
whether the keyboard covers a field the layout believes is visible — and
avoiding that keyboard is the entire purpose of PR 7.

**Result:** _not yet performed._
