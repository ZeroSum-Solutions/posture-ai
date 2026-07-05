# posture-ai — Deep Audit

**Audited:** 2026-07-04 · **Commit:** `c4aa299025e45af337870f77b3cf3f7fb9c43a62` (main) · **Method:** evidence-only, read-only (no code changed). Nine areas graded PROVED / NO-ISSUE / WEAK / N/A against actual code, config, and current vendor docs. Business-logic engine math hand-verified; other areas gathered by parallel readers and spot-checked.

---

## Plain-language overview

posture-ai is in **good structural shape**. The posture engine is a clean, self-contained package with math that reproduces its test fixtures exactly (three deviation formulas re-derived by hand — all match). Multi-tenant data isolation is **solid**: every Row-Level-Security policy was read individually and none allow one practitioner to see another's clients, assessments, or consents; every privileged (service-role) database call is guarded by an ownership check; report-export and workout-mint approval gates are enforced on the server, not just hidden in the UI. One historical "any org readable" bug was already fixed in a later migration.

The findings that matter most are **hardening gaps, not active breaches**:

1. **Consent links are stored as plain text** in the database, while the equivalent workout share links are stored hashed. A database read-leak would expose usable consent links. (Highest-value fix — same hashing pattern already exists next door.)
2. **The browser security header (CSP) still allows `unsafe-inline`/`unsafe-eval` scripts**, which weakens cross-site-scripting defense. No injection point was demonstrated, but the mitigation is missing.
3. **The rate limiter "fails open"** (a database outage disables all limits) and **10 mutating API routes have no rate limit at all** — most notably consent-link minting.
4. **First-time camera use downloads ~16.5 MB** (pose engine) on mobile with only a small "preparing…" badge and no progress bar.
5. Two **code-hygiene** items: one real lint error in the workout player, and the workout run/rate API routes have zero tests.

**Confidence:** high for architecture, security, and engine correctness (read directly). Two iOS voice-cue findings and the unbounded-table-growth risk are **WEAK** — they need a real device or live production row counts to confirm. Nothing is fully blocked. **CAM-REAL** (real-camera capture) remains a manual device check, unfaked.

---

## Area-to-evidence table

Severity key: **S1** data-loss/security-critical/crash · **S2** broken feature / meaningful gap · **S3** degraded · **S4** cosmetic/minor.

### 1. Architecture

| Claim | Verdict | Sev | Evidence | Recommendation |
|---|---|---|---|---|
| Engine purity — no app/lib imports | NO-ISSUE | — | `packages/posture-engine/src/*` imports only intra-package (`engine.ts:1-10`); grep 0 hits for app/lib | — |
| Single engine copy | NO-ISSUE | — | `lib/` uses `import type` only (`buildProgram.ts:3`, `buildFindingRow.ts:2`); no re-implemented scoring | — |
| Content pipeline single-source | PROVED | S3 | TWO exercise registries: `content/exercises/*.ts` (73 files → `ALL_EXERCISES`, workout player, `generateWorkoutSession.ts:72`) vs DB `exercises` table (manual INSERTs `seed_data.sql`, used by `app/api/exercises/route.ts`). Not synced. | Generate DB seed from `content/` like `scripts/generate-muscle-seed.ts` |
| DB threshold_config authority | PROVED | S4 | `imbalance_definitions.threshold_config` diverges from engine (seed pelvic_obliquity warn3/danger8 vs `thresholds.ts:62` warn2/danger5) and is never read at runtime (grep 0) | Annotate non-authoritative; point to `thresholds.ts` |
| SessionSnapshot version guard | PROVED | S3 | `version: 1` is a compile-time literal; read sites cast `as SessionSnapshot` with no runtime check (`workouts/[sessionId]/page.tsx:54`, `tokenProjection.ts:34`). Old snapshots break silently on shape change | Add `if (snapshot.version !== 1) notFound()`/410 at both read sites |
| Client/server boundary — assessment page | PROVED | S2 | `app/assessments/[id]/page.tsx:1` — entire 1223-line page `'use client'`; 3+ serial fetch round-trips + heavy client-side `useMemo`; blank shell + spinner | Split server component (parallel data fetch) + thin client child; `dashboard`/`workouts` already do this |
| Client/server boundary — dashboard, workout player | NO-ISSUE | — | `dashboard/page.tsx:14`, `workouts/[sessionId]/page.tsx:13` async server components w/ `Promise.all` | — |

### 2. Platform compatibility (mobile-web; iOS Safari critical)

| Claim | Verdict | Sev | Evidence | Recommendation |
|---|---|---|---|---|
| getUserMedia degrades on iOS | NO-ISSUE | — | All `ideal` constraints, no `exact` (`FullScreenCapture.tsx:164-166`) → no OverconstrainedError | — |
| playsInline present | NO-ISSUE | — | `FullScreenCapture.tsx:496`, `WorkoutPlayer.tsx:441` | — |
| GPU→CPU + SIMD fallback | NO-ISSUE | — | `detect.ts:56-67` try GPU catch CPU; FilesetResolver auto-selects SIMD/no-SIMD (all 3 wasm variants served) | — |
| WakeLock guarded | NO-ISSUE | — | `use-wake-lock.ts:29` `'wakeLock' in navigator` | — |
| WakeLock iOS <16.4 gap | WEAK | S4 | caniuse wake-lock: iOS 16.4 (Mar 2023); best-effort, no crash, no UX hint for older devices | Optional "keep screen on" hint |
| Duplicate WakeLock impl | WEAK | S4 | `FullScreenCapture.tsx:96-155` hand-rolls wakelock instead of `useWakeLock` (WorkoutPlayer uses hook) | Consume the hook |
| SpeechSynthesis absence guard | NO-ISSUE | — | `WorkoutPlayer.tsx:147` guards `'speechSynthesis' in window` | — |
| iOS timer voice cues silently fail | WEAK | S3 | `speak()` in `useEffect` on `state.phase/index` driven by 200ms TICK (`WorkoutPlayer.tsx:146-165,104`), not a user gesture; iOS needs gesture unlock. Caption fallback `aria-live` exists (`:629`). Needs real iOS to confirm | Prime `speak()` in "Begin session" onClick |
| iOS cancel()-before-speak() stall | WEAK | S3 | `WorkoutPlayer.tsx:155` `cancel()` each speak; documented iOS queue-stall bug, no `resume()` | Add `if (paused) resume()` guard |
| Lite model default, payload gated | NO-ISSUE | — | `detect.ts:27-30` lite 5.78 MB default; loads on step-2 dynamic import (`assessments/new/page.tsx:84-102`) | — |
| Cold first-capture download size | PROVED | S2 | lite 5.78 MB + wasm SIMD 11.15 MB + js 0.32 MB = ~16.5 MiB before first pose. @10 Mbps ~14 s, @2 Mbps ~69 s. Immutable-cached after (`next.config.ts:45-50`) | Progress indicator + `rel=preload` |

### 3. Security

| Claim | Verdict | Sev | Evidence | Recommendation |
|---|---|---|---|---|
| RLS — all tenant tables | NO-ISSUE | — | Every policy read: practitioners/clients/assessments/findings/captures/reports/recommendations/consent_records/consent_tokens/deletion_log/workout_* all `USING (col = auth.uid())`; writes revoked from anon/authenticated in `regulatory_hardening_v2` (service-role sole writer). No cross-tenant path. | — |
| RLS — organizations (historical) | PROVED (fixed) | — | `20260629000000:119` was `USING(true)` (leaked org names/BAA/ids) → fixed `v2:195` to own-org only | Confirm v2 ran before multi-tenant data existed |
| RLS — reference tables | NO-ISSUE | — | imbalance_definitions/exercises/muscles/links SELECT `USING(true)` = shared KB, no PII; writes revoked | — |
| SECURITY DEFINER grant hygiene | NO-ISSUE | — | record_*_consent/resolve_workout_token/check_rate_limit/handle_new_user all REVOKE PUBLIC/anon/authenticated + GRANT service_role | — |
| **Consent tokens stored plaintext** | PROVED | S2 | `consent/link/route.ts:34` stores raw `randomUUID()`; `regulatory_hardening.sql:82` `token TEXT UNIQUE`. Workout token stores SHA-256 (`token.ts:10-17`). DB read-leak → forge consent | **Hash the consent token (SHA-256), same pattern as workout token** |
| CSP script-src 'unsafe-inline' | PROVED | S3 | `next.config.ts:16` — no nonce; ~0 XSS mitigation if a sink exists (none demonstrated) | Migrate to Next.js nonces |
| CSP 'unsafe-eval' in production | PROVED | S3 | `next.config.ts:16`, no NODE_ENV guard, served on all non-viewer routes | Verify Next 16 needs it; gate to dev if not |
| CSP object-src (global) | WEAK | S4 | Global CSP omits `object-src` (falls back to default-src 'self'); viewer CSP has `object-src 'none'` (`:40`) | Add `object-src 'none'` to global |
| Rate limiter fails open | PROVED | S3 | `rate-limit.ts:18-20` returns `true` on rpc error; pg outage bypasses all limits, no circuit breaker | Dead-man switch + alert on `server_error` logs |
| Uncovered mutating routes | PROVED | S3 | No `enforceRateLimit`: consent, **consent/link (token mint)**, clients PATCH, assessments PATCH, assessments approve, settings POST/PATCH, settings/organization PATCH, workouts/[id]/run, workouts/[id]/rate. Covered: 8 routes | Add IP-keyed limit to consent/link + consent first |
| dev/create-test-user in prod bundle | WEAK | S3 | `route.ts:6-9` NODE_ENV===production → 403 gate; route + hardcoded creds (`testpractitioner@postureai.test`/`TestPass1234!`) still bundled | Exclude at build; rotate creds; verify unusable vs prod project |
| Consent respond state oracle | WEAK | S4 | `consent/respond/route.ts:70-72` 410 (consumed/expired) vs 404 (not_found); randomUUID 122-bit (vs workout 256-bit) adequate | Collapse to uniform 404; raise entropy w/ hashing |
| safe-next open redirect | NO-ISSUE | — | `safe-next.ts:9-13` rejects `//`, `/\`, non-`/`; server-trusted origin | — |
| Service-role key never client-bundled | NO-ISSUE | — | `SUPABASE_SERVICE_ROLE_KEY` only in `server.ts:29`/instrumentation/health; `client.ts` `'use client'` uses NEXT_PUBLIC_ only | — |
| test_mode decoupled | NO-ISSUE | — | `NEXT_PUBLIC_POSTURE_TEST_MODE` = UI-only; server gates separate `POSTURE_TEST_MODE_ENABLED` (`assessments/route.ts:14`). No bypass | Rename to reduce confusion |
| Workout token hash/gate | NO-ISSUE | — | 256-bit CSPRNG hashed (`token.ts:10-17`); resolve gate hash/revoked/status/expiry/approved/deleted → uniform 404 | — |

### 4. Privileged areas

| Claim | Verdict | Sev | Evidence | Recommendation |
|---|---|---|---|---|
| Approval gates server-enforced | NO-ISSUE | — | reports `practitioner_approved` `route.ts:68-73`→403; workouts mint `:63-66`; approve PATCH-only `.eq(practitioner_id)` `:26-39`; comparison same-client/approved-prior `:82-115` | — |
| Service-role sites ownership-guarded | NO-ISSUE | — | clients POST/PATCH/DELETE, assessments PATCH/approve, workouts mint/run, reports, settings/org all scope `.eq('practitioner_id', user.id)` | — |
| captures fetch not atomic | WEAK | S4 | `assessments/[id]/route.ts:62` service `captures` fetch `.eq('assessment_id', id)` lacks practitioner_id filter; relies on prior anon check (two-step) | Add `.eq('practitioner_id', user.id)` |
| Tombstone honored on reads | NO-ISSUE | — | `resolve_workout_token.sql:62` `deleted_at IS NULL`→404; DB triggers reject inserts vs deleted client w/ FOR UPDATE (`regulatory_hardening_v2.sql:212-264`); assessments hard-deleted on erasure | — |
| Deleted client → 200 not 404 | WEAK | S4 | `clients/[id]/assessments/route.ts:22-31` ownership check omits `.is('deleted_at', null)`; returns empty 200 (no PHI leak; assessments hard-deleted) | Add filter for 404 consistency |
| exercise-media bucket write | WEAK | S4 | `20260704000000` public=true, no explicit INSERT-deny policy; relies on implicit Supabase default (service-role only) | Add explicit `WITH CHECK (false)` deny for anon/authenticated |
| Storage read scoping | NO-ISSUE | — | exercise-media public (non-PHI); posture-reports private signed `{user.id}/{assessment_id}`; captures service-role signed only | — |

### 5. Performance

Uncompressed chunk sizes (Next 16 Turbopack omits the first-load table; measured from `.next/`). Gzip ≈ ⅓–¼.

| Claim | Verdict | Sev | Evidence | Recommendation |
|---|---|---|---|---|
| @react-pdf server-only | NO-ISSUE | — | `next.config.ts:3` serverExternalPackages; grep 0 client chunks | — |
| /clients/[id] first-load ~972 KB | PROVED | S3 | recharts 414 KB static-imported `app/clients/[id]/page.tsx:12` though chart hidden until Progress tab; + root 446 KB + polyfill 112 KB | `dynamic(() => import(chart), {ssr:false})` |
| /assessments/[id] first-load ~1 MB | PROVED | S3 | engine chunk `0rx97r0fsqtnb.js` 455 KB (muscle-ID data inline) + root + polyfill | Split muscle-data JSON out of engine bundle |
| framer-motion isolated | NO-ISSUE | — | only `WorkoutPlayer.tsx:3`; 148 KB chunk not in rootMainFiles | — |
| Unbounded client-list queries | PROVED | S2 | `clients/page.tsx:26-31`, `assessments/new/page.tsx:63-66`, `api/clients/route.ts:17-28` no `.limit()`/`.range()`; PostgREST 1000-row cap silently truncates at scale; no server-side search | `.limit()` guard + `?search=` prefix filter |
| /api/clients/[id]/assessments unbounded | PROVED | S3 | `route.ts:36-46` no limit, embeds all findings, called w/ `include_findings=true` | `.limit(100)` + pagination |
| Dashboard paginated, no N+1 | NO-ISSUE | — | `dashboard/page.tsx:43` `.limit(5)`; count `head:true`; PostgREST embeds, no per-row loops | — |
| Player tick re-render | WEAK | S4 | `PlayingHud` (`WorkoutPlayer.tsx:600`) not memoized, re-renders every 200 ms; DemoCanvas/SegmentedProgress are `React.memo` | Memoize PlayingHud w/ primitive props |
| MediaPipe no byte-progress | PROVED | S4 | `FullScreenCapture.tsx:549-554` pill badge only; no fetch `onprogress` in `detect.ts`; ~16.5 MB opaque | Indeterminate/shimmer progress bar |

### 6. Deployment

| Claim | Verdict | Sev | Evidence | Recommendation |
|---|---|---|---|---|
| No vercel.json (defaults) | NO-ISSUE | — | no `vercel.json`; build `next build` (`package.json:9`); headers ship via next.config.ts, no conflict | Add vercel.json only if overrides needed |
| Node version not pinned | WEAK | S3 | no `engines`/`.nvmrc`/`.node-version`; Vercel picks runtime, can drift | Pin `engines.node` |
| Migration sequence gap _020000 | WEAK | S3 | `supabase/migrations/` jumps `20260702010000`→`030000` (confirmed by ls); likely numbering, not deletion | Confirm vs prod migration history |
| assessPosture within limits | NO-ISSUE | — | pure in-memory geometry, no I/O, <50 ms (`engine.ts`); frame payload cap 512 KB « Vercel 4.5 MB body limit | — |
| PDF route no maxDuration | WEAK | S4 | `reports/route.ts` `renderToBuffer` synchronous, no `export const maxDuration`; safe under default (~300 s) | Add `export const maxDuration` to document intent |
| No env startup validation | WEAK | S3 | env via `process.env.X!` scattered (`lib/supabase/*`); missing var fails only on first request | Zod parse in `instrumentation.ts` |
| Migrations forward-only / rollback | NO-ISSUE | — | 24 timestamped forward-only; `session_runs.revision` default 0 backward-compat; latest are add-only | Note seed-table re-seed (`20260705`) in deploy checklist |

### 7. Jobs & schedulers

| Claim | Verdict | Sev | Evidence | Recommendation |
|---|---|---|---|---|
| Token/consent expiry at read-time | NO-ISSUE | — | `resolve_workout_token.sql:60` `expires_at > now()`; consent `record_remote_consent` atomic expiry→410 | — |
| No cron/edge/pg_cron | N/A | — | no vercel.json, no supabase/functions, grep 0 pg_cron across 24 migrations | — |
| Unbounded table growth | WEAK | S4 | `api_rate_limits` stale IP-hash rows never pruned (anon routes use `ipHash ?? 'anon'`); `consent_tokens`/`workout_sessions` expired rows never deleted (~3650 consent/yr @10 clients/day). Needs live row counts | Periodic `DELETE` cleanup; document retention |

### 8. Business logic (engine — hand-verified on Opus)

| Claim | Verdict | Sev | Evidence | Recommendation |
|---|---|---|---|---|
| 3 distortion computations match fixtures | NO-ISSUE | — | Hand-recomputed: FHP `atan2(0.07,0.10)`=34.99° (`metrics.ts:43-44`); shoulder `atan2(-0.05,0.30)`=9.46° (`:72`); genu-L `180−angle2D`=11.41°≈11.42° + Varum dir (`:224-234`). All match | — |
| Severity zone boundaries | NO-ISSUE | — | `toZoneAndPct` continuous piecewise-linear; maintain[0,33) warn[33,66) danger[66,100]; zone flips inclusive at warn/danger; danger caps 100 at 2×danger (`thresholds.ts:83-100`). No off-by-one | — |
| Grade bands | NO-ISSUE | — | `toGrade` inclusive upper bounds S≤5/A≤15/B≤50/C≤85/D≤95/E≤100, no gaps (`:74-107`) | — |
| Muscle-link direction | NO-ISSUE | — | Schema role enums muscle{tight\|weak} (`types.ts:67`)→exercise{stretch\|strengthen} (`:126`); sampled deep-cervical-flexors→forward_head_posture role `weak`(→strengthen), clinically correct | — |
| pelvic_axial_rotation never scored | NO-ISSUE | — | confidence 0.3 < RELIABILITY_FLOOR 0.5 → unreliable, severityPct 0, excluded from aggregate (`metrics.ts:172-192`) | — |
| Screening-vocab gate coverage | WEAK | S4 | Content via Zod `screeningText()` (`types.ts:31,55`); rating notes via `assertScreeningText` (`rating.ts:56`); UI+PDF via line-based sweep `ui-vocabulary.test.ts` over app/components/lib/pdf. Line-based heuristic could miss a stem split across a multi-line template literal | AST-based scan; add multi-line test case |
| Workout timing math | NO-ISSUE | — | `itemSeconds = work + rest×(sets−1) + 8s`; hold=sets×secs, reps=sets×reps×4s (`generateWorkoutSession.ts:84-87`). Consistent, documented estimate | Runtime display parity = qa-loop spot-check |

### 9. Code quality

| Claim | Verdict | Sev | Evidence | Recommendation |
|---|---|---|---|---|
| Typecheck clean | NO-ISSUE | — | `npx tsc --noEmit` exit 0 | — |
| Lint: 1 error | PROVED | S2 | `react-hooks/set-state-in-effect` at `app/workouts/_player/WorkoutPlayer.tsx:397` (setState synchronous in effect body) | Move resets to handler/layout effect |
| Lint: 18 warnings | PROVED | S4 | 11 no-unused-vars (tests + engine imports), 5 no-img-element (`WorkoutPlayer.tsx:459` raw `<img>`) | Prefix `_`/remove; `next/image` |
| as-any join untyped | PROVED | S2 | `app/api/reports/route.ts:239` `(assessment as any).clients` Supabase join not typed | Explicit join type |
| Silent bucket-create swallow | PROVED | S3 | `app/api/settings/route.ts:88` `.catch(()=>{})` on createBucket; upload error still surfaces but debugging blind | `warn` log on catch |
| Justified swallows | NO-ISSUE | — | JSON-body `catch{400}` (clients/reports/settings-org/assessments); cookie-setter `server.ts:19`; assessments `:150` logs+marks failed | — |
| Workout run/rate zero tests | PROVED | S2 | no unit/e2e ref to `workouts/[id]/run` or `/rate` (core execution paths) | Add e2e run+rate |
| No API unit tests | PROVED | S3 | zero `*.test.ts` under `app/api/`; all coverage e2e-only | Add route unit tests for guards/validation |
| TODO census | NO-ISSUE | — | 1 in prod source: `app/assessments/[id]/findingsToMuscleStates.ts:113` TODO(genu-direction), schema-dependent | Backlog ticket |

---

## Blocked / needs live or device verification

No area is fully **BLOCKED**; all nine reached DONE with graded rows. Three WEAK findings cannot be promoted to PROVED without access the audit deliberately did not use:

| Finding | Missing evidence | Who/what confirms |
|---|---|---|
| iOS SpeechSynthesis timer cues silently fail; `cancel()` queue-stall | Real iOS Safari device; headless cannot reproduce the gesture/audio policy | Manual device pass (adjacent to **CAM-REAL**) |
| Unbounded `api_rate_limits`/`consent_tokens`/`workout_sessions` growth | Live production row counts over time | Prod DB read (out of audit scope) or a load test on local |
| Migration `_020000` gap: deletion vs numbering choice | Applied-migration history on the production project | `supabase migration list` against prod (out of scope) |

**CAM-REAL** (real-camera capture) stays a manual device check and must never be marked PASS from headless runs.

---

## Recommended fix clusters for /qa-loop Phase 3

Ranked by value; each is one root-cause branch:

1. **Consent-token hardening (S2 security):** hash `consent_tokens.token`; add rate limit to `consent/link` + `consent`; collapse the 410/404 oracle. (Area 3)
2. **WorkoutPlayer correctness/hygiene (S2):** fix `set-state-in-effect` lint error (`:397`); replace raw `<img>`; memoize `PlayingHud`; consume `useWakeLock` hook; add iOS `speak()` gesture-prime + `resume()` guard. (Areas 2, 5, 9)
3. **Assessment page altitude (S2 perf/UX):** convert `assessments/[id]` to server component + thin client; add `SessionSnapshot` version guard. (Areas 1, 5)
4. **Query bounds (S2/S3):** `.limit()` + server-side search on the three unbounded client-list queries and `clients/[id]/assessments`. (Area 5)
5. **Test coverage (S2/S3):** e2e for `workouts/[id]/run` + `/rate`; API-route unit tests. (Area 9)
6. **CSP + rate-limit resilience (S3):** nonce migration, drop `unsafe-eval` in prod, rate-limit circuit breaker, cover remaining mutating routes. (Area 3)
7. **Ops hygiene (S3/S4):** pin Node; env startup validation; annotate dead `threshold_config`; document table retention; sync exercise registries. (Areas 1, 6, 7)
