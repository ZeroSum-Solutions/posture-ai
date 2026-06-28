-- Wave 4 PR2a: per-link evidence metadata on muscle_imbalance_links.
--
-- Foundation for the PR2b honesty gate. Schema-only in PR2a: no data is written
-- here (scored defaults true; the other three stay NULL) and no read path consumes
-- any of them until PR2b populates + renders them. Pure additive ADD COLUMN
-- (metadata-only in PG 11+: no table rewrite, no row relocation). Idempotent.
--
--   link_evidence            per-link confidence grade (content `confidence`).
--   scored                   false = display-only (excluded from the scored map
--                            in PR2b). DEFAULT true so pre-existing rows are scored.
--   exclusion_reason         why a display-only link is excluded (surfaced in PR2b).
--   direction_applicability  RESERVED for PR3 genu direction-conditioning
--                            (varum / valgum / both); unpopulated in PR2a.

ALTER TABLE muscle_imbalance_links
  ADD COLUMN IF NOT EXISTS link_evidence TEXT
    CHECK (link_evidence IN ('high', 'medium', 'low')),
  ADD COLUMN IF NOT EXISTS scored BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS exclusion_reason TEXT,
  ADD COLUMN IF NOT EXISTS direction_applicability TEXT
    CHECK (direction_applicability IN ('varum', 'valgum', 'both'));
