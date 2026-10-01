# Posture AI — Ops Runbook

Production operations reference for the Next.js app on Vercel + Supabase.
Last updated: 2026-09-08 (demo release preparation; provider deployment verified separately).

## Topology

| Piece | Where | Notes |
|---|---|---|
| Production app | https://posture-ai-ivory.vercel.app | Vercel project `posture-ai`, team `devin-wiggins-projects` |
| Production DB | Supabase `posture-ai` (`dhrkezfypzutiwtmcmof`, us-west-1) | **Zerosumsolutions-Projects Pro org** (`zljkaiwwkbpeyjsblwyb`) |
| Repo | github.com/ZeroSum-Solutions/posture-ai (private) | Owning Git remote. The current Vercel project's stored Git link still identifies `wiggdevin/posture-ai`, so pushes and PRs are not authoritative deployment evidence. |
| Local dev DB | `npx supabase start` (Docker) | migrations auto-applied; same stack CI uses |

Credentials: ZS Vault. `SUPABASE_ACCESS_TOKEN` (Management API, sees all orgs),
`VERCEL_TOKEN`, `posture_ai_supabase_db_password`. The Claude Supabase MCP
connector is OAuth-scoped to a different org — use the Management API
(`api.supabase.com`) with the vault token for this project.

Provider helpers resolve credentials from existing environment variables or ZS
Vault inside the process. Never put a token or secret value in a command argument,
receipt, terminal transcript, or committed file. A deployment receipt may record
credential names and verified scopes, but never their values.

## Environment variables

| Var | Scope | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | prod/preview/dev (Vercel) | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | prod/preview/dev | Public anon key (RLS enforced) |
| `NEXT_PUBLIC_SITE_URL` | prod/preview/dev | Canonical public origin; production must be `https://posture-ai-ivory.vercel.app` |
| `SUPABASE_SERVICE_ROLE_KEY` | prod/preview only | Server-only; never client-bundled |
| `CRON_SECRET` | prod/preview only | Vercel bearer secret for the daily privacy-maintenance route; required or the route returns 503 |
| `POSTURE_TEST_MODE_ENABLED` | **never in production** | Server gate for fixture scoring; set to `1` only by the e2e runner/CI |
| `NEXT_PUBLIC_POSE_MODEL` | optional | `lite` (default) or `full` MediaPipe model |
| `NEXT_PUBLIC_SHOW_UNREVIEWED_CONTENT` | unused | No effect since the clinical-content gate was removed (2026-10-01); safe to delete |
| `CLINICAL_CONTENT_RELEASE_ID` / `CLINICAL_CONTENT_HG03_RECEIPT_SHA256` | unused | The HG-03 activation gate was removed (2026-10-01); these are no longer read |

## Deploy

### Original application prototype operation

The prototype uses the original authenticated application: `/dashboard`, `/clients`,
`/assessments/new`, assessment results, and `/workouts`. The former `/demo` links
redirect to these original routes. Clients, scans, workouts, and progress use the
existing database tables. There is no separate browser-local application.

For the unused demonstration deployment, set server-only `POSTURE_OPERATION_MODE`
to `prototype` and `POSTURE_PROTOTYPE_PRACTITIONER_IDS` to a comma-separated list
of existing practitioner UUIDs. Invalid configuration retains the governed path.
Authentication, MFA, active practitioner admission, and record ownership still apply.
The selected practitioners can use the application without signing documents;
new records explicitly carry prototype provenance with no invented consent,
legal approval, or clinical-review receipt. Historical rows remain unchanged.
Prototype workout sessions do not mint public share tokens.

Apply the additive workout metadata and prototype-operation migrations before
releasing the corresponding application. Do not reset or replace existing records.
The original four-view capture accepts camera frames and image uploads, then
persists scored assessments and findings through the original results workflow.

The workout builder uses an owned assessment and preferences for goal, duration,
level, and equipment. Users can preview, customize, name, save, follow, and archive
workouts. Editing a completed or saved session creates a new copy to preserve
its history. For DeepSeek, set server-only `POSTURE_WORKOUT_AI_PROVIDER=deepseek`,
`POSTURE_WORKOUT_DEEPSEEK_API_KEY`, and `POSTURE_WORKOUT_DEEPSEEK_MODEL`.
For OpenRouter, select `openrouter` and set `POSTURE_WORKOUT_OPENROUTER_API_KEY`
and `POSTURE_WORKOUT_OPENROUTER_MODEL`. Only the selected provider is called. Provider failure returns
an explicitly labeled scan-based plan. No global test-mode flag is needed.

Verify the original authenticated scan-to-workout journey, including reload,
progress persistence, camera/upload recovery, and report download. Production
verification must check the exact public alias and record its deployment ID and
Git SHA; a READY build alone does not prove the alias serves that revision.

### Application release

The integrated strength builder supports 4, 6, 8 and 12-week cycles. Apply
`20260907053000_training_cycle_lengths.sql` before releasing these options. It
preserves historical eight-week compiler records and binds new cycle lengths to
the current compiler policy. The session player includes an optional rest timer;
starting or skipping it does not create a set log or change a prescription.
Private sample programs remain separate from real athlete records. The reference
library does not automatically populate the reviewed live training catalog.

The exercise library includes 279 attributable reference entries with search,
equipment/category filters, expandable instructions and incremental display.
Reference entries are separate from the versioned program catalog. Their source
and license are preserved in `content/training/library/` and on each entry.

New capture photos require migrations `20260907050000_capture_image_persistence.sql`
and `20260907052000_capture_upload_retry.sql` before the matching application is released.
Verify an authenticated upload and
retry, private photo retrieval, enlargement on Evidence, and access denial after
record deletion. Historical captures without stored photos remain explicitly
unavailable. Never represent a generated test color card as a real capture.

Evidence exposes the interactive anatomy viewer directly. Its neutral highlights
locate referenced anatomy; they do not assert muscle tightness or weakness.
Keep the viewer source revision and synchronized asset hashes in the release
record when updating the separate muscle-viewer project.

#### Exact-revision Vercel promotion

Do not infer a deployment from a merge or push. The owning Git remote is
`ZeroSum-Solutions/posture-ai`, while the current Vercel project still stores the
older `wiggdevin/posture-ai` link. Release the reviewed 40-character SHA
explicitly and verify the public alias separately.

1. Use a clean checkout of the reviewed commit, run release tooling with the
   pinned Node 22.23.2 lane, and record the exact 40-character SHA. Do not change
   Vercel environment variables during a code-only release. The `prebuild` step
   copies MediaPipe WASM from the pinned package into `public/mediapipe/wasm/`
   during the Vercel build.
2. Build the upload manifest from that commit's Git tree, never from uncommitted
   working-tree files. For every regular file, read the exact Git-object bytes,
   calculate Vercel's required file digest, and upload the content through
   `POST /v2/files` scoped to team `team_ZovXSbiQdKR8CvRpDYfAzbAr`.
3. Create the production deployment through `POST /v13/deployments`, scoped to
   project `prj_6Ryriizz6Exoye7zZxm0HlqCh0EX` and the same team. Supply the exact
   file manifest and record the reviewed SHA in deployment metadata. Obtain
   `VERCEL_TOKEN` inside the release process from an existing environment variable
   or ZS Vault; never pass it in argv or write it to a receipt.
4. Poll and inspect the returned deployment ID. Require `READY`, the exact project
   and team, production target, and deployment metadata matching the reviewed SHA.
   Treat an uncertain create response as unknown and inspect provider state before
   any retry.
5. Assign only the fixed `posture-ai-ivory.vercel.app` alias to that deployment
   through Vercel's deployment-alias API, then read the alias mapping back and
   require the exact deployment ID. A READY build alone does not prove what the
   public alias serves. Record deployment creation, readiness, alias mutation, and
   alias verification as separate privacy-safe receipts.
6. Verify `https://posture-ai-ivory.vercel.app/api/health` returns HTTP 200 with
   `{"status":"ok","database":"connected","schema":"ready"}`, then attach the
   deployment, alias, SHA, environment-scope, and hosted smoke receipts to the
   release record.

## Rollback

First check the legal-governance activation receipt described below. Before that
one-way latch is activated, the normal application rollback procedure remains
available. After activation, **never promote a deployment older than PR-05**:
its writers are intentionally rejected by the database. Use a PR-05-compatible
known-good deployment or a forward hotfix instead.

1. Vercel dashboard → Deployments → previous READY production deployment →
   *Promote to Production* (instant; no rebuild). Verify the exact deployment ID,
   SHA, project, and public alias after promotion. Never pass `VERCEL_TOKEN` on a
   CLI command line.
2. Database: migrations are forward-only. Write a compensating migration;
   never edit applied migration files.

## Migrations

`supabase/migrations/*.sql` is the **single source of truth** for schema. The app
does NOT self-apply schema at runtime (the old startup runner was removed) — so
**step 3 is mandatory**, or production runs new code against an old schema (which
is exactly how the assessment-detail / report routes silently broke once).

1. Add `supabase/migrations/<YYYYMMDDHHMMSS>_<name>.sql`.
2. Local: `npx supabase db reset` (rebuilds from the full chain; CI does the same).
3. Cloud (**required on every migration — do not skip**):
   ```bash
   umask 077
   migration_payload="$(mktemp)"
   migration_curl_config="$(mktemp)"
   trap 'rm -f "$migration_payload" "$migration_curl_config"' EXIT
   jq -Rs '{query: ., name: "<name>"}' < supabase/migrations/<file>.sql > "$migration_payload"
   printf 'header = "Authorization: Bearer %s"\n' "$SUPABASE_ACCESS_TOKEN" > "$migration_curl_config"
   curl --config "$migration_curl_config" -X POST \
     "https://api.supabase.com/v1/projects/dhrkezfypzutiwtmcmof/database/migrations" \
     -H "Content-Type: application/json" --data-binary "@$migration_payload"
   ```
4. Note: the cloud ledger stamps its own version numbers; keep names matching
   the local files so the chains stay reconcilable.
5. Verify: `GET /api/health` returns HTTP 200 with `"schema":"ready"`. It probes representative
   later-migration **tables and columns**, so a skipped *schema* migration (a new
   table or column) returns HTTP 503 with `"pending_migration"`; deployment health
   checks must treat that response as non-ready. Data-only migrations (row
   inserts/updates) aren't fully covered by the probe — CI's `supabase db reset`
   (the full chain) and the startup seed-count log are the backstop for those.

### PR-05 legal-governance cutover (HG-02; one way)

The `20260720000000_legal_document_provenance.sql` migration is an expand step.
Its latch starts inactive, so the migration alone does not disable the prior app.
Do not activate it during autonomous engineering or before counsel/product HG-02.

Activation prerequisites, all recorded in one privacy-safe HG-02 release receipt:

1. Counsel-approved, effective production documents for Privacy, Terms, Subject
   Consent, and Screening Notice are committed; their IDs, versions, hashes,
   jurisdiction, locale, scope, materiality, and approval references pass CI.
2. The migration is applied and `/api/health` reports `schema: ready`.
3. The PR-05-compatible app is the active production deployment; test mode is off.
4. Hosted smoke checks pass for practitioner acceptance/re-acceptance, new and
   existing-client subject consent/re-consent, pre-capture gating, assessment,
   both PDF variants, and workout/share notice projection. Final counsel text must
   be visibly legible in both PDFs.
5. In-flight writes from the previous release are drained. Record the deployment
   ID, migration receipt, smoke-check receipt, operator, and UTC time.

Then invoke the no-argument `public.activate_legal_governance()` function once
through the approved Supabase service-role database channel. Do not place the
service credential or SQL in shell history. Record the returned `activated_at`
timestamp and verify a new governed assessment succeeds while a disposable
`legacy_unverified` insert is rejected. The activation is idempotent and has no
deactivation path.

After activation, rollback behind PR-05 is forbidden. The INSERT latch blocks new
legacy consent tokens, consent records, assessments, reports, and workout sessions;
historical legacy rows remain readable and may still undergo non-provenance
lifecycle updates such as approval or erasure redaction.

### PR-06 privacy lifecycle and retention activation

`20260720010000_privacy_lifecycle.sql` makes database erasure transactional and
queues external report objects for idempotent retry. `vercel.json` calls
`/api/internal/privacy-maintenance` daily; Vercel supplies `Authorization: Bearer
$CRON_SECRET`. Missing or incorrect configuration fails closed. Do not invoke the
route with a secret in a command line or log; use the provider's scheduler or an
approved secret-bearing client.

The source-of-truth store inventory is
`docs/qa/privacy-lifecycle-retention-matrix.md`. The retention policy table is
empty by design and application roles cannot mutate it. After HG-02 approves an
exact duration, add it through a reviewed migration with the approval reference;
do not edit the table ad hoc. Until then the scheduled retention pass reports zero
policies and deletes no retained records. Hosted object inventory, backup/PITR
coverage, RPO/RTO, and restore/erasure propagation remain HG-07/HG-08 provider
evidence rather than claims made by this code.

Operational response:

1. A client DELETE response with `external_deletion_status: pending` means the
   database erasure committed and one or more provider objects remain queued.
2. Confirm the daily maintenance route is authorized and inspect the minimized
   receipt/outbox status through the approved operator channel. Do not copy object
   paths into tickets or logs.
3. Resolve provider availability and rerun the worker. Leased jobs become eligible
   again after five minutes; failures use bounded backoff and controlled codes.
4. Treat `complete` only as application database plus known-object deletion. A
   production launch still requires HG-07/HG-08 proof for orphan inventory and
   backup expiration/restore behavior.

### PR-07 clinical-content governance (HG-03) — gate removed 2026-10-01

**Current state:** the product owner removed the clinical-content review gate on
2026-10-01 (migration `20261001000000_remove_clinical_content_gate.sql`). Every
practitioner gets the full catalog — recommendations, programs, workouts,
knowledge links and clinical reports — with no HG-03 activation. Content is
recorded as `clinical-content-open-<inventory-prefix>`, backed by a receipt of
kind `open_ungated` whose attestation is `no_clinical_review`, so stored
provenance never claims a review. The procedure below is historical.


The production-safe default is assessment-only. With both clinical activation
variables absent, the server disables recommendations, programs, workouts, and
knowledge links; direct API, report, PDF, workout, share, static-asset, and
historical-download requests also fail closed. `NEXT_PUBLIC_*` state alone can
never activate clinical content.

Clinical source changes must be inventoried with:

```bash
npx vite-node --config vitest.config.ts scripts/generate-clinical-content-inventory.ts --write
npx vite-node --config vitest.config.ts scripts/generate-clinical-content-inventory.ts
```

The first command deliberately updates the reviewed artifact; the second is the
read-only CI check. Any item or governed-algorithm change produces a new hash and
invalidates prior approval for that item/release.

Activation requires all of the following, bound to the same inventory hash:

1. HG-03's licensed clinician signs an itemized receipt and records approved or
   rejected status for every item in the intended release scope.
2. The exact release and item hashes are committed to
   `content/clinical-review-ledger.json`; partial dependency closure never
   generalizes to unreviewed content.
3. The receipt, release, items, and activation are inserted through a reviewed
   forward migration. Browser roles cannot read the governance ledger, no
   application role may mutate it, and no application role can access the private
   activation table. A narrow RPC exposes only exact-tuple match/no-match.
4. The migration and compatible app are deployed, `/api/health` returns
   `schema: ready` and `clinical_content.status: assessment_only`, and production
   has test mode off.
5. Set `CLINICAL_CONTENT_RELEASE_ID` and
   `CLINICAL_CONTENT_HG03_RECEIPT_SHA256` to the exact committed values, then run
   `/api/health` again and require `clinical_content.status: active`; any source /
   database mismatch remains assessment-only. Then run
   direct-request smoke checks for assessment UI, both PDFs, workout mint/run,
   public share, exercise detail, muscle detail, and clinical static assets.

Rollback is fail-closed: first unset both clinical activation variables. This
immediately returns the app to assessment-only and prevents new clinical reports
or workouts. Existing clinical artifacts remain immutable but are rejected while
their release is inactive. Migrations remain forward-only; use a compensating
migration for database changes and never reactivate a rejected or superseded item.

Muscle KB content: edit files under `content/`, then
`node scripts/generate-content-index.mjs` and regenerate the seed migration via
`npx vite-node scripts/generate-muscle-seed.ts > supabase/migrations/<ts>_muscle_kb_seed.sql`.
Never hand-edit generated seeds. The content contract test
(`content/content.test.ts`) and UI vocabulary sweep (`lib/ui-vocabulary.test.ts`)
gate regressions in CI.

## PR-08 device and accessibility evidence

The canonical physical-device collection procedure is
`docs/qa/device-evidence-checklist.md`, mechanically checked against
`docs/qa/device-release-contract.json`. It supersedes the older Slice-3 and device-spike
checklists while retaining their live-worker telemetry rows.

Playwright mobile projects and the repository dummy packet prove only automation and
validator mechanics. They never satisfy HG-04. Before a human can complete HG-04, require
two physical runs on each supported device class, a structurally and physically valid
packet, a separate approved Ed25519-signed independent sample review, and an explicit
human-owned transition. Keep raw device media in the protected external evidence root;
only sanitized hashes and receipts belong in the proof root.

The physical validation command is:

```bash
npm run device:evidence:check -- \
  --contract docs/qa/device-release-contract.json \
  --receipt /protected/proof-root/device-receipt.json \
  --evidence-root /protected/raw-device-evidence \
  --release-configuration-receipt /protected/proof-root/release-configuration.json \
  --expected-commit <40-character-release-sha> \
  --expected-configuration-hash <sha256>
```

`release-configuration.json` must contain exactly `commit`, `configuration_hash`, and a nonempty `hg04_approved_reviewer_public_key_fingerprints` array. Those values are the production reviewer-key authority and must bind the same release; repository fixture keys are never accepted in physical mode.

The safe repository-fixture check is:

```bash
npm run device:evidence:check -- \
  --contract docs/qa/device-release-contract.json \
  --receipt scripts/fixtures/device-evidence/complete/receipt.json \
  --evidence-root scripts/fixtures/device-evidence/complete/artifacts \
  --fixture
```

Expected fixture semantics: structural true, physical false, launch false.

## Tests

| Suite | Command | Notes |
|---|---|---|
| Unit + content + vocab | `npx vitest run` | includes engine workspace, content contract, UI vocab lint |
| Engine only | `npm test -w @posture-ai/engine` | |
| e2e | `npm run test:e2e` | needs `npx supabase start`; desktop Chromium + mobile WebKit + Android Chromium proxy; `E2E_PORT=` to avoid clashes |
| a11y budget | part of e2e (`e2e/a11y.spec.ts`) | zero serious/critical axe violations |

## Security posture

- RLS on all tables; service-role used server-side after ownership checks.
- `POST /api/assessments`: zod-validated frames, 413 cap, 20/min/user rate
  limit (Postgres counter, fails open + logs), structured JSON logs (hashed user ids).
- CSP (`wasm-unsafe-eval` for MediaPipe), HSTS, `Permissions-Policy: camera=(self)`.
- `/api/dev/*` unreachable in production (proxy excludes + route 403s).
- Capture-photo release (requested September 8, 2026): new captures save one acquisition photo per view in private storage after the assessment is created. Landmarks remain the scoring input; corrected display previews are not uploaded. Historical screenings without stored photos remain photo-less. This replaces the former landmark-only retention policy when migration `20260907050000` and its upload route are deployed together; do not enable the client upload alone.
- The browser keeps each photo below 3 MiB before multipart upload; the server independently validates, decodes and re-encodes images without metadata. This stays below the [Vercel Function payload limit](https://vercel.com/docs/functions/limitations). Access uses the authenticated capture-image endpoint, with private/no-store responses. Capture/client erasure must remove image access immediately and enqueue stored-object deletion.
- Supabase advisors: clean as of 2026-06-12 except the intentional
  `api_rate_limits` RLS-no-policy INFO (service-role-only table).

## Practitioner admission and MFA

The practitioner beta is invitation-only. Hiding the signup screen is not the
security boundary: local Auth configuration, the admission trigger, application
gates, and sensitive-table RLS all independently deny public or AAL1 access.
Production provider configuration is verified separately under HG-01.

HG-01 must verify the hosted Auth project against this exact contract before
launch (the committed `supabase/config.toml` governs local Auth only):

- global public signup off while the email/password provider remains enabled;
- before-user-created hook enabled at
  `pg-functions://postgres/public/hook_enforce_practitioner_invitation`;
- TOTP enrollment and verification enabled, phone MFA disabled;
- invite and recovery templates installed from `supabase/templates/`;
- Site URL and redirect allowlist contain only the intended HTTPS app origins;
- secure password change and double-confirmed email changes enabled; and
- the practitioner admission migrations, including
  `current_practitioner_access_state`, are present before app promotion; and
- on a disposable hosted invite, `begin-mfa-recovery` can delete that user's
  managed `auth.sessions` rows and the pre-recovery access token, refresh token,
  `/auth/v1/user`, and `/auth/v1/factors` requests all fail afterward. This is
  proven on the local pinned stack only; a hosted schema/permission difference is
  a launch NO-GO until the implementation uses a provider-supported equivalent.

Record the read-only settings evidence under HG-01. Do not change the hosted
provider while running the autonomous engineering gates.

`npm run auth:practitioner` is the only repository operator entry point. It reads
all values from the environment so the service key never appears in command
history. It accepts these actions through `PRACTITIONER_ACCESS_ACTION`:

| Action | Required values | Result |
|---|---|---|
| `invite` | `PRACTITIONER_EMAIL`, `PRACTITIONER_DISPLAY_NAME`, `PRACTITIONER_ACCESS_ACTOR`, `NEXT_PUBLIC_APP_URL` | Creates one expiring allowlist record, then asks Auth to email the bound invitation. A retry or expired bound invite safely uses a recovery-token delivery instead of revoking/recreating the user. |
| `approve-existing` | `PRACTITIONER_EMAIL`, `PRACTITIONER_ACCESS_ACTOR` | Approves a reviewed pre-migration account; the next session still needs AAL2. |
| `revoke` | email, actor, `PRACTITIONER_ACCESS_REASON` | Revokes database membership first, then bans the Auth identity. Existing JWTs immediately lose data access through admission-aware RLS. |
| `begin-mfa-recovery` | email, actor, reason, `NEXT_PUBLIC_APP_URL` | Atomically moves the account to `recovery_pending` and deletes every Auth session, removes provider factors, freezes a new session cutoff, then sends a recovery-token email. |

The target defaults safely to local Supabase. A remote URL additionally requires
`PRACTITIONER_ACCESS_REMOTE_APPROVED=I_ACKNOWLEDGE_THIS_MUTATES_AUTH`. That flag
is a mechanical guard, not authorization: do not set it without the explicit
provider-change approval tracked by the release goal. Use ZS Vault for the
service-role credential; never paste it into a command or config file.

### Normal invitation

1. The Auth account owner verifies the intended email and records the operator
   identity. Issue one invitation; do not create the Auth user directly.
2. The practitioner opens the invitation email. The server verifies the invite
   token hash, then the practitioner sets a password.
3. The MFA page enrolls or challenges TOTP. Password setup alone remains AAL1
   and cannot read practitioner or client data.
4. After successful challenge, an authenticated database transition atomically
   binds the same user/email/invitation and marks membership active. The app then
   shows the non-diagnostic acknowledgement.

### Lost factor and break-glass recovery

There is deliberately no self-service MFA removal and no AAL1 emergency-data
bypass.

1. The Auth account owner verifies identity out of band using the approved HG-01
   procedure and records requester, verifier, reason, time, and ticket/receipt.
2. Run `begin-mfa-recovery`. One database transaction changes membership to
   `recovery_pending` and deletes all GoTrue sessions, so old access and refresh
   tokens cannot call Auth account-management endpoints after it commits.
3. The operator then removes all factors, freezes the post-deletion cutoff, and
   sends the recovery email. Any partial failure leaves access blocked; rerun the
   same action after resolving the provider problem.
4. The practitioner opens that email, chooses a new password, enrolls exactly
   one new TOTP factor, and verifies it. Completion requires both the email OTP
   and TOTP authentication timestamps to be after the frozen cutoff.
5. Confirm old sessions fail, the new AAL2 session passes, and attach the
   privacy-safe access-event receipt. Do not record the TOTP secret or raw token.

For suspected compromise, use `revoke` instead of recovery. Never delete the
Auth user to revoke access: the schema intentionally cascades practitioner
deletion into client records.

### Admission cutover and old file capabilities

New report and capture responses use same-origin, per-request authorized download
routes; they no longer mint one-hour storage URLs. URLs issued by a prior release
cannot be retroactively shortened. After deploying this change, allow the former
one-hour TTL to drain before treating URL revocation as fully effective or before
opening the practitioner beta. During that drain window, an emergency revocation
also requires deleting the affected stored object or rotating its path. Record the
cutover time and the one-hour drain completion in the release evidence.

## Known limitations / follow-ups

- **Branch protection** requires GitHub Pro on private repos — CI shows
  red/green but cannot hard-block merges. Process rule: never merge red.
- **GitHub Actions minutes** are account-wide; when exhausted, new runs are
  silently refused (PR checks never appear). Check Settings → Billing.
- **Clinical review gate**: removed 2026-10-01 (see PR-07 above). Clinical
  content is served without licensed-clinician review; provenance records say so.
- **Real-device matrix**: `docs/qa/device-release-contract.json` and
  `docs/qa/device-evidence-checklist.md` are the canonical iPhone/Android
  contract and collection procedure. Raw physical photos/video remain in the
  protected external evidence root and never become committed E2E fixtures;
  Git contains only non-sensitive metadata, hashes, and review receipts.
- **Threshold provenance / deferred clinical metrics**: engine thresholds carry
  boundary-level provenance (`packages/posture-engine/src/thresholds.ts`). Only
  `knee_extension_back_knee` is literature-cited (recurvatum: Loudon 1998 >5°,
  Kawahara 2012 >10°); everything else is an engineering default. True CVA / FSA /
  thoracic-kyphosis / APT metrics and any 2D varus-valgus cut-point remain deferred
  to the Layer-1 validation study (no honest 2D/goniometric citation exists yet).
- **"All Matched Exercises" maintain matches** (app follow-up): `deriveExerciseRecommendations`
  (`app/assessments/[id]/page.tsx`) surfaces `min_zone:'maintain'` exercises for any
  reliable finding at maintain zone (deviation 0), so a neutral metric still lists
  preventive exercises. Product decision whether to suppress maintain-zone matches;
  not a scoring bug.
- **Side-view direction arrows** (app follow-up): `DirectionArrow` references `arrow-*`
  marker ids while side markers are defined `arrow-side-*` — side arrowheads may not
  render. Pre-existing, unrelated to scoring.
- **Stale `threshold_config`**: `imbalance_definitions.threshold_config` (DB seed) is
  unused for scoring and already drifted (knee `danger_start:12` vs engine `10`). The
  engine's TS `THRESHOLDS` is the sole scoring authority; treat the column as dead.
