# Track Agent isolation

Track Agent is the first MotoTrack premium prototype. It is intentionally
separate from the free MotoTrack Log app.

## Deployment boundary

- Free MotoTrack Log: `mototrack.app`
- Premium Track Agent prototype: `agent.mototrack.app`

The free app keeps its local-only model: no account, no backend dependency, no
database dependency, and no changes to `mototrack.sessions.v1`.

Track Agent uses its own Cloudflare Worker and its own D1 schema. The premium
service may later add invitation checks, billing, AI parsing, and optional sync
without changing the free logger's storage model.

## Current scaffold

The initial scaffold lives under `premium/track-agent/`.

- `wrangler.jsonc` defines the Worker intended for `agent.mototrack.app`.
- `src/index.js` defines the Track Agent API route shape.
- `src/premium-access.js` contains `userHasPremiumAccess(userId)`, currently
  returning `true` until invite or billing logic exists.
- `src/track-agent-service.js` contains replaceable service functions and a
  deterministic mock parser.
- `migrations/0001_track_agent_schema.sql` drafts the isolated D1 tables.

## API shape

- `POST /track-agent/parse`
- `POST /track-agent/save`
- `GET /track-agent/sessions`
- `GET /track-agent/session/:id`
- `GET /track-agent/summary/:id`

Parsed output must never auto-save. The save endpoint requires explicit
confirmation from the review UI.

## Free app guardrail

Do not move Track Agent parsing, storage, D1 access, invite checks, or AI calls
into `app.js`, `storage.js`, or the `mototrack.sessions.v1` localStorage model.
The free app may link to `agent.mototrack.app` later, but should not absorb the
premium service.
