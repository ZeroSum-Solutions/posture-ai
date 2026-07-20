import { describe, it, expect } from 'vitest'
import { testLandmarksFrames, assessPosture } from '@posture-ai/engine'
import { parseAssessmentPayload, MAX_PAYLOAD_BYTES } from './frames'

const CLIENT_ID = '2f5d3f6a-4b1c-4f6e-9b3a-1c2d3e4f5a6b'
const SUBMISSION_ID = '6a76a8b9-df1d-4e93-a65b-33419bb01bb4'

const validFrames = () => {
  const front = testLandmarksFrames.find(f => f.view === 'front')!
  const side = testLandmarksFrames.find(f => f.view === 'side')!
  return [
    { ...front },
    { ...side, profileSide: 'left' as const },
    { ...side, profileSide: 'right' as const },
    { ...front, view: 'back' as const },
  ]
}

const validBody = () => ({
  client_id: CLIENT_ID,
  submission_id: SUBMISSION_ID,
  frames: validFrames(),
})

describe('parseAssessmentPayload', () => {
  it('accepts a real frames payload', () => {
    const r = parseAssessmentPayload(validBody(), { testModeEnabled: false })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.client_id).toBe(CLIENT_ID)
      expect(r.data.submission_id).toBe(SUBMISSION_ID)
      expect(r.data.frames?.length).toBe(4)
      expect(r.data.useFixture).toBe(false)
    }
  })

  it('requires a UUID submission_id', () => {
    const missing = { client_id: CLIENT_ID, frames: validFrames() }
    expect(parseAssessmentPayload(missing, { testModeEnabled: false }).ok).toBe(false)
    expect(parseAssessmentPayload({ ...validBody(), submission_id: 'not-a-uuid' }, { testModeEnabled: false }).ok).toBe(false)
  })

  it.each([
    ['front', (f: { view: string; profileSide?: string }) => f.view === 'front'],
    ['side-left', (f: { view: string; profileSide?: string }) => f.view === 'side' && f.profileSide === 'left'],
    ['side-right', (f: { view: string; profileSide?: string }) => f.view === 'side' && f.profileSide === 'right'],
    ['back', (f: { view: string; profileSide?: string }) => f.view === 'back'],
  ])('rejects a non-test payload missing the %s capture group', (_group, matches) => {
    const body = validBody()
    const frames = body.frames.filter(frame => !matches(frame))
    const r = parseAssessmentPayload({ ...body, frames }, { testModeEnabled: false })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/required capture group/i)
  })

  it('rejects an unnamed legacy side group in a non-test payload', () => {
    const body = validBody()
    const frames = body.frames.map(frame => frame.view === 'side' && frame.profileSide === 'left'
      ? { ...frame, profileSide: undefined }
      : frame)
    const r = parseAssessmentPayload({ ...body, frames }, { testModeEnabled: false })
    expect(r.ok).toBe(false)
  })

  it('rejects a frame missing the structural landmarks required for its capture group', () => {
    const body = validBody()
    const frames = body.frames.map(frame => frame.view === 'front'
      ? { ...frame, landmarks: { left_shoulder: frame.landmarks.left_shoulder } }
      : frame)
    const r = parseAssessmentPayload({ ...body, frames }, { testModeEnabled: false })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/missing structural landmarks/i)
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

  describe('capture bursts (multi-frame per view, engine 1.3.0)', () => {
    const front = () => testLandmarksFrames.find(f => f.view === 'front')!

    it('accepts repeated views as a burst (formerly capped at 3 total)', () => {
      const body = validBody()
      const frames = [...validFrames(), ...validFrames()]
      const r = parseAssessmentPayload({ ...body, frames }, { testModeEnabled: false })
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.data.frames?.length).toBe(frames.length)
    })

    it('accepts a full 5-frame burst per view', () => {
      const body = validBody()
      const frames = validFrames().flatMap(f => Array.from({ length: 5 }, () => ({ ...f })))
      const r = parseAssessmentPayload({ ...body, frames }, { testModeEnabled: false })
      expect(r.ok).toBe(true)
    })

    it('rejects more than 5 frames of the same view', () => {
      const body = validBody()
      const frames = Array.from({ length: 6 }, () => ({ ...front() }))
      const r = parseAssessmentPayload({ ...body, frames }, { testModeEnabled: false })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toMatch(/burst|per view/i)
    })

    it('burst frames round-trip into the engine and produce stability fields', () => {
      const body = validBody()
      const frames = validFrames().flatMap(f => [{ ...f }, { ...f }, { ...f }])
      const r = parseAssessmentPayload({ ...body, frames }, { testModeEnabled: false })
      expect(r.ok).toBe(true)
      if (!r.ok || !r.data.frames) throw new Error('expected parsed frames')
      const result = assessPosture(r.data.frames)
      expect(result.captureStability).not.toBeNull()
      expect(result.findings.some(f => f.stabilityScore !== undefined)).toBe(true)
    })
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
    const r = parseAssessmentPayload({ client_id: CLIENT_ID, submission_id: SUBMISSION_ID, test_mode: true }, { testModeEnabled: true })
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
      const frames = body.frames.map((frame, index) => index === 0
        ? { ...frame, captureRollDeg: -3.2, aspectRatio: 0.75, source: 'camera' as const }
        : frame)
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

    it('accepts frames without roll, aspect-ratio, or source metadata', () => {
      const body = validBody()
      const r = parseAssessmentPayload(body, { testModeEnabled: false })
      expect(r.ok).toBe(true)
    })

    it('accepts the exact bounds: captureRollDeg ±45, aspectRatio 0.1 and 10, roll 0', () => {
      const body = validBody()
      for (const patch of [
        { captureRollDeg: 45 }, { captureRollDeg: -45 }, { captureRollDeg: 0 },
        { aspectRatio: 0.1 }, { aspectRatio: 10 },
      ]) {
        const frames = body.frames.map((frame, index) => index === 0 ? { ...frame, ...patch } : frame)
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
        const frames = body.frames.map((frame, index) => index === 0 ? { ...frame, ...patch } : frame)
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

  describe('strict no-image-bytes guarantee', () => {
    const validFrame = { view: 'front', landmarks: { nose: { x: 0.5, y: 0.5 } } }

    it('rejects a frame carrying a smuggled image field', () => {
      const r = parseAssessmentPayload(
        { client_id: CLIENT_ID, frames: [{ ...validFrame, image: 'data:image/jpeg;base64,AAAA' }] },
        { testModeEnabled: false },
      )
      expect(r.ok).toBe(false)
    })

    it('rejects an image field at the top level of the payload', () => {
      const r = parseAssessmentPayload(
        { client_id: CLIENT_ID, frames: [validFrame], image: 'data:image/jpeg;base64,AAAA' },
        { testModeEnabled: false },
      )
      expect(r.ok).toBe(false)
    })

    it('rejects extra (binary-ish) keys inside a landmark', () => {
      const r = parseAssessmentPayload(
        { client_id: CLIENT_ID, frames: [{ view: 'front', landmarks: { nose: { x: 0.5, y: 0.5, blob: 'x' } } }] },
        { testModeEnabled: false },
      )
      expect(r.ok).toBe(false)
    })
  })

  describe('per-side profiles', () => {
    const f = (view: string, extra: Record<string, unknown> = {}) =>
      ({ view, landmarks: { nose: { x: 0.5, y: 0.5 } }, ...extra })

    it('accepts named profiles in a structurally complete four-group payload', () => {
      const r = parseAssessmentPayload(validBody(), { testModeEnabled: false })
      expect(r.ok).toBe(true)
    })
    it('rejects profileSide on a front frame', () => {
      const r = parseAssessmentPayload({ client_id: CLIENT_ID, frames: [f('front', { profileSide: 'left' })] }, { testModeEnabled: false })
      expect(r.ok).toBe(false)
    })
    it('accepts 20 frames across four (view, profileSide) groups', () => {
      const frames = validFrames().flatMap(frame => Array.from({ length: 5 }, () => ({ ...frame })))
      const r = parseAssessmentPayload({ client_id: CLIENT_ID, submission_id: SUBMISSION_ID, frames }, { testModeEnabled: false })
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.data.frames?.length).toBe(20)
    })
    it('rejects a 6-frame burst of the same (view, profileSide)', () => {
      const frames = Array.from({ length: 6 }, () => f('side', { profileSide: 'left' }))
      const r = parseAssessmentPayload({ client_id: CLIENT_ID, frames }, { testModeEnabled: false })
      expect(r.ok).toBe(false)
    })
    it('rejects mixing an unspecified-side frame with a named-side frame', () => {
      const frames = [f('side'), f('side', { profileSide: 'left' })]
      const r = parseAssessmentPayload({ client_id: CLIENT_ID, frames }, { testModeEnabled: false })
      expect(r.ok).toBe(false)
    })
  })
})
