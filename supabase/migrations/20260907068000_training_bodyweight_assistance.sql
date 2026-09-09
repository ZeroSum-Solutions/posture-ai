-- Preserve the full current profile validator while admitting two exact,
-- unsigned bodyweight/assistance equipment inventories.
CREATE OR REPLACE FUNCTION private.is_valid_training_profile(p_value jsonb)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_origin jsonb;
  v_preference jsonb;
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
  IF COALESCE(NOT private.jsonb_has_exact_keys(p_value - ARRAY['strengthProgrammingStyle','conditioningPreference'], ARRAY[
    'schemaVersion', 'origin', 'goal', 'experience', 'recentConsistency',
    'cycleLengthWeeks', 'strengthDays', 'localTimezone',
    'sessionTimeBudgetMinutes', 'preferredLoadUnit', 'equipmentInventory',
    'startingHistory'
  ]), true) THEN RETURN false; END IF;

  IF p_value ? 'strengthProgrammingStyle' AND NOT COALESCE(
    pg_catalog.jsonb_typeof(p_value->'strengthProgrammingStyle') = 'string'
    AND p_value->>'strengthProgrammingStyle' IN ('repeatable','intermediate_undulating')
    AND (p_value->>'strengthProgrammingStyle' <> 'intermediate_undulating'
      OR p_value->>'experience' = 'intermediate'),false) THEN RETURN false; END IF;

  IF p_value ? 'conditioningPreference' THEN
    v_preference := p_value->'conditioningPreference';
    IF COALESCE(pg_catalog.jsonb_typeof(v_preference) <> 'object'
      OR NOT private.jsonb_has_exact_keys(v_preference, ARRAY[
        'schemaVersion','catalogVersion','preferredModalityIds'
      ])
      OR v_preference->>'schemaVersion' <> 'conditioning-preference.v1'
      OR NOT private.is_stable_training_reference(v_preference->>'catalogVersion', 128)
      OR pg_catalog.jsonb_typeof(v_preference->'preferredModalityIds') <> 'array'
      OR pg_catalog.jsonb_array_length(v_preference->'preferredModalityIds') NOT BETWEEN 1 AND 8,
      true
    ) THEN RETURN false; END IF;

    IF EXISTS (
      SELECT 1 FROM pg_catalog.jsonb_array_elements(v_preference->'preferredModalityIds') modality
      WHERE pg_catalog.jsonb_typeof(modality) <> 'string'
        OR NOT private.is_stable_training_reference(modality#>>'{}', 128)
    ) OR (
      SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_array_elements(v_preference->'preferredModalityIds')
    ) <> (
      SELECT pg_catalog.count(DISTINCT modality#>>'{}')
      FROM pg_catalog.jsonb_array_elements(v_preference->'preferredModalityIds') modality
    ) THEN RETURN false; END IF;
  END IF;

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
    ELSIF v_inventory->>'kind' IN (
      'dumbbell','machine','bodyweight_external','assistance_machine'
    ) THEN
      v_loads := v_inventory -> (
        CASE v_inventory->>'kind'
          WHEN 'dumbbell' THEN 'perHandLoads'
          WHEN 'machine' THEN 'stackLoads'
          WHEN 'bodyweight_external' THEN 'externalLoads'
          ELSE 'assistanceLoads'
        END
      );
      IF COALESCE(NOT private.jsonb_has_exact_keys(v_inventory, CASE v_inventory->>'kind'
          WHEN 'dumbbell' THEN ARRAY['kind','equipmentId','unit','perHandLoads']
          WHEN 'machine' THEN ARRAY['kind','equipmentId','unit','stackLoads']
          WHEN 'bodyweight_external' THEN ARRAY['kind','equipmentId','unit','externalLoads']
          ELSE ARRAY['kind','equipmentId','unit','assistanceLoads'] END)
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
        WHEN 'bodyweight_external' THEN v_history#>>'{equipmentLoad,basis}' = 'bodyweight_external'
        WHEN 'assistance_machine' THEN v_history#>>'{equipmentLoad,basis}' = 'machine_assistance'
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

-- This validator preserves immutable policy identity. It does not decide that
-- a policy is reviewed or clinically valid: the trusted server-side catalog
-- registry makes that decision before inserting the compiled document.
CREATE OR REPLACE FUNCTION private.is_valid_training_bodyweight_assistance_load(
  p_load jsonb,
  p_exercise jsonb,
  p_document jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_basis text := p_load->>'loadBasis';
  v_policy jsonb := p_load->'bodyweightAssistancePolicy';
  v_provenance jsonb := p_load->'provenance';
BEGIN
  IF v_basis NOT IN ('bodyweight_external','machine_assistance') THEN
    RETURN NOT (p_load ? 'bodyweightAssistancePolicy');
  END IF;

  IF COALESCE(
    NOT private.jsonb_has_exact_keys(p_load, ARRAY[
      'status','acceptanceId','acceptedAt','acceptedByUserId','source',
      'executionContext','exerciseInstanceId','exerciseVersionId','equipmentId',
      'provenance','bodyweightAssistancePolicy','quantity','loadBasis',
      'implementCount','holdingConfiguration'
    ])
    OR p_load->>'status' <> 'accepted'
    OR p_load->>'source' <> 'equipment_inventory'
    OR NOT private.is_stable_training_reference(p_load->>'acceptanceId',128)
    OR NOT private.is_iso_datetime(p_load->>'acceptedAt')
    OR NOT private.is_stable_training_reference(p_load->>'acceptedByUserId',128)
    OR NOT private.is_stable_training_reference(p_load->>'equipmentId',128)
    OR NOT private.is_exact_training_quantity(p_load->'quantity')
    OR p_load->'executionContext' IS DISTINCT FROM p_document->'executionContext'
    OR p_load->>'exerciseInstanceId' IS DISTINCT FROM p_exercise->>'exerciseInstanceId'
    OR p_load->>'exerciseVersionId' IS DISTINCT FROM p_exercise->>'exerciseVersionId'
    OR NOT private.jsonb_has_exact_keys(v_policy,ARRAY['policyId','policyVersion'])
    OR NOT private.is_stable_training_reference(v_policy->>'policyId',128)
    OR NOT private.is_stable_training_reference(v_policy->>'policyVersion',128)
    OR NOT private.jsonb_has_exact_keys(v_provenance,ARRAY[
      'profileRevisionId','compiledProgramRevisionId','catalogVersion','catalogOrigin'
    ])
    OR v_provenance->>'profileRevisionId' IS DISTINCT FROM p_document->>'profileRevisionId'
    OR v_provenance->>'compiledProgramRevisionId'
      IS DISTINCT FROM p_document->>'compiledProgramRevisionId'
    OR v_provenance->>'catalogVersion' IS DISTINCT FROM p_document->>'catalogVersion'
    OR v_provenance->'catalogOrigin' IS DISTINCT FROM p_document->'catalogOrigin'
    OR NOT (
      (v_basis = 'bodyweight_external'
        AND p_load->'implementCount' = '0'::jsonb
        AND p_load->>'holdingConfiguration' = 'bodyweight_plus_external_load')
      OR (v_basis = 'machine_assistance'
        AND p_load->'implementCount' = '1'::jsonb
        AND p_load->>'holdingConfiguration' = 'machine_assistance')
    ),
    true
  ) THEN RETURN false; END IF;

  RETURN true;
EXCEPTION WHEN data_exception OR invalid_text_representation OR numeric_value_out_of_range THEN
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION private.is_valid_training_bodyweight_assistance_load(jsonb,jsonb,jsonb)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE OR REPLACE FUNCTION private.is_training_bodyweight_assistance_load_configured(
  p_load jsonb,
  p_profile jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_basis text := p_load->>'loadBasis';
  v_inventory jsonb;
  v_values jsonb;
BEGIN
  IF v_basis NOT IN ('bodyweight_external','machine_assistance') THEN RETURN true; END IF;
  IF pg_catalog.jsonb_typeof(p_profile->'equipmentInventory') <> 'array' THEN RETURN false; END IF;

  SELECT item INTO v_inventory
  FROM pg_catalog.jsonb_array_elements(p_profile->'equipmentInventory') item
  WHERE item->>'equipmentId' = p_load->>'equipmentId';
  IF v_inventory IS NULL THEN RETURN false; END IF;

  IF v_basis = 'bodyweight_external' THEN
    IF v_inventory->>'kind' <> 'bodyweight_external' THEN RETURN false; END IF;
    v_values := v_inventory->'externalLoads';
  ELSE
    IF v_inventory->>'kind' <> 'assistance_machine' THEN RETURN false; END IF;
    v_values := v_inventory->'assistanceLoads';
  END IF;

  RETURN COALESCE(
    v_inventory->>'unit' = p_load#>>'{quantity,entered,unit}'
    AND pg_catalog.jsonb_typeof(v_values) = 'array'
    AND EXISTS (
      SELECT 1 FROM pg_catalog.jsonb_array_elements_text(v_values) configured(value)
      WHERE configured.value = p_load#>>'{quantity,entered,value}'
    ),
    false
  );
END;
$$;

REVOKE ALL ON FUNCTION private.is_training_bodyweight_assistance_load_configured(jsonb,jsonb)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE OR REPLACE FUNCTION private.enforce_training_bodyweight_assistance_document()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row jsonb := pg_catalog.to_jsonb(NEW);
  v_document jsonb := COALESCE(
    v_row->'build_json', v_row->'program_json', v_row->'prescription_json'
  );
  v_session jsonb;
  v_exercise jsonb;
  v_profile jsonb;
BEGIN
  SELECT profile_json INTO v_profile
  FROM public.training_profile_revisions
  WHERE subject_id = NEW.subject_id
    AND revision::text = v_document->>'profileRevisionId';

  IF v_document->>'schemaVersion' = 'training-session-prescription.v1' THEN
    IF pg_catalog.jsonb_typeof(v_document->'exercises') <> 'array' THEN
      RETURN NEW;
    END IF;
    FOR v_exercise IN SELECT value FROM pg_catalog.jsonb_array_elements(v_document->'exercises') LOOP
      IF v_exercise ? 'acceptedInitialLoad' AND (
        pg_catalog.jsonb_typeof(v_exercise->'acceptedInitialLoad') <> 'object'
        OR NOT private.is_valid_training_bodyweight_assistance_load(
          v_exercise->'acceptedInitialLoad',v_exercise,v_document
        )
        OR NOT private.is_training_bodyweight_assistance_load_configured(
          v_exercise->'acceptedInitialLoad',v_profile
        )
      ) THEN
        RAISE EXCEPTION 'invalid bodyweight or assistance prescription evidence'
          USING ERRCODE = '23514';
      END IF;
    END LOOP;
  ELSIF v_document->>'schemaVersion' = 'training-program-revision.v1'
    AND pg_catalog.jsonb_typeof(v_document->'sessions') = 'array' THEN
    FOR v_session IN SELECT value FROM pg_catalog.jsonb_array_elements(v_document->'sessions') LOOP
      IF pg_catalog.jsonb_typeof(v_session->'exercises') <> 'array' THEN CONTINUE; END IF;
      FOR v_exercise IN SELECT value FROM pg_catalog.jsonb_array_elements(v_session->'exercises') LOOP
        IF v_exercise ? 'acceptedInitialLoad' AND (
          pg_catalog.jsonb_typeof(v_exercise->'acceptedInitialLoad') <> 'object'
          OR NOT private.is_valid_training_bodyweight_assistance_load(
            v_exercise->'acceptedInitialLoad',v_exercise,v_document
          )
          OR NOT private.is_training_bodyweight_assistance_load_configured(
            v_exercise->'acceptedInitialLoad',v_profile
          )
        ) THEN
          RAISE EXCEPTION 'invalid bodyweight or assistance prescription evidence'
            USING ERRCODE = '23514';
        END IF;
      END LOOP;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_training_bodyweight_assistance_document()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE TRIGGER training_draft_bodyweight_assistance_evidence
  BEFORE INSERT ON public.training_program_drafts
  FOR EACH ROW EXECUTE FUNCTION private.enforce_training_bodyweight_assistance_document();
CREATE TRIGGER training_revision_bodyweight_assistance_evidence
  BEFORE INSERT ON public.training_program_revisions
  FOR EACH ROW EXECUTE FUNCTION private.enforce_training_bodyweight_assistance_document();
CREATE TRIGGER training_prescription_bodyweight_assistance_evidence
  BEFORE INSERT ON public.training_session_prescriptions
  FOR EACH ROW EXECUTE FUNCTION private.enforce_training_bodyweight_assistance_document();
