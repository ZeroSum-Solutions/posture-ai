# Slice 3 — Real-Device Evidence Checklist

> **Status:** Slice 3 code is landed/ready, fully unit + e2e (degraded path) + golden verified and GPT-5.6-xhigh reviewed. This is the ONE remaining gate item from the plan that cannot be produced in CI/headless: **real-device evidence for the live VIDEO worker**. It needs physical hardware (Devin's).

The Slice 3 gate (`docs/plans/2026-07-12-capture-guides-autoalign-flow-plan.md:468`) requires, before the live-tracking feature is trusted in production:

> real-device evidence (iPhone Safari + mid/low Android Chrome: init time, inference p95, long-task count, dropped frames, memory/context-loss, sustained four-view session)

## Why headless can't cover it

- `e2e/capture-camera.spec.ts` deliberately sets `createImageBitmap = undefined` (see `DISABLE_LIVE_TRACKING`) so the live worker never runs — headless Chromium on a fake canvas stream can't faithfully exercise MediaPipe VIDEO-in-worker timing, GPU context loss, or sustained memory. The e2e proves the **degraded** path (sensor-only guides + tilt-only shutter) and the full camera→score path; it does **not** exercise findings around the worker, live gating, generation churn, or four-view memory.
- The feature **degrades gracefully**: if the worker fails to spawn/init on any device, capture still fully works (sensor-only guides, tilt-only shutter) — this is the current shipped behavior. So landing the code is low-risk; the device evidence validates the *new* live-tracking value, not baseline capture.

## Devices to test

1. **iPhone (Safari)** — a recent iPhone; Safari is the strictest WebWorker + WASM environment.
2. **Mid/low Android (Chrome)** — a budget/mid Android (not a flagship), to catch the slow-inference path (finding #3 territory: inference > 90 ms sampling interval).

## Metrics + suggested acceptance

| Metric | How to read it | Rough target |
|---|---|---|
| Worker init time | time from entering a live view → first landmarks drawn | < ~2 s (masked by the shutter→review transition) |
| Inference p95 | per-frame `detectForVideo` latency, 95th pct over a 30 s session | ideally < ~90 ms; if higher, confirm the gate doesn't flicker (sample-and-hold covers this) |
| Long tasks | Performance panel → Long Tasks during live framing | no sustained main-thread jank; shutter/tiles stay responsive |
| Dropped UI frames | visual smoothness of the video + midline overlay | overlay tracks the subject without stutter |
| Memory / context loss | repeat capture→retake across all four views ×3, watch memory | bounded (no monotonic growth); no WebGL context-loss crash |
| Sustained four-view session | full front + left + right + back capture, retakes, then submit | completes; scores 9 findings; no leak/hang |

## How to collect (no instrumentation shipped by default)

The worker path has no perf logging in the committed code (kept clean). To measure, temporarily add timing in a throwaway branch:

- **Init time:** `console.time('worker-init')` around `startLiveBackend()` in `lib/pose/live-backend.ts`; log on the `ready` message.
- **Inference p95:** in `lib/pose/live-worker.ts` `handleFrame`, wrap `detectForVideo` with `performance.now()` deltas, push to an array, and `postMessage` a p95 every N frames (or just log deltas and eyeball in the console).
- **Long tasks:** DevTools Performance record during a live session (remote-debug Safari via Mac; Android via `chrome://inspect`).
- **Memory:** DevTools Memory timeline across the retake loop.

## What to watch for specifically (from the GPT-5.6 review)

- **Gate flicker on slow devices** — if inference p95 > 90 ms, confirm the shutter gate does NOT oscillate between full-gating and tilt-only. The `LIVE_FRESHNESS_MS` (600 ms) sample-and-hold + independent watchdog should keep it stable. If it still flickers, raise `LIVE_FRAME_INTERVAL_MS` or `LIVE_FRESHNESS_MS`.
- **Exclusivity churn cost** — every shutter closes the worker + warms the IMAGE landmarker, then the next view re-opens the worker (§11.1). Measure the added latency of that churn per view; if it's painful, that's a design conversation (not a code bug).
- **Viewport-space gate accuracy** — with a real subject, confirm "Line up with the center line" fires when the feet are visibly off the drawn center line, and clears when centered (the gate now runs in viewport space via the same affine the overlay draws with).

## Sign-off

- [ ] iPhone Safari — init, p95, long-tasks, memory, four-view session recorded
- [ ] Mid/low Android Chrome — same
- [ ] Gate does not flicker on the slowest device tested
- [ ] No memory growth / context loss across the retake loop
- [ ] Degraded fallback confirmed (kill the worker / airplane-mode the model) → sensor-only guides + tilt-only shutter still capture
