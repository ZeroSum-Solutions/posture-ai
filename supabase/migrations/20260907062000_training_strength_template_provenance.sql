-- Extend the existing exact-key profile validator with one bounded optional style.
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
  IF COALESCE(NOT private.jsonb_has_exact_keys(p_value - 'strengthProgrammingStyle', ARRAY[
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

-- Bind authored strength-template provenance across immutable build/draft/revision rows.
-- Legacy repeatable documents remain valid. This does not activate a live template.
CREATE OR REPLACE FUNCTION private.validate_training_strength_template_document(p_document jsonb)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  v_style text := p_document->>'strengthProgrammingStyle';
  v_template jsonb := p_document->'strengthTemplate';
  v_context jsonb := p_document->'executionContext';
BEGIN
  IF v_style IS NULL OR v_style = 'repeatable' THEN
    RETURN NOT (p_document ? 'strengthTemplate');
  END IF;
  IF v_style <> 'intermediate_undulating' THEN RETURN false; END IF;
  IF NOT COALESCE(
    pg_catalog.jsonb_typeof(v_template) = 'object'
    AND v_template->>'schemaVersion' = 'strength-template.v1'
    AND v_template->>'style' = v_style
    AND p_document->>'compilerPolicyVersion' = 'strength-cycle-compiler.v3'
    AND private.is_stable_training_reference(v_template->>'templateId',128)
    AND private.is_stable_training_reference(v_template->>'templateVersion',128), false)
  THEN RETURN false; END IF;
  IF v_context->>'kind' = 'synthetic_simulation' THEN
    RETURN COALESCE(v_template#>>'{provenance,kind}' = 'synthetic_fixture'
      AND v_template#>>'{provenance,fixtureId}' = v_context->>'fixtureId'
      AND v_template#>>'{provenance,fixtureHash}' = v_context->>'fixtureHash'
      AND v_template#>>'{provenance,label}' = v_context->>'label',false);
  END IF;
  RETURN COALESCE(v_context = '{"kind":"live"}'::jsonb
    AND v_template#>>'{provenance,kind}' = 'reviewed_authored_template'
    AND private.is_stable_training_reference(v_template#>>'{provenance,templateRecordId}',128)
    AND private.is_stable_training_reference(v_template#>>'{provenance,reviewRecordId}',128)
    AND private.is_iso_datetime(v_template#>>'{provenance,reviewedAt}'),false);
END;
$$;
REVOKE ALL ON FUNCTION private.validate_training_strength_template_document(jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.enforce_training_strength_template_provenance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_row jsonb := pg_catalog.to_jsonb(NEW);
  v_document jsonb := COALESCE(v_row->'build_json',v_row->'program_json');
  v_source jsonb;
  v_profile jsonb;
BEGIN
  IF NOT private.validate_training_strength_template_document(v_document) THEN
    RAISE EXCEPTION 'invalid strength template provenance' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME IN ('training_program_builds','training_program_drafts') THEN
    SELECT profile_json INTO v_profile FROM public.training_profile_revisions
      WHERE subject_id = NEW.subject_id AND revision = NEW.profile_revision;
    IF COALESCE(v_document->>'strengthProgrammingStyle','repeatable')
        IS DISTINCT FROM COALESCE(v_profile->>'strengthProgrammingStyle','repeatable')
      OR (v_document->>'strengthProgrammingStyle' = 'intermediate_undulating'
        AND v_profile->>'experience' IS DISTINCT FROM 'intermediate') THEN
      RAISE EXCEPTION 'strength template does not match saved profile' USING ERRCODE = '23514';
    END IF;
    IF TG_TABLE_NAME = 'training_program_drafts' AND v_row->>'source_build_id' IS NOT NULL THEN
      SELECT build_json INTO v_source FROM public.training_program_builds
        WHERE id = (v_row->>'source_build_id')::uuid AND subject_id = NEW.subject_id;
    END IF;
  ELSE
    IF NEW.revision_number = 1 THEN
      SELECT draft.program_json INTO v_source FROM public.training_program_assignments assignment
        JOIN public.training_program_drafts draft ON draft.id = assignment.source_draft_id
        WHERE assignment.id = NEW.assignment_id AND assignment.subject_id = NEW.subject_id;
    ELSE
      SELECT program_json INTO v_source FROM public.training_program_revisions
        WHERE assignment_id = NEW.assignment_id AND revision_number = NEW.revision_number - 1;
    END IF;
  END IF;
  IF v_source IS NOT NULL AND (
    v_document->'strengthProgrammingStyle' IS DISTINCT FROM v_source->'strengthProgrammingStyle'
    OR v_document->'strengthTemplate' IS DISTINCT FROM v_source->'strengthTemplate') THEN
    RAISE EXCEPTION 'strength template changed from immutable source' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.enforce_training_strength_template_provenance() FROM PUBLIC;
CREATE TRIGGER training_build_strength_template BEFORE INSERT ON public.training_program_builds
  FOR EACH ROW EXECUTE FUNCTION private.enforce_training_strength_template_provenance();
CREATE TRIGGER training_draft_strength_template BEFORE INSERT ON public.training_program_drafts
  FOR EACH ROW EXECUTE FUNCTION private.enforce_training_strength_template_provenance();
CREATE TRIGGER training_revision_strength_template BEFORE INSERT ON public.training_program_revisions
  FOR EACH ROW EXECUTE FUNCTION private.enforce_training_strength_template_provenance();
