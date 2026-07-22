# Physical Device and Accessibility Evidence Checklist

**Contract:** `docs/qa/device-release-contract.json` (`posture-ai-device-release-v1`)

**Validator:** `scripts/check-device-evidence.mjs`
**Status:** collection template only — completing this document does not itself authorize HG-04

This is the canonical checklist for physical iPhone Safari and Android Chrome release evidence. It supersedes `docs/plans/2026-07-13-slice-3-device-evidence-checklist.md` and the device section in `docs/plans/2026-06-12-p0-device-spike-findings.md`. Those files remain historical design evidence.

Playwright's mobile projects are useful device-independent proxies. They cannot satisfy any physical-device row below. HG-04 stays frozen until the task-specific validator passes a physical packet, a different approved reviewer signs the required raw-artifact sample, and a human explicitly completes the gate.

## Before collection

- [ ] Check out the exact candidate commit and record its 40-character SHA.
- [ ] Record the exact production-readiness configuration hash.
- [ ] Use a dedicated non-production practitioner/client and a consented test subject or synthetic target.
- [ ] Create a protected evidence root outside Git. Never commit photos, video, landmarks, names, email addresses, client IDs, or other subject identifiers.
- [ ] Generate a fresh collection challenge nonce for each run.
- [ ] Record the operator identity. The independent reviewer must be a different person.
- [ ] Confirm the selected devices meet the versioned contract: physical iPhone with iOS 17+ and its supplied Safari; physical mid/low Android with Android 11+, 4–6 GB RAM, and Chrome major 150+.
- [ ] Record model, OS version, browser version/build, physical-device assertion, and the Android RAM/tier fields required by the contract.

## Required runs

Complete two distinct runs for each device class, four runs total. Each class needs one cold-cache and one warm-cache run. Run IDs, challenge nonces, time intervals, and evidence hashes must not be reused.

| Device class | Cold cache | Warm cache |
|---|---:|---:|
| `iphone_safari` | [ ] | [ ] |
| `android_chrome` | [ ] | [ ] |

For every run, capture ordered evidence for every core journey step:

- [ ] `practitioner_sign_in` — invitation-only practitioner reaches an AAL2 session.
- [ ] `valid_consent` — selected client has the required current consent before capture.
- [ ] `four_view_capture` — capture `front`, `left`, `right`, and `back`.
- [ ] `retake` — replace at least one named view and show the replacement retained.
- [ ] `score_completion` — scoring completes without a hang or context-loss crash.
- [ ] `assessment_results` — assessment-only results and markings are usable.
- [ ] `pdf_open_or_download` — PDF request succeeds and the file opens or downloads.

## Per-class recovery and accessibility matrix

Perform every row on both device classes. Core and required rows cannot be marked not applicable.

- [ ] `portrait_landscape` — rotate both ways; controls remain usable and capture state survives.
- [ ] `camera_permission_recovery` — deny permission, observe a visible recovery path, then regrant without reloading.
- [ ] `no_person_block` — no-person input cannot be accepted as a photo.
- [ ] `multiple_person_block` — multiple-person input cannot be accepted as a photo.
- [ ] `model_load_recovery` — exercise cold and warm loads plus delegate/worker recovery.
- [ ] `background_foreground_recovery` — backgrounding cleans resources; foregrounding restarts without losing the selected view.
- [ ] `sustained_session` — run at least 300 seconds through four views and retakes with zero leaks, hangs, or context-loss crashes.
- [ ] `keyboard_traversal` — on every keyboard-capable surface, focus order is visible and all actions work without touch.
- [ ] `screen_reader` — record spoken labels and order with VoiceOver on iPhone and TalkBack on Android.
- [ ] `reduced_motion` — reduced-motion mode remains understandable and usable.
- [ ] `wake_lock` — record acquire, loss, reacquire, and cleanup when supported. `not_applicable` requires an objective unsupported-capability probe.
- [ ] `workout_audio` — exercise primary audio, mute, fallback, and interruption only when workouts are enabled. For the selected assessment-only release, `not_applicable` must bind the exact flags-off configuration and configuration hash.

## Live-worker telemetry retained from Slice 3

These measurements support the `model_load_recovery` and `sustained_session` reviews. They are development telemetry, not substitutes for the user-visible physical journey.

- [ ] **Worker ready p95** — target under roughly 2 seconds; include late-ready workers.
- [ ] **Inference p95** — record worker-side `detectForVideo` latency; investigate above roughly 90 ms and confirm the shutter gate does not flicker.
- [ ] **Long tasks** — no sustained main-thread jank; record `unsupported` on Safari and use remote Web Inspector rather than calling it a pass.
- [ ] **Dropped UI frames** — video and overlay remain responsive; record result/drop counters and a short manual observation.
- [ ] **Memory / context loss** — four-view capture and retake loop does not show monotonic growth or a WebGL context-loss crash.
- [ ] Record first-overlay time, delegate, round-trip p95, late results, worker errors/timeouts, and whether telemetry sampling was truncated.

When collecting development telemetry, use `/assessments/new?captureTelemetry=1`; the flag is ignored in production. Copy the privacy-safe telemetry JSON before Analyze. It must contain no photos, landmarks, client identifiers, or screening results. Production-build testing remains authoritative for the release journey; development telemetry only supplements rows that need instrumentation.

## Artifact and packet rules

- [ ] Store raw screenshots/video/notes only beneath the declared protected evidence root.
- [ ] Use relative paths. Reject traversal, absolute paths, symlinks, missing files, and zero-byte files.
- [ ] For every artifact record media type, byte length, capture time, source run/row, relative path, and SHA-256 computed from raw bytes.
- [ ] Do not reuse evidence hashes where the contract requires unique run evidence.
- [ ] Bind the packet to the exact commit, configuration hash, contract hash, device identity, operator, and collection times.
- [ ] Prove optional exclusions with the exact capability probe or release-configuration receipt allowed by the contract.

Validate from the repository root:

```bash
npm run device:evidence:check -- \
  --contract docs/qa/device-release-contract.json \
  --receipt /protected/proof-root/device-receipt.json \
  --evidence-root /protected/raw-device-evidence \
  --release-configuration-receipt /protected/proof-root/release-configuration.json \
  --expected-commit <40-character-release-sha> \
  --expected-configuration-hash <sha256>
```

The release-configuration receipt is mandatory in physical mode and has exactly this shape: `{ "commit": "<40-character-release-sha>", "configuration_hash": "<sha256>", "hg04_approved_reviewer_public_key_fingerprints": ["<production-ed25519-public-key-sha256>"] }`. Its commit and configuration hash must equal the packet, and its nonempty fingerprint set is the sole production reviewer-key authority. The canonical contract contains no production key and fixture keys never satisfy this input.

Require `packet_structurally_valid:true` and `physical_packet_valid:true`. The validator intentionally reports `hg04_launch_eligible:false` even for a valid physical packet.

## Independent review and HG-04 handoff

- [ ] A reviewer other than the operator opens the protected raw evidence.
- [ ] The reviewer samples all four core run recordings, both device-identity artifacts, every exclusion, and the contract-selected remaining matrix rows.
- [ ] The review receipt records every sampled artifact SHA-256 and binds the packet, contract, commit, and configuration hash.
- [ ] Sign the canonical review receipt with Ed25519 using an approved production reviewer key. Repository fixture/test keys are never launch eligible.
- [ ] Store only sanitized validation/review receipts and hashes in the proof root; keep raw media external.
- [ ] A human gate owner reviews both receipts and explicitly transitions HG-04. No script performs that transition.

## Repository fixture check

The committed dummy fixture proves validator mechanics only:

```bash
npm run device:evidence:check -- \
  --contract docs/qa/device-release-contract.json \
  --receipt scripts/fixtures/device-evidence/complete/receipt.json \
  --evidence-root scripts/fixtures/device-evidence/complete/artifacts \
  --fixture
```

Its expected result is structural PASS, physical false, launch false.
