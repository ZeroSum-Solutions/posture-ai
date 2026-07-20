import { describe, expect, it } from 'vitest'
import type { PoseFrame } from '@posture-ai/engine'
import {
  assessmentSubmissionDigest,
  canonicalAssessmentSubmission,
  type AssessmentSubmissionDigestInput,
} from './submission'

const CLIENT_ID = '2f5d3f6a-4b1c-4f6e-9b3a-1c2d3e4f5a6b'

function input(frames: PoseFrame[] | null): AssessmentSubmissionDigestInput {
  return { client_id: CLIENT_ID, frames, useFixture: frames === null }
}

describe('assessment submission canonical digest', () => {
  it('is stable across frame order and object-key order', () => {
    const front = {
      view: 'front' as const,
      source: 'camera' as const,
      landmarks: { left_shoulder: { y: 0.2, x: 0.4, visibility: 0.9 } },
    }
    const back = {
      landmarks: { right_shoulder: { visibility: 0.8, x: 0.6, y: 0.21 } },
      source: 'camera' as const,
      view: 'back' as const,
    }

    const a = input([front, back])
    const b = input([back, front])
    expect(canonicalAssessmentSubmission(a)).toBe(canonicalAssessmentSubmission(b))
    expect(assessmentSubmissionDigest(a)).toBe(assessmentSubmissionDigest(b))
  })

  it('changes when scoring content changes', () => {
    const original = input([{ view: 'front', landmarks: { left_shoulder: { x: 0.4, y: 0.2 } } }])
    const changed = input([{ view: 'front', landmarks: { left_shoulder: { x: 0.41, y: 0.2 } } }])
    expect(assessmentSubmissionDigest(original)).not.toBe(assessmentSubmissionDigest(changed))
  })

  it('distinguishes fixture scoring from a real-frame submission', () => {
    const fixture = input(null)
    const frames = input([])
    expect(assessmentSubmissionDigest(fixture)).not.toBe(assessmentSubmissionDigest(frames))
  })
})
