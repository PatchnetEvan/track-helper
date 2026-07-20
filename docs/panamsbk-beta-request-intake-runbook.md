# PanAmSBK beta-request intake runbook

This runbook covers the public beta-request form at `/panamsbk`. The form is for a request only. It does not create an account, issue access, or send an invite link automatically.

## Before deployment

1. In Cloudflare Email Sending, onboard the `mototrack.app` sender address used by the Worker and complete any required DNS and destination-address verification. The Worker sends one internal notification email for each verified request.
2. In the local worktree, set the Turnstile secret interactively. Do not paste it into chat, a source file, a document, or a shell command history.

   ```powershell
   Set-Location C:\Projects\mototrack-public-panamsbk
   npx wrangler secret put TURNSTILE_SECRET_KEY
   ```

   Paste the secret only at Wrangler's hidden prompt.
3. Confirm the deployed Turnstile widget allows `mototrack.app` and uses Managed mode with pre-clearance disabled.
4. Deploy the reviewed public Worker and static assets together. The Worker owns the same-origin `/api/panamsbk-request` endpoint and otherwise serves the existing static site.

## Live smoke check

1. Confirm `https://mototrack.app/panamsbk` returns `200` and the form displays the Turnstile widget.
2. Confirm the form cannot submit without completing Turnstile.
3. Submit one test request using a controlled email address and non-sensitive test details.
4. Confirm the operator inbox receives one plain-text request email with a usable Reply-To address.
5. Confirm the requester sees the generic success message and no account or invite link is issued.
6. Confirm the page still has no public dashboard, private Pro route, coaching claim, AI claim, or access-link disclosure.

## Operator handling

1. Review the request privately.
2. Contact only approved riders using the submitted email address.
3. Issue any later private access link directly through an approved private channel.
4. Do not forward request emails or share rider information with coaches, teams, vendors, manufacturers, other riders, or public channels without explicit rider permission.
5. Do not record passwords, invite tokens, payment details, or sensitive medical/crash information in beta-request correspondence.

## QR code

Generate the QR code only after the public page and request endpoint pass the live smoke check. Its destination must be exactly:

```text
https://mototrack.app/panamsbk
```

The QR code is public and must never contain an invite token, a private access URL, or rider-specific information.

## Stop conditions

Stop accepting requests and remove public distribution materials if any of these occur:

- Turnstile verification fails for legitimate requests.
- The request endpoint sends email without verification.
- The page exposes a private access link or token.
- The request form produces duplicate or misdirected emails.
- A page change adds AI, coaching, setup, safety, timing, or sharing claims that are not current product behavior.
