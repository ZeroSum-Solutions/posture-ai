BEGIN;

SELECT plan(34);

SELECT has_table('private', 'athlete_invitations', 'athlete invitations are private');
SELECT has_table('private', 'athlete_access_events', 'athlete admission events are private');
SELECT has_column('public', 'training_subjects', 'session_valid_after', 'athlete sessions have a cutoff');
SELECT ok(
  pg_catalog.to_regprocedure('public.current_application_actor()') IS NOT NULL
  AND pg_catalog.to_regprocedure('public.complete_athlete_invitation()') IS NOT NULL
  AND pg_catalog.to_regprocedure('public.issue_self_directed_athlete_invitation(text,text,timestamptz,text)') IS NOT NULL
  AND pg_catalog.to_regprocedure('public.issue_coach_athlete_invitation(text,uuid,public.training_coach_permission[],timestamptz)') IS NOT NULL
  AND pg_catalog.to_regprocedure('public.resolve_training_profile_projection(uuid,uuid)') IS NOT NULL,
  'actor-bound admission and profile RPCs exist'
);
SELECT ok(
  (SELECT c.relrowsecurity FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'private' AND c.relname = 'athlete_invitations')
  AND (SELECT c.relrowsecurity FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'private' AND c.relname = 'athlete_access_events'),
  'private athlete admission tables enable RLS'
);
SELECT ok(
  NOT pg_catalog.has_table_privilege('authenticated', 'private.athlete_invitations', 'SELECT')
  AND NOT pg_catalog.has_table_privilege('authenticated', 'private.athlete_access_events', 'SELECT')
  AND NOT pg_catalog.has_table_privilege('anon', 'private.athlete_invitations', 'SELECT'),
  'browser roles cannot inspect private invitations or events'
);
SELECT ok(
  pg_catalog.has_function_privilege('authenticated', 'public.current_application_actor()', 'EXECUTE')
  AND NOT pg_catalog.has_function_privilege('anon', 'public.current_application_actor()', 'EXECUTE')
  AND NOT pg_catalog.has_function_privilege('service_role', 'public.current_application_actor()', 'EXECUTE'),
  'only authenticated sessions can resolve their application actor'
);
SELECT ok(
  pg_catalog.has_function_privilege('service_role', 'public.issue_self_directed_athlete_invitation(text,text,timestamptz,text)', 'EXECUTE')
  AND NOT pg_catalog.has_function_privilege('authenticated', 'public.issue_self_directed_athlete_invitation(text,text,timestamptz,text)', 'EXECUTE'),
  'self-directed invitation issuance is service-only'
);
SELECT ok(
  pg_catalog.has_function_privilege('authenticated', 'public.issue_coach_athlete_invitation(text,uuid,public.training_coach_permission[],timestamptz)', 'EXECUTE')
  AND NOT pg_catalog.has_function_privilege('anon', 'public.issue_coach_athlete_invitation(text,uuid,public.training_coach_permission[],timestamptz)', 'EXECUTE'),
  'coach invitation issuance is authenticated and internally AAL2-scoped'
);
SELECT ok(
  pg_catalog.has_function_privilege('authenticated', 'public.complete_athlete_invitation()', 'EXECUTE')
  AND pg_catalog.has_function_privilege('authenticated', 'public.resolve_training_profile_projection(uuid,uuid)', 'EXECUTE')
  AND NOT pg_catalog.has_function_privilege('anon', 'public.complete_athlete_invitation()', 'EXECUTE'),
  'completion and projection are authenticated-only RPCs'
);

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, email, created_at, updated_at) VALUES
  ('51000000-0000-4000-8000-000000000001', 'coach@example.invalid', clock_timestamp(), clock_timestamp()),
  ('51000000-0000-4000-8000-000000000099', 'unrelated@example.invalid', clock_timestamp(), clock_timestamp());
INSERT INTO public.practitioners (id, display_name, access_status, role, session_valid_after) VALUES
  ('51000000-0000-4000-8000-000000000001', 'Coach fixture', 'active', 'practitioner', '-infinity'),
  ('51000000-0000-4000-8000-000000000099', 'Unrelated fixture', 'active', 'practitioner', '-infinity');
INSERT INTO public.clients (id, practitioner_id, first_name, last_name) VALUES
  ('52000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', 'Linked', 'Athlete'),
  ('52000000-0000-4000-8000-000000000002', '51000000-0000-4000-8000-000000000001', 'Setup', 'Needed'),
  ('52000000-0000-4000-8000-000000000099', '51000000-0000-4000-8000-000000000099', 'Unrelated', 'Client');
SET LOCAL session_replication_role = origin;

SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
SELECT isnt(
  public.issue_self_directed_athlete_invitation(
    'self@example.invalid', 'Self athlete', clock_timestamp() + interval '1 day', 'test service'
  ),
  NULL::uuid,
  'service authority issues a self-directed invitation'
);
RESET ROLE;

SELECT throws_ok(
  $$ INSERT INTO private.practitioner_invitations(email_normalized, expires_at, issued_by)
     VALUES ('self@example.invalid', clock_timestamp() + interval '1 day', 'test') $$,
  '23505', NULL,
  'one email cannot hold athlete and practitioner invitation classes'
);
SELECT is(
  public.hook_enforce_practitioner_invitation(
    '{"user":{"email":"SELF@example.invalid"}}'::jsonb
  ),
  '{}'::jsonb,
  'the auth hook admits exactly one normalized athlete invitation'
);

INSERT INTO auth.users (id, email, created_at, updated_at)
VALUES ('53000000-0000-4000-8000-000000000001', 'self@example.invalid', clock_timestamp(), clock_timestamp());
SELECT is(
  (SELECT count(*) FROM public.training_subjects WHERE owner_user_id = '53000000-0000-4000-8000-000000000001'),
  1::bigint,
  'the auth trigger provisions exactly one invited subject'
);
SELECT is(
  (SELECT count(*) FROM public.practitioners WHERE id = '53000000-0000-4000-8000-000000000001'),
  0::bigint,
  'athlete provisioning never creates a practitioner identity'
);

SELECT set_config('request.jwt.claim.sub', '53000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"53000000-0000-4000-8000-000000000001","email":"self@example.invalid","aal":"aal1","iat":2000000000}', true);
SET LOCAL ROLE authenticated;
SELECT results_eq(
  $$ SELECT actor_kind, access_status FROM public.current_application_actor() $$,
  $$ VALUES ('athlete'::text, 'invited'::text) $$,
  'an invited athlete resolves as athlete without practitioner authority'
);
SELECT is(public.complete_athlete_invitation(), 'mfa_required', 'AAL1 cannot activate an athlete');
RESET ROLE;

SELECT set_config('request.jwt.claims', '{"sub":"53000000-0000-4000-8000-000000000001","email":"self@example.invalid","aal":"aal2","iat":1700000000}', true);
SET LOCAL ROLE authenticated;
SELECT is(public.complete_athlete_invitation(), 'activated', 'AAL2 consumes and activates the invitation');
SELECT is(public.complete_athlete_invitation(), 'already_active', 'athlete invitation completion is single-use');
SELECT is(
  (SELECT count(*) FROM public.client_accounts bridge JOIN public.training_subjects subject ON subject.id = bridge.subject_id
    WHERE subject.owner_user_id = '53000000-0000-4000-8000-000000000001'),
  0::bigint,
  'self-directed activation creates no legacy client bridge'
);

SELECT is(
  (SELECT revision FROM public.append_training_profile_revision(
    (SELECT id FROM public.training_subjects WHERE owner_user_id = '53000000-0000-4000-8000-000000000001'),
    0,
    '{"schemaVersion":"athlete-training-profile.v1","origin":{"kind":"athlete_input"},"goal":"strength","experience":"beginner","recentConsistency":"consistent","cycleLengthWeeks":8,"strengthDays":["monday","thursday"],"localTimezone":"UTC","sessionTimeBudgetMinutes":45,"preferredLoadUnit":"kg","equipmentInventory":[],"startingHistory":[]}'::jsonb
  )),
  1::bigint,
  'an active athlete appends a validated profile through the ordinary RPC'
);
SELECT is(
  public.resolve_training_profile_projection(
    (SELECT id FROM public.training_subjects WHERE owner_user_id = '53000000-0000-4000-8000-000000000001'), NULL
  )#>>'{current,revision}',
  '1',
  'subject projection returns the authoritative current revision'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '51000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"51000000-0000-4000-8000-000000000001","email":"coach@example.invalid","aal":"aal2","iat":2000000000}', true);
SET LOCAL ROLE authenticated;
SELECT isnt(
  public.issue_coach_athlete_invitation(
    'assigned@example.invalid', '52000000-0000-4000-8000-000000000001',
    ARRAY['subject:read','profile:read','profile:write']::public.training_coach_permission[],
    clock_timestamp() + interval '1 day'
  ),
  NULL::uuid,
  'an active AAL2 practitioner issues an invitation for their unlinked client'
);
SELECT throws_ok(
  $$ SELECT public.issue_coach_athlete_invitation(
       'bad-permissions@example.invalid', '52000000-0000-4000-8000-000000000002',
       NULL, clock_timestamp() + interval '1 day') $$,
  '42501', NULL,
  'coach invitation rejects missing permission scope'
);
RESET ROLE;

INSERT INTO auth.users (id, email, created_at, updated_at)
VALUES ('53000000-0000-4000-8000-000000000002', 'assigned@example.invalid', clock_timestamp(), clock_timestamp());
SELECT is(
  (SELECT bridge.client_id FROM public.client_accounts bridge JOIN public.training_subjects subject ON subject.id = bridge.subject_id
    WHERE subject.owner_user_id = '53000000-0000-4000-8000-000000000002'),
  '52000000-0000-4000-8000-000000000001'::uuid,
  'coach-invited provisioning creates the explicit client-to-subject bridge'
);
SELECT is(
  (SELECT permissions::text FROM public.coaching_relationships relationship JOIN public.training_subjects subject ON subject.id = relationship.subject_id
    WHERE subject.owner_user_id = '53000000-0000-4000-8000-000000000002'),
  '{subject:read,profile:read,profile:write}',
  'coach-invited provisioning preserves the exact relationship permission grant'
);

SELECT set_config('request.jwt.claim.sub', '53000000-0000-4000-8000-000000000002', true);
SELECT set_config('request.jwt.claims', '{"sub":"53000000-0000-4000-8000-000000000002","email":"assigned@example.invalid","aal":"aal2","iat":2000000000}', true);
SET LOCAL ROLE authenticated;
SELECT is(public.complete_athlete_invitation(), 'activated', 'assigned athlete accepts access through their distinct session');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '51000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"51000000-0000-4000-8000-000000000001","email":"coach@example.invalid","aal":"aal2","iat":2000000000}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  public.resolve_training_profile_projection(NULL, '52000000-0000-4000-8000-000000000001')#>>'{subjectId}',
  (SELECT subject.id::text FROM public.training_subjects subject WHERE subject.owner_user_id = '53000000-0000-4000-8000-000000000002'),
  'legacy client selector returns the canonical bridged subject id'
);
SELECT is(
  public.resolve_training_profile_projection(NULL, '52000000-0000-4000-8000-000000000002')->>'status',
  'setup_required',
  'an owned unlinked client returns explicit setup state without auto-creation'
);
SELECT throws_ok(
  $$ SELECT public.resolve_training_profile_projection(NULL, '52000000-0000-4000-8000-000000000099') $$,
  '42501', NULL,
  'a practitioner cannot resolve another practitioner client'
);
RESET ROLE;

INSERT INTO private.practitioner_invitations(email_normalized, display_name, expires_at, issued_by)
VALUES ('practitioner-new@example.invalid', 'Preserved practitioner', clock_timestamp() + interval '1 day', 'test');
INSERT INTO auth.users (id, email, created_at, updated_at)
VALUES ('53000000-0000-4000-8000-000000000003', 'practitioner-new@example.invalid', clock_timestamp(), clock_timestamp());
SELECT ok(
  EXISTS (SELECT 1 FROM public.practitioners WHERE id = '53000000-0000-4000-8000-000000000003' AND access_status = 'invited')
  AND NOT EXISTS (SELECT 1 FROM public.training_subjects WHERE owner_user_id = '53000000-0000-4000-8000-000000000003'),
  'the existing practitioner provisioning branch remains distinct'
);

SET LOCAL session_replication_role = replica;
INSERT INTO public.training_subjects(owner_user_id, status, activated_at)
VALUES ('51000000-0000-4000-8000-000000000001', 'active', clock_timestamp());
SET LOCAL session_replication_role = origin;
SELECT set_config('request.jwt.claim.sub', '51000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"51000000-0000-4000-8000-000000000001","email":"coach@example.invalid","aal":"aal2","iat":2000000000}', true);
SET LOCAL ROLE authenticated;
SELECT results_eq(
  $$ SELECT actor_kind, access_status, session_is_current FROM public.current_application_actor() $$,
  $$ VALUES ('ambiguous'::text, 'denied'::text, false) $$,
  'one UID with both identity classes fails closed'
);
RESET ROLE;

UPDATE public.training_subjects
SET session_valid_after = clock_timestamp() + interval '1 day'
WHERE owner_user_id = '53000000-0000-4000-8000-000000000001';
SELECT set_config('request.jwt.claim.sub', '53000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"53000000-0000-4000-8000-000000000001","email":"self@example.invalid","aal":"aal2","iat":1700000000}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT session_is_current FROM public.current_application_actor()),
  false,
  'athlete actor reports a session older than the subject cutoff as stale'
);
SELECT is(
  (SELECT count(*) FROM public.training_subjects WHERE owner_user_id = auth.uid()),
  0::bigint,
  'stale athlete session cannot read the subject through RLS'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
