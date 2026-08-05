-- Geographic scope: U.S. beta waitlist + international interest list.
-- ADDITIVE only. One signup table keeps one row per email; the track is a
-- classification field derived from the rider's DECLARED country/region.
-- No geolocation, no IP-derived country, no separate duplicate tables.

ALTER TABLE waitlist_signups ADD COLUMN program_track TEXT
  CHECK (program_track IN ('us_beta_waitlist', 'international_interest'));

-- Deterministic classification of pre-existing rows from the country code
-- already stored. US + DC are 'US'; territories are enumerated. Records keep
-- their historical consent_copy_version / privacy_notice_version untouched.
UPDATE waitlist_signups
   SET program_track = CASE
         WHEN country_code IN ('US', 'PR', 'VI', 'GU', 'AS', 'MP', 'UM') THEN 'us_beta_waitlist'
         ELSE 'international_interest'
       END
 WHERE program_track IS NULL;
