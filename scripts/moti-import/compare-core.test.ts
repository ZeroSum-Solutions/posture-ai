import { describe, expect, test } from 'vitest'
import {
  agreementStats,
  pairDebugRecords,
  shoulderAngleFromDebug,
} from './compare-core'
import type { DebugRecord } from './decode'

const debugRecord = (time: string, points: DebugRecord['points'] = {}): DebugRecord => ({
  time,
  version: 2,
  points,
  scalars: {},
})

describe('agreementStats', () => {
  // Expected values computed independently (Python) for these pairs.
  const engine = [2.1, 3.5, 1.0, 4.2, 2.8]
  const truth = [2.4, 3.1, 1.3, 4.8, 2.5]

  test('computes MAE, bias, and Bland–Altman limits of agreement', () => {
    const stats = agreementStats(engine, truth)!
    expect(stats.n).toBe(5)
    expect(stats.mae).toBeCloseTo(0.38, 10)
    expect(stats.bias).toBeCloseTo(-0.1, 10)
    expect(stats.loaLow).toBeCloseTo(-0.943027876170177, 10)
    expect(stats.loaHigh).toBeCloseTo(0.7430278761701771, 10)
  })

  test('computes Pearson r and ICC(2,1)', () => {
    const stats = agreementStats(engine, truth)!
    expect(stats.pearson).toBeCloseTo(0.9424595874003714, 10)
    expect(stats.icc21).toBeCloseTo(0.9499524865378527, 10)
  })

  test('returns null stats for fewer than 3 pairs', () => {
    expect(agreementStats([1], [2])).toBeNull()
    expect(agreementStats([1, 2], [2, 3])).toBeNull()
  })

  test('throws on mismatched lengths', () => {
    expect(() => agreementStats([1, 2, 3], [1, 2])).toThrow()
  })
})

describe('shoulderAngleFromDebug', () => {
  test('returns the shoulder-line tilt in degrees from acromial ends', () => {
    // 100px horizontal run, 10px vertical drop → atan2(10, 100) ≈ 5.7106°
    const record = debugRecord('t', {
      'acromialEnd[0]': { x: 100, y: 200 },
      'acromialEnd[1]': { x: 200, y: 210 },
    })
    expect(shoulderAngleFromDebug(record)).toBeCloseTo(5.710593137499643, 10)
  })

  test('is invariant to left/right order and tilt direction', () => {
    const down = debugRecord('t', {
      'acromialEnd[0]': { x: 200, y: 210 },
      'acromialEnd[1]': { x: 100, y: 200 },
    })
    const up = debugRecord('t', {
      'acromialEnd[0]': { x: 100, y: 210 },
      'acromialEnd[1]': { x: 200, y: 200 },
    })
    expect(shoulderAngleFromDebug(down)).toBeCloseTo(5.710593137499643, 10)
    expect(shoulderAngleFromDebug(up)).toBeCloseTo(5.710593137499643, 10)
  })

  test('returns null when either acromial end is missing', () => {
    expect(shoulderAngleFromDebug(debugRecord('t'))).toBeNull()
  })
})

describe('pairDebugRecords', () => {
  test('pairs positionally when record count equals session count', () => {
    const records = [debugRecord('a'), debugRecord('b')]
    expect(pairDebugRecords(records, 2)).toEqual([records[0], records[1]])
  })

  test('pairs a single record to the last session', () => {
    const records = [debugRecord('a')]
    expect(pairDebugRecords(records, 3)).toEqual([null, null, records[0]])
  })

  test('gives up on ambiguous counts', () => {
    const records = [debugRecord('a'), debugRecord('b')]
    expect(pairDebugRecords(records, 3)).toEqual([null, null, null])
  })
})
