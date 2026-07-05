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
- `TRACK_AGENT_ALLOWED_USER_IDS` can allow one or more comma-separated invited
  users.
- `TRACK_AGENT_INVITE_TOKEN` can allow prototype access through
  `x-track-agent-invite-token`, `invite_token`, or the short-lived access cookie
  set after a valid invite request.
- `DEV_USER_ID` is local/dev only and is ignored unless
  `TRACK_AGENT_ENABLE_DEV_USER_ID=true` is also set.
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

## Recommended prototype access

For remote prototype access, use `TRACK_AGENT_INVITE_TOKEN`. Send the token in an
invite link such as `/track-agent?invite_token=<token>` or in the
`x-track-agent-invite-token` header. A valid token sets an HttpOnly same-origin
cookie for subsequent UI and API requests. The UI redirects to a clean URL after
query-token entry so the token is not left in the browser address bar.

`TRACK_AGENT_ALLOWED_USER_IDS` is available for future account-backed access when
the Worker receives a trusted user id from the app or identity layer.

## Local development access

For local development only, set `TRACK_AGENT_ENABLE_DEV_USER_ID=true` and an env
user such as `DEV_USER_ID=dev-rider`, then pass `x-user-id: dev-rider`. Do not
use `DEV_USER_ID` as the remote prototype access mechanism.

For browser testing, `/track-agent?invite_token=<token>` can set an HttpOnly
same-origin cookie after the request is authorized. The token itself is not
logged by the Worker and must not be stored in D1.

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
