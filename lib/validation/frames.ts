import { z } from 'zod'
import type { PoseFrame } from '@posture-ai/engine'
import {
  POSE_MODEL_SHA256,
  POSE_RUNTIME_VERSION,
} from '@/lib/pose/pose-model'

// Boundary validation for POST /api/assessments. The client is never trusted:
// frames must be well-formed BlazePose output, and fixture scoring (test mode)
// is only reachable when the server itself runs with POSTURE_TEST_MODE_ENABLED.

/** Reject request bodies larger than this before parsing (route-level check). */
export const MAX_PAYLOAD_BYTES = 512 * 1024

// BlazePose 33-landmark names — must match lib/pose/detect.ts ordering/naming.
const LANDMARK_NAMES = [
  'nose', 'left_eye_inner', 'left_eye', 'left_eye_outer',
  'right_eye_inner', 'right_eye', 'right_eye_outer',
  'left_ear', 'right_ear', 'mouth_left', 'mouth_right',
  'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
  'left_wrist', 'right_wrist', 'left_pinky', 'right_pinky',
  'left_index', 'right_index', 'left_thumb', 'right_thumb',
  'left_hip', 'right_hip', 'left_knee', 'right_knee',
  'left_ankle', 'right_ankle', 'left_heel', 'right_heel',
  'left_foot_index', 'right_foot_index',
] as const

const landmarkNameSet = new Set<string>(LANDMARK_NAMES)

// Normalized image coords are nominally [0,1]; MediaPipe emits slight
// overshoot for off-frame joints, so allow a bounded margin.
const coord = z.number().finite().min(-0.5).max(1.5)

// `.strict()` everywhere below is a defense-in-depth guarantee: the API rejects
// any unexpected field — including a smuggled image / dataURL / base64 / blob —
// rather than silently stripping it. Only landmark coordinates may be persisted.
const landmarkSchema = z.object({
  x: coord,
  y: coord,
  z: z.number().finite().optional(),
  visibility: z.number().min(0).max(1).optional(),
}).strict()

const pixelDimension = z.number().int().min(1).max(100_000)
export const poseFrameMetaSchema = z.object({
  version: z.literal('pose-frame-meta-v1'),
  coordinateSpace: z.literal('decoded_image_normalized'),
  sourceWidthPx: pixelDimension.nullable(),
  sourceHeightPx: pixelDimension.nullable(),
  analysisWidthPx: pixelDimension,
  analysisHeightPx: pixelDimension,
  orientationNormalization: z.enum([
    'camera_video_frame',
    'exif_from_image_canvas_v1',
    'browser_decoder',
  ]),
  // The browser may consume EXIF during decode; never accept an inferred angle.
  exifOrientationDegrees: z.null(),
  // V1 has no reflected analysis/display path. Do not accept an unused flag
  // that could imply coordinates were canonicalized when they were not.
  analysisMirrored: z.literal(false),
  displayMirrored: z.literal(false),
  viewAssignment: z.literal('operator_asserted_not_verified'),
  requestedCameraFacingMode: z.literal('environment').nullable(),
  observedCameraFacingMode: z.string().min(1).max(64).nullable(),
  poseModel: z.object({
    runtime: z.literal('@mediapipe/tasks-vision'),
    runtimeVersion: z.string().min(1).max(32),
    variant: z.enum(['lite', 'full']),
    assetPath: z.enum([
      '/mediapipe/models/pose_landmarker_lite.task',
      '/mediapipe/models/pose_landmarker_full.task',
    ]),
    assetSha256: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict(),
}).strict().superRefine((meta, ctx) => {
  const hasSourceWidth = meta.sourceWidthPx !== null
  const hasSourceHeight = meta.sourceHeightPx !== null
  if (hasSourceWidth !== hasSourceHeight) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['sourceWidthPx'],
      message: 'source dimensions must both be present or both be null',
    })
  }
  const expectedAsset = meta.poseModel.variant === 'lite'
    ? '/mediapipe/models/pose_landmarker_lite.task'
    : '/mediapipe/models/pose_landmarker_full.task'
  if (meta.poseModel.assetPath !== expectedAsset) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['poseModel', 'assetPath'],
      message: 'pose model variant and asset path disagree',
    })
  }
  if (meta.poseModel.runtimeVersion !== POSE_RUNTIME_VERSION) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['poseModel', 'runtimeVersion'],
      message: 'pose runtime version is not supported',
    })
  }
  if (meta.poseModel.assetSha256 !== POSE_MODEL_SHA256[meta.poseModel.variant]) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['poseModel', 'assetSha256'],
      message: 'pose model hash does not match the bundled variant',
    })
  }
  const isCamera = meta.orientationNormalization === 'camera_video_frame'
  if (isCamera && meta.requestedCameraFacingMode !== 'environment') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['requestedCameraFacingMode'],
      message: 'camera frames must record the requested facing mode',
    })
  }
  if (!isCamera && (meta.requestedCameraFacingMode !== null || meta.observedCameraFacingMode !== null)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['observedCameraFacingMode'],
      message: 'decoded uploads cannot claim camera facing metadata',
    })
  }
})

const frameSchema = z.object({
  view: z.enum(['front', 'side', 'back']),
  landmarks: z
    .record(z.string(), landmarkSchema)
    .superRefine((landmarks, ctx) => {
      for (const name of Object.keys(landmarks)) {
        if (!landmarkNameSet.has(name)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Unknown landmark "${name}"` })
        }
      }
    }),
  // Capture metadata (all optional — historical payloads predate these).
  captureRollDeg: z.number().finite().min(-45).max(45).optional(),
  aspectRatio: z.number().finite().min(0.1).max(10).optional(),
  source: z.enum(['camera', 'upload']).optional(),
  // Anatomical side profile nearest the camera; valid only on a side view.
  profileSide: z.enum(['left', 'right']).optional(),
  poseMeta: poseFrameMetaSchema.optional(),
}).strict().superRefine((frame, ctx) => {
  if (frame.profileSide && frame.view !== 'side') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['profileSide'], message: 'profileSide is only valid on a side view' })
  }
  if (frame.poseMeta) {
    if (!frame.source) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['source'],
        message: 'versioned pose provenance requires an explicit frame source',
      })
    } else {
      const cameraProtocol = frame.poseMeta.orientationNormalization === 'camera_video_frame'
      if ((frame.source === 'camera') !== cameraProtocol) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['poseMeta', 'orientationNormalization'],
          message: 'frame source and orientation normalization disagree',
        })
      }
    }
  }
})

// A capture burst is 1–5 frames of the SAME (view, profileSide) group (engine
// 1.3.0 takes the per-landmark median + within-capture stability). 4 groups
// (front / side-left / side-right / back) × 5 caps the array; the per-group
// bound below stops a client sending 20 fronts.
const MAX_BURST_PER_VIEW = 5

export type RequiredCaptureGroup = 'front' | 'side-left' | 'side-right' | 'back'

export const REQUIRED_CAPTURE_GROUPS: readonly RequiredCaptureGroup[] = [
  'front', 'side-left', 'side-right', 'back',
]

const BILATERAL_STRUCTURAL_LANDMARKS = [
  'left_shoulder', 'right_shoulder',
  'left_hip', 'right_hip',
  'left_knee', 'right_knee',
  'left_ankle', 'right_ankle',
] as const

export const STRUCTURAL_LANDMARKS_BY_GROUP: Record<RequiredCaptureGroup, readonly string[]> = {
  front: BILATERAL_STRUCTURAL_LANDMARKS,
  back: BILATERAL_STRUCTURAL_LANDMARKS,
  'side-left': [
    'left_ear', 'left_shoulder', 'left_hip', 'left_knee', 'left_ankle',
    'left_heel', 'left_foot_index',
  ],
  'side-right': [
    'right_ear', 'right_shoulder', 'right_hip', 'right_knee', 'right_ankle',
    'right_heel', 'right_foot_index',
  ],
}

function captureGroup(frame: { view: 'front' | 'side' | 'back'; profileSide?: 'left' | 'right' }): RequiredCaptureGroup | null {
  if (frame.view === 'front' || frame.view === 'back') return frame.view
  return frame.profileSide ? `side-${frame.profileSide}` : null
}

const payloadSchema = z.object({
  client_id: z.string().uuid(),
  submission_id: z.string().uuid(),
  test_mode: z.boolean().optional(),
  frames: z
    .array(frameSchema)
    .min(1)
    .max(4 * MAX_BURST_PER_VIEW)
    .superRefine((frames, ctx) => {
      const perGroup: Record<string, number> = {}
      const presentGroups = new Set<RequiredCaptureGroup>()
      let sideUnspecified = false
      let sideNamed = false
      for (const [index, f] of frames.entries()) {
        const key = `${f.view}:${f.profileSide ?? ''}`
        perGroup[key] = (perGroup[key] ?? 0) + 1
        if (f.view === 'side') { if (f.profileSide) sideNamed = true; else sideUnspecified = true }

        const group = captureGroup(f)
        if (!group) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, 'profileSide'],
            message: 'Every side frame must identify profileSide as left or right',
          })
          continue
        }
        presentGroups.add(group)
        const missing = STRUCTURAL_LANDMARKS_BY_GROUP[group].filter(name => !f.landmarks[name])
        if (missing.length > 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, 'landmarks'],
            message: `${group} frame is missing structural landmarks: ${missing.join(', ')}`,
          })
        }
      }
      for (const [key, n] of Object.entries(perGroup)) {
        if (n > MAX_BURST_PER_VIEW) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Too many ${key} frames — a capture burst is at most ${MAX_BURST_PER_VIEW} per view/side`,
          })
        }
      }
      // The engine can't group a mix of unspecified-side and named-side captures.
      if (sideUnspecified && sideNamed) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Cannot mix unspecified-side and named-side (left/right) side frames',
        })
      }
      for (const required of REQUIRED_CAPTURE_GROUPS) {
        if (!presentGroups.has(required)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Missing required capture group: ${required}`,
          })
        }
      }
    })
    .optional(),
}).strict()

export interface ParsedAssessmentPayload {
  client_id: string
  submission_id: string
  frames: PoseFrame[] | null
  /** True only when the server-side test flag allows fixture scoring. */
  useFixture: boolean
}

export type ParseResult =
  | { ok: true; data: ParsedAssessmentPayload }
  | { ok: false; status: 400 | 422; error: string }

export function parseAssessmentPayload(
  body: unknown,
  opts: { testModeEnabled: boolean }
): ParseResult {
  const parsed = payloadSchema.safeParse(body)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return {
      ok: false,
      status: 422,
      error: `Invalid payload: ${issue?.path?.join('.') || 'body'} — ${issue?.message || 'malformed'}`,
    }
  }

  const { client_id, submission_id, test_mode, frames } = parsed.data
  const hasFrames = Array.isArray(frames) && frames.length > 0

  if (hasFrames) {
    return { ok: true, data: { client_id, submission_id, frames: frames as PoseFrame[], useFixture: false } }
  }

  // No frames: only acceptable as fixture scoring, and only when the server
  // explicitly allows test mode. Never silently fall back in production.
  if (test_mode && opts.testModeEnabled) {
    return { ok: true, data: { client_id, submission_id, frames: null, useFixture: true } }
  }
  if (test_mode && !opts.testModeEnabled) {
    return { ok: false, status: 400, error: 'Test mode is not available' }
  }
  return { ok: false, status: 400, error: 'frames are required' }
}
