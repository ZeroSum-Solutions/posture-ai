# P0 Device Spike — Findings (2026-06-12)

Automated validation of the riskiest assumption: "MediaPipe WASM + getUserMedia works
acceptably in phone browsers." Harness: `scripts/spike/detect-spike.mjs` (results in
`scripts/spike/spike-results.json`). Real-device verification checklist for the parts
only a physical phone can answer is at the bottom.

## Deployment (P0a/P0b — done)

- **Production URL:** https://posture-ai-ivory.vercel.app (`/api/health` → `{status: ok, database: connected, schema: ready}`)
- **Supabase:** project `posture-ai` (`dhrkezfypzutiwtmcmof`, us-west-1) in the **Zerosumsolutions-Projects Pro org** (`zljkaiwwkbpeyjsblwyb`), per Devin's direction. Both migrations applied; 9 tables, RLS on, 10 imbalance definitions + 10 exercises seeded. DB password in ZS Vault (`posture_ai_supabase_db_password`). A briefly-created free-org copy was deleted; `scriptcompass` (paused to free the slot during the mixup) was restored.
- **Vercel:** project `posture-ai` linked to GitHub `wiggdevin/posture-ai` — push-to-main deploys production, PRs get preview URLs. Env vars set for production/preview/development.

## Spike setup

- tasks-vision **0.10.35**, WASM + `.task` models served **first-party** from a local
  server (rehearses the P2 self-host layout: WASM from `node_modules/.../wasm`, models
  from `public/mediapipe/models/`). No CDN involved — proves self-hosting works.
- Browsers: Chromium (iPhone 14 emulation), Chromium desktop, WebKit (iPhone 14 UA/viewport).
  WebKit ≈ closest automatable proxy for iOS Safari (same engine family, not the same GPU stack).
- Photos: three interim stock fixtures in `e2e/fixtures/photos/` (natural standing
  front / side profile / back — see its README for sources and the replacement plan).

## Results (18/18 runs detected a full 33-landmark pose)

| | Chromium (mobile & desktop) | WebKit |
|---|---|---|
| Delegate | GPU (no CPU fallback needed) | GPU |
| Fileset resolve | ~1 ms | ~1 ms |
| Model load (full / lite) | 40–110 ms | 125–160 ms |
| **Cold first detect** | **~4.9–5.2 s** (shader compile) | ~0.25 s |
| Warm detect (full / lite) | 125–135 / 105–115 ms | 16–19 / 14–17 ms |

Model assets: full = 9.4 MB, lite = 5.8 MB (one-time download, cacheable long-term once self-hosted).

## Lite vs full (the model-choice decision)

Across all 3 views × 3 browsers:

- Mean landmark coordinate delta ≤ **0.0103** normalized (~1% of image dimension); max ≤ 0.02 on front/side, ≤ 0.07 on back (single outlier landmark; all back-view reliability gates still pass for both models).
- Engine reliability gates (`RELIABILITY_FLOOR = 0.5` on min landmark visibility):
  **lite passes every gate that full passes**. The single failing gate (side-view
  "knees", min-vis 0.28 full / 0.39 lite) fails for BOTH models and is inherent to
  sagittal views — the far leg is occluded. The engine already handles this by
  selecting the higher-visibility side per metric, so it does not regress scoring.
  Notably lite's visibility estimates were *higher* than full's on occluded landmarks.

**Decision: default mobile to `pose_landmarker_lite`** (40% smaller download, ~20%
faster warm inference, no measured accuracy cost at the engine's gates). Implement in
P2 behind an env flag (`NEXT_PUBLIC_POSE_MODEL=lite|full`, default lite) so it stays
reversible. Re-confirm with the real-device photo set when it lands.

## Implications for P2 (parameterization)

1. **Warm the landmarker on capture-step mount.** Chromium's ~5 s cold-start is shader
   compilation, not download; doing it during framing hides it entirely. Keep the
   per-photo preflight budget < 5 s even cold.
2. Self-hosting works under plain static serving with correct MIME (`application/wasm`).
   Long-cache headers in `next.config.ts` per roadmap.
3. Side-view far-side landmarks WILL be low-visibility — preflight messaging should not
   demand both legs visible in profile shots; the engine's per-side selection covers it.
4. The hat in `side_standing.jpg` did not break ear detection (FHP gate passed at 0.996) —
   mild headwear occlusion is tolerable; keep "face the side wall, hair tucked, no hat"
   in capture guidance anyway.

## What automation cannot answer — real-device checklist (Devin)

Run on **real iPhone Safari (iOS ≥17)** and **one Android Chrome** against
https://posture-ai-ivory.vercel.app (HTTPS, so getUserMedia is available):

1. Sign up / sign in, create a test client.
2. New assessment → grant camera permission → camera opens with rear camera.
3. Photograph a person (or yourself via a propped phone): natural standing,
   **front facing camera / true side profile / facing away**, full body head-to-feet.
4. Wizard completes → results page renders 10 findings + grade → PDF downloads.
5. Note: total time from "Analyze" tap to results; any tab crash/reload (the iOS
   Safari failure mode); whether the camera preview froze at any point.
6. **Save the three photos** — they become the canonical test fixtures replacing the
   stock interim set in `e2e/fixtures/photos/` (same filenames).

Anything that fails here parameterizes P2 hardening; nothing else in P1 is blocked on it.
