-- Accept the explicit JSON null emitted when a reviewed swap has no authored
-- warm-up sets. A replacement never inherits warm-ups from the source exercise.

ALTER TABLE public.training_exercise_swap_proposals
  DROP CONSTRAINT IF EXISTS training_exercise_swap_proposals_replacement_defaults_check1;
ALTER TABLE public.training_exercise_swap_proposals
  DROP CONSTRAINT IF EXISTS training_exercise_swap_proposals_warmup_defaults_valid;
ALTER TABLE public.training_exercise_swap_proposals
  ADD CONSTRAINT training_exercise_swap_proposals_warmup_defaults_valid CHECK ((
    NOT (replacement_defaults ? 'warmupSets')
    OR replacement_defaults->'warmupSets' = 'null'::jsonb
    OR (
      pg_catalog.jsonb_typeof(replacement_defaults->'warmupSets') = 'array'
      AND pg_catalog.jsonb_array_length(replacement_defaults->'warmupSets') BETWEEN 1 AND 5
    )
  ) IS TRUE);

CREATE OR REPLACE FUNCTION private.apply_training_exercise_swap(
  p_program jsonb,
  p_proposal_id uuid,
  p_actor_user_id uuid,
  p_accepted_at timestamptz,
  p_replacement_exercise_version_id text,
  p_selected_load jsonb,
  p_targets jsonb,
  p_replacement_defaults jsonb,
  p_author_kind text
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_sessions jsonb;
BEGIN
  SELECT pg_catalog.jsonb_agg(
    program_session.value || pg_catalog.jsonb_build_object('exercises', (
      SELECT pg_catalog.jsonb_agg(
        CASE WHEN EXISTS (
          SELECT 1 FROM pg_catalog.jsonb_array_elements(p_targets) target(value)
          WHERE target.value->>'sessionId' = program_session.value->>'sessionId'
            AND target.value->>'exerciseInstanceId' = exercise.value->>'exerciseInstanceId'
            AND target.value->'sourceExercise' = exercise.value
        ) THEN
          (exercise.value - 'warmupSets')
          || pg_catalog.jsonb_build_object('exerciseVersionId', p_replacement_exercise_version_id)
          || pg_catalog.jsonb_build_object('progression',
            exercise.value->'progression' || (p_replacement_defaults->'progressionDefaults')
            || pg_catalog.jsonb_build_object(
              'progressionSeriesId', exercise.value#>>'{progression,progressionSeriesId}',
              'exposureType', exercise.value#>>'{progression,exposureType}',
              'loadEpoch', (exercise.value#>>'{progression,loadEpoch}')::bigint + 1
            )
          )
          || pg_catalog.jsonb_build_object('acceptedInitialLoad',
            exercise.value->'acceptedInitialLoad' || pg_catalog.jsonb_build_object(
              'acceptanceId', 'swap:' || p_proposal_id::text,
              'acceptedAt', pg_catalog.to_char(p_accepted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
              'acceptedByUserId', p_actor_user_id::text,
              'exerciseVersionId', p_replacement_exercise_version_id,
              'equipmentId', p_selected_load->>'equipmentId',
              'loadBasis', p_selected_load->>'loadBasis',
              'implementCount', p_selected_load->'implementCount',
              'holdingConfiguration', p_selected_load->>'holdingConfiguration',
              'quantity', p_selected_load->'quantity'
            )
          )
          || CASE WHEN pg_catalog.jsonb_typeof(p_replacement_defaults->'warmupSets')
              IS DISTINCT FROM 'array' THEN '{}'::jsonb
            ELSE pg_catalog.jsonb_build_object('warmupSets', (
              SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                'setId', 'swap:' || p_proposal_id::text || ':'
                  || pg_catalog.md5(
                    (program_session.value->>'sessionId') || ':' || (exercise.value->>'exerciseInstanceId')
                  ) || ':warmup:' || warmup.ordinality,
                'targetReps', warmup.value->'targetReps',
                'prescribedLoad', warmup.value->'prescribedLoad'
              ) ORDER BY warmup.ordinality)
              FROM pg_catalog.jsonb_array_elements(p_replacement_defaults->'warmupSets')
                WITH ORDINALITY warmup(value, ordinality)
            )) END
        ELSE exercise.value END
        ORDER BY exercise.ordinality
      ) FROM pg_catalog.jsonb_array_elements(program_session.value->'exercises')
        WITH ORDINALITY exercise(value, ordinality)
    )) ORDER BY program_session.ordinality
  ) INTO v_sessions
  FROM pg_catalog.jsonb_array_elements(p_program->'sessions')
    WITH ORDINALITY program_session(value, ordinality);

  RETURN p_program || pg_catalog.jsonb_build_object(
    'revisionNumber', (p_program->>'revisionNumber')::bigint + 1,
    'publishedAt', pg_catalog.to_char(p_accepted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'author', pg_catalog.jsonb_build_object('kind', p_author_kind, 'userId', p_actor_user_id::text),
    'sessions', v_sessions
  );
END;
$$;

