# Posture AI v2 — Mobile-First PRD

**Date:** 2026-05-30
**Supersedes:** [2026-05-29-posture-ai-prd.md](_archive/2026-05-29-posture-ai-prd.SUPERSEDED.md) (web/PWA static-posture v1)
**Companion:** [2026-05-30-competitive-landscape.md](_archive/2026-05-30-competitive-landscape.md)
**One-liner:** A phone-only, $199/year movement & posture **screening** tool that puts ~80% of a $7K Moti-Physio / lab-tethered Vald HumanTrak workflow in any practitioner's pocket — on iOS *and* Android.

---

## 1. Why we're pivoting

The v1 PRD shipped a **web/PWA static-posture tool**, and explicitly noted web was chosen "because [it's] the only path ZeroForge can build *and self-verify* end-to-end. Native LiDAR client can attach later." That was a build-tooling decision, not a product decision.

Research (see companion doc) says the product decision is now clear:
- The phone is the differentiator, and **PWA capture on iOS is disqualifying** (Safari doesn't persist camera permission for PWAs; WASM inference 3–5× slower).
- Our **pure-TS scoring engine is reusable as-is** in native mobile — it's the real IP.
- The market gap is **phone-only, Android-inclusive, $199/yr** — directly under PostureScreen ($249/yr, iOS-only) and ~1% of the hardware tier.

Devin has said he's happy to change anything we have. This PRD does.

## 2. Target user & positioning

- **Primary:** solo / small-clinic physiotherapists, chiropractors, athletic trainers, S&C coaches, PTs. Mobile practitioners (home visits, sidelines, gym floor, telehealth).
- **Secondary:** the practitioner's own clients (a solo user = their own single client).
- **Positioning:** *"Objective movement screening, in your pocket, for $199 — works anywhere your clients are."* Not lab-grade; not diagnosis. The pocket screen that flags who needs the lab.

## 3. What we keep, change, and add

| Layer | Current (v1 web) | v2 decision |
|---|---|---|
| **Scoring engine** | Pure-TS `lib/posture-engine/` (10 imbalances, geometry→severity→grade S–E/percentile, confidence gating) | **KEEP & EXTEND.** No DOM/network deps → drops into React Native unchanged. Our core IP. Add dynamic-movement metrics. |
| **Capture** | Next.js + `@mediapipe/tasks-vision` WASM, image-upload + webcam | **REBUILD NATIVE.** React Native + Expo + VisionCamera V5 + react-native-fast-tflite + MediaPipe Pose Landmarker Full. On-device, offline, 2-view guided. |
| **Backend** | Supabase (Postgres+Auth+Storage+RLS) | **KEEP.** Add offline-first local SQLite + optional sync. |
| **Report** | `@react-pdf/renderer` two-page; modern Moti-style sheet | **KEEP design**; render on-device (expo-print) + cloud share. |
| **Web app** | Primary surface | **REPURPOSE** as report portal / practitioner dashboard / billing — not capture. |
| **Distribution** | Vercel web | **App Store + Play Store** (+ web portal). |

## 4. Ideal tech stack (final)

- **Mobile app:** React Native + **Expo** (EAS Build), New Architecture.
- **Camera/inference:** **VisionCamera V5** frame processors (native, JSI worklets, 2–5ms/frame) → **react-native-fast-tflite** (CoreML delegate on iOS / NNAPI on Android) → **MediaPipe Pose Landmarker Full** (33 landmarks + `worldLandmarks`, Apache 2.0, $0 inference). iOS fallback: Apple Vision 3D (iOS 17+).
- **Scoring:** existing pure-TS `posture-engine` (extended).
- **Overlay/render:** React Native Skia (skeleton + angle markers).
- **Local data:** expo-sqlite / WatermelonDB (offline-first).
- **Cloud:** Supabase (RLS per practitioner) + optional sync (Clinic tier).
- **Reports:** expo-print (PDF) + Supabase-hosted shareable links.
- **Web portal:** existing Next.js 16 app (reports, trends, billing).
- **Avoid:** YOLOv8 (AGPL), PWA-as-capture, any cloud-inference dependency.

## 5. Capture protocol (accuracy discipline)

- **Two views, one phone, sequential:** front + side; compute each metric from its correct plane (beats single-camera depth ambiguity, ~30–47% error reduction).
- **Standardize:** ~3m distance, camera at target-joint height, tripod/prop, **1× lens** (not ultra-wide), even lighting.
- **Per metric:** capture 3–5s clip → Butterworth filter → report stable median ± SD → **gate confidence <0.7 → mark `unreliable`, exclude from aggregate** (engine already does this).
- **Scope claims (what we measure vs. flag as "screening only"):**
  - ✅ Measure: sagittal flexion/extension (shoulder/hip/knee), craniovertebral/forward-head, thoracic kyphosis, frontal shoulder/pelvis level, knee valgus/varus (frontal), jump/landing **vertical** symmetry, gait spatiotemporal.
  - ⚠️ Flag low-confidence / don't headline: axial rotation, ankle kinematics, transverse plane, any camera-axis-pointing joint.

## 6. Feature plan

### MVP (v2.0) — "the pocket screen"
1. **Native capture** (iOS+Android): guided 2-view framing, real-time skeleton overlay, on-device MediaPipe, auto-grab at stable pose.
2. **Static posture battery** (reuse engine's 10 imbalances).
3. **Sagittal ROM:** shoulder/hip/knee flexion-extension + cervical (2-view).
4. **One dynamic screen:** **single-leg squat** scoring (highest subjectivity-fix value — visual ICC 0.58 today). + L/R asymmetry %.
5. **Report:** on-screen + PDF (grade ring, per-view ranks, imbalance cards, risk bars, muscle map, confidence flags, non-diagnostic disclaimer).
6. **Client management + progress trends** (reuse Supabase schema).
7. **Local-storage mode** (no cloud PII → no HIPAA BAA for solo tier).
8. **Exercise recommendations** (reuse mapping).

### v2.1
- Overhead-squat screen; jump/landing vertical LSI; cervical/shoulder ROM polish.
- Cloud sync + shareable client report links (web portal).
- Clinic tier (multi-seat, BAA, branded reports).

### v2.2+
- Gait spatiotemporal (walking speed, step length/time).
- Apple Vision 3D path on LiDAR iPhones (better depth where available).
- Normative cohort calibration (replace *modeled* percentile with real data as it accrues).
- Telehealth async capture (client self-records, practitioner reviews).

### Explicitly out of scope (don't overclaim)
- Force/kinetics estimation, metric 3D triaxial angles, ankle/rotational reliability, anything requiring a depth sensor or force plate.

## 7. Data model deltas (on existing schema)
- `assessments.assessment_type` already a discriminator → add `static_posture` | `rom` | `single_leg_squat` | `overhead_squat` | `jump_symmetry`.
- `assessment_findings` → already per-metric; add dynamic metrics (asymmetry %, rep count, LSI) under same shape.
- `captures.pose_frame jsonb` → store per-view + per-clip frame arrays (re-scorable).
- New: `sync_state` (offline-first), `device_tier` (local-only vs cloud).
- RLS unchanged (`practitioner_id = auth.uid()`).

## 8. Pricing & business model
- **Free:** 5 assessments/mo (full features) → $0-CAC funnel.
- **Solo: $199/yr** (or $24.99/mo) — single practitioner, local-storage OK. *(Annual, NOT one-time — funds infra/updates, avoids abandonware signal.)*
- **Clinic: $399/yr** — multi-seat, cloud sync, BAA, branded reports.
- **Enterprise:** custom (white-label, API, EHR).
- Margin: ~$160+/user/yr after 15% App Store cut + ~$0.07/user/mo infra.

## 9. Regulatory & privacy (gating requirements)
- **Non-device wellness/screening positioning** throughout. Ban "diagnose," "rehabilitation evaluation," "detects injury/disease." Mandatory non-diagnostic disclaimer (engine already emits one).
- **HIPAA:** local-storage-only solo tier = no BAA. Clinic cloud tier = BAA + AES-256 at rest + TLS + audit logs + breach process.
- **GDPR:** defer to EU expansion; keep data-residency-capable architecture.

## 10. Success metrics
- **Accuracy:** publish per-metric ICC/SEM vs goniometer/2nd-rater for the scoped battery; target ICC ≥0.80 on headline metrics before broad claims.
- **Activation:** % new practitioners completing ≥1 full assessment in week 1.
- **Retention:** % running an assessment every ≤4 weeks per active client (the subscription anchor).
- **Conversion:** free→paid after the 5-assessment trial.
- **Performance:** ≥24fps capture + <3s end-to-end score on a mid-range phone.

## 11. Risks
- **Accuracy overreach** → scoped claims + confidence gating + 2-view protocol + literature citations.
- **MediaPipe native integration instability** → Apple Vision (iOS) / ML Kit (Android) fallbacks.
- **iOS vs Android camera variance** → lock 1× lens, calibrate per platform, standardized distance.
- **Trust vs PostureScreen's published studies** → run our own small validation study early; lead with honesty.
- **Claude/Z.AI build limits on a long native build** → see §12 build-environment decision.

## 12. Build approach — DECISION NEEDED before implementation
Per Devin's tool-routing rule (>30-min task → surface build-environment choice first): a native React Native app is a larger build than ZeroForge's web self-verify loop handles. Options to confirm:
- **(A) Terminal Claude Code** here — full control, TDD on the reused engine, manual device/EAS verification. *Recommended* for a native RN build with a reusable TS core.
- **(B) ZeroForge greenfield/brownfield** — but its self-verify loop is web/Playwright-oriented; native capture can't be self-verified headlessly (same constraint that drove v1 to web).
- **(C) Hybrid** — Claude Code builds native capture + EAS; keep ZeroForge/web-tooling for the Next.js report portal.

## 13. First implementation steps (post build-env decision)
1. Stand up Expo app; port `posture-engine` (pure TS) verbatim + its vitest suite (must stay green — our regression backbone).
2. VisionCamera V5 + react-native-fast-tflite + MediaPipe Pose Landmarker; index→snake_case landmark adapter (reuse v1's `POSE_LANDMARK_NAMES`).
3. Test-mode landmark-injection seam (reuse v1 fixtures) → engine verified without the ML path.
4. 2-view guided capture UX + Skia overlay.
5. On-device report (expo-print) reusing the v1 report design.
6. Supabase offline-first sync; local-only mode for solo tier.
7. Add single-leg-squat dynamic metric to engine (TDD) + report card.
8. Small internal validation pass (ICC vs goniometer) before store submission.
