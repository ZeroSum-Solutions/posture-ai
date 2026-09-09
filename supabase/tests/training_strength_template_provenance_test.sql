BEGIN;
SELECT no_plan();
SELECT ok(private.validate_training_strength_template_document('{}'::jsonb),'legacy repeatable document remains compatible');
SELECT ok(private.validate_training_strength_template_document('{"strengthProgrammingStyle":"repeatable"}'::jsonb),'explicit repeatable requires no template');
SELECT ok(NOT private.validate_training_strength_template_document('{"strengthTemplate":{}}'::jsonb),'template without style is rejected');
SELECT ok(NOT private.validate_training_strength_template_document('{"strengthProgrammingStyle":"repeatable","strengthTemplate":{}}'::jsonb),'repeatable cannot carry undulating provenance');
SELECT ok(NOT private.validate_training_strength_template_document('{"strengthProgrammingStyle":"intermediate_undulating"}'::jsonb),'undulating requires template provenance');
CREATE TEMP TABLE template_fixture(document jsonb);
INSERT INTO template_fixture VALUES ('{
 "strengthProgrammingStyle":"intermediate_undulating","compilerPolicyVersion":"strength-cycle-compiler.v3",
 "executionContext":{"kind":"synthetic_simulation","fixtureId":"template-test.v1","fixtureHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","label":"Practice data"},
 "strengthTemplate":{"schemaVersion":"strength-template.v1","style":"intermediate_undulating","templateId":"intermediate-undulating","templateVersion":"intermediate-undulating.v1","provenance":{"kind":"synthetic_fixture","fixtureId":"template-test.v1","fixtureHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","label":"Practice data"}}
}');
SELECT ok(private.validate_training_strength_template_document(document),'exact synthetic provenance is valid') FROM template_fixture;
SELECT ok(NOT private.validate_training_strength_template_document(jsonb_set(document,'{strengthTemplate,provenance,fixtureHash}','"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"')),'different fixture hash is rejected') FROM template_fixture;
SELECT ok(NOT private.validate_training_strength_template_document(jsonb_set(document,'{executionContext}','{"kind":"live"}')),'synthetic provenance cannot become live') FROM template_fixture;
SELECT ok(NOT private.validate_training_strength_template_document(jsonb_set(document,'{compilerPolicyVersion}','"strength-compiler.v1"')),'legacy policy cannot carry undulating provenance') FROM template_fixture;
SELECT ok(NOT private.validate_training_strength_template_document(jsonb_set(document,'{strengthTemplate,provenance,label}','"Simulation"')),'fixture label remains exact') FROM template_fixture;
SELECT has_trigger('public','training_program_builds','training_build_strength_template','build insert has provenance enforcement');
SELECT has_trigger('public','training_program_drafts','training_draft_strength_template','accepted draft insert has provenance enforcement');
SELECT has_trigger('public','training_program_revisions','training_revision_strength_template','published revision insert has provenance enforcement');
CREATE TEMP TABLE profile_fixture(document jsonb);
INSERT INTO profile_fixture VALUES ('{"schemaVersion":"athlete-training-profile.v1","origin":{"kind":"athlete_input"},"goal":"strength","experience":"intermediate","recentConsistency":"consistent","cycleLengthWeeks":8,"strengthDays":["monday","thursday"],"localTimezone":"UTC","sessionTimeBudgetMinutes":45,"preferredLoadUnit":"kg","equipmentInventory":[],"startingHistory":[]}');
SELECT ok(private.is_valid_training_profile(document),'legacy profile still passes exact-key validator') FROM profile_fixture;
SELECT ok(private.is_valid_training_profile(document || '{"strengthProgrammingStyle":"repeatable"}'),'explicit repeatable profile is accepted') FROM profile_fixture;
SELECT ok(private.is_valid_training_profile(document || '{"strengthProgrammingStyle":"intermediate_undulating"}'),'intermediate undulating profile is accepted') FROM profile_fixture;
SELECT ok(NOT private.is_valid_training_profile(document || '{"experience":"beginner","strengthProgrammingStyle":"intermediate_undulating"}'),'beginner cannot submit undulating style') FROM profile_fixture;
SELECT ok(NOT private.is_valid_training_profile(document || '{"strengthProgrammingStyle":null}'),'null style is rejected') FROM profile_fixture;
SELECT ok(NOT private.is_valid_training_profile(document || '{"strengthProgrammingStyle":"invented"}'),'unknown style is rejected') FROM profile_fixture;
SELECT ok(NOT private.is_valid_training_profile(document || '{"strengthProgrammingStyle":"repeatable","other":true}'),'unknown extra profile keys remain rejected') FROM profile_fixture;
SELECT ok(private.validate_training_strength_template_document(
  jsonb_set(jsonb_set(document,'{executionContext}','{"kind":"live"}'),'{strengthTemplate,provenance}',
  '{"kind":"reviewed_authored_template","templateRecordId":"authored-template.v1","reviewRecordId":"review.v1","reviewedAt":"2026-09-08T12:00:00Z"}')),
  'syntactically valid authored provenance is accepted without activating a registry') FROM template_fixture;
SELECT ok(NOT private.validate_training_strength_template_document(
  jsonb_set(jsonb_set(document,'{executionContext}','{"kind":"live"}'),'{strengthTemplate,provenance}',
  '{"kind":"reviewed_authored_template","templateRecordId":"authored-template.v1","reviewRecordId":"review.v1","reviewedAt":"not-a-date"}')),
  'malformed authored review timestamp is rejected') FROM template_fixture;
SELECT * FROM finish();
ROLLBACK;
