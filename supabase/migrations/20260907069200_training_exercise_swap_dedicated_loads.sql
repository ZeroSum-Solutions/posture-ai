-- Extend future-only exercise swap selections to the two dedicated load bases.
-- The application resolves an exact context-bound progression policy before it
-- stores a proposal. This migration preserves that policy identity in the
-- immutable choice and resulting accepted load.

CREATE OR REPLACE FUNCTION private.is_valid_training_exercise_swap_load_options(
  p_options jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_option jsonb;
  v_basis text;
  v_policy jsonb;
  v_ordinality bigint;
BEGIN
  IF COALESCE(
    pg_catalog.jsonb_typeof(p_options) <> 'array'
    OR pg_catalog.jsonb_array_length(p_options) NOT BETWEEN 1 AND 64,
    true
  ) THEN RETURN false; END IF;

  FOR v_option, v_ordinality IN
    SELECT option_value, ordinality
    FROM pg_catalog.jsonb_array_elements(p_options)
      WITH ORDINALITY option_row(option_value, ordinality)
  LOOP
    v_basis := v_option->>'loadBasis';
    v_policy := v_option->'bodyweightAssistancePolicy';
    IF COALESCE(
      pg_catalog.jsonb_typeof(v_option) <> 'object'
      OR NOT private.jsonb_has_exact_keys(
        v_option - 'bodyweightAssistancePolicy',
        ARRAY[
          'optionIndex','equipmentId','loadBasis','implementCount',
          'holdingConfiguration','quantity'
        ]
      )
      OR NOT private.is_stable_training_reference(v_option->>'equipmentId',128)
      OR pg_catalog.jsonb_typeof(v_option->'optionIndex') <> 'number'
      OR (v_option->>'optionIndex')::numeric
        <> pg_catalog.trunc((v_option->>'optionIndex')::numeric)
      OR (v_option->>'optionIndex')::bigint <> v_ordinality - 1
      OR NOT private.is_exact_training_quantity(v_option->'quantity')
      OR NOT (
        (v_basis = 'dumbbell_single_implement'
          AND v_option->'implementCount' = '1'::jsonb
          AND v_option->>'holdingConfiguration' = 'two_hands_single_implement')
        OR (v_basis = 'dumbbell_per_hand'
          AND v_option->'implementCount' = '2'::jsonb
          AND v_option->>'holdingConfiguration' = 'one_per_hand')
        OR (v_basis = 'barbell_total'
          AND v_option->'implementCount' = '1'::jsonb
          AND v_option->>'holdingConfiguration' = 'both_hands_barbell')
        OR (v_basis = 'machine_stack'
          AND v_option->'implementCount' = '1'::jsonb
          AND v_option->>'holdingConfiguration' = 'machine_defined')
        OR (v_basis = 'bodyweight_external'
          AND v_option->'implementCount' = '0'::jsonb
          AND v_option->>'holdingConfiguration' = 'bodyweight_plus_external_load')
        OR (v_basis = 'machine_assistance'
          AND v_option->'implementCount' = '1'::jsonb
          AND v_option->>'holdingConfiguration' = 'machine_assistance')
      ),
      true
    ) THEN RETURN false; END IF;

    IF (v_basis IN ('bodyweight_external','machine_assistance'))
        IS DISTINCT FROM (v_option ? 'bodyweightAssistancePolicy') THEN
      RETURN false;
    END IF;
    IF v_option ? 'bodyweightAssistancePolicy' AND COALESCE(
      NOT private.jsonb_has_exact_keys(v_policy,ARRAY['policyId','policyVersion'])
      OR NOT private.is_stable_training_reference(v_policy->>'policyId',128)
      OR NOT private.is_stable_training_reference(v_policy->>'policyVersion',128),
      true
    ) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN data_exception OR invalid_text_representation OR numeric_value_out_of_range THEN
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION private.is_valid_training_exercise_swap_load_options(jsonb)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION private.is_valid_training_exercise_swap_load_options(jsonb)
  TO service_role;

ALTER TABLE public.training_exercise_swap_proposals
  ADD CONSTRAINT training_exercise_swap_proposals_load_options_valid
  CHECK ((private.is_valid_training_exercise_swap_load_options(load_options)) IS TRUE)
  NOT VALID;
ALTER TABLE public.training_exercise_swap_proposals
  VALIDATE CONSTRAINT training_exercise_swap_proposals_load_options_valid;

-- This is the warm-up-aware 63100 transform with one deliberate load change:
-- remove any prior dedicated policy, then attach only the selected option's
-- exact policy. A dedicated-to-conventional swap therefore cannot retain a
-- stale bodyweight or assistance policy.
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
            ((exercise.value -> 'acceptedInitialLoad'::text) - 'bodyweightAssistancePolicy'::text)
            || pg_catalog.jsonb_build_object(
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
            || CASE WHEN p_selected_load ? 'bodyweightAssistancePolicy'
              THEN pg_catalog.jsonb_build_object(
                'bodyweightAssistancePolicy',p_selected_load->'bodyweightAssistancePolicy')
              ELSE '{}'::jsonb END
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

REVOKE ALL ON FUNCTION
  private.apply_training_exercise_swap(jsonb, uuid, uuid, timestamptz, text, jsonb, jsonb, jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
