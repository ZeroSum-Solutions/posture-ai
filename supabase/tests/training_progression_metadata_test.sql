BEGIN;
SELECT no_plan();

SELECT has_table('public', 'training_session_progression_metadata', 'authored progression metadata has durable storage');
SELECT ok(NOT has_table_privilege('authenticated', 'public.training_session_progression_metadata', 'INSERT'),
  'browser cannot write progression metadata');

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id,email,created_at,updated_at) VALUES
  ('47000000-0000-4000-8000-000000000001','progression-owner@example.invalid',now(),now()),
  ('47000000-0000-4000-8000-000000000002','progression-other@example.invalid',now(),now());
INSERT INTO public.training_subjects(id,owner_user_id,status,activated_at) VALUES
  ('47000000-0000-4000-8000-000000000003','47000000-0000-4000-8000-000000000001','active',now());
INSERT INTO public.training_program_assignments(
  id,subject_id,program_mode,source_draft_id,status,active_revision
) VALUES (
  'progression-program-1','47000000-0000-4000-8000-000000000003','self_directed',
  '47000000-0000-4000-8000-000000000004','active',1
);
INSERT INTO public.training_program_revisions(
  assignment_id,subject_id,revision_number,program_json,created_by_user_id
) VALUES (
  'progression-program-1','47000000-0000-4000-8000-000000000003',1,
  '{"assignmentId":"progression-program-1","subjectId":"47000000-0000-4000-8000-000000000003","revisionNumber":1,"cycleLengthWeeks":8,"compilerPolicyVersion":"eight-week-compiler.v1","executionContext":{"kind":"live"}}'::jsonb,
  '47000000-0000-4000-8000-000000000001'
);
INSERT INTO public.training_sessions(
  id,assignment_id,subject_id,session_kind,state,scheduled_local_date,athlete_timezone
) VALUES
  ('progression-session-1','progression-program-1','47000000-0000-4000-8000-000000000003','strength','in_progress','2026-09-08','UTC'),
  ('progression-legacy-1','progression-program-1','47000000-0000-4000-8000-000000000003','strength','in_progress','2026-09-01','UTC'),
  ('progression-invalid-1','progression-program-1','47000000-0000-4000-8000-000000000003','strength','in_progress','2026-09-09','UTC');
SET LOCAL session_replication_role = origin;

CREATE FUNCTION pg_temp.progression_prescription(p_session_id text, p_progression jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT pg_catalog.jsonb_build_object(
    'schemaVersion','training-session-prescription.v1',
    'sessionId',p_session_id,
    'assignmentId','progression-program-1',
    'subjectId','47000000-0000-4000-8000-000000000003',
    'executionContext',pg_catalog.jsonb_build_object('kind','live'),
    'exercises',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('exerciseInstanceId',p_session_id || '-press')
      || CASE WHEN p_progression IS NULL THEN '{}'::jsonb
        ELSE pg_catalog.jsonb_build_object('progression',p_progression) END
    )
  );
$$;

INSERT INTO public.training_session_prescriptions(
  session_id,subject_id,assignment_id,program_revision_number,prescription_json,started_by_user_id,started_at
) VALUES (
  'progression-session-1','47000000-0000-4000-8000-000000000003','progression-program-1',1,
  pg_temp.progression_prescription('progression-session-1','{
    "progressionSeriesId":"strength-slot:push",
    "side":"bilateral",
    "rom":"catalog_default",
    "tempo":"self_selected_controlled",
    "exposureType":"standard",
    "loadEpoch":1
  }'::jsonb),
  '47000000-0000-4000-8000-000000000001','2026-09-08T17:00:00Z'
);

INSERT INTO public.training_session_prescriptions(
  session_id,subject_id,assignment_id,program_revision_number,prescription_json,started_by_user_id,started_at
) VALUES (
  'progression-legacy-1','47000000-0000-4000-8000-000000000003','progression-program-1',1,
  pg_temp.progression_prescription('progression-legacy-1',NULL),
  '47000000-0000-4000-8000-000000000001','2026-09-01T17:00:00Z'
);

SELECT results_eq(
  $$SELECT progression_series_id, metadata_json#>>'{comparator,side}', metadata_json#>>'{comparator,loadEpoch}'
    FROM public.training_session_progression_metadata
    WHERE session_id='progression-session-1'$$,
  $$VALUES ('strength-slot:push'::text,'bilateral'::text,'1'::text)$$,
  'new prescriptions persist exact authored comparator metadata once'
);
SELECT results_eq(
  $$SELECT count(*) FROM public.training_session_progression_metadata
    WHERE session_id IN ('progression-session-1','progression-legacy-1','progression-invalid-1')$$,
  $$VALUES (1::bigint)$$,
  'legacy prescriptions are not backfilled or assigned defaults'
);
SELECT ok((SELECT metadata_hash ~ '^[a-f0-9]{64}$'
  FROM public.training_session_progression_metadata
  WHERE session_id='progression-session-1'),
  'persisted metadata has a canonical evidence hash');

UPDATE public.training_sessions SET state='completed' WHERE id='progression-session-1';
SELECT ok((SELECT completed_at IS NOT NULL FROM public.training_sessions WHERE id='progression-session-1'),
  'terminal transition records an actual server completion timestamp');
SELECT throws_ok(
  $$UPDATE public.training_sessions SET completed_at=completed_at + interval '1 second' WHERE id='progression-session-1'$$,
  '55000', 'training session completion timestamp is immutable',
  'completion timestamp cannot be rewritten'
);
SELECT throws_ok(
  $$DELETE FROM public.training_session_progression_metadata WHERE session_id='progression-session-1'$$,
  '55000', NULL, 'authored progression evidence cannot be deleted'
);

SELECT set_config('request.jwt.claim.sub','47000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"47000000-0000-4000-8000-000000000001","aal":"aal2","iat":2000000000}',true);
SET LOCAL ROLE authenticated;
SELECT is(
  public.read_training_strength_evidence_projection('progression-session-1','progression-session-1-press')#>>'{metadata,progressionSeriesId}',
  'strength-slot:push',
  'owned session read exposes the persisted authored series'
);
SELECT is(
  public.read_training_strength_evidence_projection('progression-session-1','progression-session-1-press')#>>'{executionContext,kind}',
  'live',
  'progression read preserves the authorized execution context'
);
SELECT is(
  public.read_training_strength_evidence_projection('progression-session-1','progression-session-1-press')#>>'{metadata,startedAt}',
  '2026-09-08T17:00:00.000000Z',
  'started timestamp is the exact persisted server value in UTC'
);
SELECT is(
  public.read_training_strength_evidence_projection('progression-session-1','progression-session-1-press')#>>'{metadata,completedAt}',
  (SELECT pg_catalog.to_char(completed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    FROM public.training_sessions WHERE id='progression-session-1'),
  'completed timestamp is the exact persisted server value in UTC'
);
SELECT is(
  public.read_training_strength_evidence_projection('progression-legacy-1','progression-legacy-1-press')->'metadata',
  'null'::jsonb,
  'legacy session exposes unavailable metadata without guessed defaults'
);
RESET ROLE;

SELECT throws_ok($$
  INSERT INTO public.training_session_prescriptions(
    session_id,subject_id,assignment_id,program_revision_number,prescription_json,started_by_user_id
  ) VALUES (
    'progression-invalid-1','47000000-0000-4000-8000-000000000003','progression-program-1',1,
    pg_temp.progression_prescription('progression-invalid-1','{
      "progressionSeriesId":"strength-slot:push","side":"forged","rom":"catalog_default",
      "tempo":"self_selected_controlled","exposureType":"standard","loadEpoch":1
    }'::jsonb),
    '47000000-0000-4000-8000-000000000001'
  )
$$, '23514', 'invalid authored progression metadata',
  'malformed authored comparator metadata fails the start transaction');

SELECT throws_ok($$
  INSERT INTO public.training_session_prescriptions(
    session_id,subject_id,assignment_id,program_revision_number,prescription_json,started_by_user_id
  ) VALUES (
    'progression-invalid-1','47000000-0000-4000-8000-000000000003','progression-program-1',1,
    pg_temp.progression_prescription('progression-invalid-1','{
      "progressionSeriesId":"strength-slot:push","side":null,"rom":"catalog_default",
      "tempo":"self_selected_controlled","exposureType":"standard","loadEpoch":1
    }'::jsonb),
    '47000000-0000-4000-8000-000000000001'
  )
$$, '23514', 'invalid authored progression metadata',
  'null authored side cannot become progression evidence');

SELECT set_config('request.jwt.claim.sub','47000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"47000000-0000-4000-8000-000000000002","aal":"aal2","iat":2000000000}',true);
SET LOCAL ROLE authenticated;
SELECT is_empty(
  $$SELECT session_id FROM public.training_session_progression_metadata
    WHERE session_id IN ('progression-session-1','progression-legacy-1','progression-invalid-1')$$,
  'unrelated athlete cannot read progression evidence'
);
SELECT is(
  public.read_training_strength_evidence_projection('progression-session-1','progression-session-1-press'),
  NULL::jsonb,
  'unrelated athlete cannot read the evidence projection'
);
RESET ROLE;

SET CONSTRAINTS ALL IMMEDIATE;
SELECT * FROM finish();
ROLLBACK;
