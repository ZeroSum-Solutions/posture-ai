-- Athlete profile and eligibility evidence plus explicit coaching authority.
--
-- Evidence is immutable. Current pointers and relationship lifecycle rows are
-- the only mutable records in this migration. No function derives eligibility
-- state from athlete answers; authoritative decision input remains separate.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- These validators are the final boundary for the directly granted RPCs. They
-- deliberately mirror the closed v1 TypeScript contracts instead of trusting a
-- future route to have parsed caller JSON first.
CREATE OR REPLACE FUNCTION private.jsonb_has_exact_keys(
  p_value jsonb,
  p_keys text[]
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_typeof(p_value) = 'object'
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_object_keys(p_value) key
      WHERE NOT (key = ANY (p_keys))
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.unnest(p_keys) key
      WHERE NOT (p_value ? key)
    );
$$;

CREATE OR REPLACE FUNCTION private.is_stable_training_reference(
  p_value text,
  p_max_length integer
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT p_value IS NOT NULL
    AND pg_catalog.length(pg_catalog.btrim(p_value)) BETWEEN 1 AND p_max_length
    AND p_value = pg_catalog.btrim(p_value)
    AND p_value ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$';
$$;

CREATE OR REPLACE FUNCTION private.is_iso_datetime(p_value text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
  IF p_value IS NULL
    OR p_value !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$'
  THEN
    RETURN false;
  END IF;
  PERFORM p_value::timestamptz;
  RETURN true;
EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION private.is_training_timezone(p_value text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_value IS NOT NULL
    AND p_value = pg_catalog.btrim(p_value)
    AND pg_catalog.length(p_value) BETWEEN 1 AND 100
    AND (p_value = 'UTC' OR p_value LIKE '%/%')
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_timezone_names zone WHERE zone.name = p_value
    );
$$;

CREATE OR REPLACE FUNCTION private.canonical_training_load_kg(
  p_value text,
  p_unit text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
DECLARE
  v_numeric numeric;
  v_result text;
BEGIN
  IF pg_catalog.length(p_value) > 16
    OR p_value !~ '^\d+(\.\d{1,3})?$'
    OR pg_catalog.length(pg_catalog.split_part(p_value, '.', 1)) > 12
    OR p_unit NOT IN ('kg', 'lb')
  THEN
    RETURN NULL;
  END IF;
  v_numeric := p_value::numeric * CASE WHEN p_unit = 'lb' THEN 0.45359237 ELSE 1 END;
  v_result := v_numeric::text;
  IF pg_catalog.strpos(v_result, '.') > 0 THEN
    v_result := pg_catalog.rtrim(pg_catalog.rtrim(v_result, '0'), '.');
  END IF;
  RETURN CASE WHEN v_result = '' OR v_result ~ '^0+$' THEN '0' ELSE v_result END;
EXCEPTION WHEN numeric_value_out_of_range OR invalid_text_representation THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION private.is_exact_training_quantity(p_value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT COALESCE(private.jsonb_has_exact_keys(p_value, ARRAY['entered', 'canonicalKg'])
    AND private.jsonb_has_exact_keys(p_value->'entered', ARRAY['value', 'unit'])
    AND pg_catalog.jsonb_typeof(p_value#>'{entered,value}') = 'string'
    AND pg_catalog.jsonb_typeof(p_value#>'{entered,unit}') = 'string'
    AND pg_catalog.jsonb_typeof(p_value->'canonicalKg') = 'string'
    AND private.canonical_training_load_kg(
      p_value#>>'{entered,value}', p_value#>>'{entered,unit}'
    ) = p_value->>'canonicalKg'
    AND (p_value->>'canonicalKg')::numeric <= 1000, false);
$$;

CREATE OR REPLACE FUNCTION private.is_valid_training_profile(p_value jsonb)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_origin jsonb;
  v_inventory jsonb;
  v_plate jsonb;
  v_load text;
  v_history jsonb;
  v_source jsonb;
  v_equipment jsonb;
  v_expected_unit text;
  v_expected_kind text;
  v_loads jsonb;
BEGIN
  IF COALESCE(NOT private.jsonb_has_exact_keys(p_value, ARRAY[
    'schemaVersion', 'origin', 'goal', 'experience', 'recentConsistency',
    'cycleLengthWeeks', 'strengthDays', 'localTimezone',
    'sessionTimeBudgetMinutes', 'preferredLoadUnit', 'equipmentInventory',
    'startingHistory'
  ]), true) THEN RETURN false; END IF;

  IF COALESCE(p_value->>'schemaVersion' <> 'athlete-training-profile.v1'
    OR p_value->>'goal' NOT IN ('strength', 'general_fitness')
    OR p_value->>'experience' NOT IN ('new_to_strength', 'beginner', 'intermediate')
    OR p_value->>'recentConsistency' NOT IN ('none', 'intermittent', 'consistent', 'unknown')
    OR pg_catalog.jsonb_typeof(p_value->'cycleLengthWeeks') <> 'number'
    OR (p_value->>'cycleLengthWeeks')::integer NOT IN (4, 6, 8, 12)
    OR pg_catalog.jsonb_typeof(p_value->'sessionTimeBudgetMinutes') <> 'number'
    OR (p_value->>'sessionTimeBudgetMinutes')::integer NOT IN (30, 45, 60)
    OR p_value->>'preferredLoadUnit' NOT IN ('kg', 'lb')
    OR NOT private.is_training_timezone(p_value->>'localTimezone')
    OR pg_catalog.jsonb_typeof(p_value->'strengthDays') <> 'array'
    OR pg_catalog.jsonb_array_length(p_value->'strengthDays') NOT BETWEEN 2 AND 4
    OR EXISTS (
      SELECT 1 FROM pg_catalog.jsonb_array_elements(p_value->'strengthDays') day
      WHERE pg_catalog.jsonb_typeof(day) <> 'string'
        OR day#>>'{}' NOT IN ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')
    )
    OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_array_elements(p_value->'strengthDays'))
      <> (SELECT pg_catalog.count(DISTINCT day#>>'{}') FROM pg_catalog.jsonb_array_elements(p_value->'strengthDays') day)
    OR pg_catalog.jsonb_typeof(p_value->'equipmentInventory') <> 'array'
    OR pg_catalog.jsonb_array_length(p_value->'equipmentInventory') > 1000
    OR pg_catalog.jsonb_typeof(p_value->'startingHistory') <> 'array'
    OR pg_catalog.jsonb_array_length(p_value->'startingHistory') > 50,
    true
  ) THEN RETURN false; END IF;

  v_origin := p_value->'origin';
  IF COALESCE(NOT (
    (private.jsonb_has_exact_keys(v_origin, ARRAY['kind']) AND v_origin->>'kind' = 'athlete_input')
    OR (
      private.jsonb_has_exact_keys(v_origin, ARRAY['kind','fixtureId','label'])
      AND v_origin->>'kind' = 'synthetic_fixture'
      AND private.is_stable_training_reference(v_origin->>'fixtureId', 128)
      AND pg_catalog.length(pg_catalog.btrim(v_origin->>'label')) BETWEEN 1 AND 160
      AND v_origin->>'label' ~* 'synthetic'
    )
  ), true) THEN RETURN false; END IF;

  IF COALESCE((SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_array_elements(p_value->'equipmentInventory'))
    <> (SELECT pg_catalog.count(DISTINCT item->>'equipmentId') FROM pg_catalog.jsonb_array_elements(p_value->'equipmentInventory') item)
  , true) THEN RETURN false; END IF;

  FOR v_inventory IN SELECT value FROM pg_catalog.jsonb_array_elements(p_value->'equipmentInventory') LOOP
    IF COALESCE(NOT private.is_stable_training_reference(v_inventory->>'equipmentId', 128)
      OR v_inventory->>'unit' NOT IN ('kg','lb')
    , true) THEN RETURN false; END IF;
    IF v_inventory->>'kind' = 'barbell' THEN
      IF COALESCE(NOT private.jsonb_has_exact_keys(v_inventory, ARRAY[
        'kind','equipmentId','unit','barWeight','collarsTotalWeight','plates'
      ]) OR private.canonical_training_load_kg(v_inventory->>'barWeight', v_inventory->>'unit') IS NULL
        OR private.canonical_training_load_kg(v_inventory->>'barWeight', v_inventory->>'unit')::numeric > 1000
        OR private.canonical_training_load_kg(v_inventory->>'collarsTotalWeight', v_inventory->>'unit') IS NULL
        OR private.canonical_training_load_kg(v_inventory->>'collarsTotalWeight', v_inventory->>'unit')::numeric > 1000
        OR pg_catalog.jsonb_typeof(v_inventory->'plates') <> 'array'
        OR pg_catalog.jsonb_array_length(v_inventory->'plates') > 1000,
        true
      ) THEN RETURN false; END IF;
      FOR v_plate IN SELECT value FROM pg_catalog.jsonb_array_elements(v_inventory->'plates') LOOP
        IF COALESCE(NOT private.jsonb_has_exact_keys(v_plate, ARRAY['value','count'])
          OR pg_catalog.jsonb_typeof(v_plate->'value') <> 'string'
          OR pg_catalog.jsonb_typeof(v_plate->'count') <> 'number'
          OR (v_plate->>'count')::numeric <> pg_catalog.trunc((v_plate->>'count')::numeric)
          OR (v_plate->>'count')::integer NOT BETWEEN 0 AND 1000
          OR COALESCE(private.canonical_training_load_kg(v_plate->>'value', v_inventory->>'unit')::numeric, 0) <= 0
          OR private.canonical_training_load_kg(v_plate->>'value', v_inventory->>'unit')::numeric > 1000,
          true
        ) THEN RETURN false; END IF;
      END LOOP;
    ELSIF v_inventory->>'kind' IN ('dumbbell','machine') THEN
      v_loads := v_inventory -> (
        CASE v_inventory->>'kind' WHEN 'dumbbell' THEN 'perHandLoads' ELSE 'stackLoads' END
      );
      IF COALESCE(NOT private.jsonb_has_exact_keys(v_inventory, CASE v_inventory->>'kind'
          WHEN 'dumbbell' THEN ARRAY['kind','equipmentId','unit','perHandLoads']
          ELSE ARRAY['kind','equipmentId','unit','stackLoads'] END)
        OR pg_catalog.jsonb_typeof(v_loads) <> 'array'
        OR pg_catalog.jsonb_array_length(v_loads) > 1000
        OR EXISTS (
          SELECT 1 FROM pg_catalog.jsonb_array_elements(v_loads) load
          WHERE pg_catalog.jsonb_typeof(load) <> 'string'
        ),
        true
      ) THEN RETURN false; END IF;
      FOR v_load IN SELECT value#>>'{}' FROM pg_catalog.jsonb_array_elements(v_loads) LOOP
        IF private.canonical_training_load_kg(v_load, v_inventory->>'unit') IS NULL
          OR private.canonical_training_load_kg(v_load, v_inventory->>'unit')::numeric > 1000
        THEN RETURN false; END IF;
      END LOOP;
    ELSE RETURN false;
    END IF;
  END LOOP;

  FOR v_history IN SELECT value FROM pg_catalog.jsonb_array_elements(p_value->'startingHistory') LOOP
    IF COALESCE(NOT private.jsonb_has_exact_keys(v_history, ARRAY[
      'exerciseVersionId','performedAt','equipmentLoad','reps','source','progressionEvidenceEligible'
    ]) OR NOT private.is_stable_training_reference(v_history->>'exerciseVersionId', 128)
      OR NOT (pg_catalog.jsonb_typeof(v_history->'performedAt') = 'null' OR private.is_iso_datetime(v_history->>'performedAt'))
      OR pg_catalog.jsonb_typeof(v_history->'reps') <> 'number'
      OR (v_history->>'reps')::numeric <> pg_catalog.trunc((v_history->>'reps')::numeric)
      OR (v_history->>'reps')::integer NOT BETWEEN 1 AND 100
      OR v_history->'progressionEvidenceEligible' <> 'false'::jsonb
      OR NOT private.jsonb_has_exact_keys(v_history->'equipmentLoad', ARRAY['equipmentId','basis','quantity'])
      OR NOT private.is_exact_training_quantity(v_history#>'{equipmentLoad,quantity}'),
      true
    ) THEN RETURN false; END IF;
    SELECT item INTO v_equipment FROM pg_catalog.jsonb_array_elements(p_value->'equipmentInventory') item
      WHERE item->>'equipmentId' = v_history#>>'{equipmentLoad,equipmentId}';
    IF v_equipment IS NULL THEN RETURN false; END IF;
    v_expected_unit := v_equipment->>'unit';
    v_expected_kind := v_equipment->>'kind';
    IF COALESCE(v_history#>>'{equipmentLoad,quantity,entered,unit}' <> v_expected_unit
      OR NOT (CASE v_expected_kind
        WHEN 'barbell' THEN v_history#>>'{equipmentLoad,basis}' = 'barbell_total'
        WHEN 'dumbbell' THEN v_history#>>'{equipmentLoad,basis}' IN ('dumbbell_per_hand','dumbbell_single_implement')
        WHEN 'machine' THEN v_history#>>'{equipmentLoad,basis}' = 'machine_stack'
        ELSE false END),
      true
    ) THEN RETURN false; END IF;
    v_source := v_history->'source';
    IF COALESCE(NOT (
      (private.jsonb_has_exact_keys(v_source, ARRAY['kind','sourceVersion','capturedAt'])
        AND v_source->>'kind'='recalled' AND v_source->>'sourceVersion'='athlete-recall.v1'
        AND private.is_iso_datetime(v_source->>'capturedAt'))
      OR (private.jsonb_has_exact_keys(v_source, ARRAY['kind','sourceVersion','sourceSystemId','sourceRecordReference','importedAt'])
        AND v_source->>'kind'='imported' AND v_source->>'sourceVersion'='external-history-import.v1'
        AND private.is_stable_training_reference(v_source->>'sourceSystemId',128)
        AND private.is_stable_training_reference(v_source->>'sourceRecordReference',128)
        AND private.is_iso_datetime(v_source->>'importedAt'))
    ), true) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN data_exception OR invalid_text_representation OR numeric_value_out_of_range THEN
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION private.is_valid_training_answers(p_value jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_origin jsonb := p_value->'origin';
  v_conditions jsonb := p_value->'knownConditions';
BEGIN
  RETURN COALESCE(private.jsonb_has_exact_keys(p_value, ARRAY[
      'schemaVersion','questionnaireSourceVersion','submittedAt','origin',
      'adultScope','currentActivity','knownConditions','relevantSignsOrSymptoms',
      'desiredIntensity','answerCertainty','pregnancyPostpartumContext',
      'requestedProgrammingScope'
    ])
    AND p_value->>'schemaVersion' = 'eligibility-answers.v1'
    AND p_value->>'questionnaireSourceVersion' = 'preparticipation-inputs.v1-unvalidated'
    AND private.is_iso_datetime(p_value->>'submittedAt')
    AND (
      (private.jsonb_has_exact_keys(v_origin, ARRAY['kind'])
        AND v_origin->>'kind' = 'athlete_self_report')
      OR (private.jsonb_has_exact_keys(v_origin, ARRAY['kind','fixtureId','label'])
        AND v_origin->>'kind' = 'synthetic_fixture'
        AND private.is_stable_training_reference(v_origin->>'fixtureId',160)
        AND pg_catalog.length(pg_catalog.btrim(v_origin->>'label')) BETWEEN 1 AND 160
        AND v_origin->>'label' ~* 'synthetic')
    )
    AND p_value->>'adultScope' IN ('confirmed_18_plus','minor','unknown')
    AND p_value->>'currentActivity' IN ('regularly_active','not_regularly_active','unknown')
    AND private.jsonb_has_exact_keys(v_conditions, ARRAY['cardiovascular','metabolic','renal'])
    AND v_conditions->>'cardiovascular' IN ('yes','no','unknown')
    AND v_conditions->>'metabolic' IN ('yes','no','unknown')
    AND v_conditions->>'renal' IN ('yes','no','unknown')
    AND p_value->>'relevantSignsOrSymptoms' IN ('yes','no','unknown')
    AND p_value->>'desiredIntensity' IN ('light','moderate','vigorous','unknown')
    AND p_value->>'answerCertainty' IN ('complete','uncertain')
    AND p_value->>'pregnancyPostpartumContext' IN (
      'none_reported','pregnant','postpartum','unknown','prefer_not_to_say'
    )
    AND p_value->>'requestedProgrammingScope' IN (
      'strength_or_general_fitness','specialized_programming','unknown'
    ), false);
END;
$$;

CREATE OR REPLACE FUNCTION private.is_valid_training_decision(p_value jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_source jsonb := p_value->'source';
  v_source_kind text := p_value#>>'{source,kind}';
  v_constraint jsonb := p_value->'constraintSet';
BEGIN
  IF COALESCE(NOT private.jsonb_has_exact_keys(p_value, ARRAY[
    'schemaVersion','sourceRevisionId','answersRevisionId','answersSchemaVersion',
    'questionnaireSourceVersion','policyVersion','state','scope','source',
    'effectiveFrom','effectiveUntil','supersededAt','constraintSet'
  ]) OR p_value->>'schemaVersion' <> 'eligibility-decision.v1'
    OR NOT private.is_stable_training_reference(p_value->>'sourceRevisionId',160)
    OR NOT private.is_stable_training_reference(p_value->>'answersRevisionId',160)
    OR p_value->>'answersSchemaVersion' <> 'eligibility-answers.v1'
    OR p_value->>'questionnaireSourceVersion' <> 'preparticipation-inputs.v1-unvalidated'
    OR NOT private.is_stable_training_reference(p_value->>'policyVersion',128)
    OR p_value->>'state' NOT IN (
      'unanswered','eligible_general','needs_clinical_review','acute_stop','cleared_with_constraints'
    ) OR p_value->>'scope' NOT IN ('supported','outside_release','unanswered')
    OR NOT private.is_iso_datetime(p_value->>'effectiveFrom')
    OR NOT (pg_catalog.jsonb_typeof(p_value->'effectiveUntil') = 'null'
      OR private.is_iso_datetime(p_value->>'effectiveUntil'))
    OR NOT (pg_catalog.jsonb_typeof(p_value->'supersededAt') = 'null'
      OR private.is_iso_datetime(p_value->>'supersededAt'))
    OR COALESCE(
      (p_value->>'effectiveUntil')::timestamptz < (p_value->>'effectiveFrom')::timestamptz,
      false
    )
    OR COALESCE(
      (p_value->>'supersededAt')::timestamptz < (p_value->>'effectiveFrom')::timestamptz,
      false
    ),
    true
  ) THEN RETURN false; END IF;

  IF v_source_kind = 'policy_service' THEN
    IF COALESCE(NOT private.jsonb_has_exact_keys(v_source, ARRAY['kind','sourceVersion','evaluatedAt'])
      OR v_source->>'sourceVersion' <> 'eligibility-policy-service.v1'
      OR NOT private.is_iso_datetime(v_source->>'evaluatedAt'), true
    ) THEN RETURN false; END IF;
  ELSIF v_source_kind = 'qualified_reviewer' THEN
    IF COALESCE(NOT private.jsonb_has_exact_keys(v_source, ARRAY[
      'kind','sourceVersion','reviewerReference','scopeEvidenceReference','reviewedAt'
    ]) OR v_source->>'sourceVersion' <> 'qualified-review.v1'
      OR NOT private.is_stable_training_reference(v_source->>'reviewerReference',160)
      OR NOT private.is_stable_training_reference(v_source->>'scopeEvidenceReference',160)
      OR NOT private.is_iso_datetime(v_source->>'reviewedAt'), true
    ) THEN RETURN false; END IF;
  ELSIF v_source_kind = 'synthetic_fixture' THEN
    IF COALESCE(NOT private.jsonb_has_exact_keys(v_source, ARRAY['kind','sourceVersion','fixtureId','label'])
      OR v_source->>'sourceVersion' <> 'synthetic-eligibility-fixture.v1'
      OR NOT private.is_stable_training_reference(v_source->>'fixtureId',160)
      OR pg_catalog.length(pg_catalog.btrim(v_source->>'label')) NOT BETWEEN 1 AND 160
      OR v_source->>'label' !~* 'synthetic', true
    ) THEN RETURN false; END IF;
  ELSE RETURN false;
  END IF;

  IF p_value->>'state' = 'cleared_with_constraints' THEN
    RETURN v_source_kind = 'qualified_reviewer'
      AND v_constraint = '{"status":"unavailable","reason":"constraint_contract_unvalidated"}'::jsonb;
  END IF;
  RETURN pg_catalog.jsonb_typeof(v_constraint) = 'null';
EXCEPTION WHEN data_exception OR invalid_text_representation OR numeric_value_out_of_range THEN
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION private.training_evidence_sha256(p_value jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
  SELECT pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(p_value::text, 'UTF8'), 'sha256'),
    'hex'
  );
$$;

DO $$ BEGIN
  CREATE TYPE public.training_coaching_relationship_status AS ENUM (
    'active', 'revoked'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.training_coach_permission AS ENUM (
    'subject:read',
    'client_link:read',
    'profile:read',
    'profile:write',
    'program:coach_publish',
    'session:read',
    'set_log:write',
    'session:complete',
    'history:read',
    'relationship:revoke'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.training_eligibility_state AS ENUM (
    'unanswered',
    'eligible_general',
    'needs_clinical_review',
    'acute_stop',
    'cleared_with_constraints'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.training_eligibility_scope AS ENUM (
    'supported', 'outside_release', 'unanswered'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.training_eligibility_source_kind AS ENUM (
    'policy_service', 'qualified_reviewer', 'synthetic_fixture'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.training_subjects
  ADD COLUMN current_profile_revision bigint,
  ADD COLUMN current_eligibility_decision_source_revision_id text;

CREATE TABLE public.training_profile_revisions (
  subject_id uuid NOT NULL
    REFERENCES public.training_subjects(id) ON DELETE RESTRICT,
  revision bigint NOT NULL CHECK (revision > 0),
  schema_version text NOT NULL
    CHECK (schema_version = 'athlete-training-profile.v1'),
  profile_json jsonb NOT NULL,
  profile_hash text NOT NULL CHECK (profile_hash ~ '^[0-9a-f]{64}$'),
  hash_encoding text NOT NULL DEFAULT 'postgres-jsonb-text-utf8.v1'
    CHECK (hash_encoding = 'postgres-jsonb-text-utf8.v1'),
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY (subject_id, revision),
  CONSTRAINT training_profile_revisions_json_shape CHECK (
    pg_catalog.jsonb_typeof(profile_json) = 'object'
    AND profile_json->>'schemaVersion' = schema_version
    AND profile_json ?& ARRAY[
      'schemaVersion', 'origin', 'goal', 'experience', 'recentConsistency',
      'cycleLengthWeeks', 'strengthDays', 'localTimezone',
      'sessionTimeBudgetMinutes', 'preferredLoadUnit', 'equipmentInventory',
      'startingHistory'
    ]
    AND (
      (
        profile_json#>>'{origin,kind}' = 'athlete_input'
      )
      OR (
        profile_json#>>'{origin,kind}' = 'synthetic_fixture'
        AND profile_json#>>'{origin,fixtureId}'
          ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
        AND profile_json#>>'{origin,label}' ~* 'synthetic'
      )
    )
    AND profile_json->>'goal' IN ('strength', 'general_fitness')
    AND profile_json->>'experience' IN (
      'new_to_strength', 'beginner', 'intermediate'
    )
    AND profile_json->>'recentConsistency' IN (
      'none', 'intermittent', 'consistent', 'unknown'
    )
    AND profile_json->>'cycleLengthWeeks' IN ('4', '6', '8', '12')
    AND pg_catalog.jsonb_typeof(profile_json->'strengthDays') = 'array'
    AND pg_catalog.jsonb_array_length(profile_json->'strengthDays') BETWEEN 2 AND 4
    AND profile_json->'strengthDays' <@ '[
      "monday", "tuesday", "wednesday", "thursday",
      "friday", "saturday", "sunday"
    ]'::jsonb
    AND pg_catalog.length(pg_catalog.btrim(profile_json->>'localTimezone')) BETWEEN 1 AND 100
    AND profile_json->>'sessionTimeBudgetMinutes' IN ('30', '45', '60')
    AND profile_json->>'preferredLoadUnit' IN ('kg', 'lb')
    AND pg_catalog.jsonb_typeof(profile_json->'equipmentInventory') = 'array'
    AND pg_catalog.jsonb_typeof(profile_json->'startingHistory') = 'array'
  ),
  CONSTRAINT training_profile_revisions_contract_v1 CHECK (
    private.is_valid_training_profile(profile_json) IS TRUE
  ),
  CONSTRAINT training_profile_revisions_hash_bound CHECK (
    profile_hash = private.training_evidence_sha256(profile_json)
  )
);

CREATE TABLE public.training_eligibility_responses (
  subject_id uuid NOT NULL
    REFERENCES public.training_subjects(id) ON DELETE RESTRICT,
  revision bigint NOT NULL CHECK (revision > 0),
  source_revision_id text NOT NULL CHECK (
    source_revision_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
  ),
  schema_version text NOT NULL
    CHECK (schema_version = 'eligibility-answers.v1'),
  questionnaire_source_version text NOT NULL
    CHECK (questionnaire_source_version = 'preparticipation-inputs.v1-unvalidated'),
  answers_json jsonb NOT NULL,
  answers_hash text NOT NULL CHECK (answers_hash ~ '^[0-9a-f]{64}$'),
  hash_encoding text NOT NULL DEFAULT 'postgres-jsonb-text-utf8.v1'
    CHECK (hash_encoding = 'postgres-jsonb-text-utf8.v1'),
  submitted_by_user_id uuid NOT NULL,
  submitted_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY (subject_id, revision),
  UNIQUE (subject_id, source_revision_id),
  CONSTRAINT training_eligibility_responses_json_shape CHECK (
    pg_catalog.jsonb_typeof(answers_json) = 'object'
    AND answers_json ?& ARRAY[
      'schemaVersion', 'questionnaireSourceVersion', 'submittedAt', 'origin',
      'adultScope', 'currentActivity', 'knownConditions',
      'relevantSignsOrSymptoms', 'desiredIntensity', 'answerCertainty',
      'pregnancyPostpartumContext', 'requestedProgrammingScope'
    ]
    AND NOT answers_json ?| ARRAY[
      'state', 'scope', 'eligibilityDecision', 'constraints', 'constraintSet'
    ]
    AND answers_json->>'schemaVersion' = schema_version
    AND answers_json->>'questionnaireSourceVersion' = questionnaire_source_version
    AND (
      answers_json#>>'{origin,kind}' = 'athlete_self_report'
      OR (
        answers_json#>>'{origin,kind}' = 'synthetic_fixture'
        AND answers_json#>>'{origin,fixtureId}'
          ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
        AND answers_json#>>'{origin,label}' ~* 'synthetic'
      )
    )
    AND answers_json->>'adultScope' IN ('confirmed_18_plus', 'minor', 'unknown')
    AND answers_json->>'currentActivity' IN (
      'regularly_active', 'not_regularly_active', 'unknown'
    )
    AND pg_catalog.jsonb_typeof(answers_json->'knownConditions') = 'object'
    AND answers_json#>>'{knownConditions,cardiovascular}' IN ('yes', 'no', 'unknown')
    AND answers_json#>>'{knownConditions,metabolic}' IN ('yes', 'no', 'unknown')
    AND answers_json#>>'{knownConditions,renal}' IN ('yes', 'no', 'unknown')
    AND answers_json->>'relevantSignsOrSymptoms' IN ('yes', 'no', 'unknown')
    AND answers_json->>'desiredIntensity' IN (
      'light', 'moderate', 'vigorous', 'unknown'
    )
    AND answers_json->>'answerCertainty' IN ('complete', 'uncertain')
    AND answers_json->>'pregnancyPostpartumContext' IN (
      'none_reported', 'pregnant', 'postpartum', 'unknown', 'prefer_not_to_say'
    )
    AND answers_json->>'requestedProgrammingScope' IN (
      'strength_or_general_fitness', 'specialized_programming', 'unknown'
    )
  ),
  CONSTRAINT training_eligibility_responses_contract_v1 CHECK (
    private.is_valid_training_answers(answers_json) IS TRUE
  ),
  CONSTRAINT training_eligibility_responses_hash_bound CHECK (
    answers_hash = private.training_evidence_sha256(answers_json)
  )
);

CREATE TABLE public.training_eligibility_decisions (
  subject_id uuid NOT NULL,
  source_revision_id text NOT NULL CHECK (
    source_revision_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
  ),
  answers_revision_id text NOT NULL,
  schema_version text NOT NULL
    CHECK (schema_version = 'eligibility-decision.v1'),
  answers_schema_version text NOT NULL
    CHECK (answers_schema_version = 'eligibility-answers.v1'),
  questionnaire_source_version text NOT NULL
    CHECK (questionnaire_source_version = 'preparticipation-inputs.v1-unvalidated'),
  policy_version text NOT NULL CHECK (
    policy_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
  ),
  state public.training_eligibility_state NOT NULL,
  scope public.training_eligibility_scope NOT NULL,
  source_kind public.training_eligibility_source_kind NOT NULL,
  source_version text NOT NULL,
  reviewer_reference text,
  scope_evidence_reference text,
  effective_from timestamptz NOT NULL,
  effective_until timestamptz,
  supersedes_source_revision_id text,
  constraint_set jsonb,
  decision_json jsonb NOT NULL,
  decision_hash text NOT NULL CHECK (decision_hash ~ '^[0-9a-f]{64}$'),
  hash_encoding text NOT NULL DEFAULT 'postgres-jsonb-text-utf8.v1'
    CHECK (hash_encoding = 'postgres-jsonb-text-utf8.v1'),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY (subject_id, source_revision_id),
  FOREIGN KEY (subject_id, answers_revision_id)
    REFERENCES public.training_eligibility_responses(subject_id, source_revision_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (subject_id, supersedes_source_revision_id)
    REFERENCES public.training_eligibility_decisions(subject_id, source_revision_id)
    ON DELETE RESTRICT,
  CONSTRAINT training_eligibility_decisions_effective_window CHECK (
    effective_until IS NULL OR effective_until >= effective_from
  ),
  CONSTRAINT training_eligibility_decisions_source_shape CHECK (
    (
      source_kind = 'policy_service'
      AND source_version = 'eligibility-policy-service.v1'
      AND reviewer_reference IS NULL
      AND scope_evidence_reference IS NULL
    )
    OR (
      source_kind = 'qualified_reviewer'
      AND source_version = 'qualified-review.v1'
      AND reviewer_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
      AND scope_evidence_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
    )
    OR (
      source_kind = 'synthetic_fixture'
      AND source_version = 'synthetic-eligibility-fixture.v1'
      AND reviewer_reference IS NULL
      AND scope_evidence_reference IS NULL
      AND decision_json#>>'{source,label}' ~* 'synthetic'
    )
  ),
  CONSTRAINT training_eligibility_decisions_constraint_shape CHECK (
    (
      state = 'cleared_with_constraints'
      AND source_kind = 'qualified_reviewer'
      AND constraint_set = '{"status":"unavailable","reason":"constraint_contract_unvalidated"}'::jsonb
    )
    OR (state <> 'cleared_with_constraints' AND constraint_set IS NULL)
  ),
  CONSTRAINT training_eligibility_decisions_json_shape CHECK (
    pg_catalog.jsonb_typeof(decision_json) = 'object'
    AND decision_json->>'schemaVersion' = schema_version
    AND decision_json->>'sourceRevisionId' = source_revision_id
    AND decision_json->>'answersRevisionId' = answers_revision_id
    AND decision_json->>'answersSchemaVersion' = answers_schema_version
    AND decision_json->>'questionnaireSourceVersion' = questionnaire_source_version
    AND decision_json->>'policyVersion' = policy_version
    AND decision_json->>'state' = state::text
    AND decision_json->>'scope' = scope::text
    AND decision_json#>>'{source,kind}' = source_kind::text
    AND decision_json#>>'{source,sourceVersion}' = source_version
  ),
  CONSTRAINT training_eligibility_decisions_contract_v1 CHECK (
    private.is_valid_training_decision(decision_json) IS TRUE
  ),
  CONSTRAINT training_eligibility_decisions_hash_bound CHECK (
    decision_hash = private.training_evidence_sha256(decision_json)
  )
);

CREATE TABLE public.coaching_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id uuid NOT NULL
    REFERENCES public.training_subjects(id) ON DELETE RESTRICT,
  practitioner_id uuid NOT NULL
    REFERENCES public.practitioners(id) ON DELETE RESTRICT,
  status public.training_coaching_relationship_status NOT NULL DEFAULT 'active',
  permissions public.training_coach_permission[] NOT NULL,
  started_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  ended_at timestamptz,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT coaching_relationships_permissions_nonempty CHECK (
    pg_catalog.cardinality(permissions) > 0
  ),
  CONSTRAINT coaching_relationships_lifecycle_shape CHECK (
    (status = 'active' AND ended_at IS NULL)
    OR (status = 'revoked' AND ended_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX coaching_relationships_one_active_pair
  ON public.coaching_relationships(subject_id, practitioner_id)
  WHERE status = 'active' AND ended_at IS NULL;

CREATE INDEX training_profile_revisions_subject_created
  ON public.training_profile_revisions(subject_id, created_at DESC);
CREATE INDEX training_eligibility_responses_subject_created
  ON public.training_eligibility_responses(subject_id, created_at DESC);
CREATE INDEX training_eligibility_decisions_subject_effective
  ON public.training_eligibility_decisions(subject_id, effective_from DESC);
CREATE UNIQUE INDEX training_eligibility_decisions_one_successor
  ON public.training_eligibility_decisions(subject_id, supersedes_source_revision_id)
  WHERE supersedes_source_revision_id IS NOT NULL;
CREATE INDEX coaching_relationships_practitioner_active
  ON public.coaching_relationships(practitioner_id, subject_id)
  WHERE status = 'active' AND ended_at IS NULL;

ALTER TABLE public.training_subjects
  ADD CONSTRAINT training_subjects_current_profile_revision_fkey
  FOREIGN KEY (id, current_profile_revision)
  REFERENCES public.training_profile_revisions(subject_id, revision)
  ON DELETE RESTRICT;

ALTER TABLE public.training_subjects
  ADD CONSTRAINT training_subjects_current_eligibility_decision_fkey
  FOREIGN KEY (id, current_eligibility_decision_source_revision_id)
  REFERENCES public.training_eligibility_decisions(subject_id, source_revision_id)
  ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION private.reject_training_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'training evidence is append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER training_profile_revisions_append_only
  BEFORE UPDATE OR DELETE ON public.training_profile_revisions
  FOR EACH ROW EXECUTE FUNCTION private.reject_training_evidence_mutation();
CREATE TRIGGER training_eligibility_responses_append_only
  BEFORE UPDATE OR DELETE ON public.training_eligibility_responses
  FOR EACH ROW EXECUTE FUNCTION private.reject_training_evidence_mutation();
CREATE TRIGGER training_eligibility_decisions_append_only
  BEFORE UPDATE OR DELETE ON public.training_eligibility_decisions
  FOR EACH ROW EXECUTE FUNCTION private.reject_training_evidence_mutation();

CREATE OR REPLACE FUNCTION private.enforce_training_subject_evidence_pointers()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.current_profile_revision IS DISTINCT FROM OLD.current_profile_revision
    AND (
      NEW.current_profile_revision IS NULL
      OR NEW.current_profile_revision <> COALESCE(OLD.current_profile_revision, 0) + 1
    )
  THEN
    RAISE EXCEPTION 'current profile pointer must advance exactly once'
      USING ERRCODE = '40001';
  END IF;

  IF NEW.current_eligibility_decision_source_revision_id
    IS DISTINCT FROM OLD.current_eligibility_decision_source_revision_id
    AND (
      NEW.current_eligibility_decision_source_revision_id IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM public.training_eligibility_decisions decision
        WHERE decision.subject_id = NEW.id
          AND decision.source_revision_id = NEW.current_eligibility_decision_source_revision_id
          AND decision.supersedes_source_revision_id
            IS NOT DISTINCT FROM OLD.current_eligibility_decision_source_revision_id
      )
    )
  THEN
    RAISE EXCEPTION 'current eligibility pointer must follow the supersession chain'
      USING ERRCODE = '40001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER training_subjects_evidence_pointer_transition
  BEFORE UPDATE OF current_profile_revision,
    current_eligibility_decision_source_revision_id
  ON public.training_subjects
  FOR EACH ROW EXECUTE FUNCTION private.enforce_training_subject_evidence_pointers();

CREATE OR REPLACE FUNCTION private.enforce_coaching_relationship_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.status = 'revoked' THEN
    RAISE EXCEPTION 'revoked coaching relationships cannot be restored'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.id <> OLD.id
    OR NEW.subject_id <> OLD.subject_id
    OR NEW.practitioner_id <> OLD.practitioner_id
    OR NEW.started_at <> OLD.started_at
    OR NEW.created_at <> OLD.created_at
  THEN
    RAISE EXCEPTION 'coaching relationship identity is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'coaching relationship revision must advance exactly once'
      USING ERRCODE = '40001';
  END IF;
  IF NEW.status = 'revoked' AND NEW.ended_at IS NULL THEN
    RAISE EXCEPTION 'revoked coaching relationship requires an end time'
      USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := pg_catalog.clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER coaching_relationships_transition
  BEFORE UPDATE ON public.coaching_relationships
  FOR EACH ROW EXECUTE FUNCTION private.enforce_coaching_relationship_transition();

CREATE OR REPLACE FUNCTION private.is_training_subject_coach(
  p_subject_id uuid,
  p_permission text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    private.is_active_aal2_practitioner()
    AND auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.training_subjects subject
      JOIN public.coaching_relationships relationship
        ON relationship.subject_id = subject.id
      WHERE subject.id = p_subject_id
        AND subject.status = 'active'
        AND subject.revoked_at IS NULL
        AND subject.deleted_at IS NULL
        AND relationship.practitioner_id = auth.uid()
        AND relationship.status = 'active'
        AND relationship.ended_at IS NULL
        AND p_permission = ANY(relationship.permissions::text[])
    );
$$;

ALTER TABLE public.training_profile_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_eligibility_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_eligibility_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coaching_relationships ENABLE ROW LEVEL SECURITY;

CREATE POLICY training_profile_revisions_read_authorized
  ON public.training_profile_revisions
  FOR SELECT TO authenticated
  USING (
    (SELECT private.is_training_subject_owner(subject_id))
    OR (SELECT private.is_training_subject_coach(subject_id, 'profile:read'))
  );

CREATE POLICY training_eligibility_responses_read_owner
  ON public.training_eligibility_responses
  FOR SELECT TO authenticated
  USING ((SELECT private.is_training_subject_owner(subject_id)));

CREATE POLICY training_eligibility_decisions_read_owner
  ON public.training_eligibility_decisions
  FOR SELECT TO authenticated
  USING ((SELECT private.is_training_subject_owner(subject_id)));

CREATE POLICY coaching_relationships_read_participant
  ON public.coaching_relationships
  FOR SELECT TO authenticated
  USING (
    (SELECT private.is_training_subject_owner(subject_id))
    OR (
      practitioner_id = auth.uid()
      AND status = 'active'
      AND ended_at IS NULL
      AND (SELECT private.is_active_aal2_practitioner())
    )
  );

CREATE OR REPLACE FUNCTION public.append_training_profile_revision(
  p_subject_id uuid,
  p_expected_revision bigint,
  p_profile_json jsonb
)
RETURNS TABLE (revision bigint, profile_hash text, hash_encoding text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_subject public.training_subjects%ROWTYPE;
  v_revision bigint;
  v_profile_hash text;
BEGIN
  IF auth.uid() IS NULL OR COALESCE(auth.jwt()->>'aal', '') <> 'aal2' THEN
    RAISE EXCEPTION 'current AAL2 user is required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_subject
  FROM public.training_subjects
  WHERE id = p_subject_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_subject.status <> 'active'
    OR v_subject.revoked_at IS NOT NULL
    OR v_subject.deleted_at IS NOT NULL
  THEN
    RAISE EXCEPTION 'training subject is unavailable' USING ERRCODE = 'P0001';
  END IF;

  IF v_subject.owner_user_id <> auth.uid()
    AND NOT private.is_training_subject_coach(p_subject_id, 'profile:write')
  THEN
    RAISE EXCEPTION 'profile write is not authorized' USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(v_subject.current_profile_revision, 0) <> p_expected_revision THEN
    RAISE EXCEPTION 'profile revision changed concurrently' USING ERRCODE = '40001';
  END IF;

  IF private.is_valid_training_profile(p_profile_json) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'profile does not match athlete-training-profile.v1'
      USING ERRCODE = '22023';
  END IF;

  v_revision := p_expected_revision + 1;
  v_profile_hash := private.training_evidence_sha256(p_profile_json);
  INSERT INTO public.training_profile_revisions (
    subject_id, revision, schema_version, profile_json, profile_hash, hash_encoding,
    created_by_user_id
  ) VALUES (
    p_subject_id,
    v_revision,
    p_profile_json->>'schemaVersion',
    p_profile_json,
    v_profile_hash,
    'postgres-jsonb-text-utf8.v1',
    auth.uid()
  );

  UPDATE public.training_subjects
  SET current_profile_revision = v_revision
  WHERE id = p_subject_id;

  revision := v_revision;
  profile_hash := v_profile_hash;
  hash_encoding := 'postgres-jsonb-text-utf8.v1';
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.append_training_eligibility_response(
  p_subject_id uuid,
  p_expected_revision bigint,
  p_source_revision_id text,
  p_answers_json jsonb
)
RETURNS TABLE (
  revision bigint,
  source_revision_id text,
  answers_hash text,
  hash_encoding text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_subject public.training_subjects%ROWTYPE;
  v_current_revision bigint;
  v_answers_hash text;
BEGIN
  IF auth.uid() IS NULL OR COALESCE(auth.jwt()->>'aal', '') <> 'aal2' THEN
    RAISE EXCEPTION 'current AAL2 athlete is required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_subject
  FROM public.training_subjects
  WHERE id = p_subject_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_subject.owner_user_id <> auth.uid()
    OR v_subject.status <> 'active'
    OR v_subject.revoked_at IS NOT NULL
    OR v_subject.deleted_at IS NOT NULL
  THEN
    RAISE EXCEPTION 'eligibility answer write is not authorized'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(pg_catalog.max(response.revision), 0)
  INTO v_current_revision
  FROM public.training_eligibility_responses response
  WHERE response.subject_id = p_subject_id;

  IF v_current_revision <> p_expected_revision THEN
    RAISE EXCEPTION 'eligibility answer revision changed concurrently'
      USING ERRCODE = '40001';
  END IF;

  IF private.is_valid_training_answers(p_answers_json) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'answers do not match eligibility-answers.v1'
      USING ERRCODE = '22023';
  END IF;
  IF p_source_revision_id IS DISTINCT FROM p_answers_json->>'sourceRevisionId'
    AND p_answers_json ? 'sourceRevisionId'
  THEN
    RAISE EXCEPTION 'answers source revision does not match the document'
      USING ERRCODE = '22023';
  END IF;

  revision := p_expected_revision + 1;
  source_revision_id := p_source_revision_id;
  v_answers_hash := private.training_evidence_sha256(p_answers_json);
  INSERT INTO public.training_eligibility_responses (
    subject_id, revision, source_revision_id, schema_version,
    questionnaire_source_version, answers_json, answers_hash, hash_encoding,
    submitted_by_user_id, submitted_at
  ) VALUES (
    p_subject_id,
    revision,
    p_source_revision_id,
    p_answers_json->>'schemaVersion',
    p_answers_json->>'questionnaireSourceVersion',
    p_answers_json,
    v_answers_hash,
    'postgres-jsonb-text-utf8.v1',
    auth.uid(),
    (p_answers_json->>'submittedAt')::timestamptz
  );
  answers_hash := v_answers_hash;
  hash_encoding := 'postgres-jsonb-text-utf8.v1';
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_training_eligibility_decision(
  p_subject_id uuid,
  p_expected_current_source_revision_id text,
  p_decision_json jsonb
)
RETURNS TABLE (
  source_revision_id text,
  state public.training_eligibility_state,
  decision_hash text,
  hash_encoding text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_subject public.training_subjects%ROWTYPE;
  v_source_kind public.training_eligibility_source_kind;
  v_constraint_set jsonb;
  v_decision_hash text;
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'eligibility decision service authority is required'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_subject
  FROM public.training_subjects
  WHERE id = p_subject_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_subject.status <> 'active'
    OR v_subject.revoked_at IS NOT NULL
    OR v_subject.deleted_at IS NOT NULL
  THEN
    RAISE EXCEPTION 'training subject is unavailable' USING ERRCODE = 'P0001';
  END IF;

  IF v_subject.current_eligibility_decision_source_revision_id
    IS DISTINCT FROM p_expected_current_source_revision_id
  THEN
    RAISE EXCEPTION 'eligibility decision changed concurrently'
      USING ERRCODE = '40001';
  END IF;

  IF p_decision_json->>'supersededAt' IS NOT NULL THEN
    RAISE EXCEPTION 'a newly current decision cannot already be superseded'
      USING ERRCODE = '23514';
  END IF;
  IF private.is_valid_training_decision(p_decision_json) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'decision does not match eligibility-decision.v1'
      USING ERRCODE = '22023';
  END IF;

  source_revision_id := p_decision_json->>'sourceRevisionId';
  state := (p_decision_json->>'state')::public.training_eligibility_state;
  v_source_kind := (p_decision_json#>>'{source,kind}')::public.training_eligibility_source_kind;
  v_constraint_set := CASE
    WHEN pg_catalog.jsonb_typeof(p_decision_json->'constraintSet') = 'null' THEN NULL
    ELSE p_decision_json->'constraintSet'
  END;
  v_decision_hash := private.training_evidence_sha256(p_decision_json);

  INSERT INTO public.training_eligibility_decisions (
    subject_id, source_revision_id, answers_revision_id, schema_version,
    answers_schema_version, questionnaire_source_version, policy_version,
    state, scope, source_kind, source_version, reviewer_reference,
    scope_evidence_reference, effective_from, effective_until,
    supersedes_source_revision_id, constraint_set, decision_json, decision_hash,
    hash_encoding
  ) VALUES (
    p_subject_id,
    source_revision_id,
    p_decision_json->>'answersRevisionId',
    p_decision_json->>'schemaVersion',
    p_decision_json->>'answersSchemaVersion',
    p_decision_json->>'questionnaireSourceVersion',
    p_decision_json->>'policyVersion',
    state,
    (p_decision_json->>'scope')::public.training_eligibility_scope,
    v_source_kind,
    p_decision_json#>>'{source,sourceVersion}',
    p_decision_json#>>'{source,reviewerReference}',
    p_decision_json#>>'{source,scopeEvidenceReference}',
    (p_decision_json->>'effectiveFrom')::timestamptz,
    (p_decision_json->>'effectiveUntil')::timestamptz,
    p_expected_current_source_revision_id,
    v_constraint_set,
    p_decision_json,
    v_decision_hash,
    'postgres-jsonb-text-utf8.v1'
  );

  UPDATE public.training_subjects
  SET current_eligibility_decision_source_revision_id = source_revision_id
  WHERE id = p_subject_id;

  decision_hash := v_decision_hash;
  hash_encoding := 'postgres-jsonb-text-utf8.v1';
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_training_coaching_relationship(
  p_relationship_id uuid,
  p_expected_revision bigint
)
RETURNS TABLE (
  status public.training_coaching_relationship_status,
  revision bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_relationship public.coaching_relationships%ROWTYPE;
  v_subject public.training_subjects%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR COALESCE(auth.jwt()->>'aal', '') <> 'aal2' THEN
    RAISE EXCEPTION 'current AAL2 user is required' USING ERRCODE = '42501';
  END IF;

  SELECT relationship.* INTO v_relationship
  FROM public.coaching_relationships relationship
  WHERE relationship.id = p_relationship_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_relationship.status <> 'active'
    OR v_relationship.ended_at IS NOT NULL
  THEN
    RAISE EXCEPTION 'coaching relationship is unavailable' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_subject
  FROM public.training_subjects
  WHERE id = v_relationship.subject_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_subject.status <> 'active'
    OR v_subject.revoked_at IS NOT NULL
    OR v_subject.deleted_at IS NOT NULL
  THEN
    RAISE EXCEPTION 'training subject is unavailable' USING ERRCODE = 'P0001';
  END IF;

  IF v_subject.owner_user_id <> auth.uid()
    AND (
      v_relationship.practitioner_id <> auth.uid()
      OR NOT private.is_training_subject_coach(
        v_relationship.subject_id,
        'relationship:revoke'
      )
    )
  THEN
    RAISE EXCEPTION 'relationship revocation is not authorized'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_relationship.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'coaching relationship changed concurrently'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.coaching_relationships relationship
  SET status = 'revoked',
      ended_at = pg_catalog.clock_timestamp(),
      revision = relationship.revision + 1
  WHERE relationship.id = p_relationship_id
  RETURNING relationship.status, relationship.revision
  INTO status, revision;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON public.training_profile_revisions,
  public.training_eligibility_responses,
  public.training_eligibility_decisions,
  public.coaching_relationships
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT SELECT ON public.training_profile_revisions,
  public.training_eligibility_responses,
  public.training_eligibility_decisions,
  public.coaching_relationships
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION private.reject_training_evidence_mutation()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION private.jsonb_has_exact_keys(jsonb, text[])
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION private.is_stable_training_reference(text, integer)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION private.is_iso_datetime(text)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION private.is_training_timezone(text)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION private.canonical_training_load_kg(text, text)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION private.is_exact_training_quantity(jsonb)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION private.is_valid_training_profile(jsonb)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION private.is_valid_training_answers(jsonb)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION private.is_valid_training_decision(jsonb)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION private.training_evidence_sha256(jsonb)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION private.enforce_training_subject_evidence_pointers()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION private.enforce_coaching_relationship_transition()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION private.is_training_subject_coach(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION public.append_training_profile_revision(uuid, bigint, jsonb)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION public.append_training_eligibility_response(uuid, bigint, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION public.record_training_eligibility_decision(uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION public.revoke_training_coaching_relationship(uuid, bigint)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT EXECUTE ON FUNCTION private.is_training_subject_coach(uuid, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.append_training_profile_revision(uuid, bigint, jsonb)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.append_training_eligibility_response(uuid, bigint, text, jsonb)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_training_coaching_relationship(uuid, bigint)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_training_eligibility_decision(uuid, text, jsonb)
  TO service_role;
