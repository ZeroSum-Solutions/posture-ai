BEGIN;

SELECT plan(22);

SELECT is(
  private.resolve_training_prescribed_set(
    '{"exercises":[{"exerciseInstanceId":"exercise-1","warmupSets":[{"setId":"warmup-1","targetReps":8,"prescribedLoad":{"entered":{"value":"20.0","unit":"kg"},"canonicalKg":"20"}}],"setIds":["working-1","working-2"]}]}'::jsonb,
    'warmup-1'
  ),
  '{"exercise":{"exerciseInstanceId":"exercise-1","warmupSets":[{"setId":"warmup-1","targetReps":8,"prescribedLoad":{"entered":{"value":"20.0","unit":"kg"},"canonicalKg":"20"}}],"setIds":["working-1","working-2"]},"setKind":"warmup","workingSetOrdinal":null}'::jsonb,
  'an authored warm-up resolves without a working-set ordinal'
);

SELECT is(
  private.resolve_training_prescribed_set(
    '{"exercises":[{"exerciseInstanceId":"exercise-1","warmupSets":[{"setId":"warmup-1"}],"setIds":["working-1","working-2"]}]}'::jsonb,
    'working-2'
  ),
  '{"exercise":{"exerciseInstanceId":"exercise-1","warmupSets":[{"setId":"warmup-1"}],"setIds":["working-1","working-2"]},"setKind":"working","workingSetOrdinal":2}'::jsonb,
  'a working set retains its authored ordinal'
);

SELECT is(
  private.resolve_training_prescribed_set(
    '{"exercises":[{"exerciseInstanceId":"exercise-1","setIds":["working-1"]}]}'::jsonb,
    'working-1'
  )->>'setKind',
  'working',
  'legacy prescriptions without warm-up sets remain writable'
);

SELECT is(
  private.resolve_training_prescribed_set(
    '{"exercises":[{"exerciseInstanceId":"exercise-1","warmupSets":[{"setId":"duplicate"}],"setIds":["duplicate"]}]}'::jsonb,
    'duplicate'
  ),
  NULL::jsonb,
  'a set ID cannot ambiguously resolve as warm-up and working'
);

SELECT is(
  private.resolve_training_prescribed_set(
    '{"exercises":[{"exerciseInstanceId":"exercise-1","warmupSets":[{"setId":"duplicate"}],"setIds":[]},{"exerciseInstanceId":"exercise-2","warmupSets":[{"setId":"duplicate"}],"setIds":[]}]}'::jsonb,
    'duplicate'
  ),
  NULL::jsonb,
  'a set ID cannot resolve across multiple exercises'
);

SELECT is(
  private.resolve_training_prescribed_set('{"exercises":[]}'::jsonb, 'missing'),
  NULL::jsonb,
  'an unknown set does not acquire a caller-selected kind'
);

SELECT is(
  private.resolve_training_prescribed_set('{"exercises":null}'::jsonb, 'missing'),
  NULL::jsonb,
  'malformed prescription structure fails closed'
);

SELECT is(
  (
    SELECT count(*)
    FROM pg_catalog.jsonb_array_elements(
      '{"exercises":[{"warmupSets":[{"setId":"warmup-1"}],"setIds":["working-1","working-2"]}]}'::jsonb->'exercises'
    ) exercise
    CROSS JOIN LATERAL pg_catalog.jsonb_array_elements_text(exercise->'setIds') set_id
  ),
  2::bigint,
  'session completion continues to count only authored working set IDs'
);

-- Exercise the real authenticated writer against an immutable started
-- prescription. Replica mode is limited to deterministic fixture setup; every
-- assertion below calls the production RPC or reads the append-only evidence it
-- wrote.
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id,email,created_at,updated_at) VALUES
  ('60000000-0000-4000-8000-000000000101','warmup-writer-owner@example.invalid',now(),now());
INSERT INTO public.training_subjects(id,owner_user_id,status,activated_at) VALUES
  ('60000000-0000-4000-8000-000000000102','60000000-0000-4000-8000-000000000101','active',now());
INSERT INTO public.training_simulation_runs(
  id,subject_id,created_by_user_id,fixture_id,fixture_hash,status,expires_at
) VALUES (
  '60000000-0000-4000-8000-000000000103',
  '60000000-0000-4000-8000-000000000102',
  '60000000-0000-4000-8000-000000000101',
  'warmup-writer-fixture.v1',repeat('6',64),'active',now()+interval '1 hour'
);
INSERT INTO public.training_program_drafts(
  id,subject_id,created_by_user_id,profile_revision,simulation_run_id,
  program_json,expires_at
) VALUES (
  '60000000-0000-4000-8000-000000000104',
  '60000000-0000-4000-8000-000000000102',
  '60000000-0000-4000-8000-000000000101',0,
  '60000000-0000-4000-8000-000000000103',
  '{"schemaVersion":"training-program-revision.v1","subjectId":"60000000-0000-4000-8000-000000000102","revisionNumber":1,"profileRevisionId":"0","cycleLengthWeeks":8,"compilerPolicyVersion":"strength-cycle-compiler.v3","sessions":[{}],"executionContext":{"kind":"synthetic_simulation","simulationRunId":"60000000-0000-4000-8000-000000000103","fixtureId":"warmup-writer-fixture.v1","fixtureHash":"6666666666666666666666666666666666666666666666666666666666666666","label":"Practice data"}}'::jsonb,
  now()+interval '1 hour'
);
INSERT INTO public.training_program_assignments(
  id,subject_id,program_mode,simulation_run_id,source_draft_id,status,active_revision,revision
) VALUES (
  'warmup-writer-assignment',
  '60000000-0000-4000-8000-000000000102','self_directed',
  '60000000-0000-4000-8000-000000000103',
  '60000000-0000-4000-8000-000000000104','active',1,1
);
INSERT INTO public.training_program_revisions(
  assignment_id,subject_id,revision_number,program_json,created_by_user_id
) VALUES (
  'warmup-writer-assignment','60000000-0000-4000-8000-000000000102',1,
  '{"assignmentId":"warmup-writer-assignment","subjectId":"60000000-0000-4000-8000-000000000102","revisionNumber":1,"cycleLengthWeeks":8,"compilerPolicyVersion":"strength-cycle-compiler.v3"}'::jsonb,
  '60000000-0000-4000-8000-000000000101'
);
INSERT INTO public.training_sessions(
  id,assignment_id,subject_id,session_kind,state,scheduled_local_date,athlete_timezone,revision
) VALUES
  ('warmup-writer-session','warmup-writer-assignment','60000000-0000-4000-8000-000000000102','strength','in_progress','2026-09-08','UTC',1),
  ('warmup-ambiguous-session','warmup-writer-assignment','60000000-0000-4000-8000-000000000102','strength','in_progress','2026-09-08','UTC',1);
INSERT INTO public.training_session_prescriptions(
  session_id,subject_id,assignment_id,program_revision_number,prescription_json,started_by_user_id
) VALUES
  (
    'warmup-writer-session','60000000-0000-4000-8000-000000000102',
    'warmup-writer-assignment',1,
    '{"schemaVersion":"training-session-prescription.v1","sessionId":"warmup-writer-session","subjectId":"60000000-0000-4000-8000-000000000102","assignmentId":"warmup-writer-assignment","profileRevisionId":"0","executionContext":{"kind":"synthetic_simulation","simulationRunId":"60000000-0000-4000-8000-000000000103","fixtureId":"warmup-writer-fixture.v1","fixtureHash":"6666666666666666666666666666666666666666666666666666666666666666","label":"Practice data"},"exercises":[{"exerciseInstanceId":"warmup-exercise","warmupSets":[{"setId":"warmup-set","targetReps":8,"prescribedLoad":{"entered":{"value":"2.5","unit":"lb"},"canonicalKg":"1.133980925"}}],"setIds":["working-set"],"acceptedInitialLoad":{"equipmentId":"db","loadBasis":"dumbbell_single_implement"}}]}'::jsonb,
    '60000000-0000-4000-8000-000000000101'
  ),
  (
    'warmup-ambiguous-session','60000000-0000-4000-8000-000000000102',
    'warmup-writer-assignment',1,
    '{"schemaVersion":"training-session-prescription.v1","sessionId":"warmup-ambiguous-session","subjectId":"60000000-0000-4000-8000-000000000102","assignmentId":"warmup-writer-assignment","profileRevisionId":"0","executionContext":{"kind":"synthetic_simulation","simulationRunId":"60000000-0000-4000-8000-000000000103","fixtureId":"warmup-writer-fixture.v1","fixtureHash":"6666666666666666666666666666666666666666666666666666666666666666","label":"Practice data"},"exercises":[{"exerciseInstanceId":"ambiguous-exercise","warmupSets":[{"setId":"ambiguous-set"}],"setIds":["ambiguous-set"],"acceptedInitialLoad":{"equipmentId":"db","loadBasis":"dumbbell_single_implement"}}]}'::jsonb,
    '60000000-0000-4000-8000-000000000101'
  );
SET LOCAL session_replication_role = origin;

CREATE FUNCTION pg_temp.warmup_actual(
  p_value text DEFAULT '2.5',
  p_unit text DEFAULT 'lb',
  p_canonical_kg text DEFAULT '1.133980925',
  p_reps integer DEFAULT 8
) RETURNS jsonb LANGUAGE sql AS $$
  SELECT pg_catalog.jsonb_build_object(
    'quantity',pg_catalog.jsonb_build_object(
      'entered',pg_catalog.jsonb_build_object('value',p_value,'unit',p_unit),
      'canonicalKg',p_canonical_kg
    ),
    'reps',p_reps,'rir',3,'side','bilateral','symptomState','none',
    'occurredAt','2026-09-08T00:00:00Z'
  );
$$;

SELECT set_config('request.jwt.claim.sub','60000000-0000-4000-8000-000000000101',true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000101","aal":"aal2","iat":2000000000}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  public.write_training_set_log(
    'warmup-writer-session','warmup-set',1,
    '60000000-0000-4000-8000-000000000105',pg_temp.warmup_actual()
  )#>>'{event,setKind}',
  'warmup',
  'the real writer derives warm-up kind from the started prescription'
);
SELECT is(
  public.read_training_session_projection('warmup-writer-session')
    #>>'{currentActuals,0,workingSetOrdinal}',
  NULL::text,
  'a persisted warm-up actual has no working-set ordinal'
);
SELECT results_eq(
  $$SELECT event_json#>>'{quantity,entered,value}',event_json#>>'{quantity,entered,unit}',event_json#>>'{quantity,canonicalKg}'
      FROM public.training_set_log_events
      WHERE session_id='warmup-writer-session' AND set_id='warmup-set'$$,
  $$VALUES ('2.5'::text,'lb'::text,'1.133980925'::text)$$,
  'the real writer preserves the exact entered warm-up quantity'
);
SELECT is(
  public.write_training_set_log(
    'warmup-writer-session','warmup-set',1,
    '60000000-0000-4000-8000-000000000105',pg_temp.warmup_actual()
  )->>'revision',
  '2',
  'an exact warm-up retry returns the original acknowledgement'
);
SELECT results_eq(
  $$SELECT count(*) FROM public.training_set_log_events
      WHERE session_id='warmup-writer-session' AND set_id='warmup-set'$$,
  $$VALUES (1::bigint)$$,
  'an exact warm-up retry does not duplicate evidence'
);
SELECT is(
  public.write_training_set_log(
    'warmup-writer-session','warmup-set',2,
    '60000000-0000-4000-8000-000000000106',
    pg_temp.warmup_actual('3.75','kg','3.75',7)
  )#>>'{event,setKind}',
  'warmup',
  'a warm-up correction preserves the server-derived kind'
);
SELECT is(
  public.read_training_session_projection('warmup-writer-session')
    #>>'{currentActuals,0,workingSetOrdinal}',
  NULL::text,
  'a corrected warm-up remains outside working-set ordinals'
);
SELECT results_eq(
  $$SELECT event_json#>>'{quantity,entered,value}',event_json#>>'{quantity,entered,unit}',event_json#>>'{quantity,canonicalKg}'
      FROM public.training_set_log_events
      WHERE session_id='warmup-writer-session' AND set_id='warmup-set'
      ORDER BY event_revision DESC LIMIT 1$$,
  $$VALUES ('3.75'::text,'kg'::text,'3.75'::text)$$,
  'a correction preserves its exact replacement quantity without rounding'
);
SELECT throws_ok(
  $$SELECT public.complete_training_session(
      'warmup-writer-session',3,'60000000-0000-4000-8000-000000000107','complete'
    )$$,
  'PT409','training session has unlogged sets',
  'warm-up evidence alone does not satisfy working-set completion'
);
SELECT throws_ok(
  $$SELECT public.write_training_set_log(
      'warmup-writer-session','unknown-set',3,
      '60000000-0000-4000-8000-000000000108',pg_temp.warmup_actual()
    )$$,
  '22023','set is not uniquely authored in the started prescription',
  'the real writer rejects an unknown set ID'
);
SELECT throws_ok(
  $$SELECT public.write_training_set_log(
      'warmup-ambiguous-session','ambiguous-set',1,
      '60000000-0000-4000-8000-000000000109',pg_temp.warmup_actual()
    )$$,
  '22023','set is not uniquely authored in the started prescription',
  'the real writer rejects a set authored as both warm-up and working'
);
SELECT is(
  public.write_training_set_log(
    'warmup-writer-session','working-set',3,
    '60000000-0000-4000-8000-000000000110',pg_temp.warmup_actual('10','kg','10',8)
  )#>>'{event,setKind}',
  'working',
  'a working-set write remains classified as working'
);
SELECT is(
  public.read_training_session_projection('warmup-writer-session')
    #>>'{currentActuals,1,workingSetOrdinal}',
  '1',
  'the first working set retains ordinal one beside warm-up evidence'
);
SELECT is(
  public.complete_training_session(
    'warmup-writer-session',4,
    '60000000-0000-4000-8000-000000000111','complete'
  )->>'state',
  'completed',
  'completion succeeds once the authored working set is logged'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
