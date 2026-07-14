import { describe, it, expect } from 'vitest'
import { admitFrame } from './live-frame-gate'
import type { FrameGateState } from './live-frame-gate'

const base: FrameGateState = { inFlight: false, lastTimestampMs: 100, lastCurrentTime: 1.0, generation: 5 }

describe('admitFrame (live VIDEO worker guard, §4.1)', () => {
  it('admits a fresh, newer, in-generation frame', () => {
    expect(admitFrame(base, { generation: 5, timestampMs: 133, currentTime: 1.033 })).toBe(true)
  })

  it('drops a frame while one is already in flight', () => {
    expect(admitFrame({ ...base, inFlight: true }, { generation: 5, timestampMs: 200, currentTime: 2.0 })).toBe(false)
  })

  it('drops a frame from a superseded generation (phase/view changed)', () => {
    expect(admitFrame(base, { generation: 4, timestampMs: 200, currentTime: 2.0 })).toBe(false)
  })

  it('drops a non-monotonic timestamp (MediaPipe VIDEO mode requires increasing ts)', () => {
    expect(admitFrame(base, { generation: 5, timestampMs: 100, currentTime: 2.0 })).toBe(false) // equal
    expect(admitFrame(base, { generation: 5, timestampMs: 99, currentTime: 2.0 })).toBe(false)  // earlier
  })

  it('drops an unchanged frame (same video.currentTime)', () => {
    expect(admitFrame(base, { generation: 5, timestampMs: 200, currentTime: 1.0 })).toBe(false)
  })
})
