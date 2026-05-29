# Posture AI — Greenfield PRD & ZeroForge Build Plan

## Context

Devin handed two source docs (`~/Desktop/Posture AI - Product Information Document.pdf`, `~/Desktop/MotiPhysio Device Info.pdf`) plus **two real MotiPhysio report sheets** (his own Rise Movement scan) as the concrete v1 output target, and asked to synthesize a PRD + spec list and fire it into **ZeroForge** as a greenfield project that runs ground-zero-to-done.

- `MotiPhysio Device Info.pdf` = the **benchmark device** ($6,950 Windows RGB-D rig) — defines the clinical assessment science (Janda / Anatomy Trains).
- `Posture AI - Product Information Document.pdf` = the **product vision** — same science, markerless, accessible.
- **The two report screenshots = the literal v1 deliverable** — the exact output the app must produce.

**Problem solved:** posture/musculoskeletal screening is locked behind a $7K rig or radiographic X-ray. Outcome: democratize that assessment into a markerless, instant web app a practitioner runs on any client, producing a report equivalent to the MotiPhysio sheet — in Devin's modern design.

**Who it serves:** PTs / fitness pros, athletes/coaches, corporate ergonomics, everyday users (a solo user = their own single client).

### Locked decisions (confirmed with Devin)
| Axis | Decision |
|---|---|
| **Build target** | **Web app / PWA** (not native iOS) — only path ZeroForge can build *and self-verify* end-to-end. Native LiDAR client can attach later. |
| **Primary user** | **Practitioner manages multiple clients** (solo user = own single client). |
| **v1 scope** | **Static posture battery** matching the MotiPhysio report (10 imbalances, below). Dynamic movement (squat/single-leg) deferred to v2; schema left open. |
| **Backend** | **Supabase (Postgres + Auth + Storage) + RLS.** |
| **Report style** | **Modern design replicating all capabilities** of the MotiPhysio sheet (grade, percentile, per-view ranks, annotated skeletal sheet, region-grouped imbalance cards, risk bars, causes, muscle maps) — NOT a pixel-clone. |
| **Muscle map** | **Schematic SVG body-map** (front/back) highlighting tight (red) / weak (blue) muscle groups per imbalance + named lists. |
| **ZeroForge model** | **Sonnet 4.6 workhorse**; optional Opus first-pass on engine/CV/RLS; DeepSeek fallback only. |

### Honesty reframes baked into the spec
- No pre-trained Core ML model exists or is needed: **deviation = geometry** from detected joints; **severity% / grade = deterministic clinical thresholds.** The only "AI" is the pose model (MediaPipe) producing joints.
- "**Rank Nth out of 100 / Top X%**" needs a normative population we don't have → v1 computes it from a **defined, configurable severity→percentile model** (clearly labeled *modeled*, calibratable later), not a real cohort.
- Output is **screening, not diagnosis** — per-metric confidence + enforced non-diagnostic disclaimer. Single-webcam accuracy is not radiographic; thresholds are tunable calibration targets.

---

## The v1 deliverable: the two-page report (modern design)

**Page 1 — Skeletal Analysis + Overall Rating**
- Client header (name, sex, height, DOB, date, place/practice).
- **Overall grade ring (S–E)** + **"Top X%"** percentile on a maintain→warning→danger gradient bar + the grade-band table: **S 0–5 · A 5–15 · B 15–50 · C 50–85 · D 85–95 · E 95–100** (higher % = worse).
- **Annotated FRONT + SIDE skeletal diagrams**: a skeleton template with computed red angle markers + directional arrows, the client's **captured photo inset**, and a **per-view rank** ("Rank Nth out of 100"). Practitioner NOTE box.

**Page 2 — List of body imbalances** (grouped by region with a spine-flow indicator):
- One card per imbalance: deviation° vs **standard 0°** + direction, a **maintain/warning/danger risk bar with %**, **"Behavior fixes and causes"** text, and a **schematic muscle tight(red)/weak(blue) body-map** + named muscle lists.
- Non-diagnostic disclaimer footer.

### The v1 imbalance battery (exact, region-grouped)
| Region | Imbalance | View | Standard |
|---|---|---|---|
| Head/Shoulders | Forward Head Posture | side | 0° |
| Head/Shoulders | Anterior Imbalanced Shoulders | front | 0° |
| Head/Shoulders | Posterior Imbalanced Shoulders | front/back | 0° |
| Spine | T1 Tilt (Backward) | side | 0° |
| Pelvis | Pelvic Obliquity | front | 0° |
| Pelvis | Anterior Pelvic Shift | side | 0° |
| Pelvis | Pelvic Axial Rotation | transverse (front depth) | 0° |
| Leg | Genu Varum/Valgum (Left) | front | 0° |
| Leg | Genu Varum/Valgum (Right) | front | 0° |
| Leg | Knee Extension / Back Knee | side | 0° |

Each finding: `deviation°`, `direction`, `severityPct (0–100)`, `zone (maintain 0–33 / warning 33–66 / danger 66–100)`, `viewUsed`, `confidence`. Composite → `overallScore` → `grade (S–E)` + `percentile` + per-view `rank` (modeled).

---

## Architecture (A.N.T. — deterministic core, probabilistic edge)

Seam = plain landmark JSON between stages:
```
[Capture] camera/upload → PoseFrame JSON → [Engine: PURE] assessPosture() → AssessmentResult → [Viz/Report]
                              ▲ test mode injects fixture JSON (bypasses MediaPipe)
```
- **Capture** (only MediaPipe/WASM/getUserMedia): MediaPipe Tasks `PoseLandmarker` (BlazePose GHUM, 33 landmarks incl. metric 3D `worldLandmarks`). Self-host WASM + `.task` model in `/public`. Dual input: live camera + **image/video upload** (the deterministic test backbone). Persist captured frame (Storage) + extracted `PoseFrame` JSON (re-scorable).
- **Engine** (`src/lib/posture-engine/`, pure TS, no React/DOM/network): `PoseFrame[] → AssessmentResult`. Per-imbalance geometry → severity%/zone → composite grade/percentile/rank → confidence gating (low visibility ⇒ `unreliable`, excluded from aggregate; never throws). Heaviest unit-test coverage.
- **Viz/Report** (read-only consumers of JSON):
  - **Annotated skeletal sheet** (front/side SVG skeleton template + computed angle markers/arrows + photo inset) — the v1 primary visualization (interactive 3D deferred to v1.5).
  - **Schematic muscle body-map** (front/back SVG, region ids highlighted red/blue per imbalance).
  - **Risk bars** (maintain/warning/danger), **grade ring**, region-grouped imbalance cards.

### Clinical knowledge base (seeded, deterministic)
`imbalance_definitions` (10 rows), each: `key, region, label, default_view, standard_value, unit, threshold_config (deviation→severity% ramp + zone edges), causes_text, tight_muscles[] {name, svgRegionId}, weak_muscles[] {name, svgRegionId}`. Exercises mapped to `imbalance_key`. This single source drives the engine thresholds, the cards' causes text, the muscle map, and recommendations.

---

## Data model (Supabase + RLS, `practitioner_id = auth.uid()` join-free policies)

- **practitioners** (= `auth.users` via `handle_new_user()` trigger) — practice name, logo, `non_diagnostic_ack_at` gate.
- **clients** — practitioner-owned (not auth users in v1; `client_portal_invite_token` v2 hook), `consent_recorded_at`, `archived_at`.
- **assessments** — per session; `status`, `scoring_engine_version`, **`overall_score`, `overall_grade`, `overall_percentile`, `front_rank`, `side_rank`**; `assessment_type` discriminator open for v2.
- **assessment_findings** — one row per imbalance per assessment: `imbalance_key, region, label, deviation, standard, unit, direction, severity_pct, zone, view_used, confidence`; `UNIQUE(assessment_id, imbalance_key)`; composite index for trends.
- **captures** — Storage metadata (`view, storage_path, source`) + `pose_frame jsonb`.
- **reports** — generated PDF metadata (`storage_path, compared_to_assessment_id`).
- **imbalance_definitions** — seeded knowledge base (read-only to authenticated; service-role seed).
- **exercises** — seeded library; `primary_deviation_keys text[]` (imbalance_key), `min_zone`.
- **exercise_recommendations** — per-assessment, deterministically derived; `UNIQUE(assessment_id, exercise_id)`.

Storage (private, path-segment RLS, signed URLs): **posture-captures**, **posture-reports**, **practitioner-assets**.

Reporting: client-side **`@react-pdf/renderer`** (verifiable via `renderToBuffer` → assert `%PDF`), uploaded via a service-role route handler.

Progress: per-imbalance `severity_pct` and overall grade over time — query `assessment_findings` joined through `assessments` ordered by `assessed_at`; Recharts trend lines with maintain/warning/danger `ReferenceArea` zones + before/after deltas.

---

## ZeroForge integration

**Project root:** `/Users/zero-suminc./projects/posture-ai/`
**Spec file:** `<root>/.zeroforge/prompts/app_spec.txt` (XML `<project_specification>`: overview, technology_stack, core_features, database_schema, api_endpoints_summary, success_criteria, dependency-ordered `<implementation_steps>` = the features below).

**Launch (direct path):**
```
cd /Users/zero-suminc./projects/services/zeroforge
python autonomous_agent_demo.py --project-dir /Users/zero-suminc./projects/posture-ai --model claude-sonnet-4-6
```
(or `./start_ui.sh` for the live Kanban at :5173). Optional Opus first-pass on the engine/CV/RLS features, then resume on Sonnet.

### Feature decomposition (→ app_spec `<implementation_steps>`)
Image-**upload** + pure unit-tested engine come **before** live camera so the build self-verifies from day one.

**Phase 0 — Scaffold:** F-01 Next.js 16/React 19/TS/Tailwind v4/shadcn/Framer/React Query/vitest · F-02 Supabase SSR client + middleware.
**Phase 1 — Schema + KB:** F-03 core schema (6 tables incl. assessments grade/percentile/ranks + findings) + RLS + trigger · F-04 `imbalance_definitions` seed (10 imbalances: region, standard, thresholds, causes, tight/weak muscles) · F-05 exercises seed + recommendations mapping · F-06 Storage buckets + policies.
**Phase 2 — Engine (pure, vitest):** F-07 types+landmarks+geometry · F-08 the 10 imbalance computations · F-09 thresholds → severity% + zone · F-10 composite grade(S–E) + modeled percentile + per-view rank · F-11 `assessPosture` orchestrator + confidence gating.
**Phase 3 — Auth:** F-12 sign-in/up (+Google) · F-13 callback · F-14 non-diagnostic disclaimer onboarding gate.
**Phase 4 — Clients:** F-15 client list · F-16 new-client sheet (+consent) · F-17 client detail (tabs).
**Phase 5 — Capture:** F-18 client-select step · F-19 image-upload capture (front/side/back) + test-mode landmark-injection seam · F-20 MediaPipe provider + index→name adapter (smoke) · F-21 submission API (Storage upload + captures + pose_frame) · F-22 scoring apply (write findings + grade/ranks + derive recommendations) + status · F-23 processing poller.
**Phase 6 — Results UI (on-screen report):** F-24 overall rating panel (grade ring + percentile bar + band table) · F-25 annotated skeletal sheet (front/side SVG + angle markers/arrows + photo inset + per-view rank) · F-26 region-grouped imbalance cards (deviation vs standard + maintain/warning/danger bar + causes) · F-27 schematic muscle tight/weak body-map (front/back SVG highlight) · F-28 recommended-exercises panel.
**Phase 7 — PDF report:** F-29 two-page react-pdf report (p1 rating+skeletal, p2 imbalance list+muscle+causes+exercises, disclaimer footer) · F-30 generation + Storage upload route · F-31 report page (iframe preview + download).
**Phase 8 — Progress & polish:** F-32 progress trends (severity per imbalance + grade over time) · F-33 dashboard · F-34 exercise library · F-35 settings · F-36 webcam capture path · F-37 PWA manifest + SW · F-38 disclaimer surfaces + PDF watermark · F-39 RLS isolation smoke-test suite.

### Verifiability strategy
- **Unit (vitest):** engine on fixture `PoseFrame`s → assert each imbalance `deviation`/`severityPct`/`zone`, the composite `grade`/`percentile`/`rank` determinism, confidence gating; recommendation derivation; PDF `%PDF`; **RLS cross-tenant denial**.
- **Playwright e2e:** upload fixture image → assert grade ring, per-view ranks, region-grouped imbalance cards, risk bars, muscle-map highlights, disclaimer render; canonical run **injects committed `PoseFrame.json`** (bypasses MediaPipe); separate non-blocking smoke run exercises real MediaPipe (asserts only "landmarks returned").
- **Seams:** `?testMode=1` landmark injection, injectable clock/engine version, `data-testid` on grade, each finding card, muscle-map regions, disclaimer.

---

## Execution steps (post-approval)
1. Scaffold `~/projects/posture-ai/` with `.zeroforge/prompts/`; keep my planning artifacts under `docs/` so they don't collide with ZeroForge's generated app/`.claude/`.
2. Write human-readable PRD → `~/projects/posture-ai/docs/plans/2026-05-29-posture-ai-prd.md` (+ immutable blueprint snapshot).
3. Provision Supabase project (paid prod org `zljkaiwwkbpeyjsblwyb`); keys → `~/projects/posture-ai/.env`; verify connectivity (Phase L).
4. Author `app_spec.txt` — serialize PRD + the ~39-feature list into ZeroForge XML.
5. Apply initial migrations once F-03/04/05/06 exist (supervised checkpoint via `supabase db push` / MCP `apply_migration`), so DB-dependent Playwright/RLS features have a green link.
6. Fire ZeroForge greenfield on Sonnet 4.6 (optional Opus engine pass first); monitor via :5173 Kanban / CLI loop.
7. Flag Devin when initialized + running, and again at completion, with local URL + monitor/resume instructions.

## Verification (definition of done)
- ZeroForge `features.db`: all features `passes=1`. `npm run build` 0; `npx vitest run` green (engine geometry, grade/percentile/rank determinism, confidence, PDF, recommendations, RLS isolation).
- Playwright green: upload fixture → page-1 grade ring + per-view ranks + annotated skeletal sheet; page-2 region-grouped imbalance cards with deviation/risk-bar/causes/muscle-map; PDF `%PDF`; RLS denies cross-practitioner reads; disclaimer present everywhere.
- Manual smoke: sign up → accept disclaimer → create client → upload front/side/back → view full two-page report (grade C-style ring, per-imbalance cards, muscle maps, exercises) → download PDF → second assessment shows trend.

## Risks & caveats
- **Screening-grade, not radiographic** — confidence flags, screening vocabulary, tunable thresholds, mandatory disclaimer.
- **Modeled percentile/rank** (no real cohort yet) — labeled and configurable; calibratable when population data exists.
- **MediaPipe headless** flakiness → landmark-injection seam (clinical correctness verified without the ML path).
- **Supabase migration application** = the one supervised step (step 5).
- **Claude Max limits** on a long unattended run → Sonnet workhorse; DeepSeek fallback.
- **Muscle illustrations** = schematic SVG in v1 (detailed medical renders are a v1.5 asset upgrade). **Interactive 3D** deferred to v1.5 (v1 ships the annotated 2D skeletal sheet matching the deliverable).

## Deliverable routing
PRD + blueprint → `~/projects/posture-ai/docs/plans/`. App code → `~/projects/posture-ai/` (ZeroForge-generated). This config-scoped plan lives in `~/.claude/plans/`; durable home after landing = project `docs/plans/`.
