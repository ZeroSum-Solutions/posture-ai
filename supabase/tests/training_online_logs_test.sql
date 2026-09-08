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

CREATE FUNCTION pg_temp.training_actual(p_reps jsonb DEFAULT '8',p_rir jsonb DEFAULT '3',p_symptom text DEFAULT 'none')
RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('quantity', '{"entered":{"value":"2.5","unit":"lb"},"canonicalKg":"1.133980925"}'::jsonb,
  'reps',p_reps,'rir',p_rir,'side','bilateral','symptomState',p_symptom,'occurredAt','2026-09-08T00:00:00Z');
$$;
SELECT ok(NOT has_table_privilege('authenticated','public.training_set_log_events','INSERT'), 'direct client log inserts are denied');
SELECT ok(NOT has_table_privilege('service_role','public.training_set_log_events','INSERT'), 'compiler service cannot bypass log RPC');
SELECT ok(NOT has_function_privilege('service_role','public.write_training_set_log(text,text,bigint,uuid,jsonb)','EXECUTE'), 'service role cannot impersonate athlete logging');
SELECT ok(private.is_valid_training_set_actual(pg_temp.training_actual('0','"unknown"')), 'zero reps and explicitly unknown RIR are valid actuals');
SELECT ok(private.is_valid_training_set_actual(pg_temp.training_actual('8','"6_plus"')), '6-plus RIR remains distinct from unknown');
SELECT ok(NOT private.is_valid_training_set_actual(pg_temp.training_actual('8.5')), 'fractional reps are rejected');
SELECT ok(NOT private.is_valid_training_set_actual(pg_temp.training_actual('8','3.5')), 'fractional RIR is rejected');
SELECT ok(NOT private.is_valid_training_set_actual(pg_temp.training_actual()||'{"actor":{"userId":"forged"}}'), 'client actuals cannot carry actor authority');
SELECT ok(NOT private.is_valid_training_set_actual(jsonb_set(pg_temp.training_actual(),'{quantity,canonicalKg}','"2.5"')), 'false canonical conversion is rejected');

SET LOCAL ROLE authenticated;
SELECT is(public.publish_training_program_draft('45000000-0000-4000-8000-000000000006'),'program-fixture-1','owner publishes the simulation fixture');
SELECT is(public.start_training_session('program-session-1',1)->>'sessionId','program-session-1','owner starts the fixture session');
SELECT throws_ok($$ SELECT public.complete_training_session('program-session-1',2,'46000000-0000-4000-8000-000000000001','complete') $$,
 'PT409','training session has unlogged sets','completion never silently marks an unlogged set done');
SELECT throws_ok($$ SELECT public.write_training_set_log('program-session-1','forged-set',2,'46000000-0000-4000-8000-000000000002',pg_temp.training_actual()) $$,
 '22023','set is not in the started prescription','invented set IDs cannot be logged');
SELECT throws_ok($$ SELECT public.write_training_set_log('program-session-1','goblet-set-1',2,'46000000-0000-4000-8000-000000000003',pg_temp.training_actual('8.5')) $$,
 '22023','invalid training set actual','RPC rejects fractional reps before a write');
SELECT is(public.write_training_set_log('program-session-1','goblet-set-1',2,'46000000-0000-4000-8000-000000000004',pg_temp.training_actual())#>>'{event,quantity,canonicalKg}',
 '1.133980925','actual 2.5lb persists exact canonical kilograms');
SELECT results_eq($$SELECT event_json#>>'{quantity,entered,value}',event_json#>>'{quantity,entered,unit}',event_json->>'loadBasis' FROM public.training_set_log_events$$,
 $$VALUES ('2.5'::text,'lb'::text,'dumbbell_single_implement'::text)$$,'entered unit/value and prescribed single-implement basis survive');
SELECT results_eq($$SELECT event_json#>>'{actor,userId}',event_json#>>'{executionContext,simulationRunId}' FROM public.training_set_log_events$$,
 $$VALUES ('45000000-0000-4000-8000-000000000001'::text,'45000000-0000-4000-8000-000000000005'::text)$$,'actor and simulation context come from server ownership and prescription');
SELECT is(public.write_training_set_log('program-session-1','goblet-set-1',2,'46000000-0000-4000-8000-000000000004',pg_temp.training_actual())->>'revision','3','exact set retry returns the first acknowledgement');
SELECT results_eq('SELECT count(*) FROM public.training_set_log_events','VALUES (1::bigint)','double tap stores one actual');
SELECT results_eq($$SELECT revision,state FROM public.training_sessions WHERE id='program-session-1'$$, $$VALUES (3::bigint,'in_progress'::text)$$,'set entry does not complete the session');
SELECT throws_ok($$ SELECT public.write_training_set_log('program-session-1','goblet-set-1',2,'46000000-0000-4000-8000-000000000004',pg_temp.training_actual('7')) $$,
 'PT409','training request ID reused with different content','request ID reuse with different actuals conflicts');
SELECT throws_ok($$ SELECT public.write_training_set_log('program-session-1','goblet-set-1',2,'46000000-0000-4000-8000-000000000005',pg_temp.training_actual('7')) $$,
 'PT409','training session changed concurrently','a second writer at an old revision cannot overwrite');
SELECT is(public.write_training_set_log('program-session-1','goblet-set-1',3,'46000000-0000-4000-8000-000000000006',pg_temp.training_actual('7'))#>>'{event,eventType}',
 'set_actual_corrected','correction appends rather than replacing the original');
SELECT results_eq($$SELECT event_revision,event_json->>'reps' FROM public.training_set_log_events ORDER BY event_revision$$,
 $$VALUES (1::bigint,'8'::text),(2::bigint,'7'::text)$$,'both original and corrected reps remain auditable');
SELECT results_eq('SELECT count(*) FROM public.training_set_log_events WHERE replaces_event_id IS NOT NULL','VALUES (1::bigint)','correction binds the preceding event');
SELECT results_eq($$SELECT event_json->>'reps' FROM public.training_current_set_actuals$$,$$VALUES ('7'::text)$$,'current-actual view projects only the latest correction');
SELECT is(public.read_training_session_projection('program-session-1')#>>'{session,revision}','4','single-snapshot projection binds the current session revision');
SELECT is(public.read_training_session_projection('program-session-1')#>>'{currentActuals,0,reps}','7','single-snapshot projection includes the corrected actual');
SELECT is(public.complete_training_session('program-session-1',4,'46000000-0000-4000-8000-000000000007','complete')->>'state',
 'completed','completion requires its own explicit action');
SELECT is(public.complete_training_session('program-session-1',4,'46000000-0000-4000-8000-000000000007','complete')->>'revision',
 '5','duplicate completion returns the original acknowledgement');
SELECT results_eq('SELECT count(*) FROM public.training_mutation_receipts','VALUES (3::bigint)','only successful logical mutations have receipts');
RESET ROLE;
SELECT throws_ok($$ UPDATE public.training_set_log_events SET event_json='{}' $$,'55000',NULL,'privileged accidental overwrite cannot erase actual history');
SELECT throws_ok($$ DELETE FROM public.training_mutation_receipts $$,'55000',NULL,'receipts cannot be silently deleted for a replay');

-- A profile change does not rewrite or strand an already-started prescription.
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ SELECT * FROM public.append_training_profile_revision('45000000-0000-4000-8000-000000000003',1,
 (SELECT profile_json FROM public.training_profile_revisions WHERE subject_id='45000000-0000-4000-8000-000000000003' AND revision=1)) $$,
 'profile may advance independently of started history');
SELECT is(public.write_training_set_log('program-session-1','goblet-set-1',5,'46000000-0000-4000-8000-000000000008',pg_temp.training_actual('6','"unknown"'))#>>'{event,rir}',
 'unknown','a permitted historical correction survives a later profile revision');
SELECT results_eq($$SELECT prescription_json->>'profileRevisionId' FROM public.training_session_prescriptions$$,
 $$VALUES ('1'::text)$$,'started source profile remains revision one');
SELECT is(public.write_training_set_log('program-session-1','goblet-set-1',6,'46000000-0000-4000-8000-000000000009',pg_temp.training_actual('6','3','adverse_reported'))->>'state',
 'aborted','reported adverse symptoms stop the whole session');
SELECT is(public.write_training_set_log('program-session-1','goblet-set-1',7,'46000000-0000-4000-8000-000000000010',pg_temp.training_actual('6','3','none'))->>'state',
 'aborted','ordinary actual correction does not clear the symptom stop');
SELECT results_eq($$SELECT stopped_for_symptoms FROM public.training_sessions WHERE id='program-session-1'$$,'VALUES (true)','symptom stop remains monotonic');
SELECT is(public.complete_training_session('program-session-1',8,'46000000-0000-4000-8000-000000000011','complete')->>'state',
 'aborted','completion cannot promote a symptom-stopped session');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','45000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"45000000-0000-4000-8000-000000000002","aal":"aal2","iat":2000000000}',true);
SET LOCAL ROLE authenticated;
SELECT is_empty('SELECT id FROM public.training_set_log_events','unrelated athlete cannot read actual history');
SELECT is_empty('SELECT request_id FROM public.training_mutation_receipts','unrelated athlete cannot read acknowledgements');
SELECT is(public.read_training_session_projection('program-session-1'),NULL::jsonb,'projection RPC retains invoker RLS for unrelated athletes');
SELECT throws_ok($$ SELECT public.write_training_set_log('program-session-1','goblet-set-1',9,'46000000-0000-4000-8000-000000000012',pg_temp.training_actual()) $$,
 'P0001','training set write is not authorized','unrelated athlete cannot correct another session');
SELECT throws_ok($$ SELECT public.complete_training_session('program-session-1',9,'46000000-0000-4000-8000-000000000013','abort') $$,
 'P0001','training completion is not authorized','abort also requires ownership');
RESET ROLE;
SET CONSTRAINTS ALL IMMEDIATE;
SELECT * FROM finish();
ROLLBACK;
