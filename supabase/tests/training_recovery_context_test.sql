BEGIN;

SELECT plan(21);

SELECT has_table('public', 'training_recovery_context_records',
  'recovery context has immutable durable storage');
SELECT ok(NOT has_table_privilege('authenticated', 'public.training_recovery_context_records', 'INSERT'),
  'browser cannot insert a forged recovery record');
SELECT ok(NOT has_function_privilege('service_role',
  'public.record_training_recovery_context(text,text,uuid,jsonb)', 'EXECUTE'),
  'service role cannot impersonate an authenticated recovery report');
SELECT ok(private.is_valid_training_recovery_context('{
  "report":{"schemaVersion":"recovery-context.v1","capturedAt":"2026-09-09T08:00:00Z",
  "sleep":"unknown","fatigue":"concern_reported","schedule":"no_concern_reported","illness":"unknown"},
  "choice":"hold"}'::jsonb), 'the closed recovery context shape is accepted');
SELECT ok(NOT private.is_valid_training_recovery_context('{
  "report":{"schemaVersion":"recovery-context.v1","capturedAt":"2026-09-09T08:00:00Z",
  "sleep":"unknown","fatigue":"concern_reported","schedule":"no_concern_reported","illness":"unknown",
  "diagnosis":"none"}}'::jsonb), 'unknown nested recovery claims are rejected');

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id,email,created_at,updated_at) VALUES (
  '67000000-0000-4000-8000-000000000001',
  'recovery-context-athlete@example.invalid',now(),now()
);
INSERT INTO public.training_subjects(
  id,owner_user_id,status,activated_at,session_valid_after
) VALUES (
  '67000000-0000-4000-8000-000000000002',
  '67000000-0000-4000-8000-000000000001','active',now(),'-infinity'
);
INSERT INTO public.training_program_assignments(
  id,subject_id,program_mode,owning_practitioner_id,simulation_run_id,
  source_draft_id,status,active_revision,revision
) VALUES (
  'recovery-assignment-1','67000000-0000-4000-8000-000000000002',
  'self_directed',NULL,NULL,'67000000-0000-4000-8000-000000000003',
  'active',1,1
);

CREATE FUNCTION pg_temp.recovery_program(p_revision integer)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT pg_catalog.jsonb_build_object(
    'schemaVersion','training-program-revision.v1',
    'assignmentId','recovery-assignment-1',
    'subjectId','67000000-0000-4000-8000-000000000002',
    'programMode','self_directed',
    'revisionNumber',p_revision,
    'cycleLengthWeeks',8,
    'compilerPolicyVersion','strength-cycle-compiler.v3',
    'executionContext',pg_catalog.jsonb_build_object('kind','live'),
    'sessions',pg_catalog.jsonb_build_array()
  );
$$;

INSERT INTO public.training_program_revisions(
  assignment_id,subject_id,revision_number,program_json,created_by_user_id
) VALUES
  ('recovery-assignment-1','67000000-0000-4000-8000-000000000002',1,
    pg_temp.recovery_program(1),'67000000-0000-4000-8000-000000000001'),
  ('recovery-assignment-1','67000000-0000-4000-8000-000000000002',2,
    pg_temp.recovery_program(2),'67000000-0000-4000-8000-000000000001');

INSERT INTO public.training_sessions(
  id,assignment_id,subject_id,session_kind,state,scheduled_local_date,
  athlete_timezone,revision,completed_at
) VALUES
  ('recovery-session-source','recovery-assignment-1','67000000-0000-4000-8000-000000000002',
    'strength','completed','2026-09-08','UTC',4,'2026-09-08T18:00:00Z'),
  ('recovery-session-target','recovery-assignment-1','67000000-0000-4000-8000-000000000002',
    'strength','scheduled','2026-09-11','UTC',1,NULL);
INSERT INTO public.training_session_prescriptions(
  session_id,subject_id,assignment_id,program_revision_number,
  prescription_json,started_by_user_id,started_at
) VALUES (
  'recovery-session-source','67000000-0000-4000-8000-000000000002',
  'recovery-assignment-1',1,
  '{"schemaVersion":"training-session-prescription.v1","sessionId":"recovery-session-source",
    "subjectId":"67000000-0000-4000-8000-000000000002","assignmentId":"recovery-assignment-1",
    "executionContext":{"kind":"live"},"exercises":[{"exerciseInstanceId":"recovery-exercise-source"}]}'::jsonb,
  '67000000-0000-4000-8000-000000000001','2026-09-08T17:00:00Z'
);
INSERT INTO public.training_session_progression_metadata(
  session_id,subject_id,exercise_instance_id,progression_series_id,metadata_json,created_at
) VALUES (
  'recovery-session-source','67000000-0000-4000-8000-000000000002',
  'recovery-exercise-source','strength-slot:push',
  '{"schemaVersion":"strength-session-progression-metadata.v1",
    "prescriptionSourceRevisionId":"training-session-prescription.v1:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "progressionSeriesId":"strength-slot:push",
    "comparator":{"side":"bilateral","rom":"catalog_default","tempo":"controlled",
      "exposureType":"standard","loadEpoch":1}}'::jsonb,
  '2026-09-08T17:00:00Z'
);
SET LOCAL session_replication_role = origin;

SELECT set_config('request.jwt.claim.sub','67000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims',
  '{"sub":"67000000-0000-4000-8000-000000000001","aal":"aal2","iat":2000000000}',true);
SET LOCAL ROLE authenticated;

CREATE TEMP TABLE recovery_results(name text PRIMARY KEY, value jsonb);
INSERT INTO recovery_results VALUES ('hold', public.record_training_recovery_context(
  'recovery-session-source','recovery-exercise-source',
  '67000000-0000-4000-8000-000000000010',
  '{"report":{"schemaVersion":"recovery-context.v1","capturedAt":"2026-09-09T08:00:00Z",
    "sleep":"unknown","fatigue":"concern_reported","schedule":"no_concern_reported","illness":"unknown"},
    "choice":"hold"}'::jsonb
));
SELECT is((SELECT value#>>'{context,choice}' FROM recovery_results WHERE name='hold'),
  'hold', 'an AAL2 subject owner records an explicit hold');
SELECT is(public.record_training_recovery_context(
  'recovery-session-source','recovery-exercise-source',
  '67000000-0000-4000-8000-000000000010',
  '{"report":{"schemaVersion":"recovery-context.v1","capturedAt":"2026-09-09T08:00:00Z",
    "sleep":"unknown","fatigue":"concern_reported","schedule":"no_concern_reported","illness":"unknown"},
    "choice":"hold"}'::jsonb
)#>>'{recordId}', (SELECT value->>'recordId' FROM recovery_results WHERE name='hold'),
  'an exact retry returns the immutable record');
SELECT is((SELECT count(*)::text FROM public.training_recovery_context_records), '1',
  'an exact retry does not duplicate recovery history');
SELECT throws_ok($$
  SELECT public.record_training_recovery_context(
    'recovery-session-source','recovery-exercise-source',
    '67000000-0000-4000-8000-000000000010',
    '{"report":{"schemaVersion":"recovery-context.v1","capturedAt":"2026-09-09T08:00:00Z",
      "sleep":"unknown","fatigue":"no_concern_reported","schedule":"no_concern_reported","illness":"unknown"}}'::jsonb
  )$$, 'PT409', 'recovery request ID reused with different content',
  'changed content with the same request identity is a conflict');
SELECT is(public.read_training_recovery_context(
  'recovery-session-source','recovery-exercise-source'
)#>>'{context,choice}', 'hold', 'an omitted create payload can recover the applicable saved hold');

RESET ROLE;
SET LOCAL session_replication_role = replica;
UPDATE public.training_program_assignments
SET active_revision=2, revision=2
WHERE id='recovery-assignment-1';
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE authenticated;
SELECT is(public.read_training_recovery_context(
  'recovery-session-source','recovery-exercise-source'
)#>>'{context,choice}', 'hold',
  'an unrelated program revision preserves a hold for the same authored series');

INSERT INTO recovery_results VALUES ('resume', public.record_training_recovery_context(
  'recovery-session-source','recovery-exercise-source',
  '67000000-0000-4000-8000-000000000011',
  '{"report":{"schemaVersion":"recovery-context.v1","capturedAt":"2026-09-09T09:00:00Z",
    "sleep":"no_concern_reported","fatigue":"unknown","schedule":"unknown","illness":"unknown"}}'::jsonb
));
SELECT is(public.read_training_recovery_context(
  'recovery-session-source','recovery-exercise-source'
)#>>'{recordId}', (SELECT value->>'recordId' FROM recovery_results WHERE name='resume'),
  'the latest report without a choice explicitly resumes the performance path');
SELECT is(public.read_training_recovery_context(
  'recovery-session-source','unknown-exercise'
)::text, NULL, 'a recovery report does not leak across progression series');

RESET ROLE;
SET LOCAL session_replication_role = replica;
INSERT INTO public.training_progression_proposals(
  id,proposal_key,created_by_user_id,subject_id,assignment_id,
  base_program_revision_number,base_assignment_revision,target_session_id,
  target_exercise_instance_id,target_session_revision,recovery_context_record_id,
  progression_series_id,source_profile_revision,source_eligibility_revision_id,
  source_program_hash,execution_context,source_session_revisions,
  mutable_target_revisions,decision_json
) SELECT
  proposal_id,repeat(key_character,64),'67000000-0000-4000-8000-000000000001',
  '67000000-0000-4000-8000-000000000002','recovery-assignment-1',2,2,
  'recovery-session-target','recovery-exercise-target',1,recovery_id,
  'strength-slot:push',1,'eligibility-recovery-1',program_hash,'{"kind":"live"}'::jsonb,
  '[{"sessionId":"recovery-session-source","revision":4}]'::jsonb,
  '[{"sessionId":"recovery-session-target","sessionRevision":1,"exerciseInstanceId":"recovery-exercise-target","scheduledLocalDate":"2026-09-11"}]'::jsonb,
  pg_catalog.jsonb_build_object(
    'kind','rep_proposal','status','proposed','decisionKey','recovery-decision-'||key_character,
    'subjectId','67000000-0000-4000-8000-000000000002','sourceProfileRevisionId','1',
    'sourceEligibilityRevisionId','eligibility-recovery-1','executionContext',pg_catalog.jsonb_build_object('kind','live'),
    'proposal',pg_catalog.jsonb_build_object(
      'load',pg_catalog.jsonb_build_object('equipmentId','machine-1'),
      'targetReps',pg_catalog.jsonb_build_array(7,6)
    )
  )
FROM (VALUES
  ('67000000-0000-4000-8000-000000000020'::uuid,'a',NULL::uuid),
  ('67000000-0000-4000-8000-000000000021'::uuid,'b',
    (SELECT (value->>'recordId')::uuid FROM recovery_results WHERE name='resume'))
) proposal(proposal_id,key_character,recovery_id)
CROSS JOIN public.training_program_revisions revision
WHERE revision.assignment_id='recovery-assignment-1' AND revision.revision_number=2;
SET LOCAL session_replication_role = origin;

SELECT throws_ok($$
  INSERT INTO public.training_progression_acceptances(
    proposal_id,actor_user_id,request_id,request_hash,assignment_id,
    result_program_revision_number,result_json
  ) VALUES (
    '67000000-0000-4000-8000-000000000020','67000000-0000-4000-8000-000000000001',
    '67000000-0000-4000-8000-000000000030',repeat('c',64),'recovery-assignment-1',2,
    '{"schemaVersion":"training-progression-acceptance.v1",
      "proposalId":"67000000-0000-4000-8000-000000000020",
      "assignmentId":"recovery-assignment-1","programRevisionNumber":2}'::jsonb
  )$$, 'PT409', 'progression recovery context changed',
  'a saved record stales a legacy proposal without a recovery binding');

INSERT INTO public.training_progression_acceptances(
  proposal_id,actor_user_id,request_id,request_hash,assignment_id,
  result_program_revision_number,result_json
) VALUES (
  '67000000-0000-4000-8000-000000000021','67000000-0000-4000-8000-000000000001',
  '67000000-0000-4000-8000-000000000031',repeat('d',64),'recovery-assignment-1',2,
  '{"schemaVersion":"training-progression-acceptance.v1",
    "proposalId":"67000000-0000-4000-8000-000000000021",
    "assignmentId":"recovery-assignment-1","programRevisionNumber":2}'::jsonb
);
SELECT is((SELECT count(*)::text FROM public.training_progression_acceptances
  WHERE assignment_id='recovery-assignment-1'), '1',
  'a proposal bound to the latest no-choice report can be accepted');

SET LOCAL ROLE authenticated;
INSERT INTO recovery_results VALUES ('later-hold', public.record_training_recovery_context(
  'recovery-session-source','recovery-exercise-source',
  '67000000-0000-4000-8000-000000000012',
  '{"report":{"schemaVersion":"recovery-context.v1","capturedAt":"2026-09-09T10:00:00Z",
    "sleep":"unknown","fatigue":"concern_reported","schedule":"unknown","illness":"unknown"},
    "choice":"request_review"}'::jsonb
));
RESET ROLE;

SET LOCAL session_replication_role = replica;
INSERT INTO public.training_progression_proposals(
  id,proposal_key,created_by_user_id,subject_id,assignment_id,
  base_program_revision_number,base_assignment_revision,target_session_id,
  target_exercise_instance_id,target_session_revision,recovery_context_record_id,
  progression_series_id,source_profile_revision,source_eligibility_revision_id,
  source_program_hash,execution_context,source_session_revisions,
  mutable_target_revisions,decision_json
) SELECT
  '67000000-0000-4000-8000-000000000022',repeat('e',64),
  '67000000-0000-4000-8000-000000000001','67000000-0000-4000-8000-000000000002',
  'recovery-assignment-1',2,2,'recovery-session-target','recovery-exercise-target',1,
  (SELECT (value->>'recordId')::uuid FROM recovery_results WHERE name='resume'),
  'strength-slot:push',1,'eligibility-recovery-1',program_hash,'{"kind":"live"}'::jsonb,
  '[{"sessionId":"recovery-session-source","revision":4}]'::jsonb,
  '[{"sessionId":"recovery-session-target","sessionRevision":1,"exerciseInstanceId":"recovery-exercise-target","scheduledLocalDate":"2026-09-11"}]'::jsonb,
  '{"kind":"rep_proposal","status":"proposed","decisionKey":"recovery-decision-e",
    "subjectId":"67000000-0000-4000-8000-000000000002","sourceProfileRevisionId":"1",
    "sourceEligibilityRevisionId":"eligibility-recovery-1","executionContext":{"kind":"live"},
    "proposal":{"load":{"equipmentId":"machine-1"},"targetReps":[7,6]}}'::jsonb
FROM public.training_program_revisions
WHERE assignment_id='recovery-assignment-1' AND revision_number=2;
SET LOCAL session_replication_role = origin;

SELECT throws_ok($$
  INSERT INTO public.training_progression_acceptances(
    proposal_id,actor_user_id,request_id,request_hash,assignment_id,
    result_program_revision_number,result_json
  ) VALUES (
    '67000000-0000-4000-8000-000000000022','67000000-0000-4000-8000-000000000001',
    '67000000-0000-4000-8000-000000000032',repeat('f',64),'recovery-assignment-1',2,
    '{"schemaVersion":"training-progression-acceptance.v1",
      "proposalId":"67000000-0000-4000-8000-000000000022",
      "assignmentId":"recovery-assignment-1","programRevisionNumber":2}'::jsonb
  )$$, 'PT409', 'progression recovery context changed',
  'a newer applicable record stales a proposal bound to an older report');

SET LOCAL ROLE authenticated;
SELECT is(public.erase_training_subject_transactional(
  '67000000-0000-4000-8000-000000000040'
)#>>'{status}', 'erased', 'subject erasure succeeds with recovery descendants');
RESET ROLE;
SELECT is((SELECT count(*)::text FROM public.training_recovery_context_records
  WHERE subject_id='67000000-0000-4000-8000-000000000002'), '0',
  'subject erasure removes recovery records through the source-session lifecycle');
SELECT is((SELECT count(*)::text FROM public.training_progression_acceptances
  WHERE assignment_id='recovery-assignment-1'), '0',
  'subject erasure removes bound progression acceptances first');
SELECT is((SELECT count(*)::text FROM public.training_progression_proposals
  WHERE assignment_id='recovery-assignment-1'), '0',
  'subject erasure removes bound progression proposals before recovery records');
SELECT is((SELECT count(*)::text FROM public.training_subjects
  WHERE id='67000000-0000-4000-8000-000000000002'), '0',
  'the exact test subject is erased without orphan recovery state');

SELECT * FROM finish();
ROLLBACK;
