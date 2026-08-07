-- Operator-triggered existing-user profile invitation batch: audit schema.
--
-- Kept separate from waitlist_email_deliveries rather than widening that
-- table's purpose CHECK, so batch reconciliation has its own shape and its own
-- lifecycle.
--
-- These are operational/delivery records under privacy notice 2026-08-05.3's
-- "Email-delivery and security logs: 90 days" commitment, and the retention
-- sweep deletes runs past 90 days; outcomes cascade with their run. An earlier
-- parent-signup purge cascades that signup's outcome rows sooner.
--
-- Neither table stores an email address, display name, profile answer, free
-- text, raw exception text, invitation token or hash, authorization token or
-- digest, or IP address. The four outcome codes are the COMPLETE per-rider
-- vocabulary: anything a raw error would have added is deliberately not kept.
CREATE TABLE waitlist_profile_invitation_batch_runs (
  id TEXT PRIMARY KEY,
  requested_limit INTEGER NOT NULL CHECK (requested_limit BETWEEN 1 AND 25),
  eligible_count INTEGER NOT NULL DEFAULT 0,
  issued_count INTEGER NOT NULL DEFAULT 0,
  already_invited_count INTEGER NOT NULL DEFAULT 0,
  issue_failed_count INTEGER NOT NULL DEFAULT 0,
  send_failed_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (
    status IN ('running', 'completed', 'completed_with_failures', 'failed')
  ),
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE TABLE waitlist_profile_invitation_batch_outcomes (
  run_id TEXT NOT NULL,
  signup_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (
    outcome IN ('issued', 'already_invited', 'issue_failed', 'send_failed')
  ),
  occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (run_id, signup_id),
  FOREIGN KEY (run_id)
    REFERENCES waitlist_profile_invitation_batch_runs(id)
    ON DELETE CASCADE,
  FOREIGN KEY (signup_id)
    REFERENCES waitlist_signups(id)
    ON DELETE CASCADE
);
