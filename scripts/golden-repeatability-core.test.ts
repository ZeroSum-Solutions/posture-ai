import { describe, expect, it } from 'vitest'
import {
  buildMetricReliability,
  buildReliabilityProfile,
  assertCapturePoseModel,
  parseTierBFileName,
  validateTierBProvenance,
  RELIABILITY_ALGORITHM_VERSION,
  RELIABILITY_PROFILE_SCHEMA_VERSION,
  RELIABILITY_PROTOCOL_VERSION,
} from './golden-repeatability-core'

const records = [
  { caseKey: 's1|neutral|iphone', repeatId: '1', deviationDeg: 1, severityPct: 10 },
  { caseKey: 's1|neutral|iphone', repeatId: '2', deviationDeg: 2, severityPct: 20 },
  { caseKey: 's2|neutral|iphone', repeatId: '1', deviationDeg: 4, severityPct: 40 },
  { caseKey: 's2|neutral|iphone', repeatId: '2', deviationDeg: 5, severityPct: 50 },
  { caseKey: 's3|neutral|iphone', repeatId: '1', deviationDeg: 7, severityPct: 70 },
  { caseKey: 's3|neutral|iphone', repeatId: '2', deviationDeg: 8, severityPct: 80 },
]

describe('buildMetricReliability', () => {
  it('emits aligned reliability statistics in degrees and severity percentage points', () => {
    const result = buildMetricReliability(records, ['1', '2'])

    expect(result.repeatIds).toEqual(['1', '2'])
    expect(result.droppedCases).toEqual([])
    expect(result.deviationDeg.unit).toBe('deg')
    expect(result.deviationDeg.stats?.nCases).toBe(3)
    expect(result.deviationDeg.stats?.mean).toBe(4.5)
    expect(result.severityPct.unit).toBe('percentage_points')
    expect(result.severityPct.stats?.nCases).toBe(3)
    expect(result.severityPct.stats?.mean).toBe(45)
  })
})

describe('Tier B ingest provenance', () => {
  it('parses the frozen filename fields used for capture grouping', () => {
    expect(parseTierBFileName('neutral_front_iphone_r2.landmarks.json')).toEqual({
      pose: 'neutral',
      view: 'front',
      device: 'iphone',
      repeatId: '2',
    })
    expect(parseTierBFileName('bad-name.json')).toBeNull()
  })

  it('accepts only a known pose model under the current protocol version', () => {
    expect(validateTierBProvenance({
      poseModel: 'lite',
      protocolVersion: RELIABILITY_PROTOCOL_VERSION,
    }, 'fixture')).toBe('lite')
    expect(() => validateTierBProvenance({
      poseModel: 'lite',
      protocolVersion: 'old-protocol',
    }, 'fixture')).toThrow('incompatible protocolVersion')
    expect(() => validateTierBProvenance({
      protocolVersion: RELIABILITY_PROTOCOL_VERSION,
    }, 'fixture')).toThrow('poseModel')
  })

  it('rejects mixed pose models within one grouped capture', () => {
    expect(() => assertCapturePoseModel('lite', 'full', 's1|neutral|iphone|1'))
      .toThrow('mixes pose models')
  })
})

describe('buildReliabilityProfile', () => {
  it('builds a versioned pilot profile that cannot drive report comparisons', () => {
    const metric = buildMetricReliability(records, ['1', '2'])
    const profile = buildReliabilityProfile({
      engineVersion: '2.1.0',
      poseModel: 'lite',
      generatedAt: '2026-07-19T00:00:00.000Z',
      nSubjects: 3,
      capturesAssessed: 6,
      unreliableFindingsExcluded: 0,
      perMetric: { pelvic_obliquity: metric },
    })

    expect(profile).toMatchObject({
      schemaVersion: RELIABILITY_PROFILE_SCHEMA_VERSION,
      algorithmVersion: RELIABILITY_ALGORITHM_VERSION,
      protocolVersion: RELIABILITY_PROTOCOL_VERSION,
      engineVersion: '2.1.0',
      poseModel: 'lite',
      label: 'pilot',
      consumerEligible: false,
      method: {
        icc: 'ICC(2,1): two-way random, absolute agreement, single measure',
        sem: 'pooled sample SD * sqrt(1 - clamp(ICC, 0, 1))',
        mdc95: '1.96 * sqrt(2) * SEM',
      },
    })
    expect(profile.caveats).toContain('No confidence intervals are reported; this pilot profile must not gate report comparisons.')
  })
})
