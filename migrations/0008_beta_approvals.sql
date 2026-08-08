-- Beta-approval axis (track-helper #49, PR 1). Operator review of waitlist
-- candidates, fully independent of every existing rider axis: it never reads
-- into or writes through to confirmation status, program_track, unsubscribe/
-- suppression state, profile consent, or profile existence.
--
-- Current state lives here as an EXPLICIT row only after the first operator
-- decision. No row = effective state 'awaiting_review' (never reviewed).
-- 'awaiting_review' is also a valid STORED state so an operator can
-- deliberately return a previously reviewed candidate to the queue - the
-- presence of the row (and its events) distinguishes "sent back" from
-- "never looked at". Signups are NOT backfilled.
CREATE TABLE waitlist_beta_approvals (
  signup_id TEXT PRIMARY KEY
    REFERENCES waitlist_signups(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('awaiting_review', 'approved', 'hold', 'not_approved')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT NOT NULL CHECK (length(updated_by) BETWEEN 3 AND 254)
);
CREATE INDEX idx_beta_approvals_state ON waitlist_beta_approvals (state);

-- Append-only decision history. Ordering is by event_seq, not occurred_at:
-- two decisions can share a whole-second timestamp and the record of who
-- decided what, in which order, must never depend on a tie-break.
--
-- previous_state records the EFFECTIVE state the operator acted on, so the
-- first decision for a signup legitimately carries 'awaiting_review' even
-- though no current-state row existed yet.
--
-- What this table deliberately does NOT hold: email address, profile
-- answers, tokens or digests, session identifiers, IP data, or any rider
-- free text. Only which signup, from what state, to what state, by which
-- verified operator, why (bounded operational reason), and when.
--
-- It CASCADEs from the signup, so decision history is removed only as a
-- consequence of the signup itself reaching its retention purge - never by
-- an application code path, which has no event mutation API at all.
CREATE TABLE waitlist_beta_approval_events (
  event_seq INTEGER PRIMARY KEY AUTOINCREMENT,
  signup_id TEXT NOT NULL REFERENCES waitlist_signups(id) ON DELETE CASCADE,
  previous_state TEXT NOT NULL CHECK (previous_state IN ('awaiting_review', 'approved', 'hold', 'not_approved')),
  new_state TEXT NOT NULL CHECK (new_state IN ('awaiting_review', 'approved', 'hold', 'not_approved')),
  actor TEXT NOT NULL CHECK (length(actor) BETWEEN 3 AND 254),
  reason TEXT CHECK (reason IS NULL OR length(reason) <= 280),
  occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (previous_state <> new_state)
);
CREATE INDEX idx_beta_approval_events_signup ON waitlist_beta_approval_events (signup_id, event_seq);

-- Immutability. An UPDATE would rewrite who decided what or why - the one
-- thing decision evidence must never do. There is deliberately NO delete
-- trigger: a blanket BEFORE DELETE would break the required parent ON DELETE
-- CASCADE and strand approval history past the signup's retention ceiling.
CREATE TRIGGER waitlist_beta_approval_events_immutable
BEFORE UPDATE ON waitlist_beta_approval_events
BEGIN
  SELECT RAISE(ABORT, 'waitlist_beta_approval_events is append-only');
END;
