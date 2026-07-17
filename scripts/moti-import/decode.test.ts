import { describe, expect, test } from 'vitest'
import {
  debugTimeToIsoDate,
  parseAdams,
  parseClientInfo,
  parseDebugLandmarks,
  parseExtraData,
  parseRibsAngle,
  parseSkeleton,
  splitRecords,
} from './decode'

const BOM = '﻿'

// Synthetic fixtures mirroring the on-disk Moti-Physio formats exactly
// (pipe-joined pretty-printed JSON records, flat dotted keys, BOM + Base64).
// No real client data.

const skeletonRecord = (time: string, projX: number) =>
  JSON.stringify(
    {
      time,
      ID: 1,
      Joints: [
        {
          Type: 'Head',
          Confidence: 0.75,
          'Real.X': 39.21,
          'Real.Y': 625.09,
          'Real.Z': 1954.91,
          'Proj.X': projX,
          'Proj.Y': 0.211,
          'Proj.Z': 1954.91,
          'Orient.Matrix[0]': 1.0,
        },
        {
          Type: 'None',
          Confidence: 0.0,
          'Real.X': 0.0,
          'Real.Y': 0.0,
          'Real.Z': 0.0,
          'Proj.X': 0.0,
          'Proj.Y': 0.0,
          'Proj.Z': 0.0,
        },
      ],
    },
    null,
    2,
  )

describe('splitRecords', () => {
  test('returns a single record unchanged', () => {
    const raw = skeletonRecord('1/6/2025 10:10:35 AM', 0.524)
    const records = splitRecords(raw)
    expect(records).toHaveLength(1)
    expect(JSON.parse(records[0]).time).toBe('1/6/2025 10:10:35 AM')
  })

  test('splits pipe-joined records into parseable JSON', () => {
    const raw =
      skeletonRecord('1/6/2025 10:10:35 AM', 0.524) +
      '|' +
      skeletonRecord('3/18/2025 10:12:13 AM', 0.531)
    const records = splitRecords(raw)
    expect(records).toHaveLength(2)
    expect(JSON.parse(records[0]).time).toBe('1/6/2025 10:10:35 AM')
    expect(JSON.parse(records[1]).time).toBe('3/18/2025 10:12:13 AM')
  })

  test('strips a leading BOM', () => {
    const raw = BOM + skeletonRecord('1/6/2025 10:10:35 AM', 0.524)
    expect(() => JSON.parse(splitRecords(raw)[0])).not.toThrow()
  })
})

describe('parseSkeleton', () => {
  test('parses one session record per pipe-joined block', () => {
    const raw =
      skeletonRecord('1/6/2025 10:10:35 AM', 0.524) +
      '|' +
      skeletonRecord('3/18/2025 10:12:13 AM', 0.531)
    const sessions = parseSkeleton(raw)
    expect(sessions).toHaveLength(2)
    expect(sessions[0].time).toBe('1/6/2025 10:10:35 AM')
    expect(sessions[1].time).toBe('3/18/2025 10:12:13 AM')
  })

  test('maps flat Real./Proj. keys into joint vectors', () => {
    const [session] = parseSkeleton(skeletonRecord('1/6/2025 10:10:35 AM', 0.524))
    const head = session.joints.find((j) => j.type === 'Head')
    expect(head).toBeDefined()
    expect(head!.confidence).toBe(0.75)
    expect(head!.real).toEqual({ x: 39.21, y: 625.09, z: 1954.91 })
    expect(head!.proj).toEqual({ x: 0.524, y: 0.211, z: 1954.91 })
  })
})

describe('parseDebugLandmarks', () => {
  const debugRecord = (time: string) =>
    JSON.stringify(
      {
        time,
        version: 2,
        'head.x': 368.7793,
        'head.y': 1023.08887,
        'C7Vertebra.x': 371.736847,
        'C7Vertebra.y': 934.9678,
        'acromialEnd[0].x': 282.5268,
        'acromialEnd[0].y': 902.678467,
        'acromialEnd[1].x': 460.9033,
        'acromialEnd[1].y': 905.1101,
        'cameraAngle.x': 1.2,
        'cameraAngle.y': -0.4,
        'cameraAngle.z': 0.1,
        intrinsicScale: 1.075,
        cameraCalibrationVersion: 3,
      },
      null,
      2,
    )

  test('parses pipe-joined records with time and version', () => {
    const records = parseDebugLandmarks(
      debugRecord('1/6/2025 10:10:35 AM') + '|' + debugRecord('3/18/2025 10:12:13 AM'),
    )
    expect(records).toHaveLength(2)
    expect(records[0].time).toBe('1/6/2025 10:10:35 AM')
    expect(records[0].version).toBe(2)
  })

  test('groups flat dotted keys into named 2D points', () => {
    const [record] = parseDebugLandmarks(debugRecord('1/6/2025 10:10:35 AM'))
    expect(record.points['head']).toEqual({ x: 368.7793, y: 1023.08887 })
    expect(record.points['C7Vertebra']).toEqual({ x: 371.736847, y: 934.9678 })
    expect(record.points['acromialEnd[0]']).toEqual({ x: 282.5268, y: 902.678467 })
    expect(record.points['acromialEnd[1]']).toEqual({ x: 460.9033, y: 905.1101 })
  })

  test('keeps non-point values as scalars and z-components out of points', () => {
    const [record] = parseDebugLandmarks(debugRecord('1/6/2025 10:10:35 AM'))
    expect(record.scalars['intrinsicScale']).toBe(1.075)
    expect(record.scalars['cameraCalibrationVersion']).toBe(3)
    expect(record.scalars['cameraAngle.z']).toBe(0.1)
    expect(record.points['cameraAngle']).toEqual({ x: 1.2, y: -0.4 })
  })
})

describe('parseExtraData', () => {
  const extraDataRaw = (overrides: Record<string, unknown> = {}) => {
    const payload = {
      success: true,
      data: {
        anterior: { success: true, data: '[[0.06, 0.0], [0.065, 0.05]]' },
        lateral: { success: true, data: '[[-0.004, 0.0], [0.014, 0.048]]' },
        pelvis_obliiquity: { success: true, data: '[-0.1749649]' },
        pelvis_axial_rotation: { success: true, data: '[-2.3764572]' },
        pelvis_tilt: { success: true, data: '[20.642868]' },
        ...overrides,
      },
    }
    return BOM + Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
  }

  test('decodes BOM-prefixed Base64 into pelvis angles (misspelled key included)', () => {
    const result = parseExtraData(extraDataRaw())
    expect(result.pelvisObliquity).toBeCloseTo(-0.1749649)
    expect(result.pelvisAxialRotation).toBeCloseTo(-2.3764572)
    expect(result.pelvisTilt).toBeCloseTo(20.642868)
  })

  test('decodes double-encoded curve strings into point arrays', () => {
    const result = parseExtraData(extraDataRaw())
    expect(result.anteriorCurve).toEqual([
      [0.06, 0.0],
      [0.065, 0.05],
    ])
    expect(result.lateralCurve).toEqual([
      [-0.004, 0.0],
      [0.014, 0.048],
    ])
  })

  test('returns null for fields whose inner success flag is false', () => {
    const result = parseExtraData(
      extraDataRaw({ pelvis_tilt: { success: false, data: '' } }),
    )
    expect(result.pelvisTilt).toBeNull()
    expect(result.pelvisObliquity).toBeCloseTo(-0.1749649)
  })
})

describe('parseAdams', () => {
  test('parses x,y,z CSV rows in millimetres', () => {
    const rows = parseAdams(
      '-9.002286,477.735,1840.826\n-9.154111,449.9667,1841.213\n',
    )
    expect(rows).toEqual([
      { x: -9.002286, y: 477.735, z: 1840.826 },
      { x: -9.154111, y: 449.9667, z: 1841.213 },
    ])
  })
})

describe('parseRibsAngle', () => {
  test('parses newline-separated floats keeping zeros', () => {
    const values = parseRibsAngle('0\n0\n-0.7634735\n0.2888481\n0\n')
    expect(values).toEqual([0, 0, -0.7634735, 0.2888481, 0])
  })
})

describe('parseClientInfo', () => {
  const clientInfo = `${BOM}CLIENT SCREENING RECORD
=======================
Name           : Dave F
Client ID      : 0774-AM-0052
Sex            : Man
Date of Birth  : 1985-06-12
First Visit    : 2025-01-06
Height         : 170 cm
Email          : dave@example.com

App version    : BOTH Version 1 and Version 2
Screening date : 2025-01-06 [v1], 2025-03-18 [v2]
`

  test('extracts the non-PII fields needed downstream', () => {
    const info = parseClientInfo(clientInfo)
    expect(info.clientId).toBe('0774-AM-0052')
    expect(info.sex).toBe('male')
    expect(info.heightCm).toBe(170)
  })

  test('never carries name, email, or birth date through', () => {
    const info = parseClientInfo(clientInfo)
    const serialized = JSON.stringify(info)
    expect(serialized).not.toContain('Dave')
    expect(serialized).not.toContain('example.com')
    expect(serialized).not.toContain('1985')
  })

  test('maps Woman to female', () => {
    const info = parseClientInfo(clientInfo.replace('Sex            : Man', 'Sex            : Woman'))
    expect(info.sex).toBe('female')
  })

  test('parses multi-session screening dates in order', () => {
    const info = parseClientInfo(clientInfo)
    expect(info.screeningDates).toEqual(['2025-01-06', '2025-03-18'])
  })

  test('parses a single screening date', () => {
    const info = parseClientInfo(
      clientInfo.replace(
        'Screening date : 2025-01-06 [v1], 2025-03-18 [v2]',
        'Screening date : 2023-07-12 [v1]',
      ),
    )
    expect(info.screeningDates).toEqual(['2023-07-12'])
  })
})

describe('debugTimeToIsoDate', () => {
  test('converts the US-format record time to an ISO date', () => {
    expect(debugTimeToIsoDate('7/12/2023 6:18:36 PM')).toBe('2023-07-12')
    expect(debugTimeToIsoDate('1/6/2025 10:10:35 AM')).toBe('2025-01-06')
    expect(debugTimeToIsoDate('3/18/2025 10:12:13 AM')).toBe('2025-03-18')
  })

  test('returns null for unparseable input', () => {
    expect(debugTimeToIsoDate('not a time')).toBeNull()
  })
})
