BEGIN;
SELECT no_plan();

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id,email,created_at,updated_at) VALUES
 ('45000000-0000-4000-8000-000000000001','program-owner@example.invalid',now(),now()),
 ('45000000-0000-4000-8000-000000000002','program-other@example.invalid',now(),now());
INSERT INTO public.training_subjects(id,owner_user_id,status,activated_at) VALUES
 ('45000000-0000-4000-8000-000000000003','45000000-0000-4000-8000-000000000001','active',now()),
 ('45000000-0000-4000-8000-000000000004','45000000-0000-4000-8000-000000000002','active',now());
SET LOCAL session_replication_role = origin;
SELECT set_config('request.jwt.claim.sub','45000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"45000000-0000-4000-8000-000000000001","aal":"aal2","iat":2000000000}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$
 SELECT * FROM public.append_training_profile_revision('45000000-0000-4000-8000-000000000003',0,'{
  "schemaVersion":"athlete-training-profile.v1","origin":{"kind":"athlete_input"},
  "goal":"strength","experience":"beginner","recentConsistency":"intermittent","cycleLengthWeeks":8,
  "strengthDays":["monday","thursday"],"localTimezone":"UTC","sessionTimeBudgetMinutes":30,
  "preferredLoadUnit":"kg","equipmentInventory":[{"kind":"dumbbell","equipmentId":"db","unit":"kg","perHandLoads":["10"]}],"startingHistory":[]
 }'::jsonb)
$$, 'an athlete creates the source profile');
RESET ROLE;

SET LOCAL ROLE service_role;
INSERT INTO public.training_simulation_runs(id,subject_id,created_by_user_id,fixture_id,fixture_hash,expires_at)
VALUES ('45000000-0000-4000-8000-000000000005','45000000-0000-4000-8000-000000000003',
 '45000000-0000-4000-8000-000000000001','fixture.v1',repeat('a',64),now()+interval '1 hour');
INSERT INTO public.training_program_drafts(id,subject_id,created_by_user_id,profile_revision,simulation_run_id,expires_at,program_json)
VALUES ('45000000-0000-4000-8000-000000000006','45000000-0000-4000-8000-000000000003',
 '45000000-0000-4000-8000-000000000001',1,'45000000-0000-4000-8000-000000000005',now()+interval '30 minutes','{
  "schemaVersion": "training-program-revision.v1",
  "assignmentId": "program-fixture-1",
  "revisionNumber": 1,
  "subjectId": "45000000-0000-4000-8000-000000000003",
  "programMode": "self_directed",
  "owningPractitionerId": null,
  "executionContext": {
    "kind": "synthetic_simulation",
    "simulationRunId": "45000000-0000-4000-8000-000000000005",
    "fixtureId": "fixture.v1",
    "fixtureHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "label": "Practice data"
  },
  "cycleStartLocalDate": "2026-09-08",
  "cycleLengthWeeks": 8,
  "profileRevisionId": "1",
  "eligibilitySourceRevisionId": "simulation-only",
  "compilerPolicyVersion": "eight-week-compiler.v1",
  "catalogVersion": "fixture.v1",
  "ruleVersion": "progression.v1",
  "publishedAt": "2026-09-08T00:00:00Z",
  "author": {
    "kind": "athlete",
    "userId": "45000000-0000-4000-8000-000000000001"
  },
  "sessions": [
    {
      "sessionId": "program-session-1",
      "scheduledLocalDate": "2026-09-08",
      "athleteTimezone": "UTC",
      "exercises": [
        {
          "exerciseInstanceId": "goblet-instance-1",
          "exerciseVersionId": "goblet.v1",
          "setIds": [
            "goblet-set-1"
          ],
          "repRange": {
            "minimum": 6,
            "maximum": 8
          },
          "targetRir": {
            "minimum": 2,
            "maximum": 3
          },
          "restSeconds": 120,
          "acceptedInitialLoad": {
            "status": "accepted",
            "acceptanceId": "accept-1",
            "acceptedAt": "2026-09-08T00:00:00Z",
            "acceptedByUserId": "45000000-0000-4000-8000-000000000001",
            "source": "equipment_inventory",
            "equipmentId": "db",
            "loadBasis": "dumbbell_single_implement",
            "implementCount": 1,
            "holdingConfiguration": "two_hands_single_implement",
            "quantity": {
              "entered": {
                "value": "10",
                "unit": "kg"
              },
              "canonicalKg": "10"
            },
            "executionContext": {
              "kind": "synthetic_simulation",
              "simulationRunId": "45000000-0000-4000-8000-000000000005",
              "fixtureId": "fixture.v1",
              "fixtureHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              "label": "Practice data"
            },
            "exerciseInstanceId": "goblet-instance-1",
            "exerciseVersionId": "goblet.v1",
            "provenance": {
              "profileRevisionId": "1",
              "compiledProgramRevisionId": "compiled-fixture-1",
              "catalogVersion": "fixture.v1",
              "catalogOrigin": {
                "kind": "synthetic_fixture",
                "source": "server_fixture",
                "fixtureId": "fixture.v1",
                "fixtureHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "label": "Synthetic fixture"
              }
            }
          }
        }
      ]
    }
  ],
  "catalogOrigin": {
    "kind": "synthetic_fixture",
    "source": "server_fixture",
    "fixtureId": "fixture.v1",
    "fixtureHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "label": "Synthetic fixture"
  },
  "compiledProgramRevisionId": "compiled-fixture-1",
  "conditioningBouts": [
    {
      "status": "accepted",
      "acceptanceId": "conditioning-accept-1",
      "acceptedAt": "2026-09-08T00:00:00Z",
      "acceptedByUserId": "45000000-0000-4000-8000-000000000001",
      "executionContext": {
        "kind": "synthetic_simulation",
        "simulationRunId": "45000000-0000-4000-8000-000000000005",
        "fixtureId": "fixture.v1",
        "fixtureHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "label": "Practice data"
      },
      "boutId": "conditioning-session-1",
      "modalityId": "walking.v1",
      "scheduledLocalDate": "2026-09-09",
      "athleteTimezone": "UTC",
      "acceptedDurationSeconds": 600,
      "effortCue": "Walk at a conversational pace.",
      "source": {
        "compiledProgramRevisionId": "compiled-fixture-1",
        "compilerPolicyVersion": "eight-week-compiler.v1",
        "catalogVersion": "fixture.v1",
        "catalogOrigin": {
          "kind": "synthetic_fixture",
          "source": "server_fixture",
          "fixtureId": "fixture.v1",
          "fixtureHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          "label": "Synthetic fixture"
        }
      }
    }
  ]
}'::jsonb);
RESET ROLE;


CREATE FUNCTION pg_temp.conditioning_actual(p_duration jsonb DEFAULT '600',p_effort jsonb DEFAULT '3',p_symptom text DEFAULT 'none')
RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('durationSeconds',p_duration,'perceivedEffort',p_effort,
 'symptomState',p_symptom,'occurredAt','2026-09-08T00:00:00Z'); $$;
SELECT ok(NOT has_table_privilege('authenticated','public.training_conditioning_log_events','INSERT'),'direct conditioning inserts denied');
SELECT ok(NOT has_function_privilege('service_role','public.write_training_conditioning_log(text,bigint,uuid,jsonb)','EXECUTE'),'service cannot impersonate athlete conditioning logs');
SELECT ok(NOT private.is_valid_training_conditioning_actual(pg_temp.conditioning_actual('1.5')),'fractional duration rejected');
SELECT ok(NOT private.is_valid_training_conditioning_actual(pg_temp.conditioning_actual('600','11')),'effort outside scale rejected');
SELECT ok(private.is_valid_training_conditioning_actual(pg_temp.conditioning_actual('0','"unknown"')),'zero duration and unknown effort remain actuals');
SELECT ok(NOT private.is_valid_training_conditioning_actual(pg_temp.conditioning_actual()||'{"executionContext":{"kind":"live"}}'),'browser context rejected');
SET LOCAL ROLE authenticated;
SELECT is(public.publish_training_program_draft('45000000-0000-4000-8000-000000000006'),'program-fixture-1','publish both session kinds');
SELECT is(public.start_training_session('conditioning-session-1',1)->>'schemaVersion','training-conditioning-session-prescription.v1','conditioning starts with its accepted bout');
SELECT is(public.start_training_session('program-session-1',1)->>'schemaVersion','training-session-prescription.v1','strength still starts');
SELECT throws_ok($$SELECT public.complete_training_session('conditioning-session-1',2,'47000000-0000-4000-8000-000000000001','complete')$$,
 'PT409','training session has unlogged sets','conditioning cannot be marked done without an actual');
SELECT throws_ok($$SELECT public.write_training_conditioning_log('program-session-1',2,'47000000-0000-4000-8000-000000000002',pg_temp.conditioning_actual())$$,
 '22023','conditioning actual requires a conditioning session','cannot log conditioning against strength');
SELECT is(public.write_training_conditioning_log('conditioning-session-1',2,'47000000-0000-4000-8000-000000000003',pg_temp.conditioning_actual())#>>'{conditioningEvent,durationSeconds}','600','actual duration is saved');
SELECT is(public.write_training_conditioning_log('conditioning-session-1',2,'47000000-0000-4000-8000-000000000003',pg_temp.conditioning_actual())->>'revision','3','exact retry returns original ACK');
SELECT results_eq('SELECT count(*) FROM public.training_conditioning_log_events','VALUES (1::bigint)','retry creates one event');
SELECT throws_ok($$SELECT public.write_training_conditioning_log('conditioning-session-1',2,'47000000-0000-4000-8000-000000000004',pg_temp.conditioning_actual('500'))$$,
 'PT409','training session changed concurrently','stale conditioning save conflicts');
SELECT throws_ok($$SELECT public.write_training_conditioning_log('conditioning-session-1',2,'47000000-0000-4000-8000-000000000003',pg_temp.conditioning_actual('500'))$$,
 'PT409','training request ID reused with different content','same request with new actual conflicts');
SELECT is(public.write_training_conditioning_log('conditioning-session-1',3,'47000000-0000-4000-8000-000000000005',pg_temp.conditioning_actual('500','"unknown"'))#>>'{conditioningEvent,eventType}','conditioning_actual_corrected','correction is append-only');
SELECT is(public.read_training_session_projection('conditioning-session-1')#>>'{currentConditioningActual,durationSeconds}','500','projection chooses latest correction');
SELECT is(public.read_training_session_projection('conditioning-session-1')#>>'{session,revision}','4','projection revision matches actual');
SELECT is(public.complete_training_session('conditioning-session-1',4,'47000000-0000-4000-8000-000000000006','complete')->>'state','completed','finish remains explicit');
SELECT is(public.write_training_conditioning_log('conditioning-session-1',5,'47000000-0000-4000-8000-000000000007',pg_temp.conditioning_actual('450','4','adverse_reported'))->>'state','aborted','reported symptoms stop even historical session');
SELECT is(public.write_training_conditioning_log('conditioning-session-1',6,'47000000-0000-4000-8000-000000000008',pg_temp.conditioning_actual('450','4','none'))->>'state','aborted','ordinary correction cannot clear symptom stop');
RESET ROLE;
SELECT throws_ok($$DELETE FROM public.training_conditioning_log_events$$,'55000',NULL,'conditioning history cannot be erased');
SELECT set_config('request.jwt.claim.sub','45000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"45000000-0000-4000-8000-000000000002","aal":"aal2","iat":2000000000}',true);
SET LOCAL ROLE authenticated;
SELECT is_empty('SELECT id FROM public.training_conditioning_log_events','unrelated athlete cannot see conditioning history');
SELECT throws_ok($$SELECT public.write_training_conditioning_log('conditioning-session-1',7,'47000000-0000-4000-8000-000000000009',pg_temp.conditioning_actual())$$,
 'P0001','training conditioning write is not authorized','unrelated athlete cannot correct history');
RESET ROLE;
SET CONSTRAINTS ALL IMMEDIATE;
SELECT * FROM finish();
ROLLBACK;
