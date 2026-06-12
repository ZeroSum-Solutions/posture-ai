import { z } from 'zod'
import type { PoseFrame } from '@posture-ai/engine'

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

const landmarkSchema = z.object({
  x: coord,
  y: coord,
  z: z.number().finite().optional(),
  visibility: z.number().min(0).max(1).optional(),
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
})

const payloadSchema = z.object({
  client_id: z.string().uuid(),
  test_mode: z.boolean().optional(),
  frames: z.array(frameSchema).min(1).max(3).optional(),
})

export interface ParsedAssessmentPayload {
  client_id: string
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

  const { client_id, test_mode, frames } = parsed.data
  const hasFrames = Array.isArray(frames) && frames.length > 0

  if (hasFrames) {
    return { ok: true, data: { client_id, frames: frames as PoseFrame[], useFixture: false } }
  }

  // No frames: only acceptable as fixture scoring, and only when the server
  // explicitly allows test mode. Never silently fall back in production.
  if (test_mode && opts.testModeEnabled) {
    return { ok: true, data: { client_id, frames: null, useFixture: true } }
  }
  if (test_mode && !opts.testModeEnabled) {
    return { ok: false, status: 400, error: 'Test mode is not available' }
  }
  return { ok: false, status: 400, error: 'frames are required' }
}
