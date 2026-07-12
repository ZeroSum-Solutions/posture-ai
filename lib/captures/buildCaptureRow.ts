import type { PoseFrame } from '@posture-ai/engine'
import { stripFaceLandmarks } from '@/lib/pose/face-min'

/** Row shape inserted into captures by POST /api/assessments. */
export interface CaptureRow {
  assessment_id: string
  practitioner_id: string
  view: string
  source: string
  /** Anatomical side profile nearest the camera; only on a side view, else null. */
  profile_side: 'left' | 'right' | null
  pose_frame: object
}

/**
 * Pure mapper from a validated PoseFrame to its persisted capture row. Strips
 * the unused face-region keypoints (data minimization, BIPA) and never sets a
 * storage_path — no raw image bytes at rest. `profile_side` is meaningful only
 * on a side view; the DB CHECK (captures_profile_side_only_side) enforces the
 * same rule, so front/back stay null.
 */
export function buildCaptureRow(
  f: PoseFrame,
  assessmentId: string,
  practitionerId: string,
  opts: { useFixture: boolean },
): CaptureRow {
  return {
    assessment_id: assessmentId,
    practitioner_id: practitionerId,
    view: f.view,
    source: opts.useFixture ? 'fixture' : (f.source ?? 'upload'),
    profile_side: f.view === 'side' ? (f.profileSide ?? null) : null,
    pose_frame: stripFaceLandmarks(f) as unknown as object,
  }
}
