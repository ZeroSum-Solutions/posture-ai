# Posture AI — Production Roadmap (2026-06-11)

**Scope:** Harden and deploy the existing Next.js app (Vercel + Supabase), make mobile-browser capture excellent, build the muscle knowledge base. The Expo app (`mobile/`) is untouched. No billing, no app store. Screening-only vocabulary is a hard constraint throughout.

Companion docs: `2026-06-11-product-goal.md` (vision), `2026-06-11-competitive-refresh.md` (market), `2026-05-30-competitive-landscape.md` (full landscape), `app_spec.txt` (clinical reference).

---

## Status — reconciled 2026-06-26

This roadmap is largely executed; the plan body below is preserved as the original plan of record. Snapshot of what has shipped (verified against the codebase):

| Phase | Status | Evidence |
|---|---|---|
| **P0** Deploy + device spike | ✅ Done | Live on Vercel; findings in `2026-06-12-p0-device-spike-findings.md` |
| **P1** CI + e2e + engine dedup | ✅ Done | `.github/workflows/ci.yml`; `playwright.config.ts` + `e2e/` (5 specs); `lib/posture-engine` removed — single engine in `packages/posture-engine` |
| **P2** Capture hardening | ✅ Done | Self-hosted MediaPipe in `public/mediapipe/`; per-photo preflight in `lib/pose/quality.ts`; capture-level/tilt-framing flags migration |
| **P3** Server hardening | ✅ Done | `lib/validation/frames.ts` (zod), `lib/rate-limit.ts`, `lib/log.ts`; `test_mode` gated; security headers |
| **P4** Muscle knowledge base | ✅ Done | 28 muscles + 55 exercises in `content/`; `muscles` / `muscle_imbalance_links` / `exercise_muscles` tables; `/muscles` + `/muscles/[slug]`; vocabulary-lint test |
| **P5** Polish | 🟡 Mostly | Practitioner + client PDFs shipped (#13); vocabulary lint in CI; a11y/axe budget and full progress-page polish still open |
| **P6** Release verification | 🟡 Partial | CI green on PRs; full real-device matrix re-run + ops runbook still pending |

### Post-roadmap: research-evidence reconciliation (2026-06-26)

A signed-off literature review (in the *Moti Competitive Analysis* folder) was folded into the engine/content via 5 PRs:

- **#14** static-stretch 30s hold floor (×10); **#15** pec-minor length-only coding; **#16** `pelvic_axial_rotation` demoted to measure-but-not-score + muscle inferences detached; **#17** optional evidence-confidence grade on muscle links; **#18** prone hip extension + ADIM exercise.

**Deferred — need the validation study / clinician sign-off:** doorway-pec elbow-angle specificity (contested vs Umehara/Borstad); short-foot + toes-in heel-raise exercises (need a foot/pronation imbalance key + new muscle slugs); true CVA / FSA / kyphosis angle metrics (current ones are lean-from-vertical proxies, flagged non-validated); full binary→STATE muscle-coding remodel.

---

## Key facts established by code exploration

1. **Camera capture already exists in the web wizard.** `app/assessments/new/page.tsx` has a full `CameraCapture` component: `getUserMedia({ facingMode: 'environment' })`, 3-2-1 countdown, canvas frame grab, preview/retake, permission-denied error state, plumb-line SVG overlay. The mobile-web workstream is *hardening + verification*, not greenfield.
2. **Photos are never persisted.** `captures.storage_path` exists in the schema but is never written — `app/api/assessments/route.ts` only stores `pose_frame` JSON. No Supabase Storage bucket is used anywhere. **Decision (default): do not persist photos** — landmarks only, "photos never leave the device" is a strong privacy story. Confirm at P2 kickoff; revisit only if a feature genuinely requires it.
3. **Scoring is synchronous.** `POST /api/assessments` runs `assessPosture()` inline and returns `status: 'complete'`; the wizard's status polling is mostly vestigial. Error UX lives in the POST path.
4. **Security gaps confirmed:** `test_mode` in the POST body is honored unconditionally (any authed user can create fixture assessments in prod); `/api/dev/` is in `proxy.ts` `PUBLIC_PATHS`; client-sent `frames` JSON is trusted with no schema validation; service-role client is used for writes after a manual ownership check — correct but fragile.
5. **No CI, no Playwright** (no `.github/`, no `playwright.config`, no `e2e/`). Vitest is wired; engine has 100+ tests. Test-mode hooks for e2e already exist (`NEXT_PUBLIC_POSTURE_TEST_MODE=1`, `?testMode=1`, fixture landmarks).
6. **Engine is duplicated**: `packages/posture-engine/` and `lib/posture-engine/` are parallel copies — drift risk; consolidate in P1.
7. **MediaPipe assets are CDN-loaded** in `lib/pose/detect.ts` (jsdelivr WASM + Google Storage `pose_landmarker_full`, ~9 MB), with GPU→CPU fallback already implemented. Self-host in P2.
8. Disclaimers exist at capture step and onboarding ack; a full vocabulary sweep is still needed (PDF, results, exercises, new muscle content).

---

## Phase 0 — Risk spikes: deploy skeleton + real-device validation (Size: S — gates everything)

**Why first:** the riskiest assumption in the whole plan is "MediaPipe WASM + getUserMedia work acceptably on iOS Safari." iOS Safari requires HTTPS for `getUserMedia`, so the camera path cannot be meaningfully tested against `localhost` — deploying early is the validation tool, not the finish line.

1. Deploy current `main` to Vercel (preview env), wire Supabase env vars (`NEXT_PUBLIC_SUPABASE_URL`, anon key, service-role key server-only). Confirm `app/api/health` green in prod.
2. On real iPhone Safari + Android Chrome: run the full wizard with the camera; measure model download time, `detectPose` latency, memory behavior (Safari tab crashes are the failure mode), GPU delegate vs CPU fallback.
3. Spike: `pose_landmarker_lite` (~5.5 MB) vs `full` (~9 MB) behind an env flag, compared on the engine's fixtures. If lite passes confidence gating on real photos, default mobile to lite.
4. Record findings in `docs/plans/` — they parameterize Phase 2.

**Success criteria:** app live on a Vercel URL; capture→assessment→results completes on at least one real iPhone and one Android phone; latency + model-choice decision documented.

**Critical files:** `lib/pose/detect.ts`, `app/assessments/new/page.tsx`, `next.config.ts`, `app/api/health/route.ts`.

## Phase 1 — CI + e2e foundation (Size: M)

1. **GitHub Actions** (`.github/workflows/ci.yml`): lint → `tsc --noEmit` → `vitest run` (root + `packages/posture-engine`) → `next build` → Playwright e2e. **Eliminate the engine duplication** (delete one copy, re-point imports) or add a drift-check that fails CI on divergence — prefer elimination.
2. **Playwright wiring**: `@playwright/test`, `playwright.config.ts` with a mobile-viewport project (iPhone 14 emulation) + desktop project, `webServer` running `next dev` with `NEXT_PUBLIC_POSTURE_TEST_MODE=1`. Seed auth via `/api/dev/create-test-user` (test env only).
3. **e2e suite (test mode):** sign-in → create client → new assessment with `?testMode=1` (fixture landmarks) → results render 10 findings + grade → PDF link present → progress page. Plus one spec uploading a fixture *image* through the real `detectPose` path in Chromium.
4. Vercel preview deploys per PR; CI required for merge.

**Success criteria:** CI red/green on PRs; e2e covers the golden path on mobile viewport; engine duplication eliminated.

**Critical files:** `.github/workflows/ci.yml` (new), `playwright.config.ts` (new), `e2e/assessment-flow.spec.ts` (new), `vitest.config.ts`, `packages/posture-engine/src/*` vs `lib/posture-engine/*`.

## Phase 2 — Mobile-web capture hardening (Size: M)

Gap analysis of `app/assessments/new/page.tsx`:

| Exists | Gap |
|---|---|
| getUserMedia rear-camera capture w/ countdown, preview, retake | No `capture="environment"` on the file `<input>` — the native-camera-via-file-input fallback is the most reliable path on phones and is currently absent |
| Permission-denied error state | No handling for: camera in use, no rear camera, stream ends mid-session, `video.play()` quirks on iOS low-power mode |
| Pose detection at submit time | **No per-photo quality preflight.** Run `detectPose` immediately after each capture/upload; per-slot feedback: "No person detected — retake", landmark-confidence warnings ("legs not visible"), override allowed |
| Engine degrades missing landmarks to `unreliable` | No user-facing explanation on results page of *why* a metric is unreliable and how to re-shoot |
| Generic catch → "Network error" | No timeout/progress on the 9 MB model download; no distinct messaging for model-load vs detection vs API failure |
| Inline-styled, mostly responsive layout | Verify 3-slot grid, camera modal, step indicator at 360–390 px; safe-area insets; `wakeLock` during countdown (graceful without) |

Additional tasks:

1. **Self-host MediaPipe assets**: WASM fileset → `public/mediapipe/wasm/` (ship from `node_modules/@mediapipe/tasks-vision/wasm` at build), `.task` model → `public/mediapipe/models/`; update `WASM_URL`/`MODEL_URL` in `lib/pose/detect.ts`; long-cache headers in `next.config.ts`. Optionally warm the landmarker when the capture step mounts.
2. **Photo persistence**: confirmed default — don't persist; remove dead `storage_path` references or leave documented; state the privacy stance in UI copy.
3. **Real-device verification matrix** (scripted checklist in `docs/`): iOS Safari ≥17, iOS Chrome, Android Chrome, one low-end Android. Verify camera open, capture, preflight latency < ~5 s, full flow, PDF download behavior.

**Success criteria:** every capture-failure mode has a specific recovery path; per-photo quality feedback before submit; assets served first-party; e2e mobile-viewport spec covers error states (mock getUserMedia denial); checklist passes on real devices.

**Critical files:** `app/assessments/new/page.tsx`, `lib/pose/detect.ts`, `next.config.ts`, `app/assessments/[id]/page.tsx`, new `lib/pose/quality.ts`.

## Phase 3 — Server hardening, security, observability (Size: M)

1. **Validation at boundaries**: zod schemas for `POST /api/assessments` (`frames`: view enum, landmark names from the 33-point list, coords in [0,1.5], visibility [0,1], max payload size) and other API routes; 422 on malformed input.
2. **Gate `test_mode`**: only honored when the server-side test env flag is set; never in production. Exclude `/api/dev/` from production builds and from `proxy.ts` `PUBLIC_PATHS` in prod.
3. **Rate limiting** on `/api/*` mutation routes (serverless-safe: Supabase-backed counter keyed on `auth.uid` or Vercel WAF rules — decide at implementation; in-memory token buckets are insufficient on serverless).
4. **Structured logging**: small `lib/log.ts` (JSON lines: route, user hash, assessment id, duration, outcome) visible in Vercel logs; client-side `detectPose` failure reporting via a telemetry endpoint (justify any new dependency before adding).
5. **Headers**: CSP (allow `wasm-unsafe-eval` for MediaPipe), HSTS, `Permissions-Policy: camera=(self)`.
6. Run Supabase advisors (security + performance) and fix findings; verify RLS `WITH CHECK` semantics on insert paths.
7. `/security-review` pass on the branch before merge.

**Success criteria:** advisors clean; invalid frame payloads rejected with tests; `test_mode` unreachable in prod (e2e asserts it); rate limit demonstrated; logs queryable in Vercel.

**Critical files:** `app/api/assessments/route.ts`, `proxy.ts`, `lib/supabase/server.ts`, new `lib/validation/frames.ts`, new `lib/log.ts`.

## Phase 4 — Muscle knowledge base (Size: L — the big build)

### 4a. Canonical muscle list (~28, deduped from seed tight/weak mappings)

- *Head/neck (7):* suboccipitals, upper trapezius, levator scapulae, sternocleidomastoid, deep cervical flexors, middle trapezius, lower trapezius
- *Shoulder girdle (5):* pectoralis major, pectoralis minor, anterior deltoid, rhomboids, serratus anterior
- *Trunk (6):* thoracic erector spinae, lumbar erector spinae, latissimus dorsi, deep abdominals (rectus + transversus, absorbing the seed's "deep thoracic flexors"), internal/external obliques, quadratus lumborum
- *Hip/pelvis (6):* iliopsoas (hip flexors), gluteus maximus, gluteus medius, hip adductors, deep hip external rotators (piriformis group), TFL + IT band
- *Knee/leg (4):* quadriceps (VMO call-out), hamstrings, popliteus, gastrocnemius/soleus

**First task:** write the slug-mapping table from the seed free-text strings ("adductors (elevated side)", "lateral structures (varum) or adductors (valgum)") — side/condition nuance moves into `rationale_text`. **Review the mapping with Devin before content generation.**

### 4b. Data model — new normalized tables (keep JSONB during transition)

- **`muscles`**: `slug` PK, `name`, `region`, `anatomy_summary`, `function_text`, `screening_notes`, `image_path` (nullable), timestamps. Read-only RLS like `exercises`.
- **`muscle_imbalance_links`**: `muscle_slug` FK, `imbalance_key` FK → `imbalance_definitions(key)`, `role` (`tight`|`weak`), `rationale_text` (the per-pair clinical gold, ~45 rows). Unique (muscle, imbalance, role).
- **`exercise_muscles`**: `exercise_id` FK, `muscle_slug` FK, `role` (`stretch`|`strengthen`), `progression_level` int (1=regression, 2=standard, 3=progression). Unique (exercise, muscle, role).

Migration strategy: keep `tight_muscles`/`weak_muscles` JSONB while results page + PDF still read them; seed new tables; switch UI reads to the join; deprecate JSONB in a later migration.

### 4c. Content scope + generation/review strategy

- **Per muscle (~28):** anatomy summary (~120 words, plain-language origin/insertion), function, "when commonly tight / commonly weak", screening-only framing.
- **Per link (~45):** 2–3 sentence rationale tying the muscle to the specific distortion.
- **Exercise expansion 10 → ~45–60:** ≥1 stretch per "tight" muscle, ≥1 strengthen (with one progression) per "weak" muscle, deduped; keep `primary_deviation_keys` populated so existing recommendation logic keeps working.
- **Authoring pipeline:** typed content under `content/muscles/` validated by a zod schema + **vocabulary lint test** in CI (banned: diagnose/diagnosis, treat/treatment, cure, patient, medical prescription; required disclaimer presence); a generation script renders content into a seed migration. LLM-drafted against standard kinesiology references, then **human clinical review gate** (`reviewed_by`/`reviewed_at` frontmatter; unreviewed entries hidden in UI, CI warns, release doesn't block). Re-generatable, diffable, reviewable in PRs.

### 4d. UI surfaces

1. **`/muscles`** — library index grouped by region, search (style reference: `app/exercises/page.tsx`).
2. **`/muscles/[slug]`** — anatomy, function, related posture findings, prescribed stretches + strengthening progressions, screening disclaimer (extract the inline capture-step disclaimer to `components/Disclaimer.tsx`).
3. **Findings → muscle links**: muscle chips on `app/assessments/[id]/page.tsx` become `Link`s to `/muscles/[slug]`, driven by the join instead of JSONB strings.
4. **PDF**: muscle names only (no bloat); optional "see muscle guide" footnote.
5. Prefer server-component direct Supabase reads (public read-only tables; no API route needed).

**Success criteria:** all ~28 muscle pages render with reviewed content; every finding chip links to a muscle page; every tight muscle has ≥1 stretch and every weak muscle ≥1 strengthening exercise reachable from its page; vocabulary lint green; e2e covers findings→muscle→exercise navigation; recommendation engine still produces recommendations for all 10 imbalances.

**Critical files:** new migration in `supabase/migrations/`, `app/assessments/[id]/page.tsx`, new `app/muscles/page.tsx` + `app/muscles/[slug]/page.tsx`, new `content/muscles/*` + zod schema, `lib/pdf/report.tsx`.

## Phase 5 — Polish: PDF, progress, a11y, vocabulary sweep (Size: M)

1. **PDF to 100%** (`lib/pdf/report.tsx`, `app/api/reports/route.ts`): all 10 findings, practice branding, disclaimer, exercise list; verify mobile download (react-pdf in-browser on iOS Safari is a known pain — fall back to server-side generation if flaky).
2. **Progress/trends styling** finished to match the dark design system.
3. **Pragmatic a11y pass**: semantic headings, input labels, focus states, zone-color contrast check, `aria-live` on processing step, keyboard path through the wizard; axe scan in Playwright with a CI budget.
4. **Disclaimer/vocabulary sweep** across all surfaces (results, PDF, exercises, muscle pages, `app/page.tsx`) using the banned-terms lint promoted to cover UI copy.

**Success criteria:** PDF verified on desktop + iPhone; axe budget green; vocabulary lint covers app copy; progress page visually complete.

## Phase 6 — Release verification (Size: S)

1. Full e2e suite green against a production-like Vercel preview with real Supabase.
2. Real-device matrix re-run (P2 checklist) on the production URL.
3. Supabase advisors + `/security-review` re-run post-merges.
4. Load sanity: 10 concurrent assessment submissions (extend `lib/concurrent-assessment.test.ts`).
5. Ops runbook in `docs/`: env vars, deploy, rollback, migration procedure.

## Dependency graph & sizing

```
P0 spikes (S) ──► P1 CI/e2e (M) ──► P2 capture (M) ──► P3 hardening (M) ──► P6 release (S)
                        │
                        └─────────► P4 muscle KB (L) ──► P5 polish (M) ────► P6
```

P2/P3 and P4/P5 run as **parallel workstreams** after P1 (disjoint files: wizard/pose vs migrations/new pages). P4 decomposes cleanly into 4a-schema → 4c-content (parallelizable per region) → 4d-UI.

## Riskiest assumptions & early validation

| Risk | Validation (when) |
|---|---|
| MediaPipe WASM too slow / crashes on iOS Safari | P0 real-device spike on deployed HTTPS URL — before any other work |
| `pose_landmarker_lite` accuracy insufficient for engine confidence gates | P0 fixture comparison spike |
| Self-hosted WASM breaks under Vercel asset serving (MIME/CSP) | P2 first task, verified by the real-detection e2e spec |
| Seed free-text muscle strings don't map to clean slugs | P4a slug-mapping table first, user-reviewed before content gen |
| Clinical-review bottleneck on ~28 pages + 45 rationales | `reviewed` flags; launch with reviewed subset, unreviewed hidden |
| react-pdf client rendering on mobile browsers | P5, server-side fallback already sketched (`app/api/reports/route.ts`) |
| Photo persistence privacy/consent | Decided: don't persist (landmarks only) |

---

## Appendix: Ultracode initialization prompt

Copy-paste the following into a fresh Claude Code session to execute this roadmap:

```text
ultracode

We are taking Posture AI to production. Work in /Users/zero-suminc./projects/posture-ai (git repo, branch from main).

CRITICAL FRAMING: This is NOT a greenfield project. The v1 Next.js 16 web app is feature-complete and working: Supabase auth + RLS, client management, assessment wizard (photo upload AND getUserMedia camera capture → client-side MediaPipe pose detection → pure-TS 10-imbalance scoring engine → results page → branded PDF), exercise recommendations, progress trends. Do not rebuild anything that works. The native Expo app in mobile/ is explicitly OUT OF SCOPE — do not touch it.

READ FIRST (in order):
1. docs/plans/2026-06-11-product-goal.md — the product vision
2. docs/plans/2026-06-11-production-roadmap.md — the phased roadmap you are executing (P0–P6, with success criteria, critical files, and risk table)
3. docs/plans/2026-05-30-competitive-landscape.md + docs/plans/2026-06-11-competitive-refresh.md — market context
4. app_spec.txt — clinical reference (10 imbalances, thresholds, muscle mappings)
5. packages/posture-engine/src/ — the scoring engine (production-grade, 100+ tests; treat as stable API)

MISSION (two workstreams, defined in the roadmap):
A. HARDENED CORE: Deploy to Vercel + Supabase and make the phone-browser capture flow production-reliable. Execute P0 (deploy + real-device MediaPipe spike) FIRST — it gates everything. Then P1 (CI + Playwright e2e, consolidate the duplicated engine in lib/posture-engine vs packages/posture-engine), P2 (capture hardening: per-photo pose preflight with retake guidance, self-host MediaPipe WASM/model from public/, mobile UX), P3 (zod validation on frame payloads, gate test_mode out of prod, rate limiting, logging, security headers).
B. MUSCLE KNOWLEDGE BASE: The big new build (P4–P5). New tables: muscles (~28 canonical muscles), muscle_imbalance_links (~45 tight/weak rationales), exercise_muscles. Typed content files in content/muscles/ with zod schema + CI vocabulary lint. Per-muscle pages (/muscles, /muscles/[slug]) with anatomy, function, why-tight/why-weak per distortion, and prescribable stretches + strengthening progressions. Expand exercises 10 → ~45–60. Wire finding muscle-chips on the results page to muscle pages.

HARD CONSTRAINTS:
- Screening, NOT diagnosis. Non-diagnostic vocabulary everywhere; CI lint bans diagnostic terms (diagnose, treat, cure, patient, prescription). Exer got an FDA warning letter for over-claiming — we will not.
- No billing, no app-store work, no native mobile work in this push.
- Pin @mediapipe/tasks-vision to 0.10.35; self-host assets.
- Default: do NOT persist client photos (landmarks only — "photos never leave the device"). Flag for review if a feature seems to require persistence.
- Engine is a stable API: extend via new tables/content, don't refactor scoring math without failing-test justification.
- Conventional commits; TDD for new logic; Playwright e2e must stay green; verify against the roadmap's per-phase success criteria before declaring a phase done.

EXECUTION: Work phase-by-phase per the roadmap dependency graph (P0 → P1 → {P2→P3 ∥ P4→P5} → P6). After P1, run workstreams A and B in parallel where files are disjoint. At each phase boundary, run an independent verification pass against the phase's success criteria with captured evidence before proceeding. Surface blockers (e.g., iOS Safari MediaPipe failures in P0) immediately with options rather than silently working around them.
```
