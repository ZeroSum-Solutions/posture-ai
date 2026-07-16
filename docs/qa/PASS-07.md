# QA Loop — Iteration 7 (PASS-07) — IMMERSIVE FLOWS + COACH VOICE

**Date:** 2026-07-16

**Scope:** Workout and capture immersion, persistent escape, and deployable coach voice
on `codex/ui-optimization-loop`.

**Verdict:** **CLEAN (automated)** — the global application chrome no longer overlaps
dedicated capture/workout surfaces, the workout Exit remains visually present and
keyboard reachable throughout playback, and production cues use a complete static
Voicebox River pack. Physical speaker quality, wake lock, and camera ergonomics remain
honestly assigned to `CAM-REAL`.

## Implemented

- Added an explicit immersive-surface contract. While a workout player or fullscreen
  capture is mounted, the shell navigation/footer are removed and the route owns the
  full viewport; normal wizard and application pages retain the global shell.
- Replaced the auto-hiding workout close glyph with a labelled 44 px `× Exit` control
  that is independent from progress, transport, caption, and mute auto-hide behavior.
- Kept hidden secondary playback chrome out of the accessibility/tab order while the
  persistent Exit remains visible and first in keyboard traversal.
- Installed the local Voicebox Kokoro `af_river` preset as `Posture AI Coach - River`.
- Generated and committed 362 deterministic, screening-safe MP3 cues covering every
  playable exercise, all three weekly dosage progressions, later-set avoid cues, rest,
  preroll, and session completion. Web Speech remains a failure-only fallback.
- Added resumable `voice:build` and offline `voice:verify` commands; production does not
  depend on localhost, a paid TTS API, or a live Voicebox process.

## Fail-first and regression evidence

- Workout playback test failed first because Exit became `aria-hidden`, `tabindex=-1`,
  and visually hidden after 3.2 seconds. It now verifies persistent visibility, opacity,
  tab order, 44 px geometry, keyboard reveal for secondary controls, and a zero
  serious/critical Axe budget at 390 × 844.
- Immersive-shell test failed first because inline navigation display won over the shell
  policy. The final rule explicitly removes navigation/footer only while the immersive
  marker is mounted.
- Voice delivery test failed first because no static cue request existed. It now observes
  a successful 200/206 media response from `/audio/workout-coach-river/`.
- Capture permission-denied flow verifies the global navigation is absent and the local
  capture cancel control remains visible.

## Verification evidence

- `npm run voice:verify`: PASS, exactly 362 expected files.
- Full Vitest suite: PASS, 92 files / 727 tests (focused workout subset 34/34).
- `npm run typecheck`: PASS.
- `npm run lint`: PASS with 0 errors and 22 pre-existing warnings.
- `npm run build`: PASS, Next.js 16.2.6 optimized production build.
- Desktop Chromium workout suite: PASS, 5/5 including mobile viewport and Axe.
- Desktop Chromium capture permission-denied flow: PASS, 2/2 including auth setup.
- Live Codex-browser inspection at 1280 × 720: shell chrome absent, labelled Exit visible
  before playback and after secondary chrome auto-hide.
- Visual evidence:
  `/Users/zero-suminc./Inbox/screenshots/posture-ai-pass-07/workout-persistent-exit.png`.

## Remaining honest blockers

- `CAM-REAL`: physical iPhone Safari and Android Chrome camera/player pass.
- Subjective River voice quality through real phone speakers, mute/resume ergonomics,
  wake-lock behavior, video-overlay contrast, and one-thumb reach.
