BEGIN;
SELECT no_plan();

SELECT has_function(
  'public', 'read_training_previous_performance_sources', ARRAY['text', 'text'],
  'previous-performance comparable source projection exists'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.read_training_previous_performance_sources(text,text)', 'EXECUTE'),
  'authenticated actors may invoke the RLS-filtered projection'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.read_training_previous_performance_sources(text,text)', 'EXECUTE'),
  'anonymous callers cannot read training history'
);

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id,email,created_at,updated_at) VALUES
  ('59000000-0000-4000-8000-000000000001','previous-owner@example.invalid',now(),now()),
  ('59000000-0000-4000-8000-000000000002','previous-other@example.invalid',now(),now());
INSERT INTO public.training_subjects(id,owner_user_id,status,activated_at) VALUES
  ('59000000-0000-4000-8000-000000000003','59000000-0000-4000-8000-000000000001','active',now());
INSERT INTO public.training_program_assignments(
  id,subject_id,program_mode,source_draft_id,status,active_revision
) VALUES (
  'previous-program-1','59000000-0000-4000-8000-000000000003','self_directed',
  '59000000-0000-4000-8000-000000000004','active',1
);
INSERT INTO public.training_program_revisions(
  assignment_id,subject_id,revision_number,program_json,created_by_user_id
) VALUES (
  'previous-program-1','59000000-0000-4000-8000-000000000003',1,
  '{"assignmentId":"previous-program-1","subjectId":"59000000-0000-4000-8000-000000000003","revisionNumber":1,"cycleLengthWeeks":8,"compilerPolicyVersion":"eight-week-compiler.v2","executionContext":{"kind":"live"}}'::jsonb,
  '59000000-0000-4000-8000-000000000001'
);
INSERT INTO public.training_sessions(
  id,assignment_id,subject_id,session_kind,state,scheduled_local_date,athlete_timezone,revision,completed_at
) VALUES
  ('previous-old','previous-program-1','59000000-0000-4000-8000-000000000003','strength','completed','2026-08-25','UTC',3,'2026-08-25T18:00:00Z'),
  ('previous-latest','previous-program-1','59000000-0000-4000-8000-000000000003','strength','completed','2026-09-01','UTC',4,'2026-09-01T18:00:00Z'),
  ('previous-legacy','previous-program-1','59000000-0000-4000-8000-000000000003','strength','completed','2026-09-02','UTC',2,'2026-09-02T18:00:00Z'),
  ('previous-other-series','previous-program-1','59000000-0000-4000-8000-000000000003','strength','completed','2026-09-03','UTC',2,'2026-09-03T18:00:00Z'),
  ('previous-current','previous-program-1','59000000-0000-4000-8000-000000000003','strength','in_progress','2026-09-08','UTC',1,NULL),
  ('previous-future','previous-program-1','59000000-0000-4000-8000-000000000003','strength','completed','2026-09-09','UTC',1,'2026-09-09T18:00:00Z');
SET LOCAL session_replication_role = origin;

CREATE FUNCTION pg_temp.previous_prescription(p_session_id text, p_series_id text)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT pg_catalog.jsonb_build_object(
    'schemaVersion','training-session-prescription.v1',
    'sessionId',p_session_id,
    'assignmentId','previous-program-1',
    'subjectId','59000000-0000-4000-8000-000000000003',
    'executionContext',pg_catalog.jsonb_build_object('kind','live'),
    'exercises',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'exerciseInstanceId',p_session_id || '-press',
      'progression',pg_catalog.jsonb_build_object(
        'progressionSeriesId',p_series_id,
        'side','bilateral','rom','catalog_default','tempo','self_selected_controlled',
        'exposureType','standard','loadEpoch',1
      )
    ))
  );
$$;

INSERT INTO public.training_session_prescriptions(
  session_id,subject_id,assignment_id,program_revision_number,prescription_json,started_by_user_id,started_at
)
SELECT id,'59000000-0000-4000-8000-000000000003','previous-program-1',1,
  pg_temp.previous_prescription(
    id, CASE WHEN id='previous-other-series' THEN 'strength-slot:pull' ELSE 'strength-slot:push' END
  ),
  '59000000-0000-4000-8000-000000000001',
  scheduled_local_date::timestamptz + interval '17 hours'
FROM public.training_sessions WHERE assignment_id='previous-program-1';

-- Simulate a released pre-metadata session without inventing metadata.
SET LOCAL session_replication_role = replica;
DELETE FROM public.training_session_progression_metadata WHERE session_id='previous-legacy';
SET LOCAL session_replication_role = origin;

SELECT set_config('request.jwt.claim.sub','59000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"59000000-0000-4000-8000-000000000001","aal":"aal2","iat":2000000000}',true);
SET LOCAL ROLE authenticated;

SELECT is(
  public.read_training_previous_performance_sources('previous-current','previous-current-press')#>>'{current,session,sessionId}',
  'previous-current',
  'owned current session is projected without a browser comparator'
);
SELECT is(
  pg_catalog.jsonb_array_length(
    public.read_training_previous_performance_sources('previous-current','previous-current-press')->'history'
  ),
  3,
  'bounded history includes earlier same-series terminal sessions, including explicit legacy metadata'
);
SELECT is(
  public.read_training_previous_performance_sources('previous-current','previous-current-press')#>>'{history,0,evidence,session,sessionId}',
  'previous-legacy',
  'history is ordered newest completion first'
);
SELECT is(
  public.read_training_previous_performance_sources('previous-current','previous-current-press')#>>'{history,0,evidence,metadata}',
  NULL::text,
  'legacy same-series evidence remains explicitly unavailable to the server adapter'
);
SELECT is(
  public.read_training_previous_performance_sources('bad id','previous-current-press'),
  NULL::jsonb,
  'invalid references reveal no training data'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','59000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"59000000-0000-4000-8000-000000000002","aal":"aal2","iat":2000000000}',true);
SET LOCAL ROLE authenticated;
SELECT is(
  public.read_training_previous_performance_sources('previous-current','previous-current-press'),
  NULL::jsonb,
  'another subject owner cannot read the session or its history'
);
RESET ROLE;

SET CONSTRAINTS ALL IMMEDIATE;
SELECT * FROM finish();
ROLLBACK;
