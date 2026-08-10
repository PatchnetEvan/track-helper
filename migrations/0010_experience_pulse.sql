-- MotoTrack Experience Pulse (track-helper #55, PR3A). A one-tap, optional,
-- ANONYMOUS read of a single experience INSTANCE - "How was this experience?"
-- 1 (Not good) / 2 (Okay) / 3 (Good). It lives in the feedback namespace but
-- is deliberately its OWN small table: no rider identity, and NO foreign key
-- into any waitlist signup or rider profile. A pulse is never a rider
-- classification (no happy/unhappy/churn/satisfaction/engagement profile) and
-- is never NPS. If a rider wants to explain WHY, they use the separate written
-- Feedback capability (feedback_submissions).
--
-- Captured: the 1|2|3 value, the same SAFE product context the Feedback intake
-- captures (originating section/route, canonical app_version stamped
-- SERVER-side, server-authoritative timestamp), a CLOSED action_context
-- vocabulary (never rider free text), and an OPTIONAL pointer to the written
-- feedback this pulse accompanied. It holds NO rider identity, tokens, cookies,
-- CSRF values, IP, precise location, device/behavioral fingerprint, navigation
-- history, or time-on-screen inference. Rate-limit state lives in the shared
-- waitlist_rate_buckets table under a Pulse-specific namespace, never here.
-- Prompt cadence (<=1 per app session AND <=1 per app_version in a rolling
-- 7-day window) is enforced CLIENT-side; no server-side identity is invented to
-- make cooldown perfect.
--
-- Raw retention is 13 months (see runRetentionSweep); there is no analytics
-- warehouse in v1 - the Scorecard (PR3B) reads this live window directly.
CREATE TABLE feedback_experience_pulses (
  id TEXT PRIMARY KEY,                              -- xp_<uuid>
  -- The single experience-instance signal. The DB is the last line of defense
  -- for the closed 1|2|3 domain; the service validates it first.
  value INTEGER NOT NULL CHECK (value IN (1, 2, 3)),
  -- Auto-captured SAFE product context, mirroring feedback_submissions.
  -- source_section is bounded FREE TEXT (not an enum) so a future canonical tab
  -- becomes valid context with no migration. A bad/absent value is nulled by
  -- the service, never a reason to lose the signal.
  source_section TEXT CHECK (source_section IS NULL OR length(source_section) <= 64),
  source_route TEXT CHECK (source_route IS NULL OR length(source_route) <= 200),
  -- CLOSED vocabulary for WHAT product moment produced the prompt. NULL allowed
  -- (a pulse with no declared context). Never arbitrary rider-supplied text.
  -- 'manual' is reserved for an explicitly opened Pulse surface; 'after_save'
  -- and 'after_review' are the initial automatic triggers.
  action_context TEXT CHECK (action_context IS NULL OR action_context IN ('manual', 'after_save', 'after_review')),
  -- Stamped SERVER-side from the canonical src/app-version.js. Any client value
  -- is ignored by the service; this column never carries a rider-defined string.
  app_version TEXT NOT NULL CHECK (length(app_version) BETWEEN 1 AND 64),
  -- OPTIONAL link to the written feedback this pulse accompanied. Most pulses
  -- have none. On the linked feedback's retention purge the link is SET NULL so
  -- the (still-anonymous) pulse survives and purging feedback never deadlocks.
  -- This is the ONLY foreign key a pulse ever has - never to a signup/profile.
  feedback_id TEXT REFERENCES feedback_submissions(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Scorecard reads (PR3B) aggregate by time window, then by section and by
-- version. Index the dimensions those reads filter/group on; every index leads
-- with or includes created_at because every window is time-bounded first.
CREATE INDEX idx_pulse_created ON feedback_experience_pulses (created_at);
CREATE INDEX idx_pulse_section ON feedback_experience_pulses (source_section, created_at);
CREATE INDEX idx_pulse_version ON feedback_experience_pulses (app_version, created_at);
