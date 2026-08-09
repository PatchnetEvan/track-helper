-- MotoTrack Feedback intake + triage (track-helper #55, PR 1). Rider feedback
-- is kept entirely separate from waitlist/profile/approval data: its own
-- tables, no FK into signups. D1 is the intake/triage source of truth; a
-- GitHub issue is an optional, operator-created downstream artifact, never the
-- owner of the record.
--
-- Intake captures the rider's free text, an optional contact email, and a
-- small bounded set of SAFE product context (originating section/route,
-- canonical app version, server-authoritative timestamp). It deliberately
-- holds NO tokens, cookies, CSRF values, credentials, browsing history,
-- precise location, IP, or device fingerprint. Rate-limit state lives in the
-- shared waitlist_rate_buckets table as operational metadata, never here.
CREATE TABLE feedback_submissions (
  id TEXT PRIMARY KEY,                              -- fb_<uuid>
  -- rider input
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  contact_email TEXT CHECK (contact_email IS NULL OR
    (length(contact_email) BETWEEN 6 AND 254 AND contact_email = lower(trim(contact_email)))),
  -- auto-captured product context. source_section is bounded FREE TEXT (not an
  -- enum) so a future canonical tab - hydration, fitness, maintenance -
  -- becomes valid context with no migration. app_version is server-stamped
  -- from the canonical source, never rider-supplied.
  source_section TEXT CHECK (source_section IS NULL OR length(source_section) <= 64),
  source_route TEXT CHECK (source_route IS NULL OR length(source_route) <= 200),
  app_version TEXT NOT NULL CHECK (length(app_version) BETWEEN 1 AND 64),
  -- triage lifecycle. Exactly four states; a duplicate is NOT a state, it is
  -- closed with closure_reason='duplicate'.
  triage_state TEXT NOT NULL DEFAULT 'new' CHECK (triage_state IN ('new', 'reviewing', 'actionable', 'closed')),
  closure_reason TEXT CHECK (closure_reason IS NULL OR closure_reason IN ('resolved', 'duplicate', 'not_actionable', 'spam')),
  -- optional pointer to the feedback this one duplicates; SET NULL on the
  -- original's retention purge so purging an original never deadlocks.
  duplicate_of_feedback_id TEXT REFERENCES feedback_submissions(id) ON DELETE SET NULL,
  -- GitHub promotion (operator action, PR 4). At most one NEW issue per record.
  github_repo TEXT,
  github_issue_number INTEGER,
  github_issue_url TEXT,
  promoted_at TEXT,
  promoted_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- closure_reason and closed_at are set exactly when the state is 'closed'.
  CHECK ((triage_state = 'closed') = (closure_reason IS NOT NULL)),
  CHECK ((triage_state = 'closed') = (closed_at IS NOT NULL)),
  -- duplicate_of is only meaningful for a duplicate closure.
  CHECK (duplicate_of_feedback_id IS NULL OR closure_reason = 'duplicate'),
  -- a record cannot be its own duplicate.
  CHECK (duplicate_of_feedback_id IS NULL OR duplicate_of_feedback_id <> id),
  -- promotion fields are coherent: all present together or all absent.
  CHECK (
    (github_repo IS NULL AND github_issue_number IS NULL AND promoted_at IS NULL AND promoted_by IS NULL)
    OR (github_repo IS NOT NULL AND github_issue_number IS NOT NULL AND promoted_at IS NOT NULL AND promoted_by IS NOT NULL)
  )
);
CREATE INDEX idx_feedback_state ON feedback_submissions (triage_state, created_at);
CREATE INDEX idx_feedback_closed ON feedback_submissions (closed_at);

-- Append-only operator triage history (same proven pattern as the approval and
-- consent event tables): event_seq ordering, BEFORE UPDATE immutability
-- trigger, and NO delete trigger so the parent retention purge can still
-- cascade. Intake creates NO event - only operator lifecycle actions do, so
-- every event carries a verified operator actor. Not a CRM notes system.
CREATE TABLE feedback_events (
  event_seq INTEGER PRIMARY KEY AUTOINCREMENT,
  feedback_id TEXT NOT NULL REFERENCES feedback_submissions(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN
    ('state_changed', 'marked_duplicate', 'github_issue_created', 'linked_existing_issue')),
  detail TEXT CHECK (detail IS NULL OR length(detail) <= 500),
  actor TEXT NOT NULL CHECK (length(actor) BETWEEN 3 AND 254),
  occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_feedback_events_feedback ON feedback_events (feedback_id, event_seq);

CREATE TRIGGER feedback_events_immutable
BEFORE UPDATE ON feedback_events
BEGIN
  SELECT RAISE(ABORT, 'feedback_events is append-only');
END;
