BEGIN;

SELECT plan(4);

CREATE TEMP TABLE expected_training_conflict_functions (
  schema_name text NOT NULL,
  function_name text NOT NULL,
  expected_pt409_count integer NOT NULL,
  PRIMARY KEY (schema_name, function_name)
) ON COMMIT DROP;

INSERT INTO expected_training_conflict_functions (
  schema_name,
  function_name,
  expected_pt409_count
)
VALUES
  ('private', 'enforce_training_subject_evidence_pointers', 2),
  ('private', 'enforce_coaching_relationship_transition', 1),
  ('public', 'append_training_profile_revision', 1),
  ('public', 'append_training_eligibility_response', 1),
  ('public', 'record_training_eligibility_decision', 1),
  ('public', 'revoke_training_coaching_relationship', 1),
  ('public', 'handle_new_user', 1),
  ('private', 'enforce_training_assignment_identity', 1),
  ('private', 'assert_training_program_eligibility', 2),
  ('public', 'start_training_session', 1),
  ('public', 'write_training_set_log', 2),
  ('public', 'write_training_conditioning_log', 2),
  ('public', 'complete_training_session', 3),
  ('public', 'resolve_training_program_build_source', 1);

CREATE TEMP VIEW actual_training_conflict_functions AS
SELECT
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN expected_training_conflict_functions e
  ON e.schema_name = n.nspname
 AND e.function_name = p.proname;

SELECT is(
  (SELECT count(*) FROM actual_training_conflict_functions),
  14::bigint,
  'all 14 training conflict functions exist without unexpected overloads'
);

SELECT is(
  (
    SELECT count(*)
    FROM expected_training_conflict_functions e
    LEFT JOIN actual_training_conflict_functions a
      USING (schema_name, function_name)
    WHERE a.function_name IS NULL
  ),
  0::bigint,
  'the SQLSTATE inventory has no missing functions'
);

SELECT is(
  (
    SELECT count(*)
    FROM expected_training_conflict_functions e
    JOIN actual_training_conflict_functions a
      USING (schema_name, function_name)
    WHERE (
      (length(a.definition) - length(replace(a.definition, '''PT409''', '')))
      / length('''PT409''')
    ) <> e.expected_pt409_count
  ),
  0::bigint,
  'all 20 deliberate training conflicts use PT409 in their expected functions'
);

SELECT is(
  (
    SELECT count(*)
    FROM actual_training_conflict_functions
    WHERE definition LIKE '%''40001''%'
  ),
  0::bigint,
  'no training business conflict function retains serialization SQLSTATE 40001'
);

SELECT * FROM finish();

ROLLBACK;
