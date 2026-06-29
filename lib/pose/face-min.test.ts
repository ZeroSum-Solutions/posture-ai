import { describe, it, expect } from 'vitest'
import { stripFaceLandmarks, FACE_MINIMIZE_LANDMARKS } from './face-min'
import type { PoseFrame } from '@posture-ai/engine'

const lm = () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 })

describe('stripFaceLandmarks', () => {
  it('removes the unused eye/mouth keypoints but keeps nose, ears, and body', () => {
    const frame: PoseFrame = {
      view: 'front',
      landmarks: {
        nose: lm(), left_eye: lm(), right_eye: lm(), left_eye_inner: lm(),
        right_eye_outer: lm(), mouth_left: lm(), mouth_right: lm(),
        left_ear: lm(), right_ear: lm(), left_shoulder: lm(), right_hip: lm(),
      },
    }
    const out = stripFaceLandmarks(frame)
    for (const name of FACE_MINIMIZE_LANDMARKS) {
      expect(out.landmarks[name]).toBeUndefined()
    }
    expect(out.landmarks.nose).toBeDefined()
    expect(out.landmarks.left_ear).toBeDefined()
    expect(out.landmarks.right_ear).toBeDefined()
    expect(out.landmarks.left_shoulder).toBeDefined()
    expect(out.landmarks.right_hip).toBeDefined()
  })

  it('does not mutate the input frame', () => {
    const frame: PoseFrame = { view: 'side', landmarks: { left_eye: lm(), nose: lm() } }
    stripFaceLandmarks(frame)
    expect(frame.landmarks.left_eye).toBeDefined()
  })

  it('preserves view / aspectRatio / source metadata', () => {
    const frame: PoseFrame = { view: 'back', landmarks: { nose: lm() }, aspectRatio: 0.75, source: 'camera' }
    const out = stripFaceLandmarks(frame)
    expect(out.view).toBe('back')
    expect(out.aspectRatio).toBe(0.75)
    expect(out.source).toBe('camera')
  })
})
