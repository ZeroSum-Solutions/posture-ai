# Posture AI — Ops Runbook

Production operations reference for the Next.js app on Vercel + Supabase.
Last updated: 2026-06-12 (production push P0–P6).

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
| `SUPABASE_SERVICE_ROLE_KEY` | prod/preview only | Server-only; never client-bundled |
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
