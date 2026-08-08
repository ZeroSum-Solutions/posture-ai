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

---

# Delta re-audit — 2026-07-05

**Audited:** 2026-07-05 · **Commit:** `85293c4` (main) · **Scope:** delta over `c4aa299..85293c4` (26 commits: Plan 1 tail #61–#75 — golden harness, engine v2.0.0, threshold recalibration, validity/borderline; Plan 2 #76–#86 — muscle-KB regrade, coherence gate, evidence ranking, red-flag screen, why-this sheet) plus re-verification of every 2026-07-04 finding at HEAD. **Method:** five parallel readers; orchestrator re-verified the load-bearing new claims directly (`playerMachine.ts`, `runState.ts`, `buildProgram.ts`). Evidence-only; no code changed.

## Plain-language overview

The codebase remains structurally healthy: all 540 tests pass, typecheck and production build are clean, and Plan 2's new surface is largely sound — the six new migrations touch knowledge-base tables only (no historical client data mutated, all idempotent), literature citations never reach the database or any client-visible payload, all new user-facing copy passes the screening-vocabulary sweep, the QA seed script is hard-locked to localhost, and the coherence-debt ratchet provably fails in both directions (new debt AND silently-fixed debt).

Four things matter most:

1. **The red-flag safety screen is cosmetic beyond the first session.** The server accepts a completed workout run with the acknowledgement still null; resuming a session auto-starts playback after a countdown without ever re-asking about pain; the practitioner can't see the answer anywhere; and the share-link path drops it entirely. The screen works exactly once, on first play, client-side only.
2. **Progress comparisons silently cross engine versions.** Grade bands were recalibrated in engine v2.0.0, but client comparisons never check `scoring_engine_version` — a client scored under v1 bands can show grade "improvement" or "slippage" that is purely a calibration artifact.
3. **Every headline 2026-07-04 security finding is still open** — plaintext consent tokens, CSP `unsafe-inline`/`unsafe-eval`, fail-open rate limiter, now **9** uncovered mutating routes (3 added since, incl. run/rate/approve).
4. **New-surface polish gaps:** why-this sheet has no focus trap or scroll lock; the 2D map color legend renders only when "possible" markers exist; WorkoutPlayer now exceeds the 800-line hard max (815).

Confidence: high (direct reads, both new S2s re-verified by orchestrator). Still device-blocked: iOS speech/wake checks, CAM-REAL. Prod migration status unverified (requires authorization).

## New findings (delta surface)

| Area | Claim | Verdict | Sev | Evidence | Recommendation |
|---|---|---|---|---|---|
| 8/3 | Red-flag ack not server-enforced | PROVED | S2 | `runState.ts:81-113` — `buildRunUpdate` accepts `status:'completed'` with `red_flag_acknowledged` null; L99-100 only ratchets true. Zod allows optional (`run/route.ts:23`) | Gate completion (or log structured bypass event) server-side |
| 8/2 | Resume bypasses red-flag gate and auto-plays | PROVED | S2 | `playerMachine.ts:84` `resumePlayer`→`enterItem`→`upNext` (L100, timed); gate renders only in idle/intro (`WorkoutPlayer.tsx:321`); TICK active for upNext → auto-advance to playing. No re-ask, no e2e | Backlog item C1 — force gate before first TICK on resume |
| 8 | Progress persists in resumed session without gated begin() | PROVED | S2 | `WorkoutPlayer.tsx:176-199` save effect fires for any phase ≠ idle; resume lands in upNext. (First-ever progress still requires gated `begin()` — transitive claim holds only for session #1) | Same fix as above |
| 2 | red_flag_acknowledged invisible to practitioner | PROVED | S3 | Stored via run PATCH; zero renders under `app/assessments/`, `app/clients/`; token path drops it (`WorkoutPlayer.tsx:234-235`) | Surface on run detail/client timeline |
| 8 | Cross-engine-version grade comparison unguarded | PROVED | S3 | `clientComparison.ts:37-68` compares stored grade/score with no `scoring_engine_version` check; GRADE_BANDS recalibrated v2 (`thresholds.ts:92-99`: S 5→3, A 15→7, B 50→20, C 85→55, D 95→87). Version IS stored per assessment (`route.ts:139`) but not consulted | Add version-mismatch caveat to comparison output |
| 8 | Role-blind evidence pooling inflates stretch rank | PROVED | S4 | `buildProgram.ts:91-100` `linksForKeys` drops link role; `exerciseEvidenceForKey` takes max across roles — stretch on gluteus-medius×pelvic_obliquity gets weak-link weight 1.0 instead of tight-link 0.4 | Filter evidence by role↔category alignment |
| 2/5 | WhyThisSheet: no focus trap, no body scroll lock | PROVED | S2 | `WhyThisSheet.tsx:189-190` `role="dialog"` `aria-modal` set; Escape works (L166-173); tab escapes overlay; body scrolls behind | Add inert/focus-trap + overflow lock |
| 5 | 2D map legend only renders when "possible" tier present | PROVED | S2 | `MuscleBodyMap.tsx:169-178` legend gated on `hasPossible`; tight/weak red/blue uninterpreted otherwise | Persistent legend row |
| 5 | 2D vs 3D disagree on low-confidence display | PROVED | S3 | 2D: low → dashed-gray possible tier (`muscleMap.ts:192-193`); 3D: low stays colored at 0.4 intensity (`MuscleModel3D.tsx:11`, `findingsToMuscleStates.ts` no filter) | Align or document in 3D legend |
| 5 | Red-flag card: no focus management | WEAK | S3 | `WorkoutPlayer.tsx:727-776` no autoFocus/role; visible labels + testids present. Needs SR pass to prove impact | autoFocus first button |
| 5 | Validity/borderline labels lack accessible explanation | PROVED | S4 | `page.tsx:437-441` bare 11px text; borderline uses hover-only `title` (L432-435) | Accessible tooltip |
| 9 | WorkoutPlayer.tsx exceeds 800-line hard max | PROVED | S3 | `wc -l` = 815 (rule: 800 hard max). RedFlagCard/StopCard/DemoCanvas extractable | Extract subcomponents |
| 9 | Lint debt grew: 9 errors, 22 warnings | PROVED | S3 | 7× no-explicit-any `golden-synthetic.test.ts`, 1× prefer-const `golden/synthetic.ts:103`, 1× set-state-in-effect `WorkoutPlayer.tsx:424-428` (DemoCanvas reset) — backlog item 6 | Mechanical cleanup branch |
| 9 | Missing e2e: resume flow, why-this sheet | PROVED | S2 | `e2e/workout-player.spec.ts` covers red-flag yes/no on fresh start only; no resume or why-this spec | Add both specs (pairs with C1 fix) |
| A | New migrations safe (KB-only, idempotent) | NO-ISSUE | — | All six read in full; `trunk_lean_merge` keeps legacy rows (L4), `ON CONFLICT DO NOTHING`; borderline column nullable-add; regrade DELETE targets KB tables with no user-row FK | — |
| A | session_runs.red_flag RLS sound | NO-ISSUE | — | `pg_policies`: read-own only; writes service-role scoped `.eq(practitioner_id, user.id)` (`run/route.ts:63`) | — |
| A | Seed↔content round-trip intact | NO-ISSUE | — | Generator output count = seed INSERTs = content sum = 42 (pinned by `content.test.ts:277`); check constraint `high|medium|low` in DB; local DB count 42 | — |
| A | Regen trap: fix-migrations vs generator | WEAK | S4 | `20260707000000` embeds pre-fix `role='tight'` for thoracic-ES; `..010000` flips to weak; content file already weak so regen today is safe — trap is procedural | Note in generator: port fix migrations back to content before regen |
| C | Citations contained (never DB, never client) | NO-ISSUE | — | No `citation` column (information_schema 0 rows); generator omits it; token projection picks explicit fields (`tokenProjection.ts:32-38`); assessments join selects KB cols only; 0 banned stems in citations | — |
| D | New copy passes vocab sweep | NO-ISSUE | — | `ui-vocabulary.test.ts:10` roots cover `app/`; red-flag + why-this + stop-card strings: 0 banned-stem hits | — |
| E | QA seed localhost-locked | NO-ISSUE | — | `qa-seed.ts:24-34` hardcoded 127.0.0.1 + abort guard; key is the well-known local demo JWT | — |
| 8 | Coherence ratchet bidirectional | NO-ISSUE | — | `coherence.test.ts:79-88` asserts `newlyBroken=[]` AND `newlyFixed=[]`; KNOWN_DEBT count 30 = docs 30 (5 pairs spot-matched) | — |
| 8 | Thresholds v2 boundaries continuous | NO-ISSUE | — | pelvic_obliquity warn3/danger6 literature-sourced; severityPct equal on both sides of each edge (33 at warn, 66 at danger, hand-computed) | — |
| 8 | Evidence weights monotonic, ties deterministic | NO-ISSUE | — | high1.0/med0.7/low0.4; `eb-ea` then `slug.localeCompare` (`buildProgram.ts:172-173`); ranking reorders only (caps drop, never evidence) | — |
| 8 | Why-this overclaim + confidence-by-winning-role fixes present | NO-ISSUE | — | `WhyThisSheet.tsx:94-97` scoped copy (test C3 asserts); per-row `link_evidence` displayed, no cross-row max | — |
| 5 | Legacy assessments render via name fallback | NO-ISSUE | — | `muscleMap.ts:185-187` links-empty → `regionsFromLegacy`; missing viewer IDs surface as "N not shown" note (`MuscleModel3D.tsx:241-244`) | — |
| 9 | Baseline: tsc/tests/build | NO-ISSUE | — | tsc exit 0 (root + package); vitest 53 files / 540 tests pass; `next build` 47 routes OK; mediapipe payload unchanged (min first-capture ≈ 10.6 MB wasm + 5.8 MB lite model) | — |

## Prior-finding status at 85293c4 (supersedes 2026-07-04 where noted)

| 2026-07-04 finding | Status | Note |
|---|---|---|
| Consent tokens plaintext (S2) | **STILL OPEN** | `consent/link/route.ts:34` raw `randomUUID()` |
| CSP unsafe-inline/unsafe-eval; no global object-src (S3) | **STILL OPEN** | `next.config.ts:16` unchanged |
| Rate limiter fails open (S3) | **STILL OPEN** | `rate-limit.ts:17-19` |
| Uncovered mutating routes (S3) | **WORSE: 9 routes** | +`approve`/`run`/`rate` (authed, uncovered); token-facing GET/rate ARE covered (partial win) |
| Unbounded list queries ×4 (S2/S3) | **STILL OPEN** | clients, assessments/new, api/clients, clients/[id]/assessments |
| assessments/[id] client monolith (S2) | **STILL OPEN** | now 1236 lines |
| SessionSnapshot version guard (S3) | **STILL OPEN** | both read sites uncast-checked |
| recharts static import (S3) | **STILL OPEN** | `clients/[id]/page.tsx:9-12` |
| Dual exercise registries (S3) | **IMPROVED** | seed now AUTO-GENERATED from content/ (`20260705000000:1`); runtime still two sources |
| threshold_config divergence (S4) | **ANNOTATED** | inert-columns note in `20260706000000:13`; still never read |
| Workout run/rate zero tests (S2) | **IMPROVED** | `runState.test.ts` (148 lines) + red-flag e2e; route handlers still untested at HTTP layer |
| set-state-in-effect (S2) | **MOVED** | now `WorkoutPlayer.tsx:424-428` (DemoCanvas) |
| Silent bucket-create swallow; as-any join; captures 2-step; deleted-client 200; bucket write-deny; Node pin; env Zod; PlayingHud memo; WakeLock dup; dev route creds | **ALL STILL OPEN** | unchanged, see 2026-07-04 rows |
| clients list deleted-client ghost (QA-001) | **FIXED** | `clients/page.tsx:34-35` `.is('deleted_at', null)` |

## Blocked / unverifiable

| Finding | Missing evidence |
|---|---|
| iOS speech-cue / WakeLock behavior | Real iOS device (unchanged from 2026-07-04) |
| Prod migration status (6 pending per handoff) | Explicit prod authorization — not touched |
| Red-flag card SR impact | Screen-reader pass on device |

## Leverage plays (supersedes 2026-07-04 fix clusters)

1. **Red-flag integrity cluster (S2×3+S3)** — re-gate on resume, enforce/log server-side, surface ack to practitioner, add resume e2e. One branch closes the delta's whole top tier and resolves backlog item C1. The safety feature Plan 2 shipped currently works once, client-side only.
2. **Consent-token hashing + rate-limit coverage (S2, carried)** — unchanged top security play; SHA-256 pattern exists next door in `lib/workout/token.ts`.
3. **Cross-version comparison guard (S3, new)** — small fix, protects trust in progress tracking after the v2 recalibration; version already stored, just unconsulted.
4. **New-surface a11y/UX branch (S2/S3)** — focus trap + scroll lock, persistent map legend, red-flag autofocus, accessible tooltips, 2D/3D low-confidence alignment.
5. **Scale guards (S2/S3, carried)** — `.limit()` on 4 unbounded queries, dynamic recharts import, SessionSnapshot version guard.
6. **Hygiene batch (S3/S4)** — 9 lint errors (backlog item 6), WorkoutPlayer 815→<800 split, role-blind pooling fix, Node pin, env Zod validation, regen-trap note.

---

# Production-readiness re-audit — 2026-07-19

This section supersedes older claims about the app's **current** production readiness. Older sections remain as historical evidence only.

## Audit contract

- **Owner-confirmed target:** invite-only U.S. practitioner beta, responsive web only, screening/tracking only, no billing, no native Expo release, and no clinical-validity or population-norm claim.
- **Owner-confirmed privacy boundary:** non-HIPAA fitness/wellness cohort. Admitting a covered entity requires an explicit scope change and completion of every conditional HIPAA gate below.
- **Clinical-review capacity:** the owner confirmed a licensed clinician is available. Client-facing recommendations remain assessment-only/disabled until the itemized HG-03 review ledger is actually signed; reviewer availability is not approval evidence.
- **Current commit:** `0d3f84bdd6d7edbe8784b3ff73cf9704292bb33d` on clean `main`, equal to `origin/main` before this documentation update.
- **Council:** Codex primary audit; Anthropic Fable 5 at medium effort for product, security, and launch challenge; Kimi K3 for biomechanics, reliability, and clinical-claim challenge.
- **Verdicts:** `PROVED`, `NO-ISSUE`, `WEAK`, `BLOCKED`, and `N/A` use the repository deep-audit meanings. `S1` blocks any launch; `S2` blocks the proposed beta; `S3` is required before scaling or a materially broader launch; `S4` is cleanup.

## Executive verdict

**BLOCKED for production and for the proposed practitioner beta.** The engine and broad automated test suite are in substantially better condition than the product's launch controls. The shortest safe route is not a rewrite: fix the result-language contradictions, comparison claims, and capture hard failures first; then close access, legal/content, device, recovery, and reliability evidence gates in dependency order.

The current engine score itself is not the primary blocker. The largest immediate risks are presenting stale or unsupported interpretations of that score, allowing comparisons that ignore engine-version and measurement noise, and treating scaffold legal/clinical content as release-ready.

### Council positions

- **Codex:** `BLOCKED` — fix score/grade truth and comparison semantics first, then close admission, legal/content, device, recovery, and reliability evidence gates.
- **Fable 5, medium:** `NO-GO as-is; conditional GO after the gate list` — highlighted stale grade bands, unreviewed client-facing content, unearned progress claims, absent real-device evidence, unenforced invitation-only admission, and scaffold legal text.
- **Kimi K3:** `NO-GO` — highlighted stale grade bands, false population “rank,” progress wording below known measurement noise, incomplete legal/retention controls, the capture hard-failure acceptance path, and the unresolved pelvic construct/weight decision.

The council agreed that the lite/full model choice is not the first launch decision. Trustworthy presentation, reliable change detection, capture recovery, and operating controls come first.

## Reproducible baseline

| Check | 2026-07-19 result | Verdict |
|---|---|---|
| `npm run lint` | 0 errors, 22 warnings | `PROVED` with debt |
| `npm run typecheck` | passed | `PROVED` |
| `npx vitest run` | 109 files, 876 tests passed | `PROVED` |
| `npm test -w @posture-ai/engine` | 12 files, 132 tests passed | `PROVED` |
| `npm run golden` | passed | `PROVED` |
| `npm run build` | passed, 37 static pages | `PROVED` |
| Current GitHub CI | run `29707559825` succeeded for commit `0d3f84bdd6d7edbe8784b3ff73cf9704292bb33d`: `https://github.com/wiggdevin/posture-ai/actions/runs/29707559825` | `PROVED` |
| Production `/api/health` | HTTP 200 at `2026-07-20T00:27:53Z` from `https://posture-ai-ivory.vercel.app/api/health`; redacted body: `{"status":"ok","database":"connected","schema":"ready","timestamp":"2026-07-20T00:27:53.865Z"}` | `PROVED` for point-in-time reachability only |
| Physical iPhone and Android release matrix | no completed receipt | `BLOCKED` |
| Backup restore drill | no completed receipt | `BLOCKED` |

## Current findings

### 1. Scoring presentation and result truth

| ID | Sev | Verdict | Finding | Evidence | Release condition |
|---|---:|---|---|---|---|
| PRD-001 | S2 | `PROVED` | The engine grade bands and the result/PDF explanations disagree. A deviation of 14 is correctly graded B by the engine but the stale UI table describes it as A. | Engine bands: `packages/posture-engine/src/thresholds.ts:90-99`. Stale page bands and labels: `app/assessments/[id]/page.tsx:94-102,339-378,935-940`. Stale PDF bands: `lib/pdf/report.tsx:458-479`. | One shared grade projection drives engine tests, web legend, accessible copy, and PDF. Boundary tests fail if any consumer drifts. |
| PRD-002 | S2 | `PROVED` | “Front View Rank” and “Side View Rank” are mean severity values presented as a population rank/top percentage even though no reference population exists. | Rank derivation: `packages/posture-engine/src/engine.ts:121-134`. PDF labels: `lib/pdf/report.tsx:445-455`. Web already suppresses `overall_percentile`: `app/assessments/[id]/page.tsx:937-940`. | Remove the values or rename them as a plainly defined, non-population “view severity index.” No elite, critical, percentile, rank, or modeled-population copy. |
| PRD-003 | S2 | `PROVED` | The client Progress/Compare UI treats every nonzero severity change and every grade step as improvement or regression. It drops the stored engine version and bypasses the safer report comparison policy. | API returns version: `app/api/clients/[id]/assessments/route.ts:34-44`; page type drops it: `app/clients/[id]/page.tsx:53-60`; direction logic: `app/clients/[id]/page.tsx:264-317`; labels: `app/clients/[id]/ComparisonWorkspace.tsx:78-91,141-205`; safer policy: `lib/reports/clientComparison.ts:31-79`. | All comparison consumers share one version-aware policy. Cross-version comparisons fail closed. Until an eligible reliability profile exists, use the fixed fallback and say “within measurement tolerance” rather than improved/regressed. |
| PRD-004 | S2 | `WEAK` | Even the current fixed comparison deadbands (`score=3`, `severity=5`) are engineering fallbacks, not empirically established minimum detectable change. | `lib/reports/clientComparison.ts:31-79`; reliability generator exists but Tier B is empty and no eligible profile is consumed. | Preserve and label the fallback until the Tier B protocol produces an eligible, versioned profile; then consume only the validated severity-percentage-point MDC. |

### 2. Capture integrity and mobile-web readiness

| ID | Sev | Verdict | Finding | Evidence | Release condition |
|---|---:|---|---|---|---|
| CAP-001 | S2 | `PROVED` | Review displays hard failures for no person or multiple people, but “Use This Photo” remains enabled. Final submission later blocks invalid slots, so data integrity is preserved at the cost of a confusing late failure. | `app/assessments/new/FullScreenCapture.tsx:879-906`; multi-pose image detection: `lib/pose/detect.ts:22-43`. | Disable acceptance for all hard failures, keep the reason visible, and test no-person, multi-person, and recovery paths. |
| CAP-002 | S2 | `PROVED` | The cold camera path requires roughly 16.5 MiB for the lite model plus selected MediaPipe runtime assets, while the user sees no granular load/readiness progress. Immutable caching and GPU-to-CPU fallbacks/timeouts already exist, but constrained-network and both-delegates-failed recovery evidence does not. | Cache headers: `next.config.ts:43-50`; image fallback: `lib/pose/detect.ts:30-42`; video fallback: `lib/pose/live-worker.ts:28-50`; worker/frame timeouts: `lib/pose/live-backend.ts:30-132`; local asset sizes inspected on 2026-07-19. | Surface and adversarially test the existing fallbacks/timeouts; add user-visible readiness, restart/retry, and both-delegates-failed recovery; pass throttled cold-load and physical Android/iPhone checks. |
| CAP-003 | S2 | `BLOCKED` | Real-device permission, orientation, wake-lock, audio, memory, and screen-reader behavior has not been signed off for the beta surface. | Canonical contract/checklist: `docs/qa/device-release-contract.json` and `docs/qa/device-evidence-checklist.md`; no completed physical packet or independent review receipt. Playwright device proxies are non-physical evidence. | Complete two runs per supported physical class, pass the validator, obtain the separate signed independent sample review, then have a human explicitly transition HG-04. |

### 3. Reliability, biomechanics, and claim limits

| ID | Sev | Verdict | Finding | Evidence | Release condition |
|---|---:|---|---|---|---|
| REL-001 | S3 now / S2 for change claims | `PROVED` | The Tier B v2 analysis contract implements and tests ICC(A,1), agreement/consistency SEM, MDC95, deterministic participant-cluster intervals, missingness, and fail-closed packet provenance. Neutral restricted range makes SEM/MDC primary and ICC secondary. | `docs/qa/tierb-reliability/protocol.md`; `packages/posture-engine/src/reliability.ts`; `lib/reliability/`; `scripts/check-tierb-reliability.ts`. | Retain the frozen math, reference fixtures, and cryptographic guards; obtain separately authorized/adjudicated human data before consumer use. |
| REL-002 | S2 | `BLOCKED` | The checked-in Tier B packet is preparation-only and human collection remains unauthorized. The v2 minimum is the same 12 participants × 2 devices × 3 full re-stances × 4 slots = 288 unique photos (360 target). No generated profile is product-eligible. | `docs/qa/tierb-reliability/protocol.md`; `docs/qa/tierb-reliability/prepared.packet.json`; `packages/posture-engine/golden/protocol.md`. | HG-05 must supply valid collection authorization and consent, complete the exact protocol, obtain clustered uncertainty review, and sign eligibility decisions without tuning thresholds to force a pass. |
| REL-003 | S2 | `WEAK` | Pelvic obliquity remains an engineering proxy. Legacy depth-camera agreement was near zero and cannot validate the construct because BlazePose hip centers are not ASIS landmarks. | Prior validation artifacts in `datasets/moti/comparison-report-*.json`; current measurement remains based on pose-estimated hips. | Keep proxy wording and conservative weight until repeatability and construct review support a stronger claim; do not train the metric to the Moti archive. |
| REL-004 | S2 | `WEAK` | Shoulder tilt agreement improved with the full landmark model in the Moti archive, but that evidence alone does not meet the repository's default-switch decision rule or establish clinical validity. | `scripts/golden-model-compare.mjs`; Moti comparison reports; current web cold-load cost. | Do not make full the default from the Moti result alone. Decide only after device latency, repeatability, and metric-level delta evidence. |

### 4. Clinical content and product governance

| ID | Sev | Verdict | Finding | Evidence | Release condition |
|---|---:|---|---|---|---|
| CLN-001 | S2 | `PROVED` | All 29 muscle content records remain unreviewed (`reviewedBy:null`, `reviewedAt:null`). The public muscle library hides them, but assessment and program surfaces still consume clinical links and exercises. | `content/muscles/*.ts`; hide/unreviewed behavior: `app/muscles/page.tsx:7-20`, `app/muscles/[slug]/page.tsx:6-49`; report links: `app/assessments/[id]/MuscleBodyMap.tsx:188-235`; `docs/qa/BUGLOG.md:52-74`. | Licensed reviewer signs the full inventory and contraindications, or the beta is explicitly assessment-only with programs, workouts, and knowledge-base links disabled. |
| CLN-002 | S2 | `WEAK` | Screening disclaimers exist, but labels such as “critical,” population rank, causal muscle implications, and directional progress can exceed the evidence actually held. | Findings PRD-001 through PRD-004 and CLN-001. | Copy review enforces screening/proxy language throughout UI, PDF, share, and workout surfaces. |

### 5. Legal, privacy, consent, and lifecycle controls

| ID | Sev | Verdict | Finding | Evidence | Release condition |
|---|---:|---|---|---|---|
| LEG-001 | S2 | `PROVED` | Privacy, Terms, and consent copy identify themselves as scaffolding rather than counsel-approved release documents. | `app/privacy/page.tsx:13-14`; `app/terms/page.tsx:13`; `lib/consent/text.ts:5-6`. | Counsel-approved, versioned text with effective dates, jurisdiction/scope, retention, withdrawal, and re-consent semantics. |
| LEG-002 | S2 | `WEAK` | Capture-time consent, an age gate, strict frame schema, no-photo storage, and hashed share tokens are sound foundations. Consent withdrawal and workout-share revocation/rotation are not complete user workflows. | Consent create: `app/api/assessments/route.ts:67-87`; no image persistence: `app/api/assessments/route.ts:112-120`, `lib/validation/frames.ts:30-38`; withdrawal promise: `app/privacy/page.tsx:39-45`, `lib/consent/text.ts:25-26`; revocation-aware reader: `lib/consent/record.ts:13`; share mint UI: `app/assessments/[id]/ReviewDock.tsx:197`. | Implement withdrawal, share inventory/revoke/rotate, audit receipts, and post-revocation tests. |
| LEG-003 | S2 | `WEAK` | Client erasure is a nontransactional series of deletes; arbitrary free-text reason text is retained, weakening the claim that tombstones are PII-free. | `app/api/clients/[id]/route.ts:128,141-215`. | Controlled reason codes, transaction/outbox semantics for cross-system deletion, retry/idempotency, and a full erasure receipt. |
| LEG-004 | S2 if covered entities | `BLOCKED` | HIPAA readiness cannot be inferred from app code. Provider BAAs, Supabase plan/settings, PITR, enforced MFA, access controls, and operating procedures are unverified. A practitioner can currently self-describe organization status in app settings. | `lib/auth/requirePractitioner.ts:21-64`; direct browser data read example: `app/clients/page.tsx:20-35`; settings: `app/settings/page.tsx:333,412`; organization API: `app/api/settings/organization/route.ts:21`. | Keep first cohort non-HIPAA, or stop launch until provider BAAs and the complete HIPAA operating-control receipt exist. |

### 6. Admission, authentication, and authorization

| ID | Sev | Verdict | Finding | Evidence | Release condition |
|---|---:|---|---|---|---|
| AUTH-001 | S2 | `BLOCKED` | An invite-only beta is not enforced in repository code. A public signup page exists and local Supabase config enables signup; the live production Auth setting was not changed or inspected in this audit. | `app/auth/sign-up/page.tsx:15-26`; `supabase/config.toml:170-173`; practitioner bootstrap: `supabase/migrations/20260101000000_initial_schema.sql:180`. | Disable public admission in UI and provider configuration; use admin-issued invitations/allowlist; attach a production configuration receipt. |
| AUTH-002 | S2 | `WEAK` | No application-level AAL2 enforcement is present; local TOTP configuration is disabled. | `supabase/config.toml:291-299`; authenticated route protection relies on session/role rather than MFA level. | Require MFA for practitioner accounts, test enrollment/recovery, and verify server enforcement rather than a visual prompt alone. |
| AUTH-003 | S2 for HIPAA | `WEAK` | API helpers enforce practitioner and BAA checks on selected routes, but browser-side Supabase reads do not all pass through that gate. | `lib/auth/requirePractitioner.ts:21-64`; `app/clients/page.tsx:20-35`. | For a covered-entity launch, require an admin-controlled organization status and prove a two-tenant authorization matrix on a real database. |

### 7. Security and operations

| ID | Sev | Verdict | Finding | Evidence | Release condition |
|---|---:|---|---|---|---|
| SEC-001 | S2/S3 | `WEAK` | The normal rate limiter fails open when its backing service is unavailable. A strict helper exists but protects only a small set of sensitive operations. | `lib/rate-limit.ts:23-47`; route inventory completed 2026-07-19. | Strict or explicitly degraded behavior for public, expensive, and destructive endpoints; outage and abuse tests. |
| SEC-002 | S3 | `PROVED` | Global CSP permits `unsafe-inline` and `unsafe-eval`. No direct XSS sink was found in the audited client surfaces, so this is hardening rather than evidence of exploitation. | `next.config.ts:13-26`. | Nonce/hash CSP compatible with MediaPipe and Next.js; report-only rollout followed by enforcement. |
| SEC-003 | S2 | `WEAK` | Operational logging is console-only, sometimes includes raw resource UUIDs, and has no verified error monitor or alert routing. | `lib/log.ts:1-33`; repository and provider configuration inspection on 2026-07-19. | Privacy-safe structured logging, error monitoring, alert owner, tested notification, and documented retention/access. |
| OPS-001 | S2 | `BLOCKED` | No verified backup/PITR configuration or restore drill exists. Supabase plan defaults are not proof of this project's state. | No project receipt in repository or inspected provider state. | Declare RPO/RTO, verify backup/PITR settings, restore into an isolated target, and attach timing/data-integrity evidence. |
| OPS-002 | S2 | `WEAK` | Migrations are manual and production `main` auto-deploys. Health can return HTTP 200 while reporting `pending_migration`; rollback guidance can pair old app code with forward-only schema. | `docs/RUNBOOK.md:10-12,31-68`; `app/api/health/route.ts:38-43`. | Dedicated staging, migration ledger/prepromotion, expand-migrate-contract compatibility, health 503 on non-ready state, and protected production promotion. |
| OPS-003 | S2 | `WEAK` | Main branch protection/rulesets and GitHub vulnerability alerts were absent in the live repository settings checked on 2026-07-19. | Read-only GitHub API inspection on 2026-07-19. | Required CI, review, secret/dependency scanning, and protected promotion policy. |

### 8. Scale, maintainability, and historical compatibility

| ID | Sev | Verdict | Finding | Evidence | Release condition |
|---|---:|---|---|---|---|
| SCL-001 | S3 | `PROVED` | Four high-use client/assessment reads are unbounded and will degrade as a practice history grows. | `app/clients/page.tsx:20-56`; `app/api/clients/route.ts:18-30`; `app/assessments/new/page.tsx:72-101`; `app/api/clients/[id]/assessments/route.ts:34-53`. | Cursor pagination/search and bounded 150/300/1000-record performance receipts with no omissions. |
| SCL-002 | S3 | `WEAK` | Several critical client modules remain large, increasing regression risk; workout snapshots are accepted without runtime version/schema validation. | Results page ~1169 lines; capture ~1033; workout ~928; client detail ~627. Snapshot readers/writers: `lib/workout/generateWorkoutSession.ts:46-56`, `app/workouts/[sessionId]/page.tsx:51-58`, `lib/workout/tokenProjection.ts:28-35`. | Extract tested boundaries and add explicit snapshot schema/version migration or rejection behavior. |
| SCL-003 | S3 | `WEAK` | QA inventory/bug ledgers contain stale status and duplicate identifiers, making completion evidence less trustworthy. | `docs/qa/INVENTORY.md`; `docs/qa/BUGLOG.md`; live reconciliation on 2026-07-19. | Reconcile ledgers as part of each closed task and reject duplicate IDs in CI. |

### 9. Explicit exclusions

| Surface | Verdict | Reason |
|---|---|---|
| Native Expo release | `N/A` | It is excluded from the proposed responsive-web beta. Native capture still lacks landmark extraction and has its own stale-type failure; exclusion must be asserted in release notes and routing. See `docs/plans/2026-06-11-product-goal.md:20-28` and `mobile/src/CameraCaptureScreen.tsx:19-23,80-117`. |
| Billing/subscriptions | `N/A` | No paid launch is in the working beta target. |
| Public consumer signup | `N/A` as a feature; `S2` to disable | The beta is assumed invitation-only. |
| Clinical diagnosis/validation claim | `N/A` | The product remains a screening and tracking tool. |

## What is already strong

- The scoring engine has broad unit coverage and passed its current golden checks.
- Reliability formulas, guards, provenance, and consumer-eligibility metadata are implemented; the missing piece is empirical Tier B evidence, not basic math.
- Assessment creation requires consent and an adult gate, validates frames strictly, and does not retain source photos.
- Share tokens are hashed at rest.
- The public muscle library already hides unreviewed content.
- The production health endpoint currently reports connected/ready, but that is not a substitute for recovery, device, or privacy evidence.

## Launch decision

The app becomes eligible for an **invite-only beta release decision** only when:

1. Every applicable S1 and S2 row in this re-audit, including conditional escalations created by the selected cohort, passes; the launch checker derives this list from the current audit/goal manifest rather than a hand-maintained subset.
2. The owner explicitly chooses the legal/privacy cohort. If any covered entity is included, LEG-004 and AUTH-003 become hard blockers and provider BAAs/configuration receipts are mandatory.
3. A licensed clinician signs the content inventory, or the release is feature-gated to assessment-only.
4. No open S1 or S2 remains, no required human gate is merely “frozen,” and deployment is explicitly approved after the final audit.

The executable closure sequence is specified in `docs/plans/2026-07-19-production-readiness-goal-spec.md`.

---

# Focused deep re-audit — 2026-08-07

**Audited commit:** `32b5a30e72c5f19c53584a466ecf4ac7bcd57ae9` (`main` at audit start)

**Scope:** all nine `/deep-audit` areas; source/configuration and safe local commands only. This section supersedes 2026-07-19 current-status claims where the same behavior is re-checked below. `docs/evidence/**` was not bulk-read. No production data was queried and no production or provider state was mutated.

## Plain-language overview

The application is materially tighter than the July audit: the canonical Next.js build passes, all 2,121 unit tests pass, client lists are paginated for current callers, hard capture failures now disable photo acceptance, and the camera/player have explicit GPU-to-CPU, wake-lock, speech, retry, and readiness fallbacks.

Three issues matter most. First, the public health check can say the database schema is ready even when required database functions from the newest migration are missing. Second, knee-inward and knee-outward findings still share direction-specific muscle advice, so opposite presentations can receive the wrong map/program implication. Third, workout progress saves are fire-and-forget and the server's revision check is not atomic; a failed or reordered request can silently lose newer progress.

Other proved weaknesses are narrower: the optional webpack builder rejects a named page export; a few compatibility reads remain unbounded; dashboard averages can be truncated above Supabase's 1,000-row default; CSP and some public rate limits are defense-in-depth gaps; a failed logo metadata write can leave an orphaned object; and five API routes lack direct tests.

Confidence is high for source-backed findings and local gates. Physical iOS/Android behavior, database query plans and 150/400 seeded performance, the applied production migration ledger, provider backup/PITR settings, and an exact production first-load-JS table remain blocked by missing device/provider/local-database evidence. No claim below treats those gaps as passing.

## Area-to-evidence table

| Area | Claim | Verdict | Severity | Evidence (file:line / URL / calculation) | Recommendation |
|---|---|---|---:|---|---|
| 1. Architecture | The posture engine remains independent of the app. | `NO-ISSUE` | — | `rg -n "^import .*(@/\|app/\|lib/)" packages/posture-engine` returned no matches; engine imports are package-internal, e.g. `packages/posture-engine/src/metrics.ts:1-3`. | Preserve the package boundary in CI. |
| 1. Architecture | Reviewed runtime content comes from the same typed catalog used for release IDs/hashes. | `NO-ISSUE` | — | `lib/clinical-content/catalog.ts:12-33` filters `ALL_EXERCISES`/`ALL_MUSCLES` by approved release IDs; `app/exercises/page.tsx:8-22` consumes that projection. | Keep the typed catalog as the rendering source and DB rows as governed indexes/receipts. |
| 1. Architecture | Heavy assessment results preserve a server/client boundary. | `NO-ISSUE` | — | `app/assessments/[id]/page.tsx:1-21` resolves access/data server-side and passes only initial props to `ClinicalAssessmentResults`. | Keep data loading server-side when splitting the client UI. |
| 1. Architecture | Workout snapshots are versioned, but runtime validation is only a release-header check. | `WEAK` | S3 | v1/v2/v3 types: `lib/workout/generateWorkoutSession.ts:47-79`; current mint upgrades to v3 at `:187-207`. `isClinicalSnapshotForRelease` checks only `version` and two `clinicalContent` fields (`lib/workout/tokenProjection.ts:109-121`), then the in-clinic page casts the whole JSON blob (`app/workouts/[sessionId]/page.tsx:27-36,61-65`). A malformed stored `items` shape was not injected into a DB to prove the crash path. | Parse the complete snapshot with a versioned runtime schema before either player hydrates. |
| 2. Compatibility | Camera constraints are preferences, not device-excluding requirements. | `NO-ISSUE` | — | `app/assessments/new/FullScreenCapture.tsx:294-340` uses `ideal` width/height/aspect/facing and provides retry/upload failure handling. MDN says `ideal` is non-mandatory while `min`/`max`/`exact` can reject with `OverconstrainedError`: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia | Preserve preference constraints and test physical cameras. |
| 2. Compatibility | Pose runtime has timeout, GPU→CPU fallback, retry, and visible readiness. | `NO-ISSUE` | — | `lib/pose/detect.ts:117-167` publishes download/init/ready/failure and falls back GPU→CPU; `app/assessments/new/FullScreenCapture.tsx:855-867,984-1015` shows state and retry. The previously reported hard-failure acceptance bug is also fixed by `reviewAcceptDisabled` at `:856-857`. | Keep both-delegate and timeout tests; obtain physical-device evidence. |
| 2. Compatibility | Wake lock and speech degrade safely when unavailable. | `NO-ISSUE` | — | Wake-lock feature detection/reacquisition/release: `lib/capture/use-wake-lock.ts:29-117`; player uses prerecorded audio, Web Speech fallback, and always-visible captions: `app/workouts/_player/WorkoutPlayer.tsx:168-225`. MDN says locks may be system-released and must be reacquired: https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API | Preserve visible captions and physical iOS/Android tests. |
| 2. Compatibility | The default cold pose payload is quantified and immutably cached. | `NO-ISSUE` | — | `lib/pose/pose-model.ts:20-27` defaults to lite. `stat` measured lite model 5,777,746 B + selected SIMD WASM 11,153,617 B + wrapper 322,044 B = **17,253,407 B / 16.45 MiB**; `next.config.ts:43-50` gives immutable one-year caching. UI readiness is cited above. | Track the payload in the performance receipt and test throttled first capture. |
| 2. Compatibility | Real-device camera/orientation/audio/memory behavior is verified. | `WEAK` | S2 | Source fallbacks and WebKit automation exist, but no completed physical iPhone/Android evidence packet was produced in this run. Both camera and wake-lock APIs require a secure context per the MDN pages above. | Complete the device release checklist twice per supported physical class. |
| 3. Security | All effective RLS policies preserve tenant isolation and AAL2/admission restrictions. | `NO-ISSUE` | — | Every `CREATE POLICY` statement was read (`rg -n -A5 -B1 "CREATE POLICY" supabase/migrations`: 49 statements including superseded definitions). Final ownership policies are in `supabase/migrations/20260612040000_advisor_fixes.sql:14-32`; restrictive active+AAL2 guards cover 15 regulated tables in `20260719020000_practitioner_admission.sql:303-390`; only reference catalogs are public-read (`20260612010000_muscle_knowledge_base.sql:45-56`). | Maintain a two-tenant DB integration matrix when the local stack is available. |
| 3. Security | Auth redirect and bearer-token routes are bounded against open redirects/enumeration. | `NO-ISSUE` | — | `lib/auth/safe-next.ts:1-13` permits same-origin absolute paths only. Consent tokens are 256-bit and SHA-256 stored (`lib/consent/token.ts:1-9`; `app/api/consent/link/route.ts:57-67`; plaintext dropped in `supabase/migrations/20260708040000_consent_token_hash.sql:1-17`). Workout hydration uses hashed lookup and uniform 404 (`app/api/workouts/token/[token]/route.ts:18-65`). | Keep uniform negative responses and hash-only storage. |
| 3. Security | Service-role credentials are not client-bundled; dev fixture route is closed in production. | `NO-ISSUE` | — | Client-file scan found no `SUPABASE_SERVICE_ROLE_KEY`/service-client use; server helper is `lib/supabase/server.ts:26-34`. Dev route returns 403 in production (`app/api/dev/create-test-user/route.ts:45-52`) and `/api/dev/` is omitted from production public paths (`lib/auth/public-paths.ts:43-45`). | Retain both route and middleware gates. |
| 3. Security | Global CSP still allows inline/eval script execution. | `PROVED` | S3 | Literal policy at `next.config.ts:13-26` includes `'unsafe-inline'`, `'unsafe-eval'`, and `'wasm-unsafe-eval'`; the global policy also lacks `object-src 'none'`. No exploitable injection sink was proved, so this is defense-in-depth, not an XSS claim. | Roll out nonce/hash CSP in report-only mode, isolate the WASM exception, then enforce. |
| 3. Security | Public token endpoints fail open when the rate-limit database call fails. | `PROVED` | S3 | `enforceRateLimit` returns `true` on RPC error (`lib/rate-limit.ts:23-35`). Public consent response is 10/min (`app/api/consent/respond/route.ts:37-45`); public workout hydrate is 30/min (`app/api/workouts/token/[token]/route.ts:32-40`); public token rating is also on the fail-open helper. Sensitive mint/revoke/delete paths use `enforceRateLimitStrict`. | Fail closed, or use a separate availability-resilient limiter, on public bearer-token reads/writes. |
| 3. Security | Canonical link-origin configuration is complete. | `WEAK` | S3 | Consent/workout share URLs fall back to request origin if `NEXT_PUBLIC_APP_URL` is absent (`app/api/consent/link/route.ts:70-76`; `app/api/workouts/shares/route.ts:126-131`). `docs/RUNBOOK.md:290-293` requires the variable for invitations/recovery, but `.env.example:1-23` omits it (and `CRON_SECRET`). Live Vercel env names were not inspected. | Add every consumed variable to `.env.example`; centralize link origins through validated `lib/site-origin.ts`. |
| 4. Privileged areas | Service-role approval/export/mint operations are server-enforced and owner-scoped. | `NO-ISSUE` | — | Approval update filters `id` and `practitioner_id` (`app/api/assessments/[id]/approve/route.ts:32-50`); reports refuse unapproved current/prior assessments (`app/api/reports/route.ts:62-87,103-144`); workout mint filters ownership and refuses unapproved assessments (`app/api/workouts/route.ts:63-75`). | Add the missing direct approval-route test. |
| 4. Privileged areas | Public workout reads honor approval, expiry, revocation, consent withdrawal, tombstone, and practitioner status. | `NO-ISSUE` | — | The sole resolver enforces all gates in `supabase/migrations/20260720010000_privacy_lifecycle.sql:332-359`; the public route calls only that RPC (`app/api/workouts/token/[token]/route.ts:18-56`). | Keep one database resolver as the authorization source. |
| 4. Privileged areas | Exercise media is public-read and service-write only. | `NO-ISSUE` | — | `supabase/migrations/20260704000000_exercise_media_bucket.sql:1-14` creates a public-read bucket with no authenticated INSERT/UPDATE policy. | Replace `ON CONFLICT DO NOTHING` with drift verification in operations. |
| 4. Privileged areas | A failed practitioner-logo metadata write leaves the uploaded object behind. | `PROVED` | S3 | `app/api/settings/route.ts:101-119` upserts `${user.id}/logo.*`; if the DB path update fails at `:121-129`, the route returns 500 without deleting the object. The route has no direct test. | Delete/restore the uploaded object on metadata failure, or move upload+reference through an outbox/finalization protocol. |
| 5. Performance | Current client-directory callers are bounded, indexed keyset reads. | `NO-ISSUE` | — | Current route calls `list_owned_clients_page` with `limit + 1` (`app/api/clients/route.ts:103-153`); SQL caps at 51 and uses matching order/limits (`supabase/migrations/20260803000000_client_directory_trend.sql:69-128`). | Remove the legacy branch after its stated compatibility window. |
| 5. Performance | Legacy compatibility list/history requests remain unbounded and can truncate silently. | `PROVED` | S3 | Parameterless clients request reads the whole directory (`app/api/clients/route.ts:76-92`); assessment history without `limit` has no limit (`app/api/clients/[id]/assessments/route.ts:178-210`). Supabase documents `api.max_rows` default **1000**: https://supabase.com/docs/guides/local-development/cli/config#api.max_rows | Remove compatibility paths on schedule or enforce a hard cap/cursor for every request. |
| 5. Performance | Weekly dashboard averages become incomplete beyond the API row cap. | `PROVED` | S3 | Dashboard selects every weekly `overall_score` with no aggregate/limit (`app/dashboard/page.tsx:67-79`) then averages returned rows (`:175-187`). At 1,001 weekly scans, the documented 1,000-row default can omit ≥1 row, so the displayed mean is not the population mean. | Compute count/sum/average in a tenant-scoped SQL RPC. |
| 5. Performance | Player tick work is bounded and heavy media is isolated. | `NO-ISSUE` | — | One 200 ms interval dispatches real deltas (`app/workouts/_player/WorkoutPlayer.tsx:125-139`); `DemoCanvas` is memoized (`:540-557`) and media preloads are aborted (`:147-166`). | Preserve reducer/memo boundaries and measure on low-end devices. |
| 5. Performance | Official route JS and 150-client/400-assessment database plans are established. | `WEAK` | S3 | `npm run performance:budgets:check` returned `PASS` but explicitly `performance_status:"NOT_MEASURED"` and `performance_claimed:false`. Local DB attempts failed (`npx supabase status`: no `supabase_db_posture-ai`; `docker ps` confirmed absent). Next 16 Turbopack output did not emit the legacy route first-load table. | Run the official performance workflow and local seeded EXPLAIN suite; attach immutable receipts. |
| 6. Deployment | Canonical CI/Vercel build passes; webpack compatibility does not. | `PROVED` | S3 | Independent canonical `npm run build` at this SHA passed with Next 16.2.6 Turbopack, matching `package.json:9-12`, `.github/workflows/ci.yml:20-33`, and `docs/RUNBOOK.md:35-41`. Sequential `npx next build --webpack` compiled then rejected `NewAssessmentWizard`, a named page export at `app/assessments/new/page.tsx:159-160` imported by `app/assessments/new/page.pagination.test.tsx:65`. This is not the production builder. | Move the component to a non-route module if webpack compatibility is required. |
| 6. Deployment | Health can report `schema:"ready"` while required current RPCs are absent. | `PROVED` | S2 | Health probes only tables/columns (`app/api/health/route.ts:15-34`) and returns HTTP 200 with `schema:"ready"` when those pass (`:53-62`). The current migration creates required `list_owned_clients_page`, `owned_client_directory_summary`, and `owned_client_longest_since_scan` RPCs (`supabase/migrations/20260803000000_client_directory_trend.sql:21-28,140-150,208-218`), called at `app/api/clients/route.ts:133-165` and `app/dashboard/page.tsx:109`, but health probes none of them. | Probe exact required function signatures or a migration-ledger version, and return non-ready status for missing current schema. |
| 6. Deployment | Request payload stays well below Vercel's current ceiling. | `NO-ISSUE` | — | Assessment route measures the actual buffered body and rejects over 512 KiB (`app/api/assessments/route.ts:28-49`; `lib/validation/frames.ts:8-9`). Vercel's current request/response payload maximum is 4.5 MB: https://vercel.com/docs/functions/limitations#request-body-size | Keep the lower application cap and body-limit test. |
| 6. Deployment | Node version is reproducible in CI but not declared for developers/Vercel source. | `WEAK` | S4 | CI pins Node 22 (`.github/workflows/ci.yml:20-23,40-43`); `package.json:1-70` has no `engines`, and no `.nvmrc`, `.node-version`, or `mise.toml` exists. Audit shell was Node 26.5.0/npm 11.17.0. Live Vercel runtime setting was not inspected. | Add a repository runtime pin matching CI and Vercel. |
| 6. Deployment | Rollback/migration procedure is documented but production application is unverified. | `WEAK` | S2 | Forward-only migration and prior-READY rollback are documented at `docs/RUNBOOK.md:43-78`, including the legal-governance rollback floor. Production ledger/current deployment were not queried. | Attach migration/deployment IDs and a post-deploy health+RPC smoke receipt to every promotion. |
| 7. Jobs | The sole scheduled route authenticates and fails closed. | `NO-ISSUE` | — | `vercel.json:1-7` schedules `/api/internal/privacy-maintenance` daily at 03:17; missing `CRON_SECRET` returns 503 and a bad bearer returns 401 before service access (`app/api/internal/privacy-maintenance/route.ts:8-25`). No `supabase/functions` or `pg_cron` definitions exist. | Add an alert on non-2xx and last-success age. |
| 7. Jobs | Token expiry does not silently depend on cleanup. | `NO-ISSUE` | — | Workout resolver enforces `expires_at > clock_timestamp()` at read time (`supabase/migrations/20260720010000_privacy_lifecycle.sql:339-359`); consent consumption is a locked, single-use DB RPC (`supabase/migrations/20260708040000_consent_token_hash.sql:23-45`). | Cleanup may reclaim storage, but never become the authorization boundary. |
| 7. Jobs | Approved retention is intentionally inactive pending human policy. | `N/A` | — | Empty policy table is a safe no-op by design; worker iterates only approved/non-held policies (`supabase/migrations/20260720010000_privacy_lifecycle.sql:1251-1277`); activation remains HG-02 (`docs/RUNBOOK.md:112-128`). | Do not invent retention durations; activate only by reviewed migration after approval. |
| 8. Business logic | Three core angle computations match their fixtures by hand. | `NO-ISSUE` | — | Shoulder: `atan2(0.200−0.250,0.650−0.350)×180/π = −9.462°`, magnitude 9.46° (`packages/posture-engine/__tests__/engine.test.ts:304-311`; implementation `packages/posture-engine/src/metrics.ts:61-75`). Trunk: `atan2(0.020,0.300)×180/π = 3.814°` (`packages/posture-engine/__tests__/engine.test.ts:325-333`; `packages/posture-engine/src/metrics.ts:96-119`). Pelvis: `atan2(0.520−0.550,0.620−0.380)×180/π = −7.125°`, magnitude 7.13° (`packages/posture-engine/__tests__/engine.test.ts:347-355`; `packages/posture-engine/src/metrics.ts:122-132`). | Keep these fixture calculations as reviewable invariants. |
| 8. Business logic | Zone edges are intentional and covered. | `NO-ISSUE` | — | `toZoneAndPct` uses `< warn`, `< danger`, else danger (`packages/posture-engine/src/thresholds.ts:101-117`): at knee values 5°→warning with 33%, 15°→danger with 66%; representative 0/7/12 zone cases are tested at `packages/posture-engine/__tests__/thresholds.test.ts:71-74`. | Add exact-edge assertions for every threshold key. |
| 8. Business logic | Genu muscle advice ignores varum/valgum direction and can invert content. | `PROVED` | S2 | Direction column is reserved but unpopulated (`supabase/migrations/20260628010000_muscle_links_evidence_columns.sql:12-21`). The mapping explicitly ignores `f.direction` and admits over-coloring (`app/assessments/[id]/findingsToMuscleStates.ts:103-125`); the 2D resolver also has no direction gate (`app/assessments/[id]/muscleMap.ts:174-195`). Seed text says hip adductors apply only to valgum (`supabase/migrations/20260708090000_orphan_exercises_informational.sql:75-77`) while TFL/IT-band links apply only to varum (`:102-103`). Program candidates filter key/role/zone, not finding direction (`lib/program/buildProgram.ts:148-161`). | Populate/select direction applicability; gate map, knowledge, report, and program paths; add opposite-direction fixtures and update governed content hashes/receipt. |
| 8. Business logic | Exercise role coherence and screening vocabulary have automated gates. | `NO-ISSUE` | — | Coherence uses the same predicate at authoring/runtime and has empty debt (`lib/program/coherence.test.ts:5-39`; `lib/program/buildProgram.ts:140-161`). UI vocabulary scans `app`, `components`, `lib/pdf`, and `lib/capture` (`lib/ui-vocabulary.test.ts:5-59`); content has its separate test via `npm run lint:vocab`. All tests passed. | Extend the UI roots when new user-copy directories are introduced. |
| 8. Business logic | Workout duration arithmetic matches the displayed estimate. | `NO-ISSUE` | — | `lib/workout/generateWorkoutSession.ts:90-109,162-179`: hold example `2×30 + 10×(2−1) + 8 = 78s`; reps example `2×10×4 + 20×(2−1) + 8 = 108s`. Start card rounds that snapshot total to minutes (`app/workouts/_player/WorkoutPlayer.tsx:672-675`). | Add exact duration fixture assertions, not only monotonic/positive tests. |
| 9. Code quality | Main local static/unit gates pass. | `NO-ISSUE` | — | `npm run typecheck` exit 0; `npx vitest run` **220 files / 2,121 tests passed** in 22.78s; `npm run lint` exit 0 with 21 warnings and 0 errors. Canonical build passed as recorded above. | Ratchet warnings to zero before making warnings fatal. |
| 9. Code quality | Workout progress saves can fail invisibly. | `PROVED` | S2 | Adapter fires `fetch` and drops only rejected promises, never checks non-2xx (`app/workouts/[sessionId]/player.tsx:27-36`). Player advances `lastSavedRef` and revision before any acknowledgement and has no retry/error path (`app/workouts/_player/WorkoutPlayer.tsx:230-259`). Server can return 429/422/500 (`app/api/workouts/[id]/run/route.ts:47-51,92-103`). | Await/queue writes, require acknowledgement before committing the local save watermark, retry safely, and show recoverable persistence state. |
| 9. Code quality | Workout revision ordering is not atomic and can let an older write overwrite a newer one. | `PROVED` | S2 | Route reads revision (`app/api/workouts/[id]/run/route.ts:70-77`), applies the pure stale check (`:82-85`; contract `lib/workout/runState.ts:6-16,80-109`), then updates only by row ID (`run/route.ts:100`). Two concurrent revisions can both read revision 1; revision 3 may commit first and revision 2 commit last. | Perform a compare-and-swap update on stored revision, or move the merge/check/update into one locked DB function; add a concurrent route test. |
| 9. Code quality | Five of 32 API routes have no adjacent direct test. | `PROVED` | S3 | Route/test census: 32 `app/api/**/route.ts`, 27 adjacent tests. Missing: `app/api/assessments/[id]/approve/route.ts`, `app/api/settings/route.ts`, `app/api/workouts/[id]/rate/route.ts`, `app/api/workouts/[id]/run/route.ts`, `app/api/workouts/token/[token]/rate/route.ts`. | Prioritize run concurrency/failure, approval ownership, and logo cleanup tests. |
| 9. Code quality | Production explicit-`any`, TODO, and silent-catch debt is small but real. | `PROVED` | S4 | Two production explicit `any` sites: `app/api/reports/route.ts:352`, `lib/supabase/server.ts:17`. One production TODO, `genu-direction`, is at `app/assessments/[id]/findingsToMuscleStates.ts:122-124` (`git blame`: `ef74bc88`, 2026-07-02). Empty catches are at `lib/supabase/server.ts:19` (expected Server Component cookie limitation) and `WorkoutPlayer.tsx:177` (best-effort speech cancel); the harmful promise swallow is the run save above. | Remove the casts and close the direction TODO; document intentionally best-effort catches. |

## Blocked evidence

| Blocked item | Exact unmet need |
|---|---|
| Physical device compatibility | Two completed runs per supported real iPhone/iOS Safari and Android/Chrome class, including permission denial/recovery, rotation, background/foreground wake-lock reacquisition, audio fallback, memory pressure, and screen reader. Browser emulation is not physical evidence. |
| Local scale/SQL plans | A running `supabase_db_posture-ai` container. `npx supabase status` failed because the container did not exist; a second attempt using `docker ps` confirmed it absent. Needed: sanitized 150-client/400-assessment seed, row counts, and `EXPLAIN (ANALYZE, BUFFERS)` for directory/dashboard/history queries. |
| Official performance | A completed `npm run performance:official` receipt from the supported host and an exact production route first-load-JS artifact. The pre-baseline checker explicitly reports `NOT_MEASURED`. This audit did not duplicate the separately owned performance-regression work. |
| Production migration/deploy state | Read-only provider receipts for the exact applied migration ledger, active Vercel deployment SHA/runtime, required environment-variable names, and `/api/health` plus current-RPC smoke. No production data read is needed. |
| Backup/PITR and restore | Provider configuration receipt plus an isolated restore drill with RPO/RTO and integrity evidence. Repository runbook text is not provider-state proof. |
| Clinical/legal human gates | Licensed-clinician HG-03 direction/content review and counsel-approved HG-02 retention/legal artifacts. This audit did not infer clinical correctness or select retention durations. |

## Proved issue index

- **S2:** migration-blind health readiness; direction-agnostic genu muscle/program content; silent workout progress loss; non-atomic workout revision race.
- **S3:** permissive global CSP; fail-open public token rate limits; orphanable practitioner-logo upload; unbounded legacy list/history reads; truncated dashboard weekly averages; optional webpack builder incompatibility; five API routes without direct tests.
- **S4:** two production explicit-`any` casts plus the aged genu TODO (the TODO's functional consequence is already counted as S2).

No S1 was proved in this run.
