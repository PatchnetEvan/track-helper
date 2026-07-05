# Track Agent Invited Tester Playbook

## Purpose

Track Agent is an invite-only prototype that helps riders turn messy track-session notes into structured review fields.

It is for logging and review only. It is not a coach, does not make setup recommendations, and does not give safety-critical advice. Riders must keep using their own judgment, coach input, technical inspection, and track rules.

## Who Gets Invited

The first tester group should stay small and trusted:

- Riders who understand this is a prototype.
- Riders who are comfortable giving specific feedback.
- Riders who already log lap times, tire pressures, setup notes, or session notes.
- Riders who can spot when a parsed field is wrong and correct it before saving.

## How Invites Are Distributed

Invite links are sent privately. Do not post an invite link in public groups, forums, social media, or screenshots.

Use this placeholder format only:

```text
https://agent.mototrack.app/track-agent?invite_token=<redacted>
```

The real invite token should be stored and shared through a password manager or another secure channel. If the link leaks, rotate `TRACK_AGENT_INVITE_TOKEN`.

## What Testers Should Try

Ask testers to run through practical paddock workflows:

- Come off track and write a messy session note.
- Paste that note into Track Agent.
- Review the parsed fields.
- Edit anything incorrect or missing.
- Confirm save only after review.
- Check the saved session read-back or summary.

The important test is not whether the parser is perfect. The important test is whether review-before-save makes the workflow useful and safe.

## Sample Session Notes To Test

Example 1:

```text
Road Atlanta session 2 on Ninja 400. Best lap 97.4. Front hot 31, rear hot 27.5. Bike felt loose on exit of Turn 7. Changed rear rebound softer one click.
```

Example 2:

```text
Homestead session 3 on R3. Best lap 1:37.4. Front cold 29, rear cold 27. Front hot 32, rear hot 29. Pushing on entry in Turn 6. No setup change.
```

Example 3:

```text
Jennings session 1 on SV650. No clean lap. Rear felt greasy after three laps. Rear hot 30. Added one click rebound after session.
```

Example 4:

```text
Roebling practice 4. Best 1:24.8. Bike stable under braking but running wide on exit. Front hot 31.5 rear hot 28.5.
```

## What Testers Should Not Enter

Track Agent is for track-session logging only. Testers should not enter:

- Medical information.
- Payment, banking, billing, or account-number details.
- Personal identification details.
- Emergency contact information.
- Private information about other riders.
- Unrelated personal notes.
- Anything they would not want processed by the configured AI provider.

Normal track-day details are okay, such as lap times, tire pressures, bike setup notes, handling comments, weather, tire feel, and rider observations.

## Feedback Collection

Send feedback to [evan.martinez@gmail.com](mailto:evan.martinez@gmail.com). Screenshots are useful, but remove sensitive information before sending.

Ask testers:

- What did it parse correctly?
- What did it miss?
- What did it duplicate?
- Were warnings useful or noisy?
- Did the review-before-save flow feel clear?
- Was anything confusing in the UI?
- Would this save time in the paddock?

## Rotate Or Revoke Access

Rotate `TRACK_AGENT_INVITE_TOKEN` if an invite link leaks or the tester group needs to change.

After rotation:

- Old invite links stop working.
- Existing cookies may need to expire or be cleared depending on current implementation behavior.
- Send the new link only to the intended tester group.

Keep the tester group small while the prototype is active.

## When `ai_json` Can Be Enabled

Only enable `TRACK_AGENT_AI_PROVIDER=ai_json` when all of these are true:

- Invite access is confirmed.
- The tester group is known.
- Privacy copy is visible.
- The mock parser path works.
- The revert path is understood.
- The test is intentional, limited, and monitored.

Do not enable live AI casually or for public traffic.

## How To Turn AI Off Quickly

To return Track Agent to the safe default:

- Unset `TRACK_AGENT_AI_PROVIDER`, or set `TRACK_AGENT_AI_PROVIDER=mock`.
- Redeploy or update Worker configuration as required.
- Verify parse responses return `source: "mock_parser"`.

If anything feels off during testing, turn AI off first, then investigate.

## Known Prototype Limitations

- Invite access is still prototype-level.
- There is no billing or account system yet.
- AI may miss fields.
- AI may produce noisy warnings.
- AI may duplicate notes.
- The user must review before saving.
- Track Agent is not a replacement for rider judgment, coach instruction, mechanical inspection, or track safety rules.

## Tester Safety And Privacy Copy

Track Agent uses a configured AI provider to convert your session notes into structured review fields. AI output is not saved automatically. You must review and confirm before anything is stored. Do not enter sensitive personal information, medical information, financial information, or anything unrelated to your track session.

## Rollout Checklist

- [ ] Invite token configured.
- [ ] AI disabled by default.
- [ ] Mock parse verified.
- [ ] Invited tester link sent privately.
- [ ] Tester understands review-before-save.
- [ ] Feedback channel confirmed.
- [ ] Rollback path known.
