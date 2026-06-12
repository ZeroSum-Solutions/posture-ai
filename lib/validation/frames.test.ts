import { describe, it, expect } from 'vitest'
import { testLandmarksFrames } from '@posture-ai/engine'
import { parseAssessmentPayload, MAX_PAYLOAD_BYTES } from './frames'

const CLIENT_ID = '2f5d3f6a-4b1c-4f6e-9b3a-1c2d3e4f5a6b'

const validBody = () => ({
  client_id: CLIENT_ID,
  frames: testLandmarksFrames,
})

describe('parseAssessmentPayload', () => {
  it('accepts a real frames payload', () => {
    const r = parseAssessmentPayload(validBody(), { testModeEnabled: false })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.client_id).toBe(CLIENT_ID)
      expect(r.data.frames?.length).toBe(testLandmarksFrames.length)
      expect(r.data.useFixture).toBe(false)
    }
  })

  it('rejects a missing client_id', () => {
    const body = { frames: testLandmarksFrames }
    const r = parseAssessmentPayload(body, { testModeEnabled: false })
    expect(r.ok).toBe(false)
  })

  it('rejects a non-uuid client_id', () => {
    const r = parseAssessmentPayload({ ...validBody(), client_id: 'nope' }, { testModeEnabled: false })
    expect(r.ok).toBe(false)
  })

  it('rejects an invalid view label', () => {
    const body = validBody()
    const frames = [{ ...body.frames[0], view: 'diagonal' }]
    const r = parseAssessmentPayload({ ...body, frames }, { testModeEnabled: false })
    expect(r.ok).toBe(false)
  })

  it('rejects unknown landmark names', () => {
    const body = validBody()
    const frames = [{ view: 'front', landmarks: { not_a_landmark: { x: 0.5, y: 0.5 } } }]
    const r = parseAssessmentPayload({ ...body, frames }, { testModeEnabled: false })
    expect(r.ok).toBe(false)
  })

  it('rejects out-of-range coordinates', () => {
    const body = validBody()
    const frames = [{ view: 'front', landmarks: { nose: { x: 7.2, y: 0.5 } } }]
    const r = parseAssessmentPayload({ ...body, frames }, { testModeEnabled: false })
    expect(r.ok).toBe(false)
  })

  it('rejects visibility outside [0,1]', () => {
    const body = validBody()
    const frames = [{ view: 'front', landmarks: { nose: { x: 0.5, y: 0.5, visibility: 1.4 } } }]
    const r = parseAssessmentPayload({ ...body, frames }, { testModeEnabled: false })
    expect(r.ok).toBe(false)
  })

  it('rejects more than 3 frames', () => {
    const body = validBody()
    const frames = [...testLandmarksFrames, ...testLandmarksFrames]
    const r = parseAssessmentPayload({ ...body, frames }, { testModeEnabled: false })
    if (frames.length > 3) expect(r.ok).toBe(false)
  })

  it('requires frames when test mode is not enabled on the server', () => {
    const r = parseAssessmentPayload({ client_id: CLIENT_ID }, { testModeEnabled: false })
    expect(r.ok).toBe(false)
  })

  it('refuses test_mode when the server flag is off (no silent fixture fallback)', () => {
    const r = parseAssessmentPayload({ client_id: CLIENT_ID, test_mode: true }, { testModeEnabled: false })
    expect(r.ok).toBe(false)
  })

  it('allows test_mode without frames when the server flag is on', () => {
    const r = parseAssessmentPayload({ client_id: CLIENT_ID, test_mode: true }, { testModeEnabled: true })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data.useFixture).toBe(true)
  })

  it('real frames win over test_mode even when the flag is on', () => {
    const r = parseAssessmentPayload({ ...validBody(), test_mode: false }, { testModeEnabled: true })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data.useFixture).toBe(false)
  })

  it('exposes a sane payload size cap', () => {
    expect(MAX_PAYLOAD_BYTES).toBeGreaterThanOrEqual(64 * 1024)
    expect(MAX_PAYLOAD_BYTES).toBeLessThanOrEqual(1024 * 1024)
  })
})
