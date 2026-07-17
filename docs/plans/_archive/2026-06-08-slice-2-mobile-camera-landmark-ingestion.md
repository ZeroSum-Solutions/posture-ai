# Slice 2 Mobile Camera Landmark Ingestion Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Replace the fixture-only mobile tracer with a real camera capture path that can collect front/side images on a physical phone, while keeping the posture engine input contract deterministic and testable.

**Architecture:** Use `expo-camera` for Slice 2 because it is bundled with Expo SDK 56, works in Expo Go on a physical device, and avoids requiring local Xcode/iOS Simulator or a custom dev build. Add a small `PoseFrameSource` boundary so the UI can run from fixtures today and from camera-derived landmarks in the next slice. Do not install VisionCamera/MediaPipe in this slice; they require native rebuild / WASM integration decisions that should be spiked separately.

**Tech Stack:** Expo SDK 56, React Native 0.85.3, TypeScript, `@posture-ai/engine`, proposed dependency `expo-camera@56.0.7` after approval.

---

## Dependency Decision Gate

Do not run `npm install` until Devin approves this dependency plan.

| Package | Proposed version | Published | Maintainers | Decision |
|---|---:|---|---|---|
| `expo-camera` | `56.0.7` | 2026-05-21 | Expo maintainers: `ide`, `brentvatne`, `evanbacon`, `expoadmin`, `expo-bot`, etc. | **Approve** — SDK 56 bundled version, >14 days old, included in Expo Go. |
| `react-native-vision-camera` | `5.0.10` if later needed | 2026-05-19 | `mrousavy` | **Defer** — strong library, but requires native rebuild/dev build; not usable in Expo Go. |
| `@mediapipe/tasks-vision` | `0.10.35` if later needed | 2026-04-27 | Google maintainers | **Defer/spike** — browser/WASM-first API; React Native integration needs validation. |
| `react-native-mediapipe` | `0.6.0` | 2024-12-12 | single maintainer | **Do not choose by default** — smaller maintainer surface and native integration risk. |

Evidence:
- `mobile/AGENTS.md` requires exact Expo v56 docs before code.
- Expo v56 camera docs say bundled version is `~56.0.7`, supported on Android/iOS device and Web, and included in Expo Go.
- VisionCamera docs require installing native dependencies and rebuilding the native app.
- MediaPipe Web JS docs expose `@mediapipe/tasks-vision` for browser/WASM Pose Landmarker and warn detection calls can synchronously block the UI thread.

**Recommendation:** implement Slice 2 as camera capture + engine-boundary plumbing with `expo-camera@56.0.7`; then run a separate Spike 2b for live pose landmark extraction.

---

## Acceptance Criteria

- Physical phone running Expo Go can open the app and request camera permission.
- App has explicit modes: `fixture`, `front capture`, `side capture`, `assessment`.
- Fixture mode still produces the same assessment result as Slice 1.
- Camera mode captures front and side photos and stores local capture metadata in component state.
- No ML landmark extraction is faked as real; if landmarks are not available, UI labels the state as `captured photos pending landmark extraction`.
- TypeScript passes in `mobile/`.
- Existing root and `packages/posture-engine` tests continue passing.
- No package install or lockfile change happens before approval.

---

## Task 1: Add camera dependency after approval

**Objective:** Add only the Expo SDK 56 camera module, pinned to the vetted version.

**Files:**
- Modify: `mobile/package.json`
- Modify: `mobile/package-lock.json` via `npm install` only after approval

**Step 1: Edit dependency**

Add:

```json
"expo-camera": "56.0.7"
```

inside `mobile/package.json` dependencies.

**Step 2: Install only after approval**

Run:

```bash
cd mobile
npm install
```

Expected: lockfile updates with `expo-camera@56.0.7` and no canary versions.

**Step 3: Verify package resolution**

Run:

```bash
cd mobile
npm ls expo-camera
npm view expo-camera@56.0.7 time maintainers --json
```

Expected: installed version exactly `56.0.7`; publish date `2026-05-21T16:03:26.214Z`.

---

## Task 2: Configure camera permission copy

**Objective:** Add explicit camera permission text without introducing microphone permission unless video/audio is needed.

**Files:**
- Modify: `mobile/app.json`

**Step 1: Add plugin config**

Patch `mobile/app.json`:

```json
{
  "expo": {
    "plugins": [
      [
        "expo-camera",
        {
          "cameraPermission": "Allow Posture AI to access your camera for posture screening photos.",
          "recordAudioAndroid": false,
          "barcodeScannerEnabled": false
        }
      ]
    ]
  }
}
```

Keep existing `ios`, `android`, and `web` config intact.

**Step 2: Verify JSON**

Run:

```bash
python3 -m json.tool mobile/app.json >/tmp/posture-ai-app-json-ok.json
```

Expected: no JSON parse error.

---

## Task 3: Create a pose frame source boundary

**Objective:** Isolate engine input from UI/camera source so fixture data and future ML data share one contract.

**Files:**
- Create: `mobile/src/poseFrameSource.ts`
- Modify: `mobile/src/FixtureAssessmentScreen.tsx`

**Step 1: Create source types**

Create `mobile/src/poseFrameSource.ts`:

```ts
import { testLandmarksFrames } from '@posture-ai/engine'
import type { PoseFrame, ViewLabel } from '@posture-ai/engine'

export type AssessmentInputMode = 'fixture' | 'capture'

export interface CapturedViewImage {
  view: ViewLabel
  uri: string
  width?: number
  height?: number
  capturedAt: string
}

export interface PoseFrameSourceState {
  mode: AssessmentInputMode
  fixtureFrames: PoseFrame[]
  capturedImages: Partial<Record<ViewLabel, CapturedViewImage>>
  liveFrames: PoseFrame[]
}

export function createInitialPoseFrameSourceState(): PoseFrameSourceState {
  return {
    mode: 'fixture',
    fixtureFrames: testLandmarksFrames,
    capturedImages: {},
    liveFrames: [],
  }
}

export function getAssessableFrames(state: PoseFrameSourceState): PoseFrame[] {
  return state.mode === 'fixture' ? state.fixtureFrames : state.liveFrames
}

export function hasRequiredCapturedViews(state: PoseFrameSourceState): boolean {
  return Boolean(state.capturedImages.front?.uri && state.capturedImages.side?.uri)
}
```

**Step 2: Update fixture screen to consume boundary**

Replace direct `testLandmarksFrames` usage in `FixtureAssessmentScreen.tsx` with `createInitialPoseFrameSourceState()` and `getAssessableFrames()`.

**Step 3: Verify no behavior change**

Run:

```bash
cd mobile
npx tsc --noEmit
```

Expected: pass.

---

## Task 4: Add CameraCaptureScreen component

**Objective:** Add a permission-aware camera screen that captures front/side photos on-device.

**Files:**
- Create: `mobile/src/CameraCaptureScreen.tsx`
- Modify: `mobile/App.tsx`

**Step 1: Create screen shell**

Create `mobile/src/CameraCaptureScreen.tsx` with:

- `useCameraPermissions()` from `expo-camera`
- `CameraView` from `expo-camera`
- local state for `activeView: 'front' | 'side'`
- local state for `capturedImages`
- buttons: `Grant Camera Permission`, `Capture Front`, `Capture Side`, `Use Fixture Assessment`
- a status label that says `Captured photos pending landmark extraction` after both captures exist

Do not claim an assessment was generated from camera photos yet.

**Step 2: Use safe capture ref pattern**

Use a `CameraView` ref and `takePictureAsync({ quality: 0.85, skipProcessing: false })` if available in SDK 56 types.

**Step 3: Keep fixture fallback**

In `mobile/App.tsx`, render a simple in-app toggle:

- `FixtureAssessmentScreen` for deterministic Slice 1 assessment
- `CameraCaptureScreen` for Slice 2 capture path

**Step 4: Typecheck**

Run:

```bash
cd mobile
npx tsc --noEmit
```

Expected: pass.

---

## Task 5: Add deterministic tests where available

**Objective:** Test pure state helpers without requiring native camera runtime.

**Files:**
- Create: `mobile/src/poseFrameSource.test.ts` if mobile has a test runner; otherwise add tests under `packages/posture-engine` only if helpers are moved there.

**Step 1: Prefer pure helper tests**

Test:

- initial state starts in `fixture` mode
- fixture mode returns `testLandmarksFrames`
- capture mode returns `liveFrames`
- `hasRequiredCapturedViews` is false until front and side URIs exist

**Step 2: If mobile has no test runner, skip test dependency install**

Do not add Jest/Vitest to mobile just for this slice. The verification gate is TypeScript + Metro bundle.

---

## Task 6: Verify on current machine without Xcode

**Objective:** Keep verification compatible with this Mac’s current constraints.

**Files:**
- None

**Step 1: Typecheck mobile**

```bash
cd mobile
npx tsc --noEmit
```

Expected: pass.

**Step 2: Metro bundle smoke**

```bash
cd mobile
npx expo start --clear
```

In another terminal:

```bash
curl -sS http://127.0.0.1:8081/status
curl -I 'http://127.0.0.1:8081/index.bundle?platform=ios&dev=true&minify=false'
```

Expected:

- status returns `packager-status:running`
- bundle returns `HTTP/1.1 200 OK`

**Step 3: Physical-device visual check**

Open Expo Go on iPhone and scan the QR code from Metro.

Expected:

- permission screen appears
- permission prompt uses the configured camera copy
- camera preview renders on the physical phone
- front and side capture buttons update captured-state labels
- fixture assessment still renders when toggled back

---

## Task 7: Commit Slice 2

**Objective:** Commit only after gates pass.

**Files:**
- `mobile/package.json`
- `mobile/package-lock.json`
- `mobile/app.json`
- `mobile/App.tsx`
- `mobile/src/poseFrameSource.ts`
- `mobile/src/CameraCaptureScreen.tsx`
- optional pure helper test file

**Step 1: Inspect diff**

```bash
git diff --stat
git diff -- mobile package.json package-lock.json
```

**Step 2: Commit**

```bash
git add mobile/package.json mobile/package-lock.json mobile/app.json mobile/App.tsx mobile/src/poseFrameSource.ts mobile/src/CameraCaptureScreen.tsx
git commit -m "feat(mobile): add camera capture path"
```

---

## Explicit Non-Goals

- Do not install Xcode or Simulator.
- Do not add VisionCamera in this slice.
- Do not add MediaPipe in this slice.
- Do not generate medical-sounding claims from camera photos.
- Do not fake landmarks from images.
- Do not add new test-runner dependencies to `mobile/` unless separately approved.

## Next Slice After This

Run a disposable spike comparing two landmark extraction paths:

1. `@mediapipe/tasks-vision@0.10.35` with Expo web / browser worker using captured image URIs.
2. Native RN path: VisionCamera frame processors or a maintained native pose package, requiring dev build.

**Recommendation:** ship camera capture first because it can be validated today in Expo Go on a physical phone; then choose the ML path with evidence instead of guessing.
