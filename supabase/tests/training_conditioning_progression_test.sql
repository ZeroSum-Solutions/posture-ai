BEGIN;
SELECT plan(25);

SELECT has_table('public', 'training_conditioning_progression_proposals',
  'conditioning proposals have immutable storage');
SELECT has_table('public', 'training_conditioning_progression_acceptances',
  'explicit conditioning acceptances have durable storage');
SELECT ok(NOT has_table_privilege('authenticated',
  'public.training_conditioning_progression_proposals', 'INSERT'),
  'browser cannot persist a forged conditioning proposal');
SELECT ok(NOT has_table_privilege('service_role',
  'public.training_conditioning_progression_acceptances', 'INSERT'),
  'service role cannot impersonate an acceptance');
SELECT ok(NOT has_function_privilege('service_role',
  'public.accept_training_conditioning_progression_proposal(uuid,uuid)', 'EXECUTE'),
  'service role cannot call the authenticated acceptance RPC');
SELECT ok(
  has_function_privilege('authenticated',
    'private.assert_readable_training_program_eligibility(text)', 'EXECUTE')
  AND NOT has_function_privilege('anon',
    'private.assert_readable_training_program_eligibility(text)', 'EXECUTE')
  AND NOT has_function_privilege('service_role',
    'private.assert_readable_training_program_eligibility(text)', 'EXECUTE'),
  'only authenticated readers may invoke the assignment-scoped eligibility guard'
);
SELECT ok(
  NOT has_function_privilege('authenticated',
    'private.assert_training_program_eligibility(uuid,jsonb,uuid,boolean)', 'EXECUTE')
  AND NOT has_function_privilege('anon',
    'private.assert_training_program_eligibility(uuid,jsonb,uuid,boolean)', 'EXECUTE')
  AND NOT has_function_privilege('service_role',
    'private.assert_training_program_eligibility(uuid,jsonb,uuid,boolean)', 'EXECUTE'),
  'the arbitrary-input eligibility helper remains private'
);

SELECT ok(
  (SELECT provolatile = 'v'
   FROM pg_proc
   WHERE oid = 'public.read_training_conditioning_progression_candidate(text)'::regprocedure),
  'candidate reader remains volatile because its eligibility guard takes row locks'
);

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id,email,created_at,updated_at) VALUES
  ('56000000-0000-4000-8000-000000000001','conditioning-athlete@example.invalid',now(),now()),
  ('56000000-0000-4000-8000-000000000011','unrelated-conditioning-athlete@example.invalid',now(),now());
INSERT INTO public.training_subjects(
  id,owner_user_id,status,activated_at,current_profile_revision
) VALUES (
  '56000000-0000-4000-8000-000000000002',
  '56000000-0000-4000-8000-000000000001','active',now(),1
);
WITH profile(value) AS (VALUES (
  '{"schemaVersion":"athlete-training-profile.v1","origin":{"kind":"synthetic_fixture","fixtureId":"practice-strength-profile.v1","label":"Synthetic practice profile"},"goal":"strength","experience":"beginner","recentConsistency":"consistent","cycleLengthWeeks":8,"strengthDays":["monday","thursday"],"localTimezone":"UTC","sessionTimeBudgetMinutes":30,"preferredLoadUnit":"kg","equipmentInventory":[{"kind":"machine","equipmentId":"machine-1","unit":"kg","stackLoads":["50","52"]}],"startingHistory":[]}'::jsonb
)) INSERT INTO public.training_profile_revisions(
  subject_id,revision,schema_version,profile_json,profile_hash,hash_encoding,
  created_by_user_id,created_at
) SELECT '56000000-0000-4000-8000-000000000002',1,'athlete-training-profile.v1',
  value,private.training_evidence_sha256(value),'postgres-jsonb-text-utf8.v1',
  '56000000-0000-4000-8000-000000000001',now() FROM profile;
INSERT INTO public.training_simulation_runs(
  id,subject_id,created_by_user_id,fixture_id,fixture_hash,expires_at
) VALUES (
  '56000000-0000-4000-8000-000000000003',
  '56000000-0000-4000-8000-000000000002',
  '56000000-0000-4000-8000-000000000001','synthetic-starter-catalog.v1',
  'ea848ced42813786b527296c351dc51ba2a8072a6c85ac5d2f744547de730717',now()+interval '1 hour'
);

CREATE FUNCTION pg_temp.conditioning_bout(p_number integer, p_date text)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT pg_catalog.jsonb_build_object(
    'status','accepted','acceptanceId','conditioning-initial-' || p_number,
    'acceptedAt','2026-09-08T00:00:00.000Z',
    'acceptedByUserId','56000000-0000-4000-8000-000000000001',
    'executionContext',pg_catalog.jsonb_build_object(
      'kind','synthetic_simulation',
      'simulationRunId','56000000-0000-4000-8000-000000000003',
      'fixtureId','synthetic-starter-catalog.v1',
      'fixtureHash','ea848ced42813786b527296c351dc51ba2a8072a6c85ac5d2f744547de730717',
      'label','Practice data'
    ),
    'boutId','conditioning-bout-' || p_number,
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
    'schemaVersion','training-program-revision.v1','assignmentId','conditioning-assignment-1',
    'revisionNumber',p_revision,'subjectId','56000000-0000-4000-8000-000000000002',
    'programMode','self_directed','owningPractitionerId',NULL,
    'executionContext',pg_catalog.jsonb_build_object(
      'kind','synthetic_simulation',
      'simulationRunId','56000000-0000-4000-8000-000000000003',
      'fixtureId','synthetic-starter-catalog.v1',
      'fixtureHash','ea848ced42813786b527296c351dc51ba2a8072a6c85ac5d2f744547de730717',
      'label','Practice data'
    ),
    'cycleStartLocalDate','2026-09-01','cycleLengthWeeks',8,
    'profileRevisionId','1',
    'eligibilitySourceRevisionId','simulation:56000000-0000-4000-8000-000000000003',
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
      'kind','athlete','userId','56000000-0000-4000-8000-000000000001'
    ),
    'sessions',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('sessionId','placeholder-strength-session',
        'scheduledLocalDate','2026-09-01','athleteTimezone','UTC','exercises','[]'::jsonb)
    ),
    'conditioningBouts',pg_catalog.jsonb_build_array(
      pg_temp.conditioning_bout(1,'2026-09-01'),pg_temp.conditioning_bout(2,'2026-09-04'),
      pg_temp.conditioning_bout(3,'2026-09-08'),pg_temp.conditioning_bout(4,'2026-09-11')
    )
  );
$$;

INSERT INTO public.training_program_drafts(
  id,subject_id,created_by_user_id,profile_revision,simulation_run_id,
  source_build_id,selection_hash,program_json,expires_at
) VALUES (
  '56000000-0000-4000-8000-000000000004',
  '56000000-0000-4000-8000-000000000002',
  '56000000-0000-4000-8000-000000000001',1,
  '56000000-0000-4000-8000-000000000003',NULL,NULL,
  pg_temp.conditioning_program(1),now()+interval '1 hour'
);
INSERT INTO public.training_program_assignments(
  id,subject_id,program_mode,owning_practitioner_id,simulation_run_id,
  source_draft_id,status,active_revision,revision
) VALUES (
  'conditioning-assignment-1','56000000-0000-4000-8000-000000000002',
  'self_directed',NULL,'56000000-0000-4000-8000-000000000003',
  '56000000-0000-4000-8000-000000000004','active',1,1
);
INSERT INTO public.training_program_revisions(
  assignment_id,subject_id,revision_number,program_json,created_by_user_id
) VALUES (
  'conditioning-assignment-1','56000000-0000-4000-8000-000000000002',1,
  pg_temp.conditioning_program(1),'56000000-0000-4000-8000-000000000001'
);
INSERT INTO public.training_sessions(
  id,assignment_id,subject_id,session_kind,state,scheduled_local_date,
  athlete_timezone,revision,completed_at
) VALUES
  ('conditioning-bout-1','conditioning-assignment-1','56000000-0000-4000-8000-000000000002','conditioning','completed','2026-09-01','UTC',3,'2026-09-01T18:00:00Z'),
  ('conditioning-bout-2','conditioning-assignment-1','56000000-0000-4000-8000-000000000002','conditioning','completed','2026-09-04','UTC',3,'2026-09-04T18:00:00Z'),
  ('conditioning-bout-3','conditioning-assignment-1','56000000-0000-4000-8000-000000000002','conditioning','scheduled','2026-09-08','UTC',1,NULL),
  ('conditioning-bout-4','conditioning-assignment-1','56000000-0000-4000-8000-000000000002','conditioning','scheduled','2026-09-11','UTC',1,NULL);

INSERT INTO public.training_session_prescriptions(
  session_id,subject_id,assignment_id,program_revision_number,prescription_json,started_by_user_id
) SELECT 'conditioning-bout-' || number,
  '56000000-0000-4000-8000-000000000002','conditioning-assignment-1',1,
  pg_catalog.jsonb_build_object(
    'schemaVersion','training-conditioning-session-prescription.v1',
    'sessionId','conditioning-bout-' || number,
    'assignmentId','conditioning-assignment-1','programRevisionNumber',1,
    'subjectId','56000000-0000-4000-8000-000000000002',
    'executionContext',pg_temp.conditioning_program(1)->'executionContext',
    'catalogOrigin',pg_temp.conditioning_program(1)->'catalogOrigin',
    'compiledProgramRevisionId','compiled-conditioning-1',
    'acceptedBout',pg_temp.conditioning_bout(number,
      CASE number WHEN 1 THEN '2026-09-01' ELSE '2026-09-04' END)
  ),'56000000-0000-4000-8000-000000000001'
FROM generate_series(1,2) number;

INSERT INTO public.training_conditioning_log_events(
  id,subject_id,session_id,event_revision,replaces_event_id,actor_user_id,event_json
) SELECT ('56000000-0000-4000-8000-00000000000' || (4 + number))::uuid,
  '56000000-0000-4000-8000-000000000002','conditioning-bout-' || number,1,NULL,
  '56000000-0000-4000-8000-000000000001',pg_catalog.jsonb_build_object(
    'schemaVersion','training-conditioning-log-event.v1',
    'eventId','56000000-0000-4000-8000-00000000000' || (4 + number),
    'eventType','conditioning_actual_recorded','eventRevision',1,'replacesEventId',NULL,
    'subjectId','56000000-0000-4000-8000-000000000002',
    'sessionId','conditioning-bout-' || number,'boutId','conditioning-bout-' || number,
    'modalityId','synthetic-continuous-walking.v1',
    'executionContext',pg_temp.conditioning_program(1)->'executionContext',
    'durationSeconds',600,'perceivedEffort',4,'symptomState','none',
    'actor',pg_catalog.jsonb_build_object(
      'kind','athlete','userId','56000000-0000-4000-8000-000000000001'
    ),'occurredAt','2026-09-04T18:00:00.000Z','serverAt','2026-09-04T18:00:00.000Z'
  ) FROM generate_series(1,2) number;
SET LOCAL session_replication_role = origin;

SELECT set_config('request.jwt.claim.sub','56000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"56000000-0000-4000-8000-000000000001","aal":"aal2","iat":2000000000}',true);
SET LOCAL ROLE authenticated;
SELECT is(
  public.read_training_conditioning_progression_candidate('conditioning-bout-1'),
  '{"status": "insufficient_history", "schemaVersion": "conditioning-progression-candidate.v1"}'::jsonb,
  'a first completed bout returns an explicit insufficient-history outcome'
);
SELECT is(
  public.read_training_conditioning_progression_candidate('conditioning-bout-2')->>'status',
  'ready','a complete comparable history returns an explicit ready outcome'
);
SELECT is(
  public.read_training_conditioning_progression_candidate('conditioning-bout-2')#>>'{sourceBouts,0,actual,durationSeconds}',
  '600','candidate projects the exact first completed duration'
);
SELECT is(
  public.read_training_conditioning_progression_candidate('conditioning-bout-2')#>>'{targetBouts,1,boutId}',
  'conditioning-bout-4','candidate binds both next scheduled bouts'
);
SELECT is(
  public.read_training_conditioning_progression_candidate('conditioning-bout-2')->>'plannedWeeklyDurationSeconds',
  '1200','candidate derives the target week planned duration'
);
SELECT set_config('request.jwt.claim.sub','56000000-0000-4000-8000-000000000011',true);
SELECT set_config('request.jwt.claims','{"sub":"56000000-0000-4000-8000-000000000011","aal":"aal2","iat":2000000000}',true);
SELECT throws_ok(
  $$SELECT private.assert_readable_training_program_eligibility('conditioning-assignment-1')$$,
  '42501','training assignment is unavailable',
  'the narrow guard cannot be used to inspect another subject assignment'
);
SELECT set_config('request.jwt.claim.sub','56000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"56000000-0000-4000-8000-000000000001","aal":"aal1","iat":2000000000}',true);
SELECT throws_ok(
  $$SELECT public.accept_training_conditioning_progression_proposal(
    '56000000-0000-4000-8000-000000000007','56000000-0000-4000-8000-000000000008')$$,
  '42501','AAL2 conditioning progression acceptance required',
  'AAL1 cannot accept a conditioning progression proposal'
);
RESET ROLE;

SET LOCAL ROLE service_role;
WITH program AS (
  SELECT program_hash FROM public.training_program_revisions
  WHERE assignment_id='conditioning-assignment-1' AND revision_number=1
), policy(value) AS (VALUES (pg_catalog.jsonb_build_object(
  'schemaVersion','conditioning-progression-policy.v1','policyVersion','conditioning-duration-v1',
  'origin',pg_catalog.jsonb_build_object(
    'kind','synthetic_fixture','sourceVersion','conditioning-duration-policy-fixture.v1',
    'fixtureId','synthetic-conditioning-duration-policy.v1',
    'fixtureHash','bf2e3b7c8705bd50372ebad1f9ec58b2ff3456d5ba22056965311e29008f5e1f',
    'label','Synthetic conditioning duration policy for Practice data'),
  'modalityId','synthetic-continuous-walking.v1','targetEffortMaximum',4,
  'maxIncreasePerBoutSeconds',120,'maxTotalWeeklyIncreaseSeconds',240,
  'maxBoutDurationSeconds',1800,'maxPlannedWeeklyDurationSeconds',3600
))), decision(value) AS (SELECT pg_catalog.jsonb_build_object(
  'kind','duration_proposal','status','proposed','reason','two_comparable_bouts_completed',
  'policyVersion','conditioning-duration-v1','policyOrigin',policy.value->'origin',
  'decisionKey','conditioning-duration-v1:sha256:' || repeat('7',64),
  'subjectId','56000000-0000-4000-8000-000000000002',
  'assignmentId','conditioning-assignment-1','baseProgramRevisionNumber',1,
  'sourceProfileRevision',1,
  'sourceEligibilityRevisionId','simulation:56000000-0000-4000-8000-000000000003',
  'executionContext',pg_temp.conditioning_program(1)->'executionContext',
  'modalityId','synthetic-continuous-walking.v1','targetEffortMaximum',4,
  'sourceSessionRevisions',pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('sessionId','conditioning-bout-1','sessionRevision',3,'conditioningEventRevision',1),
    pg_catalog.jsonb_build_object('sessionId','conditioning-bout-2','sessionRevision',3,'conditioningEventRevision',1)),
  'increaseSecondsPerBout',60,'targetBouts',pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('sessionId','conditioning-bout-3','sessionRevision',1,'boutId','conditioning-bout-3','acceptedDurationSeconds',660),
    pg_catalog.jsonb_build_object('sessionId','conditioning-bout-4','sessionRevision',1,'boutId','conditioning-bout-4','acceptedDurationSeconds',660))
) FROM policy)
INSERT INTO public.training_conditioning_progression_proposals(
  id,proposal_key,created_by_user_id,subject_id,assignment_id,
  base_program_revision_number,base_assignment_revision,source_profile_revision,
  source_eligibility_revision_id,source_program_hash,execution_context,policy_json,
  source_session_revisions,mutable_target_revisions,decision_json
) SELECT id, key, '56000000-0000-4000-8000-000000000001',
  '56000000-0000-4000-8000-000000000002','conditioning-assignment-1',1,1,1,
  'simulation:56000000-0000-4000-8000-000000000003',program_hash,
  pg_temp.conditioning_program(1)->'executionContext',policy.value,
  decision.value->'sourceSessionRevisions',pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('sessionId','conditioning-bout-3','sessionRevision',1,'boutId','conditioning-bout-3','scheduledLocalDate','2026-09-08','acceptedDurationSeconds',600),
    pg_catalog.jsonb_build_object('sessionId','conditioning-bout-4','sessionRevision',1,'boutId','conditioning-bout-4','scheduledLocalDate','2026-09-11','acceptedDurationSeconds',600)),
  decision.value
FROM program, policy, decision, (VALUES
  ('56000000-0000-4000-8000-000000000007'::uuid,repeat('7',64)),
  ('56000000-0000-4000-8000-000000000009'::uuid,repeat('9',64))
) proposals(id,key);
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"56000000-0000-4000-8000-000000000001","aal":"aal2","iat":2000000000}',true);
SET LOCAL ROLE authenticated;
SELECT is(
  public.accept_training_conditioning_progression_proposal(
    '56000000-0000-4000-8000-000000000007','56000000-0000-4000-8000-000000000008'
  )#>>'{programRevisionNumber}',
  '2','explicit acceptance appends one program revision'
);
SELECT is(
  public.accept_training_conditioning_progression_proposal(
    '56000000-0000-4000-8000-000000000007','56000000-0000-4000-8000-000000000008'
  )#>>'{programRevisionNumber}',
  '2','exact request retry returns the original acceptance'
);
SELECT is((SELECT active_revision::text FROM public.training_program_assignments
  WHERE id='conditioning-assignment-1'),'2','acceptance advances the assignment revision once');
SELECT is((SELECT program_json#>>'{conditioningBouts,2,acceptedDurationSeconds}'
  FROM public.training_program_revisions WHERE assignment_id='conditioning-assignment-1' AND revision_number=2),
  '660','accepted duration updates the first future bout');
SELECT is((SELECT program_json#>>'{conditioningBouts,3,acceptedDurationSeconds}'
  FROM public.training_program_revisions WHERE assignment_id='conditioning-assignment-1' AND revision_number=2),
  '660','accepted duration updates the second future bout');
SELECT is((SELECT result_json#>>'{policyOrigin,fixtureHash}'
  FROM public.training_conditioning_progression_acceptances
  WHERE proposal_id='56000000-0000-4000-8000-000000000007'),
  'bf2e3b7c8705bd50372ebad1f9ec58b2ff3456d5ba22056965311e29008f5e1f',
  'acceptance preserves exact trusted policy provenance');
SELECT is(public.read_training_conditioning_progression_candidate('conditioning-bout-2'),NULL,
  'accepted source exposures cannot generate another proposal');
SELECT throws_ok(
  $$SELECT public.accept_training_conditioning_progression_proposal(
    '56000000-0000-4000-8000-000000000009','56000000-0000-4000-8000-000000000010')$$,
  'PT409','conditioning progression source changed',
  'stale assignment and program revisions cannot be accepted'
);

RESET ROLE;
SET LOCAL session_replication_role = replica;
UPDATE public.training_sessions SET state='aborted'
WHERE id IN ('conditioning-bout-3','conditioning-bout-4');
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE authenticated;
SELECT is(
  public.read_training_conditioning_progression_candidate('conditioning-bout-2'),
  '{"status": "no_pending_targets", "schemaVersion": "conditioning-progression-candidate.v1"}'::jsonb,
  'an end-of-cycle source returns an explicit no-pending-targets outcome'
);

SELECT is(
  public.read_training_conditioning_progression_candidate('conditioning-bout-4'),
  '{"status": "no_pending_targets", "schemaVersion": "conditioning-progression-candidate.v1"}'::jsonb,
  'end-of-cycle with earlier unstarted bouts does not require nonexistent source prescriptions'
);

SELECT * FROM finish();
ROLLBACK;
