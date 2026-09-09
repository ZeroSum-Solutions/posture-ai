# Strength and conditioning product gap audit

> Implementation authority: [the approved PRD](2026-09-07-strength-conditioning-prd.md) and its normative fixtures. This source audit preserves earlier candidate interfaces; conflicting coach-only sequencing, four-week-first delivery, or ownership proposals are superseded by the PRD.

**Date:** 2026-09-07
**Scope:** Current source, schema, media, and access-model audit for 4/6/8/12-week strength and conditioning programs. This annex proposes interfaces and ownership seams only; it does not authorize migrations, deployments, media purchases, clinical claims, or athlete access.

## Decision

Keep the existing workout feature as the corrective-session module and build a new training-program module beside it. Reuse its screening-to-exercise selection, immutable provenance, media fallback, player presentation, practitioner ownership checks, and ordered run-write ideas. Do not enlarge `workout_sessions.program_snapshot` into the system of record for multi-week programming: the current row is an immutable, assessment-bound, week-1-to-3 playback artifact, while a strength program needs separately addressable weeks, sessions, prescriptions, sets, performance logs, sync operations, and progression decisions.

Athlete self-service does not exist today. All authenticated product authority belongs to an active, AAL2 practitioner; the sole application role is constrained to `practitioner`. A `client` is a practitioner-owned record without an `auth.users` identity. Public share tokens expose one redacted session for a limited period; they are not an athlete account, durable ownership grant, or suitable offline-sync credential.

## Confirmed current state

### Reusable foundation

| Capability | Current evidence | Reuse decision |
|---|---|---|
| Subject and screening ownership | `clients.practitioner_id` and `assessments.practitioner_id` anchor records to one practitioner; assessments retain engine version and the client link ([initial schema](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/supabase/migrations/20260101000000_initial_schema.sql:21), [assessment columns](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/supabase/migrations/20260101000000_initial_schema.sql:37)). | Keep as the screening system of record and one possible program source. |
| Practitioner admission | Runtime admission requires AAL2 plus an active row whose role is `practitioner` ([requirePractitioner.ts](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/lib/auth/requirePractitioner.ts:136)). The database constrains the beta to that single role ([practitioner admission migration](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/supabase/migrations/20260719020000_practitioner_admission.sql:141)). | Reuse for coach surfaces. Introduce athlete identity separately; do not weaken or overload this gate. |
| Authored exercise catalog | The checked-in inventory records 73 exercises ([clinical inventory](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/content/clinical-content-inventory.json:6)). Exercise content already models category, screening indications/contraindications, sets, hold/dynamic dosage, rep bands, media, cues, steps, and rest ([exercise schema](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/content/muscles/types.ts:151)). | Reuse the content validation and stable slugs. Extend the catalog for strength movement patterns, equipment, loading, laterality, and conditioning modalities rather than inferring equipment from prose. |
| Screening-derived selection | Workout generation flattens the authored program into an ordered, immutable session and carries priority keys into each item ([generateWorkoutSession.ts](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/lib/workout/generateWorkoutSession.ts:1), [snapshot types](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/lib/workout/generateWorkoutSession.ts:21)). | Reuse as a screening-source adapter. A strength plan may also have a manual or self-service source, represented explicitly. |
| Catalog and legal provenance | Governed snapshots bind clinical catalog version/hash; prototype snapshots explicitly say `prototype_unreviewed` ([generateWorkoutSession.ts](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/lib/workout/generateWorkoutSession.ts:68)). The database rejects snapshot mutation and mismatched active clinical provenance ([clinical governance migration](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/supabase/migrations/20260720020000_clinical_content_governance.sql:361), [active release enforcement](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/supabase/migrations/20260720020000_clinical_content_governance.sql:520)). | Preserve immutable source provenance on published program revisions and compiled sessions. Keep governed and prototype provenance distinct. |
| Player shell | The player supports hold/repetition timing, sets, rest, media fallback, voice/captions, resume, pause/skip, pre-session red-flag acknowledgement, and summary/rating. Its current set display is prescribed timing rather than set-by-set performance ([WorkoutPlayer.tsx](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/app/workouts/_player/WorkoutPlayer.tsx:748)). | Reuse visual primitives, media, voice, accessibility, and the phase reducer. Add a `TrainingSessionView` adapter; do not force load/RIR data into legacy `SessionItem`. |
| Ordered run writes | `session_runs.revision` provides monotonically ordered updates ([revision migration](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/supabase/migrations/20260702030000_session_runs_revision.sql:1)). The route uses an owner-scoped compare-and-swap ([run route](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/app/api/workouts/[id]/run/route.ts:67)). | Reuse the concurrency principle and owner filtering, not the row shape, for batched offline mutations. |
| Practitioner review before save | The current builder previews assessment-derived candidates, allows a bounded preference set and item removal, and requires human review before minting ([WorkoutLibrary.tsx](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/app/workouts/WorkoutLibrary.tsx:196)). | Reuse the preview/publish interaction for a program builder, expanded to a calendar and explicit weekly prescriptions. |
| Scoped guest playback | Governed share links use a hashed, expiring token and the public response explicitly projects only safe fields ([token projection](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/lib/workout/tokenProjection.ts:123)); link rotation stays practitioner-scoped ([shares route](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/app/api/workouts/shares/route.ts:97)). | Keep for guest delivery or onboarding previews. It cannot stand in for an athlete account. |

### Material gaps

| PRD need | Current limit | Required capability |
|---|---|---|
| 4/6/8/12-week programs | `Week` is the union `1 | 2 | 3`; `computeDose` is a fixed three-week ramp, and `workout_sessions.week` has the same check ([dosage.ts](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/lib/program/dosage.ts:3), [workout schema](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/supabase/migrations/20260702000000_workout_sessions.sql:23)). | Program duration, week/day schedule, revisions, deload policy, and publish lifecycle. |
| Set-by-set logging | A run stores one `{slug, completed, skipped, durationMs}` entry per exercise ([runState.ts](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/lib/workout/runState.ts:20)); there is no performed-set entity. | One durable performance row per set/interval with target-versus-actual fields. |
| kg/lb and fractional loads | Session timing contains sets plus seconds or integer reps only ([generateWorkoutSession.ts](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/lib/workout/generateWorkoutSession.ts:21)). | Decimal entered load, entered unit, canonical conversion, unit preference, increment/equipment constraints. |
| Reps and RIR | Current reps are a prescribed integer; post-session feedback records broad difficulty only ([workout schema](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/supabase/migrations/20260702000000_workout_sessions.sql:56)). | Actual reps and RIR per set, with validation that permits incomplete sets and unloaded movements. |
| Offline idempotent sync | The authenticated player keeps an in-memory queue, retries three times, and leaves an unsaved state after network failure ([player adapter](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/app/workouts/[sessionId]/player.tsx:69)). There is no IndexedDB/outbox, device identity, mutation key, server cursor, or reconnect drain. | Durable device outbox, batched idempotent mutation interface, per-operation acknowledgement/conflict, and pull cursor. |
| Next-week progression | The only progression is a predetermined three-week category formula; severity does not scale it ([dosage.ts](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/lib/program/dosage.ts:15)). | Evidence-backed progression proposals from performed sets, explicit review state, and immutable published revisions. |
| Conditioning | The exercise enum covers stretch, strengthen, mobility, activation, and informational ([initial schema](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/supabase/migrations/20260101000000_initial_schema.sql:7)). It has no interval, distance, pace, power, heart-rate, or work:rest prescription. | Conditioning modality and dose schema plus interval performance logging. |
| Full strength catalog | Current preferences recognize only band/roller; other strength equipment is excluded by a prose regex ([personalize.ts](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/lib/workout/personalize.ts:46)). The 73 checked-in files skew corrective: 33 strengthen, 18 stretch, 6 activation, 4 mobility, and 12 informational in this audit. | Structured equipment, movement pattern, muscle emphasis, setup, bilateral/unilateral, loading method, and substitution metadata; authored compounds/accessories/conditioning movements. |
| Athlete self-service | `clients` has no auth-user key ([initial schema](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/supabase/migrations/20260101000000_initial_schema.sql:21)), while product admission explicitly says only authenticated practitioners reach exercise output ([requirePractitioner.ts](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/lib/auth/requirePractitioner.ts:192)). | Athlete account binding, invite/claim flow, coaching relationship, athlete sessions, athlete-specific RLS, recovery/MFA policy, and audit trail. |

## Proposed domain modules and data seams

### 1. Identity and access module

Add athlete access through a separate module with a small interface such as `authorizeTrainingActor(userId, resourceId, action) -> { actor, clientId, practitionerId, permissions }`. Its implementation resolves either practitioner admission or an athlete-to-client binding. Do not add `athlete` to `practitioners.role` or accept a share token as a durable principal.

Suggested records:

- `client_accounts(client_id, user_id, status, claimed_at, revoked_at)`, unique on active `client_id` and `user_id` for the first release.
- `coaching_relationships(client_id, practitioner_id, status, started_at, ended_at, permissions)` as the future ownership seam. Initially it can mirror the existing `clients.practitioner_id`; later it permits organization coaches without rewriting training history.
- `athlete_invitations` with hashed, expiring, single-use tokens and an audit event table. Claiming binds an authenticated user in one transaction.

Every server writer must authorize the authenticated actor and independently scope the target `client_id`. Service-role access still requires explicit owner/relationship predicates, following the current run route's practitioner filter.

### 2. Program-definition module

Expose a deep interface: `draftProgram(input)`, `publishProgram(programId, expectedRevision)`, and `compileSession(programRevisionId, scheduledSessionId)`. Hide schedule expansion, validation, catalog resolution, screening traceability, and immutable snapshots behind it.

Suggested records:

- `program_templates`: reusable authored structure, creator/organization scope, title, goal, level, duration constraints, status, revision.
- `training_programs`: prescribed instance with `client_id`, owning `practitioner_id`, `duration_weeks CHECK IN (4,6,8,12)`, start date, goal, status, active revision, and operation mode.
- `training_program_revisions`: immutable published definition, catalog/content provenance, algorithm version, author, review/publish timestamps, and a canonical hash.
- `program_weeks` and `program_sessions`: week ordinal, day ordinal, label, scheduled offset, focus, and optional deload marker.
- `program_session_blocks`: ordered `warmup | strength | conditioning | cooldown` blocks.
- `strength_prescriptions`: exercise/content revision, set count, rep range, target RIR range, rest, tempo, load instruction, laterality, substitution group, and notes. Prescribed load should be optional because bodyweight and first-session calibration are valid.
- `prescribed_sets`: optional set-specific overrides. Use only where sets differ; otherwise the prescription's defaults keep the interface small.

Keep `workout_sessions` intact for historical corrective sessions. A compatibility adapter may render a legacy `SessionSnapshot` as a read-only `TrainingSessionView`. New scheduled sessions should persist normalized prescriptions and compile a frozen playback view at start, so later program edits never rewrite a performed session.

### 3. Performance logging and sync module

For strength set logs, store the user's exact entry and a canonical quantity:

- `set_performances(run_id, prescription_id, set_ordinal, actual_reps, actual_rir, entered_load_value NUMERIC(9,3), entered_load_unit kg|lb, canonical_load_kg NUMERIC(12,6), completion_state, client_occurred_at, server_recorded_at)`.
- Preserve fractional entry exactly; never use floating-point for load. Validate non-negative values and a product-bounded precision, but do not round a user's `2.5 lb` entry into the display unit.
- Treat RIR as an integer product field, typically `0..10`, with null meaning unreported. Do not infer RIR from broad session difficulty.

Use an offline-first command interface:

`syncTrainingMutations({ deviceId, mutations: [{ mutationId, aggregateId, baseRevision, occurredAt, kind, payload }], sinceCursor }) -> { acknowledgements, conflicts, changes, nextCursor }`

The device stores its outbox and current training view in IndexedDB. The server inserts a unique `(actor_id, device_id, mutation_id)` receipt and applies each command transactionally. A duplicate returns the original acknowledgement. Mutations to the same aggregate use `baseRevision`; conflicts return the latest safe projection instead of silently promoting stale state. Server timestamps order authoritative history, while client timestamps remain evidence of offline occurrence. Completion is a separate command from set logging so a reconnect can safely replay either.

This is deeper than exposing CRUD for every table: callers learn one sync interface, and ownership, idempotency, validation, conflict policy, and cursor generation stay local to the module.

### 4. Conditioning module

Do not encode conditioning as fake lifting sets. `conditioning_prescriptions` should represent `continuous | intervals | circuit` with modality, rounds, work/rest seconds, optional distance metres, target pace/power, heart-rate zone, or target RPE. `conditioning_interval_performances` records interval ordinal and actual duration/distance/pace/power/heart-rate/RPE. Only fields meaningful to the selected modality may be populated, enforced in the domain validator and database checks.

The player receives a discriminated union:

- `StrengthItem`: prescribed sets, reps, RIR, rest, load guidance.
- `TimedItem`: hold/work duration and rest.
- `ConditioningItem`: continuous or interval dose.

One timeline shell can render all three, but logging and progression rules remain modality-specific adapters.

### 5. Progression module

Compute next-week changes as proposals, never as in-place edits to the active program revision. `proposeProgression(programId, week, policyVersion)` should read only completed, acknowledged performance records and return changes plus reasons and source set IDs. Persist `progression_proposals` with `proposed | accepted | rejected | expired`, algorithm/policy version, input watermark, proposer, reviewer, and decision time.

Default coach flow: the practitioner reviews load/reps/RIR/frequency changes, edits if needed, and publishes the next immutable revision. If a later self-service tier permits automatic progression, model that as an explicit policy on the program with bounded increments, deload rules, missing-data behavior, and rollback; do not silently grant it through athlete auth.

### 6. Screening provenance module

A strength program can be based on a screening, manual coach design, or an athlete template. Represent this explicitly with `program_sources(program_revision_id, source_kind, assessment_id nullable, source_snapshot jsonb, source_hash, created_at)` and constraints tying `assessment_id` to `source_kind='screening'`.

For screening-derived programs, freeze the assessment ID, scoring-engine version, relevant finding IDs/keys and reliability, clinical content version/inventory hash, operation mode, and source hash at publish time. Keep the live FK for drill-through, but render the frozen basis if the current assessment or catalog later changes. Manual/self-service sources must never be labelled screening-derived. New strength outcomes also must not rewrite the original assessment.

## Product journeys

### Practitioner journey

1. Open a client and choose **Build program** from a current screening or **Start without screening**.
2. Select 4/6/8/12 weeks, days per week, strength goal, equipment, conditioning availability, and unit preference.
3. Review a week-calendar draft. Edit blocks, exercises, set/rep/RIR/rest/load targets, substitutions, and deload weeks.
4. Review source provenance and client access, then publish revision 1.
5. Monitor adherence and performed sets from the client page. Resolve sync conflicts or flagged entries without altering raw history.
6. Review a next-week progression inbox. Accept/edit/reject proposals and publish a new revision effective on a chosen week.

The present workout builder is a useful interaction seed, but its four preferences and removable linear list ([WorkoutLibrary.tsx](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/app/workouts/WorkoutLibrary.tsx:204)) are not a program editor.

### Athlete journey

1. Receive an invitation, authenticate, and claim the matching client record. Until this identity module ships, the product remains practitioner-operated.
2. See **Today** with the scheduled session, cached media status, sync status, and last performed values.
3. Start offline. For each set, confirm/edit load and unit, enter reps and RIR, then advance. Conditioning uses the matching timer/distance/RPE controls.
4. Finish the session; completion and all set events remain durable in the local outbox until acknowledged.
5. Review history and the next scheduled session. Athlete access shows only their client/program data and cannot approve screenings, publish coach-authored revisions, or view another client.

Public `/s/[token]` playback can remain a low-friction guest journey, but it should not receive multi-week history, broad offline caches, or progression authority.

## Media and rights strategy

The media pipeline is ready but the exercise clips are not. The catalog schema accepts loop/poster/GIF fields ([exercise schema](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/content/muscles/types.ts:177)), the player implements clip-to-poster-to-branded-fallback behavior, and a public-read `exercise-media` bucket exists ([bucket migration](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/supabase/migrations/20260704000000_exercise_media_bucket.sql:1)). This audit found zero checked-in exercise `media` blocks and zero video files under `public`; the 362 checked-in workout MP3s are locally generated static cues resolved by hash ([voicePack.ts](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/lib/workout/voicePack.ts:1)).

Do not restart the prior MoveKit purchase path. The July plan records that it was declined after only 8/73 catalog matches, roughly five true matches, while confirming that the dormant pipeline can accept a different source ([media plan](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/docs/plans/2026-07-04-exercise-media-and-content-upgrade.md:946)). It also marks the downloaded exercise dataset as license-unresolved and reference-only ([media plan](/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo/docs/plans/2026-07-04-exercise-media-and-content-upgrade.md:546)).

Recommended production style: owned or explicitly licensed human-demonstration clips in a neutral studio, with consistent framing, wardrobe, background, lighting, cadence, and camera height. Capture one clean loop plus a poster per variation; frame for both 16:9 and 9:16 safe crops; use a second angle only where setup or bar path cannot be understood from the primary angle. Keep clips silent and retain the existing caption/static-voice layer. Do not use generated motion as the movement authority.

Create an asset-rights ledger before upload: stable asset ID, exercise/content revision, source/vendor, model and property releases, contract/license file reference, permitted uses, public-redistribution right, territories, term/expiry, derivative/crop rights, attribution, raw/source checksum, exported-file checksum, reviewer, approval state, and takedown state. Because the existing bucket is public, only assets cleared for public CDN redistribution belong there. Unverified assets stay outside production storage and outside catalog releases. Media approval and clinical-content approval are separate states.

Pilot 12-20 high-frequency movements spanning squat, hinge, horizontal/vertical push and pull, carry, core, unilateral lower body, and one conditioning modality. Test comprehension, crop quality, buffering, and rights workflow before filming the full catalog. Continue using poster/text fallback for uncovered movements.

## Parallel implementation ownership

Assign one owner per seam and one owner for all schema migrations to avoid conflicting table definitions.

| Workstream | Exclusive file ownership | Consumes / produces |
|---|---|---|
| Schema and domain contracts | One new ordered migration series; `lib/training/types.ts`, validation fixtures, generated DB types | Produces stable tables, constraints, RLS/RPC interfaces. No UI edits. |
| Identity and authorization | New athlete invite/claim routes, `lib/training/authorization.ts`, auth pages and route guards | Consumes schema contracts; produces `TrainingActor`. Does not edit practitioner admission semantics. |
| Program compiler and progression | `lib/training/program/**`, `lib/training/progression/**` | Consumes catalog and immutable screening-source interface; produces revisions and compiled session views. |
| Sync and performance writer | `lib/training/sync/**`, one batched sync route, IndexedDB adapter | Consumes domain contracts and `TrainingActor`; owns mutation/idempotency/conflict behavior. |
| Practitioner product UI | `app/programs/**`, client-page entry points, coach review screens | Consumes program interfaces only. No schema or athlete auth edits. |
| Athlete app and player | `app/train/**`, training player adapter, offline status/outbox UI | Reuses workout player primitives; consumes `TrainingSessionView` and sync interface. No program rules. |
| Catalog and media | `content/training/**`, media ingest/validation scripts, rights-ledger tooling, exercise detail surfaces | Produces reviewed content/media revisions. No training logs or auth edits. |
| Legacy compatibility | Narrow adapters under `lib/training/legacy/**` and legacy workout regression tests | Keeps existing corrective sessions readable/playable without reclassification or backfill. |

The migration/domain-contract owner lands the interfaces first. Other workstreams develop against fixtures until those interfaces stabilize. Avoid multiple agents modifying `WorkoutPlayer.tsx`; one player owner should extract reusable presentation primitives and expose the new discriminated item interface.

## Candidate delivery order and gates

The integrated [PRD](2026-09-07-strength-conditioning-prd.md) selects an 8-week first vertical slice and requires athlete identity/online self-logging before its athlete-facing release. That integrated sequence supersedes the smaller 4-week coach-builder candidate below.

1. **Identity decision and domain contract:** decide coach-only first versus athlete self-service in the first release. Athlete self-service requires the identity/access work above; it is not a UI toggle.
2. **Schema and pure compiler:** program/revision/schedule/prescription/source structures, strength and conditioning item union, validation, and legacy adapter.
3. **Coach builder:** create, review, publish, and inspect a 4-week program before generalizing the duration check to 6/8/12.
4. **Athlete identity and read path:** invitation claim, athlete RLS, Today/history, and revocation. Adversarial cross-client tests are a release gate.
5. **Set logging and offline sync:** IndexedDB outbox, batched idempotent sync, reconnect/conflict flows, and exact fractional-load round trips. Simulate duplicate, reordered, partially accepted, multi-tab, and multi-device mutations.
6. **Progression:** proposal evidence, practitioner review, revision activation, missing-session/deload behavior, and an audit trail.
7. **Conditioning:** one modality end to end, then expand dose and telemetry fields only as real modalities require them.
8. **Media pilot:** rights-cleared pilot assets, fallback performance, accessible captions, mobile safe crop, then catalog-scale production.

Release evidence must separately cover practitioner ownership, athlete self-access, cross-client denial, immutable screening/program provenance, offline idempotency, exact kg/lb fractional round trips, accepted/rejected progression, and media rights state. Existing corrective-workout and share-token behavior should remain regression gates throughout.

## Audit method and confidence

This was a bounded source audit of the owning worktree, its two prior workout/media plans, current TypeScript modules, checked-in assets, and migration history. No runtime data was changed and no deployed storage bucket was inspected. Counts for checked-in exercises/media/audio describe this worktree only. Vendor license claims from the July plans were treated as historical decisions, not re-verified current rights.
