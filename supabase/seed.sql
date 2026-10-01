-- LOCAL/TEST ONLY. Supabase loads this file during `supabase db reset`; it is
-- not a production migration and is not HG-03 approval evidence.

INSERT INTO public.clinical_content_review_receipts (
  receipt_sha256,
  receipt_kind,
  artifact_reference,
  signed_at,
  reviewer_name,
  license_jurisdiction,
  license_identifier,
  attestation
) VALUES (
  repeat('f', 64),
  'local_test_fixture',
  'local://clinical-content-test-fixture-v1',
  '2026-07-20T00:00:00Z',
  NULL,
  NULL,
  NULL,
  'local_test_fixture_not_clinical_approval'
);

INSERT INTO public.clinical_content_releases (
  id,
  inventory_sha256,
  hg03_receipt_sha256,
  release_kind,
  approved_at,
  recommendations_enabled,
  programs_enabled,
  workouts_enabled,
  knowledge_links_enabled
) VALUES (
  'clinical-content-test-fixture-v1',
  '043d4f1e86e61ead691b073e9b9c4e5d716500d1d23b3243b7698a0d56f206b0',
  repeat('f', 64),
  'local_test_fixture',
  '2026-07-20T00:00:00Z',
  true,
  true,
  true,
  true
);

INSERT INTO public.clinical_content_release_items (
  release_id,
  item_id,
  item_kind,
  item_slug,
  item_sha256,
  review_status,
  reviewed_at,
  reviewer_note_sha256
) VALUES (
  'clinical-content-test-fixture-v1',
  'algorithm:recommendation-engine',
  'algorithm',
  'recommendation-engine-v1',
  '6bca8846b97342a13ea5366d49d835b6c8dc4fcb2cb11fcb6e09936b59017460',
  'approved',
  '2026-07-20T00:00:00Z',
  repeat('e', 64)
);

INSERT INTO private.clinical_content_activation (
  singleton,
  release_id,
  inventory_sha256,
  hg03_receipt_sha256,
  activated_at,
  activated_by_change
) VALUES (
  true,
  'clinical-content-test-fixture-v1',
  '043d4f1e86e61ead691b073e9b9c4e5d716500d1d23b3243b7698a0d56f206b0',
  repeat('f', 64),
  '2026-07-20T00:00:00Z',
  'local-test-seed-only'
);
