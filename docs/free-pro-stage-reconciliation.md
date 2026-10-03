# Free / Pro stage reconciliation

**Status:** analysis, written before PR 3. Implements nothing and authorizes
nothing. Written 2026-09-30 against `track-helper` at
`feat/pr2-context-header-and-about` and `mototrack-pro` at `b245107`.

**Why this exists:** the stage-navigation handoff proposes six stages for the
free MotoTrack Log. Six stages with those exact labels already exist in Track
Agent Pro, and they are fixed by a contract that **already binds Free**. The
handoff was written without sight of that contract — it says so itself:
*"I couldn't open the local `mototrack-pro` folder. If it already has these
screens, check them against C1."* This is that check.

---

## 1. The contract already governs Free

`mototrack-pro/docs/trackside-redesign/free-pro-ux-contract.md` is a **binding
contract accepted 2026-09-17**. Two clauses put Free inside it:

> §2 — "The rider stage rail has exactly six stages, in this order and with
> these labels **in both products (Pro now, Free when its glove lane lands)**."

> §1 — "**Rider-facing terms are identical in both products.**"

And the governing rule: *"a rider who learns MotoTrack Free already knows how
to use MotoTrack Pro. Moving to Pro unlocks capabilities; it never changes the
workflow."*

So the labels and order the handoff proposes are **already correct** — they
match the contract exactly. What needs reconciling is what goes *inside* them.

Sharing rendering code is not required and not proposed. §11 is explicit that
the two products meet on the document, not on an implementation.

---

## 2. Mapping every existing Free panel

Today Free has eight tabs. Every field below keeps its `id` and its place in
the saved-session object; this is a regrouping of where controls appear, not a
schema change.

| Free panel | field ids | → stage | note |
|---|---|---|---|
| **Setup** | `bike`, `track`, `session-label`, `amb-temp`, `track-temp`, `humidity` | **DAY** | matches the handoff and the contract's "DAY is the Riding Day home" |
| **Setup** | `general-notes` | **NOTES?** | **see §3 — this is the one real conflict** |
| **Tires** | `tire-brand`, `tire-model`, `front-pre`, `rear-pre`, `warmer-on`, `warmer-time`, `calc-tires` | **PRE** | |
| **Tires** | `front-post`, `rear-post` | **POST** | delta from PRE shown automatically |
| **Suspension** | `fork-preload`, `fork-comp`, `fork-reb`, `shock-preload`, `shock-comp`, `shock-reb` | **PRE** | clicks are set before going out |
| **Suspension** | `symptoms`, `calc-suspension` | **POST** | symptoms are observed after the outing; the handoff moves the chips, and the button that reads them belongs with them |
| **Calculators** | `tire-core-*`, `calc-tire-core`, sag, geometry | **PRE**, behind a "Tools" entry | handoff line 26 |
| **Laps** | `laps-input`, `calc-laps` | **LAPS** | unchanged |
| **Review** | `build-summary` | **REVIEW** | |
| **History** | `compare-a`, `compare-b`, `run-compare`, saved list | **REVIEW** | handoff line 30: "Review summary + History trends/compare" |
| **About** | tagline, Pro link, Feedback, backups, help, privacy | **not a stage** | header button — done in PR 2 |

**Nothing is dropped.** Every current function lands somewhere.

### Icons and labels — identical to Pro

| stage | label | Lucide icon |
|---|---|---|
| 1 | DAY | `calendar-days` |
| 2 | PRE | `gauge` |
| 3 | POST | `flag` |
| 4 | LAPS | `timer` |
| 5 | NOTES | `notebook-pen` |
| 6 | REVIEW | `clipboard-list` |

All six shipped in PR 1. Pro uses the same six labels in the same order.

---

## 3. Decision 1 — NOTES means two different things

**This is the substantive conflict and it needs an owner ruling.**

| | means |
|---|---|
| **Pro contract §1, §2** | NOTES is the chip for **Rider Feedback** — *"the rider's own words after an outing, plus tags"*. Screen heading **RIDER FEEDBACK**, review section **RIDER FEEDBACK**. The chip label is navigation only and *"does not rename product concepts."* |
| **Handoff line 29** | NOTES holds *"General notes (moved from Setup)"* — Free's `general-notes`, a free-text field about the day, written whenever. |

These are not the same concept. Rider Feedback is written **after an outing**
and carries **tags**; `general-notes` is day-level scratch text with neither.

If Free ships the handoff's reading, a rider who learns Free and moves to Pro
finds NOTES asks a different question — exactly what the governing rule
forbids.

**Options:**

1. **Follow the contract.** NOTES becomes Rider Feedback in Free: post-outing
   text plus the nine-tag vocabulary in §5. `general-notes` moves to DAY
   instead. §11 already says Free gets *"Rider Feedback text and quick tags —
   Yes, typed"*, so the contract expects this. Costs a new tag UI in Free.
2. **NOTES holds both**, with Rider Feedback as the primary block and general
   notes below it. Honest but two concepts in one stage.
3. **Amend the contract** so NOTES means general notes in both products. That
   is a change to Pro's shipped behaviour and to a binding document — the
   largest option, and it contradicts §11.

**Recommendation: option 1.** It is what the contract says, what §11 already
budgets for Free, and the only one where the two products teach the same
workflow. But it makes PR 3 bigger than "regroup the existing panels", so the
owner should choose knowingly.

---

## 4. Decision 2 — Free has no Riding Day, and the contract assumes one

The contract's §1 table already lists Free internals that **do not exist**:

| contract says Free stores | Free actually has |
|---|---|
| `mototrack.days.v1` entry | — |
| `mototrack.bikes.v1` entry | — |
| session entry with `dayId`, `bikeId` | flat session, no day or bike entity |
| `bikeDay.coldCheck` | — |
| `bikeDay.warmersInUse` | `tires.warmerOn` (per session, not per bike-day) |
| `bike.tireSets[]`, `bike.plannedChange` | — |
| `tires.conditionFront` / `conditionRear` | — |
| `nextDecision` | — |

Free today has **one** storage key, `mototrack.sessions.v1`, holding a flat
list of session objects (`setup`, `tires`, `suspension`, `laps`, …). There is
no Riding Day container, no Bike entity, and no per-bike-per-day state.

So the contract describes a Free data model that has not been built. The
handoff sidesteps this by promising *"same field ids"* — true for a regroup,
but it means PR 3 produces six stages over a **single flat session**, while
Pro's DAY owns a board of bikes and planned entries.

**This is a decision, not an oversight to code around.** Options:

1. **Regroup only.** PR 3 rearranges today's panels into six stages over the
   existing flat session. Free looks like Pro and teaches the same vocabulary;
   DAY is one session's setup rather than a day board. Smallest change,
   honest, and defers the model.
2. **Introduce the Riding Day model in Free first** — days, bikes, per-bike
   state — then regroup onto it. Matches the contract's Free column, and is a
   storage migration (`mototrack.sessions.v1` → a versioned successor) with its
   own review.
3. **Amend the contract's Free column** to describe what Free actually stores.

**Recommendation: option 1 for PR 3, with option 2 recorded as the follow-on.**
Rearranging panels and migrating the storage schema in one PR would make the
Experience Scorecard comparison meaningless, and the handoff's whole rollout
rule is one reviewed change per app version.

---

## 5. Smaller decisions, listed rather than invented

| # | question | why it cannot be assumed |
|---|---|---|
| 5.1 | Does `calc-suspension` ("Show recommendations") follow the symptom chips to POST, or stay in PRE with the clicks? | It *reads* symptoms but *advises* on clicks. The handoff moves the chips and is silent on the button. |
| 5.2 | Do the Calculators become a "Tools" entry inside PRE, or a seventh destination? | Handoff line 26 says a Tools entry in PRE; four calculators behind one entry is a real navigation change. |
| 5.3 | Does History's saved-session list live in REVIEW, or stay reachable separately? | Handoff line 30 folds "History trends/compare" into REVIEW; it does not say where the **list** and its Load/Delete actions go. |
| 5.4 | Does Free adopt the contract's **Tire condition** 1–5 rating per end? | §11 says Free gets it. Free has no such field today. It is new product surface, not a regroup. |
| 5.5 | Does Free adopt **Cold pressures** and the once-per-bike-per-day warmers question? | §11 says yes, *"Free implementation under its own authorization"* — so the contract explicitly defers it. |
| 5.6 | Does the PRE→POST one-way transition (handoff line 13, PR 4) imply a persisted stage in the saved session? | Handoff line 69 says session stage state is part of the draft object. That is a schema addition, and PR 4's business — flagged here so PR 3 does not quietly pre-empt it. |

---

## 6. What PR 3 can do without any further decision

If the owner rules only on §3 and §4, PR 3 can proceed with:

- the six stage labels and icons, identical to Pro (already shipped in PR 1)
- the bottom stage bar on phone and the 220px left rail at ≥900px
- every existing field id in its mapped stage, unchanged
- `mototrack.sessions.v1` untouched
- no session state, no save state, no stage chip text, no status line — those
  are PRs 4 and 5, and **cannot be shown truthfully before them**

## 7. What PR 3 must not do

- invent a PRE/POST session state to drive the stage bar (PR 4)
- invent a save-status line (PR 5)
- migrate storage (a decision under §4)
- add Tire condition, Cold pressures or the warmers question (§5.4, §5.5)
- rename any rider-facing term away from the contract's §1 table

---

## 8. Summary — what is needed before PR 3

| # | decision | recommendation |
|---|---|---|
| 1 | What NOTES holds: Rider Feedback, general notes, or both | **Rider Feedback** (contract §1/§2/§11) |
| 2 | Regroup over the flat session, or build the Riding Day model first | **Regroup now**, model as a follow-on |
| 5.1–5.6 | six smaller placements and adoptions | listed, none assumed |

Decisions 1 and 2 change PR 3's size materially. The rest can be settled as
PR 3 is reviewed, but none of them should be settled by me guessing.
