-- Append-only rider-profile consent history (privacy notice 2026-08-05.3).
--
-- Current profile-consent state is DERIVED from this history, never stored as
-- a mutable flag: no events or a latest `withdrawn` means no active consent; a
-- latest `granted` means active consent. Withdrawal appends `withdrawn`;
-- re-consenting later appends a further `granted`, so a legitimate history is
-- granted → withdrawn → granted → withdrawn.
--
-- Ordering is by event_seq, not by occurred_at: two events can share a
-- whole-second timestamp, and consent state must never depend on a tie-break.
--
-- What this table deliberately does NOT hold: email address, profile answers,
-- goals or any free text, motorcycle data, track data, IP address, invitation
-- tokens, or edit-authorization tokens/digests. Only which signup, which
-- direction, under which versions, by which method, and when.
--
-- It CASCADEs from the signup, so consent history is removed only as a
-- consequence of the signup itself reaching its retention purge - never by an
-- application code path, which has no individual-event deletion API at all.
CREATE TABLE waitlist_profile_consent_events (
  event_seq INTEGER PRIMARY KEY AUTOINCREMENT,
  signup_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('granted', 'withdrawn')),
  profile_consent_version TEXT NOT NULL,
  privacy_notice_version TEXT NOT NULL,
  consent_method TEXT NOT NULL CHECK (consent_method IN ('profile_form_checkbox', 'profile_delete_action')),
  occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (signup_id) REFERENCES waitlist_signups(id) ON DELETE CASCADE
);
CREATE INDEX idx_profile_consent_events_signup ON waitlist_profile_consent_events (signup_id, event_seq);

-- Immutability. An UPDATE would rewrite what a rider consented to, or when, or
-- under which notice version - the one thing consent evidence must never do.
-- There is deliberately NO delete trigger: a blanket BEFORE DELETE would break
-- the required parent ON DELETE CASCADE and strand consent history past the
-- signup's retention ceiling.
CREATE TRIGGER waitlist_profile_consent_events_immutable
BEFORE UPDATE ON waitlist_profile_consent_events
BEGIN
  SELECT RAISE(ABORT, 'waitlist_profile_consent_events is append-only');
END;
