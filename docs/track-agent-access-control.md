# Track Agent access control

Track Agent is invitation-only during the premium prototype. The access layer is
isolated inside `premium/track-agent/` and does not affect the free MotoTrack Log
app at `mototrack.app`.

## Access model

The Worker uses `requireTrackAgentAccess(request, env, body)` before serving any
Track Agent UI or API endpoint. It delegates the decision to
`userHasPremiumAccess(userId, env, context)`.

Access is fail-closed:

- If no env configuration is present, requests are denied.
- `INVITE_ONLY` defaults to enabled.
- `DEV_USER_ID` can allow one or more comma-separated dev users.
- `TRACK_AGENT_ALLOWED_USER_IDS` can allow one or more comma-separated invited
  users.
- `TRACK_AGENT_INVITE_TOKEN` can allow prototype access through
  `x-track-agent-invite-token`, `invite_token`, or the short-lived access cookie
  set after a valid invite request.
- `TRACK_AGENT_ALLOW_OPEN_ACCESS=true` only works when `INVITE_ONLY=false`.

No real billing, account, or subscription system is wired yet.

## Gated endpoints

The guard applies to:

- `GET /`
- `GET /track-agent`
- `GET /track-agent/ui.js`
- `POST /track-agent/parse`
- `POST /track-agent/save`
- `GET /track-agent/sessions`
- `GET /track-agent/session/:id`
- `GET /track-agent/summary/:id`

Unauthorized API and JavaScript requests return `403` JSON. Unauthorized UI
requests return a `403` access-pending HTML page and do not load the Track Agent
client script.

## Local prototype access

For local development, set an env user such as `DEV_USER_ID=dev-rider` and pass
`x-user-id: dev-rider`, or set `TRACK_AGENT_INVITE_TOKEN` and pass
`x-track-agent-invite-token`.

For browser testing, `/track-agent?user_id=dev-rider` or
`/track-agent?invite_token=<token>` can set an HttpOnly same-origin cookie after
the request is authorized. The token itself is not logged by the Worker.

## Separation guarantee

The free MotoTrack Log app remains local-first and account-free. This access
layer does not modify `storage.js`, `app.js`, root `index.html`, or the
`mototrack.sessions.v1` localStorage key. Track Agent gating lives only in the
premium Worker.

## Future upgrade path

The next production-grade step is replacing the dev allowlist/token checks
behind `userHasPremiumAccess()` with a real invitation, billing, or subscription
lookup. That lookup can be backed by D1 or a billing provider, while the Worker
routes continue using the same `requireTrackAgentAccess()` middleware.
