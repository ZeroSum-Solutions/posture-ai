BEGIN;

SELECT plan(9);

SELECT ok(
  (
    SELECT count(*)
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'workout_sessions'
      AND column_name IN ('name', 'preferences', 'generation_source', 'archived_at')
  ) = 4,
  'workout sessions expose personalization and archive metadata'
);

SELECT is(
  private.valid_workout_preferences(
    '{"goal":"balanced","minutes":15,"capability":"standard","equipment":[]}'::jsonb
  ),
  true,
  'bounded workout preferences are accepted'
);

SELECT is(
  private.valid_workout_preferences(
    '{"goal":"balanced","minutes":999,"capability":"standard","equipment":[]}'::jsonb
  ),
  false,
  'unbounded workout duration is rejected'
);

SELECT is(
  private.valid_workout_preferences(
    '{"goal":"balanced","minutes":15,"capability":"standard","equipment":["band","band"]}'::jsonb
  ),
  false,
  'duplicate equipment preferences are rejected'
);

SELECT is(
  private.valid_workout_preferences(
    '{"goal":"balanced","minutes":15,"capability":"standard","equipment":[],"photos":["private-image"]}'::jsonb
  ),
  false,
  'unexpected preference fields are rejected'
);

SELECT ok(
  NOT pg_catalog.has_function_privilege(
    'authenticated',
    'public.create_personalized_workout_session_clinical_governed(uuid,uuid,uuid,integer,text,jsonb,integer,text,timestamp with time zone,uuid,text,text,text,text,timestamp with time zone,text,text,text,text,text,jsonb,text)',
    'EXECUTE'
  ),
  'browser roles cannot mint personalized governed workouts directly'
);

SELECT ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.create_personalized_workout_session_clinical_governed(uuid,uuid,uuid,integer,text,jsonb,integer,text,timestamp with time zone,uuid,text,text,text,text,timestamp with time zone,text,text,text,text,text,jsonb,text)',
    'EXECUTE'
  ),
  'the server role can mint personalized governed workouts'
);

SELECT ok(
  NOT pg_catalog.has_function_privilege(
    'authenticated',
    'public.archive_workout_session(uuid,uuid,uuid,timestamp with time zone)',
    'EXECUTE'
  ),
  'browser roles cannot archive workout sessions directly'
);

SELECT ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.archive_workout_session(uuid,uuid,uuid,timestamp with time zone)',
    'EXECUTE'
  ),
  'the server role can archive workout sessions'
);

SELECT * FROM finish();
ROLLBACK;
