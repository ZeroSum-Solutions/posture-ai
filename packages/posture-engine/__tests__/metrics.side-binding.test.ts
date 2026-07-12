import { describe, it, expect } from 'vitest'
import { forwardHeadPosture, trunkLean, kneeExtensionBackKnee } from '../src/metrics'
import type { PoseFrame } from '../src/types'

// RIGHT-side landmarks are MORE visible (0.99) than LEFT (0.60). So the legacy
// visibility heuristic picks RIGHT; an explicit profileSide must override it.
const frame: PoseFrame = { view: 'side', landmarks: {
  right_ear: { x: 0.50, y: 0.20, visibility: 0.99 },
  right_shoulder: { x: 0.50, y: 0.40, visibility: 0.99 },
  right_hip: { x: 0.50, y: 0.60, visibility: 0.99 },
  right_knee: { x: 0.50, y: 0.75, visibility: 0.99 },
  right_ankle: { x: 0.50, y: 0.95, visibility: 0.99 },
  right_foot_index: { x: 0.55, y: 0.98, visibility: 0.9 },
  right_heel: { x: 0.48, y: 0.98, visibility: 0.9 },
  left_ear: { x: 0.60, y: 0.20, visibility: 0.60 },
  left_shoulder: { x: 0.60, y: 0.40, visibility: 0.60 },
  left_hip: { x: 0.60, y: 0.60, visibility: 0.60 },
  left_knee: { x: 0.60, y: 0.75, visibility: 0.60 },
  left_ankle: { x: 0.60, y: 0.95, visibility: 0.60 },
  left_foot_index: { x: 0.65, y: 0.98, visibility: 0.6 },
  left_heel: { x: 0.58, y: 0.98, visibility: 0.6 },
} }

describe('sagittal side binding', () => {
  it('forwardHeadPosture: declared left overrides visibility; undefined falls back', () => {
    expect(forwardHeadPosture(frame, 'left').landmarksUsed).toEqual(['left_ear', 'left_shoulder'])
    expect(forwardHeadPosture(frame).landmarksUsed).toEqual(['right_ear', 'right_shoulder'])
  })
  it('trunkLean: declared left overrides visibility; undefined falls back', () => {
    expect(trunkLean(frame, 'left').landmarksUsed).toEqual(['left_shoulder', 'left_hip'])
    expect(trunkLean(frame).landmarksUsed).toEqual(['right_shoulder', 'right_hip'])
  })
  it('kneeExtensionBackKnee: declared left overrides visibility; undefined falls back', () => {
    expect(kneeExtensionBackKnee(frame, 'left').landmarksUsed).toEqual(['left_hip', 'left_knee', 'left_ankle'])
    expect(kneeExtensionBackKnee(frame).landmarksUsed).toEqual(['right_hip', 'right_knee', 'right_ankle'])
  })
})
