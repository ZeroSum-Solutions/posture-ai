# Posture AI — Ops Runbook

Production operations reference for the Next.js app on Vercel + Supabase.
Last updated: 2026-07-19 (production-readiness engineering; no provider mutation).

## Topology

| Piece | Where | Notes |
|---|---|---|
| Production app | https://posture-ai-ivory.vercel.app | Vercel project `posture-ai`, team `devin-wiggins-projects` |
| Production DB | Supabase `posture-ai` (`dhrkezfypzutiwtmcmof`, us-west-1) | **Zerosumsolutions-Projects Pro org** (`zljkaiwwkbpeyjsblwyb`) |
| Repo | github.com/wiggdevin/posture-ai (private) | push to `main` ⇒ production deploy; PRs ⇒ preview deploys |
| Local dev DB | `npx supabase start` (Docker) | migrations auto-applied; same stack CI uses |

Credentials: ZS Vault. `SUPABASE_ACCESS_TOKEN` (Management API, sees all orgs),
`VERCEL_TOKEN`, `posture_ai_supabase_db_password`. The Claude Supabase MCP
connector is OAuth-scoped to a different org — use the Management API
(`api.supabase.com`) with the vault token for this project.

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
| `NEXT_PUBLIC_SHOW_UNREVIEWED_CONTENT` | optional, non-prod | Show clinically-unreviewed muscle content with a badge |

## Deploy

- **Normal**: merge PR into `main`. Vercel builds (`prebuild` copies MediaPipe
  WASM from the pinned package into `public/mediapipe/wasm/`) and promotes.
- **Manual**: `npx vercel deploy --prod --yes --token "$VERCEL_TOKEN"`.
- **Verify**: `curl https://posture-ai-ivory.vercel.app/api/health` →
  `{"status":"ok","database":"connected","schema":"ready"}`.

## Rollback

First check the legal-governance activation receipt described below. Before that
one-way latch is activated, the normal application rollback procedure remains
available. After activation, **never promote a deployment older than PR-05**:
its writers are intentionally rejected by the database. Use a PR-05-compatible
known-good deployment or a forward hotfix instead.

1. Vercel dashboard → Deployments → previous READY production deployment →
   *Promote to Production* (instant; no rebuild), or
   `npx vercel rollback <deployment-url> --token "$VERCEL_TOKEN"`.
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
   jq -Rs '{query: ., name: "<name>"}' < supabase/migrations/<file>.sql | \
   curl -X POST "https://api.supabase.com/v1/projects/dhrkezfypzutiwtmcmof/database/migrations" \
     -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" --data @-
   ```
4. Note: the cloud ledger stamps its own version numbers; keep names matching
   the local files so the chains stay reconcilable.
5. Verify: `GET /api/health` returns `"schema":"ready"`. It probes representative
   later-migration **tables and columns**, so a skipped *schema* migration (a new
   table or column) shows `"pending_migration"`. Data-only migrations (row
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

Muscle KB content: edit files under `content/`, then
`node scripts/generate-content-index.mjs` and regenerate the seed migration via
`npx vite-node scripts/generate-muscle-seed.ts > supabase/migrations/<ts>_muscle_kb_seed.sql`.
Never hand-edit generated seeds. The content contract test
(`content/content.test.ts`) and UI vocabulary sweep (`lib/ui-vocabulary.test.ts`)
gate regressions in CI.

## Tests

| Suite | Command | Notes |
|---|---|---|
| Unit + content + vocab | `npx vitest run` | includes engine workspace, content contract, UI vocab lint |
| Engine only | `npm test -w @posture-ai/engine` | |
| e2e | `npm run test:e2e` | needs `npx supabase start`; mobile WebKit + desktop Chromium; `E2E_PORT=` to avoid clashes |
| a11y budget | part of e2e (`e2e/a11y.spec.ts`) | zero serious/critical axe violations |

## Security posture

- RLS on all tables; service-role used server-side after ownership checks.
- `POST /api/assessments`: zod-validated frames, 413 cap, 20/min/user rate
  limit (Postgres counter, fails open + logs), structured JSON logs (hashed user ids).
- CSP (`wasm-unsafe-eval` for MediaPipe), HSTS, `Permissions-Policy: camera=(self)`.
- `/api/dev/*` unreachable in production (proxy excludes + route 403s).
- Photos are never uploaded or persisted — landmarks only.
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
- **Clinical review gate**: muscle content ships `reviewed_by = null` and is
  hidden in production until reviewed (badged in dev/preview). Review then
  set `reviewed_by`/`reviewed_at` in `content/muscles/*` and regenerate the seed.
- **Real-device matrix**: docs/plans/2026-06-12-p0-device-spike-findings.md
  carries the iPhone/Android checklist; the captured photos become canonical
  e2e fixtures (same filenames in `e2e/fixtures/photos/`).
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
