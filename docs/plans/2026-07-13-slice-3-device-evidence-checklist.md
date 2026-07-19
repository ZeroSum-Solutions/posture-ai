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
| Worker ready p95 | worker spawn → worker `ready` message, including late-ready workers | < ~2 s |
| First tracked overlay | entering a live view → first landmarks visibly drawn (manual observation) | < ~2 s; investigate if the worker-ready number is fast but drawing is slow |
| Inference p95 | per-frame `detectForVideo` latency, 95th pct over a 30 s session | ideally < ~90 ms; if higher, confirm the gate doesn't flicker (sample-and-hold covers this) |
| Long tasks | Performance panel → Long Tasks during live framing | no sustained main-thread jank; shutter/tiles stay responsive |
| Dropped UI frames | visual smoothness of the video + midline overlay | overlay tracks the subject without stutter |
| Memory / context loss | repeat capture→retake across all four views ×3, watch memory | bounded (no monotonic growth); no WebGL context-loss crash |
| Sustained four-view session | full front + left + right + back capture, retakes, then submit | completes; scores 9 findings; no leak/hang |

## How to collect (development-only telemetry)

1. Run the app in development and open `/assessments/new?captureTelemetry=1` on the test phone. The flag is ignored in production builds.
2. Start camera capture. Open the **Live telemetry · dev only** panel. It records worker-ready time, worker delegate, worker-side inference p95, main-thread round-trip p95, frame results/drops, worker errors/timeouts, long tasks when supported, and JS heap when supported. Results arriving after the UI's one-second timeout remain in the timing distribution and are counted separately as late results, so slow-device p95 is not censored.
3. Complete the four-view session and retake loop. Before selecting **Analyze**, use **Copy telemetry JSON** and save the output with the device/date evidence.
4. The export contains device/timing counters only — no photos, landmarks, client identifiers, or screening results.
5. Safari does not expose Chrome's long-task or JS-heap APIs. An `unsupported` value is honest, not a pass: use Safari's remote Web Inspector for those two checks. WebGL context loss also remains a manual DevTools check because MediaPipe owns the worker's internal GPU context.
6. `sampling.truncated` must be `false`. If it is `true`, the session exceeded the 20,000-sample safety cap and its percentile evidence is incomplete; repeat a shorter evidence run.

The panel removes the old throwaway-code step while keeping instrumentation opt-in and development-only. It does not turn unsupported browser telemetry into a passing result.

## What to watch for specifically (from the GPT-5.6 review)

- **Gate flicker on slow devices** — if inference p95 > 90 ms, confirm the shutter gate does NOT oscillate between full-gating and tilt-only. The `LIVE_FRESHNESS_MS` (600 ms) sample-and-hold + independent watchdog should keep it stable. If it still flickers, raise `LIVE_FRAME_INTERVAL_MS` or `LIVE_FRESHNESS_MS`.
- **Exclusivity churn cost** — every shutter closes the worker + warms the IMAGE landmarker, then the next view re-opens the worker (§11.1). Measure the added latency of that churn per view; if it's painful, that's a design conversation (not a code bug).
- **Viewport-space gate accuracy** — with a real subject, confirm "Line up with the center line" fires when the feet are visibly off the drawn center line, and clears when centered (the gate now runs in viewport space via the same affine the overlay draws with).

## Evidence record per device

Save the copied JSON plus a short note containing: device model/OS/browser version, whether the full four-view flow scored nine findings, whether the gate flickered, whether memory rose monotonically, and whether DevTools showed context loss. Do not attach posture photos.

## Sign-off

- [ ] iPhone Safari — init, p95, long-tasks, memory, four-view session recorded
- [ ] Mid/low Android Chrome — same
- [ ] Gate does not flicker on the slowest device tested
- [ ] No memory growth / context loss across the retake loop
- [ ] Degraded fallback confirmed (kill the worker / airplane-mode the model) → sensor-only guides + tilt-only shutter still capture
