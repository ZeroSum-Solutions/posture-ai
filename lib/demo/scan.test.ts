import { describe, expect, it } from 'vitest'
import { assessPosture, testLandmarksFrames } from '@posture-ai/engine'
import { createDemoScan, createSampleScan, parseDemoScan } from './scan'

describe('browser demo scan contract', () => {
  it('calculates repeatable sample findings with the real engine', () => {
    const one = createSampleScan()
    const two = createSampleScan()
    expect(one.source).toBe('sample')
    expect(one.result.findings).toEqual(two.result.findings)
    expect(one.result.findings).toEqual(assessPosture(one.frames).findings)
    expect(one.result.findings.some(finding => finding.reliable && finding.zone !== 'maintain')).toBe(true)
    expect(one.frames.map(frame => frame.view)).toEqual(['front', 'side'])
  })

  it('minimizes unused face points without changing the scored findings', () => {
    const scan = createDemoScan(structuredClone(testLandmarksFrames))
    expect(scan.frames[0].landmarks.left_eye).toBeUndefined()
    expect(scan.frames[0].landmarks.left_ear).toBeDefined()
    expect(scan.result.findings).toEqual(assessPosture(testLandmarksFrames).findings)
    expect(testLandmarksFrames[0].landmarks.left_eye).toBeDefined()
  })

  it('rejects malformed storage and image fields, and ignores tampered result scores', () => {
    const sample = createSampleScan()
    expect(parseDemoScan({ ...sample, frames: [{ ...sample.frames[0], image: 'data:image/jpeg;base64,abc' }, sample.frames[1]] })).toBeNull()
    expect(parseDemoScan({ ...sample, frames: [{ ...sample.frames[0], aspectRatio: 0 }, sample.frames[1]] })).toBeNull()
    expect(parseDemoScan({ ...sample, result: { overallScore: 9999 } })?.result.overallScore).toEqual(sample.result.overallScore)
    expect(parseDemoScan({ ...sample, frames: [sample.frames[0]] })).toBeNull()
    expect(parseDemoScan(null)).toBeNull()
  })
})
