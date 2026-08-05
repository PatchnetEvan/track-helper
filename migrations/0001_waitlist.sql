-- MotoTrack public wait list (proposed schema; database creation is a
-- separately authorized deployment step). Additive only. Consent is
-- demonstrable: each signup pins the exact consent-copy and privacy-notice
-- versions agreed to, with consent/confirmation/unsubscribe timestamps.
-- No name, phone, precise location, or IP address is stored on the signup.

CREATE TABLE waitlist_signups (
  id TEXT PRIMARY KEY,
  email_normalized TEXT NOT NULL UNIQUE
    CHECK (email_normalized = lower(trim(email_normalized)) AND length(email_normalized) BETWEEN 6 AND 254),
  country_code TEXT NOT NULL CHECK (length(country_code) = 2 AND country_code = upper(country_code)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'unsubscribed')),
  consent_at TEXT NOT NULL,
  confirmed_at TEXT,
  unsubscribed_at TEXT,
  consent_copy_version TEXT NOT NULL,
  privacy_notice_version TEXT NOT NULL,
  signup_source TEXT,
  attribution TEXT,   -- JSON of utm_*/ref parameters already present on the signup page URL, else NULL
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Confirmation and unsubscribe tokens: hashed at rest, never stored raw.
-- Confirmation tokens are single-use with bounded expiration; unsubscribe
-- tokens are long-lived and idempotent so withdrawal always works.
CREATE TABLE waitlist_tokens (
  id TEXT PRIMARY KEY,
  signup_id TEXT NOT NULL REFERENCES waitlist_signups(id),
  token_digest TEXT NOT NULL UNIQUE CHECK (length(token_digest) = 64),
  purpose TEXT NOT NULL CHECK (purpose IN ('confirm', 'unsubscribe')),
  expires_at TEXT,               -- required for confirm, NULL for unsubscribe
  used_at TEXT,
  superseded_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (purpose != 'confirm' OR expires_at IS NOT NULL)
);
CREATE INDEX idx_waitlist_tokens_signup ON waitlist_tokens (signup_id, purpose);

-- Rate limiting: windowed counters keyed by a salted digest (email digest or
-- hashed client identifier). Short-lived operational data, purged as windows
-- roll; never joined to signup content for any other purpose.
CREATE TABLE waitlist_rate_buckets (
  bucket_key TEXT NOT NULL,
  window_start TEXT NOT NULL,
  send_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_key, window_start)
);

-- Delivery outcomes for operational visibility (no message bodies, no links).
CREATE TABLE waitlist_email_deliveries (
  id TEXT PRIMARY KEY,
  signup_id TEXT NOT NULL REFERENCES waitlist_signups(id),
  purpose TEXT NOT NULL CHECK (purpose IN ('confirm', 'welcome')),
  provider_status TEXT NOT NULL,
  requested_at TEXT NOT NULL DEFAULT (datetime('now'))
);
