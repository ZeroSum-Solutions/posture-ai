# posture-ai — Workout Player + Scan-Engine Accuracy + UX Lift

**Definitive implementation plan · v2 (GPT-5.5-hardened).**
Extremely-accurate screening → auto-generated exercises → a Future.co-grade guided **Workout Player** (timer, skip/back, coach voice, full-screen demonstrations, save + rate) → full results/capture UX lift.

> **Provenance.** Designed by a 3-angle agent panel over a code-grounded audit, then adversarially reviewed by **GPT-5.5** (`codex exec`, read-only, against the live repo). GPT verdict on the v1 draft: **MAJOR-REWORK** — the facts were confirmed, but 3 critical + 6 high issues had to be fixed before building. **This v2 folds in every one of them** (each change is tagged `[GPT-fix]`). Vendor claims independently verified via web (`movekit.com`). Full audit + research + GPT findings archived in the session scratchpad.

---

## Vision

Every screening already yields the *right* corrective exercises (`lib/program/`). The demo-defining moment we're adding is a **guided follow-along Workout Player** that feels as calm, continuous, and premium as Future.co — full-bleed looping demonstrations, a coach voice at the right moments, one big timer, and a save/rate loop — generated automatically from the scan. But a beautiful player on a shaky number is a liability for a B2B **screening** tool, so we **ship the engine credibility layer *first*, gate the player on it, snapshot every launched session, and keep the whole thing inside the screening-only guardrails** — behind a security-reviewed delivery model. Ship the wow, but ship it on a number we can stand behind and a data layer that won't rot.

---

## Decisions — locked vs. open

### Locked (with rationale)

1. **Asset strategy — License [MoveKit](https://movekit.com/pricing) (3D-mannequin exercise-demo loops, $99 one-time full library), map 55 slugs → clips.** *Independently web-verified:* 206 clips, single faceless/gender-neutral mannequin (visual consistency = the #1 "premium/fluid" lever), commercial license, **and** built-in muscle-highlight variants that pair with the app's existing tight/weak 3D theme. One-time cost → satisfies subscription-only billing. Rejected: the in-app `muscle-viewer` GLB (35 static meshes, **no skeleton** — cannot be posed); rigged r3f avatar (weeks of keyframing → v2); streamed APIs like Kemtai (recurring/metered + a mid-workout uptime dependency); AI-gen video (can't guarantee biomechanics, metered). `[GPT-fix: validate MoveKit commercial-license terms + coverage of all 55 slugs at purchase; treat ExerciseAnimatic ~$1/clip gap-fill as unverified until quoted.]`

2. **Engine credibility ships BEFORE the player** `[GPT-fix: resolves the v1 sequencing contradiction]`. The v1 draft shipped the player first yet claimed it was "reliability-gated" — but the gating signal didn't exist yet. v2 sequences the engine **within-capture stability** layer as Phase 1, then builds the player on it.

3. **Session snapshotting is mandatory (anti-drift).** `generateWorkoutSession()` freezes a `program_snapshot` JSONB at launch; a later coach swap changes only *new* sessions. `buildProgramFrom()` stays the single source of truth. `[GPT-fix: snapshot excludes direct client identifiers; see §5 erasure.]`

4. **Delivery = practitioner-launched, approval-gated, with a security-reviewed client link.** A session can only be minted from a `practitioner_approved` screening (gate already used by report export, `app/api/reports/route.ts:67`). Client follows in-clinic on the same device, **or** via a scoped, hashed, expiring, revocable share link — treated as a **real PHI-access surface**, not "inherited consent" `[GPT-fix, CRITICAL: see §5 security spec]`.

5. **Voice = pre-generated boundary cues** (intro fragments keyed on the finite `IMBALANCE_KEYS` enum + 55 static setup lines + one outro), synthesized at author time, cached in Supabase Storage. **No client-specific text is ever sent to the TTS vendor** (only enum-keyed and static copy) — this is what keeps voice PHI-clean. Zero runtime latency, offline-capable. Fallback: Web Speech API / `expo-speech`. Every line also renders as an on-screen **caption**.

6. **All new user-facing strings pass a screening-only gate.** Requires exporting a reusable validator (`assertScreeningText`) from `content/muscles/types.ts` — today only `BANNED_TERM_PATTERNS` is exported, `screeningText()` is private `[GPT-fix]`. Plus a **static allowed-phrase catalog** for coach cues (not just a banned-term denylist) `[GPT-fix, regulatory]`.

### Open — you decide (recommendation first)

| # | Decision | Recommendation | Why |
|---|----------|----------------|-----|
| **O1** | Voice vendor + billing | **ElevenLabs, author-time only, via a subscription plan** | Best naturalness; one-time generation, no runtime metering. `[GPT-fix: confirm plan commercial-use + storage rights; since no client text is sent, no BAA needed.]` |
| **O2** | Population percentiles | **Suppress `Top X%` until a normative cohort exists; show zones + stability only** | `toPercentile = 100−score` is a self-labeled "rough linear model" (`thresholds.ts:109`) but the UI presents it as population rank `Top {n}%` (`page.tsx:890`). Claiming rank without a cohort is dishonest. |
| **O3** | Client-link lifetime | **7-day, revocable, hashed token + explicit share event** (shorter than v1's 30d) | `[GPT-fix]` Minimizes PHI-link exposure window. |
| **O4** | MoveKit slug gaps | **Approve ~$1/clip gap-fill (ExerciseAnimatic) for any of 55 misses; text+poster fallback otherwise** | Consistency matters; a few $ beats a text-only hole. |
| **O5** | Regulatory review | **Yes — a lightweight legal/regulatory UX review before Phase 4 ships the client link** | `[GPT-fix]` A guided player w/ voice+timers+ratings can *look* like prescribed care even with compliant words. |
| **O6** | Ratings scope | **Movement-education feedback only (clarity / pace / difficulty), NEVER symptoms or outcomes** | `[GPT-fix]` Symptom/outcome capture would cross screening→treatment. |
| **O7** | Multi-frame capture | **Accept a 3–5-frame burst (~1s/view)** | Simplest change; unlocks within-capture stability. |
| **O8** | `exercise_recommendations` cleanup | **Deprecate in a separate migration** (written on creation, never read by `buildProgram`) | Stale, but not a blocker. |

---

## Section 1 — Scan-engine accuracy roadmap (ships FIRST)

**What "extremely accurate" honestly means here.** A single-photo *monocular 2D* pipeline (BlazePose) has no depth — no smoothing changes that, and pretending otherwise is the real risk `[GPT-fix]`. So v1 targets **trustworthiness**, precisely scoped:

- **Within-capture landmark stability** — from a 3–5-frame burst, how much do landmarks/angles jitter? `[GPT-fix: renamed from "test-retest repeatability" — a burst of a near-static subject measures detector jitter, NOT re-positioning/parallax/operator variance. We do NOT claim test-retest ±1–2° without a repeated-capture validation study, which is deferred.]`
- **Calibrated per-finding uncertainty** surfaced honestly ("8.3° ± 1.2°, high stability").
- **Honest zones** — a finding whose CI straddles a threshold is flagged non-actionable rather than falsely confident.

All additive to the frozen engine contract; stored frames re-score identically; legacy 1-frame assessments backfill `stability: null` (never fabricated). Engine `1.2.0 → 1.3.0` (`engine.ts:12`, verified).

### Tier 1 — the credibility spine (ships in Phase 1, before the player)

| # | Change | Effort | Impact | Files |
|---|--------|--------|--------|-------|
| 1.1 | **Multi-frame burst + median/MAD smoothing.** New `preprocessFrames()` in `engine.ts` before `normalizeFrame` (currently one frame/view, `engine.ts:18`): per-landmark median, reject `|x−m|>3·MAD`, emit one smoothed frame. A 1-frame array behaves exactly as today (back-compat). | M | High | `packages/posture-engine/src/engine.ts`, `app/assessments/new/FullScreenCapture.tsx`, `lib/pose/detect.ts` |
| 1.2 | **`Finding.stabilityScore` + `Finding.uncertaintyDeg`** from the burst spread (angle uncertainty via per-metric error propagation in `geometry.ts`). Extend `AssessmentResult.captureStability`. `[GPT-fix: labeled "within-capture stability", not clinical repeatability.]` | M | High | `metrics.ts`, `geometry.ts`, `types.ts` |
| 1.3 | **`ambiguous` zone — full-stack migration, NOT an enum tweak** `[GPT-fix, HIGH]`. When `deviation ± 2σ` straddles a threshold, stamp `ambiguous` → non-actionable everywhere. **Blast radius that MUST be handled in one migration:** DB `zone_enum` (`ALTER TYPE`, `20260101000000_initial_schema.sql:5`); TS union (`types.ts:25`); results color map (`page.tsx:14,116` — else undefined color); reliability leaks — `page.tsx:62`, `lib/reports/clientProgram.ts:53`, `findingsToMuscleStates.ts:98`, `selectPriorities.ts:52` all treat only `unreliable` as not-reliable, so `ambiguous` must be excluded there too; PDF `ZonePill` (`lib/pdf/report.tsx:317`). Tests for DB insert, results, PDF, program, muscle-map. | M | High | `thresholds.ts`, `metrics.ts`, `types.ts`, migration, + all sites above |
| 1.4 | **`Finding.explanation` + `Finding.validity`** (`VALIDATED\|LITERATURE_CITED\|SCREENING_ONLY`) from existing `metric_validity` (migration `20260628000000`). Makes the suppressed `pelvic_axial_rotation` self-explaining. | S | Medium | `types.ts`, `thresholds.ts`, `engine.ts`, `lib/findings/buildFindingRow.ts` (+ `assessment_findings.explanation` col) |

### Tier 2 — reduce error at the source (Phase 4, no new hardware)
2.1 **Hard framing gate** — promote `assessFrameQuality()` from advisory to blocking (span 0.60–0.95, joints in-bounds, hip centered) with a recorded override. 2.2 **Upload manual-tilt dial** → `manual_roll_deg` (a "level-assisted" state; still `levelVerified=false`). 2.3 **Tighten bilateral-knee merge** — require both reliable + severity within ~10 + CI overlap. 2.4 **Cross-view agreement flag** → `viewAgreementWarnings`.

### Tier 3 — research track, explicitly not a v1 blocker
Normative population cohort (n≥200, mocap ground truth) → empirical-CDF percentiles replacing linear `toPercentile()` (**until then, O2 suppresses `Top X%`**). Perspective/distance normalization. Multi-view 3D reconstruction (the real depth fix). We scaffold `packages/posture-engine/src/calibration/` now so adoption is a data change. **A written repeated-capture validation protocol** (re-scan minutes apart, different operator/distance) is the prerequisite before any "test-retest ±X°" claim ships `[GPT-fix]`.

**Verification (Tier 1):** engine fixtures prove a 5-frame set with one injected outlier (a) rejects it, (b) bounds `uncertaintyDeg`, (c) flips a boundary-straddler to `ambiguous`; smoothed output is deterministic-snapshotted; legacy 1-frame re-score unchanged; DB accepts the new enum; results/PDF/program/muscle-map all render `ambiguous` as non-actionable. Existing `engine.test.ts` stays green.

---

## Section 2 — Scan → Session generation

The pipeline **already produces the right exercises**: `findings → selectPriorities()` → `buildProgramFrom()` (`lib/program/buildProgram.ts`) → `ProgramReport` (ordered `ProgramStep[]` with `stepLabel`, `category`, `baseSlug`, `repRange`, 3-week ramp). We **add one pure flattener + a snapshot — no engine fork.**

**New: `lib/workout/generateWorkoutSession.ts`** — `(report, { week, capability, swaps }) → SessionSnapshot`
- Consumes the already-overridden `ProgramReport` the results page builds.
- **Reliability gate (defensibility).** Exclude steps whose driving finding is `unreliable` or `ambiguous` (available because §1 ships first). A client never follows a workout built on a number the engine won't stand behind.
- **Empty-session floor** `[GPT-fix, HIGH]`: if gating leaves **zero** playable items (e.g. all findings ambiguous), **no session is minted** — the results page shows a "re-capture / follow-up" CTA. A practitioner may override into an explicitly-labeled **"general mobility, not finding-derived"** session, audit-logged. The player never launches an empty or falsely-derived workout.
- **Ordering** honors the builder's authored arc — Loosen→Lengthen→Wake-up→Strengthen (`CATEGORY_ORDER = {mobility:0,stretch:1,activation:2,strengthen:3}`, verified) with the integrative "Connect" item pinned last; interleave cross-priority so the client warms up globally once. `[GPT-fix: CATEGORY_ORDER, applyCapability, and the per-category caps are PRIVATE in buildProgram.ts today — Phase 0 exports them (or a shared `orderSteps()` helper) so the flattener reuses, never duplicates, the logic.]`
- **Timer from existing dosage (`dosage.ts`), not invented:** `hold` → countdown ring of `holdSeconds × sets`, auto-advance at 0:00 (3-2-1 pre-roll); `dynamic` → show `reps` band as a target, **tap-Next** advances (no fake per-rep timer). **Rest** is the one missing field (all audits flagged it) → add `restSecondsBetweenSets` to `ExerciseContent` (default per category).
- **Difficulty** = existing `capability` dial (`applyCapability`); ratings feed it back within authored bands — **never severity-scaled** (preserves the `dosage.ts` safety property).
- **Cues** assembled here: new short structured `form.alignmentCue` + `form.avoidCue` + a trimmed setup line — never the raw 80–800-char `instructions` (those stay the on-screen detail).
- **Estimated duration** stored → "≈ 12 min" on the CTA.

**Verification:** golden-snapshot test (fixed `AssessmentResult` → deterministic `SessionSnapshot`); a coach swap changes a *new* session but not a launched one; `unreliable`/`ambiguous` absent; the empty-session floor triggers the retake CTA.

---

## Section 3 — Demonstration assets + voice

**Assets (MoveKit, verified).** Extend `exerciseContentSchema` (`content/muscles/types.ts`) with **optional** `media { loopUrl, posterUrl, fallbackGifUrl? }`, `form { alignmentCue, avoidCue, tempo? }`, `restSecondsBetweenSets?` (Zod-compatible — the existing `reps` `superRefine` only checks `dosageType`/`category`/`reps`, verified `types.ts:122`). DB: `exercises` **already has `video_url`** `[GPT-fix]` → migration adds only `poster_url`, `demo_gif_url` (`ADD COLUMN IF NOT EXISTS`). One-time 55-row slug→clip map; host in the **existing Supabase Storage/CDN** used for captures. **Preload `item[i+1]` during `item[i]`** via react-query — the single biggest fluid-vs-janky lever. Fallback: poster while buffering; branded placeholder + text caption if a slug has no clip. Never a broken `<video>`.

**Voice (pre-generated boundary cues).** Generate at author time: one outro, 55 setup lines, a closed set of per-`IMBALANCE_KEY` intro fragments; the session intro is **file-assembled** by concatenating relevant fragments — so even the "dynamic" part is offline and **no client text leaves the app** `[GPT-fix: this is the PHI-clean property — voice input is enum-keyed + static only]`. ElevenLabs (O1) → MP3 → Storage. Fallback: Web Speech / `expo-speech`. **A11y parity:** every spoken line renders as a simultaneous caption (works muted, screen-reader friendly). **Guardrail:** every script/caption/tag passes the exported `assertScreeningText` **and** the static allowed-phrase catalog before MP3 generation, in a `content.test.ts`-style CI gate `[GPT-fix: build-time denylist alone is insufficient for assembled strings — hence a positive allowed-phrase catalog + a runtime check on any free text].`

---

## Section 4 — The Workout Player

**Through-line:** `[full-bleed looping demo] × [one big timer/rep target] × [boundary voice cue] × [thin segmented progress] × [auto-advance or tap-Next] × [save + rate]`, Apple-Fitness+ chrome discipline (demo guides, HUD peripheral, controls auto-hide ~3s).

**Web — `app/workouts/[sessionId]/player.tsx` (client component).**
- **Canvas:** `<video loop muted playsInline poster=posterUrl>` on the clip.
- **Top:** thin segmented progress (one segment per `SessionItem`).
- **Center-bottom:** large **circular countdown ring** (hold) or **rep-target chip** "×12" (dynamic).
- **Overlay:** name + set `x/y`, a **swap** affordance (`swapAlternatives()`), a caption mirroring the voice cue.
- **Transport:** Back · Pause · Skip · mute-voice · captions toggle.
- **Wake-lock:** extract the inline logic from `FullScreenCapture.tsx` (`wakeLockRef`/`acquireWakeLock`/`releaseWakeLock` + visibility reacquire, confirmed at `:89/:127/:202`) into `lib/capture/use-wake-lock.ts` and reuse (small justified orphan-cleanup, no new dep).
- **State machine** (reducer keyed off `dosageType`): `IDLE → INTRO → UP_NEXT[i] (prefetch clip[i+1]) → PREROLL(3-2-1) → PLAYING[i] (hold: holdSeconds×sets, rest between sets, auto-advance | dynamic: rep target, tap-Next) → … → SUMMARY → SAVE → RATE`. Skip/Back/Pause throughout; **resume** = `current_item_index` + elapsed persisted every transition.
- **Motion (Framer Motion, a project default):** `layoutId` shared-element from the `PriorityProgram.tsx` row into full-screen; spring easing; `prefers-reduced-motion` honored.
- **Save → Rate:** summary (done/skipped, duration, screening-only reminder) → Save finalizes the run → **Rate = clarity + pace + difficulty (`too_easy|just_right|too_hard`) + optional ≤500-char note (lint-checked). NO symptom/outcome capture** `[GPT-fix, O6]`. Feedback nudges difficulty within authored bands only.
- **Entry point:** results page **Launch Session** CTA (~56px, shows est. duration) → `POST /api/workouts` → navigate `/workouts/[sessionId]` (in-clinic) or copy the share link.

**Mobile — later phase (Phase 5), a build, not a "port"** `[GPT-fix]`. Mobile is fixture-only (no Expo Router, no networking/auth, camera landmark-extraction still pending, `CameraCaptureScreen.tsx:80`). Same snapshot contract + shared timeline reducer + same clip/audio URLs, reached via the share-token route. New deps: expo-router, expo-video, react-native-reanimated, expo-keep-awake, react-query, expo-speech. Prereqs (nav + results screen) land with it.

**A11y (both):** captions mirror every voice line; ≥44px targets; reduced-motion; fully operable muted; SR labels on transport + timer.

---

## Section 5 — Data model + API (security-first)

Three new tables clone the `20260629100000_regulatory_hardening_v2.sql` pattern (verified: revoke public writes `:15`, no-image JSONB check `:35`, service-role RPCs `:127`, tombstone rejection `:212`): **`authenticated` = SELECT-only RLS-scoped; API service-role is sole writer; JSONB `no-image-bytes` CHECK; `client_id` FK `ON DELETE CASCADE` + tombstone-trigger rejection on every insert path** `[GPT-fix, MEDIUM: migration ordering — `session_runs`→`workout_sessions`; lock the client row before minting session+run].`

- **`workout_sessions`** — `id, assessment_id, client_id, practitioner_id, week, capability, program_snapshot JSONB, session_token_hash TEXT UNIQUE, status, estimated_duration_sec, created_at, expires_at, revoked_at`. **Snapshot excludes direct identifiers** (no client name in JSONB; the player fetches first-name separately, authed) so a snapshot isn't residual PHI after erasure `[GPT-fix, MEDIUM]`. RLS SELECT: `practitioner_id = auth.uid()`.
- **`session_runs`** — playback/resume: `workout_session_id, status, current_item_index, items JSONB [{slug, completed, skipped, durationMs}], total_duration_ms, last_paused_at, completed_at`. `no-image-bytes` CHECK.
- **`workout_ratings`** — `session_run_id, workout_session_id, client_id, clarity, pace, difficulty, feedback_tags TEXT[], notes TEXT(≤500), created_at`. **No symptom/outcome fields.**
- **`workout_share_events`** `[GPT-fix, CRITICAL]` — audit row on every link mint/revoke/access (who/when/ip) so a PHI link is accountable.
- **Also:** `exercises ADD poster_url, demo_gif_url`; `assessment_findings ADD explanation`.

**Share-token security spec** `[GPT-fix, 2× CRITICAL]` — the client link is a **real PHI surface**, not "inherited consent":
- Token = ≥256-bit CSPRNG (`crypto.randomBytes`), **stored hashed** (`session_token_hash`), compared server-side; consent links' `randomUUID()` (`app/api/consent/link/route.ts:34`) is **too weak** for this.
- A **`resolve_workout_token()` SECURITY DEFINER RPC** is the only reader — checks token hash **+ `expires_at` + `revoked_at` + client-not-tombstoned + assessment `practitioner_approved` + status** and returns a **minimal redacted projection** (no notes, no free text, minimal identifiers). Service-role "only" is not a security argument — the RPC is what makes it IDOR-safe.
- **Explicit share consent event** recorded at mint (O5 review covers the language); **7-day expiry (O3), practitioner-revocable**; **rate-limit by token + IP** (reuse `api_rate_limits`).

**API routes:**
- `POST /api/workouts { assessment_id, week, share? }` — **gated on `practitioner_approved`**, rate-limited per practitioner → `generateWorkoutSession()` → insert session + `session_runs(status:'started')` (+ share event if `share`). Returns `{ session_id, share_link? }`.
- `PATCH /api/workouts/[id]/run` — idempotent, `updated_at`-guarded playback upsert.
- `POST /api/workouts/[id]/rate` — insert rating; lint `notes`.
- `GET /api/workouts/token/[token]` — **public, via `resolve_workout_token()` only**; minimal redacted projection for hydration.
- `POST /api/workouts/token/[token]/rate` — public, token-scoped, **no free-text notes on the public path** `[GPT-fix]`.

---

## Section 6 — UX / visual system upgrade

The results page (`app/assessments/[id]/page.tsx`, 1017 lines, all inline styles, no motion) is the weak point. Invest in tokens first, then re-skin by **extraction, not rewrite**.
- **Tokenize** (`globals.css` + Tailwind v4): promote the ad-hoc palette + zone colors (incl. new `ambiguous`) to CSS variables; add transition + spacing/type scale. Formalizes the app's *own* tokens — no house aesthetic. Refactor only load-bearing components (`GradeRing`, finding cards, `PriorityProgram.tsx`) off inline styles.
- **Results hierarchy (mobile-first):** (1) Hero — larger grade ring + Top-3 severity bar + **Launch Session** CTA + est. duration. (2) **Accuracy & Methodology card** *(the visible payoff of the engine bet)*: per-finding `stabilityScore`/`uncertaintyDeg`, `levelVerified`/`tiltCorrected` (shows the actual corrected roll), `validity`/`explanation`, `missingViews`, and the plain-language 2D limits ("single photo, no depth; monocular parallax"). **Percentile shown only if O2 unlocks it.** (3) Corrective Program. (4) 3D viewer + skeletal diagrams as lazy tabs. (5) Exercise library last.
- **Traceability:** under each priority, "Targets: [finding] (+X°, 87% stable)"; tap an exercise → detail sheet (demo loop + "why" + swaps + muscle roles).
- **Capture polish** (`FullScreenCapture.tsx`): animate the tilt gate; per-group pose confidence ("head 92% / torso 88% / legs 76%"); post-capture review — reduces retakes, reinforces the accuracy story.

---

## Section 7 — Phased rollout (each phase ships independently + a verification gate)

**Phase 0 — Foundations & unblock.** License MoveKit (O4 gap-fill approved); export `assertScreeningText` + build the static allowed-phrase catalog; **export `orderSteps`/`CATEGORY_ORDER`/`applyCapability`** from `buildProgram.ts`; extend `exerciseContentSchema` (`media`/`form`/`restSecondsBetweenSets`) + `exercises` columns; map 55 slugs; author + generate boundary-cue MP3s; **the 3 workout tables + `workout_share_events` (v2-hardening parity, hashed tokens, cascade/tombstone)** + design tokens.
*Verify:* every exercise resolves clip+poster+cue (or a lint-flagged gap); banned-term + allowed-phrase + Zod tests green on all 55; migration applies clean on a branch DB; RLS denies cross-practitioner reads; `resolve_workout_token()` rejects expired/revoked/tombstoned/unapproved and an IDOR attempt.

**Phase 1 — Engine credibility layer (FIRST).** Engine `1.3.0`: `preprocessFrames()` (median/MAD burst), `stabilityScore`/`uncertaintyDeg`, **`ambiguous` full-stack migration** (all blast-radius sites in §1.3), `explanation`/`validity`; Accuracy & Methodology card.
*Verify:* fixtures reject a planted outlier, bound uncertainty, flip a straddler to `ambiguous`; legacy 1-frame re-score unchanged; DB/results/PDF/program/muscle-map render `ambiguous` as non-actionable; `engine.test.ts` green.

**Phase 2 — Session generation + the web Player.** `generateWorkoutSession.ts` (reliability-gated + empty-session floor + rest + snapshot); the player (full-bleed loop, ring/rep chip, skip/back/pause, prefetch, `use-wake-lock`, segmented progress, shared-element transition, Save + Rate); `POST /api/workouts` (approval-gated), `PATCH /run`, `POST /rate`; Launch Session CTA.
*Verify:* golden-snapshot session; real assessment → Launch → full play-through (hold auto-advance + rep tap-Next) → save → rate; reload mid-session resumes; next clip never stalls (throttle test); empty-session floor → retake CTA; `unreliable`/`ambiguous` absent.

**Phase 3 — Voice + captions.** Boundary-cue playback + captions + Web-Speech fallback + a11y parity.
*Verify:* voice fires only at boundaries, captions match; muted playthrough works; every generated/assembled string passes the allowed-phrase + `assertScreeningText` gate.

**Phase 4 — Share link (security-reviewed) + results redesign + engine Tier 2.** `resolve_workout_token()` + public token routes + share/revoke UI + audit events; results hero redesign + traceability + token/motion migration; framing gate, upload tilt dial, knee-merge, cross-view flag. **Gated on the O5 regulatory review.**
*Verify:* token link opens scoped, no-auth, minimal payload; IDOR/expired/revoked/tombstoned/unapproved all 403; rating writes back (no free text on public path); reduced-motion respected; framing gate blocks a cropped fixture; visual-regression + 375px pass.

**Phase 5 — Mobile build.** Expo Router + results screen + `expo-video`/`reanimated`/`keep-awake`/`react-query`/`expo-speech` player over the shared token contract.
*Verify:* mobile plays the same session a web link produced; skip/back/pause/resume/rate parity; offline demo playback; TTS fallback.

**Phase 6 — GPT-5.5 adversarial close-out (required).** Drive the full path (screen → approve → launch → share-link → play/skip/back/pause/resume → save → rate → offline/failed-clip fallback → voice fallback → engine uncertainty surfacing). Adversarial audit: allowed-phrase + banned-term on every assembled string/caption; screening-only framing; share-token IDOR/expiry/revocation/rate-limit; RLS; launch refused on unapproved/tombstoned/empty-session. Iterate to green.

---

## Section 8 — Risks, guardrails, deferred

**Screening-only guardrails (DB- and catalog-enforced):**
- Player = guided movement **education**, never care. Every new string passes `assertScreeningText` **+ the static allowed-phrase catalog** at build time; **ratings capture clarity/pace/difficulty, never symptoms/outcomes** (O6); **no severity→dosage scaling** (preserves `dosage.ts`). **O5 regulatory review before the client link ships** `[GPT-fix]`.
- The engine `DISCLAIMER` renders on results, the player start card, **and the share-link landing**, and is stored on the snapshot so it travels with the link.
- Assets are faceless mannequins (compliance choice); no real-person before/after imagery.
- New tables: service-role sole writer, SELECT-only authenticated, no image bytes in JSONB, cascade + tombstone on every insert path; launch requires `practitioner_approved`; snapshot excludes direct identifiers (erasure-safe).

**Risks & mitigations:** buffering → prefetch + short H.264 loops + poster; MoveKit gaps → O4 + text fallback; voice billing → author-time subscription only (O1); percentile dishonesty → suppress until a cohort (O2); large results file → extraction not rewrite; **PHI link → the §5 security spec is a hard gate.**

**Explicitly deferred (documented, not omissions):** normative cohort + empirical percentiles (Tier 3/O2); **the repeated-capture validation study** that would justify any test-retest ±X° claim `[GPT-fix]`; camera-intrinsic calibration + multi-view 3D (the real depth fix); rigged r3f avatar demos (v2 — the `muscle-viewer` GLB has no skeleton); `exercise_recommendations` cleanup (O8); full mobile auth (replaced by scoped share-token).

**The bet, restated:** ship the credibility layer **first**, gate the player on it, snapshot every launched session, keep every string inside a screening-only allowed-phrase catalog, and make the Accuracy card the visible proof — an *honestly*-accurate screening tool with a Future-grade player, in that order, behind a security-reviewed PHI-link.
