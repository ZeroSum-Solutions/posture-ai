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
