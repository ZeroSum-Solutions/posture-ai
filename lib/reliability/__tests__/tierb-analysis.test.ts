import { describe, expect, it } from 'vitest'
import {
  analyzeTierBReliability,
  participantClusterBootstrap,
  TIERB_ANALYSIS_METRIC_CELLS,
  TIERB_BOOTSTRAP_ATTEMPTS,
  TIERB_MIN_VALID_BOOTSTRAP_ATTEMPTS,
  TIERB_REPEAT_IDS,
  type7Percentile,
  type TierBAnalysisInput,
  type TierBMeasurement,
} from '../tierb-analysis'

function makeInput(participantCount = 12): TierBAnalysisInput {
  const participantIds = Array.from(
    { length: participantCount },
    (_, index) => `participant-${index + 1}`,
  )
  const deviceIds = ['device-a', 'device-b']
  const records: TierBMeasurement[] = []
  for (const [participantIndex, participantId] of participantIds.entries()) {
    for (const [deviceIndex, deviceId] of deviceIds.entries()) {
      for (const [repeatIndex, repeatId] of TIERB_REPEAT_IDS.entries()) {
        records.push({
          participantId,
          deviceId,
          metricId: 'anterior_imbalanced_shoulders',
          view: 'front',
          repeatId,
          pose: 'neutral',
          unit: 'percentage_points',
          sourceField: 'severityPct',
          reliable: true,
          value: participantIndex * 1.7 + repeatIndex * (deviceIndex + 1) * 0.15,
        })
      }
    }
  }
  return {
    participantIds,
    deviceIds,
    metricCells: TIERB_ANALYSIS_METRIC_CELLS,
    records,
    bootstrapSeed: 'public-fixture-seed',
  }
}

describe('type7Percentile', () => {
  it('uses Hyndman-Fan type-7 interpolation', () => {
    const values = [0, 10, 20, 30, 40]
    expect(type7Percentile(values, 0)).toBe(0)
    expect(type7Percentile(values, 0.25)).toBe(10)
    expect(type7Percentile(values, 0.375)).toBe(15)
    expect(type7Percentile(values, 1)).toBe(40)
  })

  it('rejects empty, unsorted, non-finite, and out-of-range inputs', () => {
    expect(() => type7Percentile([], 0.5)).toThrow('empty')
    expect(() => type7Percentile([2, 1], 0.5)).toThrow('sorted')
    expect(() => type7Percentile([1, Number.NaN], 0.5)).toThrow('finite')
    expect(() => type7Percentile([1, 2], 1.1)).toThrow('[0, 1]')
  })
})

describe('participantClusterBootstrap', () => {
  it('is deterministic, resamples participant rows, and never retries invalid draws', () => {
    const matrix = [
      [1, 1, 1],
      [2, 2, 2],
      [3, 3, 3],
    ]
    const options = {
      seed: 'deterministic-test',
      attempts: 500,
      minimumValidAttempts: 400,
    }
    const first = participantClusterBootstrap(matrix, options)
    const second = participantClusterBootstrap(matrix, options)

    expect(first).toEqual(second)
    expect(first.requestedAttempts).toBe(500)
    expect(first.validAttempts + first.invalidAttempts).toBe(500)
    expect(first.invalidAttempts).toBeGreaterThan(0)
    expect(first.invalidReasonCounts).toEqual({
      'undefined-reliability-statistics': first.invalidAttempts,
    })
    expect(first.hasSufficientValidAttempts).toBe(true)
    expect(first.intervals.icc21?.median).toBeCloseTo(1, 12)
  })

  it('rejects ragged, non-finite, undersized, or invalid bootstrap configuration', () => {
    expect(() => participantClusterBootstrap([[1, 2], [3, 4]], {
      seed: 'x',
      attempts: 10,
      minimumValidAttempts: 10,
    })).toThrow('three participant')
    expect(() => participantClusterBootstrap([
      [1, 2],
      [3, Number.NaN],
      [4, 5],
    ], { seed: 'x', attempts: 10, minimumValidAttempts: 10 })).toThrow('finite')
    expect(() => participantClusterBootstrap([
      [1, 2],
      [3],
      [4, 5],
    ], { seed: 'x', attempts: 10, minimumValidAttempts: 10 })).toThrow('ragged')
    expect(() => participantClusterBootstrap([
      [1, 2],
      [3, 4],
      [5, 6],
    ], { seed: 'x', attempts: 10, minimumValidAttempts: 11 })).toThrow('within')
  })
})

describe('analyzeTierBReliability', () => {
  it('reports primary reliability per exact device and pooling as descriptive only', () => {
    const result = analyzeTierBReliability(makeInput())

    expect(result.protocol).toEqual({
      pose: 'neutral',
      repeatIds: [1, 2, 3],
      primaryGrouping: 'exact-device',
      independentCluster: 'participant',
    })
    expect(result).toMatchObject({
      schemaVersion: 'tierb-analysis-v1',
      primaryUnit: 'percentage_points',
      consumerEligible: false,
    })
    const shoulderGroups = result.primary.filter((group) =>
      group.metricId === 'anterior_imbalanced_shoulders' && group.view === 'front')
    expect(shoulderGroups).toHaveLength(2)
    expect(shoulderGroups.map((group) => group.deviceId)).toEqual(['device-a', 'device-b'])
    for (const group of shoulderGroups) {
      expect(group.scope).toBe('primary-exact-device')
      expect(group.completeParticipants).toBe(12)
      expect(group.missingness).toBe(0)
      expect(group.isEligible).toBe(true)
      expect(group.stats).not.toBeNull()
      expect(group.bootstrap?.requestedAttempts).toBe(TIERB_BOOTSTRAP_ATTEMPTS)
      expect(group.bootstrap?.minimumValidAttempts)
        .toBe(TIERB_MIN_VALID_BOOTSTRAP_ATTEMPTS)
      expect(group.bootstrap?.hasSufficientValidAttempts).toBe(true)
    }

    expect(result.pooledDescriptive).toMatchObject({
      primary: false,
      consumerEligible: false,
    })
    expect(result.pooledDescriptive.groups).toHaveLength(TIERB_ANALYSIS_METRIC_CELLS.length)
    const pooledShoulders = result.pooledDescriptive.groups.find((group) =>
      group.metricId === 'anterior_imbalanced_shoulders' && group.view === 'front')!
    expect(pooledShoulders).toMatchObject({
      scope: 'pooled-descriptive-only',
      deviceIds: ['device-a', 'device-b'],
      participantCount: 12,
      measurementCount: 72,
    })
    expect(pooledShoulders).not.toHaveProperty('icc21')
    expect(pooledShoulders).not.toHaveProperty('mdc95')
  })

  it('treats unreliable values as missing, never as zero', () => {
    const input = makeInput(13)
    const targetIndex = input.records.findIndex((record) =>
      record.participantId === 'participant-13'
      && record.deviceId === 'device-a'
      && record.repeatId === 2)
    const unreliable = input.records[targetIndex]
    input.records = input.records.map((record, index) =>
      index === targetIndex ? { ...unreliable, reliable: false, value: null } : record)

    const result = analyzeTierBReliability(input)
    const deviceA = result.primary.find((group) =>
      group.deviceId === 'device-a'
      && group.metricId === 'anterior_imbalanced_shoulders'
      && group.view === 'front')!
    expect(deviceA.completeParticipants).toBe(12)
    expect(deviceA.observedMetricCells).toBe(38)
    expect(deviceA.missingMetricCells).toBe(1)
    expect(deviceA.absentMetricCells).toBe(0)
    expect(deviceA.unreliableMetricCells).toBe(1)
    expect(deviceA.missingness).toBeCloseTo(1 / 39, 12)
    expect(deviceA.isEligible).toBe(true)
    const pooledShoulders = result.pooledDescriptive.groups.find((group) =>
      group.metricId === 'anterior_imbalanced_shoulders' && group.view === 'front')!
    expect(pooledShoulders.measurementCount).toBe(77)

    const reliableValues = input.records
      .filter((record) => record.reliable && record.value !== null)
      .map((record) => record.value!)
    const expectedMean = reliableValues.reduce((sum, value) => sum + value, 0)
      / reliableValues.length
    expect(pooledShoulders.mean).toBeCloseTo(expectedMean, 12)
  })

  it('does not produce reliability when completeness or 20% missingness gates fail', () => {
    const input = makeInput()
    input.records = input.records.filter((record) =>
      record.deviceId !== 'device-a'
      || !['participant-1', 'participant-2', 'participant-3'].includes(record.participantId))

    const result = analyzeTierBReliability(input)
    const deviceA = result.primary.find((group) =>
      group.deviceId === 'device-a'
      && group.metricId === 'anterior_imbalanced_shoulders'
      && group.view === 'front')!
    expect(deviceA.completeParticipants).toBe(9)
    expect(deviceA.missingness).toBe(0.25)
    expect(deviceA.isEligible).toBe(false)
    expect(deviceA.failureReasons).toEqual([
      'fewer-than-12-complete-participants',
      'metric-cell-missingness-over-20-percent',
    ])
    expect(deviceA.stats).toBeNull()
    expect(deviceA.bootstrap).toBeNull()
  })

  it('requires neutral records, exactly two devices, fixed repeats, and unique cells', () => {
    const wrongPose = makeInput()
    wrongPose.records = wrongPose.records.map((record, index) => index === 0
      ? { ...record, pose: 'loaded' as TierBMeasurement['pose'] }
      : record)
    expect(() => analyzeTierBReliability(wrongPose)).toThrow('neutral-only')

    const oneDevice = makeInput()
    oneDevice.deviceIds = ['device-a']
    oneDevice.records = oneDevice.records.filter((record) => record.deviceId === 'device-a')
    expect(() => analyzeTierBReliability(oneDevice)).toThrow('exactly two devices')

    const wrongRepeat = makeInput()
    wrongRepeat.records = wrongRepeat.records.map((record, index) => index === 0
      ? { ...record, repeatId: 4 as TierBMeasurement['repeatId'] }
      : record)
    expect(() => analyzeTierBReliability(wrongRepeat)).toThrow('unexpected repeat')

    const duplicate = makeInput()
    duplicate.records = [...duplicate.records, { ...duplicate.records[0] }]
    expect(() => analyzeTierBReliability(duplicate)).toThrow('duplicate Tier B')
  })

  it('rejects ragged study metadata and non-finite values at the boundary', () => {
    const duplicateParticipant = makeInput()
    duplicateParticipant.participantIds = [
      ...duplicateParticipant.participantIds,
      duplicateParticipant.participantIds[0],
    ]
    expect(() => analyzeTierBReliability(duplicateParticipant)).toThrow('duplicates')

    const nonFinite = makeInput()
    nonFinite.records = nonFinite.records.map((record, index) => index === 0
      ? { ...record, value: Number.POSITIVE_INFINITY }
      : record)
    expect(() => analyzeTierBReliability(nonFinite)).toThrow('[0, 100]')

    const reliableMissing = makeInput()
    reliableMissing.records = reliableMissing.records.map((record, index) => index === 0
      ? { ...record, value: null }
      : record)
    expect(() => analyzeTierBReliability(reliableMissing)).toThrow('reliable')

    const unreliableNumber = makeInput()
    unreliableNumber.records = unreliableNumber.records.map((record, index) =>
      index === 0 ? { ...record, reliable: false, value: 0 } : record)
    expect(() => analyzeTierBReliability(unreliableNumber)).toThrow('unreliable')

    for (const invalidReliable of ['true', 1]) {
      const nonBooleanReliable = makeInput()
      nonBooleanReliable.records = nonBooleanReliable.records.map((record, index) =>
        index === 0
          ? { ...record, reliable: invalidReliable } as unknown as TierBMeasurement
          : record)
      expect(() => analyzeTierBReliability(nonBooleanReliable)).toThrow(
        'reliable must be a boolean',
      )
    }

    const wrongUnit = makeInput()
    wrongUnit.records = wrongUnit.records.map((record, index) => index === 0
      ? { ...record, unit: 'degrees' as TierBMeasurement['unit'] }
      : record)
    expect(() => analyzeTierBReliability(wrongUnit)).toThrow('severityPct')

    const outOfRange = makeInput()
    outOfRange.records = outOfRange.records.map((record, index) => index === 0
      ? { ...record, value: 101 }
      : record)
    expect(() => analyzeTierBReliability(outOfRange)).toThrow('[0, 100]')

    const inventedMetric = makeInput()
    inventedMetric.metricCells = [{ metricId: 'invented', view: 'front' }]
    expect(() => analyzeTierBReliability(inventedMetric)).toThrow('frozen candidate')

    const hiddenField = makeInput()
    hiddenField.records = hiddenField.records.map((record, index) => index === 0
      ? { ...record, originalFilename: 'private.jpg' } as TierBMeasurement
      : record)
    expect(() => analyzeTierBReliability(hiddenField)).toThrow('unknown or missing')
  })
})
