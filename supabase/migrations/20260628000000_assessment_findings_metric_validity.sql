-- Wave 4 PR2a: store per-finding metric validity (the dominant honesty frame).
--
-- metric_validity records how trustworthy the SCORE is, independent of any muscle
-- inference. Derived at scoring time from engine threshold provenance
-- (packages/posture-engine/src/thresholds.ts -> metricValidity()):
-- LITERATURE_CITED when both zone boundaries are peer-reviewed cut-points (only
-- knee_extension_back_knee today), else SCREENING_ONLY. VALIDATED is reserved for
-- metrics that clear the Layer-1 validation study. Nullable: rows scored before
-- this migration stay NULL, and the PR2b render path treats NULL as SCREENING_ONLY
-- (the most conservative frame). Write-only in PR2a — nothing reads it yet.
-- Idempotent.

ALTER TABLE assessment_findings
  ADD COLUMN IF NOT EXISTS metric_validity TEXT
  CHECK (metric_validity IN ('VALIDATED', 'LITERATURE_CITED', 'SCREENING_ONLY'));
