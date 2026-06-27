# MotoTrack roadmap

Ideas on the table but not yet built. Each item gets its own design discussion
before code lands.

## Product split

MotoTrack has two intended lanes:

- **MotoTrack Log** - the free, local-first paddock notebook. No account, no
  cloud requirement, no coaching, no prescriptive setup advice.
- **MotoTrack Pro** - a future paid layer for advanced calculators, setup
  analysis, AI-assisted review, and optional sync if the Pro product needs it.

The free version should stay faster than paper. The Pro version can add deeper
analysis after the logging foundation is trusted.

## Free version: MotoTrack Log

Goal: a paddock-fast setup log that records what happened without trying to
coach the rider.

### Core principles

- Local-first, account-free, and no tracking.
- Nothing required. A rider can fill in four fields and walk away.
- Consequences are okay; prescriptions are not. The free app may state neutral
  facts, but it should not tell riders what setup change to make.
- Keep the default workflow optimized for the 30 seconds after pit-in.

### Near-term logging work

- **Diff-based setup changes.** Capture setup changes as first-class records:
  from value, to value, reason/symptom, and result.
- **Hot Log fast path.** One-tap entry for post-session hot pressures,
  immediate symptoms, gut feel, and quick notes.
- **Duplicate last session.** New sessions should start from the last known
  setup rather than a blank form.
- **Auto-save.** Local-first storage makes explicit save buttons optional; avoid
  a workflow where riders lose notes because they forgot to save.
- **Large stepper controls.** Use big +/- controls for tire PSI, suspension
  clicks, sprocket teeth, and heat-cycle counts.
- **Outdoor / sunlight mode.** Add a high-contrast display mode for direct
  paddock sun.

### Free fields to add or elevate

- Tire heat-cycle or session-on-this-tire counters.
- Fuel load: full, half, low/reserve, unknown.
- Session status: complete, red flag, mechanical, off/crash, rain, traffic.
- Sag: front and rear, plus fuel level when measured.
- Chain link count alongside sprocket changes.
- ECU/fueling/map note as optional free text.
- Subjective confidence or feel rating.

### Free guardrails

- No built-in GPS lap timer.
- No Bluetooth/data-logger integration.
- No social feeds, leaderboards, or public setup sharing.
- No account or cloud nags.
- No prescriptive AI setup advice.
- No mandatory schema that makes quick notes slower than paper.

## Pro version: MotoTrack Pro

Goal: turn a rider's setup history into useful analysis while keeping the free
logger simple and trustworthy.

### Pro calculators and analysis

- **Bike profiles.** Drivetrain ratios, variable-length gearbox ratios,
  sprockets, tire references, chain links, and optional geometry constants.
- **Gearing calculator.** Simple and full modes, speed at redline per gear,
  RPM at speed, corner-speed RPM, and speed/RPM tables.
- **Tire diameter comparison.** Circumference and diameter deltas, equivalent
  rear-sprocket change, speedo error, and ride-height delta.
- **Geometry deltas.** Direction-first geometry outputs, estimated trail delta,
  and optional formula-based trail delta when bike constants exist.
- **Setup-log annotations.** Passive inline consequences on logged changes:
  gearing percentage, RPM change, tire ride-height effect, and geometry
  direction.
- **Pattern review.** Summaries of what changed, why it changed, and what result
  the rider recorded.

### Pro AI layer

- AI-assisted session review.
- Setup-history summaries.
- Cause/effect pattern detection from the rider's own logs.
- Optional setup assistant recommendations after there is enough rider-specific
  history to support them.

The Pro AI layer should be clearly separate from the free app. Free MotoTrack
logs facts; Pro may help interpret them.

### Pro guardrails

- Start with consequences and summaries before prescriptive advice.
- Do not present AI output as race-engineer certainty.
- Keep safety-sensitive language conservative and evidence-based.
- Make any sync/account requirement explicit and optional to the Pro product,
  not a requirement for the free logger.

## Opt-in advertising

Status: possible free-version monetization idea, not committed.

A single checkbox could let a rider voluntarily enable ads. **Default off.**
Riders who never enable it see zero ads and load zero third-party scripts.

### Why this respects the ethos

- Default-off keeps the no-tracking promise for everyone who does not opt in.
- One toggle, reversible at any time.
- The privacy page would clearly distinguish the default state from the opt-in
  ad state.

### Open before building

- **Provider.** Privacy-respecting options fit best:
  - EthicalAds - no cookies, no behavioral targeting, content-targeted.
  - CodeFund - similar approach.
  - Carbon Ads - tech audience, no cookies.
  - Generic networks such as AdSense or Media.net pay more but conflict with
    the ethos.
- **CSP impact.** The current `default-src 'none'` policy must allow provider
  origins only when ads are enabled.
- **Toggle persistence.** Store opt-in in `localStorage` or ask every visit.
- **Privacy page rewrite.** Explain exactly which provider loads and how to
  turn ads back off.

### Out of scope for this idea

- Account-based supporters and donation buttons.
- Geo-targeted ads or behavioral profiling.

## Cross-device sync

Status: Pro-only possibility, deferred until cross-device is the actual goal.

If Pro later needs riders to compare sessions across devices or share with a
coach, persistence can move from `localStorage` to a backend. `storage.js` was
written as a thin wrapper so this can be isolated later. Adding a backend before
sync is a real product need would force accounts, auth, and a privacy rewrite
too early.
