BEGIN;
SELECT no_plan();

SELECT has_table('public','training_manual_recalibration_proposals',
  'manual recalibration proposals have immutable storage');
SELECT has_table('public','training_manual_recalibration_acceptances',
  'explicit manual recalibration acceptances have durable storage');
SELECT has_table('public','training_manual_recalibration_proposal_lifetimes',
  'manual recalibration renewal lifetimes have append-only storage');
SELECT ok(NOT has_table_privilege('authenticated',
  'public.training_manual_recalibration_proposals','INSERT'),
  'browser callers cannot persist a forged manual recalibration offer');
SELECT ok(NOT has_table_privilege('service_role',
  'public.training_manual_recalibration_acceptances','INSERT'),
  'service role cannot impersonate an authenticated acceptance');
SELECT ok(NOT has_function_privilege('service_role',
  'public.accept_training_manual_recalibration_proposal(uuid,uuid,integer,boolean)','EXECUTE'),
  'service role cannot call the authenticated acceptance RPC');
SELECT ok(NOT has_table_privilege('authenticated',
  'public.training_manual_recalibration_proposal_lifetimes','INSERT'),
  'browser callers cannot append manual recalibration lifetimes directly');
SELECT ok(NOT has_function_privilege('service_role',
  'public.renew_training_manual_recalibration_proposal(uuid)','EXECUTE'),
  'service role cannot call the authenticated renewal RPC');
SELECT ok(has_function_privilege('authenticated',
  'public.renew_training_manual_recalibration_proposal(uuid)','EXECUTE'),
  'authenticated callers can request renewal through the guarded RPC');

CREATE FUNCTION pg_temp.active_context()
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT '{"kind":"synthetic_simulation","simulationRunId":"68300000-0000-4000-8000-000000000003","fixtureId":"synthetic-starter-catalog.v1","fixtureHash":"ea848ced42813786b527296c351dc51ba2a8072a6c85ac5d2f744547de730717","label":"Practice data"}'::jsonb;
$$;

CREATE FUNCTION pg_temp.active_origin()
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT pg_catalog.jsonb_build_object(
    'kind','synthetic_fixture','source','server_fixture',
    'fixtureId','synthetic-starter-catalog.v1',
    'fixtureHash','ea848ced42813786b527296c351dc51ba2a8072a6c85ac5d2f744547de730717',
    'label','Synthetic starter catalog'
  );
$$;

CREATE FUNCTION pg_temp.active_quantity(p_value text)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT pg_catalog.jsonb_build_object(
    'entered',pg_catalog.jsonb_build_object('value',p_value,'unit','kg'),
    'canonicalKg',p_value
  );
$$;

CREATE FUNCTION pg_temp.active_exercise(p_number integer)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT pg_catalog.jsonb_build_object(
    'exerciseInstanceId','active-exercise-' || p_number,
    'exerciseVersionId','press.v1','movementPattern','horizontal_push',
    'warmupSets',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'setId','active-warmup-' || p_number,'targetReps',5,
      'prescribedLoad',pg_temp.active_quantity('20'))),
    'setIds',pg_catalog.jsonb_build_array(
      'active-set-' || p_number || '-1','active-set-' || p_number || '-2'),
    'repRange',pg_catalog.jsonb_build_object('minimum',6,'maximum',8),
    'targetRir',pg_catalog.jsonb_build_object('minimum',2,'maximum',3),
    'restSeconds',120,
    'progression',pg_catalog.jsonb_build_object(
      'progressionSeriesId','strength-slot:push','side','bilateral',
      'rom','catalog_default','tempo','controlled','exposureType','standard','loadEpoch',1),
    'acceptedInitialLoad',pg_catalog.jsonb_build_object(
      'status','accepted','acceptanceId','initial-' || p_number,
      'acceptedAt','2026-09-08T00:00:00.000Z',
      'acceptedByUserId','68300000-0000-4000-8000-000000000001',
      'source','equipment_inventory','executionContext',pg_temp.active_context(),
      'exerciseInstanceId','active-exercise-' || p_number,
      'exerciseVersionId','press.v1','equipmentId','machine-1',
      'provenance',pg_catalog.jsonb_build_object(
        'profileRevisionId','1','compiledProgramRevisionId','compiled-active-1',
        'catalogVersion','synthetic-starter-catalog.v1','catalogOrigin',pg_temp.active_origin()),
      'loadBasis','machine_stack','implementCount',1,
      'holdingConfiguration','machine_defined','quantity',pg_temp.active_quantity('50'))
  );
$$;

CREATE FUNCTION pg_temp.active_program(p_revision bigint)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT pg_catalog.jsonb_build_object(
    'schemaVersion','training-program-revision.v1','assignmentId','active-assignment-1',
    'revisionNumber',p_revision,'subjectId','68300000-0000-4000-8000-000000000002',
    'programMode','coach_assigned',
    'owningPractitionerId','68300000-0000-4000-8000-000000000001',
    'executionContext',pg_temp.active_context(),'cycleStartLocalDate','2026-09-01',
    'cycleLengthWeeks',8,'profileRevisionId','1',
    'eligibilitySourceRevisionId','simulation:68300000-0000-4000-8000-000000000003',
    'compilerPolicyVersion','eight-week-compiler.v1',
    'catalogVersion','synthetic-starter-catalog.v1','catalogOrigin',pg_temp.active_origin(),
    'ruleVersion','strength-progression-v1','compiledProgramRevisionId','compiled-active-1',
    'publishedAt','2026-09-08T00:00:00.000Z',
    'author',pg_catalog.jsonb_build_object(
      'kind','coach','userId','68300000-0000-4000-8000-000000000001'),
    'sessions',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('sessionId','active-session-1',
        'scheduledLocalDate','2026-09-01','athleteTimezone','UTC',
        'exercises',pg_catalog.jsonb_build_array(pg_temp.active_exercise(1))),
      pg_catalog.jsonb_build_object('sessionId','active-session-2',
        'scheduledLocalDate','2026-09-10','athleteTimezone','UTC',
        'exercises',pg_catalog.jsonb_build_array(pg_temp.active_exercise(2))),
      pg_catalog.jsonb_build_object('sessionId','active-session-3',
        'scheduledLocalDate','2026-09-13','athleteTimezone','UTC',
        'exercises',pg_catalog.jsonb_build_array(pg_temp.active_exercise(3)))),
    'conditioningBouts',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('boutId','placeholder-conditioning'))
  );
$$;

CREATE FUNCTION pg_temp.active_targets()
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('sessionId','active-session-2','sessionRevision',1,
      'exerciseInstanceId','active-exercise-2','scheduledLocalDate','2026-09-10'),
    pg_catalog.jsonb_build_object('sessionId','active-session-3','sessionRevision',1,
      'exerciseInstanceId','active-exercise-3','scheduledLocalDate','2026-09-13'));
$$;

CREATE FUNCTION pg_temp.active_offer()
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT pg_catalog.jsonb_build_object(
    'schemaVersion','manual-recalibration-offer.v1','kind','options',
    'status','requires_explicit_selection',
    'sourceBindings',pg_catalog.jsonb_build_object(
      'subjectId','68300000-0000-4000-8000-000000000002',
      'assignmentId','active-assignment-1','sourceProgramRevisionNumber',1,
      'sourceProgramHash','PROGRAM_HASH_REPLACED_AT_INSERT',
      'sourceProfileRevisionId','1',
      'sourceEligibilityRevisionId','simulation:68300000-0000-4000-8000-000000000003',
      'executionContext',pg_temp.active_context(),
      'catalogVersion','synthetic-starter-catalog.v1','catalogOrigin',pg_temp.active_origin(),
      'target',pg_catalog.jsonb_build_object(
        'sessionId','active-session-2','exerciseInstanceId','active-exercise-2',
        'sessionState','scheduled','prescriptionState','unprescribed'),
      'exerciseVersionId','press.v1','priorProgressionSeriesId','strength-slot:push',
      'priorLoadEpoch',1,
      'sourceDecision',pg_catalog.jsonb_build_object(
        'decisionIdentity','decision-too-easy-1','reason','effort_too_easy_recalibration',
        'sourceSessionId','active-session-1','sourceExerciseInstanceId','active-exercise-1',
        'sourceSessionRevision',4,'sourceSessionState','completed',
        'sourceExposureRevisionIds',pg_catalog.jsonb_build_array('session-evidence-1'),
        'lastComparableActualLoad',pg_catalog.jsonb_build_object(
          'equipmentId','machine-1','basis','machine_stack','quantity',pg_temp.active_quantity('50')))),
    'currentLoad',pg_catalog.jsonb_build_object(
      'equipmentId','machine-1','basis','machine_stack','quantity',pg_temp.active_quantity('50')),
    'seriesIntent',pg_catalog.jsonb_build_object(
      'kind','new_series_on_acceptance','reason','explicit_too_easy_recalibration',
      'sourceProgressionSeriesId','strength-slot:push','sourceLoadEpoch',1,'nextLoadEpoch',2),
    'options',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('optionIndex',0,'equipmentId','machine-1',
        'basis','machine_stack','quantity',pg_temp.active_quantity('55'),
        'harderDirection','higher_resistance_or_external_load','confirmation',jsonb_build_object('explicitSelectionRequired',true,'outlierDisposition','within_20_percent')),
      pg_catalog.jsonb_build_object('optionIndex',1,'equipmentId','machine-1',
        'basis','machine_stack','quantity',pg_temp.active_quantity('70'),
        'harderDirection','higher_resistance_or_external_load','confirmation',jsonb_build_object('explicitSelectionRequired',true,'outlierDisposition','greater_than_20_percent_acknowledgement_required')))
  );
$$;

SELECT ok(private.is_valid_training_manual_recalibration_offer(
  pg_temp.active_targets(),pg_temp.active_offer()),
  'server-built harder options and ordered targets validate');
SELECT ok(NOT private.is_valid_training_manual_recalibration_offer(
  pg_temp.active_targets(),
  pg_catalog.jsonb_set(pg_temp.active_offer(),'{options,0,harderDirection}',
    '"higher_machine_assistance"'::jsonb)),
  'a forged harder direction is rejected');
SELECT ok(NOT private.is_valid_training_manual_recalibration_offer(
  pg_temp.active_targets(),
  pg_catalog.jsonb_set(pg_temp.active_offer(),'{sourceBindings,sourceDecision,lastComparableActualLoad,quantity,canonicalKg}',
    '"40"'::jsonb)),
  'a malformed nested comparable actual is rejected before persistence');
SELECT ok(NOT private.is_valid_training_manual_recalibration_offer(
  pg_temp.active_targets(),
  pg_catalog.jsonb_set(pg_temp.active_offer(),'{options,1,optionIndex}','0'::jsonb)),
  'duplicate option indexes are rejected');
SELECT ok(NOT private.is_valid_training_manual_recalibration_offer(
  pg_catalog.jsonb_set(pg_temp.active_targets(),'{0,exerciseInstanceId}',
    '"another-exercise"'::jsonb),pg_temp.active_offer()),
  'the offer target is bound to the first ordered mutable target');

SELECT ok(private.is_valid_training_manual_recalibration_offer(
  pg_temp.active_targets(),
  pg_catalog.jsonb_set(
    pg_catalog.jsonb_set(
      pg_catalog.jsonb_set(
        pg_catalog.jsonb_set(
          pg_catalog.jsonb_set(
            pg_catalog.jsonb_set(pg_temp.active_offer(),'{currentLoad,basis}','"bodyweight_external"'),
            '{currentLoad,quantity}',pg_temp.active_quantity('0')),
          '{sourceBindings,sourceDecision,lastComparableActualLoad,basis}','"bodyweight_external"'),
        '{sourceBindings,sourceDecision,lastComparableActualLoad,quantity}',pg_temp.active_quantity('0')),
      '{options}',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'optionIndex',0,'equipmentId','machine-1','basis','bodyweight_external',
        'quantity',pg_temp.active_quantity('10'),'harderDirection','higher_resistance_or_external_load',
        'confirmation',pg_catalog.jsonb_build_object(
          'explicitSelectionRequired',true,
          'outlierDisposition','zero_prior_requires_calibration_confirmation')))),
    '{bodyweightAssistancePolicy}',pg_catalog.jsonb_build_object(
      'policyId','bodyweight-policy-1','policyVersion','bodyweight-policy.v1'))),
  'zero external load offers an explicit positive calibration setting without ratio division');

SELECT ok(private.is_valid_training_manual_recalibration_offer(
  pg_temp.active_targets(),
  pg_catalog.jsonb_set(
    pg_catalog.jsonb_set(
      pg_catalog.jsonb_set(
        pg_catalog.jsonb_set(
          pg_catalog.jsonb_set(pg_temp.active_offer(),'{currentLoad,basis}','"machine_assistance"'),
          '{sourceBindings,sourceDecision,lastComparableActualLoad,basis}','"machine_assistance"'),
        '{options}',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'optionIndex',0,'equipmentId','machine-1','basis','machine_assistance',
          'quantity',pg_temp.active_quantity('40'),'harderDirection','lower_machine_assistance',
          'confirmation',pg_catalog.jsonb_build_object(
            'explicitSelectionRequired',true,'outlierDisposition','not_applicable_to_assistance')))),
      '{bodyweightAssistancePolicy}',pg_catalog.jsonb_build_object(
        'policyId','assistance-policy-1','policyVersion','assistance-policy.v1')),
    '{sourceBindings,sourceDecision,lastComparableActualLoad,quantity}',pg_temp.active_quantity('50'))),
  'machine assistance treats a lower exact assistance setting as harder without a percent outlier flag');

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id,email,created_at,updated_at) VALUES
  ('68300000-0000-4000-8000-000000000001','active-coach@example.invalid',now(),now()),
  ('68300000-0000-4000-8000-000000000009',
   'simulation+68300000000040008000000000000009@fixtures.invalid',now(),now());
INSERT INTO public.practitioners(id,display_name,access_status,role,session_valid_after) VALUES
  ('68300000-0000-4000-8000-000000000001','Active coach','active','practitioner','-infinity');
INSERT INTO public.clients(id,practitioner_id,first_name,last_name) VALUES
  ('68300000-0000-4000-8000-000000000010',
   '68300000-0000-4000-8000-000000000001','Practice','Athlete');
INSERT INTO public.training_subjects(
  id,owner_user_id,status,activated_at,current_profile_revision
) VALUES (
  '68300000-0000-4000-8000-000000000002',
  '68300000-0000-4000-8000-000000000009','active',now(),1);
WITH profile(value) AS (VALUES ('{
  "schemaVersion":"athlete-training-profile.v1",
  "origin":{"kind":"synthetic_fixture","fixtureId":"synthetic-starter-catalog.v1","label":"Synthetic manual recalibration profile"},
  "goal":"strength","experience":"beginner","recentConsistency":"consistent",
  "cycleLengthWeeks":8,"strengthDays":["monday","thursday"],
  "localTimezone":"UTC","sessionTimeBudgetMinutes":30,"preferredLoadUnit":"kg",
  "equipmentInventory":[{"kind":"machine","equipmentId":"machine-1","unit":"kg","stackLoads":["50","55","70"]}],
  "startingHistory":[]
}'::jsonb))
INSERT INTO public.training_profile_revisions(
  subject_id,revision,schema_version,profile_json,profile_hash,hash_encoding,
  created_by_user_id,created_at
) SELECT '68300000-0000-4000-8000-000000000002',1,
  'athlete-training-profile.v1',profile.value,
  private.training_evidence_sha256(profile.value),'postgres-jsonb-text-utf8.v1',
  '68300000-0000-4000-8000-000000000009',now()
FROM profile;
INSERT INTO public.training_simulation_runs(
  id,subject_id,created_by_user_id,fixture_id,fixture_hash,expires_at
) VALUES (
  '68300000-0000-4000-8000-000000000003',
  '68300000-0000-4000-8000-000000000002',
  '68300000-0000-4000-8000-000000000001','synthetic-starter-catalog.v1',
  'ea848ced42813786b527296c351dc51ba2a8072a6c85ac5d2f744547de730717',
  now()+interval '1 hour');
INSERT INTO private.athlete_invitations(
  id,email_normalized,display_name,mode,target_client_id,issuer_practitioner_id,
  permissions,state,expires_at,provisioned_user_id,subject_id,provisioned_at,accepted_at,issued_by
) VALUES (
  '68300000-0000-4000-8000-000000000011',
  'simulation+68300000000040008000000000000009@fixtures.invalid',
  'Practice data','coach_invited','68300000-0000-4000-8000-000000000010',
  '68300000-0000-4000-8000-000000000001',
  ARRAY['subject:read','program:coach_publish','session:read','set_log:write']::public.training_coach_permission[],
  'accepted',now()+interval '1 hour','68300000-0000-4000-8000-000000000009',
  '68300000-0000-4000-8000-000000000002',now(),now(),
  '68300000-0000-4000-8000-000000000001');
INSERT INTO private.training_simulation_identities(
  id,invitation_id,client_id,practitioner_id,provisioned_user_id,subject_id,
  simulation_run_id,fixture_id,fixture_hash,label,permission,internal_email,
  state,expires_at,activated_at
) VALUES (
  '68300000-0000-4000-8000-000000000012','68300000-0000-4000-8000-000000000011',
  '68300000-0000-4000-8000-000000000010','68300000-0000-4000-8000-000000000001',
  '68300000-0000-4000-8000-000000000009','68300000-0000-4000-8000-000000000002',
  '68300000-0000-4000-8000-000000000003','synthetic-starter-catalog.v1',
  'ea848ced42813786b527296c351dc51ba2a8072a6c85ac5d2f744547de730717',
  'Practice data','simulation:control',
  'simulation+68300000000040008000000000000009@fixtures.invalid',
  'active',now()+interval '1 hour',now());
INSERT INTO public.coaching_relationships(subject_id,practitioner_id,permissions,status)
VALUES ('68300000-0000-4000-8000-000000000002',
  '68300000-0000-4000-8000-000000000001',
  ARRAY['subject:read','program:coach_publish','session:read','set_log:write']::public.training_coach_permission[],
  'active');
INSERT INTO public.training_program_drafts(
  id,subject_id,created_by_user_id,profile_revision,simulation_run_id,program_json,expires_at
) VALUES (
  '68300000-0000-4000-8000-000000000004',
  '68300000-0000-4000-8000-000000000002',
  '68300000-0000-4000-8000-000000000001',1,
  '68300000-0000-4000-8000-000000000003',pg_temp.active_program(1),
  now()+interval '1 hour');
INSERT INTO public.training_program_assignments(
  id,subject_id,program_mode,owning_practitioner_id,simulation_run_id,
  source_draft_id,status,active_revision,revision
) VALUES (
  'active-assignment-1','68300000-0000-4000-8000-000000000002','coach_assigned',
  '68300000-0000-4000-8000-000000000001',
  '68300000-0000-4000-8000-000000000003',
  '68300000-0000-4000-8000-000000000004','active',1,1);
INSERT INTO public.training_program_revisions(
  assignment_id,subject_id,revision_number,program_json,created_by_user_id
) VALUES ('active-assignment-1','68300000-0000-4000-8000-000000000002',1,
  pg_temp.active_program(1),'68300000-0000-4000-8000-000000000001');
INSERT INTO public.training_sessions(
  id,assignment_id,subject_id,session_kind,state,scheduled_local_date,
  athlete_timezone,revision,completed_at
) VALUES
  ('active-session-0','active-assignment-1','68300000-0000-4000-8000-000000000002',
    'strength','completed','2026-08-28','UTC',2,'2026-08-28T18:00:00Z'),
  ('active-session-1','active-assignment-1','68300000-0000-4000-8000-000000000002',
    'strength','completed','2026-09-01','UTC',4,'2026-09-01T18:00:00Z'),
  ('active-session-2','active-assignment-1','68300000-0000-4000-8000-000000000002',
    'strength','scheduled','2026-09-10','UTC',1,NULL),
  ('active-session-3','active-assignment-1','68300000-0000-4000-8000-000000000002',
    'strength','scheduled','2026-09-13','UTC',1,NULL);
SET LOCAL session_replication_role = origin;

SET LOCAL ROLE service_role;
WITH source AS (
  SELECT program_hash FROM public.training_program_revisions
  WHERE assignment_id='active-assignment-1' AND revision_number=1
), offer AS (
  SELECT pg_catalog.jsonb_set(pg_temp.active_offer(),'{sourceBindings,sourceProgramHash}',
    pg_catalog.to_jsonb(source.program_hash)) AS value,source.program_hash
  FROM source
)
INSERT INTO public.training_manual_recalibration_proposals(
  id,proposal_key,created_by_user_id,subject_id,assignment_id,
  base_program_revision_number,base_assignment_revision,source_session_id,
  source_exercise_instance_id,source_session_revision,source_session_revisions,source_profile_revision,
  source_eligibility_revision_id,source_program_hash,execution_context,
  catalog_version,catalog_origin,target_bindings,offer_json,created_at,expires_at
) SELECT '68300000-0000-4000-8000-000000000020',repeat('a',64),
  '68300000-0000-4000-8000-000000000009',
  '68300000-0000-4000-8000-000000000002','active-assignment-1',1,1,
  'active-session-1','active-exercise-1',4,
  pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('sessionId','active-session-0','revision',2),
    pg_catalog.jsonb_build_object('sessionId','active-session-1','revision',4)),1,
  'simulation:68300000-0000-4000-8000-000000000003',offer.program_hash,
  pg_temp.active_context(),'synthetic-starter-catalog.v1',pg_temp.active_origin(),
  pg_temp.active_targets(),offer.value,now(),now()+interval '1 hour'
FROM offer;
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','68300000-0000-4000-8000-000000000008',true);
SELECT set_config('request.jwt.claims',
  '{"sub":"68300000-0000-4000-8000-000000000008","aal":"aal2","iat":2000000000}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.renew_training_manual_recalibration_proposal(
  '68300000-0000-4000-8000-000000000020')$$,
  '42501','manual recalibration renewal forbidden',
  'an unrelated AAL2 actor cannot reuse an athlete-requested manual offer');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','68300000-0000-4000-8000-000000000009',true);
SELECT set_config('request.jwt.claims',
  '{"sub":"68300000-0000-4000-8000-000000000009","aal":"aal2","iat":2000000000}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.accept_training_manual_recalibration_proposal(
  '68300000-0000-4000-8000-000000000020',
  '68300000-0000-4000-8000-000000000021',0,false)$$,
  '42501','manual recalibration acceptance forbidden',
  'the athlete cannot accept a coach-assigned familiarization change');
SELECT is(public.renew_training_manual_recalibration_proposal(
  '68300000-0000-4000-8000-000000000020')#>>'{status}',
  'active','the subject athlete can reuse a still-valid coach-assigned manual offer request');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.training_manual_recalibration_proposal_lifetimes
  WHERE proposal_id='68300000-0000-4000-8000-000000000020'),0::bigint,
  'reusing a valid athlete-requested manual offer does not append a lifetime');

SELECT set_config('request.jwt.claim.sub','68300000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims',
  '{"sub":"68300000-0000-4000-8000-000000000001","aal":"aal2","iat":2000000000}',true);
RESET ROLE;
SET LOCAL session_replication_role = replica;
UPDATE public.training_sessions SET revision=3 WHERE id='active-session-0';
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.accept_training_manual_recalibration_proposal(
  '68300000-0000-4000-8000-000000000020',
  '68300000-0000-4000-8000-000000000025',0,false)$$,
  'PT409','manual recalibration evidence changed',
  'a changed earlier evidence session stales the proposal before acceptance');
SELECT throws_ok($$SELECT public.renew_training_manual_recalibration_proposal(
  '68300000-0000-4000-8000-000000000020')$$,
  'PT409','manual recalibration evidence changed',
  'a changed earlier evidence session cannot renew the proposal');
RESET ROLE;
SET LOCAL session_replication_role = replica;
UPDATE public.training_sessions SET revision=2 WHERE id='active-session-0';
UPDATE public.training_manual_recalibration_proposals
SET created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour'
WHERE id='68300000-0000-4000-8000-000000000020';
UPDATE public.coaching_relationships
SET status='revoked',ended_at=now(),revision=revision+1
WHERE subject_id='68300000-0000-4000-8000-000000000002'
  AND practitioner_id='68300000-0000-4000-8000-000000000001';
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.renew_training_manual_recalibration_proposal(
  '68300000-0000-4000-8000-000000000020')$$,
  '42501','manual recalibration renewal forbidden',
  'a revoked coach cannot renew an unchanged expired manual offer');
RESET ROLE;
SET LOCAL session_replication_role = replica;
UPDATE public.coaching_relationships
SET status='active',ended_at=NULL,revision=revision+1
WHERE subject_id='68300000-0000-4000-8000-000000000002'
  AND practitioner_id='68300000-0000-4000-8000-000000000001';
SET LOCAL session_replication_role = origin;
SELECT set_config('request.jwt.claim.sub','68300000-0000-4000-8000-000000000009',true);
SELECT set_config('request.jwt.claims',
  '{"sub":"68300000-0000-4000-8000-000000000009","aal":"aal2","iat":2000000000}',true);
SET LOCAL ROLE authenticated;
SELECT is(public.renew_training_manual_recalibration_proposal(
  '68300000-0000-4000-8000-000000000020')#>>'{status}',
  'renewed','the subject athlete can renew an unchanged expired coach-assigned manual offer request');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.training_manual_recalibration_proposal_lifetimes
  WHERE proposal_id='68300000-0000-4000-8000-000000000020'),1::bigint,
  'one manual renewal appends exactly one lifetime row');
SELECT set_config('request.jwt.claim.sub','68300000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims',
  '{"sub":"68300000-0000-4000-8000-000000000001","aal":"aal2","iat":2000000000}',true);
SET LOCAL ROLE authenticated;
SELECT is(public.renew_training_manual_recalibration_proposal(
  '68300000-0000-4000-8000-000000000020')#>>'{status}',
  'active','reload during the renewed manual window reuses the active lifetime');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.training_manual_recalibration_proposal_lifetimes
  WHERE proposal_id='68300000-0000-4000-8000-000000000020'),1::bigint,
  'an already-active manual lifetime is not appended again');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.accept_training_manual_recalibration_proposal(
  '68300000-0000-4000-8000-000000000020',
  '68300000-0000-4000-8000-000000000024',1,false)$$,
  'PT409','manual recalibration outlier acknowledgement required',
  'an exact harder option over twenty percent requires explicit acknowledgement');
SELECT is(public.accept_training_manual_recalibration_proposal(
  '68300000-0000-4000-8000-000000000020',
  '68300000-0000-4000-8000-000000000022',0,false)#>>'{programRevisionNumber}',
  '2','owning coach acceptance appends one immutable program revision');
SELECT is((SELECT result_json#>>'{sourceDecision,lastComparableActualLoad,quantity,canonicalKg}'
  FROM public.training_manual_recalibration_acceptances
  WHERE proposal_id='68300000-0000-4000-8000-000000000020'),'50',
  'acceptance retains the exact comparable actual used for the outlier boundary');
SELECT is((SELECT active_revision::text FROM public.training_program_assignments
  WHERE id='active-assignment-1'),'2',
  'active program advances exactly one revision');
SELECT is((SELECT program_json#>>'{sessions,0,exercises,0,acceptedInitialLoad,quantity,canonicalKg}'
  FROM public.training_program_revisions
  WHERE assignment_id='active-assignment-1' AND revision_number=2),'50',
  'completed historical exercise load remains immutable');
SELECT is((SELECT program_json#>>'{sessions,1,exercises,0,acceptedInitialLoad,quantity,canonicalKg}'
  FROM public.training_program_revisions
  WHERE assignment_id='active-assignment-1' AND revision_number=2),'55',
  'selected harder load is applied to the next unprescribed target');
SELECT is((SELECT program_json#>>'{sessions,1,exercises,0,warmupSets,0,prescribedLoad,canonicalKg}'
  FROM public.training_program_revisions
  WHERE assignment_id='active-assignment-1' AND revision_number=2),'20',
  'authored warm-up load remains exact when it is no harder than the selected working load');
SELECT is((SELECT (program_json#>>'{sessions,2,exercises,0,progression,loadEpoch}') || ':' ||
    (program_json#>>'{sessions,2,exercises,0,progression,progressionSeriesId}')
  FROM public.training_program_revisions
  WHERE assignment_id='active-assignment-1' AND revision_number=2),
  '2:manual-recalibration:68300000-0000-4000-8000-000000000020',
  'every later target moves to the new load epoch and progression series');
RESET ROLE;
SET LOCAL session_replication_role = replica;
UPDATE public.training_manual_recalibration_proposals
SET created_at = now() - interval '2 seconds',
  expires_at = now() - interval '1 second'
WHERE id = '68300000-0000-4000-8000-000000000020';
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE authenticated;
SELECT is(public.renew_training_manual_recalibration_proposal(
  '68300000-0000-4000-8000-000000000020')#>>'{status}',
  'accepted','an accepted manual proposal is identified without a new lifetime');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.training_manual_recalibration_proposal_lifetimes
  WHERE proposal_id='68300000-0000-4000-8000-000000000020'),1::bigint,
  'accepted manual proposal lookup never appends a lifetime');
SET LOCAL ROLE authenticated;
SELECT is(public.accept_training_manual_recalibration_proposal(
  '68300000-0000-4000-8000-000000000020',
  '68300000-0000-4000-8000-000000000022',0,false)#>>'{programRevisionNumber}',
  '2','exact committed retry survives proposal expiry without another revision');
SELECT throws_ok($$SELECT public.accept_training_manual_recalibration_proposal(
  '68300000-0000-4000-8000-000000000020',
  '68300000-0000-4000-8000-000000000022',1,true)$$,
  'PT409','manual recalibration request ID reused with different selection',
  'changed selection with the same request ID is rejected');
SELECT throws_ok($$SELECT public.accept_training_manual_recalibration_proposal(
  '68300000-0000-4000-8000-000000000020',
  '68300000-0000-4000-8000-000000000023',NULL,false)$$,
  '22023','invalid manual recalibration acceptance',
  'a null option index cannot pass the acceptance boundary');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','68300000-0000-4000-8000-000000000009',true);
SELECT set_config('request.jwt.claims',
  '{"sub":"68300000-0000-4000-8000-000000000009","aal":"aal2","iat":2000000000}',true);
SET LOCAL ROLE authenticated;
SELECT is(public.erase_training_subject_transactional(
  '68300000-0000-4000-8000-000000000029')#>>'{status}',
  'erased','subject erasure removes a manual-recalibration renewal tree');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.training_manual_recalibration_proposal_lifetimes
  WHERE proposal_id='68300000-0000-4000-8000-000000000020'),0::bigint,
  'subject erasure cascades manual-recalibration lifetime rows');

SELECT * FROM finish();
ROLLBACK;
