BEGIN;
SELECT no_plan();

CREATE FUNCTION pg_temp.bodyweight_profile()
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT '{
    "schemaVersion":"athlete-training-profile.v1",
    "origin":{"kind":"synthetic_fixture","fixtureId":"bodyweight-db-test.v1","label":"Synthetic bodyweight database test"},
    "goal":"strength","experience":"beginner","recentConsistency":"intermittent",
    "cycleLengthWeeks":8,"strengthDays":["monday","thursday"],
    "localTimezone":"UTC","sessionTimeBudgetMinutes":45,"preferredLoadUnit":"kg",
    "equipmentInventory":[
      {"kind":"bodyweight_external","equipmentId":"bodyweight-station","unit":"kg","externalLoads":["0","5","10"]},
      {"kind":"assistance_machine","equipmentId":"assistance-machine","unit":"kg","assistanceLoads":["0","20","30"]}
    ],
    "startingHistory":[
      {
        "exerciseVersionId":"pushup.v1","performedAt":null,
        "equipmentLoad":{"equipmentId":"bodyweight-station","basis":"bodyweight_external","quantity":{"entered":{"value":"0","unit":"kg"},"canonicalKg":"0"}},
        "reps":8,"source":{"kind":"recalled","sourceVersion":"athlete-recall.v1","capturedAt":"2026-09-09T12:00:00Z"},
        "progressionEvidenceEligible":false
      },
      {
        "exerciseVersionId":"assisted-pullup.v1","performedAt":null,
        "equipmentLoad":{"equipmentId":"assistance-machine","basis":"machine_assistance","quantity":{"entered":{"value":"30","unit":"kg"},"canonicalKg":"30"}},
        "reps":6,"source":{"kind":"recalled","sourceVersion":"athlete-recall.v1","capturedAt":"2026-09-09T12:00:00Z"},
        "progressionEvidenceEligible":false
      }
    ]
  }'::jsonb;
$$;

CREATE FUNCTION pg_temp.execution_context(p_run_id uuid)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT pg_catalog.jsonb_build_object(
    'kind','synthetic_simulation','simulationRunId',p_run_id,
    'fixtureId','bodyweight-db-test.v1','fixtureHash',pg_catalog.repeat('b',64),
    'label','Practice data'
  );
$$;

CREATE FUNCTION pg_temp.accepted_load(
  p_run_id uuid,
  p_actor_id uuid,
  p_basis text,
  p_instance_id text,
  p_exercise_id text,
  p_equipment_id text,
  p_value text,
  p_policy_id text,
  p_policy_version text
)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT pg_catalog.jsonb_build_object(
    'status','accepted','acceptanceId','accepted:' || p_instance_id,
    'acceptedAt','2026-09-09T12:00:00Z','acceptedByUserId',p_actor_id,
    'source','equipment_inventory','executionContext',pg_temp.execution_context(p_run_id),
    'exerciseInstanceId',p_instance_id,'exerciseVersionId',p_exercise_id,
    'equipmentId',p_equipment_id,'loadBasis',p_basis,
    'implementCount',CASE WHEN p_basis='bodyweight_external' THEN 0 ELSE 1 END,
    'holdingConfiguration',CASE WHEN p_basis='bodyweight_external'
      THEN 'bodyweight_plus_external_load' ELSE 'machine_assistance' END,
    'bodyweightAssistancePolicy',pg_catalog.jsonb_build_object(
      'policyId',p_policy_id,'policyVersion',p_policy_version
    ),
    'quantity',pg_catalog.jsonb_build_object(
      'entered',pg_catalog.jsonb_build_object('value',p_value,'unit','kg'),
      'canonicalKg',p_value
    ),
    'provenance',pg_catalog.jsonb_build_object(
      'profileRevisionId','1','compiledProgramRevisionId','compiled-bodyweight-db-test',
      'catalogVersion','bodyweight-db-catalog.v1',
      'catalogOrigin',pg_catalog.jsonb_build_object(
        'kind','synthetic_fixture','source','server_fixture',
        'fixtureId','bodyweight-db-test.v1','fixtureHash',pg_catalog.repeat('b',64),
        'label','Synthetic bodyweight database catalog'
      )
    )
  );
$$;

CREATE FUNCTION pg_temp.program_document(
  p_subject_id uuid,
  p_actor_id uuid,
  p_run_id uuid
)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT pg_catalog.jsonb_build_object(
    'schemaVersion','training-program-revision.v1',
    'assignmentId','bodyweight-db-assignment','revisionNumber',1,
    'subjectId',p_subject_id,'programMode','self_directed','owningPractitionerId',NULL,
    'executionContext',pg_temp.execution_context(p_run_id),
    'cycleStartLocalDate','2026-09-09','cycleLengthWeeks',8,
    'profileRevisionId','1','eligibilitySourceRevisionId','simulation:bodyweight-db-test',
    'compilerPolicyVersion','strength-cycle-compiler.v3',
    'catalogVersion','bodyweight-db-catalog.v1',
    'catalogOrigin',pg_catalog.jsonb_build_object(
      'kind','synthetic_fixture','source','server_fixture',
      'fixtureId','bodyweight-db-test.v1','fixtureHash',pg_catalog.repeat('b',64),
      'label','Synthetic bodyweight database catalog'
    ),
    'ruleVersion','progression.v1','compiledProgramRevisionId','compiled-bodyweight-db-test',
    'publishedAt','2026-09-09T12:00:00Z',
    'author',pg_catalog.jsonb_build_object('kind','athlete','userId',p_actor_id),
    'sessions',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'sessionId','bodyweight-db-session','sessionType','full_body',
        'scheduledLocalDate','2026-09-09','athleteTimezone','UTC',
        'exercises',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'exerciseInstanceId','pushup-instance','exerciseVersionId','pushup.v1',
          'movementPattern','horizontal_push','setIds',pg_catalog.jsonb_build_array('pushup-set'),
          'repRange',pg_catalog.jsonb_build_object('minimum',6,'maximum',8),
          'targetRir',pg_catalog.jsonb_build_object('minimum',2,'maximum',3),
          'restSeconds',120,
          'acceptedInitialLoad',pg_temp.accepted_load(
            p_run_id,p_actor_id,'bodyweight_external','pushup-instance','pushup.v1',
            'bodyweight-station','0','synthetic-bodyweight-rep-only','1'
          )
        ))
      ),
      pg_catalog.jsonb_build_object(
        'sessionId','assistance-db-session','sessionType','full_body',
        'scheduledLocalDate','2026-09-11','athleteTimezone','UTC',
        'exercises',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'exerciseInstanceId','assisted-pullup-instance','exerciseVersionId','assisted-pullup.v1',
          'movementPattern','vertical_pull','setIds',pg_catalog.jsonb_build_array('assisted-pullup-set'),
          'repRange',pg_catalog.jsonb_build_object('minimum',6,'maximum',8),
          'targetRir',pg_catalog.jsonb_build_object('minimum',2,'maximum',3),
          'restSeconds',120,
          'acceptedInitialLoad',pg_temp.accepted_load(
            p_run_id,p_actor_id,'machine_assistance','assisted-pullup-instance','assisted-pullup.v1',
            'assistance-machine','30','synthetic-assistance-rep-only','1'
          )
        ))
      )
    ),
    'conditioningBouts','[]'::jsonb
  );
$$;

CREATE FUNCTION pg_temp.actual(p_value text)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT pg_catalog.jsonb_build_object(
    'quantity',pg_catalog.jsonb_build_object(
      'entered',pg_catalog.jsonb_build_object('value',p_value,'unit','kg'),
      'canonicalKg',p_value
    ),
    'reps',8,'rir',2,'side','bilateral','symptomState','none',
    'occurredAt','2026-09-09T13:00:00Z'
  );
$$;

SELECT ok(private.is_valid_training_profile(pg_temp.bodyweight_profile()),
  'profile validator accepts zero external load and nonnegative assistance inventory/history');
SELECT ok(NOT private.is_valid_training_profile(pg_catalog.jsonb_set(
  pg_temp.bodyweight_profile(),'{equipmentInventory,1,assistanceLoads,1}','"-5"'::jsonb
)), 'negative assistance inventory values fail closed');
SELECT ok(NOT private.is_valid_training_profile(pg_catalog.jsonb_set(
  pg_temp.bodyweight_profile(),'{equipmentInventory,1,assistanceLoads,1}','"2205"'::jsonb
)), 'assistance inventory values over the canonical 1000 kg bound fail closed');
SELECT ok(NOT private.is_valid_training_profile(pg_catalog.jsonb_set(
  pg_temp.bodyweight_profile(),'{equipmentInventory,0,externalLoads,0}','"-1"'::jsonb
)), 'negative external loads fail closed');
SELECT ok(NOT private.is_valid_training_profile(pg_catalog.jsonb_set(
  pg_temp.bodyweight_profile(),'{startingHistory,0,equipmentLoad,basis}','"machine_assistance"'::jsonb
)), 'starting history cannot cross bodyweight and assistance bases');
SELECT ok(NOT private.is_valid_training_profile(pg_catalog.jsonb_set(
  pg_temp.bodyweight_profile(),'{startingHistory,1,equipmentLoad,quantity,entered,unit}','"lb"'::jsonb
)), 'starting history preserves the exact inventory unit');

SELECT has_trigger('public','training_program_drafts','training_draft_bodyweight_assistance_evidence',
  'accepted drafts enforce dedicated load evidence');
SELECT has_trigger('public','training_program_revisions','training_revision_bodyweight_assistance_evidence',
  'published revisions enforce dedicated load evidence');
SELECT has_trigger('public','training_session_prescriptions','training_prescription_bodyweight_assistance_evidence',
  'started prescriptions enforce dedicated load evidence');

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id,email,created_at,updated_at) VALUES
  ('68000000-0000-4000-8000-000000000001','bodyweight-db-owner@example.invalid',now(),now());
INSERT INTO public.training_subjects(id,owner_user_id,status,activated_at)
VALUES ('68000000-0000-4000-8000-000000000002','68000000-0000-4000-8000-000000000001','active',now());
INSERT INTO public.training_profile_revisions(
  subject_id,revision,schema_version,profile_json,profile_hash,created_by_user_id
) VALUES (
  '68000000-0000-4000-8000-000000000002',1,'athlete-training-profile.v1',
  pg_temp.bodyweight_profile(),private.training_evidence_sha256(pg_temp.bodyweight_profile()),
  '68000000-0000-4000-8000-000000000001'
);
UPDATE public.training_subjects SET current_profile_revision=1
WHERE id='68000000-0000-4000-8000-000000000002';
INSERT INTO public.training_simulation_runs(
  id,subject_id,created_by_user_id,fixture_id,fixture_hash,status,expires_at
) VALUES (
  '68000000-0000-4000-8000-000000000003',
  '68000000-0000-4000-8000-000000000002',
  '68000000-0000-4000-8000-000000000001',
  'bodyweight-db-test.v1',repeat('b',64),'active',now()+interval '1 hour'
);
INSERT INTO public.training_program_drafts(
  id,subject_id,created_by_user_id,profile_revision,simulation_run_id,
  program_json,expires_at
) VALUES (
  '68000000-0000-4000-8000-000000000004',
  '68000000-0000-4000-8000-000000000002',
  '68000000-0000-4000-8000-000000000001',1,
  '68000000-0000-4000-8000-000000000003',
  pg_temp.program_document(
    '68000000-0000-4000-8000-000000000002',
    '68000000-0000-4000-8000-000000000001',
    '68000000-0000-4000-8000-000000000003'
  ),now()+interval '30 minutes'
);
INSERT INTO public.training_program_assignments(
  id,subject_id,program_mode,simulation_run_id,source_draft_id,status,active_revision,revision
) VALUES (
  'bodyweight-db-assignment','68000000-0000-4000-8000-000000000002','self_directed',
  '68000000-0000-4000-8000-000000000003','68000000-0000-4000-8000-000000000004',
  'active',1,1
);
SET LOCAL session_replication_role = origin;

INSERT INTO public.training_program_revisions(
  assignment_id,subject_id,revision_number,program_json,created_by_user_id
) VALUES (
  'bodyweight-db-assignment','68000000-0000-4000-8000-000000000002',1,
  pg_temp.program_document(
    '68000000-0000-4000-8000-000000000002',
    '68000000-0000-4000-8000-000000000001',
    '68000000-0000-4000-8000-000000000003'
  ),'68000000-0000-4000-8000-000000000001'
);
INSERT INTO public.training_sessions(
  id,assignment_id,subject_id,session_kind,state,scheduled_local_date,athlete_timezone,revision
) VALUES
  ('bodyweight-db-session','bodyweight-db-assignment','68000000-0000-4000-8000-000000000002','strength','scheduled','2026-09-09','UTC',1),
  ('assistance-db-session','bodyweight-db-assignment','68000000-0000-4000-8000-000000000002','strength','scheduled','2026-09-11','UTC',1),
  ('invalid-policy-db-session','bodyweight-db-assignment','68000000-0000-4000-8000-000000000002','strength','scheduled','2026-09-13','UTC',1);

SELECT set_config('request.jwt.claim.sub','68000000-0000-4000-8000-000000000001',true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"68000000-0000-4000-8000-000000000001","aal":"aal2","iat":2000000000}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  public.start_training_session('bodyweight-db-session',1)
    #>>'{exercises,0,acceptedInitialLoad,bodyweightAssistancePolicy,policyId}',
  'synthetic-bodyweight-rep-only',
  'session start preserves the exact bodyweight policy identity'
);
SELECT is(
  public.start_training_session('assistance-db-session',1)
    #>>'{exercises,0,acceptedInitialLoad,bodyweightAssistancePolicy,policyVersion}',
  '1',
  'session start preserves the exact assistance policy version'
);

SELECT is(
  public.write_training_set_log(
    'bodyweight-db-session','pushup-set',2,
    '68000000-0000-4000-8000-000000000010',pg_temp.actual('0')
  )#>>'{event,loadBasis}',
  'bodyweight_external',
  'actual zero external load is accepted and its basis is server-derived'
);
SELECT results_eq(
  $$SELECT event_json#>>'{equipmentId}',event_json#>>'{quantity,entered,value}',
      event_json#>>'{quantity,canonicalKg}',event_json ? 'bodyweightAssistancePolicy'
    FROM public.training_set_log_events
    WHERE session_id='bodyweight-db-session' AND set_id='pushup-set'$$,
  $$VALUES ('bodyweight-station'::text,'0'::text,'0'::text,false)$$,
  'the log stores exact actual quantity while policy authority remains in the immutable prescription'
);
SELECT throws_ok(
  $$SELECT public.write_training_set_log(
    'assistance-db-session','assisted-pullup-set',2,
    '68000000-0000-4000-8000-000000000011',pg_temp.actual('-5')
  )$$,
  '22023','invalid training set actual',
  'the real writer rejects negative assistance'
);
SELECT throws_ok(
  $$SELECT public.write_training_set_log(
    'assistance-db-session','assisted-pullup-set',2,
    '68000000-0000-4000-8000-000000000012',pg_temp.actual('1000.001')
  )$$,
  '22023','invalid training set actual',
  'the real writer rejects assistance over 1000 canonical kilograms'
);
SELECT is(
  public.write_training_set_log(
    'assistance-db-session','assisted-pullup-set',2,
    '68000000-0000-4000-8000-000000000013',pg_temp.actual('30')
  )#>>'{event,loadBasis}',
  'machine_assistance',
  'a bounded assistance actual is accepted with its server-derived basis'
);
SELECT throws_ok(
  $$SELECT public.write_training_set_log(
    'assistance-db-session','assisted-pullup-set',3,
    '68000000-0000-4000-8000-000000000014',
    pg_temp.actual('30') || '{"loadBasis":"bodyweight_external"}'::jsonb
  )$$,
  '22023','invalid training set actual',
  'the caller cannot author or replace the prescribed load basis'
);

RESET ROLE;

SELECT throws_ok(
  $$INSERT INTO public.training_session_prescriptions(
    session_id,subject_id,assignment_id,program_revision_number,prescription_json,started_by_user_id
  ) VALUES (
    'invalid-policy-db-session','68000000-0000-4000-8000-000000000002',
    'bodyweight-db-assignment',1,
    pg_catalog.jsonb_build_object(
      'schemaVersion','training-session-prescription.v1',
      'sessionId','invalid-policy-db-session','assignmentId','bodyweight-db-assignment',
      'programRevisionNumber',1,'subjectId','68000000-0000-4000-8000-000000000002',
      'executionContext',pg_temp.execution_context('68000000-0000-4000-8000-000000000003'),
      'profileRevisionId','1','catalogVersion','bodyweight-db-catalog.v1',
      'catalogOrigin',pg_catalog.jsonb_build_object(
        'kind','synthetic_fixture','source','server_fixture',
        'fixtureId','bodyweight-db-test.v1','fixtureHash',repeat('b',64),
        'label','Synthetic bodyweight database catalog'
      ),
      'compiledProgramRevisionId','compiled-bodyweight-db-test',
      'exercises',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'exerciseInstanceId','invalid-pushup','exerciseVersionId','pushup.v1','setIds',jsonb_build_array('invalid-set'),
        'acceptedInitialLoad',pg_temp.accepted_load(
          '68000000-0000-4000-8000-000000000003',
          '68000000-0000-4000-8000-000000000001','bodyweight_external',
          'invalid-pushup','pushup.v1','bodyweight-station','0',
          'synthetic-bodyweight-rep-only','1'
        ) - 'bodyweightAssistancePolicy'
      ))
    ),'68000000-0000-4000-8000-000000000001'
  )$$,
  '23514','invalid bodyweight or assistance prescription evidence',
  'a dedicated prescription cannot omit immutable policy identity'
);

SELECT ok(NOT private.is_valid_training_bodyweight_assistance_load(
  pg_temp.accepted_load(
    '68000000-0000-4000-8000-000000000003',
    '68000000-0000-4000-8000-000000000001','bodyweight_external',
    'pushup-instance','pushup.v1','bodyweight-station','0',
    'synthetic-bodyweight-rep-only','1'
  ) || '{"implementCount":1}'::jsonb,
  pg_catalog.jsonb_build_object('exerciseInstanceId','pushup-instance','exerciseVersionId','pushup.v1'),
  pg_temp.program_document(
    '68000000-0000-4000-8000-000000000002',
    '68000000-0000-4000-8000-000000000001',
    '68000000-0000-4000-8000-000000000003'
  )
), 'bodyweight external evidence cannot use an assistance implement configuration');

SELECT ok(NOT private.is_valid_training_bodyweight_assistance_load(
  pg_temp.accepted_load(
    '68000000-0000-4000-8000-000000000003',
    '68000000-0000-4000-8000-000000000001','machine_assistance',
    'assisted-pullup-instance','assisted-pullup.v1','assistance-machine','30',
    'synthetic-assistance-rep-only','1'
  ) || '{"loadBasis":"machine_stack"}'::jsonb,
  pg_catalog.jsonb_build_object('exerciseInstanceId','assisted-pullup-instance','exerciseVersionId','assisted-pullup.v1'),
  pg_temp.program_document(
    '68000000-0000-4000-8000-000000000002',
    '68000000-0000-4000-8000-000000000001',
    '68000000-0000-4000-8000-000000000003'
  )
), 'dedicated policy identity cannot be attached to a legacy machine basis');

SELECT ok(NOT private.is_training_bodyweight_assistance_load_configured(
  pg_temp.accepted_load(
    '68000000-0000-4000-8000-000000000003',
    '68000000-0000-4000-8000-000000000001','machine_assistance',
    'assisted-pullup-instance','assisted-pullup.v1','assistance-machine','25',
    'synthetic-assistance-rep-only','1'
  ),
  pg_temp.bodyweight_profile()
), 'an assistance starting target must be an exact configured machine setting');

SELECT throws_ok(
  $$INSERT INTO public.training_session_prescriptions(
    session_id,subject_id,assignment_id,program_revision_number,prescription_json,started_by_user_id
  ) VALUES (
    'invalid-policy-db-session','68000000-0000-4000-8000-000000000002',
    'bodyweight-db-assignment',1,
    pg_catalog.jsonb_build_object(
      'schemaVersion','training-session-prescription.v1',
      'sessionId','invalid-policy-db-session','assignmentId','bodyweight-db-assignment',
      'programRevisionNumber',1,'subjectId','68000000-0000-4000-8000-000000000002',
      'executionContext',pg_temp.execution_context('68000000-0000-4000-8000-000000000003'),
      'profileRevisionId','1','catalogVersion','bodyweight-db-catalog.v1',
      'catalogOrigin',pg_catalog.jsonb_build_object(
        'kind','synthetic_fixture','source','server_fixture',
        'fixtureId','bodyweight-db-test.v1','fixtureHash',repeat('b',64),
        'label','Synthetic bodyweight database catalog'
      ),
      'compiledProgramRevisionId','compiled-bodyweight-db-test',
      'exercises',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'exerciseInstanceId','invalid-assisted-pullup','exerciseVersionId','assisted-pullup.v1',
        'setIds',jsonb_build_array('invalid-assistance-set'),
        'acceptedInitialLoad',pg_temp.accepted_load(
          '68000000-0000-4000-8000-000000000003',
          '68000000-0000-4000-8000-000000000001','machine_assistance',
          'invalid-assisted-pullup','assisted-pullup.v1','assistance-machine','25',
          'synthetic-assistance-rep-only','1'
        )
      ))
    ),'68000000-0000-4000-8000-000000000001'
  )$$,
  '23514','invalid bodyweight or assistance prescription evidence',
  'a new prescription cannot persist an unconfigured assistance setting'
);

SELECT * FROM finish();
ROLLBACK;
