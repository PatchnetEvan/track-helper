# Track Agent Invite Access

Track Agent is invitation-only during the premium prototype. The recommended
prototype access path is `TRACK_AGENT_INVITE_TOKEN`.

## Recommended Remote Prototype Flow

1. Keep `INVITE_ONLY=true`.
2. Set a long random Worker secret named `TRACK_AGENT_INVITE_TOKEN`.
3. Send an invite link to the rider.
4. The rider opens the invite link once.
5. The Worker validates the token and sets an HttpOnly same-origin cookie.
6. The Worker redirects to a clean `/track-agent` URL without the token.
7. Subsequent UI and API calls are authorized by the cookie.

Example invite link format:

```text
https://agent.mototrack.app/track-agent?invite_token=<invite-token>
```

Do not include a real token in documentation, source control, pull requests, or
screenshots.

## Setting The Token

From `premium/track-agent/`:

```powershell
npx wrangler@latest secret put TRACK_AGENT_INVITE_TOKEN
```

The token should be generated outside the repo and entered only as a Worker
secret. It must not be stored in D1.

## Revoking Access

Prototype token access is revoked by rotating the token:

```powershell
npx wrangler@latest secret put TRACK_AGENT_INVITE_TOKEN
```

After rotation, existing cookies containing the previous token will stop working
because the Worker validates the cookie value against the current secret.

## Header Access

Automation or smoke tests can pass the token in a header instead of a URL:

```text
x-track-agent-invite-token: <invite-token>
```

The Worker does not log the token.

## Allowed User IDs

`TRACK_AGENT_ALLOWED_USER_IDS` supports comma-separated invited user IDs:

```text
TRACK_AGENT_ALLOWED_USER_IDS=rider-1,rider-2
```

This is future-ready for account-backed access. It should only be used when the
Worker receives a trusted user identity from the app or identity layer.

## Local Development Only

`DEV_USER_ID` remains available for local development, but it is ignored unless
`TRACK_AGENT_ENABLE_DEV_USER_ID=true` is also configured.

Do not use `DEV_USER_ID` as the remote prototype access mechanism.

## AI Status During Access Hardening

Keep `TRACK_AGENT_AI_PROVIDER` unset or set to `mock` while access hardening is
being validated. Live AI must not be enabled until the invite/account gate is
approved.

## Free App Separation

This access model applies only to the premium Track Agent Worker. It does not
change the free MotoTrack Log app, its localStorage schema, or the
`mototrack.sessions.v1` key.
