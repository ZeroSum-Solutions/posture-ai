-- Stable assessment-submission identity for transport retry deduplication.
-- Legacy assessments remain NULL; every new POST /api/assessments write supplies
-- both fields. The partial unique index preserves historical rows while making a
-- practitioner's non-NULL submission key authoritative under concurrent inserts.

ALTER TABLE assessments
  ADD COLUMN IF NOT EXISTS submission_id UUID NULL,
  ADD COLUMN IF NOT EXISTS submission_digest TEXT NULL;

DO $$ BEGIN
  ALTER TABLE assessments ADD CONSTRAINT assessments_submission_identity_valid
    CHECK (
      (submission_id IS NULL AND submission_digest IS NULL)
      OR
      (submission_id IS NOT NULL AND submission_digest ~ '^[0-9a-f]{64}$')
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS assessments_practitioner_submission_uidx
  ON assessments (practitioner_id, submission_id)
  WHERE submission_id IS NOT NULL;

COMMENT ON COLUMN assessments.submission_id IS
  'Client-generated UUID reused only for an unchanged assessment transport retry.';
COMMENT ON COLUMN assessments.submission_digest IS
  'Server-computed SHA-256 of the canonical assessment scoring payload.';
