-- Minimal profile-consent evidence (privacy notice 2026-08-05.3, §13).
--
-- The notice commits to retaining "the consent/withdrawal timestamp and
-- wording or version needed to demonstrate what you agreed to ... without your
-- rider-profile answers". Withdrawal DELETES the answers, so the evidence
-- cannot live on the profile row - it needs its own record.
--
-- What this table deliberately does NOT hold: any profile answer, any free
-- text, any email address. Only which signup, which direction, which version,
-- and when. It CASCADEs from the signup so it can never outlive the wait-list
-- record's retention ceiling, exactly as the notice states.
CREATE TABLE waitlist_profile_consent_events (
  id TEXT PRIMARY KEY,
  signup_id TEXT NOT NULL,
  event TEXT NOT NULL CHECK (event IN ('granted', 'withdrawn')),
  consent_copy_version TEXT NOT NULL,
  privacy_notice_version TEXT NOT NULL,
  occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (signup_id) REFERENCES waitlist_signups(id) ON DELETE CASCADE
);
CREATE INDEX idx_profile_consent_events_signup ON waitlist_profile_consent_events (signup_id, occurred_at);
