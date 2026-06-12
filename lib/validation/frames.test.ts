import { describe, it, expect } from 'vitest'
import { testLandmarksFrames, assessPosture } from '@posture-ai/engine'
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

  describe('capture metadata fields', () => {
    it('accepts captureRollDeg, aspectRatio and source on a frame', () => {
      const body = validBody()
      const frames = [{ ...body.frames[0], captureRollDeg: -3.2, aspectRatio: 0.75, source: 'camera' }]
      const r = parseAssessmentPayload({ ...body, frames }, { testModeEnabled: false })
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.data.frames?.[0]).toMatchObject({ captureRollDeg: -3.2, aspectRatio: 0.75, source: 'camera' })
      }
    })

    it('rejects captureRollDeg beyond ±45', () => {
      const body = validBody()
      const frames = [{ ...body.frames[0], captureRollDeg: 60 }]
      const r = parseAssessmentPayload({ ...body, frames }, { testModeEnabled: false })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.status).toBe(422)
    })

    it('rejects aspectRatio outside 0.1–10', () => {
      const body = validBody()
      const frames = [{ ...body.frames[0], aspectRatio: 0.05 }]
      const r = parseAssessmentPayload({ ...body, frames }, { testModeEnabled: false })
      expect(r.ok).toBe(false)
    })

    it('rejects unknown source values', () => {
      const body = validBody()
      const frames = [{ ...body.frames[0], source: 'fixture' }]
      const r = parseAssessmentPayload({ ...body, frames }, { testModeEnabled: false })
      expect(r.ok).toBe(false)
    })

    it('still accepts frames without any metadata (historical payloads)', () => {
      const r = parseAssessmentPayload(validBody(), { testModeEnabled: false })
      expect(r.ok).toBe(true)
    })

    it('accepts the exact bounds: captureRollDeg ±45, aspectRatio 0.1 and 10, roll 0', () => {
      const body = validBody()
      for (const patch of [
        { captureRollDeg: 45 }, { captureRollDeg: -45 }, { captureRollDeg: 0 },
        { aspectRatio: 0.1 }, { aspectRatio: 10 },
      ]) {
        const frames = [{ ...body.frames[0], ...patch }]
        const r = parseAssessmentPayload({ ...body, frames }, { testModeEnabled: false })
        expect(r.ok, JSON.stringify(patch)).toBe(true)
      }
    })

    it('rejects values just past the bounds', () => {
      const body = validBody()
      for (const patch of [
        { captureRollDeg: 45.001 }, { captureRollDeg: -45.001 },
        { aspectRatio: 0.099 }, { aspectRatio: 10.001 },
      ]) {
        const frames = [{ ...body.frames[0], ...patch }]
        const r = parseAssessmentPayload({ ...body, frames }, { testModeEnabled: false })
        expect(r.ok, JSON.stringify(patch)).toBe(false)
      }
    })

    it('round-trips camera metadata into the engine: parsed frames score as tilt-corrected and level-verified', () => {
      const body = validBody()
      const frames = body.frames.map(f => ({
        ...f, captureRollDeg: 4.2, aspectRatio: 0.75, source: 'camera',
      }))
      const r = parseAssessmentPayload({ ...body, frames }, { testModeEnabled: false })
      expect(r.ok).toBe(true)
      if (!r.ok || !r.data.frames) throw new Error('expected parsed frames')
      const result = assessPosture(r.data.frames)
      expect(result.tiltCorrected).toBe(true)
      expect(result.levelVerified).toBe(true)
    })
  })
})
