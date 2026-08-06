-- Optional post-confirmation rider profile (track-helper #31), PR 1.
-- Additive only. Profile data lives in its OWN table, deliberately separate
-- from consent, wait-list status, and suppression: deleting or suppressing a
-- wait-list record never depends on profile data, and no suppression decision
-- ever consults it. Nothing here can affect eligibility, position, or
-- invitation timing - there is deliberately no ranking, score, priority, or
-- completion column anywhere in this schema.

CREATE TABLE waitlist_profiles (
  id TEXT PRIMARY KEY,
  signup_id TEXT NOT NULL UNIQUE REFERENCES waitlist_signups(id),
  display_name TEXT CHECK (display_name IS NULL OR length(display_name) <= 100),
  -- Controlled multi-select stored as a JSON array of approved values; the
  -- optional free-text description for 'other' is stored SEPARATELY so the
  -- controlled vocabulary stays machine-readable and uncontaminated.
  track_involvement TEXT,
  track_involvement_other TEXT CHECK (track_involvement_other IS NULL OR length(track_involvement_other) <= 100),
  experience_level TEXT CHECK (experience_level IS NULL OR experience_level IN
    ('first_event_or_season', 'one_to_three_years', 'four_to_ten_years', 'more_than_ten_years', 'prefer_not_to_say')),
  primary_motorcycle TEXT CHECK (primary_motorcycle IS NULL OR length(primary_motorcycle) <= 200),
  other_motorcycles TEXT CHECK (other_motorcycles IS NULL OR length(other_motorcycles) <= 500),
  tracks_and_events TEXT CHECK (tracks_and_events IS NULL OR length(tracks_and_events) <= 500),
  timing_tools TEXT CHECK (timing_tools IS NULL OR length(timing_tools) <= 500),
  -- Plain text only, server-validated, 1,000 characters maximum.
  goals TEXT CHECK (goals IS NULL OR length(goals) <= 1000),
  interest_early_testing INTEGER NOT NULL DEFAULT 0 CHECK (interest_early_testing IN (0, 1)),
  interest_remote_coaching INTEGER NOT NULL DEFAULT 0 CHECK (interest_remote_coaching IN (0, 1)),
  interest_ai_coaching INTEGER NOT NULL DEFAULT 0 CHECK (interest_ai_coaching IN (0, 1)),
  profile_copy_version TEXT NOT NULL,
  privacy_notice_version TEXT NOT NULL,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Protected-link ledger. Tokens are hashed at rest and single-purpose: a
-- profile token can never confirm a signup or unsubscribe anyone. There is
-- no long-lived public editable URL - a link is consumed on a SUCCESSFUL
-- save, and a later edit requires a newly requested link.
CREATE TABLE waitlist_profile_invitations (
  id TEXT PRIMARY KEY,
  signup_id TEXT NOT NULL REFERENCES waitlist_signups(id),
  token_digest TEXT NOT NULL UNIQUE CHECK (length(token_digest) = 64),
  channel TEXT NOT NULL CHECK (channel IN ('welcome_email', 'later_invitation', 'requested_edit_link')),
  issued_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  revoked_at TEXT,
  superseded_at TEXT
);
CREATE INDEX idx_profile_invitations_signup ON waitlist_profile_invitations (signup_id, issued_at);

-- At most ONE operator-triggered later invitation per signup, enforced by the
-- engine rather than by convention.
CREATE UNIQUE INDEX idx_one_later_invitation_per_signup
  ON waitlist_profile_invitations (signup_id) WHERE channel = 'later_invitation';
