BEGIN;
SELECT no_plan();

SELECT has_table('public', 'training_exercise_swap_proposals', 'swap proposals have immutable storage');
SELECT has_table('public', 'training_exercise_swap_acceptances', 'swap acceptances have immutable storage');
SELECT ok(NOT has_table_privilege('authenticated', 'public.training_exercise_swap_proposals', 'INSERT'),
  'browser cannot forge a swap proposal');
SELECT ok(NOT has_table_privilege('service_role', 'public.training_exercise_swap_acceptances', 'INSERT'),
  'service role cannot impersonate acceptance');
SELECT ok(NOT has_function_privilege('service_role',
  'public.accept_training_exercise_swap_proposal(uuid,uuid,integer)', 'EXECUTE'),
  'service role cannot accept a swap');
SELECT ok(private.is_valid_training_exercise_swap_load_options('[{
  "optionIndex":0,"equipmentId":"bar-1","loadBasis":"barbell_total",
  "implementCount":1,"holdingConfiguration":"both_hands_barbell",
  "quantity":{"entered":{"value":"20","unit":"kg"},"canonicalKg":"20"}
}]'::jsonb), 'legacy conventional load choices remain valid');
SELECT ok(private.is_valid_training_exercise_swap_load_options('[{
  "optionIndex":0,"equipmentId":"bodyweight-external","loadBasis":"bodyweight_external",
  "implementCount":0,"holdingConfiguration":"bodyweight_plus_external_load",
  "bodyweightAssistancePolicy":{"policyId":"synthetic-rep-only.v1","policyVersion":"1"},
  "quantity":{"entered":{"value":"0","unit":"kg"},"canonicalKg":"0"}
}]'::jsonb), 'zero external-load choices preserve an exact dedicated policy');
SELECT ok(private.is_valid_training_exercise_swap_load_options('[{
  "optionIndex":0,"equipmentId":"assist-1","loadBasis":"machine_assistance",
  "implementCount":1,"holdingConfiguration":"machine_assistance",
  "bodyweightAssistancePolicy":{"policyId":"synthetic-rep-only.v1","policyVersion":"1"},
  "quantity":{"entered":{"value":"40","unit":"kg"},"canonicalKg":"40"}
}]'::jsonb), 'machine-assistance choices preserve an exact dedicated policy');
SELECT ok(NOT private.is_valid_training_exercise_swap_load_options('[{
  "optionIndex":0,"equipmentId":"assist-1","loadBasis":"machine_assistance",
  "implementCount":1,"holdingConfiguration":"machine_assistance",
  "quantity":{"entered":{"value":"40","unit":"kg"},"canonicalKg":"40"}
}]'::jsonb), 'dedicated load choices without a policy are rejected');
SELECT ok(NOT private.is_valid_training_exercise_swap_load_options('[{
  "optionIndex":0,"equipmentId":"bar-1","loadBasis":"barbell_total",
  "implementCount":1,"holdingConfiguration":"both_hands_barbell",
  "bodyweightAssistancePolicy":{"policyId":"synthetic-rep-only.v1","policyVersion":"1"},
  "quantity":{"entered":{"value":"20","unit":"kg"},"canonicalKg":"20"}
}]'::jsonb), 'conventional choices cannot retain a dedicated policy');
SELECT ok(NOT private.is_valid_training_exercise_swap_load_options('[{
  "optionIndex":1,"equipmentId":"bodyweight-external","loadBasis":"bodyweight_external",
  "implementCount":0,"holdingConfiguration":"bodyweight_plus_external_load",
  "bodyweightAssistancePolicy":{"policyId":"synthetic-rep-only.v1","policyVersion":"1"},
  "quantity":{"entered":{"value":"0","unit":"kg"},"canonicalKg":"0"}
}]'::jsonb), 'dedicated choices keep contiguous server-derived indexes');

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id,email,created_at,updated_at) VALUES
  ('61000000-0000-4000-8000-000000000001','swap-coach@example.invalid',now(),now()),
  ('61000000-0000-4000-8000-000000000002','simulation+61000000000040008000000000000002@fixtures.invalid',now(),now()),
  ('61000000-0000-4000-8000-000000000003','swap-other-coach@example.invalid',now(),now());
INSERT INTO public.practitioners(id,display_name,access_status,role,session_valid_after) VALUES
  ('61000000-0000-4000-8000-000000000001','Swap coach','active','practitioner','-infinity'),
  ('61000000-0000-4000-8000-000000000003','Other coach','active','practitioner','-infinity');
INSERT INTO public.clients(id,practitioner_id,first_name,last_name) VALUES
  ('61000000-0000-4000-8000-000000000010','61000000-0000-4000-8000-000000000001','Practice','Swap');
INSERT INTO public.training_subjects(id,owner_user_id,status,activated_at,current_profile_revision)
VALUES ('61000000-0000-4000-8000-000000000004','61000000-0000-4000-8000-000000000002','active',now(),1);
WITH profile(value) AS (VALUES (
  '{"schemaVersion":"athlete-training-profile.v1","origin":{"kind":"synthetic_fixture","fixtureId":"swap-profile.v1","label":"Synthetic swap profile"},"goal":"strength","experience":"beginner","recentConsistency":"consistent","cycleLengthWeeks":8,"strengthDays":["monday","thursday"],"localTimezone":"UTC","sessionTimeBudgetMinutes":30,"preferredLoadUnit":"kg","equipmentInventory":[{"kind":"machine","equipmentId":"machine-1","unit":"kg","stackLoads":["40","50","52"]}],"startingHistory":[]}'::jsonb
))
INSERT INTO public.training_profile_revisions(
  subject_id,revision,schema_version,profile_json,profile_hash,hash_encoding,created_by_user_id,created_at
) SELECT '61000000-0000-4000-8000-000000000004',1,'athlete-training-profile.v1',value,
  private.training_evidence_sha256(value),'postgres-jsonb-text-utf8.v1',
  '61000000-0000-4000-8000-000000000002',now() FROM profile;
INSERT INTO public.training_simulation_runs(id,subject_id,created_by_user_id,fixture_id,fixture_hash,expires_at)
VALUES ('61000000-0000-4000-8000-000000000005','61000000-0000-4000-8000-000000000004',
  '61000000-0000-4000-8000-000000000001','synthetic-starter-catalog.v1',
  'ea848ced42813786b527296c351dc51ba2a8072a6c85ac5d2f744547de730717',now()+interval '1 hour');
INSERT INTO private.athlete_invitations(
  id,email_normalized,display_name,mode,target_client_id,issuer_practitioner_id,permissions,state,
  expires_at,provisioned_user_id,subject_id,provisioned_at,accepted_at,issued_by
) VALUES ('61000000-0000-4000-8000-000000000006','simulation+61000000000040008000000000000002@fixtures.invalid','Practice data',
  'coach_invited','61000000-0000-4000-8000-000000000010','61000000-0000-4000-8000-000000000001',
  ARRAY['subject:read','program:coach_publish','session:read','set_log:write']::public.training_coach_permission[],
  'accepted',now()+interval '1 hour','61000000-0000-4000-8000-000000000002',
  '61000000-0000-4000-8000-000000000004',now(),now(),'61000000-0000-4000-8000-000000000001');
INSERT INTO private.training_simulation_identities(
  id,invitation_id,client_id,practitioner_id,provisioned_user_id,subject_id,simulation_run_id,
  fixture_id,fixture_hash,label,permission,internal_email,state,expires_at,activated_at
) VALUES ('61000000-0000-4000-8000-000000000007','61000000-0000-4000-8000-000000000006',
  '61000000-0000-4000-8000-000000000010','61000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000002','61000000-0000-4000-8000-000000000004',
  '61000000-0000-4000-8000-000000000005','synthetic-starter-catalog.v1',
  'ea848ced42813786b527296c351dc51ba2a8072a6c85ac5d2f744547de730717',
  'Practice data','simulation:control','simulation+61000000000040008000000000000002@fixtures.invalid','active',now()+interval '1 hour',now());
INSERT INTO public.coaching_relationships(subject_id,practitioner_id,permissions,status) VALUES
  ('61000000-0000-4000-8000-000000000004','61000000-0000-4000-8000-000000000001',
    ARRAY['subject:read','program:coach_publish','session:read','set_log:write']::public.training_coach_permission[],'active'),
  ('61000000-0000-4000-8000-000000000004','61000000-0000-4000-8000-000000000003',
    ARRAY['subject:read','program:coach_publish']::public.training_coach_permission[],'active');

CREATE FUNCTION pg_temp.swap_exercise(p_number integer)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT pg_catalog.jsonb_build_object(
    'exerciseInstanceId','swap-exercise-'||p_number,'exerciseVersionId','synthetic-press-a.v1',
    'movementPattern','push','setIds',pg_catalog.jsonb_build_array('swap-set-'||p_number||'-1'),
    'repRange',pg_catalog.jsonb_build_object('minimum',6,'maximum',8),'targetReps',pg_catalog.jsonb_build_array(6),
    'targetRir',pg_catalog.jsonb_build_object('minimum',2,'maximum',3),'restSeconds',120,
    'progression',pg_catalog.jsonb_build_object('progressionSeriesId','strength-slot:push','side','bilateral',
      'rom','catalog_default','tempo','controlled','exposureType','heavy','loadEpoch',0),
    'acceptedInitialLoad',pg_catalog.jsonb_build_object(
      'status','accepted','acceptanceId','initial-'||p_number,'acceptedAt','2026-09-08T00:00:00.000Z',
      'acceptedByUserId','61000000-0000-4000-8000-000000000001','source','equipment_inventory',
      'executionContext',pg_catalog.jsonb_build_object('kind','synthetic_simulation',
        'simulationRunId','61000000-0000-4000-8000-000000000005','fixtureId','synthetic-starter-catalog.v1',
        'fixtureHash','ea848ced42813786b527296c351dc51ba2a8072a6c85ac5d2f744547de730717','label','Practice data'),
      'exerciseInstanceId','swap-exercise-'||p_number,'exerciseVersionId','synthetic-press-a.v1',
      'equipmentId','machine-1','loadBasis','machine_stack','implementCount',1,
      'holdingConfiguration','machine_defined',
      'provenance',pg_catalog.jsonb_build_object('profileRevisionId','1','compiledProgramRevisionId','compiled-1',
        'catalogVersion','synthetic-starter-catalog.v1','catalogOrigin',pg_catalog.jsonb_build_object(
          'kind','synthetic_fixture','source','server_fixture','fixtureId','synthetic-starter-catalog.v1',
          'fixtureHash','ea848ced42813786b527296c351dc51ba2a8072a6c85ac5d2f744547de730717',
          'label','Synthetic starter catalog')),
      'quantity',pg_catalog.jsonb_build_object('entered',pg_catalog.jsonb_build_object('value','50','unit','kg'),'canonicalKg','50')),
    'warmupSets',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'setId','source-warmup-'||p_number,'targetReps',10,
      'prescribedLoad',pg_catalog.jsonb_build_object(
        'entered',pg_catalog.jsonb_build_object('value','25','unit','kg'),'canonicalKg','25')))
  );
$$;
CREATE FUNCTION pg_temp.swap_program(p_revision bigint)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT pg_catalog.jsonb_build_object(
    'schemaVersion','training-program-revision.v1','assignmentId','swap-assignment-1','revisionNumber',p_revision,
    'subjectId','61000000-0000-4000-8000-000000000004','programMode','coach_assigned',
    'owningPractitionerId','61000000-0000-4000-8000-000000000001',
    'executionContext',pg_catalog.jsonb_build_object('kind','synthetic_simulation',
      'simulationRunId','61000000-0000-4000-8000-000000000005','fixtureId','synthetic-starter-catalog.v1',
      'fixtureHash','ea848ced42813786b527296c351dc51ba2a8072a6c85ac5d2f744547de730717','label','Practice data'),
    'cycleStartLocalDate','2026-09-01','cycleLengthWeeks',8,'profileRevisionId','1',
    'eligibilitySourceRevisionId','simulation:61000000-0000-4000-8000-000000000005',
    'compilerPolicyVersion','strength-cycle-compiler.v3','catalogVersion','synthetic-starter-catalog.v1',
    'catalogOrigin',pg_catalog.jsonb_build_object('kind','synthetic_fixture','source','server_fixture',
      'fixtureId','synthetic-starter-catalog.v1','fixtureHash','ea848ced42813786b527296c351dc51ba2a8072a6c85ac5d2f744547de730717',
      'label','Synthetic starter catalog'),'ruleVersion','strength-progression-v1',
    'compiledProgramRevisionId','compiled-1','publishedAt','2026-09-08T00:00:00.000Z',
    'author',pg_catalog.jsonb_build_object('kind','coach','userId','61000000-0000-4000-8000-000000000001'),
    'sessions',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('sessionId','swap-session-1','sessionType','full_body','scheduledLocalDate','2026-09-01','athleteTimezone','UTC','exercises',pg_catalog.jsonb_build_array(pg_temp.swap_exercise(1))),
      pg_catalog.jsonb_build_object('sessionId','swap-session-3','sessionType','full_body','scheduledLocalDate','2026-09-01','athleteTimezone','UTC','exercises',pg_catalog.jsonb_build_array(pg_temp.swap_exercise(3))),
      pg_catalog.jsonb_build_object('sessionId','swap-session-2','sessionType','full_body','scheduledLocalDate','2026-09-10','athleteTimezone','UTC','exercises',pg_catalog.jsonb_build_array(pg_temp.swap_exercise(2)))),
    'conditioningBouts',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('boutId','placeholder'))
  );
$$;

WITH source_exercise AS (
  SELECT pg_temp.swap_exercise(2) value
), applied AS (
  SELECT private.apply_training_exercise_swap(
    pg_temp.swap_program(1),
    '61000000-0000-4000-8000-000000000041',
    '61000000-0000-4000-8000-000000000001',
    '2026-09-09T00:00:00Z',
    'synthetic-bodyweight-press.v1',
    '{"optionIndex":0,"equipmentId":"bodyweight-external","loadBasis":"bodyweight_external","implementCount":0,"holdingConfiguration":"bodyweight_plus_external_load","bodyweightAssistancePolicy":{"policyId":"synthetic-rep-only.v1","policyVersion":"1"},"quantity":{"entered":{"value":"0","unit":"kg"},"canonicalKg":"0"}}'::jsonb,
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'sessionId','swap-session-2','exerciseInstanceId','swap-exercise-2',
      'sourceExercise',source_exercise.value)),
    '{"progressionDefaults":{"side":"bilateral","rom":"catalog_default","tempo":"controlled","exposureType":"standard"},"warmupSets":null}'::jsonb,
    'coach'
  ) value FROM source_exercise
)
SELECT ok(
  value#>'{sessions,2,exercises,0,acceptedInitialLoad,bodyweightAssistancePolicy}'
    = '{"policyId":"synthetic-rep-only.v1","policyVersion":"1"}'::jsonb
  AND value#>>'{sessions,2,exercises,0,acceptedInitialLoad,loadBasis}' = 'bodyweight_external'
  AND value#>>'{sessions,2,exercises,0,acceptedInitialLoad,quantity,canonicalKg}' = '0'
  AND value#>>'{sessions,2,exercises,0,progression,loadEpoch}' = '1',
  'a conventional-to-dedicated swap writes the exact policy, zero load, and new epoch'
) FROM applied;

WITH dedicated_exercise AS (
  SELECT pg_temp.swap_exercise(2) || pg_catalog.jsonb_build_object(
    'acceptedInitialLoad',
    (pg_temp.swap_exercise(2)->'acceptedInitialLoad') || pg_catalog.jsonb_build_object(
      'loadBasis','machine_assistance','equipmentId','assist-1','implementCount',1,
      'holdingConfiguration','machine_assistance',
      'bodyweightAssistancePolicy',pg_catalog.jsonb_build_object(
        'policyId','synthetic-rep-only.v1','policyVersion','1'),
      'quantity',pg_catalog.jsonb_build_object(
        'entered',pg_catalog.jsonb_build_object('value','40','unit','kg'),'canonicalKg','40')
    )
  ) value
), dedicated_program AS (
  SELECT pg_catalog.jsonb_set(
    pg_temp.swap_program(1),'{sessions,2,exercises,0}',value
  ) value FROM dedicated_exercise
), applied AS (
  SELECT private.apply_training_exercise_swap(
    dedicated_program.value,
    '61000000-0000-4000-8000-000000000042',
    '61000000-0000-4000-8000-000000000001',
    '2026-09-09T00:00:00Z',
    'synthetic-machine-press.v1',
    '{"optionIndex":0,"equipmentId":"machine-1","loadBasis":"machine_stack","implementCount":1,"holdingConfiguration":"machine_defined","quantity":{"entered":{"value":"50","unit":"kg"},"canonicalKg":"50"}}'::jsonb,
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'sessionId','swap-session-2','exerciseInstanceId','swap-exercise-2',
      'sourceExercise',dedicated_exercise.value)),
    '{"progressionDefaults":{"side":"bilateral","rom":"catalog_default","tempo":"controlled","exposureType":"standard"},"warmupSets":null}'::jsonb,
    'coach'
  ) value FROM dedicated_program CROSS JOIN dedicated_exercise
)
SELECT ok(
  NOT ((value#>'{sessions,2,exercises,0,acceptedInitialLoad}') ? 'bodyweightAssistancePolicy')
  AND value#>>'{sessions,2,exercises,0,acceptedInitialLoad,loadBasis}' = 'machine_stack'
  AND value#>>'{sessions,2,exercises,0,acceptedInitialLoad,quantity,canonicalKg}' = '50',
  'a dedicated-to-conventional swap removes the stale dedicated policy'
) FROM applied;

INSERT INTO public.training_program_drafts(
  id,subject_id,created_by_user_id,profile_revision,simulation_run_id,source_build_id,selection_hash,program_json,expires_at
) VALUES ('61000000-0000-4000-8000-000000000008','61000000-0000-4000-8000-000000000004',
  '61000000-0000-4000-8000-000000000001',1,'61000000-0000-4000-8000-000000000005',NULL,NULL,
  pg_temp.swap_program(1),now()+interval '1 hour');
INSERT INTO public.training_program_assignments(
  id,subject_id,program_mode,owning_practitioner_id,simulation_run_id,source_draft_id,status,active_revision,revision
) VALUES ('swap-assignment-1','61000000-0000-4000-8000-000000000004','coach_assigned',
  '61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000005',
  '61000000-0000-4000-8000-000000000008','active',1,1);
INSERT INTO public.training_program_revisions(assignment_id,subject_id,revision_number,program_json,created_by_user_id)
VALUES ('swap-assignment-1','61000000-0000-4000-8000-000000000004',1,pg_temp.swap_program(1),
  '61000000-0000-4000-8000-000000000001');
INSERT INTO public.training_sessions(
  id,assignment_id,subject_id,session_kind,state,scheduled_local_date,athlete_timezone,revision,completed_at
) VALUES
  ('swap-session-1','swap-assignment-1','61000000-0000-4000-8000-000000000004','strength','completed','2026-09-01','UTC',3,'2026-09-01T18:00:00Z'),
  ('swap-session-3','swap-assignment-1','61000000-0000-4000-8000-000000000004','strength','scheduled','2026-09-01','UTC',1,NULL),
  ('swap-session-2','swap-assignment-1','61000000-0000-4000-8000-000000000004','strength','scheduled','2026-09-10','UTC',1,NULL);
INSERT INTO public.training_session_prescriptions(
  session_id,subject_id,assignment_id,program_revision_number,prescription_json,started_by_user_id,started_at
) VALUES ('swap-session-1','61000000-0000-4000-8000-000000000004','swap-assignment-1',1,
  pg_temp.swap_program(1) || pg_catalog.jsonb_build_object(
    'sessionId','swap-session-1','exercises',pg_catalog.jsonb_build_array(pg_temp.swap_exercise(1))
  ),'61000000-0000-4000-8000-000000000001','2026-09-01T16:00:00Z');
SET LOCAL session_replication_role = origin;

SELECT set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000001","aal":"aal2","iat":2000000000}',true);
SET LOCAL ROLE authenticated;
SELECT is(
  public.read_training_exercise_swap_candidate('swap-session-1','swap-exercise-1')#>>'{status}',
  'ready', 'owning AAL2 coach can project future unstarted targets'
);
SELECT is(
  public.read_training_exercise_swap_candidate('swap-session-1','swap-exercise-1')#>>'{targets,0,sessionId}',
  'swap-session-3', 'a same-day scheduled sibling is a reachable future-only target'
);
SELECT is(
  public.read_training_exercise_swap_candidate('swap-session-1','swap-exercise-1')#>>'{targets,1,sessionId}',
  'swap-session-2', 'later scheduled targets remain reachable after the same-day sibling'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000003',true);
SELECT set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000003","aal":"aal2","iat":2000000000}',true);
SET LOCAL ROLE authenticated;
SELECT is(public.read_training_exercise_swap_candidate('swap-session-1','swap-exercise-1'), NULL,
  'another permissioned coach cannot borrow the owning coach authority');
RESET ROLE;

SET LOCAL ROLE service_role;
WITH constants AS (
  SELECT
    '[{"optionIndex":0,"equipmentId":"machine-1","loadBasis":"machine_stack","implementCount":1,"holdingConfiguration":"machine_defined","quantity":{"entered":{"value":"52","unit":"kg"},"canonicalKg":"52"}}]'::jsonb loads,
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'sessionId','swap-session-2','sessionRevision',1,'scheduledLocalDate','2026-09-10',
      'exerciseInstanceId','swap-exercise-2','sourceExercise',pg_temp.swap_exercise(2))) targets,
    '{"progressionDefaults":{"side":"bilateral","rom":"catalog_default","tempo":"controlled","exposureType":"standard"},"warmupSets":[{"targetReps":8,"prescribedLoad":{"entered":{"value":"40","unit":"kg"},"canonicalKg":"40"}}]}'::jsonb defaults
), proposal AS (
  SELECT pg_catalog.jsonb_build_object(
    'schemaVersion','training-exercise-swap-proposal.v1','proposalId','61000000-0000-4000-8000-000000000009',
    'assignmentId','swap-assignment-1','baseProgramRevisionNumber',1,
    'sourceExercise',pg_catalog.jsonb_build_object('exerciseVersionId','synthetic-press-a.v1','label','Synthetic press A'),
    'replacementExercise',pg_catalog.jsonb_build_object('exerciseVersionId','synthetic-press-b.v1','label','Synthetic press B',
      'trainingIntentId','synthetic-horizontal-push','differences',pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('kind','equipment_setup','description','Uses another reviewed fixture setup.')),
      'recalibrationRequired',true),
    'loadOptions',loads,'affectedFutureSessions',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('sessionId','swap-session-2','exerciseInstanceId','swap-exercise-2','scheduledLocalDate','2026-09-10')),
    'catalogVersion','synthetic-starter-catalog.v1','catalogOrigin',pg_catalog.jsonb_build_object(
      'kind','synthetic_fixture','source','server_fixture','fixtureId','synthetic-starter-catalog.v1',
      'fixtureHash','ea848ced42813786b527296c351dc51ba2a8072a6c85ac5d2f744547de730717','label','Synthetic starter catalog')) value,
    loads, targets, defaults FROM constants
)
INSERT INTO public.training_exercise_swap_proposals(
  id,proposal_key,created_by_user_id,subject_id,assignment_id,base_program_revision_number,
  base_assignment_revision,source_exercise_version_id,replacement_exercise_version_id,
  catalog_version,catalog_origin,source_program_hash,source_profile_revision,
  source_eligibility_revision_id,execution_context,load_options,target_bindings,
  replacement_defaults,proposal_json,created_at,expires_at
) SELECT '61000000-0000-4000-8000-000000000009',repeat('c',64),
  '61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000004',
  'swap-assignment-1',1,1,'synthetic-press-a.v1','synthetic-press-b.v1','synthetic-starter-catalog.v1',
  value->'catalogOrigin',revision.program_hash,1,'simulation:61000000-0000-4000-8000-000000000005',
  revision.program_json->'executionContext',loads,targets,defaults,value,now(),now()+interval '1 hour'
FROM proposal CROSS JOIN public.training_program_revisions revision
WHERE revision.assignment_id='swap-assignment-1' AND revision.revision_number=1;

INSERT INTO public.training_exercise_swap_proposals(
  id,proposal_key,created_by_user_id,subject_id,assignment_id,base_program_revision_number,
  base_assignment_revision,source_exercise_version_id,replacement_exercise_version_id,
  catalog_version,catalog_origin,source_program_hash,source_profile_revision,
  source_eligibility_revision_id,execution_context,load_options,target_bindings,
  replacement_defaults,proposal_json,created_at,expires_at
)
SELECT '61000000-0000-4000-8000-00000000001b',repeat('1',64),created_by_user_id,subject_id,
  assignment_id,base_program_revision_number,base_assignment_revision,source_exercise_version_id,
  replacement_exercise_version_id,catalog_version,catalog_origin,source_program_hash,
  source_profile_revision,source_eligibility_revision_id,execution_context,load_options,target_bindings,
  pg_catalog.jsonb_set(replacement_defaults,'{warmupSets}','null'::jsonb),
  pg_catalog.jsonb_set(proposal_json,'{proposalId}',
    '"61000000-0000-4000-8000-00000000001b"'::jsonb),created_at,expires_at
FROM public.training_exercise_swap_proposals
WHERE id='61000000-0000-4000-8000-000000000009';
SELECT is((SELECT count(*) FROM public.training_exercise_swap_proposals
  WHERE id='61000000-0000-4000-8000-00000000001b'),1::bigint,
  'proposal storage accepts an explicit JSON null when no replacement warm-up is authored');

INSERT INTO public.training_exercise_swap_proposals(
  id,proposal_key,created_by_user_id,subject_id,assignment_id,base_program_revision_number,
  base_assignment_revision,source_exercise_version_id,replacement_exercise_version_id,
  catalog_version,catalog_origin,source_program_hash,source_profile_revision,
  source_eligibility_revision_id,execution_context,load_options,target_bindings,
  replacement_defaults,proposal_json,created_at,expires_at
)
SELECT '61000000-0000-4000-8000-00000000001c',repeat('2',64),created_by_user_id,subject_id,
  assignment_id,base_program_revision_number,base_assignment_revision,source_exercise_version_id,
  replacement_exercise_version_id,catalog_version,catalog_origin,source_program_hash,
  source_profile_revision,source_eligibility_revision_id,execution_context,load_options,target_bindings,
  replacement_defaults - 'warmupSets',
  pg_catalog.jsonb_set(proposal_json,'{proposalId}',
    '"61000000-0000-4000-8000-00000000001c"'::jsonb),created_at,expires_at
FROM public.training_exercise_swap_proposals
WHERE id='61000000-0000-4000-8000-000000000009';
SELECT is((SELECT count(*) FROM public.training_exercise_swap_proposals
  WHERE id='61000000-0000-4000-8000-00000000001c'),1::bigint,
  'proposal storage accepts an omitted replacement warm-up');

SELECT throws_ok($$
  INSERT INTO public.training_exercise_swap_proposals(
    id,proposal_key,created_by_user_id,subject_id,assignment_id,base_program_revision_number,
    base_assignment_revision,source_exercise_version_id,replacement_exercise_version_id,
    catalog_version,catalog_origin,source_program_hash,source_profile_revision,
    source_eligibility_revision_id,execution_context,load_options,target_bindings,
    replacement_defaults,proposal_json,created_at,expires_at
  )
  SELECT '61000000-0000-4000-8000-00000000001d',repeat('3',64),created_by_user_id,subject_id,
    assignment_id,base_program_revision_number,base_assignment_revision,source_exercise_version_id,
    replacement_exercise_version_id,catalog_version,catalog_origin,source_program_hash,
    source_profile_revision,source_eligibility_revision_id,execution_context,load_options,target_bindings,
    pg_catalog.jsonb_set(replacement_defaults,'{warmupSets}','"invalid"'::jsonb),
    pg_catalog.jsonb_set(proposal_json,'{proposalId}',
      '"61000000-0000-4000-8000-00000000001d"'::jsonb),created_at,expires_at
  FROM public.training_exercise_swap_proposals
  WHERE id='61000000-0000-4000-8000-000000000009'
$$, '23514', NULL,
  'proposal storage rejects a non-array replacement warm-up');

RESET ROLE;
WITH applied AS (
  SELECT private.apply_training_exercise_swap(
    pg_temp.swap_program(1),
    '61000000-0000-4000-8000-00000000001b',
    '61000000-0000-4000-8000-000000000001',
    '2026-09-09T00:00:00Z',
    'synthetic-press-b.v1',
    load_options->0,
    target_bindings,
    pg_catalog.jsonb_set(replacement_defaults,'{warmupSets}','null'::jsonb),
    'coach'
  ) value
  FROM public.training_exercise_swap_proposals
  WHERE id='61000000-0000-4000-8000-000000000009'
)
SELECT ok(
  value#>'{sessions,2,exercises,0,warmupSets}' IS NULL
  AND value#>'{sessions,0,exercises,0,warmupSets}' = pg_temp.swap_exercise(1)->'warmupSets'
  AND value#>'{sessions,1,exercises,0,warmupSets}' = pg_temp.swap_exercise(3)->'warmupSets',
  'explicit null removes source warm-ups only from the replaced future exercise'
) FROM applied;

WITH applied AS (
  SELECT private.apply_training_exercise_swap(
    pg_temp.swap_program(1),
    '61000000-0000-4000-8000-00000000001c',
    '61000000-0000-4000-8000-000000000001',
    '2026-09-09T00:00:00Z',
    'synthetic-press-b.v1',
    load_options->0,
    target_bindings,
    replacement_defaults - 'warmupSets',
    'coach'
  ) value
  FROM public.training_exercise_swap_proposals
  WHERE id='61000000-0000-4000-8000-000000000009'
)
SELECT ok(
  value#>'{sessions,2,exercises,0,warmupSets}' IS NULL
  AND value#>'{sessions,1,exercises,0,warmupSets}' = pg_temp.swap_exercise(3)->'warmupSets',
  'omitted replacement warm-ups do not carry source warm-ups into a replacement'
) FROM applied;

SET LOCAL ROLE service_role;
SELECT throws_ok($$
  INSERT INTO public.training_exercise_swap_proposals(
    id,proposal_key,created_by_user_id,subject_id,assignment_id,base_program_revision_number,
    base_assignment_revision,source_exercise_version_id,replacement_exercise_version_id,
    catalog_version,catalog_origin,source_program_hash,source_profile_revision,
    source_eligibility_revision_id,execution_context,load_options,target_bindings,
    replacement_defaults,proposal_json,created_at,expires_at
  )
  SELECT '61000000-0000-4000-8000-00000000001a',repeat('e',64),created_by_user_id,subject_id,
    assignment_id,base_program_revision_number,base_assignment_revision,source_exercise_version_id,
    replacement_exercise_version_id,catalog_version,catalog_origin,source_program_hash,
    source_profile_revision,source_eligibility_revision_id,execution_context,load_options,target_bindings,
    replacement_defaults,
    pg_catalog.jsonb_set(
      pg_catalog.jsonb_set(proposal_json,'{proposalId}',
        '"61000000-0000-4000-8000-00000000001a"'::jsonb),
      '{affectedFutureSessions,0,sessionId}','"swap-session-3"'::jsonb
    ),created_at,expires_at
  FROM public.training_exercise_swap_proposals
  WHERE id='61000000-0000-4000-8000-000000000009'
$$, '23514', NULL,
  'proposal display targets must match immutable target bindings pair by pair');
RESET ROLE;

SET LOCAL session_replication_role = replica;
INSERT INTO public.training_exercise_swap_proposals(
  id,proposal_key,created_by_user_id,subject_id,assignment_id,base_program_revision_number,
  base_assignment_revision,source_exercise_version_id,replacement_exercise_version_id,
  catalog_version,catalog_origin,source_program_hash,source_profile_revision,
  source_eligibility_revision_id,execution_context,load_options,target_bindings,
  replacement_defaults,proposal_json,created_at,expires_at
)
SELECT '61000000-0000-4000-8000-00000000000a',repeat('d',64),created_by_user_id,subject_id,
  assignment_id,base_program_revision_number,base_assignment_revision,source_exercise_version_id,
  replacement_exercise_version_id,catalog_version,catalog_origin,source_program_hash,
  source_profile_revision,source_eligibility_revision_id,execution_context,load_options,target_bindings,
  replacement_defaults,pg_catalog.jsonb_set(proposal_json,'{proposalId}',
    '"61000000-0000-4000-8000-00000000000a"'::jsonb),created_at,expires_at
FROM public.training_exercise_swap_proposals WHERE id='61000000-0000-4000-8000-000000000009';
INSERT INTO public.training_session_prescriptions(
  session_id,subject_id,assignment_id,program_revision_number,prescription_json,started_by_user_id,started_at
) VALUES ('swap-session-2','61000000-0000-4000-8000-000000000004','swap-assignment-1',1,
  pg_temp.swap_program(1) || pg_catalog.jsonb_build_object(
    'sessionId','swap-session-2','exercises',pg_catalog.jsonb_build_array(pg_temp.swap_exercise(2))
  ),'61000000-0000-4000-8000-000000000001',now());
SET LOCAL session_replication_role = origin;

SELECT set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000001","aal":"aal2","iat":2000000000}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.accept_training_exercise_swap_proposal(
  '61000000-0000-4000-8000-00000000000a','61000000-0000-4000-8000-00000000000b',0)$$,
  'PT409','exercise swap target changed',
  'acceptance rejects the complete immutable target set when one target has started');
RESET ROLE;
SET LOCAL session_replication_role = replica;
DELETE FROM public.training_session_prescriptions WHERE session_id='swap-session-2';
SET LOCAL session_replication_role = origin;

SELECT set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000002","aal":"aal2","iat":2000000000}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.accept_training_exercise_swap_proposal(
  '61000000-0000-4000-8000-000000000009','61000000-0000-4000-8000-000000000011',0)$$,
  '42501','exercise swap acceptance is not authorized',
  'subject owner cannot mutate a coach-assigned program');
SELECT throws_ok($$SELECT public.accept_training_exercise_swap_proposal(
  '61000000-0000-4000-8000-000000000009','61000000-0000-4000-8000-000000000013',63)$$,
  '42501','exercise swap acceptance is not authorized',
  'unauthorized caller cannot probe load option existence');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000001","aal":"aal2","iat":2000000000}',true);
SET LOCAL ROLE authenticated;
SELECT is(public.accept_training_exercise_swap_proposal(
  '61000000-0000-4000-8000-000000000009','61000000-0000-4000-8000-000000000012',0
)#>>'{programRevisionNumber}','2','owning coach acceptance appends one program revision');
SELECT is(public.accept_training_exercise_swap_proposal(
  '61000000-0000-4000-8000-000000000009','61000000-0000-4000-8000-000000000012',0
)#>>'{programRevisionNumber}','2','exact acceptance retry is idempotent');
SELECT throws_ok($$SELECT public.accept_training_exercise_swap_proposal(
  '61000000-0000-4000-8000-000000000009','61000000-0000-4000-8000-000000000012',1)$$,
  'PT409','exercise swap request ID reused with different content',
  'a reused request ID has a distinct conflict from stale proposal evidence');
SELECT results_eq(
  $$SELECT exercise->>'exerciseVersionId',exercise#>>'{acceptedInitialLoad,quantity,canonicalKg}',
      exercise#>>'{progression,loadEpoch}',exercise#>>'{progression,exposureType}',
      exercise#>>'{warmupSets,0,prescribedLoad,canonicalKg}'
    FROM public.training_program_revisions revision
    CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(revision.program_json->'sessions') session
    CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(session->'exercises') exercise
    WHERE revision.assignment_id='swap-assignment-1' AND revision.revision_number=2
      AND session->>'sessionId'='swap-session-2'$$,
  $$VALUES ('synthetic-press-b.v1'::text,'52'::text,'1'::text,'heavy'::text,'40'::text)$$,
  'future prescription uses the explicit load, recalibrated epoch, source track, and replacement warm-up');
SELECT is((SELECT prescription_json#>>'{exercises,0,exerciseVersionId}'
  FROM public.training_session_prescriptions WHERE session_id='swap-session-1'),
  'synthetic-press-a.v1','started prescription remains immutable');
SELECT is((SELECT prescription_json#>>'{exercises,0,warmupSets,0,setId}'
  FROM public.training_session_prescriptions WHERE session_id='swap-session-1'),
  'source-warmup-1','started prescription retains its exact historical warm-up');
SELECT is((SELECT program_json#>>'{sessions,1,exercises,0,warmupSets,0,setId}'
  FROM public.training_program_revisions WHERE assignment_id='swap-assignment-1' AND revision_number=2),
  'source-warmup-3','an untouched future exercise retains its exact source warm-up');
SELECT is((SELECT program_json#>>'{sessions,1,exercises,0,exerciseVersionId}'
  FROM public.training_program_revisions WHERE assignment_id='swap-assignment-1' AND revision_number=1),
  'synthetic-press-a.v1','historical program revision remains immutable');
SELECT is((SELECT program_json#>>'{sessions,2,exercises,0,warmupSets,0,setId}'
  FROM public.training_program_revisions WHERE assignment_id='swap-assignment-1' AND revision_number=1),
  'source-warmup-2','historical program revision retains the replaced exercise warm-up');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000002","aal":"aal2","iat":2000000000}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.accept_training_exercise_swap_proposal(
  '61000000-0000-4000-8000-000000000009','61000000-0000-4000-8000-000000000014',0)$$,
  '42501','exercise swap acceptance is not authorized',
  'unauthorized caller cannot probe accepted proposal status');
SELECT is(public.erase_training_subject_transactional('61000000-0000-4000-8000-000000000031')->>'status',
  'erased','subject erasure removes a program that has an accepted exercise swap');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.training_exercise_swap_proposals WHERE subject_id='61000000-0000-4000-8000-000000000004'),
  0::bigint,'subject erasure removes swap proposals');
SELECT is((SELECT count(*) FROM public.training_exercise_swap_acceptances WHERE assignment_id='swap-assignment-1'),
  0::bigint,'subject erasure removes swap acceptance receipts');

SELECT * FROM finish();
ROLLBACK;
