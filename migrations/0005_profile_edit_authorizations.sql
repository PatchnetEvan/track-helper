-- Short-lived, revocable edit authorization for the rider profile (PR 2).
--
-- The emailed invitation is exchanged for one of these; the INVITATION IS NOT
-- CONSUMED at exchange - opening or abandoning the form leaves the email link
-- usable until its 30-day expiry. Reopening the link revokes and replaces the
-- previous authorization so only one edit session is live, without touching
-- the invitation itself. The invitation is consumed only on a successful save.
--
-- claim_marker is the atomicity anchor (0021-style claim guard): the save
-- batch stamps it on the authorization row in its first statement, and every
-- later statement in that same transaction is conditional on THAT marker, so
-- a previously consumed authorization can never satisfy a new save.
CREATE TABLE waitlist_profile_edit_authorizations (
  id TEXT PRIMARY KEY,
  invitation_id TEXT NOT NULL REFERENCES waitlist_profile_invitations(id),
  signup_id TEXT NOT NULL REFERENCES waitlist_signups(id),
  cookie_digest TEXT NOT NULL UNIQUE CHECK (length(cookie_digest) = 64),
  csrf_digest TEXT NOT NULL CHECK (length(csrf_digest) = 64),
  claim_marker TEXT,
  issued_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  revoked_at TEXT
);
CREATE INDEX idx_profile_auth_invitation ON waitlist_profile_edit_authorizations (invitation_id);
CREATE INDEX idx_profile_auth_signup ON waitlist_profile_edit_authorizations (signup_id);
