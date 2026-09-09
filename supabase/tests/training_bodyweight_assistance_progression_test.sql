BEGIN;
SELECT no_plan();

SELECT has_function(
  'private','is_valid_training_progression_decision',
  ARRAY['jsonb','uuid','bigint','text','jsonb'],
  'proposal storage has a versioned decision validator'
);
SELECT has_trigger(
  'public','training_progression_acceptances',
  'training_progression_acceptance_bodyweight_assistance',
  'dedicated acceptance rechecks the latest bound exposure'
);

CREATE FUNCTION pg_temp.bwa_context(p_run uuid)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT pg_catalog.jsonb_build_object(
    'kind','synthetic_simulation','simulationRunId',p_run,
    'fixtureId','bodyweight-progression-db-test.v1',
    'fixtureHash',pg_catalog.repeat('8',64),'label','Practice data'
  );
$$;

CREATE FUNCTION pg_temp.bwa_profile()
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT '{
    "schemaVersion":"athlete-training-profile.v1",
    "origin":{"kind":"synthetic_fixture","fixtureId":"bodyweight-progression-db-test.v1","label":"Synthetic bodyweight progression database test"},
    "goal":"strength","experience":"beginner","recentConsistency":"consistent",
    "cycleLengthWeeks":8,"strengthDays":["monday","thursday"],
    "localTimezone":"UTC","sessionTimeBudgetMinutes":45,"preferredLoadUnit":"kg",
    "equipmentInventory":[{"kind":"bodyweight_external","equipmentId":"bodyweight-station","unit":"kg","externalLoads":["0","5"]}],
    "startingHistory":[]
  }'::jsonb;
$$;

CREATE FUNCTION pg_temp.bwa_load(p_run uuid,p_actor uuid,p_instance text)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT pg_catalog.jsonb_build_object(
    'status','accepted','acceptanceId','accepted:' || p_instance,
    'acceptedAt','2026-09-09T12:00:00Z','acceptedByUserId',p_actor,
    'source','equipment_inventory','executionContext',pg_temp.bwa_context(p_run),
    'exerciseInstanceId',p_instance,'exerciseVersionId','pushup.v1',
    'equipmentId','bodyweight-station','loadBasis','bodyweight_external',
    'implementCount',0,'holdingConfiguration','bodyweight_plus_external_load',
    'bodyweightAssistancePolicy',pg_catalog.jsonb_build_object(
      'policyId','synthetic-bodyweight-rep-only','policyVersion','1'
    ),
    'quantity',pg_catalog.jsonb_build_object(
      'entered',pg_catalog.jsonb_build_object('value','0','unit','kg'),'canonicalKg','0'
    ),
    'provenance',pg_catalog.jsonb_build_object(
      'profileRevisionId','1','compiledProgramRevisionId','compiled-bwa-progression',
      'catalogVersion','bodyweight-progression-db-test.v1',
      'catalogOrigin',pg_catalog.jsonb_build_object(
        'kind','synthetic_fixture','source','server_fixture',
        'fixtureId','bodyweight-progression-db-test.v1',
        'fixtureHash',pg_catalog.repeat('8',64),
        'label','Synthetic bodyweight progression database catalog'
      )
    )
  );
$$;

CREATE FUNCTION pg_temp.bwa_exercise(p_run uuid,p_actor uuid,p_number integer)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT pg_catalog.jsonb_build_object(
    'exerciseInstanceId','bwa-exercise-' || p_number,
    'exerciseVersionId','pushup.v1','movementPattern','horizontal_push',
    'setIds',pg_catalog.jsonb_build_array(
      'bwa-set-' || p_number || '-1','bwa-set-' || p_number || '-2'
    ),
    'targetReps',pg_catalog.jsonb_build_array(6,6),
    'repRange',pg_catalog.jsonb_build_object('minimum',6,'maximum',8),
    'targetRir',pg_catalog.jsonb_build_object('minimum',2,'maximum',3),
    'restSeconds',120,
    'progression',pg_catalog.jsonb_build_object(
      'progressionSeriesId','strength-slot:push','side','bilateral',
      'rom','catalog_default','tempo','controlled','exposureType','standard','loadEpoch',1
    ),
    'acceptedInitialLoad',pg_temp.bwa_load(p_run,p_actor,'bwa-exercise-' || p_number)
  );
$$;

CREATE FUNCTION pg_temp.bwa_program(p_subject uuid,p_actor uuid,p_run uuid,p_revision bigint)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT pg_catalog.jsonb_build_object(
    'schemaVersion','training-program-revision.v1','assignmentId','bwa-assignment',
    'revisionNumber',p_revision,'subjectId',p_subject,'programMode','self_directed',
    'owningPractitionerId',NULL,'executionContext',pg_temp.bwa_context(p_run),
    'cycleStartLocalDate','2026-09-09','cycleLengthWeeks',8,'profileRevisionId','1',
    'eligibilitySourceRevisionId','simulation:bodyweight-progression-db-test',
    'compilerPolicyVersion','strength-cycle-compiler.v3',
    'catalogVersion','bodyweight-progression-db-test.v1',
    'catalogOrigin',pg_catalog.jsonb_build_object(
      'kind','synthetic_fixture','source','server_fixture',
      'fixtureId','bodyweight-progression-db-test.v1',
      'fixtureHash',pg_catalog.repeat('8',64),
      'label','Synthetic bodyweight progression database catalog'
    ),
    'ruleVersion','progression.v1','compiledProgramRevisionId','compiled-bwa-progression',
    'publishedAt','2026-09-09T12:00:00Z',
    'author',pg_catalog.jsonb_build_object('kind','athlete','userId',p_actor),
    'sessions',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'sessionId','bwa-session-1','sessionType','full_body',
        'scheduledLocalDate','2026-09-09','athleteTimezone','UTC',
        'exercises',pg_catalog.jsonb_build_array(pg_temp.bwa_exercise(p_run,p_actor,1))
      ),
      pg_catalog.jsonb_build_object(
        'sessionId','bwa-session-2','sessionType','full_body',
        'scheduledLocalDate','2026-09-11','athleteTimezone','UTC',
        'exercises',pg_catalog.jsonb_build_array(pg_temp.bwa_exercise(p_run,p_actor,2))
      ),
      pg_catalog.jsonb_build_object(
        'sessionId','bwa-session-3','sessionType','full_body',
        'scheduledLocalDate','2026-09-13','athleteTimezone','UTC',
        'exercises',pg_catalog.jsonb_build_array(pg_temp.bwa_exercise(p_run,p_actor,3))
      )
    ),
    'conditioningBouts','[]'::jsonb
  );
$$;

CREATE FUNCTION pg_temp.bwa_decision(p_target_reps jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT pg_catalog.jsonb_build_object(
    'schemaVersion','bodyweight-assistance-progression-decision.v1',
    'kind','rep_proposal','status','proposed','reason','one_rep_progression',
    'loadChange','none','policyId','synthetic-bodyweight-rep-only','policyVersion','1',
    'sourceExposureRevisionId','session-evidence:8888888888888888888888888888888888888888888888888888888888888888',
    'preservedLoad',pg_catalog.jsonb_build_object(
      'loadBasis','bodyweight_external','equipmentId','bodyweight-station',
      'externalLoad',pg_catalog.jsonb_build_object(
        'entered',pg_catalog.jsonb_build_object('value','0','unit','kg'),'canonicalKg','0'
      )
    ),
    'targetReps',p_target_reps
  );
$$;

SELECT ok(private.is_valid_training_progression_decision(
  pg_temp.bwa_decision('[8,6]'::jsonb),
  '68100000-0000-4000-8000-000000000002',1,
  'simulation:bodyweight-progression-db-test',
  pg_temp.bwa_context('68100000-0000-4000-8000-000000000003')
), 'the versioned storage validator accepts the exact dedicated decision envelope');
SELECT ok(NOT private.is_valid_training_progression_decision(
  pg_temp.bwa_decision('[8,6]'::jsonb) || '{"loadChange":"increase"}'::jsonb,
  '68100000-0000-4000-8000-000000000002',1,
  'simulation:bodyweight-progression-db-test',
  pg_temp.bwa_context('68100000-0000-4000-8000-000000000003')
), 'dedicated progression cannot claim a load change');

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id,email,created_at,updated_at) VALUES
  ('68100000-0000-4000-8000-000000000001','bodyweight-progression-owner@example.invalid',now(),now());
INSERT INTO public.training_subjects(
  id,owner_user_id,status,activated_at,current_profile_revision
) VALUES (
  '68100000-0000-4000-8000-000000000002',
  '68100000-0000-4000-8000-000000000001','active',now(),1
);
INSERT INTO public.training_profile_revisions(
  subject_id,revision,schema_version,profile_json,profile_hash,created_by_user_id
) VALUES (
  '68100000-0000-4000-8000-000000000002',1,'athlete-training-profile.v1',
  pg_temp.bwa_profile(),private.training_evidence_sha256(pg_temp.bwa_profile()),
  '68100000-0000-4000-8000-000000000001'
);
INSERT INTO public.training_simulation_runs(
  id,subject_id,created_by_user_id,fixture_id,fixture_hash,status,expires_at
) VALUES (
  '68100000-0000-4000-8000-000000000003',
  '68100000-0000-4000-8000-000000000002',
  '68100000-0000-4000-8000-000000000001',
  'bodyweight-progression-db-test.v1',repeat('8',64),'active',now()+interval '1 hour'
);
INSERT INTO public.training_program_drafts(
  id,subject_id,created_by_user_id,profile_revision,simulation_run_id,program_json,expires_at
) VALUES (
  '68100000-0000-4000-8000-000000000004',
  '68100000-0000-4000-8000-000000000002',
  '68100000-0000-4000-8000-000000000001',1,
  '68100000-0000-4000-8000-000000000003',
  pg_temp.bwa_program(
    '68100000-0000-4000-8000-000000000002',
    '68100000-0000-4000-8000-000000000001',
    '68100000-0000-4000-8000-000000000003',1
  ),now()+interval '1 hour'
);
INSERT INTO public.training_program_assignments(
  id,subject_id,program_mode,simulation_run_id,source_draft_id,status,active_revision,revision
) VALUES (
  'bwa-assignment','68100000-0000-4000-8000-000000000002','self_directed',
  '68100000-0000-4000-8000-000000000003','68100000-0000-4000-8000-000000000004',
  'active',1,1
);
INSERT INTO public.training_program_revisions(
  assignment_id,subject_id,revision_number,program_json,created_by_user_id
) VALUES (
  'bwa-assignment','68100000-0000-4000-8000-000000000002',1,
  pg_temp.bwa_program(
    '68100000-0000-4000-8000-000000000002',
    '68100000-0000-4000-8000-000000000001',
    '68100000-0000-4000-8000-000000000003',1
  ),'68100000-0000-4000-8000-000000000001'
);
INSERT INTO public.training_sessions(
  id,assignment_id,subject_id,session_kind,state,scheduled_local_date,
  athlete_timezone,revision,completed_at
) VALUES
  ('bwa-session-1','bwa-assignment','68100000-0000-4000-8000-000000000002',
    'strength','completed','2026-09-09','UTC',4,'2026-09-09T13:00:00Z'),
  ('bwa-session-2','bwa-assignment','68100000-0000-4000-8000-000000000002',
    'strength','scheduled','2026-09-11','UTC',1,NULL),
  ('bwa-session-3','bwa-assignment','68100000-0000-4000-8000-000000000002',
    'strength','scheduled','2026-09-13','UTC',1,NULL);
INSERT INTO public.training_session_prescriptions(
  session_id,subject_id,assignment_id,program_revision_number,
  prescription_json,started_by_user_id,started_at
) VALUES (
  'bwa-session-1','68100000-0000-4000-8000-000000000002','bwa-assignment',1,
  pg_catalog.jsonb_build_object(
    'schemaVersion','training-session-prescription.v1','sessionId','bwa-session-1',
    'assignmentId','bwa-assignment','programRevisionNumber',1,
    'subjectId','68100000-0000-4000-8000-000000000002',
    'executionContext',pg_temp.bwa_context('68100000-0000-4000-8000-000000000003'),
    'profileRevisionId','1','catalogVersion','bodyweight-progression-db-test.v1',
    'catalogOrigin',pg_catalog.jsonb_build_object(
      'kind','synthetic_fixture','source','server_fixture',
      'fixtureId','bodyweight-progression-db-test.v1','fixtureHash',repeat('8',64),
      'label','Synthetic bodyweight progression database catalog'
    ),
    'compiledProgramRevisionId','compiled-bwa-progression',
    'exercises',pg_catalog.jsonb_build_array(pg_temp.bwa_exercise(
      '68100000-0000-4000-8000-000000000003',
      '68100000-0000-4000-8000-000000000001',1
    ))
  ),'68100000-0000-4000-8000-000000000001','2026-09-09T12:00:00Z'
);
INSERT INTO public.training_session_progression_metadata(
  session_id,subject_id,exercise_instance_id,progression_series_id,metadata_json,created_at
) VALUES (
  'bwa-session-1','68100000-0000-4000-8000-000000000002','bwa-exercise-1',
  'strength-slot:push',
  '{"schemaVersion":"strength-session-progression-metadata.v1","prescriptionSourceRevisionId":"training-session-prescription.v1:sha256:8888888888888888888888888888888888888888888888888888888888888888","progressionSeriesId":"strength-slot:push","comparator":{"side":"bilateral","rom":"catalog_default","tempo":"controlled","exposureType":"standard","loadEpoch":1}}'::jsonb,
  '2026-09-09T12:00:00Z'
);
INSERT INTO public.training_set_log_events(
  id,subject_id,session_id,set_id,event_revision,actor_user_id,event_json
) VALUES
  (
    '68100000-0000-4000-8000-000000000010',
    '68100000-0000-4000-8000-000000000002','bwa-session-1','bwa-set-1-1',1,
    '68100000-0000-4000-8000-000000000001',
    pg_catalog.jsonb_build_object(
      'schemaVersion','training-set-log-event.v1','eventId','68100000-0000-4000-8000-000000000010',
      'eventType','set_actual_recorded','eventRevision',1,'replacesEventId',NULL,
      'subjectId','68100000-0000-4000-8000-000000000002','sessionId','bwa-session-1',
      'exerciseInstanceId','bwa-exercise-1','setId','bwa-set-1-1','setKind','working',
      'workingSetOrdinal',1,'executionContext',pg_temp.bwa_context('68100000-0000-4000-8000-000000000003'),
      'equipmentId','bodyweight-station','loadBasis','bodyweight_external',
      'quantity','{"entered":{"value":"0","unit":"kg"},"canonicalKg":"0"}'::jsonb,
      'reps',7,'rir',2,'side','bilateral','symptomState','none',
      'actor',pg_catalog.jsonb_build_object('kind','athlete','userId','68100000-0000-4000-8000-000000000001'),
      'occurredAt','2026-09-09T12:30:00Z','serverAt','2026-09-09T12:30:01Z'
    )
  ),
  (
    '68100000-0000-4000-8000-000000000011',
    '68100000-0000-4000-8000-000000000002','bwa-session-1','bwa-set-1-2',1,
    '68100000-0000-4000-8000-000000000001',
    pg_catalog.jsonb_build_object(
      'schemaVersion','training-set-log-event.v1','eventId','68100000-0000-4000-8000-000000000011',
      'eventType','set_actual_recorded','eventRevision',1,'replacesEventId',NULL,
      'subjectId','68100000-0000-4000-8000-000000000002','sessionId','bwa-session-1',
      'exerciseInstanceId','bwa-exercise-1','setId','bwa-set-1-2','setKind','working',
      'workingSetOrdinal',2,'executionContext',pg_temp.bwa_context('68100000-0000-4000-8000-000000000003'),
      'equipmentId','bodyweight-station','loadBasis','bodyweight_external',
      'quantity','{"entered":{"value":"0","unit":"kg"},"canonicalKg":"0"}'::jsonb,
      'reps',6,'rir',2,'side','bilateral','symptomState','none',
      'actor',pg_catalog.jsonb_build_object('kind','athlete','userId','68100000-0000-4000-8000-000000000001'),
      'occurredAt','2026-09-09T12:35:00Z','serverAt','2026-09-09T12:35:01Z'
    )
  );
SET LOCAL session_replication_role = origin;

CREATE FUNCTION pg_temp.insert_bwa_proposal(
  p_id uuid,
  p_key text,
  p_reps jsonb,
  p_policy text DEFAULT 'synthetic-bodyweight-rep-only',
  p_entered_value text DEFAULT '0'
)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.training_progression_proposals(
    id,proposal_key,created_by_user_id,subject_id,assignment_id,
    base_program_revision_number,base_assignment_revision,
    target_session_id,target_exercise_instance_id,target_session_revision,
    progression_series_id,source_profile_revision,source_eligibility_revision_id,
    source_program_hash,execution_context,source_session_revisions,
    mutable_target_revisions,decision_json
  ) SELECT
    p_id,p_key,'68100000-0000-4000-8000-000000000001',
    '68100000-0000-4000-8000-000000000002','bwa-assignment',1,1,
    'bwa-session-2','bwa-exercise-2',1,'strength-slot:push',1,
    'simulation:bodyweight-progression-db-test',program_hash,
    pg_temp.bwa_context('68100000-0000-4000-8000-000000000003'),
    '[{"sessionId":"bwa-session-1","revision":4}]'::jsonb,
    '[{"sessionId":"bwa-session-2","sessionRevision":1,"exerciseInstanceId":"bwa-exercise-2","scheduledLocalDate":"2026-09-11"},{"sessionId":"bwa-session-3","sessionRevision":1,"exerciseInstanceId":"bwa-exercise-3","scheduledLocalDate":"2026-09-13"}]'::jsonb,
    pg_catalog.jsonb_set(
      pg_catalog.jsonb_set(
        pg_temp.bwa_decision(p_reps),'{policyId}',pg_catalog.to_jsonb(p_policy)
      ),
      '{preservedLoad,externalLoad,entered,value}',pg_catalog.to_jsonb(p_entered_value)
    )
  FROM public.training_program_revisions
  WHERE assignment_id='bwa-assignment' AND revision_number=1;
END;
$$;

SET LOCAL ROLE service_role;
SELECT pg_temp.insert_bwa_proposal(
  '68100000-0000-4000-8000-000000000020',repeat('1',64),'[9,6]'::jsonb
);
SELECT pg_temp.insert_bwa_proposal(
  '68100000-0000-4000-8000-000000000021',repeat('2',64),'[8,6]'::jsonb,
  'wrong-policy'
);
SELECT pg_temp.insert_bwa_proposal(
  '68100000-0000-4000-8000-000000000022',repeat('3',64),'[8,6]'::jsonb
);
SELECT pg_temp.insert_bwa_proposal(
  '68100000-0000-4000-8000-000000000023',repeat('4',64),'[8,6]'::jsonb
);
SELECT pg_temp.insert_bwa_proposal(
  '68100000-0000-4000-8000-000000000024',repeat('5',64),'[8,6]'::jsonb
);
SELECT pg_temp.insert_bwa_proposal(
  '68100000-0000-4000-8000-000000000025',repeat('6',64),'[8,6]'::jsonb,
  'synthetic-bodyweight-rep-only','0.0'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','68100000-0000-4000-8000-000000000001',true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"68100000-0000-4000-8000-000000000001","aal":"aal2","iat":2000000000}',true
);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.accept_training_progression_proposal(
    '68100000-0000-4000-8000-000000000020','68100000-0000-4000-8000-000000000030'
  )$$,
  'PT409','bodyweight or assistance progression evidence changed',
  'acceptance rejects a plus-two proposal instead of skipping the earliest eligible set'
);
SELECT throws_ok(
  $$SELECT public.accept_training_progression_proposal(
    '68100000-0000-4000-8000-000000000021','68100000-0000-4000-8000-000000000031'
  )$$,
  'PT409','progression proposal target is invalid',
  'acceptance rejects a policy identity that differs from the immutable prescription'
);
SELECT throws_ok(
  $$SELECT public.accept_training_progression_proposal(
    '68100000-0000-4000-8000-000000000025','68100000-0000-4000-8000-000000000033'
  )$$,
  'PT409','progression proposal target is invalid',
  'acceptance requires the preserved entered quantity to match lexically as well as canonically'
);
RESET ROLE;

UPDATE public.training_sessions SET revision=5 WHERE id='bwa-session-1';
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.accept_training_progression_proposal(
    '68100000-0000-4000-8000-000000000023','68100000-0000-4000-8000-000000000034'
  )$$,
  'PT409','progression evidence changed',
  'a corrected source-session revision makes a dedicated proposal stale'
);
RESET ROLE;
UPDATE public.training_sessions SET revision=4 WHERE id='bwa-session-1';
UPDATE public.training_sessions SET state='in_progress' WHERE id='bwa-session-2';
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.accept_training_progression_proposal(
    '68100000-0000-4000-8000-000000000024','68100000-0000-4000-8000-000000000035'
  )$$,
  'PT409','progression target changed',
  'a started target session cannot receive a future-only dedicated revision'
);
RESET ROLE;
UPDATE public.training_sessions SET state='scheduled' WHERE id='bwa-session-2';
SET LOCAL ROLE authenticated;
SELECT is(
  public.accept_training_progression_proposal(
    '68100000-0000-4000-8000-000000000022','68100000-0000-4000-8000-000000000032'
  )#>>'{programRevisionNumber}',
  '2','the exact dedicated proposal appends one program revision'
);
SELECT is(
  public.accept_training_progression_proposal(
    '68100000-0000-4000-8000-000000000022','68100000-0000-4000-8000-000000000032'
  )#>>'{programRevisionNumber}',
  '2','the exact acceptance retry returns its durable receipt'
);
RESET ROLE;

SELECT results_eq(
  $$SELECT session->>'sessionId',exercise->'targetReps',
      exercise#>'{acceptedInitialLoad,quantity}',
      exercise#>'{acceptedInitialLoad,bodyweightAssistancePolicy}',
      exercise#>>'{progression,loadEpoch}'
    FROM public.training_program_revisions revision
    CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(revision.program_json->'sessions') session
    CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(session->'exercises') exercise
    WHERE revision.assignment_id='bwa-assignment' AND revision.revision_number=2
      AND session->>'sessionId' IN ('bwa-session-2','bwa-session-3')
    ORDER BY session->>'sessionId'$$,
  $$VALUES
    ('bwa-session-2'::text,'[8,6]'::jsonb,'{"entered":{"value":"0","unit":"kg"},"canonicalKg":"0"}'::jsonb,
      '{"policyId":"synthetic-bodyweight-rep-only","policyVersion":"1"}'::jsonb,'1'::text),
    ('bwa-session-3'::text,'[8,6]'::jsonb,'{"entered":{"value":"0","unit":"kg"},"canonicalKg":"0"}'::jsonb,
      '{"policyId":"synthetic-bodyweight-rep-only","policyVersion":"1"}'::jsonb,'1'::text)$$,
  'acceptance changes target reps only and preserves quantity, load epoch and exact policy identity'
);
SELECT is(
  (SELECT prescription_json#>'{exercises,0,acceptedInitialLoad}'
   FROM public.training_session_prescriptions WHERE session_id='bwa-session-1'),
  pg_temp.bwa_load(
    '68100000-0000-4000-8000-000000000003',
    '68100000-0000-4000-8000-000000000001','bwa-exercise-1'
  ),
  'acceptance leaves the completed source prescription and history exact'
);

SELECT * FROM finish();
ROLLBACK;
