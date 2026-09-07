BEGIN;

SELECT plan(25);

SELECT is(
  (
    SELECT pg_catalog.count(*)
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('clients', 'assessments', 'reports', 'workout_sessions')
      AND column_name = 'operation_mode'
  ),
  4::bigint,
  'persistent artifact roots expose an operation mode'
);

SELECT is(
  (
    SELECT column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'clients' AND column_name = 'operation_mode'
  ),
  '''governed''::text',
  'new ordinary rows default to governed operation'
);

SELECT ok(
  pg_catalog.to_regprocedure(
    'public.create_assessment_prototype(uuid,uuid,uuid,text,jsonb,jsonb,numeric,text,text,boolean,boolean,numeric)'
  ) IS NOT NULL
  AND pg_catalog.to_regprocedure(
    'public.create_workout_session_prototype(uuid,uuid,uuid,integer,text,jsonb,integer,uuid,text,jsonb,text,text,text)'
  ) IS NOT NULL
  AND pg_catalog.to_regprocedure(
    'public.finalize_report_upload_prototype(uuid,uuid,text,uuid,text,text,text)'
  ) IS NOT NULL,
  'prototype transaction boundaries exist'
);

SELECT ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.create_assessment_prototype(uuid,uuid,uuid,text,jsonb,jsonb,numeric,text,text,boolean,boolean,numeric)',
    'EXECUTE'
  )
  AND pg_catalog.has_function_privilege(
    'service_role',
    'public.create_workout_session_prototype(uuid,uuid,uuid,integer,text,jsonb,integer,uuid,text,jsonb,text,text,text)',
    'EXECUTE'
  )
  AND pg_catalog.has_function_privilege(
    'service_role',
    'public.finalize_report_upload_prototype(uuid,uuid,text,uuid,text,text,text)',
    'EXECUTE'
  )
  AND NOT pg_catalog.has_function_privilege(
    'authenticated',
    'public.create_assessment_prototype(uuid,uuid,uuid,text,jsonb,jsonb,numeric,text,text,boolean,boolean,numeric)',
    'EXECUTE'
  )
  AND NOT pg_catalog.has_function_privilege(
    'anon',
    'public.create_workout_session_prototype(uuid,uuid,uuid,integer,text,jsonb,integer,uuid,text,jsonb,text,text,text)',
    'EXECUTE'
  ),
  'only the server role can execute prototype writers'
);

SET LOCAL session_replication_role = replica;
INSERT INTO public.practitioners (id, display_name, access_status, role)
VALUES
  ('91000000-0000-4000-8000-000000000001', 'Prototype operator', 'active', 'practitioner'),
  ('91000000-0000-4000-8000-000000000002', 'Other operator', 'active', 'practitioner');
SET LOCAL session_replication_role = origin;

INSERT INTO public.clients (id, practitioner_id, first_name, last_name, operation_mode)
VALUES (
  '92000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  'Prototype', 'Client', 'prototype'
);
INSERT INTO public.clients (id, practitioner_id, first_name, last_name)
VALUES (
  '92000000-0000-4000-8000-000000000002',
  '91000000-0000-4000-8000-000000000001',
  'Governed', 'Default'
);

SELECT is(
  (SELECT operation_mode FROM public.clients WHERE id = '92000000-0000-4000-8000-000000000002'),
  'governed',
  'governed default applies without changing prototype rows'
);

SELECT throws_ok(
  $$
    UPDATE public.clients SET operation_mode = 'governed'
    WHERE id = '92000000-0000-4000-8000-000000000001'
  $$,
  '55000',
  'operation mode is immutable',
  'artifact operation mode cannot be relabelled'
);

SELECT throws_ok(
  $$
    INSERT INTO public.assessments (
      client_id, practitioner_id, status, operation_mode, legal_provenance_state
    ) VALUES (
      '92000000-0000-4000-8000-000000000001',
      '91000000-0000-4000-8000-000000000001',
      'processing', 'prototype', 'legacy_unverified'
    )
  $$,
  '23514',
  NULL,
  'prototype assessment mode requires explicit prototype legal provenance'
);

CREATE TEMP TABLE assessment_result AS
SELECT public.create_assessment_prototype(
  '92000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  '93000000-0000-4000-8000-000000000001',
  repeat('a', 64),
  '[{"view":"front","source":"upload","profile_side":null,"pose_frame":{"view":"front","landmarks":[]}}]'::jsonb,
  '[{"imbalance_key":"forward_head","region":"head_neck","label":"Forward head","deviation":8,"standard":0,"unit":"deg","direction":"forward","severity_pct":40,"zone":"warning","view_used":"side","confidence":0.9,"metric_validity":"SCREENING_ONLY","stability_score":null,"uncertainty_deg":null,"borderline":false,"observations":null}]'::jsonb,
  14, 'B', 'prototype-engine-1', false, true, NULL
) AS value;

SELECT is(
  (SELECT value->>'status' FROM assessment_result),
  'complete',
  'prototype assessment transaction completes'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.assessments assessment
    WHERE assessment.id = (SELECT (value->>'assessment_id')::uuid FROM assessment_result)
      AND assessment.operation_mode = 'prototype'
      AND assessment.legal_provenance_state = 'prototype'
      AND assessment.legal_document_id IS NULL
  )
  AND EXISTS (
    SELECT 1 FROM public.captures capture
    WHERE capture.assessment_id = (SELECT (value->>'assessment_id')::uuid FROM assessment_result)
      AND capture.practitioner_id = '91000000-0000-4000-8000-000000000001'
  )
  AND EXISTS (
    SELECT 1 FROM public.assessment_findings finding
    WHERE finding.assessment_id = (SELECT (value->>'assessment_id')::uuid FROM assessment_result)
      AND finding.practitioner_id = '91000000-0000-4000-8000-000000000001'
  ),
  'assessment, minimized capture, and findings commit with prototype provenance'
);

SELECT ok(
  (
    public.create_assessment_prototype(
      '92000000-0000-4000-8000-000000000001',
      '91000000-0000-4000-8000-000000000001',
      '93000000-0000-4000-8000-000000000001', repeat('a', 64),
      '[{"view":"front","source":"upload","pose_frame":{}}]'::jsonb,
      '[]'::jsonb, 14, 'B', 'prototype-engine-1', false, true, NULL
    )->>'replayed'
  )::boolean
  AND (
    SELECT pg_catalog.count(*) FROM public.assessments
    WHERE submission_id = '93000000-0000-4000-8000-000000000001'
  ) = 1,
  'assessment submission replay is idempotent'
);

SELECT is(
  public.create_assessment_prototype(
    '92000000-0000-4000-8000-000000000002',
    '91000000-0000-4000-8000-000000000001',
    '93000000-0000-4000-8000-000000000001', repeat('a', 64),
    '[{"view":"front","source":"upload","pose_frame":{}}]'::jsonb,
    '[]'::jsonb, 14, 'B', 'prototype-engine-1', false, true, NULL
  )->>'status',
  'submission_conflict',
  'a submission id cannot replay across two clients owned by the same practitioner'
);

INSERT INTO public.assessments (
  id, client_id, practitioner_id, submission_id, submission_digest, status
) VALUES (
  '93000000-0000-4000-8000-000000000010',
  '92000000-0000-4000-8000-000000000002',
  '91000000-0000-4000-8000-000000000001',
  '93000000-0000-4000-8000-000000000011',
  repeat('f', 64),
  'complete'
);

SELECT is(
  public.create_assessment_prototype(
    '92000000-0000-4000-8000-000000000002',
    '91000000-0000-4000-8000-000000000001',
    '93000000-0000-4000-8000-000000000011', repeat('f', 64),
    '[{"view":"front","source":"upload","pose_frame":{}}]'::jsonb,
    '[]'::jsonb, 14, 'B', 'prototype-engine-1', false, true, NULL
  )->>'status',
  'submission_conflict',
  'a governed submission cannot be relabelled as a prototype replay'
);

SELECT is(
  public.create_assessment_prototype(
    '92000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000002',
    '93000000-0000-4000-8000-000000000002', repeat('b', 64),
    '[{"view":"front","source":"upload","pose_frame":{}}]'::jsonb,
    '[]'::jsonb, 10, 'A', 'prototype-engine-1', false, true, NULL
  )->>'status',
  'not_found',
  'another practitioner cannot create an assessment for the client'
);

SELECT throws_ok(
  $$
    SELECT public.create_assessment_prototype(
      '92000000-0000-4000-8000-000000000001',
      '91000000-0000-4000-8000-000000000001',
      '93000000-0000-4000-8000-000000000003', repeat('c', 64),
      '[{"view":"invalid","source":"upload","pose_frame":{}}]'::jsonb,
      '[]'::jsonb, 10, 'A', 'prototype-engine-1', false, true, NULL
    )
  $$,
  '22P02',
  'invalid input value for enum public.view_enum: "invalid"',
  'invalid child data aborts the assessment transaction'
);

SELECT is(
  (
    SELECT pg_catalog.count(*) FROM public.assessments
    WHERE submission_id = '93000000-0000-4000-8000-000000000003'
  ),
  0::bigint,
  'a failed child insert leaves no partial assessment row'
);

UPDATE public.assessments
SET practitioner_approved = true, practitioner_approved_at = pg_catalog.clock_timestamp()
WHERE id = (SELECT (value->>'assessment_id')::uuid FROM assessment_result);

CREATE TEMP TABLE workout_result AS
SELECT public.create_workout_session_prototype(
  (SELECT (value->>'assessment_id')::uuid FROM assessment_result),
  '92000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  1, 'standard',
  jsonb_build_object(
    'version', 4,
    'operationMode', 'prototype',
    'contentState', 'prototype_unreviewed',
    'week', 1,
    'capability', 'standard',
    'priorities', '[]'::jsonb,
    'items', '[]'::jsonb,
    'estimatedDurationSec', 60,
    'disclaimer', 'Screening only.',
    'clinicalContent', jsonb_build_object(
      'version', 'clinical-content-prototype-v1',
      'inventorySha256', repeat('d', 64)
    )
  ),
  60,
  '94000000-0000-4000-8000-000000000001',
  'Desk reset',
  '{"goal":"desk-reset","minutes":"10","capability":"standard","equipment":[]}'::jsonb,
  'scan',
  'clinical-content-prototype-v1',
  repeat('d', 64)
) AS value;

SELECT is(
  (SELECT value->>'status' FROM workout_result),
  'created',
  'prototype workout transaction completes'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.workout_sessions session
    WHERE session.id = (SELECT (value->>'session_id')::uuid FROM workout_result)
      AND session.operation_mode = 'prototype'
      AND session.legal_provenance_state = 'prototype'
      AND session.legal_document_id IS NULL
      AND session.clinical_review_receipt_sha256 IS NULL
      AND session.session_token_hash IS NULL
      AND session.expires_at IS NULL
      AND session.program_snapshot->>'contentState' = 'prototype_unreviewed'
  )
  AND EXISTS (
    SELECT 1 FROM public.session_runs run
    WHERE run.workout_session_id = (SELECT (value->>'session_id')::uuid FROM workout_result)
  ),
  'prototype workout and player run commit without legal, approval, or share provenance'
);

SELECT is(
  public.create_workout_session_prototype(
    (SELECT (value->>'assessment_id')::uuid FROM assessment_result),
    '92000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000002',
    1, 'standard', '{}'::jsonb, 60,
    '94000000-0000-4000-8000-000000000002', 'Other',
    '{"goal":"balanced","minutes":"10","capability":"standard","equipment":[]}'::jsonb,
    'scan', 'clinical-content-prototype-v1', repeat('d', 64)
  )->>'status',
  'invalid_input',
  'malformed prototype workout input is rejected before ownership lookup'
);

SELECT is(
  public.create_workout_session_prototype(
    (SELECT (value->>'assessment_id')::uuid FROM assessment_result),
    '92000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000001',
    1, 'standard',
    jsonb_build_object(
      'version', 4, 'operationMode', 'prototype',
      'contentState', 'prototype_unreviewed', 'legalNotice', '{}'::jsonb,
      'clinicalContent', jsonb_build_object(
        'version', 'clinical-content-prototype-v1', 'inventorySha256', repeat('d', 64)
      )
    ),
    60, '94000000-0000-4000-8000-000000000003', 'Bad notice',
    '{"goal":"balanced","minutes":"10","capability":"standard","equipment":[]}'::jsonb,
    'scan', 'clinical-content-prototype-v1', repeat('d', 64)
  )->>'status',
  'invalid_input',
  'prototype workout cannot carry a legal notice'
);

SELECT throws_ok(
  pg_catalog.format(
    'UPDATE public.workout_sessions SET session_token_hash = %L, expires_at = clock_timestamp() + interval ''1 hour'' WHERE id = %L',
    repeat('e', 64),
    (SELECT value->>'session_id' FROM workout_result)
  ),
  '23514',
  'a revoked or inactive workout share cannot be restored',
  'a privileged direct update cannot create a prototype bearer share'
);

INSERT INTO public.privacy_storage_deletion_outbox (
  deletion_receipt_id, source_code, bucket, object_path, next_attempt_at
) VALUES (
  NULL, 'report_insert_compensation', 'posture-reports',
  '91000000-0000-4000-8000-000000000001/'
    || (SELECT value->>'assessment_id' FROM assessment_result)
    || '/practitioner/prototype.pdf',
  pg_catalog.clock_timestamp() + interval '15 minutes'
);

CREATE TEMP TABLE report_result AS
SELECT public.finalize_report_upload_prototype(
  (SELECT (value->>'assessment_id')::uuid FROM assessment_result),
  '91000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001/'
    || (SELECT value->>'assessment_id' FROM assessment_result)
    || '/practitioner/prototype.pdf',
  NULL,
  'clinical_practitioner',
  'clinical-content-prototype-v1',
  repeat('d', 64)
) AS value;

SELECT is(
  (SELECT value->>'status' FROM report_result),
  'created',
  'prototype report finalization completes'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.reports report
    WHERE report.id = (SELECT (value->>'report_id')::uuid FROM report_result)
      AND report.operation_mode = 'prototype'
      AND report.legal_provenance_state = 'prototype'
      AND report.legal_document_id IS NULL
      AND report.clinical_content_version = 'clinical-content-prototype-v1'
      AND report.clinical_review_receipt_sha256 IS NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.privacy_storage_deletion_outbox job
    WHERE job.object_path LIKE '%/practitioner/prototype.pdf'
  ),
  'prototype report stores truthful provenance and consumes its cleanup intent'
);

SELECT is(
  public.finalize_report_upload_prototype(
    (SELECT (value->>'assessment_id')::uuid FROM assessment_result),
    '91000000-0000-4000-8000-000000000002',
    '91000000-0000-4000-8000-000000000002/'
      || (SELECT value->>'assessment_id' FROM assessment_result)
      || '/practitioner/wrong-owner.pdf',
    NULL, 'assessment_only', NULL, NULL
  )->>'status',
  'not_found',
  'another practitioner cannot finalize a report for the assessment'
);

SELECT throws_ok(
  $$
    INSERT INTO public.reports (
      assessment_id, practitioner_id, storage_path, operation_mode,
      legal_provenance_state, legal_document_id, report_scope
    ) VALUES (
      (SELECT (value->>'assessment_id')::uuid FROM assessment_result),
      '91000000-0000-4000-8000-000000000001', 'invalid-provenance.pdf',
      'prototype', 'prototype', 'invented-document', 'assessment_only'
    )
  $$,
  '23514',
  NULL,
  'prototype rows cannot carry invented legal provenance'
);

SELECT ok(
  pg_catalog.to_regprocedure(
    'public.create_workout_session_clinical_governed(uuid,uuid,uuid,integer,text,jsonb,integer,text,timestamp with time zone,uuid,text,text,text,text,timestamp with time zone,text,text,text,text)'
  ) IS NOT NULL
  AND pg_catalog.to_regprocedure(
    'public.finalize_report_upload_v2(uuid,uuid,text,uuid,text,text,text,timestamp with time zone,text,text,text,text,text)'
  ) IS NOT NULL,
  'governed artifact boundaries remain installed'
);

SELECT * FROM finish();
ROLLBACK;
