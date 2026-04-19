# MotoTrack roadmap

Ideas on the table but not yet built. Nothing here is committed — each item
gets its own design discussion before code lands.

## Opt-in advertising — "help pay for the app"

A single checkbox (likely in the footer or on the About tab) that lets a rider
voluntarily enable ads. **Default off.** Riders who never tick it see zero ads
and load zero third-party scripts — the existing privacy promise stays intact
for them.

### Why this respects the ethos

- Default-off keeps the no-tracking promise for everyone who doesn't opt in.
- One toggle, on the same page, no account, reversible at any time.
- The privacy page would clearly distinguish the **default state** (nothing
  loads, nothing tracked) from the **opt-in state** (named provider loads,
  spelled-out behavior).

### Open before building

- **Provider.** Privacy-respecting options fit best:
  - [EthicalAds](https://www.ethicalads.io/) — no cookies, no behavioral
    targeting, content-targeted. Used by Read the Docs. Leading candidate.
  - [CodeFund](https://codefund.io/) — similar approach.
  - Carbon Ads — tech audience, no cookies.
  - Generic networks (AdSense, Media.net) — pay more, conflict with the ethos.
- **CSP impact.** The current `default-src 'none'` policy must allow the ad
  provider's script and image origins **only when the toggle is on**. Cleanest
  approach: a different CSP served for a path or query parameter that signals
  ads enabled, plus a conditional script load in `app.js` that reads the same
  flag.
- **Toggle persistence.** Either store the opt-in flag in `localStorage`
  (`mototrack.ads-opt-in.v1`) so it sticks across visits, or ask every visit.
  Asking every visit is more honest about consent but adds friction.
- **`privacy.html` rewrite** to spell out exactly which provider loads and what
  it may collect in the opt-in state, and how to switch back off.

### Out of scope for this idea

- Account-based supporters, donation buttons — separate conversation.
- Geo-targeted ads or behavioral profiling — would violate the ethos regardless
  of provider, and will not be added.

## Session-advance workflow

Status: discussed in PR #1, paused on a design call.

A **Save & start next session** button on the Review tab that saves the current
session and pre-fills a new form for the next one. Bike, track, tire brand,
suspension settings carry forward; PSIs, symptoms, lap times, and notes clear;
session label auto-increments. Treats the form like a spreadsheet row,
advancing one row at a time through a track day.

### Open before building

- **Temps / humidity** — carry forward (saves a retype if conditions are stable)
  or clear (forces an honest re-read each session)?
- **Button label** — "Save & start next session" / "Save & next" / "Save & advance".
- **Auto-increment for non-numeric labels** — `Session 2` → `Session 3` is easy;
  `Practice 1` → `Practice 2` is a regex on the last integer; `B group` becomes
  blank for the rider to re-type.

## Cross-device sync ("Rung 3")

Status: deferred until cross-device is the actual goal.

If the product later wants riders to compare sessions across devices or share
with a coach, persistence can move from `localStorage` to a real backend
(Supabase or similar). `storage.js` was written as a thin wrapper specifically
so this swap is one file. Adding a backend before cross-device is the goal
would force accounts, auth, and a privacy rewrite for a feature nobody is
asking for.
