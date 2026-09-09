# Wave 1C Athlete Identity and Online Logging Execution Plan

> **For agentic workers:** Execute in order after the Wave 1B contract freeze. Keep iterative work uncommitted; the integration owner makes one coherent checkpoint after fresh verification. Do not deploy from this plan.

**Goal:** Add an athlete-owned identity, optional coach assignment, authorized training profile, immutable started-session prescription, and online set logging without changing legacy practitioner/client/workout behavior.

**Architecture:** A new `training_subjects` root makes an authenticated adult the owner of their training history. An optional `client_accounts` link connects that subject to an existing practitioner-owned `clients` row, and an optional `coaching_relationships` row grants a practitioner explicit training permissions. All writes remain server-side, transactionally authorized, idempotent, and revision checked; RLS is defense-in-depth for reads.

**Baseline:** `ce18f8a67969a68c065875ad4460b161ac04435b`

**Specs:** `docs/plans/2026-09-07-strength-conditioning-prd.md` (normative), `docs/plans/2026-09-07-strength-product-gap-audit.md` (annex; PRD wins on conflict), and `docs/plans/2026-09-07-strength-conditioning-grok-review.md` (independent audit dispositions).

## Frozen boundaries

- Adult self-service is real ownership: a self-directed subject has an `auth.users` owner and does not require a hidden practitioner or a `clients` row.
- `clients.practitioner_id`, `practitioners.role`, the invitation-only practitioner path, existing RLS, `workout_sessions`, `session_runs`, share tokens, saved snapshots, and `/workouts` playback are unchanged.
- A share token is never a training principal. API bodies never accept `actor_user_id`, `subject_owner_id`, or `practitioner_id` as authorization evidence.
- Athlete and coach access both require a current AAL2 session. This is the resolved product/security decision and preserves the existing protected-session boundary.
- Pregnancy-specific programming is outside this release, but pregnancy or postpartum status alone is not coded here as a blanket exclusion or as clinical clearance. Wave 1C stores the versioned answer and gates assignment/start on a server-derived eligibility decision supplied by the approved policy contract.
- Durable offline outbox, reconnect replay, and multi-device merge wait for Wave 4. Online athlete-versus-coach writes still use optimistic revisions and return visible conflicts in this wave.
- No scan is required. Wave 1C persists only the program/profile/session provenance supplied by the Wave 1B contract; it does not read legacy corrective priorities or add scan-derived restrictions.
- Synthetic prototype fixtures may exercise subject, authorization and eligibility states without creating a new clinical approval workflow. They remain labeled synthetic and do not activate or clear a real athlete.

## Contract handoff from Wave 1B

Wave 1C starts only after `lib/training/contracts/**` exports and fixtures freeze these capabilities:

| Required export | Wave 1C use |
| --- | --- |
| `AthleteTrainingProfileV1Schema` | Validate the capability-free profile, timezone, unit preference, equipment and availability before persistence. |
| `EligibilityAnswersV1Schema`, `EligibilityDecisionV1Schema` | Store answers separately from the server-derived state and typed constraints. The client cannot submit its own eligibility state. |
| `ProgramModeSchema` | Enforce immutable `self_directed` versus `coach_assigned` authority. |
| `TrainingProgramRevisionV1Schema` | Validate the compiler output before publishing an immutable revision. |
| `TrainingSessionViewV1Schema` | Render the scheduled/frozen session without adapting it into legacy `SessionItem`. |
| `SetLogMutationV1Schema` and `SetLogViewV1Schema` | Validate stable exercise-instance/set IDs, exact entered load/unit/load basis, integer reps, RIR, side and symptom state. |
| `TRAINING_SCHEMA_VERSION` and canonical hashing/decimal helpers | Persist versions and hashes; never duplicate conversion, RIR, load-basis, or progression rules in API/UI code. |

If the contract owner chooses different symbol names, update this import list once at integration. Do not create parallel Zod schemas, conversion constants, eligibility branches, or compiler rules under `app/**`.

## Exact ownership

The Wave 1B owner retains `lib/training/contracts/**`, `lib/training/engine/**`, `lib/training/screening/**`, and `content/training/**`. The Wave 1C owner exclusively changes:

- `supabase/migrations/20260907040000_training_subject_identity.sql`
- `supabase/migrations/20260907041500_training_athlete_auth_provisioning.sql`
- `supabase/migrations/20260907041000_training_profiles_relationships.sql`
- `supabase/migrations/20260907042000_training_program_sessions.sql`
- `supabase/migrations/20260907043000_training_online_logs.sql`
- `supabase/migrations/20260907044000_training_privacy_lifecycle.sql`
- matching `supabase/tests/training_*_test.sql` files
- `lib/training/access/**` and `lib/training/persistence/**`
- `app/api/training/**`, `app/train/**`, and their colocated tests/styles
- `e2e/helpers/athlete-auth.ts`, `e2e/athlete-identity.spec.ts`, and `e2e/training-online-log.spec.ts`
- narrow integration edits to `proxy.ts`, `proxy.test.ts`, `lib/auth/public-paths.ts`, `lib/auth/public-paths.test.ts`, `app/auth/confirm/route.ts`, `app/auth/confirm/route.test.ts`, `app/auth/mfa/page.tsx`, `app/auth/mfa/page.test.tsx`, `components/AppShell.tsx`, `components/array/IslandNav.tsx`, `components/array/islandPolicy.ts`, and their tests

Do not edit `lib/workout/**`, `app/api/workouts/**`, `app/workouts/[sessionId]/**`, or `app/workouts/_player/WorkoutPlayer.tsx`. Reuse presentation primitives later through a separately owned extraction.

## Ordered execution

### 1. Freeze the subject and authority model

- [ ] Add fixtures first in `lib/training/access/authorization.test.ts` for: own self-directed subject; intended existing-client claim; active assigned coach; unrelated athlete; unrelated practitioner; revoked relationship; share-token-shaped caller; athlete attempting coach-owned publish; and coach attempting clinical clearance.
- [ ] Create `lib/training/access/authorization.ts` with `authorizeTrainingActor({ supabase, userId, subjectId, action })`. Return `{ actorKind, userId, subjectId, clientId, practitionerId, permissions }` or a typed denial. Derive every ID from database relationships.
- [ ] Keep actions explicit: `profile:read`, `profile:write`, `program:self_publish`, `program:coach_publish`, `session:read`, `set_log:write`, `session:complete`, `history:read`, and `relationship:revoke`. Ordinary coach permissions never include eligibility/acute-stop clearance.

Run:

```bash
npx vitest run lib/training/access/authorization.test.ts
```

### 2. Apply the additive identity foundation

- [ ] In `20260907040000_training_subject_identity.sql`, add `public.training_subjects(id, owner_user_id UNIQUE REFERENCES auth.users, status, created_at, activated_at, revoked_at, deleted_at)`.
- [ ] Add optional one-to-one `public.client_accounts(subject_id UNIQUE, client_id UNIQUE REFERENCES clients, status, claimed_at, revoked_at)`. Self-directed subjects have no row here; coach-invited claims do.
- [ ] Keep `handle_new_user()`, practitioner invitation tables/RPCs and every existing practitioner policy unchanged in this foundation migration. No athlete signup/claim path is live yet; tests create isolated subject fixtures through migration-owner/service authority.
- [ ] Add `private.is_training_subject_owner(subject_id)` and `private.is_training_subject_coach(subject_id, permission)` as stable security-definer predicates. The owner predicate requires an active, nondeleted subject, `owner_user_id = auth.uid()` and JWT `aal2`. The coach predicate additionally requires `private.is_active_aal2_practitioner()` plus an active relationship carrying the named permission once relationships exist; until then it returns false.
- [ ] Enable RLS immediately. `training_subjects` permits SELECT only through the owner predicate or active coach predicate. `client_accounts` uses the linked subject's same predicate. Both tables have no authenticated write policy. Revoke direct writes from `anon, authenticated`; grant table writes only to `service_role`.

`supabase/tests/training_subject_identity_test.sql` must prove a self-directed subject can exist without `clients`; the optional bridge is one-to-one; AAL1, unrelated athletes, unrelated practitioners and share-token-shaped sessions read nothing; service writes do not imply user access; and the existing practitioner trigger/admission tests remain unchanged. Invitation provisioning, claim completion and dual-invitation rejection belong to the later coordinated auth migration, not this foundation checkpoint.

### 3. Add profile, eligibility evidence, and coach relationships

- [ ] In `20260907041000_training_profiles_relationships.sql`, add immutable `training_profile_revisions(subject_id, revision, schema_version, profile_json, profile_hash, created_by_user_id, created_at)` plus a current-profile pointer on the new subject table.
- [ ] Add append-only `training_eligibility_responses` and `training_eligibility_decisions` with answer/policy versions, source response, state, typed constraints, reviewer provenance, effective/expiry times and supersession. Only the policy service/RPC writes decision state.
- [ ] The answer contract includes an explicit `confirmed_18_plus | minor | unknown` adult gate and a pregnancy/postpartum option. `minor` or `unknown` denies live assignment/start. Pregnancy/postpartum is passed to the approved decision policy; Wave 1C does not invent its branch or user-facing clinical wording.
- [ ] Add `coaching_relationships(subject_id, practitioner_id, status, permissions, started_at, ended_at, revision)`. A coach-invited legacy-client claim may create the initial relationship to that client's existing owner. A self-directed subject starts with none.
- [ ] Relationship revocation invalidates future coach writes and pending coach proposals but retains athlete-owned history. It never converts a coach-authored program to self-directed authority.
- [ ] Create `GET/PATCH /api/training/profile`, `POST /api/training/relationships/invitations`, and `DELETE /api/training/relationships/[id]`; validate with contract schemas and authorize again inside each write transaction.

### 4. Generalize authentication without weakening practitioner admission

- [ ] In `20260907041500_training_athlete_auth_provisioning.sql`, add `private.athlete_invitations` with normalized email, `self_directed | coach_invited` mode, nullable target client and issuer, expiring/single-use state, provisioned user and audit timestamps, plus append-only `private.athlete_access_events`.
- [ ] Replace `handle_new_user()` only in this coordinated migration. Exactly one live invitation class may match. Preserve the practitioner branch's behavior; the athlete branch creates an invited `training_subject`, optionally links the intended client, and never creates a practitioner row. Ambiguous or absent invitations fail closed.
- [ ] Add no-argument, JWT-derived RPCs `current_application_actor()` and `complete_athlete_invitation()`. Completion locks the invite/subject, verifies bound user/email and AAL2, consumes once, and activates the subject.
- [ ] Update `app/auth/confirm/route.ts` to choose athlete versus practitioner acceptance from `current_application_actor()` after OTP verification, never from an untrusted query parameter.
- [ ] Add `app/train/accept-invite/page.tsx` and `POST /api/training/auth/complete-invitation`. Extend the existing MFA page with an athlete completion target while preserving practitioner invitation/recovery behavior.
- [ ] In `proxy.ts`, keep public and AAL1 corridors narrow. After AAL2, route practitioners through the existing admission/legal/clinical gates. Route active athletes only to `/train/**`, `/api/training/**`, and athlete account settings; return `athlete_scope_denied` for practitioner/scan surfaces without signing out the valid athlete.
- [ ] Add actor-aware training navigation: Today, Program, Exercise library and History. Practitioner navigation and legacy Workouts visibility remain unchanged.
- [ ] Add a privacy-minimized self-registration endpoint that issues a `self_directed` athlete invitation through service-role authority with strict rate limiting and identical responses for existing/new email addresses. It creates no subject until the verified Auth invite is provisioned.

### 5. Add program assignment and frozen sessions

- [ ] In `20260907042000_training_program_sessions.sql`, add `training_program_assignments` keyed to `subject_id`, with immutable `program_mode`, nullable owning practitioner for self-directed mode, status, active revision and optimistic revision.
- [ ] Add append-only `training_program_revisions` containing the validated `TrainingProgramRevisionV1`, schema/rule/catalog/source-profile versions, canonical hash, author attribution and publish time. A unique assignment/revision number prevents replacement.
- [ ] Add scheduled `training_sessions` and one immutable `training_session_prescriptions` row created transactionally at start from the then-active eligible revision. Persist stable exercise-instance and set IDs, source hashes and versions. A trigger rejects prescription UPDATE/DELETE.
- [ ] Add start-time checks for active subject, adult gate, approved `eligible_general | cleared_with_constraints` decision, active assignment, program-mode authority and non-stale program revision. A later profile/program/scan change affects only eligible future sessions.
- [ ] Create `GET /api/training/today`, `GET /api/training/sessions/[id]`, and `POST /api/training/sessions/[id]/start`. The API calls the Wave 1B compiler/validator; it does not reproduce scheduling or prescription rules.

### 6. Add idempotent online set logging and visible conflicts

- [ ] In `20260907043000_training_online_logs.sql`, add append-only `training_set_log_events` with subject/session/exercise-instance/set IDs, event revision, exact entered decimal/unit/load basis, canonical decimal kg, reps, RIR, side, symptom state, actor kind/user, client occurrence time and server time.
- [ ] Add `training_mutation_receipts(actor_user_id, request_id, aggregate_id, request_hash, result_json, created_at)` with unique `(actor_user_id, request_id)`. Reusing a request ID with a different payload is a conflict; an exact retry returns the original acknowledgement.
- [ ] Add service-only transactional RPCs for `write_training_set_log` and `complete_training_session`. Lock the session, re-authorize subject/relationship and eligibility, compare `expected_revision`, insert the event/receipt, and increment once. A stale coach/athlete write returns the current safe set projection and never overwrites.
- [ ] Keep completion separate from set logging. A set entry, timer start, navigation, or rest action cannot complete a set/session. Edits append a correcting event with attribution; historical events remain auditable.
- [ ] Create `PUT /api/training/sessions/[sessionId]/sets/[setId]` and `POST /api/training/sessions/[sessionId]/complete`, plus `app/train/today/**`, `app/train/sessions/[sessionId]/**`, and `app/train/history/**`. Show prescribed versus actual values and explicit `Saving`, `Saved`, `Conflict—reload latest`, and `Not saved` states.
- [ ] Use contract decimal helpers end to end. Preserve `2.5 lb` as entered, canonicalize with `1 lb = 0.45359237 kg`, and never use JavaScript floating-point output as persistence authority.

### 7. Extend erasure, export and retention

- [ ] In `20260907044000_training_privacy_lifecycle.sql`, extend the existing forward-only privacy RPCs so an explicit training-subject owner erasure covers profiles, eligibility records, relationships, assignments, prescriptions, log events and mutation receipts while retaining only the minimum non-identifying audit receipt allowed by policy.
- [ ] Legacy client erasure removes practitioner-owned client data, the optional `client_accounts` bridge, coaching access and pending coach proposals. It preserves the athlete-owned subject and training history. Coach unlink behaves the same way without deleting client data. Neither path silently converts a coach-authored program to self-directed authority.
- [ ] Unlink/erasure ends any coach-assigned assignment as historical: retain immutable prescriptions/history, deny new publication into it, and allow historical-actual corrections only under the existing eligibility/session/ownership checks. An athlete may explicitly create a new self-directed assignment from current profile/calibration; do not mutate the ended assignment's mode.
- [ ] Add training stores to the approval-gated retention worker and export inventory. With no durable outbox in Wave 1C, logout clears rendered/cache state and no queued mutation can replay.

## Acceptance mapping and commands

| PRD/audit criterion | Required executable evidence |
| --- | --- |
| BLOCK-1, DA-03, PR-14 | SQL + authorization tests: self-directed subject with no coach can own/publish/log; unrelated athlete/practitioner/share token denied; revoked coach cannot write or promote. |
| EL-01, BLOCK-2 | Contract/API fixtures: minor/unknown adult gate denies; empty eligibility denies; pregnancy/postpartum input is preserved and delegated to the approved policy rather than hard-coded as clearance or exclusion. |
| PR-04, PR-07 | Route/SQL tests: exact fractional kg/lb/load-basis round trip; zero/partial/unknown actuals and symptom state persist without inventing completion or progression. |
| PR-11 | SQL tests: started prescription is immutable; new program/profile/scan revisions affect future sessions only. |
| DA-01 | Exact duplicate request returns one event and the original acknowledgement; changed payload under the same request ID returns 409. |
| DA-02 | Two online actors write from revision N; one succeeds, one receives 409 plus current projection; UI displays the conflict. |
| Unlink / legacy-client erasure | SQL + authorization tests: coach assignment becomes ended and rejects new publication; immutable prescriptions/history survive; authorized historical-actual correction remains possible; explicit self-directed continuation creates a new assignment without changing the ended mode. |
| UX-02 | Browser test logs, edits and reloads a set; saved state is accurate and rest/navigation never marks completion. |
| Legacy preservation | Existing practitioner admission, client ownership, workout run, share-token projection and legacy player tests stay green. |

Run the narrow loop while editing:

```bash
npx vitest run lib/training/access app/api/training app/train
npx vitest run proxy.test.ts lib/auth/public-paths.test.ts app/api/auth/complete-invitation/route.test.ts lib/auth/requirePractitioner.test.ts 'app/api/workouts/[id]/run/route.test.ts' 'app/workouts/[sessionId]/player.test.tsx'
```

Run schema and real-actor gates after each migration group, against local Supabase only:

```bash
ATHLETE_DB_WORKDIR=/tmp/posture-ai-athlete-training-identity
ATHLETE_DB_PROJECT=posture-ai-athlete-training-identity
test "$(awk -F'\"' '/^project_id = / {print $2; exit}' "$ATHLETE_DB_WORKDIR/supabase/config.toml")" = "$ATHLETE_DB_PROJECT"
test "$(awk '/^\[db\]$/ {in_db=1; next} /^\[/ {in_db=0} in_db && /^port = / {print $3; exit}' "$ATHLETE_DB_WORKDIR/supabase/config.toml")" = "55422"
test "$(docker inspect "supabase_db_$ATHLETE_DB_PROJECT" --format '{{index .Config.Labels "com.supabase.cli.project"}}')" = "$ATHLETE_DB_PROJECT"
mise exec node@22.23.2 -- npm exec --no -- supabase db reset --local --workdir "$ATHLETE_DB_WORKDIR"

test "$(awk -F'\"' '/^project_id = / {print $2; exit}' "$ATHLETE_DB_WORKDIR/supabase/config.toml")" = "$ATHLETE_DB_PROJECT"
test "$(awk '/^\[db\]$/ {in_db=1; next} /^\[/ {in_db=0} in_db && /^port = / {print $3; exit}' "$ATHLETE_DB_WORKDIR/supabase/config.toml")" = "55422"
test "$(docker inspect "supabase_db_$ATHLETE_DB_PROJECT" --format '{{index .Config.Labels "com.supabase.cli.project"}}')" = "$ATHLETE_DB_PROJECT"
test "$(docker inspect "supabase_db_$ATHLETE_DB_PROJECT" --format '{{.State.Health.Status}}')" = "healthy"
mise exec node@22.23.2 -- npm exec --no -- supabase test db --local --workdir "$ATHLETE_DB_WORKDIR"
mise exec node@22.23.2 -- npm run test:e2e -- e2e/athlete-identity.spec.ts e2e/training-online-log.spec.ts
mise exec node@22.23.2 -- npm run test:e2e -- e2e/auth-admission.spec.ts e2e/workout-player.spec.ts
```

The explicit workdir, project ID, port and Docker-label checks are mandatory before every database reset or test. A bare `supabase db reset` from the repository checkout is unsafe because it can target unrelated local development data.

Before the integration checkpoint, run fresh full gates on the unchanged merge candidate:

```bash
npm run lint
npm run typecheck
npx vitest run
npm test -w @posture-ai/engine
npm run build
ATHLETE_DB_WORKDIR=/tmp/posture-ai-athlete-training-identity
ATHLETE_DB_PROJECT=posture-ai-athlete-training-identity
test "$(awk -F'\"' '/^project_id = / {print $2; exit}' "$ATHLETE_DB_WORKDIR/supabase/config.toml")" = "$ATHLETE_DB_PROJECT"
test "$(awk '/^\[db\]$/ {in_db=1; next} /^\[/ {in_db=0} in_db && /^port = / {print $3; exit}' "$ATHLETE_DB_WORKDIR/supabase/config.toml")" = "55422"
test "$(docker inspect "supabase_db_$ATHLETE_DB_PROJECT" --format '{{index .Config.Labels "com.supabase.cli.project"}}')" = "$ATHLETE_DB_PROJECT"
mise exec node@22.23.2 -- npm exec --no -- supabase db reset --local --workdir "$ATHLETE_DB_WORKDIR"
CI=1 npm run test:e2e
```

## Remaining decision that needs a named owner

**Eligibility policy and wording:** the data contract and fail-closed gate are executable, but the activity/disease/symptom/intensity/pregnancy answer-to-state table, constraint semantics, urgent-help text and clearance scope require a named qualified clinical reviewer. Synthetic fixtures may exercise states without extra approval steps; they do not activate or clear a real athlete.

Wave 1C is complete when the self-directed and coach-assigned online paths pass the mapped gates, legacy suites remain green, and no required decision above is represented as current clinical or production approval.
