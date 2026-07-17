import { describe, expect, test } from 'vitest'
import {
  agreementStats,
  pairDebugRecords,
  shoulderAngleFromDebug,
} from './compare-core'
import type { SessionData } from './walk'
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
  const reference = [2.4, 3.1, 1.3, 4.8, 2.5]

  test('computes MAE, bias, and Bland–Altman limits of agreement', () => {
    const stats = agreementStats(engine, reference)!
    expect(stats.n).toBe(5)
    expect(stats.mae).toBeCloseTo(0.38, 10)
    expect(stats.bias).toBeCloseTo(-0.1, 10)
    expect(stats.loaLow).toBeCloseTo(-0.943027876170177, 10)
    expect(stats.loaHigh).toBeCloseTo(0.7430278761701771, 10)
  })

  test('computes Pearson r and ICC(2,1)', () => {
    const stats = agreementStats(engine, reference)!
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
  const session = (index: number, date: string | null): SessionData => ({
    index,
    date,
    extraData: null,
    adams: null,
    ribsAngle: null,
    photos: { front: null, back: null, side: null, adams: null },
  })

  test('pairs by matching record date to session screening date', () => {
    const records = [
      debugRecord('1/6/2025 10:10:35 AM'),
      debugRecord('3/18/2025 10:12:13 AM'),
    ]
    // Sessions listed out of order to prove pairing is by date, not position.
    const sessions = [session(0, '2025-03-18'), session(1, '2025-01-06')]
    expect(pairDebugRecords(records, sessions)).toEqual([records[1], records[0]])
  })

  test('falls back to positional pairing when dates are unavailable and counts match', () => {
    const records = [debugRecord('a'), debugRecord('b')]
    const sessions = [session(0, null), session(1, null)]
    expect(pairDebugRecords(records, sessions)).toEqual([records[0], records[1]])
  })

  test('pairs a lone undated record only when there is a single session', () => {
    const records = [debugRecord('a')]
    expect(pairDebugRecords(records, [session(0, null)])).toEqual([records[0]])
    expect(
      pairDebugRecords(records, [session(0, null), session(1, null)]),
    ).toEqual([null, null])
  })

  test('pairs same-day sessions to that day\'s records in file order', () => {
    // Same-day re-screenings: record file order is chronological, and so is
    // session index order, so within a date the pairing is positional.
    const records = [
      debugRecord('9/8/2023 8:06:52 AM'),
      debugRecord('9/8/2023 8:12:51 AM'),
    ]
    const sessions = [session(0, '2023-09-08'), session(1, '2023-09-08')]
    expect(pairDebugRecords(records, sessions)).toEqual([records[0], records[1]])
  })

  test('mixes per-date groups: unique dates match, same-day groups pair in order', () => {
    const records = [
      debugRecord('5/1/2024 2:32:11 PM'),
      debugRecord('5/1/2024 3:26:23 PM'),
      debugRecord('5/4/2024 12:10:50 PM'),
    ]
    const sessions = [
      session(0, '2024-05-01'),
      session(1, '2024-05-01'),
      session(2, '2024-05-04'),
    ]
    expect(pairDebugRecords(records, sessions)).toEqual([
      records[0],
      records[1],
      records[2],
    ])
  })

  test('pairs nothing for a date whose record count mismatches its session count', () => {
    const records = [debugRecord('1/6/2025 10:10:35 AM')]
    const sessions = [session(0, '2025-01-06'), session(1, '2025-01-06')]
    expect(pairDebugRecords(records, sessions)).toEqual([null, null])
  })
})
