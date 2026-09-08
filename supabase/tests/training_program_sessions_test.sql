BEGIN;
SELECT no_plan();

SELECT has_table('public', 'training_program_assignments', 'program assignments persist independently of legacy workouts');
SELECT has_table('public', 'training_session_prescriptions', 'started prescriptions have immutable storage');
SELECT ok(NOT has_table_privilege('authenticated', 'public.training_program_drafts', 'INSERT'), 'browser cannot forge compiler drafts');
SELECT ok(NOT has_table_privilege('service_role', 'public.training_program_assignments', 'INSERT'), 'compiler service cannot publish through direct table writes');
SELECT ok(NOT has_function_privilege('service_role', 'public.start_training_session(text,bigint)', 'EXECUTE'), 'compiler service cannot impersonate a session start');

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

SELECT set_config('request.jwt.claim.sub','45000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"45000000-0000-4000-8000-000000000002","aal":"aal2","iat":2000000000}',true);
SET LOCAL ROLE authenticated;
SELECT is_empty('SELECT id FROM public.training_program_drafts', 'unrelated athlete cannot read a draft');
SELECT throws_ok($$ SELECT public.publish_training_program_draft('45000000-0000-4000-8000-000000000006') $$,
 'P0001','training draft is unavailable','unrelated athlete cannot publish another subject draft');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','45000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"45000000-0000-4000-8000-000000000001","aal":"aal1","iat":2000000000}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.publish_training_program_draft('45000000-0000-4000-8000-000000000006') $$,
 'P0001','training publication is not authorized','AAL1 cannot publish an owned program');
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"45000000-0000-4000-8000-000000000001","aal":"aal2","iat":2000000000}',true);

-- Each failure must happen before publication, without leaving an assignment.
UPDATE public.training_simulation_runs SET status='ended' WHERE id='45000000-0000-4000-8000-000000000005';
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.publish_training_program_draft('45000000-0000-4000-8000-000000000006') $$,
 'P0001','training simulation is unavailable','ended simulation cannot create a new program');
RESET ROLE;
UPDATE public.training_simulation_runs SET status='active',fixture_hash=repeat('b',64) WHERE id='45000000-0000-4000-8000-000000000005';
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.publish_training_program_draft('45000000-0000-4000-8000-000000000006') $$,
 'P0001','training simulation is unavailable','matching run ID with mismatched fixture hash cannot publish');
RESET ROLE;
UPDATE public.training_simulation_runs SET fixture_hash=repeat('a',64) WHERE id='45000000-0000-4000-8000-000000000005';
-- Model a pre-48000 draft already present when the source guard was added.
-- Publication must still reject it independently of the new INSERT guard.
SET LOCAL session_replication_role = replica;
INSERT INTO public.training_program_drafts(id,subject_id,created_by_user_id,profile_revision,simulation_run_id,expires_at,program_json)
SELECT '45000000-0000-4000-8000-000000000007',subject_id,created_by_user_id,profile_revision,NULL,expires_at,
 jsonb_set(jsonb_set(program_json,'{executionContext}','{"kind":"live"}'),'{assignmentId}','"live-program-fixture"')
FROM public.training_program_drafts WHERE id='45000000-0000-4000-8000-000000000006';
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.publish_training_program_draft('45000000-0000-4000-8000-000000000007') $$,
 'PT409','training eligibility changed concurrently','a practice draft cannot become live without current real eligibility');
SELECT results_eq('SELECT count(*) FROM public.training_program_assignments','VALUES (0::bigint)','rejected publication leaves no partial assignment');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT is(public.publish_training_program_draft('45000000-0000-4000-8000-000000000006'),'program-fixture-1','owner publishes the server-compiled draft');
SELECT is(public.publish_training_program_draft('45000000-0000-4000-8000-000000000006'),'program-fixture-1','an exact publish retry returns the existing assignment');
SELECT results_eq('SELECT count(*) FROM public.training_program_assignments','VALUES (1::bigint)','retry creates no duplicate program');
SELECT results_eq('SELECT count(*) FROM public.training_sessions','VALUES (2::bigint)','program publication materializes the scheduled session once');
SELECT throws_ok($$ SELECT public.start_training_session('program-session-1',2) $$,'PT409','training session changed concurrently','stale session start conflicts');
SELECT is(public.start_training_session('program-session-1',1)#>>'{exercises,0,acceptedInitialLoad,quantity,canonicalKg}',
 '10','starting a session preserves the single dumbbell load exactly');
SELECT results_eq($$SELECT state,revision FROM public.training_sessions WHERE id='program-session-1'$$, $$VALUES ('in_progress'::text,2::bigint)$$,'start advances the session revision once');
SELECT is(public.start_training_session('program-session-1',1)->>'sessionId','program-session-1','duplicate start returns the same immutable prescription');
SELECT results_eq('SELECT count(*) FROM public.training_session_prescriptions','VALUES (1::bigint)','duplicate start does not freeze a second prescription');
SELECT throws_ok($$ UPDATE public.training_sessions SET state='completed' WHERE id='program-session-1' $$,
 '42501',NULL,'browser cannot complete a session through table updates');
RESET ROLE;
SELECT throws_ok($$ UPDATE public.training_session_prescriptions SET prescription_json='{}' WHERE session_id='program-session-1' $$,
 '55000',NULL,'even privileged accidental updates cannot rewrite a started prescription');
SELECT throws_ok($$ DELETE FROM public.training_program_revisions WHERE assignment_id='program-fixture-1' $$,
 '55000',NULL,'published program revisions are append-only');
SELECT throws_ok($$ UPDATE public.training_program_assignments SET simulation_run_id=NULL,revision=revision+1 WHERE id='program-fixture-1' $$,
 '55000','training assignment identity is immutable','a published simulation assignment cannot be converted to live');
SELECT throws_ok($$ UPDATE public.training_program_assignments SET active_revision=3,revision=revision+1 WHERE id='program-fixture-1' $$,
 'PT409','training assignment changed concurrently','active program revisions cannot skip ahead');

SELECT set_config('request.jwt.claim.sub','45000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"45000000-0000-4000-8000-000000000002","aal":"aal2","iat":2000000000}',true);
SET LOCAL ROLE authenticated;
SELECT is_empty('SELECT id FROM public.training_program_assignments','unrelated athlete cannot read published programs');
SELECT is_empty('SELECT session_id FROM public.training_session_prescriptions','unrelated athlete cannot read the frozen prescription');
SELECT throws_ok($$ SELECT public.start_training_session('program-session-1',1) $$,
 'P0001','training session is unavailable','duplicate-start semantics never bypass ownership');
RESET ROLE;

SET CONSTRAINTS ALL IMMEDIATE;
SELECT * FROM finish();
ROLLBACK;
