-- Persist the compiler-authored 4, 6, 8, or 12 week horizon explicitly.
-- Existing eight-week rows satisfy these constraints without rewriting JSON.

DO $$
DECLARE
  v_constraint_names name[];
BEGIN
  SELECT pg_catalog.array_agg(constraint_record.conname ORDER BY constraint_record.conname)
  INTO v_constraint_names
  FROM pg_catalog.pg_constraint constraint_record
  WHERE constraint_record.conrelid = 'public.training_program_drafts'::pg_catalog.regclass
    AND constraint_record.contype = 'c'
    AND pg_catalog.pg_get_constraintdef(constraint_record.oid) LIKE '%cycleLengthWeeks%';

  IF pg_catalog.cardinality(v_constraint_names) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'expected exactly one legacy training draft cycle-length constraint';
  END IF;

  EXECUTE pg_catalog.format(
    'ALTER TABLE public.training_program_drafts DROP CONSTRAINT %I',
    v_constraint_names[1]
  );
END;
$$;

ALTER TABLE public.training_program_builds
  ADD CONSTRAINT training_program_builds_cycle_horizon CHECK ((
    CASE
      -- Builds created by the released eight-week compilers did not carry an
      -- explicit length. Preserve that immutable, policy-bound eight-week shape.
      WHEN compiler_policy_version IN ('eight-week-compiler.v1', 'eight-week-compiler.v2')
        AND NOT (build_json ? 'cycleLengthWeeks')
        AND pg_catalog.jsonb_typeof(build_json->'weeks') = 'array'
      THEN pg_catalog.jsonb_array_length(build_json->'weeks') = 8
      WHEN compiler_policy_version = 'strength-cycle-compiler.v3'
        AND build_json->>'cycleLengthWeeks' IN ('4', '6', '8', '12')
        AND pg_catalog.jsonb_typeof(build_json->'weeks') = 'array'
      THEN pg_catalog.jsonb_array_length(build_json->'weeks') = CASE build_json->>'cycleLengthWeeks'
        WHEN '4' THEN 4
        WHEN '6' THEN 6
        WHEN '8' THEN 8
        WHEN '12' THEN 12
      END
      ELSE false
    END
  ) IS TRUE) NOT VALID;

ALTER TABLE public.training_program_builds
  VALIDATE CONSTRAINT training_program_builds_cycle_horizon;

ALTER TABLE public.training_program_drafts
  ADD CONSTRAINT training_program_drafts_cycle_length CHECK ((
    (program_json->>'compilerPolicyVersion' IN ('eight-week-compiler.v1', 'eight-week-compiler.v2')
      AND program_json->>'cycleLengthWeeks' = '8')
    OR (program_json->>'compilerPolicyVersion' = 'strength-cycle-compiler.v3'
      AND program_json->>'cycleLengthWeeks' IN ('4', '6', '8', '12'))
  ) IS TRUE) NOT VALID;

ALTER TABLE public.training_program_drafts
  VALIDATE CONSTRAINT training_program_drafts_cycle_length;

ALTER TABLE public.training_program_revisions
  ADD CONSTRAINT training_program_revisions_cycle_length CHECK ((
    (program_json->>'compilerPolicyVersion' IN ('eight-week-compiler.v1', 'eight-week-compiler.v2')
      AND program_json->>'cycleLengthWeeks' = '8')
    OR (program_json->>'compilerPolicyVersion' = 'strength-cycle-compiler.v3'
      AND program_json->>'cycleLengthWeeks' IN ('4', '6', '8', '12'))
  ) IS TRUE) NOT VALID;

ALTER TABLE public.training_program_revisions
  VALIDATE CONSTRAINT training_program_revisions_cycle_length;

CREATE OR REPLACE FUNCTION private.enforce_training_program_cycle_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_source_cycle_length text;
BEGIN
  IF NEW.source_build_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT build.build_json->>'cycleLengthWeeks'
  INTO v_source_cycle_length
  FROM public.training_program_builds build
  WHERE build.id = NEW.source_build_id
    AND build.subject_id = NEW.subject_id;

  IF NOT FOUND
    OR NEW.program_json->>'cycleLengthWeeks' IS DISTINCT FROM v_source_cycle_length
  THEN
    RAISE EXCEPTION 'accepted training draft cycle does not match its source build'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS training_program_drafts_cycle_source_insert
  ON public.training_program_drafts;
CREATE TRIGGER training_program_drafts_cycle_source_insert
  BEFORE INSERT ON public.training_program_drafts
  FOR EACH ROW EXECUTE FUNCTION private.enforce_training_program_cycle_source();

REVOKE ALL ON FUNCTION private.enforce_training_program_cycle_source()
  FROM PUBLIC, anon, authenticated, service_role;
