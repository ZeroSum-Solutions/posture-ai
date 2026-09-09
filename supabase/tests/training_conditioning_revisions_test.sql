BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path TO public,extensions;
SELECT plan(25);

SELECT has_table('public','training_conditioning_revision_proposals','conditioning revisions have immutable proposals');
SELECT has_table('public','training_conditioning_revision_acceptances','conditioning revisions have immutable receipts');
SELECT ok(NOT has_table_privilege('authenticated','public.training_conditioning_revision_proposals','INSERT'),'browser cannot forge revision proposals');
SELECT ok(NOT has_table_privilege('service_role','public.training_conditioning_revision_acceptances','INSERT'),'service cannot forge authenticated acceptance');
SELECT ok(has_function_privilege('authenticated','public.read_training_conditioning_revision_candidate(text)','EXECUTE') AND NOT has_function_privilege('anon','public.read_training_conditioning_revision_candidate(text)','EXECUTE'),'candidate read is authenticated only');
SELECT ok(has_function_privilege('authenticated','public.accept_training_conditioning_revision_proposal(uuid,uuid)','EXECUTE') AND NOT has_function_privilege('service_role','public.accept_training_conditioning_revision_proposal(uuid,uuid)','EXECUTE'),'acceptance remains actor-bound');

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id,email,created_at,updated_at) VALUES
  ('64000000-0000-4000-8000-000000000001','revision-athlete@example.invalid',now(),now()),
  ('64000000-0000-4000-8000-000000000011','unrelated-revision-athlete@example.invalid',now(),now());
INSERT INTO public.practitioners(id,display_name,access_status,role,session_valid_after)
VALUES ('64000000-0000-4000-8000-000000000001','Revision fixture coach',
  'active','practitioner','-infinity');
INSERT INTO public.training_subjects(
  id,owner_user_id,status,activated_at,current_profile_revision
) VALUES (
  '64000000-0000-4000-8000-000000000002',
  '64000000-0000-4000-8000-000000000001','active',now(),1
);
WITH profile(value) AS (VALUES (
  '{"schemaVersion":"athlete-training-profile.v1","origin":{"kind":"synthetic_fixture","fixtureId":"practice-strength-profile.v1","label":"Synthetic practice profile"},"goal":"strength","experience":"beginner","recentConsistency":"consistent","cycleLengthWeeks":8,"strengthDays":["monday","thursday"],"localTimezone":"UTC","sessionTimeBudgetMinutes":30,"preferredLoadUnit":"kg","equipmentInventory":[{"kind":"machine","equipmentId":"machine-1","unit":"kg","stackLoads":["50","52"]}],"startingHistory":[]}'::jsonb
)) INSERT INTO public.training_profile_revisions(
  subject_id,revision,schema_version,profile_json,profile_hash,hash_encoding,
  created_by_user_id,created_at
) SELECT '64000000-0000-4000-8000-000000000002',1,'athlete-training-profile.v1',
  value,private.training_evidence_sha256(value),'postgres-jsonb-text-utf8.v1',
  '64000000-0000-4000-8000-000000000001',now() FROM profile;
INSERT INTO public.training_simulation_runs(
  id,subject_id,created_by_user_id,fixture_id,fixture_hash,expires_at
) VALUES (
  '64000000-0000-4000-8000-000000000003',
  '64000000-0000-4000-8000-000000000002',
  '64000000-0000-4000-8000-000000000001','synthetic-starter-catalog.v1',
  'ea848ced42813786b527296c351dc51ba2a8072a6c85ac5d2f744547de730717',now()+interval '1 hour'
);

CREATE FUNCTION pg_temp.conditioning_bout(p_number integer, p_date text)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT pg_catalog.jsonb_build_object(
    'status','accepted','acceptanceId','conditioning-initial-' || p_number,
    'acceptedAt','2026-09-08T00:00:00.000Z',
    'acceptedByUserId','64000000-0000-4000-8000-000000000001',
    'executionContext',pg_catalog.jsonb_build_object(
      'kind','synthetic_simulation',
      'simulationRunId','64000000-0000-4000-8000-000000000003',
      'fixtureId','synthetic-starter-catalog.v1',
      'fixtureHash','ea848ced42813786b527296c351dc51ba2a8072a6c85ac5d2f744547de730717',
      'label','Practice data'
    ),
    'boutId','revision-bout-' || p_number,
    'modalityId','synthetic-continuous-walking.v1',
    'scheduledLocalDate',p_date,'athleteTimezone','UTC','acceptedDurationSeconds',600,
    'effortCue','Synthetic easy to moderate walking effort.',
    'source',pg_catalog.jsonb_build_object(
      'compiledProgramRevisionId','compiled-conditioning-1',
      'compilerPolicyVersion','strength-cycle-compiler.v3',
      'catalogVersion','synthetic-starter-catalog.v1',
      'catalogOrigin',pg_catalog.jsonb_build_object(
        'kind','synthetic_fixture','source','server_fixture',
        'fixtureId','synthetic-starter-catalog.v1',
        'fixtureHash','ea848ced42813786b527296c351dc51ba2a8072a6c85ac5d2f744547de730717',
        'label','Synthetic starter catalog'
      )
    )
  );
$$;

CREATE FUNCTION pg_temp.conditioning_program(p_revision bigint)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT pg_catalog.jsonb_build_object(
    'schemaVersion','training-program-revision.v1','assignmentId','revision-assignment-1',
    'revisionNumber',p_revision,'subjectId','64000000-0000-4000-8000-000000000002',
    'programMode','self_directed','owningPractitionerId',NULL,
    'executionContext',pg_catalog.jsonb_build_object(
      'kind','synthetic_simulation',
      'simulationRunId','64000000-0000-4000-8000-000000000003',
      'fixtureId','synthetic-starter-catalog.v1',
      'fixtureHash','ea848ced42813786b527296c351dc51ba2a8072a6c85ac5d2f744547de730717',
      'label','Practice data'
    ),
    'cycleStartLocalDate','2026-09-01','cycleLengthWeeks',8,
    'profileRevisionId','1',
    'eligibilitySourceRevisionId','simulation:64000000-0000-4000-8000-000000000003',
    'compilerPolicyVersion','strength-cycle-compiler.v3',
    'catalogVersion','synthetic-starter-catalog.v1',
    'catalogOrigin',pg_catalog.jsonb_build_object(
      'kind','synthetic_fixture','source','server_fixture',
      'fixtureId','synthetic-starter-catalog.v1',
      'fixtureHash','ea848ced42813786b527296c351dc51ba2a8072a6c85ac5d2f744547de730717',
      'label','Synthetic starter catalog'
    ),
    'ruleVersion','strength-progression-v1','compiledProgramRevisionId','compiled-conditioning-1',
    'publishedAt','2026-09-08T00:00:00.000Z',
    'author',pg_catalog.jsonb_build_object(
      'kind','athlete','userId','64000000-0000-4000-8000-000000000001'
    ),
    'sessions',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('sessionId','placeholder-strength-session',
        'scheduledLocalDate','2026-09-01','athleteTimezone','UTC','exercises','[]'::jsonb)
    ),
    'conditioningBouts',pg_catalog.jsonb_build_array(
      pg_temp.conditioning_bout(1,'2026-09-01'),pg_temp.conditioning_bout(2,'2026-09-04'),
      pg_temp.conditioning_bout(3,'2026-09-09'),pg_temp.conditioning_bout(4,'2026-09-12'),
      pg_temp.conditioning_bout(5,'2026-09-16'),pg_temp.conditioning_bout(6,'2026-09-19')
    )
  );
$$;

INSERT INTO public.training_program_drafts(
  id,subject_id,created_by_user_id,profile_revision,simulation_run_id,
  source_build_id,selection_hash,program_json,expires_at
) VALUES (
  '64000000-0000-4000-8000-000000000004',
  '64000000-0000-4000-8000-000000000002',
  '64000000-0000-4000-8000-000000000001',1,
  '64000000-0000-4000-8000-000000000003',NULL,NULL,
  pg_temp.conditioning_program(1),now()+interval '1 hour'
);
INSERT INTO public.training_program_assignments(
  id,subject_id,program_mode,owning_practitioner_id,simulation_run_id,
  source_draft_id,status,active_revision,revision
) VALUES (
  'revision-assignment-1','64000000-0000-4000-8000-000000000002',
  'self_directed',NULL,'64000000-0000-4000-8000-000000000003',
  '64000000-0000-4000-8000-000000000004','active',1,1
);
INSERT INTO public.training_program_revisions(
  assignment_id,subject_id,revision_number,program_json,created_by_user_id
) VALUES (
  'revision-assignment-1','64000000-0000-4000-8000-000000000002',1,
  pg_temp.conditioning_program(1),'64000000-0000-4000-8000-000000000001'
);
INSERT INTO public.training_sessions(
  id,assignment_id,subject_id,session_kind,state,scheduled_local_date,
  athlete_timezone,revision,completed_at
) VALUES
  ('revision-bout-1','revision-assignment-1','64000000-0000-4000-8000-000000000002','conditioning','completed','2026-09-01','UTC',3,'2026-09-01T18:00:00Z'),
  ('revision-bout-2','revision-assignment-1','64000000-0000-4000-8000-000000000002','conditioning','completed','2026-09-04','UTC',3,'2026-09-04T18:00:00Z'),
  ('revision-bout-3','revision-assignment-1','64000000-0000-4000-8000-000000000002','conditioning','scheduled','2026-09-09','UTC',1,NULL),
  ('revision-bout-4','revision-assignment-1','64000000-0000-4000-8000-000000000002','conditioning','scheduled','2026-09-12','UTC',1,NULL),
  ('revision-bout-5','revision-assignment-1','64000000-0000-4000-8000-000000000002','conditioning','scheduled','2026-09-16','UTC',1,NULL),
  ('revision-bout-6','revision-assignment-1','64000000-0000-4000-8000-000000000002','conditioning','scheduled','2026-09-19','UTC',1,NULL);

INSERT INTO public.training_session_prescriptions(
  session_id,subject_id,assignment_id,program_revision_number,prescription_json,started_by_user_id
) SELECT 'revision-bout-' || number,
  '64000000-0000-4000-8000-000000000002','revision-assignment-1',1,
  pg_catalog.jsonb_build_object(
    'schemaVersion','training-conditioning-session-prescription.v1',
    'sessionId','revision-bout-' || number,
    'assignmentId','revision-assignment-1','programRevisionNumber',1,
    'subjectId','64000000-0000-4000-8000-000000000002',
    'executionContext',pg_temp.conditioning_program(1)->'executionContext',
    'catalogOrigin',pg_temp.conditioning_program(1)->'catalogOrigin',
    'compiledProgramRevisionId','compiled-conditioning-1',
    'acceptedBout',pg_temp.conditioning_bout(number,
      CASE number WHEN 1 THEN '2026-09-01' ELSE '2026-09-04' END)
  ),'64000000-0000-4000-8000-000000000001'
FROM generate_series(1,2) number;

INSERT INTO public.training_conditioning_log_events(
  id,subject_id,session_id,event_revision,replaces_event_id,actor_user_id,event_json
) SELECT ('64000000-0000-4000-8000-00000000000' || (4 + number))::uuid,
  '64000000-0000-4000-8000-000000000002','revision-bout-' || number,1,NULL,
  '64000000-0000-4000-8000-000000000001',pg_catalog.jsonb_build_object(
    'schemaVersion','training-conditioning-log-event.v1',
    'eventId','64000000-0000-4000-8000-00000000000' || (4 + number),
    'eventType','conditioning_actual_recorded','eventRevision',1,'replacesEventId',NULL,
    'subjectId','64000000-0000-4000-8000-000000000002',
    'sessionId','revision-bout-' || number,'boutId','revision-bout-' || number,
    'modalityId','synthetic-continuous-walking.v1',
    'executionContext',pg_temp.conditioning_program(1)->'executionContext',
    'durationSeconds',600,'perceivedEffort',4,'symptomState','none',
    'actor',pg_catalog.jsonb_build_object(
      'kind','athlete','userId','64000000-0000-4000-8000-000000000001'
    ),'occurredAt','2026-09-04T18:00:00.000Z','serverAt','2026-09-04T18:00:00.000Z'
  ) FROM generate_series(1,2) number;
SET LOCAL session_replication_role = origin;

CREATE FUNCTION pg_temp.revision_replacement(p_number integer,p_date text)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT pg_catalog.jsonb_build_object(
    'sourceBoutId','revision-bout-'||p_number,
    'priorModalityId','synthetic-continuous-walking.v1',
    'priorScheduledLocalDate',CASE p_number
      WHEN 3 THEN '2026-09-09' WHEN 4 THEN '2026-09-12'
      WHEN 5 THEN '2026-09-16' ELSE '2026-09-19' END,
    'priorAcceptanceId','conditioning-initial-'||p_number,
    'modalityId','synthetic-continuous-walking.v1','scheduledLocalDate',p_date,
    'athleteTimezone','UTC','acceptedDurationSeconds',660,
    'effortCue','Synthetic easy to moderate walking effort.','arrangement','separate',
    'progressionIdentity',pg_catalog.jsonb_build_object(
      'progressionSeriesId','conditioning:fixture-series','evidenceEpoch',0),
    'evidenceBoundary',pg_catalog.jsonb_build_object('kind','reset','reason','duration_changed'),
    'comparability',pg_catalog.jsonb_build_object(
      'kind','preserved_series','reason','schedule_or_duration_revision')
  );
$$;

SELECT set_config('request.jwt.claim.sub','64000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"64000000-0000-4000-8000-000000000001","aal":"aal2","iat":2000000000}',true);
SET LOCAL ROLE authenticated;
SELECT is(public.read_training_conditioning_revision_candidate('revision-assignment-1')->>'status',
  'ready','owner reads the server-derived active revision candidate');
SELECT is(pg_catalog.jsonb_array_length(public.read_training_conditioning_revision_candidate(
  'revision-assignment-1')->'sessionStates'),6,'candidate binds every conditioning session state');
SELECT is(public.read_training_conditioning_progression_candidate('revision-bout-2')->>'status',
  'ready','legacy absent epochs remain comparable before a duration revision');
SELECT set_config('request.jwt.claim.sub','64000000-0000-4000-8000-000000000011',true);
SELECT set_config('request.jwt.claims','{"sub":"64000000-0000-4000-8000-000000000011","aal":"aal2","iat":2000000000}',true);
SELECT is(public.read_training_conditioning_revision_candidate('revision-assignment-1'),NULL,
  'another athlete cannot read revision source data');
RESET ROLE;

SET LOCAL ROLE service_role;
WITH program AS (
  SELECT program_hash FROM public.training_program_revisions
  WHERE assignment_id='revision-assignment-1' AND revision_number=1
), revision(value) AS (VALUES (pg_catalog.jsonb_build_object(
  'kind','revision_ready','status','requires_explicit_revision_acceptance',
  'assignmentId','revision-assignment-1','subjectId','64000000-0000-4000-8000-000000000002',
  'baseProgramRevisionNumber',1,'compiledProgramRevisionId','compiled-conditioning-1',
  'compilerPolicyVersion','strength-cycle-compiler.v3','catalogVersion','synthetic-starter-catalog.v1',
  'executionContext',pg_temp.conditioning_program(1)->'executionContext',
  'preservedBoutIds',pg_catalog.jsonb_build_array('revision-bout-1','revision-bout-2'),
  'replacements',pg_catalog.jsonb_build_array(
    pg_temp.revision_replacement(3,'2026-09-09'),pg_temp.revision_replacement(4,'2026-09-13'),
    pg_temp.revision_replacement(5,'2026-09-16'),pg_temp.revision_replacement(6,'2026-09-19')),
  'frequencyChange','unchanged','intensityChange','not_automated',
  'strengthPriority','strength_first_when_paired'
)))
INSERT INTO public.training_conditioning_revision_proposals(
  id,proposal_key,created_by_user_id,subject_id,assignment_id,
  base_program_revision_number,base_assignment_revision,source_profile_revision,
  source_eligibility_revision_id,source_program_hash,execution_context,
  selection_json,revision_json,target_revisions,created_at,expires_at
) SELECT '64000000-0000-4000-8000-000000000020',repeat('2',64),
  '64000000-0000-4000-8000-000000000001','64000000-0000-4000-8000-000000000002',
  'revision-assignment-1',1,1,1,'simulation:64000000-0000-4000-8000-000000000003',
  program.program_hash,pg_temp.conditioning_program(1)->'executionContext',
  pg_catalog.jsonb_build_object('replacementModalityId','synthetic-continuous-walking.v1',
    'futureBouts',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('sourceBoutId','revision-bout-3','scheduledLocalDate','2026-09-09','acceptedDurationSeconds',660,'arrangement','separate'),
      pg_catalog.jsonb_build_object('sourceBoutId','revision-bout-4','scheduledLocalDate','2026-09-13','acceptedDurationSeconds',660,'arrangement','separate'),
      pg_catalog.jsonb_build_object('sourceBoutId','revision-bout-5','scheduledLocalDate','2026-09-16','acceptedDurationSeconds',660,'arrangement','separate'),
      pg_catalog.jsonb_build_object('sourceBoutId','revision-bout-6','scheduledLocalDate','2026-09-19','acceptedDurationSeconds',660,'arrangement','separate'))),
  revision.value,pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('sessionId','revision-bout-3','sessionRevision',1,'scheduledLocalDate','2026-09-09'),
    pg_catalog.jsonb_build_object('sessionId','revision-bout-4','sessionRevision',1,'scheduledLocalDate','2026-09-12'),
    pg_catalog.jsonb_build_object('sessionId','revision-bout-5','sessionRevision',1,'scheduledLocalDate','2026-09-16'),
    pg_catalog.jsonb_build_object('sessionId','revision-bout-6','sessionRevision',1,'scheduledLocalDate','2026-09-19')),
  now(),now()+interval '1 hour'
FROM program,revision;
INSERT INTO public.training_conditioning_revision_proposals(
  id,proposal_key,created_by_user_id,subject_id,assignment_id,
  base_program_revision_number,base_assignment_revision,source_profile_revision,
  source_eligibility_revision_id,source_program_hash,execution_context,
  selection_json,revision_json,target_revisions,created_at,expires_at
) SELECT '64000000-0000-4000-8000-000000000060',repeat('6',64),
  created_by_user_id,subject_id,assignment_id,base_program_revision_number,
  base_assignment_revision,source_profile_revision,source_eligibility_revision_id,
  source_program_hash,execution_context,
  pg_catalog.jsonb_set(selection_json,'{futureBouts,0,scheduledLocalDate}',
    pg_catalog.to_jsonb((CURRENT_DATE-1)::text)),
  pg_catalog.jsonb_set(revision_json,'{replacements,0,scheduledLocalDate}',
    pg_catalog.to_jsonb((CURRENT_DATE-1)::text)),
  target_revisions,now(),now()+interval '1 hour'
FROM public.training_conditioning_revision_proposals
WHERE id='64000000-0000-4000-8000-000000000020';
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','64000000-0000-4000-8000-000000000011',true);
SELECT set_config('request.jwt.claims','{"sub":"64000000-0000-4000-8000-000000000011","aal":"aal2","iat":2000000000}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.accept_training_conditioning_revision_proposal(
  '64000000-0000-4000-8000-000000000020','64000000-0000-4000-8000-000000000021')$$,
  '42501','conditioning revision not authorized','cross-owner acceptance is denied');

SELECT set_config('request.jwt.claim.sub','64000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"64000000-0000-4000-8000-000000000001","aal":"aal2","iat":2000000000}',true);
SELECT throws_ok($$SELECT public.accept_training_conditioning_revision_proposal(
  '64000000-0000-4000-8000-000000000060','64000000-0000-4000-8000-000000000061')$$,
  'PT409','conditioning revision target changed',
  'acceptance rejects a replacement date that is past in the program timezone');
SELECT is(public.accept_training_conditioning_revision_proposal(
  '64000000-0000-4000-8000-000000000020','64000000-0000-4000-8000-000000000022')#>>'{programRevisionNumber}',
  '2','owner acceptance appends one immutable program revision');
SELECT is((SELECT active_revision::text FROM public.training_program_assignments
  WHERE id='revision-assignment-1'),'2','acceptance advances the active revision once');
SELECT is((SELECT program_json#>>'{conditioningBouts,2,progressionIdentity,evidenceEpoch}'
  FROM public.training_program_revisions WHERE assignment_id='revision-assignment-1' AND revision_number=2),
  '0','duration revision persists the new evidence epoch');
SELECT is((SELECT (program_json#>>'{conditioningBouts,3,acceptedDurationSeconds}')||':'||
  (program_json#>>'{conditioningBouts,3,scheduledLocalDate}')
  FROM public.training_program_revisions WHERE assignment_id='revision-assignment-1' AND revision_number=2),
  '660:2026-09-13','accepted duration and explicit local reschedule persist together');
SELECT is(public.read_training_conditioning_progression_candidate('revision-bout-2')->>'status',
  'insufficient_history','pre-revision completions cannot progress a reset evidence epoch');
RESET ROLE;

SET LOCAL session_replication_role = replica;
UPDATE public.training_sessions SET state='completed',revision=3,completed_at=now()
WHERE id IN ('revision-bout-3','revision-bout-4');
INSERT INTO public.training_session_prescriptions(
  session_id,subject_id,assignment_id,program_revision_number,prescription_json,started_by_user_id
) SELECT session.id,'64000000-0000-4000-8000-000000000002','revision-assignment-1',2,
  pg_catalog.jsonb_build_object(
    'schemaVersion','training-conditioning-session-prescription.v1','sessionId',session.id,
    'assignmentId','revision-assignment-1','programRevisionNumber',2,
    'subjectId','64000000-0000-4000-8000-000000000002',
    'executionContext',program.program_json->'executionContext','catalogOrigin',program.program_json->'catalogOrigin',
    'compiledProgramRevisionId','compiled-conditioning-1','acceptedBout',bout.value),
  '64000000-0000-4000-8000-000000000001'
FROM public.training_sessions session
CROSS JOIN public.training_program_revisions program
JOIN LATERAL pg_catalog.jsonb_array_elements(program.program_json->'conditioningBouts') bout(value)
  ON bout.value->>'boutId'=session.id
WHERE program.assignment_id='revision-assignment-1' AND program.revision_number=2
  AND session.id IN ('revision-bout-3','revision-bout-4');
INSERT INTO public.training_conditioning_log_events(
  id,subject_id,session_id,event_revision,replaces_event_id,actor_user_id,event_json
) SELECT ('64000000-0000-4000-8000-0000000000'||(30+number))::uuid,
  '64000000-0000-4000-8000-000000000002','revision-bout-'||number,1,NULL,
  '64000000-0000-4000-8000-000000000001',pg_catalog.jsonb_build_object(
    'schemaVersion','training-conditioning-log-event.v1','eventId','64000000-0000-4000-8000-0000000000'||(30+number),
    'eventType','conditioning_actual_recorded','eventRevision',1,'replacesEventId',NULL,
    'subjectId','64000000-0000-4000-8000-000000000002','sessionId','revision-bout-'||number,
    'boutId','revision-bout-'||number,'modalityId','synthetic-continuous-walking.v1',
    'executionContext',pg_temp.conditioning_program(1)->'executionContext',
    'durationSeconds',660,'perceivedEffort',4,'symptomState','none',
    'actor',pg_catalog.jsonb_build_object('kind','athlete','userId','64000000-0000-4000-8000-000000000001'),
    'occurredAt','2026-09-13T18:00:00.000Z','serverAt','2026-09-13T18:00:00.000Z')
FROM generate_series(3,4) number;
SET LOCAL session_replication_role = origin;

SET LOCAL ROLE authenticated;
SELECT is(public.read_training_conditioning_progression_candidate('revision-bout-4')->>'status',
  'ready','two post-reset completions can drive later targets in the same epoch');
SELECT is(public.accept_training_conditioning_revision_proposal(
  '64000000-0000-4000-8000-000000000020','64000000-0000-4000-8000-000000000022')#>>'{programRevisionNumber}',
  '2','exact retry returns its receipt before rechecking now-completed targets');
RESET ROLE;

SET LOCAL session_replication_role = replica;
INSERT INTO public.coaching_relationships(
  id,subject_id,practitioner_id,status,permissions,started_at,revision
) VALUES (
  '64000000-0000-4000-8000-000000000062',
  '64000000-0000-4000-8000-000000000002',
  '64000000-0000-4000-8000-000000000001','active',
  ARRAY['program:coach_publish']::public.training_coach_permission[],now(),1
);
UPDATE public.training_program_assignments SET
  program_mode='coach_assigned',owning_practitioner_id='64000000-0000-4000-8000-000000000001',
  simulation_run_id=NULL
WHERE id='revision-assignment-1';
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE authenticated;
SELECT is(public.accept_training_conditioning_revision_proposal(
  '64000000-0000-4000-8000-000000000020','64000000-0000-4000-8000-000000000022')#>>'{programRevisionNumber}',
  '2','an owning coach with current publish authority can replay the exact receipt');
RESET ROLE;
SET LOCAL session_replication_role = replica;
UPDATE public.coaching_relationships SET status='revoked',ended_at=now(),revision=2
WHERE id='64000000-0000-4000-8000-000000000062';
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.accept_training_conditioning_revision_proposal(
  '64000000-0000-4000-8000-000000000020','64000000-0000-4000-8000-000000000022')$$,
  '42501','conditioning revision not authorized',
  'a revoked coach cannot replay an earlier exact receipt');
RESET ROLE;
SET LOCAL session_replication_role = replica;
UPDATE public.training_program_assignments SET
  program_mode='self_directed',owning_practitioner_id=NULL,
  simulation_run_id='64000000-0000-4000-8000-000000000003'
WHERE id='revision-assignment-1';
SET LOCAL session_replication_role = origin;

SET LOCAL ROLE service_role;
INSERT INTO public.training_conditioning_revision_proposals(
  id,proposal_key,created_by_user_id,subject_id,assignment_id,
  base_program_revision_number,base_assignment_revision,source_profile_revision,
  source_eligibility_revision_id,source_program_hash,execution_context,
  selection_json,revision_json,target_revisions,created_at,expires_at
) SELECT '64000000-0000-4000-8000-000000000040',repeat('4',64),
  '64000000-0000-4000-8000-000000000001','64000000-0000-4000-8000-000000000002',
  'revision-assignment-1',2,2,1,'simulation:64000000-0000-4000-8000-000000000003',
  program_hash,program_json->'executionContext',
  pg_catalog.jsonb_build_object('replacementModalityId','synthetic-continuous-walking.v1',
    'futureBouts',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('sourceBoutId','revision-bout-5','scheduledLocalDate','2026-09-16','acceptedDurationSeconds',660,'arrangement','separate'),
      pg_catalog.jsonb_build_object('sourceBoutId','revision-bout-6','scheduledLocalDate','2026-09-19','acceptedDurationSeconds',660,'arrangement','separate'))),
  pg_catalog.jsonb_build_object(
    'kind','revision_ready','status','requires_explicit_revision_acceptance',
    'assignmentId','revision-assignment-1','subjectId','64000000-0000-4000-8000-000000000002',
    'baseProgramRevisionNumber',2,'compiledProgramRevisionId','compiled-conditioning-1',
    'compilerPolicyVersion','strength-cycle-compiler.v3','catalogVersion','synthetic-starter-catalog.v1',
    'executionContext',program_json->'executionContext','preservedBoutIds',pg_catalog.jsonb_build_array(
      'revision-bout-1','revision-bout-2','revision-bout-3','revision-bout-4'),
    'replacements',pg_catalog.jsonb_build_array(
      pg_temp.revision_replacement(5,'2026-09-16'),pg_temp.revision_replacement(6,'2026-09-19')),
    'frequencyChange','unchanged','intensityChange','not_automated','strengthPriority','strength_first_when_paired'),
  pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('sessionId','revision-bout-5','sessionRevision',2,'scheduledLocalDate','2026-09-16'),
    pg_catalog.jsonb_build_object('sessionId','revision-bout-6','sessionRevision',2,'scheduledLocalDate','2026-09-19')),
  now(),now()+interval '1 hour'
FROM public.training_program_revisions WHERE assignment_id='revision-assignment-1' AND revision_number=2;
RESET ROLE;

SET LOCAL session_replication_role = replica;
INSERT INTO public.training_session_prescriptions(
  session_id,subject_id,assignment_id,program_revision_number,prescription_json,started_by_user_id
) SELECT 'revision-bout-5','64000000-0000-4000-8000-000000000002','revision-assignment-1',2,
  pg_catalog.jsonb_build_object(
    'schemaVersion','training-conditioning-session-prescription.v1','sessionId','revision-bout-5',
    'assignmentId','revision-assignment-1','programRevisionNumber',2,
    'subjectId','64000000-0000-4000-8000-000000000002',
    'executionContext',program_json->'executionContext','catalogOrigin',program_json->'catalogOrigin',
    'compiledProgramRevisionId','compiled-conditioning-1','acceptedBout',bout.value),
  '64000000-0000-4000-8000-000000000001'
FROM public.training_program_revisions program
JOIN LATERAL pg_catalog.jsonb_array_elements(program.program_json->'conditioningBouts') bout(value)
  ON bout.value->>'boutId'='revision-bout-5'
WHERE program.assignment_id='revision-assignment-1' AND program.revision_number=2;
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.accept_training_conditioning_revision_proposal(
  '64000000-0000-4000-8000-000000000040','64000000-0000-4000-8000-000000000041')$$,
  'PT409','conditioning revision target changed','a newly prescribed target cannot be revised');

SELECT is(public.erase_training_subject_transactional('64000000-0000-4000-8000-000000000050')#>>'{status}',
  'erased','owner erasure remains transactional with revision evidence present');
RESET ROLE;
SELECT is((SELECT count(*)::text FROM public.training_conditioning_revision_proposals
  WHERE subject_id='64000000-0000-4000-8000-000000000002'),'0','erasure removes revision proposals');
SELECT is((SELECT count(*)::text FROM public.training_conditioning_revision_acceptances
  WHERE assignment_id='revision-assignment-1'),'0','erasure removes revision receipts before assignments');

SELECT * FROM finish();
ROLLBACK;
