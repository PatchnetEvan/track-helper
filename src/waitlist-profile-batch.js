// Operator-triggered profile invitation batch for EXISTING confirmed signups
// (track-helper #31, PR 4).
//
// Implementation only. There is deliberately NO route, NO scheduled handler,
// NO queue consumer, NO CLI command, and NO startup invocation anywhere in the
// repository - this module is callable service-layer code and nothing in the
// deployed Worker calls it. The operator trigger is a separately reviewed
// decision, so PR 4 cannot send a real staging or production invitation.
//
// Selection is deterministic (confirmed_at ASC, id ASC) and hard-capped at 25.
// Duplicate protection is the database's, not this module's: the partial
// unique index idx_one_later_invitation_per_signup permits at most one
// later_invitation per signup, so a rerun physically cannot double-invite.

import { issueProfileInvitation } from "./waitlist-profile-service.js";
import { activeUnsubscribeToken } from "./waitlist-tokens.js";

export const BATCH_MAX_RECIPIENTS = 25;

function id(prefix) { return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`; }

// A signup is a candidate only when it is confirmed, not unsubscribed, and not
// carrying unresolved suppression evidence (an unsubscribe with no later
// re-subscription). Written once and reused so preview and execution can never
// disagree about who is eligible.
const ACTIVE_CONFIRMED = `s.status = 'confirmed'
  AND (s.unsubscribed_at IS NULL OR s.resubscribed_at IS NOT NULL)`;
const HAS_LATER_INVITATION = `EXISTS (SELECT 1 FROM waitlist_profile_invitations i
  WHERE i.signup_id = s.id AND i.channel = 'later_invitation')`;

const scalar = async (db, sql) => Number((await db.prepare(sql).bind().first())?.n ?? 0);

/**
 * READ-ONLY preview. Creates no run, no outcome, no invitation, sends no
 * email, mutates no signup, and consumes no rate bucket. Returns aggregate
 * counts only - never recipient addresses.
 */
export async function previewProfileInvitationBatch(db) {
  const eligible = await scalar(db, `SELECT COUNT(*) AS n FROM waitlist_signups s
    WHERE ${ACTIVE_CONFIRMED} AND NOT ${HAS_LATER_INVITATION}`);
  const alreadyInvited = await scalar(db, `SELECT COUNT(*) AS n FROM waitlist_signups s
    WHERE ${ACTIVE_CONFIRMED} AND ${HAS_LATER_INVITATION}`);
  const notConfirmed = await scalar(db, `SELECT COUNT(*) AS n FROM waitlist_signups s
    WHERE s.status NOT IN ('confirmed', 'unsubscribed')`);
  const unsubscribed = await scalar(db, `SELECT COUNT(*) AS n FROM waitlist_signups s
    WHERE s.status = 'unsubscribed'`);
  const suppressed = await scalar(db, `SELECT COUNT(*) AS n FROM waitlist_signups s
    WHERE s.status = 'confirmed' AND s.unsubscribed_at IS NOT NULL AND s.resubscribed_at IS NULL`);
  return {
    eligible,
    already_invited: alreadyInvited,
    excluded_not_confirmed: notConfirmed,
    excluded_unsubscribed: unsubscribed,
    excluded_suppressed: suppressed,
    next_batch_size: Math.min(eligible, BATCH_MAX_RECIPIENTS),
  };
}

// The ONE-TIME operator-triggered invitation to an existing confirmed rider.
// This is a different event from the rider-requested edit link and must never
// share its copy: that flow answers a rider who asked, this one arrives
// unbidden and has to explain why. The subject and body below are the exact
// approved copy, track-specific - the international variant never describes
// the recipient as being in the U.S. beta and promises nothing about access,
// timing, or regional availability.
export const INVITATION_SUBJECT = "Set up your MotoTrack rider profile";
export const INVITATION_CTA = "Set up your rider profile";

const US_INVITATION_BODY = [
  "Tell us about your riding",
  "",
  "You previously confirmed your place on the MotoTrack early-access waitlist. We’re now offering an optional rider profile so you can tell us about your motorcycles, track experience, and what you want MotoTrack to help you improve.",
  "",
  "Completing your rider profile is optional and does not affect your waitlist position, eligibility, or access timing.",
];
const INTERNATIONAL_INVITATION_BODY = [
  "Tell us about your riding",
  "",
  "You previously confirmed your place on the MotoTrack international interest list. We’re now offering an optional rider profile so you can tell us about your motorcycles, track experience, and what you want MotoTrack to help you improve.",
  "",
  "Completing your rider profile is optional and does not affect your place on the international interest list or guarantee MotoTrack access or availability in your region.",
];
const INVITATION_CLOSING = "This secure profile link expires in 30 days. If you choose not to complete a profile, you can simply ignore this email.";

export function profileInvitationEmail(origin, rawToken, programTrack, unsubscribeToken) {
  const body = programTrack === "international_interest" ? INTERNATIONAL_INVITATION_BODY : US_INVITATION_BODY;
  return {
    subject: INVITATION_SUBJECT,
    text: [
      ...body,
      "",
      INVITATION_CTA,
      `${origin}/waitlist/profile/open?token=${rawToken}`,
      "",
      INVITATION_CLOSING,
      // The standard MotoTrack wait-list footer, unchanged: same
      // received-because sentence, a WORKING unsubscribe link, and the
      // Privacy Policy link.
      "",
      "",
      "You received this message because this email address was submitted to the MotoTrack early-access waitlist or regional interest list. You can unsubscribe at any time.",
      `Unsubscribe: ${origin}/waitlist/unsubscribe?token=${unsubscribeToken}`,
      `Privacy Policy: ${origin}/privacy.html`,
    ].join("\n"),
  };
}

/**
 * Bounded, resumable, operator-triggered execution.
 *
 * Fails closed unless WAITLIST_PROFILE_ENABLED === "true": returns null having
 * created nothing at all. Each signup is processed independently, so one
 * rider's failure never rolls back another's success and never stops the
 * batch; nothing is retried inside a single invocation.
 */
export async function executeProfileInvitationBatch(db, env, provider, { origin, limit = BATCH_MAX_RECIPIENTS } = {}) {
  if (env?.WAITLIST_PROFILE_ENABLED !== "true") return null;
  if (!provider || typeof provider.send !== "function") return null;
  const requestedLimit = Math.max(1, Math.min(Number(limit) || 0, BATCH_MAX_RECIPIENTS));

  const eligibleCount = await scalar(db, `SELECT COUNT(*) AS n FROM waitlist_signups s
    WHERE ${ACTIVE_CONFIRMED} AND NOT ${HAS_LATER_INVITATION}`);
  const runId = id("wlpb");
  await db.prepare(`INSERT INTO waitlist_profile_invitation_batch_runs
      (id, requested_limit, eligible_count, status) VALUES (?, ?, ?, 'running')`)
    .bind(runId, requestedLimit, eligibleCount).run();

  const record = async (signupId, outcome) => {
    await db.prepare(`INSERT INTO waitlist_profile_invitation_batch_outcomes (run_id, signup_id, outcome)
      VALUES (?, ?, ?) ON CONFLICT (run_id, signup_id) DO NOTHING`).bind(runId, signupId, outcome).run();
  };

  const counts = { issued: 0, already_invited: 0, issue_failed: 0, send_failed: 0 };
  let infrastructureFailure = false;

  try {
    // Deterministic selection, so a rerun after a partial batch walks the same
    // queue in the same order rather than an arbitrary slice.
    const candidates = await db.prepare(`SELECT s.id, s.email_normalized, s.program_track FROM waitlist_signups s
      WHERE ${ACTIVE_CONFIRMED} AND NOT ${HAS_LATER_INVITATION}
      ORDER BY s.confirmed_at ASC, s.id ASC LIMIT ?`).bind(requestedLimit).all();

    for (const signup of candidates.results ?? []) {
      let outcome;
      let rawToken = null;
      try {
        rawToken = await issueProfileInvitation(db, signup.id, "later_invitation");
      } catch {
        rawToken = null;
      }
      if (!rawToken) {
        // Reconciliation: a null can mean the one later-invitation slot is
        // already spent (the unique index refused) or that issuance genuinely
        // failed. The database decides which, never a guess.
        const taken = await db.prepare(`SELECT 1 AS n FROM waitlist_profile_invitations
          WHERE signup_id = ? AND channel = 'later_invitation'`).bind(signup.id).first();
        outcome = taken ? "already_invited" : "issue_failed";
      } else {
        let sent = null;
        try {
          const unsubscribeToken = await activeUnsubscribeToken(db, signup.id);
          const message = profileInvitationEmail(origin, rawToken, signup.program_track, unsubscribeToken);
          sent = await provider.send({ to: signup.email_normalized, ...message });
        } catch {
          sent = null;
        }
        if (sent) {
          outcome = "issued";
        } else {
          // The token must not stay usable when delivery is unproven, but the
          // invitation ROW stays: it is the evidence that this signup's one
          // later-invitation slot is spent, so no later batch silently retries
          // an address whose delivery state is ambiguous.
          await db.prepare(`UPDATE waitlist_profile_invitations SET revoked_at = datetime('now')
            WHERE signup_id = ? AND channel = 'later_invitation' AND revoked_at IS NULL`).bind(signup.id).run();
          outcome = "send_failed";
        }
      }
      counts[outcome] += 1;
      await record(signup.id, outcome);
    }
  } catch {
    infrastructureFailure = true;
  }

  const status = infrastructureFailure ? "failed"
    : (counts.issue_failed + counts.send_failed > 0 ? "completed_with_failures" : "completed");
  await db.prepare(`UPDATE waitlist_profile_invitation_batch_runs
    SET issued_count = ?, already_invited_count = ?, issue_failed_count = ?, send_failed_count = ?,
      status = ?, completed_at = datetime('now') WHERE id = ?`)
    .bind(counts.issued, counts.already_invited, counts.issue_failed, counts.send_failed, status, runId).run();

  return { run_id: runId, requested_limit: requestedLimit, eligible_count: eligibleCount, status, ...counts };
}

/**
 * Retention for the batch audit trail: operational/delivery records, 90 days,
 * matching the published notice. Outcome rows cascade with their run; an
 * earlier parent-signup purge cascades that signup's outcomes sooner.
 */
export async function sweepProfileInvitationBatches(db) {
  const runs = await db.prepare(`DELETE FROM waitlist_profile_invitation_batch_runs
    WHERE started_at <= datetime('now', '-90 days')`).bind().run();
  return Number(runs?.meta?.changes ?? 0);
}
