BEGIN;
SELECT no_plan();

SELECT has_table('public', 'training_progression_proposals', 'progression proposals have immutable storage');
SELECT has_table('public', 'training_progression_acceptances', 'explicit progression acceptances have durable storage');
SELECT ok(NOT has_table_privilege('authenticated', 'public.training_progression_proposals', 'INSERT'),
  'browser cannot persist a forged progression proposal');
SELECT ok(NOT has_table_privilege('service_role', 'public.training_progression_acceptances', 'INSERT'),
  'service role cannot impersonate an authenticated acceptance');
SELECT ok(NOT has_function_privilege('service_role',
  'public.accept_training_progression_proposal(uuid,uuid)', 'EXECUTE'),
  'service role cannot call the authenticated acceptance RPC');

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id,email,created_at,updated_at) VALUES
  ('49000000-0000-4000-8000-000000000001','progression-coach@example.invalid',now(),now()),
  ('49000000-0000-4000-8000-000000000009','simulation+49000000000040008000000000000009@fixtures.invalid',now(),now());
INSERT INTO public.practitioners(id,display_name,access_status,role,session_valid_after) VALUES
  ('49000000-0000-4000-8000-000000000001','Progression coach','active','practitioner','-infinity');
INSERT INTO public.clients(id,practitioner_id,first_name,last_name) VALUES
  ('49000000-0000-4000-8000-000000000010','49000000-0000-4000-8000-000000000001','Practice','Athlete');
INSERT INTO public.training_subjects(
  id,owner_user_id,status,activated_at,current_profile_revision
) VALUES (
  '49000000-0000-4000-8000-000000000002',
  '49000000-0000-4000-8000-000000000009','active',now(),1
);
WITH profile(value) AS (VALUES (
  '{"schemaVersion":"athlete-training-profile.v1","origin":{"kind":"synthetic_fixture","fixtureId":"practice-strength-profile.v1","label":"Synthetic practice profile"},"goal":"strength","experience":"beginner","recentConsistency":"consistent","cycleLengthWeeks":8,"strengthDays":["monday","thursday"],"localTimezone":"UTC","sessionTimeBudgetMinutes":30,"preferredLoadUnit":"kg","equipmentInventory":[{"kind":"machine","equipmentId":"machine-1","unit":"kg","stackLoads":["50","52"]}],"startingHistory":[]}'::jsonb
))
INSERT INTO public.training_profile_revisions(
  subject_id,revision,schema_version,profile_json,profile_hash,hash_encoding,
  created_by_user_id,created_at
) SELECT
  '49000000-0000-4000-8000-000000000002',1,'athlete-training-profile.v1',
  profile.value,private.training_evidence_sha256(profile.value),'postgres-jsonb-text-utf8.v1',
  '49000000-0000-4000-8000-000000000009',now()
FROM profile;
INSERT INTO public.training_simulation_runs(
  id,subject_id,created_by_user_id,fixture_id,fixture_hash,expires_at
) VALUES (
  '49000000-0000-4000-8000-000000000003',
  '49000000-0000-4000-8000-000000000002',
  '49000000-0000-4000-8000-000000000001','synthetic-starter-catalog.v1',
  'ea848ced42813786b527296c351dc51ba2a8072a6c85ac5d2f744547de730717',now()+interval '1 hour'
);
INSERT INTO private.athlete_invitations(
  id,email_normalized,display_name,mode,target_client_id,issuer_practitioner_id,
  permissions,state,expires_at,provisioned_user_id,subject_id,provisioned_at,accepted_at,issued_by
) VALUES (
  '49000000-0000-4000-8000-000000000011',
  'simulation+49000000000040008000000000000009@fixtures.invalid','Practice data','coach_invited',
  '49000000-0000-4000-8000-000000000010','49000000-0000-4000-8000-000000000001',
  ARRAY['subject:read','program:coach_publish','session:read','set_log:write']::public.training_coach_permission[],
  'accepted',now()+interval '1 hour','49000000-0000-4000-8000-000000000009',
  '49000000-0000-4000-8000-000000000002',now(),now(),'49000000-0000-4000-8000-000000000001'
);
INSERT INTO private.training_simulation_identities(
  id,invitation_id,client_id,practitioner_id,provisioned_user_id,subject_id,
  simulation_run_id,fixture_id,fixture_hash,label,permission,internal_email,
  state,expires_at,activated_at
) VALUES (
  '49000000-0000-4000-8000-000000000012','49000000-0000-4000-8000-000000000011',
  '49000000-0000-4000-8000-000000000010','49000000-0000-4000-8000-000000000001',
  '49000000-0000-4000-8000-000000000009','49000000-0000-4000-8000-000000000002',
  '49000000-0000-4000-8000-000000000003','synthetic-starter-catalog.v1',
  'ea848ced42813786b527296c351dc51ba2a8072a6c85ac5d2f744547de730717',
  'Practice data','simulation:control','simulation+49000000000040008000000000000009@fixtures.invalid',
  'active',now()+interval '1 hour',now()
);
INSERT INTO public.coaching_relationships(subject_id,practitioner_id,permissions,status) VALUES (
  '49000000-0000-4000-8000-000000000002','49000000-0000-4000-8000-000000000001',
  ARRAY['subject:read','program:coach_publish','session:read','set_log:write']::public.training_coach_permission[],
  'active'
);
CREATE FUNCTION pg_temp.progression_exercise(p_number integer)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT pg_catalog.jsonb_build_object(
    'exerciseInstanceId','progression-exercise-' || p_number,
    'exerciseVersionId','press.v1',
    'setIds',pg_catalog.jsonb_build_array(
      'progression-set-' || p_number || '-1', 'progression-set-' || p_number || '-2'
    ),
    'repRange',pg_catalog.jsonb_build_object('minimum',6,'maximum',8),
    'targetRir',pg_catalog.jsonb_build_object('minimum',2,'maximum',3),
    'restSeconds',120,
    'progression',pg_catalog.jsonb_build_object(
      'progressionSeriesId','strength-slot:push','side','bilateral','rom','catalog_default',
      'tempo','controlled','exposureType','standard','loadEpoch',1
    ),
    'acceptedInitialLoad',pg_catalog.jsonb_build_object(
      'status','accepted','acceptanceId','initial-' || p_number,
      'acceptedAt','2026-09-08T00:00:00.000Z',
      'acceptedByUserId','49000000-0000-4000-8000-000000000001',
      'source','equipment_inventory',
      'executionContext',pg_catalog.jsonb_build_object(
        'kind','synthetic_simulation',
        'simulationRunId','49000000-0000-4000-8000-000000000003',
        'fixtureId','synthetic-starter-catalog.v1',
        'fixtureHash','ea848ced42813786b527296c351dc51ba2a8072a6c85ac5d2f744547de730717',
        'label','Practice data'
      ),
      'exerciseInstanceId','progression-exercise-' || p_number,
      'exerciseVersionId','press.v1','equipmentId','machine-1',
      'provenance',pg_catalog.jsonb_build_object(
        'profileRevisionId','1','compiledProgramRevisionId','compiled-1','catalogVersion','synthetic-starter-catalog.v1',
        'catalogOrigin',pg_catalog.jsonb_build_object(
          'kind','synthetic_fixture','source','server_fixture','fixtureId','synthetic-starter-catalog.v1',
          'fixtureHash','ea848ced42813786b527296c351dc51ba2a8072a6c85ac5d2f744547de730717',
          'label','Synthetic starter catalog'
        )
      ),
      'loadBasis','machine_stack','implementCount',1,'holdingConfiguration','machine_defined',
      'quantity',pg_catalog.jsonb_build_object(
        'entered',pg_catalog.jsonb_build_object('value','50','unit','kg'),'canonicalKg','50'
      )
    )
  );
$$;

CREATE FUNCTION pg_temp.progression_program(p_revision bigint)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT pg_catalog.jsonb_build_object(
    'schemaVersion','training-program-revision.v1',
    'assignmentId','progression-assignment-1','revisionNumber',p_revision,
    'subjectId','49000000-0000-4000-8000-000000000002',
    'programMode','coach_assigned','owningPractitionerId','49000000-0000-4000-8000-000000000001',
    'executionContext',pg_catalog.jsonb_build_object(
      'kind','synthetic_simulation','simulationRunId','49000000-0000-4000-8000-000000000003',
      'fixtureId','synthetic-starter-catalog.v1',
      'fixtureHash','ea848ced42813786b527296c351dc51ba2a8072a6c85ac5d2f744547de730717',
      'label','Practice data'
    ),
    'cycleStartLocalDate','2026-09-01','cycleLengthWeeks',8,
    'profileRevisionId','1','eligibilitySourceRevisionId','simulation:49000000-0000-4000-8000-000000000003',
    'compilerPolicyVersion','eight-week-compiler.v1','catalogVersion','synthetic-starter-catalog.v1',
    'catalogOrigin',pg_catalog.jsonb_build_object(
      'kind','synthetic_fixture','source','server_fixture','fixtureId','synthetic-starter-catalog.v1',
      'fixtureHash','ea848ced42813786b527296c351dc51ba2a8072a6c85ac5d2f744547de730717',
      'label','Synthetic starter catalog'
    ),
    'ruleVersion','strength-progression-v1','compiledProgramRevisionId','compiled-1',
    'publishedAt','2026-09-08T00:00:00.000Z',
    'author',pg_catalog.jsonb_build_object(
      'kind','coach','userId','49000000-0000-4000-8000-000000000001'
    ),
    'sessions',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('sessionId','progression-session-1','scheduledLocalDate','2026-09-01','athleteTimezone','UTC','exercises',pg_catalog.jsonb_build_array(pg_temp.progression_exercise(1))),
      pg_catalog.jsonb_build_object('sessionId','progression-session-2','scheduledLocalDate','2026-09-10','athleteTimezone','UTC','exercises',pg_catalog.jsonb_build_array(pg_temp.progression_exercise(2))),
      pg_catalog.jsonb_build_object('sessionId','progression-session-3','scheduledLocalDate','2026-09-13','athleteTimezone','UTC','exercises',pg_catalog.jsonb_build_array(pg_temp.progression_exercise(3)))
    ),
    'conditioningBouts',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('boutId','placeholder-conditioning')
    )
  );
$$;

INSERT INTO public.training_program_drafts(
  id,subject_id,created_by_user_id,profile_revision,simulation_run_id,
  source_build_id,selection_hash,program_json,expires_at
) VALUES (
  '49000000-0000-4000-8000-000000000004','49000000-0000-4000-8000-000000000002',
  '49000000-0000-4000-8000-000000000001',1,'49000000-0000-4000-8000-000000000003',
  NULL,NULL,pg_temp.progression_program(1),now()+interval '1 hour'
);
INSERT INTO public.training_program_assignments(
  id,subject_id,program_mode,owning_practitioner_id,simulation_run_id,source_draft_id,status,active_revision,revision
) VALUES (
  'progression-assignment-1','49000000-0000-4000-8000-000000000002','coach_assigned',
  '49000000-0000-4000-8000-000000000001',
  '49000000-0000-4000-8000-000000000003','49000000-0000-4000-8000-000000000004',
  'active',1,1
);
INSERT INTO public.training_program_revisions(
  assignment_id,subject_id,revision_number,program_json,created_by_user_id
) VALUES (
  'progression-assignment-1','49000000-0000-4000-8000-000000000002',1,
  pg_temp.progression_program(1),'49000000-0000-4000-8000-000000000001'
);
INSERT INTO public.training_sessions(
  id,assignment_id,subject_id,session_kind,state,scheduled_local_date,athlete_timezone,revision,completed_at
) VALUES
  ('progression-session-1','progression-assignment-1','49000000-0000-4000-8000-000000000002','strength','completed','2026-09-01','UTC',4,'2026-09-01T18:00:00Z'),
  ('progression-session-2','progression-assignment-1','49000000-0000-4000-8000-000000000002','strength','scheduled','2026-09-10','UTC',1,NULL),
  ('progression-session-3','progression-assignment-1','49000000-0000-4000-8000-000000000002','strength','scheduled','2026-09-13','UTC',1,NULL);
SET LOCAL session_replication_role = origin;

SET LOCAL ROLE service_role;
INSERT INTO public.training_progression_proposals(
  id,proposal_key,created_by_user_id,subject_id,assignment_id,
  base_program_revision_number,base_assignment_revision,
  target_session_id,target_exercise_instance_id,target_session_revision,
  progression_series_id,source_profile_revision,source_eligibility_revision_id,
  source_program_hash,execution_context,source_session_revisions,
  mutable_target_revisions,decision_json
) SELECT
  '49000000-0000-4000-8000-000000000005',repeat('c',64),
  '49000000-0000-4000-8000-000000000001','49000000-0000-4000-8000-000000000002',
  'progression-assignment-1',1,1,'progression-session-2','progression-exercise-2',1,
  'strength-slot:push',1,'simulation:49000000-0000-4000-8000-000000000003',
  program_hash,
  '{"kind":"synthetic_simulation","simulationRunId":"49000000-0000-4000-8000-000000000003","fixtureId":"synthetic-starter-catalog.v1","fixtureHash":"ea848ced42813786b527296c351dc51ba2a8072a6c85ac5d2f744547de730717","label":"Practice data"}'::jsonb,
  '[{"sessionId":"progression-session-1","revision":4}]'::jsonb,
  '[{"sessionId":"progression-session-2","sessionRevision":1,"exerciseInstanceId":"progression-exercise-2","scheduledLocalDate":"2026-09-10"},{"sessionId":"progression-session-3","sessionRevision":1,"exerciseInstanceId":"progression-exercise-3","scheduledLocalDate":"2026-09-13"}]'::jsonb,
  '{
    "kind":"load_proposal","status":"proposed","decisionKey":"decision-1",
    "subjectId":"49000000-0000-4000-8000-000000000002",
    "sourceProfileRevisionId":"1",
    "sourceEligibilityRevisionId":"simulation:49000000-0000-4000-8000-000000000003",
    "executionContext":{"kind":"synthetic_simulation","simulationRunId":"49000000-0000-4000-8000-000000000003","fixtureId":"synthetic-starter-catalog.v1","fixtureHash":"ea848ced42813786b527296c351dc51ba2a8072a6c85ac5d2f744547de730717","label":"Practice data"},
    "proposal":{"load":{"equipmentId":"machine-1","basis":"machine_stack","quantity":{"entered":{"value":"52","unit":"kg"},"canonicalKg":"52"}},"targetReps":[6,6]}
  }'::jsonb
FROM public.training_program_revisions
WHERE assignment_id='progression-assignment-1' AND revision_number=1;
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','49000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"49000000-0000-4000-8000-000000000001","aal":"aal2","iat":2000000000}',true);
SET LOCAL ROLE authenticated;
SELECT is(
  public.accept_training_progression_proposal(
    '49000000-0000-4000-8000-000000000005','49000000-0000-4000-8000-000000000006'
  )#>>'{programRevisionNumber}',
  '2', 'explicit acceptance appends one program revision'
);
SELECT is(
  public.accept_training_progression_proposal(
    '49000000-0000-4000-8000-000000000005','49000000-0000-4000-8000-000000000006'
  )#>>'{programRevisionNumber}',
  '2', 'exact acceptance retry is idempotent'
);
SELECT results_eq(
  $$SELECT exercise->'progression'->>'loadEpoch', exercise#>>'{acceptedInitialLoad,quantity,canonicalKg}'
    FROM public.training_program_revisions revision
    CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(revision.program_json->'sessions') session
    CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(session->'exercises') exercise
    WHERE revision.assignment_id='progression-assignment-1' AND revision.revision_number=2
      AND session->>'sessionId' IN ('progression-session-2','progression-session-3')
    ORDER BY session->>'sessionId'$$,
  $$VALUES ('2'::text,'52'::text),('2'::text,'52'::text)$$,
  'acceptance propagates the new epoch and load through every later unstarted target'
);
SELECT is(
  public.start_training_session('progression-session-3',1)
    #>>'{exercises,0,acceptedInitialLoad,quantity,canonicalKg}',
  '52', 'a later session starts from the accepted series state instead of reverting to epoch one'
);
RESET ROLE;

SET LOCAL ROLE service_role;
INSERT INTO public.training_progression_proposals(
  id,proposal_key,created_by_user_id,subject_id,assignment_id,
  base_program_revision_number,base_assignment_revision,
  target_session_id,target_exercise_instance_id,target_session_revision,
  progression_series_id,source_profile_revision,source_eligibility_revision_id,
  source_program_hash,execution_context,source_session_revisions,
  mutable_target_revisions,decision_json
) SELECT
  '49000000-0000-4000-8000-000000000007',repeat('d',64),
  '49000000-0000-4000-8000-000000000001','49000000-0000-4000-8000-000000000002',
  'progression-assignment-1',1,1,'progression-session-2','progression-exercise-2',1,
  'strength-slot:push',1,'simulation:49000000-0000-4000-8000-000000000003',
  (SELECT program_hash FROM public.training_program_revisions WHERE assignment_id='progression-assignment-1' AND revision_number=1),
  execution_context,source_session_revisions,mutable_target_revisions,decision_json
FROM public.training_progression_proposals
WHERE id='49000000-0000-4000-8000-000000000005';
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT throws_ok($$
  SELECT public.accept_training_progression_proposal(
    '49000000-0000-4000-8000-000000000007','49000000-0000-4000-8000-000000000008'
  )
$$, 'PT409', 'progression source changed',
  'an older proposal cannot compound after a series revision was accepted');
RESET ROLE;

-- A current acute-stop decision must invalidate both starting the next session
-- and accepting a previously prepared advancement. There is no acknowledgement
-- argument at either authenticated database boundary.
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id,email,created_at,updated_at) VALUES (
  '49000000-0000-4000-8000-000000000020',
  'acute-stop-owner@example.invalid',now(),now()
);
INSERT INTO public.training_subjects(
  id,owner_user_id,status,activated_at,current_profile_revision
) VALUES (
  '49000000-0000-4000-8000-000000000021',
  '49000000-0000-4000-8000-000000000020','active',now(),1
);
INSERT INTO public.coaching_relationships(
  id,subject_id,practitioner_id,status,permissions,started_at,revision
) VALUES (
  '49000000-0000-4000-8000-000000000025',
  '49000000-0000-4000-8000-000000000021',
  '49000000-0000-4000-8000-000000000001','active',
  ARRAY['subject:read','program:coach_publish']::public.training_coach_permission[],
  now(),1
);
WITH profile(value) AS (VALUES (
  '{"schemaVersion":"athlete-training-profile.v1","origin":{"kind":"athlete_input"},"goal":"strength","experience":"beginner","recentConsistency":"consistent","cycleLengthWeeks":8,"strengthDays":["monday","thursday"],"localTimezone":"UTC","sessionTimeBudgetMinutes":30,"preferredLoadUnit":"kg","equipmentInventory":[{"kind":"machine","equipmentId":"machine-1","unit":"kg","stackLoads":["50","52"]}],"startingHistory":[]}'::jsonb
))
INSERT INTO public.training_profile_revisions(
  subject_id,revision,schema_version,profile_json,profile_hash,hash_encoding,
  created_by_user_id,created_at
)
SELECT
  '49000000-0000-4000-8000-000000000021',1,'athlete-training-profile.v1',
  profile.value,private.training_evidence_sha256(profile.value),
  'postgres-jsonb-text-utf8.v1','49000000-0000-4000-8000-000000000020',now()
FROM profile;
SET LOCAL session_replication_role = origin;

SELECT set_config('request.jwt.claim.sub','49000000-0000-4000-8000-000000000020',true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"49000000-0000-4000-8000-000000000020","aal":"aal2","iat":2000000000}',
  true
);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$
  SELECT * FROM public.append_training_eligibility_response(
    '49000000-0000-4000-8000-000000000021',0,'answers:acute-stop:1',
    '{
      "schemaVersion":"eligibility-answers.v1",
      "questionnaireSourceVersion":"preparticipation-inputs.v1-unvalidated",
      "submittedAt":"2026-09-08T12:00:00Z",
      "origin":{"kind":"athlete_self_report"},
      "adultScope":"confirmed_18_plus",
      "currentActivity":"regularly_active",
      "knownConditions":{"cardiovascular":"no","metabolic":"no","renal":"no"},
      "relevantSignsOrSymptoms":"no",
      "desiredIntensity":"moderate",
      "answerCertainty":"complete",
      "pregnancyPostpartumContext":"none_reported",
      "requestedProgrammingScope":"strength_or_general_fitness"
    }'::jsonb
  )
$$, 'the acute-stop fixture begins with exact owner-authored eligibility answers');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SET LOCAL ROLE service_role;
SELECT lives_ok($$
  SELECT * FROM public.record_training_eligibility_decision(
    '49000000-0000-4000-8000-000000000021',NULL,
    '{
      "schemaVersion":"eligibility-decision.v1",
      "sourceRevisionId":"decision:acute-stop:eligible",
      "answersRevisionId":"answers:acute-stop:1",
      "answersSchemaVersion":"eligibility-answers.v1",
      "questionnaireSourceVersion":"preparticipation-inputs.v1-unvalidated",
      "policyVersion":"authority-test-policy.v1",
      "state":"eligible_general",
      "scope":"supported",
      "source":{"kind":"policy_service","sourceVersion":"eligibility-policy-service.v1","evaluatedAt":"2026-09-08T12:01:00Z"},
      "effectiveFrom":"2020-01-01T00:00:00Z",
      "effectiveUntil":"2099-01-01T00:00:00Z",
      "supersededAt":null,
      "constraintSet":null
    }'::jsonb
  )
$$, 'the fixture records an existing supported decision before acute stop');

RESET ROLE;
SET LOCAL session_replication_role = replica;
WITH program(value) AS (
  SELECT pg_temp.progression_program(1) || pg_catalog.jsonb_build_object(
    'assignmentId','acute-stop-assignment-1',
    'subjectId','49000000-0000-4000-8000-000000000021',
    'programMode','self_directed',
    'owningPractitionerId',NULL,
    'executionContext',pg_catalog.jsonb_build_object('kind','live'),
    'profileRevisionId','1',
    'eligibilitySourceRevisionId','decision:acute-stop:eligible',
    'catalogVersion','authored.v1',
    'catalogOrigin',pg_catalog.jsonb_build_object('kind','authored_catalog'),
    'author',pg_catalog.jsonb_build_object(
      'kind','athlete','userId','49000000-0000-4000-8000-000000000020'
    ),
    'sessions',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'sessionId','acute-stop-source-session','scheduledLocalDate','2026-09-01',
        'athleteTimezone','UTC','exercises',
        pg_catalog.jsonb_build_array(pg_temp.progression_exercise(1))
      ),
      pg_catalog.jsonb_build_object(
        'sessionId','acute-stop-target-session','scheduledLocalDate','2026-09-10',
        'athleteTimezone','UTC','exercises',
        pg_catalog.jsonb_build_array(pg_temp.progression_exercise(2))
      )
    )
  )
)
INSERT INTO public.training_program_drafts(
  id,subject_id,created_by_user_id,profile_revision,
  eligibility_source_revision_id,expires_at,program_json
)
SELECT
  '49000000-0000-4000-8000-000000000022',
  '49000000-0000-4000-8000-000000000021',
  '49000000-0000-4000-8000-000000000020',1,
  'decision:acute-stop:eligible',now()+interval '1 hour',program.value
FROM program;
INSERT INTO public.training_program_assignments(
  id,subject_id,program_mode,owning_practitioner_id,source_draft_id,
  status,active_revision,revision
) VALUES (
  'acute-stop-assignment-1','49000000-0000-4000-8000-000000000021',
  'self_directed',NULL,'49000000-0000-4000-8000-000000000022','active',1,1
);
INSERT INTO public.training_program_revisions(
  assignment_id,subject_id,revision_number,program_json,created_by_user_id
)
SELECT
  'acute-stop-assignment-1','49000000-0000-4000-8000-000000000021',1,
  program_json,'49000000-0000-4000-8000-000000000020'
FROM public.training_program_drafts
WHERE id='49000000-0000-4000-8000-000000000022';
INSERT INTO public.training_sessions(
  id,assignment_id,subject_id,session_kind,state,scheduled_local_date,
  athlete_timezone,revision,completed_at
) VALUES
  ('acute-stop-source-session','acute-stop-assignment-1',
   '49000000-0000-4000-8000-000000000021','strength','completed',
   '2026-09-01','UTC',4,'2026-09-01T18:00:00Z'),
  ('acute-stop-target-session','acute-stop-assignment-1',
   '49000000-0000-4000-8000-000000000021','strength','scheduled',
   '2026-09-10','UTC',1,NULL);
INSERT INTO public.training_progression_proposals(
  id,proposal_key,created_by_user_id,subject_id,assignment_id,
  base_program_revision_number,base_assignment_revision,
  target_session_id,target_exercise_instance_id,target_session_revision,
  progression_series_id,source_profile_revision,source_eligibility_revision_id,
  source_program_hash,execution_context,source_session_revisions,
  mutable_target_revisions,decision_json
)
SELECT
  '49000000-0000-4000-8000-000000000023',repeat('e',64),
  '49000000-0000-4000-8000-000000000020',
  '49000000-0000-4000-8000-000000000021','acute-stop-assignment-1',
  1,1,'acute-stop-target-session','progression-exercise-2',1,
  'strength-slot:push',1,'decision:acute-stop:eligible',program_hash,
  '{"kind":"live"}'::jsonb,
  '[{"sessionId":"acute-stop-source-session","revision":4}]'::jsonb,
  '[{"sessionId":"acute-stop-target-session","sessionRevision":1,"exerciseInstanceId":"progression-exercise-2","scheduledLocalDate":"2026-09-10"}]'::jsonb,
  '{
    "kind":"load_proposal","status":"proposed","decisionKey":"acute-stop-decision-1",
    "subjectId":"49000000-0000-4000-8000-000000000021",
    "sourceProfileRevisionId":"1",
    "sourceEligibilityRevisionId":"decision:acute-stop:eligible",
    "executionContext":{"kind":"live"},
    "proposal":{"load":{"equipmentId":"machine-1","basis":"machine_stack","quantity":{"entered":{"value":"52","unit":"kg"},"canonicalKg":"52"}},"targetReps":[6,6]}
  }'::jsonb
FROM public.training_program_revisions
WHERE assignment_id='acute-stop-assignment-1' AND revision_number=1;
SET LOCAL session_replication_role = origin;

SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SET LOCAL ROLE service_role;
SELECT lives_ok($$
  SELECT * FROM public.record_training_eligibility_decision(
    '49000000-0000-4000-8000-000000000021','decision:acute-stop:eligible',
    '{
      "schemaVersion":"eligibility-decision.v1",
      "sourceRevisionId":"decision:acute-stop:current",
      "answersRevisionId":"answers:acute-stop:1",
      "answersSchemaVersion":"eligibility-answers.v1",
      "questionnaireSourceVersion":"preparticipation-inputs.v1-unvalidated",
      "policyVersion":"authority-test-policy.v1",
      "state":"acute_stop",
      "scope":"supported",
      "source":{"kind":"policy_service","sourceVersion":"eligibility-policy-service.v1","evaluatedAt":"2026-09-08T12:02:00Z"},
      "effectiveFrom":"2020-01-02T00:00:00Z",
      "effectiveUntil":"2099-01-01T00:00:00Z",
      "supersededAt":null,
      "constraintSet":null
    }'::jsonb
  )
$$, 'authoritative acute stop supersedes the formerly supported decision');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','49000000-0000-4000-8000-000000000001',true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"49000000-0000-4000-8000-000000000001","aal":"aal2","iat":2000000000}',
  true
);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$
  SELECT * FROM public.record_training_eligibility_decision(
    '49000000-0000-4000-8000-000000000021','decision:acute-stop:current',
    '{
      "schemaVersion":"eligibility-decision.v1",
      "sourceRevisionId":"decision:coach-clear-attempt",
      "answersRevisionId":"answers:acute-stop:1",
      "answersSchemaVersion":"eligibility-answers.v1",
      "questionnaireSourceVersion":"preparticipation-inputs.v1-unvalidated",
      "policyVersion":"authority-test-policy.v1",
      "state":"eligible_general",
      "scope":"supported",
      "source":{"kind":"policy_service","sourceVersion":"eligibility-policy-service.v1","evaluatedAt":"2026-09-08T12:03:00Z"},
      "effectiveFrom":"2020-01-03T00:00:00Z",
      "effectiveUntil":"2099-01-01T00:00:00Z",
      "supersededAt":null,
      "constraintSet":null
    }'::jsonb
  )
$$, '42501','permission denied for function record_training_eligibility_decision',
  'a program-publishing coach cannot clear the current acute stop');
SELECT is(
  (SELECT current_eligibility_decision_source_revision_id
   FROM public.training_subjects
   WHERE id='49000000-0000-4000-8000-000000000021'),
  'decision:acute-stop:current',
  'the denied coach clearance attempt leaves the acute-stop pointer current'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','49000000-0000-4000-8000-000000000020',true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"49000000-0000-4000-8000-000000000020","aal":"aal2","iat":2000000000}',
  true
);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$
  SELECT public.start_training_session('acute-stop-target-session',1)
$$, 'PT409','training eligibility changed concurrently',
  'acute stop blocks starting a target prepared under the earlier supported decision');
SELECT results_eq(
  $$ SELECT state,revision FROM public.training_sessions
     WHERE id='acute-stop-target-session' $$,
  $$ VALUES ('scheduled'::text,1::bigint) $$,
  'rejected acute-stop start leaves the session unchanged'
);
SELECT is_empty(
  $$ SELECT session_id FROM public.training_session_prescriptions
     WHERE session_id='acute-stop-target-session' $$,
  'rejected acute-stop start writes no prescription'
);
SELECT throws_ok($$
  SELECT public.accept_training_progression_proposal(
    '49000000-0000-4000-8000-000000000023',
    '49000000-0000-4000-8000-000000000024'
  )
$$, 'PT409','progression eligibility changed',
  'acute stop blocks accepting an advancement prepared under the earlier supported decision');
SELECT results_eq(
  $$ SELECT active_revision,revision FROM public.training_program_assignments
     WHERE id='acute-stop-assignment-1' $$,
  $$ VALUES (1::bigint,1::bigint) $$,
  'rejected acute-stop advancement leaves the active program revision unchanged'
);
SELECT is_empty(
  $$ SELECT proposal_id FROM public.training_progression_acceptances
     WHERE proposal_id='49000000-0000-4000-8000-000000000023' $$,
  'rejected acute-stop advancement writes no acceptance receipt'
);
SELECT ok(
  pg_catalog.to_regprocedure(
    'public.start_training_session(text,bigint,boolean)'
  ) IS NULL
  AND pg_catalog.to_regprocedure(
    'public.accept_training_progression_proposal(uuid,uuid,boolean)'
  ) IS NULL,
  'start and progression acceptance expose no acknowledgement-bypass overload'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
