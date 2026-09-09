BEGIN;
SELECT plan(20);

SELECT has_function('public','erase_training_subject_transactional',ARRAY['uuid'],'subject erasure RPC exists');
SELECT ok(has_function_privilege('authenticated','public.erase_training_subject_transactional(uuid)','EXECUTE'),'authenticated actors may invoke the guarded RPC');
SELECT ok(NOT has_function_privilege('anon','public.erase_training_subject_transactional(uuid)','EXECUTE'),'anonymous callers cannot invoke erasure');
SELECT ok(NOT has_function_privilege('service_role','public.erase_training_subject_transactional(uuid)','EXECUTE'),'service role cannot impersonate subject owners');

SET LOCAL session_replication_role=replica;
INSERT INTO auth.users(id,email,created_at,updated_at) VALUES
 ('78000000-0000-4000-8000-000000000002','other-owner@example.invalid',clock_timestamp(),clock_timestamp()),
 ('78000000-0000-4000-8000-000000000003','erase-coach@example.invalid',clock_timestamp(),clock_timestamp());
INSERT INTO public.practitioners(id,display_name,access_status,role,session_valid_after)
 VALUES('78000000-0000-4000-8000-000000000003','Erasure coach','active','practitioner','-infinity');
INSERT INTO public.clients(id,practitioner_id,first_name,last_name)
 VALUES('78000000-0000-4000-8000-000000000010','78000000-0000-4000-8000-000000000003','Legacy','Record');
INSERT INTO public.training_subjects(id,owner_user_id,status,activated_at) VALUES
 ('78000000-0000-4000-8000-000000000012','78000000-0000-4000-8000-000000000002','active',clock_timestamp());
SET LOCAL session_replication_role=origin;

SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SET LOCAL ROLE service_role;
SELECT isnt(public.issue_self_directed_athlete_invitation(
  'erase-owner@example.invalid','Erase owner',clock_timestamp()+interval '1 day','erasure test'
),NULL::uuid,'subject erasure fixture starts through the real invitation issuer');
RESET ROLE;

INSERT INTO auth.users(id,email,created_at,updated_at) VALUES
 ('78000000-0000-4000-8000-000000000001','erase-owner@example.invalid',clock_timestamp(),clock_timestamp());
SELECT set_config('request.jwt.claim.sub','78000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"78000000-0000-4000-8000-000000000001","email":"erase-owner@example.invalid","aal":"aal2","iat":2000000000}',true);
SET LOCAL ROLE authenticated;
SELECT is(public.complete_athlete_invitation(),'activated','fixture accepts the provisioned invitation through the real completion RPC');
RESET ROLE;

CREATE TEMP TABLE erased_subject ON COMMIT DROP AS
 SELECT id FROM public.training_subjects
 WHERE owner_user_id='78000000-0000-4000-8000-000000000001';
INSERT INTO public.client_accounts(subject_id,client_id)
 SELECT id,'78000000-0000-4000-8000-000000000010' FROM erased_subject;
INSERT INTO public.coaching_relationships(id,subject_id,practitioner_id,status,permissions,started_at,revision)
 SELECT '78000000-0000-4000-8000-000000000013',id,'78000000-0000-4000-8000-000000000003','active',
 ARRAY['subject:read','relationship:revoke']::public.training_coach_permission[],clock_timestamp(),1
 FROM erased_subject;

SELECT set_config('request.jwt.claim.sub','78000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"78000000-0000-4000-8000-000000000001","aal":"aal1","iat":2000000000}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.erase_training_subject_transactional('78000000-0000-4000-8000-000000000020')$$,
 '42501','current AAL2 athlete is required','AAL1 cannot erase a subject');
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"78000000-0000-4000-8000-000000000001","aal":"aal2","iat":2000000000}',true);
SET LOCAL ROLE authenticated;
SELECT is(public.erase_training_subject_transactional('78000000-0000-4000-8000-000000000020')->>'status','erased','owner erases the subject transactionally');
SELECT is(public.erase_training_subject_transactional('78000000-0000-4000-8000-000000000020')->>'status','already_erased','exact retry returns a durable receipt');
SELECT throws_ok($$SELECT public.erase_training_subject_transactional('78000000-0000-4000-8000-000000000023')$$,
 'P0001','owned training subject is unavailable','a different request ID cannot rewrite the erasure receipt');
SELECT throws_ok($$SELECT public.write_training_set_log('erased-session','erased-set',1,'78000000-0000-4000-8000-000000000021',
 '{"quantity":{"entered":{"value":"2.5","unit":"lb"},"canonicalKg":"1.133980925"},"reps":8,"rir":3,"side":"bilateral","symptomState":"none","occurredAt":"2026-09-08T00:00:00Z"}')$$,
 'P0001','training set write is not authorized','a late replay cannot recreate erased session data');
SELECT set_config('request.jwt.claims','{"sub":"78000000-0000-4000-8000-000000000001","email":"erase-owner@example.invalid","aal":"aal2","iat":2000000000}',true);
SELECT is(public.complete_athlete_invitation(),'not_invited','an accepted invitation cannot reactivate an erased subject');
RESET ROLE;

SELECT is_empty($$SELECT subject.id FROM public.training_subjects subject JOIN erased_subject erased ON erased.id=subject.id$$,'erased subject is removed');
SELECT is_empty($$SELECT bridge.subject_id FROM public.client_accounts bridge JOIN erased_subject erased ON erased.id=bridge.subject_id$$,'training client bridge is removed');
SELECT is_empty($$SELECT relationship.id FROM public.coaching_relationships relationship JOIN erased_subject erased ON erased.id=relationship.subject_id$$,'training coaching access is removed');
SELECT results_eq(
 $$SELECT invitation.state::text,invitation.subject_id,invitation.provisioned_user_id,
      invitation.revoked_at IS NOT NULL
   FROM private.athlete_invitations invitation
   WHERE invitation.email_normalized='erase-owner@example.invalid'$$,
 $$VALUES ('revoked'::text,NULL::uuid,NULL::uuid,true)$$,
 'the accepted invitation is revoked and detached from erased identity pointers'
);
SELECT isnt_empty($$SELECT id FROM public.clients WHERE id='78000000-0000-4000-8000-000000000010'$$,'legacy practitioner client is preserved');
SELECT isnt_empty($$SELECT id FROM public.practitioners WHERE id='78000000-0000-4000-8000-000000000003'$$,'practitioner record is preserved');
SELECT isnt_empty($$SELECT id FROM public.training_subjects WHERE id='78000000-0000-4000-8000-000000000012'$$,'another owner subject is untouched');

SELECT set_config('request.jwt.claim.sub','78000000-0000-4000-8000-000000000003',true);
SELECT set_config('request.jwt.claims','{"sub":"78000000-0000-4000-8000-000000000003","aal":"aal2","iat":2000000000}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.erase_training_subject_transactional('78000000-0000-4000-8000-000000000022')$$,
 'P0001','owned training subject is unavailable','a practitioner cannot erase another owner subject');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
