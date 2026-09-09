BEGIN;
SELECT plan(10);

SELECT has_function(
  'private','is_current_training_bodyweight_assistance_evidence',
  ARRAY['public.training_progression_proposals'],
  'dedicated acceptance has an independent current-evidence guard'
);
SELECT ok(
  NOT pg_catalog.has_function_privilege(
    'authenticated',
    'private.is_current_training_bodyweight_assistance_evidence(public.training_progression_proposals)',
    'EXECUTE'
  ) AND NOT pg_catalog.has_function_privilege(
    'service_role',
    'private.is_current_training_bodyweight_assistance_evidence(public.training_progression_proposals)',
    'EXECUTE'
  ),
  'the acceptance guard is not directly callable by browser or proposal writer roles'
);

CREATE FUNCTION pg_temp.guard_context(p_run uuid)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT pg_catalog.jsonb_build_object(
    'kind','synthetic_simulation','simulationRunId',p_run,
    'fixtureId','bodyweight-guard-test.v1','fixtureHash',pg_catalog.repeat('9',64),
    'label','Practice data'
  );
$$;

CREATE FUNCTION pg_temp.guard_load(p_run uuid,p_actor uuid,p_instance text)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT pg_catalog.jsonb_build_object(
    'status','accepted','acceptanceId','accepted:' || p_instance,
    'acceptedAt','2026-09-09T12:00:00Z','acceptedByUserId',p_actor,
    'source','equipment_inventory','executionContext',pg_temp.guard_context(p_run),
    'exerciseInstanceId',p_instance,'exerciseVersionId','pushup.v1',
    'equipmentId','bodyweight-station','loadBasis','bodyweight_external',
    'implementCount',0,'holdingConfiguration','bodyweight_plus_external_load',
    'bodyweightAssistancePolicy',pg_catalog.jsonb_build_object(
      'policyId','synthetic-bodyweight-rep-only','policyVersion','1'
    ),
    'quantity','{"entered":{"value":"0","unit":"kg"},"canonicalKg":"0"}'::jsonb,
    'provenance',pg_catalog.jsonb_build_object(
      'profileRevisionId','1','compiledProgramRevisionId','compiled-guard',
      'catalogVersion','bodyweight-guard-test.v1',
      'catalogOrigin',pg_catalog.jsonb_build_object(
        'kind','synthetic_fixture','source','server_fixture','fixtureId','bodyweight-guard-test.v1',
        'fixtureHash',pg_catalog.repeat('9',64),'label','Synthetic guard test catalog'
      )
    )
  );
$$;

CREATE FUNCTION pg_temp.guard_exercise(p_run uuid,p_actor uuid,p_number integer)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT pg_catalog.jsonb_build_object(
    'exerciseInstanceId','guard-exercise-' || p_number,'exerciseVersionId','pushup.v1',
    'movementPattern','horizontal_push',
    'setIds',pg_catalog.jsonb_build_array('guard-set-' || p_number || '-1','guard-set-' || p_number || '-2'),
    'targetReps',pg_catalog.jsonb_build_array(6,6),
    'repRange',pg_catalog.jsonb_build_object('minimum',6,'maximum',8),
    'targetRir',pg_catalog.jsonb_build_object('minimum',2,'maximum',3),'restSeconds',120,
    'progression',pg_catalog.jsonb_build_object(
      'progressionSeriesId','strength-slot:push','side','bilateral','rom','catalog_default',
      'tempo','controlled','exposureType','standard','loadEpoch',1
    ),
    'acceptedInitialLoad',pg_temp.guard_load(p_run,p_actor,'guard-exercise-' || p_number)
  );
$$;

CREATE FUNCTION pg_temp.guard_program(
  p_subject uuid,p_actor uuid,p_run uuid,p_revision bigint,p_variant text DEFAULT 'valid'
)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_program jsonb;
BEGIN
  v_program := pg_catalog.jsonb_build_object(
    'schemaVersion','training-program-revision.v1','assignmentId','guard-assignment',
    'revisionNumber',p_revision,'subjectId',p_subject,'programMode','self_directed',
    'owningPractitionerId',NULL,'executionContext',pg_temp.guard_context(p_run),
    'cycleStartLocalDate','2026-09-09','cycleLengthWeeks',8,'profileRevisionId','1',
    'eligibilitySourceRevisionId','simulation:bodyweight-guard-test',
    'compilerPolicyVersion','strength-cycle-compiler.v3','catalogVersion','bodyweight-guard-test.v1',
    'catalogOrigin',pg_catalog.jsonb_build_object(
      'kind','synthetic_fixture','source','server_fixture','fixtureId','bodyweight-guard-test.v1',
      'fixtureHash',pg_catalog.repeat('9',64),'label','Synthetic guard test catalog'
    ),
    'ruleVersion','progression.v1','compiledProgramRevisionId','compiled-guard',
    'publishedAt','2026-09-09T12:00:00Z',
    'author',pg_catalog.jsonb_build_object('kind','athlete','userId',p_actor),
    'sessions',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'sessionId','guard-source-old','sessionType','full_body','scheduledLocalDate','2026-09-09',
        'athleteTimezone','UTC','exercises',pg_catalog.jsonb_build_array(pg_temp.guard_exercise(p_run,p_actor,1))
      ),
      pg_catalog.jsonb_build_object(
        'sessionId','guard-target','sessionType','full_body','scheduledLocalDate','2026-09-11',
        'athleteTimezone','UTC','exercises',pg_catalog.jsonb_build_array(pg_temp.guard_exercise(p_run,p_actor,2))
      )
    ),'conditioningBouts','[]'::jsonb
  );
  IF p_variant = 'missing_set_ids' THEN
    RETURN v_program #- '{sessions,1,exercises,0,setIds}';
  ELSIF p_variant = 'duplicate_target' THEN
    RETURN pg_catalog.jsonb_set(
      v_program,'{sessions}',v_program->'sessions' || pg_catalog.jsonb_build_array(v_program#>'{sessions,1}')
    );
  ELSIF p_variant = 'no_op' THEN
    RETURN pg_catalog.jsonb_set(v_program,'{sessions,1,exercises,0,targetReps}','[8,6]'::jsonb);
  END IF;
  RETURN v_program;
END;
$$;

CREATE FUNCTION pg_temp.guard_decision()
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT '{
    "schemaVersion":"bodyweight-assistance-progression-decision.v1",
    "kind":"rep_proposal","status":"proposed","reason":"one_rep_progression","loadChange":"none",
    "preservedLoad":{"loadBasis":"bodyweight_external","equipmentId":"bodyweight-station","externalLoad":{"entered":{"value":"0","unit":"kg"},"canonicalKg":"0"}},
    "targetReps":[8,6],"policyId":"synthetic-bodyweight-rep-only","policyVersion":"1",
    "sourceExposureRevisionId":"session-evidence:9999999999999999999999999999999999999999999999999999999999999999"
  }'::jsonb;
$$;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id,email,created_at,updated_at) VALUES
  ('68400000-0000-4000-8000-000000000001','bodyweight-guard-owner@example.invalid',now(),now());
INSERT INTO public.training_subjects(id,owner_user_id,status,activated_at,current_profile_revision) VALUES
  ('68400000-0000-4000-8000-000000000002','68400000-0000-4000-8000-000000000001','active',now(),1);
INSERT INTO public.training_profile_revisions(
  subject_id,revision,schema_version,profile_json,profile_hash,created_by_user_id
) VALUES (
  '68400000-0000-4000-8000-000000000002',1,'athlete-training-profile.v1',
  '{"schemaVersion":"athlete-training-profile.v1","origin":{"kind":"synthetic_fixture","fixtureId":"bodyweight-guard-test.v1","label":"Synthetic bodyweight acceptance guard database test"},"goal":"strength","experience":"beginner","recentConsistency":"consistent","cycleLengthWeeks":8,"strengthDays":["monday","thursday"],"localTimezone":"UTC","sessionTimeBudgetMinutes":45,"preferredLoadUnit":"kg","equipmentInventory":[{"kind":"bodyweight_external","equipmentId":"bodyweight-station","unit":"kg","externalLoads":["0"]}],"startingHistory":[]}'::jsonb,
  private.training_evidence_sha256('{"schemaVersion":"athlete-training-profile.v1","origin":{"kind":"synthetic_fixture","fixtureId":"bodyweight-guard-test.v1","label":"Synthetic bodyweight acceptance guard database test"},"goal":"strength","experience":"beginner","recentConsistency":"consistent","cycleLengthWeeks":8,"strengthDays":["monday","thursday"],"localTimezone":"UTC","sessionTimeBudgetMinutes":45,"preferredLoadUnit":"kg","equipmentInventory":[{"kind":"bodyweight_external","equipmentId":"bodyweight-station","unit":"kg","externalLoads":["0"]}],"startingHistory":[]}'::jsonb),
  '68400000-0000-4000-8000-000000000001'
);
INSERT INTO public.training_simulation_runs(id,subject_id,created_by_user_id,fixture_id,fixture_hash,status,expires_at) VALUES
  ('68400000-0000-4000-8000-000000000003','68400000-0000-4000-8000-000000000002',
   '68400000-0000-4000-8000-000000000001','bodyweight-guard-test.v1',repeat('9',64),'active',now()+interval '1 hour');
INSERT INTO public.training_program_drafts(
  id,subject_id,created_by_user_id,profile_revision,simulation_run_id,program_json,expires_at
) VALUES (
  '68400000-0000-4000-8000-000000000004','68400000-0000-4000-8000-000000000002',
  '68400000-0000-4000-8000-000000000001',1,'68400000-0000-4000-8000-000000000003',
  pg_temp.guard_program('68400000-0000-4000-8000-000000000002','68400000-0000-4000-8000-000000000001','68400000-0000-4000-8000-000000000003',1),
  now()+interval '1 hour'
);
INSERT INTO public.training_program_assignments(
  id,subject_id,program_mode,simulation_run_id,source_draft_id,status,active_revision,revision
) VALUES (
  'guard-assignment','68400000-0000-4000-8000-000000000002','self_directed',
  '68400000-0000-4000-8000-000000000003','68400000-0000-4000-8000-000000000004','active',1,1
);
INSERT INTO public.training_program_revisions(
  assignment_id,subject_id,revision_number,program_json,created_by_user_id
) VALUES
  ('guard-assignment','68400000-0000-4000-8000-000000000002',1,
   pg_temp.guard_program('68400000-0000-4000-8000-000000000002','68400000-0000-4000-8000-000000000001','68400000-0000-4000-8000-000000000003',1),
   '68400000-0000-4000-8000-000000000001'),
  ('guard-assignment','68400000-0000-4000-8000-000000000002',2,
   pg_temp.guard_program('68400000-0000-4000-8000-000000000002','68400000-0000-4000-8000-000000000001','68400000-0000-4000-8000-000000000003',2,'missing_set_ids'),
   '68400000-0000-4000-8000-000000000001'),
  ('guard-assignment','68400000-0000-4000-8000-000000000002',3,
   pg_temp.guard_program('68400000-0000-4000-8000-000000000002','68400000-0000-4000-8000-000000000001','68400000-0000-4000-8000-000000000003',3,'duplicate_target'),
   '68400000-0000-4000-8000-000000000001'),
  ('guard-assignment','68400000-0000-4000-8000-000000000002',4,
   pg_temp.guard_program('68400000-0000-4000-8000-000000000002','68400000-0000-4000-8000-000000000001','68400000-0000-4000-8000-000000000003',4,'no_op'),
   '68400000-0000-4000-8000-000000000001');
INSERT INTO public.training_sessions(
  id,assignment_id,subject_id,session_kind,state,scheduled_local_date,athlete_timezone,revision,completed_at
) VALUES
  ('guard-source-old','guard-assignment','68400000-0000-4000-8000-000000000002','strength','completed','2026-09-09','UTC',4,'2026-09-09T13:00:00Z'),
  ('guard-source-latest','guard-assignment','68400000-0000-4000-8000-000000000002','strength','completed','2026-09-10','UTC',4,'2026-09-10T13:00:00Z'),
  ('guard-target','guard-assignment','68400000-0000-4000-8000-000000000002','strength','scheduled','2026-09-11','UTC',1,NULL);
INSERT INTO public.training_session_prescriptions(
  session_id,subject_id,assignment_id,program_revision_number,prescription_json,started_by_user_id,started_at
) VALUES
  ('guard-source-old','68400000-0000-4000-8000-000000000002','guard-assignment',1,
   pg_catalog.jsonb_build_object(
     'sessionId','guard-source-old','subjectId','68400000-0000-4000-8000-000000000002',
     'assignmentId','guard-assignment','exercises',pg_catalog.jsonb_build_array(pg_temp.guard_exercise('68400000-0000-4000-8000-000000000003','68400000-0000-4000-8000-000000000001',1))
   ),
   '68400000-0000-4000-8000-000000000001','2026-09-09T12:00:00Z'),
  ('guard-source-latest','68400000-0000-4000-8000-000000000002','guard-assignment',1,
   pg_catalog.jsonb_build_object(
     'sessionId','guard-source-latest','subjectId','68400000-0000-4000-8000-000000000002',
     'assignmentId','guard-assignment','exercises',pg_catalog.jsonb_build_array(pg_temp.guard_exercise('68400000-0000-4000-8000-000000000003','68400000-0000-4000-8000-000000000001',4))
   ),
   '68400000-0000-4000-8000-000000000001','2026-09-10T12:00:00Z');
INSERT INTO public.training_session_progression_metadata(
  session_id,subject_id,exercise_instance_id,progression_series_id,metadata_json,created_at
) VALUES
  ('guard-source-old','68400000-0000-4000-8000-000000000002','guard-exercise-1','strength-slot:push',
   '{"schemaVersion":"strength-session-progression-metadata.v1","prescriptionSourceRevisionId":"training-session-prescription.v1:sha256:9999999999999999999999999999999999999999999999999999999999999999","progressionSeriesId":"strength-slot:push"}',now()),
  ('guard-source-latest','68400000-0000-4000-8000-000000000002','guard-exercise-4','strength-slot:push',
   '{"schemaVersion":"strength-session-progression-metadata.v1","prescriptionSourceRevisionId":"training-session-prescription.v1:sha256:9999999999999999999999999999999999999999999999999999999999999999","progressionSeriesId":"strength-slot:push"}',now());
SET LOCAL session_replication_role = origin;

CREATE FUNCTION pg_temp.insert_guard_proposal(
  p_id uuid,p_key text,p_base bigint,p_sources jsonb
)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.training_progression_proposals(
    id,proposal_key,created_by_user_id,subject_id,assignment_id,base_program_revision_number,
    base_assignment_revision,target_session_id,target_exercise_instance_id,target_session_revision,
    progression_series_id,source_profile_revision,source_eligibility_revision_id,source_program_hash,
    execution_context,source_session_revisions,mutable_target_revisions,decision_json
  ) SELECT p_id,p_key,'68400000-0000-4000-8000-000000000001',
    '68400000-0000-4000-8000-000000000002','guard-assignment',p_base,1,
    'guard-target','guard-exercise-2',1,'strength-slot:push',1,
    'simulation:bodyweight-guard-test',revision.program_hash,
    pg_temp.guard_context('68400000-0000-4000-8000-000000000003'),p_sources,
    '[{"sessionId":"guard-target","sessionRevision":1,"exerciseInstanceId":"guard-exercise-2","scheduledLocalDate":"2026-09-11"}]'::jsonb,
    pg_temp.guard_decision()
  FROM public.training_program_revisions revision
  WHERE revision.assignment_id='guard-assignment' AND revision.revision_number=p_base;
END;
$$;

SET LOCAL ROLE service_role;
SELECT pg_temp.insert_guard_proposal('68400000-0000-4000-8000-000000000010',repeat('1',64),1,'[{"sessionId":"guard-source-latest","revision":4}]');
SELECT pg_temp.insert_guard_proposal('68400000-0000-4000-8000-000000000011',repeat('2',64),1,'[{"sessionId":"guard-source-old","revision":4}]');
SELECT pg_temp.insert_guard_proposal('68400000-0000-4000-8000-000000000012',repeat('3',64),2,'[{"sessionId":"guard-source-latest","revision":4}]');
SELECT pg_temp.insert_guard_proposal('68400000-0000-4000-8000-000000000013',repeat('4',64),3,'[{"sessionId":"guard-source-latest","revision":4}]');
SELECT pg_temp.insert_guard_proposal('68400000-0000-4000-8000-000000000014',repeat('5',64),4,'[{"sessionId":"guard-source-latest","revision":4}]');
RESET ROLE;

SELECT ok(private.is_current_training_bodyweight_assistance_evidence(proposal),'a unique changed target bound to the latest series source passes')
FROM public.training_progression_proposals proposal WHERE id='68400000-0000-4000-8000-000000000010';
SELECT ok(NOT private.is_current_training_bodyweight_assistance_evidence(proposal),'omitting the latest same-series source fails closed')
FROM public.training_progression_proposals proposal WHERE id='68400000-0000-4000-8000-000000000011';
SELECT ok(NOT private.is_current_training_bodyweight_assistance_evidence(proposal),'missing target set IDs cannot create a no-op revision')
FROM public.training_progression_proposals proposal WHERE id='68400000-0000-4000-8000-000000000012';
SELECT ok(NOT private.is_current_training_bodyweight_assistance_evidence(proposal),'duplicate target identity fails closed')
FROM public.training_progression_proposals proposal WHERE id='68400000-0000-4000-8000-000000000013';
SELECT ok(NOT private.is_current_training_bodyweight_assistance_evidence(proposal),'an already-applied target cannot publish another no-op revision')
FROM public.training_progression_proposals proposal WHERE id='68400000-0000-4000-8000-000000000014';

SET LOCAL session_replication_role = replica;
INSERT INTO public.training_set_log_events(
  id,subject_id,session_id,set_id,event_revision,actor_user_id,event_json
) VALUES (
  '68400000-0000-4000-8000-000000000020','68400000-0000-4000-8000-000000000002',
  'guard-source-latest','guard-set-4-1',1,'68400000-0000-4000-8000-000000000001',
  '{"schemaVersion":"training-set-log-event.v1","eventId":"68400000-0000-4000-8000-000000000020","subjectId":"68400000-0000-4000-8000-000000000002","sessionId":"guard-source-latest","setId":"guard-set-4-1","eventRevision":1,"actor":{"userId":"68400000-0000-4000-8000-000000000001"},"exerciseInstanceId":"guard-exercise-4"}'::jsonb
);
SET LOCAL session_replication_role = origin;
SELECT ok(NOT private.is_current_training_bodyweight_assistance_evidence(proposal),'missing symptom state is never treated as a clean set')
FROM public.training_progression_proposals proposal WHERE id='68400000-0000-4000-8000-000000000010';

SELECT throws_ok(
  $$ INSERT INTO public.training_progression_acceptances(
    proposal_id,actor_user_id,request_id,request_hash,assignment_id,
    result_program_revision_number,result_json
  ) VALUES (
    '68400000-0000-4000-8000-000000000011','68400000-0000-4000-8000-000000000001',
    '68400000-0000-4000-8000-000000000030',repeat('a',64),'guard-assignment',2,
    '{"schemaVersion":"training-progression-acceptance.v1","proposalId":"68400000-0000-4000-8000-000000000011","assignmentId":"guard-assignment","programRevisionNumber":2}'
  ) $$,
  'PT409',NULL,'the actual acceptance trigger rejects a stale omitted-latest source'
);
SELECT is(
  (SELECT count(*) FROM public.training_progression_acceptances
   WHERE proposal_id='68400000-0000-4000-8000-000000000011'),
  0::bigint,'rejected acceptance leaves no receipt'
);

SELECT * FROM finish();
ROLLBACK;
